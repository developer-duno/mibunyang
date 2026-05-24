/**
 * 데이터 수집 스크립트 - 빌드 타임에 모든 API 데이터를 수집하여 정적 JSON 생성
 * 실행: node scripts/collect-data.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import { REGION_MAP, VALID_REGIONS, BUILDER_ALIASES, resolveBuilder, REGION_LAWD_PREFIX, GU_LAWD_MAP, getLawdCd, normalizeGu, loadEnv, fetchWithRetry, selectAll } from "./collectors/_shared.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

loadEnv();

const APPLYHOME_KEY = process.env.APPLYHOME_KEY;
const KAKAO_KEY = process.env.KAKAO_KEY;
const KOSIS_KEY = process.env.KOSIS_KEY;
const NEIS_KEY = process.env.NEIS_KEY;
const DART_KEY = process.env.DART_KEY;
const DATA_GO_KEY = process.env.DATA_GO_KEY;

const meta = { fetchedAt: null, count: 0, phases: {}, errors: [] };

function log(msg) { console.log(`[collect] ${msg}`); }
function logError(phase, msg) { console.error(`[collect:${phase}] ERROR: ${msg}`); meta.errors.push({ phase, msg }); }
function logRejected(phase, results) {
  results.forEach((r, i) => {
    if (r.status === "rejected") console.warn(`[collect:${phase}] rejected[${i}]: ${r.reason}`);
  });
}

// ============================================================
// Phase 1: 청약홈 (목록 + 주택형별 + 지오코딩)
// ============================================================
const AREA_CODE_REGION = {
  "100": "서울", "200": "부산", "210": "대구", "300": "대전",
  "400": "인천", "410": "경기", "500": "광주", "600": "울산",
  "680": "울산", "690": "세종",
  "700": "강원", "800": "충북", "810": "충남",
  "820": "전북", "830": "전남", "840": "경북", "850": "경남", "900": "제주",
};

const APPLYHOME_BASE = "https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1";

function isValidGu(s) {
  return s && /[가-힣]/.test(s) && /(구|군|시|생활권)$/.test(s);
}

function parseAddress(addr) {
  if (!addr) return { region: null, gu: null, dong: null };
  const parts = addr.trim().split(/\s+/);
  const regionFull = parts[0] || "";
  const region = REGION_MAP[regionFull] ?? regionFull.replace(/특별시|광역시|특별자치시|특별자치도|도$/, "");
  const gu = parts[1] || null;
  const dong = parts[2] || null;
  return { region, gu: isValidGu(gu) ? gu : null, dong: isValidGu(gu) ? dong : null };
}

function mapItem(item, idx, isRemndr) {
  const name = item.HOUSE_NM || `아파트-${idx}`;
  const addr = item.HSSPLY_ADRES || "";
  let { region, gu, dong } = parseAddress(addr);
  if (!region || !VALID_REGIONS.includes(region)) {
    const areaCode = item.SUBSCRPT_AREA_CODE;
    const areaName = item.SUBSCRPT_AREA_CODE_NM;
    if (areaName && REGION_MAP[areaName]) region = REGION_MAP[areaName];
    else if (areaName) region = areaName;
    else if (areaCode && AREA_CODE_REGION[areaCode]) region = AREA_CODE_REGION[areaCode];
  }
  const units = parseInt(item.TOT_SUPLY_HSHLDCO || 0, 10) || 0;
  const remndr = parseInt(item.REMNDR_HSHLDCO || 0, 10) || 0;
  const unsold = remndr > 0 ? remndr : null;
  return {
    id: `ah-${item.HOUSE_MANAGE_NO || String(idx)}`,
    name, dong, gu: normalizeGu(region, gu), region,
    lat: null, lng: null,
    area: 84, price: null, pp: null,
    units, unsold,
    unsoldRate: (unsold != null && units > 0) ? Math.round(unsold / units * 1000) / 10 : null,
    builder: resolveBuilder(item.CNSTRCT_ENTRPS_NM || item.BSNS_MBY_NM || null),
    completion: item.MVN_PREARNGE_YM || null,
    heating: item.HEAT_MTHD_NM || null,
    announcementUrl: item.PRESNTN_DTLS_URL || null,
    _sourceAddr: addr,
  };
}

async function phase1_applyhome() {
  if (!APPLYHOME_KEY) throw new Error("APPLYHOME_KEY not configured");

  log("Phase 1: 청약홈 목록 조회...");
  // getRemndr 단일 엔드포인트 고정 — 잔여세대/추가모집(미분양) 공고. fallback 사고 방지
  const usedEndpoint = `${APPLYHOME_BASE}/getRemndrLttotPblancDetail`;

  let items = [];
  // 첫 페이지로 전체 건수 확인 (fetchWithRetry: 일시 장애 시 3회 재시도, 소진 시 throw)
  const firstUrl = `${usedEndpoint}?page=1&perPage=1000&returnType=JSON&serviceKey=${encodeURIComponent(APPLYHOME_KEY)}`;
  const firstJson = await (await fetchWithRetry(firstUrl)).json();
  if (!firstJson.data?.length) throw new Error("청약홈 API 빈 응답");
  items = firstJson.data;
  const totalCount = firstJson.matchCount || firstJson.totalCount || 0;
  // 추가 페이지 fetch
  if (totalCount > 1000) {
    const totalPages = Math.ceil(totalCount / 1000);
    for (let page = 2; page <= totalPages; page++) {
      const url = `${usedEndpoint}?page=${page}&perPage=1000&returnType=JSON&serviceKey=${encodeURIComponent(APPLYHOME_KEY)}`;
      const json = await (await fetchWithRetry(url)).json();
      if (!json.data?.length) break;
      items = items.concat(json.data);
    }
  }
  log(`  총 ${totalCount}건 중 ${items.length}건 수신`);
  if (!items.length) throw new Error("청약홈 API에서 데이터를 가져올 수 없습니다");

  // [DEBUG] API 응답 필드 전수 확인 (첫 항목)
  log(`  사용된 엔드포인트: ${usedEndpoint}`);
  if (items.length > 0) {
    log(`  [DEBUG] 첫 번째 항목 전체 필드:
${JSON.stringify(items[0], null, 2)}`);
    const remndrValues = items.map(it => parseInt(it.REMNDR_HSHLDCO || 0, 10)).filter(v => v > 0);
    log(`  [DEBUG] REMNDR_HSHLDCO > 0인 항목: ${remndrValues.length}/${items.length}건`);
  }

  const isRemndr = usedEndpoint.includes("getRemndr");
  let apartments = items.map((item, i) => mapItem(item, i, isRemndr)).filter(a => a.region && a.name);
  log(`  기본 목록: ${apartments.length}건`);

  // 주택형별 면적/분양가 보강
  log("  주택형별 API 조회...");
  try {
    const mdlEndpoint = isRemndr
      ? `${APPLYHOME_BASE}/getRemndrLttotPblancMdl`
      : `${APPLYHOME_BASE}/getAPTLttotPblancMdl`;
    const manageNoSet = new Set(apartments.map(a => a.id.replace("ah-", "")));
    const allUnits = [];
    for (let page = 1; page <= 5; page++) {
      const url = `${mdlEndpoint}?page=${page}&perPage=1000&returnType=JSON&serviceKey=${encodeURIComponent(APPLYHOME_KEY)}`;
      const res = await fetch(url);
      if (!res.ok) break;
      const json = await res.json();
      if (!json.data?.length) break;
      allUnits.push(...json.data);
      if (allUnits.length >= (json.totalCount || Infinity)) break;
    }
    const grouped = {};
    for (const unit of allUnits) {
      const no = unit.HOUSE_MANAGE_NO;
      if (!manageNoSet.has(no)) continue;
      if (!grouped[no]) grouped[no] = [];
      grouped[no].push(unit);
    }
    let enriched = 0;
    apartments = apartments.map(a => {
      const units = grouped[a.id.replace("ah-", "")];
      if (!units) return a;
      const mainType = units.reduce((x, y) =>
        (parseInt(y.SUPLY_HSHLDCO || 0) + parseInt(y.SPSPLY_HSHLDCO || 0)) >
        (parseInt(x.SUPLY_HSHLDCO || 0) + parseInt(x.SPSPLY_HSHLDCO || 0)) ? y : x
      );
      const areaMatch = (mainType.HOUSE_TY || "").match(/(\d+\.?\d*)/);
      const area = areaMatch ? parseFloat(areaMatch[1]) : a.area;
      const price = parseInt(mainType.LTTOT_TOP_AMOUNT || 0) || a.price;
      enriched++;
      const totalUnits = units.reduce((sum, u) =>
        sum + (parseInt(u.SUPLY_HSHLDCO || 0) + parseInt(u.SPSPLY_HSHLDCO || 0)), 0);
      const finalUnits = totalUnits > 0 ? totalUnits : a.units;
      const unsoldRate = (a.unsold != null && finalUnits > 0) ? Math.round(a.unsold / finalUnits * 1000) / 10 : a.unsoldRate;
      const M2_TO_PYEONG = 3.3058;
      return { ...a, area, price, units: finalUnits, unsoldRate, pp: price && area ? Math.round(price / area * M2_TO_PYEONG) : null };
    });
    log(`  주택형별 보강: ${enriched}건`);
  } catch (e) { logError("applyhome-mdl", e.message); }

  // 지오코딩
  if (KAKAO_KEY) {
    log("  카카오 지오코딩...");
    let geocoded = 0;
    for (let i = 0; i < apartments.length; i += 10) {
      const batch = apartments.slice(i, i + 10);
      const results = await Promise.allSettled(
        batch.map(a => {
          if (!a._sourceAddr) return Promise.resolve({ lat: null, lng: null });
          const url = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(a._sourceAddr)}&size=1`;
          return fetch(url, { headers: { Authorization: `KakaoAK ${KAKAO_KEY}` } })
            .then(r => r.ok ? r.json() : { documents: [] })
            .then(d => d.documents?.length ? { lat: parseFloat(d.documents[0].y), lng: parseFloat(d.documents[0].x) } : { lat: null, lng: null })
            .catch(() => ({ lat: null, lng: null }));
        })
      );
      logRejected("geocode", results);
      batch.forEach((a, j) => {
        const r = results[j];
        if (r.status === "fulfilled" && r.value.lat) {
          apartments[i + j] = { ...a, lat: r.value.lat, lng: r.value.lng };
          geocoded++;
        }
      });
    }
    log(`  지오코딩: ${geocoded}건 좌표 획득`);
  }

  // _sourceAddr 제거
  apartments = apartments.map(({ _sourceAddr, ...rest }) => rest);

  meta.phases.applyhome = { ok: true, count: apartments.length };
  return apartments;
}

// ============================================================
// Phase 2: KOSIS 통계
// ============================================================
async function phase2_kosis(apartments) {
  if (!KOSIS_KEY) { log("Phase 2: KOSIS_KEY 없음, 건너뜀"); meta.phases.kosis = { ok: false, reason: "no key" }; return apartments; }
  log("Phase 2: KOSIS 통계 조회...");
  try {
    // ── 2-A: 시군구별 미분양 현황 (DT_MLTM_2082, 월별, MOLIT 국토교통부) ──
    // 2026-05 이전 통계청(orgId=101) DT_1YL202001E 폐지 → MOLIT(orgId=116) DT_MLTM_2082 로 이전.
    // collect-unsold-kosis.mjs 가 이미 동일 통계표 사용 중. itmId 동일.
    const now = new Date();
    const endMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
    const startDate = new Date(now.getFullYear(), now.getMonth() - 3, 1);
    const startMonth = `${startDate.getFullYear()}${String(startDate.getMonth() + 1).padStart(2, "0")}`;

    const params = new URLSearchParams({
      method: "getList", apiKey: KOSIS_KEY, format: "json", jsonVD: "Y",
      prdSe: "M", startPrdDe: startMonth, endPrdDe: endMonth,
      orgId: "116", tblId: "DT_MLTM_2082",
      itmId: "13103871087T1",
      objL1: "ALL", objL2: "ALL",
    });
    const res = await fetch(`https://kosis.kr/openapi/Param/statisticsParameterData.do?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.err) throw new Error(data.errMsg || data.err);
    const rows = Array.isArray(data) ? data : [];
    log(`  미분양 KOSIS 응답: ${rows.length}건 (${startMonth}~${endMonth})`);

    // 시군구별 최신 월 미분양 집계: { region: { gu: count } }
    const unsoldByRegionGu = {};
    const latestPeriod = {};
    for (const row of rows) {
      const region = REGION_MAP[row.C1_NM];
      if (!region) continue;
      const gu = row.C2_NM || "_total";
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

    // 시도별 합계
    const regionTotals = {};
    for (const [region, guMap] of Object.entries(unsoldByRegionGu)) {
      if (guMap["소계"] != null) regionTotals[region] = guMap["소계"];
      else if (guMap["_total"] != null) regionTotals[region] = guMap["_total"];
      else regionTotals[region] = Object.values(guMap).reduce((s, v) => s + v, 0);
    }
    log(`  시군구별 미분양: ${Object.keys(unsoldByRegionGu).length}개 시도, ${Object.values(unsoldByRegionGu).reduce((s, m) => s + Object.keys(m).length, 0)}개 시군구`);

    // 시군구별 총 분양세대수 (비례배분용)
    const unitsByGu = {};
    for (const a of apartments) {
      if (!a.region || !a.gu || !a.units || a.units <= 1) continue;
      const key = `${a.region}::${a.gu}`;
      unitsByGu[key] = (unitsByGu[key] || 0) + a.units;
    }

    // 미분양 추정: 비례배분 (확인된 값 우선)
    let kosisEstimated = 0;
    apartments = apartments.map(a => {
      const guMap = unsoldByRegionGu[a.region];
      const guUnsold = guMap?.[a.gu] ?? regionTotals[a.region] ?? null;

      // 이미 확인된 unsold 있으면 유지
      if (a.unsold != null && a.unsold > 0) {
        return { ...a, _regionalUnsold: guUnsold };
      }
      // 세대수 부족하면 추정 불가
      if (!a.region || !a.gu || !a.units || a.units <= 1 || guUnsold == null || guUnsold <= 0) {
        return { ...a, _regionalUnsold: guUnsold };
      }
      // 비례배분: 시군구 미분양 × (단지 세대수 / 시군구 총 세대수)
      const guKey = `${a.region}::${a.gu}`;
      const totalUnitsInGu = unitsByGu[guKey] || a.units;
      const estimated = Math.round(guUnsold * (a.units / totalUnitsInGu));
      if (estimated <= 0) return { ...a, _regionalUnsold: guUnsold };
      const unsoldRate = Math.round(estimated / a.units * 1000) / 10;
      if (unsoldRate > 100) return { ...a, _regionalUnsold: guUnsold };

      kosisEstimated++;
      return {
        ...a,
        unsold: estimated,
        unsoldRate,
        _regionalUnsold: guUnsold,
        _kosisEstimated: true,
      };
    });
    log(`  KOSIS 비례배분 미분양 추정: ${kosisEstimated}건`);

    // ── 2-B: 인구증감률 (DT_1B8000G, 월별) ──
    const popGrowthMap = {};
    try {
      const popEndMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
      const popStartMonth = `${now.getFullYear() - 1}01`;
      const popParams = new URLSearchParams({
        method: "getList", apiKey: KOSIS_KEY, itmId: "ALL", format: "json", jsonVD: "Y",
        prdSe: "M", startPrdDe: popStartMonth, endPrdDe: popEndMonth,
        orgId: "101", tblId: "DT_1B8000G",
        objL1: "ALL", objL2: "ALL",
      });
      const popRes = await fetch(`https://kosis.kr/openapi/Param/statisticsParameterData.do?${popParams}`);
      if (popRes.ok) {
        const popData = await popRes.json();
        const popRows = Array.isArray(popData) ? popData : [];
        const rateByRegion = {};
        for (const row of popRows) {
          if (row.C2_NM !== "자연증가율(천명당)") continue;
          if (row.C1_NM === "전국") continue;
          const region = REGION_MAP[row.C1_NM];
          if (!region) continue;
          const val = parseFloat(row.DT);
          if (isNaN(val)) continue;
          if (!rateByRegion[region]) rateByRegion[region] = [];
          rateByRegion[region].push(val);
        }
        for (const [region, vals] of Object.entries(rateByRegion)) {
          const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
          popGrowthMap[region] = Math.round(avg * 10) / 10;
        }
        log(`  인구증감: ${Object.keys(popGrowthMap).length}개 지역`);
      }
    } catch (e) { logError("kosis-pop", e.message); }

    apartments = apartments.map(a => ({
      ...a,
      popGrowth: popGrowthMap[a.region] ?? a.popGrowth ?? null,
    }));
    log(`  KOSIS 지역 매핑: ${Object.keys(regionTotals).length}개 지역`);
    meta.phases.kosis = { ok: true };
  } catch (e) { logError("kosis", e.message); meta.phases.kosis = { ok: false, reason: e.message }; }
  return apartments;
}
// ============================================================
// Phase 3: 카카오 인프라
// ============================================================
async function phase3_kakao(apartments) {
  if (!KAKAO_KEY) { log("Phase 3: KAKAO_KEY 없음, 건너뜀"); meta.phases.kakao = { ok: false, reason: "no key" }; return apartments; }
  log("Phase 3: 카카오 인프라 조회...");
  const withCoords = apartments.filter(a => a.lat && a.lng);
  if (withCoords.length === 0) { log("  좌표 있는 아파트 없음"); meta.phases.kakao = { ok: false, reason: "no coords" }; return apartments; }

  const CATS = ["HP8", "MT1", "CS2", "CE7", "CT1", "BK9", "PM9"];
  const CAT_NAMES = ["hospital", "mart", "conv", "cafe", "culture", "bank", "pharmacy"];

  async function fetchInfra(apt) {
    const h = { Authorization: `KakaoAK ${KAKAO_KEY}` };
    const base = "https://dapi.kakao.com/v2/local";
    // size=3으로 변경: count + 거리 + 시설명 추출
    const parseCat = d => ({
      count: d.meta?.total_count ?? 0,
      nearest: d.documents?.[0] ? { name: d.documents[0].place_name, dist: Math.round(parseFloat(d.documents[0].distance || 0)) } : null,
      top3: (d.documents || []).slice(0, 3).map(doc => ({ name: doc.place_name, dist: Math.round(parseFloat(doc.distance || 0)) })),
    });
    const results = await Promise.allSettled([
      ...CATS.map(code => fetch(`${base}/search/category.json?category_group_code=${code}&x=${apt.lng}&y=${apt.lat}&radius=1000&sort=distance&size=3`, { headers: h }).then(r => r.ok ? r.json() : { meta: { total_count: 0 }, documents: [] }).then(parseCat)),
      fetch(`${base}/search/keyword.json?query=${encodeURIComponent("공원")}&x=${apt.lng}&y=${apt.lat}&radius=1000&sort=distance&size=3`, { headers: h }).then(r => r.ok ? r.json() : { meta: { total_count: 0 }, documents: [] }).then(parseCat),
      fetch(`${base}/search/category.json?category_group_code=SW8&x=${apt.lng}&y=${apt.lat}&radius=5000&sort=distance&size=1`, { headers: h }).then(r => r.ok ? r.json() : { documents: [] }).then(d => d.documents?.length ? Math.round(parseFloat(d.documents[0].distance)) : 9999),
    ]);
    const infra = {};
    const nearbyFacilities = [];
    CAT_NAMES.forEach((name, i) => {
      const r = results[i].status === "fulfilled" ? results[i].value : { count: 0, nearest: null, top3: [] };
      infra[name] = r.count;
      infra[`${name}Dist`] = r.nearest?.dist ?? null;
      if (r.nearest) nearbyFacilities.push({ type: name, name: r.nearest.name, dist: r.nearest.dist });
    });
    const parkR = results[7].status === "fulfilled" ? results[7].value : { count: 0, nearest: null, top3: [] };
    infra.park = parkR.count;
    infra.parkDist = parkR.nearest?.dist ?? null;
    if (parkR.nearest) nearbyFacilities.push({ type: "park", name: parkR.nearest.name, dist: parkR.nearest.dist });
    infra.subwayDist = results[8].status === "fulfilled" ? results[8].value : 9999;
    infra.nearbyFacilities = nearbyFacilities.sort((a, b) => a.dist - b.dist);
    return infra;
  }

  let enriched = 0;
  // 배치: 5개씩 (카카오 초당 제한 방지)
  for (let i = 0; i < withCoords.length; i += 5) {
    const batch = withCoords.slice(i, i + 5);
    const results = await Promise.allSettled(batch.map(a => fetchInfra(a)));
    logRejected("infra", results);
    for (let j = 0; j < batch.length; j++) {
      if (results[j].status === "fulfilled") {
        const idx = apartments.findIndex(a => a.id === batch[j].id);
        if (idx >= 0) { apartments[idx] = { ...apartments[idx], ...results[j].value }; enriched++; }
      }
    }
    if (i % 50 === 0 && i > 0) log(`  인프라 진행: ${i}/${withCoords.length}`);
  }
  log(`  인프라 보강: ${enriched}건`);
  meta.phases.kakao = { ok: true, enriched };
  return apartments;
}

// ============================================================
// Phase 4: NEIS 학군
// ============================================================
const EDU_OFFICE_CODE = {
  "서울": "B10", "부산": "C10", "대구": "D10", "인천": "E10",
  "광주": "F10", "대전": "G10", "울산": "H10", "세종": "I10",
  "경기": "J10", "강원": "K10", "충북": "M10", "충남": "N10",
  "전북": "P10", "전남": "Q10", "경북": "R10", "경남": "S10", "제주": "T10",
};

async function phase4_neis(apartments) {
  if (!NEIS_KEY) { log("Phase 4: NEIS_KEY 없음, 건너뜀"); meta.phases.neis = { ok: false, reason: "no key" }; return apartments; }
  log("Phase 4: NEIS 학군 조회...");
  try {
    // 지역별 학교 목록
    const regions = [...new Set(apartments.map(a => a.region).filter(Boolean))];
    const regionSchools = {};
    for (const region of regions) {
      const code = EDU_OFFICE_CODE[region];
      if (!code) continue;
      const schools = [];
      let page = 1;
      while (true) {
        const url = `https://open.neis.go.kr/hub/schoolInfo?KEY=${NEIS_KEY}&Type=json&ATPT_OFCDC_SC_CODE=${code}&pIndex=${page}&pSize=1000`;
        const res = await fetch(url);
        if (!res.ok) break;
        const json = await res.json();
        const info = json.schoolInfo;
        if (!info?.[1]?.row) break;
        for (const s of info[1].row) {
          schools.push({ name: s.SCHUL_NM, type: s.SCHUL_KND_SC_NM, address: s.ORG_RDNMA || "", code: s.SD_SCHUL_CODE, officeCode: code, founded: s.FOND_SC_NM || "", foundedYear: s.FOND_YMD ? parseInt(s.FOND_YMD.substring(0, 4)) || null : null, highSchoolType: s.HS_SC_NM || null });
        }
        const total = info[0]?.head?.[0]?.list_total_count ?? 0;
        if (page * 1000 >= total) break;
        page++;
      }
      regionSchools[region] = schools;
    }
    log(`  학교 데이터: ${Object.keys(regionSchools).length}개 지역`);

    // 학군 점수 계산
    let enriched = 0;
    const withCoords = apartments.filter(a => a.lat && a.lng && KAKAO_KEY);

    // 좌표 있는 아파트: 카카오 키워드 검색
    if (withCoords.length > 0) {
      for (let i = 0; i < withCoords.length; i += 5) {
        const batch = withCoords.slice(i, i + 5);
        const results = await Promise.allSettled(batch.map(async (apt) => {
          const h = { Authorization: `KakaoAK ${KAKAO_KEY}` };
          const base = "https://dapi.kakao.com/v2/local/search/keyword.json";
          const [elem, middle, high] = await Promise.all(
            ["초등학교", "중학교", "고등학교"].map(kw =>
              fetch(`${base}?query=${encodeURIComponent(kw)}&x=${apt.lng}&y=${apt.lat}&radius=2000&sort=distance&size=15`, { headers: h })
                .then(r => r.ok ? r.json() : { meta: { total_count: 0 }, documents: [] })
                .then(d => ({
                  count: d.meta?.total_count ?? 0,
                  nearest: d.documents?.[0] ? Math.round(parseFloat(d.documents[0].distance)) : null,
                  docs: (d.documents ?? []).slice(0, 3),
                }))
                .catch(() => ({ count: 0, nearest: null, docs: [] }))
            )
          );
          let score = 0;
          if (elem.nearest != null && elem.nearest <= 500) score += 25;
          else if (elem.nearest != null && elem.nearest <= 1000) score += 15;
          else if (elem.count > 0) score += 8;
          if (middle.nearest != null && middle.nearest <= 1000) score += 20;
          else if (middle.count > 0) score += 12;
          if (high.nearest != null && high.nearest <= 2000) score += 15;
          else if (high.count > 0) score += 8;
          score += Math.round(Math.min(elem.count + middle.count + high.count, 15) * 1.5);
          score = Math.min(score, 100);
          const nearbySchools = [
            ...elem.docs.map(d => ({ name: d.place_name, type: "초등", distance: Math.round(parseFloat(d.distance)), address: d.road_address_name || d.address_name || "" })),
            ...middle.docs.map(d => ({ name: d.place_name, type: "중학교", distance: Math.round(parseFloat(d.distance)), address: d.road_address_name || d.address_name || "" })),
            ...high.docs.map(d => ({ name: d.place_name, type: "고등", distance: Math.round(parseFloat(d.distance)), address: d.road_address_name || d.address_name || "" })),
          ].sort((a, b) => a.distance - b.distance);
          return { id: apt.id, schoolScore: score, schoolGrade: score >= 85 ? "최우수" : score >= 70 ? "우수" : score >= 50 ? "보통" : "미흡", nearbySchools };
        }));
        logRejected("school", results);
        for (const r of results) {
          if (r.status === "fulfilled") {
            const idx = apartments.findIndex(a => a.id === r.value.id);
            if (idx >= 0) { apartments[idx] = { ...apartments[idx], schoolScore: r.value.schoolScore, schoolGrade: r.value.schoolGrade, nearbySchools: r.value.nearbySchools }; enriched++; }
          }
        }
      }
    }

    // 좌표 없는 아파트: NEIS 주소 매칭
    for (const apt of apartments) {
      if (apt.schoolScore != null) continue;
      const schools = regionSchools[apt.region] || [];
      const guSchools = apt.gu ? schools.filter(s => s.address.includes(apt.gu)) : schools;
      const elem = guSchools.filter(s => s.type === "초등학교").length;
      const mid = guSchools.filter(s => s.type === "중학교").length;
      const high = guSchools.filter(s => s.type === "고등학교").length;
      let score = Math.min((elem + mid + high) * 3, 40) + (elem > 0 ? 15 : 0) + (mid > 0 ? 15 : 0) + (high > 0 ? 10 : 0);
      score = Math.min(score, 100);
      apt.schoolScore = score;
      apt.schoolGrade = score >= 85 ? "최우수" : score >= 70 ? "우수" : score >= 50 ? "보통" : "미흡";
      enriched++;
    }

    log(`  학군 보강: ${enriched}건`);

    // 학생수/학급수 enrichment (NEIS classInfo API)
    const currentYear = new Date().getFullYear().toString();
    const schoolCache = new Map(); // "officeCode|schoolCode" → {students, classes}
    let schoolEnriched = 0;
    for (const apt of apartments) {
      if (!apt.nearbySchools || apt.nearbySchools.length === 0) continue;
      for (const ns of apt.nearbySchools) {
        // regionSchools에서 학교코드 매칭 (이름 일치)
        const allSchools = regionSchools[apt.region] || [];
        const matched = allSchools.find(s => s.name === ns.name);
        if (!matched || !matched.code) continue;
        const cacheKey = `${matched.officeCode}|${matched.code}`;
        if (schoolCache.has(cacheKey)) {
          const cached = schoolCache.get(cacheKey);
          ns.students = cached.students;
          ns.classes = cached.classes;
          ns.perClass = cached.perClass;
          ns.founded = matched.founded;
          ns.foundedYear = matched.foundedYear;
          if (matched.highSchoolType) ns.highSchoolType = matched.highSchoolType;
          continue;
        }
        try {
          const url = `https://open.neis.go.kr/hub/classInfo?KEY=${NEIS_KEY}&Type=json&ATPT_OFCDC_SC_CODE=${matched.officeCode}&SD_SCHUL_CODE=${matched.code}&AY=${currentYear}&pSize=100`;
          const res = await fetch(url);
          if (res.ok) {
            const json = await res.json();
            const rows = json.classInfo?.[1]?.row ?? [];
            const classes = rows.length;
            // 학생수는 classInfo에 없으므로 학급수만 저장
            const result = { students: null, classes, perClass: null };
            schoolCache.set(cacheKey, result);
            ns.classes = classes;
            ns.founded = matched.founded;
            ns.foundedYear = matched.foundedYear;
            if (matched.highSchoolType) ns.highSchoolType = matched.highSchoolType;
            schoolEnriched++;
          }
        } catch { /* continue */ }
      }
    }
    log(`  학교 상세 보강: ${schoolEnriched}건 (캐시: ${schoolCache.size}개)`);

    meta.phases.neis = { ok: true, enriched, schoolEnriched };
  } catch (e) { logError("neis", e.message); meta.phases.neis = { ok: false, reason: e.message }; }
  return apartments;
}

// ============================================================
// Phase 5: DART 건설사 재무
// ============================================================
const BUILDER_CORP_CODES = {
  "GS건설": "00120030", "현대건설": "00164478", "대우건설": "00124540",
  "삼성물산": "00149655", "DL이앤씨": "01524093", "HDC현대산업개발": "01310269",
  "포스코이앤씨": "00100814", "롯데건설": "00120438", "SK에코플랜트": "00131799",
  "한화건설": "00424529", "호반건설": "00236614", "태영건설": "01837845",
  "금호건설": "00106313", "대림산업": "01843961", "현대엔지니어링": "00349927",
  "쌍용건설": "00138206",
};

function estimateCreditGrade(ratio) {
  if (ratio <= 100) return "A";
  if (ratio <= 150) return "A-";
  if (ratio <= 200) return "BBB";
  if (ratio <= 250) return "BB";
  if (ratio <= 350) return "B";
  return "CCC";
}

async function phase5_dart(apartments) {
  if (!DART_KEY) { log("Phase 5: DART_KEY 없음, 건너뜀"); meta.phases.dart = { ok: false, reason: "no key" }; return apartments; }
  log("Phase 5: DART 건설사 재무 조회...");
  try {
    const builders = [...new Set(apartments.map(a => a.builder).filter(b => b && BUILDER_CORP_CODES[b]))];
    log(`  조회 대상 건설사: ${builders.length}개`);
    const financials = {};

    for (let i = 0; i < builders.length; i += 5) {
      const batch = builders.slice(i, i + 5);
      const results = await Promise.allSettled(batch.map(async (name) => {
        const corpCode = BUILDER_CORP_CODES[name];
        const reprtCodes = ["11011", "11012", "11013", "11014"];
        const years = [2024, 2023];
        for (const year of years) {
          for (const reprt of reprtCodes) {
            try {
              const url = `https://opendart.fss.or.kr/api/fnlttSinglAcnt.json?crtfc_key=${DART_KEY}&corp_code=${corpCode}&bsns_year=${year}&reprt_code=${reprt}`;
              const res = await fetch(url);
              if (!res.ok) continue;
              const json = await res.json();
              if (json.status !== "000" || !json.list) continue;
              let items = json.list.filter(x => x.fs_div === "CFS" && x.sj_div === "BS");
              if (!items.length) items = json.list.filter(x => x.fs_div === "OFS" && x.sj_div === "BS");
              const debt = items.find(x => x.account_nm === "부채총계");
              const equity = items.find(x => x.account_nm === "자본총계");
              if (debt && equity) {
                const d = parseFloat((debt.thstrm_amount || "").replace(/,/g, "")) || 0;
                const e = parseFloat((equity.thstrm_amount || "").replace(/,/g, "")) || 0;
                if (e > 0) return { name, debtRatio: Math.round(d / e * 10) / 10 };
              }
            } catch { continue; }
          }
        }
        return { name, debtRatio: null };
      }));
      logRejected("dart", results);
      for (const r of results) {
        if (r.status === "fulfilled" && r.value.debtRatio != null) {
          financials[r.value.name] = { debtRatio: r.value.debtRatio, creditGrade: estimateCreditGrade(r.value.debtRatio) };
        }
      }
    }

    apartments = apartments.map(a => {
      const fin = financials[a.builder];
      if (!fin) return a;
      return { ...a, builderDebtRatio: fin.debtRatio, builderCreditGrade: fin.creditGrade };
    });
    log(`  재무 보강: ${Object.keys(financials).length}개 건설사`);
    meta.phases.dart = { ok: true, builders: Object.keys(financials).length };
  } catch (e) { logError("dart", e.message); meta.phases.dart = { ok: false, reason: e.message }; }
  return apartments;
}

// ============================================================
// Phase 6: 교통 거리 (버스, IC, KTX)
// ============================================================
async function phase6_transport(apartments) {
  if (!KAKAO_KEY) { log("Phase 6: KAKAO_KEY 없음, 건너뜀"); meta.phases.transport = { ok: false, reason: "no key" }; return apartments; }
  log("Phase 6: 교통 거리 조회...");
  const withCoords = apartments.filter(a => a.lat && a.lng);
  if (withCoords.length === 0) { log("  좌표 있는 아파트 없음"); meta.phases.transport = { ok: false, reason: "no coords" }; return apartments; }

  const h = { Authorization: `KakaoAK ${KAKAO_KEY}` };
  const base = "https://dapi.kakao.com/v2/local/search/keyword.json";
  let enriched = 0;

  for (let i = 0; i < withCoords.length; i += 5) {
    const batch = withCoords.slice(i, i + 5);
    const results = await Promise.allSettled(batch.map(async (apt) => {
      const [busRes, icRes, ktxRes] = await Promise.all([
        fetch(`${base}?query=${encodeURIComponent("버스정류장")}&x=${apt.lng}&y=${apt.lat}&radius=500&size=15`, { headers: h })
          .then(r => r.ok ? r.json() : { meta: { total_count: 0 } })
          .then(d => d.meta?.total_count ?? 0)
          .catch(() => 0),
        fetch(`${base}?query=${encodeURIComponent("고속도로IC")}&x=${apt.lng}&y=${apt.lat}&radius=20000&sort=distance&size=1`, { headers: h })
          .then(r => r.ok ? r.json() : { documents: [] })
          .then(d => d.documents?.[0] ? Math.round(parseFloat(d.documents[0].distance) / 100) / 10 : 99)
          .catch(() => 99),
        fetch(`${base}?query=${encodeURIComponent("KTX")}&x=${apt.lng}&y=${apt.lat}&radius=30000&sort=distance&size=1`, { headers: h })
          .then(r => r.ok ? r.json() : { documents: [] })
          .then(d => d.documents?.[0] ? Math.round(parseFloat(d.documents[0].distance) / 100) / 10 : 99)
          .catch(() => 99),
      ]);
      return { id: apt.id, busRoutes: busRes, icDist: icRes, ktxDist: ktxRes };
    }));
    logRejected("transport", results);
    for (const r of results) {
      if (r.status === "fulfilled") {
        const idx = apartments.findIndex(a => a.id === r.value.id);
        if (idx >= 0) {
          apartments[idx] = { ...apartments[idx], busRoutes: r.value.busRoutes, icDist: r.value.icDist, ktxDist: r.value.ktxDist };
          enriched++;
        }
      }
    }
    if (i % 50 === 0 && i > 0) log(`  교통 진행: ${i}/${withCoords.length}`);
  }
  log(`  교통 보강: ${enriched}건`);
  meta.phases.transport = { ok: true, enriched };
  return apartments;
}

// ============================================================
// Phase 7: 국토부 실거래가 (nearbyMedian, jeonseRate, recentTrades6m, pir)
// ============================================================

async function phase7_realtrade(apartments) {
  if (!DATA_GO_KEY) { log("Phase 7: DATA_GO_KEY 없음, 건너뜀"); meta.phases.realtrade = { ok: false, reason: "no key" }; return apartments; }
  log("Phase 7: 실거래가 조회...");

  // 아파트들의 고유 (region, gu) 조합 추출
  const regionGuPairs = [...new Set(apartments.map(a => `${a.region}|${a.gu}`))].map(s => {
    const [region, gu] = s.split("|");
    return { region, gu };
  }).filter(rg => rg.region && rg.gu);

  // 최근 6개월 YYYYMM 생성
  const months = [];
  const now = new Date();
  for (let m = 1; m <= 6; m++) {
    const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
    months.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  // 지역별 실거래 데이터 수집
  const tradeData = {}; // { "region|gu": { trades: [{price, area}], rentPrices: [] } }
  let apiCalls = 0;

  for (const rg of regionGuPairs) {
    const lawdCd = getLawdCd(rg.region, rg.gu);
    if (!lawdCd) continue;
    const key = `${rg.region}|${rg.gu}`;
    if (tradeData[key]) continue;
    tradeData[key] = { trades: [], rentPrices: [] };

    // 매매 실거래가 (일반 API - XML 응답)
    for (const month of months) {
      try {
        const url = `https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade?serviceKey=${DATA_GO_KEY}&LAWD_CD=${lawdCd}&DEAL_YMD=${month}&pageNo=1&numOfRows=1000`;
        const res = await fetch(url);
        if (!res.ok) {
          if (apiCalls === 0) log(`  매매 API ${res.status}: ${lawdCd}/${month}`);
          continue;
        }
        const text = await res.text();
        const matches = [...text.matchAll(/<item>[\s\S]*?<\/item>/g)];
        for (const m of matches) {
          const getTag = (tag) => { const r = m[0].match(new RegExp(`<${tag}>([^<]*)</${tag}>`)); return r ? r[1].trim() : ""; };
          const price = parseInt((getTag("dealAmount") || "0").replace(/,/g, ""));
          const area = parseFloat(getTag("excluUseAr") || "0");
          const floor = parseInt(getTag("floor") || "0") || null;
          const buildYear = parseInt(getTag("buildYear") || "0") || null;
          if (price > 0 && area > 0) tradeData[key].trades.push({ price, area, floor, buildYear });
        }
        apiCalls++;
      } catch { /* continue */ }
    }

    // 전월세 (전세만 필터, 월세=0인 항목)
    for (const month of months) {
      try {
        const url = `https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent?serviceKey=${DATA_GO_KEY}&LAWD_CD=${lawdCd}&DEAL_YMD=${month}&pageNo=1&numOfRows=1000`;
        const res = await fetch(url);
        if (!res.ok) continue;
        const text = await res.text();
        const matches = [...text.matchAll(/<item>[\s\S]*?<\/item>/g)];
        for (const m of matches) {
          const getTag = (tag) => { const r = m[0].match(new RegExp(`<${tag}>([^<]*)</${tag}>`)); return r ? r[1].trim() : ""; };
          const deposit = parseInt((getTag("deposit") || "0").replace(/,/g, ""));
          const monthlyRent = parseInt((getTag("monthlyRent") || "0").replace(/,/g, ""));
          const area = parseFloat(getTag("excluUseAr") || "0");
          if (deposit > 0 && monthlyRent === 0 && area > 0) tradeData[key].rentPrices.push({ deposit, area });
        }
        apiCalls++;
      } catch { /* continue */ }
    }

    if (apiCalls % 100 === 0 && apiCalls > 0) log(`  실거래 API 호출: ${apiCalls}건`);
  }
  log(`  실거래 API 총 호출: ${apiCalls}건, ${Object.keys(tradeData).length}개 지역`);

  // 아파트별 필드 계산
  let enriched = 0;
  apartments = apartments.map(a => {
    const key = `${a.region}|${a.gu}`;
    const td = tradeData[key];
    if (!td || td.trades.length === 0) return a;

    // 유사 면적 거래 필터 (±20㎡)
    const aptArea = a.area || 84;
    const similarTrades = td.trades.filter(t => Math.abs(t.area - aptArea) <= 20);
    const tradesToUse = similarTrades.length >= 5 ? similarTrades : td.trades;

    // nearbyMedian: 매매가 중앙값 (만원)
    const sortedPrices = tradesToUse.map(t => t.price).sort((x, y) => x - y);
    const nearbyMedian = sortedPrices[Math.floor(sortedPrices.length / 2)];

    // recentTrades6m: 6개월 거래 건수
    const recentTrades6m = td.trades.length;

    // jeonseRate: 전세가율 (전세 중앙값 / 매매 중앙값 × 100)
    let jeonseRate = null;
    const similarRents = td.rentPrices.filter(t => Math.abs(t.area - aptArea) <= 20);
    const rentsToUse = similarRents.length >= 3 ? similarRents : td.rentPrices;
    if (rentsToUse.length > 0 && nearbyMedian > 0) {
      const sortedRents = rentsToUse.map(t => t.deposit).sort((x, y) => x - y);
      const medianRent = sortedRents[Math.floor(sortedRents.length / 2)];
      jeonseRate = Math.round(medianRent / nearbyMedian * 100);
    }

    // pir: 분양가 / 지역 평균소득
    let pir = null;
    if (a.price && a._avgIncome && a._avgIncome > 0) {
      pir = Math.round(a.price / (a._avgIncome / 10000) * 10) / 10; // 만원 기준
    }

    // 면적별 매매 시세 그룹핑
    const tradeGroups = {};
    for (const t of td.trades) {
      const bucket = Math.round(t.area);
      if (!tradeGroups[bucket]) tradeGroups[bucket] = [];
      tradeGroups[bucket].push(t.price);
    }
    const priceByArea = Object.entries(tradeGroups)
      .filter(([, prices]) => prices.length >= 2)
      .map(([area, prices]) => {
        prices.sort((x, y) => x - y);
        return { area: Number(area), min: prices[0], avg: Math.round(prices.reduce((s, p) => s + p, 0) / prices.length), max: prices[prices.length - 1], count: prices.length };
      }).sort((x, y) => x.area - y.area);

    // 면적별 전세 시세 그룹핑
    const rentGroups = {};
    for (const t of td.rentPrices) {
      const bucket = Math.round(t.area);
      if (!rentGroups[bucket]) rentGroups[bucket] = [];
      rentGroups[bucket].push(t.deposit);
    }
    const rentByArea = Object.entries(rentGroups)
      .filter(([, deps]) => deps.length >= 2)
      .map(([area, deps]) => {
        deps.sort((x, y) => x - y);
        return { area: Number(area), min: deps[0], avg: Math.round(deps.reduce((s, d) => s + d, 0) / deps.length), max: deps[deps.length - 1], count: deps.length };
      }).sort((x, y) => x.area - y.area);

    // 면적별 전세가율
    const jeonseByArea = priceByArea.map(p => {
      const rent = rentByArea.find(r => Math.abs(r.area - p.area) <= 5);
      return { area: p.area, rate: rent && p.avg > 0 ? Math.round(rent.avg / p.avg * 100) : null };
    }).filter(j => j.rate != null);

    // 층수 분석
    const floors = tradesToUse.map(t => t.floor).filter(f => f && f > 0);
    const avgFloor = floors.length > 0 ? Math.round(floors.reduce((s, f) => s + f, 0) / floors.length) : null;
    const floorRange = floors.length > 0 ? `${Math.min(...floors)}~${Math.max(...floors)}` : null;

    // 층별 가격 (저/중/고)
    const floorTrades = tradesToUse.filter(t => t.floor && t.floor > 0);
    let priceByFloor = null;
    if (floorTrades.length >= 5) {
      const groups = { "저층(1-5)": [], "중층(6-15)": [], "고층(16+)": [] };
      for (const t of floorTrades) {
        if (t.floor <= 5) groups["저층(1-5)"].push(t.price);
        else if (t.floor <= 15) groups["중층(6-15)"].push(t.price);
        else groups["고층(16+)"].push(t.price);
      }
      priceByFloor = Object.entries(groups)
        .filter(([, ps]) => ps.length > 0)
        .map(([group, ps]) => ({ group, avg: Math.round(ps.reduce((s, p) => s + p, 0) / ps.length), count: ps.length }));
    }

    // 주변 평균 건축년도
    const buildYears = td.trades.map(t => t.buildYear).filter(y => y && y > 1970);
    const nearbyBuildYear = buildYears.length > 0 ? Math.round(buildYears.reduce((s, y) => s + y, 0) / buildYears.length) : null;

    enriched++;
    return {
      ...a,
      nearbyMedian: nearbyMedian ?? null,
      recentTrades6m: recentTrades6m ?? null,
      jeonseRate: jeonseRate ?? null,
      pir: pir ?? null,
      priceByArea: priceByArea.length > 0 ? priceByArea : null,
      rentByArea: rentByArea.length > 0 ? rentByArea : null,
      jeonseByArea: jeonseByArea.length > 0 ? jeonseByArea : null,
      avgFloor, floorRange, priceByFloor, nearbyBuildYear,
    };
  });

  const withPrice = apartments.filter(a => a.priceByArea?.length > 0).length;
  const withRent = apartments.filter(a => a.rentByArea?.length > 0).length;
  log(`  실거래 보강: ${enriched}건, priceByArea: ${withPrice}건, rentByArea: ${withRent}건`);
  meta.phases.realtrade = { ok: true, enriched, apiCalls };
  return apartments;
}

// ============================================================
// Phase 9: 네이버 교차검증 (Supabase → naver* 필드 병합)
// ============================================================
async function phase9_naver(apartments) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    log("Phase 9: Supabase 환경변수 없음 — 네이버 교차검증 생략");
    meta.phases.naver = { ok: false, reason: "no_env" };
    return apartments;
  }

  log("Phase 9: 네이버 교차검증...");

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // 1. complexes 조회
    const { data: complexes, error: cErr } = await supabase
      .from("complexes")
      .select("complex_no, nearby_apartment_ids, use_approve_ymd, high_floor");

    if (cErr) throw new Error(`complexes 조회 실패: ${cErr.message}`);
    if (!complexes || complexes.length === 0) {
      log("  네이버 단지 데이터 없음 — 스킵");
      meta.phases.naver = { ok: true, enriched: 0, reason: "no_data" };
      return apartments;
    }

    // 2. articles 활성 매물 조회
    const { data: articles, error: aErr } = await supabase
      .from("articles")
      .select("complex_no, trade_type, price, exclusive_area, floor_info")
      .eq("is_active", true);

    if (aErr) throw new Error(`articles 조회 실패: ${aErr.message}`);

    // 3. aptId → complexNo[] 매핑
    const aptComplexMap = new Map();
    for (const c of complexes) {
      for (const aptId of (c.nearby_apartment_ids || [])) {
        if (!aptComplexMap.has(aptId)) aptComplexMap.set(aptId, new Set());
        aptComplexMap.get(aptId).add(c.complex_no);
      }
    }

    // 4. complexNo → articles 그룹핑
    const complexArticlesMap = new Map();
    for (const art of (articles || [])) {
      if (!complexArticlesMap.has(art.complex_no)) complexArticlesMap.set(art.complex_no, []);
      complexArticlesMap.get(art.complex_no).push(art);
    }

    // 5. complexNo → complex 메타 조회용
    const complexMap = new Map(complexes.map(c => [c.complex_no, c]));

    const median = (arr) => arr.length ? arr[Math.floor(arr.length / 2)] : null;
    const avg = (arr) => arr.length ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length) : null;

    // 6. 아파트별 통계 계산 + 병합
    let enriched = 0;
    const now = new Date().toISOString();

    for (const apt of apartments) {
      const cNos = aptComplexMap.get(apt.id);
      if (!cNos || cNos.size === 0) continue;

      // 인근 단지의 모든 매물 수집
      const allArts = [];
      for (const cno of cNos) {
        allArts.push(...(complexArticlesMap.get(cno) || []));
      }
      if (allArts.length === 0) continue;

      const sells = allArts.filter(a => a.trade_type === "매매");
      const jeonses = allArts.filter(a => a.trade_type === "전세");
      const wolses = allArts.filter(a => a.trade_type === "월세");

      const sellPrices = sells.map(a => a.price).filter(Boolean).sort((a, b) => a - b);
      const jeonsePrices = jeonses.map(a => a.price).filter(Boolean).sort((a, b) => a - b);

      const sellMedian = median(sellPrices);
      const jeonseMedian = median(jeonsePrices);

      // 인근 단지 메타 (건축연도, 층수)
      const nearbyComplexes = [...cNos].map(cno => complexMap.get(cno)).filter(Boolean);
      const buildYears = nearbyComplexes
        .map(c => c.use_approve_ymd ? parseInt(c.use_approve_ymd.slice(0, 4)) : null)
        .filter(y => y && y > 1970);
      const floors = nearbyComplexes.map(c => c.high_floor).filter(Boolean);

      apt.naverNearbyMedian = sellMedian;
      apt.naverNearbyAvg = avg(sellPrices);
      apt.naverJeonseRate = (sellMedian && jeonseMedian) ? Math.round(jeonseMedian / sellMedian * 100) : null;
      apt.naverSellCount = sells.length;
      apt.naverJeonseCount = jeonses.length;
      apt.naverWolseCount = wolses.length;
      apt.naverBuildYear = avg(buildYears);
      apt.naverAvgFloor = floors.length ? Math.round(floors.reduce((s, v) => s + v, 0) / floors.length * 10) / 10 : null;
      apt.naverSchoolWalkMin = apt.naverSchoolWalkMin ?? null; // 기존 값 유지
      apt.naverNearbyCount = cNos.size;
      apt.naverFetchedAt = now;
      enriched++;
    }

    log(`  네이버 교차검증: ${enriched}건 보강 (단지: ${complexes.length}, 매물: ${(articles || []).length})`);
    meta.phases.naver = { ok: true, enriched, complexes: complexes.length, articles: (articles || []).length };
  } catch (e) {
    logError("naver", e.message);
    meta.phases.naver = { ok: false, error: e.message };
  }

  return apartments;
}

// ============================================================
// Output helper
// ============================================================

/**
 * 4 JSON 출력 (apartments + list + prices + meta).
 * collect-data 본 흐름과 --from-supabase-only 모드 둘 다 호출.
 * @param {object[]} apartments — 출력할 단지 배열 (이미 내부 필드 제거된 상태)
 * @param {string} fetchedAt — ISO 시각 (apartments + list + prices 의 fetchedAt/dataUpdatedAt 박힘)
 */
function writeOutputs(apartments, fetchedAt) {
  const outDir = resolve(ROOT, "public/data");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  // list 1.66MB (가격배열 4개 제외) + prices 11.35MB (id + 4 배열) 분리 출력 + 원본 13MB 유지 (롤백 안전)
  const listData = apartments.map(({ priceByArea, rentByArea, jeonseByArea, priceByFloor, ...rest }) => rest);
  const pricesData = apartments.map(a => ({
    id: a.id,
    priceByArea: a.priceByArea ?? null,
    rentByArea: a.rentByArea ?? null,
    jeonseByArea: a.jeonseByArea ?? null,
    priceByFloor: a.priceByFloor ?? null,
  }));

  // 양쪽 키 동시 박힘 (세션 292) — staticDataApi.ts L48-50 fallback 의존 제거 + Supabase 분기 응답과 키 정합.
  const output = { ok: true, data: apartments, count: apartments.length, fetchedAt, dataUpdatedAt: fetchedAt };
  writeFileSync(resolve(outDir, "apartments.json"), JSON.stringify(output));
  writeFileSync(resolve(outDir, "apartments-list.json"), JSON.stringify({ ok: true, data: listData, count: listData.length, fetchedAt, dataUpdatedAt: fetchedAt }));
  writeFileSync(resolve(outDir, "apartments-prices.json"), JSON.stringify({ ok: true, data: pricesData, count: pricesData.length, fetchedAt, dataUpdatedAt: fetchedAt }));
  writeFileSync(resolve(outDir, "meta.json"), JSON.stringify(meta, null, 2));
}

// ============================================================
// Supabase-Only Mode
// ============================================================

/**
 * --from-supabase-only 모드 — apartments_flat VIEW 1회 SELECT 로 외부 API 호출 0회.
 * Phase 1~9 흐름 우회. 매일 cron 자동화 안전.
 * 호출 전 사전 상태: 환경변수 SUPABASE_URL + SUPABASE_ANON_KEY 박힘 필수.
 * meta 모듈 변수는 본 함수 안에서 fetchedAt/count/phases.supabaseOnly 박힘.
 * @returns {Promise<void>}
 */
export async function supabaseOnlyMode() {
  log("=== Supabase-Only 모드 (외부 API 호출 0회) ===");

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    logError("supabase-only", "SUPABASE_URL / SUPABASE_ANON_KEY 환경변수 필수");
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // apartments_flat VIEW — camelCase + psr/pir/dataReliability + naver 모두 박힘
  log("apartments_flat SELECT...");
  const apartments = await selectAll(
    (s) => s.from("apartments_flat").select("*"),
    supabase,
  );
  log(`  ${apartments.length}건 로드`);

  // 회귀 가드 — count 절대값
  const MIN_COUNT = 1000;
  if (apartments.length < MIN_COUNT) {
    logError("supabase-only", `count ${apartments.length} < ${MIN_COUNT} — 회귀 가드 발동`);
    process.exit(1);
  }

  // 전일 대비 -200 이상 감소 검출 (기존 apartments.json 박힘 시)
  const cachedPath = resolve(ROOT, "public/data/apartments.json");
  if (existsSync(cachedPath)) {
    try {
      const prev = JSON.parse(readFileSync(cachedPath, "utf8"));
      const prevCount = prev.count ?? 0;
      const diff = apartments.length - prevCount;
      if (diff <= -200) {
        logError("supabase-only", `count 전일 대비 ${diff} 감소 (이전 ${prevCount} → 신규 ${apartments.length}) — 회귀 가드 발동`);
        process.exit(1);
      }
      log(`  전일 대비 count 변동: ${diff >= 0 ? "+" : ""}${diff} (${prevCount} → ${apartments.length})`);
    } catch (err) {
      log(`  cached apartments.json 파싱 실패 (회귀 가드 비교 스킵): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // JSON 출력
  const fetchedAt = new Date().toISOString();
  meta.fetchedAt = fetchedAt;
  meta.count = apartments.length;
  meta.phases.supabaseOnly = { ok: true, count: apartments.length };

  writeOutputs(apartments, fetchedAt);
  log(`완료! ${apartments.length}건 출력`);
}

// ============================================================
// Main
// ============================================================
async function main() {
  if (process.argv.includes("--from-supabase-only")) {
    await supabaseOnlyMode();
    return;
  }

  const startTime = Date.now();
  log("데이터 수집 시작...");

  // Phase 1: 청약홈 (필수)
  let apartments;
  try {
    apartments = await phase1_applyhome();
  } catch (e) {
    logError("applyhome", e.message);
    const cachedPath = resolve(ROOT, "public/data/apartments.json");
    if (existsSync(cachedPath)) {
      try {
        log("Phase 1 실패 - 캐시된 데이터 사용");
        const cached = JSON.parse(readFileSync(cachedPath, "utf8"));
        apartments = cached.data || [];
      } catch (parseErr) {
        logError("cache-parse", parseErr.message);
        apartments = [];
      }
    } else {
      log("Phase 1 실패 - 캐시 없음, 빈 데이터로 진행");
      apartments = [];
    }
  }

  // Phase 2~7: 선택 (실패해도 계속)
  // 세션 89: naver-units 폐기 (네이버 IP 차단 → molit-units 교체). Phase 1.5 제거됨.
  apartments = await phase2_kosis(apartments);
  apartments = await phase3_kakao(apartments);
  apartments = await phase4_neis(apartments);
  apartments = await phase5_dart(apartments);
  apartments = await phase6_transport(apartments);
  apartments = await phase7_realtrade(apartments);

  // Phase 8: 파생 필드 계산
  log("Phase 8: 파생 필드 계산...");
  apartments = apartments.map(a => {
    // psr: 분양가 / 주변 중위가
    const psr = (a.price && a.nearbyMedian && a.nearbyMedian > 0)
      ? Math.round(a.price / a.nearbyMedian * 100) / 100 : null;

    // pir: avgIncome 없으면 추정소득으로 계산
    let pir = a.pir;
    if (pir == null && a.price) {
      const estIncome = 6000; // 한국 가구 평균소득 ~6000만원
      pir = Math.round(a.price / estIncome * 10) / 10;
    }

    // dataReliability: 핵심 필드 채움 비율
    const reliabilityFields = ["nearbyMedian", "jeonseRate", "subwayDist", "schoolScore",
      "hospital", "busRoutes", "builderDebtRatio", "recentTrades6m", "popGrowth"];
    const filledCount = reliabilityFields.filter(f => a[f] != null).length;
    const dataReliability = Math.round(filledCount / reliabilityFields.length * 100);

    return { ...a, psr, pir, dataReliability };
  });
  log("  파생 필드 계산 완료");

  // Phase 9: 네이버 교차검증
  apartments = await phase9_naver(apartments);

  // JSON 출력
  const fetchedAt = new Date().toISOString();
  meta.fetchedAt = fetchedAt;
  meta.count = apartments.length;

  // 내부 필드 제거
  apartments = apartments.map(({ _regionalUnsold, _avgIncome, _kosisEstimated, ...rest }) => rest);

  writeOutputs(apartments, fetchedAt);

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  log(`완료! ${apartments.length}건, ${elapsed}초 소요`);
  if (meta.errors.length > 0) {
    log(`경고: ${meta.errors.length}건 에러 발생 (데이터는 부분적으로 수집됨)`);
  }
}

const isCLI = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (isCLI) {
  main().catch(e => { console.error("수집 스크립트 치명적 오류:", e); process.exit(1); });
}

export { resolveBuilder, isValidGu, parseAddress, mapItem, getLawdCd, estimateCreditGrade };
export { AREA_CODE_REGION, BUILDER_ALIASES, VALID_REGIONS, GU_LAWD_MAP, REGION_LAWD_PREFIX };
