import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ExtraFieldsAccordion } from "./ExtraFieldsAccordion";
import { extraCount, TAB_EXTRA_SECTIONS } from "@/lib/tabExtraFields";
import type * as TabExtra from "@/lib/tabExtraFields";
import type { Apt } from "@/types/scoring";

/**
 * 세션591 L6 — 입지 탭 서랍까지 해체돼 **다섯 탭 서랍이 전부 0** 이 됐다. 컴포넌트는 남아 있다
 * (다섯 탭이 그대로 그리고, 여분이 생기면 그때 버튼이 뜬다 — 필드가 조용히 사라지지 않게 하는 마지막 그물).
 * 그래서 동작 시험(접힘·제목 N·미수집 줄·빈 묶음·⚠ 설명)은 **지우지 않고**, 서랍 계산을 옛 입지 탭
 * 4필드 묶음으로 바꿔 끼운 주입 자료로 이어 간다. 실제 계산이 0 인지는 맨 아래 묶음이
 * `vi.importActual` 로 따로 본다.
 */
// vi.mock 은 파일 맨 위로 끌어올려지므로 주입 자료도 vi.hoisted 로 같이 올린다.
const { FIXTURE_SECTION } = vi.hoisted(() => ({
  FIXTURE_SECTION: {
    key: "미래",
    title: "미래가치",
    color: "#0891B2",
    fields: ["transitDev", "devDist", "cityDev", "industryDev"],
  },
}));

vi.mock("@/lib/tabExtraFields", async (importOriginal) => {
  const real = await importOriginal<typeof TabExtra>();
  const sections = { ...real.TAB_EXTRA_SECTIONS, "sec-location": [FIXTURE_SECTION] };
  return {
    ...real,
    TAB_EXTRA_SECTIONS: sections,
    extraCount: (tab: TabExtra.TabId) =>
      (sections[tab] ?? []).reduce((n: number, s: { fields: string[] }) => n + s.fields.length, 0),
  };
});

function apt(over: Record<string, unknown> = {}): Apt {
  // transitDev 하나만 채워 "일부만 비면 미수집으로 남긴다" 시험이 EmptySectionLine(통째로 빈 묶음) 대신
  // FieldTable(부분 채움)을 타게 한다.
  return { parkingRatio: 1.4, floorAreaRatio: 220, discountPct: 5, transitDev: "GTX-A", ...over } as unknown as Apt;
}

/** 모든 여분 필드에 값이 있는 단지 — "제목 N = 그려진 줄 수" 검사용 */
function fullApt(): Apt {
  const o: Record<string, unknown> = {};
  for (const t of ["sec-overview", "sec-price", "sec-location", "sec-presale", "sec-finance"] as const)
    for (const s of TAB_EXTRA_SECTIONS[t]) for (const f of s.fields) o[f] = 1;
  return o as unknown as Apt;
}

describe("ExtraFieldsAccordion — 기본은 접혀 있다 (주입 자료)", () => {
  it("처음엔 표가 안 보이고 제목만 보인다 (손님을 숫자로 덮지 않는다)", () => {
    render(<ExtraFieldsAccordion apt={apt()} tab="sec-location" />);
    expect(screen.getByRole("button", { name: /아직 안 보여드린 자료/ })).toBeInTheDocument();
    expect(screen.queryByTestId("extra-fields-sec-location")).toBeNull();
  });

  it("누르면 펼쳐지고 다시 누르면 접힌다", () => {
    render(<ExtraFieldsAccordion apt={apt()} tab="sec-location" />);
    const btn = screen.getByRole("button", { name: /아직 안 보여드린 자료/ });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("extra-fields-sec-location")).toBeInTheDocument();
    fireEvent.click(btn);
    expect(screen.queryByTestId("extra-fields-sec-location")).toBeNull();
  });
});

describe("ExtraFieldsAccordion — 제목의 숫자가 실제 줄 수와 같다", () => {
  it("주입 묶음 — 제목 N = 펼쳤을 때 실제로 그려진 줄 수", () => {
    const { container } = render(<ExtraFieldsAccordion apt={fullApt()} tab="sec-location" />);
    const btn = screen.getByRole("button", { name: /아직 안 보여드린 자료/ });
    expect(btn.textContent).toContain(`${extraCount("sec-location")}개`);
    fireEvent.click(btn);
    // ⚠️ `TAB_EXTRA_SECTIONS` 길이와 비교하면 같은 계산을 양쪽에서 하는 셈이라 아무것도 못 잡는다.
    //    실제 DOM 에 그려진 줄(`data-field`)을 센다.
    const drawn = container.querySelectorAll("[data-field]").length;
    expect(drawn, "제목 숫자와 실제 그려진 줄 수가 어긋나면 손님이 속는다").toBe(4);
  });

  it.each(["sec-price", "sec-presale", "sec-overview", "sec-finance"] as const)(
    "%s — 여분 0(실제 계산) → null 을 반환한다",
    (tab) => {
      expect(extraCount(tab), `${tab} 여분이 되살아났다`).toBe(0);
      const { container } = render(<ExtraFieldsAccordion apt={fullApt()} tab={tab} />);
      expect(container.firstChild).toBeNull();
    }
  );
});

describe("ExtraFieldsAccordion — 값이 없어도 줄을 지우지 않는다 (주입 자료)", () => {
  it("일부만 비면 '미수집'으로 줄을 남긴다 (무엇이 없는지가 정보다)", () => {
    render(<ExtraFieldsAccordion apt={apt()} tab="sec-location" />);
    fireEvent.click(screen.getByRole("button", { name: /아직 안 보여드린 자료/ }));
    expect(screen.getAllByText(/미수집|—/).length).toBeGreaterThan(0);
  });

  it("한 묶음이 통째로 비면 빈 줄 여러 개 대신 한 줄로 접는다", () => {
    const { container } = render(<ExtraFieldsAccordion apt={{} as Apt} tab="sec-location" />);
    fireEvent.click(screen.getByRole("button", { name: /아직 안 보여드린 자료/ }));
    expect(screen.getByText(/한 건도 못 모았어요/)).toBeInTheDocument();
    expect(container.querySelectorAll("[data-field]").length, "빈 줄을 늘어놓지 않는다").toBe(0);
  });

  it("추정값 표시(⚠)가 무슨 뜻인지 설명한다", () => {
    render(<ExtraFieldsAccordion apt={apt()} tab="sec-location" />);
    fireEvent.click(screen.getByRole("button", { name: /아직 안 보여드린 자료/ }));
    expect(screen.getByText(/지역 평균으로 채운/)).toBeInTheDocument();
  });
});

describe("ExtraFieldsAccordion — 빈 탭에는 아예 안 뜬다", () => {
  it("여분이 0인 탭이면 버튼 자체가 없다", () => {
    const { container } = render(
      <ExtraFieldsAccordion apt={apt()} tab={"sec-nonexistent" as unknown as "sec-overview"} />
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("실제 서랍 계산 — 입지 탭도 0 (세션591 L6)", () => {
  it("주입 없이 계산하면 입지 탭 서랍은 비어 있다 — 옛 4필드는 거리 점 그림이 그린다", async () => {
    const real = await vi.importActual<typeof TabExtra>("@/lib/tabExtraFields");
    expect(real.extraCount("sec-location")).toBe(0);
    expect(real.TAB_EXTRA_SECTIONS["sec-location"]).toEqual([]);
  });
});
