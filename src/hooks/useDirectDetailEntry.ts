import { useState, useEffect, useRef } from "react";

/** 첫 로드 주소가 단지 주소(`/apt/{id}` 또는 옛 `?detail=`)인가 — useUrlSync 의 딥링크 복원과 같은 판정 */
function isDetailUrl(): boolean {
  try {
    if (/^\/apt\/[^/]+/.test(window.location.pathname)) return true;
    return new URLSearchParams(window.location.search).has("detail");
  } catch {
    return false;
  }
}

interface UseDirectDetailEntryArgs {
  detailAptId: string | null;
  dataLoading: boolean;
  dataError: unknown;
  /** detailAptId 가 받은 데이터(scored)에 있나 */
  found: boolean;
}

/**
 * 단지 주소로 바로 들어온 손님(검색 결과·공유 링크)에게는 단지 상세만 보여 준다 (세션641 — 사장님 결정 「단지 페이지만」).
 * 켜져 있는 동안 App 은 뒤 화면(필터 막대·탭 내용)을 안 그린다 — 구글이 단지 주소에서 홈 목록을 함께 읽어
 * 95% 가 중복 페이지로 묶이던 것을 막는다.
 *
 * - 첫 로드 주소로만 켠다(카드를 눌러 연 상세는 해당 없음).
 * - 상세가 한 번 열렸다 닫히면(✕·뒤로가기·탭 이동) 끈다 — 다시 켜지지 않는다.
 * - 데이터를 다 받았는데 그 단지가 없거나 받기에 실패하면 끈다(빈 화면 방지).
 */
export function useDirectDetailEntry({
  detailAptId,
  dataLoading,
  dataError,
  found,
}: UseDirectDetailEntryArgs): boolean {
  const [direct, setDirect] = useState(isDetailUrl);
  const openedRef = useRef(false);

  useEffect(() => {
    if (!direct) return;
    if (detailAptId) openedRef.current = true;
    else if (openedRef.current) setDirect(false);
  }, [direct, detailAptId]);

  useEffect(() => {
    if (!direct || dataLoading) return;
    if (dataError || (detailAptId && !found)) setDirect(false);
  }, [direct, dataLoading, dataError, detailAptId, found]);

  return direct;
}
