/**
 * 검색 필터 바 — 드롭다운 패널 오케스트레이터
 * 1행: 6개 FilterButton + 건수/관심/미분양/undo
 * 드롭다운: 한번에 하나만 열림 (openPanel 상태)
 * 2행: 활성 필터 칩 + 초기화/공유
 */
import { memo, useState, useRef, useEffect, useCallback } from "react";
import { C, F } from "@/theme";
import { SORT_OPTIONS } from "@/constants/sortOptions";
import { IconClose, IconHeart, IconHeartFilled } from "@/components/icons";
import { chipStyle } from "@/components/filters/filterStyles";
import { FilterButton } from "@/components/filters/FilterButton";
import { FilterDropdown } from "@/components/filters/FilterDropdown";
import { RegionPanel } from "@/components/filters/RegionPanel";
import { BudgetPanel } from "@/components/filters/BudgetPanel";
import { AreaPanel } from "@/components/filters/AreaPanel";
import { SortPanel } from "@/components/filters/SortPanel";
import { DetailPanel } from "@/components/filters/DetailPanel";
import { PresetPanel } from "@/components/filters/PresetPanel";

/** 검색 + 필터 + 정렬 + 프리셋 통합 바 */
export const SearchFilterBar = memo(function SearchFilterBar({
  filterRegion, onRegionChange, regionOptions,
  filterGu, onGuChange, guOptions,
  budgetMin, onBudgetMinChange, budgetMax, onBudgetMaxChange, onBudgetReset,
  sortKey, onSortChange,
  isPC, isDesktop,
  showFavOnly, onToggleFavOnly, favCount,
  areaMin, onAreaMinChange, areaMax, onAreaMaxChange,
  unitsMin, onUnitsMinChange, unitsMax, onUnitsMaxChange, onAreaUnitsReset,
  moveInFilter, onMoveInChange,
  minScore, onMinScoreChange,
  builderTier, onBuilderTierChange,
  benefitOnly, onToggleBenefitOnly,
  hideNoUnsold, onToggleHideNoUnsold,
  filterCollapsed, onToggleCollapsed, activeFilterCount,
  filteredLength, scoredLength,
  onShareFilters,
  onResetAll,
  onApplyPreset,
  customPresets, onSavePreset, onDeletePreset,
  filterHistory, onApplyHistory, onClearHistory,
  onUndo, onRedo, canUndo, canRedo,
  filterOptionCounts,
  showToast = () => {},
}) {
  /* ── 드롭다운 상태 (한번에 하나만) ── */
  const [openPanel, setOpenPanel] = useState(null);
  const togglePanel = useCallback((key) => setOpenPanel(prev => prev === key ? null : key), []);
  const closePanel = useCallback(() => setOpenPanel(null), []);

  /* 활성 필터 칩 키보드 핸들러 — Enter/Space → 동일 onClick 콜백 */
  const onChipKeyDown = useCallback((cb) => (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      cb();
    }
  }, []);

  /* ESC 키보드 + 외부 클릭으로 닫기 */
  const barRef = useRef(null);
  useEffect(() => {
    if (!openPanel) return;
    const onKey = (e) => { if (e.key === "Escape") closePanel(); };
    const onClick = (e) => { if (barRef.current && !barRef.current.contains(e.target)) closePanel(); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onClick); };
  }, [openPanel, closePanel]);

  /* 건수 변화 추적 */
  const prevLenRef = useRef(filteredLength);
  useEffect(() => {
    if (filteredLength != null) prevLenRef.current = filteredLength;
  }, [filteredLength]);

  /* 트리거 버튼 요약 텍스트 */
  const regionSummary = filterRegion !== "전체" ? (filterGu !== "전체" ? `${filterRegion} ${filterGu}` : filterRegion) : null;
  const budgetSummary = (budgetMin || budgetMax) ? `${budgetMin || "0"}~${budgetMax || "∞"}억` : null;
  const areaSummary = (areaMin || areaMax) ? `${areaMin || "0"}~${areaMax || "∞"}㎡` : (unitsMin || unitsMax) ? "세대수" : moveInFilter !== "전체" ? moveInFilter : null;
  const sortLabel = sortKey !== "total" ? SORT_OPTIONS.find(s => s.key === sortKey)?.pcLabel : null;
  const detailActive = !!(minScore || builderTier !== "전체" || benefitOnly);

  return (
    <div ref={barRef} data-no-print style={{ background: C.card, borderRadius: isDesktop ? 12 : 10, padding: isDesktop ? "12px 16px" : "8px 10px", border: `1px solid ${C.border}`, margin: isDesktop ? "12px 0 10px" : "8px 0 6px", boxShadow: C.shadowSm }}>
      {/* 1행: 드롭다운 트리거 + 건수 + 관심 + 미분양 + undo */}
      <div style={{ display: "flex", gap: isDesktop ? 6 : 4, alignItems: "center", flexWrap: "wrap" }}>
        <FilterButton label="지역" summary={regionSummary} isOpen={openPanel === "region"} isActive={!!regionSummary} onClick={() => togglePanel("region")} />
        <FilterButton label="금액" summary={budgetSummary} isOpen={openPanel === "budget"} isActive={!!budgetSummary} onClick={() => togglePanel("budget")} />
        <FilterButton label="면적" summary={areaSummary} isOpen={openPanel === "area"} isActive={!!areaSummary} onClick={() => togglePanel("area")} />
        <FilterButton label="정렬" summary={sortLabel} isOpen={openPanel === "sort"} isActive={!!sortLabel} onClick={() => togglePanel("sort")} />
        <FilterButton label="추천" isOpen={openPanel === "preset"} isActive={false} onClick={() => togglePanel("preset")} />
        <FilterButton label="상세" isOpen={openPanel === "detail"} isActive={detailActive} onClick={() => togglePanel("detail")} />
        <div style={{ flex: 1 }} />
        {/* 건수 배지 */}
        {filteredLength != null && <span key={filteredLength} style={{
          fontSize: F.xs, fontWeight: 700, flexShrink: 0, padding: "2px 8px", borderRadius: 10,
          color: filteredLength === 0 ? C.red : C.indigo,
          background: filteredLength === 0 ? C.redLight : C.indigoLight,
        }}>{filteredLength}{scoredLength != null ? ` / ${scoredLength}` : ""}개</span>}
        {/* 관심매물 */}
        <button onClick={onToggleFavOnly} aria-label="관심매물만 보기" aria-pressed={showFavOnly} style={{
          flexShrink: 0, height: 36, padding: "0 10px", fontSize: F.xs, fontWeight: showFavOnly ? 700 : 500,
          background: showFavOnly ? C.redLight : C.slate100, color: showFavOnly ? C.red : C.slate600,
          border: showFavOnly ? `1.5px solid ${C.red}` : `1px solid ${C.border}`, borderRadius: 6,
          cursor: "pointer", display: "flex", alignItems: "center", gap: 3, transition: "all .15s",
        }}>{showFavOnly ? <IconHeartFilled size={13} /> : <IconHeart size={13} />}{favCount > 0 ? ` ${favCount}` : ""}</button>
        {/* 미분양 토글 */}
        <button onClick={onToggleHideNoUnsold} aria-pressed={!hideNoUnsold} aria-label="미분양 없는 단지 보기" style={{
          flexShrink: 0, height: 36, padding: "0 8px", fontSize: F.micro, fontWeight: !hideNoUnsold ? 700 : 500,
          background: !hideNoUnsold ? C.amberLight : C.slate100, color: !hideNoUnsold ? C.amber : C.slate600,
          border: !hideNoUnsold ? `1.5px solid ${C.amber}` : `1px solid ${C.border}`, borderRadius: 6,
          cursor: "pointer", display: "flex", alignItems: "center", gap: 2, transition: "all .15s",
        }}>{hideNoUnsold ? "완판 포함" : "미분양만"}</button>
        {/* undo/redo */}
        {(canUndo || canRedo) && <>
          <button onClick={onUndo} disabled={!canUndo} aria-label="필터 되돌리기" style={{
            flexShrink: 0, height: 36, width: 36, fontSize: F.base, background: canUndo ? C.slate100 : "#F1F5F9",
            color: canUndo ? C.slate600 : "#CBD5E1", border: `1px solid ${canUndo ? C.border : "#E2E8F0"}`,
            borderRadius: 6, cursor: canUndo ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center",
          }}>↩</button>
          <button onClick={onRedo} disabled={!canRedo} aria-label="필터 다시실행" style={{
            flexShrink: 0, height: 36, width: 36, fontSize: F.base, background: canRedo ? C.slate100 : "#F1F5F9",
            color: canRedo ? C.slate600 : "#CBD5E1", border: `1px solid ${canRedo ? C.border : "#E2E8F0"}`,
            borderRadius: 6, cursor: canRedo ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center",
          }}>↪</button>
        </>}
      </div>

      {/* 드롭다운 패널 (한번에 하나만) */}
      <FilterDropdown isOpen={openPanel === "region"} label="지역" isDesktop={isDesktop}>
        <RegionPanel filterRegion={filterRegion} onRegionChange={onRegionChange} regionOptions={regionOptions} filterGu={filterGu} onGuChange={onGuChange} guOptions={guOptions} filterOptionCounts={filterOptionCounts} />
      </FilterDropdown>
      <FilterDropdown isOpen={openPanel === "budget"} label="금액" isDesktop={isDesktop}>
        <BudgetPanel budgetMin={budgetMin} onBudgetMinChange={onBudgetMinChange} budgetMax={budgetMax} onBudgetMaxChange={onBudgetMaxChange} onBudgetReset={onBudgetReset} />
      </FilterDropdown>
      <FilterDropdown isOpen={openPanel === "area"} label="면적" isDesktop={isDesktop}>
        <AreaPanel areaMin={areaMin} onAreaMinChange={onAreaMinChange} areaMax={areaMax} onAreaMaxChange={onAreaMaxChange} unitsMin={unitsMin} onUnitsMinChange={onUnitsMinChange} unitsMax={unitsMax} onUnitsMaxChange={onUnitsMaxChange} onAreaUnitsReset={onAreaUnitsReset} moveInFilter={moveInFilter} onMoveInChange={onMoveInChange} filterOptionCounts={filterOptionCounts} />
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
        <DetailPanel minScore={minScore} onMinScoreChange={onMinScoreChange} builderTier={builderTier} onBuilderTierChange={onBuilderTierChange} benefitOnly={benefitOnly} onToggleBenefitOnly={onToggleBenefitOnly} filterOptionCounts={filterOptionCounts} />
      </FilterDropdown>

      {/* 2행: 활성 필터 칩 + 초기화 + 공유 */}
      {activeFilterCount > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
          <div style={{ display: "flex", gap: 3, flexWrap: "wrap", flex: 1 }}>
            {showFavOnly && <span role="button" tabIndex={0} aria-label="관심 필터 해제" onClick={onToggleFavOnly} onKeyDown={onChipKeyDown(onToggleFavOnly)} style={chipStyle}>관심 ✕</span>}
            {filterRegion !== "전체" && <span role="button" tabIndex={0} aria-label={`${filterRegion} 필터 해제`} onClick={() => onRegionChange("전체")} onKeyDown={onChipKeyDown(() => onRegionChange("전체"))} style={chipStyle}>{filterRegion} ✕</span>}
            {(budgetMin || budgetMax) && <span role="button" tabIndex={0} aria-label="예산 필터 해제" onClick={onBudgetReset} onKeyDown={onChipKeyDown(onBudgetReset)} style={chipStyle}>{budgetMin || "0"}~{budgetMax || "∞"}억 ✕</span>}
            {(areaMin || areaMax) && <span role="button" tabIndex={0} aria-label="면적 필터 해제" onClick={() => { onAreaMinChange(""); onAreaMaxChange(""); }} onKeyDown={onChipKeyDown(() => { onAreaMinChange(""); onAreaMaxChange(""); })} style={chipStyle}>면적 {areaMin || "0"}~{areaMax || "∞"}㎡ ✕</span>}
            {(unitsMin || unitsMax) && <span role="button" tabIndex={0} aria-label="세대수 필터 해제" onClick={() => { onUnitsMinChange(""); onUnitsMaxChange(""); }} onKeyDown={onChipKeyDown(() => { onUnitsMinChange(""); onUnitsMaxChange(""); })} style={chipStyle}>세대 {unitsMin || "0"}~{unitsMax || "∞"} ✕</span>}
            {moveInFilter !== "전체" && <span role="button" tabIndex={0} aria-label={`${moveInFilter} 필터 해제`} onClick={() => onMoveInChange("전체")} onKeyDown={onChipKeyDown(() => onMoveInChange("전체"))} style={chipStyle}>{moveInFilter} ✕</span>}
            {minScore && <span role="button" tabIndex={0} aria-label="점수 필터 해제" onClick={() => onMinScoreChange("")} onKeyDown={onChipKeyDown(() => onMinScoreChange(""))} style={chipStyle}>{minScore}점+ ✕</span>}
            {builderTier !== "전체" && <span role="button" tabIndex={0} aria-label={`${builderTier} 필터 해제`} onClick={() => onBuilderTierChange("전체")} onKeyDown={onChipKeyDown(() => onBuilderTierChange("전체"))} style={chipStyle}>{builderTier} ✕</span>}
            {benefitOnly && <span role="button" tabIndex={0} aria-label="혜택 필터 해제" onClick={onToggleBenefitOnly} onKeyDown={onChipKeyDown(onToggleBenefitOnly)} style={chipStyle}>혜택 ✕</span>}
          </div>
          {onResetAll && (
            <button onClick={onResetAll} aria-label="전체 필터 초기화" style={{
              flexShrink: 0, height: 22, padding: "0 6px", fontSize: F.micro, fontWeight: 600,
              background: C.redLight, color: C.red, border: `1px solid ${C.red}`, borderRadius: 4,
              cursor: "pointer", display: "flex", alignItems: "center", gap: 2,
            }}>초기화</button>
          )}
          {onShareFilters && (
            <button onClick={onShareFilters} aria-label="필터 조건 공유" style={{
              flexShrink: 0, height: 22, padding: "0 6px", fontSize: F.micro, fontWeight: 600,
              background: C.slate100, color: C.slate600, border: `1px solid ${C.border}`, borderRadius: 4,
              cursor: "pointer", display: "flex", alignItems: "center", gap: 2,
            }}>공유</button>
          )}
        </div>
      )}
    </div>
  );
});
