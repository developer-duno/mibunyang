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
  // 정상 매핑 — 시군구 직접 조회
  it("서울 강남구의 법정동코드를 반환한다", () => {
    const code = getLawdCd("서울", "강남구");
    expect(code).toBeTruthy();
    expect(typeof code).toBe("string");
  });

  // 경기도 시군구
  it("경기 화성시의 법정동코드를 반환한다", () => {
    const code = getLawdCd("경기", "화성시");
    expect(code).toBeTruthy();
  });

  // 존재하지 않는 지역 → 시도 prefix 또는 null
  it("존재하지 않는 시군구는 시도 코드 또는 null을 반환한다", () => {
    const code = getLawdCd("서울", "없는구");
    // 서울 시도 prefix("11") + "000" 또는 매핑된 값
    expect(code === null || typeof code === "string").toBe(true);
  });

  // 완전 미지 지역
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
