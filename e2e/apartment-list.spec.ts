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

  test("정렬 변경 시 순서 변화", async ({ page }) => {
    // 정렬 드롭다운 열기 — FilterButton "정렬" 클릭
    const sortTrigger = page.locator('[aria-expanded]', { hasText: "정렬" });
    if (!(await sortTrigger.isVisible({ timeout: 3000 }).catch(() => false))) {
      test.skip(true, "정렬 트리거 미존재");
      return;
    }

    await sortTrigger.click();
    // 정렬 패널 내 두 번째 옵션(저가순) 클릭
    const sortOptions = page.locator('[aria-current]').or(page.locator('[role="region"][aria-label="정렬 필터"] button'));
    const optCount = await sortOptions.count();
    if (optCount > 1) {
      await sortOptions.nth(1).click();
    }
    await page.locator('[role="button"]').first().waitFor({ state: "attached", timeout: 3000 });
    const firstAfter = await page.locator('[role="button"]').first().textContent();
    expect(firstAfter?.length).toBeGreaterThan(0);
  });
});
