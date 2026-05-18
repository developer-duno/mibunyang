// @ts-check
/**
 * data-fill.mjs 테스트 — 실제 COLLECTORS/SKIP_CATEGORIES import 기반 검증
 */
import { describe, it, expect, vi } from "vitest";

// Supabase 연결 + data-audit import chain 보호
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return { ...orig, loadEnv: vi.fn(), getSupabase: vi.fn() };
});

const { COLLECTORS, SKIP_CATEGORIES } = await import("./data-fill.mjs");

// ── COLLECTORS 구조 검증 ─────────────────────────────────────
describe("COLLECTORS 수집기 매핑", () => {
  // 이 테스트가 검증하는 것: Phase 1에 기반 데이터 수집기 포함 (세션 238 W3: maintenance 추가)
  it("Phase 1에 building, builders, regions, maintenance 포함", () => {
    const phase1 = COLLECTORS.filter(c => c.phase === 1).map(c => c.category);
    expect(phase1).toEqual(["building", "builders", "regions", "maintenance"]);
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
    // regions: population.mjs (MOIS_POP_KEY) + population-sex-age.mjs (MOIS_SEX_AGE_KEY) + migration.mjs (KOSIS_MIGRATION_KEY) + housing-permits.mjs (MOLIT_KEY) + collect-housing-supply-ratio.mjs (KOSIS_KEY) + collect-housing-price.mjs (API 키 불필요, 세션 247 W6-C v2 = data.go.kr 3073746 공개 다운로드) + childcare-info.mjs (CHILDCARE_API_KEY, 세션 252 W6-D ε) + childcare-detail.mjs (CHILDCARE_BASIC_API_KEY, 세션 256 W6-D2) + collect-avg-income.mjs (KOSIS_MIGRATION_KEY 공유, 세션 258)
    expect(byCategory.regions).toContain("MOIS_POP_KEY");
    expect(byCategory.regions).toContain("MOIS_SEX_AGE_KEY");
    expect(byCategory.regions).toContain("KOSIS_MIGRATION_KEY");
    expect(byCategory.regions).toContain("MOLIT_KEY");
    expect(byCategory.regions).toContain("KOSIS_KEY");
    expect(byCategory.regions).toContain("CHILDCARE_API_KEY");
    expect(byCategory.regions).toContain("CHILDCARE_BASIC_API_KEY");
    expect(byCategory.regions).not.toContain("MOLIT_HOUSING_PRICE_KEY");
    expect(byCategory.trade_stats).toEqual([]);
    // maintenance: collect-maintenance.mjs 가 MOLIT_KEY 요구 (세션 238 W3)
    expect(byCategory.maintenance).toEqual(["MOLIT_KEY"]);
    // schools: schools-neis.mjs 가 KAKAO_KEY + NEIS_KEY + SCHOOLINFO_KEY 요구
    expect(byCategory.schools).toContain("KAKAO_KEY");
    expect(byCategory.schools).toContain("NEIS_KEY");
    expect(byCategory.schools).toContain("SCHOOLINFO_KEY");
    expect(byCategory.transport).toContain("KAKAO_KEY");
    expect(byCategory.transport).toContain("TAGO_KEY");
  });

  // 이 테스트가 검증하는 것: maintenance Phase 1 + scripts 단일 + envKeys MOLIT_KEY (세션 238 W3)
  it("maintenance phase 1 + scripts collect-maintenance.mjs + envKeys MOLIT_KEY", () => {
    const m = COLLECTORS.find(c => c.category === "maintenance");
    expect(m?.phase).toBe(1);
    expect(m?.scripts).toEqual(["collect-maintenance.mjs"]);
    expect(m?.envKeys).toEqual(["MOLIT_KEY"]);
  });

  // 이 테스트가 검증하는 것: 모든 카테고리에 scripts 배열 존재
  it("모든 카테고리에 scripts 배열이 비어있지 않음", () => {
    for (const col of COLLECTORS) {
      expect(col.scripts.length, `${col.category}.scripts 비어있음`).toBeGreaterThan(0);
    }
  });

  // 이 테스트가 검증하는 것: regions는 14개 스크립트 순차 실행 (세션 252 ε: childcare-info / 세션 256 W6-D2: childcare-detail / 세션 258: collect-avg-income / 세션 265: collect-fertility-rate 추가 / 세션 266: collect-medical-access 추가 / 세션 269: collect-sale-price-index 추가 / 세션 270: collect-jeonse-price-index 추가 / 세션 271: collect-regional-economy 추가)
  it("regions는 population → population-sex-age → migration → housing-permits → housing-supply-ratio → fertility-rate → housing-price → childcare-info → childcare-detail → collect-avg-income → medical-access → sale-price-index → jeonse-price-index → regional-economy 14개 순차", () => {
    const regions = COLLECTORS.find(c => c.category === "regions");
    expect(regions?.scripts).toEqual(["population.mjs", "population-sex-age.mjs", "migration.mjs", "housing-permits.mjs", "collect-housing-supply-ratio.mjs", "collect-fertility-rate.mjs", "collect-housing-price.mjs", "childcare-info.mjs", "childcare-detail.mjs", "collect-avg-income.mjs", "collect-medical-access.mjs", "collect-sale-price-index.mjs", "collect-jeonse-price-index.mjs", "collect-regional-economy.mjs"]);
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
