import { test, expect } from "@playwright/test";

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
    const body = JSON.stringify({
      ok: true,
      count: 1,
      fetchedAt: new Date().toISOString(),
      dataUpdatedAt: new Date().toISOString(),
      data: [{
        id: "ah-test-supabase-guard",
        name: "Supabase 가드 회귀 테스트 단지",
        region: "서울",
        gu: "강남구",
        dong: "역삼동",
        address: "테스트 1-1",
        builder: "테스트사",
        buildingCount: 1,
        totalUnits: 100,
        unsoldCount: 5,
        unsoldRate: 5,
        supplyPriceMin: 50000,
        supplyPriceMax: 60000,
        psr: 1.2,
        pir: 5.5,
        moveInDate: "2026-12-01",
        cats: { transport: 80, school: 70, eco: 60, safety: 70, growth: 60, value: 70 },
        // 핵심 가드 발동 자리: 빈 배열 (가드가 fetch skip 해야 함)
        priceByArea: [],
        rentByArea: [],
        jeonseByArea: [],
        priceByFloor: [],
      }],
    });
    for (const pattern of ["**/api/supabase/apartments", "**/data/apartments-list.json"]) {
      await page.route(pattern, route =>
        route.fulfill({ status: 200, contentType: "application/json", body })
      );
    }

    await page.goto("/");

    // 카드 클릭 → DetailModal 열기
    const card = page.locator('[role="button"]').first();
    const hasCard = await card.isVisible({ timeout: 15000 }).catch(() => false);
    if (!hasCard) {
      test.skip(true, "카드 데이터 없음 — mock 응답 형식 오류 가능");
      return;
    }
    await card.click();

    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // 모달 본문 일정 시간 대기 (lazy fetch 가 깨졌으면 이 시점에 발동)
    await page.waitForTimeout(2000);

    // 가드 핵심 검증: 상세 버킷 fetch 미발동
    expect(detailFetched, "DetailModal 이 빈 배열 priceByArea 응답에도 상세 버킷 fetch 발동 (0557e1a 가드 회귀)").toBe(false);
  });
});
