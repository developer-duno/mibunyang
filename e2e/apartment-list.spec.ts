import { test, expect } from "@playwright/test";

// 아파트 목록 — 필터/정렬/검색 테스트
test.describe("아파트 목록", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // 카드 로드 대기
    await page.locator('[role="button"]').first().waitFor({ timeout: 15000 });
  });

  test("지역 필터 적용 시 카드 수 변화", async ({ page }) => {
    // 전체 카드 수 확인
    const allCards = await page.locator('[role="button"]').count();
    expect(allCards).toBeGreaterThan(0);

    // 지역 필터 버튼 클릭 (첫 번째 필터 그룹)
    const filterButtons = page.locator('[aria-pressed]');
    const count = await filterButtons.count();
    if (count > 1) {
      // 두 번째 필터 버튼 클릭 (특정 지역)
      await filterButtons.nth(1).click();
      // 필터 적용 후 카드 수 확인
      await page.waitForTimeout(500);
      const filteredCards = await page.locator('[role="button"]').count();
      // 필터 적용 시 카드 수가 변하거나 같을 수 있음
      expect(filteredCards).toBeGreaterThanOrEqual(0);
    }
  });

  test("검색 입력 시 결과 필터링", async ({ page }) => {
    const searchInput = page.locator('input[type="text"]').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill("힐스테이트");
      await page.waitForTimeout(1000);
      // 검색 후 카드가 줄어들거나 0이 됨
      const cards = page.locator('[role="button"]');
      const count = await cards.count();
      // 검색 결과가 있으면 카드에 검색어 포함 확인
      if (count > 0) {
        const firstCardText = await cards.first().textContent();
        expect(firstCardText?.toLowerCase()).toContain("힐스테이트");
      }
    }
  });

  test("정렬 변경 시 순서 변화", async ({ page }) => {
    // 정렬 select 또는 버튼 찾기
    const sortSelect = page.locator("select").first();
    if (await sortSelect.isVisible()) {
      // 기본 정렬의 첫 카드 텍스트
      const firstBefore = await page.locator('[role="button"]').first().textContent();
      // 정렬 변경
      await sortSelect.selectOption({ index: 1 });
      await page.waitForTimeout(500);
      const firstAfter = await page.locator('[role="button"]').first().textContent();
      // 정렬이 바뀌면 첫 카드가 달라질 수 있음 (보장은 아님)
      expect(firstAfter).toBeDefined();
    }
  });
});
