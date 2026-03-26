import { memo } from "react";
import { C } from "@/theme";

/* ── 공유 스타일 상수 (DRY) ── */
const selectArrow = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 12 12'%3E%3Cpath d='M3 5l3 3 3-3' stroke='%236B7280' stroke-width='1.5' fill='none'/%3E%3C/svg%3E")`;
const selectBase = { WebkitAppearance: "none", MozAppearance: "none", appearance: "none", backgroundImage: selectArrow, backgroundRepeat: "no-repeat", backgroundPosition: "right 6px center" };
const numInput = (val, h = 30) => ({ flex: 1, minWidth: 0, padding: "4px 6px", fontSize: 11, border: val ? `1.5px solid ${C.indigo}` : `1px solid ${C.border}`, borderRadius: 5, outline: "none", height: h, boxSizing: "border-box", background: C.slate100 });
const resetBtn = (h = 30) => ({ background: C.slate100, border: `1px solid ${C.border}`, borderRadius: 5, padding: "0 6px", fontSize: 11, color: C.muted, cursor: "pointer", height: h, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 });
const tilde = { fontSize: 10, color: C.muted, flexShrink: 0 };

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
}) {
  const hasAreaUnits = areaMin || areaMax || unitsMin || unitsMax;
  return (
    <div data-no-print style={{ background: C.card, borderRadius: 10, padding: "8px 10px", border: `1px solid ${C.border}`, margin: "8px 0 6px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
      {/* 1행: 검색 입력 + 관심 토글 */}
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
      </div>
      {/* 2행: 지역 + 예산 + 초기화 */}
      <div style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 6 }}>
        <select value={filterRegion} onChange={e => onRegionChange(e.target.value)} aria-label="시/도" style={{
          ...selectBase, flex: "0 0 auto", width: 80, padding: "4px 20px 4px 8px", fontSize: 11,
          fontWeight: filterRegion !== "전체" ? 700 : 500,
          border: filterRegion !== "전체" ? `1.5px solid ${C.indigo}` : `1px solid ${C.border}`,
          borderRadius: 5, background: C.slate100,
          color: filterRegion !== "전체" ? C.indigo : C.slate600, cursor: "pointer", height: 30,
        }}>
          {regionOptions.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        {(() => { const guDisabled = filterRegion === "전체" || guOptions.length <= 1; return (
          <select value={filterRegion === "전체" ? "" : filterGu} onChange={e => onGuChange(e.target.value)} aria-label="구/군" disabled={guDisabled} style={{
            ...selectBase, flex: "0 0 auto", width: 80, padding: "4px 20px 4px 8px", fontSize: 11,
            fontWeight: filterGu !== "전체" ? 700 : 500,
            border: filterGu !== "전체" ? `1.5px solid ${C.indigo}` : `1px solid ${C.border}`, borderRadius: 5,
            background: guDisabled ? "#E2E8F0" : C.slate100,
            color: guDisabled ? "#94A3B8" : filterGu !== "전체" ? C.indigo : C.slate600,
            cursor: guDisabled ? "default" : "pointer", height: 30,
          }}>
            {filterRegion === "전체" && <option value="">지역 먼저 선택</option>}
            {guOptions.map(g2 => <option key={g2} value={g2}>{g2}</option>)}
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
      {/* 3행: 정렬 + 가중치 뱃지 */}
      <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
        {isPC ? [{ k: "total", l: "종합", ac: C.indigo, bg: C.indigoLight, pas: "#F0EEFF" }, { k: "price", l: "저가순", ac: C.amber, bg: C.amberLight, pas: "#FFFBEB" }, { k: "priceScore", l: "가격매력", ac: C.green, bg: C.greenLight, pas: "#EDFCF2" }, { k: "location", l: "입지", ac: C.blue, bg: C.blueLight, pas: "#EEF3FF" }, { k: "safe", l: "안전", ac: C.red, bg: C.redLight, pas: "#FEF2F2" }].map(s => (
          <button key={s.k} onClick={() => onSortChange(s.k)} style={{
            flex: 1, background: sortKey === s.k ? s.bg : s.pas, color: sortKey === s.k ? s.ac : C.slate600,
            border: sortKey === s.k ? `1.5px solid ${s.ac}` : "1.5px solid transparent", borderRadius: 5, padding: "4px 0", height: 28,
            fontSize: 11, fontWeight: sortKey === s.k ? 700 : 500, cursor: "pointer", whiteSpace: "nowrap", transition: "all .15s", textAlign: "center"
          }}>{s.l}</button>
        )) : (
          <select value={sortKey} onChange={e => onSortChange(e.target.value)} aria-label="정렬 기준" style={{
            flex: "0 0 auto", padding: "4px 24px 4px 8px", fontSize: 11, fontWeight: 700, height: 28,
            border: `1.5px solid ${C.indigo}`, borderRadius: 5, background: C.indigoLight, color: C.indigo,
            cursor: "pointer", WebkitAppearance: "none", MozAppearance: "none", appearance: "none",
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 12 12'%3E%3Cpath d='M3 5l3 3 3-3' stroke='%234F46E5' stroke-width='1.5' fill='none'/%3E%3C/svg%3E")`,
            backgroundRepeat: "no-repeat", backgroundPosition: "right 6px center"
          }}>
            {[{ k: "total", l: "종합순" }, { k: "price", l: "저가순" }, { k: "priceScore", l: "가격매력순" }, { k: "location", l: "입지순" }, { k: "safe", l: "안전순" }].map(s => (
              <option key={s.k} value={s.k}>{s.l}</option>
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
        {hasAreaUnits && (
          <button onClick={onAreaUnitsReset} aria-label="면적/세대 초기화" style={resetBtn(28)}>✕</button>
        )}
      </div>
    </div>
  );
});
