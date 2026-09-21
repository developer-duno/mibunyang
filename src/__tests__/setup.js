/* 글로벌 테스트 셋업 — localStorage, sessionStorage, fetch, matchMedia 등 브라우저 API 모킹 */
import { vi, beforeEach } from "vitest";
// jsdom 환경에서만 jest-dom 확장 로드 (node 환경에서는 건너뜀)
if (typeof window !== "undefined") {
  await import("@testing-library/jest-dom");
}

// 기능깃발 기본 OFF 고정 — 개발자 PC 의 .env.local 이 테스트 결과를 바꾸지 못하게 한다.
// 깃발이 켜진 PC 에서는 같은 코드가 12건 red, CI(깃발 없음)에서는 green 이라 "진짜 회귀인지
// 내 설정 탓인지"를 매번 다시 가려야 했다(세션555). ON 경로가 필요한 테스트는 지금도
// 각자 vi.stubEnv 로 켠다 — 그 호출이 이 기본값을 덮으므로 기존 테스트는 그대로 동작한다.
//
// ⚠️ beforeEach 로 매번 다시 걸어야 한다. 파일 최상위에서 한 번만 걸면
// vi.unstubAllEnvs()(ON 테스트의 뒷정리)가 이 기본값까지 통째로 걷어내, 그 뒤 테스트가
// 다시 .env.local 의 실제 값을 보게 된다(세션555 실측: 그 상태로 3건 잔존).
beforeEach(() => {
  vi.stubEnv("VITE_FEATURE_HOME", "");
  vi.stubEnv("VITE_FEATURE_UPCOMING", "");
});

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
