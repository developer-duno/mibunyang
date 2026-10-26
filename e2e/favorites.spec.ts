import { test, expect, type Page } from "@playwright/test";
import { cardName, stubCiApartments } from "./helpers";

/** 관심매물 저장소(useFavorites.ts STORAGE_KEY "mibunyang_fav" — 객체 {id: {...}}) 의 개수 */
async function favCount(page: Page): Promise<number> {
  return page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("mibunyang_fav") || "{}")).length);
}

// 즐겨찾기(관심매물) 기능 E2E 테스트
test.describe("즐겨찾기 기능", () => {
  test.beforeEach(async ({ page }) => {
    await stubCiApartments(page); // CI 공용 픽스처(goto 전) — 세션664
    await page.goto("/");
    const hasCards = await page
      .locator('[role="button"]')
      .first()
      .waitFor({ state: "visible", timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    expect(hasCards, "픽스처인데 카드 0 — 픽스처·가로채기 깨짐").toBe(true);
  });

  // 세션664 C: 옛 시험은 카드 본문(role=button) 안에서 버튼을 찾았지만 버튼 줄은 3/30 부터 본문 밖(AptCard.tsx:417)
  //   → 늘 skip. 관심매물 등록은 토스트가 없다(useFavorites.ts 에 등록 토스트 0) — 버튼 글·「관심매물만 보기」·저장소로 단언.
  test("관심매물 클릭 → '관심 해제' + 「관심매물만 보기」에 그 단지 1장 + 저장소 기록", async ({ page }) => {
    const cards = page.getByTestId("apt-card");
    const first = cards.first();
    const name = await cardName(first);

    await first.getByRole("button", { name: "관심매물", exact: true }).click();
    await expect(first.getByRole("button", { name: "관심 해제" })).toBeVisible({ timeout: 3000 });
    await expect.poll(() => favCount(page), { message: "저장소(mibunyang_fav)에 1개" }).toBe(1);

    const favOnly = page.getByRole("button", { name: "관심매물만 보기" });
    await favOnly.click();
    await expect(favOnly).toHaveAttribute("aria-pressed", "true");
    await expect(cards).toHaveCount(1);
    expect(await cardName(cards.first())).toBe(name);
  });

  test("관심매물 해제 → '관심매물' 글로 복원 + 저장소 0", async ({ page }) => {
    const first = page.getByTestId("apt-card").first();
    await first.getByRole("button", { name: "관심매물", exact: true }).click();
    await expect(first.getByRole("button", { name: "관심 해제" })).toBeVisible({ timeout: 3000 });
    await expect.poll(() => favCount(page)).toBe(1);

    await first.getByRole("button", { name: "관심 해제" }).click();
    await expect(first.getByRole("button", { name: "관심매물", exact: true })).toBeVisible({ timeout: 3000 });
    await expect.poll(() => favCount(page), { message: "해제 뒤 저장소 0" }).toBe(0);
  });
});
