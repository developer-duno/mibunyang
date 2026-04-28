import { memo } from "react";
import { C, F, catCol, catBg } from "@/theme";
import { PROFILES } from "@/constants/profiles";

const CAT_LABELS = { location: "입지", product: "상품", price: "가격", risk: "안전", benefit: "혜택", future: "미래" };
const CAT_KEYS = ["location", "product", "price", "risk", "benefit", "future"];

// 가중치 편집 행렬 — 5 프로필 × 6 카테고리 input/span + 편집/저장/취소/초기화 버튼
// 부모 WeightEditor가 state 소유, WeightTable은 표시 + 콜백 위임
export const WeightTable = memo(function WeightTable({
  profile, customWeights, editingProfile, draft, sum,
  onChange, onStartEdit, onCancelEdit, onSave, onReset,
}) {
  return (
    <div style={{ background: C.card, borderRadius: 10, border: `1px solid ${C.border}`, overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: "80px repeat(6, 1fr) 120px", gap: 0, background: C.slate100, padding: "8px 12px" }}>
        <div style={{ fontSize: F.xs, fontWeight: 700, color: C.muted }}>프로필</div>
        {CAT_KEYS.map(k => (
          <div key={k} style={{ fontSize: F.xs, fontWeight: 700, color: catCol[k], textAlign: "center" }}>{CAT_LABELS[k]}</div>
        ))}
        <div style={{ fontSize: F.xs, fontWeight: 700, color: C.muted, textAlign: "center" }}>작업</div>
      </div>

      {Object.entries(PROFILES).map(([pKey, p]) => {
        const isEditing = editingProfile === pKey;
        const w = customWeights[pKey] ?? p.w;
        const isCustom = !!customWeights[pKey];
        const isActive = profile === pKey;

        return (
          <div key={pKey} style={{
            display: "grid", gridTemplateColumns: "80px repeat(6, 1fr) 120px", gap: 0,
            padding: "10px 12px", borderTop: `1px solid ${C.border}`,
            background: isActive ? C.indigoLight + "40" : C.white
          }}>
            <div style={{ fontSize: F.sm, fontWeight: 700, color: C.text, display: "flex", alignItems: "center" }}>
              {p.name}
              {isCustom && <span style={{ fontSize: 9, color: C.amber, marginLeft: 4 }}>수정됨</span>}
            </div>

            {CAT_KEYS.map(k => (
              <div key={k} style={{ textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {isEditing ? (
                  <input
                    type="number"
                    min={0} max={100}
                    value={draft[k] ?? 0}
                    onChange={e => onChange(k, e.target.value)}
                    style={{
                      width: 44, textAlign: "center", fontSize: F.sm, fontWeight: 700,
                      padding: "4px 2px", border: `1.5px solid ${catCol[k]}`, borderRadius: 4,
                      color: catCol[k], background: catBg[k], outline: "none"
                    }}
                  />
                ) : (
                  <span style={{
                    fontSize: F.sm, fontWeight: 600, color: catCol[k],
                    background: catBg[k], padding: "3px 8px", borderRadius: 4, minWidth: 32
                  }}>{w[k]}</span>
                )}
              </div>
            ))}

            <div style={{ display: "flex", gap: 4, alignItems: "center", justifyContent: "center" }}>
              {isEditing ? (
                <>
                  <button onClick={onSave} disabled={sum !== 100} style={{
                    fontSize: F.xs, fontWeight: 700, padding: "4px 10px", borderRadius: 4, cursor: sum === 100 ? "pointer" : "default",
                    background: sum === 100 ? C.green : C.slate100, color: sum === 100 ? C.white : C.muted,
                    border: "none", opacity: sum === 100 ? 1 : 0.5
                  }}>저장</button>
                  <button onClick={onCancelEdit} style={{
                    fontSize: F.xs, fontWeight: 600, padding: "4px 8px", borderRadius: 4, cursor: "pointer",
                    background: C.white, color: C.muted, border: `1px solid ${C.border}`
                  }}>취소</button>
                </>
              ) : (
                <>
                  <button onClick={() => onStartEdit(pKey)} style={{
                    fontSize: F.xs, fontWeight: 700, padding: "4px 10px", borderRadius: 4, cursor: "pointer",
                    background: C.indigoLight, color: C.indigo, border: `1px solid ${C.indigo}`
                  }}>편집</button>
                  {isCustom && (
                    <button onClick={() => onReset(pKey)} style={{
                      fontSize: F.xs, fontWeight: 600, padding: "4px 8px", borderRadius: 4, cursor: "pointer",
                      background: C.white, color: C.muted, border: `1px solid ${C.border}`
                    }}>초기화</button>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
});
