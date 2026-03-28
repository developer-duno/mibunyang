/**
 * 공용 테스트 팩토리 함수 — 테스트 데이터를 하드코딩하지 않고 재사용
 */

/** 테스트용 아파트 데이터 생성 */
export function makeApt(overrides = {}) {
  return {
    id: 1, name: "테스트아파트", region: "경기", gu: "수원시", dong: "영통동",
    builder: "현대건설", completion: "2025-06-01",
    price: 50000, area: 84, pp: 595,
    nearbyMedian: 55000, jeonseRate: 70, pir: 5, psr: 0.9,
    dataReliability: 80,
    subwayDist: 500, subwayName: "영통역", subwayLines: "1호선", busRoutes: 10, busStopNames: "영통역입구,삼성아파트", icDist: 5, ktxDist: 15,
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
    popGrowth: 0.3, netMigration: 500,
    avgMaintenanceCost: 0, _regionAvgMaint: 0,
    transitDev: "GTX-C 착공", devDist: 1, cityDev: "신도시", industryDev: "테크노밸리",
    lat: 37.2636, lng: 127.0286,
    // 분양정보 (default null — 대부분 아파트에 presale 데이터 없음)
    presaleMinPrice: null, presaleMaxPrice: null, presalePp: null,
    presaleType: null, presaleStage: null, presaleStageCode: null,
    presaleImageUrl: null, naverPresaleNo: null, naverPresaleSeq: null,
    presaleGeneralSupply: null, presaleBuildings: null, presaleParking: null,
    presaleInquiry: null, presaleFeatures: null, presaleMoveIn: null,
    presaleRecruitDate: null, presaleSchedule: null, presaleHousingType: null,
    presaleFetchedAt: null,
    ...overrides,
  };
}

/** 스코어링 결과가 포함된 아파트 아이템 */
export function makeScoredItem(aptOverrides = {}, resOverrides = {}) {
  const apt = makeApt(aptOverrides);
  return {
    apt,
    res: {
      total: 75,
      cats: {
        price: { total: 70, subs: [] },
        location: { total: 80, subs: [] },
        product: { total: 65, subs: [] },
        benefit: { total: 60, subs: [] },
        risk: { total: 85, subs: [] },
        future: { total: 72, subs: [] },
      },
      weights: { location: 40, product: 20, price: 20, risk: 10, benefit: 5, future: 5 },
      ...resOverrides,
    },
  };
}

/** 테스트용 유저 데이터 */
export function makeUser(overrides = {}) {
  return {
    email: "test@example.com",
    name: "테스트유저",
    affiliation: "테스트회사",
    phone: "010-1234-5678",
    specialty: "부동산 중개",
    experience: 5,
    bio: "테스트용 전문가 사용자 소개글입니다. 10자 이상.",
    license: "중개사 1234호",
    status: "approved",
    role: "expert",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/** 다수 아파트 배열 생성 */
export function makeAptList(count = 5, overridesFn = (i) => ({ id: i + 1, name: `아파트${i + 1}` })) {
  return Array.from({ length: count }, (_, i) => makeApt(overridesFn(i)));
}
