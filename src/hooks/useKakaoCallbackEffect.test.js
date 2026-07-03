/**
 * useKakaoCallbackEffect 훅 테스트
 *
 * 카카오 OAuth 콜백 useEffect 훅의 동작을 검증합니다.
 * - tab !== "kakaoCallback" 이면 콜백 미실행
 * - role 별 분기: admin → admin 탭, expert → expert 탭, user → list 탭
 * - token/refreshToken/userRole localStorage 저장
 * - result.ok=false → list 탭으로 fallback
 * - pendingDetail 있으면 상세 모달 복원
 */
// @ts-check
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useKakaoCallbackEffect } from "./useKakaoCallbackEffect";

vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

/**
 * 기본 args — handleKakaoCallback 결과만 테스트별로 override.
 * @param {any} callbackResult
 * @param {Record<string, unknown>} [override]
 */
function makeArgs(callbackResult, override = {}) {
  return {
    tab: "kakaoCallback",
    kakao: { handleKakaoCallback: vi.fn().mockResolvedValue(callbackResult) },
    auth: { setLoggedIn: vi.fn(), setAuthUser: vi.fn() },
    admin: { setAdminLoggedIn: vi.fn() },
    detail: { setDetailAptId: vi.fn() },
    recordView: vi.fn(),
    setTab: vi.fn(),
    showToast: vi.fn(),
    ...override,
  };
}

describe("useKakaoCallbackEffect", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // tab 이 kakaoCallback 이 아니면 콜백을 호출하지 않는다
  it("tab 이 kakaoCallback 이 아니면 콜백을 실행하지 않는다", () => {
    const args = makeArgs({ ok: true }, { tab: "list" });
    renderHook(() => useKakaoCallbackEffect(args));

    expect(args.kakao.handleKakaoCallback).not.toHaveBeenCalled();
  });

  // user 로그인 → list 탭 + 토큰 저장 + 토스트
  it("user 로그인 성공 시 list 탭으로 이동하고 토큰을 저장한다", async () => {
    const args = makeArgs({
      ok: true,
      token: "tok-1",
      refreshToken: "ref-1",
      role: "user",
      user: { name: "홍길동" },
    });
    renderHook(() => useKakaoCallbackEffect(args));

    await waitFor(() => {
      expect(args.setTab).toHaveBeenCalledWith("list");
    });
    expect(localStorage.getItem("authToken")).toBe("tok-1");
    expect(localStorage.getItem("refreshToken")).toBe("ref-1");
    expect(localStorage.getItem("userRole")).toBe("user");
    expect(args.auth.setLoggedIn).toHaveBeenCalledWith(true);
    expect(args.showToast).toHaveBeenCalledWith("로그인 성공");
  });

  // admin 로그인 → admin 탭 + setAdminLoggedIn
  it("admin 로그인 시 admin 탭으로 이동한다", async () => {
    const args = makeArgs({ ok: true, token: "t", role: "admin" });
    renderHook(() => useKakaoCallbackEffect(args));

    await waitFor(() => {
      expect(args.admin.setAdminLoggedIn).toHaveBeenCalledWith(true);
    });
    expect(args.setTab).toHaveBeenCalledWith("admin");
  });

  // 레거시 expert role → 일반 손님 취급 (세션 405 전문가 폐지)
  it("expert role 잔존 레코드 로그인 시 일반 손님(list/home)으로 이동한다", async () => {
    const args = makeArgs({ ok: true, token: "t", role: "expert" });
    renderHook(() => useKakaoCallbackEffect(args));

    await waitFor(() => {
      expect(args.setTab).toHaveBeenCalledWith("list"); // featureFlag OFF 테스트 환경 = list
    });
    expect(args.setTab).not.toHaveBeenCalledWith("expert");
    expect(args.admin.setAdminLoggedIn).not.toHaveBeenCalled();
  });

  // pendingDetail 있으면 상세 모달 복원
  it("user 로그인 + pendingDetail 이면 상세 모달을 복원한다", async () => {
    const args = makeArgs({ ok: true, token: "t", role: "user", pendingDetail: "apt-99" });
    renderHook(() => useKakaoCallbackEffect(args));

    await waitFor(() => {
      expect(args.detail.setDetailAptId).toHaveBeenCalledWith("apt-99");
    });
    expect(args.setTab).toHaveBeenCalledWith("list");
    // 로그인 후 복원되는 상세도 "본 단지"로 기록 (cross-validate 발견 — 정책 일관)
    expect(args.recordView).toHaveBeenCalledWith("apt-99");
  });

  // pendingDetail 없으면 recordView 미호출
  it("pendingDetail 없으면 recordView 를 호출하지 않는다", async () => {
    const args = makeArgs({ ok: true, token: "t", role: "user" });
    renderHook(() => useKakaoCallbackEffect(args));

    await waitFor(() => {
      expect(args.setTab).toHaveBeenCalledWith("list");
    });
    expect(args.recordView).not.toHaveBeenCalled();
  });

  // 세션 469: pendingTab="map" 이면 로그인 후 지도 탭으로 복귀 (홈 착지 덮음)
  it("user 로그인 + pendingTab='map' 이면 지도 탭으로 복귀한다", async () => {
    const args = makeArgs({ ok: true, token: "t", role: "user", pendingTab: "map" });
    renderHook(() => useKakaoCallbackEffect(args));

    await waitFor(() => {
      expect(args.setTab).toHaveBeenCalledWith("map");
    });
    expect(args.setTab).not.toHaveBeenCalledWith("list");
    expect(args.setTab).not.toHaveBeenCalledWith("home");
  });

  // 세션 469: VITE_FEATURE_HOME=true 여도 pendingTab="map" 이 홈 착지를 이긴다
  it("VITE_FEATURE_HOME=true + pendingTab='map' → 홈이 아니라 지도 탭", async () => {
    vi.stubEnv("VITE_FEATURE_HOME", "true");
    const args = makeArgs({ ok: true, token: "t", role: "user", pendingTab: "map" });
    renderHook(() => useKakaoCallbackEffect(args));

    await waitFor(() => {
      expect(args.setTab).toHaveBeenCalledWith("map");
    });
    expect(args.setTab).not.toHaveBeenCalledWith("home");
    vi.unstubAllEnvs();
  });

  // 세션 469: admin 은 pendingTab 이 있어도 admin 탭 우선 (별도 if 분기라 충돌 없음)
  it("admin + pendingTab='map' 이어도 admin 탭 우선 (map 무시)", async () => {
    const args = makeArgs({ ok: true, token: "t", role: "admin", pendingTab: "map" });
    renderHook(() => useKakaoCallbackEffect(args));

    await waitFor(() => {
      expect(args.setTab).toHaveBeenCalledWith("admin");
    });
    expect(args.setTab).not.toHaveBeenCalledWith("map");
  });

  // VITE_FEATURE_HOME ON: 일반 유저 착지가 home (로그인 직후 홈 = 지도 위젯 열린 첫 경험, spec §1)
  it("VITE_FEATURE_HOME=true 면 user 로그인 착지가 home 이다", async () => {
    vi.stubEnv("VITE_FEATURE_HOME", "true");
    const args = makeArgs({ ok: true, token: "t", role: "user" });
    renderHook(() => useKakaoCallbackEffect(args));

    await waitFor(() => {
      expect(args.setTab).toHaveBeenCalledWith("home");
    });
    vi.unstubAllEnvs();
  });

  // result.ok=false → list 탭 fallback, 토큰 미저장
  it("콜백 실패 시 list 탭으로 fallback 하고 토큰을 저장하지 않는다", async () => {
    const args = makeArgs({ ok: false });
    renderHook(() => useKakaoCallbackEffect(args));

    await waitFor(() => {
      expect(args.setTab).toHaveBeenCalledWith("list");
    });
    expect(localStorage.getItem("authToken")).toBeNull();
    expect(args.auth.setLoggedIn).not.toHaveBeenCalled();
  });

  // role 누락 → user 로 간주
  it("role 이 없으면 user 로 간주한다", async () => {
    const args = makeArgs({ ok: true, token: "t" });
    renderHook(() => useKakaoCallbackEffect(args));

    await waitFor(() => {
      expect(localStorage.getItem("userRole")).toBe("user");
    });
    expect(args.setTab).toHaveBeenCalledWith("list");
  });

  // 신규 카카오 가입(needsMarketingConsent) → 마케팅 동의 모달 콜백 호출 (세션 427)
  it("user + needsMarketingConsent 면 onNeedsMarketingConsent 콜백을 호출한다", async () => {
    const onNeedsMarketingConsent = vi.fn();
    const args = makeArgs(
      { ok: true, token: "t", role: "user", needsMarketingConsent: true },
      { onNeedsMarketingConsent }
    );
    renderHook(() => useKakaoCallbackEffect(args));

    await waitFor(() => {
      expect(onNeedsMarketingConsent).toHaveBeenCalledTimes(1);
    });
  });

  // 기존 사용자(needsMarketingConsent=false) → 동의 모달 콜백 미호출
  it("needsMarketingConsent 가 false 면 동의 모달 콜백을 호출하지 않는다", async () => {
    const onNeedsMarketingConsent = vi.fn();
    const args = makeArgs(
      { ok: true, token: "t", role: "user", needsMarketingConsent: false },
      { onNeedsMarketingConsent }
    );
    renderHook(() => useKakaoCallbackEffect(args));

    await waitFor(() => {
      expect(args.setTab).toHaveBeenCalledWith("list");
    });
    expect(onNeedsMarketingConsent).not.toHaveBeenCalled();
  });

  // admin 은 needsMarketingConsent 여도 동의 모달 미호출 (admin 분기에서 return 안 하지만 else 블록 밖)
  it("admin 은 needsMarketingConsent 여도 동의 모달 콜백을 호출하지 않는다", async () => {
    const onNeedsMarketingConsent = vi.fn();
    const args = makeArgs(
      { ok: true, token: "t", role: "admin", needsMarketingConsent: true },
      { onNeedsMarketingConsent }
    );
    renderHook(() => useKakaoCallbackEffect(args));

    await waitFor(() => {
      expect(args.admin.setAdminLoggedIn).toHaveBeenCalledWith(true);
    });
    expect(onNeedsMarketingConsent).not.toHaveBeenCalled();
  });
});
