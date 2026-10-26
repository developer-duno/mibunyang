import type { Locator, Page } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * 시각 회귀용 고정 단지 데이터 (세션 487).
 *
 * 앞 3단지가 서로 다른 상태다 — ① 잘 채워짐(대구 힐스테이트 달성공원역)
 * ② **최악 결손**(세종더샵예미지 Ｌ４블록 — 분양정보 전무·지하철/KTX 센티널·미분양 null)
 * ③ 중간(서울 강서 크라운팰리스 — 역세권 밖·전용률 없음).
 * 뒤의 배경 60단지는 지역 기준값(시도당 표본 21개)을 성립시키기 위한 것이다.
 */
const VISUAL_FIXTURE = JSON.parse(readFileSync(new URL("./fixtures/apartments-visual.json", import.meta.url), "utf8"));

/**
 * 단지 데이터 응답을 고정 픽스처로 바꿔치기한다.
 *
 * **왜 필요한가** — 시각 baseline 이 실데이터를 쓰면 daily refresh 때문에 며칠이면
 * 스스로 깨진다. `visual.spec.ts` 는 카드를 `mask` 로 가려 이를 피하려 했지만,
 * 마스크는 카드 *내용*만 가릴 뿐 **카드 높이**는 못 가린다. 칩이 하나 늘면 카드가
 * 길어지고 그 아래 모든 요소가 밀려 baseline 이 깨진다(세션 487 실측: 실제로 깨져 있었다).
 *
 * 앱은 `VITE_USE_SUPABASE` 에 따라 `/api/supabase/apartments` 또는
 * `/data/apartments-list.json` 을 부르므로 **둘 다** 가로챈다(플래그 무관 동작).
 *
 * ⚠️ `page.goto()` **전에** 불러야 한다.
 */
export async function stubApartments(page: Page): Promise<void> {
  for (const pattern of ["**/api/supabase/apartments", "**/data/apartments-list.json"]) {
    await page.route(pattern, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(VISUAL_FIXTURE),
      })
    );
  }
}

/**
 * 목록 + 상세 버킷 응답을 임의 픽스처로 바꿔치기한다(세션577 e2e).
 *
 * `stubApartments`(위)는 시각회귀 고정 픽스처 하나만 쓰지만, 이 헬퍼는 임의의 목록 JSON과
 * (선택) 상세 버킷 JSON 맵을 받아 두 종류의 요청을 모두 가로챈다.
 *
 * ⚠️ `page.goto()` **전에** 불러야 한다(stubApartments와 동일 제약).
 *
 * @param listFixture 목록 응답 그대로(`{ ok, data, dataUpdatedAt, ... }`)
 * @param detailBuckets 버킷 파일명(`apartments-detail-16-N.json`) → 그 버킷 응답(`{ ok, data }`) 맵.
 *   생략하거나 어떤 버킷이 맵에 없으면 그 버킷 요청은 가로채지 않는다(실제 정적 파일로 감).
 */
export async function stubApartmentsWith(
  page: Page,
  listFixture: unknown,
  detailBuckets: Record<string, unknown> = {}
): Promise<void> {
  for (const pattern of ["**/api/supabase/apartments", "**/data/apartments-list.json"]) {
    await page.route(pattern, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(listFixture),
      })
    );
  }
  for (const [bucketFile, body] of Object.entries(detailBuckets)) {
    await page.route(`**/data/${bucketFile}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      })
    );
  }
}

/**
 * CI 공용 픽스처(세션664) — 운영 응답에서 그대로 고른 8단지(`fixtures/make-ci-fixture.mjs` 로 재생성).
 * 전 단지가 범위 칩(`cmpMin`·`cmpMax`)과 시세 탭 가격 표(`priceByArea`)를 가진다.
 */
const CI_LIST_FIXTURE: unknown = JSON.parse(
  readFileSync(new URL("./fixtures/apartments-ci.json", import.meta.url), "utf8")
);
const CI_DETAIL_FIXTURE: unknown = JSON.parse(
  readFileSync(new URL("./fixtures/apartments-ci-detail.json", import.meta.url), "utf8")
);
/** 상세 버킷 파일 이름 16개 전부(`src/utils/bucketHash.mjs` DETAIL_BUCKET_COUNT = 16) — 어느 버킷이든 같은 상세 픽스처. 앱은 id 로 꺼내므로 남는 행은 무해. */
const CI_DETAIL_BUCKETS: Record<string, unknown> = Object.fromEntries(
  Array.from({ length: 16 }, (_, i) => [`apartments-detail-16-${i}.json`, CI_DETAIL_FIXTURE])
);

/**
 * 카드 시험용 목록·상세 응답을 CI 공용 픽스처로 바꿔치기한다(세션664).
 *
 * **왜** — CI 러너에서 운영 목록 API(약 29MB)를 vite 프록시로 받으면 첫 카드가 15초 안에 안 떠서
 * 카드 시험 19건이 8/4부터 전부 skip 이었다(우리 PC 실측도 11~14초 — 세션664). 카드가 있어야 하는 시험은 이 픽스처로 돌리고,
 * 운영 데이터가 실제로 오는지는 `live-list.spec.ts` 한 건만 따로 본다.
 *
 * ⚠️ `page.goto()` **전에** 불러야 한다.
 */
export async function stubCiApartments(page: Page): Promise<void> {
  await stubProxyApis(page);
  await stubApartmentsWith(page, CI_LIST_FIXTURE, CI_DETAIL_BUCKETS);
}

/**
 * 운영으로 가는 `/api/**` 호출을 막는다(세션664 B1) — 목록 말고 화면이 부르는 다른 API.
 *
 * **왜** — 안 막으면 상세 탭 하나에 운영 호출이 14번, 전체 E2E 한 번에 190번 넘게 나가 IP 한도
 * (5분 30회, `api/_lib/rateLimit.ts`)를 채우고, 운영 목록을 보는 `live-list.spec.ts` 가 429 를 맞는다.
 * - 화면용 API = 그 API 의 200 반환 객체 모양 그대로 빈 값(`CI_EMPTY_API`, 출처는 줄마다).
 * - 관리자 목록 API(GET) = CI 의 가짜 토큰이 운영에서 받던 그대로 401(`api/_lib/handler.ts:76` · `adminAuth.ts` requireAdminGate).
 * - 그 밖의 주소·메서드는 `fallback` — 시험이 스스로 건 가로채기(로그인 검증·문의 제출 등)로 넘긴다.
 *
 * ⚠️ Playwright 는 **나중에** 등록한 route 를 먼저 맞춘다 → 이 함수는 시험의 다른 `page.route` 보다
 *    **먼저**(beforeEach 나 시험 첫 줄) 불러야 시험 쪽 가로채기가 이긴다. 목록 route 도 이 뒤에 등록한다.
 */
export async function stubProxyApis(page: Page): Promise<void> {
  await page.route("**/api/**", (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const body = CI_EMPTY_API[path];
    if (body) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...body, fetchedAt: new Date().toISOString() }),
      });
    }
    if (req.method() === "GET" && CI_ADMIN_401.has(path)) {
      return route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "유효하지 않은 토큰입니다" }),
      });
    }
    return route.fallback();
  });
}

/**
 * 기본 목록 화면에 보이는 픽스처 행 = 미분양(unsold) 1 이상(「미분양 없는 단지 보기」 기본 꺼짐 — App.tsx hideNoUnsold true).
 * 세션664 실측: 픽스처 8곳 중 7장(미분양 0 인 1곳 숨김).
 */
export const CI_SHOWN: Array<{ id: string; name: string; region: string }> = (
  CI_LIST_FIXTURE as { data: Array<{ id: string; name: string; region: string; unsold?: number | null }> }
).data.filter((a) => Number(a.unsold) > 0);

/** CI 공용 픽스처 단지 이름(긴 것부터 — 한 이름이 다른 이름을 품을 때 긴 쪽을 먼저 맞춘다). */
const CI_NAMES: string[] = ((CI_LIST_FIXTURE as { data: Array<{ name: string }> }).data ?? [])
  .map((a) => a.name)
  .sort((a, b) => b.length - a.length);

/** 카드(`data-testid="apt-card"`) 글 속의 픽스처 단지 이름. 못 찾으면 실패(이름이 화면에 안 그려진 것). */
export async function cardName(card: Locator): Promise<string> {
  const text = await card.innerText();
  const hit = CI_NAMES.find((n) => text.includes(n));
  if (!hit) throw new Error(`카드 글에서 픽스처 단지 이름을 못 찾음: ${text.slice(0, 80)}`);
  return hit;
}

/** 정규식 특수문자 이스케이프 */
export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 관리자 목록 API — 가짜 토큰이면 운영도 401 을 준다(requireAdminGate). */
const CI_ADMIN_401 = new Set(["/api/consults", "/api/feedback", "/api/admin/subscribers", "/api/admin/collector-status"]);

/** 프록시 API 별 "빈 정상 응답"(200 반환 객체 모양 그대로 — 출처 파일은 각 줄 주석). fetchedAt 은 응답 때 붙인다. */
const CI_EMPTY_API: Record<string, Record<string, unknown>> = {
  "/api/supabase/prices": { ok: true, data: [], count: 0 }, // api/_lib/timeseriesHandler.ts:91
  "/api/supabase/unsold-history": { ok: true, data: [], count: 0 }, // api/_lib/timeseriesHandler.ts:91
  "/api/supabase/presale-detail": { ok: true, schedule: null, units: [], firstRecruitDate: null }, // api/supabase/presale-detail.ts:108
  "/api/supabase/market-stats-history": { ok: true, data: [], count: 0, fallback: false }, // api/supabase/market-stats-history.ts:83
  "/api/finlife/rates": { ok: true, data: [], count: 0, disclosureMonth: null }, // api/finlife/rates.ts:70
  "/api/upcoming": {
    // api/upcoming.ts:114
    ok: true,
    stages: { plan: [], apply: [], sale: [] },
    calendar: {},
    totals: { plan: 0, apply: 0, sale: 0 },
  },
};

/** 애니메이션·캐럿 깜빡임 제거 → 픽셀 안정화 */
export async function freezeAnimations(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `*, *::before, *::after {
      animation-duration: 0s !important;
      animation-delay: 0s !important;
      transition-duration: 0s !important;
      caret-color: transparent !important;
    }`,
  });
}

/**
 * 캡처 직전 렌더가 완전히 멎을 때까지 기다린다.
 *
 * **웹폰트가 범인이다** — Pretendard 가 도착하기 전에 찍으면 폴백 폰트로 그려져
 * 글자 폭이 미세하게 달라진다. dev 서버 콜드 스타트(첫 실행 37초 vs 이후 7초)에서만
 * 간헐적으로 깨지던 원인이었다(세션 487 실측). `networkidle` 만으로는 부족하다 —
 * 폰트 적용은 네트워크가 아니라 렌더 단계 사건이다.
 */
export async function waitForStableRender(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  // 폰트 적용 후 리플로우가 끝난 프레임까지 한 번 더 넘긴다.
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}

/**
 * 목록 탭으로 이동. 세션 487 이후 착륙 지점 자체가 목록(LANDING_TAB)이라 대개 no-op 이지만,
 * 홈을 거쳐 온 spec 이나 착륙 지점이 다시 바뀌는 경우를 위해 남겨 둔다.
 * 홈 버튼은 데스크톱 헤더/모바일 BottomNav 양쪽 모두 getByRole 로 잡힘.
 */
export async function gotoListTab(page: Page): Promise<void> {
  const homeBtn = page.getByRole("button", { name: "홈" }).first();
  if (await homeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await page.getByRole("button", { name: "목록" }).first().click();
  }
}
