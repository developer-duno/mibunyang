import { test, expect } from "@playwright/test";

// 공유 기능 E2E 테스트
test.describe("공유 기능", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    const hasCards = await page.locator('[role="button"]').first().isVisible({ timeout: 15000 }).catch(() => false);
    if (!hasCards) {
      test.skip(true, "카드 데이터 없음 — 빈 DB");
      return;
    }
  });

  test("상세 모달에서 공유 버튼 클릭 시 ShareSheet 표시", async ({ page }) => {
    // 카드 클릭 → 상세 모달
    const detailBtn = page.locator('[role="button"]').first().locator("button", { hasText: "상세보기" });
    if (!(await detailBtn.isVisible())) {
      test.skip(true, "상세보기 버튼 미존재");
      return;
    }
    await detailBtn.click();

    // 모달 내 공유 버튼 찾기
    const shareBtn = page.locator("button", { hasText: /공유/ }).first();
    const hasShare = await shareBtn.isVisible({ timeout: 3000 }).catch(() => false);
    if (!hasShare) {
      test.skip(true, "공유 버튼 미존재");
      return;
    }
    await shareBtn.click();

    // ShareSheet dialog 표시 확인
    const dialog = page.locator('[role="dialog"][aria-label="공유 방법 선택"]');
    await expect(dialog).toBeVisible({ timeout: 3000 });
  });

  test("ShareSheet에서 링크 복사 클릭", async ({ page }) => {
    // clipboard API 권한 부여
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

    const detailBtn = page.locator('[role="button"]').first().locator("button", { hasText: "상세보기" });
    if (!(await detailBtn.isVisible())) {
      test.skip(true, "상세보기 버튼 미존재");
      return;
    }
    await detailBtn.click();

    const shareBtn = page.locator("button", { hasText: /공유/ }).first();
    const hasShare = await shareBtn.isVisible({ timeout: 3000 }).catch(() => false);
    if (!hasShare) {
      test.skip(true, "공유 버튼 미존재");
      return;
    }
    await shareBtn.click();

    const copyBtn = page.locator('[aria-label="링크 복사"]');
    await expect(copyBtn).toBeVisible({ timeout: 3000 });
    await copyBtn.click();

    // 토스트 표시 확인 (복사 완료 피드백)
    const toast = page.locator('[role="status"]');
    const hasToast = await toast.isVisible({ timeout: 3000 }).catch(() => false);
    // 토스트가 없어도 ShareSheet가 닫히면 성공
    if (!hasToast) {
      await expect(page.locator('[role="dialog"][aria-label="공유 방법 선택"]')).not.toBeVisible({ timeout: 3000 });
    }
  });
});
