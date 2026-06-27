// @ts-check
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
import { loadEnv, getSupabase, log, logError, fetchWithRetry, createReporter, recordApiQuota, recordCollectorRun, haversineKm, selectAll } from "./_shared.mjs";

loadEnv();

const PHASE = "emergency";
const API_KEY = process.env.MOLIT_KEY;

export const haversine = haversineKm;

/**
 * @typedef {{ name: string | null; type: string | null; lat: number; lng: number }} EmergencyFacility
 * @typedef {{ id: string; name: string | null; lat: number | null; lng: number | null }} EmergencyAptRow
 */

/**
 * 전국 응급의료기관 목록 조회 (페이지네이션)
 * @returns {Promise<{ facilities: EmergencyFacility[]; apiCalls: number }>}
 */
export async function fetchEmergencyList() {
  /** @type {EmergencyFacility[]} */
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
      /** @param {string} tag @returns {string} */
      const get = (tag) => { const m = item.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)); return m && m[1] ? m[1] : ""; };
      const lat = parseFloat(get("wgs84Lat"));
      const lng = parseFloat(get("wgs84Lon"));
      if (!lat || !lng) continue;
      facilities.push({
        name: get("dutyName") || null,
        type: get("dutyEmclsName") || null, // 권역응급/지역응급/지역의료기관
        lat, lng,
      });
    }
    const totalCount = parseInt(text.match(/<totalCount>(\d+)<\/totalCount>/)?.[1] || "0");
    if (page * 100 >= totalCount) break;
    page++;
  }
  return { facilities, apiCalls };
}

/**
 * 단지별 최근접 응급의료기관 매칭
 * @param {EmergencyAptRow} apt
 * @param {EmergencyFacility[]} facilities
 * @returns {{ count: number; dist: number; name: string | null; type: string | null }}
 */
export function matchNearest(apt, facilities) {
  let minDist = Infinity;
  let count = 0;
  /** @type {EmergencyFacility | null} */
  let nearest = null;
  for (const f of facilities) {
    const dist = haversine(Number(apt.lat), Number(apt.lng), f.lat, f.lng);
    if (dist <= 10) count++; // 10km 이내 시설 수
    if (dist < minDist) {
      minDist = dist;
      nearest = f;
    }
  }
  return {
    count,
    dist: Math.round(minDist * 1000), // m 단위
    name: nearest?.name ?? null,
    type: nearest?.type ?? null,
  };
}

async function main() {
  if (!API_KEY) { logError(PHASE, "MOLIT_KEY 환경변수 필요"); process.exit(1); }

  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  const sb = getSupabase();

  // 1. 전국 응급의료기관 목록 수집
  log(PHASE, "전국 응급의료기관 목록 조회 중...");
  const { facilities, apiCalls } = await fetchEmergencyList();
  log(PHASE, `응급의료기관 ${facilities.length}건 조회 완료 (API ${apiCalls}회)`);

  // 2. 단지 목록 조회 — selectAll 공유 헬퍼(1000행/배치 자동 페이지네이션)
  const apts = await selectAll((s) => s.from("apartments").select("id, name, lat, lng"), sb);
  const targets = apts.filter(a => a.lat && a.lng);
  log(PHASE, `대상: ${targets.length}건`);

  // 3. 단지별 매칭 + DB 저장
  const rpt = createReporter(PHASE);
  for (let i = 0; i < targets.length; i++) {
    if (rpt.interrupted()) break;  // 세션 321: graceful shutdown
    const apt = targets[i];
    try {
      const { count, dist, name, type } = matchNearest(apt, facilities);
      if (dryRun) {
        log(PHASE, `  [DRY] ${apt.name}: 응급의료 ${count}개(10km), 최근접 ${name ?? "-"} (${type ?? "-"}) ${dist}m`);
        rpt.success(1);
        continue;
      }
      const { error: uErr } = await sb.from("infra").upsert([{
        apartment_id: apt.id,
        emergency: count,
        emergency_dist: dist,
        emergency_name: name,
        emergency_type: type,
        updated_at: new Date().toISOString(),
      }], { onConflict: "apartment_id" });
      if (uErr) { logError(PHASE, `${apt.name}: ${uErr.message}`); rpt.fail(1); }
      else rpt.success(1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError(PHASE, `${apt.name}: ${msg}`);
      rpt.fail(1);
    }
    if ((i + 1) % 100 === 0) log(PHASE, `진행: ${i + 1}/${targets.length}`);
  }

  await recordApiQuota(PHASE, "data.go.kr/emergency", apiCalls);
  const result = rpt.summary();
  await recordCollectorRun(PHASE, result);
  if (result.fail > 0) process.exit(1);
}

const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) || "");
if (isCLI) main().catch(err => { const msg = err instanceof Error ? err.message : String(err); logError(PHASE, msg); process.exit(1); });
