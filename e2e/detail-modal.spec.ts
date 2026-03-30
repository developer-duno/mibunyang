import { test, expect } from "@playwright/test";

// 상세 모달 — 열기/닫기/섹션 렌더링 테스트
test.describe("상세 모달", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    const hasCards = await page.locator('[role="button"]').first().isVisible({ timeout: 15000 }).catch(() => false);
    if (!hasCards) {
      test.skip(true, "카드 데이터 없음 — 빈 DB");
      return;
    }
  });

  test("카드 클릭 시 모달 열림", async ({ page }) => {
    await page.locator('[role="button"]').first().click();
    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5000 });
  });

  test("모달에 단지 정보 섹션 렌더링", async ({ page }) => {
    await page.locator('[role="button"]').first().click();
    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    const modalText = await modal.textContent();
    expect(modalText?.length).toBeGreaterThan(50);
  });

  test("닫기 버튼으로 모달 닫힘", async ({ page }) => {
    await page.locator('[role="button"]').first().click();
    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    const closeBtn = modal.locator("button").first();
    await closeBtn.click();
    await expect(modal).not.toBeVisible({ timeout: 3000 });
  });
});
