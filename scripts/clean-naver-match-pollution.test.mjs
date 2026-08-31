// @ts-check
/**
 * clean-naver-match-pollution.mjs 테스트 — 오염 판정 순수 함수 검증 (세션536)
 */
import { describe, it, expect } from "vitest";
import {
  isExactNameTwin,
  stripBrackets,
  detectPollution,
  scanPollution,
  isPlausible,
  HOLD_CATEGORY,
  FIELD_SPECS,
  RADIUS_M,
  RATIO_THRESHOLD,
  TWIN_HOUSEHOLD_MIN,
} from "./clean-naver-match-pollution.mjs";
import { buildSpatialGrid } from "./collectors/sync-naver-complex.mjs";

// ── 팩토리 ───────────────────────────────────────────────────
/** @param {string} no @param {string} name @param {number|null} lat @param {number|null} lng @param {Record<string, unknown>} [fields] */
function makeCpx(no, name, lat, lng, fields = {}) {
  return /** @type {any} */ ({ complex_no: no, complex_name: name, latitude: lat, longitude: lng, total_household_count: null, ...fields });
}

/** @param {string} id @param {string} name @param {number|null} lat @param {number|null} lng @param {Record<string, unknown>} [fields] */
function makeApt(id, name, lat, lng, fields = {}) {
  return /** @type {any} */ ({ id, name, lat, lng, ...fields });
}

const FAR_R = RADIUS_M; // 500

// ── stripBrackets ────────────────────────────────────────────
describe("stripBrackets", () => {
  it("괄호와 내용을 제거한다", () => {
    expect(stripBrackets("브이티스타일(주상복합)")).toBe("브이티스타일");
  });

  it("괄호 없으면 앞뒤 공백만 trim", () => {
    expect(stripBrackets("  청계산아이파크1차  ")).toBe("청계산아이파크1차");
  });

  it("null/undefined → 빈 문자열", () => {
    expect(stripBrackets(null)).toBe("");
    expect(stripBrackets(undefined)).toBe("");
  });
});

// ── isExactNameTwin ───────────────────────────────────────────
describe("isExactNameTwin", () => {
  it("완전 동일 이름 → true", () => {
    expect(isExactNameTwin("청계산아이파크1차", "청계산아이파크1차")).toBe(true);
  });

  it("공백만 다름 → true (stringSimilarity 가 공백 제거 후 비교)", () => {
    expect(isExactNameTwin("청계산 아이파크 1차", "청계산아이파크1차")).toBe(true);
  });

  it("괄호 포함 후보 → false (주상복합 등 접미사 혼입 방지)", () => {
    expect(isExactNameTwin("이안논현오션파크(주상복합)", "이안논현오션파크")).toBe(false);
  });

  it("다른 이름 → false", () => {
    expect(isExactNameTwin("해운대엘시티더샵", "청계산아이파크1차")).toBe(false);
  });

  it("null/undefined 이름 → false", () => {
    expect(isExactNameTwin(null, "청계산아이파크1차")).toBe(false);
    expect(isExactNameTwin(undefined, "청계산아이파크1차")).toBe(false);
  });
});

// ── detectPollution ───────────────────────────────────────────
describe("detectPollution", () => {
  const spec = FIELD_SPECS.find((s) => s.key === "floor_area_ratio");
  if (!spec) throw new Error("floor_area_ratio spec 없음");

  it("apt 값 없음(null) → polluted false", () => {
    const apt = makeApt("A1", "test", 37.5, 127.0, { floor_area_ratio: null });
    const grid = buildSpatialGrid([]);
    const result = detectPollution(apt, grid, new Map(), spec);
    expect(result.polluted).toBe(false);
    expect(result.reason).toBe("값 없음");
  });

  it("apt 좌표 없음 → polluted false", () => {
    const apt = makeApt("A1", "test", null, null, { floor_area_ratio: 300 });
    const grid = buildSpatialGrid([]);
    const result = detectPollution(apt, grid, new Map(), spec);
    expect(result.polluted).toBe(false);
    expect(result.reason).toBe("apt 좌표 없음");
  });

  it("500m 이내 후보는 있으나 이름이 다름 → polluted false", () => {
    const cpx = makeCpx("C1", "해운대엘시티더샵", 37.5, 127.0, { floor_area_ratio: 100 });
    const apt = makeApt("A1", "청계산아이파크1차", 37.5, 127.0, { floor_area_ratio: 300 });
    const grid = buildSpatialGrid([cpx]);
    const complexByNo = new Map([["C1", cpx]]);
    const result = detectPollution(apt, grid, complexByNo, spec);
    expect(result.polluted).toBe(false);
    expect(result.reason).toBe("완전동명 후보 없음");
  });

  it("완전동명 후보 2개(모호) → polluted false", () => {
    const cpx1 = makeCpx("C1", "청계산아이파크1차", 37.5, 127.0, { floor_area_ratio: 100 });
    const cpx2 = makeCpx("C2", "청계산아이파크1차", 37.5001, 127.0, { floor_area_ratio: 100 });
    const apt = makeApt("A1", "청계산아이파크1차", 37.5, 127.0, { floor_area_ratio: 300 });
    const grid = buildSpatialGrid([cpx1, cpx2]);
    const complexByNo = new Map([["C1", cpx1], ["C2", cpx2]]);
    const result = detectPollution(apt, grid, complexByNo, spec);
    expect(result.polluted).toBe(false);
    expect(result.reason).toContain("모호");
  });

  it("유일 완전동명 twin(신뢰도 높음), 1.5배 이상 어긋남 → polluted true", () => {
    // total_household_count 를 신뢰도 문턱 이상으로 줘야 새 신뢰도 게이트를 통과한다.
    const cpx = makeCpx("C1", "청계산아이파크1차", 37.5, 127.0, { floor_area_ratio: 244, total_household_count: 500 });
    const apt = makeApt("A1", "청계산아이파크1차", 37.5, 127.0, { floor_area_ratio: 1294 }); // 실사례(강릉자이르네디오션) 답습
    const grid = buildSpatialGrid([cpx]);
    const complexByNo = new Map([["C1", cpx]]);
    const result = detectPollution(apt, grid, complexByNo, spec);
    expect(result.polluted).toBe(true);
    expect(result.twinValue).toBe(244);
    expect(result.ratio).toBeCloseTo(1294 / 244, 5);
  });

  it("유일 완전동명 twin, 1.5배 미만(임계 아래) → polluted false", () => {
    const cpx = makeCpx("C1", "청계산아이파크1차", 37.5, 127.0, { floor_area_ratio: 200 });
    const apt = makeApt("A1", "청계산아이파크1차", 37.5, 127.0, { floor_area_ratio: 250 }); // 1.25배
    const grid = buildSpatialGrid([cpx]);
    const complexByNo = new Map([["C1", cpx]]);
    const result = detectPollution(apt, grid, complexByNo, spec);
    expect(result.polluted).toBe(false);
    expect(result.reason).toContain("임계 미만");
  });

  it("정확히 경계값(1.5배), 신뢰도 높음 → polluted true (>= 포함)", () => {
    const cpx = makeCpx("C1", "청계산아이파크1차", 37.5, 127.0, { floor_area_ratio: 200, total_household_count: 500 });
    const apt = makeApt("A1", "청계산아이파크1차", 37.5, 127.0, { floor_area_ratio: 300 }); // 정확히 1.5배
    const grid = buildSpatialGrid([cpx]);
    const complexByNo = new Map([["C1", cpx]]);
    const result = detectPollution(apt, grid, complexByNo, spec);
    expect(result.polluted).toBe(true);
  });

  it("twin 값 0 → 비교 불가(polluted false) — sentinel 0값 오염 방지", () => {
    const cpx = makeCpx("C1", "청계산아이파크1차", 37.5, 127.0, { floor_area_ratio: 0 });
    const apt = makeApt("A1", "청계산아이파크1차", 37.5, 127.0, { floor_area_ratio: 300 });
    const grid = buildSpatialGrid([cpx]);
    const complexByNo = new Map([["C1", cpx]]);
    const result = detectPollution(apt, grid, complexByNo, spec);
    expect(result.polluted).toBe(false);
    expect(result.reason).toContain("비교 불가");
  });

  it("apt 값 0 → 비교 불가(polluted false)", () => {
    const cpx = makeCpx("C1", "청계산아이파크1차", 37.5, 127.0, { floor_area_ratio: 200 });
    const apt = makeApt("A1", "청계산아이파크1차", 37.5, 127.0, { floor_area_ratio: 0 });
    const grid = buildSpatialGrid([cpx]);
    const complexByNo = new Map([["C1", cpx]]);
    const result = detectPollution(apt, grid, complexByNo, spec);
    expect(result.polluted).toBe(false);
  });

  it("500m 밖 완전동명 twin → 후보 자체가 안 잡힘(polluted false)", () => {
    const cpx = makeCpx("C1", "청계산아이파크1차", 38.0, 127.0, { floor_area_ratio: 100 }); // ~55.5km
    const apt = makeApt("A1", "청계산아이파크1차", 37.5, 127.0, { floor_area_ratio: 1000 });
    const grid = buildSpatialGrid([cpx]);
    const complexByNo = new Map([["C1", cpx]]);
    const result = detectPollution(apt, grid, complexByNo, spec);
    expect(result.polluted).toBe(false);
    expect(result.reason).toBe("완전동명 후보 없음");
  });

  it("max_floor 필드 매핑 — apt.max_floor ↔ cpx.high_floor (이름 다름), 신뢰도 높음", () => {
    const maxFloorSpec = FIELD_SPECS.find((s) => s.key === "max_floor");
    if (!maxFloorSpec) throw new Error("max_floor spec 없음");
    const cpx = makeCpx("C1", "청계산아이파크1차", 37.5, 127.0, { high_floor: 15, total_household_count: 500 });
    const apt = makeApt("A1", "청계산아이파크1차", 37.5, 127.0, { max_floor: 40 }); // 2.67배
    const grid = buildSpatialGrid([cpx]);
    const complexByNo = new Map([["C1", cpx]]);
    const result = detectPollution(apt, grid, complexByNo, maxFloorSpec);
    expect(result.polluted).toBe(true);
    expect(result.twinValue).toBe(15);
  });

  // ── 쌍둥이 신뢰도 게이트 (b) ────────────────────────────────
  describe("쌍둥이 신뢰도 게이트 (b) — 세대수 작고 그리고 활성매물도 0", () => {
    it("세대수<20 그리고 활성매물0 → 판정 보류(polluted false)", () => {
      const cpx = makeCpx("C1", "청계산아이파크1차", 37.5, 127.0, { floor_area_ratio: 200, total_household_count: 13 });
      const apt = makeApt("A1", "청계산아이파크1차", 37.5, 127.0, { floor_area_ratio: 2300 }); // 11.5배
      const grid = buildSpatialGrid([cpx]);
      const complexByNo = new Map([["C1", cpx]]);
      const result = detectPollution(apt, grid, complexByNo, spec, new Map()); // activeCounts 미제공 → 0 취급
      expect(result.polluted).toBe(false);
      expect(result.reason).toContain("판정 보류");
      expect(result.reason).toContain("신뢰도 낮음");
      expect(result.twinHousehold).toBe(13);
      expect(result.twinActiveListings).toBe(0);
    });

    it("세대수 크면(대형단지) 활성매물0 이어도 폴루션 판정 유지 — '매물0=부실' 아님", () => {
      const cpx = makeCpx("C1", "청계산아이파크1차", 37.5, 127.0, { floor_area_ratio: 200, total_household_count: 500 });
      const apt = makeApt("A1", "청계산아이파크1차", 37.5, 127.0, { floor_area_ratio: 400 }); // 2배
      const grid = buildSpatialGrid([cpx]);
      const complexByNo = new Map([["C1", cpx]]);
      const result = detectPollution(apt, grid, complexByNo, spec, new Map());
      expect(result.polluted).toBe(true);
    });

    it("세대수 30(문턱 20 근방) + 활성매물0 → 문턱 20 기준으로는 신뢰 인정, 폴루션 판정 유지 (경쟁 후보 10/50 과의 분기점)", () => {
      // 문턱=50 이면 30<50 이라 판정 보류로 뒤집힌다 — 20 채택 근거(과제 실측 "50=과함")를 이 테스트가 못박는다.
      const cpx = makeCpx("C1", "청계산아이파크1차", 37.5, 127.0, { floor_area_ratio: 200, total_household_count: 30 });
      const apt = makeApt("A1", "청계산아이파크1차", 37.5, 127.0, { floor_area_ratio: 400 }); // 2배
      const grid = buildSpatialGrid([cpx]);
      const complexByNo = new Map([["C1", cpx]]);
      const result = detectPollution(apt, grid, complexByNo, spec, new Map());
      expect(result.polluted).toBe(true);
    });

    it("세대수 작아도 활성매물 있으면 폴루션 판정 유지 — 둘 다 약할 때만 보류", () => {
      const cpx = makeCpx("C1", "청계산아이파크1차", 37.5, 127.0, { floor_area_ratio: 200, total_household_count: 13 });
      const apt = makeApt("A1", "청계산아이파크1차", 37.5, 127.0, { floor_area_ratio: 400 }); // 2배
      const grid = buildSpatialGrid([cpx]);
      const complexByNo = new Map([["C1", cpx]]);
      const activeCounts = new Map([["C1", 5]]);
      const result = detectPollution(apt, grid, complexByNo, spec, activeCounts);
      expect(result.polluted).toBe(true);
    });

    it("세대수 미상(null) 그리고 활성매물0 → 신뢰도 낮음으로 보류(미상=신뢰 안 함)", () => {
      const cpx = makeCpx("C1", "청계산아이파크1차", 37.5, 127.0, { floor_area_ratio: 200, total_household_count: null });
      const apt = makeApt("A1", "청계산아이파크1차", 37.5, 127.0, { floor_area_ratio: 400 });
      const grid = buildSpatialGrid([cpx]);
      const complexByNo = new Map([["C1", cpx]]);
      const result = detectPollution(apt, grid, complexByNo, spec, new Map());
      expect(result.polluted).toBe(false);
      expect(result.reason).toContain("판정 보류");
    });
  });

  // ── 쌍둥이 신뢰도 게이트 (c) ────────────────────────────────
  describe("쌍둥이 신뢰도 게이트 (c) — 배제된(괄호 있는) 다른 후보가 저장값에 더 가까움", () => {
    const maxFloorSpec = FIELD_SPECS.find((s) => s.key === "max_floor");
    if (!maxFloorSpec) throw new Error("max_floor spec 없음");

    it("신뢰도 높은 twin 이 선택돼도, 배제된 후보 값이 저장값과 더 가까우면 판정 보류", () => {
      const selected = makeCpx("C-sel", "테스트단지", 37.5, 127.0, { high_floor: 5, total_household_count: 200 }); // 신뢰도 높음
      const excluded = makeCpx("C-exc", "테스트단지(주상복합)", 37.5001, 127.0, { high_floor: 22 }); // 괄호로 배제
      const apt = makeApt("A1", "테스트단지", 37.5, 127.0, { max_floor: 23 }); // selected(5)와 4.6배 / excluded(22)와 1.045배
      const grid = buildSpatialGrid([selected, excluded]);
      const complexByNo = new Map([["C-sel", selected], ["C-exc", excluded]]);
      const activeCounts = new Map([["C-sel", 10]]); // 게이트(b) 는 통과시켜 (c) 단독 효과를 본다
      const result = detectPollution(apt, grid, complexByNo, maxFloorSpec, activeCounts);
      expect(result.polluted).toBe(false);
      expect(result.reason).toContain("판정 보류");
      expect(result.reason).toContain("배제된 다른 후보");
    });

    it("배제된 후보도 저장값과 멀면 여전히 폴루션 판정", () => {
      const selected = makeCpx("C-sel", "테스트단지", 37.5, 127.0, { high_floor: 5, total_household_count: 200 });
      const excluded = makeCpx("C-exc", "테스트단지(주상복합)", 37.5001, 127.0, { high_floor: 4 }); // apt(23)와도 멀다
      const apt = makeApt("A1", "테스트단지", 37.5, 127.0, { max_floor: 23 });
      const grid = buildSpatialGrid([selected, excluded]);
      const complexByNo = new Map([["C-sel", selected], ["C-exc", excluded]]);
      const activeCounts = new Map([["C-sel", 10]]);
      const result = detectPollution(apt, grid, complexByNo, maxFloorSpec, activeCounts);
      expect(result.polluted).toBe(true);
    });
  });

  // ── 실사례 회귀 — 브이티스타일 반례 ────────────────────────
  it("실사례 회귀: 브이티스타일 — 괄호 있는 진짜 단지(75세대·활성18건)를 배제해도 소형 부속동(13세대·활성0건)만으로는 삭제하지 않는다", () => {
    const maxFloorSpec = FIELD_SPECS.find((s) => s.key === "max_floor");
    if (!maxFloorSpec) throw new Error("max_floor spec 없음");
    const real = makeCpx("C-real", "브이티스타일(주상복합)", 37.5737869, 127.0724965, { high_floor: 15, total_household_count: 75 });
    const annex = makeCpx("C-annex", "브이티스타일", 37.5737879, 127.0724975, { high_floor: 2, total_household_count: 13 }); // ~3m
    const apt = makeApt("ah-vt", "브이티스타일", 37.5737869, 127.0724965, { max_floor: 23 });
    const grid = buildSpatialGrid([real, annex]);
    const complexByNo = new Map([["C-real", real], ["C-annex", annex]]);
    const activeCounts = new Map([["C-real", 18]]); // annex 는 활성매물 0(맵에 없음)
    const result = detectPollution(apt, grid, complexByNo, maxFloorSpec, activeCounts);
    expect(result.polluted).toBe(false);
    expect(result.reason).toContain("판정 보류");
  });
});

// ── scanPollution ─────────────────────────────────────────────
describe("scanPollution", () => {
  it("여러 apt·여러 field 를 훑어 필드별로 집계한다", () => {
    const cpxNear = makeCpx("C1", "청계산아이파크1차", 37.5, 127.0, {
      floor_area_ratio: 200, building_coverage_ratio: 20, high_floor: 15, total_household_count: 300,
    });
    const cpxFar = makeCpx("C2", "해운대엘시티더샵", 38.0, 127.0, {
      floor_area_ratio: 500, building_coverage_ratio: 60, high_floor: 80, total_household_count: 300,
    });
    const aptPolluted = makeApt("A1", "청계산아이파크1차", 37.5, 127.0, {
      floor_area_ratio: 1000, // vs twin 200 = 5배 → polluted (twin 신뢰도 높음)
      building_coverage_ratio: 21, // vs twin 20 = 1.05배 → 정상
      max_floor: 16, // vs twin(high_floor) 15 = 1.07배 → 정상
    });
    const aptClean = makeApt("A2", "해운대엘시티더샵", 38.0, 127.0, {
      floor_area_ratio: 505, // vs twin 500 → 정상
      building_coverage_ratio: null,
      max_floor: null,
    });
    const grid = buildSpatialGrid([cpxNear, cpxFar]);
    const complexByNo = new Map([["C1", cpxNear], ["C2", cpxFar]]);

    const { targetsByField } = scanPollution([aptPolluted, aptClean], grid, complexByNo);

    expect(targetsByField.floor_area_ratio).toHaveLength(1);
    expect(targetsByField.floor_area_ratio[0].id).toBe("A1");
    expect(targetsByField.floor_area_ratio[0].storedValue).toBe(1000);
    expect(targetsByField.floor_area_ratio[0].twinHousehold).toBe(300);
    expect(targetsByField.floor_area_ratio[0].twinActiveListings).toBe(0);
    expect(targetsByField.building_coverage_ratio).toHaveLength(0);
    expect(targetsByField.max_floor).toHaveLength(0);
  });

  it("대상 0건이면 모든 필드가 빈 배열 + 보류 집계도 0", () => {
    const { targetsByField, holdsByField } = scanPollution([], buildSpatialGrid([]), new Map());
    for (const spec of FIELD_SPECS) {
      expect(targetsByField[spec.key]).toEqual([]);
      expect(holdsByField[spec.key]).toEqual({ twin_weak: 0, twin_implausible: 0, closer_excluded: 0 });
    }
  });

  it("activeCounts 를 넘기면 신뢰도 게이트로 세대수 작은 쌍둥이가 제외된다 — holdsByField.twin_weak 1건 집계", () => {
    // aptVal=2000 은 물리 타당범위(30~800) 밖이라 게이트(d)는 관여하지 않고 게이트(b)만 작동한다.
    const cpx = makeCpx("C1", "청계산아이파크1차", 37.5, 127.0, { floor_area_ratio: 200, total_household_count: 5 });
    const apt = makeApt("A1", "청계산아이파크1차", 37.5, 127.0, { floor_area_ratio: 2000 });
    const grid = buildSpatialGrid([cpx]);
    const complexByNo = new Map([["C1", cpx]]);
    const { targetsByField, holdsByField } = scanPollution([apt], grid, complexByNo, new Map()); // activeCounts 빈 맵 → 활성0 취급
    expect(targetsByField.floor_area_ratio).toHaveLength(0); // 신뢰도 낮아 보류
    expect(holdsByField.floor_area_ratio.twin_weak).toBe(1);
    expect(holdsByField.floor_area_ratio.twin_implausible).toBe(0);
  });

  it("게이트(d)로 보류된 건이 holdsByField.twin_implausible 에 집계된다", () => {
    // 우리 값(259, 타당범위 안) vs 쌍둥이(880, 범위 밖) — 세대수 70(≥20)이라 게이트(b)는 안 걸림.
    const cpx = makeCpx("C1", "테스트단지", 37.5, 127.0, { floor_area_ratio: 880, total_household_count: 70 });
    const apt = makeApt("A1", "테스트단지", 37.5, 127.0, { floor_area_ratio: 259 });
    const grid = buildSpatialGrid([cpx]);
    const complexByNo = new Map([["C1", cpx]]);
    const activeCounts = new Map(); // 활성매물 0 이어도 household=70≥20 이라 게이트(b) 미발동
    const { targetsByField, holdsByField } = scanPollution([apt], grid, complexByNo, activeCounts);
    expect(targetsByField.floor_area_ratio).toHaveLength(0);
    expect(holdsByField.floor_area_ratio.twin_implausible).toBe(1);
    expect(holdsByField.floor_area_ratio.twin_weak).toBe(0);
  });
});

// ── 물리적 타당성 게이트 (d) ────────────────────────────────
describe("물리적 타당성 게이트 (d) — 우리 값 타당 + 쌍둥이 값 비타당 → 보류", () => {
  it("우리 값이 타당 범위 안, 쌍둥이 값이 범위 밖(초과) → 판정 보류 + holdCategory=twin_implausible", () => {
    const spec = FIELD_SPECS.find((s) => s.key === "floor_area_ratio");
    if (!spec) throw new Error("floor_area_ratio spec 없음");
    const cpx = makeCpx("C1", "테스트단지", 37.5, 127.0, { floor_area_ratio: 900, total_household_count: 100 }); // > validMax 800
    const apt = makeApt("A1", "테스트단지", 37.5, 127.0, { floor_area_ratio: 300 }); // 타당범위(30~800) 안
    const grid = buildSpatialGrid([cpx]);
    const complexByNo = new Map([["C1", cpx]]);
    const activeCounts = new Map([["C1", 5]]); // 게이트(b) 는 통과시켜 (d) 단독 효과를 본다
    const result = detectPollution(apt, grid, complexByNo, spec, activeCounts);
    expect(result.polluted).toBe(false);
    expect(result.reason).toContain("판정 보류");
    expect(result.reason).toContain("쌍둥이 값 비타당");
    expect(result.holdCategory).toBe(HOLD_CATEGORY.TWIN_IMPLAUSIBLE);
  });

  it("우리 값이 타당 범위 안, 쌍둥이 값이 범위 밖(미달) → 판정 보류", () => {
    const spec = FIELD_SPECS.find((s) => s.key === "building_coverage_ratio");
    if (!spec) throw new Error("building_coverage_ratio spec 없음");
    const cpx = makeCpx("C1", "테스트단지", 37.5, 127.0, { building_coverage_ratio: 2, total_household_count: 100 }); // < validMin 5
    const apt = makeApt("A1", "테스트단지", 37.5, 127.0, { building_coverage_ratio: 40 }); // 타당범위(5~60) 안, 20배差(ratio 20)
    const grid = buildSpatialGrid([cpx]);
    const complexByNo = new Map([["C1", cpx]]);
    const activeCounts = new Map([["C1", 5]]);
    const result = detectPollution(apt, grid, complexByNo, spec, activeCounts);
    expect(result.polluted).toBe(false);
    expect(result.holdCategory).toBe(HOLD_CATEGORY.TWIN_IMPLAUSIBLE);
  });

  it("우리 값이 타당 범위 밖이면 게이트(d)가 관여하지 않고 기존 로직대로 진행(삭제)", () => {
    const spec = FIELD_SPECS.find((s) => s.key === "floor_area_ratio");
    if (!spec) throw new Error("floor_area_ratio spec 없음");
    const cpx = makeCpx("C1", "테스트단지", 37.5, 127.0, { floor_area_ratio: 300, total_household_count: 100 }); // 타당
    const apt = makeApt("A1", "테스트단지", 37.5, 127.0, { floor_area_ratio: 2000 }); // 타당범위 밖(둘 다 이상이어도 삭제 유지 케이스 아님 — 여기선 apt 이상·twin 타당)
    const grid = buildSpatialGrid([cpx]);
    const complexByNo = new Map([["C1", cpx]]);
    const activeCounts = new Map([["C1", 5]]);
    const result = detectPollution(apt, grid, complexByNo, spec, activeCounts);
    expect(result.polluted).toBe(true); // "우리 값이 범위 밖이고 쌍둥이가 안이면 → 기존대로 삭제"
    expect(result.holdCategory).toBeNull();
  });

  it("둘 다 타당 범위 밖이어도(우리 값이 이상한 게 확실하므로) 삭제 유지 — 게이트(d)는 관여 안 함", () => {
    const spec = FIELD_SPECS.find((s) => s.key === "floor_area_ratio");
    if (!spec) throw new Error("floor_area_ratio spec 없음");
    const cpx = makeCpx("C1", "테스트단지", 37.5, 127.0, { floor_area_ratio: 5000, total_household_count: 100 }); // 타당범위 밖
    const apt = makeApt("A1", "테스트단지", 37.5, 127.0, { floor_area_ratio: 3000 }); // 타당범위 밖
    const grid = buildSpatialGrid([cpx]);
    const complexByNo = new Map([["C1", cpx]]);
    const activeCounts = new Map([["C1", 5]]);
    const result = detectPollution(apt, grid, complexByNo, spec, activeCounts);
    expect(result.polluted).toBe(true); // "둘 다 범위 밖 → 삭제 유지"
    expect(result.holdCategory).toBeNull();
  });

  it("둘 다 타당 범위 안이면 게이트(d) 미관여 — 기존 1.5배 기준으로 폴루션 판정 유지", () => {
    const spec = FIELD_SPECS.find((s) => s.key === "floor_area_ratio");
    if (!spec) throw new Error("floor_area_ratio spec 없음");
    const cpx = makeCpx("C1", "테스트단지", 37.5, 127.0, { floor_area_ratio: 200, total_household_count: 100 }); // 타당
    const apt = makeApt("A1", "테스트단지", 37.5, 127.0, { floor_area_ratio: 400 }); // 타당, 2배
    const grid = buildSpatialGrid([cpx]);
    const complexByNo = new Map([["C1", cpx]]);
    const activeCounts = new Map([["C1", 5]]);
    const result = detectPollution(apt, grid, complexByNo, spec, activeCounts);
    expect(result.polluted).toBe(true);
    expect(result.holdCategory).toBeNull();
  });

  it("경계값: 쌍둥이가 validMax 와 정확히 같으면(포함) 타당 — 게이트(d) 미발동", () => {
    const spec = FIELD_SPECS.find((s) => s.key === "floor_area_ratio");
    if (!spec) throw new Error("floor_area_ratio spec 없음");
    const cpx = makeCpx("C1", "테스트단지", 37.5, 127.0, { floor_area_ratio: spec.validMax, total_household_count: 100 });
    const apt = makeApt("A1", "테스트단지", 37.5, 127.0, { floor_area_ratio: 300 });
    const grid = buildSpatialGrid([cpx]);
    const complexByNo = new Map([["C1", cpx]]);
    const activeCounts = new Map([["C1", 5]]);
    const result = detectPollution(apt, grid, complexByNo, spec, activeCounts);
    // validMax=800, 300 vs 800 → ratio 2.67 ≥ 1.5 이고 둘 다 타당범위 안(800 은 경계 포함) → 삭제
    expect(result.polluted).toBe(true);
  });
});

// ── isPlausible ──────────────────────────────────────────────
describe("isPlausible", () => {
  const spec = FIELD_SPECS.find((s) => s.key === "floor_area_ratio");
  if (!spec) throw new Error("floor_area_ratio spec 없음");

  it("validMin/validMax 경계값은 포함(양끝 inclusive)", () => {
    expect(isPlausible(spec.validMin, spec)).toBe(true);
    expect(isPlausible(spec.validMax, spec)).toBe(true);
  });

  it("경계 바로 밖은 비타당", () => {
    expect(isPlausible(spec.validMin - 1, spec)).toBe(false);
    expect(isPlausible(spec.validMax + 1, spec)).toBe(false);
  });
});

// ── FIELD_SPECS 물리적 타당 범위 (경쟁 후보값 포함 상수 고정) ──
describe("FIELD_SPECS validMin/validMax 상수", () => {
  it("floor_area_ratio: 30~800", () => {
    const spec = FIELD_SPECS.find((s) => s.key === "floor_area_ratio");
    expect(spec?.validMin).toBe(30);
    expect(spec?.validMax).toBe(800);
  });

  it("building_coverage_ratio: 5~60", () => {
    const spec = FIELD_SPECS.find((s) => s.key === "building_coverage_ratio");
    expect(spec?.validMin).toBe(5);
    expect(spec?.validMax).toBe(60);
  });

  it("max_floor: 3~100", () => {
    const spec = FIELD_SPECS.find((s) => s.key === "max_floor");
    expect(spec?.validMin).toBe(3);
    expect(spec?.validMax).toBe(100);
  });
});

// ── 실사례 회귀 (과제 지시 3건) ──────────────────────────────
// "지우면 멀쩡한 값이 사라지는" 반례 — 물리적 타당성 게이트(d) 없이는 전부 polluted:true(삭제)였다.
describe("실사례 회귀 — 물리적으로 비타당한 쌍둥이 값 때문에 멀쩡한 저장값이 삭제되던 3건", () => {
  it("중앙로역 푸르지오 더 센트럴 — 우리 259% vs 쌍둥이 880%(세대수 70·매물 0) → 삭제 대상에서 빠짐", () => {
    const spec = FIELD_SPECS.find((s) => s.key === "floor_area_ratio");
    if (!spec) throw new Error("floor_area_ratio spec 없음");
    const cpx = makeCpx("C1", "중앙로역 푸르지오 더 센트럴", 35.8714, 128.5911, { floor_area_ratio: 880, total_household_count: 70 });
    const apt = makeApt("ap-1", "중앙로역 푸르지오 더 센트럴", 35.8714, 128.5911, { floor_area_ratio: 259 });
    const grid = buildSpatialGrid([cpx]);
    const complexByNo = new Map([["C1", cpx]]);
    const result = detectPollution(apt, grid, complexByNo, spec, new Map()); // 활성매물 0
    expect(result.polluted).toBe(false);
    expect(result.holdCategory).toBe(HOLD_CATEGORY.TWIN_IMPLAUSIBLE);
  });

  it("힐스테이트 대구역 퍼스트 — 우리 375% vs 쌍둥이 883%(세대수 90·매물 0) → 삭제 대상에서 빠짐", () => {
    const spec = FIELD_SPECS.find((s) => s.key === "floor_area_ratio");
    if (!spec) throw new Error("floor_area_ratio spec 없음");
    const cpx = makeCpx("C1", "힐스테이트 대구역 퍼스트", 35.8778, 128.5936, { floor_area_ratio: 883, total_household_count: 90 });
    const apt = makeApt("ap-2", "힐스테이트 대구역 퍼스트", 35.8778, 128.5936, { floor_area_ratio: 375 });
    const grid = buildSpatialGrid([cpx]);
    const complexByNo = new Map([["C1", cpx]]);
    const result = detectPollution(apt, grid, complexByNo, spec, new Map());
    expect(result.polluted).toBe(false);
    expect(result.holdCategory).toBe(HOLD_CATEGORY.TWIN_IMPLAUSIBLE);
  });

  it("태왕디아너스 오페라 — 건폐율 우리 38% vs 쌍둥이 67%(세대수 120·매물 0) → 삭제 대상에서 빠짐", () => {
    const spec = FIELD_SPECS.find((s) => s.key === "building_coverage_ratio");
    if (!spec) throw new Error("building_coverage_ratio spec 없음");
    const cpx = makeCpx("C1", "태왕디아너스 오페라", 35.1595, 126.8526, { building_coverage_ratio: 67, total_household_count: 120 });
    const apt = makeApt("ap-3", "태왕디아너스 오페라", 35.1595, 126.8526, { building_coverage_ratio: 38 });
    const grid = buildSpatialGrid([cpx]);
    const complexByNo = new Map([["C1", cpx]]);
    const result = detectPollution(apt, grid, complexByNo, spec, new Map());
    expect(result.polluted).toBe(false);
    expect(result.holdCategory).toBe(HOLD_CATEGORY.TWIN_IMPLAUSIBLE);
  });
});

// ── 상수 고정값 (뮤테이션 경쟁 후보 포함) ──────────────────────
describe("RADIUS_M / RATIO_THRESHOLD / TWIN_HOUSEHOLD_MIN 상수", () => {
  it("RADIUS_M = 500 (sync-naver-complex MATCH_MAX_M 과 동일 근거)", () => {
    expect(RADIUS_M).toBe(500);
  });

  it("RATIO_THRESHOLD = 1.5 (선행 실측 확정 기준)", () => {
    expect(RATIO_THRESHOLD).toBe(1.5);
  });

  it("TWIN_HOUSEHOLD_MIN = 20 (전수 실측 — 10은 브이티스타일 반례를 못 구하고 50은 과함)", () => {
    expect(TWIN_HOUSEHOLD_MIN).toBe(20);
  });
});
