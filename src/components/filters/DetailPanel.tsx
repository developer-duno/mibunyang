/**
 * 상세 필터 패널 — 최소점수 + 시공사등급 + 혜택 토글 + 역세권 토글 + 학군 양호 토글
 * 기존 SearchFilterBar 5행에서 추출
 */
import { memo } from "react";
import { C, F } from "@/theme";
import { IconClose } from "@/components/icons";
import { numInput, tilde, resetBtn, selectBase } from "./filterStyles";

type DetailPanelProps = {
  minScore: number | string;
  onMinScoreChange: (_v: string) => void;
  builderTier: string;
  onBuilderTierChange: (_v: string) => void;
  benefitOnly: boolean;
  onToggleBenefitOnly: () => void;
  subwayOnly: boolean;
  onToggleSubwayOnly: () => void;
  schoolGoodOnly: boolean;
  onToggleSchoolGoodOnly: () => void;
  dsrPassOnly: boolean;
  onToggleDsrPassOnly: () => void;
  nonRegulatedOnly: boolean;
  onToggleNonRegulatedOnly: () => void;
  crimeSafeOnly: boolean;
  onToggleCrimeSafeOnly: () => void;
  childcareGoodOnly: boolean;
  onToggleChildcareGoodOnly: () => void;
  filterOptionCounts?: { tierCounts?: Record<string, number> };
};

export const DetailPanel = memo(function DetailPanel({
  minScore,
  onMinScoreChange,
  builderTier,
  onBuilderTierChange,
  benefitOnly,
  onToggleBenefitOnly,
  subwayOnly,
  onToggleSubwayOnly,
  schoolGoodOnly,
  onToggleSchoolGoodOnly,
  dsrPassOnly,
  onToggleDsrPassOnly,
  nonRegulatedOnly,
  onToggleNonRegulatedOnly,
  crimeSafeOnly,
  onToggleCrimeSafeOnly,
  childcareGoodOnly,
  onToggleChildcareGoodOnly,
  filterOptionCounts,
}: DetailPanelProps) {
  const hasFilter =
    minScore ||
    builderTier !== "전체" ||
    benefitOnly ||
    subwayOnly ||
    schoolGoodOnly ||
    dsrPassOnly ||
    nonRegulatedOnly ||
    crimeSafeOnly ||
    childcareGoodOnly;
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" as const }}>
      <span style={{ ...tilde, fontWeight: 600 }}>최소</span>
      <input
        type="number"
        inputMode="numeric"
        min="0"
        max="100"
        value={minScore}
        onChange={(e) => onMinScoreChange(e.target.value)}
        placeholder="점수"
        aria-label="최소 종합점수"
        style={{ ...numInput(minScore, 30), maxWidth: 60 }}
      />
      <span style={tilde}>점</span>
      <div style={{ width: 1, height: 16, background: C.border, flexShrink: 0 }} />
      <select
        value={builderTier}
        onChange={(e) => onBuilderTierChange(e.target.value)}
        aria-label="시공사 등급"
        style={{
          ...selectBase,
          flex: "0 0 auto",
          padding: "4px 20px 4px 6px",
          fontSize: F.xs,
          height: 30,
          borderRadius: 5,
          fontWeight: builderTier !== "전체" ? 700 : 500,
          border: builderTier !== "전체" ? `1.5px solid ${C.indigo}` : `1px solid ${C.border}`,
          background: C.slate100,
          color: builderTier !== "전체" ? C.indigo : C.slate600,
          cursor: "pointer",
        }}
      >
        {["전체", "1군", "2군", "기타"].map((v) => {
          const c = filterOptionCounts?.tierCounts?.[v] ?? 0;
          const total =
            v === "전체"
              ? Object.values(filterOptionCounts?.tierCounts ?? {}).reduce((s: number, n: number) => s + n, 0)
              : 0;
          return (
            <option key={v} value={v} disabled={v !== "전체" && c === 0}>
              {v === "전체" ? (total ? `전체 (${total})` : "전체") : `${v} (${c})`}
            </option>
          );
        })}
      </select>
      <button
        onClick={onToggleBenefitOnly}
        aria-label="혜택 있는 매물만"
        aria-pressed={benefitOnly}
        style={{
          flexShrink: 0,
          height: 30,
          padding: "0 10px",
          fontSize: F.xs,
          fontWeight: benefitOnly ? 700 : 500,
          background: benefitOnly ? C.amberLight : C.slate100,
          color: benefitOnly ? C.amber : C.slate600,
          border: benefitOnly ? `1.5px solid ${C.amber}` : `1px solid ${C.border}`,
          borderRadius: 5,
          cursor: "pointer",
          transition: "all .15s",
        }}
      >
        혜택
      </button>
      <button
        onClick={onToggleSubwayOnly}
        aria-label="역세권 매물만(500m 이내)"
        aria-pressed={subwayOnly}
        style={{
          flexShrink: 0,
          height: 30,
          padding: "0 10px",
          fontSize: F.xs,
          fontWeight: subwayOnly ? 700 : 500,
          background: subwayOnly ? C.blueLight : C.slate100,
          color: subwayOnly ? C.blue : C.slate600,
          border: subwayOnly ? `1.5px solid ${C.blue}` : `1px solid ${C.border}`,
          borderRadius: 5,
          cursor: "pointer",
          transition: "all .15s",
        }}
      >
        역세권
      </button>
      <button
        onClick={onToggleSchoolGoodOnly}
        aria-label="학군 양호(A·B등급) 매물만"
        aria-pressed={schoolGoodOnly}
        style={{
          flexShrink: 0,
          height: 30,
          padding: "0 10px",
          fontSize: F.xs,
          fontWeight: schoolGoodOnly ? 700 : 500,
          background: schoolGoodOnly ? C.greenLight : C.slate100,
          color: schoolGoodOnly ? C.green : C.slate600,
          border: schoolGoodOnly ? `1.5px solid ${C.green}` : `1px solid ${C.border}`,
          borderRadius: 5,
          cursor: "pointer",
          transition: "all .15s",
        }}
      >
        학군 양호
      </button>
      <button
        onClick={onToggleDsrPassOnly}
        aria-label="DSR 통과 매물만(자금조달 양호)"
        aria-pressed={dsrPassOnly}
        style={{
          flexShrink: 0,
          height: 30,
          padding: "0 10px",
          fontSize: F.xs,
          fontWeight: dsrPassOnly ? 700 : 500,
          background: dsrPassOnly ? C.indigoLight : C.slate100,
          color: dsrPassOnly ? C.indigo : C.slate600,
          border: dsrPassOnly ? `1.5px solid ${C.indigo}` : `1px solid ${C.border}`,
          borderRadius: 5,
          cursor: "pointer",
          transition: "all .15s",
        }}
      >
        DSR 통과
      </button>
      <button
        onClick={onToggleNonRegulatedOnly}
        aria-label="비규제지역 매물만(매매·대출 자유)"
        aria-pressed={nonRegulatedOnly}
        style={{
          flexShrink: 0,
          height: 30,
          padding: "0 10px",
          fontSize: F.xs,
          fontWeight: nonRegulatedOnly ? 700 : 500,
          background: nonRegulatedOnly ? C.purpleLight : C.slate100,
          color: nonRegulatedOnly ? C.purple : C.slate600,
          border: nonRegulatedOnly ? `1.5px solid ${C.purple}` : `1px solid ${C.border}`,
          borderRadius: 5,
          cursor: "pointer",
          transition: "all .15s",
        }}
      >
        비규제
      </button>
      <button
        onClick={onToggleCrimeSafeOnly}
        aria-label="치안 안전한 동네만(범죄 1~3등급)"
        aria-pressed={crimeSafeOnly}
        style={{
          flexShrink: 0,
          height: 30,
          padding: "0 10px",
          fontSize: F.xs,
          fontWeight: crimeSafeOnly ? 700 : 500,
          background: crimeSafeOnly ? C.cyanLight : C.slate100,
          color: crimeSafeOnly ? C.cyan : C.slate600,
          border: crimeSafeOnly ? `1.5px solid ${C.cyan}` : `1px solid ${C.border}`,
          borderRadius: 5,
          cursor: "pointer",
          transition: "all .15s",
        }}
      >
        치안안전
      </button>
      <button
        onClick={onToggleChildcareGoodOnly}
        aria-label="육아 인프라 좋은 곳만(어린이집 5개+ · 500m 이내)"
        aria-pressed={childcareGoodOnly}
        style={{
          flexShrink: 0,
          height: 30,
          padding: "0 10px",
          fontSize: F.xs,
          fontWeight: childcareGoodOnly ? 700 : 500,
          background: childcareGoodOnly ? C.pinkLight : C.slate100,
          color: childcareGoodOnly ? C.pink : C.slate600,
          border: childcareGoodOnly ? `1.5px solid ${C.pink}` : `1px solid ${C.border}`,
          borderRadius: 5,
          cursor: "pointer",
          transition: "all .15s",
        }}
      >
        육아인프라
      </button>
      {hasFilter && (
        <button
          onClick={() => {
            onMinScoreChange("");
            onBuilderTierChange("전체");
            if (benefitOnly) onToggleBenefitOnly();
            if (subwayOnly) onToggleSubwayOnly();
            if (schoolGoodOnly) onToggleSchoolGoodOnly();
            if (dsrPassOnly) onToggleDsrPassOnly();
            if (nonRegulatedOnly) onToggleNonRegulatedOnly();
            if (crimeSafeOnly) onToggleCrimeSafeOnly();
            if (childcareGoodOnly) onToggleChildcareGoodOnly();
          }}
          aria-label="점수/시공사/혜택/역세권/학군/DSR/규제/치안/육아 초기화"
          style={resetBtn(30)}
        >
          <IconClose size={12} />
        </button>
      )}
    </div>
  );
});
