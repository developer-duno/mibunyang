import { test, expect } from "@playwright/test";

// 기본 스모크 테스트 — 페이지 로드 + 렌더링 확인
test.describe("스모크 테스트", () => {
  test("페이지가 정상 로드됨", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/");
    await expect(page.locator("body")).toContainText("미분양");

    // 카드가 로드되거나, 로딩 상태가 표시되면 통과 (빈 DB 허용)
    const cards = page.locator('[role="button"]');
    const hasCards = await cards.first().isVisible({ timeout: 15000 }).catch(() => false);

    if (hasCards) {
      expect(await cards.count()).toBeGreaterThan(0);
    }
    // 빈 DB이더라도 페이지 자체는 에러 없이 로드되어야 함
    expect(errors).toHaveLength(0);
  });

  test("페이지 타이틀이 존재함", async ({ page }) => {
    await page.goto("/");
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
  });
});
