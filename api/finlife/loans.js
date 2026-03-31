import { withHandler } from "../_lib/handler.js";

/** 허용 금융권역 코드 */
const VALID_GROUPS = new Set(["020000", "030200", "030300", "050000"]);

export default withHandler({ method: "GET", handler: async (req, res) => {
  const apiKey = process.env.FINLIFE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ ok: false, error: "FINLIFE_API_KEY not configured" });
  }

  const topFinGrpNo = (req.query?.topFinGrpNo || "020000").trim();
  if (!VALID_GROUPS.has(topFinGrpNo)) {
    return res.status(400).json({ ok: false, error: "유효하지 않은 금융권역 코드입니다" });
  }

  try {
    const url = `https://finlife.fss.or.kr/finlifeapi/mortgageLoanProductsSearch.json?auth=${apiKey}&topFinGrpNo=${topFinGrpNo}&pageNo=1`;
    const apiRes = await fetch(url);
    if (!apiRes.ok) {
      return res.status(502).json({ ok: false, error: "finlife API 응답 오류" });
    }

    const json = await apiRes.json();
    const result = json?.result;
    if (!result || result.err_cd !== "000") {
      return res.json({ ok: true, data: [], message: result?.err_msg || "데이터 없음" });
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

    // optionList → 아파트 담보 + 원리금균등 옵션만 필터
    const products = [];
    for (const o of optionList) {
      const key = `${o.fin_co_no}:${o.fin_prdt_cd}`;
      const base = productMap.get(key);
      if (!base) continue;
      // mrtg_type: A=아파트, 필터 없이 전부 포함 (다른 담보 유형도 참고가치 있음)
      products.push({
        bank: base.bank,
        product: base.product,
        mortgageType: o.mrtg_type_nm ?? "",
        repayType: o.rpay_type_nm ?? "",
        rateType: o.lend_rate_type_nm ?? "",
        rateMin: o.lend_rate_min ?? null,
        rateMax: o.lend_rate_max ?? null,
        rateAvg: o.lend_rate_avg ?? null,
      });
    }

    // 금리 낮은 순 정렬
    products.sort((a, b) => (a.rateMin ?? 99) - (b.rateMin ?? 99));

    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=1800");
    res.json({ ok: true, data: products, count: products.length });
  } catch (err) {
    console.error("[finlife/loans] error:", err.message);
    res.status(502).json({ ok: false, error: "외부 API 연동 중 오류가 발생했습니다" });
  }
}});
