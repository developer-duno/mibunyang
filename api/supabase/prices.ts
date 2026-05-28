/**
 * GET /api/supabase/prices?apartment_id=xxx
 * GET /api/supabase/prices?apartment_ids=id1,id2,id3
 *
 * prices 테이블에서 아파트의 분양가 시계열 데이터 반환
 * apartment_ids: 쉼표 구분 복수 ID (최대 20개, siblingIds 통합 조회용)
 * 응답: { ok: true, data: [...], count: N, fetchedAt: "..." }
 */
import { createTimeseriesHandler } from "../_lib/timeseriesHandler.js";

const SELECT = "apartment_id, area, supply_area, price, pp, house_type, supply_count, recorded_at";

export default createTimeseriesHandler({
  table: "prices",
  select: SELECT,
  orderBy: "recorded_at",
  errorLabel: "분양가",
  // presale_* house_type은 네이버 분양가 폴백용 내부 데이터 — 프론트 시계열 노출 제외
  filter: (q: any) => q.not("house_type", "like", "presale_%"),
});
