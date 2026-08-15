// @ts-check
/**
 * trade-stats.mjs 테스트 — 거래 통계 순수 함수 검증
 *
 * 대상: median, monthsAgo, groupByArea
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// _shared.mjs 모킹 — 외부 호출 차단
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return {
    ...orig,
    loadEnv: vi.fn(),
    getSupabase: vi.fn(),
    getMibuyangSupabase: vi.fn(),
    log: vi.fn(),
    logError: vi.fn(),
    recordCollectorRun: vi.fn(),
  };
});

const { median, monthsAgo, groupByArea, statsKey, fetchAll } = await import("./trade-stats.mjs");
const { REGION_MAP } = await import("./_shared.mjs");

// ── 팩토리 ───────────────────────────────────────────────────
/** 거래 데이터 팩토리
 * @param {number} area
 * @param {number} price
 */
function makeTrade(area, price) {
  return { area, price };
}

// ── median ────────────────────────────────────────────────────
describe("median", () => {
  it("빈 배열 → null", () => {
    expect(median([])).toBeNull();
  });

  it("단일 요소 → 그대로 반환", () => {
    expect(median([42])).toBe(42);
  });

  it("홀수 개 → 중앙값", () => {
    // [1, 3, 5] → 정렬 후 중앙 = 3
    expect(median([5, 1, 3])).toBe(3);
  });

  it("짝수 개 → 두 중앙값의 평균 (반올림)", () => {
    // [10, 20, 30, 40] → (20+30)/2 = 25
    expect(median([40, 10, 30, 20])).toBe(25);
  });

  it("짝수 개 홀수 합 → 반올림", () => {
    // [1, 2] → (1+2)/2 = 1.5 → Math.round = 2
    expect(median([1, 2])).toBe(2);
  });

  it("중복값 처리", () => {
    // [5, 5, 5] → 5
    expect(median([5, 5, 5])).toBe(5);
  });

  it("원본 배열을 변경하지 않음 (정렬 안전성)", () => {
    const arr = [3, 1, 2];
    median(arr);
    expect(arr).toEqual([3, 1, 2]);
  });

  it("음수값 포함", () => {
    // [-10, -5, 0, 5, 10] → 0
    expect(median([-10, 10, 0, -5, 5])).toBe(0);
  });
});

// ── monthsAgo ─────────────────────────────────────────────────
describe("monthsAgo", () => {
  it("0개월 전 → 오늘 날짜 (YYYY-MM-DD)", () => {
    const result = monthsAgo(0);
    // ISO 날짜 형식 확인
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const today = new Date().toISOString().slice(0, 10);
    expect(result).toBe(today);
  });

  it("12개월 전 → 약 1년 전", () => {
    const result = monthsAgo(12);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const d = new Date();
    d.setMonth(d.getMonth() - 12);
    expect(result).toBe(d.toISOString().slice(0, 10));
  });

  it("6개월 전 → 정확한 월 계산", () => {
    const result = monthsAgo(6);
    const d = new Date();
    d.setMonth(d.getMonth() - 6);
    expect(result).toBe(d.toISOString().slice(0, 10));
  });

  it("반환값 길이 10 (YYYY-MM-DD)", () => {
    expect(monthsAgo(3).length).toBe(10);
  });
});

// ── groupByArea ───────────────────────────────────────────────
describe("groupByArea", () => {
  it("빈 배열 → 빈 배열", () => {
    expect(groupByArea([])).toEqual([]);
  });

  it("단일 거래 → 하나의 버킷 (min=avg=max)", () => {
    const result = groupByArea([makeTrade(84, 50000)]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      area: 85,  // Math.round(84/5)*5 = 85
      min: 50000,
      avg: 50000,
      max: 50000,
      count: 1,
    });
  });

  it("같은 면적 버킷 → 통계 계산 정확성", () => {
    const trades = [
      makeTrade(83, 40000),  // bucket 85
      makeTrade(84, 50000),  // bucket 85
      makeTrade(86, 60000),  // bucket 85
    ];
    const result = groupByArea(trades);
    expect(result).toHaveLength(1);
    expect(result[0].area).toBe(85);
    expect(result[0].min).toBe(40000);
    expect(result[0].max).toBe(60000);
    expect(result[0].avg).toBe(50000); // (40000+50000+60000)/3
    expect(result[0].count).toBe(3);
  });

  it("다른 면적 버킷 → 면적 오름차순 정렬", () => {
    const trades = [
      makeTrade(110, 80000), // bucket 110
      makeTrade(60, 30000),  // bucket 60
      makeTrade(84, 50000),  // bucket 85
    ];
    const result = groupByArea(trades);
    expect(result).toHaveLength(3);
    // 면적 오름차순
    expect(result[0].area).toBe(60);
    expect(result[1].area).toBe(85);
    expect(result[2].area).toBe(110);
  });

  it("버킷 경계값 (면적 정확히 5의 배수)", () => {
    const result = groupByArea([makeTrade(85, 50000)]);
    expect(result[0].area).toBe(85); // Math.round(85/5)*5 = 85
  });

  it("면적 0 → 버킷 0", () => {
    const result = groupByArea([makeTrade(0, 10000)]);
    expect(result[0].area).toBe(0);
  });

  it("평균값 반올림 (Math.round)", () => {
    // (10001 + 10002) / 2 = 10001.5 → Math.round = 10002
    const trades = [makeTrade(84, 10001), makeTrade(84, 10002)];
    const result = groupByArea(trades);
    expect(result[0].avg).toBe(10002);
  });

  it("여러 버킷 + 여러 거래 → 각 버킷별 독립 통계", () => {
    const trades = [
      makeTrade(58, 20000), // bucket 60
      makeTrade(59, 30000), // bucket 60
      makeTrade(83, 50000), // bucket 85
      makeTrade(84, 60000), // bucket 85
      makeTrade(112, 90000), // bucket 110
    ];
    const result = groupByArea(trades);
    expect(result).toHaveLength(3);

    // bucket 60
    expect(result[0]).toEqual({
      area: 60, min: 20000, avg: 25000, max: 30000, count: 2,
    });
    // bucket 85
    expect(result[1]).toEqual({
      area: 85, min: 50000, avg: 55000, max: 60000, count: 2,
    });
    // bucket 110
    expect(result[2]).toEqual({
      area: 110, min: 90000, avg: 90000, max: 90000, count: 1,
    });
  });
});

// ── statsKey ─────────────────────────────────────────────────
// 세종 단지(gu=null 40건 + "행정중심복합도시" 1건)를 한 버킷으로 통합하기 위한
// 키 헬퍼. 비세종은 기존 리터럴 `region:gu` 와 bit 단위 동일해야 함.
describe("statsKey", () => {
  it("세종 + null → '세종:' (세종 단일 버킷)", () => {
    expect(statsKey("세종", null)).toBe("세종:");
  });

  it("세종 + 임의 gu 값 → '세종:' (세종은 gu 무시)", () => {
    expect(statsKey("세종", "행정중심복합도시")).toBe("세종:");
    expect(statsKey("세종", "세종시")).toBe("세종:");
  });

  it("비세종 region + gu → 'region:gu' (기존 리터럴과 동일)", () => {
    expect(statsKey("경기", "성남시 분당구")).toBe("경기:성남시 분당구");
    expect(statsKey("서울", "강남구")).toBe("서울:강남구");
  });

  it("비세종 region + null gu → null (엄격 차단)", () => {
    expect(statsKey("경기", null)).toBeNull();
    expect(statsKey("서울", "")).toBeNull();
  });

  it("region 없음 → null", () => {
    expect(statsKey(null, "강남구")).toBeNull();
    expect(statsKey("", "강남구")).toBeNull();
  });
});

// ── complexGuMap region 정규화 (세션389 회귀 가드) ──────────────
// complexes.sido 는 정식명("대전광역시")인데 apartments/trades.region 은 약칭("대전").
// main() 의 complexGuMap 빌드는 REGION_MAP 으로 sido 를 정규화한 뒤 statsKey 를 만든다.
// 정규화 없이는 비세종 단지가 전부 아파트 키와 불일치 → nearbyBuildYear 가 세종만 채워졌던 버그.
describe("complexes.sido REGION_MAP 정규화", () => {
  // main() L220 과 동일한 정규화 로직
  /** @param {string} sido */
  const normSido = (sido) =>
    REGION_MAP[sido] ?? (sido === "세종특별자치시" ? "세종" : sido);

  it("정식명 → 약칭 정규화 (REGION_MAP)", () => {
    expect(normSido("대전광역시")).toBe("대전");
    expect(normSido("경기도")).toBe("경기");
    expect(normSido("강원도")).toBe("강원");
    expect(normSido("서울특별시")).toBe("서울");
  });

  it("세종특별자치시 → 세종 (특수 처리 보존)", () => {
    expect(normSido("세종특별자치시")).toBe("세종");
  });

  it("정규화된 region 으로 만든 statsKey 가 아파트 키(약칭)와 일치", () => {
    // 단지(정식명) vs 아파트(약칭) — 정규화 후 키가 같아야 매칭됨
    const complexKey = statsKey(normSido("대전광역시"), "유성구");
    const aptKey = statsKey("대전", "유성구");
    expect(complexKey).toBe(aptKey);
    expect(complexKey).toBe("대전:유성구");
  });

  it("정규화 없이는 키 불일치 (버그 재현 — 회귀 방지)", () => {
    const unnormalizedKey = statsKey("대전광역시", "유성구");
    const aptKey = statsKey("대전", "유성구");
    expect(unnormalizedKey).not.toBe(aptKey);
  });
});

// ── fetchAll 페이징 (세션513) ────────────────────────────────
//
// 사고: 옛 구현은 `.range(from, from+999)` 만 썼다. Postgres 는 ORDER BY 가 없으면 행 순서를
// 보장하지 않아, **같은 오프셋으로 같은 쿼리를 두 번 던졌더니 교집합이 0** 이었다(trades 79.5만행
// 라이브 실측). 그 결과 구 단위 6개월 거래량이 원본의 8% 수준으로 저장되고 있었다
// (화성시 실제 479 → 저장 38). 고유키 커서로 바꾼 뒤 1,380 = COUNT 정확 일치·중복 0 을 확인했다.
//
// 이 가드는 **쿼리를 어떻게 만드는지**를 잠근다 — 순수 함수가 아니라 배선이라 mock 으로 본다.
describe("fetchAll — 고유키 커서 페이징", () => {
  /**
   * PostgREST 쿼리 빌더 mock. 호출된 메서드를 순서대로 기록한다.
   * @param {Array<Array<Record<string, any>>>} pages 페이지별 반환 행
   */
  function makeClient(pages) {
    /** @type {Array<{ method: string, args: any[] }>} */
    const calls = [];
    let page = 0;
    const builder = {
      /** @param {string} c @param {any} o */
      order(c, o) {
        calls.push({ method: "order", args: [c, o] });
        return builder;
      },
      /** @param {number} n */
      limit(n) {
        calls.push({ method: "limit", args: [n] });
        return builder;
      },
      /** @param {string} c @param {any} v */
      eq(c, v) {
        calls.push({ method: "eq", args: [c, v] });
        return builder;
      },
      /** @param {string} c @param {any} v */
      gt(c, v) {
        calls.push({ method: "gt", args: [c, v] });
        return builder;
      },
      /** @param {string} c @param {any} v */
      lt(c, v) {
        calls.push({ method: "lt", args: [c, v] });
        return builder;
      },
      /** @param {string} c @param {any} v */
      gte(c, v) {
        calls.push({ method: "gte", args: [c, v] });
        return builder;
      },
      /** @param {string} c @param {any} v */
      is(c, v) {
        calls.push({ method: "is", args: [c, v] });
        return builder;
      },
      /** @param {any} r */
      then(r) {
        return Promise.resolve({ data: pages[page++] ?? [], error: null }).then(r);
      },
    };
    const client = {
      /** @param {string} t */
      from(t) {
        calls.push({ method: "from", args: [t] });
        return {
          /** @param {string} s */
          select(s) {
            calls.push({ method: "select", args: [s] });
            return builder;
          },
        };
      },
    };
    return { client, calls };
  }

  /** @param {number} n @param {number} start */
  const rows = (n, start = 0) => Array.from({ length: n }, (_, i) => ({ id: start + i + 1, v: "x" }));

  it("정렬 없이 페이징하지 않는다 — 매 페이지 order(고유키)", async () => {
    const { client, calls } = makeClient([rows(1000), rows(3, 1000)]);
    await fetchAll("trades", "region,gu", {}, /** @type {any} */ (client));
    const orders = calls.filter((c) => c.method === "order");
    expect(orders.length).toBe(2); // 2페이지 = order 2회
    expect(orders[0].args[0]).toBe("id");
    expect(orders[0].args[1]).toEqual({ ascending: true });
    // `.range()` 는 더 이상 쓰지 않는다(불안정 페이징의 원인)
    expect(calls.some((c) => c.method === "range")).toBe(false);
  });

  it("2페이지부터 커서(gt 마지막 키)로 이어받는다 — 오프셋을 안 쓴다", async () => {
    const { client, calls } = makeClient([rows(1000), rows(2, 1000)]);
    await fetchAll("trades", "region,gu", {}, /** @type {any} */ (client));
    const gts = calls.filter((c) => c.method === "gt");
    expect(gts.length).toBe(1); // 1페이지엔 커서 없음, 2페이지에만
    expect(gts[0].args).toEqual(["id", 1000]); // 1페이지 마지막 id
  });

  it("키가 select 에 없으면 앞에 붙인다 — 커서를 못 만들면 페이징이 죽는다", async () => {
    const { client, calls } = makeClient([rows(2)]);
    await fetchAll("trades", "region,gu", {}, /** @type {any} */ (client));
    expect(calls.find((c) => c.method === "select")?.args[0]).toBe("id,region,gu");
  });

  it("키가 이미 select 에 있으면 중복해 붙이지 않는다", async () => {
    const { client, calls } = makeClient([rows(2)]);
    await fetchAll("trades", "id,region", {}, /** @type {any} */ (client));
    expect(calls.find((c) => c.method === "select")?.args[0]).toBe("id,region");
  });

  it("내림차순 옵션은 order(desc)+lt 커서 — articles 는 이쪽이어야 산다", async () => {
    // articles 는 활성 매물이 최신(큰 article_no)에 몰려 있어 오름차순이면 죽은 행 100만 개를
    // 먼저 훑다가 서버 statement timeout 으로 죽는다(라이브 실측).
    const { client, calls } = makeClient([
      [{ article_no: "300", v: "x" }],
      [],
    ]);
    await fetchAll("articles", "complex_no", { is_active: true }, /** @type {any} */ (client), [], "article_no", true);
    const order = calls.find((c) => c.method === "order");
    expect(order?.args).toEqual(["article_no", { ascending: false }]);
  });

  it("모든 페이지의 행을 합쳐 돌려준다", async () => {
    const { client } = makeClient([rows(1000), rows(1000, 1000), rows(7, 2000)]);
    const out = await fetchAll("trades", "region", {}, /** @type {any} */ (client));
    expect(out.length).toBe(2007);
  });
});
