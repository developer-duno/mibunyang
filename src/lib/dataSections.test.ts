import { describe, it, expect } from "vitest";
import { OVERVIEW_SECTIONS, LOCATION_SECTIONS, PRICE_SECTIONS, PRESALE_SECTIONS, fieldsOf } from "./dataSections";

describe("dataSections hint", () => {
  it("종합·입지·시세 섹션 6개 모두 hint 가 채워져 있다", () => {
    const all = [...OVERVIEW_SECTIONS, ...LOCATION_SECTIONS, ...PRICE_SECTIONS];
    expect(all).toHaveLength(6);
    for (const s of all) {
      expect(typeof s.hint).toBe("string");
      expect((s.hint ?? "").length).toBeGreaterThan(10);
    }
  });

  it("분양 섹션 hint(세션 411)는 그대로 유지된다", () => {
    expect(PRESALE_SECTIONS.every((s) => (s.hint ?? "").length > 10)).toBe(true);
  });
});

// 세션 459 — 수집/점수반영됐으나 손님 데이터 탭에 미노출이던 필드 노출 (표시 전용).
describe("dataSections 노출 필드 (세션 459 표시 공백 메움)", () => {
  const locationFields = LOCATION_SECTIONS.flatMap(fieldsOf);
  const priceFields = PRICE_SECTIONS.flatMap(fieldsOf);
  const presaleFields = PRESALE_SECTIONS.flatMap(fieldsOf);

  it("입지 탭에 조망·일조·소음(view/sunlight/noise) 노출", () => {
    expect(locationFields).toContain("view");
    expect(locationFields).toContain("sunlight");
    expect(locationFields).toContain("noise");
  });

  it("시세 탭에 주택보급률(housingSupplyLevel) 노출", () => {
    expect(priceFields).toContain("housingSupplyLevel");
  });

  it("분양 탭에 계약해제율·신규공급(cancelRatio6m/newSupply) 노출", () => {
    expect(presaleFields).toContain("cancelRatio6m");
    expect(presaleFields).toContain("newSupply");
  });

  it("분양 안전지표 섹션은 hideWhenEmpty 아님(항상 노출 — 청약경쟁 hide 결합 회피)", () => {
    const safety = PRESALE_SECTIONS.find((s) => s.title === "분양 안전지표");
    expect(safety).toBeDefined();
    expect(safety?.hideWhenEmpty).toBeFalsy();
  });
});

/**
 * 세션 487 PR-5 회귀 가드 — 은행·카페·문화시설·약국까지의 **거리** 4종.
 *
 * 수집기는 계속 이 값을 모으고 있었는데 `FIELD_META` 에 엔트리가 없어
 * `LOCATION_SECTIONS` 의 짝이 `null` 이었다. 즉 **손님에게 한 번도 안 보인 자료**다.
 * (실측 채움률 bank 96.7% · cafe 95.3% · culture 97.2% · pharmacy 76.5%)
 *
 * ⚠️ 섹션 목록이 **두 벌**이다 — 여기(`lib/dataSections.ts`, 손님 탭)와
 * `constants/fieldMeta.ts` 의 `FIELD_SECTIONS`(관리자 전수 표). 한쪽만 고치면
 * `fieldMeta.test.js` 의 "hidden 아닌 모든 키가 섹션에 포함" 가드가 잡는다(실제로 잡혔다).
 */
describe("입지 생활인프라 — 개수와 거리를 짝으로 보여준다", () => {
  const infra = LOCATION_SECTIONS.find((s) => s.title.includes("생활인프라"));

  it("생활인프라 섹션이 있다", () => {
    expect(infra).toBeTruthy();
  });

  const PAIRS: Array<[string, string]> = [
    ["pharmacy", "pharmacyDist"],
    ["cafe", "cafeDist"],
    ["culture", "cultureDist"],
    ["bank", "bankDist"],
  ];

  for (const [count, dist] of PAIRS) {
    it(`${count} 는 거리(${dist})와 짝을 이룬다 — 거리가 null 이면 손님이 못 본다`, () => {
      const pair = (infra?.pairs || []).find((p) => p[0] === count);
      expect(pair, `${count} 짝이 없다`).toBeTruthy();
      expect(pair?.[1], `${count} 의 거리 자리가 비어 있다 — 수집한 자료가 화면에 안 나온다`).toBe(dist);
    });
  }

  it("거리 4종이 fieldsOf 결과에 들어온다 (채움률 도넛·hasAny 게이트가 같은 입력을 쓴다)", () => {
    const fields = infra ? fieldsOf(infra) : [];
    for (const [, dist] of PAIRS) expect(fields).toContain(dist);
  });
});
