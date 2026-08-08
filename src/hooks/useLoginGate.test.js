// @ts-check
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLoginGate } from "./useLoginGate";

describe("useLoginGate", () => {
  const makeDeps = (overrides = {}) => ({
    kakao: { initKakaoLogin: vi.fn() },
    ...overrides,
  });

  it("초기 상태: 모달 닫힘, trigger/pendingId null", () => {
    const { result } = renderHook(() => useLoginGate(makeDeps()));
    expect(result.current.showLoginPrompt).toBe(false);
    expect(result.current.loginTrigger).toBeNull();
  });

  // ── 세션 503(단계 2-B): 상세 진입 게이트 폐지 회귀 가드 ──
  // 비로그인도 상세를 열고 점수만 블라인드(2-A) 하는 게 새 정책이다. 게이트가 되살아나면
  // 구글봇(=항상 비로그인)이 다시 아무것도 못 보게 되어 색인이 통째로 죽는다.
  it("handleDetailGated 가 없다 — 상세 진입은 게이트를 거치지 않는다", () => {
    const { result } = renderHook(() => useLoginGate(makeDeps()));
    expect(/** @type {any} */ (result.current).handleDetailGated).toBeUndefined();
  });

  it("이 훅은 상세를 직접 열지 않는다 (detail 의존성 자체가 없다)", () => {
    // detail/isLoggedIn 을 넘겨도 무시된다 = 상세 진입 경로가 이 훅에 남아 있지 않다는 뜻
    const detail = { handleOpenDetail: vi.fn() };
    const { result } = renderHook(() =>
      useLoginGate(/** @type {any} */ ({ ...makeDeps(), detail, isLoggedIn: false }))
    );
    act(() => {
      result.current.requestLoginForDetail("99");
    });
    expect(detail.handleOpenDetail).not.toHaveBeenCalled();
    expect(result.current.showLoginPrompt).toBe(true);
    expect(result.current.loginTrigger).toBe("detail");
  });

  it("카카오 버튼 → 모달 닫히고 pendingDetailId 전달", () => {
    const kakao = { initKakaoLogin: vi.fn() };
    const { result } = renderHook(() => useLoginGate(makeDeps({ kakao })));

    // 상세 안 블라인드 CTA 경로 → pendingDetailId=77 저장
    act(() => {
      result.current.requestLoginForDetail("77");
    });
    act(() => {
      result.current.handleKakaoFromPrompt();
    });

    expect(result.current.showLoginPrompt).toBe(false);
    // 세션 469: initKakaoLogin 2인자 — detail 게이트라 pendingTab=null
    expect(kakao.initKakaoLogin).toHaveBeenCalledWith("77", null);
  });

  // 세션 469: map 게이트 → initKakaoLogin(null, "map") — 로그인 후 지도 복귀
  it('map trigger → 카카오 시작 시 pendingTab="map" 전달 (지도 복귀)', () => {
    const kakao = { initKakaoLogin: vi.fn() };
    const { result } = renderHook(() => useLoginGate(makeDeps({ kakao })));

    // App 의 onLoginRequired 경로 재현: loginTrigger="map" 세팅
    act(() => {
      result.current.setLoginTrigger("map");
      result.current.setShowLoginPrompt(true);
    });
    act(() => {
      result.current.handleKakaoFromPrompt();
    });

    expect(result.current.showLoginPrompt).toBe(false);
    expect(kakao.initKakaoLogin).toHaveBeenCalledWith(null, "map");
  });

  // ── 세션 495: 블라인드 CTA → 로그인 복귀 배선 ──
  // 상세를 연 채 CTA 를 누르는 경로(App onRequestLogin)는 게이트를 안 거치므로,
  // 여기서 pendingDetailId 를 안 적으면 카카오 리다이렉트 후 복귀할 단지가 없다.
  it("requestLoginForDetail → 그 단지가 로그인 후 복귀 대상으로 전달된다", () => {
    const kakao = { initKakaoLogin: vi.fn() };
    const { result } = renderHook(() => useLoginGate(makeDeps({ kakao, isLoggedIn: false })));

    act(() => {
      result.current.requestLoginForDetail("55");
    });

    expect(result.current.showLoginPrompt).toBe(true);
    expect(result.current.loginTrigger).toBe("detail");

    act(() => {
      result.current.handleKakaoFromPrompt();
    });

    expect(kakao.initKakaoLogin).toHaveBeenCalledWith("55", null);
  });

  it("closeLoginPrompt → trigger·복귀 단지 모두 리셋 (엉뚱한 단지 복원 차단)", () => {
    const kakao = { initKakaoLogin: vi.fn() };
    const { result } = renderHook(() => useLoginGate(makeDeps({ kakao, isLoggedIn: false })));

    // 단지 55 로 모달을 열었다가 그냥 닫는다
    act(() => {
      result.current.requestLoginForDetail("55");
    });
    act(() => {
      result.current.closeLoginPrompt();
    });

    expect(result.current.showLoginPrompt).toBe(false);
    expect(result.current.loginTrigger).toBeNull();

    // 이후 map 이 아닌 경로로 로그인해도 옛 단지(55)가 되살아나면 안 된다
    act(() => {
      result.current.handleKakaoFromPrompt();
    });

    expect(kakao.initKakaoLogin).toHaveBeenCalledWith(null, null);
  });

  // 세션 405: 모달은 카카오 단독 — handleExpertFromPrompt 제거 가드 (관리자 입구 = InfoPage 링크)
  it("handleExpertFromPrompt 가 제거되었다 (카카오 단독 가드)", () => {
    const { result } = renderHook(() => useLoginGate(makeDeps()));
    expect(/** @type {any} */ (result.current).handleExpertFromPrompt).toBeUndefined();
  });
});
