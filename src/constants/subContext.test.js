// @ts-check
import { describe, it, expect } from "vitest";
import { SUB_CONTEXT, PRODUCT_MAX } from "./subContext";
import { PIR_SCORE_TIERS, LIQUIDITY_TIERS, LIQUIDITY_LABELS, LIQUIDITY_AREA_UNIT } from "@/constants/scoringTiers";
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

  // interpret 3단계 검증 — 점수가 아니라 **값(info)** 으로 가른다 (세션512, 아래 블록 참조)
  it("price.적정가 괴리도: +12%→저렴, +1%→적정, -12%→비쌈", () => {
    const fn = /** @type {(v: number, i?: string) => string} */ (SUB_CONTEXT.price["적정가 괴리도"].interpret);
    expect(fn(70, "+12.0%")).toContain("저렴");
    expect(fn(40, "+1.0%")).toContain("적정");
    expect(fn(30, "-12.0%")).toContain("비쌈");
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
      for (const sc of [90, 50, 10]) expect(say("price", "적정가 괴리도", sc, "-12.0%")).not.toMatch(/주변/);
      expect(say("price", "적정가 괴리도", 10, "-12.0%")).toBe("적정가보다 비쌈");
    });

    // ⚠️ 점수로 가르면 값과 어긋난다 — 전세가율(위)과 **같은 종류의 결함**이 옆 항목에 남아 있었다.
    //    실측: 괴리도 양수인데 "비쌈" 10곳 · "적정가 수준" 91곳 중 45곳이 ±5% 밖.
    //    옛 점수 기반 산식으로 되돌리면 red.
    it("적정가 괴리도: 값(info)으로 가른다 — 양수인데 '비쌈'이라 하지 않는다", () => {
      // 옛 산식이면 sc=10 → "적정가보다 비쌈". 값은 +0.9% 라 거짓이었다.
      expect(say("price", "적정가 괴리도", 10, "+0.9%")).toBe("적정가 수준");
      expect(say("price", "적정가 괴리도", 10, "+0.9%")).not.toMatch(/비쌈/);
      expect(say("price", "적정가 괴리도", 100, "+18.8%")).toBe("적정가보다 저렴");
      expect(say("price", "적정가 괴리도", 100, "-12.0%")).toBe("적정가보다 비쌈");
      // 옛 산식이면 sc=90 → "저렴". 값이 ±5% 안이면 "적정가 수준"이다.
      expect(say("price", "적정가 괴리도", 90, "-3.2%")).toBe("적정가 수준");
    });

    it("적정가 괴리도: 경계 ±5 는 benchmark 문구와 한 쌍이다", () => {
      expect(say("price", "적정가 괴리도", 50, "+5.0%")).toBe("적정가 수준");
      expect(say("price", "적정가 괴리도", 50, "+5.1%")).toBe("적정가보다 저렴");
      expect(say("price", "적정가 괴리도", 50, "-5.0%")).toBe("적정가 수준");
      expect(say("price", "적정가 괴리도", 50, "-5.1%")).toBe("적정가보다 비쌈");
      expect(SUB_CONTEXT.price["적정가 괴리도"].benchmark).toContain("±5%");
    });

    it("적정가 괴리도: 적정가를 못 만들면 판정하지 않는다 (catVerdict 와 같은 어휘)", () => {
      // scorePrice 무데이터 분기가 내는 info. 점수(devSc 기본값)로 역산하면 거짓 판정이 된다.
      expect(say("price", "적정가 괴리도", 50, "데이터 부재")).toBe("적정가 산출 불가");
      expect(say("price", "적정가 괴리도", 50)).toBe("적정가 산출 불가");
      for (const info of ["데이터 부재", undefined]) {
        expect(say("price", "적정가 괴리도", 50, info)).not.toMatch(/저렴|비쌈|수준/);
      }
    });

    // ⚠️ 도시·산업축은 "반경 5km 내 …없음" 인데 교통만 반경이 없어, 936곳(56.9%)이 읽는 문구가
    //    "전국에 계획이 없다"로 읽혔다. 수집 반경은 셋 다 5km(`transit-match.mjs`).
    it("교통개발: 어디까지 찾아봤는지 밝힌다 — 세 축이 같은 형식", () => {
      expect(say("future", "교통개발", 0, "없음")).toBe("반경 5km 내 계획 노선 없음");
      expect(say("future", "교통개발", 0, "없음")).not.toBe("계획 노선 없음"); // 옛 문구 (반경 없음)
      for (const sub of ["교통개발", "도시개발", "산업개발"]) {
        expect(say("future", sub, 0, "없음")).toMatch(/^반경 5km 내 /);
      }
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

    // 세션513 — 거래량 미수집(180곳)이 중립 점수를 받게 되면서, 점수만 보면 "거래 보통"이라
    // 말하게 된다. 재보지도 않은 것을 보통이라 부르면 거짓 — info 로 먼저 가른다.
    //
    // ⚠️ 세션514: 이 가지는 **화면에 도달하지 않는다**(CatPanel `isNoDataInfo` 가 "미수집"을
    //    먼저 걸러 interpret 을 안 부른다). 그래도 지키는 이유는 죽은 코드라서가 아니라,
    //    **형식이 깨졌을 때 밴드를 지어내지 않는다**는 방어이기 때문이다 — 이 가지가 없으면
    //    파싱 실패가 최하 밴드("거래 침체")로 조용히 떨어진다.
    it('거래량: 건수를 못 읽으면 밴드를 지어내지 않는다 ("거래량 미수집")', () => {
      expect(say("risk", "거래량", 55, "미수집")).toBe("거래량 미수집");
      expect(say("risk", "거래량", 55, "형식이 바뀐 문자열")).toBe("거래량 미수집");
      expect(say("risk", "거래량", 55, undefined)).toBe("거래량 미수집");
      expect(say("risk", "거래량", 55, "수원시 6개월 995건")).not.toBe("거래량 미수집");
    });

    // 세션514 — 판정을 **값 기반**으로 옮긴다. 세션513이 경계를 구 단위 분포로 옮겨 놓고
    // 판정만 옛 점수 임계(70/40)에 남겨 둔 탓에, 1,000~1,999건 구간 428곳이
    // "기준 2,000건+ 활발" 옆에서 "거래 활발"을 달고 있었다(모순 26곳 → 798곳).
    describe("거래량 판정은 LIQUIDITY_TIERS 와 한 쌍 (세션514)", () => {
      /** @param {number} n */
      const at = (n) => say("risk", "거래량", 0, `수원시 6개월 ${n.toLocaleString()}건`);
      /** @param {number} i */
      const min = (i) => /** @type {number} */ (LIQUIDITY_TIERS[i].min);

      it("경계 ±1 에서 밴드가 갈린다 — 수치는 상수에서 읽는다", () => {
        LIQUIDITY_TIERS.forEach((_t, i) => {
          expect(at(min(i))).toBe(`거래 ${LIQUIDITY_LABELS[i]}`);
          expect(at(min(i) - 1)).toBe(`거래 ${LIQUIDITY_LABELS[i + 1]}`);
        });
      });

      it("점수 임계(70/40)로 되돌리면 경계가 어긋난다", () => {
        // 옛 산식은 이 구간(1,000~1,999)의 서브점수가 80 이라 "거래 활발"이라 불렀다.
        // benchmark 는 2,000건+ 를 활발이라 하므로 그 자리에서 자기 모순.
        expect(at(min(0) - 1)).toBe("거래 보통");
        expect(at(min(0) - 1)).not.toBe("거래 활발");
        // 점수를 무엇으로 주든 값이 같으면 같은 말을 한다 (점수 역산 잔재가 남으면 red)
        expect(say("risk", "거래량", 95, "수원시 6개월 1,500건")).toBe(
          say("risk", "거래량", 5, "수원시 6개월 1,500건")
        );
      });

      it("지역 이름이 무엇이든 건수만 읽는다 (gu 는 시·군·구가 섞여 있다)", () => {
        for (const area of ["수원시", "의정부시", "옹진군", "세종특별자치시", "이 지역"]) {
          expect(say("risk", "거래량", 0, `${area} 6개월 2,500건`)).toBe(`거래 ${LIQUIDITY_LABELS[0]}`);
        }
      });

      /**
       * 경계가 **실측 사분위 근방**에 있는지 (세션514).
       *
       * 위 가드들은 전부 `LIQUIDITY_TIERS` 에서 파생하므로 **경계를 옮기면 다 같이 따라간다** —
       * 그래서 잘못된 재보정(예: 2,000 → 2,500)을 하나도 못 잡는다(실증: 468건 전부 초록).
       * 파생 가드가 지키는 건 "어긋나지 않음"이지 "옳음"이 아니다.
       *
       * 여기서 잠그는 건 상수 주석이 **스스로 주장하는 근거**다 — "경계를 실제 분포의 사분위로
       * 옮긴다". 그 주장에서 멀어지면 세션501·498이 겪은 실패로 되돌아간다: 경계가 실측에서 뜨면
       * 최상 구간이 비거나(만점 0곳) 한 구간에 몰려 변별력이 사라진다.
       *
       * ⚠️ 관측값은 **세션514에 갱신됐다.** 세션513이 쓰던 값(p25 516 · med 995 · p75 1,954)은
       * 수집기의 무정렬 OFFSET 페이징 때문에 큰 구가 통째로 깎인 **오염 분포**였다.
       * 여기 적힌 수치를 고칠 때는 반드시 **재수집 후** 분포를 다시 재고 함께 고친다.
       */
      it("경계는 상수 주석이 근거로 든 실측 사분위 근방이어야 한다", () => {
        // 세션515 실측(trade_stats 2026-08-15, 완전한 6개월 창 202602~07, 값 보유 n=2,567).
        // 티어가 아니라 **관측값**이다. 세션514 값(1735/1073/715)은 4개월치 창의 분포 — 폐기.
        const OBSERVED = [2479, 1683, 1057]; // p75 · med · p25
        const TOLERANCE = 0.15; // ±15% — 재보정은 되되, 분포에서 떨어지면 red
        LIQUIDITY_TIERS.forEach((t, i) => {
          const ratio = /** @type {number} */ (t.min) / OBSERVED[i];
          expect(ratio).toBeGreaterThan(1 - TOLERANCE);
          expect(ratio).toBeLessThan(1 + TOLERANCE);
        });
      });
    });

    it("거래량 benchmark 는 LIQUIDITY_TIERS 에서 **조립**한다 (손으로 적으면 어긋난다)", () => {
      // 옛 가드는 "구"·"2,000" 문자열만 봐서, 상수를 바꿔도 초록인 껍데기였다.
      // 이제 값에서 조립한 문자열과 통째로 대조한다 — 하드코딩으로 되돌리면 red.
      const expected = `${LIQUIDITY_AREA_UNIT} 6개월 ${/** @type {number} */ (LIQUIDITY_TIERS[0].min).toLocaleString()}건+ ${LIQUIDITY_LABELS[0]}`;
      expect(SUB_CONTEXT.risk["거래량"].benchmark).toBe(expected);
      // "구"라고만 단정하던 옛 문구로 되돌아가면 red (값 보유의 42.0%가 구가 아니다)
      expect(SUB_CONTEXT.risk["거래량"].benchmark).not.toBe("구 6개월 2,000건+ 활발");
      // 옛 단지 단위 경계 문구로 되돌아가도 red
      expect(SUB_CONTEXT.risk["거래량"].benchmark).not.toContain("30건");
    });

    // 세션513 — DSR 미산정 121곳(전부 pir null)은 "대출 보통"이 아니라 재본 적이 없는 것.
    it('대출/잔금: info "미산정" 이면 "대출 심사자료 미산정"', () => {
      expect(say("risk", "대출/잔금", 50, "미산정")).toBe("대출 심사자료 미산정");
      expect(say("risk", "대출/잔금", 50, "주의")).toBe("대출 보통");
    });
  });
});
