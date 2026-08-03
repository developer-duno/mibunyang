import { memo } from "react";
import { C, F } from "@/theme";
import { FIELD_META } from "@/constants/fieldMeta";
import { EmphasisBadge } from "@/components/primitives";
import type { Apt } from "@/types/scoring";

/**
 * 필드 목록 표 — 관리자 검수 표와 손님 아코디언이 **같은 코드**를 쓴다.
 *
 * 세션 408에 `AdminDataAudit` 안에 있던 `AdminFieldSection` 을 그대로 꺼낸 것이고,
 * 렌더 결과는 관리자 쪽에서 **한 픽셀도 바뀌지 않는다**(`columns` 기본값 2 = 기존 `1fr 1fr`).
 *
 * ## 표시 규칙 (구 ExpertFieldTable 부터 이어진 것)
 *
 * - `meta.hidden` 이거나 `exclude` 에 든 필드는 렌더 안 함
 * - 값이 없으면 `미수집` + 회색 이탤릭 — 행 자체를 지우지 않는다.
 *   행이 사라지면 손님은 "고장났나" 라고 느끼고, 관리자는 "수집 대상이 아닌가" 로 오해한다
 * - `meta.isDefault(raw)` 가 참이면 앰버색 + `⚠` — **추정값·기본값임을 숨기지 않는다**
 */

export type FieldTableProps = {
  apt: Apt;
  fields: readonly string[];
  title: string;
  color: string;
  /** 이미 다른 곳에서 보여준 필드 (중복 노출 차단) */
  exclude?: readonly string[];
  /** 프로필 상위 카테고리면 ★중점 배지 */
  emphasized?: boolean;
  /** 한 줄에 몇 칸 (기본 2 — 관리자 기존 레이아웃) */
  columns?: number;
};

type FieldMetaEntry = {
  label: string;
  hidden?: boolean;
  fmt?: (_v: unknown, _apt: unknown) => unknown;
  isDefault?: (_v: unknown) => boolean;
};

/** `exclude`·`hidden` 을 걸러낸 실제 렌더 대상 — 개수 표기와 렌더가 어긋나지 않게 공용화 */
export function visibleFields(fields: readonly string[], exclude?: readonly string[]): string[] {
  const meta = FIELD_META as Record<string, FieldMetaEntry | undefined>;
  return fields.filter((fk) => {
    const m = meta[fk];
    if (!m || m.hidden) return false;
    return !exclude?.includes(fk);
  });
}

export const FieldTable = memo(function FieldTable({
  apt,
  fields,
  title,
  color,
  exclude,
  emphasized = false,
  columns = 2,
}: FieldTableProps) {
  const meta = FIELD_META as Record<string, FieldMetaEntry | undefined>;
  const shown = visibleFields(fields, exclude);
  if (shown.length === 0) return null;

  return (
    <div style={{ background: C.card, borderRadius: 8, border: `1px solid ${C.border}`, padding: 12, marginTop: 10 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: F.base,
          fontWeight: 800,
          color,
          marginBottom: 8,
          borderBottom: `2px solid ${color}`,
          paddingBottom: 6,
        }}
      >
        <span>{title}</span>
        {emphasized && <EmphasisBadge color={color} />}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: "0 16px" }}>
        {shown.map((fk) => {
          const m = meta[fk] as FieldMetaEntry;
          const raw = apt[fk] ?? null;
          const val = m.fmt ? m.fmt(raw, apt) : (raw ?? "미수집");
          const isDef = m.isDefault && m.isDefault(raw);
          const isMissing = raw == null && (val === "—" || val === "미수집");
          return (
            <div
              key={fk}
              data-field={fk}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "6px 8px",
                borderBottom: `1px solid ${C.border}`,
                fontSize: F.sm,
              }}
            >
              <span style={{ color: C.muted, flexShrink: 0 }}>{m.label}</span>
              <span
                title={isDef ? "이 값은 기본값/추정값입니다" : undefined}
                style={{
                  fontWeight: 600,
                  color: isMissing ? C.muted : isDef ? C.amber : C.text,
                  textAlign: "right",
                  marginLeft: 8,
                  fontStyle: isMissing ? "italic" : "normal",
                }}
              >
                {String(val)}
                {isDef ? " ⚠" : ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
});
