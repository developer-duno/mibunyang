/**
 * 테스트용 팩토리 함수 — 아파트 데이터 및 스코어링 결과 생성
 */

/** 테스트용 아파트 데이터 생성 */
export function makeApt(overrides = {}) {
  return {
    id: 1,
    name: "테스트아파트",
    region: "경기",
    gu: "수원시",
    dong: "영통동",
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
    schoolGrade: "우수",
    hospital: 3,
    mart: 2,
    conv: 5,
    park: 2,
    cafe: 10,
    culture: 2,
    bank: 2,
    pharmacy: 3,
    hospitalDist: 300,
    martDist: 500,
    convDist: 100,
    parkDist: 400,
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
    unsold: 150,
    recentTrades6m: 20,
    dsr40pass: true,
    hugGuarantee: true,
    builderCreditGrade: "AA",
    builderDebtRatio: 100,
    supplyRatio: 100,
    popGrowth: 0.3,
    netMigration: 500,
    transitDev: "GTX-C 착공",
    devDist: 1,
    cityDev: "신도시",
    industryDev: "테크노밸리",
    heating: "지역난방",
    ...overrides,
  };
}

/** 테스트용 스코어링 결과 생성 */
export function makeScoredItem(aptOverrides = {}, resOverrides = {}) {
  const apt = makeApt(aptOverrides);
  const cats = {
    price: {
      label: "가격 매력도",
      total: 75,
      subs: [
        { name: "분양가 대비 시세", info: "PSR 0.9", score: 80 },
        { name: "PIR", info: "5배", score: 70 },
      ],
    },
    location: {
      label: "입지·생활권",
      total: 80,
      subs: [
        { name: "지하철", info: "500m", score: 85 },
        { name: "학군", info: "우수", score: 75 },
      ],
    },
    product: {
      label: "상품성",
      total: 70,
      subs: [
        { name: "주차비율", info: "1.3대", score: 70 },
        { name: "전용률", info: "78%", score: 70 },
      ],
    },
    benefit: { label: "혜택·할인", total: 60, subs: [{ name: "할인율", info: "5%", score: 60 }] },
    risk: {
      label: "안전도",
      total: 65,
      subs: [
        { name: "미분양률", info: "15%", score: 55 },
        { name: "HUG보증", info: "있음", score: 75 },
      ],
    },
    future: {
      label: "미래가치",
      total: 72,
      subs: [
        { name: "교통개발", info: "GTX-C", score: 80 },
        { name: "도시개발", info: "신도시", score: 64 },
      ],
    },
  };
  const weights = { price: 20, location: 40, product: 20, risk: 10, benefit: 5, future: 5 };
  const total = Math.round(Object.entries(cats).reduce((s, [k, c]) => s + (c.total * (weights[k] ?? 0)) / 100, 0));
  const res = { total, cats, weights, ...resOverrides };
  return { apt, res };
}
