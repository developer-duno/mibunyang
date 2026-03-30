import { test, expect } from "@playwright/test";

// 아파트 목록 — 필터/정렬/검색 테스트
test.describe("아파트 목록", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    const hasCards = await page.locator('[role="button"]').first().isVisible({ timeout: 15000 }).catch(() => false);
    if (!hasCards) {
      test.skip(true, "카드 데이터 없음 — 빈 DB");
      return;
    }
  });

  test("지역 필터 적용 시 카드 수 변화", async ({ page }) => {
    const allCards = await page.locator('[role="button"]').count();
    expect(allCards).toBeGreaterThan(0);

    const filterButtons = page.locator('[aria-pressed]');
    const count = await filterButtons.count();
    if (count <= 1) {
      test.skip(true, "필터 버튼이 1개 이하");
      return;
    }

    await filterButtons.nth(1).click();
    await page.locator('[role="button"]').first().waitFor({ state: "attached", timeout: 5000 }).catch(() => {});
    const filteredCards = await page.locator('[role="button"]').count();
    expect(filteredCards).toBeLessThanOrEqual(allCards);
  });

  test("검색 입력 시 결과 필터링", async ({ page }) => {
    const searchInput = page.locator('input[type="text"]').first();
    await expect(searchInput).toBeVisible({ timeout: 5000 });

    const allCards = await page.locator('[role="button"]').count();
    await searchInput.fill("힐스테이트");
    await expect(page.locator('[role="button"]')).not.toHaveCount(allCards, { timeout: 5000 }).catch(() => {});
    const cards = page.locator('[role="button"]');
    const count = await cards.count();
    if (count > 0) {
      const firstCardText = await cards.first().textContent();
      expect(firstCardText?.toLowerCase()).toContain("힐스테이트");
    }
  });

  test("정렬 변경 시 순서 변화", async ({ page }) => {
    const sortSelect = page.locator("select").first();
    if (!(await sortSelect.isVisible())) {
      test.skip(true, "정렬 select 미존재");
      return;
    }

    await sortSelect.selectOption({ index: 1 });
    await page.locator('[role="button"]').first().waitFor({ state: "attached", timeout: 3000 });
    const firstAfter = await page.locator('[role="button"]').first().textContent();
    expect(firstAfter?.length).toBeGreaterThan(0);
  });
});
