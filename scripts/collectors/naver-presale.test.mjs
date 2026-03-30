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
import { vi } from "vitest";
import {
  parsePresalePrice,
  sanitizeImageUrl,
  parsePresaleAddress,
  toPresaleRow,
  matchPresaleToApt,
  tryPythonJwt,
  extractPresaleFields,
  buildNewApartment,
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

// ── tryPythonJwt ─────────────────────────────────────────────

describe("tryPythonJwt", () => {
  // Python 실행 결과에 따라 JWT 또는 null 반환 확인
  // 실제 Python 호출은 환경 의존적이므로, 반환값 형식만 검증
  it("JWT 토큰 또는 null을 반환한다", () => {
    const result = tryPythonJwt();
    // Python 미설치 또는 네트워크 불가 시 null, 성공 시 eyJ... 문자열
    if (result !== null) {
      expect(result).toMatch(/^eyJ/);
      expect(typeof result).toBe("string");
    } else {
      expect(result).toBeNull();
    }
  });

  // 반환 타입은 항상 string 또는 null (예외 발생 안 함)
  it("예외를 던지지 않고 안전하게 null을 반환한다", () => {
    // tryPythonJwt는 내부에서 모든 에러를 catch하므로 예외 발생 안 함
    expect(() => tryPythonJwt()).not.toThrow();
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

  // 4순위: 동일 region + 이름 유사도 >= 0.7
  it("동일 region + 이름 유사도 >= 0.7이면 4순위로 매칭한다", () => {
    const row = toPresaleRow(createComplexResponse(), null, createListItem());
    row._name = "테스트아파트";
    const apts = [createApartment({
      bjd_code: "9999999999",
      region: "서울",
      name: "테스트아파트 2단지",
      lat: 35.0,
      lng: 129.0,
      naver_presale_no: null,
    })];

    const result = matchPresaleToApt(row, apts);
    expect(result).not.toBeNull();
    expect(result.tier).toBe(4);
  });
});

// ── matchPresaleToApt 경계값 ────────────────────────────────

describe("matchPresaleToApt 경계값", () => {
  // Tier 2 임계값 정확히 0.5: "가나다라" vs "가나마바" → LCS=2, sim=4/8=0.5
  it("Tier 2 유사도 정확히 0.5이면 매칭 성공한다", () => {
    const row = toPresaleRow(
      createComplexResponse({ build_nm: "가나다라", bubdong_code: "1111010100" }),
      null, createListItem()
    );
    row._name = "가나다라";
    row._enrich = { lat: 37.5, lng: 126.9, bjd_code: "1111010100" };
    const apts = [createApartment({
      bjd_code: "1111010100", name: "가나마바",
      naver_presale_no: null, lat: 35.0, lng: 129.0, region: "부산",
    })];

    const result = matchPresaleToApt(row, apts);
    expect(result).not.toBeNull();
    expect(result.tier).toBe(2);
    expect(result.confidence).toBe(0.5);
  });

  // Tier 2 임계값 미달: "가나다라" vs "가나마바사" → LCS=2, sim=4/9=0.444
  it("Tier 2 유사도 0.5 미만이면 매칭 실패한다", () => {
    const row = toPresaleRow(
      createComplexResponse({ build_nm: "가나다라", bubdong_code: "1111010100" }),
      null, createListItem()
    );
    row._name = "가나다라";
    row._enrich = { lat: 35.0, lng: 129.0, bjd_code: "1111010100" };
    const apts = [createApartment({
      bjd_code: "1111010100", name: "가나마바사",
      naver_presale_no: null, lat: 33.0, lng: 127.0, region: "제주",
    })];

    const result = matchPresaleToApt(row, apts);
    expect(result).toBeNull();
  });

  // Tier 3 임계값 정확히 0.4 + 거리 500m 이내
  // "가나다라마" vs "가나바사아" → LCS=2, sim=4/10=0.4
  // 위도 차이 = 450/111000 ≈ 0.00405 → 거리 ≈ 450m (500m 이내)
  it("Tier 3 유사도 0.4 + 거리 500m 이내이면 매칭 성공한다", () => {
    const baseLat = 37.5;
    const row = toPresaleRow(
      createComplexResponse({ build_nm: "가나다라마", bubdong_code: "9999999999" }),
      null, createListItem()
    );
    row._name = "가나다라마";
    row._enrich = { lat: baseLat, lng: 126.9, bjd_code: "9999999999" };
    const apts = [createApartment({
      bjd_code: "8888888888", name: "가나바사아",
      naver_presale_no: null, lat: baseLat + 450 / 111000, lng: 126.9, region: "제주",
    })];

    const result = matchPresaleToApt(row, apts);
    expect(result).not.toBeNull();
    expect(result.tier).toBe(3);
    expect(result.confidence).toBe(0.4);
  });

  // Tier 3 거리 초과 (600m) → 매칭 실패
  it("Tier 3 거리 600m이면 매칭 실패한다", () => {
    const baseLat = 37.5;
    const row = toPresaleRow(
      createComplexResponse({ build_nm: "가나다라마", bubdong_code: "9999999999" }),
      null, createListItem()
    );
    row._name = "가나다라마";
    row._enrich = { lat: baseLat, lng: 126.9, bjd_code: "9999999999" };
    const apts = [createApartment({
      bjd_code: "8888888888", name: "가나바사아",
      naver_presale_no: null, lat: baseLat + 600 / 111000, lng: 126.9, region: "제주",
    })];

    const result = matchPresaleToApt(row, apts);
    expect(result).toBeNull();
  });

  // Tier 4 임계값 정확히 0.7: "가나다라마바사아자차" vs "가나다라마바사카타파" → LCS=7, sim=14/20=0.7
  it("Tier 4 유사도 정확히 0.7이면 매칭 성공한다", () => {
    const row = toPresaleRow(
      createComplexResponse({ build_nm: "가나다라마바사아자차", address: "서울시 강남구 역삼동 1" }),
      null, createListItem()
    );
    row._name = "가나다라마바사아자차";
    row._enrich = { lat: 35.0, lng: 129.0, bjd_code: "9999999999", address: "서울시 강남구 역삼동 1" };
    const apts = [createApartment({
      bjd_code: "8888888888", name: "가나다라마바사카타파",
      naver_presale_no: null, lat: 33.0, lng: 127.0, region: "서울",
    })];

    const result = matchPresaleToApt(row, apts);
    expect(result).not.toBeNull();
    expect(result.tier).toBe(4);
    expect(result.confidence).toBe(0.7);
  });

  // Tier 4 임계값 미달: "ABCDEFGHIJ" vs "ABCDEFXYZW" → LCS=6, sim=12/20=0.6
  it("Tier 4 유사도 0.6이면 매칭 실패한다", () => {
    const row = toPresaleRow(
      createComplexResponse({ build_nm: "ABCDEFGHIJ", address: "서울시 강남구 역삼동 1" }),
      null, createListItem()
    );
    row._name = "ABCDEFGHIJ";
    row._enrich = { lat: 35.0, lng: 129.0, bjd_code: "9999999999", address: "서울시 강남구 역삼동 1" };
    const apts = [createApartment({
      bjd_code: "8888888888", name: "ABCDEFXYZW",
      naver_presale_no: null, lat: 33.0, lng: 127.0, region: "서울",
    })];

    const result = matchPresaleToApt(row, apts);
    expect(result).toBeNull();
  });

  // Tier 1 우선순위: presaleNo 일치 apt vs bjd+완전동일 이름 apt → Tier 1 선택
  it("Tier 1이 존재하면 Tier 2~4보다 우선한다", () => {
    const row = toPresaleRow(createComplexResponse(), null, createListItem());
    row._name = "테스트아파트";
    const aptTier1 = createApartment({
      id: "tier1-apt", naver_presale_no: "6025041",
      name: "완전다른이름", bjd_code: "9999999999",
    });
    const aptTier2 = createApartment({
      id: "tier2-apt", naver_presale_no: null,
      name: "테스트아파트", bjd_code: "1144012000",
    });

    const result = matchPresaleToApt(row, [aptTier2, aptTier1]);
    expect(result.apartment.id).toBe("tier1-apt");
    expect(result.tier).toBe(1);
    expect(result.confidence).toBe(1.0);
  });

  // 다중 후보 Tier 2: 3개 후보 중 최고 유사도 선택
  it("Tier 2에서 다중 후보 중 최고 유사도를 선택한다", () => {
    const row = toPresaleRow(
      createComplexResponse({ build_nm: "래미안원베일리", bubdong_code: "1165010100" }),
      null, createListItem()
    );
    row._name = "래미안원베일리";
    row._enrich = { lat: 35.0, lng: 129.0, bjd_code: "1165010100" };
    const apts = [
      createApartment({ id: "low", bjd_code: "1165010100", name: "래미안", naver_presale_no: null }),
      createApartment({ id: "best", bjd_code: "1165010100", name: "래미안원베일리1차", naver_presale_no: null }),
      createApartment({ id: "mid", bjd_code: "1165010100", name: "래미안파크스위트", naver_presale_no: null }),
    ];

    const result = matchPresaleToApt(row, apts);
    expect(result).not.toBeNull();
    expect(result.apartment.id).toBe("best");
    expect(result.tier).toBe(2);
  });
});

// ── matchPresaleToApt null/비정상 입력 ──────────────────────

describe("matchPresaleToApt null/비정상 입력", () => {
  // _name="" → stringSimilarity("", x) = 0 → 모든 tier 실패
  it("_name이 빈 문자열이면 매칭 실패한다", () => {
    const row = toPresaleRow(createComplexResponse(), null, createListItem());
    row._name = "";
    row._enrich = { lat: 37.548, lng: 126.912, bjd_code: "1144012000", address: "서울시 마포구 서교동" };
    const apts = [createApartment({
      bjd_code: "1144012000", region: "서울",
      lat: 37.5485, lng: 126.9125, naver_presale_no: null,
    })];

    const result = matchPresaleToApt(row, apts);
    expect(result).toBeNull();
  });

  // lat=NaN → Tier 3 if(lat && lng) 가드에서 걸림
  it("lat이 NaN이면 Tier 3을 건너뛴다", () => {
    const row = toPresaleRow(
      createComplexResponse({ build_nm: "가나다라마바사" }),
      null, createListItem()
    );
    row._name = "가나다라마바사";
    row._enrich = { lat: NaN, lng: 126.9, bjd_code: "9999999999" };
    const apts = [createApartment({
      bjd_code: "8888888888", name: "완전다른이름",
      lat: 37.548, lng: 126.912, naver_presale_no: null, region: "제주",
    })];

    const result = matchPresaleToApt(row, apts);
    expect(result).toBeNull();
  });
});

// ── parsePresaleAddress 특수 주소 ────────────────────────────

describe("parsePresaleAddress 특수 주소", () => {
  // 세종특별자치시
  it("세종특별자치시를 정확히 파싱한다", () => {
    const result = parsePresaleAddress("세종특별자치시 어진동 123");
    expect(result.region).toBe("세종");
  });

  // 제주특별자치도
  it("제주특별자치도를 정확히 파싱한다", () => {
    const result = parsePresaleAddress("제주특별자치도 제주시 연동 456");
    expect(result.region).toBe("제주");
  });
});

// ── toPresaleRow 충돌 필드 우선순위 ──────────────────────────

describe("toPresaleRow 필드 충돌", () => {
  // complex와 detail 모두 dong_cnt 값이 있을 때 complex 우선
  it("complex↔detail 충돌 시 complex 값을 우선한다", () => {
    const complex = createComplexResponse({ dong_cnt: 5, parking_cnt: 200 });
    const detail = { dong_cnt: 3, parking_cnt: 150, inquiry_tel: "02-1234-5678" };
    const row = toPresaleRow(complex, detail, createListItem());

    // complex 우선 (presale_buildings = complex.dong_cnt ?? detail.dong_cnt)
    expect(row.presale_buildings).toBe(5);
    expect(row.presale_parking).toBe(200);
    // detail fallback (complex에 sell_office_phone 없으면 detail.inquiry_tel)
    expect(row.presale_inquiry).toBe("02-1234-5678");
  });
});

// ── extractPresaleFields ─────────────────────────────────────

describe("extractPresaleFields", () => {
  // presale_* 및 naver_presale_* 필드만 추출하고 _enrich/_name 제외
  it("presale/naver_presale 필드 21개만 추출하고 메타데이터를 제외한다", () => {
    const row = toPresaleRow(createComplexResponse(), null, createListItem());
    row._name = "테스트아파트";
    const picked = extractPresaleFields(row);

    // presale_* + naver_presale_* 키만 존재
    const keys = Object.keys(picked);
    expect(keys.every(k => k.startsWith("presale_") || k.startsWith("naver_presale"))).toBe(true);
    // _enrich, _name 미포함
    expect(picked._enrich).toBeUndefined();
    expect(picked._name).toBeUndefined();
    // 최소 19개 presale 필드 + 2 naver_presale
    expect(keys.length).toBeGreaterThanOrEqual(19);
  });
});

// ── buildNewApartment ────────────────────────────────────────

describe("buildNewApartment", () => {
  // ID 형식 검증: ap-{presaleNo}
  it("ID가 ap-{presaleNo} 형식이다", () => {
    const complex = createComplexResponse();
    const row = toPresaleRow(complex, null, createListItem());
    row._name = complex.build_nm;
    const apt = buildNewApartment(row, complex, "서울");

    expect(apt.id).toBe("ap-6025041");
    expect(apt.id).toMatch(/^ap-\d+$/);
  });

  // unit_source = "naver_presale"
  it("unit_source가 naver_presale이다", () => {
    const complex = createComplexResponse();
    const row = toPresaleRow(complex, null, createListItem());
    row._name = complex.build_nm;
    const apt = buildNewApartment(row, complex, "서울");

    expect(apt.unit_source).toBe("naver_presale");
    expect(apt.name).toBe("테스트아파트");
    expect(apt.units).toBe(300);
  });
});
