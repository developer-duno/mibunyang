import { memo, useState } from "react";
import { C, F } from "@/theme";
import { FIELD_META } from "@/constants/fieldMeta";
import { fmtPrice } from "@/lib/format";
import { HighlightField } from "./HighlightField";
import { InfrastructureSection } from "./InfrastructureSection";

const UNSOLD_WARN_THRESHOLD = 15;
const UNSOLD_SAFE_THRESHOLD = 5;

const DATA_SECTIONS = [
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

function dataValueColor(field, value) {
  if (value == null) return C.muted;
  if (field === "unsoldRate") return value > UNSOLD_WARN_THRESHOLD ? C.red : value <= UNSOLD_SAFE_THRESHOLD ? C.green : C.text;
  if (field === "subwayDist") return value <= 500 ? C.green : value <= 1000 ? C.blue : C.text;
  if (field === "popGrowth") return value > 0 ? C.green : value < 0 ? C.red : C.text;
  if (field === "dataReliability") return value >= 80 ? C.green : value >= 50 ? C.amber : C.red;
  if (["hospital", "mart", "conv", "cafe", "culture", "bank", "pharmacy", "park"].includes(field)) return value === 0 ? C.muted : C.text;
  if (field === "primaryDirection") {
    if (!value) return C.muted;
    return value.includes("남") ? C.green : value.includes("북") ? C.red : C.text;
  }
  return C.text;
}

export const DataSections = memo(function DataSections({ apt }) {
  const [showData, setShowData] = useState(false);

  return (
    <div style={{ background: C.bg, borderRadius: 10, padding: "10px 12px", marginBottom: 10, border: `1px solid ${C.border}` }}>
      <div
        onClick={() => setShowData(v => !v)}
        role="button"
        tabIndex={0}
        aria-expanded={showData}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setShowData(v => !v); } }}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
      >
        <span style={{ fontSize: F.base, fontWeight: 700, color: C.text }}>공공데이터 상세</span>
        <span style={{ fontSize: F.sm, color: C.muted, transition: "transform .2s", transform: showData ? "rotate(180deg)" : "rotate(0)", display: "inline-block" }}>▼</span>
      </div>
      {showData && (
        <div style={{ marginTop: 8 }}>
          {DATA_SECTIONS.map((section, si) => {
            const allFields = [...(section.highlight || []), ...(section.grid || []), ...(section.pairs || []).flat().filter(Boolean)];
            const hasAny = allFields.some(f => apt[f] != null);
            return (
              <div key={si} style={{ marginTop: si > 0 ? 12 : 0 }}>
                <div style={{ fontSize: F.sm, fontWeight: 700, color: C.sub, marginBottom: 6, paddingBottom: 4, paddingLeft: 6, borderBottom: `1px solid ${C.border}`, borderLeft: `3px solid ${C.indigo}` }}>{section.title}</div>
                {hasAny ? (<>
                  {section.highlight && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: section.grid ? 6 : 0 }}>
                      {section.highlight.map(f => (
                        <HighlightField key={f} field={f} apt={apt} dataValueColor={dataValueColor} />
                      ))}
                    </div>
                  )}
                  {section.pairs && <InfrastructureSection pairs={section.pairs} apt={apt} />}
                  {section.grid && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px" }}>
                      {section.grid.map(f => {
                        const meta = FIELD_META[f];
                        if (!meta) return null;
                        const val = apt[f];
                        return (
                          <div key={f} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0" }}>
                            <span style={{ fontSize: F.xs, color: C.muted }}>{meta.label}</span>
                            <span style={{ fontSize: F.xs, fontWeight: 600, color: dataValueColor(f, val) }}>{meta.fmt(val)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>) : (
                  <div style={{ fontSize: F.xs, color: C.muted, padding: "6px 0" }}>데이터 수집 중...</div>
                )}
              </div>
            );
          })}
          {(apt.nearbyFacilities ?? []).length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: F.sm, fontWeight: 700, color: C.sub, marginBottom: 4, paddingBottom: 4, borderBottom: `1px solid ${C.border}` }}>주변 편의시설 상세</div>
              {(apt.nearbyFacilities ?? []).slice(0, 8).map((f, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0" }}>
                  <span style={{ fontSize: F.xs, color: C.muted }}>{f.name}</span>
                  <span style={{ fontSize: F.xs, fontWeight: 600, color: f.dist <= 300 ? C.green : f.dist <= 700 ? C.blue : C.text }}>{f.dist}m</span>
                </div>
              ))}
            </div>
          )}
          {(apt.priceByFloor ?? []).length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: F.sm, fontWeight: 700, color: C.sub, marginBottom: 4, paddingBottom: 4, borderBottom: `1px solid ${C.border}` }}>층별 매매가 (주변 실거래)</div>
              {apt.priceByFloor.map((p, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0" }}>
                  <span style={{ fontSize: F.xs, color: C.muted }}>{p.group}</span>
                  <span style={{ fontSize: F.xs, fontWeight: 600, color: C.text }}>{fmtPrice(p.avg)} ({p.count}건)</span>
                </div>
              ))}
            </div>
          )}
          {apt.announcementUrl && (
            <div style={{ marginTop: 12 }}>
              <a href={apt.announcementUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: F.sm, color: C.blue, fontWeight: 600, textDecoration: "underline" }}>모집공고 원문 보기</a>
            </div>
          )}
          <div style={{ fontSize: F.micro, color: C.muted, marginTop: 10, lineHeight: 1.5 }}>
            출처: 청약홈(국토교통부) · 카카오 로컬 API · KOSIS(통계청) · 국토부 실거래가 · NEIS(교육부)
          </div>
        </div>
      )}
    </div>
  );
});
