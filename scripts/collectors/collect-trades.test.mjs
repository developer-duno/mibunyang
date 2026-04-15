/**
 * collect-trades.mjs 테스트 — 법정동코드 조회, XML 파싱 검증
 */
import { describe, it, expect, vi } from "vitest";

// loadEnv + 외부 API 호출 방지
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = await importOriginal();
  return { ...orig, loadEnv: vi.fn(), getMibuyangSupabase: vi.fn(), getSupabase: vi.fn() };
});

const { getLawdCd, extractItems, getTag, TRADE_CONFIGS, buildApiUrl, parseOnlyFilter } = await import("./collect-trades.mjs");

describe("parseOnlyFilter (세션94 단계 C)", () => {
  it("--only=경기:화성시 → '경기:화성시'", () => {
    expect(parseOnlyFilter(["node", "collect-trades.mjs", "--only=경기:화성시"])).toBe("경기:화성시");
  });
  it("플래그 없음 → null", () => {
    expect(parseOnlyFilter(["node", "collect-trades.mjs", "--months=6"])).toBeNull();
  });
  it(":누락 시 throw (9 GATE 5 해소)", () => {
    expect(() => parseOnlyFilter(["node", "collect-trades.mjs", "--only=경기"])).toThrow(/형식 오류/);
  });
});

describe("getLawdCd", () => {
  // 정상 매핑 — 중첩 구조 region 내 직접 조회
  it("서울 강남구 → 11680", () => {
    expect(getLawdCd("서울", "강남구")).toBe("11680");
  });

  // 경기도 시군구 — region 내 직접 조회
  it("경기 화성시 → 41591", () => {
    expect(getLawdCd("경기", "화성시")).toBe("41591");
  });

  // 동명이구 — 부산 해운대구 (중첩 구조로 정확한 매칭)
  it("부산 해운대구 → 26350", () => {
    expect(getLawdCd("부산", "해운대구")).toBe("26350");
  });

  // 존재하지 않는 시군구 → 시도 prefix + "000" fallback
  it("서울의 미지 구는 시도 코드 '11000'을 반환한다", () => {
    expect(getLawdCd("서울", "없는구")).toBe("11000");
  });

  // 완전 미지 지역 → null
  it("존재하지 않는 시도는 null을 반환한다", () => {
    expect(getLawdCd("미지시도", "미지구")).toBeNull();
  });
});

describe("extractItems", () => {
  // 정상 XML에서 item 추출
  it("XML에서 item 요소를 추출한다", () => {
    const xml = `
      <response><body><items>
        <item><거래금액>50000</거래금액><건축년도>2020</건축년도></item>
        <item><거래금액>60000</거래금액><건축년도>2021</건축년도></item>
      </items></body></response>`;
    const items = extractItems(xml);
    expect(items).toHaveLength(2);
    expect(items[0]).toContain("50000");
  });

  // 빈 XML
  it("item이 없는 XML은 빈 배열을 반환한다", () => {
    expect(extractItems("<response><body></body></response>")).toEqual([]);
  });

  // 빈 문자열
  it("빈 문자열은 빈 배열을 반환한다", () => {
    expect(extractItems("")).toEqual([]);
  });
});

describe("getTag", () => {
  const item = "<item><거래금액>50000</거래금액><건축년도>2020</건축년도></item>";

  // 정상 태그 추출
  it("지정 태그의 값을 추출한다", () => {
    expect(getTag(item, "거래금액")).toBe("50000");
    expect(getTag(item, "건축년도")).toBe("2020");
  });

  // 존재하지 않는 태그
  it("존재하지 않는 태그는 빈 문자열을 반환한다", () => {
    expect(getTag(item, "없는태그")).toBe("");
  });

  // 공백 포함 값은 trim
  it("태그 값의 앞뒤 공백을 제거한다", () => {
    const item2 = "<item><거래금액>  50000  </거래금액></item>";
    expect(getTag(item2, "거래금액")).toBe("50000");
  });
});

describe("AptTradeDev XML 파싱", () => {
  // AptTradeDev API 응답의 신규 필드 파싱 검증
  const devItem = `<item><aptNm>현대비젼21</aptNm><dealAmount>40,000</dealAmount><excluUseAr>33.1</excluUseAr><floor>24</floor><buildYear>1999</buildYear><umdNm>도곡동</umdNm><dealingGbn>직거래</dealingGbn><cdealDay> </cdealDay><buyerGbn>개인</buyerGbn><slerGbn>개인</slerGbn><dealDay>19</dealDay></item>`;

  it("aptNm(아파트명)을 추출한다", () => {
    expect(getTag(devItem, "aptNm")).toBe("현대비젼21");
  });

  it("dealingGbn(거래유형)을 추출한다", () => {
    expect(getTag(devItem, "dealingGbn")).toBe("직거래");
  });

  it("cdealDay(해제일) 공백은 빈 문자열로 반환된다", () => {
    // cdealDay가 공백이면 trim 후 빈 문자열 → cancel_date는 null 처리
    expect(getTag(devItem, "cdealDay")).toBe("");
  });

  it("cdealDay(해제일)에 값이 있으면 추출한다", () => {
    const cancelItem = `<item><cdealDay>26.03.20</cdealDay></item>`;
    expect(getTag(cancelItem, "cdealDay")).toBe("26.03.20");
  });

  it("기존 필드(dealAmount, excluUseAr, floor)는 동일하게 파싱된다", () => {
    expect(getTag(devItem, "dealAmount")).toBe("40,000");
    expect(getTag(devItem, "excluUseAr")).toBe("33.1");
    expect(getTag(devItem, "floor")).toBe("24");
  });
});

describe("SilvTrade XML 파싱", () => {
  // 분양권전매 API 응답 파싱 검증
  const silvItem = `<item><aptNm>동탄역 롯데캐슬</aptNm><dealAmount>55,000</dealAmount><excluUseAr>84.99</excluUseAr><floor>15</floor><buildYear>2024</buildYear><umdNm>오산동</umdNm></item>`;

  it("분양권전매 aptNm 추출", () => {
    expect(getTag(silvItem, "aptNm")).toBe("동탄역 롯데캐슬");
  });

  it("분양권전매 기본 필드 파싱", () => {
    expect(getTag(silvItem, "dealAmount")).toBe("55,000");
    expect(getTag(silvItem, "excluUseAr")).toBe("84.99");
    expect(getTag(silvItem, "floor")).toBe("15");
  });
});

// ── TRADE_CONFIGS 구조 검증 ─────────────────────────────────
describe("TRADE_CONFIGS", () => {
  // 3가지 타입 모두 존재
  it("sale, jeonse, presale 3가지 타입이 존재한다", () => {
    expect(Object.keys(TRADE_CONFIGS)).toEqual(["sale", "jeonse", "presale"]);
  });

  // 각 타입에 필수 키 존재
  for (const [type, config] of Object.entries(TRADE_CONFIGS)) {
    it(`${type}: 필수 키(endpoint, label, priceTag, validate, buildRow)가 존재한다`, () => {
      expect(config.endpoint).toBeTruthy();
      expect(config.label).toBeTruthy();
      expect(config.priceTag).toBeTruthy();
      expect(typeof config.validate).toBe("function");
      expect(typeof config.buildRow).toBe("function");
    });
  }

  // sale에만 fallbackEndpoint 존재
  it("sale에만 fallbackEndpoint가 있다", () => {
    expect(TRADE_CONFIGS.sale.fallbackEndpoint).toBeTruthy();
    expect(TRADE_CONFIGS.jeonse.fallbackEndpoint).toBeUndefined();
    expect(TRADE_CONFIGS.presale.fallbackEndpoint).toBeUndefined();
  });

  // presale에만 skipUnregistered 존재
  it("presale에만 skipUnregistered가 true이다", () => {
    expect(TRADE_CONFIGS.presale.skipUnregistered).toBe(true);
    expect(TRADE_CONFIGS.sale.skipUnregistered).toBeUndefined();
  });
});

// ── buildApiUrl 검증 ────────────────────────────────────────
describe("buildApiUrl", () => {
  it("올바른 URL을 생성한다", () => {
    const url = buildApiUrl("https://apis.data.go.kr/test/api", "11680", "202603");
    expect(url).toContain("serviceKey=");
    expect(url).toContain("LAWD_CD=11680");
    expect(url).toContain("DEAL_YMD=202603");
    expect(url).toContain("numOfRows=9999");
  });
});

// ── TRADE_CONFIGS.buildRow 검증 ─────────────────────────────
describe("TRADE_CONFIGS.buildRow", () => {
  /** 테스트용 base 행 팩토리 */
  function makeBase() {
    return { region: "서울", gu: "강남구", dong: "역삼동", deal_month: "202603", area: 84.99, price: 50000, floor: 10, build_year: 2020 };
  }

  it("sale: 비폴백 시 apt_name, dealing_type, cancel_date 포함", () => {
    const item = `<item><aptNm>래미안</aptNm><dealingGbn>중개</dealingGbn><cdealDay>26.03.01</cdealDay></item>`;
    const row = TRADE_CONFIGS.sale.buildRow(item, makeBase(), false);
    expect(row.trade_type).toBe("sale");
    expect(row.apt_name).toBe("래미안");
    expect(row.dealing_type).toBe("중개");
    expect(row.cancel_date).toBe("26.03.01");
    expect(row.deposit).toBeNull();
  });

  it("sale: 폴백 시 apt_name, dealing_type, cancel_date 미포함", () => {
    const item = `<item></item>`;
    const row = TRADE_CONFIGS.sale.buildRow(item, makeBase(), true);
    expect(row.apt_name).toBeUndefined();
    expect(row.dealing_type).toBeUndefined();
    expect(row.cancel_date).toBeUndefined();
  });

  it("jeonse: deposit = price와 동일", () => {
    const row = TRADE_CONFIGS.jeonse.buildRow("<item/>", makeBase());
    expect(row.trade_type).toBe("jeonse");
    expect(row.deposit).toBe(50000);
  });

  it("presale: apt_name 포함, deposit null", () => {
    const item = `<item><aptNm>동탄역 캐슬</aptNm></item>`;
    const row = TRADE_CONFIGS.presale.buildRow(item, makeBase());
    expect(row.trade_type).toBe("presale");
    expect(row.apt_name).toBe("동탄역 캐슬");
    expect(row.deposit).toBeNull();
  });
});

// ── TRADE_CONFIGS.validate 검증 ─────────────────────────────
describe("TRADE_CONFIGS.validate", () => {
  it("sale: price > 0 && area > 0 이면 true", () => {
    expect(TRADE_CONFIGS.sale.validate(50000, 84.99)).toBe(true);
    expect(TRADE_CONFIGS.sale.validate(0, 84.99)).toBe(false);
    expect(TRADE_CONFIGS.sale.validate(50000, 0)).toBe(false);
  });

  it("jeonse: deposit > 0 && monthlyRent === 0 && area > 0 이면 true", () => {
    // monthlyRent=0인 순수 전세만 수집
    const pureJeonse = "<item><monthlyRent>0</monthlyRent></item>";
    const monthly = "<item><monthlyRent>50</monthlyRent></item>";
    expect(TRADE_CONFIGS.jeonse.validate(30000, 60, pureJeonse)).toBe(true);
    expect(TRADE_CONFIGS.jeonse.validate(30000, 60, monthly)).toBe(false);
    expect(TRADE_CONFIGS.jeonse.validate(0, 60, pureJeonse)).toBe(false);
  });

  it("presale: price > 0 && area > 0 이면 true", () => {
    expect(TRADE_CONFIGS.presale.validate(55000, 84.99)).toBe(true);
    expect(TRADE_CONFIGS.presale.validate(0, 84.99)).toBe(false);
  });
});
