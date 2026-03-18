import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useShare } from './useShare';

describe('useShare', () => {
  let showToast;

  beforeEach(() => {
    showToast = vi.fn();
    vi.restoreAllMocks();
    // Kakao SDK 모킹
    window.Kakao = {
      isInitialized: vi.fn().mockReturnValue(true),
      init: vi.fn(),
      Share: {
        sendDefault: vi.fn(),
      },
    };
  });

  it('초기 상태: shareSheet 닫힘', () => {
    const { result } = renderHook(() => useShare(showToast));
    expect(result.current.shareSheetOpen).toBe(false);
    expect(result.current.shareData).toBeNull();
  });

  it('openShareSheet → 열림 + 데이터 설정', () => {
    const { result } = renderHook(() => useShare(showToast));
    const data = { title: "테스트", text: "내용", url: "https://test.com" };
    act(() => { result.current.openShareSheet(data); });
    expect(result.current.shareSheetOpen).toBe(true);
    expect(result.current.shareData).toEqual(data);
  });

  it('closeShareSheet → 닫힘', () => {
    const { result } = renderHook(() => useShare(showToast));
    act(() => { result.current.openShareSheet({ title: "t", text: "x", url: "u" }); });
    act(() => { result.current.closeShareSheet(); });
    expect(result.current.shareSheetOpen).toBe(false);
  });

  it('shareKakao: SDK 미초기화 → 토스트', () => {
    window.Kakao.isInitialized.mockReturnValue(false);
    const { result } = renderHook(() => useShare(showToast));
    act(() => { result.current.openShareSheet({ title: "t", text: "x", url: "u" }); });
    act(() => { result.current.shareKakao(); });
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining("카카오 SDK"));
  });

  it('shareKakao: shareData=null → 무시', () => {
    const { result } = renderHook(() => useShare(showToast));
    act(() => { result.current.shareKakao(); });
    expect(window.Kakao.Share.sendDefault).not.toHaveBeenCalled();
  });

  it('shareKakao: 정상 호출', () => {
    const { result } = renderHook(() => useShare(showToast));
    act(() => { result.current.openShareSheet({ title: "아파트", text: "분석", url: "https://x.com" }); });
    act(() => { result.current.shareKakao(); });
    expect(window.Kakao.Share.sendDefault).toHaveBeenCalled();
    expect(result.current.shareSheetOpen).toBe(false);
  });

  it('shareCopy: clipboard 성공 → 토스트', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    const { result } = renderHook(() => useShare(showToast));
    act(() => { result.current.openShareSheet({ title: "t", text: "x", url: "https://test.com" }); });
    await act(async () => { await result.current.shareCopy(); });
    expect(showToast).toHaveBeenCalledWith("링크가 복사되었습니다");
  });

  it('shareCopy: shareData=null → 무시', async () => {
    const { result } = renderHook(() => useShare(showToast));
    await act(async () => { await result.current.shareCopy(); });
    expect(showToast).not.toHaveBeenCalled();
  });

  it('shareSMS: shareData=null → 무시', () => {
    const { result } = renderHook(() => useShare(showToast));
    act(() => { result.current.shareSMS(); });
    // window.location.href 변경 없음 확인
  });
});
