import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { stubProxyApis } from "./helpers";

// 세션664 B1: 운영 프록시 호출 0 — 이 파일의 다른 가로채기보다 먼저 등록해야 시험 쪽 route 가 이긴다(helpers.ts stubProxyApis).
test.beforeEach(async ({ page }) => {
  await stubProxyApis(page);
});

const CI_LIST = JSON.parse(readFileSync(new URL("./fixtures/apartments-ci.json", import.meta.url), "utf8")) as {
  data: Array<Record<string, unknown>>;
} & Record<string, unknown>;

/**
 * 세션 280 커밋 B (0557e1a) 회귀 가드:
 * apartments_flat VIEW 응답이 `priceByArea: []` (빈 배열, trade_stats 응답 완료지만 행 0건)
 * 일 때, DetailModal 이 상세 버킷 JSON 을 불필요 fetch 하지 않는지 검증.
 *
 * 0557e1a 가드 분기:
 *   - null: trade_stats LEFT JOIN miss → skip
 *   - 배열 (빈 배열 포함): trade_stats 응답 완료 → skip
 *   - undefined: 정적 분기 list.json 미수록 → fetch 발동 (정적 lazy)
 *
 * ⚠️ 감시 대상 URL 은 세션 468(PR1)에 `apartments-prices.json` → 상세 해시 버킷
 * `apartments-detail-16-{i}.json` 으로 옮겨갔고, PR2(세션 495)에서 prices 파일 생성 자체가
 * 중단됐다. 옛 prices URL 을 계속 감시하면 **앱이 절대 부르지 않는 주소**를 지켜보는 셈이라
 * 가드를 없애도 통과하는 가짜 초록불이 된다 — 그래서 버킷 glob 으로 재조준한다.
 */
test.describe("DetailModal Supabase 가드 회귀", () => {
  test("priceByArea: [] (빈 배열) 응답 시 상세 버킷 fetch 미발동", async ({ page }) => {
    // 상세 버킷 fetch 시 즉시 fail — 가드가 깨졌을 때만 fetch 발생
    let detailFetched = false;
    await page.route("**/data/apartments-detail-*.json", route => {
      detailFetched = true;
      return route.abort();
    });

    // 한 단지가 빈 배열 priceByArea 보유.
    // 앱은 VITE_USE_SUPABASE 에 따라 `/api/supabase/apartments` 또는 `/data/apartments-list.json`
    // 을 부르므로 **둘 다** 가로챈다(helpers.ts stubApartments 관행 답습 — 플래그 무관 동작).
    // 세션664: 옛 손 행은 칸 이름이 실제 응답과 달라(`unsoldCount` — 실제는 `unsold`) 기본 필터에 걸려
    //   카드가 0 이었고, skip 이 그것을 8/4부터 가렸다. 이제 CI 공용 픽스처(운영 응답 그대로)의 첫 행을 쓰고
    //   가드가 보는 가격 배열 4칸만 빈 배열로 바꾼다.
    const real = CI_LIST.data[0];
    const body = JSON.stringify({
      ...CI_LIST,
      count: 1,
      data: [
        {
          ...real,
          // 핵심 가드 발동 자리: 빈 배열 (가드가 fetch skip 해야 함)
          priceByArea: [],
          rentByArea: [],
          jeonseByArea: [],
          priceByFloor: [],
        },
      ],
    });
    for (const pattern of ["**/api/supabase/apartments", "**/data/apartments-list.json"]) {
      await page.route(pattern, route =>
        route.fulfill({ status: 200, contentType: "application/json", body })
      );
    }

    await page.goto("/");

    // 카드 클릭 → DetailModal 열기
    const card = page.locator('[role="button"]').first();
    // 세션664: 이 시험은 자기 손 픽스처(priceByArea: [])가 핵심이라 공용 픽스처를 쓰지 않는다. 카드 0 이면 실패.
    const hasCard = await card
      .waitFor({ state: "visible", timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    expect(hasCard, "가짜 응답인데 카드 0 — mock 응답 형식·가로채기 깨짐").toBe(true);
    await card.click();

    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // 모달 본문 일정 시간 대기 (lazy fetch 가 깨졌으면 이 시점에 발동)
    await page.waitForTimeout(2000);

    // 가드 핵심 검증: 상세 버킷 fetch 미발동
    expect(detailFetched, "DetailModal 이 빈 배열 priceByArea 응답에도 상세 버킷 fetch 발동 (0557e1a 가드 회귀)").toBe(false);
  });
});
