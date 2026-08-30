import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { FieldTable } from "./FieldTable";
import { NO_DATA_TOKENS } from "@/constants/emptyText";
import { C } from "@/theme";
import type { Apt } from "@/types/scoring";

/** 값 칸(라벨 다음 span) — 색·기울임까지 봐야 "미수집 처리됐는지"를 안다. */
function valueEl(container: HTMLElement, field: string): HTMLElement {
  return container.querySelector(`[data-field="${field}"] span:nth-child(2)`) as HTMLElement;
}

function apt(overrides: Record<string, unknown> = {}): Apt {
  return overrides as unknown as Apt;
}

// A3 — 빈 값 판정을 공용 토큰(`NO_DATA_TOKENS`)으로 넓힌다.
// 옛 판정은 `val === "—" || val === "미수집"` 두 개뿐이라, fmt 가 "정보 없음"/"데이터 부재" 를
// 내는 필드가 검정 정체(normal)로 남아 손님이 "값이 있나?" 오해했다.
// ⚠️ 아래 첫 테스트가 **뮤테이션 대상**이다 — `NO_DATA_TOKENS` 에서 "정보 없음" 을 빼면 red.
//    (.claude/rules/meta/guards-must-be-mutation-tested.md — 행복 경로만 보면 껍데기가 남는다)
describe("FieldTable — 빈 값 회색 이탤릭 처리 (A3)", () => {
  // `units.fmt(null)` = "정보 없음" — 옛 두 토큰에는 없어 정체로 남던 자리.
  it("fmt 가 '정보 없음' 을 내는 필드(units=null)는 회색 이탤릭 = 미수집 처리", () => {
    const { container } = render(
      <FieldTable apt={apt({ units: null })} fields={["units"]} title="개요" color={C.text} />
    );
    const el = valueEl(container, "units");
    expect(el.textContent).toBe("정보 없음");
    // 회색 이탤릭 = 미수집 신호. jsdom 은 hex 를 rgb 로 정규화하므로 fontStyle(순수 문자열)로 잠근다.
    expect(el.style.fontStyle).toBe("italic");
    expect(el.style.color).toBe("rgb(107, 114, 128)"); // C.muted #6B7280
    // 뮤테이션 잠금 — 이 토큰이 목록에 실제로 있어야 이 테스트가 유효하다
    expect(NO_DATA_TOKENS as readonly string[]).toContain("정보 없음");
  });

  it("옛 토큰('—')도 그대로 미수집 처리 (회귀 제로)", () => {
    // unsold.fmt(null) = "—"
    const { container } = render(
      <FieldTable apt={apt({ unsold: null })} fields={["unsold"]} title="개요" color={C.text} />
    );
    const el = valueEl(container, "unsold");
    expect(el.textContent).toBe("—");
    expect(el.style.fontStyle).toBe("italic");
  });

  it("측정된 값은 미수집이 아니다 (raw 있음 → 정체 normal)", () => {
    // unsold=5 → "5세대"
    const { container } = render(
      <FieldTable apt={apt({ unsold: 5 })} fields={["unsold"]} title="개요" color={C.text} />
    );
    const el = valueEl(container, "unsold");
    expect(el.textContent).toContain("5");
    expect(el.style.fontStyle).toBe("normal");
  });

  it("측정된 0 은 미수집이 아니다 — raw==null 가드 (fmt 가 '—' 를 내도 정체)", () => {
    // unsold=0 → fmt 는 "—" 를 내지만 raw 가 0(!=null)이라 미수집이 아니다.
    const { container } = render(
      <FieldTable apt={apt({ unsold: 0 })} fields={["unsold"]} title="개요" color={C.text} />
    );
    const el = valueEl(container, "unsold");
    expect(el.textContent).toBe("—");
    expect(el.style.fontStyle).toBe("normal");
  });
});
