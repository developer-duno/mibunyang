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

  // 목차 드롭다운 점프 (세션 383) — ExpertDashboard 는 variant="dropdown"(가로 스크롤 칩바 →
  // 단추+세로 목록). 단추 펼침 → 항목 클릭 → 맨 아래 섹션이 viewport 안으로 들어옴 검증.
  // 전문가 로그인 시 tab=expert 자동 진입, 단지 자동 선택(selectedId).
  test("전문가 목차 드롭다운 항목 클릭 시 섹션 노출 + 스크롤", async ({ page }) => {
    await loginViaToken(page);
    await page.goto("/");

    // dropdown 단추 = aria-haspopup="listbox". 펼치기 전 active 라벨(기본 "요약") 표시.
    const navBtn = page.getByRole("button", { name: /요약/ }).and(page.locator('[aria-haspopup="listbox"]'));
    const hasNav = await navBtn
      .waitFor({ state: "visible", timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    if (!hasNav) {
      test.skip(true, "전문가 대시보드 목차 미렌더 — 빈 DB 또는 미진입");
      return;
    }

    const body = page.locator("[data-print-content]");
    await expect(page.locator("#sec-분양")).not.toBeInViewport();
    const before = await body.evaluate((el) => el.scrollTop);

    await navBtn.click(); // 드롭다운 펼치기
    await page.getByRole("option", { name: "네이버 분양정보" }).click();

    await expect(page.locator("#sec-분양")).toBeInViewport({ timeout: 4000 });
    await expect
      .poll(() => body.evaluate((el) => el.scrollTop), { timeout: 4000 })
      .toBeGreaterThan(before);
  });

  // 모바일 점프 회귀 가드 (세션 383) — smooth scroll 이 클릭 직후 리렌더+observer 로 취소돼
  // scrollTop 0 잔존하던 버그(behavior:"auto" 로 수정). prod handleJump(auto) 그대로 두고 실제 이동 검증.
  test("모바일 목차 드롭다운 항목 클릭 시 실제 스크롤 이동 (smooth 취소 회귀 가드)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginViaToken(page);
    await page.goto("/");

    const navBtn = page.locator('[aria-haspopup="listbox"]');
    const hasNav = await navBtn
      .waitFor({ state: "visible", timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    if (!hasNav) {
      test.skip(true, "전문가 대시보드 목차 미렌더 — 빈 DB 또는 미진입");
      return;
    }

    const body = page.locator("[data-print-content]");
    const before = await body.evaluate((el) => el.scrollTop);
    await navBtn.click(); // 펼치기
    await page.getByRole("option", { name: "가격/시장 지표" }).click(); // FIELD_SECTIONS key="가격" label="가격/시장 지표"
    // prod 코드 그대로(behavior:"auto") — 즉시 이동하므로 짧은 대기로 충분
    await expect
      .poll(() => body.evaluate((el) => el.scrollTop), { timeout: 3000 })
      .toBeGreaterThan(before + 100);
    await expect(page.locator("#sec-가격")).toBeInViewport({ timeout: 3000 });
  });

  // 목차 드롭다운 키보드 접근성 (세션 383) — role=listbox 계약: Escape 닫기 + 화살표 이동 + Enter 선택.
  test("목차 드롭다운 키보드 — Escape 닫기 + 화살표 이동 + Enter 점프", async ({ page }) => {
    await loginViaToken(page);
    await page.goto("/");

    const navBtn = page.locator('[aria-haspopup="listbox"]');
    const hasNav = await navBtn
      .waitFor({ state: "visible", timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    if (!hasNav) {
      test.skip(true, "전문가 대시보드 목차 미렌더 — 빈 DB 또는 미진입");
      return;
    }

    // 1) Escape 로 닫힘
    await navBtn.click();
    await expect(page.getByRole("listbox")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox")).toBeHidden();

    // 2) 펼치면 active("요약")에 포커스 → ArrowDown → Enter 로 다음 섹션 점프
    const body = page.locator("[data-print-content]");
    const before = await body.evaluate((el) => el.scrollTop);
    await navBtn.click();
    await page.keyboard.press("ArrowDown"); // 요약 → 단지 개요
    await page.keyboard.press("ArrowDown"); // 단지 개요 → 가격/시장 지표
    await page.keyboard.press("Enter");      // 선택
    await expect(page.getByRole("listbox")).toBeHidden(); // 선택 후 닫힘
    await expect
      .poll(() => body.evaluate((el) => el.scrollTop), { timeout: 3000 })
      .toBeGreaterThan(before);
  });
});
