// @ts-check
/**
 * useBizInquiry — 업체 문의(시행사·분양업체) 상태·전송 (세션 577 A-12)
 * - POST /api/consults 본문 정확값(consultType "업체문의", 회사·이메일·단지는 message 첫 줄들)
 * - message 조합 최대 길이 457 < 서버 자르기 500
 * - 201/429/그 밖 응답별 토스트 정확 문구
 * - 상세에서 열리면 단지 칸 자동 입력 + interestedApts 에 id, 손님이 단지 칸을 고치면 id 빼기
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useBizInquiry,
  buildBizInquiryMessage,
  BIZ_LIMITS,
  BIZ_SENT_TOAST,
  BIZ_TOO_MANY_TOAST,
  BIZ_FAIL_TOAST,
} from "./useBizInquiry";

/** @param {number} status @param {any} [body] */
function mockFetch(status, body = {}) {
  const f = vi.fn(() => Promise.resolve(/** @type {any} */ ({ status, json: () => Promise.resolve(body) })));
  vi.stubGlobal("fetch", f);
  return f;
}

const LIST_CTX = { page: "목록" };
const DETAIL_CTX = { page: "상세", apartmentId: "ap-6028351", apartmentName: "힐스테이트 앞산 센트럴" };

/** @param {any} [overrides] */
function setup(overrides = {}) {
  const showToast = vi.fn();
  const onSent = vi.fn();
  const hook = renderHook((props) => useBizInquiry(props), {
    initialProps: { showToast, onSent, open: true, context: LIST_CTX, ...overrides },
  });
  return { ...hook, showToast, onSent };
}

/** 보낼 수 있게 채운다 @param {any} result @param {string} [apartment] */
function fill(result, apartment) {
  act(() => {
    result.current.setCompany("이로움건설");
    result.current.setContact("김담당");
    result.current.setPhone("010-0123-4567");
    result.current.setEmail("");
    if (apartment != null) result.current.setApartment(apartment);
    result.current.setContent("분양 홍보 협의 문의드립니다");
    result.current.setConsent(true);
  });
}

/** @param {any} f */
function sentBody(f) {
  return JSON.parse(f.mock.calls[0][1].body);
}

afterEach(() => vi.unstubAllGlobals());

describe("buildBizInquiryMessage", () => {
  it("회사·이메일·단지 세 줄 + 빈 줄 + 본문, 빈 칸은 '-'", () => {
    expect(
      buildBizInquiryMessage({
        company: "이로움건설",
        email: "",
        apartment: "힐스테이트 앞산 센트럴",
        content: "분양 홍보 협의 문의드립니다",
      })
    ).toBe("회사: 이로움건설\n이메일: -\n단지: 힐스테이트 앞산 센트럴\n\n분양 홍보 협의 문의드립니다");
  });

  it("모든 칸을 최대 길이(50·80·60·250)로 채워도 457자 — 서버 자르기 500 안", () => {
    const msg = buildBizInquiryMessage({
      company: "가".repeat(BIZ_LIMITS.company),
      email: "a".repeat(BIZ_LIMITS.email),
      apartment: "나".repeat(BIZ_LIMITS.apartment),
      content: "다".repeat(BIZ_LIMITS.content),
    });
    expect([BIZ_LIMITS.company, BIZ_LIMITS.email, BIZ_LIMITS.apartment, BIZ_LIMITS.content]).toEqual([50, 80, 60, 250]);
    expect(msg.length).toBe(457);
  });
});

describe("useBizInquiry", () => {
  it("목록에서 연 문의: 본문 정확값(interestedApts 빈 배열) + 201 → 토스트·입력 비움·닫기", async () => {
    const f = mockFetch(201, { ok: true });
    const { result, showToast, onSent } = setup();
    fill(result, "힐스테이트 앞산 센트럴");
    expect(result.current.canSubmit).toBe(true);
    await act(async () => {
      await result.current.submit();
    });
    expect(/** @type {any[][]} */ (f.mock.calls)[0][0]).toBe("/api/consults");
    expect(sentBody(f)).toEqual({
      name: "김담당",
      phone: "010-0123-4567",
      consultType: "업체문의",
      interestedApts: [],
      consent: true,
      message: "회사: 이로움건설\n이메일: -\n단지: 힐스테이트 앞산 센트럴\n\n분양 홍보 협의 문의드립니다",
    });
    expect(showToast.mock.calls).toEqual([[BIZ_SENT_TOAST]]);
    expect(BIZ_SENT_TOAST).toBe("문의를 보냈어요. 곧 연락드릴게요");
    expect(onSent).toHaveBeenCalledTimes(1);
    expect([result.current.company, result.current.contact, result.current.phone, result.current.content]).toEqual([
      "",
      "",
      "",
      "",
    ]);
    expect(result.current.consent).toBe(false);
  });

  it("상세에서 열면 단지 칸이 자동으로 채워지고 interestedApts 에 그 id", async () => {
    const f = mockFetch(201, { ok: true });
    const { result } = setup({ context: DETAIL_CTX });
    expect(result.current.apartment).toBe("힐스테이트 앞산 센트럴");
    fill(result);
    await act(async () => {
      await result.current.submit();
    });
    expect(sentBody(f).interestedApts).toEqual(["ap-6028351"]);
  });

  it("손님이 자동 입력된 단지 칸을 고치면 id 는 싣지 않는다", async () => {
    const f = mockFetch(201, { ok: true });
    const { result } = setup({ context: DETAIL_CTX });
    fill(result, "다른 단지");
    await act(async () => {
      await result.current.submit();
    });
    expect(sentBody(f).interestedApts).toEqual([]);
    expect(sentBody(f).message).toBe("회사: 이로움건설\n이메일: -\n단지: 다른 단지\n\n분양 홍보 협의 문의드립니다");
  });

  it("손님이 직접 쓴 단지는 다음에 상세에서 열어도 덮지 않는다", () => {
    const { result, rerender, showToast, onSent } = setup({ open: false });
    act(() => result.current.setApartment("내가 쓴 단지"));
    rerender({ showToast, onSent, open: true, context: DETAIL_CTX });
    expect(result.current.apartment).toBe("내가 쓴 단지");
  });

  it("429 → '요청이 많아요' 토스트, 입력은 그대로·닫지 않음", async () => {
    mockFetch(429);
    const { result, showToast, onSent } = setup();
    fill(result);
    await act(async () => {
      await result.current.submit();
    });
    expect(showToast.mock.calls).toEqual([[BIZ_TOO_MANY_TOAST]]);
    expect(BIZ_TOO_MANY_TOAST).toBe("요청이 많아요. 잠시 뒤 다시 보내 주세요");
    expect(onSent).toHaveBeenCalledTimes(0);
    expect(result.current.company).toBe("이로움건설");
  });

  it("그 밖의 오류는 서버 error 문구, 없으면 기본 문구", async () => {
    mockFetch(400, { ok: false, error: "올바른 연락처를 입력해주세요" });
    const a = setup();
    fill(a.result);
    await act(async () => {
      await a.result.current.submit();
    });
    expect(a.showToast.mock.calls).toEqual([["올바른 연락처를 입력해주세요"]]);

    mockFetch(500, {});
    const b = setup();
    fill(b.result);
    await act(async () => {
      await b.result.current.submit();
    });
    expect(b.showToast.mock.calls).toEqual([[BIZ_FAIL_TOAST]]);
    expect(BIZ_FAIL_TOAST).toBe("문의를 보내지 못했어요. 잠시 뒤 다시 시도해 주세요");
  });

  it("보내기 조건 — 연락처 규칙(공백 제거 후 숫자·하이픈 8~20)·내용 10자·동의", () => {
    const { result } = setup();
    fill(result);
    expect(result.current.canSubmit).toBe(true);
    act(() => result.current.setPhone("010 0123 4567"));
    expect(result.current.canSubmit).toBe(true);
    act(() => result.current.setPhone("010-12"));
    expect(result.current.canSubmit).toBe(false);
    act(() => result.current.setPhone("전화주세요-12345"));
    expect(result.current.canSubmit).toBe(false);
    act(() => {
      result.current.setPhone("010-0123-4567");
      result.current.setContent("짧은 글");
    });
    expect(result.current.canSubmit).toBe(false);
    act(() => {
      result.current.setContent("분양 홍보 협의 문의드립니다");
      result.current.setCompany("   ");
    });
    expect(result.current.canSubmit).toBe(false);
  });

  it("보내기 조건이 안 되면 fetch 하지 않는다", async () => {
    const f = mockFetch(201);
    const { result } = setup();
    await act(async () => {
      await result.current.submit();
    });
    expect(f).toHaveBeenCalledTimes(0);
  });
});
