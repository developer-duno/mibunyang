import { test, expect } from "@playwright/test";

// VITE_FEATURE_HOME=true 환경에서만 홈 탭 노출 — flag OFF 환경에서는 자동 skip
test.describe("통합 홈 위젯판 (M1)", () => {
  test("홈 초기 진입 → 위젯 → D5 잠금 → '전체 목록' 펼치기", async ({ page }) => {
    await page.goto("/");
    const homeBtn = page.getByRole("button", { name: "홈" }).first();
    const isFeatureOn = await homeBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (!isFeatureOn) {
      test.skip(true, "VITE_FEATURE_HOME flag OFF — 홈 미노출 (정상)");
      return;
    }

    await expect(page.getByText("📊 시장 요약")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("로그인하면 지도가 열려요")).toBeVisible();

    await page.getByRole("button", { name: "로그인하고 지도 열기" }).click();
    await expect(page.getByRole("dialog", { name: "로그인 안내" })).toBeVisible();
    await page.getByRole("button", { name: "나중에 하기" }).click();

    await page.getByRole("button", { name: /전체 목록/ }).click();
    await expect(page.getByText("📊 시장 요약")).not.toBeVisible();
  });
});
