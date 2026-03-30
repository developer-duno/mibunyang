import { test, expect } from "@playwright/test";

// 전문가 페이지 — 탭 전환 + 대시보드 렌더링 테스트
test.describe("전문가 페이지", () => {
  test("전문가 탭 클릭 시 로그인 폼 또는 대시보드 표시", async ({ page }) => {
    await page.goto("/");
    await page.locator('[role="button"]').first().waitFor({ timeout: 15000 });

    // 전문가 탭 찾기 (하단 네비게이션 또는 상단 바)
    const expertTab = page.getByText("전문가", { exact: false });
    if (await expertTab.isVisible()) {
      await expertTab.click();
      await page.waitForTimeout(1000);

      // 로그인 폼 또는 대시보드 중 하나가 보여야 함
      const loginForm = page.locator('input[type="email"], input[type="password"]');
      const dashboard = page.getByText("데이터 완성도", { exact: false });

      const hasLogin = await loginForm.first().isVisible().catch(() => false);
      const hasDashboard = await dashboard.isVisible().catch(() => false);

      expect(hasLogin || hasDashboard).toBeTruthy();
    }
  });

  test("정보 탭에서 스코어링 설명 표시", async ({ page }) => {
    await page.goto("/");
    await page.locator('[role="button"]').first().waitFor({ timeout: 15000 });

    // 정보 탭 클릭
    const infoTab = page.getByText("정보", { exact: true });
    if (await infoTab.isVisible()) {
      await infoTab.click();
      await page.waitForTimeout(500);

      // 스코어링 관련 텍스트 확인
      const scoring = page.getByText("스코어링", { exact: false });
      await expect(scoring.first()).toBeVisible({ timeout: 3000 });
    }
  });
});
