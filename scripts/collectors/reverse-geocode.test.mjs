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

// ── 전남광주통합특별시 (2026-07-01) — 세션545 ─────────────────
describe("normalizeRegion — 통합 시도 분할 (세션545)", () => {
  it("통합 + 순천시 → 전남", () => {
    expect(normalizeRegion("전남광주통합특별시", "순천시")).toBe("전남");
  });

  it("통합 + 북구 → 광주", () => {
    expect(normalizeRegion("전남광주통합특별시", "북구")).toBe("광주");
  });

  it("gu 가 없으면 원문 그대로 — 조용히 한쪽으로 붙이지 않는다", () => {
    expect(normalizeRegion("전남광주통합특별시")).toBe("전남광주통합특별시");
    expect(normalizeRegion("전남광주통합특별시", null)).toBe("전남광주통합특별시");
  });

  it("기존 시도명은 gu 를 넘겨도 회귀 없음", () => {
    expect(normalizeRegion("전라남도", "순천시")).toBe("전남");
    expect(normalizeRegion("경기도", "광주시")).toBe("경기");
  });

  // ⚠️ 배선 가드 — 위 단위 테스트는 함수만 본다. main() 호출부가 `normalizeRegion(region)` 으로
  // 되돌아가면(gu 를 안 넘기면) 함수는 멀쩡한데 통합 시도 행에 원문 "전남광주통합특별시" 가 다시
  // 박힌다(세션545 실측: 6곳). 오케스트레이터 뮤테이션 D 가 이 구간을 green 으로 통과시켜 추가.
  // 좌변(`region =`)까지 고정해 선언부·주석·JSDoc 예시에는 매칭되지 않게 한다.
  it("main() 이 gu 를 함께 넘긴다 — `region = normalizeRegion(region, gu)`", () => {
    const src = readFileSync(new URL("./reverse-geocode.mjs", import.meta.url), "utf8");
    expect(src).toMatch(/^\s*region = normalizeRegion\(region, gu\);/m);
    expect(src).not.toMatch(/^\s*region = normalizeRegion\(region\);/m);
  });
});
