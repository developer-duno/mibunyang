// @ts-check
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
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY, KAKAO_KEY
 */
import { loadEnv, getSupabase, log, logError, sleep } from "./_shared.mjs";

loadEnv();

// ── 소음 추정 로직 ───────────────────────────────────────────────
/**
 * @param {number|null|undefined} roadDistM
 * @returns {number|null}
 */
function estimateNoise(roadDistM) {
  if (roadDistM == null) return null;
  if (roadDistM <= 50) return 70;   // 높음 (65+ dB)
  if (roadDistM <= 100) return 60;  // 보통 (55-65 dB)
  if (roadDistM <= 200) return 50;  // 낮음 (45-55 dB)
  return 40;                        // 매우 낮음 (<45 dB)
}

// ── 도로명 주소 파싱으로 소음 추정 (API 호출 불필요) ─────────────
/**
 * @param {string|null|undefined} roadAddress
 * @returns {number|null}
 */
function estimateNoiseFromAddress(roadAddress) {
  if (!roadAddress) return null;
  // "대로" → 왕복 4차선 이상, 교통량 많음 → 50m 수준
  if (roadAddress.includes("대로")) return 100;
  // "로" → 왕복 2차선, 보통 교통량 → 150m 수준
  if (/로(?:\s|$)/.test(roadAddress)) return 150;
  // "길" → 이면도로, 교통량 적음 → 250m 수준
  if (roadAddress.includes("길")) return 300;
  return null;
}

// ── Kakao 키워드 검색 (도로 시설) ────────────────────────────────
/**
 * @param {string} kakaoKey
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<number|null>}
 */
async function findNearestRoad(kakaoKey, lat, lng) {
  // 1단계: "도로" 키워드 검색 (반경 1km)
  const keywords = ["대로", "도로", "고속도로"];
  for (const keyword of keywords) {
    const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(keyword)}&x=${lng}&y=${lat}&radius=1000&sort=distance&size=1`;
    try {
      const res = await fetch(url, {
        headers: { Authorization: `KakaoAK ${kakaoKey}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) continue;
      const json = await res.json();
      if (json.documents && json.documents.length > 0) {
        return parseFloat(json.documents[0].distance) || null;
      }
    } catch {
      // ignore
    }
  }

  // 2단계: 지하철역(SW8) 폴백 (반경 1km)
  const url = `https://dapi.kakao.com/v2/local/search/category.json?category_group_code=SW8&x=${lng}&y=${lat}&radius=1000&sort=distance&size=1`;
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

  return null;
}

// ── 메인 ─────────────────────────────────────────────────────────
async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const kakaoKey = process.env.KAKAO_KEY;

  if (!kakaoKey) {
    logError("init", "KAKAO_KEY 환경변수 필요");
    process.exit(1);
  }

  const sb = getSupabase();

  // noise가 null인 아파트만 대상 (road_address도 가져옴)
  const { data: apts, error } = await sb
    .from("apartments")
    .select("id,name,lat,lng,noise,road_address")
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

    // 1단계: road_address 파싱 (API 호출 없이 즉시 추정)
    const addrDist = estimateNoiseFromAddress(apt.road_address);
    let dist = addrDist;
    let source = "address";

    // 2단계: 주소 파싱 실패 시 Kakao API 폴백
    if (dist == null) {
      dist = await findNearestRoad(kakaoKey, apt.lat, apt.lng);
      source = "kakao";
      // Rate limit: Kakao API 호출 시만 200ms 간격
      if (i < apts.length - 1) await sleep(200);
    }

    const noise = estimateNoise(dist);

    if (noise) {
      results.push({ id: apt.id, name: apt.name, noise, dist, source });
      log("noise", `${apt.name}: ${dist != null ? `${Math.round(dist)}m` : "?"} → ${noise} (${source})`);
    }

    if ((i + 1) % 50 === 0) {
      log("progress", `${i + 1}/${apts.length}건 처리...`);
    }
  }

  log("calc", `${results.length}/${apts.length}건 소음 추정 완료`);

  if (dryRun) {
    log("dry-run", "미리보기 모드 — 업데이트 생략");
    /** @type {Record<number, number>} */
    const grouped = { 70: 0, 60: 0, 50: 0, 40: 0 };
    /** @type {Record<number, string>} */
    const labels = { 70: "높음(70dB)", 60: "보통(60dB)", 50: "낮음(50dB)", 40: "매우낮음(40dB)" };
    for (const r of results) if (grouped[r.noise] != null) grouped[r.noise]++;
    for (const [k, v] of Object.entries(grouped)) {
      console.log(`  ${labels[Number(k)]}: ${v}건`);
    }
    const fromAddr = results.filter(r => r.source === "address").length;
    const fromKakao = results.filter(r => r.source === "kakao").length;
    console.log(`  소스: 주소파싱 ${fromAddr}건, Kakao API ${fromKakao}건`);
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

// CLI 직접 실행 시에만 main() 호출 (테스트 환경 보호)
const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) || "");
if (isCLI) main().catch((err) => { const msg = err instanceof Error ? err.message : String(err); logError("main", msg); process.exit(1); });

// 테스트용 순수 함수 export
export { estimateNoise, estimateNoiseFromAddress };
