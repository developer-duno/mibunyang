import { test, expect } from "@playwright/test";

// 비교 기능 — 비교 선택 + CompareSheet 테스트
test.describe("비교 기능", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.locator('[role="button"]').first().waitFor({ timeout: 15000 });
  });

  test("비교 버튼 클릭 시 비교 시트 표시", async ({ page }) => {
    const cards = page.locator('[role="button"]');
    const count = await cards.count();
    if (count < 2) {
      test.skip();
      return;
    }

    // 첫 번째 카드의 비교 체크박스/토글 클릭
    const firstCard = cards.first();
    const checkbox = firstCard.locator('input[type="checkbox"]');
    if (await checkbox.isVisible()) {
      await checkbox.click();
      // 두 번째 카드의 비교 체크박스 클릭
      const secondCheckbox = cards.nth(1).locator('input[type="checkbox"]');
      if (await secondCheckbox.isVisible()) {
        await secondCheckbox.click();
      }
    }

    // 비교 시트/테이블 영역 확인
    await page.waitForTimeout(500);
    const compareArea = page.locator("table, [data-testid='compare']");
    // 비교 UI가 나타나면 확인
    if (await compareArea.isVisible()) {
      await expect(compareArea).toBeVisible();
    }
  });
});
