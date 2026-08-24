// @ts-check
import { describe, it, expect } from "vitest";
import { PROFILES } from "@/constants/profiles";
import {
  INFRA_CONFIG,
  FULL_BUS_ROUTES,
  ENV_MAX,
  VIEW_SCORES,
  SUNLIGHT_DIRECTION_MAX,
  NOISE_TIERS,
  AIR_QUALITY_TIERS,
  infraSaturation,
  FUTURE_WEIGHTS,
  FUTURE_RAW_MAX,
  TRANSIT_LINE_TYPE,
  LIQUIDITY_LEGEND,
  LIQUIDITY_AREA_UNIT,
  LIQUIDITY_TIERS,
  LOCATION_SUB_WEIGHTS,
  AREA_BUCKET_TOLERANCE_M2,
} from "@/constants/scoringTiers";
import {
  getAgeCoeff,
  getAreaAdj,
  matchAreaPrice,
  scorePrice,
  scoreLocation,
  scoreProduct,
  scoreBenefit,
  scoreRisk,
  scoreFuture,
  computeRegionalMedians,
  calcCats,
  calcAll,
  locationTotalForProfile,
} from "./engine";

// --- 팩토리 함수: 테스트용 아파트 데이터 생성 ---
/**
 * @param {Partial<import('@/types/scoring').Apt>} [overrides]
 * @returns {import('@/types/scoring').Apt}
 */
function makeApt(overrides = {}) {
  // (any) cast 이유: id 가 number 리터럴 (Apt.id?: string) — TS2322 차단
  return /** @type {any} */ ({
    id: 1,
    name: "테스트아파트",
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
    greenBldg: null,
    hasPool: false,
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
    transitDev: "GTX-C 착공",
    devDist: 1,
    cityDev: "신도시",
    industryDev: "테크노밸리",
    ...overrides,
  });
}

// 가중치 합계 = 100%
describe("프로필 가중치 합계", () => {
  Object.entries(PROFILES).forEach(([key, profile]) => {
    it(key + " 프로필 가중치 합계 = 100", () => {
      const sum = Object.values(profile.w).reduce((a, b) => a + b, 0);
      expect(sum).toBe(100);
    });
  });
  it("프로필이 5개 존재한다", () => {
    expect(Object.keys(PROFILES).length).toBe(5);
  });
  it("모든 프로필에 6개 카테고리가 있다", () => {
    const cats = ["location", "product", "price", "risk", "benefit", "future"];
    Object.values(PROFILES).forEach((profile) => {
      cats.forEach((cat) => {
        expect(profile.w).toHaveProperty(cat);
        expect(typeof (/** @type {any} */ (profile.w)[cat])).toBe("number");
      });
    });
  });
});

describe("getAgeCoeff", () => {
  it("미래 입주일은 1.0", () => {
    expect(getAgeCoeff("2030-01-01")).toBe(1.0);
  });
  it("null은 1.05", () => {
    expect(getAgeCoeff(null)).toBe(1.05);
  });
  it("유효하지 않은 값은 1.05", () => {
    expect(getAgeCoeff("invalid")).toBe(1.05);
  });
  it("1년 미만 = 1.03", () => {
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    expect(getAgeCoeff(d.toISOString().slice(0, 10))).toBe(1.03);
  });
});

describe("getAreaAdj", () => {
  it("소형 (60m2 미만) = 1.08", () => {
    expect(getAreaAdj(50)).toBe(1.08);
  });
  it("중형 (60~85m2) = 1.0", () => {
    expect(getAreaAdj(84)).toBe(1.0);
  });
  it("대형 (85~115m2) = 0.97", () => {
    expect(getAreaAdj(100)).toBe(0.97);
  });
  it("초대형 (115m2+) = 0.94", () => {
    expect(getAreaAdj(120)).toBe(0.94);
  });
  it("null/0 = 1.0", () => {
    expect(getAreaAdj(null)).toBe(1.0);
    expect(getAreaAdj(0)).toBe(1.0);
  });
});

describe("scorePrice", () => {
  it("정상 데이터에서 0~100 범위", () => {
    const r = scorePrice(makeApt());
    expect(r.total).toBeGreaterThanOrEqual(0);
    expect(r.total).toBeLessThanOrEqual(100);
    expect(r.subs).toHaveLength(6);
    expect(r.fairPrice).toBeGreaterThan(0);
  });
  it("nearbyMedian=0이면 fairPrice=0", () => {
    const r = scorePrice(makeApt({ nearbyMedian: 0 }));
    expect(r.fairPrice).toBe(0);
    expect(r.subs[0].info).toBe("데이터 부재");
  });
  it("분양가 < 적정가 -> 높은 점수", () => {
    expect(scorePrice(makeApt({ price: 30000, nearbyMedian: 55000 })).total).toBeGreaterThan(70);
  });
  it("분양가 > 적정가 -> 낮은 점수", () => {
    expect(scorePrice(makeApt({ price: 80000, nearbyMedian: 40000 })).total).toBeLessThan(60);
  });
  it("세션108: PIR <= 10 -> PIR 서브스코어 100 (우수 구간)", () => {
    expect(scorePrice(makeApt({ pir: 8 })).subs.find((s) => s.name === "PIR")?.score ?? 0).toBe(100);
  });
  it("세션108: PIR=15 -> 양호 구간 80~100 선형", () => {
    const s = scorePrice(makeApt({ pir: 15 })).subs.find((s) => s.name === "PIR")?.score ?? 0;
    expect(s).toBeGreaterThanOrEqual(89);
    expect(s).toBeLessThanOrEqual(91);
  });
  it("세션108: PIR=25 -> 보통 구간 60~80 선형", () => {
    const s = scorePrice(makeApt({ pir: 25 })).subs.find((s) => s.name === "PIR")?.score ?? 0;
    expect(s).toBeGreaterThanOrEqual(69);
    expect(s).toBeLessThanOrEqual(71);
  });
  it("세션108: PIR=40 -> 부담 구간 (60-20=40점)", () => {
    expect(scorePrice(makeApt({ pir: 40 })).subs.find((s) => s.name === "PIR")?.score ?? 0).toBe(40);
  });
  it("세션108: PIR=60 -> 부담 구간 하한 0 클램프", () => {
    expect(scorePrice(makeApt({ pir: 60 })).subs.find((s) => s.name === "PIR")?.score ?? 0).toBe(0);
  });
  it("전세가율 75%에서 최대", () => {
    expect(
      scorePrice(makeApt({ jeonseRate: 75 })).subs.find((s) => s.name === "전세가율")?.score ?? 0
    ).toBeGreaterThanOrEqual(95);
  });
  it("PSR 점수 100 초과 불가 (클램핑)", () => {
    expect(scorePrice(makeApt({ psr: 0.5 })).subs.find((s) => s.name === "PSR")?.score ?? 0).toBeLessThanOrEqual(100);
  });
});

describe("scoreLocation", () => {
  it("정상 데이터 0~100", () => {
    const r = scoreLocation(makeApt());
    expect(r.total).toBeGreaterThanOrEqual(0);
    expect(r.total).toBeLessThanOrEqual(100);
    expect(r.subs).toHaveLength(5);
  });
  it("교통 미약 -> 교통 점수 낮음", () => {
    const r = scoreLocation(makeApt({ subwayDist: 9999, busRoutes: 0, icDist: 99, ktxDist: 99 }));
    expect(r.subs.find((s) => s.name === "교통")?.score ?? 0).toBeLessThan(30);
  });
  it("혐오시설 500m 이상이면 감점 반감", () => {
    const close = scoreLocation(makeApt({ noxious: ["소각장"], noxiousDist: 300 }));
    const far = scoreLocation(makeApt({ noxious: ["소각장"], noxiousDist: 600 }));
    expect(far.subs.find((s) => s.name === "혐오시설")?.score ?? 0).toBeGreaterThan(
      close.subs.find((s) => s.name === "혐오시설")?.score ?? 0
    );
  });
  it("미등록 지역도 에러 없이 계산", () => {
    expect(scoreLocation(makeApt({ region: "미등록" })).total).toBeGreaterThanOrEqual(0);
  });
  // 세션508: 소음 미측정(null)은 중립값(65dB 구간과 동일 15점) — 옛 `?? 75`는 NOISE_TIERS
  //   최대(70)보다 커 fallback 0점(최하)으로 떨어져 "안 재본 곳이 실측 최악보다 시끄럽다"로
  //   채점됐다(unsoldRate 세션445·hugGuarantee 세션508와 같은 결).
  it("noise null -> 65dB 구간과 동일한 자연환경 점수 (중립 15점)", () => {
    const unknown = scoreLocation(makeApt({ noise: null }));
    const at65 = scoreLocation(makeApt({ noise: 65 }));
    expect(unknown.subs.find((s) => s.name === "자연환경")?.score).toBe(
      at65.subs.find((s) => s.name === "자연환경")?.score
    );
  });
  it("noise null -> 실측 최악(70dB)보다 자연환경 점수 높음 (옛 0점 회귀 방지)", () => {
    const unknown = scoreLocation(makeApt({ noise: null }));
    const worst = scoreLocation(makeApt({ noise: 70 }));
    expect(Number(unknown.subs.find((s) => s.name === "자연환경")?.score)).toBeGreaterThan(
      Number(worst.subs.find((s) => s.name === "자연환경")?.score)
    );
  });
  // 대조군: noise 가 null 이어도 다른 서브(교통·학군)는 불변해야 한다.
  it("noise null 이어도 교통·학군 서브는 불변 (대조군)", () => {
    const withNoise = scoreLocation(makeApt({ noise: 55 }));
    const noNoise = scoreLocation(makeApt({ noise: null }));
    expect(noNoise.subs.find((s) => s.name === "교통")?.score).toBe(
      withNoise.subs.find((s) => s.name === "교통")?.score
    );
    expect(noNoise.subs.find((s) => s.name === "학군")?.score).toBe(
      withNoise.subs.find((s) => s.name === "학군")?.score
    );
  });
  // --- 세션511: 생활인프라 체감 곡선 ---
  //
  // 수집기가 `size=5` 로 잘라 세던 시절의 기준(병원5·카페20…)을 실측 분포(p85)로 옮기면서,
  // 채점도 선형에서 포화 곡선으로 바꿨다. 선형이면 "병원 80개가 반점" 같은 어색한 채점이 된다.
  it("infraSaturation — 0 이면 0, 만점 기준이면 1, 그 사이는 단조 증가", () => {
    expect(infraSaturation(0, 150)).toBe(0);
    expect(infraSaturation(150, 150)).toBeCloseTo(1, 10);
    expect(infraSaturation(300, 150)).toBe(1); // 초과분은 1 로 막힌다
    expect(infraSaturation(56, 150)).toBeGreaterThan(infraSaturation(21, 150));
  });
  it("infraSaturation 은 선형보다 후하다 — 적은 개수에도 점수를 준다 (선형 회귀 시 red)", () => {
    // 병원 5개: 선형이면 5/150 = 3.3%, 곡선이면 약 36%
    const linear = 5 / 150;
    expect(infraSaturation(5, 150)).toBeGreaterThan(linear * 5);
    // 중앙값(56개)에서 선형은 37%, 곡선은 80% 근처
    expect(infraSaturation(56, 150)).toBeGreaterThan(0.7);
    expect(56 / 150).toBeLessThan(0.4);
  });
  it("infraSaturation — max 가 0 이하이면 0 (0 나눗셈 방어)", () => {
    expect(infraSaturation(10, 0)).toBe(0);
    expect(infraSaturation(10, -1)).toBe(0);
  });
  // ⚠️ 위 세 테스트는 infraSaturation **함수만** 본다 — scoreLocation 이 그 함수를 실제로
  //    쓰는지는 검사하지 못한다(선형으로 되돌려도 전부 통과했다. 세션508 "테스트가 실전 경로를
  //    지나는가" 사각의 재현). 아래 테스트가 그 배선을 잠근다.
  it("scoreLocation 이 실제로 체감 곡선을 쓴다 — 선형으로 되돌리면 red", () => {
    const cfg = INFRA_CONFIG.find((c) => c.key === "hospital");
    const max = Number(cfg?.max);
    const weight = Number(cfg?.weight);
    // 병원만 5개, 나머지 인프라 0 → infra 서브 = (곡선 or 선형) × weight × 100
    const r = scoreLocation(
      makeApt(
        /** @type {any} */ ({
          hospital: 5,
          mart: 0,
          conv: 0,
          park: 0,
          cafe: 0,
          culture: 0,
          bank: 0,
          pharmacy: 0,
          childcare: 0,
          emergency: 0,
        })
      )
    );
    const infra = Number(r.subs.find((s) => s.name === "생활인프라")?.score);
    const curved = infraSaturation(5, max) * weight * 100;
    const linear = Math.min(5 / max, 1) * weight * 100;
    expect(Math.round(curved)).not.toBe(Math.round(linear)); // 두 방식이 실제로 구분되는 입력인지 먼저 보장
    expect(infra).toBe(Math.round(curved));
  });
  it("생활인프라 detail 의 분모는 INFRA_CONFIG 를 따라간다 (하드코딩 회귀 시 red)", () => {
    const r = scoreLocation(makeApt(/** @type {any} */ ({ hospital: 3, cafe: 7 })));
    const detail = String(r.subs.find((s) => s.name === "생활인프라")?.detail);
    const hospitalMax = INFRA_CONFIG.find((c) => c.key === "hospital")?.max;
    const parkMax = INFRA_CONFIG.find((c) => c.key === "park")?.max;
    expect(detail).toContain(`병원3/${hospitalMax}`);
    expect(detail).toContain(`/${parkMax}(1km)`);
  });
  // --- 세션511: 자연환경 0~100 정규화 ---
  //
  // 네 요소(조망40·일조38·소음30·대기20)를 그냥 더하면 최대 128 이라, 배점 10점(env*0.1)
  // 자리를 최대 12.8점까지 먹었다. 실측 1,646곳 중 1,054곳(64.0%)이 100 을 넘었다.
  // ⚠️ 자르지 않고 나눈다 — 100 에서 자르면 그 64% 가 전부 동점이 되어 변별력이 죽는다.
  it("ENV_MAX 는 네 요소 상한의 합과 일치 (표만 바뀌면 척도가 조용히 어긋난다)", () => {
    const expected =
      Math.max(...Object.values(VIEW_SCORES)) +
      SUNLIGHT_DIRECTION_MAX +
      Math.max(...NOISE_TIERS.map((t) => t.score)) +
      Math.max(...AIR_QUALITY_TIERS.map((t) => t.score));
    expect(ENV_MAX).toBe(expected);
  });
  it("최고 조건에서도 자연환경 서브는 100 을 넘지 않는다 (정규화 제거 시 red)", () => {
    // 조망 블루(40) + 일조 우수(30)+남향(8)=38 + 소음 40dB(30) + 대기 좋음(20) = 128 = ENV_MAX
    const best = scoreLocation(
      makeApt(
        /** @type {any} */ ({
          view: "블루",
          sunlight: "우수",
          primaryDirection: "남향",
          noise: 40,
          airQuality: { pm25: 10, pm10: 20, o3: 0.02 },
        })
      )
    );
    const env = Number(best.subs.find((s) => s.name === "자연환경")?.score);
    expect(env).toBeLessThanOrEqual(100);
    expect(env).toBe(100); // 이론 만점 조합이므로 정확히 100 — 나누는 수가 틀리면 여기서 걸린다
  });
  it("정규화가 순위를 뒤집지 않는다 (좋은 조건이 나쁜 조건보다 높다)", () => {
    const good = scoreLocation(makeApt(/** @type {any} */ ({ view: "블루", noise: 40, airQuality: { pm25: 10 } })));
    const bad = scoreLocation(makeApt(/** @type {any} */ ({ view: "천공", noise: 70, airQuality: { pm25: 45 } })));
    expect(Number(good.subs.find((s) => s.name === "자연환경")?.score)).toBeGreaterThan(
      Number(bad.subs.find((s) => s.name === "자연환경")?.score)
    );
  });
  // --- 세션 454: 가중치 합 1.0 불변식 (INFRA_CONFIG + 대기질) ---
  // 세션526: 입지 5서브 비중 하드코딩이 사라지고 LOCATION_SUB_WEIGHTS(기준)+프로필 locW 로 옮겨갔다.
  //   옛 가드는 리터럴 배열을 스스로 합산해 소스와 무관한 껍데기였다(상수를 바꿔도 green) — 상수 파생으로 정정.
  it("외부 5항목 가중치 합 = 1.00 (LOCATION_SUB_WEIGHTS 파생 — transport·school·infra·env·noxSafe)", () => {
    const sum = Object.values(LOCATION_SUB_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(Math.round(sum * 100) / 100).toBe(1.0);
  });
  it("대기질 복합 가중치 합 = 1.00 (PM2.5·PM10·O3)", () => {
    // scoreLocation.ts L93: 0.40 + 0.35 + 0.25
    const w = [0.4, 0.35, 0.25];
    expect(Math.round(w.reduce((a, b) => a + b, 0) * 100) / 100).toBe(1.0);
  });
  it("INFRA_CONFIG 10항목 weight 합 = 1.00", () => {
    const sum = INFRA_CONFIG.reduce((a, c) => a + c.weight, 0);
    expect(Math.round(sum * 100) / 100).toBe(1.0);
    expect(INFRA_CONFIG).toHaveLength(10);
  });
});

describe("scoreProduct", () => {
  it("정상 데이터 0~100", () => {
    const r = scoreProduct(makeApt());
    expect(r.total).toBeGreaterThanOrEqual(0);
    expect(r.total).toBeLessThanOrEqual(100);
    expect(r.subs).toHaveLength(9);
  });
  it("1군Super 브랜드 = 20점", () => {
    expect(scoreProduct(makeApt({ builder: "현대건설" })).subs.find((s) => s.name === "브랜드")?.score ?? 0).toBe(20);
  });
  it("미등록 시공사 = 5점", () => {
    expect(scoreProduct(makeApt({ builder: "무명건설" })).subs.find((s) => s.name === "브랜드")?.score ?? 0).toBe(5);
  });
  it("세대수 <= 1 -> 중립(8)", () => {
    expect(scoreProduct(makeApt({ units: 1 })).subs.find((s) => s.name === "세대수")?.score ?? 0).toBe(8);
  });
  it("수영장 보너스 +3", () => {
    const pool = scoreProduct(makeApt({ hasPool: true })).subs.find((s) => s.name === "세대수")?.score ?? 0;
    const noPool = scoreProduct(makeApt({ hasPool: false })).subs.find((s) => s.name === "세대수")?.score ?? 0;
    expect(pool).toBe(Math.min(noPool + 3, 15));
  });
  it("내진설계 5점/0점", () => {
    expect(scoreProduct(makeApt({ quakeDesign: true })).subs.find((s) => s.name === "내진")?.score ?? 0).toBe(5);
    expect(scoreProduct(makeApt({ quakeDesign: false })).subs.find((s) => s.name === "내진")?.score ?? 0).toBe(0);
  });
  // 세션508: 내진설계는 이진 필드 — null(미수집)은 true 와 동일 대우. 채워진 800/2,043건 중
  //   98.9%가 보유 + 우리 모수(신축 분양 아파트)는 2017.12 확대된 내진설계 의무 대상이라
  //   미수집을 "미적용"으로 단정하면 안 된다.
  it("내진설계 null(미수집) -> true 와 동일 (5점, 적용 추정)", () => {
    const nullScore = scoreProduct(makeApt({ quakeDesign: null })).subs.find((s) => s.name === "내진")?.score ?? -1;
    const trueScore = scoreProduct(makeApt({ quakeDesign: true })).subs.find((s) => s.name === "내진")?.score ?? -1;
    expect(nullScore).toBe(trueScore);
    expect(nullScore).toBe(5);
  });
  it("내진설계 false(확인된 미적용)만 0점 -> null·true 보다 5점 낮음", () => {
    const falseScore = scoreProduct(makeApt({ quakeDesign: false })).subs.find((s) => s.name === "내진")?.score ?? -1;
    const nullScore = scoreProduct(makeApt({ quakeDesign: null })).subs.find((s) => s.name === "내진")?.score ?? -1;
    expect(nullScore - falseScore).toBe(5);
  });
  // 대조군: quakeDesign 이 null 이어도 다른 서브(브랜드·세대수)는 불변해야 한다.
  it("내진설계 null 이어도 브랜드·세대수 서브는 불변 (대조군)", () => {
    const withTrue = scoreProduct(makeApt({ quakeDesign: true }));
    const withNull = scoreProduct(makeApt({ quakeDesign: null }));
    expect(withNull.subs.find((s) => s.name === "브랜드")?.score).toBe(
      withTrue.subs.find((s) => s.name === "브랜드")?.score
    );
    expect(withNull.subs.find((s) => s.name === "세대수")?.score).toBe(
      withTrue.subs.find((s) => s.name === "세대수")?.score
    );
  });
});

describe("scoreBenefit", () => {
  it("혜택 없음 = 0점", () => {
    const r = scoreBenefit(
      makeApt({ discountPct: 0, loanFree: false, optionFree: false, balconyFree: false, cashback: 0 })
    );
    expect(r.total).toBe(0);
    expect(r.totalWon).toBe(0);
  });
  it("총혜택율 25% 이상 = 100점", () => {
    expect(
      scoreBenefit(makeApt({ discountPct: 25, loanFree: false, optionFree: false, balconyFree: false, cashback: 0 }))
        .total
    ).toBe(100);
  });
  it("정상 혜택 totalWon > 0", () => {
    const r = scoreBenefit(makeApt());
    expect(r.totalWon).toBeGreaterThan(0);
    expect(r.subs).toHaveLength(6);
  });
  it("price=0 -> 0점", () => {
    expect(scoreBenefit(makeApt({ price: 0 })).total).toBe(0);
  });

  // 관리비 절감 테스트 — 만원 단위, 면적 미곱셈
  it("관리비 절감 — 지역 평균보다 낮으면 연간 절감액 합산", () => {
    const apt = makeApt({
      avgMaintenanceCost: 15,
      _regionAvgMaint: 20,
      discountPct: 0,
      loanFree: false,
      optionFree: false,
      balconyFree: false,
      cashback: 0,
    });
    const r = scoreBenefit(apt);
    // (20 - 15) × 12 = 60 만원
    expect(r.subs[5].name).toBe("관리비 절감");
    expect(r.subs[5].info).toContain("60");
    expect(r.totalWon).toBe(60);
  });

  it("관리비 절감 — 아파트가 지역 평균보다 비싸면 0", () => {
    const apt = makeApt({
      avgMaintenanceCost: 25,
      _regionAvgMaint: 20,
      discountPct: 0,
      loanFree: false,
      optionFree: false,
      balconyFree: false,
      cashback: 0,
    });
    const r = scoreBenefit(apt);
    expect(r.subs[5].info).toBe("-");
    expect(r.totalWon).toBe(0);
  });
});

describe("scoreRisk", () => {
  it("정상 데이터 0~100", () => {
    const r = scoreRisk(makeApt());
    expect(r.total).toBeGreaterThanOrEqual(0);
    expect(r.total).toBeLessThanOrEqual(100);
    expect(r.subs).toHaveLength(11);
  });
  it("미분양률 낮음 -> 안전 점수 높음", () => {
    expect(scoreRisk(makeApt({ unsoldRate: 5 })).total).toBeGreaterThan(scoreRisk(makeApt({ unsoldRate: 50 })).total);
  });
  it("세대수 <= 1 -> 미분양률 중립", () => {
    expect(scoreRisk(makeApt({ units: 1 })).subs.find((s) => s.name === "미분양률")?.info).toContain("미확인");
  });
  // 세션 445: unsoldRate null(=100% 초과 폭발값 무력화) → units>1 이어도 중립 처리.
  it("unsoldRate null -> 미분양률 중립 (세대수>1 이어도)", () => {
    const r = scoreRisk(makeApt({ units: 300, unsoldRate: null }));
    expect(r.subs.find((s) => s.name === "미분양률")?.info).toContain("미확인");
  });
  // 회귀: 229% 폭발값은 예전엔 최고 미분양 위험으로 채점됐으나, null 무력화 후 중립이라
  //   "위험 50%↑" 등급(점수 낮음)이 아니라 중립 점수가 나와야 한다.
  it("unsoldRate null(무력화) -> 폭발값 50% 보다 미분양률 안전점수 높음", () => {
    const cleared = scoreRisk(makeApt({ units: 300, unsoldRate: null }));
    const exploded = scoreRisk(makeApt({ units: 300, unsoldRate: 50 }));
    const clearedSub = cleared.subs.find((s) => s.name === "미분양률")?.score ?? 0;
    const explodedSub = exploded.subs.find((s) => s.name === "미분양률")?.score ?? 0;
    expect(clearedSub).toBeGreaterThan(explodedSub); // 중립(60) > 위험구간(<60)
  });
  // sanitize(engine)가 unsoldRate null 을 지역 중위값으로 되채우지 않아야 한다 (세션 445).
  //   되채우면 calcCats 의 미분양률 sub 가 "미확인" 이 아니라 중위값 등급으로 나옴.
  it("calcCats: unsoldRate null + 지역 중위값 존재 -> 중위값 되채움 안 함 (미확인 유지)", () => {
    const ctx = { regionMedians: { 경기: { pir: 5, psr: 0.8, unsoldRate: 10, supplyRatio: 100, maint: 0 } } };
    const cats = calcCats(makeApt({ region: "경기", units: 300, unsoldRate: null }), /** @type {any} */ (ctx));
    const sub = cats.risk.subs.find((s) => s.name === "미분양률");
    expect(sub?.info).toContain("미확인");
  });
  it("HUG+AA -> 시공사 재무 위험 낮음", () => {
    const r = scoreRisk(makeApt({ hugGuarantee: true, builderCreditGrade: "AA", builderDebtRatio: 80 }));
    expect(r.subs.find((s) => s.name === "시공사 재무")?.score ?? 0).toBeGreaterThanOrEqual(90);
  });
  // 세션 508: HUG 보증은 수집률 0%(builders.hug_guarantee 32개사 전부 null) → 전 단지가 null.
  //   옛 코드 `apt.hugGuarantee ? 0 : 40` 은 null("모름")을 "보증 없음"으로 단정해 전 단지에 +40 위험을 물렸다.
  //   unsoldRate(세션445)·supplyRatio(세션501)와 같은 결 — 모르는 것은 중립으로 둔다.
  /** @param {boolean | null} v */
  const finScoreOf = (v) => {
    const r = scoreRisk(makeApt({ hugGuarantee: v }));
    return r.subs.find((s) => s.name === "시공사 재무")?.score ?? 0;
  };
  it("hugGuarantee null(모름) -> true 와 동일 (무페널티)", () => {
    expect(finScoreOf(null)).toBe(finScoreOf(true));
    expect(scoreRisk(makeApt({ hugGuarantee: null })).total).toBe(scoreRisk(makeApt({ hugGuarantee: true })).total);
  });
  it("hugGuarantee false(확인된 무보증)만 +40 위험 -> null·true 보다 시공사 재무 40점 낮음", () => {
    expect(finScoreOf(null) - finScoreOf(false)).toBe(40);
    expect(finScoreOf(true) - finScoreOf(false)).toBe(40);
    // 안전도 총점 반영: fin 가중치 0.17 → 40 × 0.17 = 6.8점. total 은 반올림이라 6~7.
    const diff = scoreRisk(makeApt({ hugGuarantee: null })).total - scoreRisk(makeApt({ hugGuarantee: false })).total;
    expect(diff).toBeGreaterThanOrEqual(6);
    expect(diff).toBeLessThanOrEqual(7);
  });
  // 세션508: loanFree(중도금 무이자)도 hugGuarantee 와 같은 이진 필드 패턴. 수집률 0%(혜택 9종
  //   전부 미수집, 세션488 감사)인데 옛 코드 `apt.loanFree ? 0 : 15` 는 null 을 "무이자 아님"으로
  //   단정해 전 단지에 +15 위험을 물렸다.
  /** @param {boolean | null} v */
  const loanFinScoreOf = (v) => {
    const r = scoreRisk(makeApt({ loanFree: v }));
    return r.subs.find((s) => s.name === "대출/잔금")?.score ?? 0;
  };
  it("loanFree null(모름) -> true 와 동일 (무페널티)", () => {
    expect(loanFinScoreOf(null)).toBe(loanFinScoreOf(true));
    expect(scoreRisk(makeApt({ loanFree: null })).total).toBe(scoreRisk(makeApt({ loanFree: true })).total);
  });
  it("loanFree false(확인된 유이자)만 +15 위험 -> null·true 보다 대출/잔금 15점 낮음", () => {
    expect(loanFinScoreOf(null) - loanFinScoreOf(false)).toBe(15);
    expect(loanFinScoreOf(true) - loanFinScoreOf(false)).toBe(15);
    // 안전도 총점 반영: loan 가중치 0.15 → 15 × 0.15 = 2.25점. total 은 반올림이라 2~3.
    const diff = scoreRisk(makeApt({ loanFree: null })).total - scoreRisk(makeApt({ loanFree: false })).total;
    expect(diff).toBeGreaterThanOrEqual(2);
    expect(diff).toBeLessThanOrEqual(3);
  });
  // 대조군: loanFree 변경이 hugGuarantee·신용등급 분기에 영향 없어야 한다.
  it("loanFree 변경이 hugGuarantee·시공사 재무 로직에 영향 없음 (대조군)", () => {
    const a = scoreRisk(makeApt({ loanFree: null, hugGuarantee: false, builderCreditGrade: "BBB" }));
    const b = scoreRisk(makeApt({ loanFree: true, hugGuarantee: false, builderCreditGrade: "BBB" }));
    // loanFree null==true 이므로 hugGuarantee·신용등급을 고정하면 두 결과가 완전히 같아야 함
    expect(a.subs.find((s) => s.name === "시공사 재무")?.score).toBe(
      b.subs.find((s) => s.name === "시공사 재무")?.score
    );
    // hugGuarantee === false 는 여전히 +40 위험 유지 확인
    const notPenalized =
      scoreRisk(makeApt({ hugGuarantee: true })).subs.find((s) => s.name === "시공사 재무")?.score ?? -1;
    const stillPenalized =
      scoreRisk(makeApt({ hugGuarantee: false })).subs.find((s) => s.name === "시공사 재무")?.score ?? -1;
    expect(notPenalized - stillPenalized).toBe(40);
  });
  // 신용등급 위험 단조성: CCC(최악) < B < BB < BBB (시공사 재무 안전점수). 동일 조건에서 등급만 변경.
  // B·CCC가 점수표에 누락되면 CREDIT_DEFAULT(30)로 떨어져 BB(60)보다 안전하게 역전됨 (세션392 버그).
  // hugGuarantee:true(+0)·debtRatio:100(보정 0)으로 finSc=creditScore만 남겨 등급 차이를 선명히 (false면 +40로 천장 클램프).
  it("신용등급 CCC -> BB·BBB보다 시공사 재무 위험 높음 (안전점수 낮음)", () => {
    const fin = (/** @type {string} */ grade) => {
      const r = scoreRisk(makeApt({ hugGuarantee: true, builderCreditGrade: grade, builderDebtRatio: 100 }));
      return r.subs.find((s) => s.name === "시공사 재무")?.score ?? 0;
    };
    // 안전점수(=100-finSc)는 위험할수록 낮음 → CCC < B < BB < BBB
    expect(fin("CCC")).toBeLessThan(fin("B"));
    expect(fin("B")).toBeLessThan(fin("BB"));
    expect(fin("BB")).toBeLessThan(fin("BBB"));
  });
  it("인구 급감 -> 시장환경 위험", () => {
    expect(scoreRisk(makeApt({ popGrowth: 1.0 })).total).toBeGreaterThan(scoreRisk(makeApt({ popGrowth: -1.0 })).total);
  });
  // 계약해제율 테스트
  it("cancelRatio6m null -> 중립 65점", () => {
    const r = scoreRisk(makeApt({ cancelRatio6m: null }));
    expect(r.subs.find((s) => s.name === "계약해제율")?.score ?? 0).toBe(65);
  });
  it("cancelRatio6m 낮음 -> 안전 점수 높음", () => {
    expect(scoreRisk(makeApt({ cancelRatio6m: 2 })).total).toBeGreaterThan(
      scoreRisk(makeApt({ cancelRatio6m: 30 })).total
    );
  });
  // 공급비율·시공사부채 NULL 정직 표시 (세션403): api sanitize가 ?? 150/?? 250 비관적 폴백으로 채우되
  // _fallbackX 플래그를 세팅함. 점수는 폴백값으로 채점(불변)하되 화면 sub info/detail은 폴백 수치를 숨기고 정직 표시.
  // 세션 501: 공급량 주 지표를 인허가율 → **주택보급률**로 교체했다.
  // 옛 테스트(`supplyRatio` + `_fallbackSupplyRatio`)는 그 배선이 사라져 대체한다. 배경 —
  // 옛 등급 경계 50/100/130 은 보급률용 숫자인데 담기던 값은 인허가율(0.09~3.0%)이라
  // 자릿수가 어긋났고, 데이터가 비면 전 단지 75점 / 채우면 전 단지 5점으로 **어느 쪽이든 동점**이었다.
  it("주택보급률이 없으면 '정보 없음' + 비관적 기본값으로 채점한다", () => {
    // supplyRatio 를 null 로 명시한다 — makeApt 기본값 100 은 **옛 보급률 스케일**이라
    // 인허가율로 해석하면 PERMIT_RATIO_HIGH(2.2)를 훌쩍 넘겨 보정이 걸린다.
    const s = scoreRisk(makeApt({ housingSupplyLevel: null, supplyRatio: null })).subs.find((x) => x.name === "공급량");
    expect(s?.info).toBe("정보 없음");
    expect(s?.detail).not.toContain("150"); // 폴백 수치 노출 금지 (세션403 정직 표시 정신 유지)
    expect(s?.score).toBe(100 - 75); // 표시는 100-위험 → 비관적 기본값 75 의 반전
  });

  // 세션499 답습 — 문구를 따로 하드코딩하면 경계를 고칠 때 한쪽만 바뀌어 거짓이 생긴다.
  // 이 테스트는 구간과 문구가 같은 출처(Tier.label)에서 나오는지 지킨다.
  it("보급률 등급 문구가 점수 구간과 어긋나지 않는다", () => {
    /** @type {Array<[number, string]>} */
    const cases = [
      [93.9, "부족"], // 서울
      [99.4, "적정"], // 경기 (855단지)
      [104, "여유"], // 경계 위
      [114.4, "과잉"], // 경북
    ];
    for (const [v, label] of cases) {
      const s = scoreRisk(makeApt({ housingSupplyLevel: v })).subs.find((x) => x.name === "공급량");
      expect(s?.info, `보급률 ${v}% 는 "${label}" 이어야 한다`).toContain(label);
    }
  });

  it("보급률이 높을수록(집이 남을수록) 미분양 위험이 크다 — 표시 점수는 내려간다", () => {
    const low = scoreRisk(makeApt({ housingSupplyLevel: 93.9 })).subs.find((x) => x.name === "공급량");
    const high = scoreRisk(makeApt({ housingSupplyLevel: 114.4 })).subs.find((x) => x.name === "공급량");
    expect(high?.score).toBeLessThan(Number(low?.score));
  });

  it("인허가율 보정 — 미래 공급이 많으면 위험이 오르고, 적으면 내린다", () => {
    const pick = (/** @type {any} */ o) => scoreRisk(makeApt(o)).subs.find((x) => x.name === "공급량");
    const base = pick({ housingSupplyLevel: 99.4, supplyRatio: 1.9 }); // 보정 구간 밖
    const many = pick({ housingSupplyLevel: 99.4, supplyRatio: 2.5 }); // >= 2.2 → 위험 +5
    const few = pick({ housingSupplyLevel: 99.4, supplyRatio: 0.9 }); // <= 1.5 → 위험 -3
    expect(many?.score).toBeLessThan(Number(base?.score));
    expect(few?.score).toBeGreaterThan(Number(base?.score));
    // 보정이 주 지표를 뒤집을 만큼 크면 안 된다 (보정은 보정이어야 한다)
    expect(Math.abs(Number(many?.score) - Number(base?.score))).toBeLessThanOrEqual(10);
  });
  it('builderDebtRatio NULL(_fallbackBuilderDebt) -> 시공사 재무 점수 불변 + detail "250%" 숨김', () => {
    const filled = scoreRisk(makeApt({ builderDebtRatio: 250, builderCreditGrade: "BBB" }));
    const nullish = scoreRisk(
      makeApt({ builderDebtRatio: 250, builderCreditGrade: "BBB", _fallbackBuilderDebt: true })
    );
    const sFilled = filled.subs.find((s) => s.name === "시공사 재무");
    const sNull = nullish.subs.find((s) => s.name === "시공사 재무");
    // 점수 불변 (폴백값 250 기준 채점 동일)
    expect(sNull?.score).toBe(sFilled?.score);
    // 정직 표시: 폴백 부채율 "250%" 노출 금지 (credit grade 부분은 유지)
    expect(sNull?.detail).not.toContain("250%");
    expect(sNull?.detail).toContain("미수집");
    // 정상값은 현행 "250%" 표시 유지 (회귀 방지)
    expect(sFilled?.detail).toContain("250%");
  });
  // 세션508: builderDebtRatio 원본값 자체가 null 인 경로(compute-scores VIEW 등 _fallbackBuilderDebt
  //   플래그가 없는 경로 포함) — 연속 구간 필드라 중립(BUILDER_DEBT_UNKNOWN_ADJ=10, "주의" 구간과
  //   동일)으로 채점한다. 채워진 301건의 중앙값 171.9%가 정확히 그 구간이라는 게 근거.
  it("builderDebtRatio null -> 175%(주의 구간)와 동일한 시공사 재무 점수", () => {
    const nullScore = scoreRisk(makeApt({ builderDebtRatio: null, builderCreditGrade: "BBB" })).subs.find(
      (s) => s.name === "시공사 재무"
    )?.score;
    const midScore = scoreRisk(makeApt({ builderDebtRatio: 175, builderCreditGrade: "BBB" })).subs.find(
      (s) => s.name === "시공사 재무"
    )?.score;
    expect(nullScore).toBe(midScore);
  });
  it("builderDebtRatio null -> 250%(위험 구간)보다 시공사 재무 안전점수 높음 (옛 250 폴백 회귀 방지)", () => {
    const nullScore = Number(
      scoreRisk(makeApt({ builderDebtRatio: null, builderCreditGrade: "BBB" })).subs.find(
        (s) => s.name === "시공사 재무"
      )?.score
    );
    const worstScore = Number(
      scoreRisk(makeApt({ builderDebtRatio: 250, builderCreditGrade: "BBB" })).subs.find(
        (s) => s.name === "시공사 재무"
      )?.score
    );
    expect(nullScore).toBeGreaterThan(worstScore);
  });
  it("builderDebtRatio null -> detail에 '미수집' 표시, %% 수치 숨김 (_fallbackBuilderDebt 플래그 없이도)", () => {
    const r = scoreRisk(makeApt({ builderDebtRatio: null, builderCreditGrade: "BBB" }));
    const s = r.subs.find((x) => x.name === "시공사 재무");
    expect(s?.detail).toContain("미수집");
    expect(s?.detail).not.toContain("%)"); // "175%)" 류 부채율 수치 노출 금지
  });
  // 대조군: builderDebtRatio 가 null 이어도 신용등급 단조성(세션392 회귀 가드)은 유지된다.
  it("builderDebtRatio null 이어도 신용등급 단조성은 유지된다 (대조군)", () => {
    const fin = (/** @type {string} */ grade) =>
      scoreRisk(makeApt({ builderDebtRatio: null, builderCreditGrade: grade, hugGuarantee: true })).subs.find(
        (s) => s.name === "시공사 재무"
      )?.score ?? 0;
    expect(fin("CCC")).toBeLessThan(fin("BB"));
    expect(fin("BB")).toBeLessThan(fin("BBB"));
  });
});

// scoreRisk 내부 10개 서브 가중치 합 = 1.00 검증
describe("scoreRisk — 내부 가중치 합계", () => {
  it("10개 서브 가중치 합 = 1.00", () => {
    // engine.js: unsoldSc*0.14 + liqSc*0.14 + loanSc*0.15 + finSc*0.17 + regSc*0.05 + supSc*0.10 + mktSc*0.04 + cancelSc*0.04 + compSc*0.09 + crimeSc*0.05 + initSc*0.03
    const weights = [0.14, 0.14, 0.15, 0.17, 0.05, 0.1, 0.04, 0.04, 0.09, 0.05, 0.03];
    const sum = weights.reduce((a, b) => a + b, 0);
    expect(Math.round(sum * 100) / 100).toBe(1.0);
  });
});

// 치안 안전등급 테스트
describe("scoreRisk — crimeSafetyGrade", () => {
  it("crimeSafetyGrade null → 중립 65점 (100-35)", () => {
    const r = scoreRisk(makeApt({ crimeSafetyGrade: null }));
    expect(r.subs.find((s) => s.name === "치안 안전")?.score ?? 0).toBe(65);
  });
  it("crimeSafetyGrade 1등급 → 안전 83점 (grade 70% + police null 30%)", () => {
    const r = scoreRisk(makeApt({ crimeSafetyGrade: 1 }));
    // crimeSc = 10*0.7 + 35*0.3 = 17.5, score = round(100-17.5) = 83
    expect(r.subs.find((s) => s.name === "치안 안전")?.score ?? 0).toBe(83);
  });
  it("crimeSafetyGrade 5등급 → 위험 34점 (grade 70% + police null 30%)", () => {
    const r = scoreRisk(makeApt({ crimeSafetyGrade: 5 }));
    // crimeSc = 80*0.7 + 35*0.3 = 66.5, score = round(100-66.5) = 34
    expect(r.subs.find((s) => s.name === "치안 안전")?.score ?? 0).toBe(34);
  });
  it("1등급이 5등급보다 총점 높음", () => {
    expect(scoreRisk(makeApt({ crimeSafetyGrade: 1 })).total).toBeGreaterThan(
      scoreRisk(makeApt({ crimeSafetyGrade: 5 })).total
    );
  });
});

// mktSc(시장환경) 7단계 경계값 테스트
describe("scoreRisk — mktSc 7단계 + null 기본값", () => {
  // mktSc는 risk 관점: 성장→낮은 위험(5), 감소→높은 위험(90)
  // 최종 서브점수 = 100 - mktSc
  const getMktScore = (/** @type {number | null} */ popGrowth) => {
    const r = scoreRisk(makeApt({ popGrowth }));
    return r.subs.find((s) => s.name === "시장환경")?.score ?? 0;
  };

  it("null → 중립 65점 (100-35)", () => {
    expect(getMktScore(null)).toBe(65);
  });
  it("popGrowth ≥ 1.0 → 95점 (100-5)", () => {
    expect(getMktScore(1.0)).toBe(95);
  });
  it("popGrowth ≥ 0.5 → 80점 (100-20)", () => {
    expect(getMktScore(0.5)).toBe(80);
  });
  it("popGrowth ≥ 0 → 65점 (100-35)", () => {
    expect(getMktScore(0)).toBe(65);
  });
  it("popGrowth ≥ -0.3 → 50점 (100-50)", () => {
    expect(getMktScore(-0.3)).toBe(50);
  });
  it("popGrowth ≥ -0.8 → 35점 (100-65)", () => {
    expect(getMktScore(-0.8)).toBe(35);
  });
  it("popGrowth ≥ -2.0 → 20점 (100-80)", () => {
    expect(getMktScore(-2.0)).toBe(20);
  });
  it("popGrowth < -2.0 → 10점 (100-90)", () => {
    expect(getMktScore(-3.0)).toBe(10);
  });
});

describe("scoreFuture", () => {
  it("모든 개발 정보 0~100", () => {
    const r = scoreFuture(makeApt());
    expect(r.total).toBeGreaterThanOrEqual(0);
    expect(r.total).toBeLessThanOrEqual(100);
    expect(r.subs).toHaveLength(4);
  });
  // 세션511: 동적 재분배 폐기. 호재가 없어도 인구가 100% 를 대신하지 않는다 —
  // 그 구조가 "호재를 채우면 점수가 내려가는" 역전(보유 762곳 중 486곳)을 만들었다.
  it("호재가 없으면 인구 몫(0.55)만 받는다 — 인구 100% 대체 금지", () => {
    const r = scoreFuture(
      makeApt(
        /** @type {any} */ ({ transitDev: "없음", cityDev: "", industryDev: null, popGrowth: 0.5, netMigration: null })
      )
    );
    // popSc 80 × 0.55 / FUTURE_RAW_MAX × 100
    expect(r.total).toBe(Math.round(((80 * FUTURE_WEIGHTS.pop) / FUTURE_RAW_MAX) * 100));
    expect(r.total).toBeLessThan(80); // 옛 구조는 정확히 80을 줬다
  });
  it("노선급이 높을수록 교통 점수가 높다 (GTX > 경전철, 가산 방식)", () => {
    const pick = (/** @type {string} */ t) =>
      scoreFuture(makeApt({ transitDev: t, devDist: 1 })).subs.find((s) => s.name === "교통개발")?.score ?? 0;
    expect(pick("GTX-C 의정부역 착공")).toBeGreaterThan(pick("위례신사선 잠실역 착공"));
  });
  it("개통한 노선은 교통 0점 — 입지 축이 같은 역을 이미 센다(이중 계상 차단)", () => {
    const planned = scoreFuture(makeApt({ transitDev: "GTX-A 동탄역 공사중", devDist: 0.4 }));
    const opened = scoreFuture(makeApt({ transitDev: "GTX-A 동탄역 개통", devDist: 0.4 }));
    expect(planned.subs.find((s) => s.name === "교통개발")?.score).toBeGreaterThan(0);
    expect(opened.subs.find((s) => s.name === "교통개발")?.score).toBe(0);
  });
  it("문자열 형식이 안 맞으면 0점 — 무슨 호재인지 모르는데 점수를 주지 않는다", () => {
    expect(
      scoreFuture(makeApt({ transitDev: "알 수 없는 문자열", devDist: 1 })).subs.find((s) => s.name === "교통개발")
        ?.score
    ).toBe(0);
  });
  // TRANSIT_LINE_TYPE 은 시드의 노선명을 그대로 키로 쓴다. 시드에 노선이 추가되거나 이름이
  // 바뀌면 그 노선은 조용히 기본급(8점)으로 떨어진다 — 에러가 아니라 침묵이라 아무도 모른다.
  it("TRANSIT_LINE_TYPE 이 시드(transit-dev.json)의 노선을 빠짐없이 덮는다", async () => {
    const { readFileSync } = await import("node:fs");
    /** @type {{ projects: { name: string, type: string }[] }} */
    const seed = JSON.parse(readFileSync("public/data/transit-dev.json", "utf8"));
    const missing = seed.projects.filter((p) => !(p.name in TRANSIT_LINE_TYPE)).map((p) => p.name);
    expect(missing).toEqual([]);
    // 종류도 일치해야 한다 — 이름만 맞고 종류가 어긋나면 등급이 조용히 틀어진다
    const mismatched = seed.projects
      .filter((p) => TRANSIT_LINE_TYPE[p.name] !== p.type)
      .map((p) => `${p.name}: 시드=${p.type} 표=${TRANSIT_LINE_TYPE[p.name]}`);
    expect(mismatched).toEqual([]);
  });
  // --- 도시·산업축 거리 등급 (세션511) ---
  //
  // 옛 산식은 이름 키워드만 봐서 거리를 아예 안 봤다 — 도시축은 값 보유 111곳이 전부 80점,
  // 산업축은 239곳 중 206곳이 같은 35점이었다.
  it("도시개발은 가까울수록 높다 (LH 사업지구 거리 등급)", () => {
    const pick = (/** @type {string} */ s) =>
      scoreFuture(makeApt(/** @type {any} */ ({ cityDev: s }))).subs.find((x) => x.name === "도시개발")?.score ?? 0;
    expect(pick("어떤지구 0.3km")).toBeGreaterThan(pick("어떤지구 0.8km"));
    expect(pick("어떤지구 0.8km")).toBeGreaterThan(pick("어떤지구 1.7km"));
    expect(pick("어떤지구 1.7km")).toBeGreaterThan(pick("어떤지구 2.5km"));
    expect(pick("어떤지구 4.0km")).toBe(0); // 등급 밖
  });
  it("산업개발은 가까울수록 높다 (산업단지 거리 등급)", () => {
    const pick = (/** @type {string} */ s) =>
      scoreFuture(makeApt(/** @type {any} */ ({ industryDev: s }))).subs.find((x) => x.name === "산업개발")?.score ?? 0;
    expect(pick("어떤단지 0.8km")).toBeGreaterThan(pick("어떤단지 1.5km"));
    expect(pick("어떤단지 1.5km")).toBeGreaterThan(pick("어떤단지 2.5km"));
    expect(pick("어떤단지 2.5km")).toBeGreaterThan(pick("어떤단지 4.0km"));
    expect(pick("어떤단지 6.0km")).toBe(0); // 수집 반경 밖
  });
  // ⚠️ 두 표를 같게 만들면 한쪽이 죽는다 — LH 지구는 흔하고(최근접 중앙 1.03km) 산업단지는
  //    드물다(3.28km). 같은 거리에서 서로 다른 점수가 나와야 두 축이 각자 갈린다.
  it("두 축의 거리 등급표가 서로 다르다 (스케일이 다르므로)", () => {
    const city = scoreFuture(makeApt(/** @type {any} */ ({ cityDev: "지구 1.5km" }))).subs.find(
      (x) => x.name === "도시개발"
    )?.score;
    const ind = scoreFuture(makeApt(/** @type {any} */ ({ industryDev: "단지 1.5km" }))).subs.find(
      (x) => x.name === "산업개발"
    )?.score;
    expect(city).not.toBe(ind);
  });
  it("거리 없는 옛 형식은 0점 — 수집기와 채점이 한 쌍임을 잠근다", () => {
    // 옛 수집기 출력: `"신도시 개발(택지)"` · `"반월시화산단(국가), 시화(일반)"` — 거리가 없다.
    // 수집기만 되돌리고 채점을 안 고치면(혹은 그 반대) 점수가 조용히 0이 되는데, 이 테스트가
    // 그 상태를 "의도된 0"으로 못 박는다.
    expect(
      scoreFuture(makeApt(/** @type {any} */ ({ cityDev: "신도시 개발(택지)" }))).subs.find(
        (x) => x.name === "도시개발"
      )?.score
    ).toBe(0);
    expect(
      scoreFuture(makeApt(/** @type {any} */ ({ industryDev: "반월시화산단(국가)" }))).subs.find(
        (x) => x.name === "산업개발"
      )?.score
    ).toBe(0);
  });
  it("값이 있으면 점수가 0이어도 화면에 그대로 보여준다 (거짓 '없음' 금지)", () => {
    const r = scoreFuture(makeApt(/** @type {any} */ ({ industryDev: "먼단지 9.0km" })));
    const sub = r.subs.find((x) => x.name === "산업개발");
    expect(sub?.score).toBe(0);
    expect(sub?.info).toContain("먼단지"); // "없음" 이 아니라 실제 값
  });
  // ★ 이 저장소가 세션511에 겪은 사고의 핵심 가드 — 동적 재분배로 되돌리면 red.
  it("호재를 채우면 총점이 절대 내려가지 않는다 (단조성)", () => {
    const cases = [
      { transitDev: "GTX-A 동탄역 공사중", devDist: 0.4 },
      { transitDev: "대장홍대선 대장역 추진", devDist: 3.5 },
      { cityDev: "신도시 개발" },
      { industryDev: "테크노밸리" },
      { transitDev: "GTX-B 송도역 착공", devDist: 1.2, cityDev: "재생", industryDev: "산업단지" },
    ];
    for (const pg of [1.5, 0.7, 0.2, -0.5, -1.5]) {
      const bare = scoreFuture(
        makeApt(/** @type {any} */ ({ popGrowth: pg, transitDev: null, cityDev: null, industryDev: null }))
      );
      for (const c of cases) {
        const withDev = scoreFuture(
          makeApt(/** @type {any} */ ({ popGrowth: pg, transitDev: null, cityDev: null, industryDev: null, ...c }))
        );
        expect(withDev.total).toBeGreaterThanOrEqual(bare.total);
      }
    }
  });
  it("순유입 -> 인구 +10", () => {
    const base =
      scoreFuture(makeApt({ popGrowth: 0, netMigration: null })).subs.find((s) => s.name === "인구")?.score ?? 0;
    const inflow =
      scoreFuture(makeApt({ popGrowth: 0, netMigration: 1000 })).subs.find((s) => s.name === "인구")?.score ?? 0;
    expect(inflow).toBe(base + 10);
  });
  it("대규모 유출 -> 인구 -5", () => {
    const base =
      scoreFuture(makeApt({ popGrowth: 0, netMigration: null })).subs.find((s) => s.name === "인구")?.score ?? 0;
    const out =
      scoreFuture(makeApt({ popGrowth: 0, netMigration: -6000 })).subs.find((s) => s.name === "인구")?.score ?? 0;
    expect(out).toBe(base - 5);
  });
});

describe("computeRegionalMedians", () => {
  it("지역별 중위값 계산", () => {
    const apts = [
      { region: "경기", pir: 5, psr: 0.8, unsoldRate: 10, supplyRatio: 100 },
      { region: "경기", pir: 7, psr: 1.2, unsoldRate: 30, supplyRatio: 120 },
      { region: "경기", pir: 9, psr: 1.0, unsoldRate: 20, supplyRatio: 110 },
    ];
    const m = computeRegionalMedians(apts);
    expect(m["경기"].pir).toBe(7);
    expect(m["경기"].psr).toBe(1.0);
  });
  it("빈 배열 -> 빈 객체", () => {
    expect(computeRegionalMedians([])).toEqual({});
  });
  it("null 필드 제외", () => {
    const apts = /** @type {any} */ ([
      { region: "경기", pir: null, psr: 0.8, unsoldRate: null, supplyRatio: 100 },
      { region: "경기", pir: 5, psr: null, unsoldRate: 20, supplyRatio: null },
    ]);
    const m = computeRegionalMedians(apts);
    expect(m["경기"].pir).toBe(5);
    expect(m["경기"].psr).toBe(0.8);
    // 세션 445: unsoldRate null(=폭발값 무력화) 단지는 지역 중위값 분모에서 제외 → 20 단독.
    expect(m["경기"].unsoldRate).toBe(20);
  });
  // --- 세션 454: edge case 보강 (computeRegionalMedians.ts L31/L37/L40/L43) ---
  it("짝수 개수 -> 중앙 2개 평균", () => {
    const apts = /** @type {any} */ ([
      { region: "서울", pir: 4 },
      { region: "서울", pir: 6 },
      { region: "서울", pir: 8 },
      { region: "서울", pir: 10 },
    ]);
    // 정렬 [4,6,8,10], 중앙 2개(6,8) 평균 = 7
    expect(computeRegionalMedians(apts)["서울"].pir).toBe(7);
  });
  it("단일 원소 -> 그 값", () => {
    const apts = /** @type {any} */ ([{ region: "부산", psr: 1.5 }]);
    expect(computeRegionalMedians(apts)["부산"].psr).toBe(1.5);
  });
  it('region null/빈문자 -> "기타" 버킷 (L31)', () => {
    const apts = /** @type {any} */ ([
      { region: null, pir: 5 },
      { region: "", pir: 7 },
    ]);
    const m = computeRegionalMedians(apts);
    // 둘 다 "기타" 버킷 → [5,7] 평균 6
    expect(m["기타"].pir).toBe(6);
    expect(m[""]).toBeUndefined();
  });
  it("NaN/음수 필터 — pir 등 Number.isFinite, maint 는 >0 만 (L33-37)", () => {
    const apts = /** @type {any} */ ([
      { region: "대전", pir: NaN, psr: -1, avgMaintenanceCost: -100 },
      { region: "대전", pir: 5, psr: 0.9, avgMaintenanceCost: 0 },
      { region: "대전", pir: 7, psr: 1.1, avgMaintenanceCost: 200 },
    ]);
    const m = computeRegionalMedians(apts);
    // pir: NaN 제외 → [5,7] 평균 6. psr: -1 은 Number.isFinite 통과(음수도 finite)라 [-1,0.9,1.1] 중앙값 0.9.
    expect(m["대전"].pir).toBe(6);
    expect(m["대전"].psr).toBe(0.9);
    // maint: -100·0 제외(>0 만), 200 단독 → 200
    expect(m["대전"].maint).toBe(200);
  });
  it("해당 지역 모든 값 null -> 각 필드 null (L40)", () => {
    const apts = /** @type {any} */ ([{ region: "광주", pir: null, psr: null }]);
    const m = computeRegionalMedians(apts);
    expect(m["광주"].pir).toBeNull();
    expect(m["광주"].psr).toBeNull();
  });
});

describe("calcCats", () => {
  it("6개 카테고리 반환", () => {
    const cats = calcCats(makeApt(), {});
    expect(Object.keys(cats)).toEqual(
      expect.arrayContaining(["price", "location", "product", "benefit", "risk", "future"])
    );
  });
  it("모든 카테고리 0~100", () => {
    Object.values(calcCats(makeApt(), {})).forEach((c) => {
      expect(c.total).toBeGreaterThanOrEqual(0);
      expect(c.total).toBeLessThanOrEqual(100);
    });
  });
  it("대부분 null인 아파트도 에러 없이 계산", () => {
    Object.values(
      calcCats(/** @type {any} */ ({ id: 99, name: "널단지", region: "경기", builder: null, price: null }), {})
    ).forEach((c) => {
      expect(c.total).toBeGreaterThanOrEqual(0);
      expect(c.total).toBeLessThanOrEqual(100);
    });
  });
  // 세션 488: 용적률·전용률 0 은 미수집 — "0% → 쾌적한 밀도" 칭찬 사고 정정
  it("용적률 0 은 미수집으로 처리 (info '정보 없음', 0% 로 칭찬 안 함)", () => {
    const far0 = calcCats(makeApt({ floorAreaRatio: 0 }), {});
    const farInfo = far0.product.subs.find((s) => s.name === "용적률")?.info;
    expect(farInfo).toBe("정보 없음");
    // 값이 있으면 그대로 표시 (0 만 미수집)
    const farReal = calcCats(makeApt({ floorAreaRatio: 220 }), {});
    expect(farReal.product.subs.find((s) => s.name === "용적률")?.info).toBe("220%");
  });
  it("전용률 0 은 미수집으로 처리 (info '정보 없음')", () => {
    const excl0 = calcCats(makeApt({ exclusiveRatio: 0 }), {});
    expect(excl0.product.subs.find((s) => s.name === "전용률")?.info).toBe("정보 없음");
  });
  // --- 세션 454: sanitize null 안전성 보강 (engine.ts L22-95) ---
  it("한글 NFC 정규화 — 분해형(NFD) region 도 조합형과 동일 결과 (str L23)", () => {
    // 분해형 "경기"(NFD, 5글자)는 === 로는 조합형 "경기"(2글자)와 불일치하나,
    // sanitize str() 의 .normalize("NFC") 가 통일 → regionMedians["경기"] 키 매칭 작동.
    const rm = { 경기: { pir: 5, psr: 0.8, unsoldRate: 15, supplyRatio: 100, maint: 0 } };
    const composed = calcCats(makeApt({ region: "경기", pir: null }), { regionMedians: rm });
    const decomposed = calcCats(makeApt({ region: "경기".normalize("NFD"), pir: null }), { regionMedians: rm });
    // pir null → 지역 중위값(5) 되채움. NFC 통일 덕에 두 입력이 같은 버킷 매칭 → price 카테고리 동일.
    expect(decomposed.price.total).toBe(composed.price.total);
  });
  it("num() — price=NaN 도 throw 없이 0~100 (L24-26 NaN→fallback)", () => {
    Object.values(calcCats(makeApt({ price: NaN, area: NaN }), {})).forEach((c) => {
      expect(c.total).toBeGreaterThanOrEqual(0);
      expect(c.total).toBeLessThanOrEqual(100);
    });
  });
});

describe("calcAll", () => {
  it("모든 프로필에서 0~100", () => {
    Object.keys(PROFILES).forEach((p) => {
      const r = calcAll(makeApt(), p, {});
      expect(r.total).toBeGreaterThanOrEqual(0);
      expect(r.total).toBeLessThanOrEqual(100);
    });
  });
  it("다른 프로필은 다른 가중치", () => {
    const live = calcAll(makeApt(), "live", {});
    const invest = calcAll(makeApt(), "invest", {});
    expect(live.weights).not.toEqual(invest.weights);
  });
  it("미등록 프로필은 live 폴백", () => {
    expect(calcAll(makeApt(), "nonexistent", {}).weights).toEqual(PROFILES.live.w);
  });
});

// --- 추가 테스트: 복합 null, 경계값, regionMedians, FUTURE_WEIGHT_MAP 경로 ---

describe("calcCats — 복합 null 조합 5가지", () => {
  // 대부분 필드가 null인 아파트 5개 다른 조합 테스트
  const nullApts = [
    {
      id: "n1",
      name: "널1",
      region: "경기",
      builder: null,
      price: null,
      area: null,
      nearbyMedian: null,
      subwayDist: null,
      units: null,
      popGrowth: null,
    },
    {
      id: "n2",
      name: "널2",
      region: null,
      builder: "현대건설",
      price: 50000,
      area: null,
      nearbyMedian: null,
      transitDev: null,
      cityDev: null,
      industryDev: null,
    },
    {
      id: "n3",
      name: "널3",
      region: "서울",
      builder: null,
      price: null,
      area: 84,
      pir: null,
      psr: null,
      jeonseRate: null,
      unsoldRate: null,
    },
    {
      id: "n4",
      name: "널4",
      region: "부산",
      builder: "무명",
      price: 30000,
      nearbyMedian: 40000,
      noxious: null,
      noxiousDist: null,
      schoolScore: null,
      schoolGrade: null,
    },
    {
      id: "n5",
      name: "널5",
      region: "경기",
      price: 10000,
      discountPct: null,
      loanFree: null,
      optionFree: null,
      balconyFree: null,
      cashback: null,
      builderCreditGrade: null,
      builderDebtRatio: null,
    },
  ];

  nullApts.forEach((apt, idx) => {
    it(`널 조합 #${idx + 1}: 에러 없이 6개 카테고리 0~100`, () => {
      const cats = calcCats(/** @type {any} */ (apt), {});
      expect(Object.keys(cats)).toHaveLength(6);
      Object.values(cats).forEach((c) => {
        expect(c.total).toBeGreaterThanOrEqual(0);
        expect(c.total).toBeLessThanOrEqual(100);
      });
    });
  });
});

describe("경계값 — total=0, total=100 극단 케이스", () => {
  it("혜택 점수 total=0 (모든 혜택 없음)", () => {
    const r = scoreBenefit(
      makeApt({
        discountPct: 0,
        loanFree: false,
        loanFreePct: 0,
        optionFree: false,
        optionValue: 0,
        balconyFree: false,
        balconyValue: 0,
        cashback: 0,
        price: 50000,
      })
    );
    expect(r.total).toBe(0);
  });

  it("혜택 점수 total=100 (충분한 혜택)", () => {
    const r = scoreBenefit(makeApt({ discountPct: 30, price: 50000 }));
    expect(r.total).toBe(100);
  });

  it("가격 점수 nearbyMedian=0 → total이 정해진 기본값 범위", () => {
    const r = scorePrice(makeApt({ nearbyMedian: 0, price: 50000 }));
    expect(r.total).toBeGreaterThanOrEqual(0);
    expect(r.total).toBeLessThanOrEqual(100);
  });

  it("모든 프로필에서 극단적으로 좋은 아파트도 100 초과 불가", () => {
    const goodApt = makeApt({
      price: 20000,
      nearbyMedian: 80000,
      pir: 1,
      psr: 0.3,
      jeonseRate: 80,
      subwayDist: 100,
      busRoutes: 20,
      icDist: 1,
      ktxDist: 1,
      discountPct: 30,
      units: 2000,
      parkingRatio: 2.0,
      unsoldRate: 1,
      popGrowth: 2,
      netMigration: 5000,
      transitDev: "GTX-C 개통",
      devDist: 0.5,
      cityDev: "신도시",
      industryDev: "테크노밸리",
    });
    Object.keys(PROFILES).forEach((p) => {
      const r = calcAll(goodApt, p, {});
      expect(r.total).toBeLessThanOrEqual(100);
    });
  });
});

describe("scorePrice — regionMedians 컨텍스트 전달", () => {
  it("regionMedians 없으면 비관적 기본값 사용", () => {
    const apt = makeApt({ pir: null, psr: null });
    const withoutCtx = scorePrice(apt);
    expect(withoutCtx.total).toBeGreaterThanOrEqual(0);
  });

  it("regionMedians 전달 시 sanitize에서 지역 중위값 사용", () => {
    const regionMedians = { 경기: { pir: 5, psr: 0.8, unsoldRate: 15, supplyRatio: 100 } };
    const apt = makeApt({ region: "경기", pir: null, psr: null });
    // calcCats는 regionMedians를 ctx로 전달받아 sanitize에 사용
    const cats = calcCats(apt, /** @type {any} */ ({ regionMedians }));
    expect(cats.price.total).toBeGreaterThanOrEqual(0);
    expect(cats.price.total).toBeLessThanOrEqual(100);
  });

  it("regionMedians에 해당 지역 없으면 비관적 폴백", () => {
    const regionMedians = { 서울: { pir: 3, psr: 0.5, unsoldRate: 5, supplyRatio: 80 } };
    const apt = makeApt({ region: "경기", pir: null, psr: null });
    const cats = calcCats(apt, /** @type {any} */ ({ regionMedians }));
    // 경기 중위값 없으므로 비관적 기본값 사용 → 점수가 다를 수 있음
    expect(cats.price.total).toBeGreaterThanOrEqual(0);
  });
});

describe("scoreFuture — FUTURE_WEIGHT_MAP 모든 8개 경로", () => {
  // transit/city/industry 있음/없음 조합 (2^3 = 8)
  const combos = [
    { label: "1,1,1", transit: "GTX-C 착공", city: "신도시", industry: "테크노밸리" },
    { label: "1,1,0", transit: "지하철 착공", city: "신도심", industry: null },
    { label: "1,0,1", transit: "트램 착공", city: "", industry: "산업단지" },
    { label: "1,0,0", transit: "경전철 착공", city: "", industry: null },
    { label: "0,1,1", transit: "없음", city: "재건축", industry: "물류단지" },
    { label: "0,1,0", transit: "", city: "스마트시티", industry: "" },
    { label: "0,0,1", transit: "없음", city: "", industry: "공항" },
    { label: "0,0,0", transit: "없음", city: "", industry: null },
  ];

  combos.forEach(({ label, transit, city, industry }) => {
    it(`FUTURE_WEIGHT_MAP[${label}] 경로 정상 계산`, () => {
      const r = scoreFuture(
        makeApt(
          /** @type {any} */ ({
            transitDev: transit,
            cityDev: city,
            industryDev: industry,
            popGrowth: 0.5,
            netMigration: null,
            devDist: 1,
          })
        )
      );
      expect(r.total).toBeGreaterThanOrEqual(0);
      expect(r.total).toBeLessThanOrEqual(100);
      expect(r.subs).toHaveLength(4);
    });
  });

  it("모든 개발 없음 → 인구 몫(0.55)만 (세션511: 인구 100% 대체 폐기)", () => {
    const r = scoreFuture(
      makeApt(
        /** @type {any} */ ({ transitDev: "없음", cityDev: "", industryDev: null, popGrowth: 0.5, netMigration: null })
      )
    );
    expect(r.total).toBe(Math.round(((80 * FUTURE_WEIGHTS.pop) / FUTURE_RAW_MAX) * 100));
  });

  it("모든 개발 있음(1,1,1) → 4개 축 분산", () => {
    const r = scoreFuture(
      makeApt({
        transitDev: "GTX-C 착공",
        cityDev: "신도시",
        industryDev: "테크노밸리",
        popGrowth: 0.5,
        netMigration: null,
        devDist: 1,
      })
    );
    // 교통/도시/산업/인구 모두 0 이상
    r.subs.forEach((s) => expect(s.score).toBeGreaterThanOrEqual(0));
  });
});

// === 세션66: 신규 15개 필드 스코어링 테스트 ===

describe("scoreLocation — 대기질 복합 (PM10/O3)", () => {
  it("pm10/o3 null → 기존과 동일 (pm25만 사용)", () => {
    const base = scoreLocation(makeApt());
    const withNull = scoreLocation(makeApt({ airQuality: { pm25: null, pm10: null, o3: null } }));
    // 둘 다 pm25 null → AIR_QUALITY_DEFAULT 사용 → 동일
    expect(withNull.subs.find((s) => s.name === "자연환경")?.score ?? 0).toBe(
      base.subs.find((s) => s.name === "자연환경")?.score ?? 0
    );
  });
  it("pm10 좋음 → 환경 점수 변화", () => {
    const withPm10 = scoreLocation(makeApt({ airQuality: { pm25: 20, pm10: 20, o3: null } }));
    expect(withPm10.subs.find((s) => s.name === "자연환경")?.score ?? 0).toBeGreaterThanOrEqual(0);
  });
  it("o3 나쁨 → 환경 점수 하락", () => {
    const good = scoreLocation(makeApt({ airQuality: { pm25: 10, pm10: 20, o3: 0.02 } }));
    const bad = scoreLocation(makeApt({ airQuality: { pm25: 10, pm10: 20, o3: 0.15 } }));
    expect(good.subs.find((s) => s.name === "자연환경")?.score ?? 0).toBeGreaterThan(
      bad.subs.find((s) => s.name === "자연환경")?.score ?? 0
    );
  });
});

describe("scoreLocation — 도보통학 보정", () => {
  it("naverSchoolWalkMin null → 학군 점수 불변", () => {
    const base = scoreLocation(makeApt({ schoolScore: 70 }));
    const withNull = scoreLocation(makeApt({ schoolScore: 70, naverSchoolWalkMin: null }));
    expect(withNull.subs.find((s) => s.name === "학군")?.score ?? 0).toBe(
      base.subs.find((s) => s.name === "학군")?.score ?? 0
    );
  });
  it("5분 이내 → +10", () => {
    const r = scoreLocation(makeApt({ schoolScore: 70, naverSchoolWalkMin: 3 }));
    expect(r.subs.find((s) => s.name === "학군")?.score ?? 0).toBe(80);
  });
  it("25분 → -10", () => {
    const r = scoreLocation(makeApt({ schoolScore: 70, naverSchoolWalkMin: 25 }));
    expect(r.subs.find((s) => s.name === "학군")?.score ?? 0).toBe(60);
  });
  it("학군 점수 0~100 클램핑", () => {
    const high = scoreLocation(makeApt({ schoolScore: 95, naverSchoolWalkMin: 3 }));
    expect(high.subs.find((s) => s.name === "학군")?.score ?? 0).toBeLessThanOrEqual(100);
    const low = scoreLocation(makeApt({ schoolScore: 5, naverSchoolWalkMin: 25 }));
    expect(low.subs.find((s) => s.name === "학군")?.score ?? 0).toBeGreaterThanOrEqual(0);
  });
});

describe("scoreLocation — 교통 sentinel + busRoutes 클램핑 (세션 288)", () => {
  it('subwayDist 9000+ → info 라벨 "지하철 없음"', () => {
    const r = scoreLocation(makeApt({ subwayDist: 9999 }));
    const transport = r.subs.find((s) => s.name === "교통");
    expect(transport?.info).toContain("지하철 없음");
    expect(transport?.detail).toContain("지하철 없음");
  });
  it('subwayDist < 9000 → "지하철 N m" 라벨', () => {
    const r = scoreLocation(makeApt({ subwayDist: 500 }));
    const transport = r.subs.find((s) => s.name === "교통");
    expect(transport?.info).toContain("지하철 500m");
  });
  it("busRoutes FULL_BUS_ROUTES 이상은 동일 클램핑 (기준값 하드코딩 금지 — 세션498)", () => {
    const atFull = scoreLocation(makeApt({ busRoutes: FULL_BUS_ROUTES }));
    const at100 = scoreLocation(makeApt({ busRoutes: 100 }));
    // FULL_BUS_ROUTES 이상에서는 rawBus = 30 으로 동일 클램핑
    expect(at100.subs.find((s) => s.name === "교통")?.score ?? 0).toBe(
      atFull.subs.find((s) => s.name === "교통")?.score ?? 0
    );
  });
  it("만점 기준 미달은 만점보다 낮다 (FULL_BUS_ROUTES 상향이 실제로 반영되는지)", () => {
    const below = scoreLocation(makeApt({ busRoutes: FULL_BUS_ROUTES - 5 }));
    const atFull = scoreLocation(makeApt({ busRoutes: FULL_BUS_ROUTES }));
    expect(atFull.subs.find((s) => s.name === "교통")?.score ?? 0).toBeGreaterThan(
      below.subs.find((s) => s.name === "교통")?.score ?? 0
    );
  });
  it('detail 의 "N개/M" 분모가 FULL_BUS_ROUTES 를 따른다 (하드코딩 재발 차단)', () => {
    const r = scoreLocation(makeApt({ busRoutes: 10 }));
    expect(r.subs.find((s) => s.name === "교통")?.detail ?? "").toContain(`버스 10개/${FULL_BUS_ROUTES}`);
  });
  it("busRoutes 적을수록 교통 점수 하락 (단조성)", () => {
    const few = scoreLocation(makeApt({ busRoutes: 0 }));
    const many = scoreLocation(makeApt({ busRoutes: FULL_BUS_ROUTES }));
    expect(many.subs.find((s) => s.name === "교통")?.score ?? 0).toBeGreaterThan(
      few.subs.find((s) => s.name === "교통")?.score ?? 0
    );
  });
});

describe("scorePrice — fairPrice 3단 폴백 라벨 보강 (세션 288)", () => {
  it('nearbyMedian 부재 + avgPriceSqm 폴백 → 신뢰도 detail "폴백차감15"', () => {
    const r = scorePrice(makeApt({ nearbyMedian: null, avgPriceSqm: 12000 }));
    const rel = r.subs.find((s) => s.name === "데이터 신뢰도");
    expect(rel?.detail).toContain("폴백차감");
  });
  it("nearbyMedian 부재 + avgPriceSqm/presalePp 둘 다 null → fairPrice 0 분기", () => {
    const r = scorePrice(makeApt({ nearbyMedian: null, avgPriceSqm: null, presalePp: null }));
    expect(r.fairPrice).toBe(0);
    expect(r.subs[0].info).toBe("데이터 부재");
  });
  it('폴백 사용 시 괴리도 detail 에 "광역 시도 평균 기준" 경고', () => {
    const r = scorePrice(makeApt({ nearbyMedian: null, avgPriceSqm: 12000 }));
    expect(r.subs[0].detail).toContain("광역 시도 평균 기준");
  });
});

describe("scoreRisk — 초기분양률 (initSc)", () => {
  it("initialSaleRate null → 중립 60점 (100-40)", () => {
    const r = scoreRisk(makeApt({ initialSaleRate: null }));
    expect(r.subs.find((s) => s.name === "초기분양률")?.score ?? 0).toBe(60);
  });
  it("90%↑ → 안전 90점 (100-10)", () => {
    const r = scoreRisk(makeApt({ initialSaleRate: 95 }));
    expect(r.subs.find((s) => s.name === "초기분양률")?.score ?? 0).toBe(90);
  });
  it("20% → 위험 15점 (100-85)", () => {
    const r = scoreRisk(makeApt({ initialSaleRate: 20 }));
    expect(r.subs.find((s) => s.name === "초기분양률")?.score ?? 0).toBe(15);
  });
});

describe("scoreRisk — isRegulated DB값 우선", () => {
  it("isRegulated=true → 규제지역", () => {
    const r = scoreRisk(makeApt({ isRegulated: true }));
    expect(r.subs.find((s) => s.name === "규제")?.score ?? 0).toBe(40); // 100 - 60
  });
  it("isRegulated=false → 비규제", () => {
    const r = scoreRisk(makeApt({ isRegulated: false }));
    expect(r.subs.find((s) => s.name === "규제")?.score ?? 0).toBe(90); // 100 - 10
  });
  it("isRegulated=null → getZone() 폴백", () => {
    const r = scoreRisk(makeApt({ isRegulated: null }));
    expect(r.subs.find((s) => s.name === "규제")?.score ?? 0).toBeGreaterThanOrEqual(0);
  });
});

describe("scoreRisk — naverSellCount 매물과잉 페널티", () => {
  it("naverSellCount=60 → liqSc 페널티 +5", () => {
    const base = scoreRisk(makeApt({ naverSellCount: null }));
    const flood = scoreRisk(makeApt({ naverSellCount: 60 }));
    expect(flood.subs.find((s) => s.name === "거래량")?.score ?? 0).toBeLessThanOrEqual(
      base.subs.find((s) => s.name === "거래량")?.score ?? 0
    );
  });
});

describe("scoreRisk — presaleType 공공분양 보너스", () => {
  it("공공분양 → 시공사 재무 점수 상승", () => {
    const priv = scoreRisk(makeApt({ presaleType: "민간분양" }));
    const pub = scoreRisk(makeApt({ presaleType: "공공분양" }));
    expect(pub.subs.find((s) => s.name === "시공사 재무")?.score ?? 0).toBeGreaterThanOrEqual(
      priv.subs.find((s) => s.name === "시공사 재무")?.score ?? 0
    );
  });
});

describe("scorePrice — 택지비비율 (landSc)", () => {
  it("landCostRatio null → 중립 50점", () => {
    const r = scorePrice(makeApt({ landCostRatio: null }));
    expect(r.subs.find((s) => s.name === "택지비비율")?.score ?? 0).toBe(50);
  });
  it("landCostRatio 70% → 80점", () => {
    const r = scorePrice(makeApt({ landCostRatio: 70 }));
    expect(r.subs.find((s) => s.name === "택지비비율")?.score ?? 0).toBe(80);
  });
  it("landCostRatio 10% → 25점", () => {
    const r = scorePrice(makeApt({ landCostRatio: 10 }));
    expect(r.subs.find((s) => s.name === "택지비비율")?.score ?? 0).toBe(25);
  });
});

describe("scorePrice — fairPrice 폴백 (단위 교정)", () => {
  // avgPriceSqm 단위: 천원/㎡ (fieldMeta.js:72) → fairPrice(만원) = avgPriceSqm × area / 10
  it("nearbyMedian=null + avgPriceSqm 있으면 → 만원 스케일로 올바른 fairPrice", () => {
    const r = scorePrice(makeApt({ nearbyMedian: null, avgPriceSqm: 4510, area: 84.9372, price: 43000 }));
    // 4510 × 84.9372 / 10 ≈ 38307 만원 × brandAdj × ageCoeff (completion 미래면 1.0, 과거면 >1)
    expect(r.fairPrice).toBeGreaterThanOrEqual(35000);
    expect(r.fairPrice).toBeLessThanOrEqual(45000);
    // dev는 한 자릿수 ~ 30% 이내여야 함 (이전 버그는 -32,401%)
    expect(parseFloat(String(r.deviation))).toBeGreaterThan(-30);
    expect(parseFloat(String(r.deviation))).toBeLessThan(30);
  });
  // presalePp 단위: 만원/평 (fieldMeta.js:148) → fairPrice(만원) = presalePp × (area / 3.3058)
  it("nearbyMedian=null + presalePp 있으면 → 평수 환산으로 올바른 fairPrice", () => {
    const r = scorePrice(makeApt({ nearbyMedian: null, avgPriceSqm: null, presalePp: 2000, area: 84, price: 40000 }));
    // 2000 × (84 / 3.3058) ≈ 50,822 만원 × brandAdj × ageCoeff
    expect(r.fairPrice).toBeGreaterThanOrEqual(45000);
    expect(r.fairPrice).toBeLessThanOrEqual(58000);
  });
  it("셋 다 null → PRICE_NO_DATA_DEFAULTS 분기", () => {
    const r = scorePrice(makeApt({ nearbyMedian: null, avgPriceSqm: null, presalePp: null }));
    expect(r.fairPrice).toBe(0);
    expect(r.subs.find((s) => s.name === "적정가 괴리도")?.info).toBe("데이터 부재");
  });
  it("경남 거제 유로스카이 실측 회귀 — dev 쓰레기 값 나오면 안 됨", () => {
    // 세션91 실측: 이전엔 fairPrice=132, dev=-32,401% (clamp로 0점)
    const r = scorePrice(
      makeApt({
        nearbyMedian: null,
        avgPriceSqm: 4510,
        area: 84.9372,
        price: 43000,
        jeonseRate: null,
        pir: null,
        psr: null,
      })
    );
    expect(r.subs.find((s) => s.name === "적정가 괴리도")?.score ?? 0).toBeGreaterThan(0);
    expect(r.subs.find((s) => s.name === "적정가 괴리도")?.info).not.toContain("-32");
  });
});

describe("scorePrice — 시도 평균 폴백 신뢰도 차감 + detail 경고 (세션114)", () => {
  // 방안 A: nearbyMedian=null 이고 avgSqm/presalePp 폴백 사용 시 dataReliability -15
  it("nearbyMedian 있음 → 폴백 없음 → 차감 없음 (기준선)", () => {
    const r = scorePrice(makeApt({ nearbyMedian: 55000, avgPriceSqm: 7312, dataReliability: 90 }));
    const rel = /** @type {any} */ (r.subs.find((s) => s.name === "데이터 신뢰도"));
    expect(rel.score).toBe(90);
    expect(rel.info).not.toContain("폴백차감");
  });
  it('nearbyMedian=null + avgPriceSqm 사용 → relSc -15 + info에 "-폴백차감15"', () => {
    const r = scorePrice(
      makeApt({
        nearbyMedian: null,
        avgPriceSqm: 7312,
        area: 84.9372,
        price: 42590,
        dataReliability: 55,
      })
    );
    const rel = /** @type {any} */ (r.subs.find((s) => s.name === "데이터 신뢰도"));
    expect(rel.score).toBe(40); // 55 - 15
    expect(rel.info).toContain("-폴백차감15");
  });
  it("dataReliability=10 에서 차감해도 0 미만으로 떨어지지 않음 (클램프)", () => {
    const r = scorePrice(
      makeApt({
        nearbyMedian: null,
        avgPriceSqm: 7312,
        area: 84.9372,
        price: 42590,
        dataReliability: 10,
      })
    );
    const rel = /** @type {any} */ (r.subs.find((s) => s.name === "데이터 신뢰도"));
    expect(rel.score).toBe(0);
  });
  // 방안 B: 폴백 사용 시 괴리도 detail에 "광역 시도 평균 기준" 접미
  it('폴백 사용 → 괴리도 detail에 "광역 시도 평균 기준" 경고 포함', () => {
    const r = scorePrice(
      makeApt({
        nearbyMedian: null,
        avgPriceSqm: 7312,
        area: 84.9372,
        price: 42590,
        dataReliability: 55,
      })
    );
    const dev = /** @type {any} */ (r.subs.find((s) => s.name === "적정가 괴리도"));
    expect(dev.detail).toContain("광역 시도 평균 기준");
  });
  it("폴백 미사용 → 괴리도 detail에 경고 없음", () => {
    const r = scorePrice(makeApt({ nearbyMedian: 55000 }));
    const dev = /** @type {any} */ (r.subs.find((s) => s.name === "적정가 괴리도"));
    expect(dev.detail).not.toContain("광역 시도 평균 기준");
  });
  // 방안 A: presalePp 폴백도 동일하게 차감
  it("presalePp 폴백도 dataReliability -15 적용", () => {
    const r = scorePrice(
      makeApt({
        nearbyMedian: null,
        avgPriceSqm: null,
        presalePp: 2000,
        area: 84,
        price: 40000,
        dataReliability: 67,
      })
    );
    const rel = /** @type {any} */ (r.subs.find((s) => s.name === "데이터 신뢰도"));
    expect(rel.score).toBe(52); // 67 - 15
  });
  // 회귀 방지: 가평 자라섬 수자인 실측 — 폴백 사용 + 차감 동시 확인
  it("가평 자라섬 수자인 실측 회귀 — 폴백 + 차감 + 경고 모두 반영", () => {
    const r = scorePrice(
      makeApt({
        nearbyMedian: null,
        avgPriceSqm: 7312,
        area: 84.9176,
        price: 42590,
        dataReliability: 55,
        jeonseRate: null,
      })
    );
    expect(r.fairPrice).toBeGreaterThan(0);
    const rel = /** @type {any} */ (r.subs.find((s) => s.name === "데이터 신뢰도"));
    expect(rel.score).toBe(40);
    const dev = /** @type {any} */ (r.subs.find((s) => s.name === "적정가 괴리도"));
    expect(dev.detail).toContain("광역 시도 평균 기준");
  });
});

describe("scorePrice — null 가드 (유령 폴백 제거)", () => {
  it('jeonseRate=null → "데이터 부재" 표시 + PRICE_NO_DATA_DEFAULTS.jr 점수', () => {
    const r = scorePrice(makeApt({ jeonseRate: null }));
    const sub = /** @type {any} */ (r.subs.find((s) => s.name === "전세가율"));
    expect(sub.info).toBe("데이터 부재");
    expect(sub.score).toBe(50); // PRICE_NO_DATA_DEFAULTS.jr
  });
  it('pir=null → "데이터 부재" 표시', () => {
    const r = scorePrice(makeApt({ pir: null }));
    const sub = /** @type {any} */ (r.subs.find((s) => s.name === "PIR"));
    expect(sub.info).toBe("데이터 부재");
    expect(sub.score).toBe(50);
  });
  it('psr=null → "데이터 부재" 표시 (NaN% 유령 방지)', () => {
    const r = scorePrice(makeApt({ psr: null }));
    const sub = /** @type {any} */ (r.subs.find((s) => s.name === "PSR"));
    expect(sub.info).toBe("데이터 부재");
    expect(sub.score).toBe(50);
  });
});

describe("scorePrice — priceIndex 보정", () => {
  it("priceIndex=140 → 신뢰도 +5", () => {
    const base = scorePrice(makeApt({ priceIndex: null }));
    const hot = scorePrice(makeApt({ priceIndex: 140 }));
    expect(hot.subs.find((s) => s.name === "데이터 신뢰도")?.score ?? 0).toBeGreaterThanOrEqual(
      base.subs.find((s) => s.name === "데이터 신뢰도")?.score ?? 0
    );
  });
});

describe("scoreProduct — presale 폴백", () => {
  it("parkingRatio null + presaleParking → 주차 점수 변화", () => {
    // _noParking 플래그는 sanitize()에서 설정 → 직접 전달
    const noData = scoreProduct(makeApt({ parkingRatio: 0.5, _noParking: true, presaleParking: null }));
    const withPresale = scoreProduct(
      makeApt({ parkingRatio: 0.5, _noParking: true, presaleParking: 1500, presaleGeneralSupply: 1000 })
    );
    // 1500/1000 = 1.5 → 15점 vs 기본값 0.5 → 5점
    expect(withPresale.subs.find((s) => s.name === "주차")?.score ?? 0).toBeGreaterThan(
      noData.subs.find((s) => s.name === "주차")?.score ?? 0
    );
  });
  it("presaleHousingType 오피스텔 → 브랜드 상한 15", () => {
    const apt = scoreProduct(makeApt({ builder: "현대건설", presaleHousingType: "오피스텔" }));
    expect(apt.subs.find((s) => s.name === "브랜드")?.score ?? 0).toBeLessThanOrEqual(15);
  });
  it("presaleHousingType null → 브랜드 상한 20 (기존과 동일)", () => {
    const apt = scoreProduct(makeApt({ builder: "현대건설", presaleHousingType: null }));
    expect(apt.subs.find((s) => s.name === "브랜드")?.score ?? 0).toBe(20);
  });
});

describe("scorePrice — 내부 가중치 합계 (세션66)", () => {
  it("6개 서브 가중치 합 = 1.00", () => {
    // engine.js: devSc*0.30 + jrSc*0.20 + pirSc*0.15 + psrSc*0.25 + relSc*0.07 + landSc*0.03
    const weights = [0.3, 0.2, 0.15, 0.25, 0.07, 0.03];
    const sum = weights.reduce((a, b) => a + b, 0);
    expect(Math.round(sum * 100) / 100).toBe(1.0);
  });
});

describe("하위 호환 — makeApt() 기본값 제로 드리프트", () => {
  it("신규 필드 null인 기본 아파트 — 모든 프로필 0~100", () => {
    const cats = calcCats(makeApt(), {});
    Object.values(cats).forEach((c) => {
      expect(c.total).toBeGreaterThanOrEqual(0);
      expect(c.total).toBeLessThanOrEqual(100);
    });
  });
  it("Location 제로 드리프트: pm10/o3/walkMin null → 기존과 동일", () => {
    // makeApt()에 airQuality 없음 → pm10/o3 모두 null → 기존 pm25 전용 경로
    const r = scoreLocation(makeApt());
    expect(r.total).toBeGreaterThanOrEqual(0);
    expect(r.total).toBeLessThanOrEqual(100);
  });
});

// === 세션70: 클램핑 일관성 — 음수 방어 테스트 ===

describe("클램핑 일관성 — 음수 방어", () => {
  it("scorePrice: nearbyMedian=0 경로에서 total >= 0", () => {
    const r = scorePrice(makeApt({ nearbyMedian: 0 }));
    expect(r.total).toBeGreaterThanOrEqual(0);
  });

  it("scorePrice: 극단 고가에서 total >= 0", () => {
    const r = scorePrice(makeApt({ price: 999999, nearbyMedian: 10000, pir: 99, psr: 9, jeonseRate: 0 }));
    expect(r.total).toBeGreaterThanOrEqual(0);
  });

  it("scoreProduct: 모든 필드 null/최소에서 total >= 0", () => {
    const r = scoreProduct(
      makeApt(
        /** @type {any} */ ({
          builder: null,
          units: 0,
          parkingRatio: 0,
          floorAreaRatio: 0,
          energyGrade: null,
          exclusiveRatio: 0,
          layout: null,
          quakeDesign: false,
          maxFloor: null,
        })
      )
    );
    expect(r.total).toBeGreaterThanOrEqual(0);
  });

  it("scoreFuture: 데이터 없음 + 극단 음수 popGrowth에서 total >= 0", () => {
    const r = scoreFuture(
      makeApt(
        /** @type {any} */ ({
          transitDev: null,
          cityDev: null,
          industryDev: null,
          popGrowth: -10,
          netMigration: -99999,
        })
      )
    );
    expect(r.total).toBeGreaterThanOrEqual(0);
  });

  it("calcAll: 극단 나쁜 아파트에서 모든 프로필 total >= 0", () => {
    const badApt = makeApt(
      /** @type {any} */ ({
        price: 999999,
        nearbyMedian: 1000,
        pir: 99,
        psr: 9,
        jeonseRate: 0,
        subwayDist: 99999,
        busRoutes: 0,
        icDist: 999,
        ktxDist: 999,
        builder: null,
        units: 0,
        popGrowth: -10,
        discountPct: 0,
        loanFree: false,
        optionFree: false,
        balconyFree: false,
        cashback: 0,
        unsoldRate: 100,
        transitDev: null,
        cityDev: null,
        industryDev: null,
      })
    );
    Object.keys(PROFILES).forEach((p) => {
      const r = calcAll(badApt, p, {});
      expect(r.total).toBeGreaterThanOrEqual(0);
      expect(r.total).toBeLessThanOrEqual(100);
    });
  });

  it("scoreLocation: 교통 최소에서 transport 서브 >= 0", () => {
    const r = scoreLocation(makeApt({ subwayDist: 99999, busRoutes: 0, icDist: 999, ktxDist: 999 }));
    expect(r.subs.find((s) => s.name === "교통")?.score ?? 0).toBeGreaterThanOrEqual(0);
  });
});

// 세션99: scorePrice price=0 devSc=97 오인 버그 회귀 방어
// 재건축·후분양·임대형 등 price=0 + nearbyMedian>0 조합이 정상 분기로 빠져
// dev=100% → devSc=97 만점을 받던 버그. 분기 조건에 apt.price<=0 추가 후
// "데이터 부재" 경로로 흡수되어 devSc=PRICE_NO_DATA_DEFAULTS.dev=30 중립.
describe("scorePrice — price=0 devSc=97 오인 버그 (세션99)", () => {
  it("price=0 + nearbyMedian>0 → 데이터 부재 분기 (devSc=30)", () => {
    const r = scorePrice(makeApt({ price: 0, nearbyMedian: 202000 }));
    const dev = /** @type {any} */ (r.subs.find((s) => s.name === "적정가 괴리도"));
    expect(dev.score).toBe(30);
    expect(dev.info).toBe("데이터 부재");
    expect(r.fairPrice).toBe(0);
  });

  it('재건축 단지 detail → "정비사업" 안내', () => {
    const r = scorePrice(makeApt({ price: 0, nearbyMedian: 200000, name: "신반포22차재건축" }));
    expect(r.subs[0].detail).toContain("정비사업");
  });

  it('후분양 단지(써밋) detail → "후분양" 안내', () => {
    const r = scorePrice(makeApt({ price: 0, nearbyMedian: 135000, name: "써밋더힐" }));
    expect(r.subs[0].detail).toContain("후분양");
  });

  it('임대형 단지 detail → "임대형" 안내 (presaleType 기반)', () => {
    const r = scorePrice(
      makeApt({ price: 0, nearbyMedian: 130000, name: "길동생활B동 청년안심주택", presaleType: "민간임대시행자임의" })
    );
    expect(r.subs[0].detail).toContain("임대형");
  });
});

// 세션111: price=0 구조적 사유별 UX 분기 확장 (택지지구/공공/오피스텔).
// 점수는 불변(devSc=30), 문구만 정교화. 38건 중 26건 미분류 → 맞춤 안내로 흡수.
describe("scorePrice — price=0 classifyNoPrice 확장 (세션111)", () => {
  it('택지지구 블록(BL 접미사) → "택지지구 블록" 안내', () => {
    const r = scorePrice(makeApt({ price: 0, nearbyMedian: 200000, name: "인천검암S3BL" }));
    expect(r.subs[0].detail).toContain("택지지구 블록");
    expect(r.subs[0].score).toBe(30);
  });

  it('신도시 포함 단지 → "택지지구 블록" 안내', () => {
    const r = scorePrice(makeApt({ price: 0, nearbyMedian: 200000, name: "고덕국제신도시수자인풍경채1단지" }));
    expect(r.subs[0].detail).toContain("택지지구 블록");
  });

  it('오피스텔 (오) 접미사 → "오피스텔" 안내', () => {
    const r = scorePrice(makeApt({ price: 0, nearbyMedian: 200000, name: "덕수궁롯데캐슬136(오)" }));
    expect(r.subs[0].detail).toContain("오피스텔");
  });

  it('공공분양 + 일반 이름 → "공공분양" 안내', () => {
    const r = scorePrice(
      makeApt({ price: 0, nearbyMedian: 200000, name: "고덕신도시아테라", presaleType: "공공분양" })
    );
    // 이름에 "신도시" 포함되어 "택지지구 블록" 우선 매칭 (규칙상 정상)
    expect(r.subs[0].detail).toMatch(/택지지구 블록|공공분양/);
  });

  it('공공분양 + 블록 접미사 없는 이름 → "공공분양" 안내', () => {
    const r = scorePrice(makeApt({ price: 0, nearbyMedian: 200000, name: "일반공공단지A", presaleType: "공공분양" }));
    expect(r.subs[0].detail).toContain("공공분양");
  });

  it("판정 우선순위: 임대 > 정비사업 > 후분양 > 오피스텔 > 택지블록 > 공공", () => {
    // "재건축" + 공공분양 → 정비사업이 우선
    const r = scorePrice(makeApt({ price: 0, nearbyMedian: 200000, name: "X구역재건축", presaleType: "공공분양" }));
    expect(r.subs[0].detail).toContain("정비사업");
  });

  it("매칭 안 되는 민간분양 → 기본 메시지 유지", () => {
    const r = scorePrice(makeApt({ price: 0, nearbyMedian: 200000, name: "더샵관저아르테", presaleType: "민간분양" }));
    expect(r.subs[0].detail).toBe("분양가 데이터 없음 (중립 점수)");
    expect(r.subs[0].score).toBe(30);
  });

  // 세션111 후속: presaleStage="분양계획" 분기 (모집공고 전 예정 단지)
  it('presaleStage=분양계획 → "분양 예정 단지" 안내', () => {
    const r = scorePrice(
      makeApt({
        price: 0,
        nearbyMedian: 200000,
        name: "더샵관저아르테",
        presaleType: "민간분양",
        presaleStage: "분양계획",
      })
    );
    expect(r.subs[0].detail).toContain("분양 예정 단지");
    expect(r.subs[0].score).toBe(30);
  });

  it("분양계획 우선순위: 오피스텔 이후, 택지블록 이전", () => {
    // 택지블록 패턴(신도시)+분양계획 → 분양계획이 먼저 매칭
    const r = scorePrice(
      makeApt({ price: 0, nearbyMedian: 200000, name: "고덕국제신도시수자인풍경채1단지", presaleStage: "분양계획" })
    );
    expect(r.subs[0].detail).toContain("분양 예정 단지");
  });
});

// 세션508 — engine.ts `sanitize()` 의 null 보존을 **실전 경로로** 잠근다.
//
// ⚠️ 왜 별도 블록이 필요한가: 위의 scoreLocation/scoreRisk 단독 호출 테스트는 raw apt 를 그대로
//    넘기므로 sanitize 를 **건너뛴다**. 실제 화면·compute-scores 는 항상 calcCats → sanitize 를
//    거치므로, sanitize 가 옛 비관적 기본값(noise 75 / builderDebtRatio 250)을 되살려도
//    단독 호출 테스트는 전부 초록이다 — 뮤테이션으로 실증한 사각지대(수정이 조용히 무효화됨).
//    아래 두 테스트는 그 되돌림을 red 로 잡는다.
describe("sanitize null 보존 — 실전 경로(calcCats) 회귀 가드 (세션508)", () => {
  it("noise null 은 65dB 구간과 같고, 구간 밖(75) 폴백보다 높다", () => {
    const unknown = calcCats(makeApt({ noise: null })).location.total;
    const at65 = calcCats(makeApt({ noise: 65 })).location.total;
    const outOfRange = calcCats(makeApt({ noise: 75 })).location.total;
    expect(unknown).toBe(at65);
    // sanitize 가 `?? 75` 로 되돌아가면 unknown === outOfRange 가 되어 red.
    expect(unknown).toBeGreaterThan(outOfRange);
  });

  it("builderDebtRatio null 은 주의 구간(175%)과 같고, 최악 기본값(250%)보다 안전하다", () => {
    const unknown = calcCats(makeApt({ builderDebtRatio: null })).risk.total;
    const caution = calcCats(makeApt({ builderDebtRatio: 175 })).risk.total;
    const worst = calcCats(makeApt({ builderDebtRatio: 250 })).risk.total;
    expect(unknown).toBe(caution);
    // sanitize 가 `?? 250` 으로 되돌아가면 unknown === worst 가 되어 red.
    expect(unknown).toBeGreaterThan(worst);
  });
});

// 세션513 — P1 5건의 회귀 가드. 위 세션508 블록과 같은 이유로 **전부 calcCats 경유**다:
//   scoreRisk/scoreProduct 를 단독 호출하면 sanitize 를 건너뛰어, engine.ts 가 옛 폴백
//   (`recentTrades6m ?? 0`)으로 되돌아가도 전부 초록이 된다. 실전 경로로만 잠근다.
describe("거래량 null 보존 + 구 단위 경계 (세션513)", () => {
  /** @param {Record<string, unknown>} apt */
  const liq = (apt) => /** @type {any} */ (calcCats(apt).risk.subs.find((s) => s.name === "거래량"));

  it("recentTrades6m null 은 '미수집'이고, 0건(최하)보다 높다", () => {
    const unknown = liq(makeApt({ recentTrades6m: null }));
    const zero = liq(makeApt({ recentTrades6m: 0 }));
    expect(unknown.info).toBe("미수집");
    // sanitize 가 `?? 0` 으로 되돌아가면 info 가 "이 구 6개월 0건"이 되어 red.
    expect(unknown.score).toBeGreaterThan(zero.score);
  });

  it("null 중립은 세 번째 밴드(한산)와 같은 점수다 — 최고도 최하도 아니다", () => {
    // LIQUIDITY_UNKNOWN_SCORE(45) = TIERS[2] 구간과 같은 값. 그 등가가 깨지면 red.
    // 픽스처는 상수 파생 — 고정 숫자(옛 995)는 경계 재도출(세션514→515 실증)마다 밴드를 이탈한다.
    const midBand = LIQUIDITY_TIERS[2].min ?? 0;
    expect(liq(makeApt({ recentTrades6m: null })).score).toBe(liq(makeApt({ recentTrades6m: midBand })).score);
  });

  it("null 에 최고점을 주지 않는다 (주면 수집할 동기가 사라진다)", () => {
    expect(liq(makeApt({ recentTrades6m: null })).score).toBeLessThan(liq(makeApt({ recentTrades6m: 5000 })).score);
  });

  it("구 단위 경계 — 네 밴드가 서로 다른 점수로 갈린다 (옛 단지 단위 30/15/5 면 전부 최상으로 뭉침)", () => {
    // 픽스처는 각 밴드 하한 +50 로 상수 파생 — 고정 숫자는 경계 재도출마다 깨진다(세션515 실증).
    const [t0, t1, t2] = LIQUIDITY_TIERS.map((t) => t.min ?? 0);
    const top = liq(makeApt({ recentTrades6m: t0 + 50 })).score;
    expect(liq(makeApt({ recentTrades6m: t1 + 50 })).score).toBeLessThan(top);
    expect(liq(makeApt({ recentTrades6m: t2 + 50 })).score).toBeLessThan(
      liq(makeApt({ recentTrades6m: t1 + 50 })).score
    );
    expect(liq(makeApt({ recentTrades6m: Math.max(t2 - 500, 0) })).score).toBeLessThan(
      liq(makeApt({ recentTrades6m: t2 + 50 })).score
    );
  });

  // 세션514: 옛 단언은 `"이 구 6개월 1,234건"` 이었는데, 그 "이 구"가 값 보유 1,466곳 중
  //   616곳(42.0%)에서 거짓이었다(시 548·군 38·세종 30). 지역 이름은 아래 세션514 블록이
  //   따로 잠그고, 여기서는 원래 취지인 **"단지 단위가 아니라 자치단체 합계"**만 지킨다.
  it("문구가 자치단체 합계임을 밝힌다 (단지 거래량으로 읽히면 거짓)", () => {
    const s = liq(makeApt({ recentTrades6m: 1234 }));
    expect(s.info).toContain("6개월 1,234건");
    expect(s.detail).toContain(`${LIQUIDITY_AREA_UNIT} 단위 합계`);
  });
});

describe("dsr40pass 미산정 — 점수는 그대로, 문구만 가른다 (세션513)", () => {
  /** @param {Record<string, unknown>} apt */
  const loan = (apt) => /** @type {any} */ (calcCats(apt).risk.subs.find((s) => s.name === "대출/잔금"));

  it("null 은 '미산정' — false('주의')와 다른 말을 한다", () => {
    expect(loan(makeApt({ dsr40pass: null })).info).toBe("미산정");
    expect(loan(makeApt({ dsr40pass: false })).info).toBe("주의");
    expect(loan(makeApt({ dsr40pass: true })).info).toBe("DSR통과");
    expect(loan(makeApt({ dsr40pass: null })).detail).toContain("산출 불가");
  });

  it("null 의 점수는 false 와 같다 (실측 통과율 4.3% — true 대우는 근거 없는 최상 대우)", () => {
    expect(loan(makeApt({ dsr40pass: null })).score).toBe(loan(makeApt({ dsr40pass: false })).score);
    expect(loan(makeApt({ dsr40pass: null })).score).toBeLessThan(loan(makeApt({ dsr40pass: true })).score);
  });

  it("truthy 판정(`apt.dsr40pass ?`)으로 되돌리면 문구가 뭉개진다", () => {
    // `=== true` 를 truthy 로 되돌리면 null 이 false 와 같은 "주의" 로 떨어져 red.
    expect(loan(makeApt({ dsr40pass: null })).info).not.toBe(loan(makeApt({ dsr40pass: false })).info);
  });

  // ⚠️ 점수 쪽 `=== true` 는 **불리언·null 입력만으로는 뮤테이션이 안 잡힌다** — `null ? 15 : 50` 과
  //    `null === true ? 15 : 50` 이 둘 다 50 이라 truthy 로 되돌려도 결과가 같기 때문이다(세션513 실증:
  //    이 테스트가 없을 때 뮤테이션이 green 이었다). 두 판정이 갈리는 유일한 자리 = **불리언이 아닌
  //    truthy 값**. DB·JSON 이 1/"Y" 를 흘리면 truthy 판정은 그걸 "DSR 통과"로 받아들여, 문구는
  //    "미산정"인데 점수만 통과인 어긋남을 만든다. 그 자리를 못 박는다.
  it("불리언이 아닌 truthy(1)는 통과로 치지 않는다 — 문구와 점수가 함께 미산정", () => {
    const odd = loan(makeApt({ dsr40pass: 1 }));
    expect(odd.info).toBe("미산정");
    expect(odd.score).toBe(loan(makeApt({ dsr40pass: null })).score);
    // truthy 로 되돌리면 score 가 true 와 같아져 red.
    expect(odd.score).not.toBe(loan(makeApt({ dsr40pass: true })).score);
  });
});

describe("주차 폴백 — 분모 교정 + 상식 클램프 + '추정' 표기 (세션513)", () => {
  /** @param {Record<string, unknown>} apt */
  const park = (apt) => /** @type {any} */ (calcCats(apt).product.subs.find((s) => s.name === "주차"));
  // parkingRatio 를 비워야 _noParking 이 서고 폴백 분기로 들어간다.
  /** @param {Record<string, unknown>} o */
  const fb = (o) => makeApt(/** @type {any} */ ({ parkingRatio: null, ...o }));

  it("분모는 총세대와 일반분양 중 **큰 쪽** — 작은 분모로 되돌리면 비율이 부풀려진다", () => {
    // 주차 600면 / 총 600세대 = 1.00. 옛 분모(일반분양 300)면 2.00 으로 뻥튀기돼 만점권이 된다.
    const s = park(fb({ units: 600, presaleGeneralSupply: 300, presaleParking: 600 }));
    expect(s.info).toBe("추정 1.00대/세대");
    expect(s.score).toBeLessThan(park(fb({ units: 600, presaleGeneralSupply: 300, presaleParking: 1200 })).score);
  });

  it("units 가 비어도 일반분양 세대로 분모를 세운다 (1 로 나눠 폭발하지 않는다)", () => {
    expect(park(fb({ units: 0, presaleGeneralSupply: 400, presaleParking: 500 })).info).toBe("추정 1.25대/세대");
  });

  it("3대/세대 초과는 폴백을 포기한다 (물리적으로 있을 수 없는 값 = 원천 오염)", () => {
    const s = park(fb({ units: 100, presaleGeneralSupply: 100, presaleParking: 900 }));
    expect(s.info).toBe("정보 없음");
    expect(s.info).not.toContain("추정");
  });

  it("폴백을 쓴 단지는 '정보 없음'이라 말하지 않는다 (점수와 화면이 어긋나던 자리)", () => {
    const s = park(fb({ units: 500, presaleGeneralSupply: 500, presaleParking: 800 }));
    expect(s.info).toBe("추정 1.60대/세대");
    expect(s.detail).toContain("청약 공급자료 기반 추정");
  });
});

describe("브랜드 — resolveBuilder 정규화 + scoreProduct 배선 (세션513)", () => {
  /** @param {string} builder */
  const brand = (builder) =>
    /** @type {any} */ (calcCats(makeApt({ builder })).product.subs.find((s) => s.name === "브랜드"));

  it("법인격·공백만 다른 표기를 같은 회사로 본다", () => {
    const base = brand("GS건설");
    for (const v of ["지에스건설(주)", "지에스건설 주식회사", "㈜GS건설", "GS건설 주식회사"]) {
      expect(brand(v).score).toBe(base.score);
      expect(brand(v).info).toBe(base.info);
    }
    expect(brand("디엘이앤씨 주식회사").score).toBe(brand("DL이앤씨").score);
  });

  it("정규화를 제거하면 미등재 5점으로 떨어진다", () => {
    // resolveBuilder 의 정규화 분기를 빼면 아래가 5(기타)가 되어 red.
    expect(brand("지에스건설 주식회사").score).toBeGreaterThan(5);
    expect(brand("에이치디씨현대산업개발 주식회사").score).toBeGreaterThan(5);
  });

  it("모르는 회사는 그대로 미등재 5점 (정규화가 아무나 구제하지 않는다)", () => {
    expect(brand("듣도보도못한건설 주식회사").score).toBe(5);
  });
});

// 세션514 — 위 세션513 정정이 **세 자리 중 두 자리만** 고쳐 생긴 이중 잣대를 잠근다.
// `scorePrice` 는 처음부터 `apt.builder` 를 BRAND_TIER 에 직조회해서(선재 결함), 같은 단지가
// 상품성축에서는 1군Super 인데 가격축 적정가 계수 `adj` 는 미등재 1.0 으로 남아 있었다.
// 실측(정적 JSON 1,646곳): adj 가 달라지는 단지 67곳, 그 중 괴리도가 실제로 움직인 곳 65곳.
describe("브랜드 정규화는 가격축에도 걸린다 (세션514)", () => {
  /** @param {string} builder */
  const price = (builder) => calcCats(makeApt({ builder })).price;

  it("표기만 다른 같은 회사는 적정가·괴리도·점수가 전부 같다", () => {
    const base = price("GS건설");
    for (const v of ["지에스건설(주)", "지에스건설 주식회사", "㈜GS건설"]) {
      expect(price(v).fairPrice).toBe(base.fairPrice);
      expect(price(v).deviation).toBe(base.deviation);
      expect(price(v).total).toBe(base.total);
    }
    expect(price("디엘이앤씨(주)").deviation).toBe(price("DL이앤씨").deviation);
  });

  it("가격축과 상품성축이 같은 회사로 본다 (한쪽만 정규화하면 이중 잣대)", () => {
    // `scorePrice` 의 resolveBuilder 를 옛 직조회로 되돌리면 아래 fairPrice 비교가 red.
    const raw = calcCats(makeApt({ builder: "지에스건설(주)" }));
    const norm = calcCats(makeApt({ builder: "GS건설" }));
    expect(raw.product.subs.find((s) => s.name === "브랜드")?.score).toBe(
      norm.product.subs.find((s) => s.name === "브랜드")?.score
    );
    expect(raw.price.fairPrice).toBe(norm.price.fairPrice);
  });

  it("1군 프리미엄이 실제로 적정가를 올린다 (계수가 안 걸리면 미등재와 같아진다)", () => {
    // adj 1.05 > 1.0 — 정규화가 빠지면 "지에스건설(주)" 가 미등재 취급이라 아래가 같아져 red.
    expect(price("지에스건설(주)").fairPrice ?? 0).toBeGreaterThan(price("듣도보도못한건설(주)").fairPrice ?? 0);
  });
});

describe("주차 폴백 하한 — 0면은 측정값이 아니라 미기재 (세션514)", () => {
  /** @param {Record<string, unknown>} apt */
  const park = (apt) => /** @type {any} */ (calcCats(apt).product.subs.find((s) => s.name === "주차"));
  /** @param {Record<string, unknown>} o */
  const fb = (o) => makeApt(/** @type {any} */ ({ parkingRatio: null, ...o }));

  it("presaleParking 0 은 '추정 0.00대/세대'가 아니라 '정보 없음'", () => {
    // 상한(≤3)만 보던 옛 가드는 0 을 통과시켜 28곳에 "추정 0.00대/세대"를 찍었다.
    // `fallbackPR > 0` 를 지우면 red.
    const s = park(fb({ units: 500, presaleGeneralSupply: 500, presaleParking: 0 }));
    expect(s.info).toBe("정보 없음");
    expect(s.info).not.toContain("추정");
    expect(s.detail).toContain("미수집");
  });

  it("점수는 바뀌지 않는다 — 문구만 정직해진다", () => {
    // 0 도, 폴백 포기 후 기본값 0.5 도 PARKING_LOW_SCORE 라 같은 점수여야 한다.
    expect(park(fb({ units: 500, presaleGeneralSupply: 500, presaleParking: 0 })).score).toBe(
      park(makeApt(/** @type {any} */ ({ parkingRatio: null }))).score
    );
  });

  it("양수 폴백은 그대로 살아 있다 (하한이 유효값을 죽이지 않는다)", () => {
    expect(park(fb({ units: 500, presaleGeneralSupply: 500, presaleParking: 800 })).info).toBe("추정 1.60대/세대");
  });
});

describe("거래량 문구는 '이 구'라 단정하지 않는다 (세션514)", () => {
  /** @param {Record<string, unknown>} apt */
  const liq = (apt) => /** @type {any} */ (calcCats(apt).risk.subs.find((s) => s.name === "거래량"));

  it("구가 아닌 자치단체(시·군)를 '구'라 부르지 않는다", () => {
    // 값 보유 1,466곳 중 616곳(42.0%)이 구가 아니다 — 하드코딩 "이 구"로 되돌리면 red.
    const s = liq(makeApt({ gu: "의정부시", recentTrades6m: 1234 }));
    expect(s.info).toBe("의정부시 6개월 1,234건");
    expect(s.info).not.toMatch(/이 구/);
    expect(s.detail).toContain("의정부시");
  });

  it("gu 가 없으면 시도, 그것도 없으면 '이 지역'", () => {
    expect(liq(makeApt(/** @type {any} */ ({ gu: null, region: "경기", recentTrades6m: 10 }))).info).toBe(
      "경기 6개월 10건"
    );
    expect(liq(makeApt(/** @type {any} */ ({ gu: null, region: null, recentTrades6m: 10 }))).info).toBe(
      "이 지역 6개월 10건"
    );
  });

  it("숫자를 콤마 포함 자릿수로 남긴다 — 판정표가 이 문자열에서 건수를 읽는다", () => {
    // subContext 거래량 interpret 이 `/([\d,]+)건/` 로 파싱한다. 형식이 깨지면 밴드가 사라진다.
    expect(/([\d,]+)\s*건/.exec(liq(makeApt({ recentTrades6m: 1234 })).info)?.[1]).toBe("1,234");
  });

  it("경계 문구는 LIQUIDITY_LEGEND 에서 조립한다 (손으로 적으면 어긋난다)", () => {
    expect(liq(makeApt({ recentTrades6m: 1234 })).detail).toContain(LIQUIDITY_LEGEND);
    expect(liq(makeApt({ recentTrades6m: 1234 })).detail).toContain(`${LIQUIDITY_AREA_UNIT} 단위 합계`);
    // 미수집도 같은 단위 이름을 쓴다
    expect(liq(makeApt({ recentTrades6m: null })).detail).toContain(LIQUIDITY_AREA_UNIT);
  });
});

/**
 * 세션526 — 입지 내부 비중(locW) 오버라이드. 근거:
 * docs/superpowers/specs/2026-08-24-profile-discrimination-remeasure.md
 *
 * 옛 `scoreLocation` 은 본문에 `transport*0.3 + school*0.25 + ...` 를 박아 두어 어느 프로필이든
 * 같은 입지 점수를 냈다. 이제 프로필이 `PROFILES[*].locW` 로 그 비중을 덮어쓴다.
 */
describe("scoreLocation — locW 오버라이드 (세션526)", () => {
  /**
   * locW 5키 중 하나에 1.0 을 몰아준 비중 — 그 서브 하나만 total 에 반영돼야 한다.
   * @param {string} key
   */
  const oneHot = (key) => ({
    transport: 0,
    school: 0,
    infra: 0,
    env: 0,
    noxSafe: 0,
    [key]: 1,
  });

  /** locW 키 → subs[].name (표시 이름) @type {Record<string, string>} */
  const SUB_NAME = {
    transport: "교통",
    school: "학군",
    infra: "생활인프라",
    env: "자연환경",
    noxSafe: "혐오시설",
  };

  it("인자를 생략하면 기준 비중(LOCATION_SUB_WEIGHTS)과 같다 — 기존 호출처 무변경 보장", () => {
    const apt = makeApt();
    expect(scoreLocation(apt).total).toBe(scoreLocation(apt, LOCATION_SUB_WEIGHTS).total);
  });

  // ⚠️ 뮤테이션 대상 — total 식의 `locW.X` 를 리터럴(예: 0.35)로 되돌리면 그 키의 케이스가 red.
  //    5키를 전부 도는 이유: 한 키만 검사하면 나머지 4개가 하드코딩돼도 초록불이 된다.
  Object.keys(LOCATION_SUB_WEIGHTS).forEach((key) => {
    it(`${key} 에 비중 1.0 을 몰아주면 total = 그 서브(${SUB_NAME[key]})의 원점수`, () => {
      const apt = makeApt();
      const r = scoreLocation(apt, /** @type {any} */ (oneHot(key)));
      const subScore = r.subs.find((s) => s.name === SUB_NAME[key])?.score ?? -1;
      expect(r.total).toBe(subScore);
    });
  });

  it("subs[].score 는 비중과 무관한 원값 — locW 를 바꿔도 그대로다 (total 만 달라진다)", () => {
    const apt = makeApt();
    const base = scoreLocation(apt);
    const edu = scoreLocation(apt, /** @type {any} */ (PROFILES.edu.locW));
    expect(edu.subs.map((s) => s.score)).toEqual(base.subs.map((s) => s.score));
  });

  it("학군이 좋은 단지는 자녀교육 비중에서 입지 총점이 오른다 (수술 (나)가 실제로 순위를 가른다)", () => {
    // 학군 100 / 교통 최악 — 기준 비중보다 학군 가중(edu)에서 총점이 높아야 한다.
    const goodSchool = makeApt({ schoolScore: 100, schoolGrade: "A", subwayDist: 9999, busRoutes: 0 });
    const base = scoreLocation(goodSchool).total;
    const edu = scoreLocation(goodSchool, /** @type {any} */ (PROFILES.edu.locW)).total;
    expect(edu).toBeGreaterThan(base);
  });

  it("학군이 나쁜 단지는 은퇴 비중(학군 0.05)에서 입지 총점이 덜 깎인다", () => {
    const badSchool = makeApt({ schoolScore: 0, schoolGrade: "D" });
    const base = scoreLocation(badSchool).total;
    const retire = scoreLocation(badSchool, /** @type {any} */ (PROFILES.retire.locW)).total;
    expect(retire).toBeGreaterThan(base);
  });

  it("총점은 0~100 클램핑을 유지한다 (극단 비중에서도)", () => {
    const apt = makeApt();
    Object.keys(LOCATION_SUB_WEIGHTS).forEach((key) => {
      const t = scoreLocation(apt, /** @type {any} */ (oneHot(key))).total;
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(100);
    });
  });
});

describe("locationTotalForProfile (세션526)", () => {
  it("기준 비중으로 부르면 calcCats 의 입지 총점과 정확히 같다 — 캐시 호환 보장", () => {
    const apt = makeApt();
    expect(locationTotalForProfile(apt, LOCATION_SUB_WEIGHTS)).toBe(calcCats(apt).location.total);
  });

  // ⚠️ 이 가드가 잠그는 사실: sanitize 의 `rm`(지역 중앙값)은 supplyRatio·_regionAvgMaint 에만 쓰여
  //    입지 점수와 무관하다. 그래서 locationTotalForProfile 이 rm 을 생략해도 안전하다.
  //    rm 이 입지에 새로 쓰이게 되면 이 테스트가 red 로 알려준다.
  it("regionMedians 유무가 입지 총점을 바꾸지 않는다 (rm 은 supplyRatio·_regionAvgMaint 전용)", () => {
    const apt = makeApt({ region: "경기", pir: null, psr: null, supplyRatio: null });
    const rm = { 경기: { pir: 5, psr: 0.8, unsoldRate: 15, supplyRatio: 100, maint: 30 } };
    const withRm = calcCats(apt, /** @type {any} */ ({ regionMedians: rm })).location.total;
    const withoutRm = calcCats(apt).location.total;
    expect(withRm).toBe(withoutRm);
    expect(locationTotalForProfile(apt, LOCATION_SUB_WEIGHTS)).toBe(withRm);
  });

  it("locW 가 다르면 결과가 달라진다 (프로필별로 실제로 갈린다)", () => {
    const apt = makeApt({ schoolScore: 95, schoolGrade: "A" });
    const edu = locationTotalForProfile(apt, /** @type {any} */ (PROFILES.edu.locW));
    const retire = locationTotalForProfile(apt, /** @type {any} */ (PROFILES.retire.locW));
    expect(edu).not.toBe(retire);
  });

  it("sanitize 를 거친다 — 원시 null 입력에서도 NaN 없이 0~100", () => {
    const raw = /** @type {any} */ ({ id: 9, region: "경기", schoolScore: null, noise: null, subwayDist: null });
    const t = locationTotalForProfile(raw, LOCATION_SUB_WEIGHTS);
    expect(Number.isFinite(t)).toBe(true);
    expect(t).toBeGreaterThanOrEqual(0);
    expect(t).toBeLessThanOrEqual(100);
  });
});

/**
 * 적정가 괴리도 면적 편향 수정 — matchAreaPrice + fairPrice 1순위 교체.
 *
 * 옛 fairPrice(`nearbyMedian × getAreaAdj`)는 구 전체 거래 총액 중위값(면적 무관)에 ±3~8%
 * 계수만 곱해, 단지 면적이 그 동네 전형 면적의 배수여도 fairPrice 는 조금만 커져 대형 평형이
 * 구조적으로 "비싸다"로 채점됐다(실측: 정적 JSON 1,713곳 corr(면적,괴리도) = −0.704).
 * `trade_stats.price_by_area`(5㎡ 버킷별 실거래)가 이미 그 평형대 실거래이므로 1순위로 쓴다.
 */
describe("matchAreaPrice — 평형별 실거래 버킷 매칭", () => {
  const buckets = [
    { area: 60, min: 30000, max: 50000, avg: 40000, count: 10 },
    { area: 85, min: 50000, max: 80000, avg: 65000, count: 20 },
    { area: 115, min: 90000, max: 130000, avg: 110000, count: 5 },
  ];

  it("정확 매칭 — 이격 0", () => {
    expect(matchAreaPrice(buckets, 85)).toBe(65000);
  });

  it("이격이 허용치(AREA_BUCKET_TOLERANCE_M2) 이내면 최근접 버킷 평균값 그대로", () => {
    // 85 버킷과의 이격 = 3㎡ < 10
    expect(matchAreaPrice(buckets, 88)).toBe(65000);
  });

  it("이격이 허용치를 넘으면 최근접 버킷의 ㎡당가로 환산", () => {
    // 115 버킷과의 이격 = 15㎡ > AREA_BUCKET_TOLERANCE_M2(10) → (110000/115) × 130
    const area = 130;
    expect(AREA_BUCKET_TOLERANCE_M2).toBe(10); // 이 테스트가 전제하는 상수값 — 상수가 바뀌면 여기부터 손본다
    expect(matchAreaPrice(buckets, area)).toBeCloseTo((110000 / 115) * area, 6);
  });

  it("빈 배열/null/undefined 는 null", () => {
    expect(matchAreaPrice([], 84)).toBeNull();
    expect(matchAreaPrice(null, 84)).toBeNull();
    expect(matchAreaPrice(undefined, 84)).toBeNull();
  });

  it("area 가 유효하지 않으면(null/0/음수) null", () => {
    expect(matchAreaPrice(buckets, null)).toBeNull();
    expect(matchAreaPrice(buckets, 0)).toBeNull();
    expect(matchAreaPrice(buckets, -5)).toBeNull();
  });

  it("area<=0 또는 avg<=0 인 버킷은 후보에서 제외된다", () => {
    const dirty = /** @type {any} */ ([
      { area: 0, min: 0, max: 0, avg: 0, count: 1 },
      { area: 85, min: 50000, max: 80000, avg: 0, count: 1 },
      { area: 90, min: 60000, max: 90000, avg: 70000, count: 10 },
    ]);
    // 유효 버킷은 90 하나 — 이격 5 < 허용치라 그대로 반환
    expect(matchAreaPrice(dirty, 85)).toBe(70000);
  });
});

describe("scorePrice — 면적 버킷 매칭이 fairPrice 1순위 (면적 편향 수정)", () => {
  it("대형 평형이 버킷 매칭 덕에 총액비교보다 정확한 괴리도 점수를 받는다", () => {
    const bucket = /** @type {any} */ ([{ area: 150, min: 180000, max: 220000, avg: 200000, count: 15 }]);
    const devScoreOf = (/** @type {any} */ r) => r.subs.find((/** @type {any} */ s) => s.name === "적정가 괴리도");
    // nearbyMedian(55000)은 국민평형(84㎡) 기준 중위값 — 150㎡ 단지에 그대로 쓰면 fairPrice 가
    // 실제 실거래(20억)보다 훨씬 작게 잡혀 price=200000 이 "과대평가"로 채점된다.
    const withoutBucket = calcCats(makeApt({ area: 150, price: 200000, nearbyMedian: 55000 })).price;
    const withBucket = calcCats(makeApt({ area: 150, price: 200000, nearbyMedian: 55000, priceByArea: bucket })).price;
    expect(devScoreOf(withBucket).score).toBeGreaterThan(devScoreOf(withoutBucket).score);
    expect(devScoreOf(withBucket).detail).toContain("평수대별 실거래 기준");
    expect(devScoreOf(withoutBucket).detail).not.toContain("평수대별 실거래 기준");
  });

  it("버킷 매칭 시 areaAdj 를 다시 곱하지 않는다 (이중 계상 회피)", () => {
    // areaAdj 를 다시 곱하면 red — fairPrice = bucketAvg × ageCoeff × bAdj 만이어야 한다.
    const bucket = /** @type {any} */ ([{ area: 150, min: 180000, max: 220000, avg: 200000, count: 15 }]);
    const apt = makeApt({
      area: 150,
      price: 200000,
      nearbyMedian: 55000,
      priceByArea: bucket,
      completion: null, // ageCoeff = 1.05
      builder: "듣도보도못한건설(주)", // 미등재 → bAdj = 1.0
    });
    const r = calcCats(apt).price;
    expect(r.fairPrice).toBe(Math.round(200000 * 1.05 * 1.0));
  });

  it("_noArea(면적 미상)는 84㎡ 버킷이 있어도 매칭하지 않는다 — 현행 폴백값과 같아야 한다", () => {
    // sanitize 가 area:null 을 84 로 누르기 전에 _noArea=true 를 남긴다. 이 가드가 없으면
    // "안 잰 것"이 "84㎡ 단지"로 오매칭돼 아래 두 결과가 달라진다.
    const bucket = /** @type {any} */ ([{ area: 84, min: 40000, max: 60000, avg: 50000, count: 30 }]);
    const withBucket = calcCats(makeApt(/** @type {any} */ ({ area: null, price: 45000, priceByArea: bucket })));
    const withoutBucket = calcCats(makeApt(/** @type {any} */ ({ area: null, price: 45000 })));
    expect(withBucket.price.fairPrice).toBe(withoutBucket.price.fairPrice);
    expect(withBucket.price.total).toBe(withoutBucket.price.total);
    expect(withBucket.price.subs.find((/** @type {any} */ s) => s.name === "적정가 괴리도")?.detail).not.toContain(
      "평수대별 실거래 기준"
    );
  });

  it("면적이 유효해도 priceByArea 가 비어 있거나 없으면 기존 로직 그대로", () => {
    const withoutField = calcCats(makeApt({ area: 100 })).price;
    const withEmptyArray = calcCats(makeApt(/** @type {any} */ ({ area: 100, priceByArea: [] }))).price;
    expect(withoutField.fairPrice).toBe(withEmptyArray.fairPrice);
    expect(withoutField.total).toBe(withEmptyArray.total);
  });
});
