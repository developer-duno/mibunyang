import { describe, it, expect } from "vitest";
import { buildCardChips, splitCardChips, CHIP_ORDER, GOOD_CHIP_MAX, BAD_CHIP_MAX } from "./cardChips";
import type { CardChip } from "./cardChips";
import type { Apt } from "@/types/scoring";
import type { ScoringResult } from "@/types/components";

// 카드 칩 단일 출처 (세션 510, 재설계 PR-4).
// 이 테스트가 지키는 것은 두 가지다:
//   ① `AptCard.tsx` 에 흩어져 있던 25개 칩 조건이 **뜻을 바꾸지 않고** 옮겨졌는가
//   ② 상한을 걸어도 **정보가 사라지지 않는가** (잘린 것은 전부 hidden 으로 간다)

const NOW = "202608";

function mkRes(over: Record<string, unknown> = {}): ScoringResult {
  const cat = (total: number, extra: Record<string, unknown> = {}) => ({ total, subs: [], ...extra });
  return {
    total: 70,
    cats: {
      price: cat(70, { subs: [{ info: "+18.8%" }], fairPrice: 94500, deviation: 18.8 }),
      location: cat(70, { subs: [{ info: "지하철 777m" }] }),
      product: cat(70),
      benefit: cat(70),
      risk: cat(70),
      future: cat(70),
      ...over,
    },
  } as unknown as ScoringResult;
}

function mkApt(over: Record<string, unknown> = {}): Apt {
  return { id: "x-1", name: "테스트단지", ...over } as unknown as Apt;
}

/** 기본 옵션 — 운영 화면과 같은 상태(로그인 + 편차 스트립 켜짐) */
const OPTS = { isLoggedIn: true, showDeviation: true, nowYm: NOW };

const build = (aptOver: Record<string, unknown> = {}, res = mkRes(), opts = OPTS) =>
  buildCardChips(mkApt(aptOver), res, opts);

const idsOf = (chips: readonly CardChip[]) => chips.map((c) => c.id);
const find = (chips: readonly CardChip[], id: string) => chips.find((c) => c.id === id);

describe("buildCardChips — 늘 보이는 핵심 값(core)", () => {
  it("가격 판정·입지·안전 등급 3개는 core 층에 들어간다", () => {
    const chips = build();
    expect(find(chips, "priceCheap")?.layer).toBe("core");
    expect(find(chips, "locationInfo")?.layer).toBe("core");
    expect(find(chips, "riskGrade")?.layer).toBe("core");
  });

  it("같은 값을 두 번 쓰지 않는다 — 회색 '적정가 +18.8%' 칩은 없어졌다", () => {
    // subs[0].info 와 deviation 은 같은 숫자다(2026-08-10 실측: 값이 있는 1,525곳 전부 일치).
    // 옛 카드는 회색 '적정가 +18.8%' 와 초록 '적정가보다 19% 저렴' 을 나란히 띄웠다.
    const chips = build();
    expect(find(chips, "fairPrice")).toBeUndefined();
    expect(chips.filter((c) => c.text.includes("적정가"))).toHaveLength(1);
  });

  it("가격 데이터가 없으면(fairPrice=0) 판정 대신 안내 문구가 그 자리를 지킨다", () => {
    // 데이터 부재 분기만 정확히 fairPrice=0 + deviation="0.0" 을 낸다 — deviation 만 보면
    // 진짜 0% 괴리와 구분되지 않아 "적정가 수준"이라는 거짓말이 된다.
    const res = mkRes({
      price: { total: 70, subs: [{ info: "데이터 부재", detail: "시세 미수집" }], fairPrice: 0, deviation: "0.0" },
    });
    const chips = build({}, res);
    expect(find(chips, "priceFair")).toBeUndefined();
    expect(find(chips, "fairPriceDetail")?.text).toBe("시세 미수집");
    expect(find(chips, "fairPriceDetail")?.layer).toBe("core");
  });

  it("적정가와 정확히 같으면(fairPrice 있음 + 괴리 0) '적정가 수준'", () => {
    const res = mkRes({ price: { total: 70, subs: [{ info: "0.0%" }], fairPrice: 50000, deviation: 0 } });
    expect(find(build({}, res), "priceFair")?.text).toBe("적정가 수준");
  });

  it("비로그인이면 안전 등급이 물음표로 가려진다 (점수 블라인드 정책)", () => {
    const chips = build({}, mkRes(), { ...OPTS, isLoggedIn: false });
    expect(find(chips, "riskGrade")?.text).toBe("안전 ?등급");
  });

  it("로그인이면 실제 등급 문자가 나온다", () => {
    const chips = build({}, mkRes({ risk: { total: 85, subs: [] } }));
    expect(find(chips, "riskGrade")?.text).toBe("안전 A등급");
  });
});

describe("buildCardChips — 상태(status) 층", () => {
  it("분양 단계와 입주 예정은 상태 층이라 상한에 안 걸린다", () => {
    const chips = build({ presaleStage: "분양중", completion: "202812" });
    expect(find(chips, "presaleStage")?.layer).toBe("status");
    expect(find(chips, "moveInSoon")?.layer).toBe("status");
  });

  it("준공이 지났는데 미분양이 0이면 입주완료, 남았으면 미입주 — 둘 다 상태 층", () => {
    // 미입주를 약점으로 두면 상한 2칸을 더 급한 위험에 내주고 접힌다(운영 666곳·40.5%가 그랬다).
    // 입주 상태 세 형제는 같은 축이라 한 층에 둔다. 색만 주황으로 남긴다.
    expect(find(build({ completion: "202401", unsold: 0 }), "moveInDone")?.layer).toBe("status");
    const late = find(build({ completion: "202401", unsold: 12 }), "moveInLate");
    expect(late?.layer).toBe("status");
    expect(late?.tone).toBe("amber");
  });

  it("미분양 판정은 unsold(집 수)로 한다 — unsoldRate 가 null 이어도 미입주로 남는다", () => {
    // unsoldRate 는 100% 초과 폭발값이 null 로 무력화돼 있을 수 있다(세션 445).
    // 그 null 을 보고 판정하면 미분양 단지가 "입주완료"로 둔갑한다.
    const chips = build({ completion: "202401", unsold: 30, unsoldRate: null });
    expect(find(chips, "moveInDone")).toBeUndefined();
    expect(find(chips, "moveInLate")).toBeDefined();
  });
});

describe("buildCardChips — 강점/약점 판정", () => {
  it("가격 판정은 저렴·비쌈 중 하나만 뜨고, 둘 다 core 라 접히지 않는다", () => {
    const cheap = build({}, mkRes({ price: { total: 70, subs: [{ info: "x" }], fairPrice: 9e4, deviation: 19 } }));
    expect(find(cheap, "priceCheap")?.layer).toBe("core");
    expect(find(cheap, "priceExpensive")).toBeUndefined();

    const pricey = build({}, mkRes({ price: { total: 40, subs: [{ info: "x" }], fairPrice: 9e4, deviation: -12 } }));
    expect(find(pricey, "priceExpensive")?.text).toBe("적정가보다 12% 비쌈");
    expect(find(pricey, "priceExpensive")?.layer).toBe("core");
    expect(find(pricey, "priceCheap")).toBeUndefined();
  });

  it("전세가율은 70~80 만 강점 / 80 초과·50 미만은 약점 / 사이는 회색", () => {
    expect(find(build({ jeonseRate: 72 }), "jeonseHigh")?.layer).toBe("good");
    expect(find(build({ jeonseRate: 44 }), "jeonseLow")?.layer).toBe("bad");
    expect(find(build({ jeonseRate: 60 }), "jeonseRate")?.layer).toBe("neutral");
  });

  it("전세가율 80 초과는 초록이 아니라 주황이다 — 점수 곡선이 급락하는 구간", () => {
    // 옛 카드는 92% 를 초록 강점으로 칠했는데, 그 구간 서브점수 평균은 5.5점이다.
    // 실측 310곳(초록 칩의 45.8%)이 그렇게 반대 색으로 칠해져 있었다.
    const tooHigh = find(build({ jeonseRate: 92 }), "jeonseTooHigh");
    expect(tooHigh?.layer).toBe("bad");
    expect(tooHigh?.tone).toBe("amber");
    expect(find(build({ jeonseRate: 92 }), "jeonseHigh")).toBeUndefined();
  });

  it("경계값 80 은 아직 강점 (곡선 정점의 끝)", () => {
    expect(find(build({ jeonseRate: 80 }), "jeonseHigh")?.layer).toBe("good");
    expect(find(build({ jeonseRate: 80.1 }), "jeonseTooHigh")?.layer).toBe("bad");
  });

  it("주차는 1.5 이상 강점 / 1 미만 약점 / 사이는 회색", () => {
    expect(find(build({ parkingRatio: 1.6 }), "parkingHigh")?.layer).toBe("good");
    expect(find(build({ parkingRatio: 0.8 }), "parkingLow")?.layer).toBe("bad");
    expect(find(build({ parkingRatio: 1.2 }), "parking")?.layer).toBe("neutral");
  });

  it("전용률 80 이상만 강점, 미만은 회색", () => {
    expect(find(build({ exclusiveRatio: 82 }), "exclusiveHigh")?.layer).toBe("good");
    expect(find(build({ exclusiveRatio: 77 }), "exclusiveRatio")?.layer).toBe("neutral");
  });

  it("초등 도보 5분 이내만 강점, 6분부터는 회색", () => {
    expect(find(build({ naverSchoolWalkMin: 4 }), "schoolWalkNear")?.layer).toBe("good");
    expect(find(build({ naverSchoolWalkMin: 9 }), "schoolWalk")?.layer).toBe("neutral");
  });

  it("북쪽 계열 향만 약점 — 남향·동향은 칩 자체가 없다", () => {
    expect(find(build({ primaryDirection: "북동향" }), "northFacing")?.layer).toBe("bad");
    expect(find(build({ primaryDirection: "남향" }), "northFacing")).toBeUndefined();
    expect(find(build({ primaryDirection: "동향" }), "northFacing")).toBeUndefined();
  });

  it("학군은 C 만 약점 — A·B·D 는 칩이 없다", () => {
    expect(find(build({ schoolGrade: "C" }), "schoolC")).toBeDefined();
    for (const g of ["A", "B", "D"]) expect(find(build({ schoolGrade: g }), "schoolC")).toBeUndefined();
  });

  it("시공사 신용은 안전 등급 목록에 없을 때만 약점", () => {
    expect(find(build({ builderCreditGrade: "BBB" }), "builderCredit")).toBeDefined();
    expect(find(build({ builderCreditGrade: "AA" }), "builderCredit")).toBeUndefined();
  });

  it("DSR 통과는 true 일 때만 — false·null 은 칩이 없다", () => {
    expect(find(build({ dsr40pass: true }), "dsrPass")).toBeDefined();
    expect(find(build({ dsr40pass: false }), "dsrPass")).toBeUndefined();
    expect(find(build({ dsr40pass: null }), "dsrPass")).toBeUndefined();
  });
});

describe("buildCardChips — 상호배타 규칙", () => {
  it("혐오시설: 1km 밖이면 안심(강점), 안이면 경고(약점) — 둘이 같이 뜨지 않는다", () => {
    const safe = build({ noxious: ["장례식장"], noxiousDist: 1500 });
    expect(idsOf(safe)).toContain("noxiousSafe");
    expect(idsOf(safe)).not.toContain("noxiousNear");

    const near = build({ noxious: ["장례식장"], noxiousDist: 300 });
    expect(idsOf(near)).toContain("noxiousNear");
    expect(idsOf(near)).not.toContain("noxiousSafe");
  });

  it("혐오시설 목록이 비면 안심도 경고도 안 뜬다", () => {
    const chips = build({ noxious: [], noxiousDist: 1500 });
    expect(idsOf(chips)).not.toContain("noxiousSafe");
    expect(idsOf(chips)).not.toContain("noxiousNear");
  });

  it("치안: 5등급 위험 / 4등급 주의 / 3등급 무표시 / 2등급 이하 우수", () => {
    expect(idsOf(build({ crimeSafetyGrade: 5 }))).toContain("crimeDanger");
    expect(idsOf(build({ crimeSafetyGrade: 4 }))).toContain("crimeCaution");
    const mid = idsOf(build({ crimeSafetyGrade: 3 }));
    expect(mid).not.toContain("crimeDanger");
    expect(mid).not.toContain("crimeCaution");
    expect(mid).not.toContain("crimeGood");
    expect(idsOf(build({ crimeSafetyGrade: 2 }))).toContain("crimeGood");
  });
});

describe("buildCardChips — 편차 스트립과 겹치지 않게", () => {
  it("스트립이 떠 있으면 역세권 칩을 만들지 않는다 (같은 정보 두 번 금지)", () => {
    const chips = build({ subwayDist: 400, subwayName: "아라역" }, mkRes(), { ...OPTS, showDeviation: true });
    expect(idsOf(chips)).not.toContain("subwayNear");
    expect(idsOf(chips)).not.toContain("subwayDist");
  });

  it("스트립이 꺼져 있으면 역세권 칩이 살아난다", () => {
    const opts = { ...OPTS, showDeviation: false };
    expect(find(build({ subwayDist: 400, subwayName: "아라역" }, mkRes(), opts), "subwayNear")?.text).toBe(
      "아라역 400m 역세권"
    );
    expect(find(build({ subwayDist: 1200 }, mkRes(), opts), "subwayDist")?.layer).toBe("neutral");
  });

  it("센티널(9000 이상)은 거리 칩을 만들지 않는다", () => {
    const chips = build({ subwayDist: 9999 }, mkRes(), { ...OPTS, showDeviation: false });
    expect(idsOf(chips)).not.toContain("subwayDist");
    expect(idsOf(chips)).not.toContain("subwayNear");
  });
});

describe("buildCardChips — 교통호재는 가까울 때만", () => {
  it("2km 이내만 뜬다 — 멀거나 '없음'이면 안 뜬다", () => {
    expect(find(build({ transitDev: "GTX-B 인천대입구역", devDist: 1.2 }), "transitDev")?.text).toBe(
      "🚆 GTX-B 인천대입구역"
    );
    expect(idsOf(build({ transitDev: "GTX-B 인천대입구역", devDist: 5 }))).not.toContain("transitDev");
    expect(idsOf(build({ transitDev: "없음", devDist: 1 }))).not.toContain("transitDev");
  });
});

describe("buildCardChips — 청약 경쟁률", () => {
  it("청약 진행/예정 단계 + 경쟁률 양수일 때만 뜬다 (미분양 단계 제외)", () => {
    expect(idsOf(build({ presaleStage: "분양중", competitionRate: 8.6 }))).toContain("competition");
    expect(idsOf(build({ presaleStage: "미분양", competitionRate: 8.6 }))).not.toContain("competition");
    expect(idsOf(build({ presaleStage: "분양중", competitionRate: 0 }))).not.toContain("competition");
  });
});

describe("buildCardChips — 추가 모집은 청약홈(ah-) 단지만", () => {
  it("ah- 로 시작하는 id 만 — 다른 출처는 0 의 뜻이 '정보 없음'이라 판단 불가", () => {
    expect(idsOf(buildCardChips(mkApt({ id: "ah-9", unsoldEventCount: 2 }), mkRes(), OPTS))).toContain("unsoldEvent");
    expect(idsOf(buildCardChips(mkApt({ id: "nv-9", unsoldEventCount: 2 }), mkRes(), OPTS))).not.toContain(
      "unsoldEvent"
    );
  });
});

describe("splitCardChips — 상한을 걸어도 정보가 사라지지 않는다", () => {
  const many = build({
    // 강점 4개
    jeonseRate: 75,
    parkingRatio: 1.8,
    exclusiveRatio: 85,
    dsr40pass: true,
    // 약점 4개
    corridorType: "복도식",
    heatFuel: "LPG",
    schoolGrade: "C",
    primaryDirection: "북향",
    // 회색 1개 + 상태 1개
    naverSchoolWalkMin: 12,
    presaleStage: "분양중",
  });

  it("강점·약점은 상한만큼만 보인다", () => {
    const s = splitCardChips(many);
    expect(s.good).toHaveLength(GOOD_CHIP_MAX);
    expect(s.bad).toHaveLength(BAD_CHIP_MAX);
  });

  it("보이는 것 + 접힌 것 = 전체. 하나도 안 사라진다", () => {
    const s = splitCardChips(many);
    const shown = [...s.status, ...s.core, ...s.good, ...s.bad];
    expect([...shown, ...s.hidden]).toHaveLength(many.length);
    // 같은 칩이 두 곳에 동시에 들어가지도 않는다
    const allIds = [...shown, ...s.hidden].map((c) => c.id);
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it("회색 정보는 전부 접힌다 — 보이는 쪽에 neutral 이 남으면 안 된다", () => {
    const s = splitCardChips(many);
    const shown = [...s.status, ...s.core, ...s.good, ...s.bad];
    expect(shown.filter((c) => c.layer === "neutral")).toHaveLength(0);
    expect(s.hidden.some((c) => c.id === "schoolWalk")).toBe(true);
  });

  it("상태·핵심 값은 상한 밖이라 잘리지 않는다", () => {
    const s = splitCardChips(many);
    // 순서 고정: 가격 → 입지 → 안전. 카드 30장을 훑을 때 자리가 안 바뀌어야 학습된다
    expect(s.core.map((c) => c.id)).toEqual(["priceCheap", "locationInfo", "riskGrade"]);
    expect(s.status.map((c) => c.id)).toContain("presaleStage");
    expect(s.hidden.some((c) => c.layer === "core" || c.layer === "status")).toBe(false);
  });
});

describe("splitCardChips — 강점이 모자라도 빈칸을 만들지 않는다", () => {
  it("강점 0개면 good 은 빈 배열 (837곳·50.9% 가 강점 2개 미만, 2026-08-10 n=1,646)", () => {
    const s = splitCardChips(build({ corridorType: "복도식" }));
    expect(s.good).toHaveLength(0);
    expect(s.bad.length).toBeGreaterThan(0);
  });

  it("강점 1개면 1개만 — 회색으로 메우지 않는다", () => {
    const s = splitCardChips(build({ dsr40pass: true, naverSchoolWalkMin: 12 }));
    expect(s.good.map((c) => c.id)).toEqual(["dsrPass"]);
  });
});

describe("splitCardChips — 흔한 경고가 진짜 위험을 밀어내지 않는다", () => {
  it("점수를 실제로 깎는 약점이, 엔진에 연결도 안 된 약점보다 먼저 보인다", () => {
    // 복도식·LPG난방은 scoring/ 어디에도 등장하지 않는다(감점 0). 흔하기로는 LPG(18.1%)가
    // 미분양(14.3%)과 비슷하지만, 점수를 깎는 쪽이 먼저다.
    const s = splitCardChips(
      build({ unsoldRate: 45, builderCreditGrade: "BBB", corridorType: "복도식", heatFuel: "LPG" })
    );
    expect(s.bad.map((c) => c.id)).toEqual(["unsoldHigh", "builderCredit"]);
    expect(s.hidden.map((c) => c.id)).toEqual(expect.arrayContaining(["corridor", "heatLpg"]));
  });

  it("감점 2위인 학군C 가, 흔하기만 한 혐오시설·추가모집보다 먼저 보인다", () => {
    // 혐오시설은 56.7% 가 다는데 감점은 −0.12, 추가모집은 47.0% 인데 감점 0 이다.
    // 학군C 는 3.6% 뿐이지만 감점 −3.43 으로 2위다. 흔한 것이 치명적인 것을 밀어내면 안 된다.
    const s = splitCardChips(
      buildCardChips(
        mkApt({
          id: "ah-3",
          schoolGrade: "C",
          noxious: ["장례식장"],
          noxiousDist: 300,
          unsoldEventCount: 4,
          crimeSafetyGrade: 4,
        }),
        mkRes(),
        OPTS
      )
    );
    expect(s.bad.map((c) => c.id)[0]).toBe("schoolC");
    expect(s.hidden.map((c) => c.id)).toEqual(expect.arrayContaining(["noxiousNear", "unsoldEvent"]));
  });

  it("치안위험이 치안주의보다 앞선다 (같은 축의 더 심한 쪽)", () => {
    expect(CHIP_ORDER.crimeDanger).toBeLessThan(CHIP_ORDER.crimeCaution);
  });

  it("돈으로 환산되는 강점(할인·교통호재)이 취향 강점(전용률·전세가율)보다 앞선다", () => {
    const s = splitCardChips(
      build({ discountPct: 5, exclusiveRatio: 88, jeonseRate: 75, transitDev: "GTX-A 동탄역", devDist: 1 })
    );
    expect(s.good.map((c) => c.id)).toEqual(["discount", "transitDev"]);
    expect(s.hidden.map((c) => c.id)).toEqual(expect.arrayContaining(["jeonseHigh", "exclusiveHigh"]));
  });

  it("순서표에 없는 칩도 떨어지지 않는다 — 맨 뒤로 갈 뿐", () => {
    const unknown: CardChip[] = [
      { id: "존재하지않는칩", text: "x", tone: "green", layer: "good" },
      { id: "discount", text: "할인 5%", tone: "green", layer: "good" },
      { id: "또다른미등록", text: "y", tone: "green", layer: "good" },
    ];
    const s = splitCardChips(unknown);
    expect(s.good.map((c) => c.id)).toEqual(["discount", "존재하지않는칩"]);
    expect(s.hidden.map((c) => c.id)).toEqual(["또다른미등록"]);
  });
});

describe("CHIP_ORDER — 순서표 자체의 건전성", () => {
  it("순서 값이 중복되지 않는다 (중복이면 정렬이 입력 순서에 기대게 된다)", () => {
    const vals = Object.values(CHIP_ORDER);
    expect(new Set(vals).size).toBe(vals.length);
  });

  it("약점은 전부 강점보다 앞 번호다 (두 무리가 섞이면 순서표를 읽기 어려워진다)", () => {
    const bads = ["unsoldHigh", "builderCredit", "crimeDanger", "noxiousNear", "corridor", "northFacing"];
    const goods = ["discount", "transitDev", "dsrPass", "crimeGood", "exclusiveHigh"];
    for (const k of [...bads, ...goods]) expect(CHIP_ORDER[k], `${k} 가 순서표에 없다`).toBeTypeOf("number");
    const worstBad = Math.max(...bads.map((k) => CHIP_ORDER[k]));
    const bestGood = Math.min(...goods.map((k) => CHIP_ORDER[k]));
    expect(worstBad).toBeLessThan(bestGood);
  });

  it("순서표의 모든 키가 실제로 만들어지는 칩 id 다 (오타·삭제된 칩이 남지 않게)", () => {
    // 이 가드가 없으면 칩을 지우거나 이름을 바꿔도 순서표에 유령 키가 남고,
    // 그 키를 쓰는 테스트는 undefined 를 비교하며 조용히 통과한다.
    const everyId = new Set<string>();
    const variants: Array<Record<string, unknown>> = [
      { discountPct: 5, jeonseRate: 75, parkingRatio: 1.8, exclusiveRatio: 88, naverSchoolWalkMin: 3 },
      { jeonseRate: 40, parkingRatio: 0.7, exclusiveRatio: 60, naverSchoolWalkMin: 20 },
      { jeonseRate: 92 },
      { corridorType: "복도식", heatFuel: "LPG", schoolGrade: "C", primaryDirection: "북향" },
      { unsoldRate: 45, builderCreditGrade: "BBB", crimeSafetyGrade: 5 },
      { crimeSafetyGrade: 4 },
      { crimeSafetyGrade: 1, noxious: ["장례식장"], noxiousDist: 1500, dsr40pass: true },
      { noxious: ["장례식장"], noxiousDist: 200, id: "ah-1", unsoldEventCount: 3 },
      { transitDev: "GTX-A 동탄역", devDist: 1, presaleStage: "분양중", competitionRate: 9 },
      { subwayDist: 300, subwayName: "아라역" },
      { subwayDist: 2000 },
    ];
    for (const v of variants) {
      for (const showDeviation of [true, false]) {
        for (const c of buildCardChips(mkApt(v), mkRes(), { ...OPTS, showDeviation })) everyId.add(c.id);
      }
    }
    for (const k of Object.keys(CHIP_ORDER)) expect(everyId, `순서표의 '${k}' 를 만드는 칩이 없다`).toContain(k);
  });
});
