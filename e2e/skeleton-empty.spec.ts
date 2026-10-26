import { test, expect, type Page } from "@playwright/test";
import { CI_SHOWN, gotoListTab, stubCiApartments } from "./helpers";

/** 「금액」 필터를 열어 최소 예산에 픽스처 어느 단지도 못 넘는 값(999억)을 넣는다 — 버튼 = SearchFilterBar.tsx:207 label "금액", 입력 = BudgetPanel.tsx:40 */
async function setImpossibleBudget(page: Page) {
  await page.locator("[aria-expanded]", { hasText: "금액" }).first().click();
  await page.getByLabel("최소 예산(억)").fill("999");
  // 열린 드롭다운의 배경 막이 아래 버튼 클릭을 가로챈다 — 사람처럼 Esc 로 닫는다(SearchFilterBar.tsx:119)
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("최소 예산(억)")).toBeHidden();
}

// 스켈레톤 로딩 + 빈 상태 + 필터 초기화 테스트
test.describe("스켈레톤 & 빈 상태", () => {
  test("로딩 시 스켈레톤 표시 (목록 6카드 / 홈 탭이면 4카드)", async ({ page }) => {
    // API 응답을 3초 지연시켜 로딩 상태 포착 — 세션664 B1: 지연 뒤 운영(continue)이 아니라 공용 픽스처로(fallback).
    await stubCiApartments(page);
    await page.route("**/api/supabase/apartments*", async (route) => {
      await new Promise((r) => setTimeout(r, 3000));
      await route.fallback();
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
    await stubCiApartments(page); // CI 공용 픽스처(goto 전) — 세션664
    await page.goto("/");
    await gotoListTab(page); // HOME ON 시 홈엔 SearchFilterBar 없음 — 목록 진입 보정
    const hasCards = await page
      .locator('[role="button"]')
      .first()
      .waitFor({ state: "visible", timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    expect(hasCards, "픽스처인데 카드 0 — 픽스처·가로채기 깨짐").toBe(true);

    // 세션664 C: 옛 시험은 "예산" 글자 버튼을 찾았지만 3/31(813fc3ad)부터 "금액" → 늘 skip.
    await setImpossibleBudget(page);
    await expect(page.getByText("예산 범위에 맞는 단지가 없습니다")).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("apt-card")).toHaveCount(0);
    // 빈 상태의 되돌리기 버튼(AptListSection.tsx 빈 상태)
    await expect(page.getByRole("button", { name: "예산 해제" })).toBeVisible();
    await expect(page.getByRole("button", { name: "전체 초기화" })).toBeVisible();
  });

  test("필터 초기화 후 카드 복원", async ({ page }) => {
    await stubCiApartments(page); // CI 공용 픽스처(goto 전) — 세션664
    await page.goto("/");
    await gotoListTab(page); // HOME ON 시 홈엔 SearchFilterBar 없음 — 목록 진입 보정
    const hasCards = await page
      .locator('[role="button"]')
      .first()
      .waitFor({ state: "visible", timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    expect(hasCards, "픽스처인데 카드 0 — 픽스처·가로채기 깨짐").toBe(true);

    // 기본 화면 = 픽스처 8곳 중 미분양 있는 단지만(「미분양 없는 단지 보기」 기본 꺼짐 — 미분양 0 1곳 숨김, 세션664 실측 7장)
    const cards = page.getByTestId("apt-card");
    await expect(cards).toHaveCount(CI_SHOWN.length);
    const before = await cards.count();

    await setImpossibleBudget(page);
    await expect(page.getByText("예산 범위에 맞는 단지가 없습니다")).toBeVisible({ timeout: 5000 });
    await expect(cards).toHaveCount(0);

    await page.getByRole("button", { name: "예산 해제" }).click();
    await expect(cards).toHaveCount(before);
  });
});
