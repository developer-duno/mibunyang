import { memo, useRef, useEffect, useState, useCallback, Suspense } from "react";
import { C, F, gr } from "@/theme";
import { InfraOverlay } from "./InfraOverlay";
import { SelectedAptCard } from "./SelectedAptCard";
import {
  MAP_DEFAULTS,
  CLUSTER_OPTS,
  MY_LOC_LEVEL,
  GEO_TIMEOUT,
  loadKakaoMapSdk,
  getKakaoMaps,
} from "./kakaoMapHelpers";
import { shortPrice, buildMarkerSvg, MY_LOCATION_DOT_SVG } from "./markerSvg";
import { MapShell, MyLocationButton } from "./mapShared";
import { lazyNamed } from "@/utils/lazyNamed";
import type { MapViewProps } from "@/types/components/MapView.types";
import type { Apt } from "@/types/scoring";
import type { ScoringResult } from "@/types/components";

type FilteredItem = { apt: Apt; res: ScoringResult };

const ChoroplethView = lazyNamed(() => import("./ChoroplethView"), "ChoroplethView");

// 지역 선택 시 클로즈업 fit 의 최소 줌 레벨 (카카오는 level 클수록 축소 — 세션 416 박제).
// 단지 1개만 남아도 "길 하나만 보이는" 과도 줌인 방지용 하한. 시/도=광역 유지, 구/군=더 클로즈업.
const REGION_FIT_MIN_LEVEL = 8;
// 구/군은 4 — 클러스터 경계(CLUSTER_OPTS.minLevel=5)보다 한 단계 더 줌인해야 단일 단지 구 선택 시
// 클러스터 원이 아닌 개별 마커가 풀려 보임("더 클로즈업" 의도, 세션 417 적대검증).
const GU_FIT_MIN_LEVEL = 4;
// region-fit 시 좌측/상단 필터·선택카드가 마커를 가리지 않게 padding 확보 (top,right,bottom,left).
const FIT_PADDING = { top: 40, right: 24, bottom: 40, left: 24 };

export const KakaoMapView = memo(function KakaoMapView({
  filtered,
  onDetail,
  isPC,
  isDesktop,
  height,
  compact,
  onSelect,
  getViewport,
  onViewportChange,
  deferredRegion,
  deferredGu,
  fullscreen,
  autoLocate,
}: MapViewProps) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<unknown>(null);
  const clustererRef = useRef<{ clear: () => void; addMarkers: (_m: unknown[]) => void } | null>(null);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<FilteredItem | null>(null);
  const [markerCount, setMarkerCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"point" | "choropleth">("point");
  const [mapInstance, setMapInstance] = useState<unknown>(null);

  // compact 는 마운트 시 고정 — init effect(deps []) 안에서 읽으므로 ref 캡처.
  // deps 에 compact 를 넣으면 cleanup 이 JS ref 만 해제(지도 destroy API 없음)하고
  // 같은 div 에 두 번째 지도가 중첩 생성되는 함정 (plan 함정 박제).
  const compactRef = useRef(compact);

  // onSelect 미러 — selected 감시 단일 지점으로 4개 setSelected 경로 전부 커버.
  // 마커 effect deps 에 onSelect 를 넣으면 인라인 콜백 전달 시 마커 전체 재생성 → ref 격리.
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  });
  useEffect(() => {
    onSelectRef.current?.(selected);
  }, [selected]);

  // onDetail 미러 — 마커 click 콜백이 최신 onDetail 을 참조하되 마커 effect deps 에 onDetail 을
  // 넣지 않아 마커 전체 재생성 회피(onSelectRef 답습, 세션 417 마커 클릭 1단계화).
  const onDetailRef = useRef(onDetail);
  useEffect(() => {
    onDetailRef.current = onDetail;
  });

  // 선택 마커 강조 — selected 변화 시 setImage 만 교체(마커 전체 재생성 금지). 클러스터러에 담긴
  // 마커라 setImage 후 redraw() 필요(auto-redraw 미보장). 전국 뷰(레벨≥5)는 클러스터 묶임이라
  // 강조가 클러스터 아이콘 뒤 → 줌인(개별 마커 풀림) 시 보임(정상). deps=[selected] 만 — 마커 effect
  // 와 분리해 전체 재생성 회피. markerByIdRef 는 마커 effect 가 채우므로 stale 자동 차단.
  useEffect(() => {
    const kakao = getKakaoMaps();
    if (!kakao) return;
    const restore = (id: string | null) => {
      if (!id) return;
      const m = markerByIdRef.current.get(id) as any;
      if (m && m.__normalImage) m.setImage(m.__normalImage);
    };
    // 이전 강조 복원 (id 가 바뀐 경우만)
    let changed = false;
    if (highlightedIdRef.current && highlightedIdRef.current !== selected?.apt.id) {
      restore(highlightedIdRef.current);
      highlightedIdRef.current = null;
      changed = true;
    }
    if (!selected || !selected.apt.id) {
      // 복원이 실제 일어났을 때만 redraw (불필요한 매 선택해제 redraw 회피)
      if (changed) (clustererRef.current as any)?.redraw?.();
      return;
    }
    const marker = markerByIdRef.current.get(selected.apt.id) as any;
    if (!marker) {
      if (changed) (clustererRef.current as any)?.redraw?.();
      return; // stale/filtered 교체로 사라진 마커 — no-op
    }
    const { apt, res } = selected;
    const { w, h, svg } = buildMarkerSvg(res.total, gr(res.total).c, shortPrice(apt.price), true);
    marker.setImage(
      new kakao.MarkerImage(`data:image/svg+xml,${encodeURIComponent(svg)}`, new kakao.Size(w, h), {
        offset: new kakao.Point(w / 2, h),
      })
    );
    if (marker.setZIndex) marker.setZIndex(50);
    highlightedIdRef.current = selected.apt.id;
    // 클러스터러가 setImage 변경을 화면에 반영하도록 redraw (개별 마커 풀린 상태에서 즉시 강조).
    (clustererRef.current as any)?.redraw?.();
  }, [selected]);

  // 뷰포트 보존 (M3) — getViewport()는 init effect(deps [])에서 1회 호출하므로 compactRef 답습 캡처.
  // onViewportChange 도 ref 미러(onSelectRef 답습) — idle 리스너 deps 오염/마커 재생성 방지.
  const getViewportRef = useRef(getViewport);
  const onViewportChangeRef = useRef(onViewportChange);
  useEffect(() => {
    onViewportChangeRef.current = onViewportChange;
  });
  // 첫 마커 렌더 1회만 자동 fit. viewport(복원값)는 init effect 의 초기 center/level 에만 사용.
  // ⚠️ didFitRef 를 viewport 로 시드하지 않는 이유(맹점 4): 탭 나가기 전 부산 보다가 경기 필터로
  // 바꾸고 재진입하면, 복원된 부산 center + fit 생략 = 경기 마커가 화면 밖 빈 지도. 재마운트는 항상
  // 첫 마커 fit 1회를 허용해 빈 화면 방지. 같은 마운트 내 filtered 변경은 didFitRef true 라 fit 생략(B-1).
  const didFitRef = useRef(false);

  // region-fit 가드 (세션 417) — deferredRegion/Gu 가 "직전 값과 실제로 다를 때만" fit.
  // 정렬·예산·면적 등 filtered 만 바뀌는 재계산에는 발화 0 (사용자 수동 팬/줌 위치 보존).
  // 초기값 = 현재 prop 이라 마운트 직후 첫 run 에선 변화 없음 → didFitRef 첫 fit 과 이중 fit 방지.
  const prevRegionRef = useRef(deferredRegion);
  const prevGuRef = useRef(deferredGu);

  // 선택 마커 강조 — 마커 effect 가 매 run 재채움(apt.id → marker). filtered 교체 시 옛 detach 마커
  // 참조 차단(stale write 방지). 강조 effect 는 이 ref 로 선택 마커를 찾아 setImage 교체.
  const markerByIdRef = useRef<Map<string, unknown>>(new Map());
  const highlightedIdRef = useRef<string | null>(null);

  // Kakao Maps SDK 동적 로드 + 지도 초기화
  useEffect(() => {
    let cancelled = false;
    // idle 리스너 cleanup 용 — addListener 와 동일 (map, handler) 참조로 removeListener.
    let idleCleanup: (() => void) | null = null;
    loadKakaoMapSdk()
      .then(() => {
        if (cancelled) return;
        const maps = getKakaoMaps();
        if (!maps) return;
        maps.load(() => {
          if (cancelled || !mapRef.current || mapInstanceRef.current) return;
          const vp = getViewportRef.current?.();
          const map = new maps.Map(mapRef.current, {
            center: new maps.LatLng(vp?.lat ?? MAP_DEFAULTS.lat, vp?.lng ?? MAP_DEFAULTS.lng),
            level: vp?.level ?? MAP_DEFAULTS.level,
          });
          // idle(팬/줌 종료) 시 현재 center/level 끌어올림 — 탭 전환/언마운트 간 보존.
          const onIdle = () => {
            const c = (map as any).getCenter();
            onViewportChangeRef.current?.({ lat: c.getLat(), lng: c.getLng(), level: (map as any).getLevel() });
          };
          maps.event.addListener(map, "idle", onIdle);
          // removeListener 는 일부 kakao 버전 미지원 → 옵셔널 가드 (ChoroplethView 답습).
          idleCleanup = () => maps.event.removeListener?.(map, "idle", onIdle);
          if (compactRef.current) {
            // 위젯 모드: 줌 컨트롤 생략 + 휠 줌 차단 (280px 위젯이 홈 페이지 스크롤을 가로채는 것 방지)
            map.setZoomable(false);
          } else {
            map.addControl(new maps.ZoomControl(), maps.ControlPosition.RIGHT);
          }
          mapInstanceRef.current = map;
          setMapInstance(map);
          clustererRef.current = new maps.MarkerClusterer({
            map,
            averageCenter: true,
            minLevel: CLUSTER_OPTS.minLevel,
            disableClickZoom: false,
            gridSize: CLUSTER_OPTS.gridSize,
            styles: [
              {
                width: "44px",
                height: "44px",
                background: C.indigo,
                borderRadius: "50%",
                color: C.white,
                textAlign: "center",
                fontWeight: "700",
                fontSize: "13px",
                lineHeight: "44px",
                opacity: "0.9",
                border: "2px solid rgba(255,255,255,0.85)",
                boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
              },
            ],
          });
          setReady(true);
        });
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
      if (idleCleanup) idleCleanup();
      if (clustererRef.current) clustererRef.current.clear();
      mapInstanceRef.current = null;
      setMapInstance(null);
      clustererRef.current = null;
    };
  }, []);

  // 색칠 모드 진입 시 마커/선택 상태 리셋 (event handler 에서 호출 — set-state-in-effect 회피)
  const clearMarkersAndSelection = useCallback(() => {
    clustererRef.current?.clear();
    setSelected(null);
    setMarkerCount(0);
  }, []);

  // 마커 업데이트 — point 모드에서만 동작 (color 모드는 event handler 가 clear 처리)
  useEffect(() => {
    if (!ready || !clustererRef.current || mode !== "point") return;
    const kakao = getKakaoMaps();
    if (!kakao) return;
    clustererRef.current.clear();
    // filtered 변경 시 이전 선택 정리 — 새 filtered 에서 사라진 단지의 selected 카드가 남는 것 방지
    setSelected(null);
    // 마커 매핑 재채움 — 옛 detach 마커 참조 차단(강조 effect stale write 방지)
    markerByIdRef.current = new Map();
    highlightedIdRef.current = null;

    const markers: unknown[] = [];
    for (const item of filtered) {
      const { apt, res } = item;
      if (!apt.lat || !apt.lng) continue;
      const pos = new kakao.LatLng(apt.lat, apt.lng);
      const grade = gr(res.total);
      const { w, h, svg } = buildMarkerSvg(res.total, grade.c, shortPrice(apt.price));
      const normalImage = new kakao.MarkerImage(`data:image/svg+xml,${encodeURIComponent(svg)}`, new kakao.Size(w, h), {
        offset: new kakao.Point(w / 2, h),
      });
      const marker = new kakao.Marker({ position: pos, title: apt.name, image: normalImage });
      // 강조 복원용 — 일반 이미지를 마커 객체에 보관(강조 해제 시 setImage 로 되돌림)
      (marker as any).__normalImage = normalImage;
      // 마커 클릭 = 선택 강조(setSelected) + 바로 상세 진입(onDetail). 세션 417: 사장님 "말풍선
      // 눌러도 안 들어간다" — 카드만 뜨던 2단계를 1단계로. 비로그인이면 onDetail(=handleDetailGated)이
      // 로그인 모달을 띄움(정책 유지). setSelected 는 강조·선택카드 유지용(세션 416).
      kakao.event.addListener(marker, "click", () => {
        setSelected(item);
        if (onDetailRef.current && item.apt.id) onDetailRef.current(item.apt.id);
      });
      markers.push(marker);
      if (apt.id) markerByIdRef.current.set(apt.id, marker);
    }
    clustererRef.current.addMarkers(markers);
    setMarkerCount(markers.length);

    // region/gu 가 직전과 달라졌는지 — 이 시점 markers 는 새 지역으로 재채워진 상태(stale 0).
    const regionChanged = deferredRegion !== prevRegionRef.current;
    const guChanged = deferredGu !== prevGuRef.current;
    prevRegionRef.current = deferredRegion;
    prevGuRef.current = deferredGu;

    if (markers.length > 0 && mapInstance) {
      if (!didFitRef.current) {
        // 첫 마커 렌더 1회만 자동 fit (M3, 세션 413) — 빈 화면 방지. 이후 filtered 변경은
        // 마커만 갱신해 사용자가 수동 조작한 지도 위치가 전국으로 튕기는 것 방지.
        const bounds = new kakao.LatLngBounds();
        markers.forEach((m: any) => bounds.extend(m.getPosition()));
        (mapInstance as any).setBounds(bounds);
        didFitRef.current = true;
      } else if ((regionChanged || guChanged) && deferredRegion && deferredRegion !== "전체") {
        // 지역/구 변경 전용 클로즈업 (세션 417) — 그 지역 단지들로 자동 확대·이동.
        // "전체" 로 되돌릴 때는 fit 안 함(전국 강제 리셋 = 수동 위치 보존). didFitRef·마커
        // effect deps 무변경 → 세션 413 빈화면 가드·수동 팬 보존 무손상.
        const bounds = new kakao.LatLngBounds();
        markers.forEach((m: any) => bounds.extend(m.getPosition()));
        const m = mapInstance as any;
        m.setBounds(bounds, FIT_PADDING.top, FIT_PADDING.right, FIT_PADDING.bottom, FIT_PADDING.left);
        // 단일/소수 단지 과도 줌인 보정 — 카카오 level 은 클수록 축소(세션 416). 구는 더 클로즈업 허용.
        const minLv = deferredGu && deferredGu !== "전체" ? GU_FIT_MIN_LEVEL : REGION_FIT_MIN_LEVEL;
        if (m.getLevel() < minLv) m.setLevel(minLv);
      }
    }
  }, [ready, filtered, mode, mapInstance, deferredRegion, deferredGu]);

  // 색칠 모드 폴리곤 클릭 → 점 보기 자동 복귀 (마커는 useEffect 가 재생성하므로 clear 불필요)
  const handleSidoClick = useCallback(() => {
    setMode("point");
  }, []);

  // 모드 토글 버튼 — point→color 전환 시 마커/선택 즉시 정리 (color→point 는 useEffect 가 재생성)
  const handleModeToggle = useCallback(() => {
    setMode((m) => {
      if (m === "point") clearMarkersAndSelection();
      return m === "point" ? "choropleth" : "point";
    });
  }, [clearMarkersAndSelection]);

  const handleInfoClick = useCallback(() => {
    if (selected && onDetail && selected.apt.id) onDetail(selected.apt.id);
  }, [selected, onDetail]);

  // 현위치 버튼 핸들러
  const myLocMarkerRef = useRef<any>(null);
  const handleMyLocation = useCallback(() => {
    if (!ready || !mapInstance || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const kakao = getKakaoMaps();
        if (!kakao) return;
        const loc = new kakao.LatLng(pos.coords.latitude, pos.coords.longitude);
        if (myLocMarkerRef.current) myLocMarkerRef.current.setPosition(loc);
        else {
          myLocMarkerRef.current = new kakao.Marker({
            position: loc,
            image: new kakao.MarkerImage(MY_LOCATION_DOT_SVG, new kakao.Size(20, 20), {
              offset: new kakao.Point(10, 10),
            }),
            zIndex: 100,
          });
          myLocMarkerRef.current.setMap(mapInstance);
        }
        (mapInstance as any).setCenter(loc);
        (mapInstance as any).setLevel(MY_LOC_LEVEL);
      },
      () => {
        /* 권한 거부 시 조용히 무시 */
      },
      { enableHighAccuracy: false, timeout: GEO_TIMEOUT }
    );
  }, [ready, mapInstance]);

  // GPS 첫 진입 자동 동네 표시 (세션 435) — 손님이 지역도 안 고르고 복원 뷰포트도 없는 "진짜 첫 방문"
  // 이면 자기 동네로 자동 이동. 권한 거부/실패/미지원이면 기존 동작(첫 마커 fit)으로 폴백.
  const autoLocatedRef = useRef(false);
  useEffect(() => {
    if (autoLocatedRef.current) return;
    if (!ready || !mapInstance || mode !== "point") return;
    if (compactRef.current && !autoLocate) return; // 위젯은 기본 제외, autoLocate 면 허용(홈 미니지도, 세션 435)
    if (!navigator.geolocation) return; // 미지원 → 폴백(첫 마커 fit)
    const region = deferredRegion;
    if (region && region !== "전체") return; // 손님이 지역 골랐으면 그 선택 우선
    if (getViewportRef.current?.()) return; // 복원 뷰포트 있으면(탭 재진입) 그대로
    autoLocatedRef.current = true;
    // 순서: 마커 effect(위에 선언)가 먼저 실행돼 첫 fit(전국 마커 bounds)을 이미 수행 → didFitRef=true.
    // 따라서 GPS 거부/실패여도 화면은 전국 마커 fit 상태(빈화면 0). GPS 성공 시에만 동네로 setCenter.
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const kakao = getKakaoMaps();
        if (!kakao || !mapInstanceRef.current) return; // 언마운트 후 콜백 가드
        // GPS 콜백 도착 사이 손님이 지역을 골랐으면(deferredRegion 변경) 그 선택 우선 — 덮어쓰기 방지.
        if (deferredRegion && deferredRegion !== "전체") return;
        const loc = new kakao.LatLng(pos.coords.latitude, pos.coords.longitude);
        myLocMarkerRef.current = new kakao.Marker({
          position: loc,
          image: new kakao.MarkerImage(MY_LOCATION_DOT_SVG, new kakao.Size(20, 20), {
            offset: new kakao.Point(10, 10),
          }),
          zIndex: 100,
        });
        myLocMarkerRef.current.setMap(mapInstance);
        (mapInstance as any).setCenter(loc);
        (mapInstance as any).setLevel(MY_LOC_LEVEL);
        // 동네로 이동했으니 이후 filtered 변경 시 전국 리셋 방지(didFitRef 유지 — 마커 effect 가 이미 true 세팅).
      },
      () => {
        /* 거부/실패 → 전국 마커 fit 상태 유지(폴백). 조용히 무시 */
      },
      { enableHighAccuracy: false, timeout: GEO_TIMEOUT }
    );
  }, [ready, mapInstance, mode, deferredRegion, autoLocate]);

  return (
    <MapShell ref={mapRef} isPC={isPC} isDesktop={isDesktop} height={height} fullscreen={fullscreen} error={error}>
      {/* 인프라 오버레이 토글 — compact(위젯) 모드에선 숨김 */}
      {!compact && (
        <InfraOverlay
          mapInstance={mapInstance}
          ready={ready}
          selectedApt={
            selected ? { lat: Number(selected.apt.lat) || null, lng: Number(selected.apt.lng) || null } : null
          }
        />
      )}
      {/* 현위치 버튼 */}
      {!compact && ready && navigator.geolocation && <MyLocationButton onClick={handleMyLocation} />}
      {/* 좌상단: 결과수 + 모드 토글 */}
      <div style={{ position: "absolute", top: 8, left: 8, display: "flex", gap: 6, zIndex: 10 }}>
        <div
          style={{
            background: "rgba(255,255,255,0.92)",
            borderRadius: 8,
            padding: "4px 10px",
            fontSize: F.xs,
            fontWeight: 700,
            color: C.indigo,
            boxShadow: "0 1px 4px rgba(0,0,0,0.12)",
          }}
        >
          {mode === "choropleth"
            ? `${filtered.length}개 단지`
            : markerCount == null
              ? `${filtered.length}개 단지`
              : markerCount === filtered.length
                ? `${filtered.length}개 단지`
                : `${markerCount} / ${filtered.length}개 단지`}
        </div>
        {/* 모드토글 — compact 에선 숨김 (point 모드 고정 진입로 차단). 결과수 badge 는 유지 (spec 숨김 목록 미포함) */}
        {!compact && (
          <button
            onClick={handleModeToggle}
            aria-pressed={mode === "choropleth"}
            aria-label="지도 모드 토글"
            style={{
              background: "rgba(255,255,255,0.92)",
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              padding: "4px 10px",
              fontSize: F.xs,
              fontWeight: 700,
              color: C.indigo,
              cursor: "pointer",
              boxShadow: "0 1px 4px rgba(0,0,0,0.12)",
            }}
          >
            {mode === "point" ? "🎨 색칠" : "📍 점"}
          </button>
        )}
      </div>
      {/* 색칠 모드: ChoroplethView lazy 렌더 */}
      {mode === "choropleth" && (
        <Suspense fallback={null}>
          <ChoroplethView
            mapInstance={mapInstance}
            ready={ready}
            filtered={filtered}
            onSidoClick={handleSidoClick}
            isPC={isPC}
            isDesktop={isDesktop}
          />
        </Suspense>
      )}
      {/* 선택된 아파트 정보 카드 */}
      <SelectedAptCard selected={selected} onInfoClick={handleInfoClick} onClose={() => setSelected(null)} />
    </MapShell>
  );
});
