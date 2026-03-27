import { describe, it, expect } from "vitest";
import { applyBaseFilters } from "@/lib/filterEngine";

/* ── 테스트 데이터 팩토리 ── */
function makeItem(aptOverrides = {}, resOverrides = {}) {
  return {
    apt: { id: "t1", name: "테스트아파트", region: "서울", gu: "강남구", price: 50000, area: 84, units: 500, builder: "현대건설", ...aptOverrides },
    res: { total: 75, cats: { benefit: { totalWon: 0 } }, ...resOverrides },
  };
}

const DEFAULT_FILTER = {
  showFavOnly: false, favoriteIds: [],
  budgetMin: "", budgetMax: "",
  areaMin: "", areaMax: "",
  unitsMin: "", unitsMax: "",
  minScore: "", benefitOnly: false, searchText: "",
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
    const items = [makeItem({ price: 30000 }), makeItem({ id: "t2", price: 50000 }), makeItem({ id: "t3", price: 70000 })];
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
    const result = applyBaseFilters(items, { ...DEFAULT_FILTER, showFavOnly: true, favoriteIds: ["t2"] });
    expect(result).toHaveLength(1);
    expect(result[0].apt.id).toBe("t2");
  });

  // 검색어 필터 (이름 매칭)
  it("searchText 필터 — 이름 매칭", () => {
    const items = [makeItem({ name: "힐스테이트" }), makeItem({ id: "t2", name: "래미안" })];
    const result = applyBaseFilters(items, { ...DEFAULT_FILTER, searchText: "래미안" });
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

  // --- 카테고리별 최소 점수 필터 테스트 ---

  function makeCatItem(id, catScores) {
    const cats = {};
    for (const [k, v] of Object.entries(catScores)) {
      cats[k] = { total: v, label: k, subs: [] };
    }
    return { apt: { id, name: `apt-${id}`, region: "서울", gu: "강남구", price: 50000, area: 84, units: 500 }, res: { total: 75, cats } };
  }

  it("단일 카테고리 min 필터 — location 70 이상", () => {
    const items = [
      makeCatItem("a1", { price: 60, location: 80, product: 50, benefit: 40, risk: 70, future: 60 }),
      makeCatItem("a2", { price: 70, location: 50, product: 60, benefit: 50, risk: 80, future: 70 }),
    ];
    const result = applyBaseFilters(items, { ...DEFAULT_FILTER, min_location: "70" });
    expect(result).toHaveLength(1);
    expect(result[0].apt.id).toBe("a1");
  });

  it("복수 카테고리 AND 필터 — location 70+ AND price 60+", () => {
    const items = [
      makeCatItem("a1", { price: 60, location: 80, product: 50, benefit: 40, risk: 70, future: 60 }),
      makeCatItem("a2", { price: 50, location: 90, product: 60, benefit: 50, risk: 80, future: 70 }),
      makeCatItem("a3", { price: 80, location: 50, product: 60, benefit: 50, risk: 80, future: 70 }),
    ];
    const result = applyBaseFilters(items, { ...DEFAULT_FILTER, min_location: "70", min_price: "60" });
    expect(result).toHaveLength(1);
    expect(result[0].apt.id).toBe("a1");
  });

  it("min=0 → 전체 통과", () => {
    const items = [makeCatItem("a1", { price: 0, location: 0, product: 0, benefit: 0, risk: 0, future: 0 })];
    const result = applyBaseFilters(items, { ...DEFAULT_FILTER, min_price: "0" });
    expect(result).toHaveLength(1);
  });

  it("cats 필드 null인 경우 → 0으로 취급", () => {
    const item = { apt: { id: "n1", name: "test", region: "서울", gu: "강남구", price: 50000, area: 84, units: 500 }, res: { total: 75, cats: { price: null, location: { total: 80, subs: [] } } } };
    const result = applyBaseFilters([item], { ...DEFAULT_FILTER, min_price: "50" });
    expect(result).toHaveLength(0);
  });

  // --- 태그별 필터 테스트 ---

  it("selectedTags가 비어있으면 전체 반환", () => {
    const items = [makeItem(), makeItem({ id: "t2" })];
    const result = applyBaseFilters(items, { ...DEFAULT_FILTER, selectedTags: [], favoritesObj: {} });
    expect(result).toHaveLength(2);
  });

  it("selectedTags OR 필터 — 선택된 태그 중 하나라도 포함하면 통과", () => {
    const items = [makeItem(), makeItem({ id: "t2" }), makeItem({ id: "t3" })];
    const favoritesObj = {
      t1: { memo: "", tags: ["투자용"], addedAt: "2026-01-01" },
      t2: { memo: "", tags: ["실거주", "가격매력"], addedAt: "2026-01-01" },
      t3: { memo: "", tags: [], addedAt: "2026-01-01" },
    };
    const result = applyBaseFilters(items, { ...DEFAULT_FILTER, selectedTags: ["투자용"], favoritesObj });
    // t1만 "투자용" 태그 보유
    expect(result).toHaveLength(1);
    expect(result[0].apt.id).toBe("t1");
  });

  it("selectedTags 복수 태그 OR — 어느 하나라도 매칭", () => {
    const items = [makeItem(), makeItem({ id: "t2" }), makeItem({ id: "t3" })];
    const favoritesObj = {
      t1: { memo: "", tags: ["투자용"], addedAt: "2026-01-01" },
      t2: { memo: "", tags: ["실거주"], addedAt: "2026-01-01" },
      t3: { memo: "", tags: ["재검토"], addedAt: "2026-01-01" },
    };
    const result = applyBaseFilters(items, { ...DEFAULT_FILTER, selectedTags: ["투자용", "실거주"], favoritesObj });
    expect(result).toHaveLength(2);
    expect(result.map(x => x.apt.id).sort()).toEqual(["t1", "t2"]);
  });

  it("selectedTags 있지만 favoritesObj 없으면 전체 반환 (안전 처리)", () => {
    const items = [makeItem(), makeItem({ id: "t2" })];
    const result = applyBaseFilters(items, { ...DEFAULT_FILTER, selectedTags: ["투자용"] });
    // favoritesObj가 없으므로 필터 미적용
    expect(result).toHaveLength(2);
  });
});
