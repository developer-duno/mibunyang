// @ts-check
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InfoPage } from "./InfoPage";

describe("InfoPage", () => {
  // 기본 렌더링 — 메인 제목
  it("메인 제목이 표시됨", () => {
    render(<InfoPage expertLoggedIn={false} onExpertLoginClick={vi.fn()} onConsultClick={vi.fn()} />);
    expect(screen.getByText("미분양 아파트 비교 엔진")).toBeInTheDocument();
  });

  // 스코어링 엔진 구조 섹션
  it("스코어링 엔진 구조 제목이 표시됨", () => {
    render(<InfoPage expertLoggedIn={false} onExpertLoginClick={vi.fn()} onConsultClick={vi.fn()} />);
    expect(screen.getByText("스코어링 엔진 구조")).toBeInTheDocument();
  });

  // 6개 카테고리 설명 표시 (여러 섹션에서 중복 가능 → getAllByText)
  it("6개 카테고리 설명이 모두 표시됨", () => {
    render(<InfoPage expertLoggedIn={false} onExpertLoginClick={vi.fn()} onConsultClick={vi.fn()} />);
    expect(screen.getAllByText(/가격 매력도/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/입지·생활권/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/상품성/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/혜택·할인/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/안전도/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/미래가치/).length).toBeGreaterThanOrEqual(1);
  });

  // 학술 기반 섹션
  it("학술 기반 섹션이 표시됨", () => {
    render(<InfoPage expertLoggedIn={false} onExpertLoginClick={vi.fn()} onConsultClick={vi.fn()} />);
    expect(screen.getByText("학술 기반")).toBeInTheDocument();
  });

  // 주요 섹션들 — 프로필, 검색, 정렬, 카드, 관심매물, 지도, 상담, FAQ
  it("주요 도움말 섹션이 모두 표시됨", () => {
    render(<InfoPage expertLoggedIn={false} onExpertLoginClick={vi.fn()} onConsultClick={vi.fn()} />);
    expect(screen.getByText("프로필 선택 (5가지)")).toBeInTheDocument();
    expect(screen.getByText("검색과 필터")).toBeInTheDocument();
    expect(screen.getByText("정렬 (7가지)")).toBeInTheDocument();
    expect(screen.getByText("단지 카드 읽는 법")).toBeInTheDocument();
    expect(screen.getByText("관심매물")).toBeInTheDocument();
    expect(screen.getByText("지도 뷰")).toBeInTheDocument();
    expect(screen.getByText("상담 신청")).toBeInTheDocument();
    expect(screen.getByText("자주 묻는 질문")).toBeInTheDocument();
  });

  // 비로그인 상태 — 전문가 로그인 버튼 표시
  it("비로그인 상태에서 전문가 로그인 버튼 표시", () => {
    render(<InfoPage expertLoggedIn={false} onExpertLoginClick={vi.fn()} onConsultClick={vi.fn()} />);
    expect(screen.getByText("전문가 로그인")).toBeInTheDocument();
  });

  // 로그인 상태 — 전문가 로그인 버튼 숨김
  it("로그인 상태에서 전문가 로그인 버튼 숨김", () => {
    render(<InfoPage expertLoggedIn={true} onExpertLoginClick={vi.fn()} onConsultClick={vi.fn()} />);
    expect(screen.queryByText("전문가 로그인")).toBeNull();
  });

  // 전문가 로그인 버튼 클릭 시 콜백
  it("전문가 로그인 버튼 클릭 시 onExpertLoginClick 호출", () => {
    const onClick = vi.fn();
    render(<InfoPage expertLoggedIn={false} onExpertLoginClick={onClick} onConsultClick={vi.fn()} />);
    fireEvent.click(screen.getByText("전문가 로그인"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  // 상담 진입 카드 (D4 — 모바일 5탭에서 상담 탭 대신 정보 페이지가 정식 입구)
  it("상담 신청 카드 렌더 + 클릭 시 onConsultClick (handleNavClick('consult') 경유 = 예산 프리필 보존)", () => {
    const onConsultClick = vi.fn();
    render(<InfoPage expertLoggedIn={false} onExpertLoginClick={vi.fn()} onConsultClick={onConsultClick} />);
    fireEvent.click(screen.getByRole("button", { name: "상담 신청하기" }));
    expect(onConsultClick).toHaveBeenCalledTimes(1);
  });

  // 도시등급별 교통 보정 섹션
  it("도시등급별 교통 보정 섹션 표시", () => {
    render(<InfoPage expertLoggedIn={false} onExpertLoginClick={vi.fn()} onConsultClick={vi.fn()} />);
    expect(screen.getByText(/도시등급별 교통 보정/)).toBeInTheDocument();
  });
});
