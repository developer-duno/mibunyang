import { useState, useMemo, memo } from "react";
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

const SEC_COLOR = { "가격": C.green, "입지": C.blue, "상품성": C.purple, "혜택": C.amber, "미래": C.cyan };

export const ExpertDashboard = memo(function ExpertDashboard({ scored, profile, setProfile, expandedApt, setExpandedApt }) {
  const [search, setSearch] = useState("");
  const [regionFilter, setRegionFilter] = useState("전체");
  const [sort, setSort] = useState("total");

  const selectedId = expandedApt || (scored.length > 0 ? scored[0].apt.id : null);
  const selectedItem = useMemo(() => scored.find(x => x.apt.id === selectedId), [scored, selectedId]);

  return (
    <div style={{ display: "flex", height: "calc(100dvh - 100px)" }}>
      <ExpertSidebar scored={scored} selectedId={selectedId} onSelect={setExpandedApt}
        search={search} setSearch={setSearch} regionFilter={regionFilter} setRegionFilter={setRegionFilter} sort={sort} setSort={setSort} />

      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 4 }}>
            {Object.entries(PROFILES).map(([k, p]) => (
              <button key={k} onClick={() => setProfile(k)} aria-pressed={profile === k} style={{
                padding: "6px 10px", fontSize: 11, fontWeight: profile === k ? 700 : 500,
                background: profile === k ? C.indigoLight : C.slate100, color: profile === k ? C.indigo : C.slate600,
                border: profile === k ? `1.5px solid ${C.indigo}` : "1.5px solid transparent", borderRadius: 4, cursor: "pointer"
              }}>{p.icon} {p.name}</button>
            ))}
          </div>
          <button onClick={() => window.print()} data-no-print aria-label="현재 페이지 인쇄" style={{
            background: C.indigo, color: C.white, border: "none", borderRadius: 4, padding: "6px 14px", fontSize: 11, fontWeight: 700, cursor: "pointer"
          }}>인쇄</button>
        </div>

        {selectedItem ? (
          <>
            <ExpertAptHeader apt={selectedItem.apt} res={selectedItem.res} profile={profile} />

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
              {FIELD_SECTIONS.map(sec => (
                <ExpertFieldTable key={sec.key} apt={selectedItem.apt} fields={sec.fields} title={sec.label}
                  color={SEC_COLOR[sec.key] || C.indigo} />
              ))}
            </div>

            <ExpertUnitPlaceholder apt={selectedItem.apt} />
            <ExpertScoreBreakdown apt={selectedItem.apt} res={selectedItem.res} profile={profile} />
            <ExpertScoreSummary res={selectedItem.res} profile={profile} />
            <ExpertDataCompleteness apt={selectedItem.apt} />
          </>
        ) : (
          <div style={{ padding: 40, textAlign: "center", color: C.muted, fontSize: 13 }}>좌측 사이드바에서 단지를 선택해주세요.</div>
        )}
      </div>
    </div>
  );
});
