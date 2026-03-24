/**
 * KOSIS 시군구별 미분양 세대수 수집기
 *
 * KOSIS 국가통계포털 DT_1YL202001E 테이블에서
 * 시군구별 월별 미분양 세대수를 수집하여
 * regions.regional_unsold + apartments.unsold/unsold_rate 업데이트
 *
 * 사용법:
 *   node scripts/collectors/collect-unsold-kosis.mjs              (Supabase UPDATE)
 *   node scripts/collectors/collect-unsold-kosis.mjs --dry-run    (미리보기만)
 */
import { loadEnv, getSupabase, log, logError } from "./_shared.mjs";

loadEnv();

const PHASE = "kosis-unsold";
const KOSIS_KEY = process.env.KOSIS_KEY;

// 시도 매핑: KOSIS 시도명 → DB region 코드
// DT_MLTM_2082는 약칭("서울"), DT_MLTM_2086은 정식명("서울특별시") 사용
const REGION_MAP = {
  // 약칭 (DT_MLTM_2082 시군구별)
  "서울": "서울", "부산": "부산", "대구": "대구", "인천": "인천",
  "광주": "광주", "대전": "대전", "울산": "울산", "세종": "세종",
  "경기": "경기", "강원": "강원", "충북": "충북", "충남": "충남",
  "전북": "전북", "전남": "전남", "경북": "경북", "경남": "경남", "제주": "제주",
  // 정식명 (호환)
  "서울특별시": "서울", "부산광역시": "부산", "대구광역시": "대구",
  "인천광역시": "인천", "광주광역시": "광주", "대전광역시": "대전",
  "울산광역시": "울산", "세종특별자치시": "세종", "경기도": "경기",
  "강원특별자치도": "강원", "강원도": "강원",
  "충청북도": "충북", "충청남도": "충남",
  "전라북도": "전북", "전북특별자치도": "전북", "전라남도": "전남",
  "경상북도": "경북", "경상남도": "경남",
  "제주특별자치도": "제주", "제주도": "제주",
};

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");
  if (!KOSIS_KEY) throw new Error("KOSIS_KEY not configured");

  const sb = getSupabase();

  // 월간 데이터 조회 (DT_MLTM_2082 시군구별 미분양, 1~2개월 지연)
  const now = new Date();
  const endMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const startDate = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  const startMonth = `${startDate.getFullYear()}${String(startDate.getMonth() + 1).padStart(2, "0")}`;

  log(PHASE, `KOSIS 미분양 조회: ${startMonth} ~ ${endMonth}`);

  // KOSIS API 호출
  const params = new URLSearchParams({
    method: "getList",
    apiKey: KOSIS_KEY,
    orgId: "116",           // 국토교통부
    tblId: "DT_MLTM_2082",  // 시·군·구별 미분양현황 (월간, 시군구 단위)
    itmId: "ALL",
    objL1: "ALL",
    objL2: "ALL",
    prdSe: "M",                                   // 월간 데이터
    startPrdDe: startMonth,
    endPrdDe: endMonth,
    format: "json",
    jsonVD: "Y",
  });

  // Node.js v24 내장 fetch(undici)가 KOSIS 서버와 TLS 호환 실패 (ECONNRESET)
  // → Node.js https 모듈로 직접 호출
  const https = await import("node:https");
  const apiUrl = `https://kosis.kr/openapi/Param/statisticsParameterData.do?${params}`;
  const data = await new Promise((resolve, reject) => {
    const req = https.request(apiUrl, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`KOSIS HTTP ${res.statusCode}`));
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try { resolve(JSON.parse(body)); } catch { reject(new Error("KOSIS JSON 파싱 실패")); }
      });
    });
    req.on("error", reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error("KOSIS 타임아웃")); });
    req.end();
  });
  if (data.err) throw new Error(`KOSIS 에러: ${data.errMsg || data.err}`);

  const rows = Array.isArray(data) ? data : [];
  log(PHASE, `KOSIS 응답: ${rows.length}건`);

  if (rows.length === 0) {
    log(PHASE, "데이터 없음 — 종료");
    return;
  }

  // 최신 월 기준으로 시군구별 미분양 집계
  // { region: { gu: unsoldCount, _total: totalForRegion } }
  const unsoldByRegionGu = {};
  const latestPeriod = {};

  for (const row of rows) {
    // DT_MLTM_2082 구조: C1_NM="서울" (시도), C2_NM="강남구" (시군구) 또는 "계" (합계)
    const region = REGION_MAP[row.C1_NM];
    if (!region) continue;

    const gu = row.C2_NM === "계" ? "_total" : row.C2_NM;
    const period = row.PRD_DE;
    const value = parseInt(row.DT, 10);
    if (isNaN(value)) continue;

    const key = `${region}::${gu}`;
    if (!latestPeriod[key] || period > latestPeriod[key]) {
      latestPeriod[key] = period;
      if (!unsoldByRegionGu[region]) unsoldByRegionGu[region] = {};
      unsoldByRegionGu[region][gu] = value;
    }
  }

  // 시도별 합계 계산
  const regionTotals = {};
  for (const [region, guMap] of Object.entries(unsoldByRegionGu)) {
    // KOSIS에서 시도 행 자체가 합계인 경우
    if (guMap["소계"] != null) {
      regionTotals[region] = guMap["소계"];
    } else if (guMap["_total"] != null) {
      regionTotals[region] = guMap["_total"];
    } else {
      // 시군구 합산
      regionTotals[region] = Object.values(guMap).reduce((s, v) => s + v, 0);
    }
  }

  log(PHASE, `시도별 미분양: ${Object.entries(regionTotals).map(([r, v]) => `${r}=${v}`).join(", ")}`);

  // 1. regions 테이블 업데이트
  const { data: regions, error: rErr } = await sb
    .from("regions")
    .select("id, region, gu, regional_unsold");

  if (rErr) {
    logError(PHASE, `regions 조회 실패: ${rErr.message}`);
  } else {
    let regUpdated = 0;
    for (const reg of regions) {
      const guMap = unsoldByRegionGu[reg.region];
      if (!guMap) continue;

      // 시군구 매칭 (gu가 있으면 시군구별, 없으면 시도별)
      let unsoldValue = null;
      if (reg.gu && guMap[reg.gu] != null) {
        unsoldValue = guMap[reg.gu];
      } else if (regionTotals[reg.region] != null) {
        unsoldValue = regionTotals[reg.region];
      }

      if (unsoldValue == null || unsoldValue === reg.regional_unsold) continue;

      if (dryRun) {
        log(PHASE, `  [DRY-RUN] regions ${reg.region} ${reg.gu || ""}: ${reg.regional_unsold} → ${unsoldValue}`);
        regUpdated++;
        continue;
      }

      const { error } = await sb.from("regions").update({
        regional_unsold: unsoldValue,
      }).eq("id", reg.id);

      if (error) logError(PHASE, `  regions ${reg.id} UPDATE 실패: ${error.message}`);
      else regUpdated++;
    }
    log(PHASE, `regions 갱신: ${regUpdated}건`);
  }

  // 2. apartments unsold 추정 (KOSIS 비례배분)
  const { data: apartments, error: aErr } = await sb
    .from("apartments")
    .select("id, name, region, gu, units, unsold, unsold_rate, naver_sell_count");

  if (aErr) {
    logError(PHASE, `apartments 조회 실패: ${aErr.message}`);
    return;
  }

  // 시군구별 총 분양세대수 계산
  const unitsByGu = {};
  for (const apt of apartments) {
    if (!apt.region || !apt.gu || !apt.units) continue;
    const key = `${apt.region}::${apt.gu}`;
    unitsByGu[key] = (unitsByGu[key] || 0) + apt.units;
  }

  let aptUpdated = 0;
  for (const apt of apartments) {
    // 이미 확인된 값이 있으면 건너뜀 (우선순위: 청약홈 > 네이버 > KOSIS)
    if (apt.unsold != null && apt.unsold > 0) continue;
    if (apt.naver_sell_count != null && apt.naver_sell_count > 0) continue;
    if (!apt.region || !apt.gu || !apt.units || apt.units <= 1) continue;

    // 시군구별 미분양 총량 조회
    const guMap = unsoldByRegionGu[apt.region];
    const guUnsold = guMap?.[apt.gu] ?? regionTotals[apt.region] ?? null;
    if (guUnsold == null || guUnsold <= 0) continue;

    // 비례배분: 시군구 미분양 × (단지 세대수 / 시군구 총 세대수)
    const guKey = `${apt.region}::${apt.gu}`;
    const totalUnitsInGu = unitsByGu[guKey] || apt.units;
    const estimated = Math.round(guUnsold * (apt.units / totalUnitsInGu));
    if (estimated <= 0) continue;

    const unsoldRate = Math.round(estimated / apt.units * 1000) / 10;
    if (unsoldRate > 100) continue; // 비정상 값 방지

    if (dryRun) {
      log(PHASE, `  [DRY-RUN] ${apt.name} (${apt.region} ${apt.gu}): unsold=${estimated}, rate=${unsoldRate}%`);
      aptUpdated++;
      continue;
    }

    const { error } = await sb.from("apartments").update({
      unsold: estimated,
      unsold_rate: unsoldRate,
      updated_at: new Date().toISOString(),
    }).eq("id", apt.id);

    if (error) logError(PHASE, `  ${apt.name} UPDATE 실패: ${error.message}`);
    else aptUpdated++;
  }

  log(PHASE, `apartments 미분양 추정 갱신: ${aptUpdated}건`);
  log(PHASE, "\n=== 완료 ===");
}

main().catch(err => { logError(PHASE, err.message); process.exit(1); });
