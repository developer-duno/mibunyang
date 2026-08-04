// @vitest-environment node
// @ts-check
/**
 * transport-tago.mjs 테스트 — 지하철역명/노선 추출, IC/KTX 필터, 증분 수집 로직
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return {
    ...orig,
    loadEnv: vi.fn(),
    getSupabase: vi.fn(),
    log: vi.fn(),
    logError: vi.fn(),
    fetchWithRetry: vi.fn(),
    sleep: vi.fn(),
    recordApiQuota: vi.fn(),
  };
});

const { extractSubwayName, extractSubwayLines, isValidStation, isValidIC, buildTransportRow, fetchCollectedApartmentIds } =
  await import("./transport-tago.mjs");

// ── 팩토리 함수 ────────────────────────────────────────────────

/** Kakao 검색 결과 객체 생성 */
function makeSubwayDoc(overrides = {}) {
  return {
    place_name: "강남역 2호선",
    category_name: "교통,지하철,수도권 2호선",
    distance: "500",
    ...overrides,
  };
}

// ── 테스트 ─────────────────────────────────────────────────────

describe('extractSubwayName — 지하철역명 추출', () => {
  it('정상 역명 추출: "강남역 2호선" → "강남역"', () => {
    expect(extractSubwayName({ place_name: "강남역 2호선" })).toBe("강남역");
  });

  it('역명만 있는 경우: "서울역" → "서울역"', () => {
    expect(extractSubwayName({ place_name: "서울역" })).toBe("서울역");
  });

  it('역 없는 이름: "강남터미널" → "강남터미널" (전체 반환)', () => {
    expect(extractSubwayName({ place_name: "강남터미널" })).toBe("강남터미널");
  });

  it('null 입력 → null', () => {
    expect(extractSubwayName(/** @type {any} */ (null))).toBeNull();
  });

  it('undefined 입력 → null', () => {
    expect(extractSubwayName(undefined)).toBeNull();
  });

  it('빈 place_name → 빈 문자열', () => {
    expect(extractSubwayName({ place_name: "" })).toBe("");
  });
});

describe('extractSubwayLines — 지하철 노선 추출', () => {
  it('카테고리에서 노선 추출: "2호선"', () => {
    const subways = [makeSubwayDoc()];
    expect(extractSubwayLines(subways, "강남역")).toBe("2호선");
  });

  it('복수 노선 추출: "2호선,신분당선"', () => {
    const subways = [
      makeSubwayDoc({ category_name: "교통,지하철,수도권 2호선" }),
      makeSubwayDoc({ place_name: "강남역 신분당선", category_name: "교통,지하철,신분당선" }),
    ];
    const result = extractSubwayLines(subways, "강남역");
    expect(result).toContain("2호선");
    expect(result).toContain("신분당선");
  });

  it('매칭 역명 없으면 null', () => {
    const subways = [makeSubwayDoc({ place_name: "역삼역 2호선" })];
    expect(extractSubwayLines(subways, "강남역")).toBeNull();
  });

  it('stationName null → null', () => {
    expect(extractSubwayLines([makeSubwayDoc()], null)).toBeNull();
  });

  it('빈 배열 → null', () => {
    expect(extractSubwayLines([], "강남역")).toBeNull();
  });

  it('한글 노선명: "경의중앙선"', () => {
    const subways = [makeSubwayDoc({
      place_name: "서울역 경의중앙선",
      category_name: "교통,지하철,경의중앙선",
    })];
    expect(extractSubwayLines(subways, "서울역")).toBe("경의중앙선");
  });
});

describe('isValidStation — KTX역 필터', () => {
  it('역으로 끝나는 이름 → true', () => {
    expect(isValidStation({ place_name: "서울역", category_name: "" })).toBe(true);
  });

  it('카테고리에 기차 포함 → true', () => {
    expect(isValidStation({ place_name: "서울", category_name: "기차역" })).toBe(true);
  });

  it('카테고리에 철도 포함 → true', () => {
    expect(isValidStation({ place_name: "KTX", category_name: "철도교통" })).toBe(true);
  });

  it('관련 없는 결과 → false', () => {
    expect(isValidStation({ place_name: "역삼공원", category_name: "공원" })).toBe(false);
  });

  it('빈 값 → false', () => {
    expect(isValidStation({ place_name: "", category_name: "" })).toBe(false);
  });
});

describe('isValidIC — 고속도로IC 필터', () => {
  it('IC 포함 → true', () => {
    expect(isValidIC({ place_name: "판교IC" })).toBe(true);
  });

  it('나들목 포함 → true', () => {
    expect(isValidIC({ place_name: "판교나들목" })).toBe(true);
  });

  it('인터체인지 포함 → true', () => {
    expect(isValidIC({ place_name: "판교인터체인지" })).toBe(true);
  });

  it('관련 없는 결과 → false', () => {
    expect(isValidIC({ place_name: "판교역" })).toBe(false);
  });

  it('빈 place_name → false', () => {
    expect(isValidIC({ place_name: "" })).toBe(false);
  });
});

// 세션98: buildTransportRow — 수집 실패(null)와 실제 0건([]) 구분
describe('buildTransportRow — TAGO 수집 실패/성공 신호 분리', () => {
  const baseInput = { apartmentId: "ah-1", subways: [], validICs: [], validKTX: [] };

  it('busStops=null (수집 실패): bus_routes/bus_stop_names 둘 다 null', () => {
    const row = buildTransportRow({ ...baseInput, busStops: null });
    expect(row.bus_routes).toBeNull();
    expect(row.bus_stop_names).toBeNull();
  });

  it('busStops=[] (성공·0건): bus_routes=0, bus_stop_names=null', () => {
    const row = buildTransportRow({ ...baseInput, busStops: [] });
    expect(row.bus_routes).toBe(0);
    expect(row.bus_stop_names).toBeNull();
  });

  it('busStops=[A,B] (성공·N건): bus_routes=2, bus_stop_names="A,B"', () => {
    const row = buildTransportRow({ ...baseInput, busStops: [{ nodenm: "A" }, { nodenm: "B" }] });
    expect(row.bus_routes).toBe(2);
    expect(row.bus_stop_names).toBe("A,B");
  });

  it('busStops=[A,A,B] (중복 제거): bus_routes=2', () => {
    const row = buildTransportRow({ ...baseInput, busStops: [{ nodenm: "A" }, { nodenm: "A" }, { nodenm: "B" }] });
    expect(row.bus_routes).toBe(2);
    expect(row.bus_stop_names).toBe("A,B");
  });

  it('busStops=[{nodenm:""},{nodenm:null}] (빈/null nodenm 필터): bus_routes=0', () => {
    const row = buildTransportRow({ ...baseInput, busStops: [{ nodenm: "" }, { nodenm: /** @type {any} */ (null) }] });
    expect(row.bus_routes).toBe(0);
    expect(row.bus_stop_names).toBeNull();
  });

  it('apartment_id + 다른 필드 통합: subway/IC/KTX 와 동시 조립', () => {
    const row = buildTransportRow({
      apartmentId: "ah-99",
      subways: [{ place_name: "강남역", distance: "350", category_name: "교통,지하철,2호선" }],
      busStops: null,
      validICs: [{ distance: "5500" }],
      validKTX: [{ distance: "12000" }],
    });
    expect(row.apartment_id).toBe("ah-99");
    expect(row.subway_dist).toBe(350);
    expect(row.subway_name).toBe("강남역");
    expect(row.bus_routes).toBeNull();
    expect(row.bus_stop_names).toBeNull();
    expect(row.ic_dist).toBe(5.5);
    expect(row.ktx_dist).toBe(12);
    expect(row.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ── fetchCollectedApartmentIds — PostgREST 1000행 상한 회귀 가드 (세션 490) ──
/**
 * PostgREST 를 흉내내는 가짜 Supabase.
 * 핵심: `.limit(N)` 을 줘도 **한 응답에 최대 1000행**만 돌려준다(max_rows). `.range()` 도 같은 상한.
 * 이 상한이 있어야 "옛 `.limit(10000)` 코드로 되돌리면 테스트가 깨진다"는 걸 실제로 검증할 수 있다.
 * @param {number} totalRows
 * @param {number} [cap]
 */
function makeCappedSb(totalRows, cap = 1000) {
  const all = Array.from({ length: totalRows }, (_, i) => ({ apartment_id: `ap-${i}` }));
  const chain = {
    /** @param {number} from @param {number} to */
    range: (from, to) =>
      Promise.resolve({ data: all.slice(from, Math.min(to + 1, from + cap)), error: null }),
    /** @param {number} n */
    limit: (n) => Promise.resolve({ data: all.slice(0, Math.min(n, cap)), error: null }),
  };
  return { from: () => ({ select: () => ({ not: () => chain }) }) };
}

describe("fetchCollectedApartmentIds — 1000행 상한 넘어 전량 조회", () => {
  it("1500건: 1000 에서 잘리지 않고 전량 반환 (옛 .limit(10000) 이면 1000 에서 멈춤)", async () => {
    const done = await fetchCollectedApartmentIds(makeCappedSb(1500));
    expect(done.size).toBe(1500);
    expect(done.has("ap-1499")).toBe(true);
  });

  it("2170건(운영 규모): 전량 반환", async () => {
    const done = await fetchCollectedApartmentIds(makeCappedSb(2170));
    expect(done.size).toBe(2170);
  });

  it("정확히 1000건(경계): 무한루프 없이 1000 반환", async () => {
    const done = await fetchCollectedApartmentIds(makeCappedSb(1000));
    expect(done.size).toBe(1000);
  });

  it("0건: 빈 Set", async () => {
    const done = await fetchCollectedApartmentIds(makeCappedSb(0));
    expect(done.size).toBe(0);
  });

  it("빈/누락 apartment_id 는 제외", async () => {
    const chain = {
      /** @param {number} from */
      range: (from) =>
        Promise.resolve({
          data: from === 0 ? [{ apartment_id: "ap-1" }, { apartment_id: "" }, {}] : [],
          error: null,
        }),
    };
    const sb = { from: () => ({ select: () => ({ not: () => chain }) }) };
    const done = await fetchCollectedApartmentIds(sb);
    expect(done.size).toBe(1);
    expect(done.has("ap-1")).toBe(true);
  });
});
