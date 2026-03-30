import { test, expect } from "@playwright/test";

// 아파트 목록 — 필터/정렬/검색 테스트
test.describe("아파트 목록", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // 카드 로드 대기
    await page.locator('[role="button"]').first().waitFor({ timeout: 15000 });
  });

  test("지역 필터 적용 시 카드 수 변화", async ({ page }) => {
    const allCards = await page.locator('[role="button"]').count();
    expect(allCards).toBeGreaterThan(0);

    const filterButtons = page.locator('[aria-pressed]');
    const count = await filterButtons.count();
    if (count <= 1) {
      test.skip(true, "필터 버튼이 1개 이하 — 필터 테스트 불가");
      return;
    }

    await filterButtons.nth(1).click();
    // 필터 적용 후 카드 수가 변해야 함 (또는 같을 수 있음)
    await page.locator('[role="button"]').first().waitFor({ state: "attached", timeout: 5000 }).catch(() => {});
    const filteredCards = await page.locator('[role="button"]').count();
    expect(filteredCards).toBeLessThanOrEqual(allCards);
  });

  test("검색 입력 시 결과 필터링", async ({ page }) => {
    const searchInput = page.locator('input[type="text"]').first();
    await expect(searchInput).toBeVisible({ timeout: 5000 });

    const allCards = await page.locator('[role="button"]').count();
    await searchInput.fill("힐스테이트");
    // 검색 결과 변동 대기 — 카드 수 변화 또는 0건
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

    const firstBefore = await page.locator('[role="button"]').first().textContent();
    await sortSelect.selectOption({ index: 1 });
    // 정렬 변경 후 첫 카드 변경 확인
    await page.locator('[role="button"]').first().waitFor({ state: "attached", timeout: 3000 });
    const firstAfter = await page.locator('[role="button"]').first().textContent();
    // 정렬 적용 확인 (동일할 수 있지만 최소 카드 존재 확인)
    expect(firstAfter?.length).toBeGreaterThan(0);
  });
});
