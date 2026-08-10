// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  TAB_EXTRA_SECTIONS,
  FIELDS_SHOWN_IN_TABS,
  FIELDS_SHOWN_IN_MODAL_CHROME,
  FIELDS_SHOWN_IN_DETAIL_CARDS,
  FIELDS_SHOWN_IN_CHARTS,
  INTERNAL_ONLY_FIELDS,
  extraCount,
  type TabId,
} from "./tabExtraFields";
import { FIELD_META } from "@/constants/fieldMeta";
import { MARKET_STATS_FIELD_KEYS } from "@/constants/marketStatsFields";
import { REGION_STATS_FIELDS, REGION_STATS_ROWS } from "@/constants/regionStatsFields";
import { FIELDS_SHOWN_IN_PRESALE_CARD, presaleSectionVisibleFields } from "@/constants/presaleCardFields";
import { DISTANCE_AXES } from "@/constants/distanceAxes";

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
  schoolScore: "점수 재료 — 손님 표현은 등급(schoolGrade) 쪽이다 (세션 505)",
  isRegulated: "규제 이야기는 종합 탭 규제현황·분양 카드 '공고 당시 규제'가 자기 출처로 한다 (세션 505)",
  // 혜택 9종: 실측 채움률 전부 0.0%. 손님 표면은 종합 탭 혜택 칩(benefits)·카드 할인 배지 (세션 505 Q1 승인)
  discountPct: "혜택 9종 — 채움 0.0%, 손님 표면은 benefits 칩 (세션 505)",
  loanFree: "〃",
  loanFreePct: "〃",
  optionFree: "〃",
  optionValue: "〃",
  balconyFree: "〃",
  balconyValue: "〃",
  cashback: "〃",
  contractDiscount: "〃",
  // 세션 507 Q6 — 변별력 0 (모든 단지가 사실상 같은 답이거나 수집 자체가 0%).
  // 점수는 그대로 쓴다(scoreProduct·scoreRisk·scoreLocation) — 손님 화면에서만 내렸다.
  hasPool: "전 단지 '없음' — 있고 없고가 갈리지 않는다 (세션 507)",
  quakeDesign: "98.9% 가 '적용' — 사실상 전원 같은 답 (세션 507)",
  sunlight: "수집된 단지가 전부 '양호' (세션 507)",
  energyGrade: "수집 0% — 열어도 늘 '미수집' (세션 507)",
  supplyRatio: "수집 0% (세션 507)",
  hugGuarantee: "수집 0% (세션 507)",
};

/**
 * 위 목록은 `INTERNAL_ONLY_FIELDS` 와 **같아야** 한다. 한쪽만 늘리면 필드가 조용히
 * 사라지거나(도달 검사 통과) 사유 없이 빠진다 — 그래서 서로 맞대 잠근다.
 */
describe("손님 화면에서 뺀 목록은 코드와 테스트가 같은 것을 가리킨다", () => {
  it("INTERNAL_ONLY_FIELDS 와 INTENTIONALLY_UNRENDERED 가 같은 필드를 담는다", () => {
    expect([...INTERNAL_ONLY_FIELDS].sort()).toEqual(Object.keys(INTENTIONALLY_UNRENDERED).sort());
  });
});

describe("154필드 전량 도달 — 어느 필드도 조용히 사라지지 않는다", () => {
  const nonHidden = Object.keys(FIELD_META).filter((k) => !FIELD_META[k].hidden);

  it("숨김이 아닌 모든 필드는 세부·헤더·차트·아코디언 중 한 곳에는 나온다", () => {
    const reachable = new Set([
      ...FIELDS_SHOWN_IN_TABS,
      ...FIELDS_SHOWN_IN_MODAL_CHROME,
      // 세션 505: 전용 카드(PresaleInfo·SchoolInfo)도 "보여준 자리"다.
      ...FIELDS_SHOWN_IN_DETAIL_CARDS,
      // 세션 505: 차트도 "보여준 자리"다. 이걸 안 세면 스트립이 그리는 평당가·관리비가
      // 서랍에서 빠지는 순간 "어디에도 안 나온다"고 잘못 빨개진다.
      ...FIELDS_SHOWN_IN_CHARTS,
      // 세션 507: 분양 탭 "이 지역 통계" 서랍(`detail/RegionStats`)도 "보여준 자리"다.
      // 이걸 안 세면 옮겨온 7필드가 통째로 "어디에도 안 나온다"고 잘못 빨개진다.
      ...REGION_STATS_FIELDS,
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
    // ⚠️ 검사 방향은 **아코디언 → 다른 표면** 한쪽뿐이다. 표면끼리(차트 ↔ 세부 섹션)를
    //    통째로 맞대면 안 된다 — 예컨대 `pir` 은 편차 스트립과 "이 동네 거래 시세" 강조줄에
    //    일부러 둘 다 있다(카드의 한 줄 요약과 탭의 본값은 역할이 다르다). 그걸 여기서
    //    잡으면 이 테스트가 "아코디언 중복"이 아닌 것까지 잡는 셈이 된다.
    //    개별 중복 정리는 `gone` 목록(아래)이 결과로 잠근다.
    const dup = ALL_EXTRAS.filter(
      (f) =>
        FIELDS_SHOWN_IN_TABS.has(f) ||
        FIELDS_SHOWN_IN_MODAL_CHROME.includes(f) ||
        FIELDS_SHOWN_IN_DETAIL_CARDS.includes(f) ||
        FIELDS_SHOWN_IN_CHARTS.has(f)
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
      // ⚠️ `apt\)?\.` 인 이유: 팝업은 값을 `(mergedApt ?? apt).benefits` 처럼도 읽는다.
      //    `apt\.` 만 보면 그 형태를 통째로 놓쳐 "안 그린다"고 잘못 빨개진다 (세션 505).
      const used = new RegExp(`apt\\)?\\.${f}\\b`).test(src);
      expect(
        used,
        `FIELDS_SHOWN_IN_MODAL_CHROME 에 '${f}' 가 있는데 DetailModal.tsx 에 'apt.${f}' 가 없다.\n` +
          `→ 헤더에서 뺐다면 이 목록에서도 빼야 한다(안 빼면 그 필드가 화면 어디에도 안 나온다).`
      ).toBe(true);
    });
  }
});

describe("전용 카드가 그린다고 적어둔 필드는 실제로 그 카드가 그린다", () => {
  /**
   * 필드 → 그 필드를 그리는 소스들 (헤더 검사와 달리 파일이 필드마다 다르다).
   *
   * `re` 를 필드마다 따로 두는 이유: 카드가 값을 `apt.<필드>` 로 직접 읽는 경우도 있고,
   * `dsr40pass` 처럼 **팝업이 prop 으로 넘겨** 그림이 받는 경우도 있다. 후자는 배선이
   * 두 군데라 양쪽을 다 봐야 한다 — 한쪽만 보면 나머지 한쪽이 끊겨도 초록으로 남는다.
   * ⚠️ 정규식은 **좌변까지 고정**한다. `dsr40pass` 를 그냥 찾으면 `dsr40pass?: boolean`
   *    같은 **선언부**에 걸려, 실제로 안 그려도 통과한다(가짜 초록불).
   */
  const CARD_SOURCE: Record<string, Array<{ file: string; re: RegExp; why: string }>> = {
    schoolGrade: [{ file: "../components/detail/SchoolInfo.tsx", re: /apt\)?\.schoolGrade\b/, why: "등급 배지" }],
    dsr40pass: [
      {
        file: "../components/DetailModal.tsx",
        re: /dsr40pass=\{\(mergedApt \?\? apt\)\.dsr40pass\b/,
        why: "금융 탭이 대출 그림에 넘긴다",
      },
      {
        file: "../components/charts/LoanStack.tsx",
        re: /\{dsr40pass === (true|false) &&/,
        why: "대출 그림이 한 문장으로 그린다",
      },
    ],
  };
  for (const f of FIELDS_SHOWN_IN_PRESALE_CARD)
    CARD_SOURCE[f] = [
      { file: "../components/detail/PresaleInfo.tsx", re: new RegExp(`apt\\)?\\.${f}\\b`), why: "분양 카드" },
    ];

  // 세션508 PR-3b B2 — naverSchoolWalkMin 은 학군 카드가 "초등 도보 N분" 줄로 그린다.
  CARD_SOURCE.naverSchoolWalkMin = [
    { file: "../components/detail/SchoolInfo.tsx", re: /apt\)?\.naverSchoolWalkMin\b/, why: "초등 도보 칩" },
  ];

  // 세션508 PR-3b B1 — 입지 탭 전용 카드(TransportCard) 6필드. 각 필드는 `<Field field="..."
  // label={FIELD_META.<f>.label} value={FIELD_META.<f>.fmt(apt.<f>, apt)} />` 형태로 리터럴
  // `apt.<f>` 접근을 그대로 남긴다(동적 인덱싱이면 이 grep 이 무의미해진다).
  for (const f of ["subwayName", "subwayLines", "busRoutes", "busStopNames", "icDist", "ktxDist"])
    CARD_SOURCE[f] = [
      { file: "../components/detail/TransportCard.tsx", re: new RegExp(`apt\\)?\\.${f}\\b`), why: "교통 상세 카드" },
    ];

  /**
   * 세션 507 — 두 출처 대조표 12필드.
   *
   * 이 표는 값을 `apt.<필드>` 로 직접 읽지 않고 **행 정의 상수(`ROWS`)의 필드명 문자열**로
   * 읽는다(`apt[r.ours]`). 그래서 대조는 그 정의에 이름이 적혀 있는지를 본다.
   * ⚠️ 정규식 좌변을 `ours:`/`theirs:`/`field:` 같은 **키까지** 고정한다 — 그냥 필드명만
   *    찾으면 파일 위쪽 주석·타입 선언에도 걸려 실제로 안 그려도 통과한다(가짜 초록불).
   */
  const SOURCE_COMPARISON = "../components/detail/SourceComparison.tsx";
  for (const f of ["nearbyMedian", "nearbyBuildYear", "avgFloor"])
    CARD_SOURCE[f] = [{ file: SOURCE_COMPARISON, re: new RegExp(`ours: "${f}"`), why: "두 출처 대조표 — 우리측 열" }];
  for (const f of ["naverNearbyMedian", "naverJeonseRate", "naverBuildYear", "naverAvgFloor"])
    CARD_SOURCE[f] = [{ file: SOURCE_COMPARISON, re: new RegExp(`theirs: "${f}"`), why: "두 출처 대조표 — 네이버 열" }];
  for (const f of ["naverSellCount", "naverJeonseCount", "naverWolseCount"])
    CARD_SOURCE[f] = [{ file: SOURCE_COMPARISON, re: new RegExp(`field: "${f}"`), why: "두 출처 대조표 — 매물 칩" }];
  CARD_SOURCE.naverNearbyCount = [
    { file: SOURCE_COMPARISON, re: /apt\.naverNearbyCount\b/, why: "두 출처 대조표 — 각주 '주변 N개 단지'" },
  ];
  CARD_SOURCE.naverFetchedAt = [
    { file: SOURCE_COMPARISON, re: /apt\.naverFetchedAt\b/, why: "두 출처 대조표 — 각주 수집 시점" },
  ];

  it("목록에 든 필드가 전부 어느 카드 소속인지 적혀 있다", () => {
    const orphan = FIELDS_SHOWN_IN_DETAIL_CARDS.filter((f) => !CARD_SOURCE[f]?.length);
    expect(orphan, `어느 카드가 그리는지 안 적힌 필드: ${orphan.join(", ")}`).toEqual([]);
  });

  for (const f of FIELDS_SHOWN_IN_DETAIL_CARDS) {
    for (const { file, re, why } of CARD_SOURCE[f] ?? []) {
      it(`${f} — ${file.split("/").pop()} (${why})`, () => {
        const src = readFileSync(new URL(file, import.meta.url), "utf8");
        expect(
          re.test(src),
          `FIELDS_SHOWN_IN_DETAIL_CARDS 에 '${f}' 가 있는데 ${file} 에서 ${re} 를 못 찾았다.\n` +
            `→ 화면에서 뺐다면 이 목록에서도 빼야 한다(안 빼면 그 필드가 화면 어디에도 안 나온다).`
        ).toBe(true);
      });
    }
  }

  it("분양 카드 목록이 fieldMeta '분양' 섹션(숨김 제외)과 개수·순서까지 같다", () => {
    // 한쪽만 늘면 새 분양 필드가 서랍에 또 나오거나(적으면), 카드가 안 그리는 걸
    // 그린다고 우기게 된다(많으면). 그래서 양쪽을 맞댄다.
    expect(FIELDS_SHOWN_IN_PRESALE_CARD).toEqual(presaleSectionVisibleFields());
  });
});

/**
 * 세션 507 — "이 지역 통계" 서랍 전용 대조.
 *
 * ⚠️ 이 검사를 **따로 두는 이유**: 위 `CARD_SOURCE` 루프는 `FIELDS_SHOWN_IN_DETAIL_CARDS` 만
 * 순회한다. 지역통계 7필드는 그 목록이 아니라 `alreadySeen` 쪽으로 세므로, `CARD_SOURCE` 에만
 * 적어 두면 **검사가 0회 실행되는 껍데기**가 된다(도달 검사는 통과하는데 실제로 그리는지는
 * 아무도 안 본다). 그래서 자체 루프를 돈다.
 */
describe("이 지역 통계 서랍이 그린다고 적어둔 7필드는 실제로 그 서랍이 그린다", () => {
  const rowsSrc = readFileSync(new URL("../constants/regionStatsFields.ts", import.meta.url), "utf8");
  const viewSrc = readFileSync(new URL("../components/detail/RegionStats.tsx", import.meta.url), "utf8");

  it("행 정의(REGION_STATS_ROWS)가 목록(REGION_STATS_FIELDS)과 순서·개수까지 같다", () => {
    // 두 상수를 손으로 따로 적었다(한쪽을 펼쳐 만들면 그 한쪽을 비우는 순간 검사가 사라진다).
    // 손으로 적은 만큼 어긋날 수 있어 여기서 맞댄다.
    expect(REGION_STATS_ROWS.map((r) => r.field)).toEqual([...REGION_STATS_FIELDS]);
  });

  it("RegionStats 가 그 행 정의를 실제로 순회한다", () => {
    // 목록만 맞고 컴포넌트가 안 쓰면 7필드가 화면 어디에도 안 나온다.
    expect(/REGION_STATS_ROWS\.map\(/.test(viewSrc), "RegionStats.tsx 가 REGION_STATS_ROWS 를 안 그린다").toBe(true);
  });

  for (const f of REGION_STATS_FIELDS) {
    it(`${f} — regionStatsFields.ts 행 정의에 있다`, () => {
      // ⚠️ 좌변(`field:`)까지 고정 — 그냥 필드명만 찾으면 파일 상단 주석·`REGION_STATS_FIELDS`
      //    나열에도 걸려, 화면에 그리는 줄이 없어도 통과한다(가짜 초록불).
      expect(
        new RegExp(`field: "${f}"`).test(rowsSrc),
        `REGION_STATS_FIELDS 에 '${f}' 가 있는데 REGION_STATS_ROWS 에 그 줄이 없다.\n` +
          `→ 서랍에서 뺐다면 목록에서도 빼야 한다(안 빼면 그 필드가 화면 어디에도 안 나온다).`
      ).toBe(true);
    });
  }
});

/**
 * 표면끼리의 이중 노출 차단 (세션 507 — 뮤테이션이 찾은 구멍).
 *
 * `gone` 목록은 "서랍(아코디언)에 없어야 한다"만 잠근다. 그래서 지역통계로 옮긴 popGrowth 를
 * 시세 탭 grid 에 도로 넣어도 어느 검사도 안 빨개졌다(뮤테이션 실증) — alreadySeen 에 이미
 * 있어 서랍으로는 안 돌아가고, 표와 지역통계 서랍에 **동시에** 그려지는 경로가 열린다.
 * 세부 섹션 전체를 다른 표면과 통째로 맞대지 않는 기존 원칙(pir 처럼 역할이 다른 의도적
 * 이중 노출이 있다)은 그대로 두고, 의도적 겹침이 0 인 두 집합만 콕 집어 잠근다.
 */
describe("표면끼리도 안 겹친다 — 서랍·카드 등재 필드는 탭 섹션에 다시 못 온다", () => {
  it("지역통계 7필드는 어느 탭 세부 섹션에도 없다", () => {
    const dup = REGION_STATS_FIELDS.filter((f) => FIELDS_SHOWN_IN_TABS.has(f));
    expect(dup, `지역통계 서랍과 탭 섹션에 동시 노출: ${dup.join(", ")}`).toEqual([]);
  });

  it("전용 카드(대조표·분양카드 등) 필드는 어느 탭 세부 섹션에도 없다", () => {
    const dup = FIELDS_SHOWN_IN_DETAIL_CARDS.filter((f) => FIELDS_SHOWN_IN_TABS.has(f));
    expect(dup, `전용 카드와 탭 섹션에 동시 노출: ${dup.join(", ")}`).toEqual([]);
  });
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
  it("헤더·카드·차트가 이미 말한 값은 서랍에 없다", () => {
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
      "newSupply", // 〃 (세션 505: "분양 안전지표" 표에서 뺀 자리)
      "address", // 헤더 주소줄
      "district", // 〃 (주소 뒤 괄호)
      // ── 세션 505 PR-B ──
      // ⚠️ 여기부터는 **손으로 적는다**. 검사 대상 상수(`FIELDS_SHOWN_IN_PRESALE_CARD`,
      //    `DISTANCE_AXES[].countField`)를 그대로 펼쳐 쓰면, 그 상수를 비우는 순간
      //    이 목록도 같이 비어 검사가 통째로 사라진다(뮤테이션으로 실제 확인 — 상수를
      //    비웠는데 이 검사가 초록이었다). 잠그려는 결과는 상수와 독립이어야 한다.
      // 거리 점 그림이 개수까지 병기하면서 없앤 "생활인프라" 표의 개수 11종
      "conv",
      "cafe",
      "pharmacy",
      "childcare",
      "culture",
      "hospital",
      "park",
      "bank",
      "mart",
      "police",
      "emergency",
      "policeDist", // 치안/환경 표에서 뺀 자리 (그림이 그린다)
      "noxious", // 서랍에서 치안/환경 표로 옮긴 자리 (거리 옆에 이름 목록)
      "schoolGrade", // SchoolInfo 카드 등급 배지
      "schoolScore", // 점수 재료 — 손님 표면 아님
      "benefits", // 종합 탭 혜택 칩
      "discountPct", // 혜택 9종 — 채움 0.0%
      "loanFree",
      "loanFreePct",
      "optionFree",
      "optionValue",
      "balconyFree",
      "balconyValue",
      "cashback",
      "contractDiscount",
      // PresaleInfo 카드가 그리는 분양 15종 ("네이버 분양정보" 표를 없앤 자리)
      "presaleMinPrice",
      "presaleMaxPrice",
      "presalePp",
      "presaleType",
      "presaleStage",
      "presaleHousingType",
      "presaleGeneralSupply",
      "presaleBuildings",
      "presaleParking",
      "presaleMoveIn",
      "presaleRecruitDate",
      "presaleSchedule",
      "presaleInquiry",
      "presaleFeatures",
      "presaleFetchedAt",
      // 분양 탭 서랍에 남아 있던 마지막 둘 (세션 505 목업)
      "dsr40pass", // 금융 탭 대출 그림이 문장으로 그린다
      "isRegulated", // 이 컬럼 자체는 어디서도 안 그린다 — 규제 이야기는 다른 출처가 한다
      // ── 세션 507 PR-2 ──
      // ⚠️ 여기도 **손으로 적는다**(위 세션 505 주석과 같은 이유 — 상수를 펼치면 상수를
      //    비우는 순간 이 검사도 같이 사라진다).
      // 분양 탭 "이 지역 통계" 서랍으로 옮긴 7종
      "popGrowth",
      "netMigration",
      "housingSupplyLevel",
      "fertilityRate",
      "doctorsPer1k",
      "hospitalBedsPer1k",
      "recentTrades6m",
      // 두 출처 대조표로 옮긴 우리측 3종
      "nearbyMedian",
      "nearbyBuildYear",
      "avgFloor",
      // 〃 네이버측 9종 ("네이버 교차검증" 표를 없앤 자리)
      "naverNearbyMedian",
      "naverJeonseRate",
      "naverBuildYear",
      "naverAvgFloor",
      "naverSellCount",
      "naverJeonseCount",
      "naverWolseCount",
      "naverNearbyCount",
      "naverFetchedAt",
      // Q6 — 변별력 0 이라 손님 화면에서 뺀 6종
      "hasPool",
      "quakeDesign",
      "sunlight",
      "energyGrade",
      "supplyRatio",
      "hugGuarantee",
      // ── 세션508 PR-3b ──
      // B2: naverSchoolWalkMin 이 학군 카드(SchoolInfo)로 승격됐다. 옛 주석은 "지금 넣으면
      // 안 된다"고 적었는데(PR-3 착수 전 예고), 이 PR 이 바로 그 PR-3 다 — 이제는 넣는 게 맞다.
      "naverSchoolWalkMin",
      // B1: "교통 상세" 격자를 폐기하고 전용 카드(TransportCard)로 승격한 6종.
      "subwayName",
      "subwayLines",
      "busRoutes",
      "busStopNames",
      "icDist",
      "ktxDist",
      // ⚠️ 여기 **넣으면 안 되는 것들**:
      //   pir·psr·floorRange·housingPrice = 시세 탭 "이 동네 거래 시세" 표에 그대로 남는다.
    ];
    const back = gone.filter((f) => ALL_EXTRAS.includes(f));
    expect(back, `서랍으로 되돌아온 필드: ${back.join(", ")}`).toEqual([]);
  });

  it("거리 점 그림이 그리는 12종은 서랍에 없다", () => {
    const dists = DISTANCE_AXES.flatMap((ax) => ax.items.map((it) => it.field));
    expect(dists.length, "축 정의를 못 읽었다").toBe(12);
    const back = dists.filter((f) => ALL_EXTRAS.includes(f));
    expect(back, `서랍으로 되돌아온 거리 필드: ${back.join(", ")}`).toEqual([]);
  });
});

describe("탭 배치", () => {
  /**
   * 세션 505 전엔 "다섯 탭 모두 0보다 크다"였다. 세션 505 에 금융 탭이 0 이 됐고(혜택
   * 10종이 전부 채움 0.0% 라 열어도 "미수집"뿐), 세션508 PR-3b B2 로 시세 탭도 0 이 됐다
   * — 그 탭 서랍에 남던 마지막 필드(naverSchoolWalkMin)가 학군 카드로 승격했다.
   * 0 이면 `ExtraFieldsAccordion` 이 null 을 돌려줘 버튼 자체가 안 뜬다(빈 서랍 아님).
   * 나머지 세 탭(종합·입지·분양)까지 0 이 되면 그건 "정리"가 아니라 "실종"이므로 그대로 잠근다.
   * (종합·분양은 PR-3c 가 건물정보·재공고·시공사 카드로 마저 0화할 예정이나 이 PR 범위 밖이다.)
   */
  it("금융·시세 말고 세 탭은 보여줄 게 남아 있다 (빈 아코디언은 안 만든다)", () => {
    for (const t of ALL_TABS) {
      if (t === "sec-finance" || t === "sec-price") continue;
      expect(extraCount(t), `${t} 여분 0`).toBeGreaterThan(0);
    }
  });

  it("금융 탭 서랍은 비어 있다 (혜택 9종은 손님 화면에서 뺐다)", () => {
    expect(extraCount("sec-finance"), "빈 서랍이 되살아났다").toBe(0);
  });

  it("시세 탭 서랍도 비어 있다 (naverSchoolWalkMin 이 학군 카드로 승격, 세션508 PR-3b B2)", () => {
    expect(extraCount("sec-price"), "빈 서랍이 되살아났다").toBe(0);
  });

  it("교차검증 섹션의 naverSchoolWalkMin 은 이제 학군 카드가 그린다 (서랍엔 없다)", () => {
    // ⚠️ 이 테스트의 전제가 세션508 PR-3b 로 뒤집혔다. 옛 이름은 "교차검증 섹션에 남은
    //    필드는 시세 탭 서랍으로 간다"였고, `naverSchoolWalkMin` 이 그 서랍에 남는
    //    유일한 필드였다(세션 507 에 확정된 배선 `SECTION_TO_TAB.교차검증 = "sec-price"` 는
    //    지금도 그대로다 — 다만 그 필드 자체가 서랍이 아니라 카드로 옮겨갔을 뿐이다).
    expect(extrasOf("sec-price")).not.toContain("naverSchoolWalkMin");
    expect(extrasOf("sec-location")).not.toContain("naverSchoolWalkMin");
  });

  it("혜택(할인·중도금무이자·캐시백)은 어느 서랍에도 안 들어간다", () => {
    // 취지가 뒤집힌 테스트다. 세션 505 이전엔 "혜택은 금융 탭으로 간다"였는데,
    // 그 9필드가 전부 채움 0.0% 라 금융 탭이 통째로 빈 서랍이었다(사장님 승인 후 폐기).
    expect(ALL_EXTRAS).not.toContain("discountPct");
    expect(ALL_EXTRAS).not.toContain("loanFree");
    expect(ALL_EXTRAS).not.toContain("cashback");
  });

  it("손님 화면에서 뺀 필드는 어느 탭에도 안 들어간다", () => {
    for (const f of INTERNAL_ONLY_FIELDS) expect(ALL_EXTRAS).not.toContain(f);
  });

  it("extraCount 는 실제 필드 수와 일치한다 (제목의 N 이 거짓말 안 하게)", () => {
    for (const t of ALL_TABS) expect(extraCount(t)).toBe(extrasOf(t).length);
  });
});
