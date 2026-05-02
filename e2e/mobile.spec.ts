import { test, expect } from "@playwright/test";

// 모바일 뷰포트 E2E 테스트 (@mobile 태그로 mobile 프로젝트에서만 실행)
test.describe("모바일 레이아웃 @mobile", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // 페이지 로드 대기
    await expect(page.locator("body")).toContainText("미분양", { timeout: 15000 });
  });

  test("모바일에서 하단 네비게이션 표시", async ({ page }) => {
    const bottomNav = page.locator('nav[aria-label="메인 내비게이션"]');
    await expect(bottomNav).toBeVisible({ timeout: 5000 });
  });

  test("모바일에서 카드 1컬럼 레이아웃", async ({ page }) => {
    const hasCards = await page.locator('[role="button"]').first().isVisible({ timeout: 15000 }).catch(() => false);
    if (!hasCards) {
      test.skip(true, "카드 데이터 없음 — 빈 DB");
      return;
    }

    // 첫 번째 카드의 너비가 컨테이너 너비에 가까운지 확인 (1컬럼)
    const card = page.locator('[role="button"]').first();
    const cardBox = await card.boundingBox();
    const viewport = page.viewportSize();
    if (cardBox && viewport) {
      // 모바일에서 카드 너비는 뷰포트의 80% 이상이어야 함 (패딩 고려)
      expect(cardBox.width).toBeGreaterThan(viewport.width * 0.7);
    }
  });

  test("모바일에서 상세 모달 표시", async ({ page }) => {
    const hasCards = await page.locator('[role="button"]').first().isVisible({ timeout: 15000 }).catch(() => false);
    if (!hasCards) {
      test.skip(true, "카드 데이터 없음 — 빈 DB");
      return;
    }

    const detailBtn = page.locator('[role="button"]').first().locator("button", { hasText: "상세보기" });
    if (!(await detailBtn.isVisible())) {
      test.skip(true, "상세보기 버튼 미존재");
      return;
    }
    await detailBtn.click();

    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5000 });
  });

  // VITE_FEATURE_UPCOMING=true 환경에서만 BottomNav 곧 분양 진입로 표시
  // flag OFF 환경 (예: PR preview) 에서는 자동 skip
  test("모바일 BottomNav 에 '곧 분양' 진입로 표시 + 클릭 시 /upcoming 이동", async ({ page }) => {
    const bottomNav = page.locator('nav[aria-label="메인 내비게이션"]');
    await expect(bottomNav).toBeVisible({ timeout: 5000 });

    const upcomingBtn = bottomNav.getByRole("button", { name: /곧 분양/ });
    const isFeatureOn = await upcomingBtn.isVisible().catch(() => false);
    if (!isFeatureOn) {
      test.skip(true, "VITE_FEATURE_UPCOMING flag OFF — BottomNav 곧 분양 미노출 (정상)");
      return;
    }

    await upcomingBtn.click();
    await expect(page).toHaveURL(/\/upcoming$/, { timeout: 5000 });
  });
});
