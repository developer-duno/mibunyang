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

const { resolveRegion, pickLatestRegionId, parseKosisPermits } = await import("./housing-permits.mjs");

// 세션 501 — 출처를 폐기된 MOLIT ArchPmsService_v2 에서 KOSIS DT_MLTM_666 으로 옮겼다.
//
// KOSIS 는 C1_NM 에 시도와 함께 "실적"(전국 합계)·"수도권" 같은 집계행을 섞어 준다.
// 전국 합계(약 38만 호)가 시도 하나로 잡히면 그 시도의 공급비율이 통째로 틀어진다.
//
// ⚠️ 아래 첫 테스트는 "집계행이 결과에 없다"는 **행동**을 검증한다. 어느 방어가 잡든 결과는
// 같으므로 유효하지만, **`AGGREGATE_ROWS` 를 지워도 통과한다** — `resolveRegion` 이 그 이름들을
// 먼저 null 로 떨어뜨리기 때문이다(세션 501 뮤테이션 실측). 즉 지금 그 Set 은 이중 방어이고,
// 이 테스트가 그 Set 자체를 지켜주지는 못한다. 그 사실을 알고 읽어야 한다.
// 반면 "최신 연도 선택"과 "0·음수 배제"는 뮤테이션이 red 를 내 실제로 지켜지고 있다.
describe("parseKosisPermits (KOSIS 인허가 파싱)", () => {
  it("집계행(전국·실적·수도권·지방·계획)을 시도로 착각하지 않는다", () => {
    const out = parseKosisPermits([
      { C1_NM: "실적", PRD_DE: "2025", DT: "379834" },
      { C1_NM: "수도권", PRD_DE: "2025", DT: "222704" },
      { C1_NM: "지방", PRD_DE: "2025", DT: "157130" },
      { C1_NM: "계획", PRD_DE: "2025", DT: "400000" },
      { C1_NM: "전국", PRD_DE: "2025", DT: "379834" },
      { C1_NM: "서울", PRD_DE: "2025", DT: "41566" },
    ]);
    expect(Object.keys(out)).toEqual(["서울"]);
    expect(out["서울"].units).toBe(41566);
  });

  it("같은 시도에 여러 연도가 오면 가장 최근 연도를 쓴다", () => {
    const out = parseKosisPermits([
      { C1_NM: "경기", PRD_DE: "2023", DT: "100000" },
      { C1_NM: "경기", PRD_DE: "2025", DT: "154416" },
      { C1_NM: "경기", PRD_DE: "2024", DT: "120000" },
    ]);
    expect(out["경기"]).toEqual({ units: 154416, year: "2025" });
  });

  it("연도 역순으로 들어와도 최신이 이긴다 (입력 순서 무관)", () => {
    const out = parseKosisPermits([
      { C1_NM: "부산", PRD_DE: "2025", DT: "30449" },
      { C1_NM: "부산", PRD_DE: "2024", DT: "99999" },
    ]);
    expect(out["부산"].year).toBe("2025");
    expect(out["부산"].units).toBe(30449);
  });

  it("쉼표가 든 숫자를 파싱한다", () => {
    const out = parseKosisPermits([{ C1_NM: "충남", PRD_DE: "2025", DT: "32,093" }]);
    expect(out["충남"].units).toBe(32093);
  });

  it("0·음수·빈값·비숫자는 버린다", () => {
    const out = parseKosisPermits([
      { C1_NM: "서울", PRD_DE: "2025", DT: "0" },
      { C1_NM: "부산", PRD_DE: "2025", DT: "-5" },
      { C1_NM: "대구", PRD_DE: "2025", DT: "" },
      { C1_NM: "인천", PRD_DE: "2025", DT: "-" },
    ]);
    expect(Object.keys(out)).toEqual([]);
  });

  it("연도(PRD_DE)가 없는 행은 버린다", () => {
    expect(parseKosisPermits([{ C1_NM: "서울", DT: "41566" }])).toEqual({});
  });

  it("정식명(서울특별시)도 약칭으로 정규화한다", () => {
    const out = parseKosisPermits([{ C1_NM: "서울특별시", PRD_DE: "2025", DT: "41566" }]);
    expect(out["서울"]?.units).toBe(41566);
  });

  it("빈 입력은 빈 객체", () => {
    expect(parseKosisPermits([])).toEqual({});
  });
});

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
