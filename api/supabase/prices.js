/**
 * GET /api/supabase/prices?apartment_id=xxx
 * GET /api/supabase/prices?apartment_ids=id1,id2,id3
 *
 * prices 테이블에서 아파트의 분양가 시계열 데이터 반환
 * apartment_ids: 쉼표 구분 복수 ID (최대 20개, siblingIds 통합 조회용)
 * 응답: { ok: true, data: [...], count: N, fetchedAt: "..." }
 */
import { getSupabase } from "../_lib/supabase.js";
import { withHandler } from "../_lib/handler.js";
import { parseApartmentIds } from "../_lib/apartmentValidation.js";

const SELECT = "apartment_id, area, supply_area, price, pp, house_type, supply_count, recorded_at";

export default withHandler({ method: "GET", rateLimit: "proxy", handler: async (req, res) => {
  try {
    const supabase = getSupabase();
    const parsed = parseApartmentIds(req.query);
    if (parsed.error) {
      return res.status(parsed.status).json({ ok: false, error: parsed.error });
    }

    // presale_* house_type은 네이버 분양가 폴백용 내부 데이터 — 프론트 시계열 노출 제외
    let query;
    if (parsed.ids) {
      query = supabase.from("prices").select(SELECT).in("apartment_id", parsed.ids).not("house_type", "like", "presale_%").order("recorded_at", { ascending: true });
    } else {
      query = supabase.from("prices").select(SELECT).eq("apartment_id", parsed.id).not("house_type", "like", "presale_%").order("recorded_at", { ascending: true });
    }

    const { data, error } = await query;

    if (error) {
      console.error("Supabase prices query error:", error);
      return res.status(500).json({ ok: false, error: "분양가 데이터 조회 중 오류가 발생했습니다" });
    }

    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=7200");
    return res.status(200).json({
      ok: true,
      data: data || [],
      count: (data || []).length,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("prices API error:", err);
    return res.status(500).json({ ok: false, error: "서버 오류가 발생했습니다" });
  }
}});
