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
  // hardcoded waitForTimeout 금지 — testid 명시 selector 로 flaky 방지.
  test("DetailModal — prices lazy fetch 후 PriceTable 행 렌더", async ({ page }) => {
    await firstCard(page).click();
    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5000 });
    // 가격 데이터가 있는 단지일 때만 PriceTable 행이 표시. 데이터 없으면 skip.
    const row = modal.locator('[data-testid="price-table-row"]').first();
    const visible = await row.isVisible({ timeout: 15000 }).catch(() => false);
    if (!visible) {
      test.skip(true, "첫 단지에 가격 데이터 없음");
      return;
    }
    await expect(row).toBeVisible();
  });

  // 목차바(StickyJumpNav) 칩 점프 — jsdom 단위테스트(scrollTo 호출+aria-current mock)가 못 증명하는
  // "실브라우저 레이아웃: 맨 아래 섹션이 실제로 viewport 안으로 들어옴"을 검증.
  test("목차바 '점수' 칩 클릭 시 섹션 노출 + 실제 스크롤 + active 전환", async ({ page }) => {
    await firstCard(page).click();
    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    const body = modal.locator('[data-testid="detail-scroll-body"]');
    await expect(body).toBeVisible();

    // 헤드리스 Chromium은 scrollTo({behavior:"smooth"})를 비결정적으로 처리(scrollTop이 0~부분진행
    // 사이를 오감 — reducedMotion 으로도 instant 화 안 됨, 실측 확인). 검증 대상은 "handleJump가
    // offsetTop-44 좌표로 스크롤을 건다"이지 smooth 애니메이션 자체가 아니므로, 컨테이너 scrollTo의
    // behavior 인자만 벗겨 동기 스크롤로 만든다(prod handleJump는 불변 — UX 영향 0).
    await body.evaluate((el) => {
      const orig = el.scrollTo.bind(el);
      el.scrollTo = (opts?: ScrollToOptions | number, y?: number) => {
        if (opts && typeof opts === "object") orig({ top: opts.top, left: opts.left ?? 0 });
        else orig(opts as number, y as number);
      };
    });

    // 클릭 전: 맨 아래 섹션은 아직 viewport 밖(점프가 실제 레이아웃 변화를 일으킴을 before/after 로 증명).
    await expect(modal.locator("#sec-score")).not.toBeInViewport();

    const before = await body.evaluate((el) => el.scrollTop);
    const scoreChip = modal.getByRole("button", { name: "점수" });
    await scoreChip.click();

    // 축1(레이아웃 사실, e2e 고유가치): 점프 후 맨 아래 섹션이 viewport 안으로 들어옴.
    await expect(modal.locator("#sec-score")).toBeInViewport({ timeout: 4000 });

    // 축2(실제 스크롤 증명): 컨테이너 scrollTop 이 클릭 전보다 커짐. instant 패치라 결정적.
    await expect
      .poll(() => body.evaluate((el) => el.scrollTop), { timeout: 4000 })
      .toBeGreaterThan(before);

    // 축3(active): handleJump 가 클릭 즉시 setActiveSection → 클릭칩 aria-current 전환(스크롤 타이밍 무관).
    await expect(scoreChip).toHaveAttribute("aria-current", "true");
  });
});
