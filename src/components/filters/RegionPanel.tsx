/**
 * 지역 필터 패널 — 시/도 + 구/군 select
 * SearchFilterBar 기존 1행 지역 select를 드롭다운 패널로 추출
 */
import { memo, type CSSProperties } from "react";
import { C, F } from "@/theme";
import { selectBase } from "./filterStyles";

type RegionPanelProps = {
  filterRegion: string;
  onRegionChange: (_v: string) => void;
  regionOptions: string[];
  filterGu: string;
  onGuChange: (_v: string) => void;
  guOptions: string[];
  filterOptionCounts?: {
    regionCounts?: Record<string, number>;
    guCounts?: Record<string, number>;
  };
};

const sel = (active: boolean, disabled: boolean) => ({
  ...selectBase, flex: 1, minWidth: 80, padding: "4px 20px 4px 8px", fontSize: F.sm, height: 36,
  fontWeight: active ? 700 : 500,
  border: active ? `1.5px solid ${C.indigo}` : `1px solid ${C.border}`,
  borderRadius: 6, background: disabled ? "#E2E8F0" : C.slate100,
  color: disabled ? "#94A3B8" : active ? C.indigo : C.slate600,
  cursor: disabled ? "default" : "pointer",
} as CSSProperties);

export const RegionPanel = memo(function RegionPanel({
  filterRegion, onRegionChange, regionOptions,
  filterGu, onGuChange, guOptions,
  filterOptionCounts,
}: RegionPanelProps) {
  const guDisabled = filterRegion === "전체" || guOptions.length <= 1;
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <select value={filterRegion} onChange={e => onRegionChange(e.target.value)} aria-label="시/도" style={sel(filterRegion !== "전체", false)}>
        {regionOptions.map((r: string) => {
          const c = filterOptionCounts?.regionCounts?.[r] ?? 0;
          return <option key={r} value={r} disabled={r !== "전체" && c === 0}>{r === "전체" ? "전체" : `${r} (${c})`}</option>;
        })}
      </select>
      <select
        value={filterRegion === "전체" ? "" : filterGu}
        onChange={e => onGuChange(e.target.value)}
        aria-label="구/군" disabled={guDisabled}
        style={sel(filterGu !== "전체", guDisabled)}
      >
        {filterRegion === "전체" && <option value="">구/군</option>}
        {guOptions.map((g: string) => {
          const c = filterOptionCounts?.guCounts?.[g] ?? 0;
          return <option key={g} value={g} disabled={g !== "전체" && c === 0}>{g === "전체" ? "전체" : `${g} (${c})`}</option>;
        })}
      </select>
    </div>
  );
});
