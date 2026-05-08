// @ts-check
/**
 * GET /api/supabase/market-stats-history?region=서울&gu=강남구
 * GET /api/supabase/market-stats-history?region=서울&gu= (시도 단위, gu 빈 문자열)
 *
 * market_stats_history 테이블에서 region+gu 조합의 5지표 시계열 반환.
 * 5지표: price_index / avg_price_sqm / new_supply / initial_sale_rate / land_cost_ratio.
 * 응답: { ok: true, data: [...], count: N, fetchedAt: "..." }
 */
import { withHandler } from "../_lib/handler.js";
import { getSupabase } from "../_lib/supabase.js";

const SELECT = "region,gu,base_month,price_index,avg_price_sqm,new_supply,initial_sale_rate,land_cost_ratio";
const REGION_MAX = 20;
const GU_MAX = 30;

export default withHandler({
  method: "GET",
  rateLimit: "proxy",
  handler: async (req, res) => {
    try {
      const query = /** @type {Record<string, unknown>} */ (req.query ?? {});
      const region = String(query.region || "").trim();
      const gu = String(query.gu || "").trim();
      if (!region) {
        return res.status(400).json({ ok: false, error: "region 파라미터가 필요합니다" });
      }
      if (region.length > REGION_MAX || gu.length > GU_MAX) {
        return res.status(400).json({ ok: false, error: "잘못된 입력입니다" });
      }

      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("market_stats_history")
        .select(SELECT)
        .eq("region", region)
        .eq("gu", gu)
        .order("base_month", { ascending: true });

      if (error) {
        console.error("Supabase market_stats_history query error:", error);
        return res.status(500).json({ ok: false, error: "시장통계 데이터 조회 중 오류가 발생했습니다" });
      }

      res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=7200");
      return res.status(200).json({
        ok: true,
        data: data || [],
        count: (data || []).length,
        fetchedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error("market-stats-history API error:", err);
      return res.status(500).json({ ok: false, error: "서버 오류가 발생했습니다" });
    }
  },
});
