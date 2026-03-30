import { test, expect } from "@playwright/test";

// 전문가 페이지 — 탭 전환 + 대시보드 렌더링 테스트
test.describe("전문가 페이지", () => {
  test("전문가 탭 클릭 시 로그인 폼 또는 대시보드 표시", async ({ page }) => {
    await page.goto("/");
    await page.locator('[role="button"]').first().waitFor({ timeout: 15000 });

    const expertTab = page.getByText("전문가", { exact: false });
    if (!(await expertTab.isVisible())) {
      test.skip(true, "전문가 탭 미존재");
      return;
    }

    await expertTab.click();

    // 로그인 폼 또는 대시보드 중 하나가 보여야 함
    const loginForm = page.locator('input[type="email"], input[type="password"]');
    const dashboard = page.getByText("데이터 완성도", { exact: false });

    await expect(loginForm.first().or(dashboard)).toBeVisible({ timeout: 5000 });
  });

  test("정보 탭에서 스코어링 설명 표시", async ({ page }) => {
    await page.goto("/");
    await page.locator('[role="button"]').first().waitFor({ timeout: 15000 });

    const infoTab = page.getByText("정보", { exact: true });
    if (!(await infoTab.isVisible())) {
      test.skip(true, "정보 탭 미존재");
      return;
    }

    await infoTab.click();
    const scoring = page.getByText("스코어링", { exact: false });
    await expect(scoring.first()).toBeVisible({ timeout: 3000 });
  });
});
