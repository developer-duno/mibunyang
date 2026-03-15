/**
 * 국토부 공동주택 기본정보 → 건물 상세 (주차, 최고층, 에너지, 내진, 녹색건축) 수집기
 *
 * API: 국토교통부_공동주택 단지 목록제공 서비스 (data.go.kr #15058453)
 *   - getLnmBasicList: 시도/시군구별 단지 목록
 *   - getAphusBassInfo: 단지 상세 (건축면적, 세대수, 주차, 에너지 등)
 *
 * 사용법:
 *   node scripts/collectors/molit-building-info.mjs              (Supabase UPDATE)
 *   node scripts/collectors/molit-building-info.mjs --dry-run    (미리보기만)
 *   node scripts/collectors/molit-building-info.mjs --force      (이미 데이터 있는 것도 재수집)
 *
 * 필요 환경변수:
 *   MOLIT_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
 */
import { loadEnv, getSupabase, log, logError, stringSimilarity, sleep } from "./_shared.mjs";

loadEnv();

const PHASE = "molit-building";
const API_KEY = process.env.MOLIT_KEY;
if (!API_KEY) {
  logError(PHASE, "MOLIT_KEY 환경변수 필요 (data.go.kr 인증키)");
  process.exit(1);
}

const API_BASE = "https://apis.data.go.kr/1613000/AptBasisInfoService1";
const MIN_SIMILARITY = 0.5;
const REQUEST_DELAY = 400;

const REGION_FULL = {
  "서울": "서울특별시", "부산": "부산광역시", "대구": "대구광역시",
  "인천": "인천광역시", "광주": "광주광역시", "대전": "대전광역시",
  "울산": "울산광역시", "세종": "세종특별자치시",
  "경기": "경기도", "강원": "강원특별자치도",
  "충북": "충청북도", "충남": "충청남도",
  "전북": "전북특별자치도", "전남": "전라남도",
  "경북": "경상북도", "경남": "경상남도", "제주": "제주특별자치도",
};

// ── API 호출 ────────────────────────────────────────────────
async function apiCall(endpoint, params) {
  const qs = new URLSearchParams({ serviceKey: API_KEY, type: "json", ...params });
  const url = `${API_BASE}/${endpoint}?${qs}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (res.status === 429) { await sleep((attempt + 1) * 2000); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (text.startsWith("<?xml") || text.startsWith("<")) {
        if (text.includes("SERVICE_KEY_IS_NOT_REGISTERED"))
          throw new Error("API 키 미등록 — data.go.kr에서 서비스 신청 필요");
        throw new Error(`XML 응답: ${text.slice(0, 200)}`);
      }
      return JSON.parse(text);
    } catch (err) {
      if (attempt === 2) throw err;
      await sleep((attempt + 1) * 1000);
    }
  }
}

// ── 단지 목록 조회 ──────────────────────────────────────────
async function fetchAptList(siDo, siGunGu) {
  const params = { numOfRows: "500", pageNo: "1", siDo };
  if (siGunGu) params.siGunGu = siGunGu;
  const json = await apiCall("getLnmBasicList", params);
  const body = json?.response?.body;
  if (!body || body.totalCount === 0) return [];
  const items = body.items?.item;
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

// ── 단지 상세 조회 ──────────────────────────────────────────
async function fetchAptDetail(kaptCode) {
  const json = await apiCall("getAphusBassInfo", { kaptCode });
  const body = json?.response?.body;
  return body?.item ?? body?.items?.item ?? null;
}

// ── 이름 매칭 ───────────────────────────────────────────────
function cleanName(name) {
  return (name || "").replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
}

function findBestMatch(targetName, targetGu, aptList) {
  const cleaned = cleanName(targetName);
  let best = null;
  let bestScore = 0;
  for (const apt of aptList) {
    const kaptName = apt.kaptName || apt.as3 || "";
    let score = stringSimilarity(cleaned, cleanName(kaptName));
    if (targetGu && kaptName.includes(targetGu)) score += 0.1;
    if (score > bestScore && score >= MIN_SIMILARITY) {
      bestScore = score;
      best = apt;
    }
  }
  return best;
}

// ── 상세 필드 추출 ──────────────────────────────────────────
function extractBuildingInfo(detail) {
  const safeInt = (v) => { const n = parseInt(v, 10); return isNaN(n) ? null : n; };
  const safeFloat = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };

  // 주차대수 / 세대수 = 주차비율
  const totalParking = safeInt(detail.kaptdPcnt);
  const totalHouseholds = safeInt(detail.kaptdaCnt);
  const parkingRatio = (totalParking && totalHouseholds && totalHouseholds > 0)
    ? Math.round((totalParking / totalHouseholds) * 100) / 100
    : null;

  // 용적률 = 연면적 / 대지면적 * 100
  const totalArea = safeFloat(detail.kaptTarea); // 연면적 (㎡)
  const siteArea = safeFloat(detail.kaptDongCnt); // 건폐율로 대신 사용 가능
  // API에서 용적률을 직접 제공하지 않으므로, kaptMpArea 기반 계산은 불안정
  // 대신 naver_complexes에서 가져온 것을 우선 사용하고, 여기선 최고층/주차/에너지만 수집

  // 에너지 효율 등급
  const energyStr = detail.kaptdEcnt ?? detail.codeEcas ?? null;
  let energyGrade = null;
  if (energyStr != null) {
    const n = safeInt(energyStr);
    if (n && n >= 1 && n <= 7) energyGrade = n;
  }

  // 내진설계 여부
  const quakeStr = detail.kaptdEtrm ?? null;
  let quakeDesign = null;
  if (quakeStr != null) {
    quakeDesign = quakeStr === "Y" || quakeStr === "1" || quakeStr.includes("적용");
  }

  // 최고층
  const highFloor = safeInt(detail.kaptTopFloor) || safeInt(detail.hoCnt);

  // 녹색건축 인증등급
  const greenStr = detail.kaptdGreenGrade ?? detail.kaptGreenGrade ?? null;
  let green_bldg = null;
  if (greenStr != null) {
    const s = String(greenStr);
    if (s.includes("최우수") || s === "1") green_bldg = "최우수";
    else if (s.includes("우수") || s === "2") green_bldg = "우수";
  }

  return {
    parking_ratio: parkingRatio,
    max_floor: highFloor,
    energy_grade: energyGrade,
    quake_design: quakeDesign,
    green_bldg,
  };
}

// ── DB 업데이트 ─────────────────────────────────────────────
async function updateBuilding(sb, aptId, info, dryRun) {
  // null 필드는 업데이트에서 제외 (기존 데이터 보존)
  const row = {};
  if (info.parking_ratio != null) row.parking_ratio = info.parking_ratio;
  if (info.max_floor != null) row.max_floor = info.max_floor;
  if (info.energy_grade != null) row.energy_grade = info.energy_grade;
  if (info.quake_design != null) row.quake_design = info.quake_design;
  if (info.green_bldg != null) row.green_bldg = info.green_bldg;

  if (Object.keys(row).length === 0) return false;

  row.updated_at = new Date().toISOString();

  if (dryRun) {
    log(PHASE, `  [DRY-RUN] ${aptId}: ${JSON.stringify(row)}`);
    return true;
  }

  const { error } = await sb.from("apartments").update(row).eq("id", aptId);
  if (error) {
    logError(PHASE, `  ${aptId} UPDATE 실패: ${error.message}`);
    return false;
  }
  return true;
}

// ── 메인 ─────────────────────────────────────────────────────
async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const force = process.argv.includes("--force");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  const sb = getSupabase();

  // 1. 대상 아파트 조회 (건물 상세 미수집)
  let query = sb.from("apartments")
    .select("id, name, region, gu, address, parking_ratio, max_floor, energy_grade, quake_design");

  if (!force) {
    // 4개 상품성 필드 중 하나라도 null이면 재수집 대상
    query = query.or("energy_grade.is.null,parking_ratio.is.null,max_floor.is.null,quake_design.is.null");
  }

  const { data: targets, error } = await query;
  if (error) throw new Error(`apartments 조회 실패: ${error.message}`);
  log(PHASE, `대상: ${targets.length}건 ${force ? "(전체 재수집)" : "(상품성 필드 null 포함)"}`);

  if (!targets.length) { log(PHASE, "대상 없음, 종료"); return; }

  // 2. 지역별 그룹핑
  const regionGroups = {};
  for (const t of targets) {
    const r = t.region || "기타";
    if (!regionGroups[r]) regionGroups[r] = [];
    regionGroups[r].push(t);
  }

  let updated = 0, skipped = 0, failed = 0;

  // 3. 지역별 API 호출 → 매칭 → 상세 조회
  for (const [region, regionTargets] of Object.entries(regionGroups)) {
    const siDo = REGION_FULL[region];
    if (!siDo) { log(PHASE, `  ${region}: 매핑 없음, 건너뜀`); skipped += regionTargets.length; continue; }

    // 구별 그룹핑
    const guGroups = {};
    for (const t of regionTargets) {
      const g = t.gu || "_전체";
      if (!guGroups[g]) guGroups[g] = [];
      guGroups[g].push(t);
    }

    for (const [gu, guTargets] of Object.entries(guGroups)) {
      log(PHASE, `\n${region} ${gu}: ${guTargets.length}건`);

      let aptList;
      try {
        aptList = await fetchAptList(siDo, gu === "_전체" ? null : gu);
        await sleep(REQUEST_DELAY);
      } catch (err) {
        logError(PHASE, `  목록 조회 실패: ${err.message}`);
        failed += guTargets.length;
        continue;
      }

      if (!aptList.length) {
        log(PHASE, `  API 목록 0건`);
        skipped += guTargets.length;
        continue;
      }

      log(PHASE, `  API 목록: ${aptList.length}건`);

      for (const target of guTargets) {
        const match = findBestMatch(target.name, target.gu, aptList);
        if (!match) {
          skipped++;
          continue;
        }

        const kaptCode = match.kaptCode || match.as1;
        if (!kaptCode) { skipped++; continue; }

        try {
          await sleep(REQUEST_DELAY);
          const detail = await fetchAptDetail(kaptCode);
          if (!detail) { log(PHASE, `    ${target.name}: 상세 조회 실패`); failed++; continue; }

          const info = extractBuildingInfo(detail);
          log(PHASE, `    ${target.name}: parking=${info.parking_ratio}, floor=${info.max_floor}, energy=${info.energy_grade}, quake=${info.quake_design}`);

          const ok = await updateBuilding(sb, target.id, info, dryRun);
          if (ok) updated++;
          else skipped++;
        } catch (err) {
          logError(PHASE, `    ${target.name}: ${err.message}`);
          failed++;
        }
      }
    }
  }

  log(PHASE, `\n=== 완료 ===`);
  log(PHASE, `갱신: ${updated}, 건너뜀: ${skipped}, 실패: ${failed}`);
}

main().catch(err => { logError(PHASE, err.message); process.exit(1); });
