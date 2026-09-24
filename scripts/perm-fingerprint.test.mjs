// @ts-check
// 감시 ⑩ 범위 보강 — 권한 정의 지문 비교·판정·기대 파일 대조·주의 항목·승인 스크립트 안전장치(세션569).
// 고정 데이터는 가짜 이름만(t_demo, p_demo …). 정책 식 글자는 Postgres 가 되살리는 모양을 따른다
// (⚠️ S2 운영 되돌림 시험에서 실제로 되살린 글자가 나오면 그것으로 바꿀 것).
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  diffPermissionFingerprint,
  evaluatePermissionDrift,
  describeDriftOk,
  compareWithExpectFile,
  makeExpectFile,
  extractAttentionItems,
  canonicalJson,
  majorVersion,
  DB_PERM_ITEMS_PER_RULE,
  SENSITIVE_TABLES,
} from "./_perm-fingerprint.mjs";
import { refuseInCi, parseArgs, decideAccept, isHashMismatch, buildPreview } from "./perm-baseline.mjs";
import { formatIssueForConsole, buildMessages } from "./notify-telegram.mjs";

/**
 * @param {string} k
 * @param {string} n
 * @param {Record<string, any>} d
 */
function item(k, n, d) {
  return { k, n, d, h: createHash("md5").update(canonicalJson(d)).digest("hex") };
}

/** @param {string[]} anon @param {string[]} [auth] */
function relDef(anon, auth = []) {
  return {
    kind: "r", owner: "postgres", rls: true, rls_forced: false, security_invoker: null, security_barrier: null,
    grants: { anon, authenticated: auth, public: [] }, column_grants: [], body_md5: null,
  };
}

/** @param {string} qual @param {string[]} [roles] @param {string} [cmd] */
function polDef(qual, roles = ["public"], cmd = "SELECT") {
  return { cmd, permissive: "PERMISSIVE", roles, qual, with_check: null };
}

function baseItems() {
  return [
    item("relation", "public.t_demo", relDef(["SELECT"], ["SELECT"])),
    item("policy", "public.t_demo/p_demo", polDef("(auth.role() = 'service_role'::text)", ["public"], "ALL")),
    item("role", "anon", { bypassrls: false, superuser: false, member_of: [] }),
  ];
}

/**
 * @param {any[]} items
 * @param {{ ver?: number, scope?: number }} [o]
 */
function fp(items, o = {}) {
  return { server_version_num: o.ver ?? 170006, scope_version: o.scope ?? 1, item_count: items.length, total_hash: `hash-${items.length}`, items };
}

/**
 * @param {any[]} curItems
 * @param {{ ver?: number, scope?: number, baseVer?: number, baseScope?: number, baseItems?: any[] }} [o]
 */
function snap(curItems, o = {}) {
  return {
    current: fp(curItems, { ver: o.ver, scope: o.scope }),
    baseline: { id: 3, accepted_at: "2026-09-29T00:00:00+00:00", note: "첫 기준선", ...fp(o.baseItems ?? baseItems(), { ver: o.baseVer, scope: o.baseScope }) },
  };
}

/** @param {any[]} issues */
function body(issues) {
  return issues.map((i) => i.lines.join("\n")).join("\n");
}

const NOW = new Date("2026-09-28T00:00:00Z");

describe("evaluatePermissionDrift — 지문 비교", () => {
  it("1. 현재 = 기준선 → Issue 0", () => {
    expect(evaluatePermissionDrift(snap(baseItems()), { now: NOW })).toEqual([]);
  });

  it("2. 추가 → [지문-추가] 1건 + 종류·이름", () => {
    const cur = [...baseItems(), item("policy", "public.t_demo/p_new", polDef("true", ["authenticated"]))];
    const issues = evaluatePermissionDrift(snap(cur), { now: NOW });
    expect(issues).toHaveLength(1);
    const b = body(issues);
    expect(b).toMatch(/\[지문-추가\] 1건/);
    expect(b).toMatch(/정책 public\.t_demo\/p_new/);
    expect(b).toMatch(/FOR SELECT TO authenticated/);
    expect(b).toMatch(/추가 1 · 삭제 0 · 변경 0/);
  });

  it("3. 삭제 → [지문-삭제]", () => {
    const cur = baseItems().filter((i) => i.k !== "role");
    const b = body(evaluatePermissionDrift(snap(cur), { now: NOW }));
    expect(b).toMatch(/\[지문-삭제\] 1건/);
    expect(b).toMatch(/역할 anon/);
  });

  it("4. 정책 qual 변경 → 전 → 후", () => {
    const cur = baseItems().map((i) => i.n === "public.t_demo/p_demo"
      ? item("policy", i.n, polDef("((auth.uid() = owner) OR (owner IS NULL))", ["public"], "ALL")) : i);
    const b = body(evaluatePermissionDrift(snap(cur), { now: NOW }));
    expect(b).toMatch(/\[지문-변경\] 1건/);
    expect(b).toMatch(/qual: \(auth\.role\(\) = 'service_role'::text\) → \(\(auth\.uid\(\) = owner\) OR \(owner IS NULL\)\)/);
  });

  it("5. grants.authenticated 변경", () => {
    const cur = baseItems().map((i) => i.n === "public.t_demo" ? item("relation", i.n, relDef(["SELECT"], ["SELECT", "UPDATE"])) : i);
    const b = body(evaluatePermissionDrift(snap(cur), { now: NOW }));
    expect(b).toMatch(/grants\.authenticated: \["SELECT"\] → \["SELECT","UPDATE"\]/);
  });

  it("6. 뷰 security_invoker true → false", () => {
    const v = { ...relDef(["SELECT"]), kind: "v", rls: false, security_invoker: true, security_barrier: false };
    const base = [...baseItems(), item("relation", "public.v_demo", v)];
    const cur = [...baseItems(), item("relation", "public.v_demo", { ...v, security_invoker: false, body_md5: "abc" })];
    const b = body(evaluatePermissionDrift(snap(cur, { baseItems: base }), { now: NOW }));
    expect(b).toMatch(/security_invoker: true → false/);
  });

  it("7. 해시만 다르고 칸 차이가 안 보이면 '(정의)' 줄로 남긴다(버리지 않는다)", () => {
    const base = baseItems();
    const cur = base.map((i) => i.k === "role" ? { ...i, h: "different-hash" } : i);
    const b = body(evaluatePermissionDrift(snap(cur, { baseItems: base }), { now: NOW }));
    expect(b).toMatch(/\[지문-변경\] 1건/);
    expect(b).toMatch(/역할 anon — \(정의\)/);
  });

  it("8. 기준선 없음 → '기준선 없음' 이슈(조용히 안 넘김)", () => {
    const issues = evaluatePermissionDrift({ current: fp(baseItems()), baseline: null }, { now: NOW });
    expect(issues).toHaveLength(1);
    expect(issues[0].detail).toMatch(/기준선 없음/);
    expect(issues[0].collector).toBe("db-permissions");
  });

  it("9. RPC 실패 → 실행 실패 이슈(오류 코드만)", () => {
    const issues = evaluatePermissionDrift(null, { rpcError: "PGRST202" });
    expect(issues).toHaveLength(1);
    expect(issues[0].detail).toMatch(/실행 실패 — PGRST202/);
    expect(issues[0].at).toBe("fp-rpc-fail:PGRST202");
  });

  it("10. 큰 판 변경 + 차이 있음 → 맨 앞 원인 줄 + 목록", () => {
    const cur = [...baseItems(), item("policy", "public.t_demo/p_new", polDef("true"))];
    const issues = evaluatePermissionDrift(snap(cur, { ver: 170006, baseVer: 150008 }), { now: NOW });
    expect(issues[0].lines[0]).toMatch(/DB 큰 판 변경\(15→17\)/);
    expect(body(issues)).toMatch(/\[지문-추가\] 1건/);
  });

  it("11. 큰 판 변경 + 차이 0 → 경보 0, 안내 한 줄만", () => {
    const s = snap(baseItems(), { ver: 170006, baseVer: 150008 });
    expect(evaluatePermissionDrift(s, { now: NOW })).toEqual([]);
    const ok = describeDriftOk(s);
    expect(ok.notice).toMatch(/DB 큰 판 15→17\(지문 차이 0\)/);
    expect(ok.suffix).toMatch(/지문 3항목 · 기준선 #3 09-29/);
  });

  it("12. 작은 판만 변경 → 아무것도 없음(이슈 0 · 안내 0)", () => {
    const s = snap(baseItems(), { ver: 170010, baseVer: 170006 });
    expect(evaluatePermissionDrift(s, { now: NOW })).toEqual([]);
    expect(describeDriftOk(s).notice).toBeNull();
    expect(majorVersion(170010)).toBe(17);
  });

  it("13. scope_version 변경 → 재승인 줄(차이 0 이어도 이슈)", () => {
    const issues = evaluatePermissionDrift(snap(baseItems(), { scope: 2, baseScope: 1 }), { now: NOW });
    expect(issues).toHaveLength(1);
    expect(issues[0].lines[0]).toMatch(/지문 범위 규칙이 바뀜\(v1→v2\) — 재승인 필요/);
  });

  it("14. 변경 25건 → 항목 10 + '… 외 15건', 머리줄은 25", () => {
    const base = [];
    const cur = [];
    for (let i = 0; i < 25; i++) {
      const n = `public.t_${String(i).padStart(2, "0")}/p_demo`;
      base.push(item("policy", n, polDef("true")));
      cur.push(item("policy", n, polDef("false")));
    }
    const b = evaluatePermissionDrift(snap(cur, { baseItems: base }), { now: NOW });
    const lines = b[0].lines;
    expect(lines.join("\n")).toMatch(/\[지문-변경\] 25건/);
    expect(lines.filter((l) => l.includes("/p_demo")).length).toBe(DB_PERM_ITEMS_PER_RULE);
    expect(lines.join("\n")).toMatch(/… 외 15건/);
  });

  it("15. 긴 qual 다수 → buildMessages 모든 통 ≤ 4,000자", () => {
    const base = [];
    const cur = [];
    const long = `(${"auth.uid() = owner AND ".repeat(40)}true)`;
    for (let i = 0; i < 30; i++) {
      base.push(item("policy", `public.t_${i}/p_a`, polDef(long)));
      cur.push(item("policy", `public.t_${i}/p_a`, polDef(`${long} OR true`)));
      cur.push(item("policy", `public.t_${i}/p_b`, polDef(long)));
    }
    const issues = evaluatePermissionDrift(snap(cur, { baseItems: base }), { now: NOW });
    const msgs = buildMessages(/** @type {any} */ (issues));
    expect(msgs.length).toBeGreaterThan(0);
    for (const m of msgs) expect(m.length).toBeLessThanOrEqual(4000);
    // 값 하나는 80자에서 자른다
    expect(issues[0].lines.some((l) => l.includes("…"))).toBe(true);
  });

  it("16. formatIssueForConsole 에 이름·qual 이 0(개수만)", () => {
    const cur = [...baseItems(), item("policy", "public.secret_tbl/secret_pol", polDef("(secret_qual_text = 1)"))];
    const issues = evaluatePermissionDrift(snap(cur), { now: NOW });
    const out = formatIssueForConsole(/** @type {any} */ (issues[0]));
    for (const leak of ["secret_tbl", "secret_pol", "secret_qual_text", "[지문"]) expect(out).not.toContain(leak);
    expect(out).toMatch(/추가 1 · 삭제 0 · 변경 0/);
  });

  it("17. 입력 순서를 섞어도 출력이 같다", () => {
    const cur = [...baseItems(), item("policy", "public.a/x", polDef("true")), item("policy", "public.b/y", polDef("true"))];
    const a = evaluatePermissionDrift(snap(cur), { now: NOW });
    const b = evaluatePermissionDrift(snap(cur.slice().reverse(), { baseItems: baseItems().reverse() }), { now: NOW });
    expect(a[0].lines).toEqual(b[0].lines);
  });
});

describe("compareWithExpectFile — 기대 파일 기계 대조", () => {
  const baseHash = "hash-3";
  const newPol = item("policy", "public.t_demo/own read", polDef("(auth.uid() = owner)", ["authenticated"]));
  const cur = [...baseItems(), newPol];
  const diff = diffPermissionFingerprint(fp(cur), fp(baseItems()));

  it("18. 정확히 일치 → ok(h 로도, d 로도)", () => {
    expect(compareWithExpectFile(diff, baseHash, makeExpectFile(diff, baseHash, "rt.json")).ok).toBe(true);
    const byDef = { version: 1, base_total_hash: baseHash, changes: [{ op: "add", k: "policy", n: newPol.n, d: newPol.d }] };
    expect(compareWithExpectFile(diff, baseHash, byDef)).toEqual({ ok: true, mismatches: [] });
  });

  it("19. 이름 같고 정의 다름(qual `true`) → 거부", () => {
    const wrong = item("policy", newPol.n, polDef("true", ["authenticated"]));
    const expectFile = { version: 1, base_total_hash: baseHash, changes: [{ op: "add", k: "policy", n: newPol.n, h: wrong.h }] };
    const r = compareWithExpectFile(diff, baseHash, expectFile);
    expect(r.ok).toBe(false);
    expect(r.mismatches.join("\n")).toMatch(/정의가 기대와 다름/);
    // d 로 적어도 똑같이 거부
    const byDef = { version: 1, base_total_hash: baseHash, changes: [{ op: "add", k: "policy", n: newPol.n, d: wrong.d }] };
    expect(compareWithExpectFile(diff, baseHash, byDef).ok).toBe(false);
  });

  it("20. 실제에 항목이 하나 더 → 거부 / 기대 항목이 빠짐 → 거부", () => {
    const expectFile = makeExpectFile(diff, baseHash, "rt.json");
    const extraDiff = diffPermissionFingerprint(fp([...cur, item("policy", "public.t_demo/sneaky", polDef("true"))]), fp(baseItems()));
    const r1 = compareWithExpectFile(extraDiff, baseHash, expectFile);
    expect(r1.ok).toBe(false);
    expect(r1.mismatches.join("\n")).toMatch(/예상 밖 변화: add policy public\.t_demo\/sneaky/);
    const emptyDiff = diffPermissionFingerprint(fp(baseItems()), fp(baseItems()));
    const r2 = compareWithExpectFile(emptyDiff, baseHash, expectFile);
    expect(r2.ok).toBe(false);
    expect(r2.mismatches.join("\n")).toMatch(/기대했지만 없는 변화/);
  });

  it("21. base_total_hash 다름 → 거부", () => {
    const expectFile = makeExpectFile(diff, "other-hash", "rt.json");
    const r = compareWithExpectFile(diff, baseHash, expectFile);
    expect(r.ok).toBe(false);
    expect(r.mismatches.join("\n")).toMatch(/기준선 해시 다름/);
  });

  it("h·d 둘 다 없는 add/change 항목은 파일 자체를 거부한다", () => {
    const bad = { version: 1, base_total_hash: baseHash, changes: [{ op: "add", k: "policy", n: newPol.n }] };
    expect(compareWithExpectFile(diff, baseHash, bad).ok).toBe(false);
  });
});

describe("extractAttentionItems — 첫 기준선 주의 항목 A1~A9", () => {
  it("22. 민감 표 3개의 정책·권한이 항상 포함되고 공개 버킷도 포함된다", () => {
    const items = [
      item("relation", "public.user_profiles", relDef(["SELECT"], ["SELECT"])),
      item("policy", "public.user_profiles/own read", polDef("((auth.uid())::text = (user_id)::text)", ["authenticated"])),
      item("relation", "public.payments", relDef(["SELECT", "INSERT", "UPDATE", "DELETE"], ["SELECT", "INSERT", "UPDATE", "DELETE"])),
      item("bucket", "b_demo", { public: true, file_size_limit: null, allowed_mime_types: null }),
      item("relation", "public.t_open", relDef(["SELECT"])),
      item("policy", "public.t_open/p_open", polDef("true", ["anon"])),
    ];
    const att = extractAttentionItems(fp(items), { publicReadTables: [] });
    expect(att.map((a) => a.code)).toEqual(["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9"]);
    const a7 = att.find((a) => a.code === "A7")?.lines.join("\n") ?? "";
    for (const t of SENSITIVE_TABLES) expect(a7).toContain(`public.${t}`);
    expect(a7).toMatch(/public\.user_profiles\/own read/);
    expect(a7).toMatch(/public\.payments — RLS=true · anon: SELECT\/INSERT\/UPDATE\/DELETE/);
    expect(a7).toMatch(/public\.billing_keys — \(지문에 없음\)/);
    expect(att.find((a) => a.code === "A8")?.lines.join("\n")).toMatch(/버킷 b_demo — 공개/);
    const a1 = att.find((a) => a.code === "A1")?.lines.join("\n") ?? "";
    expect(a1).toMatch(/public\.t_open — anon 읽기 도달 가능/);
    expect(a1).toMatch(/public\.user_profiles — authenticated 읽기 도달 가능/);
    expect(a1).not.toMatch(/user_profiles — anon/); // 로그인 필수 모양은 anon 도달 불가
    expect(att.find((a) => a.code === "A2")?.lines.join("\n")).toMatch(/own read/);
  });
});

describe("perm-baseline.mjs — 안전장치", () => {
  const script = fileURLToPath(new URL("./perm-baseline.mjs", import.meta.url));

  it("23. GITHUB_ACTIONS=\"true\" 에서 exit 1(DB 에 닿기 전에 거부)", () => {
    expect(refuseInCi({ GITHUB_ACTIONS: "true" })).toMatch(/GitHub Actions/);
    expect(refuseInCi({})).toBeNull();
    const r = spawnSync(process.execPath, [script], {
      env: { ...process.env, GITHUB_ACTIONS: "true" },
      encoding: "utf8",
      timeout: 30000,
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/GitHub Actions 에서 실행할 수 없습니다/);
  });

  it("24. .github/workflows 어디에도 perm-baseline 이 없다(승인은 로컬에서만)", () => {
    const dir = new URL("../.github/workflows/", import.meta.url);
    const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(readFileSync(new URL(f, dir), "utf8")).not.toMatch(/perm-baseline/);
  });

  it("parseArgs — 세 모드와 인자", () => {
    expect(parseArgs([]).mode).toBe("preview");
    expect(parseArgs(["--make-expect", "--after=a.json", "--out=b.json"])).toMatchObject({ mode: "make-expect", after: "a.json", out: "b.json" });
    expect(parseArgs(["--accept", "--first", "--expect-hash=abc", "--note=첫 기준선 승인"])).toMatchObject({ mode: "accept", first: true, expectHash: "abc", note: "첫 기준선 승인" });
  });

  it("decideAccept — 첫 기준선: 해시 다르면 거부 · 기준선 있으면 --first 거부 · 맞으면 통과", () => {
    const noBase = { current: fp(baseItems()), baseline: null };
    const ok = parseArgs(["--accept", "--first", "--expect-hash=hash-3", "--note=첫 기준선 승인"]);
    expect(decideAccept(noBase, ok)).toEqual({ ok: true, reasons: [] });
    const bad = parseArgs(["--accept", "--first", "--expect-hash=zzz", "--note=첫 기준선 승인"]);
    expect(decideAccept(noBase, bad).ok).toBe(false);
    expect(decideAccept(snap(baseItems()), ok).ok).toBe(false);
    expect(decideAccept(noBase, parseArgs(["--accept", "--first", "--expect-hash=hash-3"])).ok).toBe(false); // 메모 없음
  });

  it("decideAccept — 기대 파일 모드: 대조가 어긋나면 거부, 맞으면 통과", () => {
    const newPol = item("policy", "public.t_demo/own read", polDef("(auth.uid() = owner)", ["authenticated"]));
    const s = snap([...baseItems(), newPol]);
    const diff = diffPermissionFingerprint(s.current, s.baseline);
    const args = parseArgs(["--accept", "--expect-file=x.json", "--note=PR #700 반영"]);
    expect(decideAccept(s, args, makeExpectFile(diff, s.baseline.total_hash, "rt")).ok).toBe(true);
    expect(decideAccept(s, args, { version: 1, base_total_hash: s.baseline.total_hash, changes: [] }).ok).toBe(false);
    expect(decideAccept(s, args, undefined).ok).toBe(false);
  });

  it("isHashMismatch — SQL 예외 글자 'hash mismatch' 로 판정", () => {
    expect(isHashMismatch("accept_permission_baseline: hash mismatch (expected a, actual b)")).toBe(true);
    expect(isHashMismatch("permission denied")).toBe(false);
  });

  it("buildPreview — 개수·주의 항목 요약과 문서를 만든다", () => {
    const { md, summary } = buildPreview({ current: fp(baseItems()), baseline: null }, []);
    expect(summary.counts).toEqual({ relation: 1, policy: 1, role: 1 });
    expect(Object.keys(summary.attention)).toHaveLength(9);
    expect(summary.diffCounts).toBeNull();
    expect(md).toMatch(/기준선: 없음/);
  });
});

describe("25. main() 배선 — 소스 대조", () => {
  const src = readFileSync(new URL("./monitor-collectors.mjs", import.meta.url), "utf8");

  it("⑩ 블록이 permission_drift_snapshot 결과로 evaluatePermissionDrift 를 부른다(호출부 좌변 고정)", () => {
    expect(src).toMatch(/permIssues\s*=\s*permIssues\.concat\(evaluatePermissionDrift\(drift,\s*\{\s*rpcError:\s*driftError\s*\}\)\)/);
    expect(src).toMatch(/await\s+fetchPermissionDriftSnapshot\(\)/);
    expect(src).toMatch(/permIssues\s*=\s*permIssues\.concat\(evaluateDbPermissions\(snapshot,\s*\{\s*rpcError:\s*error\s*\}\)\)/);
  });

  it("'이상 없음' 은 두 판정 합계 0 + 예외 0 일 때만, 기존 글자를 유지한다", () => {
    const idx = src.indexOf("주간 DB 권한 점검</b> — 이상 없음");
    expect(idx).toBeGreaterThan(-1);
    const before = src.slice(Math.max(0, idx - 700), idx);
    const guard = before.lastIndexOf("if (permIssues.length === 0 && !permCheckCrashed)");
    expect(guard).toBeGreaterThan(-1);
    // 가드와 발송 사이에 다른 if 블록이 끼어 있지 않다(가드가 실제로 이 발송을 감싼다)
    expect(before.slice(guard).match(/\n\s*\}\s*else/)).toBeNull();
    const line = src.slice(idx, src.indexOf("\n", idx));
    expect(line).toMatch(/okInfo\.suffix/);
  });
});
