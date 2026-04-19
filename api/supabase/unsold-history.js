/**
 * GET /api/supabase/unsold-history?apartment_id=xxx
 * GET /api/supabase/unsold-history?apartment_ids=id1,id2,id3
 *
 * unsold_history 테이블에서 아파트의 미분양 추이 시계열 데이터 반환
 * apartment_ids: 쉼표 구분 복수 ID (최대 20개, siblingIds 통합 조회용)
 * 응답: { ok: true, data: [...], count: N, fetchedAt: "..." }
 */
import { createTimeseriesHandler } from "../_lib/timeseriesHandler.js";

const SELECT = "apartment_id, base_month, unsold_count, post_completion_unsold, change, recorded_at";

export default createTimeseriesHandler({
  table: "unsold_history",
  select: SELECT,
  orderBy: "base_month",
  errorLabel: "미분양",
});
