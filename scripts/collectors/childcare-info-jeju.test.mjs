// @ts-check
/**
 * childcare-info-jeju.mjs 테스트 — cpmsapi017 제주 전용 매핑 + listJejuSgg
 * (parseChildcareXml / extractTag / assertNoErrorCode / aggregateChildcare 는
 *  childcare-info.test.mjs 답습 자산 박힘 — 본 test 미답습)
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import path from "path";

vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return { ...orig, loadEnv: vi.fn(), getSupabase: vi.fn() };
});

const { JEJU_ARCODE_MAP, listJejuSgg } = await import("./childcare-info-jeju.mjs");

describe("JEJU_ARCODE_MAP", () => {
  it("제주시 = 49110 (raw API 실측 박힘)", () => {
    expect(JEJU_ARCODE_MAP["제주시"]).toBe("49110");
  });

  it("서귀포시 = 49130 (raw API 실측 박힘)", () => {
    expect(JEJU_ARCODE_MAP["서귀포시"]).toBe("49130");
  });

  it("정확히 2 entries (제주시 + 서귀포시)", () => {
    expect(Object.keys(JEJU_ARCODE_MAP)).toHaveLength(2);
  });

  it("arcode 5자 형식 (49xxx 체계)", () => {
    for (const arcode of Object.values(JEJU_ARCODE_MAP)) {
      expect(arcode).toMatch(/^49\d{3}$/);
    }
  });
});

describe("listJejuSgg", () => {
  it("2 entries 반환", () => {
    expect(listJejuSgg()).toHaveLength(2);
  });

  it("region = '제주' 고정", () => {
    const list = listJejuSgg();
    for (const sgg of list) {
      expect(sgg.region).toBe("제주");
    }
  });

  it("제주시 entry = arcode 49110", () => {
    const list = listJejuSgg();
    const jejuSi = list.find(s => s.gu === "제주시");
    expect(jejuSi).toBeDefined();
    expect(jejuSi?.arcode).toBe("49110");
  });

  it("서귀포시 entry = arcode 49130", () => {
    const list = listJejuSgg();
    const seogwipo = list.find(s => s.gu === "서귀포시");
    expect(seogwipo).toBeDefined();
    expect(seogwipo?.arcode).toBe("49130");
  });

  it("법정동 코드 (50110/50130) 미박힘 (cpmsapi017 = 49xxx 체계)", () => {
    const list = listJejuSgg();
    for (const sgg of list) {
      expect(sgg.arcode).not.toMatch(/^50/);
    }
  });
});

// ── regions 조회 배선 — selectAll keyCol + 명시적 정렬 (세션566, childcare-info.mjs 답습) ──
// pickLatestPerKey 는 순서 무관하게 안전해 정렬 삭제가 행동 뮤테이션으로 안 잡힌다(childcare-info.mjs
// 뮤테이션 실측 답습). 정렬 배선 자체는 소스 grep 으로 지킨다(좌변까지 고정).
describe("regions 조회 배선 — selectAll keyCol + 명시적 재정렬", () => {
  const src = readFileSync(path.join(process.cwd(), "scripts/collectors/childcare-info-jeju.mjs"), "utf8");

  it("selectAll 에 keyCol \"id\" 를 넘긴다 (무정렬 select 는 2,359행 표에서 1,000행만 매칭한다)", () => {
    expect(src).toMatch(
      /allRegions = [\s\S]{0,40}await selectAll\(\(s\) => s\.from\("regions"\)\.select\("id, region, gu, recorded_at, childcare"\), sb, "id"\)/,
    );
  });

  it("selectAll 결과를 recorded_at 내림차순으로 재정렬한 뒤 pickLatestPerKey 에 넘긴다", () => {
    expect(src).toMatch(/allRegions = allRegions\.slice\(\)\.sort\(/);
    expect(src).toMatch(/const latestMap = pickLatestPerKey\(allRegions/);
  });

  it("조회 실패는 throw (regions 없이는 어느 행도 갱신 못 하므로 fail-open 불가)", () => {
    expect(src).toMatch(/throw new Error\(`regions 조회 실패: /);
  });
});
