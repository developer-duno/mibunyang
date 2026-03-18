import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InfoPage } from "./InfoPage";

describe("InfoPage", () => {
  // 기본 렌더링 — 스코어링 엔진 구조 제목
  it("스코어링 엔진 구조 제목이 표시됨", () => {
    render(<InfoPage expertLoggedIn={false} onExpertLoginClick={vi.fn()} />);
    expect(screen.getByText("스코어링 엔진 구조")).toBeInTheDocument();
  });

  // 6개 카테고리 설명 표시
  it("6개 카테고리 설명이 모두 표시됨", () => {
    render(<InfoPage expertLoggedIn={false} onExpertLoginClick={vi.fn()} />);
    expect(screen.getByText("가격 매력도")).toBeInTheDocument();
    expect(screen.getByText("입지·생활권")).toBeInTheDocument();
    expect(screen.getByText("상품성")).toBeInTheDocument();
    expect(screen.getByText("혜택·할인")).toBeInTheDocument();
    expect(screen.getByText("안전도")).toBeInTheDocument();
    expect(screen.getByText("미래가치")).toBeInTheDocument();
  });

  // 학술 기반 섹션
  it("학술 기반 섹션이 표시됨", () => {
    render(<InfoPage expertLoggedIn={false} onExpertLoginClick={vi.fn()} />);
    expect(screen.getByText("학술 기반")).toBeInTheDocument();
  });

  // 비로그인 상태 — 전문가 로그인 버튼 표시
  it("비로그인 상태에서 전문가 로그인 버튼 표시", () => {
    render(<InfoPage expertLoggedIn={false} onExpertLoginClick={vi.fn()} />);
    expect(screen.getByText("전문가 로그인")).toBeInTheDocument();
  });

  // 로그인 상태 — 전문가 로그인 버튼 숨김
  it("로그인 상태에서 전문가 로그인 버튼 숨김", () => {
    render(<InfoPage expertLoggedIn={true} onExpertLoginClick={vi.fn()} />);
    expect(screen.queryByText("전문가 로그인")).toBeNull();
  });

  // 전문가 로그인 버튼 클릭 시 콜백
  it("전문가 로그인 버튼 클릭 시 onExpertLoginClick 호출", () => {
    const onClick = vi.fn();
    render(<InfoPage expertLoggedIn={false} onExpertLoginClick={onClick} />);
    fireEvent.click(screen.getByText("전문가 로그인"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  // 도시등급별 교통 보정 섹션
  it("도시등급별 교통 보정 섹션 표시", () => {
    render(<InfoPage expertLoggedIn={false} onExpertLoginClick={vi.fn()} />);
    expect(screen.getByText(/도시등급별 교통 보정/)).toBeInTheDocument();
  });
});
