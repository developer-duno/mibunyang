import { useState, useCallback, useMemo, memo } from "react";
import { C, F, catCol, catBg } from "@/theme";
import { PROFILES } from "@/constants/profiles";

const CAT_LABELS = { location: "입지", product: "상품", price: "가격", risk: "안전", benefit: "혜택", future: "미래" };
const CAT_KEYS = ["location", "product", "price", "risk", "benefit", "future"];

export default memo(function WeightEditor({ profile, setProfile, customWeights, saveCustomWeights, scored, showToast = () => {} }) {
  const [editingProfile, setEditingProfile] = useState(null);
  const [draft, setDraft] = useState({});
  const [previewAptIdx, setPreviewAptIdx] = useState(0);

  const startEdit = useCallback((pKey) => {
    const current = customWeights[pKey] ?? PROFILES[pKey].w;
    setDraft({ ...current });
    setEditingProfile(pKey);
  }, [customWeights]);

  const cancelEdit = useCallback(() => { setEditingProfile(null); setDraft({}); }, []);

  const handleChange = useCallback((catKey, val) => {
    const n = val === "" ? 0 : parseInt(val, 10);
    if (isNaN(n) || n < 0 || n > 100) return;
    setDraft(prev => ({ ...prev, [catKey]: n }));
  }, []);

  const sum = CAT_KEYS.reduce((s, k) => s + (draft[k] ?? 0), 0);

  const handleSave = useCallback(() => {
    if (sum !== 100) return;
    const next = { ...customWeights, [editingProfile]: { ...draft } };
    saveCustomWeights(next);
    setEditingProfile(null);
    setDraft({});
    showToast("가중치가 저장되었습니다");
  }, [sum, editingProfile, draft, customWeights, saveCustomWeights, showToast]);

  const handleReset = useCallback((pKey) => {
    const next = { ...customWeights };
    delete next[pKey];
    saveCustomWeights(next);
    if (editingProfile === pKey) { setEditingProfile(null); setDraft({}); }
    showToast("프로필이 초기화되었습니다");
  }, [customWeights, saveCustomWeights, editingProfile, showToast]);

  // Top 5 apartments for score breakdown preview
  const topApts = useMemo(() => (scored || []).slice(0, 5), [scored]);
  const previewItem = topApts[previewAptIdx] || topApts[0];

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: F.lg, fontWeight: 800, color: C.text, marginBottom: 12 }}>가중치 관리</div>

      {/* Profile tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {Object.entries(PROFILES).map(([pKey, p]) => {
          const active = profile === pKey;
          const isCustom = !!customWeights[pKey];
          return (
            <button key={pKey} onClick={() => setProfile(pKey)} style={{
              padding: "6px 14px", fontSize: F.sm, fontWeight: active ? 700 : 500,
              background: active ? C.indigoLight : C.white, color: active ? C.indigo : C.muted,
              border: active ? `1.5px solid ${C.indigo}` : `1px solid ${C.border}`,
              borderRadius: 6, cursor: "pointer", transition: "all .15s", position: "relative"
            }}>
              {p.name}
              {isCustom && <span style={{ position: "absolute", top: -3, right: -3, width: 7, height: 7, borderRadius: "50%", background: C.amber }} />}
            </button>
          );
        })}
      </div>

      {/* Weight table for all profiles */}
      <div style={{ background: C.card, borderRadius: 10, border: `1px solid ${C.border}`, overflow: "hidden" }}>
        {/* Header */}
        <div style={{ display: "grid", gridTemplateColumns: "80px repeat(6, 1fr) 120px", gap: 0, background: C.slate100, padding: "8px 12px" }}>
          <div style={{ fontSize: F.xs, fontWeight: 700, color: C.muted }}>프로필</div>
          {CAT_KEYS.map(k => (
            <div key={k} style={{ fontSize: F.xs, fontWeight: 700, color: catCol[k], textAlign: "center" }}>{CAT_LABELS[k]}</div>
          ))}
          <div style={{ fontSize: F.xs, fontWeight: 700, color: C.muted, textAlign: "center" }}>작업</div>
        </div>

        {/* Rows */}
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
                      onChange={e => handleChange(k, e.target.value)}
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
                    <button onClick={handleSave} disabled={sum !== 100} style={{
                      fontSize: F.xs, fontWeight: 700, padding: "4px 10px", borderRadius: 4, cursor: sum === 100 ? "pointer" : "default",
                      background: sum === 100 ? C.green : C.slate100, color: sum === 100 ? C.white : C.muted,
                      border: "none", opacity: sum === 100 ? 1 : 0.5
                    }}>저장</button>
                    <button onClick={cancelEdit} style={{
                      fontSize: F.xs, fontWeight: 600, padding: "4px 8px", borderRadius: 4, cursor: "pointer",
                      background: C.white, color: C.muted, border: `1px solid ${C.border}`
                    }}>취소</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => startEdit(pKey)} style={{
                      fontSize: F.xs, fontWeight: 700, padding: "4px 10px", borderRadius: 4, cursor: "pointer",
                      background: C.indigoLight, color: C.indigo, border: `1px solid ${C.indigo}`
                    }}>편집</button>
                    {isCustom && (
                      <button onClick={() => handleReset(pKey)} style={{
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

      {/* Sum validation message */}
      {editingProfile && (
        <div style={{
          marginTop: 8, fontSize: F.xs, fontWeight: 600, padding: "6px 12px", borderRadius: 6,
          background: sum === 100 ? C.greenLight : C.redLight,
          color: sum === 100 ? C.green : C.red
        }}>
          합계: {sum}% {sum === 100 ? "— 저장 가능" : `— 100%가 되어야 합니다 (${sum > 100 ? `${sum - 100}% 초과` : `${100 - sum}% 부족`})`}
        </div>
      )}

      {/* Score Breakdown Preview */}
      {previewItem && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontSize: F.base, fontWeight: 700, color: C.text }}>가중치 산출 내역 미리보기</div>
            <div style={{ display: "flex", gap: 4 }}>
              {topApts.map((item, i) => (
                <button key={item.apt.id} onClick={() => setPreviewAptIdx(i)} style={{
                  padding: "3px 8px", fontSize: F.micro, fontWeight: previewAptIdx === i ? 700 : 500, borderRadius: 4, cursor: "pointer",
                  background: previewAptIdx === i ? C.indigoLight : C.white,
                  color: previewAptIdx === i ? C.indigo : C.muted,
                  border: previewAptIdx === i ? `1px solid ${C.indigo}` : `1px solid ${C.border}`,
                  maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
                }}>{item.apt.name}</button>
              ))}
            </div>
          </div>

          <div style={{ background: C.card, borderRadius: 10, border: `1px solid ${C.border}`, padding: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: F.base, fontWeight: 800, color: C.text }}>{previewItem.apt.name}</span>
              <span style={{ fontSize: F.xxl, fontWeight: 900, color: C.indigo }}>{previewItem.res.total}점</span>
            </div>

            {/* Breakdown bars */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {Object.entries(previewItem.res.cats).map(([k, c]) => {
                const w = previewItem.res.weights[k] ?? 0;
                const contribution = Math.round(c.total * w / 100);
                return (
                  <div key={k} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: F.xs, fontWeight: 700, color: catCol[k], minWidth: 32 }}>{CAT_LABELS[k] || k}</span>
                    <div style={{ flex: 1, height: 20, background: C.slate100, borderRadius: 4, position: "relative", overflow: "hidden" }}>
                      <div style={{
                        width: `${Math.min(contribution * 2, 100)}%`, height: "100%", background: catBg[k], borderRadius: 4,
                        transition: "width .3s", opacity: w === 0 ? 0.3 : 1
                      }} />
                      <span style={{ position: "absolute", left: 6, top: 2, fontSize: F.micro, fontWeight: 700, color: catCol[k] }}>
                        {c.total}점
                      </span>
                    </div>
                    <span style={{ fontSize: F.xs, color: C.muted, minWidth: 20, textAlign: "right" }}>{w}%</span>
                    <span style={{ fontSize: F.xs, fontWeight: 700, color: catCol[k], minWidth: 24, textAlign: "right" }}>{contribution}</span>
                  </div>
                );
              })}
            </div>

            {/* Sub-scores detail */}
            <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 3 }}>
              {Object.entries(previewItem.res.cats).map(([k, c]) => {
                const w = previewItem.res.weights[k] ?? 0;
                return (
                  <span key={k} style={{ fontSize: F.xs, color: catCol[k], background: catBg[k], padding: "3px 8px", borderRadius: 4, fontWeight: 600 }}>
                    {CAT_LABELS[k] || k} {c.total}×{w}%={Math.round(c.total * w / 100)}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
