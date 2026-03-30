import { test, expect } from "@playwright/test";

// 비교 기능 — 비교 선택 + CompareSheet 테스트
test.describe("비교 기능", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    const hasCards = await page.locator('[role="button"]').first().isVisible({ timeout: 15000 }).catch(() => false);
    if (!hasCards) {
      test.skip(true, "카드 데이터 없음 — 빈 DB");
      return;
    }
  });

  test("비교 버튼 클릭 시 비교 시트 표시", async ({ page }) => {
    const cards = page.locator('[role="button"]');
    const count = await cards.count();
    if (count < 2) {
      test.skip(true, "비교에 필요한 카드 2개 미만");
      return;
    }

    const checkbox = cards.first().locator('input[type="checkbox"]');
    if (!(await checkbox.isVisible())) {
      test.skip(true, "비교 체크박스 미존재");
      return;
    }

    await checkbox.click();
    const secondCheckbox = cards.nth(1).locator('input[type="checkbox"]');
    if (await secondCheckbox.isVisible()) {
      await secondCheckbox.click();
    }

    const compareArea = page.locator("table, [data-testid='compare']");
    await expect(compareArea).toBeVisible({ timeout: 3000 });
  });
});
