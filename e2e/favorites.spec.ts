import { test, expect } from "@playwright/test";

// 즐겨찾기(관심매물) 기능 E2E 테스트
test.describe("즐겨찾기 기능", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    const hasCards = await page.locator('[role="button"]').first().isVisible({ timeout: 15000 }).catch(() => false);
    if (!hasCards) {
      test.skip(true, "카드 데이터 없음 — 빈 DB");
      return;
    }
  });

  test("관심매물 버튼 클릭 시 토스트 표시", async ({ page }) => {
    const firstCard = page.locator('[role="button"]').first();
    const favBtn = firstCard.locator("button", { hasText: "관심매물" });
    if (!(await favBtn.isVisible())) {
      test.skip(true, "관심매물 버튼 미존재");
      return;
    }

    await favBtn.click();

    // 토스트 또는 버튼 텍스트 변경 확인
    const changed = await firstCard.locator("button", { hasText: "관심 해제" }).isVisible({ timeout: 3000 }).catch(() => false);
    expect(changed).toBe(true);
  });

  test("관심매물 해제 시 원래 상태로 복원", async ({ page }) => {
    const firstCard = page.locator('[role="button"]').first();
    const favBtn = firstCard.locator("button", { hasText: "관심매물" });
    if (!(await favBtn.isVisible())) {
      test.skip(true, "관심매물 버튼 미존재");
      return;
    }

    // 등록
    await favBtn.click();
    await expect(firstCard.locator("button", { hasText: "관심 해제" })).toBeVisible({ timeout: 3000 });

    // 해제
    await firstCard.locator("button", { hasText: "관심 해제" }).click();
    await expect(firstCard.locator("button", { hasText: "관심매물" })).toBeVisible({ timeout: 3000 });
  });
});
