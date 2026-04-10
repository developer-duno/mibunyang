/**
 * 면적+세대수+입주상태 필터 패널
 * 면적 프리셋(소형/중형/대형) 추가로 사용 편의성 개선
 */
import { memo } from "react";
import { C, F } from "@/theme";
import { IconClose } from "@/components/icons";
import { numInput, tilde, resetBtn, selectBase } from "./filterStyles";

/* 면적 프리셋 — 소형/중형/대형 */
const AREA_PRESETS = [
  { label: "소형 ~59㎡", min: "", max: "59" },
  { label: "중형 60~85㎡", min: "60", max: "85" },
  { label: "대형 85㎡~", min: "85", max: "" },
];

export const AreaPanel = memo(function AreaPanel({
  areaMin, onAreaMinChange, areaMax, onAreaMaxChange,
  unitsMin, onUnitsMinChange, unitsMax, onUnitsMaxChange,
  onAreaUnitsReset, moveInFilter, onMoveInChange, filterOptionCounts,
}) {
  const hasFilter = areaMin || areaMax || unitsMin || unitsMax || moveInFilter !== "전체";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* 면적 입력 + 프리셋 */}
      <div>
        <div style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 6 }}>
          <span style={{ ...tilde, fontWeight: 600 }}>면적</span>
          <input type="number" inputMode="numeric" min="0" value={areaMin} onChange={e => onAreaMinChange(e.target.value)} placeholder="최소" aria-label="최소 면적(㎡)" style={numInput(areaMin, 30)} />
          <span style={tilde}>~</span>
          <input type="number" inputMode="numeric" min="0" value={areaMax} onChange={e => onAreaMaxChange(e.target.value)} placeholder="최대" aria-label="최대 면적(㎡)" style={numInput(areaMax, 30)} />
          <span style={tilde}>㎡</span>
        </div>
        <div style={{ display: "flex", gap: 3 }}>
          {AREA_PRESETS.map(p => {
            const selected = areaMin === p.min && areaMax === p.max && (p.min || p.max);
            return (
              <button key={p.label} onClick={() => { onAreaMinChange(p.min); onAreaMaxChange(p.max); }}
                style={{
                  flex: 1, fontSize: F.micro, fontWeight: selected ? 700 : 600, padding: "3px 0", height: 28,
                  background: selected ? C.indigoLight : C.slate100,
                  color: selected ? C.indigo : C.slate600,
                  border: selected ? `1.5px solid ${C.indigo}` : `1px solid ${C.border}`,
                  borderRadius: 5, cursor: "pointer", transition: "all .15s",
                }}
              >{p.label}</button>
            );
          })}
        </div>
      </div>
      {/* 세대수 + 입주상태 */}
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <span style={{ ...tilde, fontWeight: 600 }}>세대</span>
        <input type="number" inputMode="numeric" min="0" value={unitsMin} onChange={e => onUnitsMinChange(e.target.value)} placeholder="최소" aria-label="최소 세대수" style={numInput(unitsMin, 30)} />
        <span style={tilde}>~</span>
        <input type="number" inputMode="numeric" min="0" value={unitsMax} onChange={e => onUnitsMaxChange(e.target.value)} placeholder="최대" aria-label="최대 세대수" style={numInput(unitsMax, 30)} />
        <div style={{ width: 1, height: 16, background: C.border, flexShrink: 0 }} />
        <select value={moveInFilter} onChange={e => onMoveInChange(e.target.value)} aria-label="입주 상태" style={{
          ...selectBase, flex: "0 0 auto", padding: "4px 20px 4px 6px", fontSize: F.xs, height: 30, borderRadius: 5,
          fontWeight: moveInFilter !== "전체" ? 700 : 500,
          border: moveInFilter !== "전체" ? `1.5px solid ${C.indigo}` : `1px solid ${C.border}`,
          background: C.slate100, color: moveInFilter !== "전체" ? C.indigo : C.slate600, cursor: "pointer",
        }}>
          {["전체", "입주예정", "미입주", "입주완료"].map(v => {
            const c = filterOptionCounts?.moveInCounts?.[v] ?? 0;
            const total = v === "전체" ? Object.values(filterOptionCounts?.moveInCounts ?? {}).reduce((s, n) => s + n, 0) : 0;
            return <option key={v} value={v} disabled={v !== "전체" && c === 0}>{v === "전체" ? (total ? `전체 (${total})` : "전체") : `${v} (${c})`}</option>;
          })}
        </select>
        {hasFilter && <button onClick={() => { onAreaUnitsReset(); onMoveInChange("전체"); }} aria-label="면적/세대/입주 초기화" style={resetBtn(30)}><IconClose size={12} /></button>}
      </div>
    </div>
  );
});
