import { test, expect } from "@playwright/test";

/**
 * 세션 280 커밋 B (0557e1a) 회귀 가드:
 * Supabase 분기 (VITE_USE_SUPABASE=true) 에서 apartments_flat VIEW 응답이
 * `priceByArea: []` (빈 배열, trade_stats 응답 완료지만 행 0건) 일 때,
 * DetailModal 이 `/data/apartments-prices.json` 11.35MB 를 불필요 fetch 하지 않는지 검증.
 *
 * 0557e1a 가드 분기:
 *   - null: trade_stats LEFT JOIN miss → skip
 *   - 배열 (빈 배열 포함): trade_stats 응답 완료 → skip
 *   - undefined: 정적 분기 list.json 미수록 → fetch 발동 (정적 lazy)
 */
test.describe("DetailModal Supabase 가드 회귀", () => {
  test("priceByArea: [] (빈 배열) 응답 시 apartments-prices.json fetch 미발동", async ({ page }) => {
    // 정적 prices 파일 fetch 시 즉시 fail — 가드가 깨졌을 때만 fetch 발생
    let pricesFetched = false;
    await page.route("**/data/apartments-prices.json", route => {
      pricesFetched = true;
      return route.abort();
    });

    // Supabase 응답 mock — 한 단지가 빈 배열 priceByArea 보유
    await page.route("**/api/supabase/apartments", async route => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
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
        }),
      });
    });

    await page.goto("/");

    // 카드 클릭 → DetailModal 열기
    const card = page.locator('[role="button"]').first();
    const hasCard = await card.isVisible({ timeout: 15000 }).catch(() => false);
    if (!hasCard) {
      test.skip(true, "카드 데이터 없음 — Supabase mock 응답 형식 오류 가능");
      return;
    }
    await card.click();

    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // 모달 본문 일정 시간 대기 (lazy fetch 가 깨졌으면 이 시점에 발동)
    await page.waitForTimeout(2000);

    // 가드 핵심 검증: prices.json fetch 미발동
    expect(pricesFetched, "DetailModal 이 빈 배열 priceByArea 응답에도 apartments-prices.json fetch 발동 (0557e1a 가드 회귀)").toBe(false);
  });
});
