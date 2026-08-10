import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ExtraFieldsAccordion } from "./ExtraFieldsAccordion";
import { extraCount, TAB_EXTRA_SECTIONS } from "@/lib/tabExtraFields";
import type { Apt } from "@/types/scoring";

function apt(over: Record<string, unknown> = {}): Apt {
  return { parkingRatio: 1.4, floorAreaRatio: 220, discountPct: 5, ...over } as unknown as Apt;
}

/** 모든 여분 필드에 값이 있는 단지 — "제목 N = 그려진 줄 수" 검사용 */
function fullApt(): Apt {
  const o: Record<string, unknown> = {};
  for (const t of ["sec-overview", "sec-price", "sec-location", "sec-presale", "sec-finance"] as const)
    for (const s of TAB_EXTRA_SECTIONS[t]) for (const f of s.fields) o[f] = 1;
  return o as unknown as Apt;
}

describe("ExtraFieldsAccordion — 기본은 접혀 있다", () => {
  it("처음엔 표가 안 보이고 제목만 보인다 (손님을 숫자로 덮지 않는다)", () => {
    render(<ExtraFieldsAccordion apt={apt()} tab="sec-overview" />);
    expect(screen.getByRole("button", { name: /아직 안 보여드린 자료/ })).toBeInTheDocument();
    expect(screen.queryByTestId("extra-fields-sec-overview")).toBeNull();
  });

  it("누르면 펼쳐지고 다시 누르면 접힌다", () => {
    render(<ExtraFieldsAccordion apt={apt()} tab="sec-overview" />);
    const btn = screen.getByRole("button", { name: /아직 안 보여드린 자료/ });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("extra-fields-sec-overview")).toBeInTheDocument();
    fireEvent.click(btn);
    expect(screen.queryByTestId("extra-fields-sec-overview")).toBeNull();
  });
});

describe("ExtraFieldsAccordion — 제목의 숫자가 실제 줄 수와 같다", () => {
  // sec-finance·sec-price 제외 — 세션 505 에 금융, 세션508 PR-3b B2 에 시세(naverSchoolWalkMin 이
  // 학군 카드로 승격)가 여분 0 이 돼 버튼 자체가 안 뜬다(빈 서랍은 안 만든다). sec-price 의 n=0
  // 케이스는 아래 별도 단언으로 확인한다.
  it.each(["sec-overview", "sec-location", "sec-presale"] as const)(
    "%s — 제목 N = 펼쳤을 때 실제로 그려진 줄 수",
    (tab) => {
      const { container } = render(<ExtraFieldsAccordion apt={fullApt()} tab={tab} />);
      const btn = screen.getByRole("button", { name: /아직 안 보여드린 자료/ });
      expect(btn.textContent).toContain(`${extraCount(tab)}개`);
      fireEvent.click(btn);
      // ⚠️ `TAB_EXTRA_SECTIONS` 길이와 비교하면 같은 계산을 양쪽에서 하는 셈이라 아무것도 못 잡는다.
      //    실제 DOM 에 그려진 줄(`data-field`)을 센다.
      const drawn = container.querySelectorAll("[data-field]").length;
      expect(drawn, "제목 숫자와 실제 그려진 줄 수가 어긋나면 손님이 속는다").toBe(extraCount(tab));
    }
  );

  // 세션508 PR-3b B2 — naverSchoolWalkMin 이 학군 카드로 승격되며 시세 탭 서랍도 실제로 비었다
  // (sec-finance 는 이미 세션 505 부터 0). n=0 이면 버튼 자체가 안 뜬다.
  it("sec-price — 여분 0(실제 탭, 가짜 tab id 아님) → null 을 반환한다", () => {
    expect(extraCount("sec-price"), "시세 탭 여분이 되살아났다").toBe(0);
    const { container } = render(<ExtraFieldsAccordion apt={fullApt()} tab="sec-price" />);
    expect(container.firstChild).toBeNull();
  });
});

describe("ExtraFieldsAccordion — 값이 없어도 줄을 지우지 않는다", () => {
  it("일부만 비면 '미수집'으로 줄을 남긴다 (무엇이 없는지가 정보다)", () => {
    render(<ExtraFieldsAccordion apt={apt()} tab="sec-overview" />);
    fireEvent.click(screen.getByRole("button", { name: /아직 안 보여드린 자료/ }));
    expect(screen.getAllByText(/미수집|—/).length).toBeGreaterThan(0);
  });

  it("한 묶음이 통째로 비면 빈 줄 여러 개 대신 한 줄로 접는다", () => {
    // ⚠️ 세션 505 전엔 금융 탭(혜택 9필드, 실측 0.0%)으로 검사했다. 그 9필드를 손님 화면에서
    //    빼면서 금융 탭 여분이 0 이 됐고 버튼 자체가 안 뜬다 — 그래서 다른 탭으로 옮겼다.
    //    값이 하나도 없는 단지(`{}`)면 어느 탭이든 이 분기를 탄다.
    const { container } = render(<ExtraFieldsAccordion apt={{} as Apt} tab="sec-location" />);
    fireEvent.click(screen.getByRole("button", { name: /아직 안 보여드린 자료/ }));
    expect(screen.getByText(/한 건도 못 모았어요/)).toBeInTheDocument();
    expect(container.querySelectorAll("[data-field]").length, "빈 줄을 늘어놓지 않는다").toBe(0);
  });

  it("추정값 표시(⚠)가 무슨 뜻인지 설명한다", () => {
    render(<ExtraFieldsAccordion apt={apt()} tab="sec-overview" />);
    fireEvent.click(screen.getByRole("button", { name: /아직 안 보여드린 자료/ }));
    expect(screen.getByText(/지역 평균으로 채운/)).toBeInTheDocument();
  });
});

describe("ExtraFieldsAccordion — 빈 탭에는 아예 안 뜬다", () => {
  it("여분이 0인 탭이면 버튼 자체가 없다", () => {
    // 점수 탭은 TabId 에 없어 애초에 못 넘긴다 → 타입으로 막히는 게 정답이지만,
    // 런타임에서도 빈 배열이면 null 을 돌려주는지 확인한다.
    const { container } = render(
      <ExtraFieldsAccordion apt={apt()} tab={"sec-nonexistent" as unknown as "sec-overview"} />
    );
    expect(container.firstChild).toBeNull();
  });
});
