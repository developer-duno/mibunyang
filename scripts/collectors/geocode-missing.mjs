/**
 * 좌표 누락 단지 지오코딩 — Kakao 주소검색 API
 *
 * apartments 테이블에서 lat/lng가 null인 단지를 찾아
 * 주소(region + gu + dong + name)로 Kakao 지오코딩 수행
 *
 * 사용법:
 *   node scripts/collectors/geocode-missing.mjs              (Supabase UPDATE)
 *   node scripts/collectors/geocode-missing.mjs --dry-run    (미리보기만)
 */
import { loadEnv, getSupabase, log, logError, sleep } from "./_shared.mjs";

loadEnv();

const PHASE = "geocode";
const KAKAO_KEY = process.env.KAKAO_KEY;
if (!KAKAO_KEY) { logError(PHASE, "KAKAO_KEY 환경변수 필요"); process.exit(1); }

/** Kakao 주소 검색 API */
async function geocode(query) {
  const url = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(query)}&size=1`;
  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${KAKAO_KEY}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (data.documents?.length > 0) {
    return { lat: parseFloat(data.documents[0].y), lng: parseFloat(data.documents[0].x) };
  }
  return null;
}

/** Kakao 키워드 검색 API (주소 검색 실패 시 폴백) */
async function geocodeKeyword(query) {
  const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(query)}&size=1`;
  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${KAKAO_KEY}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (data.documents?.length > 0) {
    return { lat: parseFloat(data.documents[0].y), lng: parseFloat(data.documents[0].x) };
  }
  return null;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  const sb = getSupabase();

  // 좌표 없는 단지 조회
  const { data: apts, error } = await sb
    .from("apartments")
    .select("id, name, dong, gu, region")
    .or("lat.is.null,lng.is.null");
  if (error) throw new Error(`apartments 조회 실패: ${error.message}`);

  log(PHASE, `좌표 없는 단지: ${apts.length}건`);
  if (apts.length === 0) { log(PHASE, "모든 단지에 좌표 있음"); return; }

  let geocoded = 0, failed = 0;

  for (let i = 0; i < apts.length; i++) {
    const apt = apts[i];
    try {
      // 단지명에서 괄호 내용 제거 (검색 정확도 향상)
      const cleanName = apt.name.replace(/\(.*?\)/g, "").trim();

      // 1차: 주소 검색 (region + gu + dong)
      const addr = [apt.region, apt.gu, apt.dong].filter(Boolean).join(" ");
      let result = addr ? await geocode(addr) : null;
      await sleep(100);

      // 2차: 키워드 검색 (region + gu + 단지명)
      if (!result) {
        const keyword = [apt.region, apt.gu, cleanName].filter(Boolean).join(" ");
        result = await geocodeKeyword(keyword);
        await sleep(100);
      }

      // 3차: 단지명만으로 키워드 검색
      if (!result) {
        result = await geocodeKeyword(cleanName);
        await sleep(100);
      }

      // 4차: region + gu만으로 주소 검색 (택지지구/블록 등으로 실패한 경우)
      if (!result && apt.region && apt.gu) {
        result = await geocode(`${apt.region} ${apt.gu}`);
        await sleep(100);
      }

      // 5차: 단지명에서 지역명 추출하여 키워드 검색
      if (!result) {
        const shortName = cleanName.replace(/\d+블[록럭]?/g, "").replace(/[A-Z]\d+/g, "").trim();
        if (shortName !== cleanName) {
          result = await geocodeKeyword(shortName);
          await sleep(100);
        }
      }

      if (result) {
        if (dryRun) {
          log(PHASE, `  [DRY] ${apt.name}: ${result.lat}, ${result.lng}`);
        } else {
          const { error: uErr } = await sb
            .from("apartments")
            .update({ lat: result.lat, lng: result.lng })
            .eq("id", apt.id);
          if (uErr) { logError(PHASE, `${apt.name}: ${uErr.message}`); failed++; continue; }
        }
        geocoded++;
      } else {
        if (dryRun) log(PHASE, `  [DRY] ${apt.name}: 좌표 찾기 실패 (${addr})`);
        failed++;
      }
    } catch (err) {
      logError(PHASE, `${apt.name}: ${err.message}`);
      failed++;
    }

    if ((i + 1) % 50 === 0) log(PHASE, `진행: ${i + 1}/${apts.length} (성공 ${geocoded}, 실패 ${failed})`);
  }

  log(PHASE, `\n=== 완료: 성공 ${geocoded}, 실패 ${failed} / 전체 ${apts.length} ===`);
}

main().catch(err => { logError(PHASE, err.message); process.exit(1); });
