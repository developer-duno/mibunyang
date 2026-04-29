import { useState, useCallback, useMemo, memo } from "react";
import { C, F } from "@/theme";
import { PROFILES } from "@/constants/profiles";
import { WeightTable } from "./WeightTable";
import { ScoreBreakdownPreview } from "./ScoreBreakdownPreview";

const CAT_KEYS = ["location", "product", "price", "risk", "benefit", "future"];

const WE_S = {
  container: { marginBottom: 24 },
  title: { fontSize: F.lg, fontWeight: 800, color: C.text, marginBottom: 12 },
  tabRow: { display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" },
  tabBadge: { position: "absolute", top: -3, right: -3, width: 7, height: 7, borderRadius: "50%", background: C.amber },
  tabButtonBase: { padding: "6px 14px", fontSize: F.sm, borderRadius: 6, cursor: "pointer", transition: "all .15s", position: "relative" },
  validationBase: { marginTop: 8, fontSize: F.xs, fontWeight: 600, padding: "6px 12px", borderRadius: 6 },
};

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

  return (
    <div style={WE_S.container}>
      <div style={WE_S.title}>가중치 관리</div>

      {/* Profile tabs */}
      <div style={WE_S.tabRow}>
        {Object.entries(PROFILES).map(([pKey, p]) => {
          const active = profile === pKey;
          const isCustom = !!customWeights[pKey];
          return (
            <button key={pKey} onClick={() => setProfile(pKey)} style={{
              ...WE_S.tabButtonBase,
              fontWeight: active ? 700 : 500,
              background: active ? C.indigoLight : C.white,
              color: active ? C.indigo : C.muted,
              border: active ? `1.5px solid ${C.indigo}` : `1px solid ${C.border}`,
            }}>
              {p.name}
              {isCustom && <span style={WE_S.tabBadge} />}
            </button>
          );
        })}
      </div>

      <WeightTable
        profile={profile}
        customWeights={customWeights}
        editingProfile={editingProfile}
        draft={draft}
        sum={sum}
        onChange={handleChange}
        onStartEdit={startEdit}
        onCancelEdit={cancelEdit}
        onSave={handleSave}
        onReset={handleReset}
      />

      {/* Sum validation message */}
      {editingProfile && (
        <div style={{
          ...WE_S.validationBase,
          background: sum === 100 ? C.greenLight : C.redLight,
          color: sum === 100 ? C.green : C.red,
        }}>
          합계: {sum}% {sum === 100 ? "— 저장 가능" : `— 100%가 되어야 합니다 (${sum > 100 ? `${sum - 100}% 초과` : `${100 - sum}% 부족`})`}
        </div>
      )}

      <ScoreBreakdownPreview topApts={topApts} previewAptIdx={previewAptIdx} setPreviewAptIdx={setPreviewAptIdx} />
    </div>
  );
});
