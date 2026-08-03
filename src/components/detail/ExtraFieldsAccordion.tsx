import { memo, useState } from "react";
import { C, F } from "@/theme";
import { FieldTable } from "./FieldTable";
import { TAB_EXTRA_SECTIONS, extraCount, type TabId } from "@/lib/tabExtraFields";
import type { Apt } from "@/types/scoring";

/**
 * "이 탭에서 아직 안 보여드린 자료 N개" — 접힌 아코디언.
 *
 * ## 왜 "전체 데이터"가 아닌가
 *
 * 이름이 곧 약속이다. "전체 데이터"라고 써 놓고 위 세부 섹션과 58% 겹치면
 * 손님은 같은 값을 두 번 읽는다. 여기 담기는 건 **차집합**이므로 이름도 그대로 부른다.
 * (계산 근거는 `lib/tabExtraFields.ts` 주석 참조)
 *
 * ## 기본 접힘인 이유
 *
 * 이 자료들은 "필요하면 파고들 수 있다"는 신뢰를 주는 게 목적이지,
 * 처음부터 펼쳐 손님을 숫자로 덮으려는 게 아니다.
 */

export const ExtraFieldsAccordion = memo(function ExtraFieldsAccordion({ apt, tab }: { apt: Apt; tab: TabId }) {
  const [open, setOpen] = useState(false);
  const sections = TAB_EXTRA_SECTIONS[tab] ?? [];
  const n = extraCount(tab);
  if (n === 0) return null;

  return (
    <div style={{ marginTop: 14 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          background: C.card,
          color: C.text,
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          padding: "10px 12px",
          fontSize: F.sm,
          fontWeight: 700,
          cursor: "pointer",
          minHeight: 44,
          textAlign: "left",
        }}
      >
        <span>이 탭에서 아직 안 보여드린 자료 {n}개</span>
        <span aria-hidden style={{ color: C.muted, fontSize: F.xs }}>
          {open ? "접기 ▲" : "펼치기 ▼"}
        </span>
      </button>
      {open && (
        <div data-testid={`extra-fields-${tab}`}>
          {sections.map((s) => (
            <FieldTable key={s.key} apt={apt} fields={s.fields} title={s.title} color={s.color} columns={2} />
          ))}
          <div style={{ fontSize: F.micro, color: C.muted, marginTop: 8, lineHeight: 1.5 }}>
            값이 없는 항목은 <i>미수집</i>으로 두고 줄을 지우지 않아요. 어떤 자료를 아직 못 모았는지도 정보이기
            때문이에요. <span style={{ color: C.amber }}>⚠</span> 가 붙은 값은 실제 조사값이 아니라 지역 평균으로 채운
            추정값이에요.
          </div>
        </div>
      )}
    </div>
  );
});
