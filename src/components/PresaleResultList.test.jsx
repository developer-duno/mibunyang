// @ts-check
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PresaleResultList } from "./PresaleResultList";

/** @returns {any} */
function makeItem(/** @type {any} */ overrides = {}) {
  return {
    apt: {
      id: "r1",
      name: "결과단지",
      region: "대전",
      gu: "유성구",
      area: 84.9948,
      price: 41800,
      competitionRate: 8.58,
      competitionSupply: 50,
      competitionApplicants: 429,
      ...overrides,
    },
    res: { total: 70, cats: {} },
  };
}

describe("PresaleResultList", () => {
  it("행 렌더: 단지명·주소·전용면적(소수1)·분양가·경쟁률 + 잔여세대 캡션", () => {
    render(<PresaleResultList items={[makeItem()]} />);
    expect(screen.getByText("결과단지")).toBeInTheDocument();
    expect(screen.getByText(/대전 유성구 · 전용 85\.0㎡ · 분양가 4억 1,800만/)).toBeInTheDocument();
    expect(screen.getByText(/청약 경쟁률 8\.6:1/)).toBeInTheDocument();
    expect(screen.getByText(/공급 50세대 · 신청 429명/)).toBeInTheDocument();
    // 거짓 표시 가드: "1순위" 문구 금지 (데이터 = 잔여세대 경쟁률)
    expect(screen.queryByText(/1순위/)).toBeNull();
    expect(screen.getByText(/청약홈 잔여세대 경쟁률 기준/)).toBeInTheDocument();
  });

  it("미달(rate<1): '미달 |' prefix + 소수 2자리 (0.01:1)", () => {
    render(<PresaleResultList items={[makeItem({ id: "r2", competitionRate: 0.01 })]} />);
    expect(screen.getByText("미달 |")).toBeInTheDocument();
    expect(screen.getByText(/청약 경쟁률 0\.01:1/)).toBeInTheDocument();
  });

  it("정상 경쟁(rate>=1)은 미달 미표기", () => {
    render(<PresaleResultList items={[makeItem()]} />);
    expect(screen.queryByText(/미달/)).toBeNull();
  });

  it("gu null 가드 (세종)", () => {
    render(<PresaleResultList items={[makeItem({ id: "r3", region: "세종", gu: null })]} />);
    expect(screen.getByText(/세종\s+· 전용/)).toBeInTheDocument();
  });

  it("행 클릭 → onOpenDetail", () => {
    const onOpenDetail = vi.fn();
    render(<PresaleResultList items={[makeItem()]} onOpenDetail={onOpenDetail} />);
    fireEvent.click(screen.getByRole("button", { name: "결과단지 분양 결과 보기" }));
    expect(onOpenDetail).toHaveBeenCalledWith("r1");
  });

  it("30개 초과 시 더 보기 → 추가 렌더", () => {
    const items = Array.from({ length: 35 }, (_, i) => makeItem({ id: `r${i}`, name: `단지${i}` }));
    render(<PresaleResultList items={items} />);
    expect(screen.queryByText("단지34")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /더 보기/ }));
    expect(screen.getByText("단지34")).toBeInTheDocument();
  });

  it("빈 목록: 빈 상태 문구", () => {
    render(<PresaleResultList items={[]} />);
    expect(screen.getByText("해당 지역 분양 결과가 없습니다.")).toBeInTheDocument();
  });
});
