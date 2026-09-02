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
  // units가 총세대수가 아니라 그 회차 공급 세대수인 자리(청약홈 계열)면 재계산이 100%를
  // 넘을 수 있다(예: 총세대수 15·미분양 47 → 313%). VIEW·API·수집기가 이미 지키는
  // ">100 → 무효" 경계(세션445)를 여기서도 지켜 "미분양 313%" 같은 거짓 수치를 막는다.
  const recalculated = units > 0 && unsold != null ? (unsold / units) * 100 : null;
  // 그 회차 공급분이 units 에 들어온 자리에서는 이 숫자가 "총 세대"가 아니다. 판정 기준은
  // 화면 표(`FIELD_META.units.fmt`)와 **같아야** 한다 — 한 모달 안에서 표는 "정보 없음",
  // 관리자 카드는 "15" 라고 서로 다른 말을 하면 안 된다(세션538 적대검증 high).
  const unitsUnknown = !(units > 1) || (unsold != null && unsold > units);
  // 세션539 E-2: 예전엔 unsoldRate 가 unitsUnknown 과 다른 문턱(apt.unsoldRate 유무만)으로
  // 갈려서, units=1·unsold=1 인 무순위 회차(collect-applyhome-seed.mjs:118-132 가 실제로
  // 만드는 상태, molit-units.mjs:48-52 가 이걸 ".or(units.lte.1,...)" 로 보정 대상 삼는다)에서
  // "총 세대 —"와 "미분양률 100.0%"가 나란히 뜨는 자기모순이 났다(세션538 적대검증 high).
  // "총 세대를 모른다"고 한 자리에서 그 값으로 만든 비율(unsold_rate 도 결국 units 기반)만
  // 믿을 수 있다고 보여줄 이유가 없다 — 같은 게이트를 탄다.
  const unsoldRate = unitsUnknown
    ? null
    : apt.unsoldRate != null
      ? Number(apt.unsoldRate).toFixed(1)
      : recalculated != null && recalculated <= 100
        ? recalculated.toFixed(1)
        : null;
  const { units: unitRows } = usePresaleDetail(apt.id);
  return (
    <div
      data-testid="admin-unit-supply"
      style={{ background: C.card, borderRadius: 8, border: `1px solid ${C.border}`, padding: 16, marginBottom: 12 }}
    >
      <div
        style={{
          fontSize: F.base,
          fontWeight: 800,
          color: C.purple,
          marginBottom: 10,
          borderBottom: `2px solid ${C.purple}`,
          paddingBottom: 6,
        }}
      >
        동/호수 현황 (관리자)
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
        <div style={{ textAlign: "center", padding: 10, background: C.bg, borderRadius: 6 }}>
          <div style={{ fontSize: F.xs, color: C.muted }}>총 세대</div>
          <div style={{ fontSize: F.lg, fontWeight: 800, color: C.text }}>
            {unitsUnknown ? "—" : units.toLocaleString("ko-KR")}
          </div>
        </div>
        <div style={{ textAlign: "center", padding: 10, background: C.redLight, borderRadius: 6 }}>
          <div style={{ fontSize: F.xs, color: C.muted }}>미분양</div>
          <div style={{ fontSize: F.lg, fontWeight: 800, color: C.red }}>
            {unsold != null ? unsold.toLocaleString("ko-KR") : "—"}
          </div>
        </div>
        <div style={{ textAlign: "center", padding: 10, background: C.amberLight, borderRadius: 6 }}>
          <div style={{ fontSize: F.xs, color: C.muted }}>미분양률</div>
          <div style={{ fontSize: F.lg, fontWeight: 800, color: C.amber }}>
            {unsoldRate != null ? `${unsoldRate}%` : "—"}
          </div>
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
                <div style={{ color: C.text, textAlign: "right", padding: "2px 0" }}>
                  {u.top_amount != null ? `${u.top_amount.toLocaleString("ko-KR")}만` : "—"}
                </div>
              </Fragment>
            ))}
          </div>
          <div style={{ marginTop: 6, fontSize: F.micro, color: C.muted }}>출처: 청약홈 분양정보 (한국부동산원)</div>
        </div>
      ) : (
        <div style={{ padding: 12, background: C.bg, borderRadius: 6, textAlign: "center" }}>
          <div style={{ fontSize: F.sm, fontWeight: 700, color: C.muted, marginBottom: 4 }}>
            동/호수 상세 데이터 미등록
          </div>
          <div style={{ fontSize: F.xs, color: C.muted }}>
            향후 관리자 페이지에서 동별/호수별 미분양 현황을 입력하면 여기에 표시됩니다.
          </div>
          <div style={{ marginTop: 8, fontSize: F.micro, color: C.muted, fontStyle: "italic" }}>
            예시: 101동 1201호 (84㎡, 12층, 남향) — 미분양
          </div>
        </div>
      )}
    </div>
  );
});
