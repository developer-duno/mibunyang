import { memo } from "react";
import { C } from "@/theme";

export const ExpertUnitPlaceholder = memo(function ExpertUnitPlaceholder({ apt }) {
  const unsoldRate = apt.units > 0 ? (apt.unsold / apt.units * 100).toFixed(1) : "0";
  return (
    <div style={{ background: C.card, borderRadius: 8, border: `1px solid ${C.border}`, padding: 16, marginBottom: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: C.purple, marginBottom: 10, borderBottom: `2px solid ${C.purple}`, paddingBottom: 6 }}>동/호수 현황</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
        <div style={{ textAlign: "center", padding: 10, background: C.bg, borderRadius: 6 }}>
          <div style={{ fontSize: 11, color: C.muted }}>총 세대</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>{(apt.units ?? 0).toLocaleString("ko-KR")}</div>
        </div>
        <div style={{ textAlign: "center", padding: 10, background: C.redLight, borderRadius: 6 }}>
          <div style={{ fontSize: 11, color: C.muted }}>미분양</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.red }}>{(apt.unsold ?? 0).toLocaleString("ko-KR")}</div>
        </div>
        <div style={{ textAlign: "center", padding: 10, background: C.amberLight, borderRadius: 6 }}>
          <div style={{ fontSize: 11, color: C.muted }}>미분양률</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.amber }}>{unsoldRate}%</div>
        </div>
      </div>
      <div style={{ padding: 12, background: C.bg, borderRadius: 6, textAlign: "center" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 4 }}>동/호수 상세 데이터 미등록</div>
        <div style={{ fontSize: 11, color: C.muted }}>향후 관리자 페이지에서 동별/호수별 미분양 현황을 입력하면 여기에 표시됩니다.</div>
        <div style={{ marginTop: 8, fontSize: 10, color: C.muted, fontStyle: "italic" }}>예시: 101동 1201호 (84㎡, 12층, 남향) — 미분양</div>
      </div>
    </div>
  );
});
