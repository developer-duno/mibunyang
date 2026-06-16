// @ts-check
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDataPipeline, VISIBLE_PAGE_SIZE } from "./useDataPipeline";

/* ── calcCats / computeRegionalMedians 모킹 ── */
vi.mock("@/scoring/engine", () => ({
  calcCats: vi.fn(() => ({
    price: { total: 70, subs: [] },
    location: { total: 65, subs: [] },
    product: { total: 60, subs: [] },
    risk: { total: 75, subs: [] },
    benefit: { total: 50, totalWon: 500, subs: [] },
    future: { total: 55, subs: [] },
  })),
  computeRegionalMedians: vi.fn(() => ({})),
}));

/* ── 팩토리 ── */
function makeCats(overrides = {}) {
  return {
    price: { total: 70, subs: [] },
    location: { total: 65, subs: [] },
    product: { total: 60, subs: [] },
    risk: { total: 75, subs: [] },
    benefit: { total: 50, totalWon: 500, subs: [] },
    future: { total: 55, subs: [] },
    ...overrides,
  };
}

function makeApt(overrides = {}) {
  return {
    id: "ah-1", name: "테스트아파트", region: "서울", gu: "강남구",
    price: 50000, area: 84, units: 500, builder: "현대건설",
    completion: "202706", unsoldRate: 10, updatedAt: "2026-04-01",
    catsCache: makeCats(),
    ...overrides,
  };
}

const DEFAULT_PROPS = {
  apartments: [], profile: "live", customWeights: {},
  filterRegion: "전체", filterGu: "전체", sortKey: "total",
  moveInFilter: "전체", builderTier: "전체",
  showFavOnly: false, favoriteSet: new Set(),
  budgetMin: "", budgetMax: "", areaMin: "", areaMax: "",
  unitsMin: "", unitsMax: "", minScore: "", benefitOnly: false,
  searchQuery: "",
  hideNoUnsold: false, compIds: [], dataUpdatedAt: "2026-04-10T00:00:00Z",
};

function renderPipeline(overrides = {}) {
  return renderHook((props) => useDataPipeline(props), {
    initialProps: /** @type {any} */ ({ ...DEFAULT_PROPS, ...overrides }),
  });
}

/* ══════════════════════════════════════ */

describe("useDataPipeline", () => {
  /* ── 반환 구조 ── */
  describe("반환 구조", () => {
    it("필수 필드가 모두 존재", () => {
      const { result } = renderPipeline();
      const keys = Object.keys(result.current);
      const required = [
        "guOptions", "catsCache", "scored", "filtered", "visible",
        "visibleCount", "setVisibleCount", "scoredMap", "compItems", "pw",
        "activeFilterCount", "regionOptions", "filterOptionCounts",
        "dataFreshnessText", "isFilterPending",
      ];
      for (const k of required) {
        expect(keys).toContain(k);
      }
    });

    it("dataFreshnessText 포맷", () => {
      const { result } = renderPipeline();
      expect(result.current.dataFreshnessText).toBe("2026-04-10 업데이트");
    });

    it("dataUpdatedAt null → dataFreshnessText null", () => {
      const { result } = renderPipeline({ dataUpdatedAt: null });
      expect(result.current.dataFreshnessText).toBeNull();
    });
  });

  /* ── guOptions ── */
  describe("guOptions", () => {
    it("전체 선택 시 모든 gu 반환", () => {
      const apts = [
        makeApt({ gu: "강남구" }),
        makeApt({ id: "ah-2", gu: "서초구" }),
        makeApt({ id: "ah-3", gu: "강남구" }), // 중복
      ];
      const { result } = renderPipeline({ apartments: apts, filterRegion: "전체" });
      expect(result.current.guOptions).toContain("전체");
      expect(result.current.guOptions).toContain("강남구");
      expect(result.current.guOptions).toContain("서초구");
      // 중복 제거
      expect(result.current.guOptions.filter(g => g === "강남구")).toHaveLength(1);
    });

    it("특정 region 선택 시 해당 gu만 반환", () => {
      const apts = [
        makeApt({ region: "서울", gu: "강남구" }),
        makeApt({ id: "ah-2", region: "경기", gu: "성남시" }),
      ];
      const { result } = renderPipeline({ apartments: apts, filterRegion: "서울" });
      expect(result.current.guOptions).toContain("강남구");
      expect(result.current.guOptions).not.toContain("성남시");
    });

    it("빈 배열 → [전체]", () => {
      const { result } = renderPipeline({ apartments: [] });
      expect(result.current.guOptions).toEqual(["전체"]);
    });
  });

  /* ── catsCache ── */
  describe("catsCache", () => {
    it("catsCache.price 있으면 그대로 사용", async () => {
      const { calcCats } = await import("@/scoring/engine");
      /** @type {import('vitest').Mock} */ (calcCats).mockClear();
      const apts = [makeApt()]; // catsCache 포함
      renderPipeline({ apartments: apts });
      expect(calcCats).not.toHaveBeenCalled();
    });

    it("catsCache 없으면 calcCats 호출", async () => {
      const { calcCats } = await import("@/scoring/engine");
      /** @type {import('vitest').Mock} */ (calcCats).mockClear();
      const apts = [makeApt({ catsCache: null })];
      renderPipeline({ apartments: apts });
      expect(calcCats).toHaveBeenCalledTimes(1);
    });
  });

  /* ── scored (가중합산) ── */
  describe("scored", () => {
    it("live 프로필 가중합산 계산", () => {
      // live: location:40, product:20, price:20, risk:10, benefit:5, future:5
      // cats: location:65, product:60, price:70, risk:75, benefit:50, future:55
      // 합산: 65*40/100 + 60*20/100 + 70*20/100 + 75*10/100 + 50*5/100 + 55*5/100
      //     = 26 + 12 + 14 + 7.5 + 2.5 + 2.75 = 64.75 → round → 65
      const apts = [makeApt()];
      const { result } = renderPipeline({ apartments: apts, profile: "live" });
      expect(result.current.scored).toHaveLength(1);
      expect(result.current.scored[0].res.total).toBe(65);
    });

    it("점수 100 초과 시 100으로 클램핑", () => {
      const highCats = makeCats({
        price: { total: 100, subs: [] },
        location: { total: 100, subs: [] },
        product: { total: 100, subs: [] },
        risk: { total: 100, subs: [] },
        benefit: { total: 100, totalWon: 1000, subs: [] },
        future: { total: 100, subs: [] },
      });
      const apts = [makeApt({ catsCache: highCats })];
      const { result } = renderPipeline({ apartments: apts });
      expect(result.current.scored[0].res.total).toBeLessThanOrEqual(100);
    });

    it("customWeights 적용 시 우선 사용", () => {
      const apts = [makeApt()];
      const cw = { live: { location: 100, product: 0, price: 0, risk: 0, benefit: 0, future: 0 } };
      const { result } = renderPipeline({ apartments: apts, profile: "live", customWeights: cw });
      // location:65 * 100/100 = 65
      expect(result.current.scored[0].res.total).toBe(65);
    });

    it("잘못된 customWeights → PROFILES 폴백", () => {
      const apts = [makeApt()];
      const cw = { live: { location: "invalid" } }; // 타입 불일치
      const { result } = renderPipeline({ apartments: apts, profile: "live", customWeights: cw });
      // PROFILES.live.w 기본값 사용 → 65
      expect(result.current.scored[0].res.total).toBe(65);
    });
  });

  /* ── filtered (정렬 + 필터) ── */
  describe("filtered", () => {
    const threeApts = [
      makeApt({ id: "ah-1", region: "서울", gu: "강남구", price: 30000, unsoldRate: 10 }),
      makeApt({ id: "ah-2", region: "서울", gu: "서초구", price: 50000, unsoldRate: 0 }),
      makeApt({ id: "ah-3", region: "경기", gu: "성남시", price: 70000, unsoldRate: 5 }),
    ];

    it("sortKey=price → 가격 오름차순", () => {
      const { result } = renderPipeline({ apartments: threeApts, sortKey: "price" });
      const prices = result.current.filtered.map(x => x.apt.price);
      expect(prices[0] ?? 0).toBeLessThanOrEqual(prices[1] ?? 0);
      expect(prices[1] ?? 0).toBeLessThanOrEqual(prices[2] ?? 0);
    });

    it("sortKey=total → 점수 내림차순 (동점 시 동일 순서)", () => {
      const { result } = renderPipeline({ apartments: threeApts, sortKey: "total" });
      const totals = result.current.filtered.map(x => x.res.total);
      for (let i = 0; i < totals.length - 1; i++) {
        expect(totals[i]).toBeGreaterThanOrEqual(totals[i + 1]);
      }
    });

    it("sortKey=unsoldRate → 미분양률 내림차순 (높은순), null 은 맨 뒤", () => {
      const apts = [
        makeApt({ id: "ah-a", region: "서울", price: 30000, unsoldRate: 5 }),
        makeApt({ id: "ah-b", region: "서울", price: 30000, unsoldRate: 20 }),
        makeApt({ id: "ah-c", region: "서울", price: 30000, unsoldRate: null }),
        makeApt({ id: "ah-d", region: "서울", price: 30000, unsoldRate: 12 }),
      ];
      const { result } = renderPipeline({ apartments: apts, sortKey: "unsoldRate" });
      const order = result.current.filtered.map(x => x.apt.id);
      expect(order).toEqual(["ah-b", "ah-d", "ah-a", "ah-c"]); // 20 > 12 > 5 > null
    });

    it("sortKey=moveInSoon → 준공완료(최근순) → 예정(가까운순) → 미정/null 맨뒤 (세션 424)", () => {
      // NOW_YM 기준 과거/미래 동적 생성 (시간 흐름에 안정). YYYYMM 고정폭.
      const yy = new Date().getFullYear();
      const past1 = `${yy - 1}05`;   // 작년 5월 (준공완료, 더 오래됨)
      const past2 = `${yy - 1}11`;   // 작년 11월 (준공완료, 더 최근)
      const future1 = `${yy + 1}03`; // 내년 3월 (예정, 더 가까움)
      const future2 = `${yy + 3}06`; // 3년 후 (예정, 더 먼 미래)
      const apts = [
        makeApt({ id: "ah-fut-far", region: "서울", price: 30000, completion: future2 }),
        makeApt({ id: "ah-undecided", region: "서울", price: 30000, completion: "미정" }),
        makeApt({ id: "ah-past-old", region: "서울", price: 30000, completion: past1 }),
        makeApt({ id: "ah-null", region: "서울", price: 30000, completion: null }),
        makeApt({ id: "ah-fut-near", region: "서울", price: 30000, completion: future1 }),
        makeApt({ id: "ah-past-recent", region: "서울", price: 30000, completion: past2 }),
      ];
      const { result } = renderPipeline({ apartments: apts, sortKey: "moveInSoon" });
      const order = result.current.filtered.map(x => x.apt.id);
      // 준공완료(최근 먼저): past2 > past1 → 예정(가까운 먼저): future1 > future2 → 미정·null 맨뒤(입력 순서 안정)
      expect(order.slice(0, 4)).toEqual(["ah-past-recent", "ah-past-old", "ah-fut-near", "ah-fut-far"]);
      // 미정("미정")·null 은 정규식 미일치라 rank 2 (맨 뒤 2칸), 동률 종합점수 → 안정 정렬로 입력 순서
      expect(order.slice(4).sort()).toEqual(["ah-null", "ah-undecided"]);
    });

    it("filterRegion 적용", () => {
      const { result } = renderPipeline({ apartments: threeApts, filterRegion: "서울" });
      expect(result.current.filtered.every(x => x.apt.region === "서울")).toBe(true);
    });

    it("filterGu 적용", () => {
      const { result } = renderPipeline({ apartments: threeApts, filterRegion: "서울", filterGu: "강남구" });
      expect(result.current.filtered.every(x => x.apt.gu === "강남구")).toBe(true);
    });

    it("hideNoUnsold → unsoldRate 0 제외", () => {
      const { result } = renderPipeline({ apartments: threeApts, hideNoUnsold: true });
      expect(result.current.filtered.every(x => (x.apt.unsoldRate ?? 0) > 0)).toBe(true);
      expect(result.current.filtered.some(x => x.apt.id === "ah-2")).toBe(false);
    });
  });

  /* ── visible (페이지네이션) ── */
  describe("visible", () => {
    it("VISIBLE_PAGE_SIZE 상수 = 30", () => {
      expect(VISIBLE_PAGE_SIZE).toBe(30);
    });

    it("아파트 수 > PAGE_SIZE → visible은 PAGE_SIZE 이하", () => {
      const manyApts = Array.from({ length: 50 }, (_, i) =>
        makeApt({ id: `ah-${i}` })
      );
      const { result } = renderPipeline({ apartments: manyApts });
      expect(result.current.visible.length).toBeLessThanOrEqual(VISIBLE_PAGE_SIZE);
    });

    it("setVisibleCount로 확장", () => {
      const manyApts = Array.from({ length: 50 }, (_, i) =>
        makeApt({ id: `ah-${i}` })
      );
      const { result } = renderPipeline({ apartments: manyApts });
      act(() => { result.current.setVisibleCount(50); });
      expect(result.current.visible.length).toBe(50);
    });
  });

  /* ── filterOptionCounts ── */
  describe("filterOptionCounts", () => {
    it("빈 scored → null", () => {
      const { result } = renderPipeline({ apartments: [] });
      expect(result.current.filterOptionCounts).toBeNull();
    });

    it("정상 데이터 → 4개 카운트 객체 반환", () => {
      const apts = [
        makeApt({ id: "ah-1", region: "서울" }),
        makeApt({ id: "ah-2", region: "경기" }),
      ];
      const { result } = renderPipeline({ apartments: apts });
      const counts = result.current.filterOptionCounts;
      expect(counts).not.toBeNull();
      expect(counts).toHaveProperty("regionCounts");
      expect(counts).toHaveProperty("guCounts");
      expect(counts).toHaveProperty("moveInCounts");
      expect(counts).toHaveProperty("tierCounts");
    });
  });

  /* ── scoredMap / compItems ── */
  describe("scoredMap & compItems", () => {
    it("scoredMap에서 id로 조회 가능", () => {
      const apts = [makeApt({ id: "ah-99" })];
      const { result } = renderPipeline({ apartments: apts });
      expect(result.current.scoredMap.get("ah-99")).toBeDefined();
      expect(result.current.scoredMap.get("ah-99")?.apt.id).toBe("ah-99");
    });

    it("compIds에 해당하는 항목만 compItems에 포함", () => {
      const apts = [
        makeApt({ id: "ah-1" }),
        makeApt({ id: "ah-2" }),
        makeApt({ id: "ah-3" }),
      ];
      const { result } = renderPipeline({ apartments: apts, compIds: ["ah-1", "ah-3"] });
      expect(result.current.compItems).toHaveLength(2);
      expect(result.current.compItems.map(x => x.apt.id)).toEqual(["ah-1", "ah-3"]);
    });

    it("존재하지 않는 compIds → 빈 배열", () => {
      const apts = [makeApt({ id: "ah-1" })];
      const { result } = renderPipeline({ apartments: apts, compIds: ["ah-999"] });
      expect(result.current.compItems).toHaveLength(0);
    });
  });

  /* ── activeFilterCount ── */
  describe("activeFilterCount", () => {
    it("필터 없으면 0", () => {
      const { result } = renderPipeline();
      expect(result.current.activeFilterCount).toBe(0);
    });

    it("필터 적용 시 카운트 증가", () => {
      const { result } = renderPipeline({ filterRegion: "서울", budgetMin: "3" });
      expect(result.current.activeFilterCount).toBe(2);
    });

    it("검색어가 있으면 카운트 +1", () => {
      const { result } = renderPipeline({ searchQuery: "래미안" });
      expect(result.current.activeFilterCount).toBe(1);
    });

    it("공백만 입력한 검색어는 카운트 0 (trim 기준)", () => {
      const { result } = renderPipeline({ searchQuery: "   " });
      expect(result.current.activeFilterCount).toBe(0);
    });
  });

  /* ── 검색어 필터 ── */
  describe("searchQuery 필터", () => {
    const apts = [
      makeApt({ id: "ah-1", name: "래미안 강남", region: "서울", gu: "강남구" }),
      makeApt({ id: "ah-2", name: "푸르지오 인천", region: "인천", gu: "서구" }),
    ];

    it("검색어로 단지명 매칭만 남김", () => {
      const { result } = renderPipeline({ apartments: apts, searchQuery: "래미안" });
      expect(result.current.filtered).toHaveLength(1);
      expect(result.current.filtered[0].apt.id).toBe("ah-1");
    });

    it("지역으로도 매칭", () => {
      const { result } = renderPipeline({ apartments: apts, searchQuery: "인천" });
      expect(result.current.filtered).toHaveLength(1);
      expect(result.current.filtered[0].apt.id).toBe("ah-2");
    });

    it("빈 검색어는 전체 통과", () => {
      const { result } = renderPipeline({ apartments: apts, searchQuery: "" });
      expect(result.current.filtered).toHaveLength(2);
    });

    it("공백만 입력하면 전체 통과(정규화 후 빈쿼리)", () => {
      const { result } = renderPipeline({ apartments: apts, searchQuery: "   " });
      expect(result.current.filtered).toHaveLength(2);
    });
  });

  /* ── regionOptions ── */
  describe("regionOptions", () => {
    it("빈 배열 → [전체]", () => {
      const { result } = renderPipeline({ apartments: [] });
      expect(result.current.regionOptions).toEqual(["전체"]);
    });

    it("아파트 region 기반 옵션 생성", () => {
      const apts = [
        makeApt({ region: "서울" }),
        makeApt({ id: "ah-2", region: "경기" }),
      ];
      const { result } = renderPipeline({ apartments: apts });
      expect(result.current.regionOptions[0]).toBe("전체");
      expect(result.current.regionOptions).toContain("서울");
      expect(result.current.regionOptions).toContain("경기");
    });
  });
});
