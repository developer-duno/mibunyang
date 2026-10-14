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

type SupabaseQuery = {
  in: (_col: string, _vals: string[]) => SupabaseQuery;
  eq: (_col: string, _val: string) => SupabaseQuery;
  order: (_col: string, _opts: { ascending: boolean }) => SupabaseQuery;
  then: <T>(_resolve: (_value: { data: unknown[] | null; error: unknown }) => T) => Promise<T>;
};

type MergeMonthly = { key: string; value: string };

type CreateTimeseriesConfig = {
  table: string;
  select: string;
  orderBy: string;
  errorLabel: string;
  filter?: (_q: SupabaseQuery) => SupabaseQuery;
  /** 세션635 다: 복수 id 응답을 key(달)별 한 행으로 접는다(묶음 구성원 여러 행 → 차트 톱니 방지). */
  mergeMonthly?: MergeMonthly;
};

/** 같은 달(key) 여러 행 → 한 행: 요청 순서 **첫 id**(재료 행)의 행이 있으면 그 행, 없으면 value 최댓값(설계서 §4-7 (5) — 두 번째 순위 id 가 아니라 최댓값). key 오름차순. */
export function mergeMonthlyRows<T extends Record<string, unknown>>(
  rows: T[],
  idOrder: string[],
  { key, value }: MergeMonthly
): T[] {
  const first = idOrder[0];
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const k = String(r[key] ?? "");
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }
  const num = (r: T) => (typeof r[value] === "number" ? (r[value] as number) : -Infinity);
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(
      ([, g]) =>
        g.find((r) => String(r.apartment_id) === first) ?? g.reduce((best, r) => (num(r) > num(best) ? r : best), g[0])
    );
}

export function createTimeseriesHandler({
  table,
  select,
  orderBy,
  errorLabel,
  filter,
  mergeMonthly,
}: CreateTimeseriesConfig) {
  return withHandler({ method: "GET", rateLimit: "proxy", handler: async (req, res) => {
    try {
      const supabase = getSupabase();
      const parsed = parseApartmentIds((req.query ?? {}) as { apartment_ids?: string; apartment_id?: string });
      if ("error" in parsed) {
        return res.status(parsed.status).json({ ok: false, error: parsed.error });
      }

      let query = supabase.from(table).select(select) as unknown as SupabaseQuery;
      query = "ids" in parsed ? query.in("apartment_id", parsed.ids) : query.eq("apartment_id", parsed.id);
      if (filter) query = filter(query);
      query = query.order(orderBy, { ascending: true });

      const { data, error } = await query;
      if (error) {
        console.error(`Supabase ${table} query error:`, error);
        return res.status(500).json({ ok: false, error: `${errorLabel} 데이터 조회 중 오류가 발생했습니다` });
      }

      const rowsOut =
        mergeMonthly && "ids" in parsed
          ? mergeMonthlyRows((data ?? []) as Record<string, unknown>[], parsed.ids, mergeMonthly)
          : data || [];

      res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=7200");
      return res.status(200).json({
        ok: true,
        data: rowsOut,
        count: rowsOut.length,
        fetchedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error(`${table} API error:`, err);
      return res.status(500).json({ ok: false, error: "서버 오류가 발생했습니다" });
    }
  }});
}
