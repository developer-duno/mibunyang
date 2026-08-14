// @ts-check
import { describe, it, expect } from "vitest";
import { SUB_CONTEXT, PRODUCT_MAX } from "./subContext";
import { PIR_SCORE_TIERS } from "@/constants/scoringTiers";
import { scorePrice, scoreLocation, scoreProduct, scoreBenefit, scoreRisk, scoreFuture } from "@/scoring/engine";

describe("SUB_CONTEXT", () => {
  const EXPECTED_CATS = ["price", "location", "product", "benefit", "risk", "future"];

  it("6개 카테고리 존재", () => {
    EXPECTED_CATS.forEach((cat) => {
      expect(SUB_CONTEXT).toHaveProperty(cat);
    });
  });

  // interpret 함수 null 안전성 검증
  Object.entries(SUB_CONTEXT).forEach(([cat, subs]) => {
    Object.entries(subs).forEach(([name, ctx]) => {
      if (ctx.interpret === null) return; // benefit은 null
      const fn = /** @type {(v: number | null) => string} */ (ctx.interpret);
      const benchmark = /** @type {string} */ (ctx.benchmark);

      it(`${cat}.${name}: interpret(null) 에러 없이 동작`, () => {
        expect(() => fn(null)).not.toThrow();
      });

      it(`${cat}.${name}: interpret(0) 에러 없이 동작`, () => {
        expect(() => fn(0)).not.toThrow();
      });

      it(`${cat}.${name}: interpret(100) 문자열 반환`, () => {
        expect(typeof fn(100)).toBe("string");
      });

      it(`${cat}.${name}: interpret(50) 문자열 반환`, () => {
        expect(typeof fn(50)).toBe("string");
      });

      it(`${cat}.${name}: benchmark 문자열 존재`, () => {
        expect(typeof benchmark).toBe("string");
        expect(benchmark.length).toBeGreaterThan(0);
      });
    });
  });

  // benefit 카테고리 특수 검증
  it("benefit 서브는 interpret/benchmark 모두 null", () => {
    Object.values(SUB_CONTEXT.benefit).forEach((ctx) => {
      expect(ctx.interpret).toBeNull();
      expect(ctx.benchmark).toBeNull();
    });
  });

  // 카테고리별 서브 수 검증
  it("price: 6개 서브", () => {
    expect(Object.keys(SUB_CONTEXT.price)).toHaveLength(6);
  });
  it("location: 5개 서브", () => {
    expect(Object.keys(SUB_CONTEXT.location)).toHaveLength(5);
  });
  it("product: 9개 서브", () => {
    expect(Object.keys(SUB_CONTEXT.product)).toHaveLength(9);
  });
  it("benefit: 6개 서브", () => {
    expect(Object.keys(SUB_CONTEXT.benefit)).toHaveLength(6);
  });
  it("risk: 11개 서브", () => {
    expect(Object.keys(SUB_CONTEXT.risk)).toHaveLength(11);
  });
  it("future: 4개 서브", () => {
    expect(Object.keys(SUB_CONTEXT.future)).toHaveLength(4);
  });

  // interpret 3단계 검증 (높음/보통/낮음)
  it("price.적정가 괴리도: 70→높음, 40→보통, 30→낮음", () => {
    const fn = /** @type {(v: number) => string} */ (SUB_CONTEXT.price["적정가 괴리도"].interpret);
    expect(fn(70)).toContain("저렴");
    expect(fn(40)).toContain("적정");
    expect(fn(30)).toContain("비쌈");
  });
});

// engine.js subs[].name ↔ SUB_CONTEXT 키 정합성 동적 검증
// (C2 키 분리에 의존 — revert 시 future/benefit 테스트 실패 예상)
describe("engine↔subContext 키 정합성", () => {
  // 테스트용 아파트 데이터 (모든 필드 포함)
  function makeTestApt() {
    return {
      id: 1,
      name: "테스트",
      region: "경기",
      gu: "수원시",
      builder: "현대건설",
      completion: "2025-06-01",
      price: 50000,
      area: 84,
      pp: 595,
      nearbyMedian: 55000,
      jeonseRate: 70,
      pir: 5,
      psr: 0.9,
      dataReliability: 80,
      subwayDist: 500,
      busRoutes: 10,
      icDist: 5,
      ktxDist: 15,
      schoolScore: 70,
      schoolGrade: "B+",
      hospital: 3,
      mart: 2,
      conv: 5,
      park: 2,
      cafe: 10,
      culture: 2,
      bank: 2,
      pharmacy: 3,
      view: "그린",
      sunlight: "양호",
      noise: 55,
      noxious: [],
      noxiousDist: null,
      units: 1000,
      parkingRatio: 1.3,
      floorAreaRatio: 220,
      exclusiveRatio: 78,
      maxFloor: 25,
      energyGrade: 2,
      layout: "4베이판상",
      quakeDesign: true,
      discountPct: 5,
      loanFree: true,
      loanFreePct: 60,
      optionFree: true,
      optionValue: 500,
      balconyFree: true,
      balconyValue: 800,
      cashback: 200,
      avgMaintenanceCost: 15,
      avgMaintenanceCostRegion: 20,
      unsoldRate: 15,
      recentTrades6m: 20,
      dsr40pass: true,
      hugGuarantee: true,
      builderCreditGrade: "AA",
      builderDebtRatio: 100,
      supplyRatio: 100,
      popGrowth: 0.3,
      netMigration: 500,
      cancelRatio6m: 5,
      competitionRate: 3,
      transitDev: "GTX-C 착공",
      devDist: 1,
      cityDev: "신도시",
      industryDev: "테크노밸리",
    };
  }

  const scoreFns = {
    price: scorePrice,
    location: scoreLocation,
    product: scoreProduct,
    benefit: scoreBenefit,
    risk: scoreRisk,
    future: scoreFuture,
  };

  Object.entries(scoreFns).forEach(([cat, fn]) => {
    it(`${cat}: engine subs 이름이 모두 SUB_CONTEXT에 존재`, () => {
      const result = fn(/** @type {any} */ (makeTestApt()));
      const SC = /** @type {Record<string, Record<string, unknown>>} */ (/** @type {unknown} */ (SUB_CONTEXT));
      const ctxKeys = new Set(Object.keys(SC[cat] || {}));
      for (const sub of result.subs) {
        expect(ctxKeys.has(sub.name)).toBe(true);
      }
    });
  });
});

// PRODUCT_MAX: scoringTiers.js(영어 키)에서 파생된 한글 키 bridge export
describe("PRODUCT_MAX", () => {
  it("합계 = 100", () => {
    expect(Object.values(PRODUCT_MAX).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("9개 서브스코어 정의", () => {
    expect(Object.keys(PRODUCT_MAX)).toHaveLength(9);
  });

  it("모든 값이 양수", () => {
    Object.values(PRODUCT_MAX).forEach((v) => expect(v).toBeGreaterThan(0));
  });

  it("브랜드=20 (최대)", () => {
    expect(PRODUCT_MAX["브랜드"]).toBe(20);
  });
  it("내진=5, 구조=5 (최소)", () => {
    expect(PRODUCT_MAX["내진"]).toBe(5);
    expect(PRODUCT_MAX["구조"]).toBe(5);
  });

  // SUB_CONTEXT.product 키와 매칭 검증
  it("PRODUCT_MAX 키가 SUB_CONTEXT.product 키와 일치", () => {
    const maxKeys = Object.keys(PRODUCT_MAX).sort();
    const ctxKeys = Object.keys(SUB_CONTEXT.product).sort();
    expect(maxKeys).toEqual(ctxKeys);
  });

  // ── 문구가 값·배점표와 어긋나던 자리 (세션512 전수 조사) ──────────────────────
  //
  // 전부 "점수만 보고 문구를 역산"해서 난 거짓이다. 각 테스트는 **옛 문구가 돌아오면 red** 가
  // 되도록 옛 문자열의 부재를 함께 단언한다 — 통과만 보는 가드는 껍데기다
  // (.claude/rules/meta/guards-must-be-mutation-tested.md).
  describe("문구 ↔ 값 일치 (세션512)", () => {
    /** @param {string} cat @param {string} sub @param {number} sc @param {string} [info] */
    const say = (cat, sub, sc, info) =>
      /** @type {(s: number, i?: string) => string} */ (/** @type {any} */ (SUB_CONTEXT)[cat][sub].interpret)(sc, info);

    it("적정가 괴리도: '주변 대비'라 하지 않는다 — 적정가와의 괴리다", () => {
      // deviation = 적정가(주변 중앙가 × 연식·면적·브랜드 계수) 대비. 주변 단지 직접 비교가 아니다.
      for (const sc of [90, 50, 10]) expect(say("price", "적정가 괴리도", sc)).not.toMatch(/주변/);
      expect(say("price", "적정가 괴리도", 10)).toBe("적정가보다 비쌈");
    });

    it("전세가율: 높아서 낮은 점수를 '낮다'고 하지 않는다 (∩ 곡선)", () => {
      expect(say("price", "전세가율", 5, "151.1%")).toMatch(/높음/);
      expect(say("price", "전세가율", 5, "151.1%")).not.toMatch(/낮/);
      expect(say("price", "전세가율", 20, "85.0%")).toMatch(/높음/);
      expect(say("price", "전세가율", 30, "55.0%")).toMatch(/낮음/);
      // 점수로 가르면 아래쪽(jr 66% → sc 72)이 "적정"에 섞여 새 거짓이 생긴다
      expect(say("price", "전세가율", 72, "66.1%")).not.toMatch(/적정/);
    });

    it("PIR 기준선은 PIR_SCORE_TIERS 에서 만든다 — 손으로 적으면 어긋난다", () => {
      expect(SUB_CONTEXT.price.PIR.benchmark).toContain(`${PIR_SCORE_TIERS.EXCELLENT_MAX}배`);
      expect(SUB_CONTEXT.price.PIR.benchmark).not.toMatch(/^3배/); // 옛 값(가구소득 시절)
    });

    it("택지비비율: 단지 원가가 아니라 시도 값임을 밝힌다", () => {
      expect(say("price", "택지비비율", 90)).toContain("시도");
      expect(say("price", "택지비비율", 90)).not.toMatch(/가격 안정/); // 재지 않은 인과
      expect(SUB_CONTEXT.price.택지비비율.benchmark).not.toMatch(/60%/); // 도달 0곳이던 기준
    });

    it("브랜드: 배점표(BRAND_TIER)와 한 칸도 밀리지 않는다", () => {
      expect(say("product", "브랜드", 20)).toBe("1군 최상위 브랜드");
      expect(say("product", "브랜드", 15)).toBe("1군 브랜드");
      expect(say("product", "브랜드", 10)).toBe("2군 브랜드");
      // 5점에는 3군 등재 브랜드와 표 미등재(공공기관·표기 변형 포함)가 함께 떨어진다
      expect(say("product", "브랜드", 5)).not.toMatch(/중소/);
    });

    it("용적률: FAR_TIERS(10/7/3)와 임계가 맞는다 — 7점은 '쾌적'이 아니다", () => {
      expect(say("product", "용적률", 10)).toBe("쾌적한 밀도");
      expect(say("product", "용적률", 7)).toBe("보통 밀도");
      expect(say("product", "용적률", 7)).not.toMatch(/쾌적/);
      expect(say("product", "용적률", 3)).toBe("과밀 우려");
    });

    it("구조: 층수만 재므로 조망을 주장하지 않는다", () => {
      expect(say("product", "구조", 5)).not.toMatch(/조망/);
      expect(say("product", "구조", 5)).toBe("고층 단지");
    });

    it("학군: 접근성을 재므로 '우수 학군'이라 하지 않는다", () => {
      expect(say("location", "학군", 90)).not.toMatch(/우수 학군/);
      expect(say("location", "학군", 90)).toBe("학교 접근 우수");
    });

    it("혐오시설: 시설이 있는데 '깨끗'이라 하지 않는다 (값으로 가른다)", () => {
      expect(say("location", "혐오시설", 100, "없음")).toBe("주변 깨끗");
      expect(say("location", "혐오시설", 100, "공장 620m")).not.toMatch(/깨끗/);
      // '소규모'를 뒷받침할 값이 수집기에 없다 — 거리 완화일 뿐이다
      expect(say("location", "혐오시설", 50, "장례식장 892m")).not.toMatch(/소규모/);
    });

    // ⚠️ 적대검증이 잡은 자리 — `info` 는 감점 0인 시설(공장·장례식장)까지 담으므로 전체 개수로 세면
    //    "여러 곳"이 55곳(87.3%)에서 거짓이 된다. **감점 대상만** 세야 한다.
    it("혐오시설: '여러 곳'은 감점 대상이 2개 이상일 때만 (공장·장례식장은 안 센다)", () => {
      // 실데이터: 감점 대상 화장장 1개 + 감점 0인 공장 → "여러 곳"이 아니다
      expect(say("location", "혐오시설", 33, "화장장,공장")).toBe("감점 시설 가까움");
      expect(say("location", "혐오시설", 33, "화장장,공장")).not.toMatch(/여러/);
      // 감점 대상 2개(소각장+고압선)면 "여러 곳"이 참
      expect(say("location", "혐오시설", 10, "소각장,고압선,공장")).toBe("감점 시설 여러 곳");
      // 감점 0인 시설만 잔뜩 있어도 개수로 세지 않는다
      expect(say("location", "혐오시설", 20, "장례식장,공장,축산시설")).not.toMatch(/여러/);
    });

    // ⚠️ 적대검증 실측 — 이 항목의 판정·기준선을 통째로 옛 상태로 되돌려도 src 전체 2,782건이
    //    초록이었다(완전 무방비). 다른 10종과 같은 꼴로 잠근다.
    it("교통: 지하철만 재는 게 아니므로 '역세권 500m'를 기준이라 하지 않는다", () => {
      expect(say("location", "교통", 90)).toBe("교통 우수");
      expect(say("location", "교통", 90)).not.toMatch(/대중교통 우수/); // 옛 문구
      expect(SUB_CONTEXT.location.교통.benchmark).not.toMatch(/역세권 500m/);
      expect(SUB_CONTEXT.location.교통.benchmark).toMatch(/나들목|KTX/);
    });

    // ⚠️ 이 축은 확실성+근접+노선급의 합이라 트램(6)·경전철(8)도 70을 넘는다(실측 24곳).
    //    "대형"이라 부르면 재지 않은 규모를 주장하는 것이다.
    it("교통개발: 규모를 주장하지 않는다 — 트램도 같은 분기에 들어온다", () => {
      const s = say("future", "교통개발", 73, "대전2호선(트램) 판암역 착공");
      expect(s).not.toMatch(/대형/);
      expect(s).toBe("착공 단계 · 가까움");
    });

    it("자연환경·생활인프라 기준선이 엔진에 없는 숫자를 말하지 않는다", () => {
      expect(SUB_CONTEXT.location.자연환경.benchmark).not.toMatch(/55dB/); // NOISE_TIERS 에 없는 경계
      expect(SUB_CONTEXT.location.생활인프라.benchmark).not.toMatch(/마트2\+/); // 마트는 1개면 만점
    });

    it("규제: 이진 축이므로 '일부'라 하지 않는다", () => {
      expect(say("risk", "규제", 40)).not.toMatch(/일부/);
      expect(say("risk", "규제", 40)).toMatch(/규제지역/);
      expect(say("risk", "규제", 90)).toMatch(/비규제/);
    });

    it("공급량: info 의 라벨을 그대로 옮긴다 — 다시 매기지 않는다", () => {
      expect(say("risk", "공급량", 95, "보급률 93.9% 부족")).toBe("주택 부족");
      expect(say("risk", "공급량", 25, "보급률 102.5% 여유")).toBe("주택 여유");
      // 옛 산식은 점수로 다시 갈라 "부족"에 "공급 적정"을 붙였다
      expect(say("risk", "공급량", 95, "보급률 93.9% 부족")).not.toBe("공급 적정");
      // 우리는 수요를 잰 적이 없다
      expect(say("risk", "공급량", 95, "보급률 93.9% 부족")).not.toMatch(/수요/);
    });
  });
});
