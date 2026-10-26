import { test, expect, type Page } from "@playwright/test";
import { stubCiApartments } from "./helpers";

// 공유 기능 E2E 테스트
test.describe("공유 기능", () => {
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

  // 세션664 C: 옛 시험은 카드 본문(role=button) 안에서 "상세보기"를 찾아 3/30 부터 늘 skip. 지금 = 카드 버튼 줄의
  //   "상세보기"(AptCard.tsx:418) → 상세 창 · 데스크톱(이 프로젝트 1280)은 오른쪽 레일의 "공유"(DetailModal.tsx:1145).
  const SHEET = '[role="dialog"][aria-label="공유 방법 선택"]';

  async function openShareSheet(page: Page) {
    await page.getByTestId("apt-card").first().getByRole("button", { name: "상세보기" }).click();
    const modal = page.locator('[role="dialog"]').first();
    await expect(modal).toBeVisible({ timeout: 5000 });
    await modal.getByTestId("detail-rail").getByRole("button", { name: /공유/ }).click();
    await expect(page.locator(SHEET)).toBeVisible({ timeout: 3000 });
  }

  test("상세보기 → 상세 창 → 공유 → ShareSheet(카카오톡·링크 복사 버튼)", async ({ page }) => {
    await openShareSheet(page);
    const sheet = page.locator(SHEET);
    await expect(sheet.getByRole("button", { name: "링크 복사" })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "카카오톡으로 공유" })).toBeVisible();
  });

  test("ShareSheet 링크 복사 → 클립보드에 이 단지 주소 + 토스트 + 시트 닫힘", async ({ page }) => {
    // 클립보드 쓰기를 가로채 무엇이 쓰였는지 남긴다(권한·헤드리스 차이와 무관하게 호출 자체를 본다).
    await page.addInitScript(() => {
      const w = window as unknown as { __copied: string[] };
      w.__copied = [];
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: async (t: string) => void w.__copied.push(t) },
      });
    });
    await page.reload();
    await page.getByTestId("apt-card").first().waitFor({ state: "visible", timeout: 15000 });

    await openShareSheet(page);
    const aptId = decodeURIComponent(new URL(page.url()).pathname.replace(/^\/apt\//, ""));
    expect(aptId, "상세 창을 열면 주소가 /apt/{id}").toMatch(/^a[hp]-/);

    await page.locator(SHEET).getByRole("button", { name: "링크 복사" }).click();
    const copied = await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied);
    expect(copied, "writeText 1회").toHaveLength(1);
    expect(copied[0]).toContain(`detail=${aptId}`); // useShareCallbacks.ts:88
    await expect(page.getByText("링크가 복사되었습니다")).toBeVisible({ timeout: 3000 });
    await expect(page.locator(SHEET)).not.toBeVisible();
  });
});
