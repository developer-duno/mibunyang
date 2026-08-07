/**
 * 스코어링 엔진 룩업 테이블
 *
 * engine.js의 인라인 매직넘버를 명명된 상수로 추출.
 * 모든 수치는 기존과 100% 동일. 가중치 합계 불변.
 */

export type Tier = { max?: number; min?: number; score: number };

// === 헬퍼: 하향 임계값 매칭 ===
/** value <= max 조건으로 첫 매칭 반환 */
export const tierMax = (v: number, tiers: readonly Tier[], fallback = 0): number => {
  for (const t of tiers) if (t.max != null && v <= t.max) return t.score;
  return fallback;
};
/** value >= min 조건으로 첫 매칭 반환 */
export const tierMin = (v: number, tiers: readonly Tier[], fallback = 0): number => {
  for (const t of tiers) if (t.min != null && v >= t.min) return t.score;
  return fallback;
};

// === Location: 교통 ===
export const SUBWAY_DIST_TIERS: Tier[] = [
  { max: 300, score: 25 },
  { max: 500, score: 21 },
  { max: 700, score: 16 },
  { max: 1000, score: 11 },
  { max: 1500, score: 6 },
];
// 버스 만점 기준 = 반경 500m 안 **고유** 정류장 개수. 15 → 20 정정(세션498).
// 근거: 전 단지 2,635곳 실측 분포 = 중앙값 10 · p75 16 · p90 20 · p95 24 · 최대 49.
// 만점 도달 비율이 기준 15 면 30.2%(세 곳 중 한 곳이 동점 → 도심끼리 변별 불가), 20 이면
// 13.9%, 25 면 4.4%. 비교 엔진이므로 상위 10%대만 만점을 받는 20 을 택했다.
// ⚠️ scripts/collectors/transport-tago.mjs 의 BUS_UNIQUE_CAP(수집 상한)과 같아야 만점 도달이
// 가능하다 — 동기화는 transport-tago.test.mjs 가 가드한다.
export const FULL_BUS_ROUTES = 20;
export const IC_DIST_TIERS: Tier[] = [
  { max: 2, score: 20 },
  { max: 5, score: 14 },
  { max: 10, score: 8 },
];
export const KTX_DIST_TIERS: Tier[] = [
  { max: 5, score: 20 },
  { max: 10, score: 12 },
  { max: 15, score: 6 },
];

// === Location: 인프라 가중치 ===
export const INFRA_CONFIG: { key: string; max: number; weight: number }[] = [
  { key: "hospital", max: 5, weight: 0.16 },
  { key: "mart", max: 3, weight: 0.08 },
  { key: "conv", max: 10, weight: 0.04 },
  { key: "park", max: 4, weight: 0.12 },
  { key: "cafe", max: 20, weight: 0.12 },
  { key: "culture", max: 3, weight: 0.12 },
  { key: "bank", max: 4, weight: 0.04 },
  { key: "pharmacy", max: 4, weight: 0.12 },
  { key: "childcare", max: 5, weight: 0.1 },
  { key: "emergency", max: 3, weight: 0.1 },
];

// === Location: 환경 ===
export const VIEW_SCORES: Record<string, number> = { 블루: 40, 그린: 30, 천공: 20 };
export const SUNLIGHT_SCORES: Record<string, number> = { 우수: 30, 양호: 22 };
export const SUNLIGHT_DEFAULT = 15;
export const SUNLIGHT_NO_DATA = 22;
// 방향별 일조 보정 보너스 (환경 서브스코어 내 가산)
export const DIRECTION_BONUS: Record<string, number> = {
  남향: 8,
  남동향: 6,
  남서향: 6,
  동향: 3,
  서향: 2,
  동남향: 6,
  서남향: 6,
  북동향: 1,
  북서향: 1,
  북향: 0,
};
export const SUNLIGHT_DIRECTION_MAX = 38; // 일조(30) + 방향 보너스(8) 상한
export const WON_TO_MANWON = 10000; // 원 → 만원 변환
export const NOISE_TIERS: Tier[] = [
  { max: 50, score: 30 },
  { max: 60, score: 22 },
  { max: 65, score: 15 },
  { max: 70, score: 8 },
];
// === Location: 대기질 (PM2.5 기준 4단계) ===
export const AIR_QUALITY_TIERS: Tier[] = [
  { max: 15, score: 20 }, // 좋음
  { max: 25, score: 15 }, // 보통
  { max: 50, score: 8 }, // 나쁨
];
export const AIR_QUALITY_DEFAULT = 12; // 데이터 없을 때 중립

export const NOXIOUS_DIST_THRESHOLD = 500; // m — 이 거리 이상이면 감점 반감
export const NOXIOUS_REDUCTION = 0.5;
export const NOXIOUS_PEN_CAP = -15;

// === Product ===
export const UNIT_TIERS: Tier[] = [
  { min: 1500, score: 15 },
  { min: 1000, score: 13 },
  { min: 700, score: 10 },
  { min: 400, score: 7 },
];
export const UNIT_UNKNOWN_SCORE = 8;
export const UNIT_SMALL_SCORE = 4;
export const PARKING_TIERS: Tier[] = [
  { min: 1.5, score: 15 },
  { min: 1.3, score: 12 },
  { min: 1.1, score: 8 },
];
export const PARKING_LOW_SCORE = 5;
export const FAR_TIERS: Tier[] = [
  { max: 200, score: 10 },
  { max: 250, score: 7 },
];
export const FAR_HIGH_SCORE = 3;
export const ENERGY_SCORES: Record<string, number> = { 1: 7, 2: 5 };
export const ENERGY_DEFAULT = 3;
export const GREEN_BLDG_SCORES: Record<string, number> = { 최우수: 3, 우수: 2 };
export const EXCL_RATIO_TIERS: Tier[] = [
  { min: 80, score: 10 },
  { min: 77, score: 8 },
  { min: 74, score: 6 },
];
export const EXCL_LOW_SCORE = 4;
export const FLOOR_TIERS: Tier[] = [
  { min: 35, score: 5 },
  { min: 25, score: 4 },
  { min: 15, score: 3 },
];
export const FLOOR_LOW_SCORE = 2;
export const PRODUCT_MAX: Record<string, number> = {
  brand: 20,
  unit: 15,
  parking: 15,
  far: 10,
  energy: 10,
  exclusive: 10,
  layout: 10,
  quake: 5,
  structure: 5,
};

// === Risk ===
export const UNSOLD_RATE_TIERS: Tier[] = [
  { max: 5, score: 10 },
  { max: 15, score: 25 },
  { max: 30, score: 45 },
  { max: 50, score: 70 },
];
export const UNSOLD_HIGH_SCORE = 90;
export const UNSOLD_UNKNOWN_SCORE = 40;
export const LIQUIDITY_TIERS: Tier[] = [
  { min: 30, score: 5 },
  { min: 15, score: 20 },
  { min: 5, score: 45 },
];
export const LIQUIDITY_LOW_SCORE = 80;
// 위험점수(낮을수록 안전). estimateCreditGrade(dart-builders.mjs)가 생성하는 6등급(A,A-,BBB,BB,B,CCC) 전수 커버 필수.
// B(부채251~350%)·CCC(>350%) 누락 시 scoreRisk의 ?? CREDIT_DEFAULT(30)로 떨어져 BB(60)보다 안전하게 역전됨 (세션392 버그 정정).
export const CREDIT_GRADE_SCORES: Record<string, number> = {
  AA: 0,
  "AA-": 5,
  "A+": 10,
  A: 15,
  "A-": 20,
  BBB: 35,
  BB: 60,
  B: 75,
  CCC: 90,
};
/** 안전 등급 목록 (AptCard 경고 태그 판정용) */
export const SAFE_CREDIT_GRADES: string[] = ["AAA", "AA+", "AA", "AA-", "A+", "A", "A-"];
export const CREDIT_DEFAULT = 30;
export const SUPPLY_RATIO_TIERS: Tier[] = [
  { max: 50, score: 5 },
  { max: 100, score: 25 },
  { max: 130, score: 50 },
];
export const SUPPLY_HIGH_SCORE = 75;

// scoreRisk cancelRatio6m (계약해제율: 낮을수록 안전 → 낮은 위험점수)
export const CANCEL_RATIO_TIERS: Tier[] = [
  { max: 3, score: 10 },
  { max: 8, score: 25 },
  { max: 15, score: 45 },
  { max: 25, score: 65 },
];
export const CANCEL_RATIO_HIGH_SCORE = 85;
export const CANCEL_RATIO_NULL_SCORE = 35;

// scoreRisk crimeSafetyGrade (행안부 지역안전지수 범죄: 1=최안전→낮은 위험, 5=최위험→높은 위험)
export const CRIME_SAFETY_SCORES: Record<string, number> = { 1: 10, 2: 25, 3: 40, 4: 60, 5: 80 };
export const CRIME_SAFETY_NULL_SCORE = 35;

// scoreRisk policeDist (경찰관서 근접성: 멀수록 높은 위험점수)
export const POLICE_DIST_TIERS: Tier[] = [
  { max: 500, score: 5 }, // 500m 이내
  { max: 1000, score: 15 }, // 1km 이내
  { max: 2000, score: 30 }, // 2km 이내
  { max: 3000, score: 50 }, // 3km 이내
];
export const POLICE_DIST_HIGH_SCORE = 70; // 3km 초과
export const POLICE_DIST_NULL_SCORE = 35; // 데이터 없음 중립

// scoreRisk popGrowth (위험 관점: 높으면 안전 → 낮은 위험점수)
export const POP_RISK_TIERS: Tier[] = [
  { min: 0.5, score: 10 },
  { min: 0, score: 20 },
  { min: -0.3, score: 30 },
  { min: -0.8, score: 45 },
];
export const POP_RISK_HIGH = 60;
export const POP_RISK_NULL = 35;

// === Future: 인구 (미래가치 관점: 7단계) ===
export const POP_FUTURE_TIERS: Tier[] = [
  { min: 1.0, score: 95 },
  { min: 0.5, score: 80 },
  { min: 0, score: 65 },
  { min: -0.3, score: 50 },
  { min: -0.8, score: 35 },
  { min: -2.0, score: 20 },
];
export const POP_FUTURE_LOW = 10;
export const POP_FUTURE_NULL = 35;

// === Future: 동적 가중치 룩업 테이블 (Q-4) ===
// 키: "${hasTr},${hasCity},${hasInd}" (1=있음, 0=없음) → 합계 항상 1.00
// `as const` 부착 — scoreFuture.ts:84 의 `as keyof typeof FUTURE_WEIGHT_MAP` 패턴 보존
export const FUTURE_WEIGHT_MAP = {
  "1,1,1": { tr: 0.3, city: 0.25, pop: 0.25, ind: 0.2 },
  "1,1,0": { tr: 0.4, city: 0.3, pop: 0.3, ind: 0 },
  "1,0,1": { tr: 0.4, city: 0, pop: 0.3, ind: 0.3 },
  "1,0,0": { tr: 0.55, city: 0, pop: 0.45, ind: 0 },
  "0,1,1": { tr: 0, city: 0.35, pop: 0.35, ind: 0.3 },
  "0,1,0": { tr: 0, city: 0.45, pop: 0.55, ind: 0 },
  "0,0,1": { tr: 0, city: 0, pop: 0.6, ind: 0.4 },
  "0,0,0": { tr: 0, city: 0, pop: 1.0, ind: 0 },
} as const;

// === Price: 데이터 부재 시 기본값 ===
export const PRICE_NO_DATA_DEFAULTS: { dev: number; jr: number; pir: number; psr: number } = {
  dev: 30,
  jr: 50,
  pir: 50,
  psr: 50,
};

// 세션114: 인근 실거래 중위값(nearbyMedian) 부재로 시도 평균 avgPriceSqm을
// fairPrice 폴백으로 사용할 때 적용. 섬·군 지역에서 시도 평균이 실시세의
// 2~3배로 과대평가되는 왜곡을 사용자에게 알리기 위해 dataReliability 차감 +
// detail 문자열 경고 접미를 부여. 점수 로직(괴리도/PIR/PSR/전세가율 계산) 불변.
export const PRICE_FALLBACK_RELIABILITY_PENALTY = 15;

// === Price: PIR (소득대비 가격비율) 점수 구간 ===
// 세션108 재설계: KOSIS 1인당 개인소득(만원/월) 기준. 기존 ≤3/≤5/≤7 구간은
// 가구소득 PIR 가정이라 개인소득 PIR(2022 전국 p50=19.25, p75=25.27, p90=34.27)과
// 맞지 않아 882/1000건이 "부담" 구간 쏠림. 분포 분위수 기반 새 구간.
// 구조: ≤10 우수(100점), 10~20 양호(80→100 선형), 20~30 보통(60→80 선형),
//       >30 부담(60에서 (pir-30)*2 감점, 하한 0).
export const PIR_SCORE_TIERS: {
  EXCELLENT_MAX: number;
  GOOD_MAX: number;
  MODERATE_MAX: number;
  BURDEN_PENALTY: number;
} = {
  EXCELLENT_MAX: 10, // 우수 상한 (p05~p10 수준, 저가 or 저소득지역)
  GOOD_MAX: 20, // 양호 상한 (한국 평균, p50=19.25 근처)
  MODERATE_MAX: 30, // 보통 상한 (수도권 평균, p75=25.27~p90=34.27)
  BURDEN_PENALTY: 2, // PIR 초과 1당 감점 (30→35일 때 -10, 30→60일 때 -60)
};

// === Future: 동적 가중치 룩업 테이블 (Q-4) ===
// 키: "${hasTr},${hasCity},${hasInd}" (1=있음, 0=없음) → 합계 항상 1.00
// === Price: 괴리도 점수 임계값 ===
// 첫 항목 {min, score} / 나머지 {min, base, range, span} — union type
export type DevScoreTier = { min: number; score: number } | { min: number; base: number; range: number; span: number };
export const DEV_SCORE_TIERS: DevScoreTier[] = [
  { min: 20, score: 97 },
  { min: 10, base: 75, range: 20, span: 10 },
  { min: 5, base: 55, range: 20, span: 5 },
  { min: 0, base: 35, range: 20, span: 5 },
];
export const DEV_SCORE_NEGATIVE_MULT = 4;
export const DEV_SCORE_BASE = 35;

// === Benefit ===
export const INTEREST_RATE = 0.045; // 중도금 대출 추정 금리 4.5%
export const LOAN_TERM_MULT = 1.5; // 중도금 기간 계수 (약 1.5년)
export const BENEFIT_FULL_RATE = 25; // 총혜택률 25% = 100점

// === Area 조정 ===
export const AREA_ADJ_TIERS: { max: number; adj: number }[] = [
  { max: 60, adj: 1.08 },
  { max: 85, adj: 1.0 },
  { max: 115, adj: 0.97 },
];
export const AREA_ADJ_LARGE = 0.94;

// === Location: 대기질 PM10 (4단계, ㎍/㎥ 기준) ===
export const AIR_PM10_TIERS: Tier[] = [
  { max: 30, score: 20 }, // 좋음
  { max: 80, score: 15 }, // 보통
  { max: 150, score: 8 }, // 나쁨
];
export const AIR_PM10_DEFAULT = 12; // 데이터 없을 때 중립

// === Location: 오존 O3 (3단계, ppm 기준) ===
export const AIR_O3_TIERS: Tier[] = [
  { max: 0.03, score: 20 }, // 좋음
  { max: 0.09, score: 12 }, // 보통
];
export const AIR_O3_DEFAULT = 12; // 데이터 없을 때 중립
export const AIR_O3_BAD_SCORE = 5; // 나쁨

// === Location: 도보통학 시간 보정 (분 기준) ===
export const SCHOOL_WALK_BONUS: Tier[] = [
  { max: 5, score: 10 }, // 5분 이내 +10
  { max: 10, score: 5 }, // 10분 이내 +5
  { max: 15, score: 0 }, // 15분 이내 ±0
  { max: 20, score: -5 }, // 20분 이내 -5
];
export const SCHOOL_WALK_FAR_ADJ = -10; // 20분 초과

// === Risk: 초기분양률 (높을수록 안전 → 낮은 위험점수) ===
export const INIT_SALE_TIERS: Tier[] = [
  { min: 90, score: 10 }, // 초기 90%↑ = 매우 안전
  { min: 70, score: 25 },
  { min: 50, score: 45 },
  { min: 30, score: 65 },
];
export const INIT_SALE_HIGH_RISK = 85; // 30% 미만
export const INIT_SALE_NULL = 40; // 데이터 없음 중립

// === Risk: 매물 과잉 임계값 ===
export const LISTING_FLOOD_THRESHOLD = 50; // 매물 50건 초과 → +5
export const LISTING_WARN_THRESHOLD = 30; // 매물 30건 초과 → +2
export const LISTING_FLOOD_PENALTY = 5;
export const LISTING_WARN_PENALTY = 2;

// === Risk: 공공분양 재무안전 보너스 ===
export const PUBLIC_PRESALE_BONUS = -15;

// === Risk: 신규공급 보정 임계값 ===
export const NEW_SUPPLY_HIGH = 5000; // 대량 공급 → supSc +5
export const NEW_SUPPLY_LOW = 1000; // 희소 공급 → supSc -3
export const NEW_SUPPLY_HIGH_ADJ = 5;
export const NEW_SUPPLY_LOW_ADJ = -3;

// === Price: 택지비 비율 (높을수록 가격 안정 → 높은 점수) ===
export const LAND_COST_TIERS: Tier[] = [
  { min: 60, score: 80 }, // 택지비 60%↑ = 구조적 가격 하한
  { min: 40, score: 60 },
  { min: 20, score: 40 },
];
export const LAND_COST_LOW = 25; // 20% 미만
export const LAND_COST_NULL = 50; // 데이터 없음 중립

// === Price: 매매가격지수 보정 임계값 ===
export const PRICE_INDEX_HOT = 130; // 과열 시장 → +5
export const PRICE_INDEX_WARM = 110; // 상승 시장 → +3
export const PRICE_INDEX_HOT_BONUS = 5;
export const PRICE_INDEX_WARM_BONUS = 3;

// === Product: 주택유형별 브랜드 상한 ===
export const HOUSING_TYPE_CAP_DEFAULT = 20;
export const HOUSING_TYPE_CAP_NON_APT = 15; // 오피스텔/도시형
