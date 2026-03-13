/**
 * 소음 추정 수집기 — 도로 근접도 기반 dB 추정
 *
 * Kakao Maps API로 아파트 좌표 주변 도로 검색 → 거리 기반 소음 추정.
 * 환경부 소음지도 API가 안정화되면 대체 예정.
 *
 * 소음 추정 기준 (도로교통소음 표준):
 *   - 50m 이내: "높음" (65+ dB)
 *   - 100m 이내: "보통" (55-65 dB)
 *   - 200m 이내: "낮음" (45-55 dB)
 *   - 200m 초과: "매우 낮음" (<45 dB)
 *
 * 사용법:
 *   node scripts/collectors/noise-estimate.mjs          (apartments 테이블 업데이트)
 *   node scripts/collectors/noise-estimate.mjs --dry-run (미리보기만)
 *
 * 필요 환경변수:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY, KAKAO_REST_KEY
 */
import { loadEnv, getSupabase, log, logError, sleep } from "./_shared.mjs";

loadEnv();

// ── 소음 추정 로직 ───────────────────────────────────────────────
function estimateNoise(roadDistM) {
  if (roadDistM == null) return null;
  if (roadDistM <= 50) return "높음";
  if (roadDistM <= 100) return "보통";
  if (roadDistM <= 200) return "낮음";
  return "매우 낮음";
}

// ── Kakao 키워드 검색 (도로 시설) ────────────────────────────────
async function findNearestRoad(kakaoKey, lat, lng) {
  // 카테고리: 도로 관련 — "교통,수송" 카테고리의 도로
  // Kakao에서 주요 도로를 직접 검색하기 어려우므로,
  // 주요 교차로/IC/대로 키워드로 근접도 추정
  const categories = ["SW8"]; // SW8 = 지하철역 (도로 근접도 대리 지표)
  const url = `https://dapi.kakao.com/v2/local/search/category.json?category_group_code=${categories[0]}&x=${lng}&y=${lat}&radius=500&sort=distance&size=1`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `KakaoAK ${kakaoKey}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (json.documents && json.documents.length > 0) {
      return parseFloat(json.documents[0].distance) || null;
    }
  } catch {
    // ignore
  }

  // 폴백: 키워드 "대로" 검색
  const url2 = `https://dapi.kakao.com/v2/local/search/keyword.json?query=대로&x=${lng}&y=${lat}&radius=300&sort=distance&size=1`;
  try {
    const res = await fetch(url2, {
      headers: { Authorization: `KakaoAK ${kakaoKey}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (json.documents && json.documents.length > 0) {
      return parseFloat(json.documents[0].distance) || null;
    }
  } catch {
    // ignore
  }

  return null;
}

// ── 메인 ─────────────────────────────────────────────────────────
async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const kakaoKey = process.env.KAKAO_REST_KEY;

  if (!kakaoKey) {
    logError("init", "KAKAO_REST_KEY 환경변수 필요");
    process.exit(1);
  }

  const sb = getSupabase();

  // noise가 null인 아파트만 대상
  const { data: apts, error } = await sb
    .from("apartments")
    .select("id,name,lat,lng,noise")
    .is("noise", null)
    .not("lat", "is", null)
    .not("lng", "is", null);

  if (error) {
    logError("load", `아파트 조회 실패: ${error.message}`);
    process.exit(1);
  }

  log("load", `소음 미수집 아파트 ${apts.length}건`);

  if (apts.length === 0) {
    log("done", "처리할 아파트 없음");
    return;
  }

  const results = [];

  for (let i = 0; i < apts.length; i++) {
    const apt = apts[i];
    const dist = await findNearestRoad(kakaoKey, apt.lat, apt.lng);
    const noise = estimateNoise(dist);

    if (noise) {
      results.push({ id: apt.id, name: apt.name, noise, dist });
      log("noise", `${apt.name}: ${dist != null ? `${Math.round(dist)}m` : "?"} → ${noise}`);
    }

    // Rate limit: 요청 간 200ms 간격
    if (i < apts.length - 1) await sleep(200);

    if ((i + 1) % 50 === 0) {
      log("progress", `${i + 1}/${apts.length}건 처리...`);
    }
  }

  log("calc", `${results.length}/${apts.length}건 소음 추정 완료`);

  if (dryRun) {
    log("dry-run", "미리보기 모드 — 업데이트 생략");
    const grouped = { "높음": 0, "보통": 0, "낮음": 0, "매우 낮음": 0 };
    for (const r of results) grouped[r.noise]++;
    for (const [k, v] of Object.entries(grouped)) {
      console.log(`  ${k}: ${v}건`);
    }
    return;
  }

  // apartments 테이블 개별 update (noise 컬럼)
  let updated = 0;
  for (const r of results) {
    const { error: e } = await sb
      .from("apartments")
      .update({ noise: r.noise })
      .eq("id", r.id);

    if (e) {
      logError("update", `${r.name}: ${e.message}`);
    } else {
      updated++;
    }
  }

  log("done", `apartments.noise ${updated}/${results.length}건 업데이트 완료`);
}

main().catch((err) => {
  logError("main", err.message);
  process.exit(1);
});
