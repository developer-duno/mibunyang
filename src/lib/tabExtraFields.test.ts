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
    //    통째로 맞대면 안 된다 — 예컨대 `pir` 은 편차 스트립과 "시장/투자 지표" 강조줄에
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
   * 세션 505 전엔 "다섯 탭 모두 0보다 크다"였다. 지금은 금융 탭만 0 이 정답이다 —
   * 그 탭의 여분 10개가 전부 채움 0.0% 인 혜택 필드라 열어도 "미수집"뿐이었다.
   * 0 이면 `ExtraFieldsAccordion` 이 null 을 돌려줘 버튼 자체가 안 뜬다(빈 서랍 아님).
   * 나머지 네 탭까지 0 이 되면 그건 "정리"가 아니라 "실종"이므로 그대로 잠근다.
   */
  it("금융 말고 네 탭은 보여줄 게 남아 있다 (빈 아코디언은 안 만든다)", () => {
    for (const t of ALL_TABS) {
      if (t === "sec-finance") continue;
      expect(extraCount(t), `${t} 여분 0`).toBeGreaterThan(0);
    }
  });

  it("금융 탭 서랍은 비어 있다 (혜택 9종은 손님 화면에서 뺐다)", () => {
    expect(extraCount("sec-finance"), "빈 서랍이 되살아났다").toBe(0);
  });

  it("네이버 시세 교차검증 필드는 미래가 아니라 시세 탭으로 간다", () => {
    // 대표값이 `naverNearbyAvg` → `naverBuildYear` 로 바뀐 이유: 앞의 것은 바로 위
    // "네이버 주변 중위가"와 같은 말이라 세션 505 에 손님 화면에서 뺐다(hidden).
    const priceExtras = extrasOf("sec-price");
    expect(priceExtras).toContain("naverBuildYear");
    expect(extrasOf("sec-location")).not.toContain("naverBuildYear");
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
