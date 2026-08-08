import { test, expect } from "@playwright/test";
import { stubApartments, freezeAnimations, waitForStableRender } from "./helpers";

// 비로그인 시각 회귀 baseline (세션 418)
// - 카카오 OAuth 로그인이 필요한 화면(지도)은 자동 캡처 불가 → 비로그인 화면만.
//   ⚠️ 세션 503(2-B): **상세는 이제 비로그인도 열린다**(점수만 블라인드). 지금 이 파일은 그걸
//   아직 안 찍는데, 상세 화면 시각 회귀를 잡고 싶으면 캡처 대상에 추가할 수 있는 상태가 됐다.
// - 카드 데이터는 고정 픽스처로 스텁한다(세션 487). 원래는 mask 만으로 daily refresh 를
//   피하려 했으나, 마스크는 카드 *내용*만 가릴 뿐 **카드 높이**는 못 가려서 칩이 하나만
//   늘어도 아래 요소가 전부 밀려 baseline 이 스스로 깨졌다(실측 확인). mask 는 그대로 둔다
//   — 데이터를 고정한 지금은 중복 안전장치일 뿐 해가 없다.
// - 최초 실행: `npx playwright test e2e/visual.spec.ts --update-snapshots` 로 baseline 생성.
// - 회귀 검사: 이후 `npx playwright test e2e/visual.spec.ts` 가 baseline 과 픽셀 비교.
//
// @visual 태그 → 평소 e2e 와 분리 실행 가능 (`npx playwright test --grep @visual`).

test.describe("비로그인 시각 baseline @visual", () => {
  test.beforeEach(async ({ page }) => {
    await stubApartments(page);
    await freezeAnimations(page);
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
    await waitForStableRender(page);
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
    await waitForStableRender(page);
    await expect(page).toHaveScreenshot("list-main-mobile.png", {
      fullPage: false,
      maxDiffPixelRatio: 0.02,
      mask: [page.locator('[role="button"]')],
      animations: "disabled",
    });
  });
});
