// @ts-check
/**
 * housing-permits.mjs 테스트 — 주택 인허가 순수 함수 검증
 *
 * 대상: resolveRegion
 */
import { describe, it, expect, vi } from "vitest";

// _shared.mjs 모킹
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return {
    ...orig,
    loadEnv: vi.fn(),
    getSupabase: vi.fn(),
    log: vi.fn(),
    logError: vi.fn(),
    fetchWithRetry: vi.fn(),
    today: vi.fn(() => "2026-03-30"),
    recordApiQuota: vi.fn(),
    REGION_MAP: orig.REGION_MAP,
    VALID_REGIONS: orig.VALID_REGIONS,
  };
});

// MOLIT_KEY 설정 — 모듈 로드 시 process.exit 방지
process.env.MOLIT_KEY = "test-key";

const { resolveRegion, pickLatestRegionId } = await import("./housing-permits.mjs");

// ── resolveRegion ─────────────────────────────────────────────
describe("resolveRegion (housing-permits)", () => {
  it("정확한 매칭 '서울특별시' → '서울'", () => {
    expect(resolveRegion("서울특별시")).toBe("서울");
  });

  it("정확한 매칭 '경기도' → '경기'", () => {
    expect(resolveRegion("경기도")).toBe("경기");
  });

  it("부분 매칭 '대전' → '대전'", () => {
    expect(resolveRegion("대전")).toBe("대전");
  });

  it("null → null", () => {
    expect(resolveRegion(null)).toBeNull();
  });

  it("매칭 불가 → null", () => {
    expect(resolveRegion("알수없는곳")).toBeNull();
  });

  it("제주특별자치도 → 제주", () => {
    expect(resolveRegion("제주특별자치도")).toBe("제주");
  });
});

// ── pickLatestRegionId (PostgREST 전체행 UPDATE 버그 회귀 가드) ────
describe("pickLatestRegionId (housing-permits)", () => {
  it("같은 시도의 여러 스냅샷 중 최신 recorded_at 의 id 만 선택", () => {
    const rows = [
      { id: 1, region: "서울", recorded_at: "2026-03-20" },
      { id: 2, region: "서울", recorded_at: "2026-02-01" },
      { id: 3, region: "서울", recorded_at: "2026-01-01" },
    ];
    const map = pickLatestRegionId(rows);
    expect(map.get("서울")).toBe(1); // 최신 2026-03-20 = id 1
    expect(map.size).toBe(1); // 시도당 1개만
  });

  it("입력 정렬 순서와 무관하게 최신행 선택 (DESC/ASC/무작위 모두)", () => {
    const ascRows = [
      { id: 30, region: "경기", recorded_at: "2026-01-01" },
      { id: 20, region: "경기", recorded_at: "2026-02-01" },
      { id: 10, region: "경기", recorded_at: "2026-03-01" }, // 최신
    ];
    expect(pickLatestRegionId(ascRows).get("경기")).toBe(10);
  });

  it("여러 시도 각각 최신행 id 매핑", () => {
    const rows = [
      { id: 1, region: "서울", recorded_at: "2026-03-01" },
      { id: 2, region: "서울", recorded_at: "2026-01-01" },
      { id: 5, region: "부산", recorded_at: "2026-03-01" },
      { id: 6, region: "부산", recorded_at: "2026-02-01" },
    ];
    const map = pickLatestRegionId(rows);
    expect(map.get("서울")).toBe(1);
    expect(map.get("부산")).toBe(5);
    expect(map.size).toBe(2);
  });

  it("빈 입력 → 빈 Map", () => {
    expect(pickLatestRegionId([]).size).toBe(0);
  });

  it("region 누락 행은 제외", () => {
    const rows = /** @type {any} */ ([
      { id: 1, region: "", recorded_at: "2026-03-01" },
      { id: 2, region: "대전", recorded_at: "2026-03-01" },
    ]);
    const map = pickLatestRegionId(rows);
    expect(map.has("")).toBe(false);
    expect(map.get("대전")).toBe(2);
    expect(map.size).toBe(1);
  });
});
