/**
 * 학군 정보 수집기 — Kakao Places + NEIS 교육정보 기반
 *
 * 초·중·고 검색 → NEIS 상세 보강 → 학군 점수 계산 → schools 테이블 업데이트
 *
 * 사용법:
 *   node scripts/collectors/schools-neis.mjs              (Supabase UPDATE)
 *   node scripts/collectors/schools-neis.mjs --dry-run    (미리보기만)
 *   node scripts/collectors/schools-neis.mjs --limit 100  (처리 건수 제한)
 */
import { loadEnv, getSupabase, log, logError, fetchWithRetry, sleep } from "./_shared.mjs";

loadEnv();

const PHASE = "schools";
const KAKAO_KEY = process.env.KAKAO_KEY;
if (!KAKAO_KEY) { logError(PHASE, "KAKAO_KEY 환경변수 필요"); process.exit(1); }

/** NEIS API 키 — 없으면 NEIS 보강 스킵 (기존 거리 기반만 유지) */
const NEIS_KEY = process.env.NEIS_KEY;
const NEIS_BASE = "https://open.neis.go.kr/hub";

const EXCLUDE_POI = ["행정실", "교장실", "교무실", "상담실", "교차로", "체육관", "기숙사", "테니스장", "공영주차장", "백주년기념관", "로봇관", "정약용체육관"];
export const isSchoolPlace = (name) => !EXCLUDE_POI.some(suf => name.includes(suf));

// ── Kakao Places API ────────────────────────────────────────────
async function searchKakao(lat, lng, keyword, radius) {
  const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(keyword)}&x=${lng}&y=${lat}&radius=${radius}&sort=distance&size=15`;
  const res = await fetchWithRetry(url, { headers: { Authorization: `KakaoAK ${KAKAO_KEY}` } });
  const data = await res.json();
  return data.documents || [];
}

// ── NEIS 교육정보 API ───────────────────────────────────────────
/** 전역 NEIS 캐시 — 정규화된 학교명 → NEIS 데이터 (중복 호출 방지) */
const neisCache = new Map();
let neisApiCalls = 0;

/** 학교명 정규화 — 매칭용 (공백·괄호 제거) */
export function normalizeSchoolName(name) {
  return name.replace(/\s+/g, "").replace(/[()]/g, "");
}

/** NEIS 학교기본정보 조회 — schoolType, founded, highSchoolType 반환 */
export async function fetchNeisSchoolInfo(schoolName) {
  if (!NEIS_KEY) return null;

  const cacheKey = normalizeSchoolName(schoolName);
  if (neisCache.has(cacheKey)) return neisCache.get(cacheKey);

  const url = `${NEIS_BASE}/schoolInfo?KEY=${NEIS_KEY}&Type=json&pIndex=1&pSize=5&SCHUL_NM=${encodeURIComponent(schoolName)}`;

  try {
    const res = await fetchWithRetry(url);
    const data = await res.json();
    neisApiCalls++;

    const rows = data?.schoolInfo?.[1]?.row;
    if (!rows || rows.length === 0) {
      neisCache.set(cacheKey, null);
      return null;
    }

    // 정확히 매칭되는 학교 우선, 없으면 첫 번째 결과 사용
    const exact = rows.find(r => normalizeSchoolName(r.SCHUL_NM) === cacheKey);
    const row = exact || rows[0];

    const info = {
      schoolType: row.FOND_SC_NM || null,            // 공립 / 사립 / 국립
      founded: row.FOND_YMD ? Number(row.FOND_YMD.slice(0, 4)) : null,
      highSchoolType: row.HS_SC_NM || null,           // 일반고 / 특수목적고 / 특성화고 / 자율고
      coedu: row.COEDU_SC_NM || null,                 // 남녀공학 / 남 / 여
      neisCode: row.SD_SCHUL_CODE || null,             // classInfo API용 학교코드
      officeCode: row.ATPT_OFCDC_SC_CODE || null,      // classInfo API용 교육청코드
    };

    neisCache.set(cacheKey, info);
    return info;
  } catch (err) {
    logError(PHASE, `NEIS 조회 실패 (${schoolName}): ${err.message}`);
    neisCache.set(cacheKey, null);
    return null;
  }
}

/** 학년도 계산 — 1~2월은 전년도 (한국 학년도 3월 시작) */
export function getAcademicYear() {
  const now = new Date();
  return now.getMonth() < 2 ? now.getFullYear() - 1 : now.getFullYear();
}

/** classInfo 전용 캐시 — "officeCode|neisCode" → 학급수 */
const classCache = new Map();

/** NEIS 학급정보 조회 — 학급수(행 수) 반환 */
export async function fetchNeisClassInfo(officeCode, neisCode) {
  if (!NEIS_KEY || !officeCode || !neisCode) return null;

  const cacheKey = `${officeCode}|${neisCode}`;
  if (classCache.has(cacheKey)) return classCache.get(cacheKey);

  const ay = getAcademicYear();
  const url = `${NEIS_BASE}/classInfo?KEY=${NEIS_KEY}&Type=json&ATPT_OFCDC_SC_CODE=${officeCode}&SD_SCHUL_CODE=${neisCode}&AY=${ay}&pIndex=1&pSize=100`;

  try {
    const res = await fetchWithRetry(url);
    const data = await res.json();
    neisApiCalls++;
    const rows = data?.classInfo?.[1]?.row;
    const count = rows?.length ?? null;
    classCache.set(cacheKey, count);
    return count;
  } catch (err) {
    logError(PHASE, `classInfo 실패 (${neisCode}): ${err.message}`);
    classCache.set(cacheKey, null);
    return null;
  }
}

/** nearby_schools 배열에 NEIS 정보 보강 */
export async function enrichWithNeis(nearbySchools) {
  if (!NEIS_KEY || nearbySchools.length === 0) return nearbySchools;

  const enriched = [];
  for (const school of nearbySchools) {
    const info = await fetchNeisSchoolInfo(school.name);
    await sleep(100); // NEIS rate limit 준수

    if (info) {
      const enrichedSchool = {
        ...school,
        ...(info.schoolType && { schoolType: info.schoolType }),
        ...(info.founded && { founded: info.founded }),
        ...(info.highSchoolType && school.type === "고" && { highSchoolType: info.highSchoolType }),
      };
      // classInfo 호출 — neisCode/officeCode 캐시에 있을 때만
      if (info.neisCode && info.officeCode) {
        const classes = await fetchNeisClassInfo(info.officeCode, info.neisCode);
        if (classes) enrichedSchool.classes = classes;
        await sleep(100); // classInfo rate limit
      }
      enriched.push(enrichedSchool);
    } else {
      enriched.push(school);
    }
  }
  return enriched;
}

// ── 학군 점수 계산 ──────────────────────────────────────────────
/** 고교 계열 기반 품질 보정 (NEIS 데이터 있을 때만 작동) */
export function calcQualityBonus(highSchools) {
  let bonus = 0;
  for (const s of highSchools) {
    if (!s.highSchoolType) continue;
    const t = s.highSchoolType;
    if (t.includes("특수목적")) bonus += 7;       // 외고/과학고/국제고 등
    else if (t.includes("자율")) bonus += 5;      // 자율형사립고
    else if (t.includes("특성화")) bonus -= 2;    // 직업 특성화고
    // 일반고: 0
  }
  return bonus;
}

export function calcScore(elem, middle, high) {
  let score = 50;
  // 거리 기반 점수 (기존 로직 유지)
  for (const s of elem) {
    const d = Number(s.distance);
    if (d <= 500) score += 15;
    else if (d <= 1000) score += 10;
  }
  for (const s of middle) {
    if (Number(s.distance) <= 1000) score += 8;
    else score += 4;
  }
  for (const s of high) {
    if (Number(s.distance) <= 1000) score += 5;
    else score += 2;
  }

  // 품질 보정 — NEIS highSchoolType 있을 때만 적용
  score += calcQualityBonus(high);

  return Math.min(Math.max(score, 0), 100);
}

export function gradeFromScore(score) {
  if (score >= 80) return "A";
  if (score >= 60) return "B";
  if (score >= 40) return "C";
  return "D";
}

// ── 메인 수집 로직 ──────────────────────────────────────────────
async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const limitIdx = process.argv.indexOf("--limit");
  const limit = limitIdx !== -1 ? Number(process.argv[limitIdx + 1]) : Infinity;
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");
  if (NEIS_KEY) log(PHASE, "NEIS API 활성화 — 학교 상세 보강 적용");
  else log(PHASE, "⚠️ NEIS_KEY 미설정 — 거리 기반만 사용");

  const sb = getSupabase();
  const { data: apts, error } = await sb.from("apartments").select("id, name, lat, lng").limit(10000);
  if (error) throw new Error(`apartments 조회 실패: ${error.message}`);

  const targets = apts.filter(a => a.lat && a.lng).slice(0, limit);
  log(PHASE, `대상: ${targets.length}건 (좌표 있음${limit < Infinity ? `, limit ${limit}` : ""})`);

  let updated = 0, skipped = 0;

  for (let i = 0; i < targets.length; i++) {
    const apt = targets[i];
    try {
      // 1단계: Kakao Places 검색 (기존)
      const elem = await searchKakao(apt.lat, apt.lng, "초등학교", 1000);
      await sleep(100);
      const middle = await searchKakao(apt.lat, apt.lng, "중학교", 2000);
      await sleep(100);
      const high = await searchKakao(apt.lat, apt.lng, "고등학교", 2000);
      await sleep(100);

      // 2단계: nearby_schools 생성 + NEIS 보강
      let nearbySchools = [
        ...elem.filter(s => isSchoolPlace(s.place_name)).map(s => ({ name: s.place_name, type: "초", distance: Math.round(Number(s.distance)) })),
        ...middle.filter(s => isSchoolPlace(s.place_name)).map(s => ({ name: s.place_name, type: "중", distance: Math.round(Number(s.distance)) })),
        ...high.filter(s => isSchoolPlace(s.place_name)).map(s => ({ name: s.place_name, type: "고", distance: Math.round(Number(s.distance)) })),
      ].sort((a, b) => a.distance - b.distance);

      nearbySchools = await enrichWithNeis(nearbySchools);

      // 3단계: 점수 계산 (NEIS 보강된 고교 데이터 반영)
      const enrichedHigh = nearbySchools.filter(s => s.type === "고");
      const score = calcScore(
        nearbySchools.filter(s => s.type === "초"),
        nearbySchools.filter(s => s.type === "중"),
        enrichedHigh,
      );
      const grade = gradeFromScore(score);

      const row = {
        apartment_id: apt.id,
        school_score: score,
        school_grade: grade,
        nearby_schools: nearbySchools,
        updated_at: new Date().toISOString(),
      };

      if (dryRun) {
        log(PHASE, `  [DRY] ${apt.name}: 점수${score}(${grade}) 초${elem.length} 중${middle.length} 고${high.length}`);
        updated++;
        continue;
      }

      const { error: uErr } = await sb.from("schools").upsert([row], { onConflict: "apartment_id" });
      if (uErr) { logError(PHASE, `${apt.name}: ${uErr.message}`); skipped++; }
      else updated++;
    } catch (err) {
      logError(PHASE, `${apt.name}: ${err.message}`);
      skipped++;
    }

    if ((i + 1) % 30 === 0) log(PHASE, `진행: ${i + 1}/${targets.length} (갱신 ${updated})`);
  }

  log(PHASE, `\n=== 완료: 갱신 ${updated}, 건너뜀 ${skipped} ===`);
  if (NEIS_KEY) log(PHASE, `NEIS API 호출: ${neisApiCalls}건, schoolInfo 캐시: ${neisCache.size}건, classInfo 캐시: ${classCache.size}건`);
}

const isCLI = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (isCLI) main().catch(err => { logError(PHASE, err.message); process.exit(1); });
