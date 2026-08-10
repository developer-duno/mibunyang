import { memo, useState } from "react";
import { C, F } from "@/theme";
import { FIELD_META } from "@/constants/fieldMeta";
import type { Apt } from "@/types/scoring";

/**
 * BuilderCard — 분양 탭 "시공사" 전용 카드 (세션508 PR-3c C2).
 *
 * 필드 3개: `builder`·`builderCreditGrade`·`builderDebtRatio`. **`hugGuarantee` 는 뺐다**
 * (사장님 확정 — 수집률 0%, 세션 507 Q6 유지). `builder` 는 종합 탭 "단지 기본정보" 격자
 * (`lib/dataSections.ts` OVERVIEW_SECTIONS)에서 뺀 자리 — 신용등급·부채비율과 한 카드에
 * 모아 "이 시공사를 믿어도 되나"를 한 자리에서 답한다.
 *
 * ## builderCreditGrade — fmt 재사용 (새로 짓지 않는다)
 *
 * 라이브 실측: 등급 null 85.3% 중 **48.7%는 "해당없음"**(공기업·신탁·조합 — 신용등급
 * 개념 자체가 없다)이고 **36.5%는 진짜 미수집**(삼성물산·디엘이앤씨 등 대형사 포함).
 * `FIELD_META.builderCreditGrade.fmt` 가 이미 이 둘을 갈라 말한다 — 색만 새로 입히고
 * 문구는 그대로 재사용한다(v1 플랜이 센티널 문구를 새로 지으려다 오류난 것과 같은 함정).
 *
 * ## builderDebtRatio — fmt 를 못 쓰는 이유
 *
 * `FIELD_META.builderDebtRatio.fmt` 는 null 을 "—"로만 그려 폴백(`_fallbackBuilderDebt`)을
 * 못 가른다. `scoreRisk.ts:240` 이 이미 쓰는 판정("null 이거나 폴백이면 미수집")을
 * 그대로 이관한다(Track A 와 일관 — #368).
 */
const FIELDS = ["builder", "builderCreditGrade", "builderDebtRatio"] as const;

const BC_S: Record<string, import("react").CSSProperties> = {
  // TransportCard 의 TC_S.container 와 byte-identical (같은 탭 형제와 시각 일관)
  container: {
    background: C.bg,
    borderRadius: 10,
    padding: "10px 12px",
    marginBottom: 10,
    border: `1px solid ${C.border}`,
  },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, cursor: "pointer" },
  title: { fontSize: F.sm, fontWeight: 700, color: C.sub },
  arrow: { fontSize: F.sm, color: C.muted, transition: "transform .2s", display: "inline-block" },
  body: { marginTop: 8 },
  cell: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0" },
  label: { fontSize: F.xs, color: C.muted },
  value: { fontSize: F.xs, fontWeight: 600, color: C.text },
};

function Field({ field, label, value }: { field: string; label: string; value: string }) {
  return (
    <div style={BC_S.cell} data-field={field}>
      <span style={BC_S.label}>{label}</span>
      <span style={BC_S.value}>{value}</span>
    </div>
  );
}

export const BuilderCard = memo(function BuilderCard({ apt }: { apt: Apt }) {
  const [open, setOpen] = useState(false);
  const hasAny = FIELDS.some((f) => apt[f] != null);
  if (!hasAny) return null;

  // scoreRisk.ts:240 이 이미 쓰는 판정을 그대로 이관 — 우리 값이 없어 지역 평균 등으로
  // 채운 폴백 상태(_fallbackBuilderDebt)면 부채비율을 "미수집"으로 감춘다.
  const builderDebtRatio = apt.builderDebtRatio as number | null | undefined;
  const debtText = builderDebtRatio == null || apt._fallbackBuilderDebt ? "미수집" : `${builderDebtRatio}%`;

  return (
    <div style={BC_S.container}>
      <div
        onClick={() => setOpen((v) => !v)}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
        style={BC_S.head}
      >
        <span style={BC_S.title}>시공사 정보</span>
        <span aria-hidden style={{ ...BC_S.arrow, transform: open ? "rotate(180deg)" : "rotate(0)" }}>
          ▼
        </span>
      </div>
      {open && (
        <div style={BC_S.body}>
          <Field field="builder" label={FIELD_META.builder.label} value={FIELD_META.builder.fmt(apt.builder, apt)} />
          <Field
            field="builderCreditGrade"
            label={FIELD_META.builderCreditGrade.label}
            value={FIELD_META.builderCreditGrade.fmt(apt.builderCreditGrade, apt)}
          />
          <Field field="builderDebtRatio" label={FIELD_META.builderDebtRatio.label} value={debtText} />
        </div>
      )}
    </div>
  );
});
