/**
 * useKeyboardShortcuts 훅 테스트
 *
 * 데스크톱 키보드 단축키 훅의 동작을 검증합니다.
 * - 숫자 1~5: 프로필 전환 (PROFILES 키 순서)
 * - Ctrl/Meta+Z: undo / Ctrl/Meta+Shift+Z 또는 Ctrl/Meta+Y: redo
 * - Escape: 상세 모달 닫기
 * - isDesktop=false 시 비활성 / INPUT·TEXTAREA·SELECT 포커스 시 무시
 */
// @ts-check
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";
import { PROFILES } from "@/constants/profiles";

const PROFILE_KEYS = Object.keys(PROFILES); // [live, invest, newlywed, edu, retire]

/**
 * keydown 이벤트를 document 에 디스패치한다.
 * @param {string} key
 * @param {KeyboardEventInit} [opts]
 */
function press(key, opts = {}) {
  document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts }));
}

/** 기본 args 를 만든다. 개별 테스트는 override 로 일부만 교체. */
function makeArgs(override = {}) {
  return {
    isDesktop: true,
    setProfile: vi.fn(),
    canUndo: true,
    canRedo: true,
    undo: vi.fn(),
    redo: vi.fn(),
    detail: { detailAptId: null, setDetailAptId: vi.fn() },
    ...override,
  };
}

describe("useKeyboardShortcuts", () => {
  beforeEach(() => {
    // 포커스 상태 초기화 — activeElement 가 BODY 가 되도록
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  afterEach(() => {
    document.body.replaceChildren();
  });

  // 숫자 1~5 → 해당 인덱스 프로필 전환
  it("숫자 1~5 키로 프로필을 전환한다", () => {
    const args = makeArgs();
    renderHook(() => useKeyboardShortcuts(args));

    press("1");
    expect(args.setProfile).toHaveBeenCalledWith(PROFILE_KEYS[0]);

    press("5");
    expect(args.setProfile).toHaveBeenCalledWith(PROFILE_KEYS[4]);
  });

  // Ctrl+Z → undo (canUndo=true)
  it("Ctrl+Z 로 undo 를 호출한다", () => {
    const args = makeArgs();
    renderHook(() => useKeyboardShortcuts(args));

    press("z", { ctrlKey: true });
    expect(args.undo).toHaveBeenCalledTimes(1);
  });

  // Meta+Z 도 동일하게 undo (macOS)
  it("Meta+Z 로도 undo 를 호출한다", () => {
    const args = makeArgs();
    renderHook(() => useKeyboardShortcuts(args));

    press("z", { metaKey: true });
    expect(args.undo).toHaveBeenCalledTimes(1);
  });

  // Ctrl+Shift+Z → redo
  it("Ctrl+Shift+Z 로 redo 를 호출한다", () => {
    const args = makeArgs();
    renderHook(() => useKeyboardShortcuts(args));

    press("z", { ctrlKey: true, shiftKey: true });
    expect(args.redo).toHaveBeenCalledTimes(1);
    expect(args.undo).not.toHaveBeenCalled();
  });

  // Ctrl+Y → redo
  it("Ctrl+Y 로 redo 를 호출한다", () => {
    const args = makeArgs();
    renderHook(() => useKeyboardShortcuts(args));

    press("y", { ctrlKey: true });
    expect(args.redo).toHaveBeenCalledTimes(1);
  });

  // canUndo=false 면 undo 미호출
  it("canUndo=false 면 Ctrl+Z 가 undo 를 호출하지 않는다", () => {
    const args = makeArgs({ canUndo: false });
    renderHook(() => useKeyboardShortcuts(args));

    press("z", { ctrlKey: true });
    expect(args.undo).not.toHaveBeenCalled();
  });

  // Escape → 상세 모달 닫기 (detailAptId 있을 때만)
  it("상세 모달이 열려 있으면 Escape 로 닫는다", () => {
    const setDetailAptId = vi.fn();
    const args = makeArgs({ detail: { detailAptId: "apt-1", setDetailAptId } });
    renderHook(() => useKeyboardShortcuts(args));

    press("Escape");
    expect(setDetailAptId).toHaveBeenCalledWith(null);
  });

  // 상세 모달이 닫혀 있으면 Escape 무시
  it("상세 모달이 닫혀 있으면 Escape 가 아무 동작도 안 한다", () => {
    const setDetailAptId = vi.fn();
    const args = makeArgs({ detail: { detailAptId: null, setDetailAptId } });
    renderHook(() => useKeyboardShortcuts(args));

    press("Escape");
    expect(setDetailAptId).not.toHaveBeenCalled();
  });

  // isDesktop=false → 리스너 미등록
  it("isDesktop=false 면 단축키가 비활성화된다", () => {
    const args = makeArgs({ isDesktop: false });
    renderHook(() => useKeyboardShortcuts(args));

    press("1");
    press("z", { ctrlKey: true });
    expect(args.setProfile).not.toHaveBeenCalled();
    expect(args.undo).not.toHaveBeenCalled();
  });

  // INPUT 포커스 시 단축키 무시
  it("INPUT 에 포커스가 있으면 단축키를 무시한다", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    const args = makeArgs();
    renderHook(() => useKeyboardShortcuts(args));

    press("1");
    expect(args.setProfile).not.toHaveBeenCalled();
  });

  // unmount 시 리스너 제거 — 이후 키 입력 무반응
  it("unmount 후에는 키 입력에 반응하지 않는다", () => {
    const args = makeArgs();
    const { unmount } = renderHook(() => useKeyboardShortcuts(args));

    unmount();
    press("1");
    expect(args.setProfile).not.toHaveBeenCalled();
  });
});
