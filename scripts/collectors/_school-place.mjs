// @ts-check
/**
 * 학교 POI 판정 — calc-school-walk.mjs · schools-neis.mjs 공유 모듈
 *
 * 세션567: 두 수집기가 각자 복제해 쓰던 `isSchoolPlace`(이름 화이트리스트)를 이 파일로
 * 옮기고, 카카오 문서 1건이 "초등학교(분교장 포함, 개교 예정 제외)"인지 판정하는
 * `isElementarySchoolDoc` 을 신설한다.
 *
 * 왜 별도 파일인가 — `schools-neis.mjs` 는 최상위에서 `if (!KAKAO_KEY) process.exit(1)` 을
 * 실행하므로, 그 모듈을 직접 import 하면 KAKAO_KEY 미설정 환경(테스트 포함)에서 이 판정
 * 로직까지 함께 죽는다. 부수효과·env 읽기가 전혀 없는 이 파일만 공유한다.
 *
 * 사장님 결정(2026-09-23) 근거 — 카카오 keyword.json "초등학교" 라이브 실측:
 *   - `인천영종초등학교 금산분교장` → category_name "교육,학문 > 학교 > 초등학교" (SC4)
 *     ← 이름이 "학교"로 끝나야 하는 옛 isSchoolPlace 가 이걸 버렸다.
 *   - `탄방초등학교 용문분교장` → 같은 분류, 2025-09-01 개교, 운영 중.
 *   - `미단초중학교 (2028년 3월 예정)` → 같은 분류지만 **개교 예정이라 제외**해야 한다.
 *   - `인천영종초등학교 금산분교장 교무실` → "학교부속시설", `…병설유치원` → "유치원",
 *     `세븐일레븐 …초교점` → 편의점, `도성초교교차로` → 교차로. 전부 분류로 걸러진다.
 */

/** 정상 학교는 반드시 "학교"로 끝남 (부속시설·비학교 POI 자동 제외) */
export const SCHOOL_SUFFIX_RE = /(?:초등학교|중학교|고등학교|학교)$/;

/** @param {string} name */
export const isSchoolPlace = (name) => typeof name === "string" && SCHOOL_SUFFIX_RE.test(name.trim());

/** 카카오 category_name 이 "…학교 > 초등학교"로 끝나는가 (분교장 포함 판정용) */
const ELEM_CATEGORY_RE = /학교\s*>\s*초등학교$/;
/** 이름이 "분교장" 또는 "분교"로 끝나는가 */
const BRANCH_SCHOOL_RE = /분교장?$/;
/** 개교 예정 표기 — "가칭", "(…예정…)", "[…예정…]" */
const PLANNED_SCHOOL_RE = /가칭|\([^)]*예정[^)]*\)|\[[^\]]*예정[^\]]*\]/;

/**
 * 카카오 keyword.json 문서 1건이 "진짜 초등학교(분교장 포함, 개교 예정 제외)"인지 판정한다.
 * 기존 이름 화이트리스트(isSchoolPlace)를 **합집합**으로 보존한다 — 분류만으로 좁히면
 * 측정하지 않은 회귀가 생긴다. 예정 학교 제외만 의도된 동작 변화다.
 * @param {{ place_name?: string, category_name?: string } | null | undefined} doc
 * @returns {boolean}
 */
export function isElementarySchoolDoc(doc) {
  const name = typeof doc?.place_name === "string" ? doc.place_name.trim() : "";
  if (!name || PLANNED_SCHOOL_RE.test(name)) return false;
  if (isSchoolPlace(name)) return true;
  const category = typeof doc?.category_name === "string" ? doc.category_name : "";
  return ELEM_CATEGORY_RE.test(category) && BRANCH_SCHOOL_RE.test(name);
}
