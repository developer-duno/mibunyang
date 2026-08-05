// @ts-check
/**
 * noxious.mjs 테스트 — Haversine 거리 계산 검증
 */
import { describe, it, expect, vi } from "vitest";

// loadEnv + 외부 API 호출 방지
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return { ...orig, loadEnv: vi.fn(), getSupabase: vi.fn() };
});

const { haversineM, selectNoxiousTargets, buildNoxiousRow } = await import("./noxious.mjs");

describe("haversineM", () => {
  // 동일 좌표 → 0m
  it("동일 좌표는 0m를 반환한다", () => {
    expect(haversineM(37.5, 127.0, 37.5, 127.0)).toBe(0);
  });

  // 서울→부산 약 325km (오차 5km 이내)
  it("서울→부산 약 325km", () => {
    // 서울(37.5665, 126.978) → 부산(35.1796, 129.0756)
    const dist = haversineM(37.5665, 126.978, 35.1796, 129.0756);
    expect(dist).toBeGreaterThan(320_000);
    expect(dist).toBeLessThan(330_000);
  });

  // 짧은 거리 (1km 이내)
  it("가까운 두 지점의 거리를 정확히 계산한다", () => {
    // 약 1km 떨어진 두 지점 (위도 약 0.009도 ≈ 1km)
    const dist = haversineM(37.5, 127.0, 37.509, 127.0);
    expect(dist).toBeGreaterThan(900);
    expect(dist).toBeLessThan(1100);
  });

  // 적도 부근 경도 차이 검증
  it("적도에서 경도 1도 ≈ 약 111km", () => {
    const dist = haversineM(0, 0, 0, 1);
    expect(dist).toBeGreaterThan(110_000);
    expect(dist).toBeLessThan(112_000);
  });
});

/**
 * 세션 491 — 증분 수집 회귀 가드.
 *
 * 이전 구조는 매 실행이 전 단지(2,170건)를 다시 조회했다. 단지당 약 2.9초라 전수 105분인데
 * 워크플로 제한이 60분이라, 루프가 끝난 뒤 일괄 저장하던 코드에 도달하지 못하고 매번
 * SIGKILL(유예 0) 로 죽었다 — 3개월 연속 쓰기 0건, 미채움 236건 방치.
 * 아래 테스트는 그 구조가 되돌아오는 것을 막는다.
 */
describe("selectNoxiousTargets (증분 대상 추림)", () => {
  const rows = /** @type {any[]} */ ([
    { id: "a", noxious: null }, // 미조회
    { id: "b", noxious: ["장례식장"] }, // 조회 완료 (발견 있음)
    { id: "c", noxious: [] }, // 조회 완료 (발견 없음)
    { id: "d" }, // noxious 키 자체가 없음(undefined)
  ]);

  it("아직 조회하지 않은 단지만 고른다", () => {
    expect(selectNoxiousTargets(rows).map((r) => r.id)).toEqual(["a", "d"]);
  });

  it("빈 배열([])은 '조회했고 없음'이므로 건너뛴다 — 이게 없으면 매번 재조회된다", () => {
    expect(selectNoxiousTargets(rows).some((r) => r.id === "c")).toBe(false);
  });

  it("undefined 도 미조회로 본다 (=== null 로 좁히면 매번 재조회되는 함정)", () => {
    expect(selectNoxiousTargets(rows).some((r) => r.id === "d")).toBe(true);
  });

  it("--force 면 이미 조회한 단지까지 전량 반환한다", () => {
    expect(selectNoxiousTargets(rows, true)).toHaveLength(4);
  });

  it("전부 조회 완료면 대상이 0건이다 (헛도는 실행 방지)", () => {
    const done = /** @type {any[]} */ ([{ id: "x", noxious: [] }, { id: "y", noxious: ["변전소"] }]);
    expect(selectNoxiousTargets(done)).toEqual([]);
  });
});

describe("buildNoxiousRow (저장 행 생성)", () => {
  it("발견이 있으면 최근접 거리를 반올림해 담는다", () => {
    expect(buildNoxiousRow("a", ["장례식장"], 123.6)).toEqual({
      id: "a",
      noxious: ["장례식장"],
      noxious_dist: 124,
    });
  });

  it("발견 0건도 빈 배열로 기록한다 — 이게 없으면 다음 회차에 또 조회한다", () => {
    expect(buildNoxiousRow("b", [], Infinity)).toEqual({
      id: "b",
      noxious: [],
      noxious_dist: null,
    });
  });

  it("발견 0건이면 거리는 null 이다 (Infinity 가 DB 로 새지 않는다)", () => {
    const row = buildNoxiousRow("c", [], Infinity);
    expect(row.noxious_dist).toBeNull();
    expect(Number.isFinite(row.noxious_dist)).toBe(false);
  });

  // ⚠️ 이 케이스가 없으면 Number.isFinite 가드를 지워도 테스트가 전부 통과한다(실측).
  //    발견 0건일 때는 `found.length > 0` 이 이미 false 라 가드 없이도 null 이 나오기 때문.
  //    가드가 진짜 필요한 건 "발견은 있는데 거리를 못 구한" 경우다 — searchNearby 가
  //    dist 없는 결과를 돌려주게 바뀌면 Infinity 가 그대로 DB 에 박힌다.
  it("발견이 있어도 거리가 Infinity 면 null 로 막는다 (가드가 지워지면 여기서 걸린다)", () => {
    expect(buildNoxiousRow("d", ["장례식장"], Infinity).noxious_dist).toBeNull();
  });

  it("발견이 있고 거리가 NaN 이어도 null 로 막는다", () => {
    expect(buildNoxiousRow("e", ["변전소"], NaN).noxious_dist).toBeNull();
  });
});
