// @ts-check
/**
 * 보육정보공개 cpmsapi017 (제주도 어린이집 정보 조회) → regions.childcare JSONB
 *
 * 자원: info.childcare.go.kr 보육정보공개 API
 * data.go.kr 15101201 (한국사회보장정보원_제주도 어린이집 정보조회)
 * endpoint: http://api.childcare.go.kr/mediate/rest/cpmsapi017/cpmsapi017/request
 *
 * 본 collector 신설 이유:
 *   cpmsapi021 (전국 어린이집) 가 제주 2 시군구 INFO-200 응답 (API 자체 미보유).
 *   별도 cpmsapi017 (제주도 전용) 으로 제주시·서귀포시 채움. 254/256 → 256/256.
 *
 * arcode 체계 (raw 실측 박힘):
 *   - 49110 = 제주시 (cpmsapi017 전용 코드, 법정동 50110 와 다름)
 *   - 49130 = 서귀포시 (cpmsapi017 전용 코드, 법정동 50130 와 다름)
 *   - 50110/50130 (법정동) = INFO-200 응답
 *
 * 응답 필드 7 (XML, cpmsapi021 와 100% 동일):
 *   stcode/crname/crtel/crfax/craddr/crhome/crcapat
 *
 * 결과코드: ERROR-100 / ERROR-200 / INFO-100 / INFO-200 (skip) / INFO-300 / INFO-400
 *
 * 계정 2단계: 개발계정 키 = 시군구당 50행 제한 (raw 실측 박힘).
 *   운영계정 키 = 전수 응답 (data.go.kr 승인심의 통과 후).
 *
 * 사용:
 *   node scripts/collectors/childcare-info-jeju.mjs            (regions 업데이트)
 *   node scripts/collectors/childcare-info-jeju.mjs --dry-run  (미리보기 sample)
 *
 * 필요 env:
 *   CHILDCARE_JEJU_KEY   — info.childcare.go.kr cpmsapi017 인증키
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_KEY
 */
import { loadEnv, getSupabase, log, logError, createReporter, fetchWithRetry, today, recordApiQuota, recordCollectorRun, sleep } from "./_shared.mjs";
import { parseChildcareXml, extractTag, assertNoErrorCode, aggregateChildcare, pickLatestPerKey, mergePreserveCoords } from "./childcare-info.mjs";

loadEnv();

const API_KEY = process.env.CHILDCARE_JEJU_KEY;
const BASE_URL = "http://api.childcare.go.kr/mediate/rest/cpmsapi017/cpmsapi017/request";

/**
 * 제주 arcode 매핑 (cpmsapi017 독립 매핑, GU_LAWD_MAP 답습 불가).
 * raw API 실측 박제 (2026-05-27): 49110/49130 응답 OK, 50110/50130 INFO-200.
 * @type {Record<string, string>}
 */
export const JEJU_ARCODE_MAP = {
  "제주시": "49110",
  "서귀포시": "49130",
};

/**
 * 제주 시군구 리스트 → {region, gu, arcode} 반환.
 * @returns {Array<{region: string, gu: string, arcode: string}>}
 */
export function listJejuSgg() {
  return Object.entries(JEJU_ARCODE_MAP).map(([gu, arcode]) => ({
    region: "제주",
    gu,
    arcode,
  }));
}

/**
 * 제주 어린이집 시군구코드 (arcode 5자) 별 API 호출.
 * @param {string} arcode
 * @returns {Promise<import("./childcare-info.mjs").ChildcareItem[]>}
 */
async function fetchChildcareJeju(arcode) {
  if (!API_KEY) throw new Error("CHILDCARE_JEJU_KEY 환경변수 필요");
  const url = `${BASE_URL}?key=${encodeURIComponent(API_KEY)}&arcode=${arcode}`;
  const res = await fetchWithRetry(url);
  const xml = await res.text();
  assertNoErrorCode(xml);
  return parseChildcareXml(xml);
}

async function main() {
  if (!API_KEY) {
    logError("init", "CHILDCARE_JEJU_KEY 환경변수 필요 (info.childcare.go.kr cpmsapi017 인증키)");
    process.exit(1);
  }
  const dryRun = process.argv.includes("--dry-run");
  const fetchedAt = today();

  const sggList = listJejuSgg();
  log("init", `대상: ${sggList.length}개 시군구 (제주 arcode 49xxx)${dryRun ? " — dry-run" : ""}`);

  const rpt = createReporter("childcare-info-jeju");

  /** @type {Array<{region: string, gu: string, agg: import("./childcare-info.mjs").ChildcareAggregate}>} */
  const rows = [];
  let apiCalls = 0;
  for (const { region, gu, arcode } of sggList) {
    if (rpt.interrupted()) {
      log("fetch", "SIGTERM 받음 — 남은 시군구 skip");
      break;
    }
    try {
      const items = await fetchChildcareJeju(arcode);
      apiCalls++;
      if (items.length === 0) {
        log("fetch", `  ${region} ${gu} (${arcode}): 0건 — skip`);
        rpt.skip(1);
        continue;
      }
      const agg = aggregateChildcare(items, fetchedAt);
      rows.push({ region, gu, agg });
      log("fetch", `  ${region} ${gu} (${arcode}): ${items.length}건 / 정원 ${agg.total_capacity.toLocaleString()}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logError("fetch", `  ${region} ${gu} (${arcode}): ${msg}`);
      rpt.fail(1);
    }
    await sleep(150);
  }

  log("calc", `${rows.length}/${sggList.length}개 시군구 집계 완료 (API 호출 ${apiCalls}회)`);

  if (dryRun) {
    log("dry-run", "미리보기 모드");
    console.log("\n시군구별 sample:");
    for (const r of rows) {
      console.log(`  ${r.region} ${r.gu}: ${r.agg.count}건 / 정원 ${r.agg.total_capacity.toLocaleString()}`);
      if (r.agg.facilities[0]) {
        const f = r.agg.facilities[0];
        console.log(`    └ sample: ${f.crname} (${f.stcode}) ${f.crtel} / 정원 ${f.crcapat} / ${f.craddr}`);
      }
    }
    rpt.summary();
    return;
  }

  const sb = getSupabase();

  // regions 시계열 전수 → (region, gu) 별 최신행 id 맵 (childcare-info.mjs 와 동일 버그 차단).
  // PostgREST PATCH 가 order/limit 무시 → .eq(region).eq(gu) 가 제주 다중 스냅샷 전부 덮어쓰던 패턴 제거.
  const { data: allRegions, error: regErr } = await sb.from("regions")
    .select("id, region, gu, recorded_at, childcare")
    .order("recorded_at", { ascending: false });
  if (regErr) throw new Error(`regions 조회 실패: ${regErr.message}`);
  const latestMap = pickLatestPerKey(allRegions ?? []);
  // 최신행 id → 기존 childcare 본문 (merge 시 좌표 보존용, childcare-info.mjs 답습).
  /** @type {Map<number, import("./childcare-info.mjs").ChildcareAggregate | null>} */
  const prevById = new Map();
  for (const r of allRegions ?? []) prevById.set(r.id, r.childcare ?? null);

  let saved = 0;
  for (const row of rows) {
    if (rpt.interrupted()) break;  // graceful shutdown (childcare-info.mjs 답습, 룰 일관)
    const latest = latestMap.get(`${row.region}|${row.gu}`);

    if (latest) {
      // 기존 좌표·70필드 보존 merge (톱니 차단, childcare-info.mjs 답습).
      const merged = mergePreserveCoords(row.agg, prevById.get(latest.id));
      const { error: updErr } = await sb.from("regions")
        .update({ childcare: merged })
        .eq("id", latest.id);
      if (updErr) {
        logError("regions", `UPDATE 빨강 ${row.region} ${row.gu}: ${updErr.message}`);
        rpt.fail(1);
        continue;
      }
    } else {
      const { error: insErr } = await sb.from("regions").insert([{
        region: row.region,
        gu: row.gu,
        childcare: row.agg,
        recorded_at: fetchedAt,
      }]);
      if (insErr) {
        logError("regions", `INSERT 빨강 ${row.region} ${row.gu}: ${insErr.message}`);
        rpt.fail(1);
        continue;
      }
    }
    saved++;
    rpt.success(1);
  }
  log("done", `regions ${saved}/${rows.length}건 childcare 채움 (${fetchedAt})`);
  const result = rpt.summary();

  if (!dryRun) await recordApiQuota("childcare-info-jeju", "CHILDCARE_JEJU_KEY", apiCalls);
  await recordCollectorRun("childcare-info-jeju", result);
  if (result.fail > 0) process.exit(1);
}

const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) ?? "");
if (isCLI) main().catch(err => { const msg = err instanceof Error ? err.message : String(err); logError("main", msg); process.exit(1); });
