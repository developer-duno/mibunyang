import { test, expect } from "@playwright/test";

// 상세 모달 — 열기/닫기/섹션 렌더링 테스트
test.describe("상세 모달", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.locator('[role="button"]').first().waitFor({ timeout: 15000 });
  });

  test("카드 클릭 시 모달 열림", async ({ page }) => {
    await page.locator('[role="button"]').first().click();

    // dialog 역할 모달 확인
    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5000 });
  });

  test("모달에 단지 정보 섹션 렌더링", async ({ page }) => {
    await page.locator('[role="button"]').first().click();
    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // 모달 내부에 단지명 또는 주요 섹션 텍스트 존재
    const modalText = await modal.textContent();
    expect(modalText?.length).toBeGreaterThan(50);
  });

  test("닫기 버튼으로 모달 닫힘", async ({ page }) => {
    await page.locator('[role="button"]').first().click();
    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // IconClose 버튼 (SVG 아이콘이 있는 버튼)
    const closeBtn = modal.locator("button").first();
    await closeBtn.click();

    // 모달이 사라짐
    await expect(modal).not.toBeVisible({ timeout: 3000 });
  });
});
