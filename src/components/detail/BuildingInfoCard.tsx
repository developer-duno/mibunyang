import { memo, useState } from "react";
import { C, F } from "@/theme";
import { FIELD_META } from "@/constants/fieldMeta";
import { dataValueColor } from "@/lib/dataSections";
import type { Apt } from "@/types/scoring";

/**
 * BuildingInfoCard — 종합 탭 "건물 정보" 전용 카드 (세션508 PR-3c C4).
 *
 * 필드 7개: `maxFloor`·`corridorType`·`heatFuel`·`primaryDirection`·`floorAreaRatio`·
 * `buildingCoverageRatio`·`layout`.
 *
 * ⚠️ `floors`(층수 범위 문자열, 예: "중층(6~15F)")는 이 카드에서 뺐다 — 한 번 채워지면
 * 갱신되지 않는데 `maxFloor`(숫자)는 월간으로 덮어써져서, 같은 카드 안에 "최고층 19층"과
 * "층수 범위 중층(6~15F)"이 나란히 뜨며 어긋나는 단지가 손님 모수 1,754곳 중 306곳(18.1%)
 * 이었다. 둘 다 결국 `maxFloor`에서 파생되는 값이라 원래도 중복이었다. 관리자 전수 표
 * (`AdminDataAudit` → `FieldTable`)에는 그대로 남는다 — `INTERNAL_ONLY_FIELDS`(`lib/tabExtraFields.ts`)
 * 로 옮겼을 뿐 `FIELD_META.floors`는 그대로다(완성도 계산 모수에서 빠지면 안 되므로 `hidden`은
 * 쓰지 않는다 — `fieldMeta.ts` 의 `naverNearbyAvg` 선례와 같은 이유).
 *
 * 채움률은 **모수와 측정일을 함께** 적는다 — 모집단 없는 비율은 검증도 인용도 못 한다
 * (`.claude/rules/collectors/external-file-duplicate-rows.md`). 2026-08-10 운영 API(n=1,646) 기준
 * 평균 81.5%(당시 8필드), 가장 낮은 건 `corridorType` 64.9% 이고 `layout` 은 68.9%로 두 번째다.
 * (초안에 있던 "평균 73%·layout 23.6%" 는 분자와 분모를 서로 다른 모수에서 가져온 값이라
 *  어느 출처로도 재현되지 않았다 — 세션508 적대검증에서 정정.)
 *
 * `heatFuel`·`primaryDirection` 은 종합 탭 "단지 기본정보" 격자(`lib/dataSections.ts`
 * OVERVIEW_SECTIONS)에서 뺀 자리 — 이 카드가 층수·구조·향까지 한데 모아 "이 건물이 어떻게
 * 생겼나"를 한 자리에서 답한다. 나머지 5필드는 옛 종합 탭 아코디언(서랍) 소속이었다 — 이
 * 카드가 그 서랍을 마저 0으로 만든다(플랜 §"착수 전 사장님 확인 1건" 표의 마지막 칸).
 *
 * ## layout — fmt 재사용 금지 (다른 6필드와 다르다)
 *
 * `FIELD_META.layout.fmt` 는 `${v} (${sc}점)` 로 **점수 엔진 원재료(LAYOUT_SCORE)를 문자열에
 * 그대로 박아** 내보낸다. 그런데 이 필드는 옛 종합 탭 서랍(`ExtraFieldsAccordion` → `FieldTable`)
 * 소속이었고 그 경로엔 로그인 분기가 없다. 즉 세션 503(2-B)으로 상세 게이트가 폐지된 뒤로는
 * **비로그인 손님이 이미 "4베이판상 (10점)"을 보고 있었다**(세션508 적대검증이 origin/main 의
 * 서랍 구성을 실행으로 재현해 확인). 그래서 이 카드는 "미래 위험 예방"이 아니라 **현존 누출을
 * 막는 수정**이다 — fmt 를 그대로 재사용했다면 누출을 더 눈에 띄는 자리로 옮기기만 했을 것이다.
 * → 점수 접미어 없는 별도 포맷을 쓴다(`fmtLayout`, `v || "미수집"`). 나머지 6필드는 기존
 * 원칙(TransportCard·BuilderCard 답습 — "센티널 문구는 fieldMeta 것을 그대로 재사용, 새로
 * 짓지 않는다")대로 `FIELD_META.fmt` 를 그대로 재사용한다.
 *
 * ## primaryDirection — 색 규칙 답습
 *
 * `lib/dataSections.ts dataValueColor` 의 남향 초록 / 북향 빨강 규칙을 그대로 쓴다
 * (AptCard 향 칩과 같은 어휘 — 새 규칙 0).
 *
 * 기본 접힘 — TransportCard·BuilderCard 패턴 답습.
 */
const FIELDS = [
  "maxFloor",
  "corridorType",
  "heatFuel",
  "primaryDirection",
  "floorAreaRatio",
  "buildingCoverageRatio",
  "layout",
] as const;

const BI_S: Record<string, import("react").CSSProperties> = {
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
  body: { marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px" },
  cell: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0" },
  label: { fontSize: F.xs, color: C.muted },
  value: { fontSize: F.xs, fontWeight: 600, color: C.text },
};

/** layout 전용 포맷 — FIELD_META.layout.fmt 는 점수(LAYOUT_SCORE)를 문자열에 박아 재사용 금지. */
function fmtLayout(v: unknown): string {
  return (v as string) || "미수집";
}

/** 필드 1행 — label/value 는 호출부가 리터럴 `apt.<field>` 로 넘긴다(회귀 가드가 소스를 grep 하기 때문). */
function Field({ field, label, value, color }: { field: string; label: string; value: string; color?: string }) {
  return (
    <div style={BI_S.cell} data-field={field}>
      <span style={BI_S.label}>{label}</span>
      <span style={{ ...BI_S.value, ...(color ? { color } : {}) }}>{value}</span>
    </div>
  );
}

export const BuildingInfoCard = memo(function BuildingInfoCard({ apt }: { apt: Apt }) {
  const [open, setOpen] = useState(false);
  const hasAny = FIELDS.some((f) => apt[f] != null);
  if (!hasAny) return null;

  return (
    <div style={BI_S.container}>
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
        style={BI_S.head}
      >
        <span style={BI_S.title}>건물 정보</span>
        <span aria-hidden style={{ ...BI_S.arrow, transform: open ? "rotate(180deg)" : "rotate(0)" }}>
          ▼
        </span>
      </div>
      {open && (
        <div style={BI_S.body}>
          <Field
            field="maxFloor"
            label={FIELD_META.maxFloor.label}
            value={FIELD_META.maxFloor.fmt(apt.maxFloor, apt)}
          />
          <Field
            field="corridorType"
            label={FIELD_META.corridorType.label}
            value={FIELD_META.corridorType.fmt(apt.corridorType, apt)}
          />
          <Field
            field="heatFuel"
            label={FIELD_META.heatFuel.label}
            value={FIELD_META.heatFuel.fmt(apt.heatFuel, apt)}
          />
          <Field
            field="primaryDirection"
            label={FIELD_META.primaryDirection.label}
            value={FIELD_META.primaryDirection.fmt(apt.primaryDirection, apt)}
            color={dataValueColor("primaryDirection", apt.primaryDirection)}
          />
          <Field
            field="floorAreaRatio"
            label={FIELD_META.floorAreaRatio.label}
            value={FIELD_META.floorAreaRatio.fmt(apt.floorAreaRatio, apt)}
          />
          <Field
            field="buildingCoverageRatio"
            label={FIELD_META.buildingCoverageRatio.label}
            value={FIELD_META.buildingCoverageRatio.fmt(apt.buildingCoverageRatio, apt)}
          />
          <Field field="layout" label={FIELD_META.layout.label} value={fmtLayout(apt.layout)} />
        </div>
      )}
    </div>
  );
});
