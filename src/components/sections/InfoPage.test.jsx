// @ts-check
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InfoPage } from "./InfoPage";
import { SORT_OPTIONS } from "@/constants/sortOptions";

// 세션 405: 전문가 CTA 카드 → 카카오 로그인 카드 + 로그아웃 + 관리자 링크로 개편

function makeProps(overrides = {}) {
  return {
    isLoggedIn: false,
    adminLoggedIn: false,
    onAdminLoginClick: vi.fn(),
    onKakaoLogin: vi.fn(),
    kakaoLoading: false,
    onLogout: vi.fn(),
    onConsultClick: vi.fn(),
    ...overrides,
  };
}

describe("InfoPage", () => {
  // 기본 렌더링 — 메인 제목
  it("메인 제목이 표시됨", () => {
    render(<InfoPage {...makeProps()} />);
    expect(screen.getByText("미분양 아파트 비교 엔진")).toBeInTheDocument();
  });

  // 스코어링 엔진 구조 섹션
  it("스코어링 엔진 구조 제목이 표시됨", () => {
    render(<InfoPage {...makeProps()} />);
    expect(screen.getByText("스코어링 엔진 구조")).toBeInTheDocument();
  });

  // 6개 카테고리 설명 표시 (여러 섹션에서 중복 가능 → getAllByText)
  it("6개 카테고리 설명이 모두 표시됨", () => {
    render(<InfoPage {...makeProps()} />);
    expect(screen.getAllByText(/가격 매력도/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/입지·생활권/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/상품성/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/혜택·할인/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/안전도/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/미래가치/).length).toBeGreaterThanOrEqual(1);
  });

  // 학술 기반 섹션
  it("학술 기반 섹션이 표시됨", () => {
    render(<InfoPage {...makeProps()} />);
    expect(screen.getByText("학술 기반")).toBeInTheDocument();
  });

  // 주요 섹션들 — 프로필, 검색, 정렬, 카드, 관심매물, 지도, 상담, FAQ
  it("주요 도움말 섹션이 모두 표시됨", () => {
    render(<InfoPage {...makeProps()} />);
    expect(screen.getByText("프로필 선택 (5가지)")).toBeInTheDocument();
    expect(screen.getByText("검색과 필터")).toBeInTheDocument();
    // 세션539 A-5①: "12가지"는 손 적힌 옛 값이었다 — 실제 SORT_OPTIONS 는 17개(관리비순·
    // 치안안전·주차넉넉·병원가까움·공원가까움 5개가 안내에서만 빠져 있었다). SORT_OPTIONS.length
    // 에서 파생시켜, 정렬이 늘어도 이 테스트가 손으로 안 고쳐도 되게 한다.
    expect(screen.getByText(`정렬 (${SORT_OPTIONS.length}가지)`)).toBeInTheDocument();
    expect(screen.getByText("단지 카드 읽는 법")).toBeInTheDocument();
    expect(screen.getByText("관심매물")).toBeInTheDocument();
    expect(screen.getByText("지도 뷰")).toBeInTheDocument();
    expect(screen.getByText("상담 신청")).toBeInTheDocument();
    expect(screen.getByText("자주 묻는 질문")).toBeInTheDocument();
  });

  // 비로그인 — 카카오 로그인 카드 (구 전문가 폼 카카오 버튼의 대체 입구)
  it("비로그인 상태에서 카카오 로그인 카드가 표시되고 클릭 시 onKakaoLogin 호출", () => {
    const onKakaoLogin = vi.fn();
    render(<InfoPage {...makeProps({ onKakaoLogin })} />);
    const btn = screen.getByRole("button", { name: /카카오로 시작하기/ });
    fireEvent.click(btn);
    expect(onKakaoLogin).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("로그아웃")).toBeNull();
  });

  // 로그인(카카오 손님 포함) — 로그아웃 버튼 (모바일 유일 로그아웃 경로 — 구 전문가 네비 로그아웃 대체)
  it("로그인 상태에서 로그아웃 버튼 표시 + 클릭 시 onLogout 호출", () => {
    const onLogout = vi.fn();
    render(<InfoPage {...makeProps({ isLoggedIn: true, onLogout })} />);
    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/카카오로 시작하기/)).toBeNull();
  });

  // 마케팅 수신 동의 토글 (D3) — privacy.html "언제든 철회 가능" 약속 이행
  it("로그인 일반 손님이면 마케팅 동의 토글 노출 + 동의 상태 반영", () => {
    render(
      <InfoPage {...makeProps({ isLoggedIn: true, consentMarketing: true, onToggleMarketingConsent: vi.fn() })} />
    );
    const sw = screen.getByRole("switch", { name: "마케팅 정보 수신 동의" });
    expect(sw).toBeTruthy();
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText(/받는 중/)).toBeTruthy();
  });

  it("마케팅 동의 거부(false) 상태면 토글 꺼짐 표시", () => {
    render(
      <InfoPage {...makeProps({ isLoggedIn: true, consentMarketing: false, onToggleMarketingConsent: vi.fn() })} />
    );
    const sw = screen.getByRole("switch", { name: "마케팅 정보 수신 동의" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText(/받지 않음/)).toBeTruthy();
  });

  it("토글 클릭 시 onToggleMarketingConsent 호출", () => {
    const onToggle = vi.fn();
    render(
      <InfoPage {...makeProps({ isLoggedIn: true, consentMarketing: false, onToggleMarketingConsent: onToggle })} />
    );
    fireEvent.click(screen.getByRole("switch", { name: "마케팅 정보 수신 동의" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("비로그인이면 마케팅 동의 토글 숨김", () => {
    render(<InfoPage {...makeProps({ isLoggedIn: false, onToggleMarketingConsent: vi.fn() })} />);
    expect(screen.queryByRole("switch", { name: "마케팅 정보 수신 동의" })).toBeNull();
  });

  it("관리자 로그인이면 마케팅 동의 토글 숨김 (손님 전용)", () => {
    render(
      <InfoPage
        {...makeProps({
          isLoggedIn: true,
          adminLoggedIn: true,
          consentMarketing: true,
          onToggleMarketingConsent: vi.fn(),
        })}
      />
    );
    expect(screen.queryByRole("switch", { name: "마케팅 정보 수신 동의" })).toBeNull();
  });

  // 관리자 입구 — 작은 텍스트 링크 (관리자 유일 입구, 세션 405 결정)
  it("관리자 미로그인이면 '관리자 로그인' 링크 표시 + 클릭 시 onAdminLoginClick 호출", () => {
    const onAdminLoginClick = vi.fn();
    render(<InfoPage {...makeProps({ onAdminLoginClick })} />);
    fireEvent.click(screen.getByRole("button", { name: "관리자 로그인" }));
    expect(onAdminLoginClick).toHaveBeenCalledTimes(1);
  });

  it("관리자 로그인 상태면 '관리자 로그인' 링크 숨김", () => {
    render(<InfoPage {...makeProps({ isLoggedIn: true, adminLoggedIn: true })} />);
    expect(screen.queryByText("관리자 로그인")).toBeNull();
  });

  it("전문가 문구가 더는 없다 (세션 405 폐지 가드)", () => {
    render(<InfoPage {...makeProps()} />);
    expect(screen.queryByText("전문가 로그인")).toBeNull();
    expect(screen.queryByText(/파트너 전문가 전용/)).toBeNull();
  });

  // 상담 진입 카드 (D4 — 모바일 5탭에서 상담 탭 대신 정보 페이지가 정식 입구)
  it("상담 신청 카드 렌더 + 클릭 시 onConsultClick (handleNavClick('consult') 경유 = 예산 프리필 보존)", () => {
    const onConsultClick = vi.fn();
    render(<InfoPage {...makeProps({ onConsultClick })} />);
    fireEvent.click(screen.getByRole("button", { name: "상담 신청하기" }));
    expect(onConsultClick).toHaveBeenCalledTimes(1);
  });

  // 도시등급별 교통 보정 섹션
  it("도시등급별 교통 보정 섹션 표시", () => {
    render(<InfoPage {...makeProps()} />);
    expect(screen.getByText(/도시등급별 교통 보정/)).toBeInTheDocument();
  });
});
