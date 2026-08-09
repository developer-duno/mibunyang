// @ts-check
/**
 * regulation-seed.mjs 테스트 — 규제지역 순수 함수 검증
 *
 * 대상: buildRegulatedSet, makeRegionKey
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
    ROOT: orig.ROOT,
  };
});

const { buildRegulatedSet, makeRegionKey, isRegulatedArea } = await import("./regulation-seed.mjs");

const { readFileSync } = await import("fs");
const { resolve } = await import("path");
const { ROOT } = await import("./_shared.mjs");
const realZones = JSON.parse(readFileSync(resolve(ROOT, "src/data/regulation-zones.json"), "utf8"));

// ── buildRegulatedSet ─────────────────────────────────────────
describe("buildRegulatedSet", () => {
  it("투기과열지구 + 조정대상지역 → 합산 Set", () => {
    const zones = {
      "투기과열지구": ["서울 강남구", "서울 서초구"],
      "조정대상지역": ["경기 수원시", "서울 강남구"], // 중복
    };
    const result = buildRegulatedSet(zones);
    expect(result.size).toBe(3); // 중복 제거
    expect(result.has("서울 강남구")).toBe(true);
    expect(result.has("경기 수원시")).toBe(true);
  });

  it("빈 zones → 빈 Set", () => {
    const result = buildRegulatedSet({});
    expect(result.size).toBe(0);
  });

  it("한쪽만 있는 경우", () => {
    const zones = { "투기과열지구": ["서울 종로구"] };
    const result = buildRegulatedSet(zones);
    expect(result.size).toBe(1);
    expect(result.has("서울 종로구")).toBe(true);
  });

  it("null 리스트 → 무시", () => {
    const zones = { "투기과열지구": null, "조정대상지역": ["경기 성남시"] };
    const result = buildRegulatedSet(zones);
    expect(result.size).toBe(1);
  });

  it("_guAliases 도 조회 키에 담는다 (DB 표기 흔들림 흡수)", () => {
    const zones = { "투기과열지구": ["경기 성남시 분당구"], "_guAliases": ["경기 분당구"] };
    const result = buildRegulatedSet(zones);
    expect(result.has("경기 성남시 분당구")).toBe(true);
    expect(result.has("경기 분당구")).toBe(true);
  });
});

// ── isRegulatedArea ───────────────────────────────────────────
describe("isRegulatedArea — 실제 regulation-zones.json 기준", () => {
  const regulated = buildRegulatedSet(realZones);

  it("서울은 어느 구든 규제 (시도 단독 폴백 — 없으면 서울 전체가 새어 나간다)", () => {
    for (const gu of ["강남구", "양천구", "노원구", "중랑구", "금천구"]) {
      expect(isRegulatedArea(regulated, "서울", gu)).toBe(true);
    }
  });

  it("경기 12곳 공식 표기 → 규제", () => {
    for (const gu of [
      "과천시", "광명시", "성남시 분당구", "성남시 수정구", "성남시 중원구",
      "수원시 영통구", "수원시 장안구", "수원시 팔달구", "안양시 동안구",
      "용인시 수지구", "의왕시", "하남시",
    ]) {
      expect(isRegulatedArea(regulated, "경기", gu)).toBe(true);
    }
  });

  it("경기 시 이름 없는 DB 표기 → 규제", () => {
    for (const gu of ["분당구", "수정구", "중원구", "영통구", "장안구", "팔달구", "동안구", "수지구"]) {
      expect(isRegulatedArea(regulated, "경기", gu)).toBe(true);
    }
  });

  it("지정 안 된 곳은 규제 아님", () => {
    expect(isRegulatedArea(regulated, "부산", "해운대구")).toBe(false);
    expect(isRegulatedArea(regulated, "경기", "평택시")).toBe(false);
    expect(isRegulatedArea(regulated, "경기", "용인시 처인구")).toBe(false);
    expect(isRegulatedArea(regulated, "경기", "안양시 만안구")).toBe(false);
  });

  it("region 이 비면 폴백이 발동하지 않는다 (빈 문자열이 키로 새지 않게)", () => {
    expect(isRegulatedArea(regulated, null, null)).toBe(false);
    expect(isRegulatedArea(regulated, "", "")).toBe(false);
  });
});

// ── makeRegionKey ─────────────────────────────────────────────
describe("makeRegionKey", () => {
  it("region + gu → '서울 강남구'", () => {
    expect(makeRegionKey("서울", "강남구")).toBe("서울 강남구");
  });

  it("gu null → 'region'만", () => {
    expect(makeRegionKey("세종", null)).toBe("세종");
  });

  it("region null → 'gu'만", () => {
    expect(makeRegionKey(null, "강남구")).toBe("강남구");
  });

  it("모두 null → 빈 문자열", () => {
    expect(makeRegionKey(null, null)).toBe("");
  });

  it("undefined 처리 → null과 동일", () => {
    expect(makeRegionKey(undefined, undefined)).toBe("");
  });
});
