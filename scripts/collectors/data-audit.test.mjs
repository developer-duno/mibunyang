// @ts-check
/**
 * data-audit.mjs 테스트 — null 판정, 감사 계산 검증
 */
import { describe, it, expect, vi } from "vitest";

// Supabase 연결 방지 — importOriginal 없이 필요한 것만 re-export
vi.mock("./_shared.mjs", () => ({
  loadEnv: vi.fn(),
  getSupabase: vi.fn(),
  log: vi.fn(),
  logError: vi.fn(),
  sleep: vi.fn(),
  createReporter: vi.fn(() => ({ success: vi.fn(), fail: vi.fn(), skip: vi.fn(), summary: vi.fn() })),
}));

const { isFieldNull, computeAudit, AUDIT_FIELDS, fetchAllFromView } = await import("./data-audit.mjs");

// 팩토리: 모든 필드가 채워진 아파트 행
function createFullRow(overrides = {}) {
  return {
    id: "ah-100", name: "테스트아파트", region: "서울", gu: "강남구", dong: "역삼동",
    address: "서울시 강남구", roadAddress: "테헤란로 1", district: "역삼1", lat: 37.5, lng: 127.0,
    builder: "삼성물산", units: 500, completion: "202601", layout: "3룸",
    area: 84, price: 50000, pp: 1800,
    maxFloor: 25, parkingRatio: 1.2, floorAreaRatio: 250, exclusiveRatio: 78,
    energyGrade: 2, heating: "지역난방", corridorType: "계단식", heatFuel: "도시가스",
    avgMaintenanceCost: 15, primaryDirection: "남향", floors: "15-25", hasPool: false,
    maintHeat: 10, maintHotwater: 8, maintGas: 5, maintElec: 12, maintWater: 3,
    isRegulated: false, dsr40pass: true,
    discountPct: 5, loanFree: true, balconyFree: true, cashback: 500, benefits: ["발코니무료"],
    hospital: 3, mart: 2, conv: 5, cafe: 8, culture: 1, bank: 4, pharmacy: 3, park: 2,
    hospitalDist: 300, martDist: 200, convDist: 100, cafeDist: 150, cultureDist: 800,
    bankDist: 250, pharmacyDist: 180, parkDist: 400, nearbyFacilities: ["스타벅스"],
    subwayDist: 500, busRoutes: 12, icDist: 5, ktxDist: 30, subwayName: "역삼역", subwayLines: ["2호선"], busStopNames: ["역삼동"],
    schoolScore: 72, schoolGrade: "A", nearbySchools: [{ name: "역삼초" }],
    builderDebtRatio: 180, builderCreditGrade: "A+", hugGuarantee: true,
    nearbyMedian: 45000, recentTrades6m: 15, jeonseRate: 62, pir: 8.5, psr: 0.9,
    avgFloor: 12, nearbyBuildYear: 2018, floorRange: "3-25",
    priceByArea: [{ area: 84, price: 50000 }], rentByArea: [{ area: 84, rent: 3000 }],
    jeonseByArea: [{ area: 84, jeonse: 30000 }], priceByFloor: [{ floor: 10, price: 50000 }],
    naverNearbyMedian: 44000, naverNearbyAvg: 45000, naverJeonseRate: 60,
    naverSellCount: 5, naverJeonseCount: 3, naverWolseCount: 2,
    naverBuildYear: 2018, naverAvgFloor: 11, naverSchoolWalkMin: 8, naverNearbyCount: 20,
    view: "한강뷰", sunlight: "남향", noise: 45, noxious: ["고압선"], noxiousDist: 500,
    transitDev: "GTX-A", devDist: 2.5, cityDev: "마곡지구", industryDev: "판교테크노밸리",
    elecUsageKwh: 65000, gasUsageMj: 180000, energyCollectedAt: "2026-03-26T00:00:00Z",
    competitionRate: 3.5, competitionSupply: 200, competitionApplicants: 700,
    cancelRatio6m: 2.5,
    popGrowth: 1.2, supplyRatio: 95, netMigration: 500,
    priceIndex: 102, avgPriceSqm: 850, newSupply: 5000, initialSaleRate: 95, landCostRatio: 55,
    airQuality: { pm25: 15, pm10: 30, grade: "좋음", station: "강남구" },
    crimeSafetyGrade: 2, emergency: 3, emergencyDist: 800,
    emergencyName: "강남세브란스병원", emergencyType: "지역응급의료센터",
    dataReliability: 85,
    ...overrides,
  };
}

// ── isFieldNull 테스트 ───────────────────────────────────────
describe("isFieldNull", () => {
  // 이 테스트가 검증하는 것: 기본 null/undefined 판정
  it("null/undefined → true", () => {
    expect(isFieldNull("name", null)).toBe(true);
    expect(isFieldNull("name", undefined)).toBe(true);
  });

  // 이 테스트가 검증하는 것: 정상 값은 false
  it("채워진 값 → false", () => {
    expect(isFieldNull("name", "테스트")).toBe(false);
    expect(isFieldNull("price", 50000)).toBe(false);
    expect(isFieldNull("isRegulated", false)).toBe(false);
  });

  // 이 테스트가 검증하는 것: 빈 배열 = null
  it("빈 배열 → true, 채워진 배열 → false", () => {
    expect(isFieldNull("benefits", [])).toBe(true);
    expect(isFieldNull("benefits", ["발코니무료"])).toBe(false);
    expect(isFieldNull("noxious", [])).toBe(true);
    expect(isFieldNull("priceByArea", [])).toBe(true);
    expect(isFieldNull("priceByArea", [{ area: 84 }])).toBe(false);
  });

  // 이 테스트가 검증하는 것: COALESCE 기본값 마스킹
  it("COALESCE 기본값 → true", () => {
    expect(isFieldNull("subwayDist", 9999)).toBe(true);
    expect(isFieldNull("icDist", 99)).toBe(true);
    expect(isFieldNull("ktxDist", 99)).toBe(true);
  });

  // 이 테스트가 검증하는 것: 실제 값은 기본값이 아님
  it("COALESCE 필드에 실제 값 → false", () => {
    expect(isFieldNull("subwayDist", 500)).toBe(false);
    expect(isFieldNull("icDist", 3)).toBe(false);
  });

  // 이 테스트가 검증하는 것: units 특수 케이스
  it("units <= 1 → true, units > 1 → false", () => {
    expect(isFieldNull("units", 0)).toBe(true);
    expect(isFieldNull("units", 1)).toBe(true);
    expect(isFieldNull("units", 500)).toBe(false);
  });

  // 이 테스트가 검증하는 것: 영구 미수집 필드
  it("영구 미수집 필드 (quakeDesign, greenBldg) → 항상 true", () => {
    expect(isFieldNull("quakeDesign", true)).toBe(true);
    expect(isFieldNull("greenBldg", "녹색1등급")).toBe(true);
  });
});

// ── computeAudit 테스트 ──────────────────────────────────────
describe("computeAudit", () => {
  // 이 테스트가 검증하는 것: 빈 입력 처리
  it("빈 배열 → total=0, 카테고리 비어있음", () => {
    const audit = computeAudit([]);
    expect(audit.total).toBe(0);
    expect(Object.keys(audit.categories)).toHaveLength(0);
  });

  // 이 테스트가 검증하는 것: 정상 데이터 감사 계산
  it("전체 필드 채워진 행 → 높은 커버리지", () => {
    const rows = [createFullRow(), createFullRow({ region: "부산" })];
    const audit = computeAudit(rows);

    expect(audit.total).toBe(2);
    expect(audit.avgReliability).toBe(85);

    // core 카테고리: 모든 필드 채움
    expect(audit.categories.core.rate).toBe(100);
    expect(audit.categories.price.rate).toBe(100);
    // building: energyGrade 영구 미수집(PERMANENT_NULL, 세션 358) → 12필드 중 11필드만 채움 = 91.7%
    expect(audit.categories.building.rate).toBeCloseTo(91.7, 0);

    // 지역별
    expect(audit.regions["서울"].apartments).toBe(1);
    expect(audit.regions["부산"].apartments).toBe(1);
  });

  // 이 테스트가 검증하는 것: null 필드가 있는 행의 감사
  it("일부 null 필드 → 커버리지 반영", () => {
    const row = createFullRow({
      energyGrade: null,
      parkingRatio: null,
      naverNearbyMedian: null,
      naverJeonseRate: null,
      benefits: [],
    });
    const audit = computeAudit([row]);

    // building: 12개 중 2개 null → ~83% (세션 258: maint 5필드 → maintenance 카테고리 분리)
    expect(audit.categories.building.rate).toBeGreaterThanOrEqual(80);

    // 필드별 상세
    expect(audit.fields["building.energyGrade"].missing).toBe(1);
    expect(audit.fields["building.parkingRatio"].missing).toBe(1);
    expect(audit.fields["building.maxFloor"].filled).toBe(1);
  });
});

// ── AUDIT_FIELDS 구조 테스트 ─────────────────────────────────
describe("AUDIT_FIELDS", () => {
  // 이 테스트가 검증하는 것: 19개 카테고리 정의 (17 기존 + air + safety, 세션 262)
  it("19개 카테고리 존재", () => {
    expect(Object.keys(AUDIT_FIELDS)).toHaveLength(19);
  });

  // 이 테스트가 검증하는 것: 각 카테고리에 collector와 fields 존재
  it("모든 카테고리에 collector + fields 존재", () => {
    for (const [cat, def] of Object.entries(AUDIT_FIELDS)) {
      expect(def.collector, `${cat}.collector 누락`).toBeTruthy();
      expect(def.fields.length, `${cat}.fields 비어있음`).toBeGreaterThan(0);
    }
  });

  // 이 테스트가 검증하는 것: maintenance 카테고리 신규 (세션 258 — building에서 maint 5필드 분리)
  it("maintenance 카테고리에 collector + maint 5필드", () => {
    const m = AUDIT_FIELDS.maintenance;
    expect(m.collector).toBe("collect-maintenance");
    expect(m.fields).toEqual(["maintHeat", "maintHotwater", "maintGas", "maintElec", "maintWater"]);
    // building에서 maint 필드 제거됐는지 — 이중 카운트 방지
    expect(AUDIT_FIELDS.building.fields).not.toContain("maintHeat");
  });

  // 이 테스트가 검증하는 것: air/safety 카테고리 신규 (세션 262 — 미감사 3필드 감사 편입)
  it("air/safety 카테고리에 collector + 신규 6필드", () => {
    expect(AUDIT_FIELDS.air.collector).toBe("collect-air-quality");
    expect(AUDIT_FIELDS.air.fields).toEqual(["airQuality"]);
    expect(AUDIT_FIELDS.safety.fields).toEqual([
      "crimeSafetyGrade", "emergency", "emergencyDist", "emergencyName", "emergencyType",
    ]);
  });
});

// ── fetchAllFromView regions merge (세션 351 — fetch/merge 5컬럼 누락 회귀 가드) ──
// 테이블별 mock 응답을 반환하는 Supabase 빌더. fetchAllFromTable 의
// from(table).select(cols, opts).eq?().range(a,b) → { data, error, count } 체인 재현.
/** @param {Record<string, Record<string, unknown>[]>} tableRows */
function makeMockSb(tableRows) {
  return {
    from(/** @type {string} */ table) {
      const rows = tableRows[table] ?? [];
      const result = { data: rows, error: null, count: rows.length };
      /** @type {any} */
      const builder = {
        select: () => builder,
        eq: () => builder,
        range: () => Promise.resolve(result),
      };
      return builder;
    },
  };
}

describe("fetchAllFromView regions merge", () => {
  // 빈 관련 테이블 7종 (regions 만 케이스별로 덮어씀)
  const EMPTY_RELATED = {
    prices: [], infra: [], schools: [], transport: [], builders: [], trade_stats: [],
  };

  // 이 테스트가 검증하는 것: regions 5개 시장지표 컬럼이 apt 객체에 camelCase 로 merge 되는지
  // (L431 fetch + L491-493 merge 누락 버그 회귀 가드 — 누락 시 priceIndex 등이 undefined)
  it("regions 5개 시장지표 컬럼이 priceIndex 등으로 merge 됨", async () => {
    const sb = makeMockSb({
      apartments: [{ id: "ah-1", region: "서울" }],
      ...EMPTY_RELATED,
      regions: [{
        region: "서울", gu: null, recorded_at: "2026-03-20",
        pop_growth: -0.8, supply_ratio: null, net_migration: -167,
        price_index: 232, avg_price_sqm: 16606, new_supply: 1158,
        initial_sale_rate: 100, land_cost_ratio: 59,
      }],
    });
    const rows = await fetchAllFromView(/** @type {any} */ (sb), null);
    expect(rows).toHaveLength(1);
    const apt = rows[0];
    expect(apt.priceIndex).toBe(232);
    expect(apt.avgPriceSqm).toBe(16606);
    expect(apt.newSupply).toBe(1158);
    expect(apt.initialSaleRate).toBe(100);
    expect(apt.landCostRatio).toBe(59);
    // 기존 3컬럼도 유지
    expect(apt.popGrowth).toBe(-0.8);
    expect(apt.netMigration).toBe(-167);
  });

  // 이 테스트가 검증하는 것: 시군구 행(gu non-null, price_index NULL)이 시도 행을 덮어쓰지 않음
  // (VIEW latest_regions 와 일치 — gu IS NULL 필터. 시군구 행이 먼저 와도 시도 값 보존)
  it("시군구 행이 먼저 와도 시도 행 값을 덮어쓰지 않음", async () => {
    const sb = makeMockSb({
      apartments: [{ id: "ah-1", region: "서울" }],
      ...EMPTY_RELATED,
      regions: [
        // 시군구 행이 배열 앞 — price_index NULL (덮어쓰면 안 됨)
        { region: "서울", gu: "강남구", recorded_at: "2026-03-20", price_index: null, pop_growth: 1.0 },
        // 시도 행 (gu null) — 진짜 시장지표 보유
        { region: "서울", gu: null, recorded_at: "2026-03-20", price_index: 232, pop_growth: -0.8 },
      ],
    });
    const rows = await fetchAllFromView(/** @type {any} */ (sb), null);
    const apt = rows[0];
    expect(apt.priceIndex).toBe(232); // 시도 행 값, 시군구 NULL 아님
    expect(apt.popGrowth).toBe(-0.8); // 시도 행 값
  });

  // 이 테스트가 검증하는 것: 같은 시도에 여러 recorded_at — 최신 행 선택 (VIEW ORDER BY recorded_at DESC)
  it("같은 시도 다중 recorded_at — 최신 행 선택", async () => {
    const sb = makeMockSb({
      apartments: [{ id: "ah-1", region: "서울" }],
      ...EMPTY_RELATED,
      regions: [
        { region: "서울", gu: null, recorded_at: "2026-01-01", price_index: 100 }, // 구
        { region: "서울", gu: null, recorded_at: "2026-03-20", price_index: 232 }, // 최신
      ],
    });
    const rows = await fetchAllFromView(/** @type {any} */ (sb), null);
    expect(rows[0].priceIndex).toBe(232);
  });
});
