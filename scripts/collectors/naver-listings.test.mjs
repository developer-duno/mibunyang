/**
 * naver-listings.mjs 테스트 — 네이버 매물 수집기 순수 함수 검증
 *
 * 대상: parseNaverPrice, calcPricePerPyeong, detectPool, toComplexRow, toArticleRow, enrichArticleFromDetail
 */
import { describe, it, expect, vi } from "vitest";

// _shared.mjs 모킹 — 외부 호출 차단
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = await importOriginal();
  return {
    ...orig,
    loadEnv: vi.fn(),
    getSupabase: vi.fn(),
    getMibuyangSupabase: vi.fn(),
    upsertBatch: vi.fn(),
    log: vi.fn(),
    logError: vi.fn(),
    today: vi.fn(() => "2026-03-30"),
  };
});

// 환경변수 설정 — 모듈 로드 시 process.exit 방지
process.env.SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "test-service-key";

const { parseNaverPrice, calcPricePerPyeong, detectPool, toComplexRow, toArticleRow, enrichArticleFromDetail } =
  await import("./naver-listings.mjs");

// ── 팩토리 ───────────────────────────────────────────────────
/** 네이버 단지 API 응답 팩토리 */
function makeComplexData(overrides = {}) {
  return {
    complexNo: "12345",
    complexName: "래미안아파트",
    realEstateTypeCode: "APT",
    latitude: "37.5",
    longitude: "127.0",
    totalHouseholdCount: 1000,
    useApproveYmd: "20200301",
    constructionCompanyName: "삼성물산",
    floorAreaRatio: "250.5",
    totalParkingCount: 1500,
    highFloor: 35,
    lowFloor: 3,
    minSupplyArea: "59.9",
    maxSupplyArea: "134.5",
    ...overrides,
  };
}

/** 네이버 매물 API 응답 팩토리 */
function makeArticleData(overrides = {}) {
  return {
    articleNo: "99001",
    tradeTypeName: "매매",
    dealOrWarrantPrc: "5억 3,000",
    rentPrc: "",
    area1: "84.9",
    area2: "59.9",
    floorInfo: "10/25",
    buildingName: "101동",
    direction: "남향",
    realEstateTypeName: "아파트",
    isVerifiedArticle: true,
    articleConfirmYmd: "20260330",
    ...overrides,
  };
}

// ── parseNaverPrice ───────────────────────────────────────────
describe("parseNaverPrice", () => {
  it("'2억 5,000' → 25000 (만원)", () => {
    expect(parseNaverPrice("2억 5,000")).toBe(25000);
  });

  it("'5억' → 50000", () => {
    expect(parseNaverPrice("5억")).toBe(50000);
  });

  it("'5천' → 5000", () => {
    expect(parseNaverPrice("5천")).toBe(5000);
  });

  it("'2억 3천' → 23000", () => {
    expect(parseNaverPrice("2억 3천")).toBe(23000);
  });

  it("'1억' → 10000", () => {
    expect(parseNaverPrice("1억")).toBe(10000);
  });

  it("null/undefined → 0", () => {
    expect(parseNaverPrice(null)).toBe(0);
    expect(parseNaverPrice(undefined)).toBe(0);
  });

  it("빈 문자열 → 0", () => {
    expect(parseNaverPrice("")).toBe(0);
  });

  it("'3,500' → 3500 (만원 단위 숫자)", () => {
    expect(parseNaverPrice("3,500")).toBe(3500);
  });

  it("'10억 5,000만원' → 105000", () => {
    expect(parseNaverPrice("10억 5,000만원")).toBe(105000);
  });

  it("'0' → 0", () => {
    expect(parseNaverPrice("0")).toBe(0);
  });
});

// ── calcPricePerPyeong ────────────────────────────────────────
describe("calcPricePerPyeong", () => {
  it("정상 계산 (5억, 84m²)", () => {
    const result = calcPricePerPyeong(50000, 84);
    // 50000 / (84 / 3.3058) ≈ 1967
    expect(result).toBeGreaterThan(1900);
    expect(result).toBeLessThan(2100);
  });

  it("price null → null", () => {
    expect(calcPricePerPyeong(null, 84)).toBeNull();
  });

  it("price 0 → null", () => {
    expect(calcPricePerPyeong(0, 84)).toBeNull();
  });

  it("areaM2 null → null", () => {
    expect(calcPricePerPyeong(50000, null)).toBeNull();
  });

  it("areaM2 0 → null", () => {
    expect(calcPricePerPyeong(50000, 0)).toBeNull();
  });

  it("areaM2 음수 → null", () => {
    expect(calcPricePerPyeong(50000, -10)).toBeNull();
  });

  it("반환값 정수 (Math.round)", () => {
    const result = calcPricePerPyeong(50000, 84);
    expect(Number.isInteger(result)).toBe(true);
  });
});

// ── detectPool ────────────────────────────────────────────────
describe("detectPool", () => {
  it("facilityInfo에 '수영' 포함 → true", () => {
    expect(detectPool({ facilityInfo: { name: "수영장" } })).toBe(true);
  });

  it("photos 카테고리에 'pool' 포함 → true", () => {
    expect(detectPool({ photos: [{ categoryName: "pool area" }] })).toBe(true);
  });

  it("tagList에 '수영장' 포함 → true", () => {
    expect(detectPool({ tagList: ["수영장", "헬스장"] })).toBe(true);
  });

  it("수영 관련 정보 없음 → null (false가 아님)", () => {
    expect(detectPool({ facilityInfo: { name: "헬스장" } })).toBeNull();
  });

  it("빈 객체 → null", () => {
    expect(detectPool({})).toBeNull();
  });

  it("complexFacility에 'pool' 포함 → true", () => {
    expect(detectPool({ complexFacility: "swimming pool" })).toBe(true);
  });

  it("detailDescription에 'swimming pool' 포함 → true", () => {
    expect(detectPool({ detailDescription: "This complex has a swimming pool." })).toBe(true);
  });
});

// ── toComplexRow ──────────────────────────────────────────────
describe("toComplexRow", () => {
  it("모든 필드 정상 매핑", () => {
    const row = toComplexRow(makeComplexData());
    expect(row.complex_no).toBe("12345");
    expect(row.complex_name).toBe("래미안아파트");
    expect(row.latitude).toBe(37.5);
    expect(row.longitude).toBe(127.0);
    expect(row.total_household_count).toBe(1000);
    expect(row.use_approve_ymd).toBe("20200301");
    expect(row.construction_company).toBe("삼성물산");
    expect(row.floor_area_ratio).toBe(250.5);
    expect(row.total_parking_count).toBe(1500);
    expect(row.high_floor).toBe(35);
    expect(row.low_floor).toBe(3);
    expect(row.min_supply_area_m2).toBe(59.9);
    expect(row.max_supply_area_m2).toBe(134.5);
    expect(row.last_crawled_at).toBeDefined();
  });

  it("필수 필드 누락 시 null 처리", () => {
    const row = toComplexRow({ complexNo: "999" });
    expect(row.complex_no).toBe("999");
    expect(row.complex_name).toBe("");
    expect(row.latitude).toBeNull();
    expect(row.longitude).toBeNull();
    expect(row.construction_company).toBeNull();
  });

  it("complexNumber 대체 키 사용", () => {
    const row = toComplexRow({ complexNumber: "888", name: "테스트" });
    expect(row.complex_no).toBe("888");
    expect(row.complex_name).toBe("테스트");
  });

  it("has_pool은 detectPool 결과 반영", () => {
    const row = toComplexRow(makeComplexData({ facilityInfo: { name: "수영장" } }));
    expect(row.has_pool).toBe(true);
  });
});

// ── toArticleRow ──────────────────────────────────────────────
describe("toArticleRow", () => {
  it("모든 필드 정상 매핑", () => {
    const row = toArticleRow(makeArticleData(), "12345");
    expect(row.article_no).toBe("99001");
    expect(row.complex_no).toBe("12345");
    expect(row.trade_type_name).toBe("매매");
    expect(row.numeric_price).toBe(53000); // 5억 3,000
    expect(row.area1_m2).toBe(84.9);
    expect(row.area2_m2).toBe(59.9);
    expect(row.floor_info).toBe("10/25");
    expect(row.direction).toBe("남향");
    expect(row.is_verified).toBe(true);
    expect(row.is_active).toBe(true);
    expect(row.is_presale).toBe(false);
  });

  it("분양권 감지 (realEstateTypeName)", () => {
    const row = toArticleRow(makeArticleData({ realEstateTypeName: "분양권" }), "12345");
    expect(row.is_presale).toBe(true);
  });

  it("분양권 감지 (articleRealEstateTypeName)", () => {
    const row = toArticleRow(makeArticleData({ articleRealEstateTypeName: "분양권(전매)" }), "12345");
    expect(row.is_presale).toBe(true);
  });

  it("가격 null → numeric_price null", () => {
    const row = toArticleRow(makeArticleData({ dealOrWarrantPrc: "" }), "12345");
    expect(row.numeric_price).toBeNull(); // parseNaverPrice returns 0, then || null → null
  });

  it("price_per_pyeong 계산", () => {
    const row = toArticleRow(makeArticleData(), "12345");
    // 53000만원 / (59.9 / 3.3058평) ≈ 2925
    expect(row.price_per_pyeong).toBeGreaterThan(2800);
    expect(row.price_per_pyeong).toBeLessThan(3100);
  });

  it("상세 필드는 null 초기화", () => {
    const row = toArticleRow(makeArticleData(), "12345");
    expect(row.room_count).toBeNull();
    expect(row.bathroom_count).toBeNull();
    expect(row.numeric_maintenance_cost).toBeNull();
    expect(row.move_in_date).toBeNull();
    expect(row.heating_type).toBeNull();
    expect(row.use_approve_ymd).toBeNull();
  });
});

// ── enrichArticleFromDetail ────────────────────────────────────
describe("enrichArticleFromDetail", () => {
  it("상세 API에서 방/욕실/관리비 보강", () => {
    const row = { room_count: null, bathroom_count: null, numeric_maintenance_cost: null };
    const detail = {
      articleDetail: {
        roomCount: 3,
        bathroomCount: 2,
        heatingTypeName: "개별난방",
        useApproveYmd: "20200301",
        moveInPossibleYmd: "20260401",
        maintenanceCost: {
          costsByDate: [{ commonPrice: "150000" }], // 15만원 → Math.round(150000/10000) = 15
        },
      },
      articleAddition: {},
    };

    const result = enrichArticleFromDetail(row, detail);
    expect(result.room_count).toBe(3);
    expect(result.bathroom_count).toBe(2);
    expect(result.heating_type).toBe("개별난방");
    expect(result.use_approve_ymd).toBe("20200301");
    expect(result.move_in_date).toBe("20260401");
    expect(result.numeric_maintenance_cost).toBe(15);
  });

  it("articleDetail 없음 → null 유지", () => {
    const row = { room_count: null };
    const result = enrichArticleFromDetail(row, {});
    expect(result.room_count).toBeNull();
  });

  it("관리비 데이터 없음 → numeric_maintenance_cost 변경 안 됨", () => {
    const row = { numeric_maintenance_cost: null };
    const detail = {
      articleDetail: { maintenanceCost: null },
      articleAddition: {},
    };
    const result = enrichArticleFromDetail(row, detail);
    expect(result.numeric_maintenance_cost).toBeNull();
  });

  it("costsByDate 빈 배열 → 관리비 미변경", () => {
    const row = { numeric_maintenance_cost: null };
    const detail = {
      articleDetail: { maintenanceCost: { costsByDate: [] } },
      articleAddition: {},
    };
    const result = enrichArticleFromDetail(row, detail);
    expect(result.numeric_maintenance_cost).toBeNull();
  });
});
