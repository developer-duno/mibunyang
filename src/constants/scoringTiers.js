/**
 * 스코어링 엔진 룩업 테이블
 *
 * engine.js의 인라인 매직넘버를 명명된 상수로 추출.
 * 모든 수치는 기존과 100% 동일. 가중치 합계 불변.
 */

// === 헬퍼: 하향 임계값 매칭 ===
/** value <= max 조건으로 첫 매칭 반환 */
export const tierMax = (v, tiers, fallback = 0) => {
  for (const t of tiers) if (v <= t.max) return t.score;
  return fallback;
};
/** value >= min 조건으로 첫 매칭 반환 */
export const tierMin = (v, tiers, fallback = 0) => {
  for (const t of tiers) if (v >= t.min) return t.score;
  return fallback;
};

// === Location: 교통 ===
export const SUBWAY_DIST_TIERS = [
  { max: 300, score: 25 }, { max: 500, score: 21 }, { max: 700, score: 16 },
  { max: 1000, score: 11 }, { max: 1500, score: 6 },
];
export const FULL_BUS_ROUTES = 15;
export const IC_DIST_TIERS = [
  { max: 2, score: 20 }, { max: 5, score: 14 }, { max: 10, score: 8 },
];
export const KTX_DIST_TIERS = [
  { max: 5, score: 20 }, { max: 10, score: 12 }, { max: 15, score: 6 },
];

// === Location: 인프라 가중치 ===
export const INFRA_CONFIG = [
  { key: "hospital", max: 5, weight: 0.20 },
  { key: "mart",     max: 3, weight: 0.10 },
  { key: "conv",     max: 10, weight: 0.05 },
  { key: "park",     max: 4, weight: 0.15 },
  { key: "cafe",     max: 20, weight: 0.15 },
  { key: "culture",  max: 3, weight: 0.15 },
  { key: "bank",     max: 4, weight: 0.05 },
  { key: "pharmacy", max: 4, weight: 0.15 },
];

// === Location: 환경 ===
export const VIEW_SCORES = { "블루": 40, "그린": 30, "천공": 20 };
export const SUNLIGHT_SCORES = { "우수": 30, "양호": 22 };
export const SUNLIGHT_DEFAULT = 15;
export const SUNLIGHT_NO_DATA = 22;
// 방향별 일조 보정 보너스 (환경 서브스코어 내 가산)
export const DIRECTION_BONUS = { "남향": 8, "남동향": 6, "남서향": 6, "동향": 3, "서향": 2, "동남향": 6, "서남향": 6, "북동향": 1, "북서향": 1, "북향": 0 };
export const NOISE_TIERS = [
  { max: 50, score: 30 }, { max: 60, score: 22 }, { max: 65, score: 15 }, { max: 70, score: 8 },
];
export const NOXIOUS_DIST_THRESHOLD = 500;   // m — 이 거리 이상이면 감점 반감
export const NOXIOUS_REDUCTION = 0.5;
export const NOXIOUS_PEN_CAP = -15;

// === Product ===
export const UNIT_TIERS = [
  { min: 1500, score: 15 }, { min: 1000, score: 13 },
  { min: 700, score: 10 }, { min: 400, score: 7 },
];
export const UNIT_UNKNOWN_SCORE = 8;
export const UNIT_SMALL_SCORE = 4;
export const PARKING_TIERS = [
  { min: 1.5, score: 15 }, { min: 1.3, score: 12 }, { min: 1.1, score: 8 },
];
export const PARKING_LOW_SCORE = 5;
export const FAR_TIERS = [
  { max: 200, score: 10 }, { max: 250, score: 7 },
];
export const FAR_HIGH_SCORE = 3;
export const ENERGY_SCORES = { 1: 7, 2: 5 };
export const ENERGY_DEFAULT = 3;
export const GREEN_BLDG_SCORES = { "최우수": 3, "우수": 2 };
export const EXCL_RATIO_TIERS = [
  { min: 80, score: 10 }, { min: 77, score: 8 }, { min: 74, score: 6 },
];
export const EXCL_LOW_SCORE = 4;
export const FLOOR_TIERS = [
  { min: 35, score: 5 }, { min: 25, score: 4 }, { min: 15, score: 3 },
];
export const FLOOR_LOW_SCORE = 2;
export const PRODUCT_MAX = { brand: 20, unit: 15, parking: 15, far: 10, energy: 10, exclusive: 10, layout: 10, quake: 5, structure: 5 };

// === Risk ===
export const UNSOLD_RATE_TIERS = [
  { max: 5, score: 10 }, { max: 15, score: 25 }, { max: 30, score: 45 }, { max: 50, score: 70 },
];
export const UNSOLD_HIGH_SCORE = 90;
export const UNSOLD_UNKNOWN_SCORE = 40;
export const LIQUIDITY_TIERS = [
  { min: 30, score: 5 }, { min: 15, score: 20 }, { min: 5, score: 45 },
];
export const LIQUIDITY_LOW_SCORE = 80;
export const CREDIT_GRADE_SCORES = { AA: 0, "AA-": 5, "A+": 10, A: 15, "A-": 20, BBB: 35, BB: 60 };
/** 안전 등급 목록 (AptCard 경고 태그 판정용) */
export const SAFE_CREDIT_GRADES = ["AAA", "AA+", "AA", "AA-", "A+", "A", "A-"];
export const CREDIT_DEFAULT = 30;
export const SUPPLY_RATIO_TIERS = [
  { max: 50, score: 5 }, { max: 100, score: 25 }, { max: 130, score: 50 },
];
export const SUPPLY_HIGH_SCORE = 75;

// scoreRisk popGrowth (위험 관점: 높으면 안전 → 낮은 위험점수)
export const POP_RISK_TIERS = [
  { min: 0.5, score: 10 }, { min: 0, score: 20 },
  { min: -0.3, score: 30 }, { min: -0.8, score: 45 },
];
export const POP_RISK_HIGH = 60;
export const POP_RISK_NULL = 35;

// === Future: 인구 (미래가치 관점: 7단계) ===
export const POP_FUTURE_TIERS = [
  { min: 1.0, score: 95 }, { min: 0.5, score: 80 },
  { min: 0, score: 65 }, { min: -0.3, score: 50 },
  { min: -0.8, score: 35 }, { min: -2.0, score: 20 },
];
export const POP_FUTURE_LOW = 10;
export const POP_FUTURE_NULL = 35;

// === Future: 동적 가중치 룩업 테이블 (Q-4) ===
// 키: "${hasTr},${hasCity},${hasInd}" (1=있음, 0=없음) → 합계 항상 1.00
export const FUTURE_WEIGHT_MAP = {
  "1,1,1": { tr: 0.30, city: 0.25, pop: 0.25, ind: 0.20 },
  "1,1,0": { tr: 0.40, city: 0.30, pop: 0.30, ind: 0 },
  "1,0,1": { tr: 0.40, city: 0, pop: 0.30, ind: 0.30 },
  "1,0,0": { tr: 0.55, city: 0, pop: 0.45, ind: 0 },
  "0,1,1": { tr: 0, city: 0.35, pop: 0.35, ind: 0.30 },
  "0,1,0": { tr: 0, city: 0.45, pop: 0.55, ind: 0 },
  "0,0,1": { tr: 0, city: 0, pop: 0.60, ind: 0.40 },
  "0,0,0": { tr: 0, city: 0, pop: 1.00, ind: 0 },
};

// === Price: 데이터 부재 시 기본값 ===
export const PRICE_NO_DATA_DEFAULTS = { dev: 30, jr: 50, pir: 50, psr: 50 };

// === Future: 동적 가중치 룩업 테이블 (Q-4) ===
// 키: "${hasTr},${hasCity},${hasInd}" (1=있음, 0=없음) → 합계 항상 1.00
// === Price: 괴리도 점수 임계값 ===
export const DEV_SCORE_TIERS = [
  { min: 20, score: 97 },
  { min: 10, base: 75, range: 20, span: 10 },
  { min: 5, base: 55, range: 20, span: 5 },
  { min: 0, base: 35, range: 20, span: 5 },
];
export const DEV_SCORE_NEGATIVE_MULT = 4;
export const DEV_SCORE_BASE = 35;

// === Benefit ===
export const INTEREST_RATE = 0.045;      // 중도금 대출 추정 금리 4.5%
export const LOAN_TERM_MULT = 1.5;       // 중도금 기간 계수 (약 1.5년)
export const BENEFIT_FULL_RATE = 25;     // 총혜택률 25% = 100점

// === Area 조정 ===
export const AREA_ADJ_TIERS = [
  { max: 60, adj: 1.08 }, { max: 85, adj: 1.0 }, { max: 115, adj: 0.97 },
];
export const AREA_ADJ_LARGE = 0.94;
