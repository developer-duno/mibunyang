import { track } from "@vercel/analytics";

/**
 * 벤더 격리 래퍼 — @vercel/analytics 의존성을 이 파일에 한정.
 * 정적 함수이므로 useCallback 의존성 배열에 추가 불필요.
 */
export function trackEvent(name, props) {
  if (!name) return;
  try { track(name, props); } catch (e) { console.warn("[analytics]", e); }
}
