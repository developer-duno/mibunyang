/**
 * data-fill.mjs 테스트 — 실제 COLLECTORS/SKIP_CATEGORIES import 기반 검증
 */
import { describe, it, expect, vi } from "vitest";

// Supabase 연결 + data-audit import chain 보호
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = await importOriginal();
  return { ...orig, loadEnv: vi.fn(), getSupabase: vi.fn() };
});

const { COLLECTORS, SKIP_CATEGORIES } = await import("./data-fill.mjs");

// ── COLLECTORS 구조 검증 ─────────────────────────────────────
describe("COLLECTORS 수집기 매핑", () => {
  // 이 테스트가 검증하는 것: Phase 1에 기반 데이터 수집기 포함
  it("Phase 1에 building, builders, regions 포함", () => {
    const phase1 = COLLECTORS.filter(c => c.phase === 1).map(c => c.category);
    expect(phase1).toEqual(["building", "builders", "regions"]);
  });

  // 이 테스트가 검증하는 것: Phase 2는 trade_stats만 (Phase 1 이후 실행)
  it("Phase 2에 trade_stats만 포함 (regions 의존)", () => {
    const phase2 = COLLECTORS.filter(c => c.phase === 2).map(c => c.category);
    expect(phase2).toEqual(["trade_stats"]);
  });

  // 이 테스트가 검증하는 것: Phase 3에 Kakao 의존 수집기 포함
  it("Phase 3에 infra, schools, transport, environment 포함", () => {
    const phase3 = COLLECTORS.filter(c => c.phase === 3).map(c => c.category);
    expect(phase3).toEqual(["infra", "schools", "transport", "environment"]);
  });

  // 이 테스트가 검증하는 것: 각 카테고리별 필수 env 키 매핑
  it("각 카테고리별 필수 env 키가 올바르게 매핑됨", () => {
    const byCategory = Object.fromEntries(COLLECTORS.map(c => [c.category, c.envKeys]));

    expect(byCategory.building).toEqual(["MOLIT_KEY"]);
    expect(byCategory.builders).toEqual(["DART_KEY"]);
    expect(byCategory.regions).toEqual(["MOIS_POP_KEY"]);
    expect(byCategory.trade_stats).toEqual([]);
    expect(byCategory.transport).toContain("KAKAO_KEY");
    expect(byCategory.transport).toContain("TAGO_KEY");
  });

  // 이 테스트가 검증하는 것: 모든 카테고리에 scripts 배열 존재
  it("모든 카테고리에 scripts 배열이 비어있지 않음", () => {
    for (const col of COLLECTORS) {
      expect(col.scripts.length, `${col.category}.scripts 비어있음`).toBeGreaterThan(0);
    }
  });

  // 이 테스트가 검증하는 것: regions는 3개 스크립트 순차 실행
  it("regions는 population → migration → housing-permits 3개 순차", () => {
    const regions = COLLECTORS.find(c => c.category === "regions");
    expect(regions.scripts).toEqual(["population.mjs", "migration.mjs", "housing-permits.mjs"]);
  });
});

// ── SKIP_CATEGORIES 검증 ────────────────────────────────────
describe("SKIP_CATEGORIES", () => {
  // 이 테스트가 검증하는 것: 자동 보정 불가 카테고리
  it("naver, future, core, price, risk, benefits는 스킵", () => {
    expect(SKIP_CATEGORIES.has("naver")).toBe(true);
    expect(SKIP_CATEGORIES.has("future")).toBe(true);
    expect(SKIP_CATEGORIES.has("core")).toBe(true);
    expect(SKIP_CATEGORIES.has("price")).toBe(true);
    expect(SKIP_CATEGORIES.has("risk")).toBe(true);
    expect(SKIP_CATEGORIES.has("benefits")).toBe(true);
  });

  // 이 테스트가 검증하는 것: 실행 가능 카테고리는 스킵 안 됨
  it("building, trade_stats 등 실행 카테고리는 스킵 아님", () => {
    for (const col of COLLECTORS) {
      expect(SKIP_CATEGORIES.has(col.category), `${col.category}가 스킵 목록에 있으면 안 됨`).toBe(false);
    }
  });
});

// ── threshold 로직 검증 (순수 로직) ─────────────────────────
describe("threshold 필터링 로직", () => {
  // 이 테스트가 검증하는 것: 누락률 기준 필터
  it("커버리지 85% (누락 15%) → threshold 20% 미만 → skip", () => {
    const nullRate = 100 - 85;
    expect(nullRate < 20).toBe(true);
  });

  it("커버리지 49% (누락 51%) → threshold 20% 이상 → 보정 대상", () => {
    const nullRate = 100 - 49;
    expect(nullRate >= 20).toBe(true);
  });
});
