// @ts-check
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useFeedback,
  buildFeedbackContext,
  feedbackContextLabel,
  FEEDBACK_SENT_TOAST,
  FEEDBACK_TOO_MANY_TOAST,
} from "./useFeedback";

/** @param {number} status @param {any} [body] */
function mockFetch(status, body = {}) {
  return vi.fn(() => Promise.resolve(/** @type {any} */ ({ status, json: () => Promise.resolve(body) })));
}

const CTX = { page: "상세", apartmentId: "ap-6028351", apartmentName: "힐스테이트테스트" };

/** @param {any} [overrides] */
function setup(overrides = {}) {
  const showToast = vi.fn();
  const onLoginRequired = vi.fn();
  const hook = renderHook(() => useFeedback({ showToast, onLoginRequired, context: CTX, ...overrides }));
  return { ...hook, showToast, onLoginRequired };
}

/** 보낼 수 있는 상태로 채운다 @param {any} result */
function fill(result) {
  act(() => {
    result.current.setKind("bug");
    result.current.setMessage("  지도에서 단지 점이 안 보여요  ");
    result.current.setConsent(true);
  });
}

describe("useFeedback (세션574)", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("authToken", "user-token");
    globalThis.fetch = mockFetch(201, { ok: true, id: 7 });
  });

  // 세션 577(A-12): 문의 모달로 통합 — 로그인 여부와 무관하게 연다(업체 문의 탭은 로그인 불필요)
  it("openFeedback 은 로그인 안내 없이 모달을 연다", () => {
    const { result, onLoginRequired } = setup();
    act(() => result.current.openFeedback());
    expect(result.current.open).toBe(true);
    expect(onLoginRequired).not.toHaveBeenCalled();
  });

  it("requestLogin(의견 탭의 로그인 버튼) = 모달 닫고 로그인 안내 1회", () => {
    const { result, onLoginRequired } = setup();
    act(() => result.current.openFeedback());
    act(() => result.current.requestLogin());
    expect(result.current.open).toBe(false);
    expect(onLoginRequired).toHaveBeenCalledTimes(1);
  });

  it("보내기 활성 = 종류 선택 + 동의 + 10자 이상 셋 다", () => {
    const { result } = setup();
    expect(result.current.canSubmit).toBe(false);
    act(() => {
      result.current.setMessage("열 글자가 넘는 내용이에요");
      result.current.setConsent(true);
    });
    expect(result.current.canSubmit).toBe(false); // 종류 미선택
    act(() => result.current.setKind("suggest"));
    expect(result.current.canSubmit).toBe(true);
    act(() => result.current.setConsent(false));
    expect(result.current.canSubmit).toBe(false); // 동의 해제
    act(() => {
      result.current.setConsent(true);
      result.current.setMessage("   아홉글자예요요   "); // 앞뒤 공백 빼면 9자
    });
    expect(result.current.canSubmit).toBe(false);
  });

  it("정상 전송 — Bearer 헤더 + 본문 + 성공 토스트 + 입력 비우고 닫기", async () => {
    const { result, showToast } = setup();
    act(() => result.current.openFeedback());
    fill(result);
    await act(async () => {
      await result.current.submit();
    });
    const fetchMock = /** @type {any} */ (globalThis.fetch);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/feedback");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer user-token");
    expect(JSON.parse(init.body)).toEqual({
      kind: "bug",
      message: "지도에서 단지 점이 안 보여요",
      consent: true,
      page: "상세",
      apartmentId: "ap-6028351",
      apartmentName: "힐스테이트테스트",
    });
    expect(showToast).toHaveBeenCalledWith(FEEDBACK_SENT_TOAST);
    expect(FEEDBACK_SENT_TOAST).toBe("의견을 보냈어요. 고맙습니다!");
    expect(result.current.open).toBe(false);
    expect(result.current.message).toBe("");
    expect(result.current.kind).toBe(null);
    expect(result.current.consent).toBe(false);
  });

  it("보내기 조건이 안 되면 fetch 하지 않는다", async () => {
    const { result } = setup();
    act(() => result.current.setMessage("열 글자가 넘는 내용이에요"));
    await act(async () => {
      await result.current.submit();
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("429 → '요청이 많아요' 토스트, 폼은 그대로", async () => {
    globalThis.fetch = mockFetch(429, { ok: false });
    const { result, showToast } = setup();
    act(() => result.current.openFeedback());
    fill(result);
    await act(async () => {
      await result.current.submit();
    });
    expect(showToast).toHaveBeenCalledWith(FEEDBACK_TOO_MANY_TOAST);
    expect(FEEDBACK_TOO_MANY_TOAST).toBe("요청이 많아요. 잠시 뒤 다시 보내 주세요");
    expect(result.current.open).toBe(true);
    expect(result.current.message).not.toBe("");
  });

  it("401 → 폼 닫고 로그인 안내, 쓰던 글은 남긴다", async () => {
    globalThis.fetch = mockFetch(401, { ok: false });
    const { result, onLoginRequired } = setup();
    act(() => result.current.openFeedback());
    fill(result);
    await act(async () => {
      await result.current.submit();
    });
    expect(onLoginRequired).toHaveBeenCalledOnce();
    expect(result.current.open).toBe(false);
    expect(result.current.message).not.toBe("");
  });

  it("토큰이 없으면 fetch 없이 로그인 안내", async () => {
    localStorage.removeItem("authToken");
    const { result, onLoginRequired } = setup();
    act(() => result.current.openFeedback());
    fill(result);
    await act(async () => {
      await result.current.submit();
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(onLoginRequired).toHaveBeenCalledOnce();
  });

  it("그 밖의 오류는 서버 문구를, 네트워크 오류는 연결 안내를 토스트", async () => {
    globalThis.fetch = mockFetch(400, { ok: false, error: "의견 종류를 골라주세요" });
    const { result, showToast } = setup();
    fill(result);
    await act(async () => {
      await result.current.submit();
    });
    expect(showToast).toHaveBeenCalledWith("의견 종류를 골라주세요");

    globalThis.fetch = vi.fn(() => Promise.reject(new Error("offline")));
    await act(async () => {
      await result.current.submit();
    });
    expect(showToast).toHaveBeenLastCalledWith("서버에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요");
    expect(result.current.submitting).toBe(false);
  });

  it("단지 문맥이 없으면 본문에서 빠진다", async () => {
    const { result } = setup({ context: { page: "목록" } });
    fill(result);
    await act(async () => {
      await result.current.submit();
    });
    const body = JSON.parse(/** @type {any} */ (globalThis.fetch).mock.calls[0][1].body);
    expect(body.page).toBe("목록");
    expect(body).not.toHaveProperty("apartmentId");
    expect(body).not.toHaveProperty("apartmentName");
  });
});

describe("buildFeedbackContext / feedbackContextLabel", () => {
  it("상세가 열려 있으면 상세 + 단지", () => {
    const ctx = buildFeedbackContext("list", true, { id: "ap-6028351", name: "힐스테이트테스트" });
    expect(ctx).toEqual({ page: "상세", apartmentId: "ap-6028351", apartmentName: "힐스테이트테스트" });
    expect(feedbackContextLabel(ctx)).toBe("상세 · 힐스테이트테스트 (ap-6028351)");
  });

  it("탭 이름을 손님 말로 — 목록에서 비교 시트가 열려 있으면 비교", () => {
    expect(buildFeedbackContext("map", false, null)).toEqual({ page: "지도" });
    expect(buildFeedbackContext("list", false, null)).toEqual({ page: "목록" });
    expect(buildFeedbackContext("list", true, null)).toEqual({ page: "비교" });
    expect(buildFeedbackContext("upcoming", false, null)).toEqual({ page: "곧 분양" });
    expect(buildFeedbackContext("somethingNew", false, null)).toEqual({ page: "somethingNew" });
  });

  it("단지 이름이 없으면 id 만", () => {
    expect(feedbackContextLabel({ page: "상세", apartmentId: "ah-1", apartmentName: null })).toBe("상세 · ah-1");
    expect(feedbackContextLabel({ page: "홈" })).toBe("홈");
  });
});
