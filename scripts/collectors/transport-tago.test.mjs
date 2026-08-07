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

const {
  extractSubwayName, extractSubwayLines, isValidStation, isValidIC, buildTransportRow,
  fetchCollectedApartmentIds, fetchExistingApartmentIds, orderTargets, findHighFailureRates,
  RADIUS, KAKAO_MAX_RADIUS_M,
} = await import("./transport-tago.mjs");

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

// ── 완료 판정 기준 = bus_routes (세션 496, subway_name 아님) ──
describe("fetchCollectedApartmentIds — 완료 판정 기준 = bus_routes IS NOT NULL", () => {
  /**
   * 실제 PostgREST `.not(field, "is", null)` 동작을 흉내낸다: 넘겨받은 field 값 기준으로
   * null 인 행을 걸러낸 뒤에만 응답한다. field 인자가 "subway_name" 으로 되돌아가면(회귀)
   * 아래 (a)~(c) 케이스가 잘못된 집합을 돌려줘 즉시 잡힌다 — 뮤테이션 검증용.
   * @param {Record<string, unknown>[]} rows
   */
  function makeFilteringSb(rows) {
    /** @type {string[]} */
    const notCalls = [];
    const sb = {
      from: () => ({
        select: () => ({
          /** @param {string} field */
          not: (field) => {
            notCalls.push(field);
            const filtered = rows.filter((r) => r[field] != null);
            return {
              /** @param {number} from */
              range: (from) => Promise.resolve({ data: from === 0 ? filtered : [], error: null }),
            };
          },
        }),
      }),
    };
    return { sb, notCalls };
  }

  const rows = [
    { apartment_id: "ap-rural-no-subway", subway_name: null, bus_routes: 3 },   // (c) 지방: 지하철 없어도 버스 성공
    { apartment_id: "ap-zero-bus", subway_name: "강남역", bus_routes: 0 },       // (b) 버스 성공·0건
    { apartment_id: "ap-bus-fail", subway_name: "강남역", bus_routes: null },    // (a) 지하철 성공, 버스만 실패(동결 사례)
  ];

  it("필터 기준 필드는 bus_routes 다 (subway_name 이면 회귀)", async () => {
    const { sb, notCalls } = makeFilteringSb(rows);
    await fetchCollectedApartmentIds(sb);
    expect(notCalls).toEqual(["bus_routes"]);
  });

  it("(a) 지하철은 있어도 bus_routes null(TAGO 실패)인 행은 완료 집합에서 빠진다 — 동결 해소", async () => {
    const { sb } = makeFilteringSb(rows);
    const done = await fetchCollectedApartmentIds(sb);
    expect(done.has("ap-bus-fail")).toBe(false);
  });

  it("(b) bus_routes=0 (성공·0건) 인 행은 완료 집합에 포함된다", async () => {
    const { sb } = makeFilteringSb(rows);
    const done = await fetchCollectedApartmentIds(sb);
    expect(done.has("ap-zero-bus")).toBe(true);
  });

  it("(c) subway_name 이 null 이어도 bus_routes 가 있으면 완료 집합에 포함된다 — 지방 단지 헛돌이 해소", async () => {
    const { sb } = makeFilteringSb(rows);
    const done = await fetchCollectedApartmentIds(sb);
    expect(done.has("ap-rural-no-subway")).toBe(true);
  });

  it("옛 기준(subway_name)이었다면 정반대 결과가 나왔을 것 — 세 사례 전부 뒤집힘 확인", () => {
    // 회귀 방지 문서화: 옛 `.not("subway_name","is",null)` 기준이면
    // ap-rural-no-subway 는 매일 헛돌이(제외돼야 하는데 포함 안 됨), ap-bus-fail 은 동결(포함돼야 하는데 됨).
    const oldCriterionDone = new Set(
      rows.filter((r) => r.subway_name != null).map((r) => r.apartment_id),
    );
    expect(oldCriterionDone.has("ap-rural-no-subway")).toBe(false); // 옛 기준: 헛돌이(미완료로 계속 잡힘)
    expect(oldCriterionDone.has("ap-bus-fail")).toBe(true);         // 옛 기준: 동결(완료로 오판)
  });
});

// ── orderTargets — 신규 단지 우선 정렬 (세션 496) ──
describe("orderTargets — 신규(행 없음) 우선, 재시도(bus_routes null) 뒤로", () => {
  it("신규가 항상 재시도보다 앞에 온다", () => {
    const withCoords = [{ id: "retry-1" }, { id: "new-1" }, { id: "retry-2" }, { id: "new-2" }];
    const doneSet = new Set(); // 아무도 완료 아님
    const existingSet = new Set(["retry-1", "retry-2"]); // 이 둘만 행이 이미 있음(재시도 대상)
    const { targets, newCount, retryCount } = orderTargets(withCoords, doneSet, existingSet);
    expect(newCount).toBe(2);
    expect(retryCount).toBe(2);
    expect(targets.map((t) => t.id)).toEqual(["new-1", "new-2", "retry-1", "retry-2"]);
  });

  it("완료(doneSet) 는 신규·재시도 어느 쪽에도 안 들어간다", () => {
    const withCoords = [{ id: "done-1" }, { id: "new-1" }, { id: "retry-1" }];
    const doneSet = new Set(["done-1"]);
    const existingSet = new Set(["done-1", "retry-1"]);
    const { targets, newCount, retryCount } = orderTargets(withCoords, doneSet, existingSet);
    expect(newCount).toBe(1);
    expect(retryCount).toBe(1);
    expect(targets.map((t) => t.id)).toEqual(["new-1", "retry-1"]);
  });

  it("전부 신규(existingSet 빈 집합)면 원래 순서 그대로", () => {
    const withCoords = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const { targets, newCount, retryCount } = orderTargets(withCoords, new Set(), new Set());
    expect(newCount).toBe(3);
    expect(retryCount).toBe(0);
    expect(targets.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("전부 완료면 빈 배열", () => {
    const withCoords = [{ id: "a" }, { id: "b" }];
    const doneSet = new Set(["a", "b"]);
    const existingSet = new Set(["a", "b"]);
    const { targets, newCount, retryCount } = orderTargets(withCoords, doneSet, existingSet);
    expect(targets).toEqual([]);
    expect(newCount).toBe(0);
    expect(retryCount).toBe(0);
  });
});

// ── fetchExistingApartmentIds — transport 행 존재 여부(성공 무관) ──
describe("fetchExistingApartmentIds", () => {
  it("bus_routes 값과 무관하게 행이 있으면 포함", async () => {
    const chain = {
      /** @param {number} from */
      range: (from) =>
        Promise.resolve({
          data: from === 0 ? [{ apartment_id: "ap-1" }, { apartment_id: "ap-2" }] : [],
          error: null,
        }),
    };
    const sb = { from: () => ({ select: () => chain }) };
    const existing = await fetchExistingApartmentIds(sb);
    expect(existing.size).toBe(2);
    expect(existing.has("ap-1")).toBe(true);
    expect(existing.has("ap-2")).toBe(true);
  });

  it("행이 없으면 빈 Set", async () => {
    const chain = { range: () => Promise.resolve({ data: [], error: null }) };
    const sb = { from: () => ({ select: () => chain }) };
    const existing = await fetchExistingApartmentIds(sb);
    expect(existing.size).toBe(0);
  });
});

// ── findHighFailureRates — 실패율 경고 임계 (세션 496, 8-06 TAGO 100% 장애 관측성) ──
describe("findHighFailureRates — 신호별 실패율 50% 초과 경고", () => {
  it("버스만 100% 실패면 버스만 경고 (8-06 TAGO 100%·Kakao 91.6% 성공 재현)", () => {
    const result = findHighFailureRates({ subway: 1, bus: 10, ic: 0, ktx: 0 }, 10);
    expect(result.map((r) => r.label)).toEqual(["버스(TAGO)"]);
    expect(result[0].rate).toBe(1);
  });

  it("정확히 50% 는 경고 안 함 (임계는 초과만)", () => {
    const result = findHighFailureRates({ subway: 5, bus: 0, ic: 0, ktx: 0 }, 10);
    expect(result).toEqual([]);
  });

  it("51% 는 경고함", () => {
    const result = findHighFailureRates({ subway: 51, bus: 0, ic: 0, ktx: 0 }, 100);
    expect(result.map((r) => r.label)).toEqual(["지하철"]);
  });

  it("attempted=0 이면 빈 배열 (0으로 나누기 방지)", () => {
    expect(findHighFailureRates({ subway: 0, bus: 0, ic: 0, ktx: 0 }, 0)).toEqual([]);
  });

  it("전부 정상(실패 0)이면 빈 배열", () => {
    expect(findHighFailureRates({ subway: 0, bus: 0, ic: 0, ktx: 0 }, 100)).toEqual([]);
  });

  it("여러 신호가 동시에 임계를 넘으면 전부 반환", () => {
    const result = findHighFailureRates({ subway: 60, bus: 90, ic: 0, ktx: 0 }, 100);
    expect(result.map((r) => r.label).sort()).toEqual(["버스(TAGO)", "지하철"].sort());
  });
});

/**
 * 세션 497 회귀 가드 — 검색 반경은 "API 가 받아주는 상한" 과 "점수가 필요로 하는 하한"
 * 사이에 있어야 한다. 위를 넘기면 매 호출 400 으로 조용히 전멸하고(이번 사고), 아래로
 * 내려가면 점수에 쓰이는 거리를 놓쳐 센티널 99 가 늘어난다. 양쪽을 다 잠근다.
 *
 * 기대값은 일부러 상수를 다시 참조하지 않고 숫자를 직접 적는다 — 소스의 상수로 비교하면
 * 그 상수까지 같이 바뀔 때 테스트가 저 혼자 따라가서 아무것도 못 잡는다.
 */
describe("RADIUS — Kakao 반경 상한(20000m)과 점수 유효구간 사이", () => {
  it("KAKAO_MAX_RADIUS_M 은 공식 문서상 상한 20000m (developers.kakao.com/docs/ko/local/dev-guide)", () => {
    expect(KAKAO_MAX_RADIUS_M).toBe(20000);
  });

  it("모든 반경이 20000m 이하 — 넘으면 Kakao 가 400 ValidationError 로 거절한다", () => {
    const over = Object.entries(RADIUS).filter(([, m]) => m > 20000);
    expect(over).toEqual([]);
  });

  it("IC 반경은 10000m 이상 — scoreLocation IC_DIST_TIERS 가 10km 까지 점수를 준다", () => {
    expect(RADIUS.IC).toBeGreaterThanOrEqual(10000);
  });

  it("KTX 반경은 15000m 이상 — scoreLocation KTX_DIST_TIERS 가 15km 까지 점수를 준다", () => {
    expect(RADIUS.KTX).toBeGreaterThanOrEqual(15000);
  });
});
