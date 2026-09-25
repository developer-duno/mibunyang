import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { stubApartmentsWith } from "./helpers";

// 면적 빈칸 단지(D2)·주차 추정(D5-b)이 화면에 실제로 그려지는지 지키는 e2e (검사관 C 6a, 세션577).
//
// ⚠️ `detail-modal.spec.ts` 의 `firstCard`(hasText: "㎡")를 이 spec 에는 그대로 못 쓴다 — 이 spec 의
// 픽스처는 첫 대상 단지(루원시티 SK 리더스뷰)의 area 가 null 이라 카드에 "㎡" 텍스트 자체가 없다
// (D2: 면적을 모르면 ㎡ 토큰을 통째로 뺀다). "㎡" 로 첫 카드를 고르면 이 단지를 **구조적으로** 못
// 고르므로, 이름으로 정확히 찾는 방식(검색창 → 이름 필터)을 쓴다.

const LIST_FIXTURE = JSON.parse(
  readFileSync(new URL("./fixtures/apartments-area-null.json", import.meta.url), "utf8")
);
const DETAIL_BUCKET = JSON.parse(
  readFileSync(new URL("./fixtures/apartments-area-null-detail.json", import.meta.url), "utf8")
);
// 루원시티 SK 리더스뷰(ah-2026930023)는 FNV-1a 해시로 버킷 10에 들어간다(bucketHash.mjs,
// DETAIL_BUCKET_COUNT=16). 용문역(ah-2023910096)은 버킷 3이지만 이 spec 은 그 단지의 상세
// 버킷(priceByArea)을 검증하지 않으므로 stub 하지 않는다 — 실제 정적 파일 요청은 dev 서버에
// 해당 파일이 없어 404가 나되, 그 응답은 DetailModal 의 catch 로 흡수되어 화면엔 영향 없다.
const DETAIL_BUCKETS = { "apartments-detail-16-10.json": DETAIL_BUCKET };

async function loginViaToken(page: Page) {
  await page.route("**/api/auth/verify", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, user: { id: 1, email: "e2e@test.com", role: "user" }, role: "user" }),
    })
  );
  await page.addInitScript(() => {
    localStorage.setItem("expertToken", "e2e-test-token");
    localStorage.setItem("userRole", "user");
  });
}

/** 검색창을 열고 검색어를 입력해 이름이 정확히 일치하는 카드 하나로 좁힌다. */
async function searchAndOpenCard(page: Page, query: string, cardName: string) {
  await page.getByRole("button", { name: "검색", exact: true }).click();
  const input = page.getByRole("textbox", { name: "단지명·지역 검색" });
  await input.fill(query);
  // 검색 드롭다운(FilterDropdown)이 position:absolute 로 카드 위에 떠 있어 열린 채로는
  // 카드 클릭을 가로챈다(SearchFilterBar.tsx:431 — Enter 키가 closePanel 을 부른다).
  await input.press("Enter");
  const card = page.locator('[role="button"]').filter({ hasText: cardName });
  await card.first().waitFor({ state: "visible", timeout: 15000 });
  await card.first().click();
}

test.describe("면적 빈칸 단지 상세 · 주차 추정 문구", () => {
  test.beforeEach(async ({ page }) => {
    await loginViaToken(page);
    await stubApartmentsWith(page, LIST_FIXTURE, DETAIL_BUCKETS);
    await page.goto("/");

    const listTab = page.getByRole("button", { name: "목록" });
    if (await listTab.isVisible().catch(() => false)) {
      await listTab.click();
    }

    // "미분양 없는 단지 보기" 토글은 기본 켜짐(hideNoUnsold=true, App.tsx:96)이라 unsold=0인
    // 단지(루원시티 SK 리더스뷰)가 목록에서 걸러진다 — 두 픽스처 행 모두 보이도록 끈다.
    await page.getByRole("button", { name: "미분양 없는 단지 보기" }).click();
  });

  test("루원시티 SK 리더스뷰 — 헤더에 ㎡ 없음 + 시세 탭 '전체 면적'", async ({ page }) => {
    await searchAndOpenCard(page, "루원시티 SK", "루원시티 SK 리더스뷰");

    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // (a) 모달 헤더(h1 + 지역/면적/가격 서브텍스트 + 주소) 스코프에 "㎡" 가 전혀 없다.
    // 시세 탭 본문(PriceTable)에는 정상적으로 "㎡"가 여러 번 나오므로 헤더 영역으로 스코프를
    // 좁혀야 한다 — h1의 부모 div(headerRow 첫 자식)를 xpath 로 잡는다.
    const headerBlock = modal.locator("h1").locator("xpath=..");
    const headerText = await headerBlock.textContent();
    expect(headerText).not.toContain("㎡");
    expect(headerText).not.toContain("0㎡");

    // (b) 시세 탭으로 이동 → "총 N건 · 전체 면적" 정확 문자열 (N = 픽스처 priceByArea count 합 25).
    await modal.getByRole("tab", { name: "시세", exact: true }).click();
    await expect(modal.locator("#sec-price")).toBeVisible({ timeout: 4000 });

    const row = modal.locator('[data-testid="price-table-row"]').first();
    await row.waitFor({ state: "visible", timeout: 15000 });
    await expect(modal.locator("#sec-price")).toContainText("총 25건 · 전체 면적");
  });

  test("용문역 리체스트(임의공급) — 종합 탭 주차 편차 '추정 1.13대/세대', 막대 없음", async ({ page }) => {
    // 모달을 새로 열기 전, 앞선 테스트와 독립적으로 동작하도록 이 테스트 안에서 바로 검색.
    await searchAndOpenCard(page, "용문역 리체스트", "용문역 리체스트(임의공급)");

    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // 종합 탭이 기본 활성 탭(detail-modal.spec.ts 확인 패턴과 동일).
    await expect(modal.locator("#sec-overview")).toBeVisible();

    // 편차 줄 자체(estimated 상태)는 aria-label 이 정확히 이 문장이다(deviationAriaLabel).
    const parkingRow = modal.getByRole("img", {
      name: "주차 추정 1.13대/세대. 추정치라 지역 단지들과 견주지 않았습니다.",
    });
    await expect(parkingRow).toBeVisible({ timeout: 5000 });
    await expect(parkingRow).toContainText("추정 1.13대/세대");

    // 막대(트랙 div)가 없음 — ok 상태 행은 lowWord("빠듯")/highWord("여유") 끝말이 함께 그려지는데,
    // estimated 상태는 label + text 두 span 뿐이라 그 끝말이 없다.
    const rowText = await parkingRow.textContent();
    expect(rowText).not.toContain("빠듯");
    expect(rowText).not.toContain("여유");
    // DOM 상으로도 트랙에 해당하는 하위 div 가 없어야 한다(estimated 분기는 span 2개만 렌더).
    await expect(parkingRow.locator("div")).toHaveCount(0);
  });
});
