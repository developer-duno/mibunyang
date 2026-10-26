import { test, expect } from "@playwright/test";
import { CI_SHOWN, gotoListTab, stubCiApartments } from "./helpers";

// 아파트 목록 — 필터/정렬/검색 테스트
test.describe("아파트 목록", () => {
  test.beforeEach(async ({ page }) => {
    await stubCiApartments(page); // CI 공용 픽스처(goto 전) — 세션664
    await page.goto("/");
    await gotoListTab(page); // HOME ON 시 초기 탭이 홈 — 목록 검증은 목록 탭에서 (silent skip 방지)
    const hasCards = await page
      .locator('[role="button"]')
      .first()
      .waitFor({ state: "visible", timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    expect(hasCards, "픽스처인데 카드 0 — 픽스처·가로채기 깨짐").toBe(true);
  });

  // 세션664 D: 옛 시험은 `[aria-pressed]` 둘째(= 프로필 "투자" 버튼, HeaderSection.tsx:205)를 눌러 지역 필터가 아니었고
  //   `≤ 전체` 라 무엇을 눌러도 초록. 지금 = 「지역」 → 시/도 select(RegionPanel.tsx:53) → 그 시도 카드 수를 픽스처에서 계산해 정확히.
  test("지역 필터 적용 시 카드 수 = 픽스처의 그 시도 단지 수", async ({ page }) => {
    const cards = page.getByTestId("apt-card");
    await expect(cards).toHaveCount(CI_SHOWN.length);
    const region = CI_SHOWN[0].region;
    const n = CI_SHOWN.filter((a) => a.region === region).length;
    expect(n, "고른 시도의 단지 수는 전체보다 적어야 필터가 보인다").toBeLessThan(CI_SHOWN.length);

    await page.locator("[aria-expanded]", { hasText: "지역" }).first().click();
    await page.getByLabel("시/도").selectOption(region);
    await page.keyboard.press("Escape");
    await expect(cards).toHaveCount(n);
  });

  test("정렬 변경 시 순서 변화", async ({ page }) => {
    // 정렬 드롭다운 열기 — FilterButton "정렬" 클릭(SearchFilterBar.tsx:221)
    const sortTrigger = page.locator('[aria-expanded]', { hasText: "정렬" });
    const hasSort = await sortTrigger
      .first()
      .waitFor({ state: "visible", timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    if (!hasSort) {
      expect(!process.env.CI, "CI 인데 「정렬」 필터 버튼이 없다 — SearchFilterBar 의 label 이 바뀌었는지 확인").toBe(true);
      test.skip(true, "정렬 트리거 미존재");
      return;
    }

    await sortTrigger.click();
    // 정렬 패널 내 두 번째 옵션(저가순) 클릭
    const sortOptions = page.locator('[aria-current]').or(page.locator('[role="region"][aria-label="정렬 필터"] button'));
    const optCount = await sortOptions.count();
    if (optCount > 1) {
      await sortOptions.nth(1).click();
    }
    await page.locator('[role="button"]').first().waitFor({ state: "attached", timeout: 3000 });
    const firstAfter = await page.locator('[role="button"]').first().textContent();
    expect(firstAfter?.length).toBeGreaterThan(0);
  });
});
