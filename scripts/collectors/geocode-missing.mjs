// @ts-check
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
import { loadEnv, getSupabase, log, logError, sleep, setupGracefulShutdown, recordCollectorRun } from "./_shared.mjs";

loadEnv();

const PHASE = "geocode";
const KAKAO_KEY = process.env.KAKAO_KEY;
if (!KAKAO_KEY) { logError(PHASE, "KAKAO_KEY 환경변수 필요"); process.exit(1); }

/**
 * Kakao 주소 검색 API
 * @param {string} query
 * @returns {Promise<{lat: number, lng: number} | null>}
 */
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

/**
 * Kakao 키워드 검색 API (주소 검색 실패 시 폴백)
 * @param {string} query
 * @returns {Promise<{lat: number, lng: number} | null>}
 */
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

/**
 * region에 콤마가 있으면 단지명 기반으로 정확한 지역 선택
 * @param {string | null | undefined} region
 * @param {string} aptName
 * @returns {string | null | undefined}
 */
export function resolveRegionFromName(region, aptName) {
  if (!region || !region.includes(",")) return region;
  const candidates = region.split(",").map(s => s.trim());
  return candidates.find(r => aptName.includes(r)) || candidates[0];
}

/**
 * gu가 주소가 아닌 값(번지, 블록 등)이면 단지명에서 추출
 * @param {string | null | undefined} gu
 * @param {string} aptName
 * @returns {string | null}
 */
export function extractGu(gu, aptName) {
  if (!gu) return null;
  if (!/^\d+/.test(gu) && !/BL$|블록$|지구$|구역$/.test(gu)) return null;
  const guMatch = aptName.match(/([가-힣]+[시구군])\s/);
  return guMatch ? guMatch[1] : null;
}

/**
 * 주소 문자열 조립
 * @param {string | null | undefined} region
 * @param {string | null | undefined} gu
 * @param {string | null | undefined} dong
 * @returns {string}
 */
export function buildAddress(region, gu, dong) {
  return [region, gu, dong].filter(Boolean).join(" ");
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  // 세션 504: 매일·매주 도는데 collector_runs 행이 0개라 감시가 이 수집기를 못 봤다.
  const startedMs = Date.now();
  const startedAt = new Date().toISOString();
  const sb = getSupabase();
  const isInterrupted = setupGracefulShutdown(PHASE);  // 세션 344: graceful shutdown

  // 좌표 없는 단지 조회
  const { data: apts, error } = await sb
    .from("apartments")
    .select("id, name, dong, gu, region")
    .or("lat.is.null,lng.is.null");
  if (error) throw new Error(`apartments 조회 실패: ${error.message}`);

  log(PHASE, `좌표 없는 단지: ${apts.length}건`);
  if (apts.length === 0) {
    log(PHASE, "모든 단지에 좌표 있음");
    // 할 일이 0건이어도 기록은 남긴다 — 안 남기면 "돌았는데 할 일이 없었다" 와
    // "아예 안 돌았다" 가 구분되지 않아 미발화 감시가 무력해진다(세션 503 실거래 사고).
    await recordCollectorRun(PHASE, {
      ok: 0, fail: 0, skip: 0,
      elapsed: ((Date.now() - startedMs) / 1000).toFixed(1),
      startedAt,
      status: "success",
    });
    return;
  }

  let geocoded = 0, failed = 0;

  for (let i = 0; i < apts.length; i++) {
    if (isInterrupted()) break;  // 세션 344: graceful shutdown
    const apt = apts[i];
    try {
      const cleanName = apt.name.replace(/\(.*?\)/g, "").trim();

      let region = apt.region;
      /** @type {{ region?: string | null, gu?: string | null }} */
      const dbUpdates = {};
      const resolved = resolveRegionFromName(region, apt.name);
      if (resolved !== region) {
        region = resolved;
        dbUpdates.region = region;
        log(PHASE, `  region 수정: "${apt.region}" → "${region}" (${apt.name})`);
      }

      let gu = apt.gu;
      const extractedGu = extractGu(gu, apt.name);
      if (extractedGu) {
        gu = extractedGu;
        dbUpdates.gu = gu;
        log(PHASE, `  gu 수정: "${apt.gu}" → "${gu}" (${apt.name})`);
      }

      // DB 수정 적용
      if (!dryRun && Object.keys(dbUpdates).length > 0) {
        await sb.from("apartments").update(dbUpdates).eq("id", apt.id);
      }

      // 1차: 주소 검색 (region + gu + dong)
      const addr = buildAddress(region, gu, apt.dong);
      let result = addr ? await geocode(addr) : null;
      await sleep(100);

      // 2차: 키워드 검색 (region + gu + 단지명)
      if (!result) {
        const keyword = [region, gu, cleanName].filter(Boolean).join(" ");
        result = await geocodeKeyword(keyword);
        await sleep(100);
      }

      // 3차: 단지명만으로 키워드 검색
      if (!result) {
        result = await geocodeKeyword(cleanName);
        await sleep(100);
      }

      // 4차: region + gu만으로 주소 검색 (택지지구/블록 등으로 실패한 경우)
      if (!result && region && gu) {
        result = await geocode(`${region} ${gu}`);
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
      const msg = err instanceof Error ? err.message : String(err);
      logError(PHASE, `${apt.name}: ${msg}`);
      failed++;
    }

    if ((i + 1) % 50 === 0) log(PHASE, `진행: ${i + 1}/${apts.length} (성공 ${geocoded}, 실패 ${failed})`);
  }

  log(PHASE, `\n=== 완료: 성공 ${geocoded}, 실패 ${failed} / 전체 ${apts.length} ===`);
  // 중단(SIGTERM)으로 루프를 끊고 나온 경우는 partial — 성공으로 찍으면 잘린 회차가
  // 정상 완주로 보여 다음 회차가 이어받아야 할 신호를 지운다.
  await recordCollectorRun(PHASE, {
    ok: geocoded, fail: failed, skip: 0,
    elapsed: ((Date.now() - startedMs) / 1000).toFixed(1),
    startedAt,
    status: isInterrupted() ? "partial" : (failed > 0 ? "failure" : "success"),
  });
  if (failed > 0) process.exit(1);
}

const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) ?? "");
if (isCLI) main().catch(err => {
  const msg = err instanceof Error ? err.message : String(err);
  logError(PHASE, msg);
  process.exit(1);
});
