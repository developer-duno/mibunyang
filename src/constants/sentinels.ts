/**
 * 센티널 — "값이 있는 척하는 미수집".
 *
 * DB VIEW 가 COALESCE 로 채워 넣은 기본값이라 숫자로는 멀쩡해 보이지만
 * 실제로는 "측정 반경 밖" 또는 "미수집"을 뜻한다. 이걸 진짜 값으로 오해하면
 * 편차 막대가 "지하철 9,999m" 같은 거짓을 그린다.
 *
 * ⚠️ **진실의 원천은 여기 하나**여야 한다.
 * `scripts/collectors/data-audit.mjs` 의 `MASKED_DEFAULTS` 와 값이 어긋나면
 * 화면(이 파일)과 채움률 감사(그쪽)가 서로 다른 말을 하게 되므로,
 * `sentinels.test.ts` 가 두 파일의 값이 같은지 매 CI 에서 대조한다.
 */
export const SENTINEL = {
  subwayDist: 9999,
  icDist: 99,
  ktxDist: 99,
} as const;

export type SentinelField = keyof typeof SENTINEL;

/**
 * 센티널이 뜻하는 "찾아본 반경"(km) — 화면이 "N km 안에 없음"으로 적는 데 쓴다(세션591).
 *
 * 센티널은 "모름"이 아니라 **수집기가 이 반경을 찾아봤는데 없었다**는 뜻이다
 * (`scripts/collectors/transport-tago.mjs` 의 `RADIUS` — 지하철 10km · IC·KTX 20km).
 * 그래서 "미수집"이 아니라 "20km 안에 없음"이 사실이다.
 * ⚠️ 수집기 반경을 바꾸면 여기도 같이 바꿔야 한다 — `sentinels.test.ts` 가 두 파일을 대조한다.
 */
export const SENTINEL_RADIUS_KM: Readonly<Record<SentinelField, number>> = {
  subwayDist: 10,
  icDist: 20,
  ktxDist: 20,
};

/**
 * 개수 칸(`countField`)이 있는 시설의 "찾아본 반경"(m) — 세션675 B16(👤 결정 마의 같은 원칙: 화면 글이 사실과 달라서).
 *
 * 수집기는 이 반경 안을 찾아 개수와 가장 가까운 거리를 쓴다. 반경 안에 하나도 없으면 개수 0 · 거리 null 이다
 * (운영 정적 자료 1,678곳 실측 — 거리 빈 줄 2,455개가 전부 개수 0). 그래서 화면은 그 줄을 「미수집」이 아니라
 * 「{반경} 안에 없음」으로 적는다(위 센티널 「10km 안에 없음」과 같은 꼴). 개수도 null 이면 찾아본 적이 없어 줄을 안 그린다.
 *
 * ⚠️ 수집기 상수의 **사본**이다 — `src/` 는 `scripts/` 를 import 하지 못한다(수집기는 최상위에서 env·DB 를 열고,
 *    Vercel 빌드는 `scripts/` 를 싣지 않는다). 그래서 `sentinels.test.ts` 가 수집기 파일 글자를 읽어 대조한다:
 *    infra-kakao.mjs `CATEGORIES` · collect-childcare.mjs(어린이집·유치원 반경) · collect-police.mjs `RADIUS`.
 * 응급의료(`emergencyDist`)는 없다 — 그 수집기는 거리를 반경 없이 가장 가까운 곳으로 재고 개수만 10km 안이라,
 *    거리 null 이면 "안 재본 것"이다(줄을 안 그린다).
 */
export const COUNT_SEARCH_RADIUS_M: Readonly<Record<string, number>> = {
  convDist: 500,
  cafeDist: 500,
  pharmacyDist: 500,
  hospitalDist: 1000,
  martDist: 1000,
  cultureDist: 1000,
  bankDist: 1000,
  parkDist: 1000,
  childcareDist: 1000,
  policeDist: 3000,
};

/**
 * 카카오 인프라 수집기(infra-kakao.mjs `CATEGORIES`)가 한 번에 채우는 8종의 거리 필드 — 세션675 B16c.
 * 8종 거리가 **전부** null 이면 그 수집기가 이 단지를 한 번도 찾아본 적이 없다(개수 칸 DEFAULT 0 + 다른 수집기의
 * `updated_at` 갱신 때문에 신선도 판정 `buildFreshIds` 가 영영 건너뜀 — 운영 12곳, 메인 10/30 실측). 그때 개수 0 은
 * "찾아봤는데 0곳"이 아니라 기본값이라, 8줄 모두 「안에 없음」 대신 숨긴다. 한 종이라도 거리가 있으면 찾아본 것이다.
 */
export const KAKAO_INFRA_DIST_FIELDS: readonly string[] = [
  "hospitalDist",
  "martDist",
  "convDist",
  "cafeDist",
  "cultureDist",
  "bankDist",
  "pharmacyDist",
  "parkDist",
];

/**
 * 이 값이 센티널(= 사실상 미수집)인가.
 *
 * `>=` 로 보는 이유 — 마스킹 값 이상은 전부 "반경 밖"이라는 뜻이지
 * 9,999m 와 10,500m 를 구분하는 게 의미 있는 게 아니다.
 * 센티널 목록에 없는 필드는 항상 false (일반 필드는 이 개념이 없다).
 */
export function isSentinel(field: string, value: unknown): boolean {
  if (!(field in SENTINEL)) return false;
  const n = Number(value);
  if (!Number.isFinite(n)) return false;
  return n >= SENTINEL[field as SentinelField];
}
