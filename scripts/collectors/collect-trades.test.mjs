/**
 * collect-trades.mjs 테스트 — 법정동코드 조회, XML 파싱 검증
 */
import { describe, it, expect, vi } from "vitest";

// loadEnv + 외부 API 호출 방지
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = await importOriginal();
  return { ...orig, loadEnv: vi.fn(), getMibuyangSupabase: vi.fn(), getSupabase: vi.fn() };
});

const { getLawdCd, extractItems, getTag } = await import("./collect-trades.mjs");

describe("getLawdCd", () => {
  // 정상 매핑 — REGION_GU_OVERRIDE 경유 (동명이구)
  it("서울 강남구 → 11680", () => {
    expect(getLawdCd("서울", "강남구")).toBe("11680");
  });

  // 경기도 시군구 — GU_LAWD_MAP 직접 조회
  it("경기 화성시 → 41590", () => {
    expect(getLawdCd("경기", "화성시")).toBe("41590");
  });

  // 동명이구 처리 — 부산 해운대구 (override 테이블)
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
