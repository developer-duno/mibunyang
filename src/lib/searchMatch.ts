// 단지명·지역·구 부분일치 검색 매칭.
// 한글은 단순 includes 정규화로 충분(fuzzysort 등은 ASCII 전용이라 한국어 부적합 — oss-first 예외).
// 전각 공백(U+3000) 포함 모든 공백 제거 — 단지명에 전각 공백이 섞인 경우가 실재.
// 정규식 리터럴에 전각 공백을 직접 넣으면 no-irregular-whitespace 린트 에러 → (U+3000) 이스케이프 사용.
const WS = /[\s\u3000]+/g;

/** 검색어 정규화 — 소문자화 + 모든 공백(일반·전각) 제거. 빈 입력 → "". */
export function normalizeQuery(q: string): string {
  return q.toLowerCase().replace(WS, "");
}

// 초성 검색("ㅎㄴ"→한남): 표준 한글 유니코드 산식으로 인라인 구현. 이 파일의 "한국어 검색은 인라인"
// 방침 답습(fuzzysort 등 ASCII 전용 부적합). es-hangul 등 OSS 대체 가능하나 초성 추출은
// 결정적 표준 알고리즘이라 의존성·번들 없이 인라인(oss-first 예외 사유 명시).
// 현대 한글 음절의 초성 19자 (유니코드 배열 순서 그대로).
const CHOSEONG = [
  "ㄱ",
  "ㄲ",
  "ㄴ",
  "ㄷ",
  "ㄸ",
  "ㄹ",
  "ㅁ",
  "ㅂ",
  "ㅃ",
  "ㅅ",
  "ㅆ",
  "ㅇ",
  "ㅈ",
  "ㅉ",
  "ㅊ",
  "ㅋ",
  "ㅌ",
  "ㅍ",
  "ㅎ",
];
const CHOSEONG_SET = new Set(CHOSEONG);
const HANGUL_BASE = 0xac00; // '가'
const HANGUL_LAST = 0xd7a3; // '힣'
const JAMO_PER_CHOSEONG = 588; // 21 중성 × 28 종성

/** 문자열의 각 한글 음절을 초성으로 치환(비한글은 그대로). "한남더힐" → "ㅎㄴㄷㅎ". */
function toChoseong(str: string): string {
  let out = "";
  for (const ch of str) {
    const code = ch.charCodeAt(0);
    if (code >= HANGUL_BASE && code <= HANGUL_LAST) {
      out += CHOSEONG[Math.floor((code - HANGUL_BASE) / JAMO_PER_CHOSEONG)];
    } else {
      out += ch;
    }
  }
  return out;
}

/** 검색어가 전부 초성 자모(ㄱ~ㅎ 자음)면 초성 검색 발동. 빈 문자열·모음·완성형은 false. */
function isChoseongQuery(q: string): boolean {
  if (!q) return false;
  for (const ch of q) {
    if (!CHOSEONG_SET.has(ch)) return false;
  }
  return true;
}

/**
 * 단지명·지역·구 중 하나라도 정규화된 검색어를 부분 포함하면 true.
 * @param normalizedQuery normalizeQuery 를 거친 값. 빈 문자열이면 전체 통과.
 */
export function matchesQuery(apt: { name?: string; region?: string; gu?: string }, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  // name/region/gu 모두 optional + gu 일부 누락 → ?? "" 폴백 필수(undefined 메서드 호출 방지)
  const hay = `${apt.name ?? ""}${apt.region ?? ""}${apt.gu ?? ""}`.toLowerCase().replace(WS, "");
  if (isChoseongQuery(normalizedQuery)) {
    return toChoseong(hay).includes(normalizedQuery);
  }
  return hay.includes(normalizedQuery);
}
