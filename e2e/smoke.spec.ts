import { test, expect } from "@playwright/test";

// 기본 스모크 테스트 — 페이지 로드 + 렌더링 확인
test.describe("스모크 테스트", () => {
  test("페이지가 정상 로드되고 카드가 렌더링됨", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/");
    // 헤더 또는 제목 텍스트 확인
    await expect(page.locator("body")).toContainText("미분양");

    // 아파트 카드 최소 1개 렌더링 대기 (Supabase 데이터 로드)
    const cards = page.locator('[role="button"]');
    await expect(cards.first()).toBeVisible({ timeout: 15000 });

    // 콘솔 에러 없음
    expect(errors).toHaveLength(0);
  });

  test("페이지 타이틀이 존재함", async ({ page }) => {
    await page.goto("/");
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
  });
});
