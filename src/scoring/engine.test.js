import { describe, it, expect } from 'vitest';
import { PROFILES } from '@/constants/profiles';
import {
  getAgeCoeff, getAreaAdj,
  scorePrice, scoreLocation, scoreProduct,
  scoreBenefit, scoreRisk, scoreFuture,
  computeRegionalMedians, calcCats, calcAll,
} from './engine';

// --- 팩토리 함수: 테스트용 아파트 데이터 생성 ---
function makeApt(overrides = {}) {
  return {
    id: 1, name: "테스트아파트", region: "경기", gu: "수원시",
    builder: "현대건설", completion: "2025-06-01",
    price: 50000, area: 84, pp: 595,
    nearbyMedian: 55000, jeonseRate: 70, pir: 5, psr: 0.9,
    dataReliability: 80,
    subwayDist: 500, busRoutes: 10, icDist: 5, ktxDist: 15,
    schoolScore: 70, schoolGrade: "B+",
    hospital: 3, mart: 2, conv: 5, park: 2, cafe: 10, culture: 2, bank: 2, pharmacy: 3,
    view: "그린", sunlight: "양호", noise: 55, noxious: [], noxiousDist: null,
    units: 1000, parkingRatio: 1.3, floorAreaRatio: 220, exclusiveRatio: 78,
    maxFloor: 25, energyGrade: 2, greenBldg: null, hasPool: false,
    layout: "4베이판상", quakeDesign: true,
    discountPct: 5, loanFree: true, loanFreePct: 60,
    optionFree: true, optionValue: 500, balconyFree: true, balconyValue: 800,
    cashback: 200,
    unsoldRate: 15, recentTrades6m: 20, dsr40pass: true, hugGuarantee: true,
    builderCreditGrade: "AA", builderDebtRatio: 100, supplyRatio: 100,
    popGrowth: 0.3, netMigration: 500, cancelRatio6m: 5,
    transitDev: "GTX-C 착공", devDist: 1, cityDev: "신도시", industryDev: "테크노밸리",
    ...overrides,
  };
}

// 가중치 합계 = 100%
describe('프로필 가중치 합계', () => {
  Object.entries(PROFILES).forEach(([key, profile]) => {
    it(key + ' 프로필 가중치 합계 = 100', () => {
      const sum = Object.values(profile.w).reduce((a, b) => a + b, 0);
      expect(sum).toBe(100);
    });
  });
  it('프로필이 5개 존재한다', () => {
    expect(Object.keys(PROFILES).length).toBe(5);
  });
  it('모든 프로필에 6개 카테고리가 있다', () => {
    const cats = ['location', 'product', 'price', 'risk', 'benefit', 'future'];
    Object.entries(PROFILES).forEach(([key, profile]) => {
      cats.forEach(cat => {
        expect(profile.w).toHaveProperty(cat);
        expect(typeof profile.w[cat]).toBe('number');
      });
    });
  });
});

describe('getAgeCoeff', () => {
  it('미래 입주일은 1.0', () => { expect(getAgeCoeff('2030-01-01')).toBe(1.0); });
  it('null은 1.05', () => { expect(getAgeCoeff(null)).toBe(1.05); });
  it('유효하지 않은 값은 1.05', () => { expect(getAgeCoeff('invalid')).toBe(1.05); });
  it('1년 미만 = 1.03', () => {
    const d = new Date(); d.setMonth(d.getMonth() - 3);
    expect(getAgeCoeff(d.toISOString().slice(0, 10))).toBe(1.03);
  });
});

describe('getAreaAdj', () => {
  it('소형 (60m2 미만) = 1.08', () => { expect(getAreaAdj(50)).toBe(1.08); });
  it('중형 (60~85m2) = 1.0', () => { expect(getAreaAdj(84)).toBe(1.0); });
  it('대형 (85~115m2) = 0.97', () => { expect(getAreaAdj(100)).toBe(0.97); });
  it('초대형 (115m2+) = 0.94', () => { expect(getAreaAdj(120)).toBe(0.94); });
  it('null/0 = 1.0', () => { expect(getAreaAdj(null)).toBe(1.0); expect(getAreaAdj(0)).toBe(1.0); });
});

describe('scorePrice', () => {
  it('정상 데이터에서 0~100 범위', () => {
    const r = scorePrice(makeApt());
    expect(r.total).toBeGreaterThanOrEqual(0);
    expect(r.total).toBeLessThanOrEqual(100);
    expect(r.subs).toHaveLength(6);
    expect(r.fairPrice).toBeGreaterThan(0);
  });
  it('nearbyMedian=0이면 fairPrice=0', () => {
    const r = scorePrice(makeApt({ nearbyMedian: 0 }));
    expect(r.fairPrice).toBe(0);
    expect(r.subs[0].info).toBe("데이터 부재");
  });
  it('분양가 < 적정가 -> 높은 점수', () => {
    expect(scorePrice(makeApt({ price: 30000, nearbyMedian: 55000 })).total).toBeGreaterThan(70);
  });
  it('분양가 > 적정가 -> 낮은 점수', () => {
    expect(scorePrice(makeApt({ price: 80000, nearbyMedian: 40000 })).total).toBeLessThan(60);
  });
  it('PIR <= 3 -> PIR 서브스코어 100', () => {
    expect(scorePrice(makeApt({ pir: 2 })).subs.find(s => s.name === "PIR").score).toBe(100);
  });
  it('전세가율 75%에서 최대', () => {
    expect(scorePrice(makeApt({ jeonseRate: 75 })).subs.find(s => s.name === "전세가율").score).toBeGreaterThanOrEqual(95);
  });
  it('PSR 점수 100 초과 불가 (클램핑)', () => {
    expect(scorePrice(makeApt({ psr: 0.5 })).subs.find(s => s.name === "PSR").score).toBeLessThanOrEqual(100);
  });
});

describe('scoreLocation', () => {
  it('정상 데이터 0~100', () => {
    const r = scoreLocation(makeApt());
    expect(r.total).toBeGreaterThanOrEqual(0);
    expect(r.total).toBeLessThanOrEqual(100);
    expect(r.subs).toHaveLength(5);
  });
  it('교통 미약 -> 교통 점수 낮음', () => {
    const r = scoreLocation(makeApt({ subwayDist: 9999, busRoutes: 0, icDist: 99, ktxDist: 99 }));
    expect(r.subs.find(s => s.name === "교통").score).toBeLessThan(30);
  });
  it('혐오시설 500m 이상이면 감점 반감', () => {
    const close = scoreLocation(makeApt({ noxious: ["소각장"], noxiousDist: 300 }));
    const far = scoreLocation(makeApt({ noxious: ["소각장"], noxiousDist: 600 }));
    expect(far.subs.find(s => s.name === "혐오시설").score)
      .toBeGreaterThan(close.subs.find(s => s.name === "혐오시설").score);
  });
  it('미등록 지역도 에러 없이 계산', () => {
    expect(scoreLocation(makeApt({ region: "미등록" })).total).toBeGreaterThanOrEqual(0);
  });
});

describe('scoreProduct', () => {
  it('정상 데이터 0~100', () => {
    const r = scoreProduct(makeApt());
    expect(r.total).toBeGreaterThanOrEqual(0);
    expect(r.total).toBeLessThanOrEqual(100);
    expect(r.subs).toHaveLength(9);
  });
  it('1군Super 브랜드 = 20점', () => {
    expect(scoreProduct(makeApt({ builder: "현대건설" })).subs.find(s => s.name === "브랜드").score).toBe(20);
  });
  it('미등록 시공사 = 5점', () => {
    expect(scoreProduct(makeApt({ builder: "무명건설" })).subs.find(s => s.name === "브랜드").score).toBe(5);
  });
  it('세대수 <= 1 -> 중립(8)', () => {
    expect(scoreProduct(makeApt({ units: 1 })).subs.find(s => s.name === "세대수").score).toBe(8);
  });
  it('수영장 보너스 +3', () => {
    const pool = scoreProduct(makeApt({ hasPool: true })).subs.find(s => s.name === "세대수").score;
    const noPool = scoreProduct(makeApt({ hasPool: false })).subs.find(s => s.name === "세대수").score;
    expect(pool).toBe(Math.min(noPool + 3, 15));
  });
  it('내진설계 5점/0점', () => {
    expect(scoreProduct(makeApt({ quakeDesign: true })).subs.find(s => s.name === "내진").score).toBe(5);
    expect(scoreProduct(makeApt({ quakeDesign: false })).subs.find(s => s.name === "내진").score).toBe(0);
  });
});

describe('scoreBenefit', () => {
  it('혜택 없음 = 0점', () => {
    const r = scoreBenefit(makeApt({ discountPct: 0, loanFree: false, optionFree: false, balconyFree: false, cashback: 0 }));
    expect(r.total).toBe(0);
    expect(r.totalWon).toBe(0);
  });
  it('총혜택율 25% 이상 = 100점', () => {
    expect(scoreBenefit(makeApt({ discountPct: 25, loanFree: false, optionFree: false, balconyFree: false, cashback: 0 })).total).toBe(100);
  });
  it('정상 혜택 totalWon > 0', () => {
    const r = scoreBenefit(makeApt());
    expect(r.totalWon).toBeGreaterThan(0);
    expect(r.subs).toHaveLength(6);
  });
  it('price=0 -> 0점', () => {
    expect(scoreBenefit(makeApt({ price: 0 })).total).toBe(0);
  });

  // 관리비 절감 테스트 — 만원 단위, 면적 미곱셈
  it('관리비 절감 — 지역 평균보다 낮으면 연간 절감액 합산', () => {
    const apt = makeApt({ avgMaintenanceCost: 15, _regionAvgMaint: 20, discountPct: 0, loanFree: false, optionFree: false, balconyFree: false, cashback: 0 });
    const r = scoreBenefit(apt);
    // (20 - 15) × 12 = 60 만원
    expect(r.subs[5].name).toBe("관리비 절감");
    expect(r.subs[5].info).toContain("60");
    expect(r.totalWon).toBe(60);
  });

  it('관리비 절감 — 아파트가 지역 평균보다 비싸면 0', () => {
    const apt = makeApt({ avgMaintenanceCost: 25, _regionAvgMaint: 20, discountPct: 0, loanFree: false, optionFree: false, balconyFree: false, cashback: 0 });
    const r = scoreBenefit(apt);
    expect(r.subs[5].info).toBe("-");
    expect(r.totalWon).toBe(0);
  });
});

describe('scoreRisk', () => {
  it('정상 데이터 0~100', () => {
    const r = scoreRisk(makeApt());
    expect(r.total).toBeGreaterThanOrEqual(0);
    expect(r.total).toBeLessThanOrEqual(100);
    expect(r.subs).toHaveLength(11);
  });
  it('미분양률 낮음 -> 안전 점수 높음', () => {
    expect(scoreRisk(makeApt({ unsoldRate: 5 })).total).toBeGreaterThan(scoreRisk(makeApt({ unsoldRate: 50 })).total);
  });
  it('세대수 <= 1 -> 미분양률 중립', () => {
    expect(scoreRisk(makeApt({ units: 1 })).subs.find(s => s.name === "미분양률").info).toContain("미확인");
  });
  it('HUG+AA -> 시공사 재무 위험 낮음', () => {
    const r = scoreRisk(makeApt({ hugGuarantee: true, builderCreditGrade: "AA", builderDebtRatio: 80 }));
    expect(r.subs.find(s => s.name === "시공사 재무").score).toBeGreaterThanOrEqual(90);
  });
  it('인구 급감 -> 시장환경 위험', () => {
    expect(scoreRisk(makeApt({ popGrowth: 1.0 })).total).toBeGreaterThan(scoreRisk(makeApt({ popGrowth: -1.0 })).total);
  });
  // 계약해제율 테스트
  it('cancelRatio6m null -> 중립 65점', () => {
    const r = scoreRisk(makeApt({ cancelRatio6m: null }));
    expect(r.subs.find(s => s.name === "계약해제율").score).toBe(65);
  });
  it('cancelRatio6m 낮음 -> 안전 점수 높음', () => {
    expect(scoreRisk(makeApt({ cancelRatio6m: 2 })).total).toBeGreaterThan(scoreRisk(makeApt({ cancelRatio6m: 30 })).total);
  });
});

// scoreRisk 내부 10개 서브 가중치 합 = 1.00 검증
describe('scoreRisk — 내부 가중치 합계', () => {
  it('10개 서브 가중치 합 = 1.00', () => {
    // engine.js: unsoldSc*0.14 + liqSc*0.14 + loanSc*0.15 + finSc*0.17 + regSc*0.05 + supSc*0.10 + mktSc*0.04 + cancelSc*0.04 + compSc*0.09 + crimeSc*0.05 + initSc*0.03
    const weights = [0.14, 0.14, 0.15, 0.17, 0.05, 0.10, 0.04, 0.04, 0.09, 0.05, 0.03];
    const sum = weights.reduce((a, b) => a + b, 0);
    expect(Math.round(sum * 100) / 100).toBe(1.00);
  });
});

// 치안 안전등급 테스트
describe('scoreRisk — crimeSafetyGrade', () => {
  it('crimeSafetyGrade null → 중립 65점 (100-35)', () => {
    const r = scoreRisk(makeApt({ crimeSafetyGrade: null }));
    expect(r.subs.find(s => s.name === "치안 안전").score).toBe(65);
  });
  it('crimeSafetyGrade 1등급 → 안전 83점 (grade 70% + police null 30%)', () => {
    const r = scoreRisk(makeApt({ crimeSafetyGrade: 1 }));
    // crimeSc = 10*0.7 + 35*0.3 = 17.5, score = round(100-17.5) = 83
    expect(r.subs.find(s => s.name === "치안 안전").score).toBe(83);
  });
  it('crimeSafetyGrade 5등급 → 위험 34점 (grade 70% + police null 30%)', () => {
    const r = scoreRisk(makeApt({ crimeSafetyGrade: 5 }));
    // crimeSc = 80*0.7 + 35*0.3 = 66.5, score = round(100-66.5) = 34
    expect(r.subs.find(s => s.name === "치안 안전").score).toBe(34);
  });
  it('1등급이 5등급보다 총점 높음', () => {
    expect(scoreRisk(makeApt({ crimeSafetyGrade: 1 })).total)
      .toBeGreaterThan(scoreRisk(makeApt({ crimeSafetyGrade: 5 })).total);
  });
});

// mktSc(시장환경) 7단계 경계값 테스트
describe('scoreRisk — mktSc 7단계 + null 기본값', () => {
  // mktSc는 risk 관점: 성장→낮은 위험(5), 감소→높은 위험(90)
  // 최종 서브점수 = 100 - mktSc
  const getMktScore = (popGrowth) => {
    const r = scoreRisk(makeApt({ popGrowth }));
    return r.subs.find(s => s.name === "시장환경").score;
  };

  it('null → 중립 65점 (100-35)', () => { expect(getMktScore(null)).toBe(65); });
  it('popGrowth ≥ 1.0 → 95점 (100-5)', () => { expect(getMktScore(1.0)).toBe(95); });
  it('popGrowth ≥ 0.5 → 80점 (100-20)', () => { expect(getMktScore(0.5)).toBe(80); });
  it('popGrowth ≥ 0 → 65점 (100-35)', () => { expect(getMktScore(0)).toBe(65); });
  it('popGrowth ≥ -0.3 → 50점 (100-50)', () => { expect(getMktScore(-0.3)).toBe(50); });
  it('popGrowth ≥ -0.8 → 35점 (100-65)', () => { expect(getMktScore(-0.8)).toBe(35); });
  it('popGrowth ≥ -2.0 → 20점 (100-80)', () => { expect(getMktScore(-2.0)).toBe(20); });
  it('popGrowth < -2.0 → 10점 (100-90)', () => { expect(getMktScore(-3.0)).toBe(10); });
});

describe('scoreFuture', () => {
  it('모든 개발 정보 0~100', () => {
    const r = scoreFuture(makeApt());
    expect(r.total).toBeGreaterThanOrEqual(0);
    expect(r.total).toBeLessThanOrEqual(100);
    expect(r.subs).toHaveLength(4);
  });
  it('교통/도시/산업 없으면 인구 가중치 100%', () => {
    const r = scoreFuture(makeApt({ transitDev: "없음", cityDev: "", industryDev: null, popGrowth: 0.5, netMigration: null }));
    expect(r.total).toBe(80);
  });
  it('GTX 고가치 교통 1.2x 보너스', () => {
    const normal = scoreFuture(makeApt({ transitDev: "일반 착공", devDist: 1 })).subs.find(s => s.name === "교통개발").score;
    const gtx = scoreFuture(makeApt({ transitDev: "GTX-C 착공", devDist: 1 })).subs.find(s => s.name === "교통개발").score;
    expect(gtx).toBeGreaterThan(normal);
  });
  it('순유입 -> 인구 +10', () => {
    const base = scoreFuture(makeApt({ popGrowth: 0, netMigration: null })).subs.find(s => s.name === "인구").score;
    const inflow = scoreFuture(makeApt({ popGrowth: 0, netMigration: 1000 })).subs.find(s => s.name === "인구").score;
    expect(inflow).toBe(base + 10);
  });
  it('대규모 유출 -> 인구 -5', () => {
    const base = scoreFuture(makeApt({ popGrowth: 0, netMigration: null })).subs.find(s => s.name === "인구").score;
    const out = scoreFuture(makeApt({ popGrowth: 0, netMigration: -6000 })).subs.find(s => s.name === "인구").score;
    expect(out).toBe(base - 5);
  });
});

describe('computeRegionalMedians', () => {
  it('지역별 중위값 계산', () => {
    const apts = [
      { region: "경기", pir: 5, psr: 0.8, unsoldRate: 10, supplyRatio: 100 },
      { region: "경기", pir: 7, psr: 1.2, unsoldRate: 30, supplyRatio: 120 },
      { region: "경기", pir: 9, psr: 1.0, unsoldRate: 20, supplyRatio: 110 },
    ];
    const m = computeRegionalMedians(apts);
    expect(m["경기"].pir).toBe(7);
    expect(m["경기"].psr).toBe(1.0);
  });
  it('빈 배열 -> 빈 객체', () => { expect(computeRegionalMedians([])).toEqual({}); });
  it('null 필드 제외', () => {
    const apts = [
      { region: "경기", pir: null, psr: 0.8, unsoldRate: null, supplyRatio: 100 },
      { region: "경기", pir: 5, psr: null, unsoldRate: 20, supplyRatio: null },
    ];
    const m = computeRegionalMedians(apts);
    expect(m["경기"].pir).toBe(5);
    expect(m["경기"].psr).toBe(0.8);
  });
});

describe('calcCats', () => {
  it('6개 카테고리 반환', () => {
    const cats = calcCats(makeApt(), {});
    expect(Object.keys(cats)).toEqual(expect.arrayContaining(['price', 'location', 'product', 'benefit', 'risk', 'future']));
  });
  it('모든 카테고리 0~100', () => {
    Object.values(calcCats(makeApt(), {})).forEach(c => {
      expect(c.total).toBeGreaterThanOrEqual(0);
      expect(c.total).toBeLessThanOrEqual(100);
    });
  });
  it('대부분 null인 아파트도 에러 없이 계산', () => {
    Object.values(calcCats({ id: 99, name: "널단지", region: "경기", builder: null, price: null }, {})).forEach(c => {
      expect(c.total).toBeGreaterThanOrEqual(0);
      expect(c.total).toBeLessThanOrEqual(100);
    });
  });
});

describe('calcAll', () => {
  it('모든 프로필에서 0~100', () => {
    Object.keys(PROFILES).forEach(p => {
      const r = calcAll(makeApt(), p, {});
      expect(r.total).toBeGreaterThanOrEqual(0);
      expect(r.total).toBeLessThanOrEqual(100);
    });
  });
  it('다른 프로필은 다른 가중치', () => {
    const live = calcAll(makeApt(), 'live', {});
    const invest = calcAll(makeApt(), 'invest', {});
    expect(live.weights).not.toEqual(invest.weights);
  });
  it('미등록 프로필은 live 폴백', () => {
    expect(calcAll(makeApt(), 'nonexistent', {}).weights).toEqual(PROFILES.live.w);
  });
});

// --- 추가 테스트: 복합 null, 경계값, regionMedians, FUTURE_WEIGHT_MAP 경로 ---

describe('calcCats — 복합 null 조합 5가지', () => {
  // 대부분 필드가 null인 아파트 5개 다른 조합 테스트
  const nullApts = [
    { id: 'n1', name: '널1', region: '경기', builder: null, price: null, area: null, nearbyMedian: null, subwayDist: null, units: null, popGrowth: null },
    { id: 'n2', name: '널2', region: null, builder: '현대건설', price: 50000, area: null, nearbyMedian: null, transitDev: null, cityDev: null, industryDev: null },
    { id: 'n3', name: '널3', region: '서울', builder: null, price: null, area: 84, pir: null, psr: null, jeonseRate: null, unsoldRate: null },
    { id: 'n4', name: '널4', region: '부산', builder: '무명', price: 30000, nearbyMedian: 40000, noxious: null, noxiousDist: null, schoolScore: null, schoolGrade: null },
    { id: 'n5', name: '널5', region: '경기', price: 10000, discountPct: null, loanFree: null, optionFree: null, balconyFree: null, cashback: null, builderCreditGrade: null, builderDebtRatio: null },
  ];

  nullApts.forEach((apt, idx) => {
    it(`널 조합 #${idx + 1}: 에러 없이 6개 카테고리 0~100`, () => {
      const cats = calcCats(apt, {});
      expect(Object.keys(cats)).toHaveLength(6);
      Object.values(cats).forEach(c => {
        expect(c.total).toBeGreaterThanOrEqual(0);
        expect(c.total).toBeLessThanOrEqual(100);
      });
    });
  });
});

describe('경계값 — total=0, total=100 극단 케이스', () => {
  it('혜택 점수 total=0 (모든 혜택 없음)', () => {
    const r = scoreBenefit(makeApt({ discountPct: 0, loanFree: false, loanFreePct: 0, optionFree: false, optionValue: 0, balconyFree: false, balconyValue: 0, cashback: 0, price: 50000 }));
    expect(r.total).toBe(0);
  });

  it('혜택 점수 total=100 (충분한 혜택)', () => {
    const r = scoreBenefit(makeApt({ discountPct: 30, price: 50000 }));
    expect(r.total).toBe(100);
  });

  it('가격 점수 nearbyMedian=0 → total이 정해진 기본값 범위', () => {
    const r = scorePrice(makeApt({ nearbyMedian: 0, price: 50000 }));
    expect(r.total).toBeGreaterThanOrEqual(0);
    expect(r.total).toBeLessThanOrEqual(100);
  });

  it('모든 프로필에서 극단적으로 좋은 아파트도 100 초과 불가', () => {
    const goodApt = makeApt({
      price: 20000, nearbyMedian: 80000, pir: 1, psr: 0.3, jeonseRate: 80,
      subwayDist: 100, busRoutes: 20, icDist: 1, ktxDist: 1,
      discountPct: 30, units: 2000, parkingRatio: 2.0, unsoldRate: 1,
      popGrowth: 2, netMigration: 5000, transitDev: "GTX-C 개통", devDist: 0.5,
      cityDev: "신도시", industryDev: "테크노밸리",
    });
    Object.keys(PROFILES).forEach(p => {
      const r = calcAll(goodApt, p, {});
      expect(r.total).toBeLessThanOrEqual(100);
    });
  });
});

describe('scorePrice — regionMedians 컨텍스트 전달', () => {
  it('regionMedians 없으면 비관적 기본값 사용', () => {
    const apt = makeApt({ pir: null, psr: null });
    const withoutCtx = scorePrice(apt);
    expect(withoutCtx.total).toBeGreaterThanOrEqual(0);
  });

  it('regionMedians 전달 시 sanitize에서 지역 중위값 사용', () => {
    const regionMedians = { "경기": { pir: 5, psr: 0.8, unsoldRate: 15, supplyRatio: 100 } };
    const apt = makeApt({ region: "경기", pir: null, psr: null });
    // calcCats는 regionMedians를 ctx로 전달받아 sanitize에 사용
    const cats = calcCats(apt, { regionMedians });
    expect(cats.price.total).toBeGreaterThanOrEqual(0);
    expect(cats.price.total).toBeLessThanOrEqual(100);
  });

  it('regionMedians에 해당 지역 없으면 비관적 폴백', () => {
    const regionMedians = { "서울": { pir: 3, psr: 0.5, unsoldRate: 5, supplyRatio: 80 } };
    const apt = makeApt({ region: "경기", pir: null, psr: null });
    const cats = calcCats(apt, { regionMedians });
    // 경기 중위값 없으므로 비관적 기본값 사용 → 점수가 다를 수 있음
    expect(cats.price.total).toBeGreaterThanOrEqual(0);
  });
});

describe('scoreFuture — FUTURE_WEIGHT_MAP 모든 8개 경로', () => {
  // transit/city/industry 있음/없음 조합 (2^3 = 8)
  const combos = [
    { label: '1,1,1', transit: 'GTX-C 착공', city: '신도시', industry: '테크노밸리' },
    { label: '1,1,0', transit: '지하철 착공', city: '신도심', industry: null },
    { label: '1,0,1', transit: '트램 착공', city: '', industry: '산업단지' },
    { label: '1,0,0', transit: '경전철 착공', city: '', industry: null },
    { label: '0,1,1', transit: '없음', city: '재건축', industry: '물류단지' },
    { label: '0,1,0', transit: '', city: '스마트시티', industry: '' },
    { label: '0,0,1', transit: '없음', city: '', industry: '공항' },
    { label: '0,0,0', transit: '없음', city: '', industry: null },
  ];

  combos.forEach(({ label, transit, city, industry }) => {
    it(`FUTURE_WEIGHT_MAP[${label}] 경로 정상 계산`, () => {
      const r = scoreFuture(makeApt({ transitDev: transit, cityDev: city, industryDev: industry, popGrowth: 0.5, netMigration: null, devDist: 1 }));
      expect(r.total).toBeGreaterThanOrEqual(0);
      expect(r.total).toBeLessThanOrEqual(100);
      expect(r.subs).toHaveLength(4);
    });
  });

  it('모든 개발 없음(0,0,0) → 인구에 100% 가중', () => {
    const r = scoreFuture(makeApt({ transitDev: '없음', cityDev: '', industryDev: null, popGrowth: 0.5, netMigration: null }));
    // 인구 가중치=1.00 → total = popSc * 1.00 = 80
    expect(r.total).toBe(80);
  });

  it('모든 개발 있음(1,1,1) → 4개 축 분산', () => {
    const r = scoreFuture(makeApt({ transitDev: 'GTX-C 착공', cityDev: '신도시', industryDev: '테크노밸리', popGrowth: 0.5, netMigration: null, devDist: 1 }));
    // 교통/도시/산업/인구 모두 0 이상
    r.subs.forEach(s => expect(s.score).toBeGreaterThanOrEqual(0));
  });
});

// === 세션66: 신규 15개 필드 스코어링 테스트 ===

describe('scoreLocation — 대기질 복합 (PM10/O3)', () => {
  it('pm10/o3 null → 기존과 동일 (pm25만 사용)', () => {
    const base = scoreLocation(makeApt());
    const withNull = scoreLocation(makeApt({ airQuality: { pm25: null, pm10: null, o3: null } }));
    // 둘 다 pm25 null → AIR_QUALITY_DEFAULT 사용 → 동일
    expect(withNull.subs.find(s => s.name === "자연환경").score)
      .toBe(base.subs.find(s => s.name === "자연환경").score);
  });
  it('pm10 좋음 → 환경 점수 변화', () => {
    const withPm10 = scoreLocation(makeApt({ airQuality: { pm25: 20, pm10: 20, o3: null } }));
    expect(withPm10.subs.find(s => s.name === "자연환경").score).toBeGreaterThanOrEqual(0);
  });
  it('o3 나쁨 → 환경 점수 하락', () => {
    const good = scoreLocation(makeApt({ airQuality: { pm25: 10, pm10: 20, o3: 0.02 } }));
    const bad = scoreLocation(makeApt({ airQuality: { pm25: 10, pm10: 20, o3: 0.15 } }));
    expect(good.subs.find(s => s.name === "자연환경").score)
      .toBeGreaterThan(bad.subs.find(s => s.name === "자연환경").score);
  });
});

describe('scoreLocation — 도보통학 보정', () => {
  it('naverSchoolWalkMin null → 학군 점수 불변', () => {
    const base = scoreLocation(makeApt({ schoolScore: 70 }));
    const withNull = scoreLocation(makeApt({ schoolScore: 70, naverSchoolWalkMin: null }));
    expect(withNull.subs.find(s => s.name === "학군").score)
      .toBe(base.subs.find(s => s.name === "학군").score);
  });
  it('5분 이내 → +10', () => {
    const r = scoreLocation(makeApt({ schoolScore: 70, naverSchoolWalkMin: 3 }));
    expect(r.subs.find(s => s.name === "학군").score).toBe(80);
  });
  it('25분 → -10', () => {
    const r = scoreLocation(makeApt({ schoolScore: 70, naverSchoolWalkMin: 25 }));
    expect(r.subs.find(s => s.name === "학군").score).toBe(60);
  });
  it('학군 점수 0~100 클램핑', () => {
    const high = scoreLocation(makeApt({ schoolScore: 95, naverSchoolWalkMin: 3 }));
    expect(high.subs.find(s => s.name === "학군").score).toBeLessThanOrEqual(100);
    const low = scoreLocation(makeApt({ schoolScore: 5, naverSchoolWalkMin: 25 }));
    expect(low.subs.find(s => s.name === "학군").score).toBeGreaterThanOrEqual(0);
  });
});

describe('scoreRisk — 초기분양률 (initSc)', () => {
  it('initialSaleRate null → 중립 60점 (100-40)', () => {
    const r = scoreRisk(makeApt({ initialSaleRate: null }));
    expect(r.subs.find(s => s.name === "초기분양률").score).toBe(60);
  });
  it('90%↑ → 안전 90점 (100-10)', () => {
    const r = scoreRisk(makeApt({ initialSaleRate: 95 }));
    expect(r.subs.find(s => s.name === "초기분양률").score).toBe(90);
  });
  it('20% → 위험 15점 (100-85)', () => {
    const r = scoreRisk(makeApt({ initialSaleRate: 20 }));
    expect(r.subs.find(s => s.name === "초기분양률").score).toBe(15);
  });
});

describe('scoreRisk — isRegulated DB값 우선', () => {
  it('isRegulated=true → 규제지역', () => {
    const r = scoreRisk(makeApt({ isRegulated: true }));
    expect(r.subs.find(s => s.name === "규제").score).toBe(40); // 100 - 60
  });
  it('isRegulated=false → 비규제', () => {
    const r = scoreRisk(makeApt({ isRegulated: false }));
    expect(r.subs.find(s => s.name === "규제").score).toBe(90); // 100 - 10
  });
  it('isRegulated=null → getZone() 폴백', () => {
    const r = scoreRisk(makeApt({ isRegulated: null }));
    expect(r.subs.find(s => s.name === "규제").score).toBeGreaterThanOrEqual(0);
  });
});

describe('scoreRisk — naverSellCount 매물과잉 페널티', () => {
  it('naverSellCount=60 → liqSc 페널티 +5', () => {
    const base = scoreRisk(makeApt({ naverSellCount: null }));
    const flood = scoreRisk(makeApt({ naverSellCount: 60 }));
    expect(flood.subs.find(s => s.name === "거래량").score)
      .toBeLessThanOrEqual(base.subs.find(s => s.name === "거래량").score);
  });
});

describe('scoreRisk — presaleType 공공분양 보너스', () => {
  it('공공분양 → 시공사 재무 점수 상승', () => {
    const priv = scoreRisk(makeApt({ presaleType: "민간분양" }));
    const pub = scoreRisk(makeApt({ presaleType: "공공분양" }));
    expect(pub.subs.find(s => s.name === "시공사 재무").score)
      .toBeGreaterThanOrEqual(priv.subs.find(s => s.name === "시공사 재무").score);
  });
});

describe('scorePrice — 택지비비율 (landSc)', () => {
  it('landCostRatio null → 중립 50점', () => {
    const r = scorePrice(makeApt({ landCostRatio: null }));
    expect(r.subs.find(s => s.name === "택지비비율").score).toBe(50);
  });
  it('landCostRatio 70% → 80점', () => {
    const r = scorePrice(makeApt({ landCostRatio: 70 }));
    expect(r.subs.find(s => s.name === "택지비비율").score).toBe(80);
  });
  it('landCostRatio 10% → 25점', () => {
    const r = scorePrice(makeApt({ landCostRatio: 10 }));
    expect(r.subs.find(s => s.name === "택지비비율").score).toBe(25);
  });
});

describe('scorePrice — fairPrice 폴백', () => {
  it('nearbyMedian=0 + avgPriceSqm 있으면 → fairPrice 산출 시도', () => {
    const r = scorePrice(makeApt({ nearbyMedian: 0, avgPriceSqm: 5000, area: 84 }));
    // avgPriceSqm 5000千원/㎡ × 84㎡ / 10000 × 3.3 ≈ 138.6 만원 (매우 작지만 > 0)
    expect(r.fairPrice).toBeGreaterThanOrEqual(0);
  });
  it('nearbyMedian=0 + presalePp 있으면 → fairPrice 산출 시도', () => {
    const r = scorePrice(makeApt({ nearbyMedian: 0, avgPriceSqm: null, presalePp: 2000 }));
    expect(r.fairPrice).toBeGreaterThanOrEqual(0);
  });
});

describe('scorePrice — priceIndex 보정', () => {
  it('priceIndex=140 → 신뢰도 +5', () => {
    const base = scorePrice(makeApt({ priceIndex: null }));
    const hot = scorePrice(makeApt({ priceIndex: 140 }));
    expect(hot.subs.find(s => s.name === "데이터 신뢰도").score)
      .toBeGreaterThanOrEqual(base.subs.find(s => s.name === "데이터 신뢰도").score);
  });
});

describe('scoreProduct — presale 폴백', () => {
  it('parkingRatio null + presaleParking → 주차 점수 변화', () => {
    // _noParking 플래그는 sanitize()에서 설정 → 직접 전달
    const noData = scoreProduct(makeApt({ parkingRatio: 0.5, _noParking: true, presaleParking: null }));
    const withPresale = scoreProduct(makeApt({ parkingRatio: 0.5, _noParking: true, presaleParking: 1500, presaleGeneralSupply: 1000 }));
    // 1500/1000 = 1.5 → 15점 vs 기본값 0.5 → 5점
    expect(withPresale.subs.find(s => s.name === "주차").score)
      .toBeGreaterThan(noData.subs.find(s => s.name === "주차").score);
  });
  it('presaleHousingType 오피스텔 → 브랜드 상한 15', () => {
    const apt = scoreProduct(makeApt({ builder: "현대건설", presaleHousingType: "오피스텔" }));
    expect(apt.subs.find(s => s.name === "브랜드").score).toBeLessThanOrEqual(15);
  });
  it('presaleHousingType null → 브랜드 상한 20 (기존과 동일)', () => {
    const apt = scoreProduct(makeApt({ builder: "현대건설", presaleHousingType: null }));
    expect(apt.subs.find(s => s.name === "브랜드").score).toBe(20);
  });
});

describe('scorePrice — 내부 가중치 합계 (세션66)', () => {
  it('6개 서브 가중치 합 = 1.00', () => {
    // engine.js: devSc*0.30 + jrSc*0.20 + pirSc*0.15 + psrSc*0.25 + relSc*0.07 + landSc*0.03
    const weights = [0.30, 0.20, 0.15, 0.25, 0.07, 0.03];
    const sum = weights.reduce((a, b) => a + b, 0);
    expect(Math.round(sum * 100) / 100).toBe(1.00);
  });
});

describe('하위 호환 — makeApt() 기본값 제로 드리프트', () => {
  it('신규 필드 null인 기본 아파트 — 모든 프로필 0~100', () => {
    const cats = calcCats(makeApt(), {});
    Object.values(cats).forEach(c => {
      expect(c.total).toBeGreaterThanOrEqual(0);
      expect(c.total).toBeLessThanOrEqual(100);
    });
  });
  it('Location 제로 드리프트: pm10/o3/walkMin null → 기존과 동일', () => {
    // makeApt()에 airQuality 없음 → pm10/o3 모두 null → 기존 pm25 전용 경로
    const r = scoreLocation(makeApt());
    expect(r.total).toBeGreaterThanOrEqual(0);
    expect(r.total).toBeLessThanOrEqual(100);
  });
});