/**
 * 학군 정보 수집기 — Kakao Places 기반
 *
 * 초·중·고 검색 → 학군 점수 계산 → schools 테이블 업데이트
 *
 * 사용법:
 *   node scripts/collectors/schools-neis.mjs              (Supabase UPDATE)
 *   node scripts/collectors/schools-neis.mjs --dry-run    (미리보기만)
 */
import { loadEnv, getSupabase, log, logError, fetchWithRetry, sleep } from "./_shared.mjs";

loadEnv();

const PHASE = "schools";
const KAKAO_KEY = process.env.KAKAO_KEY;
if (!KAKAO_KEY) { logError(PHASE, "KAKAO_KEY 환경변수 필요"); process.exit(1); }

async function searchKakao(lat, lng, keyword, radius) {
  const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(keyword)}&x=${lng}&y=${lat}&radius=${radius}&sort=distance&size=15`;
  const res = await fetchWithRetry(url, { headers: { Authorization: `KakaoAK ${KAKAO_KEY}` } });
  const data = await res.json();
  return data.documents || [];
}

function calcScore(elem, middle, high) {
  let score = 50;
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
  return Math.min(score, 100);
}

function gradeFromScore(score) {
  if (score >= 80) return "A";
  if (score >= 60) return "B";
  if (score >= 40) return "C";
  return "D";
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  const sb = getSupabase();
  const { data: apts, error } = await sb.from("apartments").select("id, name, lat, lng");
  if (error) throw new Error(`apartments 조회 실패: ${error.message}`);

  const targets = apts.filter(a => a.lat && a.lng);
  log(PHASE, `대상: ${targets.length}건 (좌표 있음)`);

  let updated = 0, skipped = 0;

  for (let i = 0; i < targets.length; i++) {
    const apt = targets[i];
    try {
      const elem = await searchKakao(apt.lat, apt.lng, "초등학교", 1000);
      await sleep(100);
      const middle = await searchKakao(apt.lat, apt.lng, "중학교", 2000);
      await sleep(100);
      const high = await searchKakao(apt.lat, apt.lng, "고등학교", 2000);
      await sleep(100);

      const score = calcScore(elem, middle, high);
      const grade = gradeFromScore(score);

      const nearbySchools = [
        ...elem.map(s => ({ name: s.place_name, type: "초", distance: Math.round(Number(s.distance)) })),
        ...middle.map(s => ({ name: s.place_name, type: "중", distance: Math.round(Number(s.distance)) })),
        ...high.map(s => ({ name: s.place_name, type: "고", distance: Math.round(Number(s.distance)) })),
      ].sort((a, b) => a.distance - b.distance);

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
}

main().catch(err => { logError(PHASE, err.message); process.exit(1); });
