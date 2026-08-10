import { memo, useState } from "react";
import { C, F } from "@/theme";
import { FIELD_META } from "@/constants/fieldMeta";
import { fmtPrice } from "@/lib/format";
import { computeCompleteness } from "@/lib/completeness";
import { fieldsOf, dataValueColor } from "@/lib/dataSections";
import { HighlightField } from "./HighlightField";
import { CompletenessDonut } from "./CompletenessDonut";
import { HelpHint } from "@/components/HelpHint";
import { ChartFrame } from "@/components/charts/ChartFrame";
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
          {sectionPct != null && <CompletenessDonut pct={sectionPct} size={40} label={section.title} />}
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

// 층별 매매가 (주변 실거래) — 계단 칸 + 평균 거래 층수·거래 층 범위 흡수 (→ 시세 탭, 세션508 PR-3b B3)
//
// 왜 계단 칸인가 — 층이 오를수록 값이 뚜렷이 오른다(1-5층/6-15층/16층+ 3구간 실측,
// 세션508). 표로 세 줄 늘어놓으면 그 오름세가 안 읽히는데, 막대 높이로 그리면 한눈에 든다.
//
// 왜 이 블록이 avgFloor·floorRange 까지 떠맡나 — 셋 다 채움률이 94.2%로 같다(같은 "주변
// 실거래" 계산에서 함께 나온다). priceByFloor 가 비면 나머지 둘도 사실상 같이 빈다. 그래서
// 블록을 통째로 숨기는 게이트(priceByFloor 없으면 렌더 안 함)를 그대로 셋의 게이트로 쓴다 —
// 별도 카드를 하나 더 만들면 "빈 카드 옆에 또 빈 카드"가 나란히 뜰 뻔했다.
export const PriceByFloorBlock = memo(function PriceByFloorBlock({ apt }: { apt: Apt }) {
  const rows = (apt.priceByFloor as Array<{ group: string; avg: number; count: number }> | undefined) ?? [];
  if (rows.length === 0) return null;

  const maxAvg = Math.max(...rows.map((r) => r.avg));

  // SourceComparison 이 하던 폴백 은폐를 그대로 이관한다 — 우리 값이 없어 네이버 값을 대신
  // 앉힌 상태(`_fallbackAvgFloor`)면 "N층"이 아니라 "미수집"으로 적어야 한다. 안 그러면
  // 네이버 값을 우리가 잰 값처럼 말하게 된다(§SourceComparison.tsx 헤더 주석과 같은 원칙).
  const isAvgFloorFallback = apt._fallbackAvgFloor === true;
  const avgFloor = isAvgFloorFallback ? null : (apt.avgFloor as number | null | undefined);
  // floorRange 는 대응하는 폴백 플래그가 없다(확인 완료) — 값이 있으면 그대로 쓴다.
  const floorRange = apt.floorRange as string | null | undefined;
  const summaryParts: string[] = [];
  if (avgFloor != null) summaryParts.push(`평균 거래 층수 ${avgFloor}층`);
  // 단위를 여기서 붙인다 — DB 값은 "1~23" 처럼 **단위가 없다**(라이브 1,488건 전수 확인).
  // 옛 격자에선 "거래 층수 범위" 라벨이 문맥을 줬지만 문장 안에서는 "거래 층 1~23" 으로 끊겨
  // 어색해진다. 값에 이미 "층" 이 붙어 오는 날을 대비해 한 번 떼고 다시 붙인다.
  if (floorRange != null) summaryParts.push(`거래 층 ${String(floorRange).replace(/층$/, "")}층`);

  const aria =
    `층별 평균 매매가 ${rows.length}개 구간. ` +
    rows.map((r) => `${r.group} ${fmtPrice(r.avg)}, ${r.count}건.`).join(" ") +
    (summaryParts.length > 0 ? ` ${summaryParts.join(", ")}.` : "");

  return (
    <ChartFrame title="층별 매매가 (주변 실거래)" ariaLabel={aria} height={140}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 84 }} aria-hidden>
        {rows.map((r) => {
          const pct = maxAvg > 0 ? Math.max(8, (r.avg / maxAvg) * 100) : 8;
          return (
            <div
              key={r.group}
              style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", height: "100%" }}
            >
              <span style={{ fontSize: F.micro, fontWeight: 700, color: C.text, marginBottom: 4 }}>
                {fmtPrice(r.avg)}
              </span>
              <div style={{ flex: 1, display: "flex", alignItems: "flex-end", width: "70%" }}>
                <div style={{ width: "100%", height: `${pct}%`, background: C.blue, borderRadius: "4px 4px 0 0" }} />
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
        {rows.map((r) => (
          <div key={r.group} style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontSize: F.xs, fontWeight: 700, color: C.sub }}>{r.group}</div>
            <div style={{ fontSize: F.micro, color: C.muted }}>{r.count}건</div>
          </div>
        ))}
      </div>
      {summaryParts.length > 0 && (
        <div style={{ marginTop: 8, fontSize: F.xs, color: C.sub }}>{summaryParts.join(" · ")}</div>
      )}
    </ChartFrame>
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
