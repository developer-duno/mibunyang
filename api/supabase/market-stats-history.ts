/**
 * GET /api/supabase/market-stats-history?region=서울&gu=강남구
 * GET /api/supabase/market-stats-history?region=서울&gu= (시도 단위, gu 빈 문자열)
 *
 * market_stats_history 테이블에서 region+gu 조합의 5지표 시계열 반환.
 * 5지표: price_index / avg_price_sqm / new_supply / initial_sale_rate / land_cost_ratio.
 * 응답: { ok: true, data: [...], count: N, fallback: boolean, fetchedAt: "..." }
 *
 * KOSIS DT_41401N_005~009 5지표는 시도 단위만 제공 (collect-market-stats.mjs L161:
 * C2_NM != "전체" continue + L166: gu="" 강제 적재). gu="서구" 등 시군구 쿼리는
 * 빈 응답 → 시도 (gu="") 자동 폴백으로 사용자에게 시도 평균 데이터 표시.
 */
import { withHandler } from "../_lib/handler.js";
import { getSupabase } from "../_lib/supabase.js";

const SELECT = "region,gu,base_month,price_index,avg_price_sqm,new_supply,initial_sale_rate,land_cost_ratio";
const REGION_MAX = 20;
const GU_MAX = 30;
const METRIC_FIELDS = ["price_index", "avg_price_sqm", "new_supply", "initial_sale_rate", "land_cost_ratio"];

/**
 * 응답 행 중 5필드가 하나라도 유효 값을 가진 행이 있는지 검사.
 * 시군구 쿼리가 행은 있으나 모두 NULL 인 경우 시도 폴백 트리거.
 */
function hasAnyMetricValue(rows: Array<Record<string, unknown>> | null | undefined): boolean {
  if (!rows || rows.length === 0) return false;
  for (const row of rows) {
    for (const f of METRIC_FIELDS) {
      if (row[f] != null) return true;
    }
  }
  return false;
}

export default withHandler({
  method: "GET",
  rateLimit: "proxy",
  handler: async (req, res) => {
    try {
      const query = (req.query ?? {}) as Record<string, unknown>;
      const region = String(query.region || "").trim();
      const gu = String(query.gu || "").trim();
      if (!region) {
        return res.status(400).json({ ok: false, error: "region 파라미터가 필요합니다" });
      }
      if (region.length > REGION_MAX || gu.length > GU_MAX) {
        return res.status(400).json({ ok: false, error: "잘못된 입력입니다" });
      }

      const supabase = getSupabase();
      const runQuery = (guValue: string) => supabase
        .from("market_stats_history")
        .select(SELECT)
        .eq("region", region)
        .eq("gu", guValue)
        .order("base_month", { ascending: true });

      let { data, error } = await runQuery(gu);
      let fallback = false;

      // 시도 폴백 — KOSIS 통계 시도 단위 한계로 시군구 쿼리 (1) 빈 응답 또는 (2) 행은
      // 있지만 5필드 모두 NULL 인 경우 gu="" 자동 조회. (2) 케이스 = collector 가
      // base_month 별 wide row 만들면서 시군구는 행만 채우고 값은 비워두는 사고.
      if (!error && gu && !hasAnyMetricValue(data)) {
        const fb = await runQuery("");
        if (!fb.error) {
          console.info(`[market-stats] Fallback hit: region="${region}" gu="${gu}" → gu=""`);
          data = fb.data;
          fallback = true;
        } else {
          console.error(`[market-stats] Fallback error: region="${region}"`, fb.error);
        }
      }

      if (error) {
        console.error("Supabase market_stats_history query error:", error);
        return res.status(500).json({ ok: false, error: "시장통계 데이터 조회 중 오류가 발생했습니다" });
      }

      res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=7200");
      return res.status(200).json({
        ok: true,
        data: data || [],
        count: (data || []).length,
        fallback,
        fetchedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error("market-stats-history API error:", err);
      return res.status(500).json({ ok: false, error: "서버 오류가 발생했습니다" });
    }
  },
});
