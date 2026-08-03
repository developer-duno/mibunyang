import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ExtraFieldsAccordion } from "./ExtraFieldsAccordion";
import { extraCount } from "@/lib/tabExtraFields";
import type { Apt } from "@/types/scoring";

function apt(over: Record<string, unknown> = {}): Apt {
  return { parkingRatio: 1.4, floorAreaRatio: 220, discountPct: 5, ...over } as unknown as Apt;
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
  it.each(["sec-overview", "sec-price", "sec-location", "sec-presale", "sec-finance"] as const)(
    "%s — 제목 N = 펼쳤을 때 실제로 그려진 줄 수",
    (tab) => {
      const { container } = render(<ExtraFieldsAccordion apt={apt()} tab={tab} />);
      const btn = screen.getByRole("button", { name: /아직 안 보여드린 자료/ });
      expect(btn.textContent).toContain(`${extraCount(tab)}개`);
      fireEvent.click(btn);
      // ⚠️ `TAB_EXTRA_SECTIONS` 길이와 비교하면 같은 계산을 양쪽에서 하는 셈이라 아무것도 못 잡는다.
      //    실제 DOM 에 그려진 줄(`data-field`)을 센다.
      const drawn = container.querySelectorAll("[data-field]").length;
      expect(drawn, "제목 숫자와 실제 그려진 줄 수가 어긋나면 손님이 속는다").toBe(extraCount(tab));
    }
  );
});

describe("ExtraFieldsAccordion — 값이 없어도 줄을 지우지 않는다", () => {
  it("빈 단지도 '미수집'으로 줄을 채운다", () => {
    render(<ExtraFieldsAccordion apt={{} as Apt} tab="sec-overview" />);
    fireEvent.click(screen.getByRole("button", { name: /아직 안 보여드린 자료/ }));
    expect(screen.getAllByText(/미수집|—/).length).toBeGreaterThan(0);
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
