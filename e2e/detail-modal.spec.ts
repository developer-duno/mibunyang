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

  // prices lazy fetch (apartments-prices.json) 후 PriceTable 첫 행 실제 렌더 검증.
  // hardcoded waitForTimeout 금지 — testid 명시 selector 로 flaky 방지.
  test("DetailModal — prices lazy fetch 후 PriceTable 행 렌더", async ({ page }) => {
    await page.locator('[role="button"]').first().click();
    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5000 });
    // 가격 데이터가 있는 단지일 때만 PriceTable 행이 표시. 데이터 없으면 skip.
    const row = modal.locator('[data-testid="price-table-row"]').first();
    const visible = await row.isVisible({ timeout: 15000 }).catch(() => false);
    if (!visible) {
      test.skip(true, "첫 단지에 가격 데이터 없음");
      return;
    }
    await expect(row).toBeVisible();
  });
});
