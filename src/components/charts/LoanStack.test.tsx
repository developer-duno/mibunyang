import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LoanStack } from "./LoanStack";
import { calcLTV, getZone } from "@/constants/regulations";
import { fmtPrice } from "@/lib/format";

describe("LoanStack — 분양가가 없으면 그리지 않는다", () => {
  // 세션675 검사 F9 — 빈 상자·"못 모았어요" 문구 없이 통째로 안 그린다(결정 마 원칙)
  it.each([null, undefined, 0, -1, NaN])("price=%s 면 아무것도 안 그린다", (p) => {
    const { container } = render(<LoanStack price={p as number | null} region="서울" gu="강남구" />);
    expect(container.innerHTML).toBe("");
  });
});

describe("LoanStack — 수도권 규제지역 꼬리 · 화면 읽기 설명 (세션675 검사 F1·F11)", () => {
  // 은행업감독업무시행세칙 별표 18 「5. 담보가치 산정」 다목 — 수도권 투기과열지구 잔금대출은 분양가액 제외
  it("서울 규제 → 막대 아래 글 끝 '잔금 때는 감정가·시세로 다시 재요.' · 비규제·지방 규제는 없음", () => {
    const a = render(<LoanStack price={50000} region="서울" gu="강남구" isRegulated />);
    expect(screen.getByTestId("loan-stack-regulated").textContent).toBe(" 잔금 때는 감정가·시세로 다시 재요.");
    a.unmount();
    const b = render(<LoanStack price={50000} region="경기" gu="평택시" isRegulated={false} />);
    expect(screen.queryByTestId("loan-stack-regulated")).toBeNull();
    b.unmount();
    render(<LoanStack price={50000} region="부산" gu="해운대구" isRegulated />);
    expect(screen.queryByTestId("loan-stack-regulated")).toBeNull();
  });

  it("aria 설명에 DSR 미통과 문장과 규제지역 꼬리가 같이 들어간다", () => {
    render(<LoanStack price={50000} region="서울" gu="강남구" isRegulated dsr40pass={false} />);
    const label = screen.getByRole("img").getAttribute("aria-label") ?? "";
    expect(label).toContain(
      "다만 소득 대비 상환 부담(DSR) 기준에 걸릴 수 있어요. 연소득을 넣으면 아래 카드에서 볼 수 있어요."
    );
    expect(label).toContain("잔금 때는 감정가·시세로 다시 재요.");
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
    expect(
      screen.getByText(/^분양가 5억 3,020만 · 지금 규정으로 규제지역 기준 최대 40%까지 빌릴 수 있어요\./)
    ).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\d\.\d억/);
  });

  it("조각이 30% 보다 좁으면 그 조각 안 글자는 비우고 아래 줄에만 금액 (넘침 방지)", () => {
    // 경기 비규제 30억 → 수도권 25억 초과 2억 = 7% 조각(세션706 — 비규제 수도권도 시가별 한도)
    render(<LoanStack price={300000} region="경기" gu="평택시" isRegulated={false} />);
    const [loanSeg, ownSeg] = [
      ...(screen.getByRole("img").firstElementChild?.firstElementChild as HTMLElement).children,
    ] as HTMLElement[];
    expect(loanSeg.textContent).toBe("");
    expect(ownSeg.textContent).toBe("내 돈 28억");
    expect(screen.getByText("빌릴 수 있는 돈 2억")).toBeInTheDocument();
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
      screen.getByText(
        /비규제지역이지만 지금 규정에서 수도권 주택구입 대출은 분양가로 계산하면 최대 6억이라 분양가의 60%까지 빌릴 수 있어요\. 실제 한도는 대출 받을 때 시세로 정해져요\(15억 이하 6억 · 15~25억 4억 · 25억 넘으면 2억\)\./
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/비규제지역 기준 최대 60%/)).toBeNull();
    // 세션709 A1 — 한도를 정하는 집값은 대출 신청일 시세(10·15 FAQ 3-2)라 「이 집값이면」 단정은 빠진다
    expect(screen.queryByText(/이 집값이면/)).toBeNull();
  });

  // 세션706 보완 R1·R3 — 문장 금액은 실제로 걸린 한도(옛 글자 「최대 6억」 고정이면 4억 단지에서 거짓)
  it("인천 연수구 비규제 21.39억 → 4억 · 문장도 「분양가로 계산하면 최대 4억」", () => {
    render(<LoanStack price={213900} region="인천" gu="연수구" isRegulated={false} />);
    expect(screen.getByText("빌릴 수 있는 돈 4억")).toBeInTheDocument();
    expect(
      screen.getByText(
        /비규제지역이지만 지금 규정에서 수도권 주택구입 대출은 분양가로 계산하면 최대 4억이라 분양가의 19%까지 빌릴 수 있어요\. 실제 한도는 대출 받을 때 시세로 정해져요/
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/최대 6억이라/)).toBeNull();
  });

  it("6억 한도에 안 걸리면 옛 문장 그대로 — 경기 비규제 5억 → 최대 70%", () => {
    render(<LoanStack price={50000} region="경기" gu="평택시" />);
    expect(screen.getByText(/비규제지역 기준 최대 70%까지 빌릴 수 있어요/)).toBeInTheDocument();
    // 세션709 A1 — 시세 한도 꼬리는 6억 한도에 걸린 갈래에만
    expect(screen.queryByText(/실제 한도는 대출 받을 때 시세로/)).toBeNull();
  });

  it("DB 규제 표시가 이름보다 먼저 — 화성시(이름은 비규제) + isRegulated 참 → 40%", () => {
    render(<LoanStack price={100000} region="경기" gu="화성시" isRegulated />);
    expect(screen.getByText("빌릴 수 있는 돈 4억")).toBeInTheDocument();
    expect(screen.getByText(/규제지역 기준 최대 40%/)).toBeInTheDocument();
  });

  // A-26 ⑮ (세션713 👤) — 규제 수도권은 시도 없이 재도 구간 금액 한도가 걸려 metroCapped 가 거짓이다.
  // 비율(40%)보다 금액 한도가 먼저 걸리면 「규제지역 기준 최대 22%」가 규칙처럼 읽히므로 금액 한도 문장으로.
  // 기대값: 18억 × 40% = 7.2억 → 15억 초과 4억 한도(10·15 FAQ) → 4억 = 22%.
  // ⚠️ 변이 대상: 조건을 metroCapped 만으로 되돌리면 18억 단언이 빨강 · 비율 비교를 지우면 5.3억 단언이 빨강.
  it("서울 규제 18억 → 4억 · 「규제지역이라 지금 규정에서 주택구입 대출은 … 최대 4억이라 분양가의 22%」", () => {
    render(<LoanStack price={180000} region="서울" gu="강남구" isRegulated />);
    expect(screen.getByText("빌릴 수 있는 돈 4억")).toBeInTheDocument();
    expect(
      screen.getByText(
        "규제지역이라 지금 규정에서 주택구입 대출은 분양가로 계산하면 최대 4억이라 분양가의 22%까지 빌릴 수 있어요. 실제 한도는 대출 받을 때 시세로 정해져요(15억 이하 6억 · 15~25억 4억 · 25억 넘으면 2억).",
        { exact: false }
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/규제지역 기준 최대 22%/)).toBeNull();
  });

  it("서울 규제 5.3억 → 비율 40% 그대로라 옛 문장 「지금 규정으로 규제지역 기준 최대 40%」", () => {
    render(<LoanStack price={53000} region="서울" gu="강남구" isRegulated />);
    expect(screen.getByText(/지금 규정으로 규제지역 기준 최대 40%까지 빌릴 수 있어요\./)).toBeInTheDocument();
    expect(screen.queryByText(/규제지역이라 지금 규정에서/)).toBeNull();
    expect(screen.queryByText(/실제 한도는 대출 받을 때 시세로/)).toBeNull();
  });

  it("경기 비규제 16억 → 4억 · 수도권 한도 문장(「비규제지역이지만」) 그대로 — 새 문장 아님", () => {
    render(<LoanStack price={160000} region="경기" gu="평택시" isRegulated={false} />);
    expect(screen.getByText("빌릴 수 있는 돈 4억")).toBeInTheDocument();
    expect(
      screen.getByText(
        /비규제지역이지만 지금 규정에서 수도권 주택구입 대출은 분양가로 계산하면 최대 4억이라 분양가의 25%까지/
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/규제지역이라 지금 규정에서/)).toBeNull();
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

describe("LoanStack — 진한 주황 · 기준 배지 (세션675)", () => {
  // ⚠️ 변이 대상: 옛 amber(#D97706 = 흰 글자 3.19:1)로 되돌리면 빨강.
  it("'내 돈' 조각 바탕과 '직접 준비할 돈' 글자는 진한 주황 #B45309", () => {
    render(<LoanStack price={53020} region="서울" gu="강남구" isRegulated />);
    const seg = screen.getByText(/^내 돈 /);
    expect(seg.style.background).toBe("rgb(180, 83, 9)");
    expect(screen.getByText(/^직접 준비할 돈 /).style.color).toBe("rgb(180, 83, 9)");
  });

  it("basisLabel 을 주면 제목 옆 배지, 안 주면 배지 없음", () => {
    const r = render(<LoanStack price={50000} region="부산" gu="해운대구" basisLabel="59B 기준" />);
    expect(screen.getByTestId("loan-stack-basis").textContent).toBe("59B 기준");
    r.unmount();
    render(<LoanStack price={50000} region="부산" gu="해운대구" />);
    expect(screen.queryByTestId("loan-stack-basis")).toBeNull();
  });
});

describe("LoanStack — DSR 은 막대가 아니라 한 줄 안내", () => {
  it("통과면 초록 안내", () => {
    render(<LoanStack price={50000} region="서울" gu="강남구" dsr40pass />);
    expect(screen.getByText(/기준도 통과할 만해요/)).toBeInTheDocument();
  });

  // 세션675 「막대 아래 말 끝맺기」 · 「주황 글자 진하게」(글자 #B45309 = 흰 바탕 5.02:1)
  it("미통과면 주의 안내 — '연소득을 넣으면 아래 카드에서 볼 수 있어요'로 끝맺고 진한 주황", () => {
    render(<LoanStack price={50000} region="서울" gu="강남구" dsr40pass={false} />);
    const el = screen.getByText(/기준에 걸릴 수 있어요/);
    expect(el.textContent).toBe(
      " 다만 소득 대비 상환 부담(DSR) 기준에 걸릴 수 있어요. 연소득을 넣으면 아래 카드에서 볼 수 있어요."
    );
    expect(el.style.color).toBe("rgb(180, 83, 9)");
  });

  it("모르면 아무 말도 안 한다 (모르는 걸 단정하지 않는다)", () => {
    render(<LoanStack price={50000} region="서울" gu="강남구" dsr40pass={null} />);
    expect(screen.queryByText(/DSR/)).toBeNull();
  });
});

// A-26 ⑫-② (세션711 👤 안 1) — 막대 금액은 늘 지금 규정이라 문장에 「지금 규정」을 밝히고,
// 아래 잔금 카드에 종전 줄이 보이는 단지면(부모가 grandfatherDate 를 넘김) 그 카드로 잇는 한 문장을 DSR 문장 앞에 붙인다.
describe("LoanStack — 「지금 규정」 · 잔금 카드로 잇는 문장 (세션711)", () => {
  const BRIDGE =
    "이 단지는 첫 공고 날짜(2025-05-20)에 따라 종전 규정이 적용될 수도 있어요. 자세한 금액은 아래 잔금 카드에 있어요.";

  // ⚠️ 변이 대상: 그 밖 갈래의 「지금 규정으로 」를 지우면 첫 단언, metroCapped 갈래의 「지금 규정에서 」를 지우면 둘째 단언이 빨강.
  it("두 갈래 모두 화면 글과 aria 에 같은 「지금 규정」 문장", () => {
    const a = render(<LoanStack price={50000} region="부산" gu="해운대구" />);
    const zoneLine = "지금 규정으로 비규제지역 기준 최대 70%까지 빌릴 수 있어요.";
    expect(a.container.textContent).toContain(`분양가 5억 · ${zoneLine}`);
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain(zoneLine);
    a.unmount();
    render(<LoanStack price={100000} region="경기" gu="평택시" />);
    const capped =
      "비규제지역이지만 지금 규정에서 수도권 주택구입 대출은 분양가로 계산하면 최대 6억이라 분양가의 60%까지 빌릴 수 있어요.";
    expect(document.body.textContent).toContain(capped);
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain(capped);
  });

  // ⚠️ 변이 대상: grandfatherDate 가 있어도 문장을 안 붙이면 빨강 · 늘 붙이면 「없음」 단언이 빨강.
  it("grandfatherDate 가 있으면 시세 문장 뒤·DSR 문장 앞에 잇는 문장(화면·aria 둘 다) · 없으면 안 붙음", () => {
    const a = render(
      <LoanStack price={100000} region="경기" gu="평택시" dsr40pass={false} grandfatherDate="2025-05-20" />
    );
    expect(screen.getByTestId("loan-stack-grandfather").textContent).toBe(` ${BRIDGE}`);
    const t = a.container.textContent ?? "";
    expect(t.indexOf("시세로 정해져요")).toBeLessThan(t.indexOf(BRIDGE));
    expect(t.indexOf(BRIDGE)).toBeLessThan(t.indexOf("다만 소득 대비 상환 부담(DSR)"));
    const label = screen.getByRole("img").getAttribute("aria-label") ?? "";
    expect(label).toContain(BRIDGE);
    expect(label.indexOf(BRIDGE)).toBeLessThan(label.indexOf("다만 소득 대비 상환 부담(DSR)"));
    a.unmount();
    for (const g of [null, undefined, ""]) {
      const r = render(<LoanStack price={100000} region="경기" gu="평택시" grandfatherDate={g} />);
      expect(screen.queryByTestId("loan-stack-grandfather")).toBeNull();
      expect(r.container.textContent).not.toContain("종전 규정");
      expect(screen.getByRole("img").getAttribute("aria-label")).not.toContain("종전 규정");
      r.unmount();
    }
  });

  it("규제지역 40% 갈래에도 같은 문장(metroCapped 여부와 무관) · 규제 꼬리는 그 뒤", () => {
    const { container } = render(
      <LoanStack price={38850} region="서울" gu="중구" isRegulated grandfatherDate="2021-05-04" />
    );
    const t = container.textContent ?? "";
    expect(t).toContain(
      "지금 규정으로 규제지역 기준 최대 40%까지 빌릴 수 있어요. 이 단지는 첫 공고 날짜(2021-05-04)에 따라 종전 규정이 적용될 수도 있어요. 자세한 금액은 아래 잔금 카드에 있어요. 잔금 때는 감정가·시세로 다시 재요."
    );
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
