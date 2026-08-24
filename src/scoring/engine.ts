import { PROFILES } from "@/constants/profiles";
import { scorePrice, getAgeCoeff, getAreaAdj, matchAreaPrice, isPresale } from "./scorePrice";
import { scoreLocation } from "./scoreLocation";
import { scoreProduct } from "./scoreProduct";
import { scoreBenefit } from "./scoreBenefit";
import { scoreRisk } from "./scoreRisk";
import { scoreFuture } from "./scoreFuture";
import { computeRegionalMedians } from "./computeRegionalMedians";
import type { LocationSubWeights } from "@/constants/scoringTiers";
import type { Apt, Cats, Profile, ProfileWeights, ScoringContext, Res } from "@/types/scoring";

type RegionMedian = NonNullable<ScoringContext["regionMedians"]>[string];

/**
 * null 안전 레이어 + 한글 NFC 정규화.
 * 위험 필드 null → 비관적 기본값(dataReliability:30).
 * 단 unsoldRate 는 null 보존(세션 445) — 100% 초과 폭발값 무력화분을 지역 중위값으로 되채우지 않고
 *   scoreRisk 가 "미분양률 미확인=중립"으로 처리하게 둔다.
 * 단 builderDebtRatio·noise 도 null 보존(세션508) — "모르는 것을 나쁘게 단정하는" 비관적 기본값
 *   (구 builderDebtRatio:250, noise:75)을 제거. scoreRisk/scoreLocation 이 null=중립으로 처리한다.
 *   supplyRatio 도 이미 null 보존(세션501, 폴백 150 제거) — 위 "위험 필드" 기본값 목록에서 제외.
 * 혜택 필드 null → 0, 가격/시장 필드 null → null 유지 (서브스코어 내부에서 재평가).
 * rm(regionMedians[region]) 우선 → 지역 중위값으로 위험 필드 폴백(unsoldRate 제외).
 * `??` 전용 (||는 0/"" 오판 유발로 금지, src/scoring/CLAUDE.md).
 */
function sanitize(apt: Apt, rm?: RegionMedian): Apt {
  const str = (v: unknown, fallback = ""): string => (v ?? fallback).toString().trim().normalize("NFC");
  const num = <T extends number | null>(v: unknown, fallback: T): number | T => {
    const n = Number(v);
    return v == null || Number.isNaN(n) ? fallback : n;
  };
  return {
    ...apt,
    // 위험 필드 → 지역 중위값 우선, 없으면 비관적 기본값
    pir: num(apt.pir, null),
    psr: num(apt.psr, null),
    // unsoldRate null 보존 (세션 445): 지역 중위값 되채움 금지. null = "미분양률 미확인"
    //   → scoreRisk 가 units<=1 과 동일하게 중립(UNSOLD_UNKNOWN_SCORE) 처리. 100% 초과 폭발값을
    //   VIEW/JSON 에서 null 로 무력화한 단지가 지역 중위값 기반 임의 등급으로 오채점되던 것 방지.
    unsoldRate: num(apt.unsoldRate, null),
    // 세션513: 폴백 0 제거. 옛 값은 미수집 180곳(정적 JSON 1,646 중 10.9%)에 "6개월 0건"이라는
    //   측정하지도 않은 사실을 만들어 LIQUIDITY_LOW_SCORE(80, 최하)로 채점했다. 위 unsoldRate(세션445)·
    //   builderDebtRatio/noise(세션508)와 같은 결 — null → scoreRisk 가 LIQUIDITY_UNKNOWN_SCORE(중립)로 처리.
    recentTrades6m: num(apt.recentTrades6m, null),
    cancelRatio6m: num(apt.cancelRatio6m, null),
    competitionRate: num(apt.competitionRate, null),
    crimeSafetyGrade: apt.crimeSafetyGrade != null ? num(apt.crimeSafetyGrade, null) : null,
    // 세션508: 폴백 250 제거. 옛 값은 "부채율 250%(최악 구간)"로 실제 채점했는데, 미수집 사유의
    // 57.1%가 공기업·신탁·조합류(애초에 그 잣대의 대상이 아님)였다. null → scoreRisk 가
    // BUILDER_DEBT_UNKNOWN_ADJ(중립 +10)로 처리.
    builderDebtRatio: num(apt.builderDebtRatio, null),
    // 세션 501: 폴백 150 제거. 이 필드는 이제 **인허가율**(연간 인허가÷가구수, 실측 0.09~3.0%)이라
    // 150 은 스케일이 맞지 않는다 — 그대로 두면 데이터가 없는 단지마다 PERMIT_RATIO_HIGH(2.2)를
    // 넘겨 "미래 공급 과잉" 보정이 상시 걸린다. 없으면 null → 보정 자체를 하지 않는다.
    // (주 지표인 주택보급률의 비관적 폴백은 scoreRisk 의 HOUSING_SUPPLY_UNKNOWN_SCORE 가 담당.)
    supplyRatio: num(apt.supplyRatio, rm?.supplyRatio ?? null),
    popGrowth: apt.popGrowth != null ? num(apt.popGrowth, null) : null,
    netMigration: apt.netMigration != null ? num(apt.netMigration, null) : null,
    dataReliability: num(apt.dataReliability, 30),
    // 가격/시장 필드
    jeonseRate: num(apt.jeonseRate, null),
    nearbyMedian: num(apt.nearbyMedian, null),
    price: num(apt.price, 0),
    // area 를 84 로 누르기 전에 사실을 남긴다(세션508 `_no*` 관례) — scorePrice 의 평형별
    // 실거래 버킷 매칭이 "안 잰 것"을 "84㎡ 단지"로 오매칭하지 않게 하기 위함.
    _noArea: apt.area == null || !(Number(apt.area) > 0),
    area: num(apt.area, 84),
    // 교통 필드
    subwayDist: num(apt.subwayDist, 9999),
    busRoutes: num(apt.busRoutes, 0),
    icDist: num(apt.icDist, 99),
    ktxDist: num(apt.ktxDist, 99),
    // 인프라 필드
    // 세션508: 폴백 75 제거 — NOISE_TIERS 최대(70)보다 커서 fallback 0점(최하)으로 떨어졌었다.
    // null → scoreLocation 이 NOISE_UNKNOWN_SCORE(중립 15점)로 처리.
    noise: num(apt.noise, null),
    hospital: num(apt.hospital, 0),
    mart: num(apt.mart, 0),
    conv: num(apt.conv, 0),
    park: num(apt.park, 0),
    cafe: num(apt.cafe, 0),
    culture: num(apt.culture, 0),
    bank: num(apt.bank, 0),
    pharmacy: num(apt.pharmacy, 0),
    // 혜택 필드 → 0
    discountPct: num(apt.discountPct, 0),
    loanFreePct: num(apt.loanFreePct, 0),
    optionValue: num(apt.optionValue, 0),
    balconyValue: num(apt.balconyValue, 0),
    cashback: num(apt.cashback, 0),
    // 상품성 필드
    units: num(apt.units, 0),
    parkingRatio: num(apt.parkingRatio, 0.5),
    floorAreaRatio: num(apt.floorAreaRatio, 300),
    exclusiveRatio: num(apt.exclusiveRatio, 60),
    maxFloor: num(apt.maxFloor, 10),
    devDist: num(apt.devDist, 99),
    // 한글 문자열 NFC 정규화 (API-2)
    region: str(apt.region),
    gu: str(apt.gu),
    builder: str(apt.builder, "기타"),
    transitDev: str(apt.transitDev),
    cityDev: str(apt.cityDev),
    industryDev: str(apt.industryDev),
    view: str(apt.view),
    sunlight: str(apt.sunlight),
    schoolGrade: str(apt.schoolGrade),
    // 관리비/방향 (Phase 4 수집 데이터)
    avgMaintenanceCost: num(apt.avgMaintenanceCost, 0),
    primaryDirection: str(apt.primaryDirection, ""),
    _regionAvgMaint: num(rm?.maint, 0),
    // 신규 스코어링 필드 (세션66)
    initialSaleRate: num(apt.initialSaleRate, null),
    landCostRatio: num(apt.landCostRatio, null),
    priceIndex: num(apt.priceIndex, null),
    avgPriceSqm: num(apt.avgPriceSqm, null),
    presalePp: num(apt.presalePp, null),
    presaleParking: num(apt.presaleParking, null),
    presaleGeneralSupply: num(apt.presaleGeneralSupply, null),
    naverSellCount: num(apt.naverSellCount, null),
    naverSchoolWalkMin: num(apt.naverSchoolWalkMin, null),
    // 원본 null 여부 플래그 (표시용)
    _noView: apt.view == null || apt.view === "",
    _noNoise: apt.noise == null,
    // 세션98: bus_routes는 api/CLAUDE.md "위험 필드 null→비관적 기본값" 규칙으로
    // apartments.js에서 `?? 0` 처리됨 → null 판정 불가.
    // 수집 성공 여부는 busStopNames(수집기가 실패 시 null 저장) 기준으로 판정.
    _noBus: apt.busStopNames == null,
    _noParking: apt.parkingRatio == null,
    // 0 은 실제 0 이 아니라 미수집 — 용적률·전용률은 물리적으로 0 일 수 없다(세션 488 감사:
    // 용적률 0% 가 "쾌적한 밀도"로 칭찬되던 사고). null 뿐 아니라 0 도 "없음"으로.
    _noFar: apt.floorAreaRatio == null || apt.floorAreaRatio === 0,
    _noExcl: apt.exclusiveRatio == null || apt.exclusiveRatio === 0,
    _noFloor: apt.maxFloor == null,
    _noSunlight: apt.sunlight == null || apt.sunlight === "",
    // 혜택 3필드는 위에서 null→0 으로 눌리므로, 엔진이 "안 재봄"과 "재보니 0"을 구분하려면
    // 누르기 **전에** 그 사실을 남겨야 한다. 없으면 미수집을 "없음"이라 단정하게 된다(세션512).
    _noDiscount: apt.discountPct == null,
    _noCashback: apt.cashback == null,
    _noMaint: apt.avgMaintenanceCost == null,
  };
}

/**
 * 6개 카테고리 점수 계산 (가격/입지/상품/혜택/안전도/미래가치).
 * 각 scoreX() 는 내부 가중치 합 1.00, total 0~100 클램핑.
 * safe() 폴백: 개별 카테고리 함수 throw 시 total=0 + 빈 subs. 전체 파이프라인 보호.
 */
export function calcCats(apt: Apt, ctx?: ScoringContext): Cats {
  const region = (apt.region as string) || "";
  const rm = ctx?.regionMedians?.[region];
  const a = sanitize(apt, rm);
  const safe = (fn: () => Res): Res => {
    try {
      return fn();
    } catch (e) {
      const msg = (e as { message?: string } | null)?.message ?? e;
      console.error("[scoring] safe() caught:", msg);
      return { total: 0, subs: [], totalWon: 0, rate: "0", deviation: 0, fairPrice: 0, riskRaw: 0 };
    }
  };
  return {
    price: { ...safe(() => scorePrice(a)), label: "가격 매력도", key: "price" },
    location: { ...safe(() => scoreLocation(a)), label: "입지·생활권", key: "location" },
    product: { ...safe(() => scoreProduct(a)), label: "상품성", key: "product" },
    benefit: { ...safe(() => scoreBenefit(a)), label: "혜택·할인", key: "benefit" },
    risk: { ...safe(() => scoreRisk(a)), label: "안전도", key: "risk" },
    future: { ...safe(() => scoreFuture(a)), label: "미래가치", key: "future" },
  };
}

/**
 * 프로필별 입지 총점만 다시 계산한다 (세션526 — 프로필 변별력 수술 (나)).
 *
 * `catsCache`(서버가 구워 보내는 캐시)는 기준 비중으로 계산돼 있어 프로필과 무관하다.
 * `locW` 를 가진 프로필(신혼·자녀교육·은퇴)은 화면에서 이 함수로 입지 총점만 갈아끼운다
 * — 나머지 5개 카테고리와 캐시 구조는 건드리지 않으므로 캐시 호환이 유지된다.
 *
 * ⚠️ `rm`(지역 중앙값) 인자를 생략하는 이유: `sanitize` 안에서 `rm` 이 쓰이는 자리는
 * `supplyRatio`(→ scoreRisk)와 `_regionAvgMaint`(→ scoreBenefit **하나뿐**, 전수 grep 확인)이라
 * 입지 점수에는 영향이 0 이다. `engine.test.js` 가 rm 유무로 입지 총점이 같음을 잠근다.
 */
export function locationTotalForProfile(apt: Apt, locW: LocationSubWeights): number {
  return scoreLocation(sanitize(apt), locW).total;
}

/**
 * 종합 점수 계산. profile 가중치(PROFILES[profile].w, 합계 100) 로 6카테고리 가중 평균.
 * 클램핑: Math.max(0, Math.min(total, 100)) — 카테고리 total 이 100 초과해도 최종 100 상한.
 * Number.isFinite 가드: NaN/Infinity 서브스코어는 0 처리 (전체 점수 오염 방지).
 *
 * @example
 *   // 가중치 불변식: Object.values(weights).reduce((a,b) => a+b) === 100
 *   const { total, cats, weights } = calcAll(apt, "live", { regionMedians });
 */
export function calcAll(
  apt: Apt,
  profile: Profile | string,
  ctx?: ScoringContext
): {
  total: number;
  cats: Cats;
  weights: ProfileWeights;
} {
  const profiles = PROFILES as Record<string, { w: ProfileWeights }>;
  const w = profiles[profile]?.w || profiles.live.w;
  const cats = calcCats(apt, ctx);
  const total = (Object.keys(cats) as Array<keyof Cats>).reduce((s, k) => {
    const ct = cats[k].total;
    return s + (Number.isFinite(ct) ? (ct * w[k as keyof ProfileWeights]) / 100 : 0);
  }, 0);
  return { total: Math.round(Math.max(0, Math.min(total, 100))), cats, weights: w };
}

// re-export: 기존 @/scoring/engine import 경로 호환성 유지
export {
  getAgeCoeff,
  getAreaAdj,
  matchAreaPrice,
  isPresale,
  scorePrice,
  scoreLocation,
  scoreProduct,
  scoreBenefit,
  scoreRisk,
  scoreFuture,
  computeRegionalMedians,
};
