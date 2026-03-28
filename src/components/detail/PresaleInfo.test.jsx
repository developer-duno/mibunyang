import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PresaleInfo } from "./PresaleInfo";
import { makeApt } from "@/__tests__/factories";

// analytics mock (trackEvent 호출 방지)
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

describe("PresaleInfo", () => {
  // presaleStage가 null이면 아무것도 렌더링하지 않음
  it("presaleStage가 null이면 null을 반환한다", () => {
    const apt = makeApt({ presaleStage: null });
    const { container } = render(<PresaleInfo apt={apt} />);
    expect(container.firstChild).toBeNull();
  });

  // presaleStage가 있으면 섹션 표시
  it("presaleStage가 있으면 네이버 분양정보를 표시한다", () => {
    const apt = makeApt({
      presaleStage: "분양중", presaleType: "민간분양",
      presaleMinPrice: 30000, presaleMaxPrice: 50000, presalePp: 2000,
    });
    render(<PresaleInfo apt={apt} />);
    expect(screen.getByText("네이버 분양정보")).toBeTruthy();
    expect(screen.getByText("분양중")).toBeTruthy();
  });

  // 가격 범위 표시
  it("분양가 범위를 올바르게 표시한다", () => {
    const apt = makeApt({
      presaleStage: "분양중", presaleMinPrice: 30000, presaleMaxPrice: 50000,
    });
    render(<PresaleInfo apt={apt} />);
    expect(screen.getByText("분양가 범위")).toBeTruthy();
  });

  // null 안전성: presaleStage만 있고 나머지 전부 null
  it("presaleStage만 있고 나머지 null이어도 크래시 없다", () => {
    const apt = makeApt({ presaleStage: "분양예정" });
    expect(() => render(<PresaleInfo apt={apt} />)).not.toThrow();
    expect(screen.getByText("분양예정")).toBeTruthy();
  });

  // 네이버 링크 표시
  it("naverPresaleNo + naverPresaleSeq가 있으면 링크를 표시한다", () => {
    const apt = makeApt({
      presaleStage: "분양중", naverPresaleNo: "6025041", naverPresaleSeq: "9033181",
    });
    render(<PresaleInfo apt={apt} />);
    expect(screen.getByText("네이버 분양정보 보기")).toBeTruthy();
  });
});
