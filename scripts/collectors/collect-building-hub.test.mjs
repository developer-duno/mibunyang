import { describe, it, expect } from "vitest";

// collect-building-hub.mjs의 makeLotParams 로직 재현 (순수 함수 테스트)
// 이 테스트가 검증하는 것: 지번 파라미터 생성 + 에너지 집계 + 타입 변환의 정확성

function makeLotParams(bjdCode, lotMain, lotSub) {
  return {
    sigunguCd: bjdCode.slice(0, 5),
    bjdongCd: bjdCode.slice(5, 10),
    bun: String(lotMain ?? 0).padStart(4, "0"),
    ji: String(lotSub ?? 0).padStart(4, "0"),
  };
}

// quakeDesign 타입 변환 ("1"/"Y"/true → boolean)
function parseQuakeDesign(val) {
  if (val === "0" || val === "N" || val === false || val === "미적용") return false;
  if (val === "1" || val === "Y" || val === true || val === "적용") return true;
  return null;
}

// energy MAX 집계
function aggregateEnergy(items) {
  if (!items || items.length === 0) return null;
  const max = Math.max(...items.map(i => parseFloat(i.useQty) || 0));
  return max === 0 ? null : max;
}

// heatFuel MODE 집계
function aggregateHeatFuel(items) {
  if (!items || items.length === 0) return null;
  const counts = {};
  for (const item of items) {
    const fuel = item.heatMethCdNm || item.fuelCdNm || null;
    if (fuel) counts[fuel] = (counts[fuel] || 0) + 1;
  }
  const entries = Object.entries(counts);
  return entries.length > 0 ? entries.sort((a, b) => b[1] - a[1])[0][0] : null;
}

describe("makeLotParams — 지번 파라미터 생성", () => {
  it("정상 10자리 법정동코드 분할", () => {
    const p = makeLotParams("1168010100", 123, 4);
    expect(p.sigunguCd).toBe("11680");
    expect(p.bjdongCd).toBe("10100");
    expect(p.bun).toBe("0123");
    expect(p.ji).toBe("0004");
  });

  it("부번 없음 (0) → '0000'", () => {
    const p = makeLotParams("1168010100", 456, 0);
    expect(p.ji).toBe("0000");
  });

  it("부번 null → '0000'", () => {
    const p = makeLotParams("1168010100", 456, null);
    expect(p.ji).toBe("0000");
  });

  it("본번 null → '0000'", () => {
    const p = makeLotParams("1168010100", null, 0);
    expect(p.bun).toBe("0000");
  });
});

describe("parseQuakeDesign — 내진설계 타입 변환", () => {
  it('"1" → true', () => expect(parseQuakeDesign("1")).toBe(true));
  it('"Y" → true', () => expect(parseQuakeDesign("Y")).toBe(true));
  it('"적용" → true', () => expect(parseQuakeDesign("적용")).toBe(true));
  it('true → true', () => expect(parseQuakeDesign(true)).toBe(true));
  it('"0" → false', () => expect(parseQuakeDesign("0")).toBe(false));
  it('"N" → false', () => expect(parseQuakeDesign("N")).toBe(false));
  it('"미적용" → false', () => expect(parseQuakeDesign("미적용")).toBe(false));
  it('null → null', () => expect(parseQuakeDesign(null)).toBeNull());
  it('undefined → null', () => expect(parseQuakeDesign(undefined)).toBeNull());
});

describe("aggregateEnergy — MAX 집계", () => {
  it("복수 건물 → 최대값", () => {
    expect(aggregateEnergy([{ useQty: "100" }, { useQty: "250" }, { useQty: "180" }])).toBe(250);
  });

  it("단일 건물", () => {
    expect(aggregateEnergy([{ useQty: "420" }])).toBe(420);
  });

  it("빈 배열 → null", () => {
    expect(aggregateEnergy([])).toBeNull();
  });

  it("모든 값 0 → null", () => {
    expect(aggregateEnergy([{ useQty: "0" }, { useQty: "0" }])).toBeNull();
  });

  it("유효하지 않은 값 → 0 처리", () => {
    expect(aggregateEnergy([{ useQty: "abc" }, { useQty: "150" }])).toBe(150);
  });
});

describe("aggregateHeatFuel — MODE 집계", () => {
  it("최빈값 반환", () => {
    const items = [
      { heatMethCdNm: "도시가스" },
      { heatMethCdNm: "도시가스" },
      { heatMethCdNm: "LPG" },
    ];
    expect(aggregateHeatFuel(items)).toBe("도시가스");
  });

  it("단일 값", () => {
    expect(aggregateHeatFuel([{ fuelCdNm: "지역난방" }])).toBe("지역난방");
  });

  it("빈 배열 → null", () => {
    expect(aggregateHeatFuel([])).toBeNull();
  });

  it("모든 값 null → null", () => {
    expect(aggregateHeatFuel([{ heatMethCdNm: null }, {}])).toBeNull();
  });
});
