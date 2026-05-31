import { useState, useCallback, useEffect } from "react";

export interface PresaleScheduleOfficial {
  house_manage_no: string;
  recruit_date: string | null;
  special_receipt_bgnde: string | null;
  special_receipt_endde: string | null;
  general_rank1_bgnde: string | null;
  general_rank1_endde: string | null;
  general_rank2_bgnde: string | null;
  general_rank2_endde: string | null;
  winner_announce_date: string | null;
  contract_bgnde: string | null;
  contract_endde: string | null;
  move_in_ym: string | null;
  tot_supply: number | null;
  pblanc_url: string | null;
  biz_entity: string | null;
  constructor: string | null;
}

export interface ApplyhomeUnitSupply {
  house_manage_no: string;
  model_no: string;
  house_ty: string | null;
  supply_area: number | null;
  general_supply: number | null;
  special_supply: number | null;
  special_by_type: Record<string, number> | null;
  top_amount: number | null;
}

interface UsePresaleDetailReturn {
  schedule: PresaleScheduleOfficial | null;
  units: ApplyhomeUnitSupply[];
  loading: boolean;
  error: string | null;
}

// apartmentId별 응답 캐시 (SPA 세션 유지). DetailModal 재오픈 시 재fetch 제거.
const cache = new Map<string, { schedule: PresaleScheduleOfficial | null; units: ApplyhomeUnitSupply[] }>();
/** 테스트 격리용 */
export function _clearPresaleDetailCache(): void { cache.clear(); }

/**
 * 청약홈 공식 분양 일정 + 평형 페칭 훅 (/api/supabase/presale-detail).
 * apartments_flat VIEW 에 없는 신규 테이블 2종을 단지 상세에서 별도 조회.
 */
export function usePresaleDetail(apartmentId: string | null | undefined): UsePresaleDetailReturn {
  const [schedule, setSchedule] = useState<PresaleScheduleOfficial | null>(null);
  const [units, setUnits] = useState<ApplyhomeUnitSupply[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!apartmentId) return;
    const cached = cache.get(apartmentId);
    if (cached) { setSchedule(cached.schedule); setUnits(cached.units); setLoading(false); setError(null); return; }
    setLoading(true);
    setError(null);
    try {
      const url = `/api/supabase/presale-detail?apartment_id=${encodeURIComponent(apartmentId)}`;
      const res = await fetch(url, { signal });
      if (signal?.aborted) return;
      if (!res.ok) {
        if (res.status === 429) throw new Error("요청이 너무 많습니다. 잠시 후 다시 시도해주세요");
        throw new Error(`API 오류 (${res.status})`);
      }
      const json = await res.json() as { ok?: boolean; schedule?: PresaleScheduleOfficial | null; units?: ApplyhomeUnitSupply[]; error?: string };
      if (!json.ok) throw new Error(json.error || "데이터 조회 실패");
      const sched = json.schedule ?? null;
      const us = json.units ?? [];
      cache.set(apartmentId, { schedule: sched, units: us });
      setSchedule(sched);
      setUnits(us);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      const message = err instanceof Error ? err.message : String(err);
      if (import.meta.env.DEV) {
        console.error("[usePresaleDetail]", { apartmentId, error: message });
      }
      setError(message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [apartmentId]);

  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, [load]);

  return { schedule, units, loading, error };
}
