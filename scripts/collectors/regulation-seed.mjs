// @ts-check
/**
 * 규제지역 시드 적용 — regulation-zones.json → apartments.is_regulated
 *
 * 사용법:
 *   node scripts/collectors/regulation-seed.mjs
 *   node scripts/collectors/regulation-seed.mjs --dry-run
 *
 * 필요 환경변수: SUPABASE_URL, SUPABASE_SERVICE_KEY
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadEnv, getSupabase, log, ROOT, createReporter, recordCollectorRun } from "./_shared.mjs";

loadEnv();
const PHASE = "regulation-seed";

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
 * region + gu → 규제 조회 키
 * @param {string | null | undefined} region
 * @param {string | null | undefined} gu
 * @returns {string}
 */
export function makeRegionKey(region, gu) {
  return `${region ?? ""} ${gu ?? ""}`.trim();
}

async function main() {
  // 세션 504: 매주 도는데 collector_runs 기록이 0행이라 감시 사각이었다.
  // 리포터는 반드시 루프 이전에 만든다(루프 뒤면 SIGTERM 등록 0회 = graceful 무효).
  const rpt = createReporter(PHASE);
  const DRY = process.argv.includes("--dry-run");
  const sb = getSupabase();

  // 규제지역 JSON 로드
  const jsonPath = resolve(ROOT, "src/data/regulation-zones.json");
  const zones = JSON.parse(readFileSync(jsonPath, "utf8"));

  const regulated = buildRegulatedSet(zones);
  log("regulation", `규제지역: ${regulated.size}개 시군구`);

  // 전체 아파트 조회 — 페이지네이션 1000 행/배치
  const PAGE_SIZE = 1000;
  const apts = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await sb
      .from("apartments")
      .select("id, region, gu, is_regulated")
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    apts.push(...data);
    if (data.length < PAGE_SIZE) break;
  }

  let updated = 0;
  for (const apt of apts) {
    if (rpt.interrupted()) break;
    const key = makeRegionKey(apt.region, apt.gu);
    const shouldBeRegulated = isRegulatedArea(regulated, apt.region, apt.gu);

    // 이미 동일하면 건너뜀
    if (apt.is_regulated === shouldBeRegulated) { rpt.skip(); continue; }

    if (DRY) {
      log("dry", `${apt.id} (${key}) → is_regulated=${shouldBeRegulated}`);
      updated++;
      rpt.success();
      continue;
    }

    const { error: uErr } = await sb
      .from("apartments")
      .update({ is_regulated: shouldBeRegulated, updated_at: new Date().toISOString() })
      .eq("id", apt.id);

    if (uErr) {
      log("error", `${apt.id}: ${uErr.message}`);
      rpt.fail();
    } else {
      updated++;
      rpt.success();
    }
  }

  log("regulation", `완료: ${updated}건 갱신`);
  // 0건이어도 기록한다 — 기록이 없으면 "바뀔 게 없어서 0건" 과 "전부 실패해서 0건" 이
  // 구분되지 않는다(collect-trades 2개월 공백 사고, 세션 503).
  const summary = rpt.summary();
  await recordCollectorRun(PHASE, summary);
}

const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) || "");
if (isCLI) main().catch(e => { console.error(e); process.exit(1); });
