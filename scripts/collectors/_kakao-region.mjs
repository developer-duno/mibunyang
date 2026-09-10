// @ts-check
/**
 * 카카오 **좌표 → 행정구역**(`coord2regioncode`) 공용 헬퍼 — 세션546 PR-F2 §2-A.
 *
 * ## 왜 있나
 *
 * 인천 2026-07-01 개편(중구·동구 → 제물포구·영종구 / 서구 → 서해구·검단구)은 전남광주와 달리
 * 옛 구를 **쪼갠** 것이라 이름·코드 1:1 표를 만들 수 없다. 어느 단지가 제물포인지 영종인지는
 * **좌표로 다시 물어야** 알 수 있다. 그 물음을 이 모듈이 담당한다.
 *
 * ## 계약
 *
 * - HTTP 실패·429 는 `fetchWithRetry` 가 재시도하고, 그래도 안 되면 **throw** 한다.
 *   빈 배열로 삼키지 않는 이유 = 호출자가 "지역을 못 받았다"와 "카카오가 아무것도 모른다"를
 *   구분해 skip 으로 집계해야 하기 때문이다. 조용한 폴백은 0건을 정상처럼 보이게 만든다
 *   (`.claude/rules/collectors/unordered-pagination-loses-rows.md` §3 과 같은 결).
 * - `documents` 가 비면 `[]` — 이건 진짜 "카카오가 그 좌표에 행정구역을 안 준다"이다.
 *
 * ⚠️ `_` 접두 = 라이브러리. graceful/exit-quota/orphan 감사가 자동 제외한다(`_kakao-poi.mjs` 선례).
 *
 * ⚠️ `reverse-geocode.mjs`·`fix-placeholder-addresses.mjs` 에도 같은 호출이 각자 박혀 있다.
 *    이번 PR 은 그 둘을 **건드리지 않는다**(통합은 BACKLOG) — 매일 도는 수집기의 동작을
 *    이 작업의 부수효과로 바꾸지 않는다.
 */
import { fetchWithRetry, sleep } from "./_shared.mjs";

const KAKAO_REGION_URL = "https://dapi.kakao.com/v2/local/geo/coord2regioncode.json";

/**
 * 좌표 하나를 카카오에 물어 행정구역 문서 배열을 받는다.
 *
 * @param {number} lat 위도
 * @param {number} lng 경도
 * @param {string | undefined} kakaoKey REST API 키
 * @param {{ retries?: number, sleepMs?: number }} [opts]
 *   `retries` 는 `fetchWithRetry` 에 그대로(기본 3) · `sleepMs` 는 호출 **뒤** 쉬는 시간(기본 100)
 * @returns {Promise<any[]>} `documents` 배열(빈 응답이면 `[]`)
 * @throws {Error} 재시도 후에도 HTTP 가 실패했을 때 — 호출자가 skip 으로 집계한다
 */
export async function fetchRegionDocs(lat, lng, kakaoKey, { retries = 3, sleepMs = 100 } = {}) {
  if (!kakaoKey) throw new Error("KAKAO_KEY 없음");
  const url = `${KAKAO_REGION_URL}?x=${encodeURIComponent(String(lng))}&y=${encodeURIComponent(String(lat))}`;
  const res = await fetchWithRetry(url, { headers: { Authorization: `KakaoAK ${kakaoKey}` } }, retries);
  const data = await res.json();
  if (sleepMs > 0) await sleep(sleepMs);
  return Array.isArray(data?.documents) ? data.documents : [];
}

/**
 * `documents` 에서 법정동(B) · 행정동(H) 문서를 갈라낸다.
 *
 * 둘의 쓰임이 다르다 — **법정동코드는 B 에서만** 나오고(`bjd_code` 는 건축HUB·학교알리미 조회 키),
 * 화면에 쓰는 동 이름은 H(행정동)를 쓰는 게 `reverse-geocode.mjs` 의 관례다.
 *
 * @param {any[] | null | undefined} documents
 * @returns {{ legal: any | null, admin: any | null }} 없으면 각각 null
 */
export function pickRegionDocs(documents) {
  const docs = Array.isArray(documents) ? documents : [];
  return {
    legal: docs.find((d) => d?.region_type === "B") ?? null,
    admin: docs.find((d) => d?.region_type === "H") ?? null,
  };
}
