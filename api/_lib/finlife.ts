/**
 * finlife 오픈API 공통 모듈 — 주택담보대출/전세자금대출 공유 로직
 * loans.js, rent-loans.js에서 사용
 */

/** 허용 금융권역 코드 */
export const VALID_GROUPS = new Set(["020000", "030200", "030300", "050000"]);

type FinlifeBase = {
  bank: string;
  product: string;
  joinWay: string;
  loanLimit: string;
};

type FinlifeOption = {
  fin_co_no?: string;
  fin_prdt_cd?: string;
  [key: string]: unknown;
};

type FinlifeProduct = {
  bank: string;
  product: string;
  joinWay: string;
  loanLimit: string;
  rateMin?: number;
  [key: string]: unknown;
};

type FetchFinlifeParams = {
  apiKey: string;
  topFinGrpNo: string;
  endpoint: string;
  mapProduct: (_base: FinlifeBase, _option: FinlifeOption) => FinlifeProduct;
};

type FetchFinlifeResult =
  | { data: FinlifeProduct[]; count: number; message?: string; disclosureMonth?: string | null }
  | { error: string; status: number };

/**
 * 공시월(`dcls_month`) 중 가장 최근 값 하나 — finlife 오픈API 명세: baseList·optionList 의
 * `dcls_month` = "공시 제출월 [YYYYMM]". 6자리 숫자·월 1~12 가 아니면 버리고, 맞는 값이 없으면 null
 * (화면은 그 글자만 뺀다). 상품마다 공시월이 다를 수 있어 가장 최근 값을 고른다(세션593 D4).
 */
export function pickDisclosureMonth(list: ReadonlyArray<{ dcls_month?: unknown }>): string | null {
  let best: string | null = null;
  for (const b of list) {
    const s = String(b?.dcls_month ?? "").trim();
    const m = /^(\d{4})(\d{2})$/.exec(s);
    if (!m) continue;
    const month = Number(m[2]);
    if (month < 1 || month > 12) continue;
    if (best == null || s > best) best = s;
  }
  return best;
}

/**
 * finlife API 상품 조회 공통 로직
 */
export async function fetchFinlifeProducts({
  apiKey,
  topFinGrpNo,
  endpoint,
  mapProduct,
}: FetchFinlifeParams): Promise<FetchFinlifeResult> {
  const url = `https://finlife.fss.or.kr/finlifeapi/${endpoint}.json?auth=${apiKey}&topFinGrpNo=${topFinGrpNo}&pageNo=1`;
  const apiRes = await fetch(url);
  if (!apiRes.ok) {
    return { error: "finlife API 응답 오류", status: 502 };
  }

  const json = await apiRes.json() as { result?: { err_cd?: string; err_msg?: string; baseList?: unknown[]; optionList?: unknown[] } };
  const result = json?.result;
  if (!result || result.err_cd !== "000") {
    return { data: [], count: 0, message: result?.err_msg || "데이터 없음" };
  }

  const baseList = (result.baseList ?? []) as Array<{ fin_co_no?: string; fin_prdt_cd?: string; kor_co_nm?: string; fin_prdt_nm?: string; join_way?: string; loan_lmt?: string; dcls_month?: string }>;
  const optionList = (result.optionList ?? []) as FinlifeOption[];

  // baseList → 상품 기본정보 맵
  const productMap = new Map<string, FinlifeBase>();
  for (const b of baseList) {
    productMap.set(`${b.fin_co_no}:${b.fin_prdt_cd}`, {
      bank: b.kor_co_nm ?? "",
      product: b.fin_prdt_nm ?? "",
      joinWay: b.join_way ?? "",
      loanLimit: b.loan_lmt ?? "",
    });
  }

  // optionList → 상품 목록 (엔드포인트별 필드 매핑 적용)
  const products: FinlifeProduct[] = [];
  for (const o of optionList) {
    const key = `${o.fin_co_no}:${o.fin_prdt_cd}`;
    const base = productMap.get(key);
    if (!base) continue;
    products.push(mapProduct(base, o));
  }

  // 금리 낮은 순 정렬
  products.sort((a, b) => (a.rateMin ?? 99) - (b.rateMin ?? 99));

  return { data: products, count: products.length, disclosureMonth: pickDisclosureMonth(baseList) };
}
