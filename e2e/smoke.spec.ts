import { test, expect } from "@playwright/test";
import { CI_SHOWN, stubCiApartments } from "./helpers";

// 세션664 B1: 운영 프록시 호출 0 — 이 파일의 다른 가로채기보다 먼저 등록해야 시험 쪽 route 가 이긴다(helpers.ts stubCiApartments).
test.beforeEach(async ({ page }) => {
  await stubCiApartments(page);
});

// 기본 스모크 테스트 — 페이지 로드 + 렌더링 확인
test.describe("스모크 테스트", () => {
  test("페이지가 정상 로드됨", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/");
    await expect(page.locator("body")).toContainText("미분양");

    // 세션664 D: 옛 `if (hasCards)` 는 카드가 없어도 조용히 초록 + isVisible({timeout}) 은 기다리지 않는다.
    //   이제 공용 픽스처(beforeEach)라 카드는 반드시 있어야 한다 — 기본 화면 장수 = CI_SHOWN.
    const cards = page.getByTestId("apt-card");
    await expect(cards.first(), "픽스처인데 카드 0 — 픽스처·가로채기 깨짐").toBeVisible({ timeout: 15000 });
    await expect(cards).toHaveCount(CI_SHOWN.length);
    // 페이지 자체는 에러 없이 로드되어야 함
    expect(errors).toHaveLength(0);
  });

  test("페이지 타이틀이 존재함", async ({ page }) => {
    await page.goto("/");
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
  });
});
