import { useEffect, useRef } from "react";
import { PROFILES } from "@/constants/profiles";
import { isFeatureHome } from "@/constants/featureFlags";
import { MAX_COMPARE } from "@/hooks/useComparison";
import type { Apt, Profile } from "@/types/scoring";

interface UseUrlSyncArgs {
  tab: string;
  setTab: (_tab: string) => void;
  setProfile: (_k: Profile) => void;
  /** 지금 열린 단지 (없으면 null) — 주소 `/apt/{id}` 동기화의 기준값 */
  detailAptId: string | null;
  openDetail: (_aptId: string) => void;
  closeDetail: () => void;
  setCompIds: (_v: string[] | ((_prev: string[]) => string[])) => void;
  setShowCompOpen: (_v: boolean | ((_prev: boolean) => boolean)) => void;
  apartments: Apt[];
  dataLoading: boolean;
  dataError: string | null;
  setFavoriteIds: (_idsOrFn: string[] | ((_prev: string[]) => string[])) => void;
  showToast: (_msg: string) => void;
}

/**
 * URL 동기화 5종 useEffect 훅 (App.tsx L389~455 추출, 세션 485 / 2·3번 신설 세션 503).
 * 1) tab="upcoming" ↔ URL "/upcoming" 동기화 ([tab] deps)
 * 2) 상세 열림 ↔ 주소 "/apt/{id}" 동기화 ([detailAptId] deps — 단계 2-B)
 * 3) popstate(뒤로/앞으로) ↔ 상세 열림 (단계 2-B)
 * 4) URL 딥링크 복원 (경로형 /apt/{id} + 옛 detail/compare/profile 쿼리, mount 1회 [] deps)
 * 5) dedup 후 무효 ID 정리 (apartments 갱신 시 관심매물/비교 목록 정리)
 */
export function useUrlSync({
  tab,
  setTab,
  setProfile,
  detailAptId,
  openDetail,
  closeDetail,
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

  // ── 독립 useEffect: 상세 열림 ↔ 주소 `/apt/{id}` 동기화 (세션 503, 단계 2-B) ──
  // 상세는 모달이라 주소가 안 바뀌면 공유도 색인도 불가능했다. 열면 주소를 만들고 닫으면 되돌린다.
  //
  // ⚠️ "실제로 바뀐 경우에만 움직인다"(prev === detailAptId 면 즉시 반환)가 이 effect 의 핵심이고,
  // 그 한 줄이 함정 두 개를 동시에 막는다:
  //  1) 첫 렌더(null===null): `/apt/{id}` 로 직접 들어온 손님의 주소를 아래 복원 effect 가 읽기 전에
  //     "상세가 안 열려 있으니 `/` 로" 라며 지워버리는 사고를 막는다.
  //  2) tab 만 바뀐 실행: tab 이 바뀌면 useDetailModal 이 같은 커밋에서 detailAptId 를 null 로
  //     만드는데 그 커밋의 effect 패스에선 아직 옛 값이라, 이 effect 가 위 effect 가 방금 바꿔둔
  //     `/upcoming` 을 `/apt/{id}` 로 되밀어 히스토리에 쓰레기 항목을 쌓는다.
  const prevDetailRef = useRef<string | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (prevDetailRef.current === detailAptId) return;
    prevDetailRef.current = detailAptId;
    if (detailAptId) {
      const want = `/apt/${encodeURIComponent(detailAptId)}`;
      if (window.location.pathname !== want) {
        try {
          window.history.pushState({ aptId: detailAptId }, "", want);
        } catch {
          /* noop */
        }
      }
      return;
    }
    if (window.location.pathname.startsWith("/apt/")) {
      try {
        window.history.pushState(null, "", tab === "upcoming" ? "/upcoming" : "/");
      } catch {
        /* noop */
      }
    }
  }, [detailAptId, tab]);

  // ── 독립 useEffect: 뒤로/앞으로 가기 ↔ 상세 열림 (세션 503) ──
  // pushState 로 만든 항목은 뒤로가기 때 popstate 만 오고 화면은 그대로다. 주소를 보고 맞춰준다.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPop = () => {
      const id = window.location.pathname.match(/^\/apt\/([^/]+)/)?.[1];
      if (id) openDetail(decodeURIComponent(id));
      else closeDetail();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [openDetail, closeDetail]);

  // ── 독립 useEffect: URL 딥링크 복원 ──
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // 경로형 `/apt/{id}` 가 1순위, 없으면 옛 `?detail=` (세션 503 — 기존 공유 링크 하위호환)
    const pathId = window.location.pathname.match(/^\/apt\/([^/]+)/)?.[1];
    const detailId = pathId ? decodeURIComponent(pathId) : params.get("detail");
    const compareStr = params.get("compare");
    const profileParam = params.get("profile");
    if (profileParam && profileParam in PROFILES) setProfile(profileParam as Profile);
    if (detailId) openDetail(detailId);
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
      // 옛 `?detail=` 링크는 여기서 곧장 `/apt/{id}` 로 승격한다 — replaceState 라 히스토리 항목이
      // 안 늘고, 주소창도 바로 새 형식이 된다.
      //
      // ⚠️ 쿼리만 지우고 "/" 로 두면 안 된다(세션 503 실측): StrictMode 가 effect 를 두 번 돌리는
      // 개발 모드에서 1차가 쿼리를 지우면 2차 마운트엔 복원할 근거가 사라져 상세가 닫힌 채 남는다.
      // 주소에 id 를 남겨두면 2차가 그 주소를 다시 읽어 복원한다(= 개발과 운영 동작이 같아진다).
      const nextPath = detailId ? `/apt/${encodeURIComponent(detailId)}` : window.location.pathname;
      try {
        window.history.replaceState(null, "", remaining ? `${nextPath}?${remaining}` : nextPath);
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
