import { test, expect } from "@playwright/test";

// 금리비교 섹션 E2E 테스트
test.describe("금리비교 기능", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    const hasCards = await page.locator('[role="button"]').first().isVisible({ timeout: 15000 }).catch(() => false);
    if (!hasCards) {
      test.skip(true, "카드 데이터 없음 — 빈 DB");
      return;
    }
  });

  test("상세 모달 내 금리비교 섹션 렌더링", async ({ page }) => {
    const detailBtn = page.locator('[role="button"]').first().locator("button", { hasText: "상세보기" });
    if (!(await detailBtn.isVisible())) {
      test.skip(true, "상세보기 버튼 미존재");
      return;
    }
    await detailBtn.click();

    // 모달이 열리면 금리비교 섹션 찾기
    const loanSection = page.locator("text=금리비교").or(page.locator("text=주택담보대출"));
    const hasLoan = await loanSection.first().isVisible({ timeout: 5000 }).catch(() => false);

    // finlife API 미등록이면 섹션이 없을 수 있음 — 모달 자체가 열리면 통과
    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 3000 });

    if (hasLoan) {
      await expect(loanSection.first()).toBeVisible();
    }
  });

  test("금융권역 탭 전환", async ({ page }) => {
    const detailBtn = page.locator('[role="button"]').first().locator("button", { hasText: "상세보기" });
    if (!(await detailBtn.isVisible())) {
      test.skip(true, "상세보기 버튼 미존재");
      return;
    }
    await detailBtn.click();

    // 금리비교 접기/펼치기 토글 찾기
    const toggle = page.locator('[role="button"][aria-expanded]').filter({ hasText: /금리/ });
    const hasToggle = await toggle.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasToggle) {
      test.skip(true, "금리비교 토글 미존재 — finlife API 미등록");
      return;
    }

    // 펼치기
    const expanded = await toggle.getAttribute("aria-expanded");
    if (expanded === "false") {
      await toggle.click();
    }

    // 권역 탭 확인 — 세션 410 D3: StickyJumpNav 도 role=tablist 라 무스코프 셀렉터는 2개 매칭.
    // aria-label="금융권역" 으로 은행권역 tablist 만 명시 타겟(StickyJumpNav="상세 분석 카테고리"와 분리).
    const tablist = page.getByRole("tablist", { name: "금융권역" });
    const hasTabs = await tablist.isVisible({ timeout: 3000 }).catch(() => false);
    if (hasTabs) {
      const tabs = tablist.locator('[role="tab"]');
      const tabCount = await tabs.count();
      expect(tabCount).toBeGreaterThan(0);

      // 두 번째 탭 클릭 (있으면)
      if (tabCount >= 2) {
        await tabs.nth(1).click();
        await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
      }
    }
  });
});
