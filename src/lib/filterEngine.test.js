// @ts-check
import { describe, it, expect } from "vitest";
import { applyBaseFilters } from "@/lib/filterEngine";

/* ── 테스트 데이터 팩토리 ── */
/**
 * @param {Record<string, unknown>} [aptOverrides]
 * @param {Record<string, unknown>} [resOverrides]
 * @returns {import('@/types/hooks').ScoredApt}
 */
function makeItem(aptOverrides = {}, resOverrides = {}) {
  return /** @type {any} */ ({
    apt: {
      id: "t1",
      name: "테스트아파트",
      region: "서울",
      gu: "강남구",
      price: 50000,
      area: 84,
      units: 500,
      builder: "현대건설",
      ...aptOverrides,
    },
    res: { total: 75, cats: { benefit: { totalWon: 0 } }, ...resOverrides },
  });
}

const DEFAULT_FILTER = {
  showFavOnly: false,
  favoriteSet: new Set(),
  budgetMin: "",
  budgetMax: "",
  areaMin: "",
  areaMax: "",
  unitsMin: "",
  unitsMax: "",
  minScore: "",
  benefitOnly: false,
  subwayOnly: false,
};

describe("applyBaseFilters", () => {
  // 정상: 필터 없이 전체 반환
  it("필터 없으면 전체 반환", () => {
    const items = [makeItem(), makeItem({ id: "t2" })];
    expect(applyBaseFilters(items, DEFAULT_FILTER)).toHaveLength(2);
  });

  // 예산 필터: 최소/최대 (만원 → 원 변환)
  it("budgetMin 필터 적용", () => {
    const items = [makeItem({ price: 30000 }), makeItem({ id: "t2", price: 60000 })];
    const result = applyBaseFilters(items, { ...DEFAULT_FILTER, budgetMin: "4" });
    // 4억 = 40000만원, price >= 40000
    expect(result).toHaveLength(1);
    expect(result[0].apt.id).toBe("t2");
  });

  it("budgetMax 필터 적용", () => {
    const items = [makeItem({ price: 30000 }), makeItem({ id: "t2", price: 60000 })];
    const result = applyBaseFilters(items, { ...DEFAULT_FILTER, budgetMax: "4" });
    expect(result).toHaveLength(1);
    expect(result[0].apt.id).toBe("t1");
  });

  // 예산 역전 시 자동 스왑
  it("budgetMin > budgetMax이면 자동 스왑", () => {
    const items = [
      makeItem({ price: 30000 }),
      makeItem({ id: "t2", price: 50000 }),
      makeItem({ id: "t3", price: 70000 }),
    ];
    const result = applyBaseFilters(items, { ...DEFAULT_FILTER, budgetMin: "6", budgetMax: "4" });
    // 스왑: effectiveMin=4, effectiveMax=6 → 40000 <= price <= 60000
    expect(result).toHaveLength(1);
    expect(result[0].apt.id).toBe("t2");
  });

  // 면적 필터
  it("areaMin/areaMax 필터 적용", () => {
    const items = [makeItem({ area: 59 }), makeItem({ id: "t2", area: 84 }), makeItem({ id: "t3", area: 120 })];
    const result = applyBaseFilters(items, { ...DEFAULT_FILTER, areaMin: "60", areaMax: "100" });
    expect(result).toHaveLength(1);
    expect(result[0].apt.id).toBe("t2");
  });

  // 세대수 필터
  it("unitsMin 필터 적용", () => {
    const items = [makeItem({ units: 200 }), makeItem({ id: "t2", units: 1000 })];
    const result = applyBaseFilters(items, { ...DEFAULT_FILTER, unitsMin: "500" });
    expect(result).toHaveLength(1);
    expect(result[0].apt.id).toBe("t2");
  });

  // 최소 점수 필터
  it("minScore 필터 적용", () => {
    const items = [makeItem({}, { total: 60 }), makeItem({ id: "t2" }, { total: 80 })];
    const result = applyBaseFilters(items, { ...DEFAULT_FILTER, minScore: "70" });
    expect(result).toHaveLength(1);
    expect(result[0].apt.id).toBe("t2");
  });

  // 혜택 필터
  it("benefitOnly 필터 적용", () => {
    const items = [makeItem(), makeItem({ id: "t2" }, { cats: { benefit: { totalWon: 500 } } })];
    const result = applyBaseFilters(items, { ...DEFAULT_FILTER, benefitOnly: true });
    expect(result).toHaveLength(1);
    expect(result[0].apt.id).toBe("t2");
  });

  // 즐겨찾기 필터
  it("showFavOnly 필터 적용", () => {
    const items = [makeItem(), makeItem({ id: "t2" })];
    const result = applyBaseFilters(items, { ...DEFAULT_FILTER, showFavOnly: true, favoriteSet: new Set(["t2"]) });
    expect(result).toHaveLength(1);
    expect(result[0].apt.id).toBe("t2");
  });

  // 빈 배열 입력
  it("빈 배열 입력 시 빈 배열 반환", () => {
    expect(applyBaseFilters([], DEFAULT_FILTER)).toHaveLength(0);
  });

  // null 안전: area/units null
  it("area null이면 areaMin 필터에서 0으로 취급", () => {
    const items = [makeItem({ area: null })];
    const result = applyBaseFilters(items, { ...DEFAULT_FILTER, areaMin: "60" });
    expect(result).toHaveLength(0);
  });

  // 역세권 필터 (subwayOnly) — 세션 430 추가 칩의 필터링 로직 직접 검증 (세션 431)
  // subwayDist <= 500m 통과, 경계값 500 포함
  it("subwayOnly=true이면 subwayDist<=500만 통과 (경계 500 포함)", () => {
    const items = [
      makeItem({ id: "near", subwayDist: 300 }),
      makeItem({ id: "edge", subwayDist: 500 }),
      makeItem({ id: "far", subwayDist: 800 }),
    ];
    const result = applyBaseFilters(items, { ...DEFAULT_FILTER, subwayOnly: true });
    expect(result).toHaveLength(2);
    expect(result.map((x) => x.apt.id)).toEqual(["near", "edge"]);
  });

  // subwayDist=null이면 제외
  it("subwayOnly=true이면 subwayDist=null 단지 제외", () => {
    const items = [makeItem({ id: "null", subwayDist: null }), makeItem({ id: "near", subwayDist: 300 })];
    const result = applyBaseFilters(items, { ...DEFAULT_FILTER, subwayOnly: true });
    expect(result).toHaveLength(1);
    expect(result[0].apt.id).toBe("near");
  });

  // subwayDist=9999(역없음 sentinel) / >500 제외
  it("subwayOnly=true이면 subwayDist=9999(역없음)·>500 제외", () => {
    const items = [makeItem({ id: "none", subwayDist: 9999 }), makeItem({ id: "near", subwayDist: 400 })];
    const result = applyBaseFilters(items, { ...DEFAULT_FILTER, subwayOnly: true });
    expect(result).toHaveLength(1);
    expect(result[0].apt.id).toBe("near");
  });

  // subwayOnly=false면 거리 무관 전부 통과 (무영향)
  it("subwayOnly=false이면 subwayDist 무관 전부 통과", () => {
    const items = [makeItem({ id: "far", subwayDist: 9999 }), makeItem({ id: "nullable", subwayDist: null })];
    const result = applyBaseFilters(items, { ...DEFAULT_FILTER, subwayOnly: false });
    expect(result).toHaveLength(2);
  });
});
