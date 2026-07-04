/**
 * 상세 필터 패널 — 최소점수 + 시공사등급 + 토글 필터 10개
 * 세션 480: 토글 10개를 성격별 4그룹(교통·생활편의/가족·교육/자금·규제/안전·품질)으로 시각 그룹화.
 *   그룹 메타·라벨·색은 @/constants/filterGroups (진실의 원천). 동작·색·aria 무변경 = 순수 시각 재배치.
 *   최소점수(number)·시공사등급(select)은 토글이 아니라 "안전·품질" 그룹 상단에 인라인 유지.
 */
import { memo } from "react";
import { C, F, R } from "@/theme";
import { IconClose } from "@/components/icons";
import { numInput, tilde, resetBtn, selectBase } from "./filterStyles";
import {
  DETAIL_FILTER_GROUPS,
  groupLabelStyle,
  type ToggleFilterKey,
  type ToggleColor,
} from "@/constants/filterGroups";

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
  parkingGoodOnly: boolean;
  onToggleParkingGoodOnly: () => void;
  hospitalNearOnly: boolean;
  onToggleHospitalNearOnly: () => void;
  parkNearOnly: boolean;
  onToggleParkNearOnly: () => void;
  filterOptionCounts?: { tierCounts?: Record<string, number> };
  /** 태블릿+PC(≥768) 가로 2칸 / 모바일 1칸 그리드 판정 (세션 483) */
  isPC?: boolean;
  /** PC(≥1024, 마우스)만 컨트롤 높이 32 납작 / 태블릿·모바일은 36 터치 (세션 483) */
  isDesktop?: boolean;
};

/** 토글 버튼 공통 스타일 — 활성 시 color 계열, 비활성 시 slate. PC 32 / 태블릿·모바일 36 (세션 483) */
function toggleBtnStyle(active: boolean, color: ToggleColor, isDesktop: boolean) {
  return {
    flexShrink: 0,
    height: isDesktop ? 32 : 36,
    padding: "0 10px",
    fontSize: F.xs,
    fontWeight: active ? 700 : 500,
    background: active ? C[`${color}Light`] : C.slate100,
    color: active ? C[color] : C.slate600,
    border: active ? `1.5px solid ${C[color]}` : `1px solid ${C.border}`,
    borderRadius: R.chip,
    cursor: "pointer",
    transition: "all .15s",
  } as const;
}

/** 그룹 내부 버튼 줄 — flexWrap 유지 (모바일 세로 폭증 방지) */
const groupRow = { display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" as const };

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
  parkingGoodOnly,
  onToggleParkingGoodOnly,
  hospitalNearOnly,
  onToggleHospitalNearOnly,
  parkNearOnly,
  onToggleParkNearOnly,
  filterOptionCounts,
  isPC = false,
  isDesktop = false,
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
    childcareGoodOnly ||
    parkingGoodOnly ||
    hospitalNearOnly ||
    parkNearOnly;

  // key → { value, onToggle } 조회 맵. ⚠️ filterGroups.ts 의 ToggleFilterKey 와 1:1 —
  // 어긋나면 Record<ToggleFilterKey,...> 타입이 typecheck 에서 잡음 (drift 가드).
  const toggleState: Record<ToggleFilterKey, { value: boolean; onToggle: () => void }> = {
    benefitOnly: { value: benefitOnly, onToggle: onToggleBenefitOnly },
    subwayOnly: { value: subwayOnly, onToggle: onToggleSubwayOnly },
    schoolGoodOnly: { value: schoolGoodOnly, onToggle: onToggleSchoolGoodOnly },
    dsrPassOnly: { value: dsrPassOnly, onToggle: onToggleDsrPassOnly },
    nonRegulatedOnly: { value: nonRegulatedOnly, onToggle: onToggleNonRegulatedOnly },
    crimeSafeOnly: { value: crimeSafeOnly, onToggle: onToggleCrimeSafeOnly },
    childcareGoodOnly: { value: childcareGoodOnly, onToggle: onToggleChildcareGoodOnly },
    parkingGoodOnly: { value: parkingGoodOnly, onToggle: onToggleParkingGoodOnly },
    hospitalNearOnly: { value: hospitalNearOnly, onToggle: onToggleHospitalNearOnly },
    parkNearOnly: { value: parkNearOnly, onToggle: onToggleParkNearOnly },
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* 4그룹 = 태블릿+PC(isPC ≥768) 가로 2칸 / 좁은 모바일 1칸 (세션 483).
          ⚠️ auto-fit 은 넓은 PC 에서 4칸까지 벌어져(라이브 실측 1280px→4칸) 사장님 "2칸"과
          어긋나므로, 정확히 최대 2칸으로 고정. isDesktop(≥1024) 게이팅은 태블릿서 1칸이라 폐기. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isPC ? "1fr 1fr" : "1fr",
          gap: 10,
        }}
      >
        {DETAIL_FILTER_GROUPS.map((group) => {
          const isQuality = group.label === "안전·품질";
          return (
            <div key={group.label} role="group" aria-label={`${group.label} 필터`}>
              <div style={groupLabelStyle(group.color)}>{group.label}</div>
              <div style={groupRow}>
                {/* 안전·품질 그룹 상단: 최소점수 + 시공사등급 (토글 아님, 인라인 유지) */}
                {isQuality && (
                  <>
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
                        height: isDesktop ? 32 : 36,
                        borderRadius: R.btn,
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
                            ? Object.values(filterOptionCounts?.tierCounts ?? {}).reduce(
                                (s: number, n: number) => s + n,
                                0
                              )
                            : 0;
                        return (
                          <option key={v} value={v} disabled={v !== "전체" && c === 0}>
                            {v === "전체" ? (total ? `전체 (${total})` : "전체") : `${v} (${c})`}
                          </option>
                        );
                      })}
                    </select>
                  </>
                )}
                {group.toggles.map((t) => {
                  const { value, onToggle } = toggleState[t.key];
                  return (
                    <button
                      key={t.key}
                      onClick={onToggle}
                      aria-label={t.ariaLabel}
                      aria-pressed={value}
                      style={toggleBtnStyle(value, t.color, isDesktop)}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
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
            if (parkingGoodOnly) onToggleParkingGoodOnly();
            if (hospitalNearOnly) onToggleHospitalNearOnly();
            if (parkNearOnly) onToggleParkNearOnly();
          }}
          aria-label="점수/시공사/혜택/역세권/학군/DSR/규제/치안/육아/주차/병원/공원 초기화"
          style={{ ...resetBtn(30), alignSelf: "flex-start" }}
        >
          <IconClose size={12} />
        </button>
      )}
    </div>
  );
});
