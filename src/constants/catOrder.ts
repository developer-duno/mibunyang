import type { Category } from "./profiles";

/**
 * 화면에 6카테고리를 그리는 **표시 순서의 단일 출처**.
 *
 * 왜 필요한가 — 이 상수가 생기기 전 화면 순서는 `Object.entries(res.cats)`,
 * 즉 서버 `catsCache` JSON 의 **키 직렬화 순서**였다(실측 1,581행 전부
 * `risk>price>future>benefit>product>location`). 이것은 약속된 계약이 아니라
 * 수집기가 필드 대입 순서를 바꾸면 소리 없이 뒤집히는 부산물이고, 그때
 * red 가 되는 테스트가 하나도 없었다. 게다가 폴백 경로(`calcCats`)는
 * 순서가 달라(`price>location>product>benefit>risk>future`) `catsCache`
 * 누락 단지만 다른 순서로 그려졌다.
 *
 * 순서 근거 — 파랑(입지 `#2563EB`)과 보라(상품 `#7C3AED`)가 인접하면
 * 색각이상에서 구분되지 않아, 그 사이에 앰버(혜택 `#D97706`)를 끼웠다.
 * hex 값은 하나도 바꾸지 않는다(`theme/index.ts` `catCol` 그대로).
 *
 * ⚠️ `profiles.ts` 의 `CAT_TIEBREAK_ORDER` 와 **다른 목적**이다.
 * 저쪽은 가중치 동점 시 어느 카테고리를 먼저 고를지의 tie-break 이고,
 * 이쪽은 고른 것을 화면에 어느 차례로 그릴지다. 순서도 서로 다르다.
 */
export const CAT_DISPLAY_ORDER: readonly Category[] = ["price", "location", "benefit", "product", "risk", "future"];

/**
 * cats 객체를 `CAT_DISPLAY_ORDER` 차례의 `[key, value]` 배열로 바꾼다.
 * 입력 객체의 키 순서는 **무시**한다 — 그게 이 함수의 존재 이유다.
 * 값이 없는(null/undefined) 카테고리는 건너뛴다(부분 데이터 방어).
 */
export function orderedCatEntries<T>(
  cats: Record<string, T | undefined | null> | null | undefined
): Array<[Category, T]> {
  if (!cats) return [];
  const out: Array<[Category, T]> = [];
  for (const k of CAT_DISPLAY_ORDER) {
    const v = cats[k];
    if (v != null) out.push([k, v]);
  }
  return out;
}
