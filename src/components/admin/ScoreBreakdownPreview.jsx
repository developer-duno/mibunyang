import { memo } from "react";
import { C, F, catCol, catBg } from "@/theme";

const CAT_LABELS = { location: "입지", product: "상품", price: "가격", risk: "안전", benefit: "혜택", future: "미래" };

// 가중치 산출 내역 미리보기 — 상위 5 아파트 탭 + 6 카테고리 breakdown bar + sub-scores
// 부모 WeightEditor가 topApts/previewAptIdx 소유, 자식은 표시 + 콜백 위임
export const ScoreBreakdownPreview = memo(function ScoreBreakdownPreview({ topApts, previewAptIdx, setPreviewAptIdx }) {
  const previewItem = topApts[previewAptIdx] || topApts[0];
  if (!previewItem) return null;

  return (
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
  );
});
