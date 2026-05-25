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

const { median, monthsAgo, groupByArea, statsKey } = await import("./trade-stats.mjs");

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
