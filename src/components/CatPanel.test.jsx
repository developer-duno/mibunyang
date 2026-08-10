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
    // 헤더 토글 버튼만 aria-expanded 를 가짐 (도움말 ? 버튼과 구별, 세션: HelpHint 도입)
    const toggle = screen.getByRole("button", { expanded: false });
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
    const toggle = screen.getByRole("button", { expanded: false });

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
    const toggle = screen.getByRole("button", { expanded: false });
    fireEvent.keyDown(toggle, { key: "Enter" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("Space 키로 펼침 토글", () => {
    render(<CatPanel cat={makeCat()} k="price" />);
    const toggle = screen.getByRole("button", { expanded: false });
    fireEvent.keyDown(toggle, { key: " " });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  // 펼쳤을 때 모든 서브지표 표시
  it("펼치면 모든 서브지표가 표시됨", () => {
    const cat = makeCat();
    render(<CatPanel cat={cat} k="price" />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));

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

  // 프로필 맞춤 강조 (세션 382)
  it("emphasized=true 면 '중점' 배지 표시", () => {
    render(<CatPanel cat={makeCat()} k="price" emphasized />);
    expect(screen.getByText(/중점/)).toBeInTheDocument();
  });

  it("emphasized 미전달이면 배지 없음(기존 동작 보존)", () => {
    render(<CatPanel cat={makeCat()} k="price" />);
    expect(screen.queryByText(/중점/)).toBeNull();
  });

  // defaultExpanded (세션 409 D2b) — 종합 탭 미니카드 클릭 시 해당 카테고리 자동 펼침용.
  it("defaultExpanded=true 면 초기 aria-expanded=true (미니카드 자동 펼침)", () => {
    render(<CatPanel cat={makeCat()} k="price" defaultExpanded />);
    // 헤더 토글만 aria-expanded 보유 (도움말 ? 버튼 제외)
    expect(screen.getByRole("button", { expanded: true })).toBeInTheDocument();
  });

  it("defaultExpanded 미전달이면 초기 aria-expanded=false (기존 동작 보존)", () => {
    render(<CatPanel cat={makeCat()} k="price" />);
    expect(screen.getByRole("button", { expanded: false })).toBeInTheDocument();
  });

  // 서브지표 강/약 부호 기호 (세션 434 점수 근거 투명화 C) — 색맹 접근성: 색만 의존 않고 기호 병행.
  // interpret 이 있어야(SUB_CONTEXT 매칭 서브명) 부호가 뜸. price "전세가율" 사용.
  it("score>=70 서브는 ▲ 강점 기호 + aria-label", () => {
    render(<CatPanel cat={makeCat({ subs: [{ name: "전세가율", score: 80, info: "75%" }] })} k="price" />);
    expect(screen.getByText("▲")).toBeInTheDocument();
    expect(screen.getByLabelText("강점")).toBeInTheDocument();
  });

  it("40~69 서브는 ■ 보통 기호", () => {
    render(<CatPanel cat={makeCat({ subs: [{ name: "전세가율", score: 55, info: "60%" }] })} k="price" />);
    expect(screen.getByText("■")).toBeInTheDocument();
    expect(screen.getByLabelText("보통")).toBeInTheDocument();
  });

  it("score<40 서브는 ▼ 약점 기호", () => {
    render(<CatPanel cat={makeCat({ subs: [{ name: "전세가율", score: 20, info: "40%" }] })} k="price" />);
    // ▼ 는 펼침 화살표(헤더)와 텍스트 겹침 — aria-label 로 부호만 단언
    const sign = screen.getByLabelText("약점");
    expect(sign.textContent).toBe("▼");
  });

  it("부호는 색만 아니라 aria-label 병행 (WCAG 색맹 접근성)", () => {
    render(<CatPanel cat={makeCat({ subs: [{ name: "전세가율", score: 80, info: "75%" }] })} k="price" />);
    const labeled = screen.getByLabelText("강점");
    expect(labeled.textContent).toBe("▲");
  });

  // product 는 부호 미표시 (세션 434 적대검증) — PRODUCT_MAX 키 영문 vs subName 한글 불일치로
  // normalizeScore 가 max=10 폴백 → interpret 의 raw-max 임계와 어긋남. 모순 회피 위해 product 제외.
  it("product 카테고리는 부호 미표시 (interpret 척도 불일치 회피)", () => {
    render(
      <CatPanel
        cat={makeCat({ label: "상품성", subs: [{ name: "주차", score: 12, info: "1.5대" }] })}
        k="product"
        defaultExpanded
      />
    );
    // product 는 ▲■▼ 부호 안 뜸 (interpret 문구는 떠도 부호 없음)
    expect(screen.queryByLabelText("강점")).toBeNull();
    expect(screen.queryByLabelText("보통")).toBeNull();
    expect(screen.queryByLabelText("약점")).toBeNull();
  });

  // 카테고리 제목 옆 도움말(?) — 손님이 카테고리 의미를 이해하도록 (catHelp 단일 출처)
  it("카테고리 제목 옆에 도움말 트리거를 노출한다", () => {
    render(<CatPanel cat={makeCat({ label: "가격 매력도" })} k="price" />);
    expect(screen.getByLabelText("가격 매력도 풀이 보기")).toBeInTheDocument();
  });

  it("도움말을 클릭하면 카테고리 설명이 나타난다", () => {
    render(<CatPanel cat={makeCat({ label: "가격 매력도" })} k="price" />);
    fireEvent.click(screen.getByLabelText("가격 매력도 풀이 보기"));
    // catHelp("price") 고유 문구 — 서브지표 "적정가괴리" 와 겹치지 않게 "합리적" 으로 특정
    expect(screen.getByText(/합리적/)).toBeInTheDocument();
  });

  // "세부 N개" 헤더 표기 (세션508 PR-3c C5)
  it("서브지표가 있으면 헤더에 '세부 N개'를 표기한다", () => {
    render(<CatPanel cat={makeCat()} k="price" />);
    // makeCat() 기본 subs 3개
    expect(screen.getByText("세부 3개")).toBeInTheDocument();
  });

  // 🔴 슬림 catsCache 과도기(subs=[]) 가드 — "세부 0개" 는 거짓말이라 표기 자체를 숨긴다.
  it("서브지표가 없으면(슬림 catsCache) '세부 0개'를 표기하지 않는다", () => {
    render(<CatPanel cat={makeCat({ subs: [] })} k="price" />);
    expect(screen.queryByText(/세부 \d+개/)).toBeNull();
  });
});
