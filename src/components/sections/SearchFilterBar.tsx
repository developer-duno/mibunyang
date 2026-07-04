/**
 * 검색 필터 바 — 드롭다운 패널 오케스트레이터
 * 1행: 6개 FilterButton + 건수/관심/미분양/undo
 * 드롭다운: 한번에 하나만 열림 (openPanel 상태)
 * 2행: 활성 필터 칩 + 초기화/공유
 */
import { memo, useState, useRef, useEffect, useCallback, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { C, F } from "@/theme";
import { SORT_OPTIONS } from "@/constants/sortOptions";
import { IconHeart, IconHeartFilled } from "@/components/icons";
import { chipStyle } from "@/components/filters/filterStyles";
import { FilterButton } from "@/components/filters/FilterButton";
import { FilterDropdown } from "@/components/filters/FilterDropdown";
import { RegionPanel } from "@/components/filters/RegionPanel";
import { BudgetPanel } from "@/components/filters/BudgetPanel";
import { AreaPanel } from "@/components/filters/AreaPanel";
import { SortPanel } from "@/components/filters/SortPanel";
import { DetailPanel } from "@/components/filters/DetailPanel";
import { PresetPanel } from "@/components/filters/PresetPanel";
import type { SearchFilterBarProps } from "@/types/components/SearchFilterBar.types";

/** 검색 + 필터 + 정렬 + 프리셋 통합 바 */
export const SearchFilterBar = memo(function SearchFilterBar({
  filterRegion,
  onRegionChange,
  regionOptions,
  filterGu,
  onGuChange,
  guOptions,
  budgetMin,
  onBudgetMinChange,
  budgetMax,
  onBudgetMaxChange,
  onBudgetReset,
  sortKey,
  onSortChange,
  searchQuery = "",
  onSearchChange,
  isDesktop,
  isPC,
  showFavOnly,
  onToggleFavOnly,
  favCount,
  areaMin,
  onAreaMinChange,
  areaMax,
  onAreaMaxChange,
  unitsMin,
  onUnitsMinChange,
  unitsMax,
  onUnitsMaxChange,
  onAreaUnitsReset,
  moveInFilter,
  onMoveInChange,
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
  hideNoUnsold,
  onToggleHideNoUnsold,
  activeFilterCount,
  filteredLength,
  scoredLength,
  onShareFilters,
  onResetAll,
  onApplyPreset,
  customPresets,
  onSavePreset,
  onDeletePreset,
  filterHistory,
  onApplyHistory,
  onClearHistory,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  filterOptionCounts,
  showToast = () => {},
}: SearchFilterBarProps) {
  /* ── 드롭다운 상태 (한번에 하나만) ── */
  const [openPanel, setOpenPanel] = useState<string | null>(null);
  const togglePanel = useCallback((key: string) => setOpenPanel((prev) => (prev === key ? null : key)), []);
  const closePanel = useCallback(() => setOpenPanel(null), []);

  /* 활성 필터 칩 키보드 핸들러 — Enter/Space → 동일 onClick 콜백 */
  const onChipKeyDown = useCallback(
    (cb: (() => void) | undefined) => (e: ReactKeyboardEvent) => {
      if (!cb) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        cb();
      }
    },
    []
  );

  /* ESC 키보드 + 외부 클릭으로 닫기 */
  const barRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!openPanel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePanel();
    };
    const onClick = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) closePanel();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [openPanel, closePanel]);

  /* 건수 변화 추적 */
  const prevLenRef = useRef<number>(filteredLength);
  useEffect(() => {
    if (filteredLength != null) prevLenRef.current = filteredLength;
  }, [filteredLength]);

  /* 트리거 버튼 요약 텍스트 */
  const regionSummary =
    filterRegion !== "전체" ? (filterGu !== "전체" ? `${filterRegion} ${filterGu}` : filterRegion) : undefined;
  const budgetSummary = budgetMin || budgetMax ? `${budgetMin || "0"}~${budgetMax || "∞"}억` : undefined;
  const areaSummary =
    areaMin || areaMax
      ? `${areaMin || "0"}~${areaMax || "∞"}㎡`
      : unitsMin || unitsMax
        ? "세대수"
        : moveInFilter !== "전체"
          ? moveInFilter
          : undefined;
  const sortLabel = sortKey !== "total" ? SORT_OPTIONS.find((s) => s.key === sortKey)?.pcLabel : undefined;
  const detailActive = !!(
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
    parkNearOnly
  );

  /* undo/redo 버튼 공용 스타일 (active = canUndo/canRedo, undefined → 비활성) */
  const undoRedoBtnStyle = (active?: boolean) => ({
    flexShrink: 0,
    height: 36,
    width: 36,
    fontSize: F.base,
    background: active ? C.slate100 : "#F1F5F9",
    color: active ? C.slate600 : "#CBD5E1",
    border: `1px solid ${active ? C.border : "#E2E8F0"}`,
    borderRadius: 6,
    cursor: active ? "pointer" : "default",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  });

  return (
    <div
      ref={barRef}
      data-no-print
      style={{
        position: "relative", // 드롭다운 오버레이(absolute) 기준점 (세션 481)
        zIndex: 20, // 열린 드롭다운이 아래 카드 위로
        background: C.card,
        borderRadius: isDesktop ? 12 : 10,
        padding: isDesktop ? "12px 16px" : "8px 10px",
        border: `1px solid ${C.border}`,
        margin: isDesktop ? "12px 0 10px" : "8px 0 6px",
        boxShadow: C.shadowSm,
      }}
    >
      {/* 1행: 드롭다운 트리거 + 건수 + 관심 + 미분양 + undo */}
      <div style={{ display: "flex", gap: isDesktop ? 6 : 4, alignItems: "center", flexWrap: "wrap" }}>
        <FilterButton
          label="지역"
          summary={regionSummary}
          isOpen={openPanel === "region"}
          isActive={!!regionSummary}
          onClick={() => togglePanel("region")}
        />
        <FilterButton
          label="금액"
          summary={budgetSummary}
          isOpen={openPanel === "budget"}
          isActive={!!budgetSummary}
          onClick={() => togglePanel("budget")}
        />
        <FilterButton
          label="면적"
          summary={areaSummary}
          isOpen={openPanel === "area"}
          isActive={!!areaSummary}
          onClick={() => togglePanel("area")}
        />
        <FilterButton
          label="정렬"
          summary={sortLabel}
          isOpen={openPanel === "sort"}
          isActive={!!sortLabel}
          onClick={() => togglePanel("sort")}
        />
        <FilterButton
          label="추천"
          isOpen={openPanel === "preset"}
          isActive={false}
          onClick={() => togglePanel("preset")}
        />
        <FilterButton
          label="상세"
          isOpen={openPanel === "detail"}
          isActive={detailActive}
          onClick={() => togglePanel("detail")}
        />
        <FilterButton
          label="검색"
          summary={searchQuery.trim() ? searchQuery : undefined}
          isOpen={openPanel === "search"}
          isActive={!!searchQuery.trim()}
          onClick={() => togglePanel("search")}
        />
        <div style={{ flex: 1 }} />
        {/* 건수 배지 */}
        {filteredLength != null && (
          <span
            key={filteredLength}
            style={{
              fontSize: F.xs,
              fontWeight: 700,
              flexShrink: 0,
              padding: "2px 8px",
              borderRadius: 10,
              color: filteredLength === 0 ? C.red : C.indigo,
              background: filteredLength === 0 ? C.redLight : C.indigoLight,
            }}
          >
            {filteredLength}
            {scoredLength != null ? ` / ${scoredLength}` : ""}개
          </span>
        )}
        {/* 관심매물 */}
        <button
          onClick={onToggleFavOnly}
          aria-label="관심매물만 보기"
          aria-pressed={showFavOnly}
          style={{
            flexShrink: 0,
            height: 36,
            padding: "0 10px",
            fontSize: F.xs,
            fontWeight: showFavOnly ? 700 : 500,
            background: showFavOnly ? C.redLight : C.slate100,
            color: showFavOnly ? C.red : C.slate600,
            border: showFavOnly ? `1.5px solid ${C.red}` : `1px solid ${C.border}`,
            borderRadius: 6,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 3,
            transition: "all .15s",
          }}
        >
          {showFavOnly ? <IconHeartFilled size={13} /> : <IconHeart size={13} />}
          {(favCount ?? 0) > 0 ? ` ${favCount}` : ""}
        </button>
        {/* 미분양 토글 */}
        <button
          onClick={onToggleHideNoUnsold}
          aria-pressed={!hideNoUnsold}
          aria-label="미분양 없는 단지 보기"
          style={{
            flexShrink: 0,
            height: 36,
            padding: "0 8px",
            fontSize: F.micro,
            fontWeight: !hideNoUnsold ? 700 : 500,
            background: !hideNoUnsold ? C.amberLight : C.slate100,
            color: !hideNoUnsold ? C.amber : C.slate600,
            border: !hideNoUnsold ? `1.5px solid ${C.amber}` : `1px solid ${C.border}`,
            borderRadius: 6,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 2,
            transition: "all .15s",
          }}
        >
          {hideNoUnsold ? "완판 포함" : "미분양만"}
        </button>
        {/* undo/redo */}
        {(canUndo || canRedo) && (
          <>
            <button onClick={onUndo} disabled={!canUndo} aria-label="필터 되돌리기" style={undoRedoBtnStyle(canUndo)}>
              ↩
            </button>
            <button onClick={onRedo} disabled={!canRedo} aria-label="필터 다시실행" style={undoRedoBtnStyle(canRedo)}>
              ↪
            </button>
          </>
        )}
      </div>

      {/* 드롭다운 열림 시 뒤 카드 어둡게 + 클릭 시 닫힘 (세션 481) — fixed 라 바(z20) 아래 전체 화면 */}
      {openPanel && (
        <div
          data-no-print
          aria-hidden="true"
          onClick={closePanel}
          style={{
            position: "fixed",
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            zIndex: 15,
            background: "rgba(15,20,35,0.16)",
          }}
        />
      )}

      {/* 드롭다운 패널 (한번에 하나만) */}
      <FilterDropdown isOpen={openPanel === "region"} label="지역" isDesktop={isDesktop}>
        <RegionPanel
          filterRegion={filterRegion}
          onRegionChange={onRegionChange}
          regionOptions={regionOptions}
          filterGu={filterGu}
          onGuChange={onGuChange}
          guOptions={guOptions}
          filterOptionCounts={filterOptionCounts}
        />
      </FilterDropdown>
      <FilterDropdown isOpen={openPanel === "budget"} label="금액" isDesktop={isDesktop}>
        <BudgetPanel
          budgetMin={budgetMin}
          onBudgetMinChange={onBudgetMinChange}
          budgetMax={budgetMax}
          onBudgetMaxChange={onBudgetMaxChange}
          onBudgetReset={onBudgetReset}
        />
      </FilterDropdown>
      <FilterDropdown isOpen={openPanel === "area"} label="면적" isDesktop={isDesktop}>
        <AreaPanel
          areaMin={areaMin}
          onAreaMinChange={onAreaMinChange}
          areaMax={areaMax}
          onAreaMaxChange={onAreaMaxChange}
          unitsMin={unitsMin}
          onUnitsMinChange={onUnitsMinChange}
          unitsMax={unitsMax}
          onUnitsMaxChange={onUnitsMaxChange}
          onAreaUnitsReset={onAreaUnitsReset}
          moveInFilter={moveInFilter}
          onMoveInChange={onMoveInChange}
          filterOptionCounts={filterOptionCounts}
        />
      </FilterDropdown>
      <FilterDropdown isOpen={openPanel === "sort"} label="정렬" isDesktop={isDesktop}>
        <SortPanel sortKey={sortKey} onSortChange={onSortChange} onClose={closePanel} />
      </FilterDropdown>
      <FilterDropdown isOpen={openPanel === "preset"} label="추천" isDesktop={isDesktop}>
        <PresetPanel
          key={openPanel === "preset" ? "open" : "closed"}
          customPresets={customPresets}
          onApplyPreset={onApplyPreset}
          onSavePreset={onSavePreset}
          onDeletePreset={onDeletePreset}
          filterHistory={filterHistory}
          onApplyHistory={onApplyHistory}
          onClearHistory={onClearHistory}
          activeFilterCount={activeFilterCount}
          closePanel={closePanel}
          showToast={showToast}
        />
      </FilterDropdown>
      <FilterDropdown isOpen={openPanel === "detail"} label="상세" isDesktop={isDesktop}>
        <DetailPanel
          minScore={minScore}
          onMinScoreChange={onMinScoreChange}
          builderTier={builderTier}
          onBuilderTierChange={onBuilderTierChange}
          benefitOnly={benefitOnly}
          onToggleBenefitOnly={onToggleBenefitOnly}
          subwayOnly={subwayOnly}
          onToggleSubwayOnly={onToggleSubwayOnly}
          schoolGoodOnly={schoolGoodOnly}
          onToggleSchoolGoodOnly={onToggleSchoolGoodOnly}
          dsrPassOnly={dsrPassOnly}
          onToggleDsrPassOnly={onToggleDsrPassOnly}
          nonRegulatedOnly={nonRegulatedOnly}
          onToggleNonRegulatedOnly={onToggleNonRegulatedOnly}
          crimeSafeOnly={crimeSafeOnly}
          onToggleCrimeSafeOnly={onToggleCrimeSafeOnly}
          childcareGoodOnly={childcareGoodOnly}
          onToggleChildcareGoodOnly={onToggleChildcareGoodOnly}
          parkingGoodOnly={parkingGoodOnly}
          onToggleParkingGoodOnly={onToggleParkingGoodOnly}
          hospitalNearOnly={hospitalNearOnly}
          onToggleHospitalNearOnly={onToggleHospitalNearOnly}
          parkNearOnly={parkNearOnly}
          onToggleParkNearOnly={onToggleParkNearOnly}
          filterOptionCounts={filterOptionCounts}
          isPC={isPC}
        />
      </FilterDropdown>
      <FilterDropdown isOpen={openPanel === "search"} label="검색" isDesktop={isDesktop}>
        <input
          value={searchQuery}
          onChange={(e) => onSearchChange?.(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") closePanel();
          }}
          placeholder="단지명·지역 검색 (예: 래미안, 대전)"
          aria-label="단지명·지역 검색"
          autoFocus
          style={{
            width: "100%",
            height: 38,
            padding: "0 12px",
            fontSize: F.base,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            boxSizing: "border-box",
          }}
        />
      </FilterDropdown>

      {/* 2행: 활성 필터 칩 + 초기화 + 공유 */}
      {activeFilterCount > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
          <div style={{ display: "flex", gap: 3, flexWrap: "wrap", flex: 1 }}>
            {searchQuery.trim() && (
              <span
                role="button"
                tabIndex={0}
                aria-label="검색어 해제"
                onClick={() => onSearchChange?.("")}
                onKeyDown={onChipKeyDown(() => onSearchChange?.(""))}
                style={chipStyle}
              >
                검색: {searchQuery} ✕
              </span>
            )}
            {showFavOnly && (
              <span
                role="button"
                tabIndex={0}
                aria-label="관심 필터 해제"
                onClick={onToggleFavOnly}
                onKeyDown={onChipKeyDown(onToggleFavOnly)}
                style={chipStyle}
              >
                관심 ✕
              </span>
            )}
            {filterRegion !== "전체" && (
              <span
                role="button"
                tabIndex={0}
                aria-label={`${filterRegion} 필터 해제`}
                onClick={() => onRegionChange("전체")}
                onKeyDown={onChipKeyDown(() => onRegionChange("전체"))}
                style={chipStyle}
              >
                {filterRegion} ✕
              </span>
            )}
            {(budgetMin || budgetMax) && (
              <span
                role="button"
                tabIndex={0}
                aria-label="예산 필터 해제"
                onClick={onBudgetReset}
                onKeyDown={onChipKeyDown(onBudgetReset)}
                style={chipStyle}
              >
                {budgetMin || "0"}~{budgetMax || "∞"}억 ✕
              </span>
            )}
            {(areaMin || areaMax) && (
              <span
                role="button"
                tabIndex={0}
                aria-label="면적 필터 해제"
                onClick={() => {
                  onAreaMinChange("");
                  onAreaMaxChange("");
                }}
                onKeyDown={onChipKeyDown(() => {
                  onAreaMinChange("");
                  onAreaMaxChange("");
                })}
                style={chipStyle}
              >
                면적 {areaMin || "0"}~{areaMax || "∞"}㎡ ✕
              </span>
            )}
            {(unitsMin || unitsMax) && (
              <span
                role="button"
                tabIndex={0}
                aria-label="세대수 필터 해제"
                onClick={() => {
                  onUnitsMinChange("");
                  onUnitsMaxChange("");
                }}
                onKeyDown={onChipKeyDown(() => {
                  onUnitsMinChange("");
                  onUnitsMaxChange("");
                })}
                style={chipStyle}
              >
                세대 {unitsMin || "0"}~{unitsMax || "∞"} ✕
              </span>
            )}
            {moveInFilter !== "전체" && (
              <span
                role="button"
                tabIndex={0}
                aria-label={`${moveInFilter} 필터 해제`}
                onClick={() => onMoveInChange("전체")}
                onKeyDown={onChipKeyDown(() => onMoveInChange("전체"))}
                style={chipStyle}
              >
                {moveInFilter} ✕
              </span>
            )}
            {minScore && (
              <span
                role="button"
                tabIndex={0}
                aria-label="점수 필터 해제"
                onClick={() => onMinScoreChange("")}
                onKeyDown={onChipKeyDown(() => onMinScoreChange(""))}
                style={chipStyle}
              >
                {minScore}점+ ✕
              </span>
            )}
            {builderTier !== "전체" && (
              <span
                role="button"
                tabIndex={0}
                aria-label={`${builderTier} 필터 해제`}
                onClick={() => onBuilderTierChange("전체")}
                onKeyDown={onChipKeyDown(() => onBuilderTierChange("전체"))}
                style={chipStyle}
              >
                {builderTier} ✕
              </span>
            )}
            {benefitOnly && (
              <span
                role="button"
                tabIndex={0}
                aria-label="혜택 필터 해제"
                onClick={onToggleBenefitOnly}
                onKeyDown={onChipKeyDown(onToggleBenefitOnly)}
                style={chipStyle}
              >
                혜택 ✕
              </span>
            )}
            {subwayOnly && (
              <span
                role="button"
                tabIndex={0}
                aria-label="역세권 필터 해제"
                onClick={onToggleSubwayOnly}
                onKeyDown={onChipKeyDown(onToggleSubwayOnly)}
                style={chipStyle}
              >
                역세권 ✕
              </span>
            )}
            {schoolGoodOnly && (
              <span
                role="button"
                tabIndex={0}
                aria-label="학군 양호 필터 해제"
                onClick={onToggleSchoolGoodOnly}
                onKeyDown={onChipKeyDown(onToggleSchoolGoodOnly)}
                style={chipStyle}
              >
                학군 양호 ✕
              </span>
            )}
            {dsrPassOnly && (
              <span
                role="button"
                tabIndex={0}
                aria-label="DSR 통과 필터 해제"
                onClick={onToggleDsrPassOnly}
                onKeyDown={onChipKeyDown(onToggleDsrPassOnly)}
                style={chipStyle}
              >
                DSR 통과 ✕
              </span>
            )}
            {nonRegulatedOnly && (
              <span
                role="button"
                tabIndex={0}
                aria-label="비규제 필터 해제"
                onClick={onToggleNonRegulatedOnly}
                onKeyDown={onChipKeyDown(onToggleNonRegulatedOnly)}
                style={chipStyle}
              >
                비규제 ✕
              </span>
            )}
            {crimeSafeOnly && (
              <span
                role="button"
                tabIndex={0}
                aria-label="치안안전 필터 해제"
                onClick={onToggleCrimeSafeOnly}
                onKeyDown={onChipKeyDown(onToggleCrimeSafeOnly)}
                style={chipStyle}
              >
                치안안전 ✕
              </span>
            )}
            {childcareGoodOnly && (
              <span
                role="button"
                tabIndex={0}
                aria-label="육아인프라 필터 해제"
                onClick={onToggleChildcareGoodOnly}
                onKeyDown={onChipKeyDown(onToggleChildcareGoodOnly)}
                style={chipStyle}
              >
                육아인프라 ✕
              </span>
            )}
            {parkingGoodOnly && (
              <span
                role="button"
                tabIndex={0}
                aria-label="주차넉넉 필터 해제"
                onClick={onToggleParkingGoodOnly}
                onKeyDown={onChipKeyDown(onToggleParkingGoodOnly)}
                style={chipStyle}
              >
                주차넉넉 ✕
              </span>
            )}
            {hospitalNearOnly && (
              <span
                role="button"
                tabIndex={0}
                aria-label="병원가까움 필터 해제"
                onClick={onToggleHospitalNearOnly}
                onKeyDown={onChipKeyDown(onToggleHospitalNearOnly)}
                style={chipStyle}
              >
                병원가까움 ✕
              </span>
            )}
            {parkNearOnly && (
              <span
                role="button"
                tabIndex={0}
                aria-label="공원가까움 필터 해제"
                onClick={onToggleParkNearOnly}
                onKeyDown={onChipKeyDown(onToggleParkNearOnly)}
                style={chipStyle}
              >
                공원가까움 ✕
              </span>
            )}
          </div>
          {onResetAll && (
            <button
              onClick={onResetAll}
              aria-label="전체 필터 초기화"
              style={{
                flexShrink: 0,
                height: 22,
                padding: "0 6px",
                fontSize: F.micro,
                fontWeight: 600,
                background: C.redLight,
                color: C.red,
                border: `1px solid ${C.red}`,
                borderRadius: 4,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 2,
              }}
            >
              초기화
            </button>
          )}
          {onShareFilters && (
            <button
              onClick={onShareFilters}
              aria-label="필터 조건 공유"
              style={{
                flexShrink: 0,
                height: 22,
                padding: "0 6px",
                fontSize: F.micro,
                fontWeight: 600,
                background: C.slate100,
                color: C.slate600,
                border: `1px solid ${C.border}`,
                borderRadius: 4,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 2,
              }}
            >
              공유
            </button>
          )}
        </div>
      )}
    </div>
  );
});
