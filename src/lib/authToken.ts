/**
 * 인증 토큰 localStorage 키 접근 + 옛 키 자동 이관 (세션 426).
 *
 * 키 이름이 "expertToken" → "authToken" 으로 바뀌었다(세션 405 전문가 role 폐지 후 역사적 이름 정리).
 * 키만 바꾸면 기존 로그인 세션이 끊기므로, 앱 첫 마운트 시 옛 키의 토큰을 새 키로 1회 이관한다.
 *
 * - `getAuthToken()`: 부트스트랩 3곳(App 초기 tab·useAuth 초기 state·useAdminMode 초기 state)에서만 호출.
 *   첫 진입 시 옛 expertToken(localStorage→sessionStorage)을 authToken 으로 옮기고 옛 키를 제거한다.
 * - 로그인 후 매번 토큰을 읽는 곳(fetchUsers 등)은 이관이 이미 끝났으므로 `localStorage.getItem(TOKEN_KEY)` 로 충분.
 * - 옛 키 이관 코드는 충분한 시간(전 사용자 재방문) 후 제거 가능.
 */

export const TOKEN_KEY = "authToken";
const LEGACY_TOKEN_KEY = "expertToken"; // 세션 405 이전 역사적 키 — 자동 이관 후 제거 예정

/**
 * 새 키(authToken) 우선 반환. 없으면 옛 키(expertToken, localStorage→sessionStorage)를
 * authToken 으로 1회 이관한 뒤 반환. userRole 도 함께 이관. 둘 다 없으면 null.
 */
export function getAuthToken(): string | null {
  try {
    const current = localStorage.getItem(TOKEN_KEY);
    if (current) return current;

    const legacy = localStorage.getItem(LEGACY_TOKEN_KEY) ?? sessionStorage.getItem(LEGACY_TOKEN_KEY);
    if (!legacy) return null;

    // 옛 키 → 새 키 1회 이관
    localStorage.setItem(TOKEN_KEY, legacy);
    const role = localStorage.getItem("userRole") ?? sessionStorage.getItem("userRole");
    if (role) localStorage.setItem("userRole", role);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
    sessionStorage.removeItem(LEGACY_TOKEN_KEY);
    sessionStorage.removeItem("userRole");
    return legacy;
  } catch {
    return null;
  }
}

/** 로그아웃 시 새 키 + 옛 키 잔재 전부 청소 (양쪽 storage). */
export function clearAuthTokens(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
    localStorage.removeItem("userRole");
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(LEGACY_TOKEN_KEY);
    sessionStorage.removeItem("userRole");
  } catch {
    /* storage 접근 실패 시 무시 */
  }
}
