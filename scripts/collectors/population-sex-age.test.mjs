// @ts-check
/**
 * population-sex-age.mjs 테스트 — 지역명 해석, 성/연령 파싱 검증 (세션 242 W6-A)
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return { ...orig, loadEnv: vi.fn(), getMibuyangSupabase: vi.fn(), getSupabase: vi.fn() };
});

const { resolveRegion, parseGu, parseSexAge, AGE_BUCKETS, pickCanonicalRows } = await import("./population-sex-age.mjs");

describe("resolveRegion", () => {
  it("'서울특별시' → '서울'", () => {
    expect(resolveRegion("서울특별시")).toBe("서울");
  });
  it("'경기도' → '경기'", () => {
    expect(resolveRegion("경기도")).toBe("경기");
  });
  it("null 입력 시 null", () => {
    expect(resolveRegion(null)).toBeNull();
    expect(resolveRegion(undefined)).toBeNull();
    expect(resolveRegion("")).toBeNull();
  });
});

describe("parseGu", () => {
  it("서울 종로구 정상 자리", () => {
    expect(parseGu("서울특별시", "종로구")).toEqual({ region: "서울", gu: "종로구", folded: false });
  });
  it("세종 자리 = gu 무시 후 '세종시' 자리", () => {
    expect(parseGu("세종특별자치시", "")).toEqual({ region: "세종", gu: "세종시", folded: false });
  });
  it("ctpvNm 미상 → null", () => {
    expect(parseGu("미상", "강남구")).toBeNull();
  });
  it("sggNm 빈 자리 (서울/경기 등) → null", () => {
    expect(parseGu("서울특별시", "")).toBeNull();
  });
});

// 세션522 — gu 표기 통일 배선 가드.
// 자매 `population.mjs` 는 세션510부터 여기서 표기를 접는데 이 파일만 빠져 있었다.
// 이 수집기는 UPDATE 가 0행이면 **INSERT 로 행을 만든다** — 표기를 안 접으면 canonical 행 옆에
// sex_age 만 든 별도 행이 생기고 어느 쪽도 온전해 보이지 않는다.
//
// ⚠️ 행동으로 검증한다 — 소스 grep 은 선언부·주석에 걸려 무효가 될 수 있다(세션491).
describe("parseGu — gu 표기 통일 (세션522)", () => {
  it("행안부가 시 이름 없이 준 구를 canonical 로 편다", () => {
    expect(parseGu("경기도", "장안구")).toEqual({ region: "경기", gu: "수원시 장안구", folded: true });
  });

  it("압축형도 canonical 로 접는다", () => {
    expect(parseGu("경기도", "수원장안구")).toEqual({ region: "경기", gu: "수원시 장안구", folded: true });
  });

  it("이미 canonical 이면 그대로 (기존 동작 보존)", () => {
    expect(parseGu("경기도", "수원시 장안구")).toEqual({ region: "경기", gu: "수원시 장안구", folded: false });
  });

  it("광역시 자치구는 손대지 않는다", () => {
    expect(parseGu("서울특별시", "종로구")).toEqual({ region: "서울", gu: "종로구", folded: false });
  });

  it("화성 신설구는 시 단위로 접힌다 — folded 로 표시된다", () => {
    // 별칭표가 화성 4구를 "화성시" 로 접는다(화면 단지가 전부 시 단위 표기라).
    // 이 folded 표시가 없으면 아래 pickCanonicalRows 가 시 값과 구 값을 구분하지 못한다.
    expect(parseGu("경기도", "화성시 효행구")).toEqual({ region: "경기", gu: "화성시", folded: true });
    expect(parseGu("경기도", "화성시")).toEqual({ region: "경기", gu: "화성시", folded: false });
  });
});

// 세션523 — 표기 통일이 **서로 다른 원문을 한 키로 모으는** 자리 가드.
// 행안부는 화성시를 시 단위와 신설 4구로 둘 다 준다. 별칭표가 그 구들을 "화성시" 로 접으므로
// dedup 없이 쓰면 UPDATE 루프가 같은 행을 다섯 번 덮어써 **시 전체 인구구성이 구 하나의 값으로
// 바뀐다** — 로그도 실패 수도 정상이라 사람 눈에 안 띄는 자리다.
describe("pickCanonicalRows — 한 키로 모인 원문 정리 (세션523)", () => {
  /** 성/연령 원본 한 줄. total 만 다르게 줘서 어느 원문이 남았는지 가른다. */
  /** @type {(ctpvNm: string, sggNm: string, total: number) => Record<string, unknown>} */
  const item = (ctpvNm, sggNm, total) => ({
    ctpvNm, sggNm, statsYm: "202606",
    totNmprCnt: String(total), maleNmprCnt: String(total), femlNmprCnt: "0",
  });

  it("시 단위 원문이 있으면 접힌 구 값이 그것을 덮지 않는다", () => {
    const { rows, collapsed } = pickCanonicalRows([
      item("경기도", "화성시 효행구", 100),
      item("경기도", "화성시", 999999),        // 시 전체 — 이게 남아야 한다
      item("경기도", "화성시 동탄구", 200),
      item("경기도", "화성시 만세구", 300),
      item("경기도", "화성시 병점구", 400),
    ], "2026-06-01");
    expect(rows).toHaveLength(1);
    expect(rows[0].gu).toBe("화성시");
    expect(rows[0].sex_age.total).toBe(999999);
    expect(collapsed).toBe(4);
  });

  it("시 단위 원문이 **뒤에** 와도 결과가 같다 (순서에 안 흔들린다)", () => {
    const { rows } = pickCanonicalRows([
      item("경기도", "화성시 효행구", 100),
      item("경기도", "화성시 동탄구", 200),
      item("경기도", "화성시", 999999),
    ], "2026-06-01");
    expect(rows[0].sex_age.total).toBe(999999);
  });

  it("정상 보정(장안구 → 수원시 장안구)은 겹칠 원문이 없어 그대로 살아남는다", () => {
    const { rows, collapsed } = pickCanonicalRows([
      item("경기도", "장안구", 111),
      item("경기도", "권선구", 222),
    ], "2026-06-01");
    expect(rows.map((/** @type {{gu: string}} */ r) => r.gu).sort()).toEqual(["수원시 권선구", "수원시 장안구"]);
    expect(collapsed).toBe(0);
  });

  it("접힌 원문만 여럿이면 경고 대상으로 남긴다 (조용히 틀리지 않게)", () => {
    const { rows, foldedOnly } = pickCanonicalRows([
      item("경기도", "화성시 효행구", 100),
      item("경기도", "화성시 동탄구", 200),
    ], "2026-06-01");
    expect(rows).toHaveLength(1);
    expect(foldedOnly).toEqual(["경기|화성시"]);
  });

  it("접히지 않은 원문끼리 겹치면 기존 동작(나중 것)을 지킨다", () => {
    // 세종은 원래부터 sggNm 이 무엇이든 "세종시" 한 키로 모인다. 이 수정이 그 결과를
    // 조용히 바꾸면 안 되므로 같은 등급끼리는 나중 것이 이기던 옛 동작을 그대로 둔다.
    const { rows } = pickCanonicalRows([
      item("세종특별자치시", "조치원읍", 111),
      item("세종특별자치시", "한솔동", 222),
    ], "2026-06-01");
    expect(rows).toHaveLength(1);
    expect(rows[0].sex_age.total).toBe(222);
  });

  it("인구 0 이하인 원문은 애초에 들어오지 않는다", () => {
    const { rows } = pickCanonicalRows([item("경기도", "화성시", 0)], "2026-06-01");
    expect(rows).toHaveLength(0);
  });
});

describe("parseSexAge", () => {
  // sample 응답 박제 (서울 종로구, 202602)
  const sample = {
    stdgCd: "1111000000",
    ctpvNm: "서울특별시",
    sggNm: "종로구",
    statsYm: "202602",
    totNmprCnt: "136764",
    maleNmprCnt: "65495",
    femlNmprCnt: "71269",
    male0AgeNmprCnt: "2577",
    male10AgeNmprCnt: "4480",
    male20AgeNmprCnt: "9313",
    male30AgeNmprCnt: "9859",
    male40AgeNmprCnt: "8671",
    male50AgeNmprCnt: "11170",
    male60AgeNmprCnt: "10458",
    male70AgeNmprCnt: "5861",
    male80AgeNmprCnt: "2704",
    male90AgeNmprCnt: "391",
    male100AgeNmprCnt: "11",
    feml0AgeNmprCnt: "2464",
    feml10AgeNmprCnt: "4702",
    feml20AgeNmprCnt: "10782",
    feml30AgeNmprCnt: "9927",
    feml40AgeNmprCnt: "9420",
    feml50AgeNmprCnt: "11604",
    feml60AgeNmprCnt: "10521",
    feml70AgeNmprCnt: "6819",
    feml80AgeNmprCnt: "4160",
    feml90AgeNmprCnt: "846",
    feml100AgeNmprCnt: "24",
  };

  it("totalMale/totalFeml/total 자리 정확 자리", () => {
    const b = parseSexAge(sample);
    expect(b.totalMale).toBe(65495);
    expect(b.totalFeml).toBe(71269);
    expect(b.total).toBe(136764);
    expect(b.statsYm).toBe("202602");
  });

  it("male/feml 11 연령대 (age0~age100) 자리 채움", () => {
    const b = parseSexAge(sample);
    expect(Object.keys(b.male)).toHaveLength(AGE_BUCKETS.length);
    expect(Object.keys(b.feml)).toHaveLength(AGE_BUCKETS.length);
    expect(b.male.age0).toBe(2577);
    expect(b.male.age50).toBe(11170);
    expect(b.male.age100).toBe(11);
    expect(b.feml.age40).toBe(9420);
    expect(b.feml.age100).toBe(24);
  });

  it("연령대 합산 = totalMale 자리 검증", () => {
    const b = parseSexAge(sample);
    const sumMale = Object.values(b.male).reduce((s, n) => s + n, 0);
    expect(sumMale).toBe(b.totalMale);
  });

  it("필드 누락 자리 = 0 fallback", () => {
    const partial = /** @type {Record<string, unknown>} */ ({
      ctpvNm: "서울특별시", sggNm: "종로구", statsYm: "202602",
      totNmprCnt: "100", maleNmprCnt: "50", femlNmprCnt: "50",
      // 연령대 필드 0개 자리
    });
    const b = parseSexAge(partial);
    expect(b.male.age0).toBe(0);
    expect(b.feml.age100).toBe(0);
  });

  it("필드 null/undefined 자리 = 0 fallback", () => {
    const nullish = /** @type {Record<string, unknown>} */ ({
      ctpvNm: "서울", sggNm: "강남구", statsYm: "202602",
      totNmprCnt: null, maleNmprCnt: undefined, femlNmprCnt: "0",
      male0AgeNmprCnt: null,
    });
    const b = parseSexAge(nullish);
    expect(b.total).toBe(0);
    expect(b.totalMale).toBe(0);
    expect(b.male.age0).toBe(0);
  });
});

describe("AGE_BUCKETS", () => {
  it("11 연령대 (0, 10, ..., 100)", () => {
    expect(AGE_BUCKETS).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(AGE_BUCKETS.length).toBe(11);
  });
});
