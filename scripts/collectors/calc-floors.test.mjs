// @ts-check
/**
 * calc-floors.mjs 테스트 — classifyFloors 층수 분류 검증
 */
import { describe, it, expect, vi } from "vitest";

// 외부 호출 방지
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return { ...orig, loadEnv: vi.fn(), getSupabase: vi.fn() };
});

const { classifyFloors, selectFloorTargets } = await import("./calc-floors.mjs");

describe("classifyFloors", () => {
  // null/0/음수 → null
  it("null 입력은 null을 반환한다", () => {
    expect(classifyFloors(null)).toBeNull();
  });

  it("undefined 입력은 null을 반환한다", () => {
    expect(classifyFloors(undefined)).toBeNull();
  });

  it("0층은 null을 반환한다", () => {
    expect(classifyFloors(0)).toBeNull();
  });

  it("음수는 null을 반환한다", () => {
    expect(classifyFloors(-3)).toBeNull();
  });

  // 저층 (1~5F)
  it("1층 → 저층(1~5F)", () => {
    expect(classifyFloors(1)).toBe("저층(1~5F)");
  });

  it("5층 → 저층(1~5F) (경계값)", () => {
    expect(classifyFloors(5)).toBe("저층(1~5F)");
  });

  // 중층 (6~15F)
  it("6층 → 중층(6~15F) (경계값)", () => {
    expect(classifyFloors(6)).toBe("중층(6~15F)");
  });

  it("15층 → 중층(6~15F) (경계값)", () => {
    expect(classifyFloors(15)).toBe("중층(6~15F)");
  });

  // 고층 (16~25F)
  it("16층 → 고층(16~25F) (경계값)", () => {
    expect(classifyFloors(16)).toBe("고층(16~25F)");
  });

  it("25층 → 고층(16~25F) (경계값)", () => {
    expect(classifyFloors(25)).toBe("고층(16~25F)");
  });

  // 초고층 (26F+)
  it("26층 → 초고층(26F+) (경계값)", () => {
    expect(classifyFloors(26)).toBe("초고층(26F+)");
  });

  it("50층 → 초고층(26F+)", () => {
    expect(classifyFloors(50)).toBe("초고층(26F+)");
  });
});

// 세션539 F-3: floors 가 max_floor 갱신을 못 따라가던 화석화 회귀 가드.
describe("selectFloorTargets", () => {
  it("floors 가 비어있으면 대상에 포함한다 (기존 동작 보존)", () => {
    const apts = [{ id: "a1", max_floor: 20, floors: null }];
    expect(selectFloorTargets(apts)).toEqual(apts);
  });

  it("floors 가 classifyFloors(max_floor) 와 어긋나면 대상에 포함한다 (화석화 정정 — 이게 없으면 red)", () => {
    // max_floor=90 은 초고층(26F+) 인데 floors 는 옛 값 "중층(6~15F)" 로 멈춰 있는 실측 사례.
    const apts = [{ id: "a2", max_floor: 90, floors: "중층(6~15F)" }];
    expect(selectFloorTargets(apts)).toEqual(apts);
  });

  it("floors 가 classifyFloors(max_floor) 와 일치하면 대상에서 제외한다 (불필요 UPDATE 방지)", () => {
    const apts = [{ id: "a3", max_floor: 20, floors: "고층(16~25F)" }];
    expect(selectFloorTargets(apts)).toEqual([]);
  });

  it("여러 단지 중 어긋난 것만 골라낸다", () => {
    const apts = [
      { id: "ok", max_floor: 10, floors: "중층(6~15F)" }, // 일치 → 제외
      { id: "empty", max_floor: 30, floors: null }, // 빈 값 → 포함
      { id: "stale", max_floor: 90, floors: "중층(6~15F)" }, // 어긋남 → 포함
    ];
    const targets = selectFloorTargets(apts);
    expect(targets.map((a) => a.id).sort()).toEqual(["empty", "stale"]);
  });
});
