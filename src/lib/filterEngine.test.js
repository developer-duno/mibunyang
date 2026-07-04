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
  schoolGoodOnly: false,
  dsrPassOnly: false,
  nonRegulatedOnly: false,
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

  // 학군 양호 필터 (schoolGoodOnly) — A·B 등급만 통과 (세션 459)
  it("schoolGoodOnly=true이면 A·B 등급만 통과, C·D·null 제외", () => {
    const items = [
      makeItem({ id: "a", schoolGrade: "A" }),
      makeItem({ id: "b", schoolGrade: "B" }),
      makeItem({ id: "c", schoolGrade: "C" }),
      makeItem({ id: "d", schoolGrade: "D" }),
      makeItem({ id: "null", schoolGrade: null }),
    ];
    const result = applyBaseFilters(items, { ...DEFAULT_FILTER, schoolGoodOnly: true });
    expect(result.map((x) => x.apt.id)).toEqual(["a", "b"]);
  });

  // B+ 같은 prefix 변형도 B 로 시작하므로 통과 (startsWith 검증)
  it("schoolGoodOnly=true이면 B+ 등급(prefix)도 통과", () => {
    const items = [makeItem({ id: "bplus", schoolGrade: "B+" }), makeItem({ id: "cplus", schoolGrade: "C+" })];
    const result = applyBaseFilters(items, { ...DEFAULT_FILTER, schoolGoodOnly: true });
    expect(result.map((x) => x.apt.id)).toEqual(["bplus"]);
  });

  // schoolGoodOnly=false면 등급 무관 전부 통과 (무영향)
  it("schoolGoodOnly=false이면 schoolGrade 무관 전부 통과", () => {
    const items = [makeItem({ id: "c", schoolGrade: "C" }), makeItem({ id: "null", schoolGrade: null })];
    const result = applyBaseFilters(items, { ...DEFAULT_FILTER, schoolGoodOnly: false });
    expect(result).toHaveLength(2);
  });

  // DSR 통과 필터 (dsrPassOnly) — dsr40pass===true만 통과 (false·null 제외, 세션 461)
  it("dsrPassOnly=true이면 dsr40pass===true만 통과, false·null 제외", () => {
    const items = [
      makeItem({ id: "pass", dsr40pass: true }),
      makeItem({ id: "fail", dsr40pass: false }),
      makeItem({ id: "null", dsr40pass: null }),
    ];
    const result = applyBaseFilters(items, { ...DEFAULT_FILTER, dsrPassOnly: true });
    expect(result.map((x) => x.apt.id)).toEqual(["pass"]);
  });

  // dsrPassOnly=false면 dsr40pass 무관 전부 통과 (무영향)
  it("dsrPassOnly=false이면 dsr40pass 무관 전부 통과", () => {
    const items = [makeItem({ id: "fail", dsr40pass: false }), makeItem({ id: "null", dsr40pass: null })];
    const result = applyBaseFilters(items, { ...DEFAULT_FILTER, dsrPassOnly: false });
    expect(result).toHaveLength(2);
  });

  // 비규제지역 필터 (nonRegulatedOnly) — isRegulated!==true 통과 (false·null 통과, true 제외, 세션 461)
  it("nonRegulatedOnly=true이면 isRegulated!==true만 통과 (false·null 통과, true 제외)", () => {
    const items = [
      makeItem({ id: "free", isRegulated: false }),
      makeItem({ id: "reg", isRegulated: true }),
      makeItem({ id: "null", isRegulated: null }),
    ];
    const result = applyBaseFilters(items, { ...DEFAULT_FILTER, nonRegulatedOnly: true });
    expect(result.map((x) => x.apt.id)).toEqual(["free", "null"]);
  });

  // nonRegulatedOnly=false면 isRegulated 무관 전부 통과 (무영향)
  it("nonRegulatedOnly=false이면 isRegulated 무관 전부 통과", () => {
    const items = [makeItem({ id: "reg", isRegulated: true }), makeItem({ id: "free", isRegulated: false })];
    const result = applyBaseFilters(items, { ...DEFAULT_FILTER, nonRegulatedOnly: false });
    expect(result).toHaveLength(2);
  });

  // 치안 안전 필터 (crimeSafeOnly) — crimeSafetyGrade 1~3만 통과 (4·5 위험 + null 미수집 제외, 세션 475)
  it("crimeSafeOnly=true이면 crimeSafetyGrade 1~3만 통과 (4·5·null 제외)", () => {
    const items = [
      makeItem({ id: "g1", crimeSafetyGrade: 1 }),
      makeItem({ id: "g3", crimeSafetyGrade: 3 }),
      makeItem({ id: "g4", crimeSafetyGrade: 4 }),
      makeItem({ id: "g5", crimeSafetyGrade: 5 }),
      makeItem({ id: "gnull", crimeSafetyGrade: null }),
    ];
    const result = applyBaseFilters(items, { ...DEFAULT_FILTER, crimeSafeOnly: true });
    expect(result.map((x) => x.apt.id)).toEqual(["g1", "g3"]);
  });

  // crimeSafeOnly=false면 crimeSafetyGrade 무관 전부 통과 (무영향)
  it("crimeSafeOnly=false이면 crimeSafetyGrade 무관 전부 통과", () => {
    const items = [makeItem({ id: "g5", crimeSafetyGrade: 5 }), makeItem({ id: "gnull", crimeSafetyGrade: null })];
    const result = applyBaseFilters(items, { ...DEFAULT_FILTER, crimeSafeOnly: false });
    expect(result).toHaveLength(2);
  });

  // 육아 인프라 필터 (childcareGoodOnly) — 어린이집 5개+ AND 도보권(≤500m)만 통과 (세션 475)
  it("childcareGoodOnly=true이면 childcare>=5 AND childcareDist<=500만 통과", () => {
    const items = [
      makeItem({ id: "good", childcare: 8, childcareDist: 200 }),
      makeItem({ id: "few", childcare: 2, childcareDist: 200 }), // 개수 부족
      makeItem({ id: "far", childcare: 8, childcareDist: 900 }), // 거리 초과
      makeItem({ id: "nodist", childcare: 8, childcareDist: null }), // 거리 미수집
      makeItem({ id: "nocount", childcare: null, childcareDist: 200 }), // 개수 미수집
    ];
    const result = applyBaseFilters(items, { ...DEFAULT_FILTER, childcareGoodOnly: true });
    expect(result.map((x) => x.apt.id)).toEqual(["good"]);
  });

  // childcareGoodOnly=false면 childcare 무관 전부 통과 (무영향)
  it("childcareGoodOnly=false이면 childcare 무관 전부 통과", () => {
    const items = [
      makeItem({ id: "few", childcare: 1, childcareDist: 900 }),
      makeItem({ id: "good", childcare: 8, childcareDist: 100 }),
    ];
    const result = applyBaseFilters(items, { ...DEFAULT_FILTER, childcareGoodOnly: false });
    expect(result).toHaveLength(2);
  });

  // 주차 넉넉 필터 (parkingGoodOnly) — parkingRatio >= 1.5만 통과 (여유, null 미수집 제외, 세션 477)
  it("parkingGoodOnly=true이면 parkingRatio>=1.5만 통과 (<1.5·null 제외)", () => {
    const items = [
      makeItem({ id: "roomy", parkingRatio: 2.0 }),
      makeItem({ id: "exact", parkingRatio: 1.5 }), // 경계값 포함
      makeItem({ id: "tight", parkingRatio: 1.2 }), // 미달
      makeItem({ id: "none", parkingRatio: null }), // 미수집
    ];
    const result = applyBaseFilters(items, { ...DEFAULT_FILTER, parkingGoodOnly: true });
    expect(result.map((x) => x.apt.id)).toEqual(["roomy", "exact"]);
  });

  // parkingGoodOnly=false면 parkingRatio 무관 전부 통과 (무영향)
  it("parkingGoodOnly=false이면 parkingRatio 무관 전부 통과", () => {
    const items = [makeItem({ id: "tight", parkingRatio: 0.8 }), makeItem({ id: "roomy", parkingRatio: 2.0 })];
    const result = applyBaseFilters(items, { ...DEFAULT_FILTER, parkingGoodOnly: false });
    expect(result).toHaveLength(2);
  });

  // 병원 도보권 필터 (hospitalNearOnly) — hospitalDist <= 500m만 통과 (null 미수집 제외, 세션 479)
  it("hospitalNearOnly=true이면 hospitalDist<=500만 통과 (>500·null 제외)", () => {
    const items = [
      makeItem({ id: "near", hospitalDist: 120 }),
      makeItem({ id: "edge", hospitalDist: 500 }), // 경계값 포함
      makeItem({ id: "far", hospitalDist: 800 }), // 초과
      makeItem({ id: "none", hospitalDist: null }), // 미수집
    ];
    const result = applyBaseFilters(items, { ...DEFAULT_FILTER, hospitalNearOnly: true });
    expect(result.map((x) => x.apt.id)).toEqual(["near", "edge"]);
  });

  it("hospitalNearOnly=false이면 hospitalDist 무관 전부 통과", () => {
    const items = [makeItem({ id: "far", hospitalDist: 900 }), makeItem({ id: "near", hospitalDist: 100 })];
    const result = applyBaseFilters(items, { ...DEFAULT_FILTER, hospitalNearOnly: false });
    expect(result).toHaveLength(2);
  });

  // 공원 도보권 필터 (parkNearOnly) — parkDist <= 500m만 통과 (null 미수집 제외, 세션 479)
  it("parkNearOnly=true이면 parkDist<=500만 통과 (>500·null 제외)", () => {
    const items = [
      makeItem({ id: "near", parkDist: 220 }),
      makeItem({ id: "edge", parkDist: 500 }), // 경계값 포함
      makeItem({ id: "far", parkDist: 700 }), // 초과
      makeItem({ id: "none", parkDist: null }), // 미수집
    ];
    const result = applyBaseFilters(items, { ...DEFAULT_FILTER, parkNearOnly: true });
    expect(result.map((x) => x.apt.id)).toEqual(["near", "edge"]);
  });

  it("parkNearOnly=false이면 parkDist 무관 전부 통과", () => {
    const items = [makeItem({ id: "far", parkDist: 800 }), makeItem({ id: "near", parkDist: 150 })];
    const result = applyBaseFilters(items, { ...DEFAULT_FILTER, parkNearOnly: false });
    expect(result).toHaveLength(2);
  });
});
