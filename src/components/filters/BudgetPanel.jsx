/**
 * 금액 필터 패널 — 예산 min~max 입력 + 프리셋(3/5/7/10억)
 * 프리셋은 항상 표시, 선택된 프리셋 하이라이트
 */
import { memo } from "react";
import { C, F } from "@/theme";
import { IconClose } from "@/components/icons";
import { numInput, tilde, resetBtn } from "./filterStyles";

const BUDGET_PRESETS = [3, 5, 7, 10];

export const BudgetPanel = memo(function BudgetPanel({
  budgetMin, onBudgetMinChange, budgetMax, onBudgetMaxChange, onBudgetReset,
}) {
  const hasBudget = budgetMin || budgetMax;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {/* 예산 입력 */}
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <input type="number" inputMode="decimal" min="0" step="0.1" value={budgetMin} onChange={e => onBudgetMinChange(e.target.value)} placeholder="최소(억)" aria-label="최소 예산(억)" style={numInput(budgetMin)} />
        <span style={tilde}>~</span>
        <input type="number" inputMode="decimal" min="0" step="0.1" value={budgetMax} onChange={e => onBudgetMaxChange(e.target.value)} placeholder="최대(억)" aria-label="최대 예산(억)" style={numInput(budgetMax)} />
        <span style={tilde}>억</span>
        {hasBudget && <button onClick={onBudgetReset} aria-label="예산 초기화" style={resetBtn()}><IconClose size={12} /></button>}
      </div>
      {/* 예산 프리셋 — 항상 표시 */}
      <div style={{ display: "flex", gap: 3 }}>
        {BUDGET_PRESETS.map(v => {
          const selected = !budgetMin && budgetMax === String(v);
          return (
            <button key={v} onClick={() => { onBudgetMinChange(""); onBudgetMaxChange(String(v)); }}
              style={{
                flex: 1, fontSize: F.xs, fontWeight: selected ? 700 : 600, padding: "4px 0", height: 30,
                background: selected ? C.indigoLight : C.slate100,
                color: selected ? C.indigo : C.slate600,
                border: selected ? `1.5px solid ${C.indigo}` : `1px solid ${C.border}`,
                borderRadius: 5, cursor: "pointer", transition: "all .15s",
              }}
            >{v}억 이하</button>
          );
        })}
      </div>
    </div>
  );
});
