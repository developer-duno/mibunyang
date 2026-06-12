// @ts-check
// UpcomingCardList 단위 테스트 — D-day 로직 + null 가드
import { describe, it, expect } from "vitest";
import { computeDday } from "./UpcomingCardList";

describe("computeDday — 청약일 D-day 계산 (spec § 6-2)", () => {
  const today = new Date("2026-05-08T00:00:00");

  it("당일 청약 → '오늘 청약' (빨강)", () => {
    const r = computeDday("2026-05-08", today);
    expect(r?.label).toBe("오늘 청약");
  });

  it("D-3 (5/11 - 5/8) → 'D-3' (주황)", () => {
    const r = computeDday("2026-05-11", today);
    expect(r?.label).toBe("D-3");
  });

  it("D-7 (5/15 - 5/8) → 'D-7' (회색)", () => {
    const r = computeDday("2026-05-15", today);
    expect(r?.label).toBe("D-7");
  });

  it("D-30 → 'D-30' (회색, 1주 초과)", () => {
    const r = computeDday("2026-06-07", today);
    expect(r?.label).toBe("D-30");
  });

  it("D+1 (5/7 - 5/8 = 어제) → 'D+1'", () => {
    const r = computeDday("2026-05-07", today);
    expect(r?.label).toBe("D+1");
  });

  it("D+8 (1주 이상 지난 단지) → null (표시 X)", () => {
    const r = computeDday("2026-04-30", today);
    expect(r).toBeNull();
  });

  it("null 입력 → null", () => {
    expect(computeDday(null)).toBeNull();
  });

  it("비정형 텍스트 ('미정') → null", () => {
    expect(computeDday("미정", today)).toBeNull();
  });

  it("빈 문자열 → null", () => {
    expect(computeDday("", today)).toBeNull();
  });
});

// ── 세션 406: 카드 강조줄 render 테스트 (이 파일 최초 render — 주소/강조 2줄 분리 가드) ──
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { UpcomingCardList } from "./UpcomingCardList";

/** @returns {any} */
function makeUpcomingApt(/** @type {any} */ overrides = {}) {
  return {
    id: "u1", name: "강조테스트단지", region: "대전", gu: "유성구",
    presaleStage: "분양계획", presaleRecruitDate: "2026-07-01", presaleMinPrice: 41800,
    ...overrides,
  };
}

describe("UpcomingCard 강조줄 (호갱노노 답습 — 세션 406)", () => {
  it("모집일은 indigo 강조 + 분양가는 굵게, 주소줄 분리", () => {
    render(<UpcomingCardList items={[makeUpcomingApt()]} onSubscribe={vi.fn()} onOpenDetail={vi.fn()} isMobile={false} />);
    const recruit = screen.getByText(/2026\.07\.01 모집/);
    expect(recruit.style.color).toBe("rgb(67, 56, 202)"); // C.indigo #4338CA
    expect(recruit.style.fontWeight).toBe("700");
    expect(screen.getByText("4억 1,800만").style.fontWeight).toBe("700");
    expect(screen.getByText(/대전 유성구/)).toBeInTheDocument();
  });

  it("모집일 null → 강조줄에서 생략 (기존 ternary 패턴 보존)", () => {
    render(<UpcomingCardList items={[makeUpcomingApt({ presaleRecruitDate: null, presaleMinPrice: null })]} onSubscribe={vi.fn()} onOpenDetail={vi.fn()} isMobile={false} />);
    expect(screen.queryByText(/모집/)).toBeNull();
    expect(screen.getByText("분양가 미공개")).toBeInTheDocument();
  });
});
