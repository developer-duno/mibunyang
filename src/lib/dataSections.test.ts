import { describe, it, expect } from "vitest";
import { OVERVIEW_SECTIONS, LOCATION_SECTIONS, PRICE_SECTIONS, PRESALE_SECTIONS, fieldsOf } from "./dataSections";
import { DISTANCE_AXES } from "@/constants/distanceAxes";

describe("dataSections hint", () => {
  // 세션 505 에 6 → 5. 입지의 "생활인프라 (반경 1km)" 표를 없앴다(거리 점 그림이 흡수).
  it("종합·입지·시세 섹션 5개 모두 hint 가 채워져 있다", () => {
    const all = [...OVERVIEW_SECTIONS, ...LOCATION_SECTIONS, ...PRICE_SECTIONS];
    expect(all).toHaveLength(5);
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

  // 세션 505 PR-C — 공시가격을 손님 화면에 처음 올린 자리. 표에서 빠지면 수집기·VIEW 가
  // 멀쩡해도 손님은 영영 못 본다(등재가 곧 노출이라 이 한 줄이 도달 가드다).
  it("시세 탭에 공시가격(housingPrice) 노출 + 시세 바로 옆자리", () => {
    expect(priceFields).toContain("housingPrice");
    expect(priceFields.indexOf("housingPrice")).toBe(priceFields.indexOf("nearbyMedian") + 1);
  });

  // 공시가격은 실거래·호가와 잣대가 달라 나란히 놓으면 "셋 중 뭘 믿나" 혼란이 난다.
  // 안내문이 그 차이를 설명하지 않으면 노출 자체가 손님을 헷갈리게 만든다.
  it("시세 탭 안내문이 공시가격이 왜 시세보다 낮은지 설명한다", () => {
    const hint = PRICE_SECTIONS.map((s) => s.hint ?? "").join(" ");
    expect(hint).toContain("공시가격");
    expect(hint).toMatch(/세금/);
    expect(hint).toMatch(/낮은 게 정상/);
  });

  it("분양 탭에 계약해제율(cancelRatio6m) 노출", () => {
    expect(presaleFields).toContain("cancelRatio6m");
  });

  // 세션 505: newSupply 는 지역 시장 추이 차트가 시계열로 그린다 — 한 시점 숫자를 옆에 또 적지 않는다.
  it("신규공급(newSupply)은 표에서 뺐다 (차트가 시계열로 그린다)", () => {
    expect(presaleFields).not.toContain("newSupply");
  });

  it("분양 안전 섹션은 hideWhenEmpty 아님(항상 노출 — 청약경쟁이 비어도 계약해제율은 남는다)", () => {
    const safety = PRESALE_SECTIONS.find((s) => s.title === "분양 안전");
    expect(safety).toBeDefined();
    expect(safety?.hideWhenEmpty).toBeFalsy();
  });

  // 세션 505: PresaleInfo 카드가 그리는 15필드를 표로 또 그리던 "네이버 분양정보" 섹션 폐지
  it("분양 탭에 '네이버 분양정보' 표가 없다 (바로 위 카드와 완전 중복이었다)", () => {
    expect(PRESALE_SECTIONS.map((s) => s.title)).not.toContain("네이버 분양정보");
    expect(presaleFields).not.toContain("presaleMinPrice");
    expect(presaleFields).not.toContain("presaleStage");
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
describe("생활인프라 — 개수와 거리가 한 곳(거리 점 그림)에서 함께 보인다", () => {
  it("생활인프라 표는 없앴다 (같은 값을 그림과 표에서 두 번 읽던 자리)", () => {
    expect(LOCATION_SECTIONS.find((s) => s.title.includes("생활인프라"))).toBeUndefined();
    // 표를 없앤 김에 개수/거리가 통째로 사라지면 안 된다 — 그림이 받아야 진짜 정리다(아래).
  });

  const PAIRS: Array<[string, string]> = [
    ["pharmacy", "pharmacyDist"],
    ["cafe", "cafeDist"],
    ["culture", "cultureDist"],
    ["bank", "bankDist"],
  ];
  const items = DISTANCE_AXES.flatMap((ax) => ax.items);

  for (const [count, dist] of PAIRS) {
    it(`${count} 는 거리(${dist})와 같은 줄에 있다 — 짝이 끊기면 손님이 못 본다`, () => {
      const item = items.find((i) => i.field === dist);
      expect(item, `${dist} 가 그림 축에 없다`).toBeTruthy();
      expect(item?.countField, `${dist} 줄에 개수(${count})가 안 붙었다 — 표를 없앤 만큼 사라진다`).toBe(count);
    });
  }

  it("입지 탭 표에는 이제 개수·거리가 남아 있지 않다 (그림과 겹치지 않는다)", () => {
    const fields = LOCATION_SECTIONS.flatMap(fieldsOf);
    for (const [count, dist] of PAIRS) {
      expect(fields, `${count} 가 표에 남아 그림과 겹친다`).not.toContain(count);
      expect(fields, `${dist} 가 표에 남아 그림과 겹친다`).not.toContain(dist);
    }
    // 그림이 그리는 역까지 거리·경찰관서도 마찬가지
    expect(fields).not.toContain("subwayDist");
    expect(fields).not.toContain("policeDist");
  });

  it("혐오시설 이름 목록은 거리 옆(치안/환경)으로 옮겼다 — 서랍 깊은 곳이 아니라", () => {
    const safety = LOCATION_SECTIONS.find((s) => s.title === "치안/환경");
    const fields = safety ? fieldsOf(safety) : [];
    expect(fields).toContain("noxious");
    expect(fields).toContain("noxiousDist");
  });
});
