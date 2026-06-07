import { useState, useMemo, useEffect, useCallback, useRef, memo } from "react";
import { C, F } from "@/theme";
import { StickyJumpNav, JUMP_NAV_HEIGHT, type JumpSection } from "@/components/detail/StickyJumpNav";
import { useResponsive } from "@/hooks/useResponsive";
import { PROFILES } from "@/constants/profiles";
import { FIELD_SECTIONS } from "@/constants/fieldMeta";
import { ExpertFieldTable } from "./ExpertFieldTable";
import { ExpertScoreBreakdown } from "./ExpertScoreBreakdown";
import { ExpertScoreSummary } from "./ExpertScoreSummary";
import { ExpertUnitPlaceholder } from "./ExpertUnitPlaceholder";
import { ExpertDataCompleteness } from "./ExpertDataCompleteness";
import { ExpertSidebar } from "./ExpertSidebar";
import { ExpertAptHeader } from "./ExpertAptHeader";
import { ExpertHelpGuide } from "./ExpertHelpGuide";
import type { ExpertDashboardProps } from "@/types/components/ExpertDashboard.types";
import type { ExpertSortKey } from "@/types/expert";

const SEC_COLOR: Record<string, string> = { "가격": C.green, "안전": C.red, "입지": C.blue, "상품성": C.purple, "혜택": C.amber, "미래": C.cyan, "교차검증": "#6366F1" };

// 목차바 칩 = 요약 + FIELD_SECTIONS 9섹션 파생(하드코딩 금지 → 섹션 변경 시 자동 반영).
const EXPERT_JUMP_SECTIONS: JumpSection[] = [
  { id: "sec-summary", label: "요약" },
  ...FIELD_SECTIONS.map((s) => ({ id: `sec-${s.key}`, label: s.label })),
];

export const ExpertDashboard = memo(function ExpertDashboard({ scored, profile, setProfile, expandedApt, setExpandedApt, onSwitchToAdmin }: ExpertDashboardProps) {
  const [search, setSearch] = useState("");
  const [regionFilter, setRegionFilter] = useState("전체");
  const [sort, setSort] = useState<ExpertSortKey>("total");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { isPC } = useResponsive();
  const isMobile = !isPC;
  const [helpOpen, setHelpOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [activeSection, setActiveSection] = useState<string>(EXPERT_JUMP_SECTIONS[0].id);
  // 칩 클릭 점프 중에는 observer 가 active 를 덮어쓰지 않게 잠금(타임스탬프). 마지막 섹션은
  // 컨테이너를 못 채워 스크롤 후에도 윗 섹션이 viewport 상단에 남아 클릭칩이 active 를 잃는 race 방지.
  const jumpLockUntil = useRef(0);

  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSidebarOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sidebarOpen]);

  const selectedId: string | null = expandedApt || (scored.length > 0 ? (scored[0].apt.id ?? null) : null);
  const selectedItem = useMemo(() => scored.find(x => x.apt.id === selectedId), [scored, selectedId]);

  // 목차바 active 추적 — 화면 상단(칩바 아래)에 가장 가까운 가시 섹션. 단지 바뀌면 섹션 노드
  // 재생성되므로 [selectedId] 로 재관찰. (소비자 DetailModal observer 패턴 답습)
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !selectedItem) return;
    const els = EXPERT_JUMP_SECTIONS
      .map((s) => root.querySelector<HTMLElement>(`#${s.id}`))
      .filter((el): el is HTMLElement => el != null);
    if (els.length === 0) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (Date.now() < jumpLockUntil.current) return; // 칩 점프 직후엔 클릭 active 우선
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const id = visible[0].target.id;
        if (id) setActiveSection(id);
      },
      { root, rootMargin: `-${JUMP_NAV_HEIGHT}px 0px -55% 0px`, threshold: 0 },
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [selectedId]);

  // ExpertSidebar(memo)에 onSelect prop 전달 — 참조 안정화로 불필요 리렌더 방지
  const handleSelect = useCallback((id: string) => {
    setExpandedApt(id);
    setSidebarOpen(false);
  }, [setExpandedApt]);

  // 칩 클릭 → 해당 섹션으로 점프(컨테이너 직접 scrollTo, 칩바 높이 보정). offsetTop 은 offsetParent
  // 기준이라 data-print-content 가 position:relative 여야 정확. (소비자 handleJump 답습)
  const handleJump = useCallback((id: string) => {
    const root = scrollRef.current;
    const el = root?.querySelector<HTMLElement>(`#${id}`);
    if (root && el && typeof root.scrollTo === "function") {
      jumpLockUntil.current = Date.now() + 800; // smooth 스크롤 안정 동안 observer 억제
      root.scrollTo({ top: Math.max(0, el.offsetTop - JUMP_NAV_HEIGHT), behavior: "smooth" });
      setActiveSection(id);
    }
  }, []);

  return (
    <div style={{ display: "flex", height: "calc(100dvh - 100px)", position: "relative" }}>
      {/* 오버레이 백드롭 */}
      {sidebarOpen && (
        <div onClick={() => setSidebarOpen(false)} style={{
          position: "fixed", top: 0, right: 0, bottom: 0, left: 0,
          background: "rgba(0,0,0,0.4)", zIndex: 199
        }} />
      )}

      {/* 사이드바 (PC/모바일 통합 오버레이) */}
      <div data-sidebar style={{
        position: "fixed", top: 0, left: 0, bottom: 0, zIndex: 200,
        transform: sidebarOpen ? "translateX(0)" : "translateX(-100%)",
        transition: "transform .3s ease"
      }}>
        <ExpertSidebar scored={scored} selectedId={selectedId} onSelect={handleSelect}
          search={search} setSearch={setSearch} regionFilter={regionFilter} setRegionFilter={setRegionFilter}
          sort={sort} setSort={setSort} isMobile={isMobile} onClose={() => setSidebarOpen(false)} />
      </div>

      <div ref={scrollRef} data-print-content style={{ flex: 1, overflowY: "auto", position: "relative", padding: isMobile ? "12px 14px" : "16px 20px" }}>
        <div data-no-print style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 4 }}>
          <button onClick={() => setSidebarOpen(true)} aria-label="단지 목록 열기" style={{
            background: C.slate100, border: `1px solid ${C.border}`, borderRadius: 6,
            padding: "6px 10px", fontSize: F.sm, fontWeight: 700, cursor: "pointer",
            color: C.text, minHeight: 44, whiteSpace: "nowrap", flexShrink: 0
          }}>&#9776; 목록</button>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
            {Object.entries(PROFILES).map(([k, p]) => (
              <button key={k} onClick={() => setProfile(k as typeof profile)} aria-pressed={profile === k} style={{
                padding: "6px 10px", fontSize: F.xs, fontWeight: profile === k ? 700 : 500,
                background: profile === k ? C.indigoLight : C.slate100, color: profile === k ? C.indigo : C.slate600,
                border: profile === k ? `1.5px solid ${C.indigo}` : "1.5px solid transparent", borderRadius: 4, cursor: "pointer"
              }}>{p.name}</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
            <button onClick={() => setHelpOpen(v => !v)} data-no-print style={{
              background: helpOpen ? C.indigo : C.white, color: helpOpen ? C.white : C.indigo,
              border: `1px solid ${C.indigo}`, borderRadius: 4, padding: "6px 10px", fontSize: F.xs, fontWeight: 700, cursor: "pointer"
            }}>도움말</button>
            {onSwitchToAdmin && (
              <button onClick={onSwitchToAdmin} data-no-print style={{
                background: C.white, color: C.indigo, border: `1px solid ${C.indigo}`, borderRadius: 4, padding: "6px 10px", fontSize: F.xs, fontWeight: 700, cursor: "pointer"
              }}>관리</button>
            )}
            <button onClick={() => window.print()} data-no-print aria-label="현재 페이지 인쇄" style={{
              background: C.indigo, color: C.white, border: "none", borderRadius: 4, padding: "6px 14px", fontSize: F.xs, fontWeight: 700, cursor: "pointer"
            }}>인쇄</button>
          </div>
        </div>

        <ExpertHelpGuide open={helpOpen} onClose={() => setHelpOpen(false)} />

        {selectedItem ? (
          <>
            <StickyJumpNav sections={EXPERT_JUMP_SECTIONS} activeId={activeSection}
              totalScore={selectedItem.res.total} onJump={handleJump} isDesktop={!isMobile} noPrint />

            <ExpertAptHeader apt={selectedItem.apt} res={selectedItem.res} />

            <div id="sec-summary">
              <ExpertScoreBreakdown apt={selectedItem.apt} res={selectedItem.res} profile={profile} />
              <ExpertScoreSummary res={selectedItem.res} profile={profile} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "0 12px" }}>
              {FIELD_SECTIONS.map(sec => {
                const excl = sec.key === "가격" ? ["nearbyMedian","jeonseRate","pir","psr","dataReliability"]
                  : sec.key === "입지" ? ["hospital","conv","cafe","culture","bank","pharmacy"]
                  : sec.key === "안전" ? ["unsoldRate","recentTrades6m","supplyRatio","popGrowth"]
                  : undefined;
                return (
                  <div id={`sec-${sec.key}`} key={sec.key}>
                    <ExpertFieldTable apt={selectedItem.apt} fields={sec.fields} title={sec.label}
                      color={SEC_COLOR[sec.key] || C.indigo} exclude={excl} />
                  </div>
                );
              })}
            </div>

            <ExpertUnitPlaceholder apt={selectedItem.apt} />
            <ExpertDataCompleteness apt={selectedItem.apt} />
          </>
        ) : (
          <div style={{ padding: 40, textAlign: "center", color: C.muted, fontSize: F.base }}>좌측 사이드바에서 단지를 선택해주세요.</div>
        )}
      </div>
    </div>
  );
});
