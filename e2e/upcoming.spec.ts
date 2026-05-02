import { test, expect, Page } from "@playwright/test";

// /upcoming 페이지 E2E — /api/upcoming HTTP 500 회귀 방지 핵심
// 전제: dev 서버에 VITE_FEATURE_UPCOMING=true 로 띄워야 /upcoming 라우트 진입 가능
//       (없으면 / 로 replaceState 됨, App.jsx:60-67)

const SAMPLE_APT_WITH_SCORE = {
  id: "ap-test-1",
  name: "테스트 분양단지",
  region: "서울",
  gu: "강남구",
  presaleStage: "분양중",
  presaleMinPrice: 50000,
  presalePp: 3500,
  presaleRecruitDate: "2026-05-08",
  presaleSchedule: null,
  presaleImageUrl: null,
  naverPresaleNo: null,
  naverPresaleSeq: null,
  catsCache: { total: 78.5, price: 80, location: 75, product: 80 },
};

async function mockUpcomingOk(page: Page, body: Record<string, unknown>) {
  await page.route("**/api/upcoming", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        stages: { plan: [], apply: [], sale: [] },
        calendar: {},
        totals: { plan: 0, apply: 0, sale: 0 },
        fetchedAt: new Date().toISOString(),
        ...body,
      }),
    });
  });
}

async function mockUpcoming500(page: Page) {
  await page.route("**/api/upcoming", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "데이터 조회 실패" }),
    });
  });
}

test.describe("/upcoming — 분양 임박 페이지 회귀 방지", () => {
  test("200 빈 데이터 응답 시 '데이터를 불러오지 못했습니다' 미표시", async ({ page }) => {
    await mockUpcomingOk(page, {});
    await page.goto("/upcoming");
    // 로딩 → 빈 상태로 전환 대기
    await expect(page.getByText("데이터를 불러오지 못했습니다")).toHaveCount(0);
    await expect(page.getByText("현재 분양 임박 단지가 없습니다.").first()).toBeVisible();
  });

  test("500 응답 시 에러 UI + '다시 시도' 버튼 표시", async ({ page }) => {
    await mockUpcoming500(page);
    await page.goto("/upcoming");
    await expect(page.getByText("데이터를 불러오지 못했습니다")).toBeVisible();
    await expect(page.getByRole("button", { name: "다시 시도" })).toBeVisible();
  });

  test("catsCache 포함된 단지 응답 시 점수 배지 '★ 점수 78.5' 렌더", async ({ page }) => {
    await mockUpcomingOk(page, {
      stages: { plan: [], apply: [], sale: [SAMPLE_APT_WITH_SCORE] },
      totals: { plan: 0, apply: 0, sale: 1 },
    });
    await page.goto("/upcoming");
    await expect(page.getByText("테스트 분양단지")).toBeVisible();
    await expect(page.getByText(/★ 점수 78\.5/)).toBeVisible();
  });
});
