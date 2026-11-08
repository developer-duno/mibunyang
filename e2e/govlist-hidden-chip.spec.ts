import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { gotoListTab, stubApartmentsWith, stubProxyApis } from "./helpers";

// 세션689 PR-3(설계서 docs/superpowers/plans/2026-11-01-govlist-unsold-source.md §6 · 👤 Q7·Q8·11/04) —
// 지자체 명단 등재·수 비공개 카드가 ① 기본 목록(「미분양 없는 단지 보기」 꺼짐 = hideNoUnsold)에 남고
// ② 칩 「미분양 수 비공개 · 대구시 9월 명단」 ③ 편차 막대 미분양 줄 끝 글자 「비공개」를 그리는지 실제 화면으로 본다.
// 픽스처 = CI 공용 목록(운영 응답에서 고른 8곳)에 두류 꼴 한 장을 덧붙인 것 — 운영 DB 에는 아직 그 칸이 없다.

const CI_LIST = JSON.parse(readFileSync(new URL("./fixtures/apartments-ci.json", import.meta.url), "utf8")) as {
  data: Array<Record<string, unknown>>;
} & Record<string, unknown>;

const NAME = "명단비공개시험단지";
const HIDDEN_CARD: Record<string, unknown> = {
  ...CI_LIST.data[0],
  id: "ah-e2e-govlist-1",
  name: NAME,
  region: "대구",
  gu: "달서구",
  unsold: null,
  unsoldRate: null,
  unsoldSource: "govlist",
  unsoldListedHidden: true,
  unsoldListedAsOf: "2026-09-30",
  // 약점 줄 2칸을 다른 칩이 차지하지 않게(칩이 접힘 안으로 밀리지 않게) — 약점 재료를 비운다
  parkingRatio: null,
  builderDebtRatio: null,
  crimeSafetyGrade: null,
  noxious: [],
  corridorType: null,
  heatFuel: null,
  primaryDirection: null,
  schoolGrade: null,
  unsoldEventCount: 0,
  memberIds: ["ah-e2e-govlist-1"],
  siblingIds: ["ah-e2e-govlist-1"],
  materialId: null,
  complexKey: null,
  aliasIds: null,
};
const LIST = { ...CI_LIST, data: [...CI_LIST.data, HIDDEN_CARD], count: CI_LIST.data.length + 1 };

test.describe("지자체 명단 등재 · 수 비공개 카드 (세션689)", () => {
  test.beforeEach(async ({ page }) => {
    await stubProxyApis(page);
    await stubApartmentsWith(page, LIST);
    await page.goto("/");
    await gotoListTab(page);
  });

  test("기본 목록에 남고 칩·막대 끝 글자가 「비공개」를 말한다", async ({ page }) => {
    const card = page.getByTestId("apt-card").filter({ hasText: NAME });
    await expect(card).toHaveCount(1, { timeout: 15000 });
    await expect(card).toContainText("미분양 수 비공개 · 대구시 9월 명단");
    await expect(card.getByRole("img", { name: "미분양 비공개." })).toHaveCount(1);
  });
});
