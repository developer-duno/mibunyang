/**
 * GET /api/supabase/unsold-history?apartment_id=xxx
 *
 * unsold_history 테이블에서 특정 아파트의 미분양 추이 시계열 데이터 반환
 * 응답: { ok: true, data: [...], count: N, fetchedAt: "..." }
 */
import { getSupabase } from "../_lib/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const supabase = getSupabase();
    const apartmentId = (req.query.apartment_id || "").trim();
    if (!apartmentId) {
      return res.status(400).json({ ok: false, error: "apartment_id 파라미터가 필요합니다" });
    }

    const { data, error } = await supabase
      .from("unsold_history")
      .select("base_month, unsold_count, post_completion_unsold, change, recorded_at")
      .eq("apartment_id", apartmentId)
      .order("base_month", { ascending: true });

    if (error) {
      console.error("Supabase unsold_history query error:", error);
      return res.status(500).json({ ok: false, error: "미분양 데이터 조회 중 오류가 발생했습니다" });
    }

    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=7200");
    return res.status(200).json({
      ok: true,
      data: data || [],
      count: (data || []).length,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("unsold-history API error:", err);
    return res.status(500).json({ ok: false, error: "서버 오류가 발생했습니다" });
  }
}
