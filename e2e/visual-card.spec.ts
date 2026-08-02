import { test, expect } from "@playwright/test";
import { gotoListTab, stubApartments, freezeAnimations, waitForStableRender } from "./helpers";

/**
 * 단지 카드 시각 baseline (세션 487, 시각화 PR-2).
 *
 * ## 왜 별도 파일인가 — `visual.spec.ts` 로는 카드 변경을 **한 건도 못 잡는다**
 *
 * `visual.spec.ts` 는 `mask: [page.locator('[role="button"]')]` 로 캡처한다.
 * 그런데 단지 카드 자체가 `role="button"` 이라, 저 마스크는 **카드 30장을 통째로
 * 검은 사각형으로 덮는다.** 카드 안이 어떻게 바뀌든 스냅샷은 그대로다.
 * 매일 바뀌는 단지 데이터 때문에 어쩔 수 없이 그렇게 만든 것이라 그 파일은 옳고,
 * 대신 여기서 **데이터를 고정**해 마스크 없이 카드를 직접 찍는다.
 *
 * ## 어떻게 고정하나
 *
 * `page.route()` 로 데이터 응답을 굽어둔 픽스처(`fixtures/apartments-visual.json`)로
 * 바꿔치기한다. 앱은 `VITE_USE_SUPABASE` 에 따라 `/api/supabase/apartments` 또는
 * `/data/apartments-list.json` 을 부르므로 **둘 다** 가로챈다(플래그 무관 동작).
 *
 * 픽스처 앞 3단지는 일부러 서로 다른 상태다(전부 경기 — 아래 "왜 한 지역인가" 참조):
 *   1. 의정부역 센트럴자이앤위브캐슬 — 잘 채워짐(분양중·역세권 515m·전용률 74%)
 *   2. 동탄 그웬 160 — **최악 결손**(분양가·소득부담·주차·관리비·전용률 전부 없음 + 분양정보 전무)
 *   3. 더샵 광교산퍼스트파크 — 중간(역세권 밖 2.9km·분양정보 없음)
 * 잘 채워진 단지만 보고 결정하면 2번 화면을 못 본다. 그래서 셋을 함께 찍는다.
 *
 * ## 왜 셋 다 경기인가
 *
 * 총 21단지(3 + 배경 18)로 맞추기 위해서다. 한 페이지가 30장이라 21이면 전부 첫 화면에
 * 렌더돼 **"더 보기"를 누를 일이 없다**. 동시에 경기 표본 21개는 G1 임계(시도 n≥20)를
 * 넘겨 PR-3 의 편차 막대가 "전국 폴백"이 아닌 **지역 기준**으로 그려진다 — 즉 실제
 * 운영과 같은 경로를 찍는다.
 *
 * ## 실행
 *
 *   baseline 생성: `PW_VISUAL=1 npx playwright test --project=visual --update-snapshots`
 *   회귀 검사:     `PW_VISUAL=1 npx playwright test --project=visual`
 *
 * ⚠️ CI 에서는 돌지 않는다 — baseline 픽셀이 OS 마다 달라 `visual` 프로젝트 자체가
 * `PW_VISUAL=1` 일 때만 켜지고, 현재 baseline 은 win32 로 떠 있다(`visual.spec.ts` 와 동일 관습).
 * 즉 이 파일은 **카드를 고치기 전후로 사람이 직접 돌려 비교하는 도구**다.
 */

test.describe("단지 카드 시각 baseline @visual", () => {
  test.beforeEach(async ({ page }) => {
    await stubApartments(page);
    await freezeAnimations(page);
  });

  /**
   * 이름으로 카드를 찾는다.
   *
   * ⚠️ **인덱스(`nth(0)`)로 잡으면 안 된다** — 목록은 점수순으로 정렬되므로
   * 픽스처의 첫 단지가 화면 첫 카드가 아니다(실제로 이 함정에 걸렸다).
   *
   * 픽스처를 21단지로 맞춰 둔 덕에 한 페이지(`VISIBLE_PAGE_SIZE` 30) 안에 다 들어온다
   * → **"더 보기"를 누를 일이 없다.** 예전엔 63단지라 페이지를 넘겨야 했는데, 콜드 스타트
   * 때 그 클릭이 오버레이에 막혀 간헐 타임아웃이 났다(세션 487 실측). 없앨 수 있는
   * 불안정 요인은 없앤다.
   *
   * 이름 조각은 픽스처 안에서 유일하도록 골라 뒀다(전각 공백이 섞인 원본 이름 대신
   * 공백 없는 조각을 쓴다 — Playwright 의 텍스트 정규화가 전각 공백을 건드릴 수 있다).
   */
  async function cardNamed(page: import("@playwright/test").Page, namePart: string) {
    await page.goto("/");
    await gotoListTab(page);
    const card = page.locator('[role="button"]').filter({ hasText: namePart }).first();
    await card.waitFor({ state: "visible", timeout: 15000 });
    await card.scrollIntoViewIfNeeded();
    await page.waitForLoadState("networkidle").catch(() => {});
    await waitForStableRender(page);
    return card;
  }

  /** 픽스처 안에서 유일한 이름 조각 (`fixtures/apartments-visual.json` 생성 시 보장) */
  const RICH = "의정부역 센트럴자이"; // ① 잘 채워짐 (분양중·역세권 515m·전용률 74%)
  const SPARSE = "동탄 그웬 160"; // ② 최악 결손 (분양가·소득부담·주차·관리비·전용률 없음 + 분양정보 전무)
  const MID = "광교산퍼스트파크"; // ③ 중간 (역세권 밖 2.9km·분양정보 없음)

  test("카드 ① 잘 채워진 단지 — 데스크톱", async ({ page }) => {
    const card = await cardNamed(page, RICH);
    await expect(card).toHaveScreenshot("card-rich-desktop.png", {
      maxDiffPixelRatio: 0.01,
      animations: "disabled",
    });
  });

  test("카드 ② 최악 결손 단지 — 데스크톱", async ({ page }) => {
    const card = await cardNamed(page, SPARSE);
    await expect(card).toHaveScreenshot("card-sparse-desktop.png", {
      maxDiffPixelRatio: 0.01,
      animations: "disabled",
    });
  });

  test("카드 ③ 중간 단지 — 데스크톱", async ({ page }) => {
    const card = await cardNamed(page, MID);
    await expect(card).toHaveScreenshot("card-mid-desktop.png", {
      maxDiffPixelRatio: 0.01,
      animations: "disabled",
    });
  });

  test("카드 ① — 375px 모바일 (트랙 폭이 가장 좁은 조건)", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const card = await cardNamed(page, RICH);
    await expect(card).toHaveScreenshot("card-rich-mobile.png", {
      maxDiffPixelRatio: 0.01,
      animations: "disabled",
    });
  });

  test("카드 ① — 1024px 데스크톱 3열 (트랙 폭 최악 108px 조건)", async ({ page }) => {
    // 설계 §2-6: 1024 3열이 카드 폭 312 → 트랙 108px 로 가장 좁다.
    await page.setViewportSize({ width: 1024, height: 900 });
    const card = await cardNamed(page, RICH);
    await expect(card).toHaveScreenshot("card-rich-1024.png", {
      maxDiffPixelRatio: 0.01,
      animations: "disabled",
    });
  });
});
