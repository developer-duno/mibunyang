import type { Page } from "@playwright/test";

/**
 * VITE_FEATURE_HOME ON 이면 초기 탭이 홈 — 목록 검증 spec 은 목록 탭으로 이동 (OFF 면 no-op).
 * 홈 버튼은 데스크톱 헤더/모바일 BottomNav 양쪽 모두 getByRole 로 잡힘.
 */
export async function gotoListTab(page: Page): Promise<void> {
  const homeBtn = page.getByRole("button", { name: "홈" }).first();
  if (await homeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await page.getByRole("button", { name: "목록" }).first().click();
  }
}
