/**
 * collect-data.mjs 순수 함수 테스트
 * 대상: resolveBuilder, isValidGu, parseAddress, mapItem, getLawdCd (5개)
 * estimateCreditGrade는 dart-builders.test.mjs에 13케이스 기존재 → 제외
 */
import { describe, it, expect, vi } from "vitest";

// 모듈 초기화 부수효과 차단
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
vi.mock("./collectors/_shared.mjs", async (importOriginal) => {
  const orig = await importOriginal();
  return { ...orig, loadEnv: vi.fn() };
});

const {
  resolveBuilder, isValidGu, parseAddress, mapItem, getLawdCd,
  AREA_CODE_REGION, BUILDER_ALIASES, VALID_REGIONS, GU_LAWD_MAP, REGION_LAWD_PREFIX,
} = await import("./collect-data.mjs");

// ============================================================
// 팩토리 함수
// ============================================================

/** 청약홈 API 응답 항목 팩토리 */
function createApplyhomeItem(overrides = {}) {
  return {
    HOUSE_NM: "테스트아파트",
    HSSPLY_ADRES: "서울특별시 강남구 테헤란로 123",
    TOT_SUPLY_HSHLDCO: "500",
    REMNDR_HSHLDCO: "50",
    HOUSE_MANAGE_NO: "2024000001",
    SUBSCRPT_AREA_CODE: "100",
    SUBSCRPT_AREA_CODE_NM: "서울",
    CNSTRCT_ENTRPS_NM: "현대건설",
    BSNS_MBY_NM: null,
    MVN_PREARNGE_YM: "202612",
    HEAT_MTHD_NM: "지역난방",
    PRESNTN_DTLS_URL: "https://example.com",
    ...overrides,
  };
}

// ============================================================
// resolveBuilder — 건설사명 정규화 (8케이스)
// ============================================================
describe("resolveBuilder", () => {
  // BUILDER_ALIASES 매칭
  it("지에스건설 → GS건설", () => {
    expect(resolveBuilder("지에스건설")).toBe("GS건설");
  });

  it("GS건설(주) → GS건설", () => {
    expect(resolveBuilder("GS건설(주)")).toBe("GS건설");
  });

  it("삼성물산건설부문 → 삼성물산", () => {
    expect(resolveBuilder("삼성물산건설부문")).toBe("삼성물산");
  });

  it("에이치디씨현대산업개발 → HDC현대산업개발", () => {
    expect(resolveBuilder("에이치디씨현대산업개발")).toBe("HDC현대산업개발");
  });

  // 미등록 건설사
  it("미등록 건설사는 원문 그대로 반환", () => {
    expect(resolveBuilder("미래건설")).toBe("미래건설");
  });

  // null/빈값
  it("null → '기타'", () => {
    expect(resolveBuilder(null)).toBe("기타");
  });

  it("빈문자열 → '기타'", () => {
    expect(resolveBuilder("")).toBe("기타");
  });

  // trim
  it("앞뒤 공백이 있으면 trim 후 매칭", () => {
    expect(resolveBuilder("  지에스건설  ")).toBe("GS건설");
  });
});

// ============================================================
// isValidGu — 구/군/시/생활권 유효성 (10케이스)
// ============================================================
describe("isValidGu", () => {
  // 유효한 값
  it("'강남구' → truthy", () => {
    expect(isValidGu("강남구")).toBeTruthy();
  });

  it("'해운대구' → truthy", () => {
    expect(isValidGu("해운대구")).toBeTruthy();
  });

  it("'수원시' → truthy", () => {
    expect(isValidGu("수원시")).toBeTruthy();
  });

  it("'기장군' → truthy", () => {
    expect(isValidGu("기장군")).toBeTruthy();
  });

  it("'세종생활권' → truthy", () => {
    expect(isValidGu("세종생활권")).toBeTruthy();
  });

  // 무효한 값
  it("null → falsy", () => {
    expect(isValidGu(null)).toBeFalsy();
  });

  it("빈문자열 → falsy", () => {
    expect(isValidGu("")).toBeFalsy();
  });

  it("숫자 문자열 '123' → falsy (한글 없음)", () => {
    expect(isValidGu("123")).toBeFalsy();
  });

  it("접미사 없는 한글 '강남' → falsy", () => {
    expect(isValidGu("강남")).toBeFalsy();
  });

  // 경계값: 한글+접미사지만 비정상
  it("'테스트' → falsy (접미사 없음)", () => {
    expect(isValidGu("테스트")).toBeFalsy();
  });
});

// ============================================================
// parseAddress — 주소 파싱 (12케이스)
// ============================================================
describe("parseAddress", () => {
  // 정상 파싱
  it("서울특별시 강남구 테헤란로 → region:서울, gu:강남구, dong:테헤란로", () => {
    const r = parseAddress("서울특별시 강남구 테헤란로");
    expect(r.region).toBe("서울");
    expect(r.gu).toBe("강남구");
    expect(r.dong).toBe("테헤란로");
  });

  it("부산광역시 해운대구 우동 → region:부산, gu:해운대구, dong:우동", () => {
    const r = parseAddress("부산광역시 해운대구 우동");
    expect(r.region).toBe("부산");
    expect(r.gu).toBe("해운대구");
    expect(r.dong).toBe("우동");
  });

  // REGION_MAP 정규화
  it("경기도 수원시 영통구 → region:경기", () => {
    const r = parseAddress("경기도 수원시 영통구");
    expect(r.region).toBe("경기");
    expect(r.gu).toBe("수원시");
  });

  // 특별자치시/도 제거
  it("세종특별자치시 → region:세종", () => {
    const r = parseAddress("세종특별자치시");
    expect(r.region).toBe("세종");
  });

  it("제주특별자치도 제주시 → region:제주", () => {
    const r = parseAddress("제주특별자치도 제주시");
    expect(r.region).toBe("제주");
    expect(r.gu).toBe("제주시");
  });

  // gu 무효 시 gu=null, dong=null
  it("gu가 유효하지 않으면 gu=null, dong=null", () => {
    const r = parseAddress("서울특별시 123 테헤란로");
    expect(r.region).toBe("서울");
    expect(r.gu).toBeNull();
    expect(r.dong).toBeNull();
  });

  // null/undefined/빈값
  it("null → 모두 null", () => {
    const r = parseAddress(null);
    expect(r).toEqual({ region: null, gu: null, dong: null });
  });

  it("undefined → 모두 null", () => {
    const r = parseAddress(undefined);
    expect(r).toEqual({ region: null, gu: null, dong: null });
  });

  it("빈문자열 → 모두 null", () => {
    const r = parseAddress("");
    expect(r).toEqual({ region: null, gu: null, dong: null });
  });

  // 1개 토큰만
  it("1개 토큰만 있는 주소 → gu=null, dong=null", () => {
    const r = parseAddress("서울특별시");
    expect(r.region).toBe("서울");
    expect(r.gu).toBeNull();
  });

  // 다중 공백
  it("다중 공백은 정규식 split으로 정상 처리", () => {
    const r = parseAddress("서울특별시   강남구   역삼동");
    expect(r.region).toBe("서울");
    expect(r.gu).toBe("강남구");
    expect(r.dong).toBe("역삼동");
  });

  // dong 없는 2토큰 주소
  it("2토큰 주소 → dong=null", () => {
    const r = parseAddress("인천광역시 미추홀구");
    expect(r.region).toBe("인천");
    expect(r.gu).toBe("미추홀구");
    expect(r.dong).toBeNull();
  });
});

// ============================================================
// mapItem — 청약홈 응답 → 아파트 객체 변환 (15케이스)
// ============================================================
describe("mapItem", () => {
  // 정상 변환
  it("모든 필드가 올바르게 매핑된다", () => {
    const item = createApplyhomeItem();
    const apt = mapItem(item, 0, false);

    expect(apt.id).toBe("ah-2024000001");
    expect(apt.name).toBe("테스트아파트");
    expect(apt.region).toBe("서울");
    expect(apt.gu).toBe("강남구");
    expect(apt.units).toBe(500);
    expect(apt.unsold).toBe(50);
    expect(apt.builder).toBe("현대건설");
    expect(apt.completion).toBe("202612");
    expect(apt.heating).toBe("지역난방");
  });

  // id 생성
  it("HOUSE_MANAGE_NO 기반으로 id 생성", () => {
    const apt = mapItem(createApplyhomeItem({ HOUSE_MANAGE_NO: "9999" }), 0, false);
    expect(apt.id).toBe("ah-9999");
  });

  it("HOUSE_MANAGE_NO 없으면 인덱스 사용", () => {
    const apt = mapItem(createApplyhomeItem({ HOUSE_MANAGE_NO: "" }), 7, false);
    expect(apt.id).toBe("ah-7");
  });

  // name fallback
  it("HOUSE_NM 없으면 '아파트-{idx}' 생성", () => {
    const apt = mapItem(createApplyhomeItem({ HOUSE_NM: "" }), 3, false);
    expect(apt.name).toBe("아파트-3");
  });

  // region 폴백 경로 1: parseAddress 성공 (기본 케이스에서 이미 테스트)

  // region 폴백 경로 2: REGION_MAP[areaName]
  it("주소에서 region 추출 실패 → SUBSCRPT_AREA_CODE_NM으로 폴백", () => {
    const apt = mapItem(createApplyhomeItem({
      HSSPLY_ADRES: "",
      SUBSCRPT_AREA_CODE_NM: "경기도",
    }), 0, false);
    expect(apt.region).toBe("경기");
  });

  // region 폴백 경로 3: areaName 직접 사용
  it("REGION_MAP에 없는 areaName → 직접 사용", () => {
    const apt = mapItem(createApplyhomeItem({
      HSSPLY_ADRES: "",
      SUBSCRPT_AREA_CODE_NM: "미래특별시",
    }), 0, false);
    expect(apt.region).toBe("미래특별시");
  });

  // region 폴백 경로 4: AREA_CODE_REGION
  it("areaName도 없으면 AREA_CODE_REGION으로 폴백", () => {
    const apt = mapItem(createApplyhomeItem({
      HSSPLY_ADRES: "",
      SUBSCRPT_AREA_CODE_NM: "",
      SUBSCRPT_AREA_CODE: "200",
    }), 0, false);
    expect(apt.region).toBe("부산");
  });

  // units 파싱
  it("TOT_SUPLY_HSHLDCO 문자열을 정수로 파싱", () => {
    const apt = mapItem(createApplyhomeItem({ TOT_SUPLY_HSHLDCO: "1234" }), 0, false);
    expect(apt.units).toBe(1234);
  });

  it("TOT_SUPLY_HSHLDCO 없으면 0", () => {
    const apt = mapItem(createApplyhomeItem({ TOT_SUPLY_HSHLDCO: "" }), 0, false);
    expect(apt.units).toBe(0);
  });

  // unsoldRate 계산
  it("remndr > 0이면 unsoldRate 계산", () => {
    const apt = mapItem(createApplyhomeItem({
      TOT_SUPLY_HSHLDCO: "1000",
      REMNDR_HSHLDCO: "100",
    }), 0, false);
    expect(apt.unsold).toBe(100);
    expect(apt.unsoldRate).toBe(10.0);
  });

  it("remndr = 0이면 unsold=null, unsoldRate=null", () => {
    const apt = mapItem(createApplyhomeItem({ REMNDR_HSHLDCO: "0" }), 0, false);
    expect(apt.unsold).toBeNull();
    expect(apt.unsoldRate).toBeNull();
  });

  // builder fallback
  it("CNSTRCT_ENTRPS_NM 우선, BSNS_MBY_NM fallback", () => {
    const apt = mapItem(createApplyhomeItem({
      CNSTRCT_ENTRPS_NM: "",
      BSNS_MBY_NM: "호반건설",
    }), 0, false);
    expect(apt.builder).toBe("호반건설");
  });

  it("둘 다 없으면 '기타'", () => {
    const apt = mapItem(createApplyhomeItem({
      CNSTRCT_ENTRPS_NM: "",
      BSNS_MBY_NM: "",
    }), 0, false);
    expect(apt.builder).toBe("기타");
  });

  // 기본값
  it("기본값: area=84, price=null, lat/lng=null", () => {
    const apt = mapItem(createApplyhomeItem(), 0, false);
    expect(apt.area).toBe(84);
    expect(apt.price).toBeNull();
    expect(apt.lat).toBeNull();
    expect(apt.lng).toBeNull();
  });
});

// ============================================================
// getLawdCd — 법정동코드 매핑 (10케이스)
// ============================================================
describe("getLawdCd", () => {
  // 직접 매칭 — 고유 키
  it("강남구 → 11680 (고유 키 직접 매칭)", () => {
    expect(getLawdCd("서울", "강남구")).toBe("11680");
  });

  it("송파구 → 11710", () => {
    expect(getLawdCd("서울", "송파구")).toBe("11710");
  });

  it("해운대구 → 26350", () => {
    expect(getLawdCd("부산", "해운대구")).toBe("26350");
  });

  // 경기 시 매칭
  it("수원시 → 41110 (경기 시 직접 매칭)", () => {
    expect(getLawdCd("경기", "수원시")).toBe("41110");
  });

  it("성남시 → 41130", () => {
    expect(getLawdCd("경기", "성남시")).toBe("41130");
  });

  // shortGu 부분 매칭
  it("수원 (접미사 없음) → shortGu 부분 매칭으로 41110", () => {
    expect(getLawdCd("경기", "수원")).toBe("41110");
  });

  // REGION_LAWD_PREFIX 폴백
  it("미등록 gu → REGION_LAWD_PREFIX + '000'", () => {
    expect(getLawdCd("강원", "춘천동")).toBe("42000");
  });

  it("서울 미등록 gu → 11 + 000", () => {
    expect(getLawdCd("서울", "미래구")).toBe("11000");
  });

  // null/미등록 region
  it("미등록 region → null", () => {
    expect(getLawdCd("미래도", "미래구")).toBeNull();
  });

  // TODO: GU_LAWD_MAP 중복 키 버그 — "중구"/"서구"/"동구" 등이 여러 시도에 중복 정의
  // JS 객체는 마지막 값만 유지하므로, getLawdCd("서울", "중구")는 서울 코드(11140)가 아닌
  // 마지막 정의된 시도의 코드를 반환함. region 파라미터를 활용하지 않는 구조적 한계.
  // 향후 GU_LAWD_MAP을 { 서울: { 중구: "11140" }, 부산: { 중구: "26110" } } 형태로 개선 필요.
  it("중복 키 '중구' → 마지막 정의값 반환 (알려진 한계)", () => {
    const result = getLawdCd("서울", "중구");
    // 서울 중구(11140)가 아닌 마지막 정의된 값이 반환됨
    expect(result).toBe(GU_LAWD_MAP["중구"]);
  });
});

// ============================================================
// 상수 검증 (3케이스)
// ============================================================
describe("상수 무결성", () => {
  it("VALID_REGIONS는 17개 시도", () => {
    expect(VALID_REGIONS).toHaveLength(17);
    expect(VALID_REGIONS).toContain("서울");
    expect(VALID_REGIONS).toContain("제주");
  });

  it("AREA_CODE_REGION의 키는 문자열 숫자", () => {
    expect(AREA_CODE_REGION["100"]).toBe("서울");
    expect(AREA_CODE_REGION["410"]).toBe("경기");
  });

  it("REGION_LAWD_PREFIX는 17개 시도 매핑", () => {
    expect(Object.keys(REGION_LAWD_PREFIX)).toHaveLength(17);
    expect(REGION_LAWD_PREFIX["서울"]).toBe("11");
    expect(REGION_LAWD_PREFIX["경기"]).toBe("41");
  });
});
