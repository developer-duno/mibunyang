import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LoanStack } from "./LoanStack";
import { calcLTV, getZone } from "@/constants/regulations";
import { fmtPrice } from "@/lib/format";

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
    const loan = calcLTV(price, zone, "서울");
    render(<LoanStack price={price} region="서울" gu="강남구" />);
    const label = screen.getByRole("img").getAttribute("aria-label") || "";
    expect(label).toContain(fmtPrice(loan));
    expect(label).toContain(fmtPrice(price - loan));
  });

  it("비싼 구간도 기존 calcLTV 규칙을 그대로 쓴다 (규칙을 새로 쓰지 않는다)", () => {
    const price = 150000; // 15억
    const zone = getZone("서울", "강남구");
    render(<LoanStack price={price} region="서울" gu="강남구" />);
    expect(screen.getByText(`빌릴 수 있는 돈 ${fmtPrice(calcLTV(price, zone, "서울"))}`)).toBeInTheDocument();
  });
});

// 세션593 D1 — 숫자 3칸을 막대로 합치며 금액을 만원까지(fmtPrice). 목업: 대출 2억 1,208만 · 내 돈 3억 1,812만.
describe("LoanStack — 금액은 만원까지 (세션593 D1)", () => {
  // ⚠️ 변이 대상: 막대 금액을 옛 억 반올림("2.1억")으로 되돌리면 빨강.
  it("규제지역 분양가 5억 3,020만 → 막대 안 '대출 2억 1,208만'·'내 돈 3억 1,812만' + 아래 글에 분양가", () => {
    const { container } = render(<LoanStack price={53020} region="서울" gu="강남구" isRegulated />);
    const bar = screen.getByRole("img").firstElementChild?.firstElementChild as HTMLElement;
    const [loanSeg, ownSeg] = [...bar.children] as HTMLElement[];
    expect(loanSeg.textContent).toBe("대출 2억 1,208만");
    expect(ownSeg.textContent).toBe("내 돈 3억 1,812만");
    expect(screen.getByText("빌릴 수 있는 돈 2억 1,208만")).toBeInTheDocument();
    expect(screen.getByText("직접 준비할 돈 3억 1,812만")).toBeInTheDocument();
    expect(screen.getByText(/^분양가 5억 3,020만 · 규제지역 기준 최대 40%까지 빌릴 수 있어요\./)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\d\.\d억/);
  });

  it("조각이 30% 보다 좁으면 그 조각 안 글자는 비우고 아래 줄에만 금액 (넘침 방지)", () => {
    // 경기 비규제 30억 → 수도권 최대 6억 = 20% 조각
    render(<LoanStack price={300000} region="경기" gu="평택시" isRegulated={false} />);
    const [loanSeg, ownSeg] = [
      ...(screen.getByRole("img").firstElementChild?.firstElementChild as HTMLElement).children,
    ] as HTMLElement[];
    expect(loanSeg.textContent).toBe("");
    expect(ownSeg.textContent).toBe("내 돈 24억");
    expect(screen.getByText("빌릴 수 있는 돈 6억")).toBeInTheDocument();
  });
});

describe("LoanStack — 대출 한도 숫자 (세션592 규정 정정)", () => {
  it("지방 비규제 10억 → 7억 (70% 하나, 한도 없음)", () => {
    render(<LoanStack price={100000} region="부산" gu="해운대구" />);
    expect(screen.getByText("빌릴 수 있는 돈 7억")).toBeInTheDocument();
  });

  it("경기 비규제 10억 → 6억 (수도권 주택구입 대출 최대 6억)", () => {
    render(<LoanStack price={100000} region="경기" gu="평택시" />);
    expect(screen.getByText("빌릴 수 있는 돈 6억")).toBeInTheDocument();
    // 6억 한도로 깎였으면 "비규제지역 기준 최대 60%" 처럼 비규제 규칙이 바뀐 것처럼 쓰지 않는다
    expect(
      screen.getByText(/비규제지역이지만 수도권 주택구입 대출은 최대 6억이라 분양가의 60%까지 빌릴 수 있어요/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/비규제지역 기준 최대 60%/)).toBeNull();
  });

  it("6억 한도에 안 걸리면 옛 문장 그대로 — 경기 비규제 5억 → 최대 70%", () => {
    render(<LoanStack price={50000} region="경기" gu="평택시" />);
    expect(screen.getByText(/비규제지역 기준 최대 70%까지 빌릴 수 있어요/)).toBeInTheDocument();
  });

  it("DB 규제 표시가 이름보다 먼저 — 화성시(이름은 비규제) + isRegulated 참 → 40%", () => {
    render(<LoanStack price={100000} region="경기" gu="화성시" isRegulated />);
    expect(screen.getByText("빌릴 수 있는 돈 4억")).toBeInTheDocument();
    expect(screen.getByText(/규제지역 기준 최대 40%/)).toBeInTheDocument();
  });

  it("DB 거짓이면 이름이 규제여도 비규제 — 서울 + isRegulated 거짓 → 70%(서울이라 6억 한도)", () => {
    render(<LoanStack price={50000} region="서울" gu="강남구" isRegulated={false} />);
    expect(screen.getByText("빌릴 수 있는 돈 3억 5,000만")).toBeInTheDocument();
  });

  // 세션592 보완 F2 — 같은 집값·시도에서 DB 표시만 바뀌어도 다시 계산해야 한다.
  // ⚠️ 변이 대상: useMemo 의존 배열에서 isRegulated 를 빼면 옛 금액(3억 5,000만)이 남아 빨강.
  it("isRegulated 가 거짓 → 참으로 바뀌어 다시 그리면 금액이 바뀐다 (메모 키에 DB 표시가 들어 있다)", () => {
    const { rerender } = render(<LoanStack price={50000} region="경기" gu="화성시" isRegulated={false} />);
    expect(screen.getByText("빌릴 수 있는 돈 3억 5,000만")).toBeInTheDocument();
    rerender(<LoanStack price={50000} region="경기" gu="화성시" isRegulated />);
    expect(screen.getByText("빌릴 수 있는 돈 2억")).toBeInTheDocument();
    expect(screen.queryByText("빌릴 수 있는 돈 3억 5,000만")).toBeNull();
  });

  it("DB 값이 비었으면 이름 조회 — 구리시(2026-07-01 지정) → 40%", () => {
    render(<LoanStack price={100000} region="경기" gu="구리시" isRegulated={null} />);
    expect(screen.getByText("빌릴 수 있는 돈 4억")).toBeInTheDocument();
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
