import { test, expect, type Page } from "@playwright/test";
import { stubApartments, stubProxyApis } from "./helpers";

// 세션664 B1: 운영 프록시 호출 0 — 이 파일의 다른 가로채기보다 먼저 등록해야 시험 쪽 route 가 이긴다(helpers.ts stubProxyApis).
test.beforeEach(async ({ page }) => {
  await stubProxyApis(page);
});

// 금융 탭 금리 블록 E2E (세션593 D7).
//
// 옛 spec 은 금융 탭을 누르지 않은 채 "[aria-expanded] 안의 '금리' 글자" 를 찾다가 못 찾으면
// test.skip 으로 조용히 꺼졌다(금융 패널은 탭을 눌러야 마운트된다 — 실제로는 늘 건너뛰었다).
// 이제는 ① 단지 목록을 고정 픽스처로 ② 금리 응답을 가짜로 바꿔치기해 외부 상태와 무관하게
// 반드시 돌고, 못 찾으면 **실패**한다.

/** 은행권 주담대 가짜 응답 — 10/02 사본에서 뽑은 줄(값 그대로) + 공시월 */
const BANK_RATES = {
  ok: true,
  disclosureMonth: "202609",
  data: [
    { bank: "경남은행", mortgageType: "아파트외", repayType: "만기일시상환방식", rateMin: 3.7, rateMax: 5.51 },
    { bank: "아이엠뱅크", mortgageType: "아파트", repayType: "분할상환방식", rateMin: 4.2, rateMax: 6.51 },
    { bank: "신한은행", mortgageType: "아파트", repayType: "분할상환방식", rateMin: 4.29, rateMax: 6.37 },
    { bank: "우리은행", mortgageType: "아파트", repayType: "분할상환방식", rateMin: 4.41, rateMax: 6.91 },
    { bank: "농협은행주식회사", mortgageType: "아파트", repayType: "분할상환방식", rateMin: 4.49, rateMax: 7.71 },
    { bank: "주식회사 하나은행", mortgageType: "아파트", repayType: "분할상환방식", rateMin: 4.5, rateMax: 6.5 },
    { bank: "주식회사 카카오뱅크", mortgageType: "아파트", repayType: "분할상환방식", rateMin: 4.51, rateMax: 6.07 },
  ],
};

/** 우리 금리 API 를 가짜로 — 부른 권역을 기록한다 */
async function stubRates(page: Page, calls: string[]) {
  await page.route("**/api/finlife/rates**", (route) => {
    const url = new URL(route.request().url());
    const type = url.searchParams.get("type");
    const grp = url.searchParams.get("topFinGrpNo") ?? "";
    calls.push(`${type}:${grp}`);
    const body =
      type === "mortgage" && grp === "020000"
        ? BANK_RATES
        : {
            ok: true,
            disclosureMonth: "202609",
            data: [
              {
                bank: `가짜${grp}`,
                product: "상품",
                mortgageType: "아파트",
                repayType: "분할상환방식",
                rateMin: 5.5,
                rateMax: 7.2,
              },
            ],
          };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
}

test.describe("금융 탭 금리 블록", () => {
  test("한 달에 갚을 돈 · 은행 범위 1줄(이름 0) · 다른 금융권은 펼칠 때만 부른다", async ({ page }) => {
    const calls: string[] = [];
    await stubApartments(page);
    await stubRates(page, calls);
    await page.goto("/");

    const listTab = page.getByRole("button", { name: "목록" });
    if (await listTab.isVisible().catch(() => false)) await listTab.click();

    await page.locator('[role="button"]').filter({ hasText: "㎡" }).first().click();
    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 10000 });
    await modal.getByRole("tab", { name: "금융" }).click();

    const panel = modal.locator("#sec-finance");
    await expect(panel.getByText("한 달에 갚을 돈", { exact: true })).toBeVisible({ timeout: 10000 });
    // 세션675 「한 달 상환에 금리 2개」 — 가장 낮은·가장 높은 은행 금리(= 아래 범위 줄 양 끝)
    await expect(panel.getByText(/아파트·분할상환 은행 금리 4\.20% ~ 7\.71% 기준 · 2026년 9월 공시/)).toBeVisible();
    // 세션665 — 은행 이름 없이 범위 한 줄. 가짜 응답의 아파트·분할상환 6개 은행: 최저 4.20(아이엠뱅크) ~ 최고 7.71(농협)
    await expect(panel.getByTestId("bank-rate-row")).toHaveCount(1);
    await expect(panel.getByTestId("bank-rate-row")).toHaveAttribute("aria-label", "6개 은행 4.20% ~ 7.71%");
    await expect(panel.getByTestId("bank-rate-bars")).not.toContainText("농협");
    await expect(panel.getByTestId("bank-rate-bars")).not.toContainText("아이엠뱅크");
    await expect(panel.getByText("은행별 금리 비교")).toHaveCount(0);

    // 닫힌 채로는 다른 권역을 부르지 않는다 — 첫 진입 = 주담대 은행권 1(전세 금리 조회는 세션675 에 면적별 표와 함께 지움)
    expect(calls.filter((c) => c.startsWith("mortgage:") && !c.endsWith(":020000"))).toEqual([]);

    const toggle = panel.getByRole("button", { name: "저축은행 · 여신전문 · 보험 금리 보기" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    // 권역 탭 — StickyJumpNav 도 role=tablist 라 aria-label="금융권역" 으로 좁힌다(세션 410 D3).
    const tabs = panel.getByRole("tablist", { name: "금융권역" }).getByRole("tab");
    await expect(tabs).toHaveText(["저축은행", "여신전문", "보험"]);
    await expect(panel.getByTestId("group-rate-row")).toHaveAttribute("aria-label", "1개 저축은행 5.50% ~ 7.20%");
    await expect(panel.getByText("가짜030300")).toHaveCount(0);
    await tabs.nth(2).click();
    await expect(tabs.nth(2)).toHaveAttribute("aria-selected", "true");
    await expect(panel.getByTestId("group-rate-row")).toHaveAttribute("aria-label", "1개 보험사 5.50% ~ 7.20%");
    await expect(panel.getByText("가짜050000")).toHaveCount(0);
    expect(calls).toContain("mortgage:030300");
    expect(calls).toContain("mortgage:050000");
  });
});
