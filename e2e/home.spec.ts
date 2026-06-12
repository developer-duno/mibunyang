import { test, expect } from "@playwright/test";

// VITE_FEATURE_HOME=true 환경에서만 홈 탭 노출 — flag OFF 환경에서는 자동 skip
test.describe("통합 홈 위젯판 (M1)", () => {
  test("홈 초기 진입 → 위젯 → D5 잠금 → '전체 목록' 펼치기", async ({ page }) => {
    await page.goto("/");
    const homeBtn = page.getByRole("button", { name: "홈" }).first();
    const isFeatureOn = await homeBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (!isFeatureOn) {
      test.skip(true, "VITE_FEATURE_HOME flag OFF — 홈 미노출 (정상)");
      return;
    }

    await expect(page.getByText("📊 시장 요약")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("로그인하면 지도가 열려요")).toBeVisible();

    await page.getByRole("button", { name: "로그인하고 지도 열기" }).click();
    await expect(page.getByRole("dialog", { name: "로그인 안내" })).toBeVisible();
    await page.getByRole("button", { name: "나중에 하기" }).click();

    await page.getByRole("button", { name: /전체 목록/ }).click();
    await expect(page.getByText("📊 시장 요약")).not.toBeVisible();
  });

  // M2: 로그인 시 지도 위젯 = MapView 미니지도 임베드 (spec "expert e2e" 대체 — admin 로그인 경유).
  // CI 는 VITE_KAKAO_JS_KEY 미주입이라 에러 오버레이 분기 — 단언은 키 유무 무관한
  // 결과수 badge(/개 단지/, ready·error 와 무관 항상 렌더)로. 실지도 렌더 검증은 로컬 브라우저 1회.
  test("관리자 로그인 → 홈 미니지도 임베드 (잠금 해제 + 결과수 badge)", async ({ page }) => {
    // admin API mock (admin.spec.ts setupAdminMocks 답습 — admin 탭 착지 시 unmocked 404 토스트 차단)
    await page.route("**/api/auth/login", async (route) => {
      await route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ ok: true, token: "mock-admin-jwt", user: { email: "admin@test.com" }, role: "admin" }),
      });
    });
    await page.route("**/api/auth/verify", async (route) => {
      await route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ ok: true, user: { email: "admin@test.com" }, role: "admin" }),
      });
    });
    await page.route("**/api/admin/users*", async (route) => {
      const url = new URL(route.request().url());
      const body = url.searchParams.get("action") === "stats"
        ? { ok: true, counts: { pending: 0, approved: 0, rejected: 0, suspended: 0 }, userTypes: {}, specialtyDist: {}, recentSignups: [] }
        : { ok: true, users: [] };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.route("**/api/consults", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: [] }) });
    });

    await page.goto("/");
    const homeBtn = page.getByRole("button", { name: "홈" }).first();
    const isFeatureOn = await homeBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (!isFeatureOn) {
      test.skip(true, "VITE_FEATURE_HOME flag OFF — 홈 미노출 (정상)");
      return;
    }

    // 관리자 로그인 (정보 → 관리자 로그인 → 폼) — 로그인 직후 admin 탭 직행 (useAppNavigation L29-32)
    await page.getByText("정보", { exact: true }).click();
    await page.getByText("관리자 로그인", { exact: false }).click();
    await page.locator('input[type="email"]').fill("admin@test.com");
    await page.locator('input[type="password"]').fill("testpassword");
    await page.locator('button[type="submit"]').click();
    await expect(page.getByText("관리자 대시보드")).toBeVisible({ timeout: 10000 });

    // admin 탭 → 헤더 네비 "홈" 명시 클릭 (chromium 1280px = isDesktop, BottomNav null)
    await page.getByRole("button", { name: "홈" }).first().click();

    // 잠금 placeholder 부재 + 미니지도 위젯 결과수 badge 노출
    await expect(page.getByText("로그인하면 지도가 열려요")).not.toBeVisible();
    const mapWidget = page.getByTestId("map-widget");
    await expect(mapWidget).toBeVisible({ timeout: 10000 });
    await expect(mapWidget.getByText(/개 단지/)).toBeVisible({ timeout: 10000 });
  });
});
