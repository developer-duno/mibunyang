// @ts-check
/**
 * 역지오코딩 수집기 — Kakao 좌표→주소 변환
 *
 * 좌표가 있는 단지의 region/gu/dong/address/road_address + bjd_code/lot 정보 갱신
 * 기존 dong에 "구역"/"지구"/"뉴타운" 등이 있으면 district 필드로 이동
 * bjd_code: 법정동코드 10자리 (건축HUB API 조회용)
 * lot_main/lot_sub: 지번 본번/부번 (건축HUB API 조회용)
 *
 * 사용법:
 *   node scripts/collectors/reverse-geocode.mjs              (Supabase UPDATE)
 *   node scripts/collectors/reverse-geocode.mjs --dry-run    (미리보기만)
 *   node scripts/collectors/reverse-geocode.mjs --force      (이미 주소 있어도 재수행)
 */
import { loadEnv, getSupabase, log, logError, sleep, setupGracefulShutdown } from "./_shared.mjs";

loadEnv();

const PHASE = "reverse-geocode";
const KAKAO_KEY = process.env.KAKAO_KEY;
if (!KAKAO_KEY) { logError(PHASE, "KAKAO_KEY 환경변수 필요"); process.exit(1); }

const DISTRICT_PATTERNS = /지구|구역|뉴타운|택지|단지|블록|BL$/;

/**
 * Kakao 역지오코딩: 좌표→행정구역
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<{admin: any, legal: any} | null>}
 */
async function reverseGeocode(lat, lng) {
  const url = `https://dapi.kakao.com/v2/local/geo/coord2regioncode.json?x=${lng}&y=${lat}`;
  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${KAKAO_KEY}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const docs = /** @type {Array<{region_type: string}>} */ (data.documents || []);
  // H=행정동, B=법정동
  const admin = docs.find(d => d.region_type === "H");
  const legal = docs.find(d => d.region_type === "B");
  return { admin, legal };
}

/**
 * Kakao 좌표→도로명주소
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<{address: string|null, roadAddress: string|null, lotMain: number|null, lotSub: number} | null>}
 */
async function coordToAddress(lat, lng) {
  const url = `https://dapi.kakao.com/v2/local/geo/coord2address.json?x=${lng}&y=${lat}`;
  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${KAKAO_KEY}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const doc = data.documents?.[0];
  if (!doc) return null;
  const mainNo = doc.address?.main_address_no;
  const subNo = doc.address?.sub_address_no;
  return {
    address: doc.address?.address_name || null,
    roadAddress: doc.road_address?.address_name || null,
    lotMain: mainNo ? parseInt(mainNo, 10) || null : null,
    lotSub: subNo && subNo !== "" && subNo !== "0" ? parseInt(subNo, 10) : 0,
  };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const force = process.argv.includes("--force");
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  const sb = getSupabase();
  const isInterrupted = setupGracefulShutdown(PHASE);  // 세션 344: graceful shutdown

  // 좌표 있는 단지 조회 (address가 없거나 --force) — 페이지네이션 1000 행/배치
  const PAGE_SIZE = 1000;
  const apts = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    let q = sb.from("apartments").select("id, name, dong, gu, region, lat, lng, address");
    if (!force) q = q.is("address", null);
    q = q.not("lat", "is", null).not("lng", "is", null).range(offset, offset + PAGE_SIZE - 1);
    const { data, error } = await q;
    if (error) throw new Error(`apartments 조회 실패: ${error.message}`);
    if (!data || data.length === 0) break;
    apts.push(...data);
    if (data.length < PAGE_SIZE) break;
  }

  log(PHASE, `대상: ${apts.length}건`);
  if (apts.length === 0) { log(PHASE, "모든 단지에 주소 있음"); return; }

  let updated = 0, failed = 0;

  for (let i = 0; i < apts.length; i++) {
    if (isInterrupted()) break;  // 세션 344: graceful shutdown
    const apt = apts[i];
    try {
      // 역지오코딩
      const geo = await reverseGeocode(apt.lat, apt.lng);
      await sleep(80);
      const addr = await coordToAddress(apt.lat, apt.lng);
      await sleep(80);

      if (!geo?.admin) { failed++; continue; }

      const admin = geo.admin;
      let region = admin.region_1depth_name;
      let gu = admin.region_2depth_name || null;
      let dong = admin.region_3depth_name || null;

      // 세종특별자치시: gu가 없음
      if (region === "세종특별자치시") {
        region = "세종";
        gu = null;
      }

      // region 정규화 (예: "충청북도" → "충북")
      region = normalizeRegion(region);

      // 기존 dong에 특수 지역명이 있으면 district로 이동
      let district = null;
      if (apt.dong && DISTRICT_PATTERNS.test(apt.dong)) {
        district = apt.dong;
      }

      // 법정동코드 (건축HUB API 조회에 필요)
      const bjdCode = geo?.legal?.code ?? null;
      if (!bjdCode) log(PHASE, `  ⚠ ${apt.name}: 법정동코드 없음 (좌표 정밀도 부족)`);

      const updates = {
        region,
        gu,
        dong,
        address: addr?.address || null,
        road_address: addr?.roadAddress || null,
        bjd_code: bjdCode,
        lot_main: addr?.lotMain ?? null,
        lot_sub: addr?.lotSub ?? 0,
        ...(district ? { district } : {}),
      };

      if (dryRun) {
        log(PHASE, `  [DRY] ${apt.name}: ${region} ${gu || ""} ${dong || ""} | ${addr?.address || "?"} | bjd=${bjdCode} lot=${addr?.lotMain}-${addr?.lotSub}`);
      } else {
        const { error: uErr } = await sb.from("apartments").update(updates).eq("id", apt.id);
        if (uErr) { logError(PHASE, `${apt.name}: ${uErr.message}`); failed++; continue; }
      }
      updated++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError(PHASE, `${apt.name}: ${msg}`);
      failed++;
    }

    if ((i + 1) % 100 === 0) log(PHASE, `진행: ${i + 1}/${apts.length} (갱신 ${updated})`);
  }

  log(PHASE, `\n=== 완료: 갱신 ${updated}, 실패 ${failed} / 전체 ${apts.length} ===`);
  if (failed > 0) process.exit(1);
}

/**
 * 시도명 정규화
 * @param {string} name
 * @returns {string}
 */
export function normalizeRegion(name) {
  const map = {
    "서울특별시": "서울", "부산광역시": "부산", "대구광역시": "대구",
    "인천광역시": "인천", "광주광역시": "광주", "대전광역시": "대전",
    "울산광역시": "울산", "세종특별자치시": "세종",
    "경기도": "경기", "강원특별자치도": "강원", "강원도": "강원",
    "충청북도": "충북", "충청남도": "충남",
    "전라북도": "전북", "전북특별자치도": "전북",
    "전라남도": "전남",
    "경상북도": "경북", "경상남도": "경남",
    "제주특별자치도": "제주",
  };
  return /** @type {Record<string, string>} */ (map)[name] || name;
}

const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) ?? "");
if (isCLI) main().catch(err => {
  const msg = err instanceof Error ? err.message : String(err);
  logError(PHASE, msg);
  process.exit(1);
});
