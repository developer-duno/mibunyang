// @ts-check
/**
 * 좌표를 **남의 단지와 공유하는** 행에 표시를 단다 — `apartments.coord_shared` (세션560)
 *
 * ## 무엇이 문제인가
 * 지오코딩이 단지를 못 찾으면 구청·면사무소 같은 **대표 장소의 좌표**로 떨어진다. 그러면
 * 서로 다른 단지 여럿이 **소수점까지 똑같은 좌표**를 공유한다. 좌표가 틀리면 그 좌표로 재는
 * 것이 **전부** 틀린다 — 지하철·학교·병원·대기질 측정소까지.
 *
 * 세션539~542가 같은 결함 209곳을 고쳤지만, 남은 것들은 **아직 준공 전이라 지도에 없어서**
 * 정정 도구가 정답을 못 찾는다(2026-09-22 dry-run 1,860곳 → 정정 대상 0곳).
 *
 * ## 그래서 고치는 대신 **표시**한다 (사장님 확정 2026-09-22)
 * 손님이 "지하철 5분"을 사실로 믿고 판단하는 것을 막는 게 먼저다. 좌표를 **추측으로 옮기면**
 * 멀쩡한 값을 망친다(실증: 형제 행 좌표를 쓰려다 `금강펜테리움 6차`↔`7차` 같은 **별개 단지**를
 * 묶는 규칙이 나와 폐기했다).
 *
 * ## 판정은 **직접 하지 않는다** — 정정 도구의 덤프를 읽는다
 * ⚠️ 세션560에 이 판정을 직접 구현하려다 세 번 틀렸다(29 → 36 → 95자리로 출렁였다).
 * 이름에서 회차를 떼는 규칙이 미묘해서다: `신림스카이아파트14차`(회차)와
 * `금강펜테리움 6차 센트럴파크`(단지 차수)를 가르는 일은 이미 정정 도구가 풀어 둔 문제다.
 *
 * 그래서 이 수집기는 **`fix-placeholder-addresses.mjs --out=<덤프>` 결과를 입력으로 받는다.**
 * 그 도구의 `findTruePlaceholders` 가 진짜 판정자이고, 핵심 조건은 **`tier === "none"`**
 * (= 카카오 POI·청약홈 주소·네이버 단지 **세 출처가 모두 실패한 행**)이다. 같은 단지의
 * 회차 분리는 출처가 잡아 주므로 애초에 후보에 안 든다.
 *
 * ## 플래그는 한 방향으로만 조용히 안 꺼진다 (세션565 — 3↔3 스왑 사고)
 * 2026-09-23 세션565가 사람 승인 42건을 반영한 뒤 이 도구를 재실행하자 켜짐/꺼짐이 3↔3 으로
 * 스왑됐다: 진짜로 아직 틀린 행(오룡 39/40BL·동탄 A106)은 **이웃이 고쳐지고 자기만 남아** 표시가
 * 꺼졌고, 반대로 사람이 승인해 정확히 옮긴 행(아산탕정 D1-2BL 그랜드마크Ⅱ 계열)은 재분석 덤프가
 * 사람 승인(tier "none" 그대로, `coreName` 은 로마숫자 "Ⅱ"를 안 떼므로 "2"와 다른 핵심이름)을
 * 몰라 다시 후보로 잡혔다. 사장님 확정 방향: **"표시는 그 행이 실제로 옮겨지거나 확인되기 전에는
 * 절대 꺼지지 않는다. 사람이 승인해 옮긴 행은 다시 켜지지 않는다."** — 그래서 판정을
 * `decideFlags`(사람 승인 최우선 → 후보 → sticky → 정리) 로 분리했다. **`coreName` 은 건드리지
 * 않는다** — 로마숫자를 정규화하면 시흥거모지구 루체Ⅰ/Ⅱ(진짜 별개 블록)가 조용히 합쳐진다.
 *
 * ## 사용법
 *   node scripts/fix-placeholder-addresses.mjs --out=<덤프>          # ① 판정 (20분 안팎, 반영 이후 덤프여야 한다)
 *   node scripts/collectors/flag-shared-coords.mjs --from=<덤프>      # ② dry-run
 *   node scripts/collectors/flag-shared-coords.mjs --from=<덤프> --apply
 *
 * ⚠️ 경로는 **절대경로**로. Git Bash `/tmp` 와 node `resolve("/tmp")` 가 다른 폴더다.
 * ⚠️ 선행: `supabase/migrations/20260922000002_apartments_coord_shared.sql` 적용.
 */
import {
  loadEnv,
  log,
  logError,
  getSupabase,
  selectAll,
  createSemaphore,
  recordCollectorRun,
  createReporter,
  haversineMeters,
} from "./_shared.mjs";
import { findTruePlaceholders, readApprovals, APPROVE_MATCH_M } from "../fix-placeholder-addresses.mjs";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

loadEnv();

const PHASE = "flag-shared-coords";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const DEFAULT_APPROVALS_DIR = join(REPO_ROOT, "docs", "audits");
const APPROVALS_FILENAME_RE = /coord-approvals.*\.json$/;

/**
 * 덤프에서 표시 대상 id 집합을 뽑는다.
 *
 * 판정은 정정 도구의 `findTruePlaceholders` 가 한다 — 이 함수는 덤프의 모양만 검사한다.
 *
 * @param {unknown} dump `--out=` 으로 저장된 JSON
 * @returns {Set<string>}
 */
export function flaggedFromDump(dump) {
  const d = /** @type {{ rows?: unknown; rosterSize?: unknown }} */ (dump);
  if (!d || !Array.isArray(d.rows)) {
    throw new Error("덤프 형식이 아닙니다 — rows 배열이 없습니다");
  }
  // 로스터가 통째로 비면 외부 API 가 죽은 회차다. 그걸로 표시를 내리면 안 된다(fail-close).
  if (typeof d.rosterSize === "number" && d.rosterSize === 0) {
    throw new Error("덤프의 로스터가 0건입니다 — 그 회차는 신뢰할 수 없습니다(fail-close)");
  }
  const rows = /** @type {Array<{ id: string; name: string; lat: number | null; lng: number | null; tier: string }>} */ (
    d.rows
  );
  return findTruePlaceholders(rows);
}

/**
 * 덤프의 모양을 검사하고 `id → tier` 맵을 만든다. `flaggedFromDump` 와 같은 검증(fail-close)을 쓴다.
 * @param {unknown} dump
 * @returns {Map<string, string>}
 */
export function tiersFromDump(dump) {
  const d = /** @type {{ rows?: unknown; rosterSize?: unknown }} */ (dump);
  if (!d || !Array.isArray(d.rows)) {
    throw new Error("덤프 형식이 아닙니다 — rows 배열이 없습니다");
  }
  if (typeof d.rosterSize === "number" && d.rosterSize === 0) {
    throw new Error("덤프의 로스터가 0건입니다 — 그 회차는 신뢰할 수 없습니다(fail-close)");
  }
  const rows = /** @type {Array<{ id: string; tier: string }>} */ (d.rows);
  /** @type {Map<string, string>} */
  const out = new Map();
  for (const r of rows) {
    if (r?.id) out.set(r.id, r.tier);
  }
  return out;
}

/**
 * `docs/audits/*coord-approvals*.json` 을 전부 읽어 `id → {lat,lng}` 로 합친다.
 *
 * 같은 id 가 두 파일에서 `APPROVE_MATCH_M` 밖의 서로 다른 좌표로 나오면 모순이므로 throw
 * (fail-close) — 어느 쪽이 맞는지 이 함수가 판단하지 않는다. 근방(이내)이면 먼저 읽은 값을 쓴다.
 *
 * @param {string} [dir] 기본값 = 레포 루트의 docs/audits (import.meta.url 기준, cwd 무관)
 * @returns {Map<string, { lat: number, lng: number }>}
 */
export function loadHumanApprovals(dir = DEFAULT_APPROVALS_DIR) {
  /** @type {Map<string, { lat: number, lng: number }>} */
  const out = new Map();
  /** @type {string[]} */
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // 디렉토리 없음 — 빈 Map
  }
  const files = entries.filter((f) => APPROVALS_FILENAME_RE.test(f)).sort();
  for (const f of files) {
    const approvals = readApprovals(join(dir, f));
    for (const ap of approvals) {
      const existing = out.get(ap.id);
      if (!existing) {
        out.set(ap.id, { lat: ap.lat, lng: ap.lng });
        continue;
      }
      const d = haversineMeters(existing.lat, existing.lng, ap.lat, ap.lng);
      if (d > APPROVE_MATCH_M) {
        throw new Error(
          `승인 좌표 충돌: ${ap.id} 가 두 파일에서 ${Math.round(d)}m 떨어진 서로 다른 좌표로 승인됨(${f})`
        );
      }
      // 근방이면 기존 값 유지(같은 승인의 중복 기재로 간주).
    }
  }
  return out;
}

/**
 * 각 행의 다음 표시 상태를 정한다. 순서가 판정이다 — 먼저 맞는 규칙이 이긴다.
 *
 * ⚠️ **순서를 바꾸지 마라.** 사람 승인이 후보 판정보다 먼저 와야 한다 — 안 그러면 사람이
 * 옮긴 좌표도 재분석 덤프가 다시 후보로 잡을 수 있다(세션565 사고, §"플래그는 한 방향으로만").
 *
 * @param {{
 *   rows: Array<{ id: string, coord_shared: boolean | null, lat: number | null, lng: number | null }>,
 *   candidates: Set<string>,
 *   dumpTiers: Map<string, string>,
 *   approvals: Map<string, { lat: number, lng: number }>,
 *   matchM?: number,
 * }} input
 * @returns {Map<string, { next: boolean, reason: "human-approved" | "placeholder" | "sticky" | "confirmed-ok" | "clear" }>}
 */
export function decideFlags({ rows, candidates, dumpTiers, approvals, matchM = APPROVE_MATCH_M }) {
  /** @type {Map<string, { next: boolean, reason: "human-approved" | "placeholder" | "sticky" | "confirmed-ok" | "clear" }>} */
  const out = new Map();
  for (const r of rows) {
    const id = r.id;
    const prev = r.coord_shared === true;

    // (a) 사람 승인 — 현재 좌표가 승인 좌표와 근방이면 무조건 끈다. 다른 규칙보다 먼저.
    const approval = approvals.get(id);
    if (approval && r.lat != null && r.lng != null) {
      const d = haversineMeters(r.lat, r.lng, approval.lat, approval.lng);
      if (d <= matchM) {
        out.set(id, { next: false, reason: "human-approved" });
        continue;
      }
    }

    // (b) 재분석 후보 — 진짜 자리표시.
    if (candidates.has(id)) {
      out.set(id, { next: true, reason: "placeholder" });
      continue;
    }

    // (c) 이전에 켜져 있었는데 이번엔 후보가 아님 — tier "ok" 만 끈다(출처가 현재 좌표를
    //     실제로 확인한 경우). 그 외(부분 덤프로 안 잡힘 포함)는 sticky — 꺼지지 않는다.
    if (prev) {
      if (dumpTiers.get(id) === "ok") {
        out.set(id, { next: false, reason: "confirmed-ok" });
      } else {
        out.set(id, { next: true, reason: "sticky" });
      }
      continue;
    }

    // (d) 그 외 — 이전에도 꺼져 있었고 지금도 후보가 아님.
    out.set(id, { next: false, reason: "clear" });
  }
  return out;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const fromArg = process.argv.find((a) => a.startsWith("--from="));
  if (!fromArg) {
    logError(PHASE, "--from=<덤프> 가 필요합니다 (fix-placeholder-addresses.mjs --out= 로 만든 JSON)");
    process.exit(1);
  }
  const path = fromArg.slice("--from=".length);

  /** @type {Set<string>} */
  let candidates;
  /** @type {Map<string, string>} */
  let dumpTiers;
  try {
    const dump = JSON.parse(readFileSync(path, "utf8"));
    candidates = flaggedFromDump(dump);
    dumpTiers = tiersFromDump(dump);
  } catch (e) {
    logError(PHASE, `덤프를 읽지 못했습니다(${path}): ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
    return;
  }
  log(PHASE, `덤프 판정: 재분석 후보 ${candidates.size}곳`);

  /** @type {Map<string, { lat: number, lng: number }>} */
  let approvals;
  try {
    approvals = loadHumanApprovals();
  } catch (e) {
    logError(PHASE, `사람 승인 목록을 읽지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
    return;
  }
  log(PHASE, `사람 승인 ${approvals.size}건 로드`);

  const sb = getSupabase();
  const rows = await selectAll((s) => s.from("apartments").select("id,name,coord_shared,lat,lng"), sb, "id");
  log(PHASE, `단지 ${rows.length}곳`);

  const decisions = decideFlags({ rows, candidates, dumpTiers, approvals });
  const all = rows.map((r) => ({ id: r.id, name: r.name, prev: r.coord_shared === true, ...decisions.get(r.id) }));
  const updates = all.filter((x) => x.next !== x.prev);

  /** @param {"human-approved"|"placeholder"|"sticky"|"confirmed-ok"|"clear"} reason */
  const countReason = (reason) => all.filter((x) => x.reason === reason).length;
  const onPlaceholder = countReason("placeholder");
  const stickyKept = countReason("sticky");
  const offApproved = countReason("human-approved");
  const offConfirmedOk = countReason("confirmed-ok");
  const clearCount = countReason("clear");
  log(
    PHASE,
    `켬(placeholder) ${onPlaceholder} | 유지(sticky) ${stickyKept} | ` +
      `끔: 사람승인 ${offApproved} · 출처확인 ${offConfirmedOk} | 이미 맞음 ${clearCount}`
  );

  if (!apply) {
    log(PHASE, "DRY-RUN 종료");
    for (const u of updates) {
      log(PHASE, `  ${u.id} | ${u.name} | ${u.prev}→${u.next} | ${u.reason}`);
    }
    return;
  }

  const rpt = createReporter(PHASE);
  const limit = createSemaphore(10);
  const CHUNK = 500;
  let ok = 0;
  let fail = 0;
  for (let i = 0; i < updates.length; i += CHUNK) {
    if (rpt.interrupted()) {
      log(PHASE, `중단 신호 — ${ok}곳까지 반영하고 멈춥니다`);
      break;
    }
    const results = await Promise.all(
      updates
        .slice(i, i + CHUNK)
        .map((u) =>
          limit(async () => sb.from("apartments").update({ coord_shared: u.next }).eq("id", u.id))
        )
    );
    // ⚠️ 보낸 수가 아니라 **돌아온 결과**에서 센다([[count-results-not-sent]] — 세션560 실사고).
    for (const r of results) {
      const err = /** @type {{ error?: { message?: string } | null }} */ (r)?.error;
      if (err) {
        if (!fail) logError(PHASE, `업데이트 실패 예시: ${err.message}`);
        fail++;
      } else ok++;
    }
  }
  rpt.success(ok);
  if (fail) rpt.fail(fail);
  rpt.skip(rows.length - updates.length);
  await recordCollectorRun(PHASE, rpt.summary());
  log(PHASE, `완료 — 반영 ${ok}곳${fail ? ` / 실패 ${fail}곳` : ""}`);
  if (fail) process.exitCode = 1;
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) ?? "");
if (isCLI) {
  main().catch((e) => {
    logError(PHASE, e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
