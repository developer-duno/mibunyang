import { withHandler } from "../_lib/handler.js";
import { VALID_GROUPS, fetchFinlifeProducts } from "../_lib/finlife.js";

/** 전세자금대출 옵션 매핑 */
const mapRentLoanProduct = (base, o) => ({
  bank: base.bank,
  product: base.product,
  loanLimit: base.loanLimit,
  repayType: o.rpay_type_nm ?? "",
  rateType: o.lend_rate_type_nm ?? "",
  rateMin: o.lend_rate_min ?? null,
  rateMax: o.lend_rate_max ?? null,
  rateAvg: o.lend_rate_avg ?? null,
});

export default withHandler({ method: "GET", rateLimit: "proxy", handler: async (req, res) => {
  const apiKey = process.env.FINLIFE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ ok: false, error: "FINLIFE_API_KEY not configured" });
  }

  const topFinGrpNo = (req.query?.topFinGrpNo || "020000").trim();
  if (!VALID_GROUPS.has(topFinGrpNo)) {
    return res.status(400).json({ ok: false, error: "유효하지 않은 금융권역 코드입니다" });
  }

  try {
    const result = await fetchFinlifeProducts({
      apiKey, topFinGrpNo,
      endpoint: "rentHouseLoanProductsSearch",
      mapProduct: mapRentLoanProduct,
    });

    if (result.error) {
      return res.status(result.status).json({ ok: false, error: result.error });
    }
    if (result.message) {
      return res.json({ ok: true, data: [], message: result.message });
    }

    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=1800");
    res.json({ ok: true, data: result.data, count: result.count });
  } catch (err) {
    console.error("[finlife/rent-loans] error:", err.message);
    res.status(502).json({ ok: false, error: "외부 API 연동 중 오류가 발생했습니다" });
  }
}});
