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
    id: "ah-1",
    name: "테스트아파트",
    region: "서울",
    gu: "강남구",
    price: 50000,
    area: 84,
    units: 500,
    builder: "현대건설",
    completion: "202706",
    unsoldRate: 10,
    updatedAt: "2026-04-01",
    catsCache: makeCats(),
    ...overrides,
  };
}

const DEFAULT_PROPS = {
  apartments: [],
  profile: "live",
  customWeights: {},
  filterRegion: "전체",
  filterGu: "전체",
  sortKey: "total",
  moveInFilter: "전체",
  builderTier: "전체",
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
  searchQuery: "",
  hideNoUnsold: false,
  compIds: [],
  dataUpdatedAt: "2026-04-10T00:00:00Z",
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
        "guOptions",
        "catsCache",
        "scored",
        "filtered",
        "visible",
        "visibleCount",
        "setVisibleCount",
        "scoredMap",
        "compItems",
        "pw",
        "activeFilterCount",
        "regionOptions",
        "filterOptionCounts",
        "dataFreshnessText",
        "isFilterPending",
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
      expect(result.current.guOptions.filter((g) => g === "강남구")).toHaveLength(1);
    });

    it("특정 region 선택 시 해당 gu만 반환", () => {
      const apts = [makeApt({ region: "서울", gu: "강남구" }), makeApt({ id: "ah-2", region: "경기", gu: "성남시" })];
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
      // live: location:45, product:20, price:20, risk:10, benefit:0, future:5 (2026-08-11: benefit 5 → location 재분배)
      // cats: location:65, product:60, price:70, risk:75, benefit:50, future:55
      // 합산: 65*45/100 + 60*20/100 + 70*20/100 + 75*10/100 + 50*0/100 + 55*5/100
      //     = 29.25 + 12 + 14 + 7.5 + 0 + 2.75 = 65.5 → round → 66
      const apts = [makeApt()];
      const { result } = renderPipeline({ apartments: apts, profile: "live" });
      expect(result.current.scored).toHaveLength(1);
      expect(result.current.scored[0].res.total).toBe(66);
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
      // PROFILES.live.w 기본값 사용 → 66 (2026-08-11: benefit 재분배로 65→66, 위 테스트와 동일 산식)
      expect(result.current.scored[0].res.total).toBe(66);
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
      const prices = result.current.filtered.map((x) => x.apt.price);
      expect(prices[0] ?? 0).toBeLessThanOrEqual(prices[1] ?? 0);
      expect(prices[1] ?? 0).toBeLessThanOrEqual(prices[2] ?? 0);
    });

    it("sortKey=total → 점수 내림차순 (동점 시 동일 순서)", () => {
      const { result } = renderPipeline({ apartments: threeApts, sortKey: "total" });
      const totals = result.current.filtered.map((x) => x.res.total);
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
      const order = result.current.filtered.map((x) => x.apt.id);
      expect(order).toEqual(["ah-b", "ah-d", "ah-a", "ah-c"]); // 20 > 12 > 5 > null
    });

    // 세션 445 R1 회귀: hideNoUnsold("미분양만 보기")는 unsold(수) 기준.
    //   unsoldRate 가 100% 초과 폭발값이라 null 로 무력화돼도 unsold>0 이면 목록에 남아야 한다
    //   (과거 unsoldRate>0 필터라 클램프 null 단지가 미분양 목록에서 사라지던 회귀 방지).
    it("hideNoUnsold=true → unsold>0 단지는 unsoldRate=null 이어도 남는다", () => {
      const apts = [
        makeApt({ id: "ah-clamped", region: "서울", price: 30000, unsold: 39, unsoldRate: null }),
        makeApt({ id: "ah-sold", region: "서울", price: 30000, unsold: 0, unsoldRate: 0 }),
        makeApt({ id: "ah-normal", region: "서울", price: 30000, unsold: 5, unsoldRate: 5 }),
      ];
      const { result } = renderPipeline({ apartments: apts, hideNoUnsold: true });
      const ids = result.current.filtered.map((x) => x.apt.id).sort();
      expect(ids).toEqual(["ah-clamped", "ah-normal"]); // 미분양 0 단지만 빠짐
    });

    it("sortKey=moveInSoon → 준공완료(최근순) → 예정(가까운순) → 미정/null 맨뒤 (세션 424)", () => {
      // NOW_YM 기준 과거/미래 동적 생성 (시간 흐름에 안정). YYYYMM 고정폭.
      const yy = new Date().getFullYear();
      const past1 = `${yy - 1}05`; // 작년 5월 (준공완료, 더 오래됨)
      const past2 = `${yy - 1}11`; // 작년 11월 (준공완료, 더 최근)
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
      const order = result.current.filtered.map((x) => x.apt.id);
      // 준공완료(최근 먼저): past2 > past1 → 예정(가까운 먼저): future1 > future2 → 미정·null 맨뒤(입력 순서 안정)
      expect(order.slice(0, 4)).toEqual(["ah-past-recent", "ah-past-old", "ah-fut-near", "ah-fut-far"]);
      // 미정("미정")·null 은 정규식 미일치라 rank 2 (맨 뒤 2칸), 동률 종합점수 → 안정 정렬로 입력 순서
      expect(order.slice(4).sort()).toEqual(["ah-null", "ah-undecided"]);
    });

    it("sortKey=subwayNear → 역세권 가까운순(오름차순), null·9999(역없음 sentinel)은 맨 뒤 (세션 444)", () => {
      const apts = [
        makeApt({ id: "ah-a", region: "서울", price: 30000, subwayDist: 800 }),
        makeApt({ id: "ah-b", region: "서울", price: 30000, subwayDist: 150 }),
        makeApt({ id: "ah-c", region: "서울", price: 30000, subwayDist: null }),
        makeApt({ id: "ah-d", region: "서울", price: 30000, subwayDist: 400 }),
        makeApt({ id: "ah-e", region: "서울", price: 30000, subwayDist: 9999 }), // 역 없음 sentinel → 맨뒤
      ];
      const { result } = renderPipeline({ apartments: apts, sortKey: "subwayNear" });
      const order = result.current.filtered.map((x) => x.apt.id);
      // 150 < 400 < 800 < (null·9999 = Infinity, 동률 종합점수 tie-break → 안정 정렬로 입력 순서 c,e)
      expect(order.slice(0, 3)).toEqual(["ah-b", "ah-d", "ah-a"]);
      expect(order.slice(3).sort()).toEqual(["ah-c", "ah-e"]);
    });

    it("sortKey=jeonseHigh → 전세가율 높은순(내림차순), null 은 맨 뒤 (세션 444)", () => {
      const apts = [
        makeApt({ id: "ah-a", region: "서울", price: 30000, jeonseRate: 60 }),
        makeApt({ id: "ah-b", region: "서울", price: 30000, jeonseRate: 85 }),
        makeApt({ id: "ah-c", region: "서울", price: 30000, jeonseRate: null }),
        makeApt({ id: "ah-d", region: "서울", price: 30000, jeonseRate: 72 }),
      ];
      const { result } = renderPipeline({ apartments: apts, sortKey: "jeonseHigh" });
      const order = result.current.filtered.map((x) => x.apt.id);
      expect(order).toEqual(["ah-b", "ah-d", "ah-a", "ah-c"]); // 85 > 72 > 60 > null(-1)
    });

    it("sortKey=maintenanceLow → 관리비 낮은순(오름차순), null 은 맨 뒤 (세션 474)", () => {
      const apts = [
        makeApt({ id: "ah-a", region: "서울", price: 30000, avgMaintenanceCost: 18 }),
        makeApt({ id: "ah-b", region: "서울", price: 30000, avgMaintenanceCost: 5 }),
        makeApt({ id: "ah-c", region: "서울", price: 30000, avgMaintenanceCost: null }),
        makeApt({ id: "ah-d", region: "서울", price: 30000, avgMaintenanceCost: 12 }),
      ];
      const { result } = renderPipeline({ apartments: apts, sortKey: "maintenanceLow" });
      const order = result.current.filtered.map((x) => x.apt.id);
      expect(order).toEqual(["ah-b", "ah-d", "ah-a", "ah-c"]); // 5 < 12 < 18 < null(Infinity 맨뒤)
    });

    it("sortKey=crimeSafe → 치안 안전순(등급 오름차순, 1=안전), null 은 맨 뒤 (세션 474)", () => {
      const apts = [
        makeApt({ id: "ah-a", region: "서울", price: 30000, crimeSafetyGrade: 4 }),
        makeApt({ id: "ah-b", region: "서울", price: 30000, crimeSafetyGrade: 1 }),
        makeApt({ id: "ah-c", region: "서울", price: 30000, crimeSafetyGrade: null }),
        makeApt({ id: "ah-d", region: "서울", price: 30000, crimeSafetyGrade: 2 }),
      ];
      const { result } = renderPipeline({ apartments: apts, sortKey: "crimeSafe" });
      const order = result.current.filtered.map((x) => x.apt.id);
      expect(order).toEqual(["ah-b", "ah-d", "ah-a", "ah-c"]); // 1 < 2 < 4 < null(Infinity 맨뒤)
    });

    it("sortKey=parkingHigh → 주차 넉넉순(내림차순), null 은 맨 뒤 (세션 477)", () => {
      const apts = [
        makeApt({ id: "ah-a", region: "서울", price: 30000, parkingRatio: 0.8 }),
        makeApt({ id: "ah-b", region: "서울", price: 30000, parkingRatio: 2.0 }),
        makeApt({ id: "ah-c", region: "서울", price: 30000, parkingRatio: null }),
        makeApt({ id: "ah-d", region: "서울", price: 30000, parkingRatio: 1.4 }),
      ];
      const { result } = renderPipeline({ apartments: apts, sortKey: "parkingHigh" });
      const order = result.current.filtered.map((x) => x.apt.id);
      expect(order).toEqual(["ah-b", "ah-d", "ah-a", "ah-c"]); // 2.0 > 1.4 > 0.8 > null(-Infinity 맨뒤)
    });

    it("sortKey=hospitalNear → 병원 가까운순(거리 오름차순), null 은 맨 뒤 (세션 479)", () => {
      const apts = [
        makeApt({ id: "ah-a", region: "서울", price: 30000, hospitalDist: 800 }),
        makeApt({ id: "ah-b", region: "서울", price: 30000, hospitalDist: 100 }),
        makeApt({ id: "ah-c", region: "서울", price: 30000, hospitalDist: null }),
        makeApt({ id: "ah-d", region: "서울", price: 30000, hospitalDist: 300 }),
      ];
      const { result } = renderPipeline({ apartments: apts, sortKey: "hospitalNear" });
      const order = result.current.filtered.map((x) => x.apt.id);
      expect(order).toEqual(["ah-b", "ah-d", "ah-a", "ah-c"]); // 100 < 300 < 800 < null(Infinity 맨뒤)
    });

    it("sortKey=parkNear → 공원 가까운순(거리 오름차순), null 은 맨 뒤 (세션 479)", () => {
      const apts = [
        makeApt({ id: "ah-a", region: "서울", price: 30000, parkDist: 700 }),
        makeApt({ id: "ah-b", region: "서울", price: 30000, parkDist: 150 }),
        makeApt({ id: "ah-c", region: "서울", price: 30000, parkDist: null }),
        makeApt({ id: "ah-d", region: "서울", price: 30000, parkDist: 400 }),
      ];
      const { result } = renderPipeline({ apartments: apts, sortKey: "parkNear" });
      const order = result.current.filtered.map((x) => x.apt.id);
      expect(order).toEqual(["ah-b", "ah-d", "ah-a", "ah-c"]); // 150 < 400 < 700 < null(Infinity 맨뒤)
    });

    // 세션 524 — 정렬 6종(카테고리 점수 4 + 최신 + 대단지)에 순서 가드가 없던 자리.
    //   한 배열로 6개를 돌려 "정렬 키마다 다른 순서가 나온다"까지 함께 잠근다.
    describe("정렬 6종 순서 (세션 524)", () => {
      const sortApts = [
        makeApt({
          id: "ah-s1",
          region: "서울",
          units: 300,
          updatedAt: "2026-01-05",
          catsCache: makeCats({
            price: { total: 40, subs: [] },
            location: { total: 80, subs: [] },
            risk: { total: 60, subs: [] },
            benefit: { total: 50, totalWon: 100, subs: [] },
          }),
        }),
        makeApt({
          id: "ah-s2",
          region: "서울",
          units: 1200,
          updatedAt: "2026-07-20",
          catsCache: makeCats({
            price: { total: 90, subs: [] },
            location: { total: 50, subs: [] },
            risk: { total: 95, subs: [] },
            benefit: { total: 50, totalWon: 900, subs: [] },
          }),
        }),
        makeApt({
          id: "ah-s3",
          region: "서울",
          units: 800,
          updatedAt: "2026-03-11",
          catsCache: makeCats({
            price: { total: 65, subs: [] },
            location: { total: 95, subs: [] },
            risk: { total: 30, subs: [] },
            benefit: { total: 50, totalWon: 400, subs: [] },
          }),
        }),
      ];
      const orderBy = (/** @type {string} */ sortKey) =>
        renderPipeline({ apartments: sortApts, sortKey }).result.current.filtered.map((x) => x.apt.id);

      it("sortKey=priceScore → 가격점수 내림차순", () => {
        expect(orderBy("priceScore")).toEqual(["ah-s2", "ah-s3", "ah-s1"]); // 90 > 65 > 40
      });

      it("sortKey=location → 입지점수 내림차순", () => {
        expect(orderBy("location")).toEqual(["ah-s3", "ah-s1", "ah-s2"]); // 95 > 80 > 50
      });

      it("sortKey=safe → 안정성(risk)점수 내림차순", () => {
        expect(orderBy("safe")).toEqual(["ah-s2", "ah-s1", "ah-s3"]); // 95 > 60 > 30
      });

      it("sortKey=benefit → 혜택 금액(totalWon) 내림차순", () => {
        expect(orderBy("benefit")).toEqual(["ah-s2", "ah-s3", "ah-s1"]); // 900 > 400 > 100
      });

      it("sortKey=newest → updatedAt 최신순", () => {
        expect(orderBy("newest")).toEqual(["ah-s2", "ah-s3", "ah-s1"]); // 07-20 > 03-11 > 01-05
      });

      it("sortKey=units → 세대수 많은순", () => {
        expect(orderBy("units")).toEqual(["ah-s2", "ah-s3", "ah-s1"]); // 1200 > 800 > 300
      });
    });

    it("filterRegion 적용", () => {
      const { result } = renderPipeline({ apartments: threeApts, filterRegion: "서울" });
      expect(result.current.filtered.every((x) => x.apt.region === "서울")).toBe(true);
    });

    it("filterGu 적용", () => {
      const { result } = renderPipeline({ apartments: threeApts, filterRegion: "서울", filterGu: "강남구" });
      expect(result.current.filtered.every((x) => x.apt.gu === "강남구")).toBe(true);
    });

    // 세션 524 — 시공사 등급·입주 상태가 파이프라인에서 실제로 거르는지 (기존엔 정렬만 있고 이 두 필터 가드가 없었다)
    it("builderTier 적용 — 1군만 남는다", () => {
      const apts = [
        makeApt({ id: "ah-t1", region: "서울", builder: "현대건설" }), // 1군Super → "1군"
        makeApt({ id: "ah-etc", region: "서울", builder: "이름없는건설" }), // 매핑 없음 → "기타"
      ];
      const { result } = renderPipeline({ apartments: apts, builderTier: "1군" });
      expect(result.current.filtered.map((x) => x.apt.id)).toEqual(["ah-t1"]);
    });

    it("builderTier 적용 — 기타만 남는다", () => {
      const apts = [
        makeApt({ id: "ah-t1", region: "서울", builder: "현대건설" }),
        makeApt({ id: "ah-etc", region: "서울", builder: "이름없는건설" }),
      ];
      const { result } = renderPipeline({ apartments: apts, builderTier: "기타" });
      expect(result.current.filtered.map((x) => x.apt.id)).toEqual(["ah-etc"]);
    });

    it("moveInFilter 적용 — 입주예정/미입주/입주완료 각각 그 상태만 남는다", () => {
      // NOW_YM 기준 상대값 (고정 날짜는 시간이 지나면 스스로 깨진다)
      const yy = new Date().getFullYear();
      const apts = [
        makeApt({ id: "ah-sched", region: "서울", completion: `${yy + 1}03` }), // 미래 → 입주예정
        makeApt({ id: "ah-notmoved", region: "서울", completion: `${yy - 1}05`, unsold: 12 }), // 과거 + 잔여 → 미입주
        makeApt({ id: "ah-done", region: "서울", completion: `${yy - 1}05`, unsold: 0 }), // 과거 + 잔여 0 → 입주완료
      ];
      const pick = (/** @type {string} */ moveInFilter) =>
        renderPipeline({ apartments: apts, moveInFilter }).result.current.filtered.map((x) => x.apt.id);
      expect(pick("입주예정")).toEqual(["ah-sched"]);
      expect(pick("미입주")).toEqual(["ah-notmoved"]);
      expect(pick("입주완료")).toEqual(["ah-done"]);
    });

    it("hideNoUnsold → unsoldRate 0 제외", () => {
      const { result } = renderPipeline({ apartments: threeApts, hideNoUnsold: true });
      expect(result.current.filtered.every((x) => (x.apt.unsoldRate ?? 0) > 0)).toBe(true);
      expect(result.current.filtered.some((x) => x.apt.id === "ah-2")).toBe(false);
    });
  });

  /* ── visible (페이지네이션) ── */
  describe("visible", () => {
    it("VISIBLE_PAGE_SIZE 상수 = 30", () => {
      expect(VISIBLE_PAGE_SIZE).toBe(30);
    });

    it("아파트 수 > PAGE_SIZE → visible은 PAGE_SIZE 이하", () => {
      const manyApts = Array.from({ length: 50 }, (_, i) => makeApt({ id: `ah-${i}` }));
      const { result } = renderPipeline({ apartments: manyApts });
      expect(result.current.visible.length).toBeLessThanOrEqual(VISIBLE_PAGE_SIZE);
    });

    it("setVisibleCount로 확장", () => {
      const manyApts = Array.from({ length: 50 }, (_, i) => makeApt({ id: `ah-${i}` }));
      const { result } = renderPipeline({ apartments: manyApts });
      act(() => {
        result.current.setVisibleCount(50);
      });
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
      const apts = [makeApt({ id: "ah-1", region: "서울" }), makeApt({ id: "ah-2", region: "경기" })];
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
      const apts = [makeApt({ id: "ah-1" }), makeApt({ id: "ah-2" }), makeApt({ id: "ah-3" })];
      const { result } = renderPipeline({ apartments: apts, compIds: ["ah-1", "ah-3"] });
      expect(result.current.compItems).toHaveLength(2);
      expect(result.current.compItems.map((x) => x.apt.id)).toEqual(["ah-1", "ah-3"]);
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

    // 세션 524 회귀 가드 — filterGu 가 카운트 배열에 없어 "서울 강남구"가 1개로 보이던 결함.
    //   지역과 별개로 세야 배지 숫자와 실제 좁힌 정도가 맞는다.
    it("filterGu 선택 시 카운트 +1", () => {
      const { result } = renderPipeline({ filterGu: "강남구" });
      expect(result.current.activeFilterCount).toBe(1);
    });

    it("filterRegion + filterGu 동시 선택 시 카운트 2", () => {
      const { result } = renderPipeline({ filterRegion: "서울", filterGu: "강남구" });
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
      const apts = [makeApt({ region: "서울" }), makeApt({ id: "ah-2", region: "경기" })];
      const { result } = renderPipeline({ apartments: apts });
      expect(result.current.regionOptions[0]).toBe("전체");
      expect(result.current.regionOptions).toContain("서울");
      expect(result.current.regionOptions).toContain("경기");
    });
  });
});
