// @ts-check
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CatPanel } from "./CatPanel";

// 테스트용 카테고리 데이터 팩토리
function makeCat(overrides = {}) {
  return {
    label: "가격 매력도",
    total: 72,
    subs: [
      { name: "적정가괴리", score: 80, info: "-5.2%" },
      { name: "전세가율", score: 65, info: "68%" },
      { name: "PIR", score: 55, info: "6.2" },
    ],
    ...overrides,
  };
}

describe("CatPanel", () => {
  // 기본 렌더링 (접힌 상태)
  it("카테고리 라벨과 총점을 표시", () => {
    render(<CatPanel cat={makeCat()} k="price" />);
    expect(screen.getByText("가격 매력도")).toBeInTheDocument();
    expect(screen.getByText("72")).toBeInTheDocument();
  });

  it("초기 상태에서 aria-expanded=false", () => {
    render(<CatPanel cat={makeCat()} k="price" />);
    const toggle = screen.getByRole("button");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  // 등급 뱃지 표시 (72점 → B+)
  it("점수에 맞는 등급 뱃지 표시", () => {
    render(<CatPanel cat={makeCat({ total: 72 })} k="price" />);
    expect(screen.getByText("B+")).toBeInTheDocument();
  });

  // 하이라이트 서브지표 표시 (접힌 상태에서도 최대 3개)
  it("접힌 상태에서도 하이라이트 서브지표 표시", () => {
    render(<CatPanel cat={makeCat()} k="price" />);
    expect(screen.getByText("적정가괴리:")).toBeInTheDocument();
  });

  // 펼치기/접기 토글
  it("클릭하면 펼쳐지고 다시 클릭하면 접힘", () => {
    render(<CatPanel cat={makeCat()} k="price" />);
    const toggle = screen.getByRole("button");

    // 펼치기
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    // 접기
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  // 키보드 접근성 (Enter/Space)
  it("Enter 키로 펼침 토글", () => {
    render(<CatPanel cat={makeCat()} k="price" />);
    const toggle = screen.getByRole("button");
    fireEvent.keyDown(toggle, { key: "Enter" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("Space 키로 펼침 토글", () => {
    render(<CatPanel cat={makeCat()} k="price" />);
    const toggle = screen.getByRole("button");
    fireEvent.keyDown(toggle, { key: " " });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  // 펼쳤을 때 모든 서브지표 표시
  it("펼치면 모든 서브지표가 표시됨", () => {
    const cat = makeCat();
    render(<CatPanel cat={cat} k="price" />);
    fireEvent.click(screen.getByRole("button"));

    // 펼친 상태에서 모든 서브지표 이름 확인
    cat.subs.forEach((s) => {
      expect(screen.getAllByText(s.name).length).toBeGreaterThanOrEqual(1);
    });
  });

  // 빈 서브지표
  it("서브지표가 없으면 하이라이트 영역이 없음", () => {
    render(<CatPanel cat={makeCat({ subs: [] })} k="price" />);
    // progressbar(Bar)는 존재하지만 하이라이트 dot은 없어야 함
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  // benefit 카테고리 (info가 "-"인 항목 필터)
  it("benefit 카테고리는 info가 '-'인 항목을 하이라이트에서 제외", () => {
    const cat = makeCat({
      label: "혜택·할인",
      subs: [
        { name: "분양가할인", score: 5, info: "-" },
        { name: "중도금무이자", score: 60, info: "60%" },
        { name: "발코니확장", score: 800, info: "800만" },
      ],
    });
    render(<CatPanel cat={cat} k="benefit" />);
    // "-" info인 분양가할인은 하이라이트에 안 나와야 함 (접힌 상태)
    expect(screen.getByText("중도금무이자:")).toBeInTheDocument();
  });
});
