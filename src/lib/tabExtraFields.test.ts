// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  TAB_EXTRA_SECTIONS,
  FIELDS_SHOWN_IN_TABS,
  FIELDS_SHOWN_IN_MODAL_CHROME,
  FIELDS_SHOWN_IN_CHARTS,
  INTERNAL_ONLY_FIELDS,
  extraCount,
  type TabId,
} from "./tabExtraFields";
import { FIELD_META } from "@/constants/fieldMeta";
import { MARKET_STATS_FIELD_KEYS } from "@/constants/marketStatsFields";

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
  naverNearbyAvg: "바로 위 '네이버 주변 중위가'와 같은 이야기 (세션 505, 관리자 표에는 그대로 있음)",
};

describe("154필드 전량 도달 — 어느 필드도 조용히 사라지지 않는다", () => {
  const nonHidden = Object.keys(FIELD_META).filter((k) => !FIELD_META[k].hidden);

  it("숨김이 아닌 모든 필드는 세부·헤더·차트·아코디언 중 한 곳에는 나온다", () => {
    const reachable = new Set([
      ...FIELDS_SHOWN_IN_TABS,
      ...FIELDS_SHOWN_IN_MODAL_CHROME,
      // 세션 505: 차트도 "보여준 자리"다. 이걸 안 세면 스트립이 그리는 평당가·관리비가
      // 서랍에서 빠지는 순간 "어디에도 안 나온다"고 잘못 빨개진다.
      ...FIELDS_SHOWN_IN_CHARTS,
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
    // ⚠️ 검사 방향은 **아코디언 → 다른 표면** 한쪽뿐이다. 표면끼리(차트 ↔ 세부 섹션) 맞대면
    //    안 된다 — 거리 12종은 지금 차트와 세부 섹션에 일부러 둘 다 있고(그 정리는 PR-A 밖),
    //    그걸 여기서 잡으면 이 테스트가 "아코디언 중복"이 아닌 걸 잡는 셈이 된다.
    const dup = ALL_EXTRAS.filter(
      (f) => FIELDS_SHOWN_IN_TABS.has(f) || FIELDS_SHOWN_IN_MODAL_CHROME.includes(f) || FIELDS_SHOWN_IN_CHARTS.has(f)
    );
    expect(dup, `세부/헤더/차트에 이미 있는데 아코디언에도 넣은 필드: ${dup.join(", ")}`).toEqual([]);
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

describe("차트가 이미 보여준 필드 — 손 목록이 차트와 어긋나지 않는다", () => {
  it("지역 시장 추이 5지표가 MARKET_STATS_FIELD_KEYS 와 순서·개수까지 같다", () => {
    const src = readFileSync(new URL("../components/detail/MarketStatsCharts.tsx", import.meta.url), "utf8");
    // 차트는 KOSIS 컬럼(snake_case), 서랍은 FIELD_META 키(camelCase)라 자동으로 안 이어진다.
    // ⚠️ `key:` 만 잡으면 `d?.[m.key]` 같은 참조에도 걸리므로 문자열 리터럴만 잡는다.
    const chartKeys = [...src.matchAll(/^\s{4}key: "([a-z_]+)",$/gm)].map((m) => m[1]);
    const toSnake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    expect(chartKeys.length, "MarketStatsCharts 의 METRICS 를 못 읽었다 — 정규식이 낡았다").toBeGreaterThan(0);
    expect(chartKeys, "차트에 지표를 더했으면 marketStatsFields.ts 에도 같은 순서로 더해야 한다").toEqual(
      MARKET_STATS_FIELD_KEYS.map(toSnake)
    );
  });

  it("차트가 그리는 필드는 서랍에 다시 안 나온다", () => {
    const dup = ALL_EXTRAS.filter((f) => FIELDS_SHOWN_IN_CHARTS.has(f));
    expect(dup, `차트에 이미 있는데 서랍에도 넣은 필드: ${dup.join(", ")}`).toEqual([]);
  });

  /**
   * 세션 505 가 서랍에서 걷어낸 필드들이 되돌아오는 것을 막는다.
   *
   * 위 두 검사만으로는 안 잡히는 구멍이 있다 — 예컨대 `district` 를
   * `FIELDS_SHOWN_IN_MODAL_CHROME` 에서 빼면 그 필드가 **서랍으로 되돌아가면서** "도달"
   * 조건은 그대로 충족돼 전부 초록으로 남는다(뮤테이션으로 실제 확인). 그래서 결과 자체를 잠근다.
   */
  it("헤더·차트가 이미 말한 값은 서랍에 없다", () => {
    const gone = [
      "pp", // 편차 스트립 1번째 줄
      "unsoldRate", // 〃 2번째
      "subwayDist", // 〃 3번째 (+거리 점 그림)
      "jeonseRate", // 〃 4번째
      "pir", // 〃 5번째
      "parkingRatio", // 〃 6번째
      "avgMaintenanceCost", // 〃 7번째
      "exclusiveRatio", // 〃 8번째
      "avgPriceSqm", // 지역 시장 추이
      "priceIndex", // 〃
      "initialSaleRate", // 〃
      "landCostRatio", // 〃
      "address", // 헤더 주소줄
      "district", // 〃 (주소 뒤 괄호)
    ];
    const back = gone.filter((f) => ALL_EXTRAS.includes(f));
    expect(back, `서랍으로 되돌아온 필드: ${back.join(", ")}`).toEqual([]);
  });
});

describe("탭 배치", () => {
  it("다섯 탭 모두 보여줄 게 남아 있다 (빈 아코디언은 안 만든다)", () => {
    for (const t of ALL_TABS) expect(extraCount(t), `${t} 여분 0`).toBeGreaterThan(0);
  });

  it("네이버 시세 교차검증 필드는 미래가 아니라 시세 탭으로 간다", () => {
    // 대표값이 `naverNearbyAvg` → `naverBuildYear` 로 바뀐 이유: 앞의 것은 바로 위
    // "네이버 주변 중위가"와 같은 말이라 세션 505 에 손님 화면에서 뺐다(hidden).
    const priceExtras = extrasOf("sec-price");
    expect(priceExtras).toContain("naverBuildYear");
    expect(extrasOf("sec-location")).not.toContain("naverBuildYear");
  });

  it("혜택(할인·중도금무이자·캐시백)은 금융 탭으로 간다", () => {
    expect(extrasOf("sec-finance")).toContain("discountPct");
    expect(extrasOf("sec-finance")).toContain("loanFree");
  });

  it("손님 화면에서 뺀 필드는 어느 탭에도 안 들어간다", () => {
    for (const f of INTERNAL_ONLY_FIELDS) expect(ALL_EXTRAS).not.toContain(f);
  });

  it("extraCount 는 실제 필드 수와 일치한다 (제목의 N 이 거짓말 안 하게)", () => {
    for (const t of ALL_TABS) expect(extraCount(t)).toBe(extrasOf(t).length);
  });
});
