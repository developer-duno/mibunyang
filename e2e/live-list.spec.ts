import { test, expect } from "@playwright/test";
import { gotoListTab, stubProxyApis } from "./helpers";

// 운영 실데이터 스모크 (세션664).
//
// ⚠️ 이 시험 **하나만** 운영에 기댄다 — 가로채기 없이 dev 서버의 vite 프록시(`/api` → 운영)로
// 실제 목록 API(약 29MB)를 받는다. 나머지 카드 시험은 `stubCiApartments`(공용 픽스처)를 쓴다.
// 카드 시험이 운영 응답 속도(우리 PC 11~14초 · CI 는 15초 초과)에 묶여 8/4부터 전부 skip 이던 것을
// 픽스처로 옮기고, "운영 목록이 실제로 오는가"는 여기서 넉넉한 60초로 따로 본다. skip 없음 — 안 오면 실패.
test("운영 목록이 실제로 온다(60초)", async ({ page }) => {
  test.setTimeout(90_000);
  await stubProxyApis(page); // 목록 말고 다른 API(곧 분양 등)는 막는다 — 운영으로 가는 건 목록 하나뿐(세션664 B1)
  // 실패했을 때 왜인지(429 한도 · 5xx · 응답 없음) 메시지에 남긴다 — StrictMode 로 끊긴 첫 요청은 응답이 없을 수 있다.
  const statuses: number[] = [];
  page.on("response", (r) => {
    if (new URL(r.url()).pathname === "/api/supabase/apartments") statuses.push(r.status());
  });
  await page.goto("/");
  await gotoListTab(page);
  const cards = page.locator('[role="button"]').filter({ hasText: "㎡" });
  const shown = await cards
    .first()
    .waitFor({ state: "visible", timeout: 60_000 })
    .then(() => true)
    .catch(() => false);
  const why = statuses.length
    ? `/api/supabase/apartments 응답 ${statuses.join(",")}(마지막 ${statuses[statuses.length - 1]})`
    : "/api/supabase/apartments 응답 없음";
  expect(shown, `60초 안에 카드 없음 — ${why}`).toBe(true);
  expect(await cards.count(), "운영 목록인데 카드가 10장 미만").toBeGreaterThanOrEqual(10);
});
