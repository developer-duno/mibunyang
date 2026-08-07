/**
 * GET /api/supabase/presale-detail?apartment_id=xxx
 *
 * 청약홈 공식 분양 일정(presale_schedule_official) + 평형별 공급(applyhome_unit_supply)을
 * apartment_id 로 함께 조회. apartments_flat VIEW 에 JOIN 하지 않고 별도 쿼리 후 merge
 * (data-audit fetchAllFromView 선례 — 공용 VIEW 19초 위험 회피).
 *
 * 응답: { ok: true, schedule: {...}|null, units: [...], fetchedAt: "..." }
 */
import { getSupabase } from "../_lib/supabase.js";
import { withHandler } from "../_lib/handler.js";
import { parseApartmentIds } from "../_lib/apartmentValidation.js";

const SCHEDULE_SELECT =
  "house_manage_no, recruit_date, special_receipt_bgnde, special_receipt_endde, " +
  "general_rank1_bgnde, general_rank1_endde, general_rank2_bgnde, general_rank2_endde, " +
  "winner_announce_date, contract_bgnde, contract_endde, move_in_ym, tot_supply, " +
  "pblanc_url, biz_entity, constructor, " +
  // 규제 7종(PR #331 저장) — 공고 시점 스냅샷이라 화면에서 recruit_date 와 반드시 함께 쓴다.
  // 한글명·표시순서는 src/constants/regulationFlags.ts 가 단일 출처.
  "adjustment_target_area, speculation_overheated, price_cap_applied, redevelopment_biz, " +
  "public_housing_district, large_scale_district, metro_private_public_housing";
const UNIT_SELECT =
  "house_manage_no, model_no, house_ty, supply_area, general_supply, special_supply, " +
  "special_by_type, top_amount";

export default withHandler({
  method: "GET",
  rateLimit: "proxy",
  handler: async (req, res) => {
    try {
      const supabase = getSupabase();
      const parsed = parseApartmentIds((req.query ?? {}) as { apartment_id?: string });
      // 단일 apartment_id 전용 (복수 불필요 — 단지 상세 1건 조회용)
      if ("error" in parsed) {
        return res.status(parsed.status).json({ ok: false, error: parsed.error });
      }
      const aptId = "id" in parsed ? parsed.id : parsed.ids[0];

      // 두 테이블 병렬 조회 후 JS merge (VIEW JOIN 회피)
      const [scheduleRes, unitsRes] = await Promise.all([
        supabase
          .from("presale_schedule_official")
          .select(SCHEDULE_SELECT)
          .eq("apartment_id", aptId)
          .order("recruit_date", { ascending: false })
          .limit(1),
        supabase
          .from("applyhome_unit_supply")
          .select(UNIT_SELECT)
          .eq("apartment_id", aptId)
          .order("supply_area", { ascending: true }),
      ]);

      if (scheduleRes.error || unitsRes.error) {
        console.error("presale-detail query error:", scheduleRes.error || unitsRes.error);
        return res.status(500).json({ ok: false, error: "분양 상세 데이터 조회 중 오류가 발생했습니다" });
      }

      res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=7200");
      return res.status(200).json({
        ok: true,
        schedule: (scheduleRes.data || [])[0] ?? null,
        units: unitsRes.data || [],
        fetchedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error("presale-detail API error:", err);
      return res.status(500).json({ ok: false, error: "서버 오류가 발생했습니다" });
    }
  },
});
