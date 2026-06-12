import { memo, Fragment } from "react";
import { C, F } from "@/theme";
import { usePresaleDetail } from "@/hooks/usePresaleDetail";
import type { Apt } from "@/types/scoring";

/**
 * AdminUnitSupply — 동/호수 현황 + 청약홈 평형별 공급 표 (관리자 전용, 세션 405 구 ExpertUnitPlaceholder 이식).
 * usePresaleDetail(apt.id).units 라이브 표(주택형·일반/특공·최고가)는 이 컴포넌트에만 존재
 * (PresaleInfo 는 schedule 만 사용 — 세션 405 누락 감사 #1). 로직 무변경 이식.
 */

// 면적(㎡) → 평 환산 표시 ("84.93㎡ · 25.7평")
function fmtArea(m2: number | null): string {
  if (m2 == null) return "—";
  return `${m2.toFixed(1)}㎡ · ${(m2 / 3.3058).toFixed(1)}평`;
}

type AdminUnitSupplyProps = { apt: Apt };

export const AdminUnitSupply = memo(function AdminUnitSupply({ apt }: AdminUnitSupplyProps) {
  const units = Number(apt.units ?? 0);
  const unsold = apt.unsold != null ? Number(apt.unsold) : null;
  const unsoldRate = apt.unsoldRate != null ? Number(apt.unsoldRate).toFixed(1) : (units > 0 && unsold != null ? (unsold / units * 100).toFixed(1) : null);
  const { units: unitRows } = usePresaleDetail(apt.id);
  return (
    <div data-testid="admin-unit-supply" style={{ background: C.card, borderRadius: 8, border: `1px solid ${C.border}`, padding: 16, marginBottom: 12 }}>
      <div style={{ fontSize: F.base, fontWeight: 800, color: C.purple, marginBottom: 10, borderBottom: `2px solid ${C.purple}`, paddingBottom: 6 }}>동/호수 현황 (관리자)</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
        <div style={{ textAlign: "center", padding: 10, background: C.bg, borderRadius: 6 }}>
          <div style={{ fontSize: F.xs, color: C.muted }}>총 세대</div>
          <div style={{ fontSize: F.lg, fontWeight: 800, color: C.text }}>{(apt.units ?? 0).toLocaleString("ko-KR")}</div>
        </div>
        <div style={{ textAlign: "center", padding: 10, background: C.redLight, borderRadius: 6 }}>
          <div style={{ fontSize: F.xs, color: C.muted }}>미분양</div>
          <div style={{ fontSize: F.lg, fontWeight: 800, color: C.red }}>{unsold != null ? unsold.toLocaleString("ko-KR") : "—"}</div>
        </div>
        <div style={{ textAlign: "center", padding: 10, background: C.amberLight, borderRadius: 6 }}>
          <div style={{ fontSize: F.xs, color: C.muted }}>미분양률</div>
          <div style={{ fontSize: F.lg, fontWeight: 800, color: C.amber }}>{unsoldRate != null ? `${unsoldRate}%` : "—"}</div>
        </div>
      </div>
      {unitRows.length > 0 ? (
        <div>
          <div style={{ fontSize: F.xs, fontWeight: 700, color: C.purple, marginBottom: 6 }}>
            청약홈 평형별 공급 ({unitRows.length}개 타입)
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr", gap: 4, fontSize: F.xs }}>
            <div style={{ fontWeight: 700, color: C.muted, padding: "2px 0" }}>주택형</div>
            <div style={{ fontWeight: 700, color: C.muted, textAlign: "right", padding: "2px 0" }}>일반</div>
            <div style={{ fontWeight: 700, color: C.muted, textAlign: "right", padding: "2px 0" }}>특공</div>
            <div style={{ fontWeight: 700, color: C.muted, textAlign: "right", padding: "2px 0" }}>최고가</div>
            {unitRows.map((u, i) => (
              <Fragment key={i}>
                <div style={{ color: C.text, padding: "2px 0" }}>{fmtArea(u.supply_area)}</div>
                <div style={{ color: C.text, textAlign: "right", padding: "2px 0" }}>{u.general_supply ?? 0}</div>
                <div style={{ color: C.text, textAlign: "right", padding: "2px 0" }}>{u.special_supply ?? 0}</div>
                <div style={{ color: C.text, textAlign: "right", padding: "2px 0" }}>{u.top_amount != null ? `${u.top_amount.toLocaleString("ko-KR")}만` : "—"}</div>
              </Fragment>
            ))}
          </div>
          <div style={{ marginTop: 6, fontSize: F.micro, color: C.muted }}>출처: 청약홈 분양정보 (한국부동산원)</div>
        </div>
      ) : (
        <div style={{ padding: 12, background: C.bg, borderRadius: 6, textAlign: "center" }}>
          <div style={{ fontSize: F.sm, fontWeight: 700, color: C.muted, marginBottom: 4 }}>동/호수 상세 데이터 미등록</div>
          <div style={{ fontSize: F.xs, color: C.muted }}>향후 관리자 페이지에서 동별/호수별 미분양 현황을 입력하면 여기에 표시됩니다.</div>
          <div style={{ marginTop: 8, fontSize: F.micro, color: C.muted, fontStyle: "italic" }}>예시: 101동 1201호 (84㎡, 12층, 남향) — 미분양</div>
        </div>
      )}
    </div>
  );
});
