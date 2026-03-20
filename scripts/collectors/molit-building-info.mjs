/**
 * 국토부 공동주택 기본정보 → 건물 상세 (주차, 최고층, 에너지, 내진, 녹색건축) 수집기
 *
 * API: 국토교통부 공동주택 서비스
 *   - AptListService3 (#15057332): 시도별 단지 목록
 *   - AptBasisInfoServiceV4: 단지 기본 정보 (getAphusBassInfoV4)
 *   - AptBasisInfoServiceV4: 단지 상세 정보 (getAphusDtlInfoV4) — 주차, 에너지, 내진 등
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

const API_LIST_BASE = "https://apis.data.go.kr/1613000/AptListService3";
const API_DETAIL_BASE = "https://apis.data.go.kr/1613000/AptBasisInfoServiceV4";
const MIN_SIMILARITY = 0.5;
const REQUEST_DELAY = 400;

// 시도 약칭 → 시도 코드 (법정동 코드 앞 2자리)
const SIDO_CODE = {
  "서울": "11", "부산": "26", "대구": "27", "인천": "28",
  "광주": "29", "대전": "30", "울산": "31", "세종": "36",
  "경기": "41", "강원": "42", "충북": "43", "충남": "44",
  "전북": "45", "전남": "46", "경북": "47", "경남": "48", "제주": "50",
};

// ── API 호출 ────────────────────────────────────────────────
async function apiCall(baseUrl, endpoint, params) {
  const qs = new URLSearchParams({ serviceKey: API_KEY, type: "json", ...params });
  const url = `${baseUrl}/${endpoint}?${qs}`;
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

// ── 단지 목록 조회 (V3: AptListService3 — 페이지네이션) ──────
async function fetchAptList(sidoCode) {
  const allItems = [];
  let pageNo = 1;

  while (true) {
    const params = { numOfRows: "500", pageNo: String(pageNo), sidoCode };
    const json = await apiCall(API_LIST_BASE, "getSidoAptList3", params);
    const body = json?.response?.body;
    if (!body || body.totalCount === 0) break;

    // V3: body.items가 바로 배열 (V1에서는 body.items.item이었음)
    const rawItems = Array.isArray(body.items) ? body.items : body.items?.item;
    if (!rawItems) break;
    const page = Array.isArray(rawItems) ? rawItems : [rawItems];
    allItems.push(...page);

    const totalCount = parseInt(body.totalCount, 10) || 0;
    if (allItems.length >= totalCount || page.length < 500) break;

    pageNo++;
    await sleep(REQUEST_DELAY);
  }

  return allItems;
}

// ── 단지 기본+상세 조회 (V4: 두 엔드포인트 병합) ─────────────
async function fetchAptDetail(kaptCode) {
  // 기본 정보 (세대수, 최고층 등)
  const bassJson = await apiCall(API_DETAIL_BASE, "getAphusBassInfoV4", { kaptCode });
  const bass = bassJson?.response?.body?.item ?? null;

  await sleep(REQUEST_DELAY);

  // 상세 정보 (주차, 에너지, 구조 등)
  const dtlJson = await apiCall(API_DETAIL_BASE, "getAphusDtlInfoV4", { kaptCode });
  const dtl = dtlJson?.response?.body?.item ?? null;

  if (!bass && !dtl) return null;
  return { ...bass, ...dtl }; // 두 응답 병합
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

// ── 상세 필드 추출 (V4 응답 기준) ────────────────────────────
function extractBuildingInfo(detail) {
  const safeInt = (v) => { const n = parseInt(v, 10); return isNaN(n) ? null : n; };

  // 주차: V4에서 kaptdPcnt(지상) + kaptdPcntu(지하) 합산
  const groundParking = safeInt(detail.kaptdPcnt) || 0;
  const underParking = safeInt(detail.kaptdPcntu) || 0;
  const totalParking = groundParking + underParking;
  const totalHouseholds = safeInt(detail.kaptdaCnt);
  const parkingRatio = (totalParking > 0 && totalHouseholds && totalHouseholds > 0)
    ? Math.round((totalParking / totalHouseholds) * 100) / 100
    : null;

  // 에너지 효율 등급: V4에서 kaptdEcnt(Dtl) 또는 kaptdEcntp(Bass)
  const energyStr = detail.kaptdEcnt ?? detail.kaptdEcntp ?? null;
  let energyGrade = null;
  if (energyStr != null) {
    const n = safeInt(energyStr);
    if (n && n >= 1 && n <= 7) energyGrade = n;
  }

  // 최고층: V4에서 ktownFlrNo가 실제 최고층 (kaptTopFloor는 지상 시작층)
  const highFloor = safeInt(detail.ktownFlrNo) || safeInt(detail.kaptTopFloor) || safeInt(detail.hoCnt);

  // 내진설계: V4 Dtl에서 필드 사라짐 — null 유지 (기존 데이터 보존)
  const quakeDesign = null;

  // 녹색건축: V4 Dtl에서 필드 사라짐 — null 유지 (기존 데이터 보존)
  const green_bldg = null;

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
    const sidoCode = SIDO_CODE[region];
    if (!sidoCode) { log(PHASE, `  ${region}: 시도코드 매핑 없음, 건너뜀`); skipped += regionTargets.length; continue; }

    log(PHASE, `\n${region} (${sidoCode}): ${regionTargets.length}건`);

    let aptList;
    try {
      aptList = await fetchAptList(sidoCode);
      await sleep(REQUEST_DELAY);
    } catch (err) {
      logError(PHASE, `  목록 조회 실패: ${err.message}`);
      failed += regionTargets.length;
      continue;
    }

    if (!aptList.length) {
      log(PHASE, `  API 목록 0건`);
      skipped += regionTargets.length;
      continue;
    }

    log(PHASE, `  API 목록: ${aptList.length}건`);

    for (const target of regionTargets) {
      const match = findBestMatch(target.name, target.gu, aptList);
      if (!match) {
        skipped++;
        continue;
      }

      const kaptCode = match.kaptCode;
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

  log(PHASE, `\n=== 완료 ===`);

  log(PHASE, `갱신: ${updated}, 건너뜀: ${skipped}, 실패: ${failed}`);
}

main().catch(err => { logError(PHASE, err.message); process.exit(1); });
