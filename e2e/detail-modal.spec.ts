import { test, expect, type Page } from "@playwright/test";

// 비로그인 게이트 우회 — 카드 클릭 시 상세(DetailModal)가 열리려면 isLoggedIn(=expertLoggedIn)이
// true여야 한다(useLoginGate.ts:21). 비로그인이면 LoginPromptModal("로그인 안내")이 떠 상세가 안 열림.
// expertLoggedIn 초기값 = !!localStorage.expertToken(useExpertMode.ts:34). 단 verify useEffect가
// /api/auth/verify 호출 후 `if (!data.ok)`면 토큰을 지우고 로그아웃하므로, mock은 반드시 { ok: true }
// 스키마여야 한다({ valid: true }로 주면 data.ok=undefined → 로그아웃 → 게이트 부활).
async function loginViaToken(page: Page) {
  await page.route("**/api/auth/verify", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, user: { id: 1, email: "e2e@test.com", role: "user" }, role: "user" }),
    }),
  );
  await page.addInitScript(() => {
    // expertToken = 공용 인증 토큰 키 (세션 405 전문가 role 폐지 후에도 카카오 손님·관리자 공용)
    localStorage.setItem("expertToken", "e2e-test-token");
    localStorage.setItem("userRole", "user");
  });
}

// 첫 단지 카드를 클릭해 상세 모달을 연다. 카드 = AptCard(div role="button" + 면적 "㎡" 텍스트, L69).
// Playwright auto-wait(toBeVisible/click)로 데이터 렌더를 기다림 — isVisible({timeout})은 timeout을
// 무시하고 즉시 평가하므로(공식), 카드 렌더 전 false 반환해 잘못 skip하는 함정이 있어 쓰지 않는다.
function firstCard(page: Page) {
  return page.locator('[role="button"]').filter({ hasText: "㎡" }).first();
}

// 상세 모달 — 열기/닫기/섹션 렌더링 테스트 (로그인 게이트 우회 후 진짜 DetailModal 검증)
test.describe("상세 모달", () => {
  test.beforeEach(async ({ page }) => {
    await loginViaToken(page); // goto 이전 등록 필수 (addInitScript)
    await page.goto("/");

    // role "user" = 일반 손님 → 초기 탭이 곧 목록/홈 (세션 405 — 구 전문가 대시보드 자동 진입·소비자뷰 전환 불필요).
    // 통합 홈 플래그 ON 환경이면 목록 탭으로 전환해 카드를 노출.
    const listTab = page.getByRole("button", { name: "목록" });
    if (await listTab.isVisible().catch(() => false)) {
      await listTab.click();
    }

    const card = firstCard(page);
    const hasCards = await card
      .waitFor({ state: "visible", timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    if (!hasCards) {
      test.skip(true, "카드 데이터 없음 — 빈 DB");
      return;
    }
  });

  test("카드 클릭 시 모달 열림", async ({ page }) => {
    await firstCard(page).click();
    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5000 });
  });

  // CTA sticky 바 (세션 407) — 콘텐츠 길이·스크롤 위치와 무관하게 모달 열린 직후 화면 안에 있어야 함.
  test("CTA 바 — 모달 열린 직후 스크롤 없이 화면 안 (sticky bottom)", async ({ page }) => {
    await firstCard(page).click();
    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5000 });
    await expect(modal.getByTestId("detail-cta-bar")).toBeInViewport();
  });

  test("모달에 단지 정보 섹션 렌더링", async ({ page }) => {
    await firstCard(page).click();
    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    const modalText = await modal.textContent();
    expect(modalText?.length).toBeGreaterThan(50);
  });

  test("닫기 버튼으로 모달 닫힘", async ({ page }) => {
    await firstCard(page).click();
    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    const closeBtn = modal.locator("button").first();
    await closeBtn.click();
    await expect(modal).not.toBeVisible({ timeout: 3000 });
  });

  // prices lazy fetch (apartments-prices.json) 후 PriceTable 첫 행 실제 렌더 검증.
  // 세션 407 D1: PriceTable 은 시세 탭 소속 — 칩 클릭 선행. #sec-price 단언은 데이터 무관 non-skip
  // 가드라 칩 클릭 수정이 누락되면 즉시 fail (silent-skip 함정 차단). 행 단언만 데이터 의존 skip 유지.
  test("DetailModal — 시세 탭: 칩 클릭 후 섹션 마운트 + prices lazy fetch 행 렌더", async ({ page }) => {
    await firstCard(page).click();
    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // exact:true — 세션 409 D2b 종합 탭 미니카드 aria-label("입지 78점 B+ …")이 부분일치로 잡히는 것 차단(칩만)
    await modal.getByRole("button", { name: "시세", exact: true }).click();
    // non-skip 가드: 시세 탭 패널은 데이터 유무와 무관하게 마운트·가시 (탭 전환 자체의 회귀 가드)
    await expect(modal.locator("#sec-price")).toBeVisible({ timeout: 4000 });

    // 가격 데이터가 있는 단지일 때만 PriceTable 행이 표시. 데이터 없으면 skip.
    // isVisible({timeout}) 은 timeout 무시·즉시 평가라 오스킵 함정(파일 헤더) — waitFor 패턴 사용.
    const row = modal.locator('[data-testid="price-table-row"]').first();
    const visible = await row
      .waitFor({ state: "visible", timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    if (!visible) {
      test.skip(true, "첫 단지에 가격 데이터 없음");
      return;
    }
    await expect(row).toBeVisible();
  });

  // 탭바(StickyJumpNav) — 세션 407 D1: 점프 앵커 → 콘텐츠 교체 탭. 스크롤 단언은 의미 소멸로 삭제,
  // 실브라우저 고유 가치 = "비활성 패널이 실제로 숨고(keepMounted display:none) 새 패널이 보인다".
  test("탭바 '점수' 칩 클릭 시 콘텐츠 교체 — 점수 탭 노출 + 종합 탭 숨김 + active 전환", async ({ page }) => {
    await firstCard(page).click();
    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // 클릭 전: 기본 탭(종합) 가시, 점수 탭 미마운트(not.toBeVisible 은 부재도 pass)
    await expect(modal.locator("#sec-overview")).toBeVisible();
    await expect(modal.locator("#sec-score")).not.toBeVisible();

    // exact:true — 미니카드 aria-label("입지 78점 …")의 "점"이 부분일치로 잡히는 strict 위반 차단(세션 409 D2b)
    const scoreChip = modal.getByRole("button", { name: "점수", exact: true });
    await scoreChip.click();

    // 축1: 점수 탭 콘텐츠 마운트·가시 (DataSections + CatPanel)
    await expect(modal.locator("#sec-score")).toBeVisible({ timeout: 4000 });

    // 축2(콘텐츠 교체 증명): 종합 탭은 DOM 에 남되(keepMounted) 화면에서 숨음.
    await expect(modal.locator("#sec-overview")).not.toBeVisible();

    // 축3(active): handleTabChange 가 클릭 즉시 setActiveTab → 클릭칩 aria-current 전환.
    await expect(scoreChip).toHaveAttribute("aria-current", "true");
  });
});
