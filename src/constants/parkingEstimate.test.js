// @ts-check
// 세션576 D5 — 주차 비율 추정 산식 한 곳(parkingEstimate) + 그 산식을 쓰는 두 화면(점수 탭·종합 탭).
// ⚠️ 뮤테이션 대상 — 헬퍼 상한 `<= 3` 을 `<= 30` 으로 풀면 오염 클램프 시험(293.6·4.17)이 red 여야 한다.
import { describe, it, expect } from "vitest";
import { estimateParkingRatio } from "./parkingEstimate";
import { FIELD_META } from "./fieldMeta";
import { calcCats } from "@/scoring/engine";

describe("estimateParkingRatio — 주차대수 / max(총세대, 일반분양, 1), 0 < r <= 3 만", () => {
  it("유효한 추정치는 그 값을 돌려준다", () => {
    const a = estimateParkingRatio(825, 589, null);
    expect(a).toBe(825 / 589);
    expect(a?.toFixed(2)).toBe("1.40");
    // 분모는 총세대와 일반분양 중 큰 쪽 — 1543 / max(107, 768)
    const b = estimateParkingRatio(1543, 107, 768);
    expect(b).toBe(1543 / 768);
    expect(b?.toFixed(2)).toBe("2.01");
  });

  it("0 은 원천 미기재라 null", () => {
    expect(estimateParkingRatio(0, 500, null)).toBeNull();
  });

  it("3 초과(총세대 오염 자리)는 null", () => {
    expect(estimateParkingRatio(1468, 5, 102)).toBeNull(); // 1468/102 = 14.39… (총세대 5 오염)
    expect(estimateParkingRatio(1468, 5, null)).toBeNull(); // 1468/5 = 293.6
    expect(estimateParkingRatio(413, 99, 99)).toBeNull(); // 4.17
  });

  it("주차대수가 없으면 null", () => {
    expect(estimateParkingRatio(null, 500, null)).toBeNull();
    expect(estimateParkingRatio(undefined, 500, 300)).toBeNull();
  });
});

describe("fieldMeta presaleParking — 0 은 미수집 (D5)", () => {
  const fmt = FIELD_META.presaleParking.fmt;
  it("0·null 은 '미수집', 값이 있으면 천 단위 쉼표", () => {
    expect(fmt(0)).toBe("미수집");
    expect(fmt(null)).toBe("미수집");
    expect(fmt(1543)).toBe("1,543대");
  });
});

describe("fieldMeta parkingRatio — 실측이 없으면 점수 탭과 같은 추정치 (D5)", () => {
  const fmt = FIELD_META.parkingRatio.fmt;
  it("parkingRatio null + 추정 가능 → '추정 1.40대/세대'", () => {
    expect(fmt(null, { presaleParking: 825, units: 589 })).toBe("추정 1.40대/세대");
    expect(fmt(null, { presaleParking: 1543, units: 107, presaleGeneralSupply: 768 })).toBe("추정 2.01대/세대");
  });

  it("추정 불가(오염 클램프·0)·apt 없음 → 지금 그대로 '—'", () => {
    expect(fmt(null, { presaleParking: 1468, units: 5, presaleGeneralSupply: 102 })).toBe("—");
    expect(fmt(null, { presaleParking: 413, units: 99, presaleGeneralSupply: 99 })).toBe("—");
    expect(fmt(null, { presaleParking: 0, units: 500 })).toBe("—");
    expect(fmt(null)).toBe("—");
  });

  it("실측값이 있으면 추정하지 않고 그대로", () => {
    expect(fmt(1.49)).toBe("1.49대/세대");
    expect(fmt(1.49, { parkingRatio: 1.49, presaleParking: 0, units: 500 })).toBe("1.49대/세대");
  });

  it("종합 탭 문구 = 점수 탭(calcCats 상품성 주차) 문구 — 같은 산식을 지난다", () => {
    const apt = { parkingRatio: null, presaleParking: 825, units: 589 };
    const park = /** @type {any} */ (calcCats(/** @type {any} */ (apt)).product.subs.find((s) => s.name === "주차"));
    expect(fmt(null, apt)).toBe(park.info);
  });
});

// 리팩터(scoreProduct 가 헬퍼를 부르게 한 것) 전후로 점수 값·문구가 바이트 단위로 같아야 한다.
//   아래 기대값은 **리팩터 전 코드**로 같은 입력을 calcCats 에 넣어 떠 둔 값이다(2026-09-26, 세션576).
describe("scoreProduct 주차 항목 — 헬퍼 리팩터 전후 동일 (D5)", () => {
  const base = {
    id: 1,
    name: "t",
    region: "경기",
    gu: "수원시",
    builder: "현대건설",
    completion: "202506",
    price: 50000,
    area: 84,
  };
  /** @param {Record<string, unknown>} o */
  const run = (o) => {
    const p = calcCats(/** @type {any} */ ({ ...base, ...o }), {}).product;
    const s = /** @type {any} */ (p.subs.find((x) => x.name === "주차"));
    return { total: p.total, score: s.score, info: s.info, detail: s.detail };
  };

  it("유효 추정 2곳 + 오염 클램프 1곳 + 0 1곳 + 실측 1곳", () => {
    expect(run({ parkingRatio: null, presaleParking: 825, units: 589 })).toEqual({
      total: 67,
      score: 12,
      info: "추정 1.40대/세대",
      detail: "추정 1.40대/세대 (청약 공급자료 기반 추정 · 우수 1.5↑, 양호 1.3↑, 보통 1.1↑)",
    });
    expect(run({ parkingRatio: null, presaleParking: 1543, units: 107, presaleGeneralSupply: 768 })).toEqual({
      total: 67,
      score: 15,
      info: "추정 2.01대/세대",
      detail: "추정 2.01대/세대 (청약 공급자료 기반 추정 · 우수 1.5↑, 양호 1.3↑, 보통 1.1↑)",
    });
    expect(run({ parkingRatio: null, presaleParking: 1468, units: 5, presaleGeneralSupply: 102 })).toEqual({
      total: 60,
      score: 8,
      info: "정보 없음",
      detail: "미수집 (기준: 1.5↑우수, 1.3↑양호, 1.1↑보통 · 중립 8점)",
    });
    expect(run({ parkingRatio: null, presaleParking: 0, units: 500 })).toEqual({
      total: 63,
      score: 8,
      info: "정보 없음",
      detail: "미수집 (기준: 1.5↑우수, 1.3↑양호, 1.1↑보통 · 중립 8점)",
    });
    expect(run({ parkingRatio: 1.49, presaleParking: 0, units: 500 })).toEqual({
      total: 67,
      score: 12,
      info: "1.49대/세대",
      detail: "1.49대/세대 (우수 1.5↑, 양호 1.3↑, 보통 1.1↑)",
    });
  });
});
