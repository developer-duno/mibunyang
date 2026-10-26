// @ts-check
/**
 * 규제지역 시드 적용 — regulation-zones.json → apartments.is_regulated
 *
 * 사용법:
 *   node scripts/collectors/regulation-seed.mjs
 *   node scripts/collectors/regulation-seed.mjs --dry-run
 *   node scripts/collectors/regulation-seed.mjs --force   # 바뀔 단지가 상한(50곳)을 넘어도 반영 — 진짜 지정·해제 날에 표를 확인한 사람만
 *
 * 진짜 지정·해제 날 절차: 표(src/data/regulation-zones.json) PR 합친 날 → Actions 「daily-deploy」 수동 실행에서
 * regulation_force 켬(반영+굽기 한 번에).
 *
 * 필요 환경변수: SUPABASE_URL, SUPABASE_SERVICE_KEY
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadEnv, getSupabase, log, logError, ROOT, createReporter, recordCollectorRun, selectAll } from "./_shared.mjs";

loadEnv();
const PHASE = "regulation-seed";

/**
 * 차단기 상한 — 한 번에 is_regulated 가 뒤집힐 **단지 수(complex_key || id 로 묶은 고유 개수)**가 이보다 많으면
 * 아무것도 쓰지 않고 멈춘다(행 수가 아니다 — 한 단지의 공고 행 여럿은 1곳, 사장님 결정 2026-10-26).
 * 근거: 사장님 결정 2026-10-26 "하루에 50곳 넘게 바뀌면 멈추고 알림, 진짜 지정·해제 날에는 사람이 강제 통과(--force)".
 * 규제 단지가 서울 189 · 경기 144곳(공개 화면 기준, 세션662 실측)이라 JSON 에서 시도 한 줄만 빠져도 100곳+ 가 뒤집힌다.
 */
export const REG_BREAKER_MAX_ROWS = 50;

/**
 * 규제지역 JSON → Set 생성
 * @param {Record<string, unknown>} zones
 * @returns {Set<string>}
 */
export function buildRegulatedSet(zones) {
  /** @type {Set<string>} */
  const regulated = new Set();
  // _guAliases 는 공식 지정 목록이 아니라 DB 표기 흔들림("성남시 분당구" vs "분당구")을 흡수하는
  // 조회 키다. 조회용 Set 에는 함께 담아야 두 표기 모두 규제로 잡힌다 (JSON 의 _guAliasesNote 참조).
  for (const list of [zones["투기과열지구"], zones["조정대상지역"], zones["_guAliases"]]) {
    if (Array.isArray(list)) list.forEach(z => regulated.add(String(z)));
  }
  return regulated;
}

/**
 * 규제지역 여부 판정 — 정확 키("서울 강남구") 먼저, 없으면 시도 단독("서울") 폴백.
 *
 * 10·15 대책이 서울을 **전역** 지정하면서 시도 한 토막짜리 항목이 생겼다. 시군구를 붙인 키만
 * 보면 서울 637단지가 통째로 비규제로 새어 나간다. 폴백 순서는 화면 쪽 `getZone` 과 같다.
 *
 * @param {Set<string>} regulated
 * @param {string | null | undefined} region
 * @param {string | null | undefined} gu
 * @returns {boolean}
 */
export function isRegulatedArea(regulated, region, gu) {
  if (regulated.has(makeRegionKey(region, gu))) return true;
  const r = String(region ?? "").trim();
  return r !== "" && regulated.has(r);
}

/**
 * 법정동코드 앞자리 규칙 읽기 — JSON `_bjdPrefixZones` ({ "41597": "경기 화성시 동탄구" }).
 * 값(지정 이름)이 규제 Set 에 들어 있을 때만 규칙으로 쓴다 — 목록에서 그 이름을 빼면 규칙도 같이 꺼진다.
 * @param {Record<string, unknown>} zones
 * @param {Set<string>} regulated
 * @returns {Array<{ prefix: string; region: string; city: string; dongPrefix: string }>}
 */
export function buildBjdPrefixRules(zones, regulated) {
  const raw = zones["_bjdPrefixZones"];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  /** @type {Array<{ prefix: string; region: string; city: string; dongPrefix: string }>} */
  const rules = [];
  for (const [prefix, name] of Object.entries(/** @type {Record<string, unknown>} */ (raw))) {
    const full = String(name ?? "").trim();
    if (!/^\d{2,10}$/.test(prefix) || !regulated.has(full)) continue;
    // "경기 화성시 동탄구" → 시도 "경기" · 시 "화성시" · 동 이름 머리 "동탄"(구 이름에서 끝 "구"를 뗀 것)
    const [region = "", city = "", sub = ""] = full.split(/\s+/);
    rules.push({ prefix, region, city, dongPrefix: sub.replace(/구$/, "") });
  }
  return rules;
}

/**
 * 규제지역 판정(수집기 전체 규칙) — ① 이름 키(`isRegulatedArea`) ② 법정동코드 앞자리 규칙
 * ③ 법정동코드가 비었으면 같은 시·같은 동 이름 머리(예: gu "화성시" + dong "동탄…").
 *
 * 우리 DB 는 화성시를 gu "화성시" 하나로 저장해(2026-10-04 실측) 2026-07-01 지정된 동탄구만
 * 이름으로 고를 수 없다 — 그래서 ②③ 이 있다. ③ 은 bjd_code 가 빈 행(실측 3행)을 위한 것.
 *
 * @param {Set<string>} regulated
 * @param {Array<{ prefix: string; region: string; city: string; dongPrefix: string }>} prefixRules
 * @param {{ region?: string | null; gu?: string | null; dong?: string | null; bjd_code?: string | null }} apt
 * @returns {boolean}
 */
export function isRegulatedApt(regulated, prefixRules, apt) {
  if (isRegulatedArea(regulated, apt.region, apt.gu)) return true;
  const code = String(apt.bjd_code ?? "").trim();
  const region = String(apt.region ?? "").trim();
  const gu = String(apt.gu ?? "").trim();
  const dong = String(apt.dong ?? "").trim();
  for (const r of prefixRules) {
    if (code !== "") {
      if (code.startsWith(r.prefix)) return true;
      continue;
    }
    if (region === r.region && gu === r.city && r.dongPrefix !== "" && dong.startsWith(r.dongPrefix)) return true;
  }
  return false;
}

/**
 * region + gu → 규제 조회 키
 * @param {string | null | undefined} region
 * @param {string | null | undefined} gu
 * @returns {string}
 */
export function makeRegionKey(region, gu) {
  return `${region ?? ""} ${gu ?? ""}`.trim();
}

/**
 * @typedef {{ id: string; complex_key?: string | null; region: string | null; gu: string | null; dong: string | null; bjd_code: string | null; is_regulated: boolean | null }} RegApt
 * @typedef {{ id: string; bundle: string; region: string | null; gu: string | null; prev: boolean | null; next: boolean }} RegChange
 */

/**
 * 바뀔 행 목록 — 지금 값(is_regulated)과 판정이 다른 행만. DB 접근 없는 순수 함수(먼저 다 센 뒤에 쓴다).
 * `bundle` = 단지 묶음 열쇠(`complex_key || id`) — 차단기는 이것의 고유 개수(곳)로 센다.
 * @param {Set<string>} regulated
 * @param {Array<{ prefix: string; region: string; city: string; dongPrefix: string }>} prefixRules
 * @param {RegApt[]} apts
 * @returns {RegChange[]}
 */
export function planRegulationChanges(regulated, prefixRules, apts) {
  /** @type {RegChange[]} */
  const changes = [];
  for (const apt of apts) {
    const next = isRegulatedApt(regulated, prefixRules, apt);
    if (apt.is_regulated === next) continue;
    changes.push({ id: apt.id, bundle: apt.complex_key || apt.id, region: apt.region, gu: apt.gu, prev: apt.is_regulated, next });
  }
  return changes;
}

/**
 * 바뀔 단지 수(곳) — `bundle`(없으면 id)의 고유 개수.
 * @param {ReadonlyArray<{ id: string, bundle?: string | null }>} changes
 * @returns {number}
 */
export function countChangedPlaces(changes) {
  return new Set(changes.map((c) => c.bundle ?? c.id)).size;
}

/**
 * 차단기 판정 — 바뀔 단지(곳)가 `max` 를 넘으면 걸린다(같으면 통과). `force` 면 걸리지 않는다. 순수 함수.
 * @param {ReadonlyArray<{ id: string, bundle?: string | null }>} changes
 * @param {{ max?: number, force?: boolean }} [opts]
 * @returns {{ tripped: boolean, over: boolean, places: number, reason: string | null }}
 */
export function evaluateRegBreaker(changes, { max = REG_BREAKER_MAX_ROWS, force = false } = {}) {
  const places = countChangedPlaces(changes);
  const over = places > max;
  const tripped = over && !force;
  return {
    tripped,
    over,
    places,
    reason: tripped
      ? `REG_BREAKER 바뀔 단지 ${places}곳(행 ${changes.length}개) > ${max}곳 — 표를 확인하고 --force(Actions daily-deploy 수동 실행 regulation_force)로`
      : null,
  };
}

/**
 * 바뀔 단지의 시도별 개수(곳) — "서울 189 · 경기 144" 꼴(많은 순).
 * @param {RegChange[]} changes
 * @returns {string}
 */
export function countChangesBySido(changes) {
  /** @type {Map<string, Set<string>>} */
  const m = new Map();
  for (const c of changes) {
    const k = String(c.region ?? "").trim() || "(시도 없음)";
    const set = m.get(k) ?? new Set();
    set.add(c.bundle ?? c.id);
    m.set(k, set);
  }
  return [...m.entries()].map(([k, s]) => /** @type {[string, number]} */ ([k, s.size])).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(" · ");
}

/**
 * 판정 → (통과하면) 쓰기. main 의 쓰기 부분을 뗀 것 — 모의 supabase 로 시험한다.
 * 걸리면 UPDATE 0회 · failure 기록(REG_BREAKER) · exitCode 1. dry-run 은 쓰기·기록 0, 판정만 로그하고 exitCode 0.
 * @param {{
 *   sb: any,
 *   apts: RegApt[],
 *   regulated: Set<string>,
 *   prefixRules: Array<{ prefix: string; region: string; city: string; dongPrefix: string }>,
 *   rpt: { interrupted: () => boolean, success: (n?: number) => void, fail: (n?: number) => void, skip: (n?: number) => void, summary: () => Record<string, any> },
 *   dry?: boolean,
 *   force?: boolean,
 *   max?: number,
 *   record?: (collector: string, result: Record<string, any>) => Promise<void>,
 * }} args
 * @returns {Promise<{ changes: RegChange[], tripped: boolean, updated: number, exitCode: number }>}
 */
export async function runRegulationSeed({ sb, apts, regulated, prefixRules, rpt, dry = false, force = false, max = REG_BREAKER_MAX_ROWS, record = (collector, result) => recordCollectorRun(collector, result) }) {
  const changes = planRegulationChanges(regulated, prefixRules, apts);
  const breaker = evaluateRegBreaker(changes, { max, force });
  log("regulation", `바뀔 단지 ${breaker.places}곳(행 ${changes.length}개) / 전체 ${apts.length}행 (상한 ${max}곳)${changes.length > 0 ? ` — ${countChangesBySido(changes)}` : ""}`);
  if (force && breaker.over) log("regulation", `강제 통과(--force) — 바뀔 단지 ${breaker.places}곳이 상한 ${max}곳을 넘지만 반영합니다`);
  else if (force) log("regulation", `강제 통과 인자 있음 — 상한 안(${breaker.places}곳 ≤ ${max}곳)이라 영향 없음`);

  if (breaker.tripped) {
    for (const c of changes.slice(0, 20)) log("regulation", `  바뀜 ${c.id} (${makeRegionKey(c.region, c.gu)}) ${c.prev} → ${c.next}`);
    if (changes.length > 20) log("regulation", `  … 외 ${changes.length - 20}행`);
    if (dry) {
      log("dry", `⚠ 실제 실행이면 차단기에 걸립니다(${breaker.reason})`);
    } else {
      logError("regulation", `${breaker.reason} — 아무것도 쓰지 않았습니다`);
      await record(PHASE, { status: "failure", ok: 0, fail: 0, skip: apts.length, errorMessage: breaker.reason });
      return { changes, tripped: true, updated: 0, exitCode: 1 };
    }
  }

  rpt.skip(apts.length - changes.length);
  let updated = 0;
  for (const c of changes) {
    if (rpt.interrupted()) break;
    if (dry) {
      log("dry", `${c.id} (${makeRegionKey(c.region, c.gu)}) → is_regulated=${c.next}`);
      updated++;
      rpt.success();
      continue;
    }

    const { error: uErr } = await sb
      .from("apartments")
      .update({ is_regulated: c.next, updated_at: new Date().toISOString() })
      .eq("id", c.id);

    if (uErr) {
      log("error", `${c.id}: ${uErr.message}`);
      rpt.fail();
    } else {
      updated++;
      rpt.success();
    }
  }

  log("regulation", `완료: ${updated}건 갱신`);
  // 0건이어도 기록한다 — 기록이 없으면 "바뀔 게 없어서 0건" 과 "전부 실패해서 0건" 이
  // 구분되지 않는다(collect-trades 2개월 공백 사고, 세션 503). dry-run 은 기록하지 않는다(미리보기가 성공으로 읽히지 않게).
  const summary = rpt.summary();
  if (!dry) await record(PHASE, summary);
  return { changes, tripped: breaker.tripped, updated, exitCode: 0 };
}

/**
 * 실행 인자 읽기 — `--dry-run`(미리보기) · `--force`(차단기 무시).
 * @param {readonly string[]} argv
 * @returns {{ dry: boolean, force: boolean }}
 */
export function parseSeedArgs(argv) {
  return { dry: argv.includes("--dry-run"), force: argv.includes("--force") };
}

/**
 * 진입점. 시험은 deps 로 DB·표·리포터·기록을 넣는다(생략하면 운영 값). 결과 exitCode 를 process.exitCode 에 넣고 돌려준다.
 * @param {{
 *   argv?: readonly string[],
 *   sb?: any,
 *   zones?: Record<string, unknown>,
 *   apts?: RegApt[],
 *   rpt?: Parameters<typeof runRegulationSeed>[0]["rpt"],
 *   record?: (collector: string, result: Record<string, any>) => Promise<void>,
 * }} [deps]
 * @returns {Promise<number>}
 */
export async function main(deps = {}) {
  // 세션 504: 매주 도는데 collector_runs 기록이 0행이라 감시 사각이었다.
  // 리포터는 반드시 루프 이전에 만든다(루프 뒤면 SIGTERM 등록 0회 = graceful 무효).
  const rpt = deps.rpt ?? createReporter(PHASE);
  const { dry: DRY, force: FORCE } = parseSeedArgs(deps.argv ?? process.argv);
  const sb = deps.sb ?? getSupabase();

  // 규제지역 JSON 로드
  const jsonPath = resolve(ROOT, "src/data/regulation-zones.json");
  const zones = deps.zones ?? JSON.parse(readFileSync(jsonPath, "utf8"));

  const regulated = buildRegulatedSet(zones);
  const prefixRules = buildBjdPrefixRules(zones, regulated);
  log("regulation", `규제지역: ${regulated.size}개 시군구 · 법정동코드 규칙 ${prefixRules.length}개`);

  // 전체 아파트 조회 — 세션534: 무정렬 OFFSET → 고유키(id) 커서
  // (unordered-pagination-loses-rows.md §1). apartments 3페이지 경계에서의 행 유실 차단.
  // bjd_code·dong 은 이름으로 못 가르는 곳(화성시 동탄구) 판정용 — isRegulatedApt 참조.
  // complex_key 는 차단기가 단지 수(곳)를 세는 묶음 열쇠(세션662).
  const apts = deps.apts ?? /** @type {RegApt[]} */ (
    await selectAll((s) => s.from("apartments").select("id, complex_key, region, gu, dong, bjd_code, is_regulated"), sb, "id")
  );

  // 먼저 바뀔 행을 다 세고 차단기를 본 뒤에 쓴다(세션662 — 시도 한 줄이 빠진 JSON 이 100곳+ 를 한 번에 뒤집지 못하게).
  const { exitCode } = await runRegulationSeed({ sb, apts, regulated, prefixRules, rpt, dry: DRY, force: FORCE, record: deps.record });
  if (exitCode !== 0) process.exitCode = exitCode;
  return exitCode;
}

const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) || "");
if (isCLI) main().catch(e => { console.error(e); process.exit(1); });
