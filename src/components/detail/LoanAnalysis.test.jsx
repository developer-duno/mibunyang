import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LoanAnalysis } from "./LoanAnalysis";
import { makeApt } from "@/__tests__/factories";

describe("LoanAnalysis", () => {
  // 기본 렌더링 — 분양가, LTV, 자기자본 카드 표시
  it("분양가, LTV 대출한도, 필요 자기자본을 표시한다", () => {
    const apt = makeApt({ price: 50000, region: "경기", gu: "수원시" });
    render(<LoanAnalysis apt={apt} />);
    expect(screen.getByText("분양가")).toBeTruthy();
    expect(screen.getByText("LTV 대출한도")).toBeTruthy();
    expect(screen.getByText("필요 자기자본")).toBeTruthy();
  });

  // 비규제지역 존 표시 (현재 ZONE_MAP 비어있으므로 모든 지역 = normal)
  it("비규제지역 배지를 표시한다", () => {
    const apt = makeApt({ region: "경기", gu: "수원시" });
    render(<LoanAnalysis apt={apt} />);
    expect(screen.getByText("비규제지역")).toBeTruthy();
  });

  // LTV 계산 검증 — 비규제 9억 이하 70%
  it("비규제지역 9억 이하 LTV 70%를 올바르게 계산한다", () => {
    // 50000만원 = 5억 → LTV = 5억 * 0.7 = 35000만원 = 3억 5000만
    const apt = makeApt({ price: 50000, region: "강원", gu: "춘천시" });
    render(<LoanAnalysis apt={apt} />);
    expect(screen.getByText("3억 5,000만")).toBeTruthy();
  });

  // region/gu가 null인 경우 — getZone은 normal 폴백
  it("region이 null이어도 크래시 없이 렌더링한다", () => {
    const apt = makeApt({ region: null, gu: null, price: 30000 });
    expect(() => render(<LoanAnalysis apt={apt} />)).not.toThrow();
    expect(screen.getByText("비규제지역")).toBeTruthy();
  });

  // price가 0인 경우
  it("price가 0이면 분양가에 '-'을 표시한다", () => {
    const apt = makeApt({ price: 0 });
    render(<LoanAnalysis apt={apt} />);
    // fmtPrice(0) = "-"
    const dashes = screen.getAllByText("-");
    expect(dashes.length).toBeGreaterThan(0);
  });

  // 관련 법률 토글
  it("관련 법률 섹션을 클릭하면 내용이 토글된다", () => {
    const apt = makeApt({ price: 50000 });
    render(<LoanAnalysis apt={apt} />);
    const toggle = screen.getByText("관련 법률/규정 안내");
    // 초기: 숨겨진 상태
    expect(screen.queryByText(/LTV \(담보인정비율\)/)).toBeNull();
    // 클릭 후 표시
    fireEvent.click(toggle);
    expect(screen.getByText(/LTV \(담보인정비율\)/)).toBeTruthy();
    // 다시 클릭하면 숨김
    fireEvent.click(toggle);
    expect(screen.queryByText(/LTV \(담보인정비율\)/)).toBeNull();
  });

  // aria-expanded 속성 검증
  it("토글 버튼의 aria-expanded가 올바르게 변경된다", () => {
    const apt = makeApt({ price: 50000 });
    render(<LoanAnalysis apt={apt} />);
    const toggle = screen.getByRole("button", { name: /관련 법률/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  // priceByArea가 있으면 상세 테이블 표시
  it("priceByArea가 있으면 면적별 LTV 테이블을 표시한다", () => {
    const apt = makeApt({
      price: 50000, area: 84,
      priceByArea: [{ area: 84, min: 48000, avg: 50000, max: 52000, count: 5 }],
      rentByArea: [{ area: 84, min: 20000, avg: 25000, max: 30000 }],
    });
    render(<LoanAnalysis apt={apt} />);
    expect(screen.getByText("최저매매")).toBeTruthy();
    expect(screen.getByText("갭투자액")).toBeTruthy();
    expect(screen.getByText("LTV한도")).toBeTruthy();
  });

  // priceByArea가 null이면 상세 테이블 미표시
  it("priceByArea가 null이면 상세 테이블을 표시하지 않는다", () => {
    const apt = makeApt({ price: 50000, priceByArea: null });
    render(<LoanAnalysis apt={apt} />);
    expect(screen.queryByText("최저매매")).toBeNull();
  });

  // 키보드 접근성 — Enter 키로 토글
  it("Enter 키로 법률 섹션을 토글할 수 있다", () => {
    const apt = makeApt({ price: 50000 });
    render(<LoanAnalysis apt={apt} />);
    const toggle = screen.getByRole("button", { name: /관련 법률/ });
    fireEvent.keyDown(toggle, { key: "Enter" });
    expect(screen.getByText(/LTV \(담보인정비율\)/)).toBeTruthy();
  });
});
