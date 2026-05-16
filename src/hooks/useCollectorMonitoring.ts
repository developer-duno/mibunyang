import { useState, useCallback, useEffect, useRef } from "react";
import type { CollectorStatusResponse, ShowToast } from "@/types/admin";

/**
 * useCollectorMonitoring — 수집기 모니터링 화면용 훅 (모니터링 에픽 4단계).
 *
 * GET /api/admin/collector-status 를 마운트 시 1회 자동 호출한다.
 * useAdminMode 의 fetchUsers 패턴 답습 — Bearer 토큰 + AbortController + 429/401/500 분기.
 * useAdminMode 와 독립 — 401 시 로그아웃 처리는 useAdminMode 의 verify 폴링이 담당하므로
 * 여기서는 토스트 + error 상태만 노출한다.
 */
export function useCollectorMonitoring(showToast: ShowToast): {
  data: CollectorStatusResponse | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
} {
  const [data, setData] = useState<CollectorStatusResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchStatus = useCallback(async (): Promise<void> => {
    const token = localStorage.getItem("expertToken");
    if (!token) {
      setError("관리자 인증이 필요합니다");
      return;
    }
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/collector-status", {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (res.status === 429) {
        showToast("요청이 너무 많습니다. 잠시 후 다시 시도해주세요.");
        setError("요청이 너무 많습니다");
        return;
      }
      const json = await res.json() as CollectorStatusResponse & { error?: string };
      if (res.status === 401) {
        showToast("관리자 세션이 만료되었습니다");
        setError("관리자 세션이 만료되었습니다");
        return;
      }
      if (!res.ok || !json.ok) {
        setError(json.error ?? "모니터링 데이터 조회에 실패했습니다");
        return;
      }
      setData(json);
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        setError("서버 연결에 실패했습니다");
      }
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  // 마운트 시 1회 자동 호출 + 언마운트 시 진행 중 요청 취소
  useEffect(() => {
    fetchStatus();
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, [fetchStatus]);

  const refetch = useCallback(() => {
    fetchStatus();
  }, [fetchStatus]);

  return { data, loading, error, refetch };
}
