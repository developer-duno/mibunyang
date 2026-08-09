/**
 * 스코어링 도메인 타입 (M1 a-2).
 *
 * scoring/* 모듈이 import 하여 .ts 변환 시 함수 시그니처에 사용.
 * 모든 필드 optional — sanitize() 가 null 폴백 처리하므로 호출처는 부분 객체도 안전.
 *
 * src/scoring/CLAUDE.md 의 함수 시그니처 표 + engine.js JSDoc 기반.
 */

/**
 * 단지별 1km 내 어린이집 상세 1건 — apt.nearbyChildcare 원소 (세션 257 W6-D2).
 *
 * collect-nearby-childcare.mjs 가 regions.childcare.facilities[] 에서 Haversine 으로 골라 채움.
 * 기초 필드(name/distance/capacity)는 항상, 70 필드(type/cctv/enrolled/status/dataStdDate/detail)는
 * childcare-detail cron 미도달 시군구면 null/빈 객체.
 */
export interface NearbyChildcare {
  name: string;
  distance: number;
  capacity?: number | null;
  type?: string | null;
  enrolled?: number | null;
  cctv?: number | null;
  status?: string | null;
  dataStdDate?: string | null;
  detail?: Record<string, unknown> | null;
}

/**
 * 원본 아파트 객체 (DB SELECT 또는 sanitize 결과).
 *
 * sanitize() 후의 a 객체 = 모든 위험·가격·인프라 필드 num()/str() 처리 완료.
 * 본 타입은 sanitize 입력·출력 둘 다 커버 (보수적 partial).
 */
export interface Apt {
  // 식별자
  id?: string;
  name?: string;

  // 위치
  region?: string;
  gu?: string;

  // 가격·시장 (sanitize 후 num)
  price?: number;
  area?: number;
  pir?: number | null;
  psr?: number | null;
  jeonseRate?: number | null;
  nearbyMedian?: number | null;
  avgPriceSqm?: number | null;
  presalePp?: number | null;
  priceIndex?: number | null;
  landCostRatio?: number | null;

  // 위험 (sanitize 후 num + 비관 폴백)
  // unsold = 미분양 세대 수(원시), unsoldRate = 미분양률(%). 100% 초과 폭발값은 null 로 무력화(세션 445).
  //   "미분양 단지 여부" 판정은 unsoldRate(null 가능) 가 아니라 unsold(수) 로 해야 함(R1/R2 회귀 가드).
  unsold?: number | null;
  unsoldRate?: number | null;
  recentTrades6m?: number;
  cancelRatio6m?: number | null;
  competitionRate?: number | null;
  // 청약홈 잔여세대 경쟁률 동반 필드 (정보성 — 스코어링 미사용, sanitize 무관)
  competitionSupply?: number | null;
  competitionApplicants?: number | null;
  crimeSafetyGrade?: number | null;
  /** 세션508: 폴백 250 제거, null 보존(모름=중립). scoreRisk 가 BUILDER_DEBT_UNKNOWN_ADJ 처리. */
  builderDebtRatio?: number | null;
  /** 인허가율(연간 인허가 호수 ÷ 가구수, %). 세션501: 폴백 150 제거로 null 이 정상값이 됐다. */
  supplyRatio?: number | null;
  _fallbackSupplyRatio?: boolean;
  _fallbackBuilderDebt?: boolean;
  popGrowth?: number | null;
  netMigration?: number | null;
  housingSupplyLevel?: number | null;
  dataReliability?: number;
  initialSaleRate?: number | null;
  isRegulated?: boolean | null;
  naverSellCount?: number | null;

  // 교통
  subwayDist?: number;
  busRoutes?: number;
  busStopNames?: string[] | null;
  icDist?: number;
  ktxDist?: number;

  // 인프라
  /** 세션508: 폴백 75 제거, null 보존(모름=중립). scoreLocation 이 NOISE_UNKNOWN_SCORE 처리. */
  noise?: number | null;
  hospital?: number;
  hospitalDist?: number;
  mart?: number;
  conv?: number;
  park?: number;
  parkDist?: number;
  cafe?: number;
  culture?: number;
  bank?: number;
  pharmacy?: number;

  // 혜택
  /** 세션508: 폴백 false 제거, null 보존(모름=페널티 없음). scoreRisk 가 `=== false` 만 불이익 처리. */
  loanFree?: boolean | null;
  loanFreePct?: number;
  discountPct?: number;
  optionFree?: boolean;
  optionValue?: number;
  balconyFree?: boolean;
  balconyValue?: number;
  cashback?: number;

  // 상품성
  units?: number;
  parkingRatio?: number;
  floorAreaRatio?: number;
  exclusiveRatio?: number;
  maxFloor?: number;
  devDist?: number;
  presaleParking?: number | null;
  presaleGeneralSupply?: number | null;
  presaleHousingType?: string | null;
  presaleInquiry?: string | null;

  // 관리비·방향·연식·브랜드
  avgMaintenanceCost?: number;
  primaryDirection?: string;
  builder?: string;
  completion?: string | null;

  // 환경·교육
  view?: string;
  sunlight?: string;
  schoolGrade?: string;
  naverSchoolWalkMin?: number | null;
  nearbyChildcare?: NearbyChildcare[] | null;

  // 미래가치 (개발)
  transitDev?: string;
  cityDev?: string;
  industryDev?: string;
  presaleType?: string | null;
  presaleStage?: string | null;
  newSupply?: number;

  // sanitize 내부 플래그
  _regionAvgMaint?: number;
  _noView?: boolean;
  _noNoise?: boolean;
  _noBus?: boolean;
  _noParking?: boolean;
  _noFar?: boolean;
  _noExcl?: boolean;
  _noFloor?: boolean;
  _noSunlight?: boolean;

  // 추가 필드 (도메인 확장 — strict 회피)
  [key: string]: unknown;
}

/**
 * 단일 카테고리 점수 결과 (모든 scoreXxx 함수의 공통 반환).
 * scorePrice 는 fairPrice/deviation/fairPriceFromSidoAvg 추가, scoreBenefit 은 totalWon/rate/noData 추가.
 */
export interface Res {
  total: number;
  subs: Array<SubScore>;
  // scorePrice
  fairPrice?: number;
  deviation?: string | number;
  fairPriceFromSidoAvg?: boolean;
  // scoreBenefit
  totalWon?: number;
  rate?: string;
  noData?: boolean;
  // calcCats 가 추가
  label?: string;
  key?: string;
  // 다른 도메인별 필드
  [key: string]: unknown;
}

export interface SubScore {
  name: string;
  score: number;
  info?: string;
  detail?: string;
  // scorePrice/Location 등 도메인별 추가 필드
  [key: string]: unknown;
}

/**
 * calcCats 반환 — 6개 카테고리 점수.
 */
export interface Cats {
  price: Res;
  location: Res;
  product: Res;
  benefit: Res;
  risk: Res;
  future: Res;
}

/**
 * PROFILES 의 키 (가중치 프로필 5종).
 * src/constants/profiles.js 의 PROFILES 키.
 */
export type Profile = "live" | "invest" | "newlywed" | "edu" | "retire";

/**
 * PROFILES[profile].w — 6 카테고리 가중치.
 * **불변식**: Object.values(w).reduce((a,b) => a+b) === 100
 * (런타임 검증: WeightEditor.test.jsx L165, subContext.test.js, engine.test.js)
 */
export interface ProfileWeights {
  price: number;
  location: number;
  product: number;
  benefit: number;
  risk: number;
  future: number;
}

/**
 * calcAll/calcCats 의 ctx 인자 — 지역 중위값 맵.
 * computeRegionalMedians(apartments) 의 반환을 그대로 받음.
 */
export interface ScoringContext {
  regionMedians?: Record<
    string,
    {
      pir: number | null;
      psr: number | null;
      unsoldRate: number | null;
      supplyRatio: number | null;
      maint: number | null;
    }
  >;
}
