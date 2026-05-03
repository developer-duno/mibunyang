/**
 * 추천/프리셋 필터 패널 — 기본 + 커스텀 + 저장 input + 히스토리 select
 * SearchFilterBar 기존 인라인 추천 드롭다운(L146-220)에서 추출
 * 부모는 key={openPanel === "preset" ? "open" : "closed"} 으로 강제 unmount → showPresetInput 자연 초기화
 */
import { memo, useState, useCallback } from "react";
import { C, F } from "@/theme";
import { FILTER_PRESETS } from "@/constants/filterPresets";

type Preset = { name?: string; key?: string; label?: string; desc?: string; values?: Record<string, unknown>; filters?: Record<string, unknown>; [k: string]: unknown };
type HistoryItem = { name?: string; ts?: number; sig?: string; count?: number; filters?: Record<string, unknown>; [key: string]: unknown };

type PresetPanelProps = {
  customPresets?: Preset[];
  onApplyPreset: (_preset: Preset) => void;
  onSavePreset?: (_name: string) => void;
  onDeletePreset?: (_name: string) => void;
  filterHistory?: HistoryItem[];
  onApplyHistory?: (_h: HistoryItem) => void;
  onClearHistory?: () => void;
  activeFilterCount: number;
  closePanel: () => void;
  showToast?: (_msg: string) => void;
};

export const PresetPanel = memo(function PresetPanel({
  customPresets,
  onApplyPreset,
  onSavePreset,
  onDeletePreset,
  filterHistory,
  onApplyHistory,
  onClearHistory,
  activeFilterCount,
  closePanel,
  showToast = () => {},
}: PresetPanelProps) {
  const [showPresetInput, setShowPresetInput] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [historyKey, setHistoryKey] = useState(0);

  const handlePresetSave = useCallback(() => {
    if (presetName.trim() && onSavePreset) {
      onSavePreset(presetName);
      setPresetName("");
      setShowPresetInput(false);
      showToast("프리셋이 저장되었습니다");
    }
  }, [presetName, onSavePreset, showToast]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* 기본 프리셋 */}
      <div>
        <div style={{ fontSize: F.micro, color: C.muted, fontWeight: 600, marginBottom: 4 }}>추천 프리셋</div>
        <div style={{ display: "flex", gap: 3, flexWrap: "wrap" as const }}>
          {(FILTER_PRESETS as Preset[]).map((p: Preset) => (
            <button key={p.key as string} onClick={() => { onApplyPreset((p.values ?? p) as Preset); closePanel(); }} title={p.desc} style={{
              flex: "1 0 auto", fontSize: F.xs, fontWeight: 600, padding: "4px 8px", height: 30,
              background: C.indigoLight, color: C.indigo, border: `1px solid ${C.indigo}`,
              borderRadius: 5, cursor: "pointer", transition: "all .15s", whiteSpace: "nowrap" as const,
            }}>{p.label}</button>
          ))}
        </div>
      </div>
      {/* 커스텀 프리셋 */}
      {(customPresets?.length ?? 0) > 0 && customPresets && (
        <div>
          <div style={{ fontSize: F.micro, color: C.muted, fontWeight: 600, marginBottom: 4 }}>내 프리셋</div>
          <div style={{ display: "flex", gap: 3, flexWrap: "wrap" as const }}>
            {customPresets.map((p: Preset) => (
              <span key={p.key as string} style={{ display: "inline-flex", alignItems: "center", gap: 1 }}>
                <button onClick={() => { onApplyPreset((p.values ?? p) as Preset); closePanel(); }} title={p.desc} style={{
                  fontSize: F.xs, fontWeight: 600, padding: "4px 8px", height: 30,
                  background: C.greenLight, color: C.green, border: `1px solid ${C.green}`,
                  borderRadius: "5px 0 0 5px", cursor: "pointer", whiteSpace: "nowrap" as const,
                }}>{p.label}</button>
                <button onClick={() => { if (onDeletePreset) { onDeletePreset(p.key as string); showToast("프리셋이 삭제되었습니다"); } }} aria-label={`${p.label} 삭제`} style={{
                  fontSize: 9, padding: "4px 5px", height: 30, background: C.greenLight, color: C.green,
                  border: `1px solid ${C.green}`, borderLeft: "none", borderRadius: "0 5px 5px 0", cursor: "pointer",
                }}>✕</button>
              </span>
            ))}
          </div>
        </div>
      )}
      {/* 프리셋 저장 + 히스토리 */}
      <div style={{ display: "flex", gap: 3, alignItems: "center", flexWrap: "wrap" }}>
        {activeFilterCount > 0 && onSavePreset && (
          showPresetInput ? (
            <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
              <input type="text" value={presetName} onChange={e => setPresetName(e.target.value)}
                maxLength={12} placeholder="이름 (12자)" autoFocus
                onKeyDown={e => { if (e.key === "Enter") handlePresetSave(); if (e.key === "Escape") { setShowPresetInput(false); setPresetName(""); } }}
                style={{ width: 80, fontSize: F.micro, height: 28, padding: "2px 6px", border: `1px solid ${C.green}`, borderRadius: 4, outline: "none", background: C.greenLight }} />
              <button onClick={handlePresetSave} style={{ fontSize: F.micro, fontWeight: 600, padding: "3px 6px", height: 28, background: C.green, color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>저장</button>
              <button onClick={() => { setShowPresetInput(false); setPresetName(""); }} style={{ fontSize: F.micro, padding: "3px 4px", height: 28, background: C.slate100, color: C.muted, border: `1px solid ${C.border}`, borderRadius: 4, cursor: "pointer" }}>취소</button>
            </div>
          ) : (
            <button onClick={() => setShowPresetInput(true)} aria-label="현재 필터를 프리셋으로 저장" style={{
              fontSize: F.micro, fontWeight: 600, padding: "3px 8px", height: 28,
              background: C.greenLight, color: C.green, border: `1px solid ${C.green}`,
              borderRadius: 4, cursor: "pointer", whiteSpace: "nowrap",
            }}>+ 프리셋 저장</button>
          )
        )}
        {(filterHistory?.length ?? 0) > 0 && filterHistory && (
          <select key={historyKey} onChange={e => { const i = Number(e.target.value); if (filterHistory[i]) { onApplyHistory?.(filterHistory[i]); setHistoryKey(k => k + 1); closePanel(); } }} defaultValue="" aria-label="필터 히스토리" style={{
            WebkitAppearance: "none", MozAppearance: "none", appearance: "none",
            flex: 1, fontSize: F.micro, height: 28, padding: "2px 20px 2px 6px",
            border: `1px solid ${C.border}`, borderRadius: 4, background: C.slate100, color: C.slate600, cursor: "pointer",
          }}>
            <option value="" disabled>히스토리 ({(filterHistory ?? []).length})</option>
            {filterHistory.map((h: HistoryItem, i: number) => (
              <option key={h.sig ?? `h-${i}`} value={i}>필터 {h.count ?? 0}개 · {new Date(h.ts ?? Date.now()).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</option>
            ))}
          </select>
        )}
        {(filterHistory?.length ?? 0) > 0 && onClearHistory && (
          <button onClick={onClearHistory} aria-label="히스토리 삭제" style={{ background: C.slate100, border: `1px solid ${C.border}`, borderRadius: 4, padding: "0 6px", fontSize: 9, color: C.muted, cursor: "pointer", height: 28, display: "flex", alignItems: "center" }}>지우기</button>
        )}
      </div>
    </div>
  );
});
