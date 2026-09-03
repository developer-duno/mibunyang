// @ts-check
/**
 * industry-match.mjs 테스트 — 산업단지 매칭 순수 함수 검증
 *
 * 대상: haversine
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";

// _shared.mjs 모킹
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return {
    ...orig,
    loadEnv: vi.fn(),
    getSupabase: vi.fn(),
    log: vi.fn(),
    logError: vi.fn(),
    ROOT: orig.ROOT,
  };
});

const { haversine } = await import("./industry-match.mjs");

// 소스를 직접 읽어 배선(어느 쿼리로 훑는지)을 검사한다 — transit-match.test.mjs 답습 패턴.
const COLLECTOR_SRC = readFileSync(new URL("./industry-match.mjs", import.meta.url), "utf8");

// ── haversine (industry-match) ────────────────────────────────
describe("haversine (industry-match)", () => {
  it("같은 좌표 → 거리 0", () => {
    expect(haversine(37.5, 127.0, 37.5, 127.0)).toBe(0);
  });

  it("서울↔대구 약 240km", () => {
    // 서울시청: 37.5665, 126.9780 / 대구시청: 35.8714, 128.6014
    const dist = haversine(37.5665, 126.9780, 35.8714, 128.6014);
    expect(dist).toBeGreaterThan(220);
    expect(dist).toBeLessThan(260);
  });

  it("반월시화산단 반경 10km 검증", () => {
    // 반월시화: 37.31, 126.73 / 안산시 중심: 37.32, 126.83 → ~8.5km
    const dist = haversine(37.31, 126.73, 37.32, 126.83);
    expect(dist).toBeGreaterThan(5);
    expect(dist).toBeLessThan(15);
  });
});

// 세션539 B-1: dev_plans(industrial_complex) 무정렬 OFFSET → 고유키(id) 커서 회귀 가드.
// 618건은 아직 1페이지 안이라 지금 당장은 무해하지만, 자매 조회(transit-match.mjs 의
// lh_zone)가 같은 무정렬 형태로 1,174건에서 이미 실제로 행을 잃고 있었다
// (unordered-pagination-loses-rows.md §1). select 문자열 리터럴 조각으로 고정 —
// toContain("id") 류는 옆 옵션 줄에 오매칭된다([[guards-must-be-mutation-tested]] §"소스 grep 가드").
describe("dev_plans(industrial_complex) 페이징 — 고유키 커서 회귀 가드 (세션539 B-1)", () => {
  it("select 는 id 를 포함하고 selectAll(..., sbSrc, \"id\") 커서로 훑는다", () => {
    expect(COLLECTOR_SRC.includes('.select("id, name, lat, lng")')).toBe(true);
    expect(COLLECTOR_SRC).toMatch(
      /\(s\) => s\.from\("dev_plans"\)\.select\("id, name, lat, lng"\)\.eq\("kind", "industrial_complex"\)\.not\("lat", "is", null\),\s*sbSrc,\s*"id",/,
    );
  });

  it("dev_plans 를 무정렬 .range() 손제작 루프로 훑지 않는다", () => {
    expect(COLLECTOR_SRC).not.toMatch(/from\("dev_plans"\)[\s\S]{0,200}?\.range\(/);
  });
});
