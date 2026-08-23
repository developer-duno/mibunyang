// @ts-check
import { describe, it, expect } from "vitest";
import { PROFILES, getTopCats } from "./profiles";
import { LOCATION_SUB_WEIGHTS } from "./scoringTiers";

// 프로필 구조 및 가중치 무결성 검증
describe("PROFILES 상수", () => {
  const EXPECTED_CATS = ["location", "product", "price", "risk", "benefit", "future"];

  it("5개 프로필이 존재한다", () => {
    expect(Object.keys(PROFILES)).toHaveLength(5);
    expect(Object.keys(PROFILES)).toEqual(expect.arrayContaining(["live", "invest", "newlywed", "edu", "retire"]));
  });

  Object.entries(PROFILES).forEach(([key, p]) => {
    describe(`${key} 프로필`, () => {
      it("가중치 합계 = 100", () => {
        expect(Object.values(p.w).reduce((a, b) => a + b, 0)).toBe(100);
      });

      it("6개 카테고리 키 존재", () => {
        EXPECTED_CATS.forEach((cat) => {
          expect(p.w).toHaveProperty(cat);
        });
      });

      it("가중치가 모두 0 이상 정수", () => {
        Object.values(p.w).forEach((v) => {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(Number.isInteger(v)).toBe(true);
        });
      });

      it("name과 desc가 비어있지 않음", () => {
        expect(p.name.length).toBeGreaterThan(0);
        expect(p.desc.length).toBeGreaterThan(0);
      });

      it("예상치 못한 키가 없다", () => {
        Object.keys(p.w).forEach((k) => {
          expect(EXPECTED_CATS).toContain(k);
        });
      });
    });
  });

  it("서로 다른 프로필은 서로 다른 가중치를 가진다", () => {
    const keys = Object.keys(PROFILES);
    const P = /** @type {Record<string, { w: unknown }>} */ (PROFILES);
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        expect(P[keys[i]].w).not.toEqual(P[keys[j]].w);
      }
    }
  });
});

// 프로필 상위 N 카테고리 파생 — 맞춤 강조용 (세션 382)
describe("getTopCats", () => {
  it("invest 상위 2 = price, risk", () => {
    expect(getTopCats(PROFILES.invest.w)).toEqual(["price", "risk"]);
  });
  it("edu 상위 2 = location, product", () => {
    expect(getTopCats(PROFILES.edu.w)).toEqual(["location", "product"]);
  });
  // 세션526 수술 (가): retire 가 location 35→25 / product 30→45 로 뒤집혀 product 가 단독 1위다.
  //   "은퇴는 사는 집 자체가 중요"라는 프로필 성격이 이제 순위에도 드러난다.
  it("retire 상위 2 = product(45), location(25) — 세션526에 product 가 location 을 추월", () => {
    expect(getTopCats(PROFILES.retire.w)).toEqual(["product", "location"]);
  });
  it("동점(live: product/price=20)은 카테고리 선언 순서로 — location, product", () => {
    expect(getTopCats(PROFILES.live.w)).toEqual(["location", "product"]);
  });
  // 2026-08-11: benefit 가중치 0 재분배로 newlywed price 가 30→40 이 되어 더 이상 location 과 동점이
  // 아니다(price 가 단독 1위) — constants/profiles.ts 근거 주석 참조.
  it("newlywed 상위 2 = price(40), location(30) — benefit 10 이 price 로 재분배돼 동점 해소", () => {
    expect(getTopCats(PROFILES.newlywed.w)).toEqual(["price", "location"]);
  });
  it("n=3 도 동작", () => {
    expect(getTopCats(PROFILES.invest.w, 3)).toEqual(["price", "risk", "location"]);
  });
});

/**
 * 세션526 — 프로필 변별력 수술. 근거: docs/superpowers/specs/2026-08-24-profile-discrimination-remeasure.md
 *
 * 손님이 프로필을 바꿔도 추천이 거의 같던(실거주–자녀교육 상관 0.992, 상위10 겹침 9/10) 문제를
 * ① 카테고리 가중치를 벌리고 ② 입지 내부 비중(locW)을 프로필별로 갈라 해소했다.
 * 아래 가드는 그 결정을 되돌리면 red 가 나게 해, "왜 이 값인지" 를 다시 보게 만든다.
 */
describe("세션526 프로필 변별력 — 카테고리 가중치 (수술 가)", () => {
  it("edu 는 입지에 압도적 비중을 준다 (location 70) — 옛 값 50 으로 되돌리면 red", () => {
    expect(PROFILES.edu.w).toEqual({ location: 70, product: 10, price: 10, risk: 5, benefit: 0, future: 5 });
    // 설계 의도: "학군 최우선" 프로필은 입지가 나머지 전부(30)보다 커야 한다.
    expect(PROFILES.edu.w.location).toBeGreaterThanOrEqual(60);
  });

  it("retire 는 상품성이 입지보다 크다 (product 45 > location 25) — 옛 값(30/35)으로 되돌리면 red", () => {
    expect(PROFILES.retire.w).toEqual({ location: 25, product: 45, price: 15, risk: 15, benefit: 0, future: 0 });
    expect(PROFILES.retire.w.product).toBeGreaterThan(PROFILES.retire.w.location);
  });

  it("live/invest/newlywed 의 카테고리 가중치는 이번 수술에서 건드리지 않았다", () => {
    expect(PROFILES.live.w).toEqual({ location: 45, product: 20, price: 20, risk: 10, benefit: 0, future: 5 });
    expect(PROFILES.invest.w).toEqual({ location: 15, product: 10, price: 35, risk: 30, benefit: 0, future: 10 });
    expect(PROFILES.newlywed.w).toEqual({ location: 30, product: 15, price: 40, risk: 10, benefit: 0, future: 5 });
  });
});

describe("세션526 프로필 변별력 — 입지 내부 비중 locW (수술 나)", () => {
  const WITH_LOC_W = /** @type {const} */ (["newlywed", "edu", "retire"]);

  it("locW 를 가진 프로필은 신혼·자녀교육·은퇴 셋 (live/invest 는 기준 비중 사용)", () => {
    const has = Object.entries(PROFILES)
      .filter(([, p]) => p.locW != null)
      .map(([k]) => k);
    expect(has.sort()).toEqual([...WITH_LOC_W].sort());
    expect(PROFILES.live.locW).toBeUndefined();
    expect(PROFILES.invest.locW).toBeUndefined();
  });

  WITH_LOC_W.forEach((key) => {
    describe(`${key}.locW`, () => {
      it("5개 서브 비중 합 = 1.00 (src/scoring/CLAUDE.md 불변식)", () => {
        const locW = /** @type {Record<string, number>} */ (PROFILES[key].locW);
        expect(Object.values(locW).reduce((a, b) => a + b, 0)).toBeCloseTo(1.0, 10);
      });

      it("키 집합이 LOCATION_SUB_WEIGHTS 와 정확히 같다 (오타 키는 조용히 0점이 된다)", () => {
        const locW = /** @type {Record<string, number>} */ (PROFILES[key].locW);
        expect(Object.keys(locW).sort()).toEqual(Object.keys(LOCATION_SUB_WEIGHTS).sort());
      });

      it("모든 비중이 0 이상", () => {
        const locW = /** @type {Record<string, number>} */ (PROFILES[key].locW);
        Object.values(locW).forEach((v) => expect(v).toBeGreaterThanOrEqual(0));
      });
    });
  });

  it("기준 비중 LOCATION_SUB_WEIGHTS 자체도 합 1.00", () => {
    expect(Object.values(LOCATION_SUB_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1.0, 10);
  });

  // 설계 의도 — 프로필 이름이 말하는 것과 산식이 보는 것이 같아야 한다.
  it("자녀교육은 학군을 가장 크게 본다 (0.55, 입지의 절반 초과)", () => {
    const locW = /** @type {Record<string, number>} */ (PROFILES.edu.locW);
    expect(locW.school).toBe(0.55);
    expect(locW.school).toBeGreaterThan(0.5);
  });

  it("은퇴는 학군이 가장 작고, 인프라·자연환경이 가장 크다", () => {
    const locW = /** @type {Record<string, number>} */ (PROFILES.retire.locW);
    expect(locW.school).toBe(0.05);
    expect(Math.min(...Object.values(locW))).toBe(locW.school);
    expect(locW.infra).toBe(0.3);
    expect(locW.env).toBe(0.3);
    expect(locW.env).toBeGreaterThan(/** @type {Record<string, number>} */ (LOCATION_SUB_WEIGHTS).env);
  });

  it("신혼은 학군을 낮추고 인프라를 기준보다 크게 본다", () => {
    const locW = /** @type {Record<string, number>} */ (PROFILES.newlywed.locW);
    const base = /** @type {Record<string, number>} */ (LOCATION_SUB_WEIGHTS);
    expect(locW.school).toBeLessThan(base.school);
    expect(locW.infra).toBeGreaterThan(base.infra);
  });

  it("자녀교육과 은퇴의 locW 는 서로 다르다 (같으면 수술 (나)의 의미가 없다)", () => {
    expect(PROFILES.edu.locW).not.toEqual(PROFILES.retire.locW);
  });
});
