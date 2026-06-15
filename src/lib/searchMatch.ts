// 단지명·지역·구 부분일치 검색 매칭.
// 한글은 단순 includes 정규화로 충분(fuzzysort 등은 ASCII 전용이라 한국어 부적합 — oss-first 예외).
// 전각 공백(U+3000) 포함 모든 공백 제거 — 단지명에 전각 공백이 섞인 경우가 실재.
// 정규식 리터럴에 전각 공백을 직접 넣으면 no-irregular-whitespace 린트 에러 → (U+3000) 이스케이프 사용.
const WS = /[\s\u3000]+/g;

/** 검색어 정규화 — 소문자화 + 모든 공백(일반·전각) 제거. 빈 입력 → "". */
export function normalizeQuery(q: string): string {
  return q.toLowerCase().replace(WS, "");
}

/**
 * 단지명·지역·구 중 하나라도 정규화된 검색어를 부분 포함하면 true.
 * @param normalizedQuery normalizeQuery 를 거친 값. 빈 문자열이면 전체 통과.
 */
export function matchesQuery(
  apt: { name?: string; region?: string; gu?: string },
  normalizedQuery: string,
): boolean {
  if (!normalizedQuery) return true;
  // name/region/gu 모두 optional + gu 일부 누락 → ?? "" 폴백 필수(undefined 메서드 호출 방지)
  const hay = `${apt.name ?? ""}${apt.region ?? ""}${apt.gu ?? ""}`.toLowerCase().replace(WS, "");
  return hay.includes(normalizedQuery);
}
