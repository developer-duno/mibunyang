import { memo, useEffect, useMemo, useRef, useState, Suspense, type CSSProperties } from "react";
import { lazyNamed } from "@/utils/lazyNamed";
import { C, F } from "@/theme";
import { PROFILES, getTopCats } from "@/constants/profiles";
import { aptVerdict } from "@/constants/aptVerdict";
import { catVerdict } from "@/constants/catVerdict";
import { orderedCatEntries } from "@/constants/catOrder";
import { DeviationStrip } from "./DeviationStrip";
import { OVERVIEW_DEVIATION_FIELDS } from "@/constants/deviationFields";
import { AreaPriceScatter } from "./charts/AreaPriceScatter";
import { DistanceDots } from "./charts/DistanceDots";
import { ScoreBadge } from "./primitives";
import { CatPanel, getHighlights } from "./CatPanel";
import { TransportCard } from "./detail/TransportCard";
import { fmtPrice, fmtCompletion } from "@/lib/format";
import { PriceTable } from "./detail/PriceTable";
import { SchoolInfo } from "./detail/SchoolInfo";
import { NearbyChildcareSection } from "./detail/NearbyChildcareSection";
import { LoanAnalysis } from "./detail/LoanAnalysis";
import {
  DataSectionBlock,
  NearbyFacilitiesBlock,
  PriceByFloorBlock,
  AnnouncementLink,
} from "./detail/DataSectionBlock";
import { ExtraFieldsAccordion } from "./detail/ExtraFieldsAccordion";
import { PresaleTimeline } from "./charts/PresaleTimeline";
import { LoanStack } from "./charts/LoanStack";
import { CategoryMiniCard } from "./detail/CategoryMiniCard";
import { ProfileWeightBar } from "./detail/ProfileWeightBar";
import { BlindScoreBadge, LoginCta, ScoreLockPanel } from "./detail/ScoreBlind";
import { AdminDataAudit } from "./detail/AdminDataAudit";
import { OVERVIEW_SECTIONS, LOCATION_SECTIONS, PRICE_SECTIONS, PRESALE_SECTIONS } from "@/lib/dataSections";
import { PresaleInfo } from "./detail/PresaleInfo";
import { UnsoldEventCard } from "./detail/UnsoldEventCard";
import { BuilderCard } from "./detail/BuilderCard";
import { BuildingInfoCard } from "./detail/BuildingInfoCard";
import { PriceChart } from "./detail/PriceChart";
import { UnsoldChart } from "./detail/UnsoldChart";
import { SourceComparison } from "./detail/SourceComparison";
import { RegionStats } from "./detail/RegionStats";
import { HelpHint } from "./HelpHint";
import { StickyJumpNav, type JumpSection } from "./detail/StickyJumpNav";
import { IconClose } from "./icons";
import { fetchApartmentDetail, type AptDetailFields } from "@/services/staticDataApi";
import type { Apt, Cats, Res } from "@/types/scoring";
import { trackEvent } from "@/lib/analytics";
import type { DetailModalProps } from "@/types/components/DetailModal.types";

// 관리자 인사이트 레이어 (세션 405 전문가 대시보드 이식) — adminLoggedIn 일 때만 로드 (소비자 번들 영향 0)
const AdminScoreBreakdown = lazyNamed(() => import("./detail/AdminScoreBreakdown"), "AdminScoreBreakdown");
const AdminUnitSupply = lazyNamed(() => import("./detail/AdminUnitSupply"), "AdminUnitSupply");

// 탭바 6섹션 정의 — id 는 영문 슬러그 (한글 id CSS.escape 함정 회피).
// 13블록을 6탭으로 묶되 데이터 삭제·축소 0 (각 블록은 정확히 1탭 소속, 세션 407 D1: 점프 앵커 → 콘텐츠 교체 탭).
const JUMP_SECTIONS: JumpSection[] = [
  { id: "sec-overview", label: "종합" },
  { id: "sec-price", label: "시세" },
  { id: "sec-location", label: "입지" },
  { id: "sec-presale", label: "분양" },
  { id: "sec-finance", label: "금융" },
  { id: "sec-score", label: "점수" },
];

// 탭 전환 페이드 (세션 410 D3) — 활성 패널 진입 시 opacity 0→1 .18s. display:none→표시 전환 시
// animation-name 신규 적용으로 keyframe 1회 재생(W3C CSS Animations). prefers-reduced-motion 존중.
// <style> 은 게이트 밖 항상 렌더 위치에 1회 주입(Skeleton primitives.tsx 패턴 답습).
const FADE_KEYFRAMES = `@keyframes detailTabFade { from { opacity: 0 } to { opacity: 1 } }
@media (prefers-reduced-motion: reduce) { [data-tab-panel] { animation: none !important } }`;

const DM_S = {
  dragBar: { width: 40, height: 4, background: C.border, borderRadius: 2, margin: "0 auto 12px", cursor: "pointer" },
  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  closeBtn: {
    background: C.slate100,
    border: "none",
    borderRadius: "50%",
    width: 44,
    height: 44,
    cursor: "pointer",
    color: C.muted,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  // 종합 판정 한 줄 (세션508 PR-3a A1) — ScoreBadge 보다 먼저 뜨는 상위 결론 문장.
  verdictLine: { fontSize: F.md, fontWeight: 700, color: C.text, textAlign: "center" as const, marginBottom: 8 },
  verdictBlind: { fontSize: F.sm, color: C.muted, textAlign: "center" as const, marginBottom: 8 },
  scoreBadgeWrap: { textAlign: "center" as const, marginBottom: 16 },
  metricsHead: { fontSize: F.md, fontWeight: 700, color: C.text, marginBottom: 6 },
  metricsRow: { display: "flex", justifyContent: "space-between", padding: "4px 0" },
  metricsLabel: { fontSize: F.base, color: C.muted },
  benefitsBox: {
    background: C.amberLight,
    borderRadius: 10,
    padding: "8px 10px",
    marginBottom: 10,
    border: `1px solid ${C.amberBorder}`,
  },
  benefitsHead: { fontSize: F.base, fontWeight: 700, color: C.amber, marginBottom: 4 },
  benefitsChipRow: { display: "flex", flexWrap: "wrap" as const, gap: 4 },
  benefitsChip: {
    fontSize: F.sm,
    color: C.amber,
    background: C.white,
    padding: "4px 10px",
    borderRadius: 4,
    border: `1px solid ${C.amberBorder}`,
  },
  republishBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: F.sm,
    color: C.amber,
    background: C.amberLight,
    border: `1px solid ${C.amberBorder}`,
    borderRadius: 6,
    padding: "3px 8px",
    marginBottom: 8,
  },
  sourceFooter: { fontSize: F.micro, color: C.muted, marginTop: 10, lineHeight: 1.5 },
  actionRow: { display: "flex", gap: 8 },
};

export const DetailModal = memo(function DetailModal({
  item,
  onClose,
  isComp,
  onComp,
  isFav,
  onFav,
  onShare,
  isPC,
  isDesktop,
  onConsult,
  profile,
  adminLoggedIn = false,
  regionStats = null,
  isLoggedIn = true,
  onRequestLogin,
}: DetailModalProps) {
  // 비로그인 점수 블라인드 (단계 2-A). 세션 503(2-B)이 상세 게이트를 없애면서 이 분기가 실제로
  // 켜졌다 — 이제 비로그인·검색엔진이 여기까지 도달한다(그 전까지는 도달 자체가 불가능했다).
  const blind = !isLoggedIn;
  // 종합 탭 편차 스트립 8줄 (세션 487 PR-4) — 카드와 **같은 컴포넌트**, 트랙만 넓다.
  // 카드에서 배운 읽는 법("오른쪽으로 길수록 유리")이 팝업에서 그대로 통해야 하기 때문.
  // 지역 분포가 있어야만 그린다(없으면 "미수집" 8줄짜리 빈 블록). 다른 차트·서랍은 이 값을
  // 안 쓰므로 세션 505 에 게이트를 걷어냈다 — 되돌림용 플래그도 같이 졸업.
  const showDeviation = regionStats != null;
  const closeRef = useRef<HTMLButtonElement>(null);
  const prevFocusRef = useRef<Element | null>(null);
  // 상세 필드 lazy fetch (apartments-detail-16-N.json 버킷 1개, 세션 468) — DetailModal 첫 열림 시
  // id 해시 버킷 1개만 fetch(br ~69KB) + 버킷 단위 Map 캐시. 가격배열 + 학교/어린이집/혜택 + full catsCache 통합.
  const [detail, setDetail] = useState<AptDetailFields | null>(null);
  const [pricesLoading, setPricesLoading] = useState(false);
  const [pricesError, setPricesError] = useState<string | null>(null);
  useEffect(() => {
    if (!item) return;
    prevFocusRef.current = document.activeElement;
    document.body.style.overflow = "hidden";
    // 모달 열림 시 닫기 버튼으로 포커스 이동 (모바일 가상키보드 방지)
    requestAnimationFrame(() => closeRef.current?.focus());
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // 포커스 트랩: Tab 키가 모달 내부에서만 순환
      if (e.key === "Tab") {
        const modal = closeRef.current?.closest('[role="dialog"]');
        if (!modal) return;
        const focusable = modal.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (!focusable.length) return;
        const first = focusable[0],
          last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          (last as HTMLElement).focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          (first as HTMLElement).focus();
        }
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", handleKey);
      // 모달 닫힘 시 이전 포커스 복원
      (prevFocusRef.current as HTMLElement | null)?.focus?.();
    };
    // boolean sentinel: 모달 열림/닫힘(false↔true)에만 effect 재실행. item 객체 reference 변경 시
    // 포커스가 닫기 버튼으로 튀거나 body overflow 가 깜박이는 것 방지. exhaustive-deps 의도적 위반.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!item, onClose]);

  // ── 문서 제목 ↔ 열린 단지 (세션 503, 단계 2-B) ──
  // 상세 2,043쪽이 전부 "미분양 비교 엔진 v3.0" 한 제목이면 검색결과에서 서로 구분이 안 된다.
  // 닫을 때 되돌리는 게 핵심 — 목록으로 나왔는데 제목에 단지명이 남아 있으면 그 자체가 거짓 표시다.
  useEffect(() => {
    if (typeof document === "undefined" || !item) return;
    const prev = document.title;
    const a = item.apt;
    const where = [a.region, a.gu].filter(Boolean).join(" ");
    document.title = `${a.name}${where ? ` (${where})` : ""} 분양가·미분양 | 미분양 비교`;
    return () => {
      document.title = prev;
    };
  }, [item]);

  // 상세 필드 lazy fetch — item 변경 시마다 (버킷 캐시 hit 으로 안전)
  useEffect(() => {
    if (!item) {
      setDetail(null);
      setPricesError(null);
      setPricesLoading(false);
      return;
    }
    const aptId = item.apt.id as string;
    // Supabase 분기 가드 — apartments_flat VIEW 가 단지별로 priceByArea 를 다른 형태로 응답:
    //   - null: trade_stats LEFT JOIN miss (가격 데이터 미수집 단지)
    //   - 배열 (빈 배열 포함): trade_stats 응답 완료 (거래 0건 = 빈 배열)
    //   - undefined: 정적 분기 (USE_SUPABASE=false) apartments-list.json 에 priceByArea 미수록
    // null/배열 모두 "이미 응답 받은 상태" → fetch skip(Supabase 는 catsCache full·학교도 함께 옴).
    // undefined 만 버킷 fetch 발동 (정적 lazy).
    const priceByArea = (item.apt as { priceByArea?: unknown }).priceByArea;
    if (priceByArea !== undefined) {
      // null/배열/미래 타입 모두 fetch skip — 이미 응답 받은 상태
      setDetail(null);
      setPricesError(null);
      return;
    }
    let cancelled = false;
    setPricesLoading(true);
    setPricesError(null);
    fetchApartmentDetail(aptId)
      .then((d) => {
        if (!cancelled) {
          setDetail(d);
          setPricesLoading(false);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (import.meta.env.DEV) {
          console.warn("[DetailModal] detail fetch 실패", msg);
        }
        setPricesError(msg);
        setPricesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [item]);
  // 상세 필드 병합 — useMemo + item?.apt.id deps 로 item ref 변경마다 무효화 차단.
  // hook 순서 보장 위해 conditional return 이전에 호출. item 미정의 시 undefined 반환.
  // 버킷의 가격배열·학교·어린이집·혜택·catsCache(full) 를 목록의 슬림 apt 위에 덮음.
  const mergedApt = useMemo(
    () => (item && detail ? ({ ...item.apt, ...detail } as Apt) : item?.apt),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- item?.apt 가 item ref 변경을 추적(item 바뀌면 apt 도 새 ref)하므로 단지 전환 무효화 충분. item 본문 추가 불필요.
    [item?.apt.id, item?.apt, detail]
  );
  // 점수 res 병합 — 목록의 res.cats 는 슬림 subs(price/location subs[0] 만). 버킷의 full catsCache
  // 로 카테고리별 subs 를 복원한 res 를 CatPanel·AdminScoreBreakdown 에 전달. total/가중치는 scored 유지.
  const mergedRes = useMemo(() => {
    const full = detail?.catsCache as Cats | null | undefined;
    if (!item || !full) return item?.res;
    const fullCats = full as unknown as Record<string, Res | undefined>;
    const cats = Object.fromEntries(
      Object.entries(item.res.cats).map(([k, c]) => {
        const f = fullCats[k];
        return [k, f?.subs?.length ? { ...c, subs: f.subs } : c];
      })
    ) as Cats;
    return { ...item.res, cats };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- item?.res 가 item ref 변경 추적, detail 은 버킷 도착 시 재계산.
  }, [item?.res, detail]);

  // 탭 상태 (세션 407 D1) — activeTab = 현재 콘텐츠 교체 탭, visited = 방문 탭 누적(keepMounted).
  // 한 번 마운트된 패널은 display:none 으로 유지: 떠난 탭의 fetch 훅 인스턴스 캐시(useRef 캐시인
  // useLoanRates/useRentLoanRates 포함)·trackEvent dedup·펼침 상태가 모달 열림 세션 동안 보존된다.
  // 리셋 effect 없음 — App 이 detailAptId 조건부 렌더라 닫힘 = 언마운트 = state 자연 소멸.
  // 불변식: activeTab ∈ visited (초기 시딩 + handleTabChange 가 둘을 동시 갱신).
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [activeTab, setActiveTab] = useState<string>(JUMP_SECTIONS[0].id);
  const [visited, setVisited] = useState<Set<string>>(() => new Set([JUMP_SECTIONS[0].id]));

  // 탭 목록 — 관리자 로그인 시에만 "관리자" 탭(sec-admin) 7번째 추가 (세션 409 D2b).
  // 소비자(adminLoggedIn=false)는 JUMP_SECTIONS 6개 그대로 = 칩·패널 노출 0. 초기 탭은 항상
  // JUMP_SECTIONS[0](sec-overview) 불변이라 activeTab/visited 초기값(위)과 단일 출처 유지.
  const sections = useMemo<JumpSection[]>(
    () => (adminLoggedIn ? [...JUMP_SECTIONS, { id: "sec-admin", label: "관리자" }] : JUMP_SECTIONS),
    [adminLoggedIn]
  );

  // 관리자가 sec-admin 탭을 보던 중 로그아웃 → sections 6개로 축소되며 activeTab 이 사라진 탭을 가리켜
  // 모든 패널 display:none = 빈 본문. activeTab 이 더 이상 존재하지 않으면 종합 탭으로 복원(세션 410 D3 적대검증).
  useEffect(() => {
    if (!sections.some((s) => s.id === activeTab)) setActiveTab(JUMP_SECTIONS[0].id);
  }, [sections, activeTab]);

  // 미니카드 → 점수 탭 자동 펼침: 카테고리별 단조 증가 seq. 점프 시 그 카테고리 CatPanel 의 key 만
  // 바뀌어 1개만 리마운트(=defaultExpanded 재평가=펼침), 형제 5개 key 불변 = 손으로 펼친 상태 보존.
  // 같은 카테고리 재클릭도 seq+1 로 재펼침. 모달 닫힘 = 언마운트 = 자연 소멸 (세션 409 D2b 적대검증 R2).
  const [jumpSeqs, setJumpSeqs] = useState<Record<string, number>>({});
  const handleCategoryJump = (k: string) => {
    setJumpSeqs((m) => ({ ...m, [k]: (m[k] ?? 0) + 1 }));
    handleTabChange("sec-score");
  };

  // 칩 클릭 = 탭 전환. setActiveTab/visited 는 무조건 실행(가드 밖) — scrollTo 미구현 환경
  // (jsdom·구형 브라우저)에서도 탭 전환은 일어나야 비활성 패널 콘텐츠에 도달 가능.
  // scrollTo 는 탭 전환 시 이전 탭의 스크롤 잔류 방지용 top:0 리셋(instant)만.
  const handleTabChange = (id: string) => {
    // analytics — 탭이 실제 바뀔 때만 발화(같은 탭 재선택 제외). activeTab 은 인라인 함수 클로저라
    // 클릭 시점의 최신 활성탭 캡처. 미니카드 점프(handleCategoryJump→sec-score)·칩 클릭·화살표 전환
    // 모두 이 핸들러 경유 = 단일 발화 지점. tab_switch(useAppNavigation) 선례 답습.
    if (id !== activeTab) trackEvent("detail_tab_view", { tab: id, previous_tab: activeTab });
    setActiveTab(id);
    setVisited((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    const root = bodyRef.current;
    if (root && typeof root.scrollTo === "function") root.scrollTo({ top: 0 });
  };

  // 패널 마운트/표시 규칙 — 관리자는 전부 즉시 마운트(인쇄 "전체 펼침" 보존), 소비자는 첫 방문 시
  // 마운트 후 keepMounted. 표시는 activeTab 만 (나머지 display:none — print CSS 가 인쇄 시 펼침).
  const isPanelMounted = (id: string) => adminLoggedIn || visited.has(id);
  // 활성 패널만 페이드 애니메이션 부여 — display:none→표시 전환 시 keyframe 1회 재생(세션 410 D3).
  // 같은 탭 유지 중 리렌더는 animation 문자열 동일 → 재생 skip(깜빡임 0). 인쇄는 print CSS 가 무효화.
  const panelStyle = (id: string): CSSProperties =>
    activeTab === id
      ? { margin: 0, padding: 0, animation: "detailTabFade .18s ease-out" }
      : { margin: 0, padding: 0, display: "none" };

  if (!item) return null;
  const { apt, res } = item;
  // 종합 판정 한 줄 (세션508 PR-3a A1) — blind 여부와 무관하게 순수 계산(res.total/res.cats 만 봄).
  // 렌더 분기(blind 면 대신 "점수는 로그인 후 볼 수 있어요")는 아래 JSX 에서 결정한다.
  const verdict = aptVerdict(res.total, res.cats);

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        zIndex: 300,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: isPC ? "center" : "flex-end",
        justifyContent: "center",
      }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${apt.name} 상세 분석`}
    >
      <div
        style={{
          background: C.card,
          borderRadius: isPC ? 20 : "20px 20px 0 0",
          width: "100%",
          maxWidth: isDesktop ? 760 : isPC ? 640 : 520,
          maxHeight: isPC ? "92dvh" : "95dvh",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          boxShadow: isPC ? "0 8px 40px rgba(0,0,0,0.2)" : "0 -8px 30px rgba(0,0,0,0.15)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            flexShrink: 0,
            padding: isDesktop ? "16px 24px 0" : "12px 16px 0",
            borderBottom: `1px solid ${C.border}`,
            background: C.card,
          }}
        >
          {!isDesktop && <div onClick={onClose} style={DM_S.dragBar} />}
          <div style={DM_S.headerRow}>
            <div>
              {/* 세션 503(2-B): 검색엔진·스크린리더가 "이 쪽의 제목"으로 읽는 자리. 크기·굵기는
                  인라인으로 고정돼 있어 h1 의 기본 스타일이 안 먹고, margin 만 0 으로 눌러 모양 보존. */}
              <h1 style={{ fontSize: isDesktop ? F.xl : F.lg, fontWeight: 800, color: C.text, margin: 0 }}>
                {apt.name}
              </h1>
              <div style={{ fontSize: isDesktop ? F.base : F.sm, color: C.muted }}>
                {[apt.region, apt.gu, apt.dong].filter(Boolean).join(" ")} · {apt.area}㎡ · {fmtPrice(apt.price)}
              </div>
              {apt.address ? (
                <div style={{ fontSize: F.sm, color: C.muted, marginTop: 2 }}>
                  {String(apt.address)}
                  {apt.district ? ` (${String(apt.district)})` : ""}
                </div>
              ) : null}
              {apt.roadAddress ? <div style={{ fontSize: F.sm, color: C.muted }}>{String(apt.roadAddress)}</div> : null}
            </div>
            <button ref={closeRef} onClick={onClose} aria-label="닫기" style={DM_S.closeBtn}>
              <IconClose size={18} />
            </button>
          </div>
        </div>
        {/* data-print-content: 관리자 인쇄 시 App print CSS 가 스크롤 해제·전체 펼침 (세션 405) */}
        {/* 하단 패딩은 CTA sticky 바가 자체 패딩으로 담당 (바닥 밀착을 위해 스크롤러 하단 패딩 0) */}
        <div
          ref={bodyRef}
          data-testid="detail-scroll-body"
          data-print-content
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            position: "relative",
            padding: isDesktop ? "0 24px" : "0 16px",
          }}
        >
          <StickyJumpNav
            sections={sections}
            activeId={activeTab}
            // 목차바 우측 "종합 NN" 배지도 같은 종합점수다 — 여기를 안 막으면 뿌옇게 만든 원 바로
            // 위에 숫자가 그대로 떠서 블라인드가 무의미해진다. null = 배지 자체 미렌더
            // (StickyJumpNav 의 `totalScore != null` 가드 재사용, 그쪽 파일 무변경).
            totalScore={blind ? null : res.total}
            onJump={handleTabChange}
            isMounted={isPanelMounted}
            isDesktop={isDesktop}
            noPrint
          />
          {/* 탭 전환 페이드 keyframes — 게이트 밖 항상 렌더 위치 1회 주입 (세션 410 D3) */}
          <style>{FADE_KEYFRAMES}</style>

          {/* §1 종합 탭 — ScoreBadge + 핵심지표 + 카테고리 미니카드 6 + 혜택칩 + 재공고배지 (세션 409 D2b: 레이더 제거) */}
          {isPanelMounted("sec-overview") && (
            <section
              id="sec-overview"
              role="tabpanel"
              aria-labelledby="tab-sec-overview"
              data-tab-panel
              style={panelStyle("sec-overview")}
            >
              {/* 종합 판정 한 줄 (세션508 PR-3a A1) — ScoreBadge 보다 먼저. ProfileWeightBar 의
            "강점/보완" 요약을 대체한다(ProfileWeightBar 는 profile && !blind 일 때만 떠서
            비로그인·프로필 미선택 손님은 결론 문장을 못 봤다 — 이 한 줄이 상위 개념). blind 는
            점수 파생값이라 등급·카테고리 대신 "로그인 후" 안내로 교체한다. verdict 가 null
            (슬림 catsCache 등)이면 아무것도 렌더하지 않는다 — NaN·"—등급" 표시 금지. */}
              {blind ? (
                <div style={DM_S.verdictBlind}>점수는 로그인 후 볼 수 있어요</div>
              ) : (
                verdict && <div style={DM_S.verdictLine}>{verdict}</div>
              )}

              <div style={DM_S.scoreBadgeWrap}>
                {blind ? <BlindScoreBadge size={80} /> : <ScoreBadge score={res.total} size={80} />}
              </div>

              {/* 핵심 지표 — 세션 409 D2b: 6각형 레이더 제거(카테고리 점수는 아래 미니카드와 이중 노출 → 루즈
            해소, 사장님 지시). 미니카드가 카테고리 시각화+진입 역할을 모두 흡수. 핵심지표는 전폭.
            세션 505: 8행 → 4행(지역·분양가는 헤더, 전세가율·미분양률은 편차 스트립과 겹쳐 뺌).
            세션508 PR-3a A2: 4행 → 2행. 규제현황·LTV한도는 금융 탭이 이미 배지+3칸으로 갖고
            있다(A3) — 같은 값을 두 곳에서 또 읽게 하지 않는다(정보 손실 0). */}
              <div style={{ marginBottom: 12 }}>
                <div>
                  <div style={DM_S.metricsHead}>핵심 지표</div>
                  {[
                    {
                      l: "적정가 괴리",
                      v:
                        res.cats.price.deviation != null
                          ? `${Number(res.cats.price.deviation) > 0 ? "+" : ""}${res.cats.price.deviation}%`
                          : "—",
                      c:
                        res.cats.price.deviation != null
                          ? Number(res.cats.price.deviation) > 0
                            ? C.green
                            : C.red
                          : C.muted,
                      hint: "주변 시세로 계산한 '적정가'와 실제 분양가를 비교한 거예요. +(플러스)면 적정가보다 싸게(좋은 신호), −(마이너스)면 비싸게 나온 거예요. 예: +5%면 적정가보다 5% 저렴해요.",
                    },
                    { l: "입주", v: fmtCompletion(apt.completion) },
                  ].map((r, i) => (
                    <div key={i} style={DM_S.metricsRow}>
                      <span style={{ ...DM_S.metricsLabel, display: "flex", alignItems: "center" }}>
                        {r.l}
                        {(r as { hint?: string }).hint && (
                          <HelpHint text={(r as { hint?: string }).hint as string} label={r.l} />
                        )}
                      </span>
                      <span style={{ fontSize: F.base, fontWeight: 600, color: r.c || C.text }}>{r.v}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 카테고리 요약 미니카드 (세션 409 D2b) — 점수+등급+결론, 탭하면 점수 탭 해당 카테고리 자동 펼침.
            ⚠️ 옛 주석은 "레이더(위)가 한눈 비교, 미니카드는 결론+진입"이라 했으나 레이더는 세션 409 에
            이미 제거됐다(현재 코드에 없음). 세션508 PR-3a A4: 편차 스트립을 미니카드 뒤로 옮겼다 —
            스트립(231px)이 미니카드 앞을 막으면 "카드를 첫 화면 안으로"라는 목표 자체가 무효화된다.
            역할 분리는 "미니카드 = 카테고리 결론+진입(행동), 스트립 = 지역 대비 위치(상대, 근거)"다.
            benefit 제외 6→5개 (2026-08-11) — PROFILES 5개 전부 가중치 0 이 되어 더 이상 "점수
            카테고리"가 아니다(constants/profiles.ts 근거 주석 참조). 실제 혜택 금액은 지우지
            않고 아래 별도 사실 라벨("총 혜택 약 N만원")로 옮겼다 — 점수 그리드와 섞이면 안 된다. */}
              {(() => {
                const overviewTopCats = profile ? (getTopCats(PROFILES[profile].w) as string[]) : [];
                return (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: isPC ? "repeat(3, 1fr)" : "repeat(2, 1fr)",
                      gap: 8,
                      margin: "12px 0",
                    }}
                  >
                    {orderedCatEntries(res.cats as unknown as Record<string, Res>)
                      .filter(([k]) => k !== "benefit")
                      .map(([k, c]) => (
                        <CategoryMiniCard
                          key={k}
                          k={k}
                          cat={c}
                          emphasized={overviewTopCats.includes(k)}
                          onJump={() => handleCategoryJump(k)}
                          blind={blind}
                        />
                      ))}
                  </div>
                );
              })()}

              {/* 프로필 가중치 막대 — "왜 이 점수인지" 새 정보축 (세션 434 점수 근거 투명화 A+B).
            ⚠️ 옛 주석은 "상세 모달은 로그인 전제(useDetailModal 단일 진입)라 블라인드 무관"이라 했으나
            그 전제는 이미 깨졌다 — 2-A 로 블라인드를 넣었고 세션 503(2-B)이 게이트를 없애 비로그인도
            상세를 연다. 비로그인엔 아예 안 그린다 —
            가중치는 "내 프로필"이 있어야 성립하는 값이라 뿌옇게 남기는 것보다 없는 편이 정직하다.
            세션508 PR-3a A1: 강점/보완 요약 줄은 위 판정 한 줄로 이관 — 이제 막대만 그린다. */}
              {profile && !blind && <ProfileWeightBar weights={PROFILES[profile].w} cats={res.cats} />}

              {/* 요약 시각화 — "이 단지 vs 같은 지역 한가운데 값" 8줄 (세션 487 PR-4).
                  카드의 3줄과 같은 컴포넌트라 읽는 법이 그대로 이어진다. 트랙만 넓다.
                  세션508 PR-3a A4: 미니카드 뒤로 이동(위 주석 참조). apt 는 raw(mergedApt 아님) —
                  detail 버킷(staticDataApi.ts:63-73)에 이 컴포넌트가 읽는 필드가 없어 값이 안
                  바뀐다(전수 grep 확인, v1 의 "PresaleInfo 만 raw" 단정은 오류였다). */}
              {showDeviation && (
                <DeviationStrip
                  apt={apt}
                  fields={OVERVIEW_DEVIATION_FIELDS}
                  regionStats={regionStats}
                  compact={false}
                />
              )}

              {/* 혜택 사실 라벨 (2026-08-11) — benefit 이 점수 카테고리에서 빠지면서(위 미니카드 참조)
              생긴 자리. 점수가 아니라 "총 혜택 약 N만원" 금액 사실만 보여준다 — 점수 그리드와
              떨어뜨리려 미니카드 뒤(여기)에 둔다. AptCard.tsx 의 같은 문구·조건(totalWon > 0)을
              그대로 답습(그쪽은 건드리지 않음, 다른 브랜치 충돌 회피) — 카드에서 본 문구가 상세에서도
              똑같이 읽혀야 한다. `apt.benefits`(정성적 혜택 목록 칩)는 운영 실측 채움 0%(0/1,646)라
              사실상 항상 비어 있지만, 데이터가 채워지면 자동 노출되도록 조건은 그대로 둔다. */}
              {(() => {
                // totalWon/rate 는 subs 와 달리 슬림 res(목록 응답)에도 이미 있다(AptCard.tsx:96 이
                // 같은 res.cats.benefit?.totalWon 을 버킷 없이 그대로 씀) — mergedRes 대기 불필요.
                const benefitWon = res.cats.benefit?.totalWon ?? 0;
                const benefitRate = res.cats.benefit?.rate ?? 0;
                const benefitsList = (mergedApt ?? apt).benefits;
                const hasBenefitsList = Array.isArray(benefitsList) && (benefitsList as unknown[]).length > 0;
                if (!(benefitWon > 0) && !hasBenefitsList) return null;
                return (
                  <div style={DM_S.benefitsBox}>
                    {benefitWon > 0 && (
                      <div style={DM_S.benefitsHead}>
                        {res.cats.benefit?.wonSource || "혜택"} 약 {benefitWon.toLocaleString()}만원 ({benefitRate}%)
                      </div>
                    )}
                    {hasBenefitsList && (
                      <div style={DM_S.benefitsChipRow}>
                        {(benefitsList as string[]).map((b: string, i: number) => (
                          <span key={i} style={DM_S.benefitsChip}>
                            {b}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {Array.isArray(apt.siblingIds) && (apt.siblingIds as string[]).length > 1 && (
                <div style={DM_S.republishBadge}>재공고 {(apt.siblingIds as string[]).length}회 · 시계열 통합 조회</div>
              )}

              {/* 건물 정보 카드 (세션508 PR-3c C4) — 층수·구조·용적률·향 8필드. 기본 접힘 —
                  TransportCard·BuilderCard 패턴 답습. layout 은 카드 자체가 점수 접미어 없는
                  전용 포맷을 쓴다(FIELD_META.layout.fmt 는 점수를 문자열에 박아 재사용 금지). */}
              <BuildingInfoCard apt={mergedApt ?? apt} />

              {/* 단지 기본정보 (핵심지표 중복 4필드 제외 — 세션 408 D2a) */}
              {OVERVIEW_SECTIONS.map((s) => (
                <DataSectionBlock key={s.title} section={s} apt={mergedApt ?? apt} />
              ))}

              <ExtraFieldsAccordion apt={mergedApt ?? apt} tab="sec-overview" />

              {/* 잠금 자리 CTA (단계 2-A) — 종합 탭 하단 1곳. 점수 탭 잠금 패널의 것과 같은 문구. */}
              {blind && <LoginCta onRequestLogin={onRequestLogin} />}

              {/* 출처 footer — 전 탭 공통 데이터 출처 (종합 탭 1회 고정, 세션 408 D2a) */}
              <div style={DM_S.sourceFooter}>
                출처: 청약홈(국토교통부) · 카카오 로컬 API · KOSIS(통계청) · 국토부 실거래가 · NEIS(교육부)
              </div>
            </section>
          )}

          {/* §2 시세 탭 — PriceTable + PriceChart + UnsoldChart */}
          {isPanelMounted("sec-price") && (
            <section
              id="sec-price"
              role="tabpanel"
              aria-labelledby="tab-sec-price"
              data-tab-panel
              style={panelStyle("sec-price")}
            >
              {/* 적정가 대비 위치 게이지 (세션 430) — deviation 양수=저렴(scorePrice.ts 진실원천), -30~+30% 클램프, 0 중앙.
                  ⚠️ 옛 이름 "주변 시세 대비"는 거짓이었다 — 이 값은 `scorePrice.ts` 가 낸 **적정가와의 괴리**이지
                  주변 단지 비교가 아니다(세션 487 에 카드 배지는 정정했는데 이 게이지만 옛 이름이 남아 있었다). */}
              {res.cats.price?.deviation != null &&
                (() => {
                  const dev = Number(res.cats.price.deviation);
                  if (!Number.isFinite(dev)) return null;
                  const clamped = Math.max(-30, Math.min(30, dev));
                  const pct = 50 + (clamped / 30) * 50;
                  const isGood = dev > 0;
                  return (
                    <div
                      style={{
                        background: C.bg,
                        borderRadius: 10,
                        padding: "12px 14px",
                        marginBottom: 10,
                        border: `1px solid ${C.border}`,
                      }}
                    >
                      <div style={{ fontSize: F.base, fontWeight: 700, color: C.text, marginBottom: 8 }}>
                        적정가 대비 위치
                      </div>
                      <div
                        style={{
                          position: "relative",
                          height: 12,
                          background: C.slate100,
                          borderRadius: 6,
                          margin: "4px 0 6px",
                        }}
                      >
                        <div
                          style={{
                            position: "absolute",
                            left: "50%",
                            top: 0,
                            width: 2,
                            height: "100%",
                            background: C.muted,
                            transform: "translateX(-1px)",
                          }}
                        />
                        <div
                          style={{
                            position: "absolute",
                            left: `${pct}%`,
                            top: "50%",
                            width: 14,
                            height: 14,
                            borderRadius: "50%",
                            background: isGood ? C.green : C.red,
                            border: `2px solid ${C.card}`,
                            transform: "translate(-50%,-50%)",
                          }}
                        />
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: F.xs, color: C.muted }}>
                        <span>30% 비쌈</span>
                        <span style={{ fontWeight: 700, color: isGood ? C.green : C.red }}>
                          {isGood
                            ? `+${Math.round(dev)}% 저렴`
                            : dev < 0
                              ? `${Math.abs(Math.round(dev))}% 비쌈`
                              : "적정가와 비슷"}
                        </span>
                        <span>30% 저렴</span>
                      </div>
                    </div>
                  );
                })()}
              {/* 요약 시각화 (세션 487 PR-5b) — 154필드 중 단지 하나로 분포가 성립하는
                  유일한 자산(priceByArea 채움 96.8%, 단지당 중앙 28포인트). */}
              <AreaPriceScatter
                priceByArea={(mergedApt ?? apt).priceByArea}
                aptPrice={(apt.price as number | null) ?? null}
                aptArea={(apt.area as number | null) ?? null}
              />
              <PriceTable apt={mergedApt ?? apt} isLoading={pricesLoading} error={pricesError} />
              <PriceChart apartmentId={apt.id as string} siblingIds={apt.siblingIds as string[] | undefined} />
              <UnsoldChart apartmentId={apt.id as string} siblingIds={apt.siblingIds as string[] | undefined} />

              {/* 두 출처 대조 (세션 507 PR-2) — 옛 "네이버 교차검증" 표를 대체한다.
                  우리 값과 네이버 값이 다른 표 두 개에 흩어져 있어 정작 비교가 안 되던 자리라,
                  같은 줄에 나란히 놓고 폴백(우리 값이 없어 네이버 값을 빌려 쓴 경우)은
                  "미수집"으로 갈라 거짓 상호검증을 막는다. */}
              <SourceComparison apt={mergedApt ?? apt} />

              {/* 이 동네 거래 시세 + 층별가 (세션 408 D2a, 세션 507 에 섹션 1개로 축소) */}
              {PRICE_SECTIONS.map((s) => (
                <DataSectionBlock key={s.title} section={s} apt={mergedApt ?? apt} />
              ))}
              <PriceByFloorBlock apt={mergedApt ?? apt} />
              <ExtraFieldsAccordion apt={mergedApt ?? apt} tab="sec-price" />
            </section>
          )}

          {/* §3 입지 탭 — SchoolInfo + NearbyChildcare */}
          {isPanelMounted("sec-location") && (
            <section
              id="sec-location"
              role="tabpanel"
              aria-labelledby="tab-sec-location"
              data-tab-panel
              style={panelStyle("sec-location")}
            >
              {/* 입지 한 줄 요약 (세션508 PR-3b B4) — catVerdict + 상위 서브 1개. A1(종합 탭
                  판정 한 줄)과 같은 blind/슬림 catsCache 가드 패턴. getHighlights 는 CatPanel.tsx
                  에서 export 했다(플랜 §"v1 에서 틀렸던 것" #8 — 모듈 비공개라 그냥 쓰면 TS2305). */}
              {blind ? (
                <div style={DM_S.verdictBlind}>입지 점수는 로그인 후 볼 수 있어요</div>
              ) : (
                (() => {
                  const locCat = res.cats.location;
                  if (!locCat) return null;
                  const top = getHighlights(locCat.subs, "location")[0];
                  return (
                    <div style={DM_S.verdictLine}>
                      {catVerdict("location", locCat)}
                      {top && ` · ${top.name} ${top.info ?? ""}`}
                    </div>
                  );
                })()
              )}

              {/* 요약 시각화 (세션 487 PR-5b) — 거리 자릿수가 필드마다 달라 축 3분리.
                  세션 505 에 개수까지 라벨에 병기해("병원 3곳") 아래 "생활인프라" 표를 흡수했다.
                  KTX·IC(km 단위라 m 축과 안 맞음)·혐오시설(멀수록 좋아 방향이 반대)은 여전히 제외. */}
              <DistanceDots apt={mergedApt ?? apt} />

              {/* 교통 상세 카드 (세션508 PR-3b B1) — LOCATION_SECTIONS 의 옛 "교통 상세" 격자를
                  전용 카드로 승격. 기본 접힘 — 입지 판단 1차 신호는 위 DistanceDots 그림이 준다. */}
              <TransportCard apt={mergedApt ?? apt} />

              <SchoolInfo apt={mergedApt ?? apt} />

              <NearbyChildcareSection apt={mergedApt ?? apt} />

              {/* 치안/환경 (세션 408 D2a — 입지 탭 빈약 해소. 세션508 PR-3b: "교통 상세" 는
                  위 TransportCard 로 승격돼 LOCATION_SECTIONS 에서 빠졌다) */}
              {LOCATION_SECTIONS.map((s) => (
                <DataSectionBlock key={s.title} section={s} apt={mergedApt ?? apt} />
              ))}
              <NearbyFacilitiesBlock apt={mergedApt ?? apt} />
              <ExtraFieldsAccordion apt={mergedApt ?? apt} tab="sec-location" />
            </section>
          )}

          {/* §4 분양 탭 — PresaleInfo + MarketStatsCharts(KOSIS 지역 거시통계) */}
          {isPanelMounted("sec-presale") && (
            <section
              id="sec-presale"
              role="tabpanel"
              aria-labelledby="tab-sec-presale"
              data-tab-panel
              style={panelStyle("sec-presale")}
            >
              <PresaleTimeline
                stage={(mergedApt ?? apt).presaleStage as string | null}
                minPrice={(mergedApt ?? apt).presaleMinPrice as number | null}
                maxPrice={(mergedApt ?? apt).presaleMaxPrice as number | null}
                aptPrice={(apt.price as number | null) ?? null}
                competitionRate={(mergedApt ?? apt).competitionRate as number | null}
                competitionSupply={(mergedApt ?? apt).competitionSupply as number | null}
                competitionApplicants={(mergedApt ?? apt).competitionApplicants as number | null}
              />
              {/* 세션508 PR-3a A5: raw apt → mergedApt ?? apt 통일. ⚠️ 다만 **값이 바뀌지는 않는다** —
                  이 컴포넌트가 읽는 건 presale* 계열인데 detail 버킷(staticDataApi.ts:63-73)엔 그 필드가
                  하나도 없다(버킷 10키는 catsCache·nearby*·priceBy* 계열뿐이고 id 는 저장 시 떼어낸다).
                  분양 값은 목록 응답에 실려 온다. 즉 통일은 "형태를 같게" 하려는 것이지 버킷 도착을
                  기다리는 게 아니다. 초안 주석("버킷에 있어 버킷 도착 후 갱신돼야 한다")은 자기가 인용한
                  파일과 어긋났다 — 세션509 적대검증에서 정정(같은 파일 아래 AdminUnitSupply 주석이
                  같은 형식의 **참인** 예다). */}
              <PresaleInfo apt={mergedApt ?? apt} />

              {/* 추가 모집(무순위 공고) 이력 카드 (세션508 PR-3c C1) — ah- 단지만 그린다. */}
              <UnsoldEventCard apt={mergedApt ?? apt} />

              {/* 시공사 카드 (세션508 PR-3c C2) — builder·builderCreditGrade·builderDebtRatio. */}
              <BuilderCard apt={mergedApt ?? apt} />

              {/* 계약해제율 (세션 408 D2a, 세션508 PR-3c C3: 청약경쟁 3필드는 위 진행 그림으로 이동) */}
              {PRESALE_SECTIONS.map((s) => (
                <DataSectionBlock key={s.title} section={s} apt={mergedApt ?? apt} />
              ))}
              <AnnouncementLink apt={mergedApt ?? apt} />

              {/* 관리자 인사이트(동/호수·평형 공급)는 세션 409 D2b 로 관리자 탭(sec-admin)으로 이동 */}

              {/* 이 지역 통계 (세션 507 PR-2) — 시세 탭 표에 단지 값과 섞여 있던 인구·의료·
                  거래량 7종을 지역 시장 추이 그래프와 한 서랍에 모았다. 그래프 자체는
                  `MarketStatsCharts` 무변경 재사용(RegionStats 안에서 그린다). */}
              <RegionStats apt={mergedApt ?? apt} />
              <ExtraFieldsAccordion apt={mergedApt ?? apt} tab="sec-presale" />
            </section>
          )}

          {/* §5 금융 탭 — LoanAnalysis (이 단지 대출 시뮬레이션) */}
          {isPanelMounted("sec-finance") && (
            <section
              id="sec-finance"
              role="tabpanel"
              aria-labelledby="tab-sec-finance"
              data-tab-panel
              style={panelStyle("sec-finance")}
            >
              <LoanStack
                price={(apt.price as number | null) ?? null}
                region={apt.region as string | null}
                gu={apt.gu as string | null}
                dsr40pass={(mergedApt ?? apt).dsr40pass as boolean | null}
              />
              <LoanAnalysis apt={mergedApt ?? apt} isLoading={pricesLoading} error={pricesError} />
              <ExtraFieldsAccordion apt={mergedApt ?? apt} tab="sec-finance" />
            </section>
          )}

          {/* §6 점수 탭 — CatPanel×5 순수 점수만 (세션 409 D2b: 관리자 인사이트는 sec-admin 탭으로 이동).
            jumpSeqs[k] key = 종합 탭 미니카드 클릭 시 해당 카테고리 1개만 리마운트(defaultExpanded 펼침).
            benefit 제외 6→5개 (2026-08-11) — 위 미니카드와 동일 근거(가중치 0, 더 이상 점수 카테고리 아님). */}
          {isPanelMounted("sec-score") && (
            <section
              id="sec-score"
              role="tabpanel"
              aria-labelledby="tab-sec-score"
              data-tab-panel
              style={panelStyle("sec-score")}
            >
              {/* 비로그인 = 패널 6개를 통째로 잠금 안내로 교체 (단계 2-A). CatPanel 은 서브지표 41개까지
                  펼치는 곳이라 부분 가리기가 성립하지 않는다 — 문을 통째로 닫고 왜 닫혔는지만 알린다. */}
              {blind && <ScoreLockPanel onRequestLogin={onRequestLogin} />}
              {!blind &&
                (() => {
                  const topCats = profile ? (getTopCats(PROFILES[profile].w) as string[]) : [];
                  // mergedRes = 버킷 도착 시 full subs 로 복원된 res, 미도착 시 슬림 res(subs[0]만).
                  return orderedCatEntries((mergedRes ?? res).cats as unknown as Record<string, Res>)
                    .filter(([k]) => k !== "benefit")
                    .map(([k, c]) => {
                      const seq = jumpSeqs[k] ?? 0;
                      return (
                        <CatPanel
                          key={`${k}#${seq}`}
                          cat={c}
                          k={k}
                          emphasized={topCats.includes(k)}
                          defaultExpanded={seq > 0}
                        />
                      );
                    });
                })()}
            </section>
          )}

          {/* §7 관리자 탭 — 점수 산출 과정 + 동/호수·평형 공급 + 141필드 검수 (세션 409 D2b: 점수·분양 탭에서
            분리, adminLoggedIn 시에만 칩·패널 노출). data-tab-panel = App print CSS 가 인쇄 시 펼침.
            isPanelMounted(adminLoggedIn)=즉시 마운트 → 현행 "전체 펼쳐 인쇄" 동선 보존. */}
          {adminLoggedIn && isPanelMounted("sec-admin") && (
            <section
              id="sec-admin"
              role="tabpanel"
              aria-labelledby="tab-sec-admin"
              data-tab-panel
              style={panelStyle("sec-admin")}
            >
              <Suspense
                fallback={<div style={{ padding: 16, fontSize: F.sm, color: C.muted }}>점수 산출 과정 로딩 중...</div>}
              >
                <AdminScoreBreakdown apt={mergedApt ?? apt} res={mergedRes ?? res} profile={profile} />
              </Suspense>
              <Suspense
                fallback={<div style={{ padding: 12, fontSize: F.sm, color: C.muted }}>평형별 공급 로딩 중...</div>}
              >
                {/* 세션508 PR-3a A5: 의도적으로 raw apt 유지 — 동/호수·평형 공급 표(usePresaleDetail
                    units)가 읽는 필드는 detail 버킷(staticDataApi.ts:63-73)에 없어 mergedApt 로
                    바꿔도 값이 안 바뀐다(전수 grep 확인). */}
                <AdminUnitSupply apt={apt} />
              </Suspense>
              <AdminDataAudit apt={mergedApt ?? apt} profile={profile} />
            </section>
          )}

          {/* CTA 공통 영역 — 탭 무관 항상 노출 + sticky bottom (사장님 결정 2026-06-13 ×2).
            sticky 기본 동작 = 콘텐츠가 화면보다 길면 하단에 반투명으로 겹쳐 떠 있고, 짧으면 콘텐츠 끝
            제자리 — 길이 측정 분기 없이 두 경우 자동. 좌우 negative margin = 스크롤러 패딩 전폭 덮기
            (StickyJumpNav 패턴). 포커스 트랩 불변식: 이 블록이 모달 내 마지막 포커서블 + 항상 가시 —
            트랩(위 handleKey)이 display:none 패널 내부 요소를 경계로 잡아 탈출하는 것을 DOM 순서로 차단. */}
          <div
            data-testid="detail-cta-bar"
            style={{
              position: "sticky",
              bottom: 0,
              zIndex: 10,
              margin: `12px ${isDesktop ? -24 : -16}px 0`,
              padding: `10px ${isDesktop ? 24 : 16}px calc(12px + env(safe-area-inset-bottom, 0px))`,
              background: `${C.card}EB`,
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
              borderTop: `1px solid ${C.border}`,
            }}
          >
            {onConsult && (
              <button
                onClick={() => onConsult(apt.id as string)}
                style={{
                  width: "100%",
                  background: C.blue,
                  color: C.white,
                  border: "none",
                  borderRadius: 8,
                  padding: "12px 0",
                  fontSize: F.base,
                  fontWeight: 700,
                  cursor: "pointer",
                  minHeight: 44,
                  marginBottom: 8,
                  transition: "all .15s",
                }}
              >
                이 매물 상담하기
              </button>
            )}
            <div style={DM_S.actionRow}>
              <button
                onClick={() => onFav(apt.id as string)}
                style={{
                  flex: 1,
                  background: isFav ? C.redLight : C.slate100,
                  color: isFav ? C.red : C.muted,
                  border: isFav ? `1.5px solid ${C.red}` : "1.5px solid transparent",
                  borderRadius: 8,
                  padding: isDesktop ? "12px 0" : "10px 0",
                  fontSize: isDesktop ? F.md : F.base,
                  fontWeight: 700,
                  cursor: "pointer",
                  minHeight: 44,
                  transition: "all .15s",
                }}
              >
                {isFav ? "관심 등록됨" : "관심매물 추가"}
              </button>
              <button
                onClick={() => onComp(apt.id as string)}
                style={{
                  flex: 1,
                  background: isComp ? C.indigo : "transparent",
                  color: isComp ? C.white : C.indigo,
                  border: `1.5px solid ${C.indigo}`,
                  borderRadius: 8,
                  padding: isDesktop ? "12px 0" : "10px 0",
                  fontSize: isDesktop ? F.md : F.base,
                  fontWeight: 700,
                  cursor: "pointer",
                  minHeight: 44,
                  transition: "all .15s",
                }}
              >
                {isComp ? "비교 중" : "비교 추가"}
              </button>
              {onShare && (
                <button
                  onClick={() => onShare(apt.id as string)}
                  aria-label="이 단지 공유하기"
                  style={{
                    flex: 1,
                    background: C.slate100,
                    color: C.slate600,
                    border: "1.5px solid transparent",
                    borderRadius: 8,
                    padding: isDesktop ? "12px 0" : "10px 0",
                    fontSize: isDesktop ? F.md : F.base,
                    fontWeight: 700,
                    cursor: "pointer",
                    minHeight: 44,
                    transition: "all .15s",
                  }}
                >
                  공유
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
