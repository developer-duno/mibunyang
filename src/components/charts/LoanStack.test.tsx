import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LoanStack, fmtEok } from "./LoanStack";
import { calcLTV, getZone } from "@/constants/regulations";

describe("fmtEok — 억/만원 표기", () => {
  it("1억 미만은 만원, 넘으면 억", () => {
    expect(fmtEok(5000)).toBe("5,000만");
    expect(fmtEok(9999)).toBe("9,999만");
    expect(fmtEok(10000)).toBe("1억");
    expect(fmtEok(45000)).toBe("4.5억");
  });
  it("10억 이상은 소수점을 버린다 (자릿수가 길어 읽기 나쁨)", () => {
    expect(fmtEok(123456)).toBe("12억");
  });
});

describe("LoanStack — 분양가가 없으면 계산하지 않는다", () => {
  it.each([null, undefined, 0, -1, NaN])("price=%s 면 이유를 적고 안 그린다", (p) => {
    render(<LoanStack price={p as number | null} region="서울" gu="강남구" />);
    expect(screen.getByText(/자금 구성을 계산할 수 없어요/)).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });
});

describe("LoanStack — 두 조각이 분양가와 정확히 맞는다", () => {
  it("대출 + 내 돈 = 분양가 (밑변이 어긋나면 그림이 거짓말이다)", () => {
    const price = 50000;
    const zone = getZone("서울", "강남구");
    const loan = calcLTV(price, zone);
    render(<LoanStack price={price} region="서울" gu="강남구" />);
    const label = screen.getByRole("img").getAttribute("aria-label") || "";
    expect(label).toContain(fmtEok(loan));
    expect(label).toContain(fmtEok(price - loan));
  });

  it("9억 넘는 구간도 기존 calcLTV 규칙을 그대로 쓴다 (규칙을 새로 쓰지 않는다)", () => {
    const price = 150000; // 15억
    const zone = getZone("서울", "강남구");
    render(<LoanStack price={price} region="서울" gu="강남구" />);
    expect(screen.getByText(new RegExp(`빌릴 수 있는 돈 ${fmtEok(calcLTV(price, zone))}`))).toBeInTheDocument();
  });
});

describe("LoanStack — DSR 은 막대가 아니라 한 줄 안내", () => {
  it("통과면 초록 안내", () => {
    render(<LoanStack price={50000} region="서울" gu="강남구" dsr40pass />);
    expect(screen.getByText(/기준도 통과할 만해요/)).toBeInTheDocument();
  });

  it("미통과면 주의 안내", () => {
    render(<LoanStack price={50000} region="서울" gu="강남구" dsr40pass={false} />);
    expect(screen.getByText(/기준에 걸릴 수 있어요/)).toBeInTheDocument();
  });

  it("모르면 아무 말도 안 한다 (모르는 걸 단정하지 않는다)", () => {
    render(<LoanStack price={50000} region="서울" gu="강남구" dsr40pass={null} />);
    expect(screen.queryByText(/DSR/)).toBeNull();
  });
});

describe("LoanStack — 스크린리더", () => {
  it("금액과 비중을 말해주고 '점수'라는 말은 안 쓴다", () => {
    render(<LoanStack price={50000} region="경기" gu="수원시" />);
    const label = screen.getByRole("img").getAttribute("aria-label") || "";
    expect(label).toMatch(/대출 비중 \d+ 퍼센트/);
    expect(label).not.toContain("점수");
  });
});
