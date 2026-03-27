import { memo, useState, useRef, useCallback } from "react";
import { C } from "@/theme";
import { SORT_OPTIONS } from "@/constants/sortOptions";
import { FILTER_PRESETS } from "@/constants/filterPresets";

/* ── 배지 pulse 애니메이션 (SSR-safe) ── */
const BADGE_ANIM = "badge-pulse";
if (typeof document !== "undefined" && !document.getElementById(BADGE_ANIM)) {
  const s = document.createElement("style"); s.id = BADGE_ANIM;
  s.textContent = `@keyframes ${BADGE_ANIM}{0%{transform:scale(1)}50%{transform:scale(1.15)}100%{transform:scale(1)}}`;
  document.head.appendChild(s);
}

/* ── 공유 스타일 상수 (DRY) ── */
const selectArrow = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 12 12'%3E%3Cpath d='M3 5l3 3 3-3' stroke='%236B7280' stroke-width='1.5' fill='none'/%3E%3C/svg%3E")`;
const selectBase = { WebkitAppearance: "none", MozAppearance: "none", appearance: "none", backgroundImage: selectArrow, backgroundRepeat: "no-repeat", backgroundPosition: "right 6px center" };
const numInput = (val, h = 30) => ({ flex: 1, minWidth: 0, padding: "4px 6px", fontSize: 11, border: val ? `1.5px solid ${C.indigo}` : `1px solid ${C.border}`, borderRadius: 5, outline: "none", height: h, boxSizing: "border-box", background: C.slate100 });
const resetBtn = (h = 30) => ({ background: C.slate100, border: `1px solid ${C.border}`, borderRadius: 5, padding: "0 6px", fontSize: 11, color: C.muted, cursor: "pointer", height: h, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 });
const tilde = { fontSize: 10, color: C.muted, flexShrink: 0 };
const chipStyle = { fontSize: 10, padding: "2px 6px", borderRadius: 10, background: C.indigoLight, color: C.indigo, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" };

/** 검색 + 필터 + 정렬 + 가중치 뱃지 통합 바 */
export const SearchFilterBar = memo(function SearchFilterBar({
  searchText, onSearchChange,
  filterRegion, onRegionChange, regionOptions,
  filterGu, onGuChange, guOptions,
  budgetMin, onBudgetMinChange, budgetMax, onBudgetMaxChange, onBudgetReset,
  sortKey, onSortChange,
  pw, catCol, catBg,
  isPC,
  showFavOnly, onToggleFavOnly, favCount,
  areaMin, onAreaMinChange, areaMax, onAreaMaxChange,
  unitsMin, onUnitsMinChange, unitsMax, onUnitsMaxChange, onAreaUnitsReset,
  moveInFilter, onMoveInChange,
  minScore, onMinScoreChange,
  builderTier, onBuilderTierChange,
  benefitOnly, onToggleBenefitOnly,
  filterCollapsed, onToggleCollapsed, activeFilterCount,
  filteredLength, scoredLength,
  onShareFilters,
  onResetAll,
  onApplyPreset,
  customPresets, onSavePreset, onDeletePreset,
  filterHistory, onApplyHistory, onClearHistory,
  onUndo, onRedo, canUndo, canRedo,
  filterOptionCounts,
  catMinScores, onCatMinChange, onCatMinReset,
}) {
  const hasAreaUnits = areaMin || areaMax || unitsMin || unitsMax;
  const prevLenRef = useRef(filteredLength);
  const delta = filteredLength != null && prevLenRef.current != null && prevLenRef.current !== filteredLength ? filteredLength - prevLenRef.current : null;
  if (filteredLength != null && filteredLength !== prevLenRef.current) prevLenRef.current = filteredLength;
  const [showPresetInput, setShowPresetInput] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [historyKey, setHistoryKey] = useState(0);
  const presetInputRef = useRef(null);
  const handlePresetSave = useCallback(() => {
    if (presetName.trim() && onSavePreset) { onSavePreset(presetName); setPresetName(""); setShowPresetInput(false); }
  }, [presetName, onSavePreset]);
  return (
    <div data-no-print style={{ background: C.card, borderRadius: 10, padding: "8px 10px", border: `1px solid ${C.border}`, margin: "8px 0 6px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
      {/* 1행: 검색 + 관심 토글 + 결과 건수 + 접기 */}
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
        <div style={{ position: "relative", flex: 1 }}>
          <input type="text" value={searchText} onChange={e => onSearchChange(e.target.value)} placeholder="단지명, 건설사, 지역 검색" aria-label="단지 검색" style={{
            width: "100%", padding: "6px 30px 6px 10px", fontSize: 12,
            border: searchText ? `1.5px solid ${C.indigo}` : `1px solid ${C.border}`,
            borderRadius: 6, background: C.slate100, color: C.text,
            outline: "none", height: 32, boxSizing: "border-box"
          }} />
          {searchText && (
            <button onClick={() => onSearchChange("")} aria-label="검색어 지우기" style={{
              position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
              background: "none", border: "none", cursor: "pointer", color: C.muted, fontSize: 14, padding: 2
            }}>✕</button>
          )}
        </div>
        <button onClick={onToggleFavOnly} aria-label="관심매물만 보기" style={{
          flexShrink: 0, height: 32, padding: "0 10px", fontSize: 11, fontWeight: showFavOnly ? 700 : 500,
          background: showFavOnly ? C.redLight : C.slate100, color: showFavOnly ? C.red : C.slate600,
          border: showFavOnly ? `1.5px solid ${C.red}` : `1px solid ${C.border}`, borderRadius: 6,
          cursor: "pointer", display: "flex", alignItems: "center", gap: 3, transition: "all .15s"
        }}>{showFavOnly ? "\u2665" : "\u2661"}{favCount > 0 ? ` ${favCount}` : ""}</button>
        <button onClick={onToggleCollapsed} aria-label="필터 접기/펼치기" style={{
          flexShrink: 0, height: 32, padding: "0 8px", fontSize: 11, fontWeight: 600,
          background: activeFilterCount > 0 ? C.indigoLight : C.slate100,
          color: activeFilterCount > 0 ? C.indigo : C.slate600,
          border: activeFilterCount > 0 ? `1.5px solid ${C.indigo}` : `1px solid ${C.border}`, borderRadius: 6,
          cursor: "pointer", display: "flex", alignItems: "center", gap: 2, transition: "all .15s"
        }}>{filterCollapsed ? "▼" : "▲"}{activeFilterCount > 0 ? ` ${activeFilterCount}` : ""}</button>
        {(canUndo || canRedo) && <>
          <button onClick={onUndo} disabled={!canUndo} aria-label="필터 되돌리기" style={{
            flexShrink: 0, height: 32, width: 32, fontSize: 13, background: canUndo ? C.slate100 : "#F1F5F9",
            color: canUndo ? C.slate600 : "#CBD5E1", border: `1px solid ${canUndo ? C.border : "#E2E8F0"}`,
            borderRadius: 6, cursor: canUndo ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center"
          }}>↩</button>
          <button onClick={onRedo} disabled={!canRedo} aria-label="필터 다시실행" style={{
            flexShrink: 0, height: 32, width: 32, fontSize: 13, background: canRedo ? C.slate100 : "#F1F5F9",
            color: canRedo ? C.slate600 : "#CBD5E1", border: `1px solid ${canRedo ? C.border : "#E2E8F0"}`,
            borderRadius: 6, cursor: canRedo ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center"
          }}>↪</button>
        </>}
      </div>
      {/* 결과 건수 + 활성 필터 태그 칩 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, marginBottom: filterCollapsed ? 0 : 6 }}>
        {activeFilterCount > 0 && (
          <div style={{ display: "flex", gap: 3, flexWrap: "wrap", flex: 1 }}>
            {showFavOnly && <span onClick={onToggleFavOnly} style={chipStyle}>관심 ✕</span>}
            {filterRegion !== "전체" && <span onClick={() => onRegionChange("전체")} style={chipStyle}>{filterRegion} ✕</span>}
            {(budgetMin || budgetMax) && <span onClick={onBudgetReset} style={chipStyle}>{budgetMin || "0"}~{budgetMax || "∞"}억 ✕</span>}
            {(areaMin || areaMax) && <span onClick={() => { onAreaMinChange(""); onAreaMaxChange(""); }} style={chipStyle}>면적 {areaMin || "0"}~{areaMax || "∞"}㎡ ✕</span>}
            {(unitsMin || unitsMax) && <span onClick={() => { onUnitsMinChange(""); onUnitsMaxChange(""); }} style={chipStyle}>세대 {unitsMin || "0"}~{unitsMax || "∞"} ✕</span>}
            {moveInFilter !== "전체" && <span onClick={() => onMoveInChange("전체")} style={chipStyle}>{moveInFilter} ✕</span>}
            {minScore && <span onClick={() => onMinScoreChange("")} style={chipStyle}>{minScore}점+ ✕</span>}
            {builderTier !== "전체" && <span onClick={() => onBuilderTierChange("전체")} style={chipStyle}>{builderTier} ✕</span>}
            {benefitOnly && <span onClick={onToggleBenefitOnly} style={chipStyle}>혜택 ✕</span>}
            {searchText && <span onClick={() => onSearchChange("")} style={chipStyle}>{searchText.length > 10 ? searchText.slice(0, 10) + "…" : searchText} ✕</span>}
          </div>
        )}
        {filteredLength != null && <span key={filteredLength} style={{
          fontSize: 11, fontWeight: 700, flexShrink: 0, padding: "2px 8px", borderRadius: 10,
          color: filteredLength === 0 ? C.red : C.indigo,
          background: filteredLength === 0 ? C.redLight : C.indigoLight,
          animation: `${BADGE_ANIM} 0.3s ease-out`
        }}>{filteredLength} / {scoredLength}개{delta != null && <span style={{
          fontSize: 9, marginLeft: 3, fontWeight: 600,
          color: delta > 0 ? C.green : C.red
        }}>{delta > 0 ? "+" : ""}{delta}</span>}</span>}
        {activeFilterCount > 0 && onResetAll && (
          <button onClick={onResetAll} aria-label="전체 필터 초기화" style={{
            flexShrink: 0, height: 22, padding: "0 6px", fontSize: 10, fontWeight: 600,
            background: C.redLight, color: C.red, border: `1px solid ${C.red}`, borderRadius: 4,
            cursor: "pointer", display: "flex", alignItems: "center", gap: 2
          }}>초기화</button>
        )}
        {activeFilterCount > 0 && onShareFilters && (
          <button onClick={onShareFilters} aria-label="필터 조건 공유" style={{
            flexShrink: 0, height: 22, padding: "0 6px", fontSize: 10, fontWeight: 600,
            background: C.slate100, color: C.slate600, border: `1px solid ${C.border}`, borderRadius: 4,
            cursor: "pointer", display: "flex", alignItems: "center", gap: 2
          }}>🔗 공유</button>
        )}
      </div>
      {!filterCollapsed && <>
      {/* 2행: 지역 + 예산 + 초기화 */}
      <div style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 6 }}>
        <select value={filterRegion} onChange={e => onRegionChange(e.target.value)} aria-label="시/도" style={{
          ...selectBase, flex: "0 0 auto", minWidth: 80, width: "auto", maxWidth: 130, padding: "4px 20px 4px 8px", fontSize: 11,
          fontWeight: filterRegion !== "전체" ? 700 : 500,
          border: filterRegion !== "전체" ? `1.5px solid ${C.indigo}` : `1px solid ${C.border}`,
          borderRadius: 5, background: C.slate100,
          color: filterRegion !== "전체" ? C.indigo : C.slate600, cursor: "pointer", height: 30,
        }}>
          {regionOptions.map(r => { const c = filterOptionCounts?.regionCounts?.[r] ?? 0; return <option key={r} value={r} disabled={r !== "전체" && c === 0}>{r === "전체" ? "전체" : `${r} (${c})`}</option>; })}
        </select>
        {(() => { const guDisabled = filterRegion === "전체" || guOptions.length <= 1; return (
          <select value={filterRegion === "전체" ? "" : filterGu} onChange={e => onGuChange(e.target.value)} aria-label="구/군" disabled={guDisabled} style={{
            ...selectBase, flex: "0 0 auto", minWidth: 80, width: "auto", maxWidth: 130, padding: "4px 20px 4px 8px", fontSize: 11,
            fontWeight: filterGu !== "전체" ? 700 : 500,
            border: filterGu !== "전체" ? `1.5px solid ${C.indigo}` : `1px solid ${C.border}`, borderRadius: 5,
            background: guDisabled ? "#E2E8F0" : C.slate100,
            color: guDisabled ? "#94A3B8" : filterGu !== "전체" ? C.indigo : C.slate600,
            cursor: guDisabled ? "default" : "pointer", height: 30,
          }}>
            {filterRegion === "전체" && <option value="">지역 먼저 선택</option>}
            {guOptions.map(g2 => { const c = filterOptionCounts?.guCounts?.[g2] ?? 0; return <option key={g2} value={g2} disabled={g2 !== "전체" && c === 0}>{g2 === "전체" ? "전체" : `${g2} (${c})`}</option>; })}
          </select>
        ); })()}
        <input type="number" inputMode="decimal" min="0" step="0.1" value={budgetMin} onChange={e => onBudgetMinChange(e.target.value)} placeholder="최소(억)" aria-label="최소 예산(억)" style={numInput(budgetMin)} />
        <span style={tilde}>~</span>
        <input type="number" inputMode="decimal" min="0" step="0.1" value={budgetMax} onChange={e => onBudgetMaxChange(e.target.value)} placeholder="최대(억)" aria-label="최대 예산(억)" style={numInput(budgetMax)} />
        <span style={tilde}>억</span>
        {(budgetMin || budgetMax) ? (
          <button onClick={onBudgetReset} aria-label="예산 초기화" style={resetBtn()}>✕</button>
        ) : null}
      </div>
      {/* 예산 프리셋 */}
      {!budgetMin && !budgetMax && (
        <div style={{ display: "flex", gap: 3, marginBottom: 6 }}>
          {[3, 5, 7, 10].map(v => (
            <button key={v} onClick={() => { onBudgetMinChange(""); onBudgetMaxChange(String(v)); }} style={{
              flex: 1, fontSize: 10, fontWeight: 600, padding: "3px 0", height: 24,
              background: C.slate100, color: C.slate600, border: `1px solid ${C.border}`,
              borderRadius: 4, cursor: "pointer", transition: "all .15s"
            }}>{v}억 이하</button>
          ))}
        </div>
      )}
      {/* 프리셋 버튼 (기본 + 커스텀) */}
      {activeFilterCount === 0 && onApplyPreset && (
        <div style={{ display: "flex", gap: 3, marginBottom: 6, flexWrap: "wrap" }}>
          {FILTER_PRESETS.map(p => (
            <button key={p.key} onClick={() => onApplyPreset(p.values)} title={p.desc} style={{
              flex: "1 0 auto", fontSize: 10, fontWeight: 600, padding: "3px 6px", height: 24,
              background: C.indigoLight, color: C.indigo, border: `1px solid ${C.indigo}`,
              borderRadius: 4, cursor: "pointer", transition: "all .15s", whiteSpace: "nowrap"
            }}>{p.label}</button>
          ))}
          {customPresets?.map(p => (
            <span key={p.key} style={{ display: "inline-flex", alignItems: "center", gap: 1 }}>
              <button onClick={() => onApplyPreset(p.values)} title={p.desc} style={{
                fontSize: 10, fontWeight: 600, padding: "3px 6px", height: 24,
                background: C.greenLight, color: C.green, border: `1px solid ${C.green}`,
                borderRadius: "4px 0 0 4px", cursor: "pointer", whiteSpace: "nowrap"
              }}>{p.label}</button>
              <button onClick={() => onDeletePreset?.(p.key)} aria-label={`${p.label} 삭제`} style={{
                fontSize: 9, padding: "3px 4px", height: 24, background: C.greenLight, color: C.green,
                border: `1px solid ${C.green}`, borderLeft: "none", borderRadius: "0 4px 4px 0", cursor: "pointer"
              }}>✕</button>
            </span>
          ))}
        </div>
      )}
      {/* 프리셋 저장 버튼 (필터 활성 시) */}
      {activeFilterCount > 0 && onSavePreset && (
        <div style={{ display: "flex", gap: 3, marginBottom: 6, alignItems: "center" }}>
          {showPresetInput ? (
            <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
              <input ref={presetInputRef} type="text" value={presetName} onChange={e => setPresetName(e.target.value)}
                maxLength={12} placeholder="이름 (12자)" autoFocus
                onKeyDown={e => { if (e.key === "Enter") handlePresetSave(); if (e.key === "Escape") { setShowPresetInput(false); setPresetName(""); } }}
                style={{ width: 80, fontSize: 10, height: 24, padding: "2px 6px", border: `1px solid ${C.green}`, borderRadius: 4, outline: "none", background: C.greenLight }} />
              <button onClick={handlePresetSave} style={{ fontSize: 10, fontWeight: 600, padding: "3px 6px", height: 24, background: C.green, color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>저장</button>
              <button onClick={() => { setShowPresetInput(false); setPresetName(""); }} style={{ fontSize: 10, padding: "3px 4px", height: 24, background: C.slate100, color: C.muted, border: `1px solid ${C.border}`, borderRadius: 4, cursor: "pointer" }}>취소</button>
            </div>
          ) : (
            <button onClick={() => setShowPresetInput(true)} aria-label="현재 필터를 프리셋으로 저장" style={{
              fontSize: 10, fontWeight: 600, padding: "3px 8px", height: 24,
              background: C.greenLight, color: C.green, border: `1px solid ${C.green}`,
              borderRadius: 4, cursor: "pointer", whiteSpace: "nowrap"
            }}>+ 프리셋 저장</button>
          )}
          {filterHistory?.length > 0 && (
            <select key={historyKey} onChange={e => { const i = Number(e.target.value); if (filterHistory[i]) { onApplyHistory?.(filterHistory[i]); setHistoryKey(k => k + 1); } }} defaultValue="" aria-label="필터 히스토리" style={{
              ...selectBase, flex: 1, fontSize: 10, height: 24, padding: "2px 20px 2px 6px",
              border: `1px solid ${C.border}`, borderRadius: 4, background: C.slate100, color: C.slate600, cursor: "pointer"
            }}>
              <option value="" disabled>히스토리 ({filterHistory.length})</option>
              {filterHistory.map((h, i) => (
                <option key={h.sig} value={i}>필터 {h.count}개 · {new Date(h.ts).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</option>
              ))}
            </select>
          )}
          {filterHistory?.length > 0 && onClearHistory && (
            <button onClick={onClearHistory} aria-label="히스토리 삭제" style={{ ...resetBtn(24), fontSize: 9 }}>지우기</button>
          )}
        </div>
      )}
      {/* 3행: 정렬 + 가중치 뱃지 */}
      <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
        {isPC ? SORT_OPTIONS.map(s => (
          <button key={s.key} onClick={() => onSortChange(s.key)} style={{
            flex: 1, background: sortKey === s.key ? s.bg : s.pas, color: sortKey === s.key ? s.ac : C.slate600,
            border: sortKey === s.key ? `1.5px solid ${s.ac}` : "1.5px solid transparent", borderRadius: 5, padding: "4px 0", height: 28,
            fontSize: 11, fontWeight: sortKey === s.key ? 700 : 500, cursor: "pointer", whiteSpace: "nowrap", transition: "all .15s", textAlign: "center"
          }}>{s.pcLabel}</button>
        )) : (
          <select value={sortKey} onChange={e => onSortChange(e.target.value)} aria-label="정렬 기준" style={{
            flex: "0 0 auto", padding: "4px 24px 4px 8px", fontSize: 11, fontWeight: 700, height: 28,
            border: `1.5px solid ${C.indigo}`, borderRadius: 5, background: C.indigoLight, color: C.indigo,
            cursor: "pointer", WebkitAppearance: "none", MozAppearance: "none", appearance: "none",
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 12 12'%3E%3Cpath d='M3 5l3 3 3-3' stroke='%234F46E5' stroke-width='1.5' fill='none'/%3E%3C/svg%3E")`,
            backgroundRepeat: "no-repeat", backgroundPosition: "right 6px center"
          }}>
            {SORT_OPTIONS.map(s => (
              <option key={s.key} value={s.key}>{s.mobileLabel}</option>
            ))}
          </select>
        )}
        <div style={{ width: 1, height: 20, background: C.border, flexShrink: 0, margin: "0 2px" }} />
        {Object.entries(pw).map(([k]) => {
          const nm = { location: "입지", product: "상품", price: "가격", risk: "안전", benefit: "혜택", future: "미래" };
          return <span key={k} style={{ fontSize: 9, fontWeight: 700, color: catCol[k], background: catBg[k], padding: "2px 4px", borderRadius: 3, whiteSpace: "nowrap" }}>{nm[k]}{pw[k]}</span>;
        })}
      </div>
      {/* 4행: 면적 + 세대수 필터 */}
      <div style={{ display: "flex", gap: 4, alignItems: "center", marginTop: 6 }}>
        <span style={tilde}>면적</span>
        <input type="number" inputMode="numeric" min="0" value={areaMin} onChange={e => onAreaMinChange(e.target.value)} placeholder="최소" aria-label="최소 면적(㎡)" style={numInput(areaMin, 28)} />
        <span style={tilde}>~</span>
        <input type="number" inputMode="numeric" min="0" value={areaMax} onChange={e => onAreaMaxChange(e.target.value)} placeholder="최대" aria-label="최대 면적(㎡)" style={numInput(areaMax, 28)} />
        <span style={tilde}>㎡</span>
        <div style={{ width: 1, height: 16, background: C.border, flexShrink: 0 }} />
        <span style={tilde}>세대</span>
        <input type="number" inputMode="numeric" min="0" value={unitsMin} onChange={e => onUnitsMinChange(e.target.value)} placeholder="최소" aria-label="최소 세대수" style={numInput(unitsMin, 28)} />
        <span style={tilde}>~</span>
        <input type="number" inputMode="numeric" min="0" value={unitsMax} onChange={e => onUnitsMaxChange(e.target.value)} placeholder="최대" aria-label="최대 세대수" style={numInput(unitsMax, 28)} />
        <div style={{ width: 1, height: 16, background: C.border, flexShrink: 0 }} />
        <select value={moveInFilter} onChange={e => onMoveInChange(e.target.value)} aria-label="입주 상태" style={{
          ...selectBase, flex: "0 0 auto", padding: "4px 20px 4px 6px", fontSize: 11, height: 28, borderRadius: 5,
          fontWeight: moveInFilter !== "전체" ? 700 : 500,
          border: moveInFilter !== "전체" ? `1.5px solid ${C.indigo}` : `1px solid ${C.border}`,
          background: C.slate100, color: moveInFilter !== "전체" ? C.indigo : C.slate600, cursor: "pointer",
        }}>
          {["전체", "입주예정", "미입주", "입주완료"].map(v => { const c = filterOptionCounts?.moveInCounts?.[v] ?? 0; const total = v === "전체" ? Object.values(filterOptionCounts?.moveInCounts ?? {}).reduce((s, n) => s + n, 0) : 0; return <option key={v} value={v} disabled={v !== "전체" && c === 0}>{v === "전체" ? (total ? `전체 (${total})` : "전체") : `${v} (${c})`}</option>; })}
        </select>
        {(hasAreaUnits || moveInFilter !== "전체") && (
          <button onClick={() => { onAreaUnitsReset(); onMoveInChange("전체"); }} aria-label="면적/세대/입주 초기화" style={resetBtn(28)}>✕</button>
        )}
      </div>
      {/* 5행: 종합점수 최소 + 시공사 + 혜택 토글 */}
      <div style={{ display: "flex", gap: 4, alignItems: "center", marginTop: 6 }}>
        <span style={tilde}>최소</span>
        <input type="number" inputMode="numeric" min="0" max="100" value={minScore} onChange={e => onMinScoreChange(e.target.value)} placeholder="점수" aria-label="최소 종합점수" style={{ ...numInput(minScore, 28), maxWidth: 52 }} />
        <span style={tilde}>점</span>
        <div style={{ width: 1, height: 16, background: C.border, flexShrink: 0 }} />
        <select value={builderTier} onChange={e => onBuilderTierChange(e.target.value)} aria-label="시공사 등급" style={{
          ...selectBase, flex: "0 0 auto", padding: "4px 20px 4px 6px", fontSize: 11, height: 28, borderRadius: 5,
          fontWeight: builderTier !== "전체" ? 700 : 500,
          border: builderTier !== "전체" ? `1.5px solid ${C.indigo}` : `1px solid ${C.border}`,
          background: C.slate100, color: builderTier !== "전체" ? C.indigo : C.slate600, cursor: "pointer",
        }}>
          {["전체", "1군", "2군", "기타"].map(v => { const c = filterOptionCounts?.tierCounts?.[v] ?? 0; const total = v === "전체" ? Object.values(filterOptionCounts?.tierCounts ?? {}).reduce((s, n) => s + n, 0) : 0; return <option key={v} value={v} disabled={v !== "전체" && c === 0}>{v === "전체" ? (total ? `전체 (${total})` : "전체") : `${v} (${c})`}</option>; })}
        </select>
        <button onClick={onToggleBenefitOnly} aria-label="혜택 있는 매물만" style={{
          flexShrink: 0, height: 28, padding: "0 8px", fontSize: 10, fontWeight: benefitOnly ? 700 : 500,
          background: benefitOnly ? C.amberLight : C.slate100, color: benefitOnly ? C.amber : C.slate600,
          border: benefitOnly ? `1.5px solid ${C.amber}` : `1px solid ${C.border}`, borderRadius: 5,
          cursor: "pointer", transition: "all .15s"
        }}>혜택</button>
        {(minScore || builderTier !== "전체" || benefitOnly) && (
          <button onClick={() => { onMinScoreChange(""); onBuilderTierChange("전체"); if (benefitOnly) onToggleBenefitOnly(); }} aria-label="점수/시공사/혜택 초기화" style={resetBtn(28)}>✕</button>
        )}
      </div>
      {/* 6행: 카테고리별 최소 점수 (접이식) */}
      {catMinScores && (() => {
        const CAT_UI = [
          { key: "price", label: "가격", fKey: "min_price" },
          { key: "location", label: "입지", fKey: "min_location" },
          { key: "product", label: "상품", fKey: "min_product" },
          { key: "benefit", label: "혜택", fKey: "min_benefit" },
          { key: "risk", label: "안전", fKey: "min_risk" },
          { key: "future", label: "미래", fKey: "min_future" },
        ];
        const hasCatFilter = Object.values(catMinScores).some(Boolean);
        return (
          <div style={{ marginTop: 6 }}>
            <button onClick={() => {}} aria-label="카테고리 점수 필터 토글" style={{ background: "transparent", border: "none", padding: 0, fontSize: 11, color: hasCatFilter ? C.indigo : C.muted, fontWeight: 600, cursor: "pointer", marginBottom: 4 }}>
              ▸ 카테고리별 최소 점수 {hasCatFilter ? `(${Object.values(catMinScores).filter(Boolean).length})` : ""}
            </button>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
              {CAT_UI.map(({ key, label, fKey }) => (
                <div key={key} style={{ display: "flex", alignItems: "center", gap: 2 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: catCol?.[key] || C.muted, minWidth: 22 }}>{label}</span>
                  <input type="number" inputMode="numeric" min="0" max="100"
                    value={catMinScores[fKey] ?? ""} onChange={e => onCatMinChange?.(key, e.target.value)}
                    placeholder="0" aria-label={`${label} 최소 점수`}
                    style={{ ...numInput(catMinScores[fKey], 26), maxWidth: 48, fontSize: 10 }} />
                </div>
              ))}
            </div>
            {hasCatFilter && <button onClick={onCatMinReset} aria-label="카테고리 점수 초기화" style={{ ...resetBtn(24), marginTop: 4, fontSize: 10 }}>카테고리 초기화</button>}
          </div>
        );
      })()}
      </>}
    </div>
  );
});
