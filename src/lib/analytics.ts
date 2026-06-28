import { track } from "@vercel/analytics";

/**
 * 벤더 격리 래퍼 — @vercel/analytics 의존성을 이 파일에 한정.
 * 정적 함수이므로 useCallback 의존성 배열에 추가 불필요.
 * props 의 unknown 값은 string 으로 normalize (vercel/analytics AllowedPropertyValues 정합).
 */
type TrackValue = string | number | boolean | null | undefined;

export function trackEvent(name: string, props?: Record<string, unknown>): void {
  if (!name) return;
  try {
    if (props) {
      const normalized: Record<string, TrackValue> = {};
      for (const [k, v] of Object.entries(props)) {
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null) {
          normalized[k] = v;
        } else if (v !== undefined) {
          normalized[k] = String(v);
        }
      }
      track(name, normalized);
    } else {
      track(name);
    }
  } catch (e) {
    console.warn("[analytics]", e);
  }
}
