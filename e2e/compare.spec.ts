import { test, expect } from "@playwright/test";
import { cardName, escapeRe, stubCiApartments } from "./helpers";

// 비교 기능 — 비교 선택 + CompareSheet 테스트
test.describe("비교 기능", () => {
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

  // 세션664 C: 옛 시험은 카드 안 체크박스를 찾았지만 카드엔 처음부터 체크박스가 없었다(3/30 판도 "비교" 버튼) →
  //   늘 skip. 지금 화면 = 카드 버튼 줄(카드 본문 role=button 밖, AptCard.tsx:430) "비교" → 목록 위 "N개 비교 보기"(App.tsx:703).
  test("카드 '비교' 2곳 → 'N개 비교 보기' → 비교 표에 두 단지 이름", async ({ page }) => {
    const cards = page.getByTestId("apt-card");
    expect(await cards.count(), "비교하려면 카드가 2장 이상").toBeGreaterThanOrEqual(2);
    const names = [await cardName(cards.nth(0)), await cardName(cards.nth(1))];

    await cards.nth(0).getByRole("button", { name: "비교", exact: true }).click();
    await expect(cards.nth(0).getByRole("button", { name: "비교 중" })).toBeVisible();
    await cards.nth(1).getByRole("button", { name: "비교", exact: true }).click();
    await page.getByRole("button", { name: "2개 비교 보기" }).click();

    await expect(page.getByRole("button", { name: "비교 닫기" })).toBeVisible({ timeout: 5000 });
    const table = page.locator("table").filter({ has: page.getByRole("columnheader") }).first();
    for (const n of names) {
      // 비교 표 머리글은 이름의 마지막 낱말(CompareSheet.tsx:221)
      await expect(table.getByRole("columnheader", { name: new RegExp(escapeRe(n.split(" ").pop() ?? n)) })).toBeVisible();
    }
  });
});
