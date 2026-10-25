import { describe, it, expect } from "vitest";
import zonesJson from "../data/regulation-zones.json" with { type: "json" };
import {
  DEFAULT_PAYMENT_SPLIT,
  DSR_LIMIT_BANK,
  GRANDFATHER_RULES,
  LOAN_RULES_BASIS,
  LOAN_TERM_YEARS,
  STRESS_RATE_LOCAL,
  STRESS_RATE_LOCAL_UNTIL,
  STRESS_RATE_METRO,
  dayAfter,
  earliestIsoDate,
  grandfatherRule,
  isNonHousing,
  kstYearMonth,
  latestIsoDate,
  ltvForPresale,
  moveInStarted,
  normalizeIsoDate,
  normalizeYearMonth,
  shortSido,
  stressAddFor,
} from "./loanRules";

/**
 * 잔금 계획 계산기 규칙 숫자(세션659). 기대값은 상수에서 읽지 않고 **리터럴로 못 박는다** — 상수를 잘못 바꾸면
 * 화면·계산·시험이 함께 따라가며 초록이 되는 "파생 가드" 함정(guards-must-be-mutation-tested 세션514)을 막는다.
 * 출처 = `loanRules.ts` 주석의 원문(금융위 10·15 FAQ · 9·7 FAQ 5-1 · 2026-06-30 보도 FAQ · 금융위원회공고 제2026-362호).
 */
describe("loanRules 상수 — 원문 숫자 그대로", () => {
  it("DSR 40% · 30년 · 스트레스 가산 수도권 3.0 / 지방 0.75 (2026-12-31 까지) · 기본 비율 10·60·30", () => {
    expect(DSR_LIMIT_BANK).toBe(0.4);
    expect(LOAN_TERM_YEARS).toBe(30);
    expect(STRESS_RATE_METRO).toBe(3.0);
    expect(STRESS_RATE_LOCAL).toBe(0.75);
    expect(STRESS_RATE_LOCAL_UNTIL).toBe("2026-12-31");
    expect(DEFAULT_PAYMENT_SPLIT).toEqual({ contract: 10, interim: 60, balance: 30 });
  });

  it("기준일 글자는 한 곳 — '2026년 10월'", () => {
    expect(LOAN_RULES_BASIS).toBe("2026년 10월");
  });

  it("경과규정 표 — 기본 2025-10-15·70% · 7/1 지정 3곳 2026-06-30·70% · 서울 4구 2025-09-07·50%·금액 뚜껑 유지", () => {
    expect(GRANDFATHER_RULES.default).toEqual({
      cutoff: "2025-10-15",
      rate: 0.7,
      eventLabel: "규제지역 지정",
      keepRegulatedCaps: false,
    });
    const g4 = { cutoff: "2025-09-07", rate: 0.5, eventLabel: "규제지역 LTV 강화", keepRegulatedCaps: true };
    const d71 = { cutoff: "2026-06-30", rate: 0.7, eventLabel: "규제지역 지정", keepRegulatedCaps: false };
    expect(GRANDFATHER_RULES.byZone).toEqual({
      "서울 강남구": g4,
      "서울 서초구": g4,
      "서울 송파구": g4,
      "서울 용산구": g4,
      "경기 화성시 동탄구": d71,
      "경기 용인시 기흥구": d71,
      "경기 구리시": d71,
    });
  });

  it("경기 키는 regulation-zones.json 지정 목록에 그대로 있다(표기가 갈리면 빨강)", () => {
    const listed = new Set([...zonesJson["투기과열지구"], ...zonesJson["조정대상지역"]]);
    for (const k of Object.keys(GRANDFATHER_RULES.byZone).filter((k) => k.startsWith("경기 "))) {
      expect(listed.has(k)).toBe(true);
    }
  });
});

describe("날짜 도우미 — new Date(문자열) 없이", () => {
  it("normalizeIsoDate 는 YYYY-MM-DD 만, 월·일 범위 검사", () => {
    expect(normalizeIsoDate("2025-10-15")).toBe("2025-10-15");
    expect(normalizeIsoDate(" 2025-10-15 ")).toBe("2025-10-15");
    expect(normalizeIsoDate("2025-10")).toBeNull();
    expect(normalizeIsoDate("")).toBeNull();
    expect(normalizeIsoDate(null)).toBeNull();
    expect(normalizeIsoDate("2025-13-01")).toBeNull();
    expect(normalizeIsoDate("2025-00-10")).toBeNull();
    expect(normalizeIsoDate("202211-01")).toBeNull();
  });

  it("earliest·latestIsoDate 는 형식이 맞는 것 중 가장 이른·늦은 날", () => {
    expect(earliestIsoDate("2026-06-12", "2021-03-05")).toBe("2021-03-05");
    expect(earliestIsoDate("2026-06", "2026-06-12")).toBe("2026-06-12");
    expect(earliestIsoDate(null, undefined, "")).toBeNull();
    expect(latestIsoDate("2021-03-05", "2026-06-12", "x")).toBe("2026-06-12");
  });

  it("dayAfter — 기준일(전일) → 효력일 · 윤년", () => {
    expect(dayAfter("2025-10-15")).toBe("2025-10-16");
    expect(dayAfter("2025-09-07")).toBe("2025-09-08");
    expect(dayAfter("2026-06-30")).toBe("2026-07-01");
    expect(dayAfter("2024-02-28")).toBe("2024-02-29");
  });

  it("입주월 — 형식 이상은 모름(null), 이번 달보다 앞일 때만 '시작됨', KST 이번 달", () => {
    expect(normalizeYearMonth("2026-09")).toBe("2026-09");
    expect(normalizeYearMonth("202609")).toBe("2026-09");
    expect(normalizeYearMonth("미정")).toBeNull();
    expect(normalizeYearMonth("2026 미정")).toBeNull();
    expect(normalizeYearMonth("2026-13")).toBeNull();
    expect(moveInStarted(["2026-09", null], "2026-10")).toBe(true);
    expect(moveInStarted([null, "202609"], "2026-10")).toBe(true);
    expect(moveInStarted(["2026-10"], "2026-10")).toBe(false); // 이번 달은 아직 아님
    expect(moveInStarted(["미정", undefined], "2026-10")).toBe(false);
    // 2026-10-31 15:30 UTC = KST 11-01 00:30
    expect(kstYearMonth(new Date(Date.UTC(2026, 9, 31, 15, 30)))).toBe("2026-11");
    expect(kstYearMonth(new Date(Date.UTC(2026, 9, 31, 14, 30)))).toBe("2026-10");
  });
});

describe("지역 판정", () => {
  it("shortSido — 긴 표기도 짧은 이름으로(regionGeoMapping 재사용)", () => {
    expect(shortSido("서울특별시")).toBe("서울");
    expect(shortSido("경기도")).toBe("경기");
    expect(shortSido("서울")).toBe("서울");
    expect(shortSido("경기,서울")).toBe("경기");
  });

  it("grandfatherRule — 비규제 없음 · 서울 일반 구 기본 · 4구 9·7 · 서울 구 모름 없음 · 긴 표기도 같다", () => {
    expect(grandfatherRule("normal", "인천", "남동구")).toBeNull();
    expect(grandfatherRule("overheated", "서울", "중구")?.cutoff).toBe("2025-10-15");
    expect(grandfatherRule("overheated", "서울", "송파구")?.cutoff).toBe("2025-09-07");
    expect(grandfatherRule("overheated", "서울특별시", "송파구")?.cutoff).toBe("2025-09-07");
    expect(grandfatherRule("overheated", "서울", "용산구")?.rate).toBe(0.5);
    expect(grandfatherRule("overheated", "서울", null)).toBeNull();
  });

  it("7/1 지정 — 화성시(DB gu 하나) · 기흥구 두 표기 · 구리시는 2026-06-30, 그 밖 경기 규제지역은 기본", () => {
    expect(grandfatherRule("overheated", "경기", "화성시")?.cutoff).toBe("2026-06-30");
    expect(grandfatherRule("overheated", "경기도", "화성시 동탄구")?.cutoff).toBe("2026-06-30");
    expect(grandfatherRule("overheated", "경기", "용인시 기흥구")?.cutoff).toBe("2026-06-30");
    expect(grandfatherRule("overheated", "경기", "기흥구")?.cutoff).toBe("2026-06-30");
    expect(grandfatherRule("overheated", "경기", "구리시")?.cutoff).toBe("2026-06-30");
    expect(grandfatherRule("overheated", "경기", "용인시 수지구")?.cutoff).toBe("2025-10-15");
    expect(grandfatherRule("overheated", "경기", "과천시")?.cutoff).toBe("2025-10-15");
  });

  it("isNonHousing — 오피스텔·상가/업무·생활숙박·지식산업 · 이름 (오) · 아파트·주상복합·도시형은 주택", () => {
    expect(isNonHousing("오피스텔", "빌리브 에이센트")).toBe(true);
    expect(isNonHousing("상가/업무", "x")).toBe(true);
    expect(isNonHousing(null, "동탄역디에트르퍼스티지(오)")).toBe(true);
    expect(isNonHousing(null, "OO 생활숙박시설")).toBe(true);
    expect(isNonHousing("아파트", "디에이치방배")).toBe(false);
    expect(isNonHousing("주상복합", "상봉 센트럴 아이파크")).toBe(false);
    expect(isNonHousing("도시형생활주택", "x")).toBe(false);
    expect(isNonHousing(null, null)).toBe(false);
  });
});

describe("ltvForPresale — 큰 숫자는 지금 규정, 종전은 따로 (대조군 · 라이브 apartments.json 2026-10-25)", () => {
  it("비규제 ah-2022910270 인천 남동구 4억 6,268만 → 지금 70% = 3억 2,388만 · 종전 없음", () => {
    const r = ltvForPresale({ price: 46268, zone: "normal", region: "인천", gu: "남동구", firstDate: "2022-07-08" });
    expect(r).toEqual({ current: { amount: 32388, rate: 0.7 }, grandfathered: null });
  });

  it("중구 ah-2021910042 3억 8,850만 · 첫 공고 2021-05-04 → 지금 40% = 1억 5,540만 · 종전 70% 2억 7,195만", () => {
    const r = ltvForPresale({
      price: 38850,
      zone: "overheated",
      region: "서울",
      gu: "중구",
      firstDate: "2021-05-04",
      latestDate: "2022-12-19",
    });
    expect(r.current).toEqual({ amount: 15540, rate: 0.4 });
    expect(r.grandfathered).toEqual({
      rate: 0.7,
      amount: 27195,
      cutoff: "2025-10-15",
      effectiveDate: "2025-10-16",
      eventLabel: "규제지역 지정",
      firstDate: "2021-05-04",
      latestDate: "2022-12-19",
    });
  });

  it("송파 ah-2022930012 9억 4,085만 · 2019-08-19 → 지금 3억 7,634만 · 종전 50% 4억 7,043만(반올림)", () => {
    const r = ltvForPresale({
      price: 94085,
      zone: "overheated",
      region: "서울",
      gu: "송파구",
      firstDate: "2019-08-19",
    });
    expect(r.current.amount).toBe(37634);
    expect(r.grandfathered?.amount).toBe(47043);
    expect(r.grandfathered?.effectiveDate).toBe("2025-09-08");
    expect(r.grandfathered?.eventLabel).toBe("규제지역 LTV 강화");
  });

  it("서초 ap-6021215 15억 1,440만 · 2024-08-16 → 지금 4억 · 종전 50% 도 15억 초과 4억 뚜껑 → 같은 값", () => {
    const r = ltvForPresale({
      price: 151440,
      zone: "overheated",
      region: "서울",
      gu: "서초구",
      firstDate: "2024-08-16",
    });
    expect(r.current.amount).toBe(40000);
    expect(r.grandfathered?.amount).toBe(40000);
  });

  it("강북 ah-2022910077 9억 4,573만 — 큰 숫자는 첫 공고와 상관없이 3억 7,829만 · 종전(2021 첫 공고)은 6억", () => {
    const r = ltvForPresale({
      price: 94573,
      zone: "overheated",
      region: "서울",
      gu: "강북구",
      firstDate: "2021-03-05",
      latestDate: "2026-06-12",
    });
    expect(r.current.amount).toBe(37829);
    expect(r.grandfathered?.amount).toBe(60000);
    expect(r.grandfathered?.latestDate).toBe("2026-06-12");
    const late = ltvForPresale({
      price: 94573,
      zone: "overheated",
      region: "서울",
      gu: "강북구",
      firstDate: "2026-06-12",
    });
    expect(late).toEqual({ current: { amount: 37829, rate: 0.4 }, grandfathered: null });
  });

  it("7/1 지정 화성시 4억 3,535만 · 2026-03-06 → 종전 70% 3억 474만", () => {
    const r = ltvForPresale({
      price: 43535,
      zone: "overheated",
      region: "경기",
      gu: "화성시",
      firstDate: "2026-03-06",
    });
    expect(r.current.amount).toBe(17414);
    expect(r.grandfathered?.amount).toBe(30474);
    expect(r.grandfathered?.effectiveDate).toBe("2026-07-01");
  });

  it("기준일 당일은 종전 있음(≤ 포함) · 다음날은 없음 — 기본·7/1·4구", () => {
    const at = (region: string, gu: string, d: string) =>
      ltvForPresale({ price: 50000, zone: "overheated", region, gu, firstDate: d }).grandfathered != null;
    expect(at("서울", "중구", "2025-10-15")).toBe(true);
    expect(at("서울", "중구", "2025-10-16")).toBe(false);
    expect(at("경기", "구리시", "2026-06-30")).toBe(true);
    expect(at("경기", "구리시", "2026-07-01")).toBe(false);
    expect(at("서울", "강남구", "2025-09-07")).toBe(true);
    expect(at("서울", "강남구", "2025-09-08")).toBe(false);
  });

  it("공고일 형식 이상('2025-10'·''·null)은 종전 없음", () => {
    for (const d of ["2025-10", "", null]) {
      expect(
        ltvForPresale({ price: 50000, zone: "overheated", region: "서울", gu: "중구", firstDate: d }).grandfathered
      ).toBeNull();
    }
  });
});

describe("stressAddFor — 수도권 또는 규제지역 3.0, 지방 비규제 0.75", () => {
  it("네 갈래 — 규제·지방 가짜 값도 3.0(규제지역 조건을 지우면 빨강)", () => {
    expect(stressAddFor("normal", "부산")).toBe(0.75);
    expect(stressAddFor("normal", "인천")).toBe(3.0);
    expect(stressAddFor("overheated", "서울")).toBe(3.0);
    expect(stressAddFor("overheated", "부산")).toBe(3.0);
  });
});
