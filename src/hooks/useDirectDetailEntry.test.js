// @ts-check
import { describe, it, expect, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useDirectDetailEntry } from "./useDirectDetailEntry";

/** @typedef {{ detailAptId: string | null, dataLoading: boolean, dataError: unknown, found: boolean }} P */
/** @param {P} p */
const useRun = (p) => useDirectDetailEntry(p);
/** @param {string | null} detailAptId @param {boolean} dataLoading @param {unknown} dataError @param {boolean} found @returns {P} */
const P = (detailAptId, dataLoading, dataError, found) => ({ detailAptId, dataLoading, dataError, found });

describe("useDirectDetailEntry (세션641)", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("첫 주소가 / 면 꺼져 있다", () => {
    const { result } = renderHook(useRun, {
      initialProps: P(null, true, null, false),
    });
    expect(result.current).toBe(false);
  });

  it("/apt/{id} 와 옛 ?detail= 은 켠다", () => {
    window.history.replaceState(null, "", "/apt/a1");
    const a = renderHook(useRun, { initialProps: P(null, true, null, false) });
    expect(a.result.current).toBe(true);
    window.history.replaceState(null, "", "/?detail=a1");
    const b = renderHook(useRun, { initialProps: P(null, true, null, false) });
    expect(b.result.current).toBe(true);
  });

  it("받는 중엔 그 단지가 아직 없어도 켜진 채", () => {
    window.history.replaceState(null, "", "/apt/a1");
    const { result } = renderHook(useRun, {
      initialProps: P("a1", true, null, false),
    });
    expect(result.current).toBe(true);
  });

  it("열렸다 닫히면 끄고, 다시 열어도 안 켜진다", () => {
    window.history.replaceState(null, "", "/apt/a1");
    const { result, rerender } = renderHook(useRun, {
      initialProps: P("a1", false, null, true),
    });
    expect(result.current).toBe(true);
    rerender(P(null, false, null, false));
    expect(result.current).toBe(false);
    rerender(P("a1", false, null, true));
    expect(result.current).toBe(false);
  });

  it("다 받았는데 그 단지가 없으면 끈다", () => {
    window.history.replaceState(null, "", "/apt/nope");
    const { result, rerender } = renderHook(useRun, {
      initialProps: P("nope", true, null, false),
    });
    expect(result.current).toBe(true);
    rerender(P("nope", false, null, false));
    expect(result.current).toBe(false);
  });

  it("받기에 실패하면 끈다", () => {
    window.history.replaceState(null, "", "/apt/a1");
    const { result, rerender } = renderHook(useRun, {
      initialProps: P("a1", true, null, false),
    });
    // found:true 로 둔다 — "못 찾음" 조건과 갈라 실패 조건 하나만 지키는지 본다
    rerender(P("a1", false, new Error("x"), true));
    expect(result.current).toBe(false);
  });

  it("다 받았고 그 단지가 있으면 켜진 채", () => {
    window.history.replaceState(null, "", "/apt/a1");
    const { result, rerender } = renderHook(useRun, {
      initialProps: P("a1", true, null, false),
    });
    rerender(P("a1", false, null, true));
    expect(result.current).toBe(true);
  });
});
