// @ts-check
/**
 * reverse-geocode.mjs 테스트 — 역지오코딩 순수 함수 검증
 *
 * 대상: normalizeRegion
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// _shared.mjs 모킹
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
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

const { normalizeRegion } = await import("./reverse-geocode.mjs");

// ── normalizeRegion ───────────────────────────────────────────
describe("normalizeRegion", () => {
  it("서울특별시 → 서울", () => {
    expect(normalizeRegion("서울특별시")).toBe("서울");
  });

  it("부산광역시 → 부산", () => {
    expect(normalizeRegion("부산광역시")).toBe("부산");
  });

  it("경기도 → 경기", () => {
    expect(normalizeRegion("경기도")).toBe("경기");
  });

  it("세종특별자치시 → 세종", () => {
    expect(normalizeRegion("세종특별자치시")).toBe("세종");
  });

  it("강원특별자치도 → 강원", () => {
    expect(normalizeRegion("강원특별자치도")).toBe("강원");
  });

  it("강원도 → 강원 (구 명칭)", () => {
    expect(normalizeRegion("강원도")).toBe("강원");
  });

  it("전북특별자치도 → 전북", () => {
    expect(normalizeRegion("전북특별자치도")).toBe("전북");
  });

  it("충청북도 → 충북", () => {
    expect(normalizeRegion("충청북도")).toBe("충북");
  });

  it("제주특별자치도 → 제주", () => {
    expect(normalizeRegion("제주특별자치도")).toBe("제주");
  });

  it("매핑에 없는 값 → 원본 반환", () => {
    expect(normalizeRegion("알수없는지역")).toBe("알수없는지역");
  });
});

// ── apartments 조회 selectAll 고유키(id) 커서 회귀 가드 (세션534) ──────
// 무정렬 OFFSET 으로 훑으면 3페이지 경계에서 행이 샌다(unordered-pagination-loses-rows.md §1).
// selectAll(..., sb, "id") 커서 옵트인이 되돌아가지 않게 소스에서 직접 검사.
describe("apartments 고유키(id) 커서 페이징 가드", () => {
  const src = readFileSync(
    fileURLToPath(new URL("./reverse-geocode.mjs", import.meta.url)),
    "utf8",
  );

  it("apartments 조회는 selectAll(..., sb, \"id\") 커서", () => {
    // 호출부를 앵커로 keyCol 캡처 — keyCol 제거·변경 시 red (뮤테이션 대상).
    const m = src.match(
      /selectAll\(\s*\(s\) => \{[\s\S]*?\.from\("apartments"\)[\s\S]*?\},\s*sb,\s*"([^"]+)"/,
    );
    expect(m?.[1]).toBe("id");
  });

  it("apartments 에 무정렬 .range() 오프셋 루프가 남아있지 않음", () => {
    // .from("apartments") 직후 .range( 가 붙으면 옛 offset 페이징이 되살아난 것.
    expect(/\.from\("apartments"\)[\s\S]{0,400}?\.range\(/.test(src)).toBe(false);
  });
});
