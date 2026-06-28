// @ts-check
import { describe, it, expect } from "vitest";
import { SUB_CONTEXT, PRODUCT_MAX } from "./subContext";
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
});
