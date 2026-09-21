// @ts-check
import { describe, it, expect } from "vitest";
import { findOrphanKeys, classifyOrphan, buildIndexes, tally, SIDO_IS_CITY } from "./fix-orphan-trade-regions.mjs";

/**
 * 같은 행을 n 개 만든다.
 * @param {number} n
 * @param {Record<string, any>} o
 */
const rep = (n, o) => Array(n).fill(0).map(() => ({ ...o }));

describe("findOrphanKeys — apartments 에 없는 조합만 고아", () => {
  it("정상 조합은 고아가 아니다", () => {
    const orphans = findOrphanKeys(
      [{ region: "인천", gu: "서해구" }],
      [{ region: "인천", gu: "서해구" }],
    );
    expect([...orphans]).toEqual([]);
  });

  it("apartments 에 없는 조합은 고아", () => {
    const orphans = findOrphanKeys(
      [{ region: "인천", gu: "서구" }],
      [{ region: "인천", gu: "서해구" }],
    );
    expect([...orphans]).toEqual(["인천|서구"]);
  });

  // ⚠️ 뮤테이션 대상 — SIDO_IS_CITY 를 비우면 red. 세션556 dry-run 1차가 이 가드 없이
  //    세종 거래 972건을 강원 원주시·경북 경산시로 옮기려 했다(반곡동·대평동 동명이의).
  it("세종은 apartments.gu 가 null 이라 조합이 없지만 고아가 아니다", () => {
    const orphans = findOrphanKeys(
      [{ region: "세종", gu: "세종시" }, { region: "세종", gu: "아무거나" }],
      [{ region: "세종", gu: null }],
    );
    expect([...orphans]).toEqual([]);
    expect(SIDO_IS_CITY.has("세종")).toBe(true);
  });
});

describe("tally", () => {
  it("최상위와 독점률을 센다", () => {
    const t = tally(["A", "A", "A", "B"]);
    expect(t.top).toBe("A");
    expect(t.topCount).toBe(3);
    expect(t.total).toBe(4);
    expect(t.dominance).toBeCloseTo(0.75);
  });
  it("빈 입력은 top=null", () => {
    expect(tally([]).top).toBeNull();
  });
});

describe("classifyOrphan — 시도를 건너뛰는 이동", () => {
  // ⚠️ 뮤테이션 대상 — `if (inFromSido > 0 || aptInFromSido > 0)` 를 `if (false)` 로 바꾸면 red.
  //    세종 가드와 **서로 다른 것을 막는 이중 방어**다: 세종 가드는 세종만, 이 가드는
  //    "그 동이 출발 시도에도 실재하는" 모든 경우를 막는다.
  it("그 동이 출발 시도에도 있으면 막는다 (반곡동 = 세종·원주 양쪽)", () => {
    const trades = [
      ...rep(1393, { region: "강원", gu: "원주시", dong: "반곡동", apt_name: "수루배마을6단지" }),
      ...rep(50, { region: "세종", gu: "세종시", dong: "반곡동", apt_name: "다른단지" }),
    ];
    const idx = buildIndexes(trades, [
      { region: "강원", gu: "원주시", dong: "반곡동" },
      { region: "세종", gu: "세종시", dong: "반곡동" },
    ]);
    const v = classifyOrphan(
      { region: "세종", gu: "세종시", dong: "반곡동", apt_name: null },
      idx,
      new Set(["세종|세종시"]),
    );
    expect(v.verdict).toBe("weak");
    expect(v.to).toBeNull();
  });

  it("그 동이 출발 시도에 없으면 옮긴다 (휘경동 = 대구에 없음)", () => {
    const trades = rep(713, { region: "서울", gu: "동대문구", dong: "휘경동", apt_name: "주공2" });
    const idx = buildIndexes(trades, [{ region: "서울", gu: "동대문구", dong: "휘경동" }]);
    const v = classifyOrphan(
      { region: "대구", gu: "대구", dong: "휘경동", apt_name: null },
      idx,
      new Set(["대구|대구"]),
    );
    expect(v.verdict).toBe("move");
    expect(v.to).toBe("서울|동대문구");
  });

  it("시도를 건너뛰는데 표본이 적으면 막는다", () => {
    const trades = rep(5, { region: "서울", gu: "동대문구", dong: "희귀동", apt_name: null });
    const idx = buildIndexes(trades, []);
    const v = classifyOrphan(
      { region: "대구", gu: "대구", dong: "희귀동", apt_name: null },
      idx,
      new Set(["대구|대구"]),
    );
    expect(v.verdict).toBe("weak");
  });
});

describe("classifyOrphan — 같은 시도 안", () => {
  it("같은 시도 안에서 독점이면 옮긴다 (원당동 = 인천 검단구, 충남 당진은 무시)", () => {
    const trades = [
      ...rep(2310, { region: "인천", gu: "검단구", dong: "원당동", apt_name: null }),
      ...rep(285, { region: "충남", gu: "당진시", dong: "원당동", apt_name: null }),
    ];
    const idx = buildIndexes(trades, [{ region: "인천", gu: "검단구", dong: "원당동" }]);
    const v = classifyOrphan(
      { region: "인천", gu: "서구", dong: "원당동", apt_name: null },
      idx,
      new Set(["인천|서구"]),
    );
    expect(v.verdict).toBe("move");
    expect(v.to).toBe("인천|검단구");
  });

  it("단지 근거가 거래 근거와 어긋나면 옮기지 않는다", () => {
    const trades = rep(100, { region: "인천", gu: "검단구", dong: "어떤동", apt_name: null });
    const idx = buildIndexes(trades, [{ region: "인천", gu: "영종구", dong: "어떤동" }]);
    const v = classifyOrphan(
      { region: "인천", gu: "서구", dong: "어떤동", apt_name: null },
      idx,
      new Set(["인천|서구"]),
    );
    expect(v.verdict).toBe("conflict");
    expect(v.to).toBeNull();
  });
});

describe("classifyOrphan — 시 이름이 빠진 구 표기", () => {
  // ⚠️ 뮤테이션 대상 — suffixMatches 블록을 지우면 red.
  //    목적지 표기가 둘로 갈려(`경남|창원시 의창구` vs `경남|창원시`) 독점 검사에 막히는 자리.
  it("고아 gu 가 정상 조합 gu 의 뒤쪽과 일치하면 시 이름을 붙인다", () => {
    const trades = [
      ...rep(195, { region: "경남", gu: "창원시 의창구", dong: "사화동", apt_name: null }),
      ...rep(132, { region: "경남", gu: "창원시", dong: "사화동", apt_name: null }),
    ];
    const idx = buildIndexes(trades, []);
    const v = classifyOrphan(
      { region: "경남", gu: "의창구", dong: "사화동", apt_name: null },
      idx,
      new Set(["경남|의창구"]),
    );
    expect(v.verdict).toBe("move");
    expect(v.to).toBe("경남|창원시 의창구");
  });

  it("뒤쪽이 일치하는 후보가 여럿이면 옮기지 않는다", () => {
    const trades = [
      ...rep(50, { region: "경남", gu: "창원시 북구", dong: "겹치는동", apt_name: null }),
      ...rep(50, { region: "경남", gu: "포항시 북구", dong: "겹치는동", apt_name: null }),
    ];
    const idx = buildIndexes(trades, []);
    const v = classifyOrphan(
      { region: "경남", gu: "북구", dong: "겹치는동", apt_name: null },
      idx,
      new Set(["경남|북구"]),
    );
    expect(v.verdict).not.toBe("move");
  });
});

describe("classifyOrphan — 단지 이름 근거", () => {
  it("같은 단지명 거래가 몰려 있으면 동보다 우선한다 (학산동 = 포항 vs 울산)", () => {
    const trades = [
      ...rep(152, { region: "경북", gu: "포항시 북구", dong: "학산동", apt_name: "학산 한신더휴 엘리트파크" }),
      ...rep(70, { region: "울산", gu: "중구", dong: "학산동", apt_name: "다른단지" }),
      ...rep(193, { region: "경북", gu: "포항시 북구", dong: "학산동", apt_name: "또다른단지" }),
    ];
    const idx = buildIndexes(trades, []);
    const v = classifyOrphan(
      { region: "경북", gu: "북구", dong: "학산동", apt_name: "학산 한신더휴 엘리트파크" },
      idx,
      new Set(["경북|북구"]),
    );
    expect(v.verdict).toBe("move");
    expect(v.to).toBe("경북|포항시 북구");
  });
});

describe("classifyOrphan — 판정 불가", () => {
  it("dong 이 없으면 nodata", () => {
    const idx = buildIndexes([], []);
    expect(classifyOrphan({ region: "인천", gu: "서구", dong: null, apt_name: null }, idx, new Set()).verdict).toBe("nodata");
  });
  it("그 동을 쓰는 정상 거래가 없으면 nodata", () => {
    const idx = buildIndexes([], []);
    expect(classifyOrphan({ region: "인천", gu: "서구", dong: "없는동", apt_name: null }, idx, new Set()).verdict).toBe("nodata");
  });
  it("고아끼리 서로를 근거로 삼지 않는다", () => {
    // 같은 고아 조합만 있는 동 — 근거가 0 이 되어야 한다
    const trades = rep(100, { region: "인천", gu: "서구", dong: "고아동", apt_name: null });
    const idx = buildIndexes(trades, []);
    const v = classifyOrphan({ region: "인천", gu: "서구", dong: "고아동", apt_name: null }, idx, new Set(["인천|서구"]));
    expect(v.verdict).toBe("nodata");
  });
});
