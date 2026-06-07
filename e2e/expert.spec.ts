import { test, expect, type Page } from "@playwright/test";

// 전문가 로그인 우회 — expertToken 주입 + verify mock({ ok:true })로 게이트 통과(useExpertMode.ts:34·173).
// detail-modal.spec.ts 의 동일 헬퍼 답습. { valid:true } 로 주면 data.ok=undefined → 로그아웃되니 금지.
async function loginViaToken(page: Page) {
  await page.route("**/api/auth/verify", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, user: { id: 1, email: "e2e@test.com", role: "expert" }, role: "expert" }),
    }),
  );
  await page.addInitScript(() => {
    localStorage.setItem("expertToken", "e2e-test-token");
    localStorage.setItem("userRole", "expert");
  });
}

// 전문가 페이지 — 탭 전환 + 대시보드 렌더링 테스트
test.describe("전문가 페이지", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // 빈 DB여도 페이지 로드는 가능 — 네비게이션 버튼 대기
    await page.locator("body").waitFor({ state: "attached", timeout: 10000 });
  });

  test("전문가 탭 클릭 시 로그인 폼 또는 대시보드 표시", async ({ page }) => {
    const expertTab = page.getByText("전문가", { exact: false });
    if (!(await expertTab.isVisible())) {
      test.skip(true, "전문가 탭 미존재");
      return;
    }

    await expertTab.click();
    const loginForm = page.locator('input[type="email"], input[type="password"]');
    const dashboard = page.getByText("데이터 완성도", { exact: false });
    await expect(loginForm.first().or(dashboard)).toBeVisible({ timeout: 5000 });
  });

  test("정보 탭에서 스코어링 설명 표시", async ({ page }) => {
    const infoTab = page.getByText("정보", { exact: true });
    if (!(await infoTab.isVisible())) {
      test.skip(true, "정보 탭 미존재");
      return;
    }

    await infoTab.click();
    const scoring = page.getByText("스코어링", { exact: false });
    await expect(scoring.first()).toBeVisible({ timeout: 3000 });
  });

  // 목차바 칩 점프 — jsdom 단위테스트가 못 증명하는 "실브라우저: 맨 아래 섹션이 viewport 안으로
  // 들어옴" 검증. 전문가 로그인 시 tab=expert 자동 진입(App.tsx:121), 단지 자동 선택(selectedId).
  test("전문가 목차바 칩 클릭 시 섹션 노출 + 스크롤 + active", async ({ page }) => {
    await loginViaToken(page);
    await page.goto("/");

    const summaryChip = page.getByRole("button", { name: "요약" });
    const hasChips = await summaryChip
      .waitFor({ state: "visible", timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    if (!hasChips) {
      test.skip(true, "전문가 대시보드 칩 미렌더 — 빈 DB 또는 미진입");
      return;
    }

    // 헤드리스 Chromium smooth scroll 비결정성 회피 — 컨테이너 scrollTo 의 behavior 인자만 벗겨
    // 동기 스크롤화(prod handleJump 불변). detail-modal.spec.ts 패치 답습.
    const body = page.locator("[data-print-content]");
    await body.evaluate((el) => {
      const orig = el.scrollTo.bind(el);
      el.scrollTo = (opts?: ScrollToOptions | number, y?: number) => {
        if (opts && typeof opts === "object") orig({ top: opts.top, left: opts.left ?? 0 });
        else orig(opts as number, y as number);
      };
    });

    await expect(page.locator("#sec-분양")).not.toBeInViewport();
    const before = await body.evaluate((el) => el.scrollTop);
    const lastChip = page.getByRole("button", { name: "네이버 분양정보" });
    await lastChip.click();

    await expect(page.locator("#sec-분양")).toBeInViewport({ timeout: 4000 });
    await expect
      .poll(() => body.evaluate((el) => el.scrollTop), { timeout: 4000 })
      .toBeGreaterThan(before);
    await expect(lastChip).toHaveAttribute("aria-current", "true");
  });

  // 모바일 점프 회귀 가드 (세션 383) — smooth scroll 이 클릭 직후 리렌더+observer 로 취소돼
  // scrollTop 0 잔존하던 버그(behavior:"auto" 로 수정). 위 데스크톱 테스트는 scrollTo behavior
  // 를 벗겨 동기화하므로 이 버그를 못 잡았다. 여기선 prod handleJump(auto) 그대로 두고 실제 이동 검증.
  test("모바일 목차 칩 클릭 시 실제 스크롤 이동 (smooth 취소 회귀 가드)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginViaToken(page);
    await page.goto("/");

    const priceChip = page.getByRole("button", { name: "가격" });
    const hasChips = await priceChip
      .waitFor({ state: "visible", timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    if (!hasChips) {
      test.skip(true, "전문가 대시보드 칩 미렌더 — 빈 DB 또는 미진입");
      return;
    }

    const body = page.locator("[data-print-content]");
    const before = await body.evaluate((el) => el.scrollTop);
    await priceChip.click();
    // prod 코드 그대로(behavior:"auto") — 즉시 이동하므로 짧은 대기로 충분
    await expect
      .poll(() => body.evaluate((el) => el.scrollTop), { timeout: 3000 })
      .toBeGreaterThan(before + 100);
    await expect(page.locator("#sec-가격")).toBeInViewport({ timeout: 3000 });
  });
});
