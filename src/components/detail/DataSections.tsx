import { memo, useState } from "react";
import { C, F } from "@/theme";
import { FIELD_META } from "@/constants/fieldMeta";
import { fmtPrice } from "@/lib/format";
import { HighlightField } from "./HighlightField";
import { InfrastructureSection } from "./InfrastructureSection";
import type { DataSectionsProps, DataSection } from "@/types/components/DataSections.types";

const UNSOLD_WARN_THRESHOLD = 15;
const UNSOLD_SAFE_THRESHOLD = 5;

const DATA_SECTIONS: DataSection[] = [
  {
    title: "단지 기본정보",
    highlight: ["unsoldRate", "pp", "completion", "dataReliability"],
    grid: ["dong", "address", "roadAddress", "district", "units", "unsold", "builder", "heating", "heatFuel", "avgMaintenanceCost", "primaryDirection"],
  },
  {
    title: "생활인프라 (반경 1km)",
    pairs: [
      ["hospital", "hospitalDist"], ["mart", "martDist"], ["conv", "convDist"],
      ["park", "parkDist"], ["pharmacy", null], ["cafe", null],
      ["culture", null], ["bank", null],
      ["childcare", "childcareDist"], ["emergency", "emergencyDist"],
    ],
  },
  { title: "교통 상세", grid: ["subwayDist", "subwayName", "subwayLines", "busRoutes", "busStopNames", "icDist", "ktxDist"] },
  {
    title: "시장/투자 지표",
    highlight: ["pir", "psr", "popGrowth"],
    grid: ["recentTrades6m", "nearbyMedian", "nearbyBuildYear", "avgFloor", "floorRange", "netMigration"],
  },
  {
    title: "치안/환경",
    grid: ["crimeSafetyGrade", "police", "policeDist", "airQuality", "noxiousDist"],
  },
  {
    title: "청약 경쟁 현황",
    grid: ["competitionRate", "competitionSupply", "competitionApplicants"],
    hideWhenEmpty: true,
  },
  {
    title: "네이버 교차검증",
    grid: ["naverNearbyMedian", "naverJeonseRate", "naverSellCount", "naverJeonseCount",
           "naverWolseCount", "naverSchoolWalkMin", "naverNearbyCount", "naverFetchedAt"],
  },
  {
    title: "네이버 분양정보",
    grid: ["presaleStage", "presaleType", "presaleHousingType", "presaleMinPrice", "presaleMaxPrice",
           "presalePp", "presaleGeneralSupply", "presaleBuildings", "presaleParking",
           "presaleMoveIn", "presaleRecruitDate", "presaleSchedule", "presaleInquiry",
           "presaleFeatures", "presaleFetchedAt"],
  },
];

// 정적 inline style 호이스팅 (세션149 HS_S / 세션150 DM_S 패턴 확장)
// 동적 4건은 인라인 보존: rotate(showData) / marginTop(si>0) / marginBottom(section.grid) / color(dataValueColor·f.dist)
const DS_S: Record<string, import("react").CSSProperties> = {
  container: { background: C.bg, borderRadius: 10, padding: "10px 12px", marginBottom: 10, border: `1px solid ${C.border}` },
  toggleHead: { display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" },
  toggleTitle: { fontSize: F.base, fontWeight: 700, color: C.text },
  body: { marginTop: 8 },
  subBlock: { marginTop: 12 },
  sectionTitle: { fontSize: F.sm, fontWeight: 700, color: C.sub, marginBottom: 6, paddingBottom: 4, paddingLeft: 6, borderBottom: `1px solid ${C.border}`, borderLeft: `3px solid ${C.indigo}` },
  subSectionTitle: { fontSize: F.sm, fontWeight: 700, color: C.sub, marginBottom: 4, paddingBottom: 4, borderBottom: `1px solid ${C.border}` },
  highlightRowBase: { display: "flex", flexWrap: "wrap", gap: 8 },
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px" },
  gridCell: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0" },
  gridLabel: { fontSize: F.xs, color: C.muted },
  gridValueBase: { fontSize: F.xs, fontWeight: 600 },
  emptyText: { fontSize: F.xs, color: C.muted, padding: "6px 0" },
  link: { fontSize: F.sm, color: C.blue, fontWeight: 600, textDecoration: "underline" },
  footer: { fontSize: F.micro, color: C.muted, marginTop: 10, lineHeight: 1.5 },
};

function dataValueColor(field: string, value: unknown): string {
  if (value == null) return C.muted;
  const n = Number(value);
  if (field === "unsoldRate") return n > UNSOLD_WARN_THRESHOLD ? C.red : n <= UNSOLD_SAFE_THRESHOLD ? C.green : C.text;
  if (field === "subwayDist") return n <= 500 ? C.green : n <= 1000 ? C.blue : C.text;
  if (field === "popGrowth") return n > 0 ? C.green : n < 0 ? C.red : C.text;
  if (field === "dataReliability") return n >= 80 ? C.green : n >= 50 ? C.amber : C.red;
  if (["hospital", "mart", "conv", "cafe", "culture", "bank", "pharmacy", "park"].includes(field)) return n === 0 ? C.muted : C.text;
  if (field === "primaryDirection") {
    if (!value) return C.muted;
    const s = String(value);
    return s.includes("남") ? C.green : s.includes("북") ? C.red : C.text;
  }
  return C.text;
}

export const DataSections = memo(function DataSections({ apt }: DataSectionsProps) {
  const [showData, setShowData] = useState(false);

  return (
    <div style={DS_S.container}>
      <div
        onClick={() => setShowData(v => !v)}
        role="button"
        tabIndex={0}
        aria-expanded={showData}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setShowData(v => !v); } }}
        style={DS_S.toggleHead}
      >
        <span style={DS_S.toggleTitle}>공공데이터 상세</span>
        <span style={{ fontSize: F.sm, color: C.muted, transition: "transform .2s", transform: showData ? "rotate(180deg)" : "rotate(0)", display: "inline-block" }}>▼</span>
      </div>
      {showData && (
        <div style={DS_S.body}>
          {DATA_SECTIONS.map((section, si) => {
            const allFields: string[] = [...(section.highlight || []), ...(section.grid || []), ...(section.pairs || []).flat().filter((x): x is string => typeof x === "string")];
            const hasAny = allFields.some(f => apt[f] != null);
            if (section.hideWhenEmpty && !hasAny) return null;
            return (
              <div key={si} style={{ marginTop: si > 0 ? 12 : 0 }}>
                <div style={DS_S.sectionTitle}>{section.title}</div>
                {hasAny ? (<>
                  {section.highlight && (
                    <div style={{ ...DS_S.highlightRowBase, marginBottom: section.grid ? 6 : 0 }}>
                      {section.highlight.map(f => (
                        <HighlightField key={f} field={f} apt={apt} dataValueColor={dataValueColor} />
                      ))}
                    </div>
                  )}
                  {section.pairs && <InfrastructureSection pairs={section.pairs} apt={apt} />}
                  {section.grid && (
                    <div style={DS_S.grid}>
                      {section.grid.map(f => {
                        const meta = (FIELD_META as Record<string, { label: string; fmt?: (_v: unknown, _apt: unknown) => unknown }>)[f];
                        if (!meta) return null;
                        const val = apt[f];
                        return (
                          <div key={f} style={DS_S.gridCell}>
                            <span style={DS_S.gridLabel}>{meta.label}</span>
                            <span style={{ ...DS_S.gridValueBase, color: dataValueColor(f, val) }}>{String(meta.fmt ? meta.fmt(val, apt) : val ?? "")}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>) : (
                  <div style={DS_S.emptyText}>데이터 수집 중...</div>
                )}
              </div>
            );
          })}
          {(((apt.nearbyFacilities as Array<{ name: string; dist: number }> | undefined) ?? []).length > 0) && (
            <div style={DS_S.subBlock}>
              <div style={DS_S.subSectionTitle}>주변 편의시설 상세</div>
              {((apt.nearbyFacilities as Array<{ name: string; dist: number }> | undefined) ?? []).slice(0, 8).map((f, i) => (
                <div key={i} style={DS_S.gridCell}>
                  <span style={DS_S.gridLabel}>{f.name}</span>
                  <span style={{ ...DS_S.gridValueBase, color: f.dist <= 300 ? C.green : f.dist <= 700 ? C.blue : C.text }}>{f.dist}m</span>
                </div>
              ))}
            </div>
          )}
          {(((apt.priceByFloor as Array<{ group: string; avg: number; count: number }> | undefined) ?? []).length > 0) && (
            <div style={DS_S.subBlock}>
              <div style={DS_S.subSectionTitle}>층별 매매가 (주변 실거래)</div>
              {((apt.priceByFloor as Array<{ group: string; avg: number; count: number }> | undefined) ?? []).map((p, i) => (
                <div key={i} style={DS_S.gridCell}>
                  <span style={DS_S.gridLabel}>{p.group}</span>
                  <span style={{ ...DS_S.gridValueBase, color: C.text }}>{fmtPrice(p.avg)} ({p.count}건)</span>
                </div>
              ))}
            </div>
          )}
          {Boolean(apt.announcementUrl) && (
            <div style={DS_S.subBlock}>
              <a href={String(apt.announcementUrl)} target="_blank" rel="noopener noreferrer" style={DS_S.link}>모집공고 원문 보기</a>
            </div>
          )}
          <div style={DS_S.footer}>
            출처: 청약홈(국토교통부) · 카카오 로컬 API · KOSIS(통계청) · 국토부 실거래가 · NEIS(교육부)
          </div>
        </div>
      )}
    </div>
  );
});
