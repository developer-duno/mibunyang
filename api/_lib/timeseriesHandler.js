/**
 * apartment_id/apartment_ids 기반 시계열 조회 핸들러 팩토리
 * prices / unsold_history 등 동일 패턴 API 공용
 *
 * 공통 처리:
 *  - method GET + rateLimit "proxy" (withHandler)
 *  - parseApartmentIds 검증 (400)
 *  - Supabase 단일/복수 분기 (eq/in) + 선택적 filter 훅
 *  - ORDER BY ascending 고정
 *  - Cache-Control public s-maxage=3600
 *  - 표준 응답 { ok, data, count, fetchedAt }
 *  - error/catch 분기 한국어 메시지
 */
import { getSupabase } from "./supabase.js";
import { withHandler } from "./handler.js";
import { parseApartmentIds } from "./apartmentValidation.js";

/**
 * @param {object} cfg
 * @param {string}   cfg.table       - Supabase 테이블명
 * @param {string}   cfg.select      - SELECT 컬럼 목록
 * @param {string}   cfg.orderBy     - ORDER BY 컬럼 (ascending 고정)
 * @param {string}   cfg.errorLabel  - 사용자 에러 메시지 라벨 (예: "분양가")
 * @param {(q) => q} [cfg.filter]    - Supabase 쿼리 체인 추가 필터 훅 (선택)
 */
export function createTimeseriesHandler({ table, select, orderBy, errorLabel, filter }) {
  return withHandler({ method: "GET", rateLimit: "proxy", handler: async (req, res) => {
    try {
      const supabase = getSupabase();
      const parsed = parseApartmentIds(req.query);
      if (parsed.error) {
        return res.status(parsed.status).json({ ok: false, error: parsed.error });
      }

      let query = supabase.from(table).select(select);
      query = parsed.ids ? query.in("apartment_id", parsed.ids) : query.eq("apartment_id", parsed.id);
      if (filter) query = filter(query);
      query = query.order(orderBy, { ascending: true });

      const { data, error } = await query;
      if (error) {
        console.error(`Supabase ${table} query error:`, error);
        return res.status(500).json({ ok: false, error: `${errorLabel} 데이터 조회 중 오류가 발생했습니다` });
      }

      res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=7200");
      return res.status(200).json({
        ok: true,
        data: data || [],
        count: (data || []).length,
        fetchedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error(`${table} API error:`, err);
      return res.status(500).json({ ok: false, error: "서버 오류가 발생했습니다" });
    }
  }});
}
