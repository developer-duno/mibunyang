/**
 * naver-presale.mjs 테스트 — 분양정보 수집기 핵심 함수 검증
 *
 * 검증 대상:
 * - parsePresalePrice: 원→만원 변환, null/빈값 안전성
 * - sanitizeImageUrl: URL 화이트리스트 검증
 * - parsePresaleAddress: 주소→region/gu/dong 분리
 * - toPresaleRow: API 응답→DB 행 변환
 * - matchPresaleToApt: 4단계 매칭 로직
 */
import { describe, it, expect } from "vitest";
import {
  parsePresalePrice,
  sanitizeImageUrl,
  parsePresaleAddress,
  toPresaleRow,
  matchPresaleToApt,
} from "./naver-presale.mjs";

// ── 테스트 팩토리 ─────────────────────────────────────────────

/** 네이버 complex API 응답 팩토리 */
function createComplexResponse(overrides = {}) {
  return {
    build_dtl_cd: 6025041,
    supp_cd: 9033181,
    build_nm: "테스트아파트",
    bubdong_code: "1144012000",
    address: "서울시 마포구 서교동 372-8",
    min_price: 461000000,
    max_price: 499000000,
    supp_bclass: "G",
    bclass_nm: "아파트",
    supp_proc_step_nm: "분양중",
    supp_sclass: "민간분양",
    house_supp_cnt: 200,
    total_house_cnt: 300,
    recruit_date: "2026-03-01",
    pyper_price: 64847283,
    preview_image: "//naver-file.ebunyang.co.kr/img/test.jpg",
    xpos: "126.9124477",
    ypos: "37.5482353",
    schdl_info: { schdl_cd: "101" },
    ...overrides,
  };
}

/** 리스트 API 응답 항목 팩토리 */
function createListItem(overrides = {}) {
  return {
    preSaleComplexNumber: 6025041,
    announcementPreSaleSequence: 9033181,
    preSaleComplexName: "테스트아파트",
    preSaleStageCode: "C12",
    scheduleName: "입주자모집공고",
    dateInfo: "2026-03-01",
    ...overrides,
  };
}

/** 기존 아파트 레코드 팩토리 */
function createApartment(overrides = {}) {
  return {
    id: "ah-100",
    name: "테스트아파트",
    region: "서울",
    gu: "마포구",
    dong: "서교동",
    lat: 37.548,
    lng: 126.912,
    bjd_code: "1144012000",
    naver_presale_no: null,
    units: 300,
    builder: "현대건설",
    max_floor: 25,
    completion: "202611",
    ...overrides,
  };
}

// ── parsePresalePrice ─────────────────────────────────────────

describe("parsePresalePrice", () => {
  // 정상: 원→만원 변환 (461000000원 → 46100만원)
  it("원 단위를 만원으로 정확히 변환한다", () => {
    expect(parsePresalePrice(461000000)).toBe(46100);
  });

  // 정상: 0원은 0만원
  it("0원은 0을 반환한다", () => {
    expect(parsePresalePrice(0)).toBe(0);
  });

  // null 입력
  it("null 입력 시 null을 반환한다", () => {
    expect(parsePresalePrice(null)).toBeNull();
  });

  // undefined 입력
  it("undefined 입력 시 null을 반환한다", () => {
    expect(parsePresalePrice(undefined)).toBeNull();
  });

  // 문자열 숫자도 처리
  it("문자열 숫자를 정수로 변환한다", () => {
    expect(parsePresalePrice("500000000")).toBe(50000);
  });

  // 잘못된 형식
  it("숫자가 아닌 문자열은 null을 반환한다", () => {
    expect(parsePresalePrice("abc")).toBeNull();
  });
});

// ── sanitizeImageUrl ──────────────────────────────────────────

describe("sanitizeImageUrl", () => {
  // 정상: // 프로토콜 없는 naver 이미지 URL
  it("프로토콜 없는 naver 이미지 URL에 https: 추가한다", () => {
    const url = "//naver-file.ebunyang.co.kr/img/test.jpg";
    expect(sanitizeImageUrl(url)).toBe("https://naver-file.ebunyang.co.kr/img/test.jpg");
  });

  // 정상: pstatic.net 도메인
  it("pstatic.net 서브도메인을 허용한다", () => {
    const url = "https://landthumb-phinf.pstatic.net/img.jpg";
    expect(sanitizeImageUrl(url)).toBe(url);
  });

  // 위험: 허용되지 않은 도메인
  it("허용 외 도메인은 null을 반환한다", () => {
    expect(sanitizeImageUrl("https://evil.com/malware.js")).toBeNull();
  });

  // null/빈값
  it("null 입력 시 null을 반환한다", () => {
    expect(sanitizeImageUrl(null)).toBeNull();
  });

  it("빈 문자열은 null을 반환한다", () => {
    expect(sanitizeImageUrl("")).toBeNull();
  });
});

// ── parsePresaleAddress ───────────────────────────────────────

describe("parsePresaleAddress", () => {
  // 정상: "서울시 마포구 서교동 372-8" 파싱
  it("서울시 마포구 서교동을 정확히 분리한다", () => {
    const result = parsePresaleAddress("서울시 마포구 서교동 372-8");
    expect(result.region).toBe("서울");
    expect(result.gu).toBe("마포구");
    expect(result.dong).toBe("서교동");
  });

  // 정상: 도 단위 주소
  it("경기도 성남시 분당구를 파싱한다", () => {
    const result = parsePresaleAddress("경기도 성남시 분당구 야탑동");
    expect(result.region).toBe("경기");
    expect(result.gu).toBe("분당구");
  });

  // null 입력
  it("null 입력 시 모두 null을 반환한다", () => {
    const result = parsePresaleAddress(null);
    expect(result.region).toBeNull();
    expect(result.gu).toBeNull();
    expect(result.dong).toBeNull();
  });

  // 빈 문자열
  it("빈 문자열은 모두 null을 반환한다", () => {
    const result = parsePresaleAddress("");
    expect(result.region).toBeNull();
  });
});

// ── toPresaleRow ──────────────────────────────────────────────

describe("toPresaleRow", () => {
  // 정상: 전체 필드 변환
  it("complex+detail+list 데이터를 DB 행으로 변환한다", () => {
    const complex = createComplexResponse();
    const detail = { dong_cnt: 3, parking_cnt: 150, inquiry_tel: "1661-4919", features: "역세권" };
    const list = createListItem();

    const row = toPresaleRow(complex, detail, list);

    expect(row.presale_min_price).toBe(46100);
    expect(row.presale_max_price).toBe(49900);
    expect(row.presale_pp).toBe(6485);
    expect(row.presale_type).toBe("민간분양");
    expect(row.presale_stage).toBe("분양중");
    expect(row.presale_stage_code).toBe("C12");
    expect(row.presale_buildings).toBe(3);
    expect(row.presale_parking).toBe(150);
    expect(row.presale_inquiry).toBe("1661-4919");
    expect(row.presale_features).toBe("역세권");
    expect(row.presale_housing_type).toBe("아파트");
    expect(row.naver_presale_no).toBe("6025041");
    expect(row.naver_presale_seq).toBe("9033181");
    expect(row._enrich.lat).toBeCloseTo(37.548, 2);
    expect(row._enrich.units).toBe(300);
  });

  // detail이 null인 경우 — complex 데이터만으로 부분 변환
  it("detail null 시 complex 데이터만으로 변환한다", () => {
    const complex = createComplexResponse();
    const row = toPresaleRow(complex, null, createListItem());

    expect(row.presale_min_price).toBe(46100);
    expect(row.presale_buildings).toBeNull();
    expect(row.presale_inquiry).toBeNull();
    expect(row.presale_housing_type).toBe("아파트");
  });
});

// ── matchPresaleToApt ─────────────────────────────────────────

describe("matchPresaleToApt", () => {
  // 1순위: naver_presale_no 완전 일치
  it("naver_presale_no가 일치하면 매칭한다", () => {
    const row = toPresaleRow(createComplexResponse(), null, createListItem());
    row._name = "테스트아파트";
    const apts = [createApartment({ naver_presale_no: "6025041" })];

    const result = matchPresaleToApt(row, apts);
    expect(result).not.toBeNull();
    expect(result.apartment.id).toBe("ah-100");
    expect(result.confidence).toBe(1.0);
  });

  // 2순위: bjd_code + 이름 유사도
  it("bjd_code 일치 + 이름 유사도 >= 0.5이면 매칭한다", () => {
    const row = toPresaleRow(createComplexResponse(), null, createListItem());
    row._name = "테스트아파트";
    const apts = [createApartment({ bjd_code: "1144012000", name: "테스트아파트 1단지" })];

    const result = matchPresaleToApt(row, apts);
    expect(result).not.toBeNull();
  });

  // 매칭 실패: 이름이 완전히 다름
  it("이름 유사도가 낮으면 매칭 실패한다", () => {
    const row = toPresaleRow(
      createComplexResponse({ build_nm: "가나다라마바사" }),
      null,
      createListItem()
    );
    row._name = "가나다라마바사";
    const apts = [createApartment({
      bjd_code: "9999999999",
      name: "완전다른아파트",
      lat: 35.0,
      lng: 129.0,
      naver_presale_no: null,
    })];

    const result = matchPresaleToApt(row, apts);
    expect(result).toBeNull();
  });

  // 3순위: 좌표 근접 + 이름 유사도
  it("좌표 500m 이내 + 이름 유사도 >= 0.4이면 매칭한다", () => {
    const row = toPresaleRow(createComplexResponse(), null, createListItem());
    row._name = "테스트아파트";
    // bjd_code 다르지만 좌표 근접
    const apts = [createApartment({
      bjd_code: "9999999999",
      lat: 37.5485,
      lng: 126.9125,
      naver_presale_no: null,
    })];

    const result = matchPresaleToApt(row, apts);
    expect(result).not.toBeNull();
  });
});
