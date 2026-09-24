// @ts-check
/**
 * 감시 ⑩ 범위 보강 — 권한 정의 지문 비교·판정 공용 모듈(세션569). 순수 함수만(DB 호출 0).
 *
 * DB 쪽 `permission_fingerprint()`/`permission_drift_snapshot()`(마이그 20260924000400)이 권한과
 * 관련된 정의를 항목 단위 지문 `{k, n, d, h}` 로 떠 주면, 여기서 사람이 승인한 기준선과 대조한다.
 * 쓰는 곳: scripts/monitor-collectors.mjs(주 1회 감시 ⑩) · scripts/perm-baseline.mjs(미리보기·승인).
 *
 * 원칙: 값(기준선 내용·차이 세부)은 DB·텔레그램·로컬 비공개 파일에만, 코드는 공개 저장소에.
 * 설계 문서(비공개, 깃 미추적) = .omc/artifacts/session569/perm_fingerprint_design.md
 */

/**
 * @typedef {{ k: string, n: string, d: Record<string, any>, h: string }} FpItem
 * @typedef {{ server_version_num?: number, scope_version?: number, item_count?: number, total_hash?: string, items?: FpItem[] }} Fingerprint
 * @typedef {Fingerprint & { id?: number, accepted_at?: string, note?: string }} Baseline
 * @typedef {{ current?: Fingerprint | null, baseline?: Baseline | null }} DriftSnapshot
 * @typedef {{ path: string, before: any, after: any }} FieldDiff
 * @typedef {{ k: string, n: string, before: Record<string, any>, after: Record<string, any>, hBefore: string, hAfter: string, fields: FieldDiff[] }} ChangedItem
 * @typedef {{ added: FpItem[], removed: FpItem[], changed: ChangedItem[], majorChanged: boolean, scopeChanged: boolean,
 *   majorBefore: number | null, majorAfter: number | null, scopeBefore: number | null, scopeAfter: number | null }} FpDiff
 * @typedef {{ kind: "nulls", collector: string, detail: string, lines: string[], at: string }} PermIssue
 */

/** 규칙(또는 지문 섹션) 하나가 텔레그램 메시지에 싣는 항목 줄 상한. 넘치면 "… 외 N건" 으로 접는다
 * (세션568) — 한 규칙이 수백 줄이면 텔레그램 400 으로 통째로 전송 스킵되어 다른 규칙까지
 * 사람에게 안 보이므로, 규칙마다 상한을 둬 나머지 규칙의 머리줄이 살아남게 한다.
 * (세션569 monitor-collectors.mjs 에서 옮김 — monitor 가 다시 export 한다.) */
export const DB_PERM_ITEMS_PER_RULE = 10;

/**
 * 항목 목록을 `DB_PERM_ITEMS_PER_RULE` 개까지만 남기고 넘치면 "… 외 N건" 한 줄을 덧붙인다.
 * 머리줄(`[Rn] … N건`)의 개수는 이 함수가 건드리지 않는다 — 호출부에서 자르기 전 전체
 * 개수를 이미 박아 넣는다.
 * @param {string[]} lines 이미 "  · " 접두가 붙은 항목 줄들
 * @returns {string[]}
 */
export function capRuleItems(lines) {
  if (lines.length <= DB_PERM_ITEMS_PER_RULE) return lines;
  const shown = lines.slice(0, DB_PERM_ITEMS_PER_RULE);
  const omitted = lines.length - DB_PERM_ITEMS_PER_RULE;
  return [...shown, `  · … 외 ${omitted}건`];
}

/** 2u 민감 표 — 첫 기준선 주의 항목 A7 에 정책·권한 전부를 항상 싣는다. */
export const SENSITIVE_TABLES = ["user_profiles", "payments", "billing_keys"];

/** 지문 항목 종류 → 사람 말. */
export const KIND_LABEL = /** @type {Record<string, string>} */ ({
  relation: "표/뷰",
  policy: "정책",
  bucket: "버킷",
  function: "함수",
  schema: "스키마",
  default_acl: "기본 권한",
  extension: "확장",
  role: "역할",
});

/** relkind → 사람 말. */
const RELKIND_LABEL = /** @type {Record<string, string>} */ ({
  r: "표", p: "분할 표", v: "뷰", m: "구체화 뷰", f: "외부 표",
});

/** 값 하나를 텔레그램 줄에 실을 때의 글자 상한(넘치면 "…"). */
export const FP_VALUE_MAX = 80;

// ── 판정 공용(세션569 monitor-collectors.mjs 에서 옮김 — 감시 R 규칙과 주의 항목이 같은 잣대를 쓴다) ──

/**
 * `USING`/`WITH CHECK` 표현식이 정확히 "service_role 만 통과"하는 문구인지. 부분 일치로 판정하면
 * `auth.role() = 'service_role' OR true` 같은 위험한 정책까지 서비스 전용으로 오분류된다 —
 * 실측(2026-09-24) 서비스 전용 정책 43개는 전부 qual 이 정확히 아래 문구다.
 * @param {string | null | undefined} expr
 * @returns {boolean}
 */
export function isServiceRoleOnly(expr) {
  if (expr == null) return false;
  const n = String(expr).toLowerCase().replace(/\s+/g, "");
  return n === "(auth.role()='service_role'::text)";
}

/**
 * 문자열 전체가 하나의 괄호쌍으로 감싸여 있으면 그 바깥 괄호 한 겹을 벗긴다.
 * `(a)or(b)` 처럼 첫 괄호가 중간에서 닫히는 경우는 벗기지 않는다.
 * @param {string} s
 * @returns {string}
 */
function stripOuterParens(s) {
  if (!s.startsWith("(") || !s.endsWith(")")) return s;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") {
      depth--;
      if (depth === 0 && i !== s.length - 1) return s;
    }
  }
  return s.slice(1, -1);
}

/**
 * "로그인해야만 통과"로 인정하는 **정확한 모양 목록**(세션569, 구멍 ④). 소문자·공백 제거·바깥 괄호
 * 한 겹을 벗긴 식이 이 중 하나와 **통째로** 같을 때만 참이다. `auth.uid()` 가 언급만 됐다고 로그인
 * 필수로 보면 `(auth.uid() = owner) OR (owner IS NULL)`·`auth.uid() IS NULL`·
 * `COALESCE(auth.uid(), owner) = owner`·`auth.uid() IS DISTINCT FROM owner` 처럼 비로그인도 통과하는
 * 식을 놓친다 — 목록 밖은 전부 "도달 가능"(보수적)으로 본다.
 * ①`auth.uid()=칸` ②`칸=auth.uid()` ③`(auth.uid())::text=(칸)::text`(운영 실측 3개가 이 꼴)
 * ④③의 좌우 반대 ⑤`auth.role()='authenticated'`(::text 는 있어도 없어도).
 */
export const LOGIN_REQUIRED_SHAPES = [
  /^auth\.uid\(\)=[a-z_][a-z0-9_]*$/,
  /^[a-z_][a-z0-9_]*=auth\.uid\(\)$/,
  /^\(auth\.uid\(\)\)::text=\([a-z_][a-z0-9_]*\)::text$/,
  /^\([a-z_][a-z0-9_]*\)::text=\(auth\.uid\(\)\)::text$/,
  /^auth\.role\(\)='authenticated'(::text)?$/,
];

/**
 * 표현식이 "로그인해야만 통과"하는 정확한 모양인지(구멍 ④ — 모양 목록 밖은 도달 가능으로 본다).
 * @param {string | null | undefined} expr
 * @returns {boolean}
 */
export function requiresLogin(expr) {
  if (expr == null) return false;
  const inner = stripOuterParens(String(expr).toLowerCase().replace(/\s+/g, ""));
  return LOGIN_REQUIRED_SHAPES.some((re) => re.test(inner));
}

/**
 * 정책이 `cmd` 에 대해 실제로 거는 식 목록(세션569 검사관 🟡2). PostgreSQL 규칙 그대로:
 * SELECT·DELETE = USING(qual) · INSERT = WITH CHECK(없으면 ALL 정책은 USING 을 쓰고, INSERT 전용은 제약 없음)
 * · UPDATE = USING + WITH CHECK(없으면 USING). null 은 "제약 없음(참)"이다.
 * 옛 판정은 명령과 무관하게 qual·with_check 둘 다 봐서, `FOR ALL USING (true) WITH CHECK (auth.uid() = owner)`
 * 의 **읽기**를 로그인 필수로 오판했다(WITH CHECK 는 읽기에 안 걸린다).
 * @param {{ cmd?: unknown, qual?: string | null, with_check?: string | null }} p
 * @param {"SELECT" | "INSERT" | "UPDATE" | "DELETE"} cmd
 * @returns {Array<string | null>}
 */
export function exprsForCmd(p, cmd) {
  const qual = p.qual ?? null;
  const check = p.with_check ?? null;
  if (cmd === "SELECT" || cmd === "DELETE") return [qual];
  if (cmd === "INSERT") return [check ?? (p.cmd === "ALL" ? qual : null)];
  return [qual, check ?? qual];
}

/**
 * 이 정책이 `role` 의 `cmd` 를 **통과시키지 못하는가** — 그 명령에 걸리는 식 중 하나라도 서비스 전용이거나,
 * anon 인데 로그인 필수 정확 모양이면 참(그 정책으로는 도달 불가).
 * @param {{ cmd?: unknown, qual?: string | null, with_check?: string | null }} p
 * @param {"anon" | "authenticated"} role
 * @param {"SELECT" | "INSERT" | "UPDATE" | "DELETE"} cmd
 * @returns {boolean}
 */
export function policyBlocksRole(p, role, cmd) {
  const exprs = exprsForCmd(p, cmd);
  if (exprs.some((e) => isServiceRoleOnly(e))) return true;
  if (role === "anon" && exprs.some((e) => requiresLogin(e))) return true;
  return false;
}

/**
 * 제한(RESTRICTIVE) 정책인가 — pg_policies.permissive 는 문자열 "PERMISSIVE"/"RESTRICTIVE" 다(구멍 ⑤).
 * 제한 정책은 다른 허용 정책을 좁힐 뿐 스스로 도달 근거가 되지 못한다.
 * @param {{ permissive?: unknown }} p
 * @returns {boolean}
 */
export function isRestrictive(p) {
  return String(p.permissive).toUpperCase() === "RESTRICTIVE";
}

// ── 정규화·비교 ─────────────────────────────────────────────────────────────

/**
 * 키를 재귀 정렬한 JSON 문자열 — 기대 파일의 정의(d)와 실제 정의를 글자 그대로 비교할 때 쓴다.
 * (DB 는 jsonb 라 키 순서가 이미 정규화돼 오지만, 사람이 손댄 기대 파일은 아닐 수 있다.)
 * @param {unknown} v
 * @returns {string}
 */
export function canonicalJson(v) {
  if (v === undefined) return "null";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map((x) => canonicalJson(x)).join(",")}]`;
  const obj = /** @type {Record<string, unknown>} */ (v);
  const keys = Object.keys(obj).sort(compareC);
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

/**
 * 바이트(코드 단위) 순 비교 — DB 의 COLLATE "C" 와 같은 순서(ASCII 이름 기준).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function compareC(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * @param {{ k: string, n: string }} a
 * @param {{ k: string, n: string }} b
 */
function compareItem(a, b) {
  return compareC(a.k, b.k) || compareC(a.n, b.n);
}

/** @param {{ k: string, n: string }} it */
function itemKey(it) {
  return `${it.k}\u0000${it.n}`;
}

/**
 * Postgres `server_version_num` → 큰 판(170006 → 17). 작은 판은 매 분기 바뀌어 비교하지 않는다.
 * @param {unknown} num
 * @returns {number | null}
 */
export function majorVersion(num) {
  const n = Number(num);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n / 10000);
}

/**
 * 정의 객체를 "경로 → 값" 으로 편다. 배열은 통째로 한 값(순서가 이미 정규화돼 온다).
 * @param {unknown} v
 * @param {string} prefix
 * @param {Map<string, unknown>} out
 */
function flatten(v, prefix, out) {
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    const obj = /** @type {Record<string, unknown>} */ (v);
    const keys = Object.keys(obj);
    if (keys.length === 0) out.set(prefix, {});
    for (const k of keys) flatten(obj[k], prefix ? `${prefix}.${k}` : k, out);
    return;
  }
  out.set(prefix, v);
}

/**
 * 두 정의의 칸 단위 차이.
 * @param {unknown} before
 * @param {unknown} after
 * @returns {FieldDiff[]}
 */
function fieldDiffs(before, after) {
  /** @type {Map<string, unknown>} */
  const a = new Map();
  /** @type {Map<string, unknown>} */
  const b = new Map();
  flatten(before, "", a);
  flatten(after, "", b);
  const paths = [...new Set([...a.keys(), ...b.keys()])].sort(compareC);
  /** @type {FieldDiff[]} */
  const out = [];
  for (const p of paths) {
    const x = a.has(p) ? a.get(p) : undefined;
    const y = b.has(p) ? b.get(p) : undefined;
    if (canonicalJson(x) !== canonicalJson(y)) out.push({ path: p || "(정의)", before: x ?? null, after: y ?? null });
  }
  return out;
}

/**
 * 현재 지문과 기준선 지문의 차이. 같음 판정은 **해시(h)** 로 한다(이름만 같다고 같은 게 아니다).
 * 해시만 다르고 칸 차이가 안 보이면 fields=[{path:"(정의)"}] 로 남긴다 — 버리지 않는다.
 * @param {Fingerprint | null | undefined} current
 * @param {Fingerprint | null | undefined} baseline
 * @returns {FpDiff}
 */
export function diffPermissionFingerprint(current, baseline) {
  const cur = /** @type {FpItem[]} */ ((current?.items ?? []).slice()).sort(compareItem);
  const base = /** @type {FpItem[]} */ ((baseline?.items ?? []).slice()).sort(compareItem);
  const baseMap = new Map(base.map((it) => [itemKey(it), it]));
  const curMap = new Map(cur.map((it) => [itemKey(it), it]));
  /** @type {FpItem[]} */
  const added = [];
  /** @type {ChangedItem[]} */
  const changed = [];
  for (const it of cur) {
    const prev = baseMap.get(itemKey(it));
    if (!prev) {
      added.push(it);
      continue;
    }
    if (prev.h === it.h) continue;
    const fields = fieldDiffs(prev.d, it.d);
    changed.push({
      k: it.k, n: it.n, before: prev.d, after: it.d, hBefore: prev.h, hAfter: it.h,
      fields: fields.length > 0 ? fields : [{ path: "(정의)", before: null, after: null }],
    });
  }
  const removed = base.filter((it) => !curMap.has(itemKey(it)));
  const majorBefore = majorVersion(baseline?.server_version_num);
  const majorAfter = majorVersion(current?.server_version_num);
  const scopeBefore = baseline?.scope_version ?? null;
  const scopeAfter = current?.scope_version ?? null;
  return {
    added, removed, changed,
    majorChanged: majorBefore != null && majorAfter != null && majorBefore !== majorAfter,
    scopeChanged: scopeBefore != null && scopeAfter != null && scopeBefore !== scopeAfter,
    majorBefore, majorAfter, scopeBefore, scopeAfter,
  };
}

// ── 사람 말 요약 ─────────────────────────────────────────────────────────────

/**
 * 값 하나를 한 줄 글자로(길면 "…").
 * @param {unknown} v
 * @param {number} [max]
 * @returns {string}
 */
export function formatValue(v, max = FP_VALUE_MAX) {
  const s = v == null ? "null" : typeof v === "string" ? v : canonicalJson(v);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * 추가된 항목 한 줄 요약(종류별로 핵심만).
 * @param {FpItem} it
 * @returns {string}
 */
function describeItem(it) {
  const d = it.d ?? {};
  if (it.k === "policy") {
    const roles = Array.isArray(d.roles) ? d.roles.join(",") : "?";
    const restrict = String(d.permissive).toUpperCase() === "RESTRICTIVE" ? ", 제한" : "";
    const using = d.qual != null ? ` USING ${formatValue(d.qual)}` : "";
    const check = d.with_check != null ? ` CHECK ${formatValue(d.with_check)}` : "";
    return `(FOR ${d.cmd} TO ${roles}${restrict})${using}${check}`;
  }
  if (it.k === "relation") {
    const g = d.grants ?? {};
    const parts = [RELKIND_LABEL[d.kind] ?? String(d.kind)];
    for (const r of ["anon", "authenticated", "public"]) {
      if (Array.isArray(g[r]) && g[r].length > 0) parts.push(`${r}: ${g[r].join("/")}`);
    }
    if (d.kind === "v") parts.push(`security_invoker=${d.security_invoker}`);
    if (d.kind === "r" || d.kind === "p") parts.push(`RLS=${d.rls}`);
    return `(${parts.join(", ")})`;
  }
  if (it.k === "function") {
    const ex = d.execute ?? {};
    const who = ["anon", "authenticated", "public"].filter((r) => ex[r] === true);
    return `(${d.security_definer ? "정의자" : "호출자"} 권한, 실행: ${who.length > 0 ? who.join("/") : "제한"})`;
  }
  if (it.k === "bucket") return `(${d.public ? "공개" : "비공개"})`;
  return `(${formatValue(d)})`;
}

/**
 * 기준선 승인 시각을 KST MM-DD 로.
 * @param {string | undefined} iso
 * @returns {string}
 */
function kstMonthDay(iso) {
  if (!iso) return "?";
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "?";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit" }).formatToParts(t);
  const mm = parts.find((p) => p.type === "month")?.value ?? "??";
  const dd = parts.find((p) => p.type === "day")?.value ?? "??";
  return `${mm}-${dd}`;
}

/**
 * 감시 ⑩ 지문 판정 — `permission_drift_snapshot()` 결과(또는 RPC 실패)를 Issue 목록으로.
 *
 * | 상황 | 결과 |
 * | RPC 실패 | 실행 실패 이슈 |
 * | 기준선 없음 | "기준선 없음 — 첫 승인 필요" 이슈(조용히 안 넘긴다) |
 * | 범위 판(scope_version) 다름 | 맨 앞 재승인 줄 + 차이 목록(차이 0 이어도 이슈) |
 * | 큰 판 다름 + 차이 있음 | 맨 앞 원인 줄 + 차이 목록 |
 * | 큰 판 다름 + 차이 0 | [] (안내는 `describeDriftOk` 가 "이상 없음" 줄 뒤에) |
 * | 작은 판만 다름 | 비교 안 함(판 번호 무시) |
 * | 차이 있음 / 없음 | 이슈 1건 / [] |
 * @param {DriftSnapshot | null | undefined} snapshot
 * @param {{ rpcError?: string | null, now?: Date }} [opts]
 * @returns {PermIssue[]}
 */
export function evaluatePermissionDrift(snapshot, opts = {}) {
  const at = (opts.now ?? new Date()).toISOString();
  if (!snapshot || !snapshot.current) {
    const code = opts.rpcError ?? "알 수 없는 오류";
    return [{
      kind: "nulls",
      collector: "db-permissions",
      detail: `권한 지문 점검 실행 실패 — ${code}`,
      lines: [
        "permission_drift_snapshot() RPC 호출이 실패했습니다(오류 코드만 기록).",
        "[조치] 마이그 20260924000400 이 적용됐는지, service_role 에 EXECUTE 권한이 있는지 확인하세요.",
      ],
      at: `fp-rpc-fail:${code}`,
    }];
  }
  const current = snapshot.current;
  const baseline = snapshot.baseline ?? null;
  if (!baseline) {
    return [{
      kind: "nulls",
      collector: "db-permissions",
      detail: "권한 지문 기준선 없음 — 첫 승인 필요",
      lines: [
        `[지문] 기준선 없음 — 현재 ${current.item_count ?? (current.items ?? []).length}항목`,
        "[조치] node scripts/perm-baseline.mjs(미리보기) → 사장님 승인 → --accept --first --expect-hash=<미리보기 해시>",
      ],
      at,
    }];
  }

  const diff = diffPermissionFingerprint(current, baseline);
  const total = diff.added.length + diff.removed.length + diff.changed.length;
  if (total === 0 && !diff.scopeChanged) return [];

  /** @type {string[]} */
  const lines = [];
  if (diff.scopeChanged) {
    lines.push(`[지문] 지문 범위 규칙이 바뀜(v${diff.scopeBefore}→v${diff.scopeAfter}) — 재승인 필요`);
  }
  if (diff.majorChanged) {
    lines.push(`[지문] DB 큰 판 변경(${diff.majorBefore}→${diff.majorAfter}) — 정책 글자 재표기일 수 있음, 확인 후 재승인`);
  }
  lines.push(
    `[지문] 기준선 #${baseline.id ?? "?"}(${kstMonthDay(baseline.accepted_at)} 승인) 대비 — ` +
      `추가 ${diff.added.length} · 삭제 ${diff.removed.length} · 변경 ${diff.changed.length}`,
  );
  if (diff.added.length > 0) {
    lines.push(
      `[지문-추가] ${diff.added.length}건`,
      ...capRuleItems(diff.added.map((it) => `  · ${KIND_LABEL[it.k] ?? it.k} ${it.n}  ${describeItem(it)}`)),
    );
  }
  if (diff.removed.length > 0) {
    lines.push(
      `[지문-삭제] ${diff.removed.length}건`,
      ...capRuleItems(diff.removed.map((it) => `  · ${KIND_LABEL[it.k] ?? it.k} ${it.n}`)),
    );
  }
  if (diff.changed.length > 0) {
    lines.push(
      `[지문-변경] ${diff.changed.length}건`,
      ...capRuleItems(diff.changed.map((c) => {
        const shown = c.fields.slice(0, 3).map((f) =>
          f.path === "(정의)" ? "(정의)" : `${f.path}: ${formatValue(f.before)} → ${formatValue(f.after)}`);
        const more = c.fields.length > 3 ? ` 외 ${c.fields.length - 3}칸` : "";
        return `  · ${KIND_LABEL[c.k] ?? c.k} ${c.n} — ${shown.join(" / ")}${more}`;
      })),
    );
  }
  return [{
    kind: "nulls",
    collector: "db-permissions",
    // 공개 콘솔(formatIssueForConsole)에 남는 유일한 글 — 개수만.
    detail: `권한 정의 지문 — 추가 ${diff.added.length} · 삭제 ${diff.removed.length} · 변경 ${diff.changed.length}` +
      (diff.scopeChanged ? " (범위 규칙 변경)" : ""),
    lines,
    at,
  }];
}

/**
 * 지문 경보가 없을 때 "이상 없음" 줄 뒤에 붙일 글 — `suffix`(같은 줄) + `notice`(다음 줄, 없으면 null).
 * 큰 판만 바뀌고 지문 차이가 0 이면 경보 대신 notice 로 알린다.
 * @param {DriftSnapshot | null | undefined} snapshot
 * @returns {{ suffix: string, notice: string | null }}
 */
export function describeDriftOk(snapshot) {
  const cur = snapshot?.current;
  const base = snapshot?.baseline;
  if (!cur || !base) return { suffix: "", notice: null };
  const count = cur.item_count ?? (cur.items ?? []).length;
  const suffix = ` (지문 ${count}항목 · 기준선 #${base.id ?? "?"} ${kstMonthDay(base.accepted_at)})`;
  const mb = majorVersion(base.server_version_num);
  const ma = majorVersion(cur.server_version_num);
  const notice = mb != null && ma != null && mb !== ma
    ? `DB 큰 판 ${mb}→${ma}(지문 차이 0) — 재승인하면 사라짐`
    : null;
  return { suffix, notice };
}

// ── 기대 파일(의도한 변경의 기계 대조, 설계 §5-4) ──────────────────────────────

/**
 * 차이를 기대 파일 모양으로 — `perm-baseline.mjs --make-expect` 가 되돌림 시험 덤프(적용 뒤 지문)와
 * 지금 기준선의 차이로 만든다.
 * @param {FpDiff} diff
 * @param {string} baseTotalHash
 * @param {string} source
 */
export function makeExpectFile(diff, baseTotalHash, source) {
  return {
    version: 1,
    base_total_hash: baseTotalHash,
    source,
    changes: [
      ...diff.added.map((it) => ({ op: "add", k: it.k, n: it.n, h: it.h, d: it.d })),
      ...diff.changed.map((c) => ({ op: "change", k: c.k, n: c.n, h: c.hAfter, d: c.after })),
      ...diff.removed.map((it) => ({ op: "remove", k: it.k, n: it.n })),
    ],
  };
}

/**
 * 지금 차이가 기대 파일과 **정확히** 같은지 — 하나라도 어긋나면 ok=false(승인 거부).
 * ① base_total_hash = 지금 기준선 total_hash ② (op,k,n) 집합이 같다(많아도 적어도 거부)
 * ③ add·change 는 h 가 있으면 h 로, 없으면 canonicalJson(d) 로 정의까지 같다(이름만 같은 승인 차단).
 * @param {FpDiff} diff
 * @param {string | null | undefined} baselineTotalHash
 * @param {any} expect
 * @returns {{ ok: boolean, mismatches: string[] }}
 */
export function compareWithExpectFile(diff, baselineTotalHash, expect) {
  /** @type {string[]} */
  const mismatches = [];
  if (!expect || typeof expect !== "object" || expect.version !== 1 || !Array.isArray(expect.changes)) {
    return { ok: false, mismatches: ["기대 파일 형식이 아님(version 1 · changes 배열 필요)"] };
  }
  if (!baselineTotalHash || expect.base_total_hash !== baselineTotalHash) {
    mismatches.push(`기준선 해시 다름 — 기대 ${expect.base_total_hash ?? "(없음)"} / 지금 ${baselineTotalHash ?? "(없음)"}`);
  }
  /** @type {Map<string, any>} */
  const expected = new Map();
  for (const c of expect.changes) {
    if (!c || !["add", "change", "remove"].includes(c.op) || typeof c.k !== "string" || typeof c.n !== "string") {
      mismatches.push(`기대 항목 형식 오류: ${formatValue(c)}`);
      continue;
    }
    if (c.op !== "remove" && c.h == null && c.d == null) {
      mismatches.push(`기대 항목에 h·d 둘 다 없음(정의 대조 불가): ${c.op} ${c.k} ${c.n}`);
      continue;
    }
    const key = `${c.op}\u0000${c.k}\u0000${c.n}`;
    if (expected.has(key)) mismatches.push(`기대 항목 중복: ${c.op} ${c.k} ${c.n}`);
    expected.set(key, c);
  }
  /** @type {Array<{ op: string, k: string, n: string, h?: string, d?: any }>} */
  const actual = [
    ...diff.added.map((it) => ({ op: "add", k: it.k, n: it.n, h: it.h, d: it.d })),
    ...diff.changed.map((c) => ({ op: "change", k: c.k, n: c.n, h: c.hAfter, d: c.after })),
    ...diff.removed.map((it) => ({ op: "remove", k: it.k, n: it.n })),
  ];
  const seen = new Set();
  for (const a of actual) {
    const key = `${a.op}\u0000${a.k}\u0000${a.n}`;
    seen.add(key);
    const e = expected.get(key);
    if (!e) {
      mismatches.push(`예상 밖 변화: ${a.op} ${a.k} ${a.n}`);
      continue;
    }
    if (a.op === "remove") continue;
    const same = e.h != null ? e.h === a.h : canonicalJson(e.d) === canonicalJson(a.d);
    if (!same) mismatches.push(`정의가 기대와 다름: ${a.op} ${a.k} ${a.n}`);
  }
  for (const [key, e] of expected) {
    if (!seen.has(key)) mismatches.push(`기대했지만 없는 변화: ${e.op} ${e.k} ${e.n}`);
  }
  return { ok: mismatches.length === 0, mismatches };
}

// ── 첫 기준선 주의 항목(설계 §5-2 A1~A9) ─────────────────────────────────────

/**
 * 정책 항목 이름 `schema.table/policy` → { schema, table, policy }.
 * @param {string} n
 */
function splitPolicyName(n) {
  const slash = n.indexOf("/");
  const rel = slash >= 0 ? n.slice(0, slash) : n;
  const dot = rel.indexOf(".");
  return { rel, schema: rel.slice(0, dot), table: rel.slice(dot + 1), policy: slash >= 0 ? n.slice(slash + 1) : "" };
}

/**
 * 지문의 관계 항목 하나에 대해 `role` 이 `cmd` 로 **실제로** 도달 가능한지(감시 R1/R4 와 같은 잣대).
 * @param {FpItem} rel
 * @param {FpItem[]} policiesOfRel
 * @param {"anon" | "authenticated"} role
 * @param {"SELECT" | "INSERT" | "UPDATE" | "DELETE"} cmd
 * @returns {boolean}
 */
function reachableFp(rel, policiesOfRel, role, cmd) {
  const d = rel.d ?? {};
  if (d.kind === "v" || d.kind === "m" || d.kind === "f") return true; // RLS 가 없는 관계 — 권한이 곧 도달
  const applicable = policiesOfRel.filter((p) => {
    const pd = p.d ?? {};
    if (isRestrictive(pd)) return false;
    if (!(pd.cmd === cmd || pd.cmd === "ALL")) return false;
    const roles = (Array.isArray(pd.roles) ? pd.roles : []).map((r) => String(r).toLowerCase());
    return roles.includes(role) || roles.includes("public");
  });
  if (applicable.length === 0) return d.rls !== true;
  return applicable.some((p) => !policyBlocksRole(p.d ?? {}, role, cmd));
}

/**
 * @param {Record<string, any>} d 관계 정의
 * @param {"anon" | "authenticated"} role
 * @param {string} priv
 */
function hasRelPriv(d, role, priv) {
  const g = d.grants ?? {};
  const own = Array.isArray(g[role]) && g[role].includes(priv);
  const pub = Array.isArray(g.public) && g.public.includes(priv);
  const col = Array.isArray(d.column_grants) &&
    d.column_grants.some((/** @type {string} */ s) => s.startsWith(`${role}:${priv}:`) || s.startsWith(`PUBLIC:${priv}:`));
  return own || pub || col;
}

/**
 * 첫 기준선(또는 재승인) 때 사람이 꼭 봐야 할 항목을 지문에서 **자동으로** 뽑는다(메인이 손으로 추리지 않는다).
 * 반환은 항상 A1~A9 9개(항목이 없으면 lines 빈 배열).
 * @param {Fingerprint | null | undefined} current
 * @param {{ sensitiveTables?: string[], publicReadTables?: string[] }} [opts]
 * @returns {Array<{ code: string, title: string, lines: string[] }>}
 */
export function extractAttentionItems(current, opts = {}) {
  const sensitive = opts.sensitiveTables ?? SENSITIVE_TABLES;
  const publicRead = new Set(opts.publicReadTables ?? []);
  const items = /** @type {FpItem[]} */ ((current?.items ?? []).slice()).sort(compareItem);
  const rels = items.filter((it) => it.k === "relation");
  const pols = items.filter((it) => it.k === "policy");
  /** @type {Map<string, FpItem[]>} */
  const polsByRel = new Map();
  for (const p of pols) {
    const { rel } = splitPolicyName(p.n);
    if (!polsByRel.has(rel)) polsByRel.set(rel, []);
    polsByRel.get(rel)?.push(p);
  }
  /** @param {FpItem} p */
  const polLine = (p) => {
    const d = p.d ?? {};
    const roles = Array.isArray(d.roles) ? d.roles.join(",") : "?";
    return `${p.n} — FOR ${d.cmd} TO ${roles} ${d.permissive}` +
      (d.qual != null ? ` USING ${d.qual}` : "") + (d.with_check != null ? ` CHECK ${d.with_check}` : "");
  };

  /** @type {string[]} */
  const a1 = [];
  /** @type {string[]} */
  const a9 = [];
  for (const r of rels) {
    const d = r.d ?? {};
    const tableName = r.n.slice(r.n.indexOf(".") + 1);
    const ps = polsByRel.get(r.n) ?? [];
    if (d.kind !== "v") {
      for (const role of /** @type {Array<"anon" | "authenticated">} */ (["anon", "authenticated"])) {
        if (hasRelPriv(d, role, "SELECT") && reachableFp(r, ps, role, "SELECT") &&
            !(r.n.startsWith("public.") && publicRead.has(tableName))) {
          a1.push(`${r.n} — ${role} 읽기 도달 가능(공개 읽기 기준 명단 밖)`);
        }
      }
    }
    for (const role of /** @type {Array<"anon" | "authenticated">} */ (["anon", "authenticated"])) {
      for (const cmd of /** @type {Array<"INSERT" | "UPDATE" | "DELETE">} */ (["INSERT", "UPDATE", "DELETE"])) {
        if (hasRelPriv(d, role, cmd) && d.kind !== "v" && reachableFp(r, ps, role, cmd)) {
          a9.push(`${r.n} — ${role} ${cmd} 도달 가능`);
        }
      }
    }
  }

  const a2 = pols
    .filter((p) => {
      const d = p.d ?? {};
      const text = `${d.qual ?? ""} ${d.with_check ?? ""}`;
      return /auth\.[a-z_]+\(\)/i.test(text) && !isServiceRoleOnly(d.qual) && !isServiceRoleOnly(d.with_check);
    })
    .map(polLine);

  const a3 = rels
    .filter((r) => r.d?.kind === "v" || r.d?.kind === "m")
    .map((r) => {
      const d = r.d ?? {};
      if (d.kind === "v") return `${r.n} — 뷰, security_invoker=${d.security_invoker}`;
      return `${r.n} — 구체화 뷰(RLS 없음), anon SELECT=${hasRelPriv(d, "anon", "SELECT")}`;
    });

  const a4 = items
    .filter((it) => it.k === "function" && it.d?.security_definer === true)
    .map((it) => `${it.n} — 정의자, 실행 ${formatValue(it.d?.execute ?? {})}`);

  const a5 = items
    .filter((it) => it.k === "default_acl" && Array.isArray(it.d?.grants) && it.d.grants.length > 0)
    .map((it) => `${it.n} — ${it.d.grants.join(", ")}`);

  const a6 = items
    .filter((it) => it.k === "role")
    .map((it) => `${it.n} — bypassrls=${it.d?.bypassrls} superuser=${it.d?.superuser} 소속=[${(it.d?.member_of ?? []).join(", ")}]`);

  /** @type {string[]} */
  const a7 = [];
  for (const t of sensitive) {
    const r = rels.find((x) => x.n === `public.${t}`);
    if (!r) {
      a7.push(`public.${t} — (지문에 없음)`);
      continue;
    }
    const d = r.d ?? {};
    const g = d.grants ?? {};
    a7.push(`public.${t} — RLS=${d.rls} · anon: ${(g.anon ?? []).join("/") || "없음"} · authenticated: ${(g.authenticated ?? []).join("/") || "없음"}` +
      ` · public: ${(g.public ?? []).join("/") || "없음"} · 칸 권한 ${(d.column_grants ?? []).length}개`);
    const ps = polsByRel.get(`public.${t}`) ?? [];
    if (ps.length === 0) a7.push(`  └ 정책 0개`);
    for (const p of ps) a7.push(`  └ ${polLine(p)}`);
  }

  /** @type {string[]} */
  const a8 = [];
  for (const b of items.filter((it) => it.k === "bucket" && it.d?.public === true)) a8.push(`버킷 ${b.n} — 공개`);
  for (const p of pols) {
    if (!p.n.startsWith("storage.")) continue;
    const roles = (Array.isArray(p.d?.roles) ? p.d.roles : []).map((r) => String(r).toLowerCase());
    if (roles.some((r) => r === "anon" || r === "authenticated" || r === "public")) a8.push(polLine(p));
  }

  return [
    { code: "A1", title: "anon·authenticated 가 실제로 읽는데 공개 읽기 기준 명단 밖인 표", lines: a1 },
    { code: "A2", title: "서비스 전용이 아닌 정책 중 auth.*() 를 쓰는 것(식 원문)", lines: a2 },
    { code: "A3", title: "뷰·구체화 뷰와 security_invoker", lines: a3 },
    { code: "A4", title: "SECURITY DEFINER 함수(실행 역할 포함)", lines: a4 },
    { code: "A5", title: "anon·authenticated·PUBLIC 대상 기본 권한", lines: a5 },
    { code: "A6", title: "anon·authenticated·authenticator 소속 역할·BYPASSRLS", lines: a6 },
    { code: "A7", title: "2u 민감 표의 정책·권한 전부", lines: a7 },
    { code: "A8", title: "공개 버킷 · anon/authenticated/public 대상 storage 정책", lines: a8 },
    { code: "A9", title: "anon·authenticated 쓰기가 실제로 도달 가능한 표", lines: a9 },
  ];
}

/**
 * 종류별 항목 수.
 * @param {Fingerprint | null | undefined} fp
 * @returns {Record<string, number>}
 */
export function countByKind(fp) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const it of fp?.items ?? []) out[it.k] = (out[it.k] ?? 0) + 1;
  return out;
}
