import { test, expect } from "@playwright/test";

// 비로그인 시각 회귀 baseline (세션 418)
// - 카카오 OAuth 로그인 게이트 안쪽(지도·상세)은 자동 캡처 불가 → 비로그인 화면만.
// - daily refresh 로 카드 데이터가 매일 바뀌므로 동적 데이터 영역은 mask 처리,
//   안정적 UI 골격(헤더·필터바·네비·빈상태)만 baseline 으로 잡는다.
// - 최초 실행: `npx playwright test e2e/visual.spec.ts --update-snapshots` 로 baseline 생성.
// - 회귀 검사: 이후 `npx playwright test e2e/visual.spec.ts` 가 baseline 과 픽셀 비교.
//
// @visual 태그 → 평소 e2e 와 분리 실행 가능 (`npx playwright test --grep @visual`).

test.describe("비로그인 시각 baseline @visual", () => {
  test.beforeEach(async ({ page }) => {
    // 애니메이션·캐럿 깜빡임 제거 → 픽셀 안정화
    await page.addStyleTag({
      content: `*, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        caret-color: transparent !important;
      }`,
    });
  });

  test("목록 메인 — 상단 골격 (헤더+필터바)", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("body")).toContainText("미분양");
    // 카드 로딩(skeleton)이 끝날 때까지 대기 — 빈 DB 도 허용(15s 안에 안 뜨면 빈상태)
    await page
      .locator('[role="button"]')
      .first()
      .waitFor({ state: "visible", timeout: 15000 })
      .catch(() => {});
    // 동적 카드 그리드는 mask — 매일 바뀌는 단지 데이터는 비교 대상 아님
    await expect(page).toHaveScreenshot("list-main-desktop.png", {
      fullPage: false,
      maxDiffPixelRatio: 0.02,
      mask: [page.locator('[role="button"]')],
      animations: "disabled",
    });
  });

  test("목록 메인 — 모바일 골격 (375px)", async ({ page }) => {
    // visual 프로젝트는 Desktop Chrome 디바이스라 viewport 를 spec 에서 직접 모바일로 설정.
    // (프로젝트 device 의존 시 desktop/mobile baseline 이 동일 캡처되는 함정 회피)
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await expect(page.locator("body")).toContainText("미분양");
    await page
      .locator('[role="button"]')
      .first()
      .waitFor({ state: "visible", timeout: 15000 })
      .catch(() => {});
    await expect(page).toHaveScreenshot("list-main-mobile.png", {
      fullPage: false,
      maxDiffPixelRatio: 0.02,
      mask: [page.locator('[role="button"]')],
      animations: "disabled",
    });
  });
});
