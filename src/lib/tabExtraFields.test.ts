// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  TAB_EXTRA_SECTIONS,
  FIELDS_SHOWN_IN_TABS,
  FIELDS_SHOWN_IN_MODAL_CHROME,
  INTERNAL_ONLY_FIELDS,
  extraCount,
  type TabId,
} from "./tabExtraFields";
import { FIELD_META } from "@/constants/fieldMeta";

const ALL_TABS: TabId[] = ["sec-overview", "sec-price", "sec-location", "sec-presale", "sec-finance"];

function extrasOf(tab: TabId): string[] {
  return TAB_EXTRA_SECTIONS[tab].flatMap((s) => s.fields);
}
const ALL_EXTRAS = ALL_TABS.flatMap(extrasOf);

/**
 * 손님 화면에 **일부러** 안 내보내는 필드. 여기 없는 필드가 어느 화면에도 안 나오면
 * 아래 "전량 도달" 테스트가 빨개진다 — 필드만 늘리고 화면 배선을 잊는 사고를 막는 장치다.
 */
const INTENTIONALLY_UNRENDERED: Record<string, string> = {
  id: "내부 식별자 — 손님에게 의미 0 (관리자 표에는 그대로 있음)",
};

describe("154필드 전량 도달 — 어느 필드도 조용히 사라지지 않는다", () => {
  const nonHidden = Object.keys(FIELD_META).filter((k) => !FIELD_META[k].hidden);

  it("숨김이 아닌 모든 필드는 세부·헤더·아코디언 중 한 곳에는 나온다", () => {
    const reachable = new Set([
      ...FIELDS_SHOWN_IN_TABS,
      ...FIELDS_SHOWN_IN_MODAL_CHROME,
      ...ALL_EXTRAS,
      ...Object.keys(INTENTIONALLY_UNRENDERED),
    ]);
    const orphans = nonHidden.filter((f) => !reachable.has(f));
    expect(
      orphans,
      `어느 화면에도 안 나오는 필드 ${orphans.length}개: ${orphans.join(", ")}\n` +
        `→ dataSections 에 넣거나, 일부러 뺀 거면 INTENTIONALLY_UNRENDERED 에 사유와 함께 등재하세요.`
    ).toEqual([]);
  });

  it("한 필드가 두 곳에 겹쳐 나오지 않는다 (세션 409 이중 노출 재발 차단)", () => {
    const dup = ALL_EXTRAS.filter((f) => FIELDS_SHOWN_IN_TABS.has(f) || FIELDS_SHOWN_IN_MODAL_CHROME.includes(f));
    expect(dup, `세부/헤더에 이미 있는데 아코디언에도 넣은 필드: ${dup.join(", ")}`).toEqual([]);
  });

  it("아코디언 안에서도 같은 필드가 두 번 안 나온다", () => {
    const seen = new Set<string>();
    const dup: string[] = [];
    for (const f of ALL_EXTRAS) {
      if (seen.has(f)) dup.push(f);
      else seen.add(f);
    }
    expect(dup, `아코디언 내부 중복: ${dup.join(", ")}`).toEqual([]);
  });

  it("숨김 필드는 아코디언에 안 들어간다", () => {
    const hidden = ALL_EXTRAS.filter((f) => FIELD_META[f]?.hidden);
    expect(hidden).toEqual([]);
  });
});

describe("헤더가 그린다고 적어둔 필드는 실제로 헤더가 그린다", () => {
  const src = readFileSync(new URL("../components/DetailModal.tsx", import.meta.url), "utf8");

  for (const f of FIELDS_SHOWN_IN_MODAL_CHROME) {
    it(`${f} — DetailModal 이 직접 렌더한다`, () => {
      // ⚠️ includes 로 세면 `apt.price` 가 `apt.priceXX` 에도 걸리고, `apt.gu` 가
      //    `apt.guarantee` 에도 걸린다(실제로 뮤테이션 검사에서 통과해버렸다). 단어 경계 필수.
      const used = new RegExp(`apt\\.${f}\\b`).test(src);
      expect(
        used,
        `FIELDS_SHOWN_IN_MODAL_CHROME 에 '${f}' 가 있는데 DetailModal.tsx 에 'apt.${f}' 가 없다.\n` +
          `→ 헤더에서 뺐다면 이 목록에서도 빼야 한다(안 빼면 그 필드가 화면 어디에도 안 나온다).`
      ).toBe(true);
    });
  }
});

describe("탭 배치", () => {
  it("다섯 탭 모두 보여줄 게 남아 있다 (빈 아코디언은 안 만든다)", () => {
    for (const t of ALL_TABS) expect(extraCount(t), `${t} 여분 0`).toBeGreaterThan(0);
  });

  it("네이버 시세 교차검증 필드는 미래가 아니라 시세 탭으로 간다", () => {
    const priceExtras = extrasOf("sec-price");
    expect(priceExtras).toContain("naverNearbyAvg");
    expect(extrasOf("sec-location")).not.toContain("naverNearbyAvg");
  });

  it("혜택(할인·중도금무이자·캐시백)은 금융 탭으로 간다", () => {
    expect(extrasOf("sec-finance")).toContain("discountPct");
    expect(extrasOf("sec-finance")).toContain("loanFree");
  });

  it("내부 식별자 id 는 어느 탭에도 안 들어간다", () => {
    for (const f of INTERNAL_ONLY_FIELDS) expect(ALL_EXTRAS).not.toContain(f);
  });

  it("extraCount 는 실제 필드 수와 일치한다 (제목의 N 이 거짓말 안 하게)", () => {
    for (const t of ALL_TABS) expect(extraCount(t)).toBe(extrasOf(t).length);
  });
});
