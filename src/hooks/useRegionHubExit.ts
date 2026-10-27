import { useEffect, useRef } from "react";
import { isOnRegionHub, isRegionPath, type RegionHub } from "@/lib/regionPath";

interface UseRegionHubExitArgs {
  /** `/region/…` 로 들어와 아직 머무는 허브 (없으면 null) */
  regionHub: RegionHub | null;
  setRegionHub: (_v: RegionHub | null) => void;
  /** 미분양 없는 단지 숨김 — App.tsx 소유. 허브에선 꺼 두고 떠나면 다시 켠다 */
  setHideNoUnsold: (_v: boolean) => void;
  filterRegion: string;
  filterGu: string;
  tab: string;
}

/** 목록·지도는 같은 화면 묶음 — 둘 사이를 오가는 것은 떠남이 아니다(결정 39) */
const hubView = (t: string): string => (t === "list" || t === "map" ? "list+map" : t);

/**
 * 지역 허브를 떠나는 순간을 잡는다 (세션669 PR-S2 · 결정 33·37·39).
 *
 * 떠남 = 지역·구를 경로 값과 다르게 바꿈(초기화 포함) 또는 목록·지도 밖의 탭으로 바꿈. 그러면
 *  ① 허브를 지운다 — 그 뒤 같은 지역을 다시 골라도 허브로 돌아가지 않는다(주소 `/?region=…`)
 *  ② "미분양 없는 단지 숨김"을 다시 켠다 — 홈·새로고침 전후·홈 요약 위젯 숫자가 늘 같은 모집단
 *  ③ 탭을 바꿔 떠났고 주소가 아직 `/region/…` 이면 `/` + 쿼리(지금 지역·구는 `region`·`gu` 쿼리로)로 바꾼다.
 *     지역·구를 바꿔 떠난 경우는 useFilterSort 의 주소 쓰기가 `/region/…` 을 `/?region=…` 로 바꾼다.
 *
 * 숨김을 사람이 허브 안에서 직접 켜고 끄는 것은 막지 않는다 — 떠날 때만 켠다.
 */
export function useRegionHubExit({
  regionHub,
  setRegionHub,
  setHideNoUnsold,
  filterRegion,
  filterGu,
  tab,
}: UseRegionHubExitArgs): void {
  // 허브로 들어온 첫 탭 — 이와 다르면 떠난 것. 단 목록↔지도는 같은 필터·같은 단지라 머문다(결정 39)
  const entryTabRef = useRef(tab);
  useEffect(() => {
    if (!regionHub) return;
    const filtersOnHub = isOnRegionHub(regionHub, filterRegion, filterGu);
    if (filtersOnHub && hubView(tab) === hubView(entryTabRef.current)) return;
    setRegionHub(null);
    setHideNoUnsold(true);
    // 지역·구를 바꿔 떠난 경우 주소는 useFilterSort 가 평소처럼 쓴다(그래야 filter_change 기록이 1건 남는다 — 보완 F5).
    // 여기서 먼저 바꾸면 그쪽이 "주소 같음"으로 보고 기록을 건너뛴다. 탭을 바꿔 떠난 경우만 여기서 쓴다.
    if (!filtersOnHub) return;
    if (typeof window === "undefined" || !isRegionPath(window.location.pathname)) return;
    // region·gu 를 맨 앞에 — 필터 직렬화(FILTER_URL_MAP 순서)와 같은 모양이라 다음 필터 쓰기가 헛돌지 않는다
    const rest = new URLSearchParams(window.location.search);
    rest.delete("region");
    rest.delete("gu");
    const params = new URLSearchParams();
    if (filterRegion !== "전체") params.set("region", filterRegion);
    if (filterRegion !== "전체" && filterGu !== "전체") params.set("gu", filterGu);
    for (const [k, v] of rest) params.append(k, v);
    const q = params.toString();
    try {
      window.history.replaceState(null, "", q ? `/?${q}` : "/");
    } catch {
      /* noop */
    }
  }, [regionHub, setRegionHub, setHideNoUnsold, filterRegion, filterGu, tab]);
}
