/**
 * finlife 오픈API 공통 모듈 — 주택담보대출/전세자금대출 공유 로직
 * loans.js, rent-loans.js에서 사용
 */

/** 허용 금융권역 코드 */
export const VALID_GROUPS = new Set(["020000", "030200", "030300", "050000"]);

/**
 * finlife API 상품 조회 공통 로직
 * @param {object} params
 * @param {string} params.apiKey - FINLIFE_API_KEY
 * @param {string} params.topFinGrpNo - 금융권역 코드
 * @param {string} params.endpoint - finlife API 엔드포인트명 (예: "mortgageLoanProductsSearch")
 * @param {function} params.mapProduct - optionList 항목을 응답 객체로 변환하는 함수 (base, option) => object
 * @returns {Promise<{data: Array, count: number} | {error: string, status: number}>}
 */
export async function fetchFinlifeProducts({ apiKey, topFinGrpNo, endpoint, mapProduct }) {
  const url = `https://finlife.fss.or.kr/finlifeapi/${endpoint}.json?auth=${apiKey}&topFinGrpNo=${topFinGrpNo}&pageNo=1`;
  const apiRes = await fetch(url);
  if (!apiRes.ok) {
    return { error: "finlife API 응답 오류", status: 502 };
  }

  const json = await apiRes.json();
  const result = json?.result;
  if (!result || result.err_cd !== "000") {
    return { data: [], count: 0, message: result?.err_msg || "데이터 없음" };
  }

  const baseList = result.baseList ?? [];
  const optionList = result.optionList ?? [];

  // baseList → 상품 기본정보 맵
  const productMap = new Map();
  for (const b of baseList) {
    productMap.set(`${b.fin_co_no}:${b.fin_prdt_cd}`, {
      bank: b.kor_co_nm ?? "",
      product: b.fin_prdt_nm ?? "",
      joinWay: b.join_way ?? "",
      loanLimit: b.loan_lmt ?? "",
    });
  }

  // optionList → 상품 목록 (엔드포인트별 필드 매핑 적용)
  const products = [];
  for (const o of optionList) {
    const key = `${o.fin_co_no}:${o.fin_prdt_cd}`;
    const base = productMap.get(key);
    if (!base) continue;
    products.push(mapProduct(base, o));
  }

  // 금리 낮은 순 정렬
  products.sort((a, b) => (a.rateMin ?? 99) - (b.rateMin ?? 99));

  return { data: products, count: products.length };
}
