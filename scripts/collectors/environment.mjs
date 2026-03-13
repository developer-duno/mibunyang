/**
 * 환경 데이터(view) 수집기 — Kakao 키워드 검색 기반
 *
 * 조망 분류:
 *   블루 — 반경 1km 내 하천/호수/바다 발견
 *   그린 — 반경 1km 내 대형 공원/산 발견 (블루 없을 때)
 *   천공 — 블루/그린 모두 없을 때
 *
 * 사용법:
 *   node scripts/collectors/environment.mjs              (Supabase 업데이트)
 *   node scripts/collectors/environment.mjs --dry-run    (미리보기만)
 *   node scripts/collectors/environment.mjs --json       (apartments.json 직접 업데이트)
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { loadEnv, getSupabase, log, logError, fetchWithRetry, sleep, ROOT } from "./_shared.mjs";

loadEnv();

const SEARCH_RADIUS = 1000; // 1km

// ── 블루 조망 키워드 (수계) ─────────────────────────────────
const BLUE_KEYWORDS = ["하천", "강", "호수", "저수지", "해수욕장", "바다"];
// ── 그린 조망 키워드 ────────────────────────────────────────
const GREEN_KEYWORDS = ["공원", "산", "수목원", "자연휴양림", "생태공원"];

// ── Kakao 키워드 검색 ───────────────────────────────────────
async function searchKeyword(lat, lng, keyword) {
  const kakaoKey = process.env.KAKAO_KEY;
  const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(keyword)}&x=${lng}&y=${lat}&radius=${SEARCH_RADIUS}&sort=distance&size=3`;
  const res = await fetchWithRetry(url, {
    headers: { Authorization: `KakaoAK ${kakaoKey}` },
  });
  const data = await res.json();
  return data.documents || [];
}

// ── 조망 판정 ───────────────────────────────────────────────
async function classifyView(lat, lng) {
  let errors = 0;

  // 블루 체크
  for (const kw of BLUE_KEYWORDS) {
    try {
      const results = await searchKeyword(lat, lng, kw);
      if (results.length > 0) return "블루";
    } catch (err) {
      errors++;
      logError("classify", `블루 "${kw}": ${err.message}`);
    }
    await sleep(80);
  }

  // 그린 체크
  for (const kw of GREEN_KEYWORDS) {
    try {
      const results = await searchKeyword(lat, lng, kw);
      if (results.length > 0) return "그린";
    } catch (err) {
      errors++;
      logError("classify", `그린 "${kw}": ${err.message}`);
    }
    await sleep(80);
  }

  // 모든 키워드가 에러면 판정 불가 → null 반환 (DB 미기록)
  if (errors === BLUE_KEYWORDS.length + GREEN_KEYWORDS.length) return null;

  return "천공";
}

// ── 메인 ─────────────────────────────────────────────────────
async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const jsonMode = process.argv.includes("--json");

  if (!process.env.KAKAO_KEY) {
    logError("env", "KAKAO_KEY 환경변수가 필요합니다");
    process.exit(1);
  }

  // 1. 아파트 데이터 로드
  let apartments;
  if (jsonMode) {
    const jsonPath = resolve(ROOT, "public/data/apartments.json");
    apartments = JSON.parse(readFileSync(jsonPath, "utf8"));
    log("load", `apartments.json: ${apartments.length}건`);
  } else {
    const sb = getSupabase();
    const { data, error } = await sb.from("apartments").select("id, name, lat, lng, view");
    if (error) throw new Error(`Supabase 조회 실패: ${error.message}`);
    apartments = data;
    log("load", `Supabase apartments: ${apartments.length}건`);
  }

  const withCoords = apartments.filter(a => a.lat && a.lng);
  // 이미 view가 있는 아파트는 스킵 (재수집 방지)
  const targets = withCoords.filter(a => !a.view);
  log("filter", `대상: ${targets.length}건 (좌표 있고 view 없음) / 전체 ${apartments.length}건`);

  // 2. 각 아파트 조망 분류
  const updates = [];
  let processed = 0;
  const counts = { "블루": 0, "그린": 0, "천공": 0 };

  for (const apt of targets) {
    try {
      const view = await classifyView(apt.lat, apt.lng);
      if (view == null) { logError("skip", `${apt.name}: API 전체 실패, 판정 불가`); processed++; continue; }
      updates.push({ id: apt.id, view });
      counts[view]++;
    } catch (err) {
      logError("classify", `${apt.name}: ${err.message}`);
    }

    processed++;
    if (processed % 30 === 0) {
      log("progress", `${processed}/${targets.length}건 처리 (블루:${counts["블루"]} 그린:${counts["그린"]} 천공:${counts["천공"]})`);
    }
  }

  log("result", `분류 완료: 블루 ${counts["블루"]}, 그린 ${counts["그린"]}, 천공 ${counts["천공"]}`);

  if (dryRun) {
    log("dry-run", "미리보기 모드 — 업데이트 생략");
    for (const u of updates.slice(0, 30)) {
      const apt = apartments.find(a => a.id === u.id);
      console.log(`  ${apt?.name || u.id}: ${u.view}`);
    }
    if (updates.length > 30) console.log(`  ... 외 ${updates.length - 30}건`);
    return;
  }

  // 3. 업데이트
  if (jsonMode) {
    const aptMap = new Map(apartments.map(a => [a.id, a]));
    for (const u of updates) {
      const apt = aptMap.get(u.id);
      if (!apt) continue;
      apt.view = u.view;
    }
    const jsonPath = resolve(ROOT, "public/data/apartments.json");
    writeFileSync(jsonPath, JSON.stringify([...aptMap.values()], null, 2), "utf8");
    log("json", `apartments.json 업데이트 완료 (${updates.length}건)`);
  } else {
    const sb = getSupabase();
    let ok = 0;
    for (const u of updates) {
      const { error } = await sb.from("apartments")
        .update({ view: u.view })
        .eq("id", u.id);
      if (error) logError("upsert", `${u.id}: ${error.message}`);
      else ok++;
    }
    log("supabase", `${ok}/${updates.length}건 업데이트`);
  }
}

main().catch(err => { logError("main", err.message); process.exit(1); });
