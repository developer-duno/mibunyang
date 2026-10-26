import { test, expect } from "@playwright/test";
import { stubCiApartments } from "./helpers";

// 모바일 뷰포트 E2E 테스트 (@mobile 태그로 mobile 프로젝트에서만 실행)
test.describe("모바일 레이아웃 @mobile", () => {
  test.beforeEach(async ({ page }) => {
    await stubCiApartments(page); // CI 공용 픽스처(goto 전) — 세션664
    await page.goto("/");
    // 페이지 로드 대기
    await expect(page.locator("body")).toContainText("미분양", { timeout: 15000 });
  });

  test("모바일에서 하단 네비게이션 표시", async ({ page }) => {
    const bottomNav = page.locator('nav[aria-label="메인 내비게이션"]');
    await expect(bottomNav).toBeVisible({ timeout: 5000 });
  });

  test("모바일에서 카드 1컬럼 레이아웃", async ({ page }) => {
    const hasCards = await page
      .locator('[role="button"]')
      .first()
      .waitFor({ state: "visible", timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    expect(hasCards, "픽스처인데 카드 0 — 픽스처·가로채기 깨짐").toBe(true);

    // 첫 번째 카드의 너비가 컨테이너 너비에 가까운지 확인 (1컬럼)
    const card = page.locator('[role="button"]').first();
    const cardBox = await card.boundingBox();
    const viewport = page.viewportSize();
    // 세션664 D: 옛 `if (cardBox && viewport)` 는 둘 중 하나가 null 이면 조용히 초록 → 둘 다 단언
    expect(cardBox, "첫 카드 상자(boundingBox) 없음 — 카드가 화면에 안 그려짐").not.toBeNull();
    expect(viewport, "뷰포트 크기 없음").not.toBeNull();
    // 모바일에서 카드 너비는 뷰포트의 70% 초과여야 함 (패딩 고려)
    expect(cardBox?.width ?? 0).toBeGreaterThan((viewport?.width ?? Infinity) * 0.7);
  });

  test("모바일에서 상세 모달 표시 + 하단 바 공유 → ShareSheet", async ({ page }) => {
    const hasCards = await page
      .locator('[role="button"]')
      .first()
      .waitFor({ state: "visible", timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    expect(hasCards, "픽스처인데 카드 0 — 픽스처·가로채기 깨짐").toBe(true);

    // 세션664 C: 옛 로케이터(카드 본문 role=button 안의 버튼)는 3/30 부터 못 찾아 늘 skip → 카드 버튼 줄의 "상세보기".
    await page.getByTestId("apt-card").first().getByRole("button", { name: "상세보기" }).click();

    const modal = page.locator('[role="dialog"]').first();
    await expect(modal).toBeVisible({ timeout: 5000 });
    // 휴대폰 폭은 하단 고정 바(detail-cta-bar)에 공유 버튼(DetailModal.tsx:1031 aria-label) → ShareSheet
    await modal.getByTestId("detail-cta-bar").getByRole("button", { name: "이 단지 공유하기" }).click();
    await expect(page.locator('[role="dialog"][aria-label="공유 방법 선택"]')).toBeVisible({ timeout: 3000 });
  });

  // VITE_FEATURE_UPCOMING=true 환경에서만 BottomNav 곧 분양 진입로 표시
  // flag OFF 환경 (예: PR preview) 에서는 자동 skip
  test("모바일 BottomNav 에 '곧 분양' 진입로 표시 + 클릭 시 /upcoming 이동", async ({ page }) => {
    const bottomNav = page.locator('nav[aria-label="메인 내비게이션"]');
    await expect(bottomNav).toBeVisible({ timeout: 5000 });

    const upcomingBtn = bottomNav.getByRole("button", { name: /곧 분양/ });
    const isFeatureOn = await upcomingBtn.isVisible().catch(() => false);
    if (!isFeatureOn) {
      expect(!process.env.CI, "CI 는 VITE_FEATURE_UPCOMING=true(e2e.yml) 인데 BottomNav 에 '곧 분양'이 없다 — 깃발 전달·메뉴 배열 확인").toBe(true);
      test.skip(true, "VITE_FEATURE_UPCOMING flag OFF — BottomNav 곧 분양 미노출 (정상)");
      return;
    }

    await upcomingBtn.click();
    await expect(page).toHaveURL(/\/upcoming$/, { timeout: 5000 });
  });
});
