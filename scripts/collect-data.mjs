/**
 * 데이터 수집 스크립트 - 빌드 타임에 모든 API 데이터를 수집하여 정적 JSON 생성
 * 실행: node scripts/collect-data.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// .env 파일 수동 파싱 (Vercel에서는 process.env 자동 주입)
try {
  const envPath = resolve(ROOT, ".env");
  if (existsSync(envPath)) {
    const envContent = readFileSync(envPath, "utf8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (key && !process.env[key]) process.env[key] = val;
    }
  }
} catch { /* ignore */ }

const APPLYHOME_KEY = process.env.APPLYHOME_KEY;
const KAKAO_KEY = process.env.KAKAO_KEY;
const KOSIS_KEY = process.env.KOSIS_KEY;
const NEIS_KEY = process.env.NEIS_KEY;
const DART_KEY = process.env.DART_KEY;
const DATA_GO_KEY = process.env.DATA_GO_KEY;

const meta = { fetchedAt: null, count: 0, phases: {}, errors: [] };

function log(msg) { console.log(`[collect] ${msg}`); }
function logError(phase, msg) { console.error(`[collect:${phase}] ERROR: ${msg}`); meta.errors.push({ phase, msg }); }

// ============================================================
// brands.js 로직 인라인
// ============================================================
const BUILDER_ALIASES = {
  "지에스건설": "GS건설", "GS건설(주)": "GS건설", "(주)GS건설": "GS건설",
  "현대건설(주)": "현대건설", "(주)현대건설": "현대건설",
  "(주)대우건설": "대우건설", "대우건설(주)": "대우건설",
  "에이치디씨현대산업개발": "HDC현대산업개발", "HDC현대산업개발(주)": "HDC현대산업개발",
  "디엘이앤씨": "DL이앤씨", "DL이앤씨(주)": "DL이앤씨",
  "포스코이앤씨(주)": "포스코이앤씨", "(주)포스코이앤씨": "포스코이앤씨",
  "삼성물산(주)": "삼성물산", "삼성물산건설부문": "삼성물산",
  "롯데건설(주)": "롯데건설", "(주)롯데건설": "롯데건설",
  "대림산업(주)": "대림산업", "(주)대림산업": "대림산업",
  "한화건설(주)": "한화건설", "(주)한화건설": "한화건설",
  "호반건설(주)": "호반건설", "(주)호반건설": "호반건설",
  "SK에코플랜트(주)": "SK에코플랜트",
  "태영건설(주)": "태영건설", "(주)태영건설": "태영건설",
  "금호건설(주)": "금호건설", "(주)금호건설": "금호건설",
};
function resolveBuilder(name) {
  if (!name) return "기타";
  return BUILDER_ALIASES[name.trim()] ?? name.trim();
}

// ============================================================
// Phase 1: 청약홈 (목록 + 주택형별 + 지오코딩)
// ============================================================
const REGION_MAP = {
  "서울특별시": "서울", "부산광역시": "부산", "대구광역시": "대구",
  "인천광역시": "인천", "광주광역시": "광주", "대전광역시": "대전",
  "울산광역시": "울산", "세종특별자치시": "세종",
  "경기도": "경기", "강원특별자치도": "강원", "강원도": "강원",
  "충청북도": "충북", "충청남도": "충남",
  "전북특별자치도": "전북", "전라북도": "전북", "전라남도": "전남",
  "경상북도": "경북", "경상남도": "경남", "제주특별자치도": "제주",
};
const AREA_CODE_REGION = {
  "100": "서울", "200": "부산", "210": "대구", "300": "대전",
  "400": "인천", "410": "경기", "500": "광주", "600": "울산",
  "680": "울산", "690": "세종",
  "700": "강원", "800": "충북", "810": "충남",
  "820": "전북", "830": "전남", "840": "경북", "850": "경남", "900": "제주",
};
const VALID_REGIONS = ["서울","부산","대구","인천","광주","대전","울산","세종","경기","강원","충북","충남","전북","전남","경북","경남","제주"];

const APPLYHOME_BASE = "https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1";

function parseAddress(addr) {
  if (!addr) return { region: null, gu: null, dong: null };
  const parts = addr.trim().split(/\s+/);
  const regionFull = parts[0] || "";
  const region = REGION_MAP[regionFull] ?? regionFull.replace(/특별시|광역시|특별자치시|특별자치도|도$/, "");
  return { region, gu: parts[1] || null, dong: parts[2] || null };
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
  const unsold = isRemndr ? units : (parseInt(item.REMNDR_HSHLDCO || 0, 10) || 0);
  return {
    id: `ah-${item.HOUSE_MANAGE_NO || String(idx)}`,
    name, dong, gu, region,
    lat: null, lng: null,
    area: 84, price: null, pp: null,
    units, unsold,
    unsoldRate: units > 0 ? Math.round(unsold / units * 1000) / 10 : null,
    builder: resolveBuilder(item.CNSTRCT_ENTRPS_NM || item.BSNS_MBY_NM || null),
    completion: item.MVN_PREARNGE_YM || null,
    _sourceAddr: addr,
  };
}

async function phase1_applyhome() {
  if (!APPLYHOME_KEY) throw new Error("APPLYHOME_KEY not configured");

  log("Phase 1: 청약홈 목록 조회...");
  const endpoints = [
    `${APPLYHOME_BASE}/getRemndrLttotPblancDetail`,
    `${APPLYHOME_BASE}/getAPTLttotPblancDetail`,
  ];

  let items = [];
  let usedEndpoint = null;
  for (const ep of endpoints) {
    try {
      // 첫 페이지로 전체 건수 확인
      const firstUrl = `${ep}?page=1&perPage=1000&returnType=JSON&serviceKey=${encodeURIComponent(APPLYHOME_KEY)}`;
      const firstRes = await fetch(firstUrl);
      if (!firstRes.ok) continue;
      const firstJson = await firstRes.json();
      if (!firstJson.data?.length) continue;
      items = firstJson.data;
      usedEndpoint = ep;
      const totalCount = firstJson.matchCount || firstJson.totalCount || 0;
      // 추가 페이지 fetch
      if (totalCount > 1000) {
        const totalPages = Math.ceil(totalCount / 1000);
        for (let page = 2; page <= totalPages; page++) {
          try {
            const url = `${ep}?page=${page}&perPage=1000&returnType=JSON&serviceKey=${encodeURIComponent(APPLYHOME_KEY)}`;
            const res = await fetch(url);
            if (!res.ok) break;
            const json = await res.json();
            if (!json.data?.length) break;
            items = items.concat(json.data);
          } catch { break; }
        }
      }
      log(`  총 ${totalCount}건 중 ${items.length}건 수신`);
      break;
    } catch { continue; }
  }
  if (!items.length) throw new Error("청약홈 API에서 데이터를 가져올 수 없습니다");

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
      return { ...a, area, price, pp: price && area ? Math.round(price / area * 3.3058) : null };
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
const KOSIS_REGION_MAP = {
  "서울특별시": "서울", "부산광역시": "부산", "대구광역시": "대구",
  "인천광역시": "인천", "광주광역시": "광주", "대전광역시": "대전",
  "울산광역시": "울산", "세종특별자치시": "세종",
  "경기도": "경기", "강원도": "강원", "강원특별자치도": "강원",
  "충청북도": "충북", "충청남도": "충남",
  "전라북도": "전북", "전북특별자치도": "전북", "전라남도": "전남",
  "경상북도": "경북", "경상남도": "경남",
  "제주도": "제주", "제주특별자치도": "제주",
};

async function phase2_kosis(apartments) {
  if (!KOSIS_KEY) { log("Phase 2: KOSIS_KEY 없음, 건너뜀"); meta.phases.kosis = { ok: false, reason: "no key" }; return apartments; }
  log("Phase 2: KOSIS 통계 조회...");
  try {
    const latestYear = String(new Date().getFullYear() - 1);
    const startYear = String(Number(latestYear) - 1);
    const params = new URLSearchParams({
      method: "getList", apiKey: KOSIS_KEY, itmId: "ALL", format: "json", jsonVD: "Y",
      prdSe: "A", startPrdDe: startYear, endPrdDe: latestYear, orgId: "116", tblId: "DT_MLTM_2086",
      objL1: "ALL", objL2: "ALL",
    });
    const res = await fetch(`https://kosis.kr/openapi/Param/statisticsParameterData.do?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.err) throw new Error(data.errMsg || data.err);
    const rows = Array.isArray(data) ? data : [];

    const unsoldMap = {};
    const latest = {};
    for (const row of rows) {
      if (row.C1_NM !== "시도별미분양현황") continue;
      const region = KOSIS_REGION_MAP[row.C2_NM];
      if (!region) continue;
      const period = row.PRD_DE;
      const value = parseFloat(row.DT);
      if (isNaN(value)) continue;
      if (!latest[region] || period > latest[region]) {
        latest[region] = period;
        unsoldMap[region] = value;
      }
    }

    // 인구증감률 조회 (인구동향 DT_1B8000G 월간 - 자연증가율 천명당)
    const popGrowthMap = {};
    try {
      const now = new Date();
      const endMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
      const startMonth = `${now.getFullYear() - 1}01`;
      const popParams = new URLSearchParams({
        method: "getList", apiKey: KOSIS_KEY, itmId: "ALL", format: "json", jsonVD: "Y",
        prdSe: "M", startPrdDe: startMonth, endPrdDe: endMonth,
        orgId: "101", tblId: "DT_1B8000G",
        objL1: "ALL", objL2: "ALL",
      });
      const popRes = await fetch(`https://kosis.kr/openapi/Param/statisticsParameterData.do?${popParams}`);
      if (popRes.ok) {
        const popData = await popRes.json();
        const popRows = Array.isArray(popData) ? popData : [];
        // 자연증가율(천명당) 직접 사용 - 최신 연도 평균
        const rateByRegion = {};
        for (const row of popRows) {
          if (row.C2_NM !== "자연증가율(천명당)") continue;
          if (row.C1_NM === "전국") continue;
          const region = KOSIS_REGION_MAP[row.C1_NM];
          if (!region) continue;
          const val = parseFloat(row.DT);
          if (isNaN(val)) continue;
          if (!rateByRegion[region]) rateByRegion[region] = [];
          rateByRegion[region].push(val);
        }
        for (const [region, vals] of Object.entries(rateByRegion)) {
          // 월별 자연증가율 평균 → popGrowth (‰ → % 변환: /10)
          const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
          popGrowthMap[region] = Math.round(avg * 10) / 10; // 천명당 → 그대로 사용 (scoring에서 ‰ 기준)
        }
        log(`  인구증감: ${Object.keys(popGrowthMap).length}개 지역`);
      }
    } catch (e) { logError("kosis-pop", e.message); }

    // 평균소득 - KOSIS에서 적절한 테이블을 찾지 못함, 향후 추가
    const incomeMap = {};
    log(`  평균소득: KOSIS 테이블 미확인, 건너뜀`);

    apartments = apartments.map(a => ({
      ...a,
      _regionalUnsold: unsoldMap[a.region] ?? null,
      popGrowth: popGrowthMap[a.region] ?? null,
      _avgIncome: incomeMap[a.region] ?? null,
    }));
    log(`  KOSIS 지역 매핑: ${Object.keys(unsoldMap).length}개 지역`);
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
    const results = await Promise.allSettled([
      ...CATS.map(code => fetch(`${base}/search/category.json?category_group_code=${code}&x=${apt.lng}&y=${apt.lat}&radius=1000&size=1`, { headers: h }).then(r => r.ok ? r.json() : { meta: { total_count: 0 } }).then(d => d.meta?.total_count ?? 0)),
      fetch(`${base}/search/keyword.json?query=${encodeURIComponent("공원")}&x=${apt.lng}&y=${apt.lat}&radius=1000&size=1`, { headers: h }).then(r => r.ok ? r.json() : { meta: { total_count: 0 } }).then(d => d.meta?.total_count ?? 0),
      fetch(`${base}/search/category.json?category_group_code=SW8&x=${apt.lng}&y=${apt.lat}&radius=5000&sort=distance&size=1`, { headers: h }).then(r => r.ok ? r.json() : { documents: [] }).then(d => d.documents?.length ? Math.round(parseFloat(d.documents[0].distance)) : 9999),
    ]);
    const infra = {};
    CAT_NAMES.forEach((name, i) => { infra[name] = results[i].status === "fulfilled" ? results[i].value : 0; });
    infra.park = results[7].status === "fulfilled" ? results[7].value : 0;
    infra.subwayDist = results[8].status === "fulfilled" ? results[8].value : 9999;
    return infra;
  }

  let enriched = 0;
  // 배치: 5개씩 (카카오 초당 제한 방지)
  for (let i = 0; i < withCoords.length; i += 5) {
    const batch = withCoords.slice(i, i + 5);
    const results = await Promise.allSettled(batch.map(a => fetchInfra(a)));
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
          schools.push({ name: s.SCHUL_NM, type: s.SCHUL_KND_SC_NM, address: s.ORG_RDNMA || "" });
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
                .then(d => ({ count: d.meta?.total_count ?? 0, nearest: d.documents?.[0] ? Math.round(parseFloat(d.documents[0].distance)) : null }))
                .catch(() => ({ count: 0, nearest: null }))
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
          return { id: apt.id, schoolScore: score, schoolGrade: score >= 85 ? "최우수" : score >= 70 ? "우수" : score >= 50 ? "보통" : "미흡" };
        }));
        for (const r of results) {
          if (r.status === "fulfilled") {
            const idx = apartments.findIndex(a => a.id === r.value.id);
            if (idx >= 0) { apartments[idx] = { ...apartments[idx], schoolScore: r.value.schoolScore, schoolGrade: r.value.schoolGrade }; enriched++; }
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
    meta.phases.neis = { ok: true, enriched };
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

// 시도 → 법정동코드 앞 2자리 매핑
const REGION_LAWD_PREFIX = {
  "서울": "11", "부산": "26", "대구": "27", "인천": "28",
  "광주": "29", "대전": "30", "울산": "31", "세종": "36",
  "경기": "41", "강원": "42", "충북": "43", "충남": "44",
  "전북": "45", "전남": "46", "경북": "47", "경남": "48", "제주": "50",
};

// 구/군 → 법정동코드 5자리 매핑 (주요 지역)
const GU_LAWD_MAP = {
  // 서울
  "종로구": "11110", "중구": "11140", "용산구": "11170", "성동구": "11200", "광진구": "11215",
  "동대문구": "11230", "중랑구": "11260", "성북구": "11290", "강북구": "11305", "도봉구": "11320",
  "노원구": "11350", "은평구": "11380", "서대문구": "11410", "마포구": "11440", "양천구": "11470",
  "강서구": "11500", "구로구": "11530", "금천구": "11545", "영등포구": "11560", "동작구": "11590",
  "관악구": "11620", "서초구": "11650", "강남구": "11680", "송파구": "11710", "강동구": "11740",
  // 부산
  "중구": "26110", "서구": "26140", "동구": "26170", "영도구": "26200", "부산진구": "26230",
  "동래구": "26260", "남구": "26290", "북구": "26320", "해운대구": "26350", "사하구": "26380",
  "금정구": "26410", "강서구": "26440", "연제구": "26470", "수영구": "26500", "사상구": "26530",
  "기장군": "26710",
  // 인천
  "중구": "28110", "동구": "28120", "미추홀구": "28177", "연수구": "28185", "남동구": "28200",
  "부평구": "28237", "계양구": "28245", "서구": "28260", "강화군": "28710", "옹진군": "28720",
  // 경기 주요
  "수원시": "41110", "성남시": "41130", "의정부시": "41150", "안양시": "41170", "부천시": "41190",
  "광명시": "41210", "평택시": "41220", "동두천시": "41250", "안산시": "41270", "고양시": "41280",
  "과천시": "41290", "구리시": "41310", "남양주시": "41360", "오산시": "41370", "시흥시": "41390",
  "군포시": "41410", "의왕시": "41430", "하남시": "41450", "용인시": "41460", "파주시": "41480",
  "이천시": "41500", "안성시": "41550", "김포시": "41570", "화성시": "41590", "광주시": "41610",
  "양주시": "41630", "포천시": "41650", "여주시": "41670",
  // 대구
  "중구": "27110", "동구": "27140", "서구": "27170", "남구": "27200", "북구": "27230",
  "수성구": "27260", "달서구": "27290", "달성군": "27710",
  // 대전
  "동구": "30110", "중구": "30140", "서구": "30170", "유성구": "30200", "대덕구": "30230",
  // 광주
  "동구": "29110", "서구": "29140", "남구": "29155", "북구": "29170", "광산구": "29200",
  // 울산
  "중구": "31110", "남구": "31140", "동구": "31170", "북구": "31200", "울주군": "31710",
  // 세종
  "세종시": "36110",
};

async function phase7_realtrade(apartments) {
  if (!DATA_GO_KEY) { log("Phase 7: DATA_GO_KEY 없음, 건너뜀"); meta.phases.realtrade = { ok: false, reason: "no key" }; return apartments; }
  log("Phase 7: 실거래가 조회...");

  // 아파트들의 고유 (region, gu) 조합 추출
  const regionGuPairs = [...new Set(apartments.map(a => `${a.region}|${a.gu}`))].map(s => {
    const [region, gu] = s.split("|");
    return { region, gu };
  }).filter(rg => rg.region && rg.gu);

  // 법정동코드 매핑
  function getLawdCd(region, gu) {
    // 구/군 이름으로 직접 매핑 시도
    if (GU_LAWD_MAP[gu]) return GU_LAWD_MAP[gu];
    // 시 이름 시도 (경기도 등)
    const shortGu = gu.replace(/시$|군$|구$/, "");
    for (const [name, code] of Object.entries(GU_LAWD_MAP)) {
      if (name.includes(shortGu)) return code;
    }
    // 시도 코드 + 000 (시도 전체)
    const prefix = REGION_LAWD_PREFIX[region];
    return prefix ? prefix + "000" : null;
  }

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
          if (price > 0 && area > 0) tradeData[key].trades.push({ price, area });
        }
        apiCalls++;
      } catch { /* continue */ }
    }

    // 전월세 - Dev API 시도 (403이면 스킵)
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

    enriched++;
    return {
      ...a,
      nearbyMedian: nearbyMedian ?? null,
      recentTrades6m: recentTrades6m ?? null,
      jeonseRate: jeonseRate ?? null,
      pir: pir ?? null,
    };
  });

  log(`  실거래 보강: ${enriched}건`);
  meta.phases.realtrade = { ok: true, enriched, apiCalls };
  return apartments;
}

// ============================================================
// Main
// ============================================================
async function main() {
  const startTime = Date.now();
  log("데이터 수집 시작...");

  // Phase 1: 청약홈 (필수)
  let apartments;
  try {
    apartments = await phase1_applyhome();
  } catch (e) {
    logError("applyhome", e.message);
    console.error("Phase 1 실패 - 빌드 중단");
    process.exit(1);
  }

  // Phase 2~7: 선택 (실패해도 계속)
  apartments = await phase2_kosis(apartments);
  apartments = await phase3_kakao(apartments);
  apartments = await phase4_neis(apartments);
  apartments = await phase5_dart(apartments);
  apartments = await phase6_transport(apartments);
  apartments = await phase7_realtrade(apartments);

  // JSON 출력
  const outDir = resolve(ROOT, "public/data");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const fetchedAt = new Date().toISOString();
  meta.fetchedAt = fetchedAt;
  meta.count = apartments.length;

  // 내부 필드 제거
  apartments = apartments.map(({ _regionalUnsold, _avgIncome, ...rest }) => rest);

  const output = { ok: true, data: apartments, count: apartments.length, fetchedAt };
  writeFileSync(resolve(outDir, "apartments.json"), JSON.stringify(output));
  writeFileSync(resolve(outDir, "meta.json"), JSON.stringify(meta, null, 2));

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  log(`완료! ${apartments.length}건, ${elapsed}초 소요`);
  if (meta.errors.length > 0) {
    log(`경고: ${meta.errors.length}건 에러 발생 (데이터는 부분적으로 수집됨)`);
  }
}

main().catch(e => { console.error("수집 스크립트 치명적 오류:", e); process.exit(1); });
