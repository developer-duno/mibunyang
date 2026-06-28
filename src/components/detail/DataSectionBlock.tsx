import { memo, useState } from "react";
import { C, F } from "@/theme";
import { FIELD_META } from "@/constants/fieldMeta";
import { fmtPrice } from "@/lib/format";
import { computeCompleteness } from "@/lib/completeness";
import { fieldsOf, dataValueColor } from "@/lib/dataSections";
import { HighlightField } from "./HighlightField";
import { InfrastructureSection } from "./InfrastructureSection";
import { CompletenessDonut } from "./CompletenessDonut";
import { HelpHint } from "@/components/HelpHint";
import type { Apt } from "@/types/scoring";
import type { DataSection } from "@/types/components/DataSections.types";

// 공공데이터 섹션 1개 = 자체 접힘 + 자체 박스 (세션 408 D2a — 구 DataSections 단일토글 해체).
// SchoolInfo/NearbyChildcareSection 과 byte-identical 박스 → 같은 탭 형제와 시각 일관.
// 헤더(제목+채움률 도넛+▼)는 항상 표시, 본문은 open 시. 기본 접힘(사장님 결정 — spec "기본 접힘+더보기").

const DSB_S: Record<string, import("react").CSSProperties> = {
  // SchoolInfo.tsx L26 / 구 DS_S.container 와 byte-identical
  container: {
    background: C.bg,
    borderRadius: 10,
    padding: "10px 12px",
    marginBottom: 10,
    border: `1px solid ${C.border}`,
  },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, cursor: "pointer" },
  title: { fontSize: F.sm, fontWeight: 700, color: C.sub },
  body: { marginTop: 8 },
  highlightRowBase: { display: "flex", flexWrap: "wrap", gap: 8 },
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px" },
  gridCell: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0" },
  gridLabel: { fontSize: F.xs, color: C.muted },
  gridValueBase: { fontSize: F.xs, fontWeight: 600 },
  emptyText: { fontSize: F.xs, color: C.muted, padding: "6px 0" },
  subSectionTitle: {
    fontSize: F.sm,
    fontWeight: 700,
    color: C.sub,
    marginBottom: 4,
    paddingBottom: 4,
    borderBottom: `1px solid ${C.border}`,
  },
  link: { fontSize: F.sm, color: C.blue, fontWeight: 600, textDecoration: "underline" },
};

export const DataSectionBlock = memo(function DataSectionBlock({
  section,
  apt,
  defaultOpen = false,
}: {
  section: DataSection;
  apt: Apt;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const allFields = fieldsOf(section);
  const hasAny = allFields.some((f) => apt[f] != null);
  // hideWhenEmpty 섹션(청약 경쟁)은 데이터 없으면 컴포넌트 자체 미렌더 (구 L234 게이트 byte 이전)
  if (section.hideWhenEmpty && !hasAny) return null;
  const sectionPct = hasAny ? computeCompleteness(allFields, apt).pct : null;

  return (
    <div style={DSB_S.container}>
      <div
        onClick={() => setOpen((v) => !v)}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
        style={DSB_S.head}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ ...DSB_S.title, display: "flex", alignItems: "center" }}>
            {section.title}
            {section.hint && <HelpHint text={section.hint} label={section.title} />}
          </span>
          {sectionPct != null && <CompletenessDonut pct={sectionPct} size={34} label={section.title} />}
        </div>
        <span
          style={{
            fontSize: F.sm,
            color: C.muted,
            transition: "transform .2s",
            transform: open ? "rotate(180deg)" : "rotate(0)",
            display: "inline-block",
          }}
        >
          ▼
        </span>
      </div>
      {open && (
        <div style={DSB_S.body}>
          {hasAny ? (
            <>
              {section.highlight && (
                <div style={{ ...DSB_S.highlightRowBase, marginBottom: section.grid ? 6 : 0 }}>
                  {section.highlight.map((f) => (
                    <HighlightField key={f} field={f} apt={apt} dataValueColor={dataValueColor} />
                  ))}
                </div>
              )}
              {section.pairs && <InfrastructureSection pairs={section.pairs} apt={apt} />}
              {section.grid && (
                <div style={DSB_S.grid}>
                  {section.grid.map((f) => {
                    const meta = (
                      FIELD_META as Record<string, { label: string; fmt?: (_v: unknown, _apt: unknown) => unknown }>
                    )[f];
                    if (!meta) return null;
                    const val = apt[f];
                    return (
                      <div key={f} style={DSB_S.gridCell}>
                        <span style={DSB_S.gridLabel}>{meta.label}</span>
                        <span style={{ ...DSB_S.gridValueBase, color: dataValueColor(f, val) }}>
                          {String(meta.fmt ? meta.fmt(val, apt) : (val ?? ""))}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <div style={DSB_S.emptyText}>데이터 수집 중...</div>
          )}
        </div>
      )}
    </div>
  );
});

// ── 부가블록 3종 (구 DataSections L273-299 — 자체 박스로 탭에 직접 배치) ──

// 주변 편의시설 상세 (→ 입지 탭)
export const NearbyFacilitiesBlock = memo(function NearbyFacilitiesBlock({ apt }: { apt: Apt }) {
  const facilities = (apt.nearbyFacilities as Array<{ name: string; dist: number }> | undefined) ?? [];
  if (facilities.length === 0) return null;
  return (
    <div style={DSB_S.container}>
      <div style={DSB_S.subSectionTitle}>주변 편의시설 상세</div>
      {facilities.slice(0, 8).map((f, i) => (
        <div key={i} style={DSB_S.gridCell}>
          <span style={DSB_S.gridLabel}>{f.name}</span>
          <span style={{ ...DSB_S.gridValueBase, color: f.dist <= 300 ? C.green : f.dist <= 700 ? C.blue : C.text }}>
            {f.dist}m
          </span>
        </div>
      ))}
    </div>
  );
});

// 층별 매매가 (주변 실거래) (→ 시세 탭)
export const PriceByFloorBlock = memo(function PriceByFloorBlock({ apt }: { apt: Apt }) {
  const rows = (apt.priceByFloor as Array<{ group: string; avg: number; count: number }> | undefined) ?? [];
  if (rows.length === 0) return null;
  return (
    <div style={DSB_S.container}>
      <div style={DSB_S.subSectionTitle}>층별 매매가 (주변 실거래)</div>
      {rows.map((p, i) => (
        <div key={i} style={DSB_S.gridCell}>
          <span style={DSB_S.gridLabel}>{p.group}</span>
          <span style={{ ...DSB_S.gridValueBase, color: C.text }}>
            {fmtPrice(p.avg)} ({p.count}건)
          </span>
        </div>
      ))}
    </div>
  );
});

// 국토부 모집공고 원문 링크 (→ 분양 탭). 라벨 = "국토부 모집공고 원문" (PresaleInfo "청약홈 공고"와 차별화).
export const AnnouncementLink = memo(function AnnouncementLink({ apt }: { apt: Apt }) {
  if (!apt.announcementUrl) return null;
  return (
    <div style={DSB_S.container}>
      <a href={String(apt.announcementUrl)} target="_blank" rel="noopener noreferrer" style={DSB_S.link}>
        국토부 모집공고 원문 보기
      </a>
    </div>
  );
});
