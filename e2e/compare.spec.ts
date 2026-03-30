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
      test.skip(true, "비교에 필요한 카드 2개 미만");
      return;
    }

    const firstCard = cards.first();
    const checkbox = firstCard.locator('input[type="checkbox"]');
    if (!(await checkbox.isVisible())) {
      test.skip(true, "비교 체크박스 미존재");
      return;
    }

    await checkbox.click();
    const secondCheckbox = cards.nth(1).locator('input[type="checkbox"]');
    if (await secondCheckbox.isVisible()) {
      await secondCheckbox.click();
    }

    // 비교 시트/테이블 영역이 나타나야 함
    const compareArea = page.locator("table, [data-testid='compare']");
    await expect(compareArea).toBeVisible({ timeout: 3000 });
  });
});
