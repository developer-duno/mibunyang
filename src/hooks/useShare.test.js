// @ts-check
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useShare } from "./useShare";

// ## 이 테스트는 `.env.local` 에 흔들리지 않는다 — 실측 근거 (세션556)
//
// `useShare.ts:5-6` 은 `VITE_KAKAO_JS_KEY`·`VITE_KAKAO_CHANNEL_ID` 를 **모듈 최상위 상수**로
// 읽는다. 최상위라 `vi.stubEnv` 로 덮을 수 없어서 "개발자 PC 의 `.env.local` 이 테스트 결과를
// 바꾸는 잠복 아니냐" 는 지적이 있었다(세션555 검사관). 실측해 보니 **아니다.**
//
// 모듈 상수를 직접 `"DUMMY_KEY"` 와 `""` 로 바꿔 각각 돌렸고 **양쪽 다 10건 통과**했다.
// 이유는 아래 `beforeEach` 가 `isInitialized` 를 항상 `true` 로 모킹하기 때문이다.
// 키를 읽는 자리는 **두 곳**인데 조건이 같다 — `useShare.ts:25`(공유 시점 재시도)와
// `useShare.ts:94`(마운트 useEffect) 둘 다
// `if (KAKAO_JS_KEY && window.Kakao && !window.Kakao.isInitialized())` 라서
// `!true` 로 막혀 **키를 읽는 줄에 애초에 도달하지 않는다.**
// 아래 "defer 로드 대응" 테스트도 같은 `kakao` 객체를 다시 붙이므로 마찬가지다.
//
// ⚠️ 그래서 이 안전은 **`isInitialized: true` 모킹에 의존한다.** 그 모킹을 바꾸거나
//    `init` 분기를 지나는 테스트를 새로 넣으면 그때부터는 키에 흔들린다 —
//    그 경우 `vi.mock("./useShare", …)` 이나 주입 방식으로 격리해야 한다.
describe("useShare", () => {
  /** @type {import('vitest').Mock} */
  let showToast;
  /** @type {any} */
  let kakao;

  beforeEach(() => {
    showToast = vi.fn();
    vi.restoreAllMocks();
    // Kakao SDK 모킹 (any cast — vi.fn() 시그니처 정합 노력 0, test mock 본질)
    kakao = {
      isInitialized: vi.fn().mockReturnValue(true),
      init: vi.fn(),
      Share: {
        sendDefault: vi.fn(),
      },
    };
    window.Kakao = kakao;
  });

  it("초기 상태: shareSheet 닫힘", () => {
    const { result } = renderHook(() => useShare(showToast));
    expect(result.current.shareSheetOpen).toBe(false);
    expect(result.current.shareData).toBeNull();
  });

  it("openShareSheet → 열림 + 데이터 설정", () => {
    const { result } = renderHook(() => useShare(showToast));
    const data = { title: "테스트", text: "내용", url: "https://test.com" };
    act(() => {
      result.current.openShareSheet(data);
    });
    expect(result.current.shareSheetOpen).toBe(true);
    expect(result.current.shareData).toEqual(data);
  });

  it("closeShareSheet → 닫힘", () => {
    const { result } = renderHook(() => useShare(showToast));
    act(() => {
      result.current.openShareSheet({ title: "t", text: "x", url: "u" });
    });
    act(() => {
      result.current.closeShareSheet();
    });
    expect(result.current.shareSheetOpen).toBe(false);
  });

  it("shareKakao: SDK 미초기화 → 토스트", () => {
    kakao.isInitialized.mockReturnValue(false);
    const { result } = renderHook(() => useShare(showToast));
    act(() => {
      result.current.openShareSheet({ title: "t", text: "x", url: "u" });
    });
    act(() => {
      result.current.shareKakao();
    });
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining("카카오 SDK"));
  });

  it("shareKakao: shareData=null → 무시", () => {
    const { result } = renderHook(() => useShare(showToast));
    act(() => {
      result.current.shareKakao();
    });
    expect(kakao.Share.sendDefault).not.toHaveBeenCalled();
  });

  it("shareKakao: 정상 호출", () => {
    const { result } = renderHook(() => useShare(showToast));
    act(() => {
      result.current.openShareSheet({ title: "아파트", text: "분석", url: "https://x.com" });
    });
    act(() => {
      result.current.shareKakao();
    });
    expect(kakao.Share.sendDefault).toHaveBeenCalled();
    expect(result.current.shareSheetOpen).toBe(false);
  });

  // 세션 465 defer 대응: 마운트 시점에 SDK 부재(마운트 init effect 미발동)여도
  // 공유 시점 가드가 call-time 상태를 보므로 SDK 도착 후 공유는 정상 동작
  it("shareKakao: 마운트 때 SDK 부재 → 공유 시점 도착이면 정상 공유 (defer 로드 대응)", () => {
    delete window.Kakao;
    const { result } = renderHook(() => useShare(showToast));
    window.Kakao = kakao; // defer 스크립트 로드 완료 시뮬
    act(() => {
      result.current.openShareSheet({ title: "t", text: "x", url: "https://x.com" });
    });
    act(() => {
      result.current.shareKakao();
    });
    expect(kakao.Share.sendDefault).toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalledWith(expect.stringContaining("카카오 SDK"));
  });

  it("shareCopy: clipboard 성공 → 토스트", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    const { result } = renderHook(() => useShare(showToast));
    act(() => {
      result.current.openShareSheet({ title: "t", text: "x", url: "https://test.com" });
    });
    await act(async () => {
      await result.current.shareCopy();
    });
    expect(showToast).toHaveBeenCalledWith("링크가 복사되었습니다");
  });

  it("shareCopy: shareData=null → 무시", async () => {
    const { result } = renderHook(() => useShare(showToast));
    await act(async () => {
      await result.current.shareCopy();
    });
    expect(showToast).not.toHaveBeenCalled();
  });

  it("shareSMS: shareData=null → 무시", () => {
    const { result } = renderHook(() => useShare(showToast));
    act(() => {
      result.current.shareSMS();
    });
    // window.location.href 변경 없음 확인
  });
});
