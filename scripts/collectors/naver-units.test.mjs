// @ts-check
/**
 * naver-units.mjs 테스트 — 네이버 세대수 보정 순수 함수 검증
 *
 * 대상: cleanName
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
    stringSimilarity: orig.stringSimilarity,
    sleep: vi.fn(),
  };
});

// 환경변수 설정 — 모듈 로드 시 process.exit 방지
process.env.SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "test-service-key";

const { cleanName } = await import("./naver-units.mjs");

// ── cleanName ─────────────────────────────────────────────────
describe("cleanName", () => {
  it("괄호 텍스트 제거", () => {
    expect(cleanName("래미안(1단지)")).toBe("래미안");
  });

  it("여러 괄호 제거", () => {
    expect(cleanName("래미안(1단지)(2차)")).toBe("래미안");
  });

  it("연속 공백 정규화", () => {
    expect(cleanName("래미안  아파트   1차")).toBe("래미안 아파트 1차");
  });

  it("앞뒤 공백 trim", () => {
    expect(cleanName("  래미안  ")).toBe("래미안");
  });

  it("null → 빈 문자열", () => {
    expect(cleanName(null)).toBe("");
  });

  it("undefined → 빈 문자열", () => {
    expect(cleanName(undefined)).toBe("");
  });

  it("빈 문자열 → 빈 문자열", () => {
    expect(cleanName("")).toBe("");
  });

  it("괄호 없는 이름은 그대로", () => {
    expect(cleanName("래미안아파트")).toBe("래미안아파트");
  });
});
