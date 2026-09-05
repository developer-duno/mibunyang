// @ts-check
/**
 * 좌표 누락 단지 지오코딩 — Kakao 단지명 키워드(게이트 통과분만)
 *
 * apartments 테이블에서 lat/lng 가 null 인 단지를 찾아 **단지명**으로 좌표를 찾는다.
 *
 * 단계: 단지명 키워드(`geocodeApartmentByName`) 단 하나. **주소검색은 하지 않는다** —
 *   지번 없는 질의(`경기 고양시 덕양구`)는 카카오가 중심점만 돌려주고 그건 자리표시다.
 *
 * ⚠️ 키워드 결과는 **검증 없이 채택하지 않는다**(세션541). 카테고리(아파트/주택, 모델하우스
 * 제외) · 시도+시군구 일치 · 이름 유사도 0.7(약함은 시군구 게이트를 실제로 거쳤을 때만)를
 * `_kakao-poi.mjs` 가 건다. 이름이 안 잡히면 질의의 지역명이 지배해 **구청 좌표**가 1위로
 * 올라오고, `reverse-geocode.mjs` 가 그걸 지번·도로명까지 갖춘 가짜 주소로 세탁했다
 * (세션539~540: 314곳 발견 → 209곳 정정, 최대 131km).
 *
 * ⚠️ 옛 주소검색 단계(1차 `region gu dong` = **동 중심점**, 4차 `region gu` = **시군구 중심점**)는
 * 둘 다 삭제했다. 그건 그 단지의 좌표가 아니라 자리표시인데, 저장되는 순간 위 세탁 경로를
 * 그대로 타서 가짜 주소가 된다. 좌표를 모르면 **정직한 null** 이 낫다.
 *
 * ⚠️ 그래서 "못 찾음"은 **실패가 아니라 skip**(미확정)이다. 실패로 세면 좌표 미상 단지가 하나만
 * 남아도 `exit 1` 이 되고, `collect-naver-listings.yml` 의 뒤 step(reverse-geocode·전용률…)이
 * 매일 통째로 건너뛰어진다.
 *
 * 사용법:
 *   node scripts/collectors/geocode-missing.mjs              (Supabase UPDATE)
 *   node scripts/collectors/geocode-missing.mjs --dry-run    (미리보기만)
 */
import { loadEnv, getSupabase, log, logError, setupGracefulShutdown, recordCollectorRun } from "./_shared.mjs";
import { shortRegion, geocodeApartmentByName, fetchKakaoKeywordDocs } from "./_kakao-poi.mjs";

loadEnv();

const PHASE = "geocode";
const KAKAO_KEY = process.env.KAKAO_KEY;
if (!KAKAO_KEY) { logError(PHASE, "KAKAO_KEY 환경변수 필요"); process.exit(1); }

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
    .select("id, name, gu, region")
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

  // 세션541: notFound(미확정)를 failed 와 **가른다**. 게이트를 통과한 후보가 없어 좌표를
  // null 로 둔 것은 정상 결과이지 실패가 아니다 — 파일 머리 주석의 exit 1 사고 참조.
  let geocoded = 0, notFound = 0, failed = 0;

  for (let i = 0; i < apts.length; i++) {
    if (isInterrupted()) break;  // 세션 344: graceful shutdown
    const apt = apts[i];
    try {
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

      // 단지명 키워드 — 게이트(카테고리·시도+시군구·이름 유사도)를 통과한 후보만.
      const byName = await geocodeApartmentByName(
        { name: apt.name, sido: shortRegion(region), gu }, // 이름 정리(괄호·회차어)는 안에서 한다
        { fetchDocs: (q) => fetchKakaoKeywordDocs(q, KAKAO_KEY) },
      );

      if (byName) {
        log(PHASE, `  [키워드 ${byName.tier}] ${apt.name} → ${byName.placeName}`);
        if (dryRun) {
          log(PHASE, `  [DRY] ${apt.name}: ${byName.lat}, ${byName.lng}`);
        } else {
          const { error: uErr } = await sb
            .from("apartments")
            .update({ lat: byName.lat, lng: byName.lng })
            .eq("id", apt.id);
          if (uErr) { logError(PHASE, `${apt.name}: ${uErr.message}`); failed++; continue; }
        }
        geocoded++;
      } else {
        log(PHASE, `  [미확정] ${apt.name} — 게이트 통과 후보 없음, 좌표 null 유지`);
        notFound++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError(PHASE, `${apt.name}: ${msg}`);
      failed++;
    }

    if ((i + 1) % 50 === 0) log(PHASE, `진행: ${i + 1}/${apts.length} (성공 ${geocoded}, 미확정 ${notFound}, 실패 ${failed})`);
  }

  log(PHASE, `\n=== 완료: 성공 ${geocoded}, 미확정 ${notFound}, 실패 ${failed} / 전체 ${apts.length} ===`);
  // 중단(SIGTERM)으로 루프를 끊고 나온 경우는 partial — 성공으로 찍으면 잘린 회차가
  // 정상 완주로 보여 다음 회차가 이어받아야 할 신호를 지운다.
  await recordCollectorRun(PHASE, {
    ok: geocoded, fail: failed, skip: notFound,
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
