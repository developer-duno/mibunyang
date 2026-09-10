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
 *   node scripts/collectors/reverse-geocode.mjs                  (address 가 비어 있는 단지만)
 *   node scripts/collectors/reverse-geocode.mjs --dry-run        (미리보기만)
 *   node scripts/collectors/reverse-geocode.mjs --only-null-bjd  (bjd_code 가 비어 있는 단지만)
 *
 * ⛔ `--force` 는 **좌표 있는 전 단지**를 카카오 값으로 덮어쓴다(세션546 H1).
 *   갱신 필드가 `region·gu·dong·address·road_address·bjd_code·lot_main·lot_sub`(+`district`)
 *   전부라, 세션539~544 가 209곳에 손으로 박은 **`address`(정답 출처 표기)와 `district` 결정이
 *   통째로 지워진다**. 되돌릴 길이 없다(다시 force 해도 카카오 값이 다시 박힌다).
 *   위험의 정체는 **덮어쓰기 범위**이지 특정 코드값이 아니다 — 전남광주통합특별시 `12…` 는
 *   2026-07-01 출범 이후 **새 정답 코드**이고 코드표·저장 데이터가 이미 그리로 옮겨졌다(PR-E).
 *   비어 있는 bjd_code 를 채우는 게 목적이면 `--only-null-bjd` 를 쓴다.
 *   그래도 전량 덮어써야 하면 `--force --i-know-overwrite-all` 로 **두 개를 함께** 준다.
 */
import { loadEnv, getSupabase, log, logError, sleep, setupGracefulShutdown, recordCollectorRun, selectAll, resolveRegionName, VALID_REGIONS, normalizeGu } from "./_shared.mjs";

loadEnv();

const PHASE = "reverse-geocode";
const KAKAO_KEY = process.env.KAKAO_KEY;
if (!KAKAO_KEY) { logError(PHASE, "KAKAO_KEY 환경변수 필요"); process.exit(1); }

const DISTRICT_PATTERNS = /지구|구역|뉴타운|택지|단지|블록|BL$/;

/** `--force`(전량 덮어쓰기)를 열려면 함께 줘야 하는 확인 플래그. */
export const OVERWRITE_ACK_FLAG = "--i-know-overwrite-all";

/**
 * 인자로 대상 범위를 정하고 `--force` 를 게이트한다 (세션546 H1).
 *
 * ⚠️ 이름을 `--i-know-jeonnam-gwangju` 로 두지 않는다 — 위험의 정체가 전남·광주 코드가 아니라
 * **전량 덮어쓰기**이기 때문. 이름이 근거를 잘못 말하면 다음 사람이 "PR-E 로 코드가 정리됐으니
 * 이제 안전하다" 고 오독한다.
 *
 * ⚠️ 순수 함수로 뺀 이유 = main 을 돌리지 않고도 인자 조합을 시험하기 위해서다.
 * @param {string[]} argv
 * @returns {{ ok: true, scope: "null-address" | "null-bjd" | "all" } | { ok: false, reason: string }}
 */
export function resolveTargetScope(argv) {
  const force = argv.includes("--force");
  const onlyNullBjd = argv.includes("--only-null-bjd");
  if (force && onlyNullBjd) {
    return {
      ok: false,
      reason: "--force 와 --only-null-bjd 는 함께 못 쓴다 — 전량 덮어쓰기와 빈 칸 채우기 중 하나만 고르라.",
    };
  }
  if (force) {
    if (!argv.includes(OVERWRITE_ACK_FLAG)) {
      return {
        ok: false,
        reason:
          `--force 는 좌표 있는 **전 단지**의 region/gu/dong/address/road_address/bjd_code/lot 를 ` +
          `카카오 값으로 덮어쓴다. 세션539~544 가 209곳에 박은 address 출처 표기·district 결정이 ` +
          `되돌릴 수 없이 지워진다. bjd_code 를 채우려는 것이면 --only-null-bjd 를 쓰라. ` +
          `그래도 전량 덮어써야 하면 ${OVERWRITE_ACK_FLAG} 를 함께 주라.`,
      };
    }
    return { ok: true, scope: "all" };
  }
  if (onlyNullBjd) return { ok: true, scope: "null-bjd" };
  return { ok: true, scope: "null-address" };
}

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
  // ⚠️ DB 에 손대기 전에(=getSupabase 앞에) 게이트한다 — 세션546 H1.
  const scoped = resolveTargetScope(process.argv);
  if (!scoped.ok) {
    logError(PHASE, scoped.reason);
    process.exit(1);
  }
  const scope = scoped.scope;
  if (scope === "all") {
    log(PHASE, "⚠️ --force: 좌표 있는 전 단지를 카카오 값으로 덮어쓴다(손으로 박은 address·district 소실).");
  }
  if (dryRun) log(PHASE, "=== DRY-RUN 모드 ===");

  // 세션 504: 매일·매주 도는데 collector_runs 행이 0개라 감시가 이 수집기를 못 봤다.
  const startedMs = Date.now();
  const startedAt = new Date().toISOString();
  const sb = getSupabase();
  const isInterrupted = setupGracefulShutdown(PHASE);  // 세션 344: graceful shutdown

  // 좌표 있는 단지 조회 — 범위는 위 `resolveTargetScope` 가 정한다.
  //   null-address(기본) = address 가 빈 단지 / null-bjd = bjd_code 가 빈 단지 / all = 전량(--force)
  // ⚠️ 대상 선정은 **쿼리**에서, 17지역 검증은 **응답 처리**에서 한다(세션545 VALID_REGIONS).
  // 세션534: 무정렬 OFFSET → 고유키(id) 커서 (unordered-pagination-loses-rows.md §1).
  // WHERE 필터(.not lat·.not lng, 선택적 .is address null)는 콜백에 그대로 유지.
  // selectAll 은 error 시 throw — 옛 throw 시맨틱과 동일.
  const apts = /** @type {any[]} */ (/** @type {unknown} */ (
    await selectAll(
      (s) => {
        let q = s
          .from("apartments")
          .select("id, name, dong, gu, region, lat, lng, address")
          .not("lat", "is", null)
          .not("lng", "is", null);
        if (scope === "null-address") q = q.is("address", null);
        else if (scope === "null-bjd") q = q.is("bjd_code", null);
        return q;
      },
      sb,
      "id",
    )
  ));

  log(PHASE, `대상: ${apts.length}건`);
  if (apts.length === 0) {
    log(PHASE, scope === "null-bjd" ? "모든 단지에 법정동코드 있음" : "모든 단지에 주소 있음");
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

  let updated = 0, failed = 0;
  // 카카오가 17지역 밖 시도명을 줘 건너뛴 수 (세션545 — 실패가 아니라 skip 이다)
  let invalidRegion = 0;

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
      region = normalizeRegion(region, gu);

      // ⚠️ `normalizeRegion` 은 못 가르면 **원문을 그대로 돌려준다**(`?? name`). 그 값을 그대로
      //    쓰면 `apartments.region` 에 17지역 밖 문자열이 박힌다 — 실제로 카카오가 주는
      //    "전남광주통합특별시" 가 6곳에 그렇게 들어갔고(세션545 정정), 그 행은 화면의 지역
      //    필터 어디에도 안 잡히고 지역 지표 조인도 끊긴다. 표준 17개가 아니면 **쓰지 않는다**.
      if (!VALID_REGIONS.includes(region)) {
        logError(PHASE, `region 미확정 — 건너뜀: ${apt.name} (카카오 "${region}", gu="${gu ?? ""}")`);
        invalidRegion++;
        continue;
      }

      // ⚠️ gu 정규화는 **여기**여야 한다(세션546). 두 조건이 위치를 못 박는다:
      //    ① `region` 이 17지역 약칭으로 확정된 **뒤**여야 한다 — 별칭표 키가 `약칭|표기` 라
      //       카카오 원문("경기도")으로는 절대 안 맞는다(`normalizeGu("경기도","화성시 동탄구")` 무변경 실측).
      //    ② 그런데 L145 `normalizeRegion(region, gu)` 는 gu 를 **인자로 받아** 지역을 가르므로
      //       그 앞에서 gu 를 바꾸면 지역 판정 자체가 달라진다. 그래서 그 뒤·`updates` 앞.
      //    이 한 줄이 없으면 매일 도는 이 수집기가 카카오 원문("화성특례시"·"화성시 동탄구")을
      //    그대로 저장해 표기 혼재가 **재발**한다(세션546 실측 5곳).
      gu = normalizeGu(region, gu) || null;

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
  // 중단(SIGTERM)으로 루프를 끊고 나온 경우는 partial — 성공으로 찍으면 잘린 회차가
  // 정상 완주로 보여 다음 회차가 이어받아야 할 신호를 지운다.
  await recordCollectorRun(PHASE, {
    ok: updated, fail: failed, skip: invalidRegion,
    elapsed: ((Date.now() - startedMs) / 1000).toFixed(1),
    startedAt,
    status: isInterrupted() ? "partial" : (failed > 0 ? "failure" : "success"),
  });
  if (failed > 0) process.exit(1);
}

/**
 * 시도명 정규화 — 카카오 `region_1depth_name` → 우리 17지역 약칭.
 *
 * 세션545: 통합 시도("전남광주통합특별시")는 시도 이름만으로 못 가르므로 `gu`(2depth)를 받아
 * `resolveRegionName` 에 넘긴다. gu 가 없으면 원문 그대로 — 조용히 한쪽으로 붙이지 않는다.
 *
 * @param {string} name
 * @param {string | null} [gu]
 * @returns {string}
 */
export function normalizeRegion(name, gu = null) {
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
  return (
    /** @type {Record<string, string>} */ (map)[name] ??
    resolveRegionName(name, gu) ??
    name
  );
}

const argv1 = process.argv[1];
const isCLI = argv1 && import.meta.url.endsWith((argv1.replace(/\\/g, "/").split("/").pop()) ?? "");
if (isCLI) main().catch(err => {
  const msg = err instanceof Error ? err.message : String(err);
  logError(PHASE, msg);
  process.exit(1);
});
