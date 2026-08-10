import { memo, useState } from "react";
import { C, F } from "@/theme";
import { FIELD_META } from "@/constants/fieldMeta";
import type { Apt } from "@/types/scoring";

/**
 * TransportCard — 입지 탭 "교통 상세" 전용 카드 (세션508 PR-3b B1).
 *
 * `LOCATION_SECTIONS`(`lib/dataSections.ts`)의 "교통 상세" 격자를 폐기하고 여기로 승격했다.
 * 담는 건 그림(`charts/DistanceDots`)이 못 그리는 값뿐이다 — 역 이름·노선처럼 글자값,
 * IC·KTX 처럼 km 단위(그림 축은 m)라 못 올리는 값. 역까지 "거리"(subwayDist, m 단위)는
 * 여전히 그림 소관이라 여기 없다.
 *
 * ⚠️ 센티널 문구는 `FIELD_META` 의 fmt 를 그대로 호출한다 — 새로 짓지 않는다. v1 플랜은
 * "icDist/ktxDist 99=미수집"으로 잘못 지었다가 적대검증에서 정정됐다(플랜 §"v1 에서 틀렸던 것" #1).
 * 실제로는 99 이상이 "반경 밖"(측정은 했고 90km 넘게 멀다는 뜻)이고, null 만 fmt 가 "—"로 그린다.
 *
 * 기본 접힘 — 입지 판단의 1차 신호는 바로 위 `DistanceDots` 그림이 이미 준다.
 */
const FIELDS = ["subwayName", "subwayLines", "busRoutes", "busStopNames", "icDist", "ktxDist"] as const;

const TC_S: Record<string, import("react").CSSProperties> = {
  // DataSectionBlock 의 DSB_S.container 와 byte-identical (같은 탭 형제와 시각 일관)
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
  body: { marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px" },
  cell: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0" },
  label: { fontSize: F.xs, color: C.muted },
  value: { fontSize: F.xs, fontWeight: 600, color: C.text },
};

/** 필드 1행 — label/value 는 호출부가 리터럴 `apt.<field>` 로 넘긴다(회귀 가드가 소스를 grep 하기 때문). */
function Field({ field, label, value }: { field: string; label: string; value: string }) {
  return (
    <div style={TC_S.cell} data-field={field}>
      <span style={TC_S.label}>{label}</span>
      <span style={TC_S.value}>{value}</span>
    </div>
  );
}

export const TransportCard = memo(function TransportCard({ apt }: { apt: Apt }) {
  const [open, setOpen] = useState(false);
  const hasAny = FIELDS.some((f) => apt[f] != null);
  if (!hasAny) return null;

  return (
    <div style={TC_S.container}>
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
        style={TC_S.head}
      >
        <span style={TC_S.title}>교통 상세</span>
        <span aria-hidden style={{ ...TC_S.arrow, transform: open ? "rotate(180deg)" : "rotate(0)" }}>
          ▼
        </span>
      </div>
      {open && (
        <div style={TC_S.body}>
          <Field
            field="subwayName"
            label={FIELD_META.subwayName.label}
            value={FIELD_META.subwayName.fmt(apt.subwayName, apt)}
          />
          <Field
            field="subwayLines"
            label={FIELD_META.subwayLines.label}
            value={FIELD_META.subwayLines.fmt(apt.subwayLines, apt)}
          />
          <Field
            field="busRoutes"
            label={FIELD_META.busRoutes.label}
            value={FIELD_META.busRoutes.fmt(apt.busRoutes, apt)}
          />
          <Field
            field="busStopNames"
            label={FIELD_META.busStopNames.label}
            value={FIELD_META.busStopNames.fmt(apt.busStopNames, apt)}
          />
          <Field field="icDist" label={FIELD_META.icDist.label} value={FIELD_META.icDist.fmt(apt.icDist, apt)} />
          <Field field="ktxDist" label={FIELD_META.ktxDist.label} value={FIELD_META.ktxDist.fmt(apt.ktxDist, apt)} />
        </div>
      )}
    </div>
  );
});
