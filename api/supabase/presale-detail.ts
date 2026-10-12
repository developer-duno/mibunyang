/**
 * GET /api/supabase/presale-detail?apartment_id=xxx
 *
 * 청약홈 공식 분양 일정(presale_schedule_official) + 평형별 공급(applyhome_unit_supply)을
 * apartment_id 로 함께 조회. apartments_flat VIEW 에 JOIN 하지 않고 별도 쿼리 후 merge
 * (data-audit fetchAllFromView 선례 — 공용 VIEW 19초 위험 회피).
 * 세션630: **같은 단지 묶음(`apartments.complex_key`) 단위로 읽는다** — 수집기는 같은 묶음 동점 공고를 id 작은
 * 행에 붙이는데 카드는 묶음의 다른 행(id 큰 행)일 수 있다. 열쇠가 비면 자기 id 만. 일정은 묶음 전체에서 최신 1행,
 * 평형은 (공고번호, 모델번호)로 한 벌만(같은 공고가 묶음 두 행에 붙어 있어도 두 벌이 안 되게).
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

      // 같은 단지 묶음의 행 id 들(세션630) — 열쇠 1회 조회 → 같은 열쇠 행 전부. 열쇠가 없으면 자기 id 만.
      // 오피스텔 `(오)` 행은 묶음에 섞여 있어도(DB 실측 45묶음) 서로 읽지 않는다 — 아파트 카드에 오피스텔 공고·오피스텔 카드에 아파트 공고가 안 섞이게.
      const isOfficetel = (name: unknown) => String(name ?? "").includes("(오)");
      const keyRes = await supabase.from("apartments").select("complex_key, name").eq("id", aptId).limit(1);
      if (keyRes.error) {
        console.error("presale-detail key query error:", keyRes.error);
        return res.status(500).json({ ok: false, error: "분양 상세 데이터 조회 중 오류가 발생했습니다" });
      }
      const self = keyRes.data?.[0] as { complex_key?: string | null; name?: string | null } | undefined;
      const key = self?.complex_key ?? null;
      let ids = [aptId];
      if (key && !isOfficetel(self?.name)) {
        const bundleRes = await supabase.from("apartments").select("id, name").eq("complex_key", key);
        if (bundleRes.error) {
          console.error("presale-detail bundle query error:", bundleRes.error);
          return res.status(500).json({ ok: false, error: "분양 상세 데이터 조회 중 오류가 발생했습니다" });
        }
        const members = ((bundleRes.data ?? []) as { id: string; name?: string | null }[]).filter((r) => !isOfficetel(r.name));
        ids = [...new Set([aptId, ...members.map((r) => r.id)])];
      }

      // 두 테이블 병렬 조회 후 JS merge (VIEW JOIN 회피)
      const [scheduleRes, unitsRes] = await Promise.all([
        supabase
          .from("presale_schedule_official")
          .select(SCHEDULE_SELECT)
          .in("apartment_id", ids)
          .order("recruit_date", { ascending: false, nullsFirst: false }) // 내림차순 기본은 빈 날짜가 맨 앞
          .limit(1),
        supabase
          .from("applyhome_unit_supply")
          .select(UNIT_SELECT)
          .in("apartment_id", ids)
          .order("supply_area", { ascending: true }),
      ]);

      if (scheduleRes.error || unitsRes.error) {
        console.error("presale-detail query error:", scheduleRes.error || unitsRes.error);
        return res.status(500).json({ ok: false, error: "분양 상세 데이터 조회 중 오류가 발생했습니다" });
      }

      // 같은 공고가 묶음 두 행에 붙어 있으면 평형이 두 벌 — (공고번호, 모델번호)로 한 벌만 남긴다(순서 = 면적 오름차순 그대로).
      const seen = new Set<string>();
      const units = ((unitsRes.data || []) as { house_manage_no?: string; model_no?: string }[]).filter((u) => {
        const k = `${u.house_manage_no}|${u.model_no}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });

      res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=7200");
      return res.status(200).json({
        ok: true,
        schedule: (scheduleRes.data || [])[0] ?? null,
        units,
        fetchedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error("presale-detail API error:", err);
      return res.status(500).json({ ok: false, error: "서버 오류가 발생했습니다" });
    }
  },
});
