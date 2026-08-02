import { useEffect } from "react";
import { PROFILES } from "@/constants/profiles";
import { isFeatureHome } from "@/constants/featureFlags";
import { MAX_COMPARE } from "@/hooks/useComparison";
import type { Apt, Profile } from "@/types/scoring";

interface UseUrlSyncArgs {
  tab: string;
  setTab: (_tab: string) => void;
  setProfile: (_k: Profile) => void;
  handleDetailGated: (_aptId: string) => void;
  setCompIds: (_v: string[] | ((_prev: string[]) => string[])) => void;
  setShowCompOpen: (_v: boolean | ((_prev: boolean) => boolean)) => void;
  apartments: Apt[];
  dataLoading: boolean;
  dataError: string | null;
  setFavoriteIds: (_idsOrFn: string[] | ((_prev: string[]) => string[])) => void;
  showToast: (_msg: string) => void;
}

/**
 * URL 동기화 3종 useEffect 훅 (App.tsx L389~455 추출, 세션 485).
 * 1) tab="upcoming" ↔ URL "/upcoming" 동기화 ([tab] deps)
 * 2) URL 딥링크 복원 (detail/compare/profile 쿼리 파라미터, mount 1회 [] deps)
 * 3) dedup 후 무효 ID 정리 (apartments 갱신 시 관심매물/비교 목록 정리)
 */
export function useUrlSync({
  tab,
  setTab,
  setProfile,
  handleDetailGated,
  setCompIds,
  setShowCompOpen,
  apartments,
  dataLoading,
  dataError,
  setFavoriteIds,
  showToast,
}: UseUrlSyncArgs): void {
  // ── 독립 useEffect: tab="upcoming" ↔ URL "/upcoming" 동기화 ──
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onUpcomingPath = window.location.pathname.startsWith("/upcoming");
    if (tab === "upcoming" && !onUpcomingPath) {
      try {
        window.history.pushState(null, "", "/upcoming");
      } catch {
        /* noop */
      }
    } else if (tab !== "upcoming" && onUpcomingPath) {
      try {
        window.history.pushState(null, "", "/");
      } catch {
        /* noop */
      }
    }
  }, [tab]);

  // ── 독립 useEffect: URL 딥링크 복원 ──
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const detailId = params.get("detail");
    const compareStr = params.get("compare");
    const profileParam = params.get("profile");
    if (profileParam && profileParam in PROFILES) setProfile(profileParam as Profile);
    if (detailId) handleDetailGated(detailId);
    if (compareStr) {
      const ids = compareStr.split(",").filter(Boolean).slice(0, MAX_COMPARE);
      if (ids.length >= 2) {
        setCompIds(ids);
        setShowCompOpen(true);
        // CompareSheet 는 list 탭 전용 렌더 — home 기본 탭에선 list 로 페어 전환.
        // ?detail= 복합 링크는 detail 우선(!detailId): 탭 전환 시 useDetailModal 모달닫힘 충돌 회피.
        // 복합 링크의 비교 시트 열림 상태는 유실 수용(compIds 보존 — 목록의 'N개 비교 보기' 버튼으로 재개)
        if (!detailId && isFeatureHome()) setTab("list");
      }
    }
    if (detailId || compareStr) {
      const cleanParams = new URLSearchParams(window.location.search);
      cleanParams.delete("detail");
      cleanParams.delete("compare");
      const remaining = cleanParams.toString();
      try {
        window.history.replaceState(null, "", remaining ? `?${remaining}` : window.location.pathname);
      } catch {
        /* noop: history.replaceState 미지원 환경 무시 */
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 독립 useEffect: dedup 후 무효 ID 정리 ──
  useEffect(() => {
    if (dataLoading || dataError || !apartments.length) return;
    const validIds = new Set(apartments.map((a) => a.id));
    setFavoriteIds((ids) => {
      const next = ids.filter((id) => validIds.has(id));
      if (next.length === ids.length) return ids;
      if (ids.length - next.length > 0)
        showToast(`데이터 변경으로 관심매물 ${ids.length - next.length}개가 정리되었습니다`);
      return next;
    });
    setCompIds((ids) => {
      const next = ids.filter((id) => validIds.has(id));
      return next.length === ids.length ? ids : next;
    });
  }, [apartments, dataLoading, dataError, setFavoriteIds, setCompIds, showToast]);
}
