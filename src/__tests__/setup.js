/* 글로벌 테스트 셋업 — localStorage, sessionStorage, fetch, matchMedia 등 브라우저 API 모킹 */
import { vi } from "vitest";
// jsdom 환경에서만 jest-dom 확장 로드 (node 환경에서는 건너뜀)
if (typeof window !== "undefined") {
  await import("@testing-library/jest-dom");
}

// localStorage / sessionStorage 모킹 (jsdom 기본 제공하지만 안전장치)
if (!globalThis.localStorage) {
  const store = {};
  globalThis.localStorage = {
    getItem: vi.fn((k) => store[k] ?? null),
    setItem: vi.fn((k, v) => {
      store[k] = String(v);
    }),
    removeItem: vi.fn((k) => {
      delete store[k];
    }),
    clear: vi.fn(() => Object.keys(store).forEach((k) => delete store[k])),
  };
}

// matchMedia 폴리필 (jsdom에 없음, node 환경에서는 건너뜀)
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

// IntersectionObserver 폴리필
if (!globalThis.IntersectionObserver) {
  globalThis.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// ResizeObserver 폴리필
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// scrollTo 폴리필 (node 환경에서는 건너뜀)
if (typeof window !== "undefined" && !window.scrollTo) {
  window.scrollTo = vi.fn();
}
