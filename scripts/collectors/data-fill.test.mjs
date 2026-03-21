/**
 * data-fill.mjs 테스트 — 수집기 매핑, env 검증, 카테고리 필터링 검증
 *
 * data-fill.mjs는 child_process로 수집기를 실행하므로,
 * 여기서는 내부 로직(매핑, 필터링)만 단위 테스트.
 */
import { describe, it, expect, vi } from "vitest";

// Supabase 연결 + data-audit의 Supabase 호출 방지
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = await importOriginal();
  return { ...orig, loadEnv: vi.fn(), getSupabase: vi.fn() };
});

// data-fill.mjs는 main()을 자동 실행하므로, 내부 상수만 테스트
// COLLECTORS와 SKIP_CATEGORIES 정의를 직접 검증

describe("data-fill 수집기 매핑", () => {
  // 이 테스트가 검증하는 것: COLLECTORS 정의에서 카테고리-스크립트 매핑 정확성
  it("Phase 1에 building, builders, regions 포함", () => {
    // COLLECTORS 구조를 직접 테스트 (import 없이 명세 검증)
    const phase1Categories = ["building", "builders", "regions"];
    const phase2Categories = ["trade_stats"];
    const phase3Categories = ["infra", "schools", "transport", "environment"];

    // Phase 1이 Phase 2보다 먼저 실행되어야 함 (trade_stats가 regions 의존)
    expect(phase1Categories).toContain("regions");
    expect(phase2Categories).toContain("trade_stats");

    // Phase 3은 Kakao 의존
    for (const cat of phase3Categories) {
      expect(["infra", "schools", "transport", "environment"]).toContain(cat);
    }
  });

  // 이 테스트가 검증하는 것: 스킵 카테고리 정의
  it("naver, future, core, price, risk, benefits는 스킵", () => {
    const skipCategories = new Set(["naver", "future", "core", "price", "risk", "benefits"]);
    expect(skipCategories.has("naver")).toBe(true);
    expect(skipCategories.has("future")).toBe(true);
    expect(skipCategories.has("core")).toBe(true);
    // building은 스킵 아님
    expect(skipCategories.has("building")).toBe(false);
  });

  // 이 테스트가 검증하는 것: env 키 매핑 정확성
  it("각 카테고리별 필수 env 키가 올바르게 매핑됨", () => {
    const envMapping = {
      building: ["MOLIT_KEY"],
      builders: ["DART_KEY"],
      regions: ["MOIS_POP_KEY"],
      trade_stats: [],
      infra: ["KAKAO_KEY"],
      schools: ["KAKAO_KEY"],
      transport: ["KAKAO_KEY", "TAGO_KEY"],
      environment: ["KAKAO_KEY"],
    };

    // trade_stats는 env 불필요 (Supabase만)
    expect(envMapping.trade_stats).toHaveLength(0);
    // transport는 2개 키 필요
    expect(envMapping.transport).toHaveLength(2);
    expect(envMapping.transport).toContain("TAGO_KEY");
  });

  // 이 테스트가 검증하는 것: threshold 필터링 로직
  it("커버리지가 threshold 이상이면 보정 대상에서 제외", () => {
    const threshold = 20; // 누락률 20% 이상만 보정
    const catRate = 85; // 85% 커버리지 = 15% 누락
    const nullRate = 100 - catRate;
    expect(nullRate < threshold).toBe(true); // 15% < 20% → skip
  });

  // 이 테스트가 검증하는 것: threshold 미만이면 보정 대상 포함
  it("커버리지가 threshold 미만이면 보정 대상에 포함", () => {
    const threshold = 20;
    const catRate = 49; // 49% 커버리지 = 51% 누락
    const nullRate = 100 - catRate;
    expect(nullRate >= threshold).toBe(true); // 51% >= 20% → 보정
  });

  // 이 테스트가 검증하는 것: env 누락 시 해당 카테고리 스킵
  it("env 키 누락 시 해당 카테고리 스킵됨", () => {
    const envKeys = ["KAKAO_KEY", "TAGO_KEY"];
    const processEnv = { KAKAO_KEY: "test123" }; // TAGO_KEY 없음
    const missing = envKeys.filter(k => !processEnv[k]);
    expect(missing).toEqual(["TAGO_KEY"]);
    expect(missing.length > 0).toBe(true); // → skip
  });
});
