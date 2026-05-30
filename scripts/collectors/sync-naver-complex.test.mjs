// @ts-check
/**
 * sync-naver-complex.mjs 테스트 — 네이버 단지 동기화 순수 함수 검증
 *
 * 대상: matchApartments, median, parseFloor, buildSpatialGrid, findNearbyComplexes
 */
import { describe, it, expect, vi } from "vitest";

// _shared.mjs 모킹 — stringSimilarity는 실제 구현 사용
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return {
    ...orig,
    loadEnv: vi.fn(),
    getSupabase: vi.fn(),
    getMibuyangSupabase: vi.fn(),
    log: vi.fn(),
    logError: vi.fn(),
    stringSimilarity: orig.stringSimilarity,
  };
});

const { matchApartments, median, parseFloor, buildSpatialGrid, findNearbyComplexes } =
  await import("./sync-naver-complex.mjs");

// ── 팩토리 ───────────────────────────────────────────────────
/**
 * @param {string} complexNo @param {string} name
 * @param {number|null} [lat] @param {number|null} [lng]
 */
function makeComplex(complexNo, name, lat = null, lng = null) {
  return /** @type {any} */ ({ complex_no: complexNo, complex_name: name, latitude: lat, longitude: lng });
}

/**
 * @param {string} id @param {string} name
 * @param {number|null} [lat] @param {number|null} [lng]
 */
function makeApt(id, name, lat = null, lng = null) {
  return /** @type {any} */ ({ id, name, lat, lng });
}

// ── median ────────────────────────────────────────────────────
describe("median (sync-naver-complex)", () => {
  it("빈 배열 → 0 (trade-stats와 다름)", () => {
    expect(median([])).toBe(0);
  });

  it("단일 요소 → 그대로", () => {
    expect(median([42])).toBe(42);
  });

  it("홀수 개 → 중앙값", () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it("짝수 개 → 두 중앙값 평균 (반올림)", () => {
    expect(median([10, 20, 30, 40])).toBe(25);
  });

  it("원본 배열 미변경", () => {
    const arr = [3, 1, 2];
    median(arr);
    expect(arr).toEqual([3, 1, 2]);
  });
});

// ── parseFloor ────────────────────────────────────────────────
describe("parseFloor", () => {
  it("'3/15' → 3 (슬래시 앞 파싱)", () => {
    expect(parseFloor("3/15")).toBe(3);
  });

  it("null/undefined → null", () => {
    expect(parseFloor(null)).toBeNull();
    expect(parseFloor(undefined)).toBeNull();
  });

  it("빈 문자열 → null", () => {
    expect(parseFloor("")).toBeNull();
  });

  it("한국어 '저' → 3", () => {
    expect(parseFloor("저")).toBe(3);
  });

  it("한국어 '중' → 8", () => {
    expect(parseFloor("중")).toBe(8);
  });

  it("한국어 '고' → 20", () => {
    expect(parseFloor("고")).toBe(20);
  });

  it("숫자 0 → null (0층 무효)", () => {
    expect(parseFloor("0")).toBeNull();
  });

  it("음수 → null", () => {
    expect(parseFloor("-1")).toBeNull();
  });

  it("200 이상 → null (범위 초과)", () => {
    expect(parseFloor("200")).toBeNull();
    expect(parseFloor("999")).toBeNull();
  });

  it("199 → 199 (유효 범위)", () => {
    expect(parseFloor("199")).toBe(199);
  });

  it("숫자 타입 입력 → String 변환 후 파싱", () => {
    expect(parseFloor(/** @type {any} */ (10))).toBe(10);
  });
});

// ── matchApartments ───────────────────────────────────────────
describe("matchApartments", () => {
  it("complexLinksMap에 매핑 있음 → 해당 아파트 반환", () => {
    const cpx = makeComplex("C001", "래미안");
    const apts = [makeApt("A1", "래미안", 37.5, 127.0), makeApt("A2", "힐스테이트", 37.5, 127.0)];
    const linksMap = new Map([["C001", ["A1"]]]);

    const result = matchApartments(cpx, apts, linksMap);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("A1");
  });

  it("complexLinksMap에 매핑 없음 → 이름 유사도로 폴백", () => {
    const cpx = makeComplex("C001", "래미안아파트");
    const apts = [
      makeApt("A1", "래미안아파트", 37.5, 127.0),
      makeApt("A2", "힐스테이트아파트", 37.5, 127.0),
    ];
    const linksMap = new Map();

    const result = matchApartments(cpx, apts, linksMap);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.some(a => a.id === "A1")).toBe(true);
  });

  it("매칭 결과 없음 → 빈 배열", () => {
    const cpx = makeComplex("C001", "완전다른이름");
    const apts = [makeApt("A1", "래미안아파트", 37.5, 127.0)];
    const linksMap = new Map();

    const result = matchApartments(cpx, apts, linksMap);
    expect(result).toEqual([]);
  });

  it("단지명 괄호 제거 후 매칭", () => {
    const cpx = makeComplex("C001", "래미안(1단지)");
    const apts = [makeApt("A1", "래미안", 37.5, 127.0)];
    const linksMap = new Map();

    // 괄호 제거 후 "래미안"으로 매칭
    const result = matchApartments(cpx, apts, linksMap);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it("linksMap 매핑이 빈 배열이면 이름 매칭으로 폴백", () => {
    const cpx = makeComplex("C001", "래미안아파트");
    const apts = [makeApt("A1", "래미안아파트", 37.5, 127.0)];
    const linksMap = new Map([["C001", []]]);

    const result = matchApartments(cpx, apts, linksMap);
    // nearbyIds가 빈 배열이므로 matched.length === 0 → 이름 매칭 폴백
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});

// ── buildSpatialGrid ──────────────────────────────────────────
describe("buildSpatialGrid", () => {
  it("좌표 있는 단지 → 그리드 셀에 배치", () => {
    const complexes = [makeComplex("C1", "A", 37.5, 127.0)];
    const { grid, cellSize } = buildSpatialGrid(complexes);
    expect(cellSize).toBe(0.02);
    expect(Object.keys(grid).length).toBe(1);
  });

  it("좌표 없는 단지 → 스킵", () => {
    const complexes = [makeComplex("C1", "A", null, null)];
    const { grid } = buildSpatialGrid(complexes);
    expect(Object.keys(grid).length).toBe(0);
  });

  it("같은 셀에 여러 단지 배치", () => {
    // 0.02도 셀 = ~2km, 같은 셀 내 근접 좌표
    const complexes = [
      makeComplex("C1", "A", 37.500, 127.000),
      makeComplex("C2", "B", 37.501, 127.001),
    ];
    const { grid } = buildSpatialGrid(complexes);
    // 같은 셀에 2개
    const cells = Object.values(grid);
    const totalItems = cells.reduce((sum, arr) => sum + arr.length, 0);
    expect(totalItems).toBe(2);
  });

  it("커스텀 cellSize", () => {
    const complexes = [makeComplex("C1", "A", 37.5, 127.0)];
    const { cellSize } = buildSpatialGrid(complexes, 0.05);
    expect(cellSize).toBe(0.05);
  });
});

// ── findNearbyComplexes ───────────────────────────────────────
describe("findNearbyComplexes", () => {
  it("반경 내 단지 반환", () => {
    // 서울 강남역 근처 (~300m 거리)
    const complexes = [
      makeComplex("C1", "A", 37.4979, 127.0276),
      makeComplex("C2", "B", 37.4990, 127.0280),
    ];
    const spatialGrid = buildSpatialGrid(complexes);
    const apt = makeApt("A1", "test", 37.4985, 127.0278);

    const result = findNearbyComplexes(apt, spatialGrid, 2);
    expect(result).toContain("C1");
    expect(result).toContain("C2");
  });

  it("반경 외 단지 제외", () => {
    // ~50km 떨어진 좌표
    const complexes = [makeComplex("C1", "A", 38.0, 127.0)];
    const spatialGrid = buildSpatialGrid(complexes);
    const apt = makeApt("A1", "test", 37.5, 127.0);

    const result = findNearbyComplexes(apt, spatialGrid, 2);
    expect(result).toEqual([]);
  });

  it("apt에 좌표 없음 → 빈 배열", () => {
    const complexes = [makeComplex("C1", "A", 37.5, 127.0)];
    const spatialGrid = buildSpatialGrid(complexes);
    const apt = makeApt("A1", "test", null, null);

    const result = findNearbyComplexes(apt, spatialGrid);
    expect(result).toEqual([]);
  });

  it("빈 그리드 → 빈 배열", () => {
    const spatialGrid = buildSpatialGrid([]);
    const apt = makeApt("A1", "test", 37.5, 127.0);

    const result = findNearbyComplexes(apt, spatialGrid);
    expect(result).toEqual([]);
  });

  it("같은 좌표 → 거리 0, 반드시 포함", () => {
    const complexes = [makeComplex("C1", "A", 37.5, 127.0)];
    const spatialGrid = buildSpatialGrid(complexes);
    const apt = makeApt("A1", "test", 37.5, 127.0);

    const result = findNearbyComplexes(apt, spatialGrid, 0.001);
    expect(result).toContain("C1");
  });
});
