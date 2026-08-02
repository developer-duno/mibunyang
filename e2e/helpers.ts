import type { Page } from "@playwright/test";
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
 * VITE_FEATURE_HOME ON 이면 초기 탭이 홈 — 목록 검증 spec 은 목록 탭으로 이동 (OFF 면 no-op).
 * 홈 버튼은 데스크톱 헤더/모바일 BottomNav 양쪽 모두 getByRole 로 잡힘.
 */
export async function gotoListTab(page: Page): Promise<void> {
  const homeBtn = page.getByRole("button", { name: "홈" }).first();
  if (await homeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await page.getByRole("button", { name: "목록" }).first().click();
  }
}
