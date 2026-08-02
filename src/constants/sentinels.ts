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
