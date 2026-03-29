/**
 * geocode-missing.mjs 테스트 — 지오코딩 순수 함수 검증
 *
 * 대상: resolveRegionFromName, extractGu, buildAddress
 */
import { describe, it, expect, vi } from "vitest";

// _shared.mjs 모킹
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = await importOriginal();
  return {
    ...orig,
    loadEnv: vi.fn(),
    getSupabase: vi.fn(),
    log: vi.fn(),
    logError: vi.fn(),
    sleep: vi.fn(),
  };
});

// KAKAO_KEY 설정 — 모듈 로드 시 process.exit 방지
process.env.KAKAO_KEY = "test-key";

const { resolveRegionFromName, extractGu, buildAddress } = await import("./geocode-missing.mjs");

// ── resolveRegionFromName ─────────────────────────────────────
describe("resolveRegionFromName", () => {
  it("콤마 없는 region → 그대로 반환", () => {
    expect(resolveRegionFromName("서울", "래미안아파트")).toBe("서울");
  });

  it("콤마 있고 단지명에 매칭 → 매칭된 지역", () => {
    expect(resolveRegionFromName("서울,경기", "경기 래미안")).toBe("경기");
  });

  it("콤마 있고 단지명에 매칭 없음 → 첫 번째 후보", () => {
    expect(resolveRegionFromName("서울,경기", "래미안아파트")).toBe("서울");
  });

  it("null region → null", () => {
    expect(resolveRegionFromName(null, "래미안")).toBeNull();
  });

  it("빈 문자열 → 빈 문자열 (콤마 없음)", () => {
    expect(resolveRegionFromName("", "래미안")).toBe("");
  });

  it("공백 포함 콤마 분리 → trim 처리", () => {
    expect(resolveRegionFromName("서울 , 경기", "경기 래미안")).toBe("경기");
  });
});

// ── extractGu ─────────────────────────────────────────────────
describe("extractGu", () => {
  it("숫자로 시작하는 gu → 단지명에서 추출", () => {
    expect(extractGu("123-4", "수원시 래미안 아파트")).toBe("수원시");
  });

  it("'블록'으로 끝나는 gu → 단지명에서 추출", () => {
    expect(extractGu("A3블록", "안산시 래미안 아파트")).toBe("안산시");
  });

  it("'지구'로 끝나는 gu → 단지명에서 추출", () => {
    expect(extractGu("세교지구", "화성시 세교지구 아파트")).toBe("화성시");
  });

  it("정상 gu (구/군 이름) → null (추출 불필요)", () => {
    expect(extractGu("강남구", "래미안아파트")).toBeNull();
  });

  it("null gu → null", () => {
    expect(extractGu(null, "래미안아파트")).toBeNull();
  });

  it("단지명에서 시구군 패턴 못 찾음 → null", () => {
    expect(extractGu("123-4", "래미안아파트")).toBeNull();
  });
});

// ── buildAddress ──────────────────────────────────────────────
describe("buildAddress", () => {
  it("모든 값 있음 → 공백으로 조합", () => {
    expect(buildAddress("서울", "강남구", "역삼동")).toBe("서울 강남구 역삼동");
  });

  it("dong null → region gu만", () => {
    expect(buildAddress("서울", "강남구", null)).toBe("서울 강남구");
  });

  it("gu null → region dong만", () => {
    expect(buildAddress("서울", null, "역삼동")).toBe("서울 역삼동");
  });

  it("모두 null → 빈 문자열", () => {
    expect(buildAddress(null, null, null)).toBe("");
  });

  it("region만 → region만", () => {
    expect(buildAddress("서울", null, null)).toBe("서울");
  });
});
