import { useState, useMemo, useEffect, memo } from "react";
import { C } from "@/theme";
import { PROFILES } from "@/constants/profiles";
import { FIELD_SECTIONS } from "@/constants/fieldMeta";
import { ExpertFieldTable } from "./ExpertFieldTable";
import { ExpertScoreBreakdown } from "./ExpertScoreBreakdown";
import { ExpertScoreSummary } from "./ExpertScoreSummary";
import { ExpertUnitPlaceholder } from "./ExpertUnitPlaceholder";
import { ExpertDataCompleteness } from "./ExpertDataCompleteness";
import { ExpertSidebar } from "./ExpertSidebar";
import { ExpertAptHeader } from "./ExpertAptHeader";

const SEC_COLOR = { "가격": C.green, "입지": C.blue, "상품성": C.purple, "혜택": C.amber, "미래": C.cyan, "교차검증": "#6366F1" };

export const ExpertDashboard = memo(function ExpertDashboard({ scored, profile, setProfile, expandedApt, setExpandedApt, onSwitchToAdmin }) {
  const [search, setSearch] = useState("");
  const [regionFilter, setRegionFilter] = useState("전체");
  const [sort, setSort] = useState("total");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    if (!sidebarOpen || !isMobile) return;
    const onKey = (e) => { if (e.key === "Escape") setSidebarOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sidebarOpen, isMobile]);

  const selectedId = expandedApt || (scored.length > 0 ? scored[0].apt.id : null);
  const selectedItem = useMemo(() => scored.find(x => x.apt.id === selectedId), [scored, selectedId]);

  const handleSelect = (id) => {
    setExpandedApt(id);
    if (isMobile) setSidebarOpen(false);
  };

  return (
    <div style={{ display: "flex", height: "calc(100dvh - 100px)", position: "relative" }}>
      {/* 모바일: 오버레이 백드롭 */}
      {isMobile && sidebarOpen && (
        <div onClick={() => setSidebarOpen(false)} style={{
          position: "fixed", top: 0, right: 0, bottom: 0, left: 0,
          background: "rgba(0,0,0,0.5)", zIndex: 199
        }} />
      )}

      {/* 사이드바 */}
      {isMobile ? (
        <div data-sidebar style={{
          position: "fixed", top: 0, left: 0, bottom: 0, zIndex: 200,
          transform: sidebarOpen ? "translateX(0)" : "translateX(-100%)",
          transition: "transform .3s ease"
        }}>
          <ExpertSidebar scored={scored} selectedId={selectedId} onSelect={handleSelect}
            search={search} setSearch={setSearch} regionFilter={regionFilter} setRegionFilter={setRegionFilter}
            sort={sort} setSort={setSort} isMobile onClose={() => setSidebarOpen(false)} />
        </div>
      ) : (
        <div data-sidebar>
          <ExpertSidebar scored={scored} selectedId={selectedId} onSelect={handleSelect}
            search={search} setSearch={setSearch} regionFilter={regionFilter} setRegionFilter={setRegionFilter}
            sort={sort} setSort={setSort} />
        </div>
      )}

      <div data-print-content style={{ flex: 1, overflowY: "auto", padding: isMobile ? "12px 14px" : "16px 20px" }}>
        <div data-no-print style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 4 }}>
          {isMobile && (
            <button onClick={() => setSidebarOpen(true)} aria-label="단지 목록 열기" style={{
              background: C.slate100, border: `1px solid ${C.border}`, borderRadius: 6,
              padding: "6px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer",
              color: C.text, minHeight: 44, whiteSpace: "nowrap", flexShrink: 0
            }}>&#9776; 목록</button>
          )}
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
            {Object.entries(PROFILES).map(([k, p]) => (
              <button key={k} onClick={() => setProfile(k)} aria-pressed={profile === k} style={{
                padding: "6px 10px", fontSize: 11, fontWeight: profile === k ? 700 : 500,
                background: profile === k ? C.indigoLight : C.slate100, color: profile === k ? C.indigo : C.slate600,
                border: profile === k ? `1.5px solid ${C.indigo}` : "1.5px solid transparent", borderRadius: 4, cursor: "pointer"
              }}>{p.name}</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
            {onSwitchToAdmin && (
              <button onClick={onSwitchToAdmin} data-no-print style={{
                background: C.white, color: C.indigo, border: `1px solid ${C.indigo}`, borderRadius: 4, padding: "6px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer"
              }}>관리</button>
            )}
            <button onClick={() => window.print()} data-no-print aria-label="현재 페이지 인쇄" style={{
              background: C.indigo, color: C.white, border: "none", borderRadius: 4, padding: "6px 14px", fontSize: 11, fontWeight: 700, cursor: "pointer"
            }}>인쇄</button>
          </div>
        </div>

        {selectedItem ? (
          <>
            <ExpertAptHeader apt={selectedItem.apt} res={selectedItem.res} />

            <ExpertScoreBreakdown apt={selectedItem.apt} res={selectedItem.res} profile={profile} />
            <ExpertScoreSummary res={selectedItem.res} profile={profile} />

            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "0 12px" }}>
              {FIELD_SECTIONS.map(sec => {
                const excl = sec.key === "가격" ? ["nearbyMedian","jeonseRate","pir","psr","dataReliability"]
                  : sec.key === "입지" ? ["subwayDist","busRoutes","icDist","ktxDist","schoolScore","schoolGrade","hospital","mart","conv","park","cafe","culture","bank","pharmacy","view","sunlight","noise","noxious"]
                  : undefined;
                return (
                  <ExpertFieldTable key={sec.key} apt={selectedItem.apt} fields={sec.fields} title={sec.label}
                    color={SEC_COLOR[sec.key] || C.indigo} exclude={excl} />
                );
              })}
            </div>

            <ExpertUnitPlaceholder apt={selectedItem.apt} />
            <ExpertDataCompleteness apt={selectedItem.apt} />
          </>
        ) : (
          <div style={{ padding: 40, textAlign: "center", color: C.muted, fontSize: 13 }}>좌측 사이드바에서 단지를 선택해주세요.</div>
        )}
      </div>
    </div>
  );
});
