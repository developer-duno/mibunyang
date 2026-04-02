/**
 * 응급의료기관 수집기 — data.go.kr 국립중앙의료원 API
 *
 * 전국 응급의료기관 목록 조회 → 단지별 최근접 거리(haversine) 매칭.
 * infra 테이블의 emergency/emergency_dist 컬럼에 저장.
 *
 * 사용법:
 *   node scripts/collectors/collect-emergency.mjs              (Supabase UPDATE)
 *   node scripts/collectors/collect-emergency.mjs --dry-run    (미리보기만)
 */
import { loadEnv, getSupabase, log, logError, fetchWithRetry, createReporter, recordApiQuota } from "./_shared.mjs";

loadEnv();

const PHASE = "emergency";
const API_KEY = process.env.MOLIT_KEY;
if (!API_KEY) { logError(PHASE, "MOLIT_KEY 환경변수 필요"); process.exit(1); }

/** Haversine 거리 (km) */
export function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** 전국 응급의료기관 목록 조회 (페이지네이션) */
export async function fetchEmergencyList() {
  const facilities = [];
  let page = 1;
  let apiCalls = 0;
  while (true) {
    const url = `https://apis.data.go.kr/B552657/ErmctInfoInqireService/getEgytListInfoInqire?serviceKey=${API_KEY}&pageNo=${page}&numOfRows=100&Q0=&Q1=`;
    const res = await fetchWithRetry(url);
    apiCalls++;
    const text = await res.text();
    // XML 응답 파싱
    const items = text.match(/<item>([\s\S]*?)<\/item>/g) || [];
    if (items.length === 0) break;
    for (const item of items) {
      const get = (tag) => { const m = item.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)); return m ? m[1] : null; };
      const lat = parseFloat(get("wgs84Lat"));
      const lng = parseFloat(get("wgs84Lon"));
      if (!lat || !lng) continue;
      facilities.push({
        name: get("dutyName"),
        type: get("dutyEmclsName"), // 권역응급/지역응급/지역의료기관
        lat, lng,
      });
    }
    const totalCount = parseInt(text.match(/<totalCount>(\d+)<\/totalCount>/)?.[1] || "0");
    if (page * 100 >= totalCount) break;
    page++;
  }
  return { facilities, apiCalls };
}

/** 단지별 최근접 응급의료기관 매칭 */
export function matchNearest(apt, facilities) {
  let minDist = Infinity;
  let count = 0;
  for (const f of facilities) {
    const dist = haversine(apt.lat, apt.lng, f.lat, f.lng);
    if (dist <= 10) count++; // 10km 이내 시설 수
    if (dist < minDist) minDist = dist;
  }
  return { count, dist: Math.round(minDist * 1000) }; // m 단위
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  const sb = getSupabase();

  // 1. 전국 응급의료기관 목록 수집
  log(PHASE, "전국 응급의료기관 목록 조회 중...");
  const { facilities, apiCalls } = await fetchEmergencyList();
  log(PHASE, `응급의료기관 ${facilities.length}건 조회 완료 (API ${apiCalls}회)`);

  // 2. 단지 목록 조회
  const { data: apts, error } = await sb.from("apartments").select("id, name, lat, lng").limit(10000);
  if (error) throw new Error(`apartments 조회 실패: ${error.message}`);
  const targets = apts.filter(a => a.lat && a.lng);
  log(PHASE, `대상: ${targets.length}건`);

  // 3. 단지별 매칭 + DB 저장
  const rpt = createReporter(PHASE);
  for (let i = 0; i < targets.length; i++) {
    const apt = targets[i];
    try {
      const { count, dist } = matchNearest(apt, facilities);
      if (dryRun) {
        log(PHASE, `  [DRY] ${apt.name}: 응급의료 ${count}개(10km), 최근접 ${dist}m`);
        rpt.success(1);
        continue;
      }
      const { error: uErr } = await sb.from("infra").upsert([{
        apartment_id: apt.id, emergency: count, emergency_dist: dist,
        updated_at: new Date().toISOString(),
      }], { onConflict: "apartment_id" });
      if (uErr) { logError(PHASE, `${apt.name}: ${uErr.message}`); rpt.fail(1); }
      else rpt.success(1);
    } catch (err) {
      logError(PHASE, `${apt.name}: ${err.message}`);
      rpt.fail(1);
    }
    if ((i + 1) % 100 === 0) log(PHASE, `진행: ${i + 1}/${targets.length}`);
  }

  await recordApiQuota(PHASE, "data.go.kr/emergency", apiCalls);
  const result = rpt.summary();
  if (result.fail > 0) process.exit(1);
}

const isCLI = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (isCLI) main().catch(err => { logError(PHASE, err.message); process.exit(1); });
