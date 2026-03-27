/**
 * GET /api/supabase/unsold-history?apartment_id=xxx
 * GET /api/supabase/unsold-history?apartment_ids=id1,id2,id3
 *
 * unsold_history 테이블에서 아파트의 미분양 추이 시계열 데이터 반환
 * apartment_ids: 쉼표 구분 복수 ID (최대 20개, siblingIds 통합 조회용)
 * 응답: { ok: true, data: [...], count: N, fetchedAt: "..." }
 */
import { getSupabase } from "../_lib/supabase.js";

const ID_PATTERN = /^ah-\d+$/;

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const supabase = getSupabase();
    const rawIds = (req.query.apartment_ids || "").trim();
    const apartmentId = (req.query.apartment_id || "").trim();

    let query;
    if (rawIds) {
      const ids = rawIds.split(",").map(s => s.trim()).filter(Boolean);
      if (ids.length === 0 || ids.length > 20) {
        return res.status(400).json({ ok: false, error: "apartment_ids는 1~20개 사이여야 합니다" });
      }
      if (!ids.every(id => ID_PATTERN.test(id))) {
        return res.status(400).json({ ok: false, error: "잘못된 apartment_id 형식입니다" });
      }
      query = supabase
        .from("unsold_history")
        .select("apartment_id, base_month, unsold_count, post_completion_unsold, change, recorded_at")
        .in("apartment_id", ids)
        .order("base_month", { ascending: true });
    } else if (apartmentId) {
      if (!ID_PATTERN.test(apartmentId)) {
        return res.status(400).json({ ok: false, error: "잘못된 apartment_id 형식입니다" });
      }
      query = supabase
        .from("unsold_history")
        .select("apartment_id, base_month, unsold_count, post_completion_unsold, change, recorded_at")
        .eq("apartment_id", apartmentId)
        .order("base_month", { ascending: true });
    } else {
      return res.status(400).json({ ok: false, error: "apartment_id 또는 apartment_ids 파라미터가 필요합니다" });
    }

    const { data, error } = await query;

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
