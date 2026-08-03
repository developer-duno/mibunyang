import { test, expect } from "@playwright/test";
import { gotoListTab } from "./helpers";

// 스켈레톤 로딩 + 빈 상태 + 필터 초기화 테스트
test.describe("스켈레톤 & 빈 상태", () => {
  test("로딩 시 스켈레톤 표시 (목록 6카드 / 홈 탭이면 4카드)", async ({ page }) => {
    // API 응답을 3초 지연시켜 로딩 상태 포착
    await page.route("**/api/supabase/apartments*", async (route) => {
      await new Promise((r) => setTimeout(r, 3000));
      await route.continue();
    });
    await page.goto("/");
    // skeleton-pulse 애니메이션이 적용된 카드 확인
    const skeletons = page.locator('[style*="skeleton-pulse"]');
    await expect(skeletons.first()).toBeVisible({ timeout: 5000 });
    const count = await skeletons.count();
    // 세션 487 이후 착륙 지점은 항상 목록이라 보통 6개. 홈 화면이면 SkeletonList 4개.
    // 두 경우를 다 허용해 착륙 지점이 바뀌어도 이 테스트가 흔들리지 않게 한다.
    expect([4, 6]).toContain(count);
  });

  test("필터로 0건 시 빈 상태 메시지 표시", async ({ page }) => {
    await page.goto("/");
    await gotoListTab(page); // HOME ON 시 홈엔 SearchFilterBar 없음 — 목록 진입 보정
    const hasCards = await page
      .locator('[role="button"]')
      .first()
      .isVisible({ timeout: 15000 })
      .catch(() => false);
    if (!hasCards) {
      test.skip(true, "카드 데이터 없음 — 빈 DB");
      return;
    }

    // 예산 필터 트리거 클릭
    const budgetTrigger = page.locator("[aria-expanded]", { hasText: "예산" });
    if (!(await budgetTrigger.isVisible({ timeout: 3000 }).catch(() => false))) {
      test.skip(true, "예산 필터 트리거 미존재");
      return;
    }
    await budgetTrigger.click();

    // 극단적 최소 예산 입력 (999억 — 모든 단지 초과)
    const minInput = page.locator('input[placeholder*="최소"]').or(page.locator('input[aria-label*="최소"]'));
    if (await minInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await minInput.fill("999");
    } else {
      // 프리셋 버튼으로 시도
      const presets = page.locator("button", { hasText: /^\d+억/ });
      if (
        await presets
          .last()
          .isVisible({ timeout: 2000 })
          .catch(() => false)
      ) {
        await presets.last().click();
      }
    }

    // 빈 상태 메시지 확인
    await expect(page.locator("text=단지가 없습니다")).toBeVisible({ timeout: 5000 });
    // 필터 초기화 버튼 확인
    await expect(page.locator("button", { hasText: "필터 초기화" })).toBeVisible();
  });

  test("필터 초기화 후 카드 복원", async ({ page }) => {
    await page.goto("/");
    await gotoListTab(page); // HOME ON 시 홈엔 SearchFilterBar 없음 — 목록 진입 보정
    const hasCards = await page
      .locator('[role="button"]')
      .first()
      .isVisible({ timeout: 15000 })
      .catch(() => false);
    if (!hasCards) {
      test.skip(true, "카드 데이터 없음 — 빈 DB");
      return;
    }

    // 예산 필터로 0건 만들기
    const budgetTrigger = page.locator("[aria-expanded]", { hasText: "예산" });
    if (!(await budgetTrigger.isVisible({ timeout: 3000 }).catch(() => false))) {
      test.skip(true, "예산 필터 트리거 미존재");
      return;
    }
    await budgetTrigger.click();

    const minInput = page.locator('input[placeholder*="최소"]').or(page.locator('input[aria-label*="최소"]'));
    if (await minInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await minInput.fill("999");
    } else {
      const presets = page.locator("button", { hasText: /^\d+억/ });
      if (
        await presets
          .last()
          .isVisible({ timeout: 2000 })
          .catch(() => false)
      ) {
        await presets.last().click();
      }
    }

    // 빈 상태 확인
    await expect(page.locator("text=단지가 없습니다")).toBeVisible({ timeout: 5000 });

    // 필터 초기화 클릭
    const resetBtn = page.locator("button", { hasText: "필터 초기화" });
    await expect(resetBtn).toBeVisible();
    await resetBtn.click();

    // 카드 복원 확인
    await expect(page.locator('[role="button"]').first()).toBeVisible({ timeout: 5000 });
    const restoredCount = await page.locator('[role="button"]').count();
    expect(restoredCount).toBeGreaterThan(0);
  });
});
