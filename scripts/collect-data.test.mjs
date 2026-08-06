// @vitest-environment node
/**
 * collect-data.mjs 순수 함수 테스트
 * 대상: resolveBuilder, isValidGu, parseAddress, mapItem, getLawdCd (5개)
 * estimateCreditGrade는 dart-builders.test.mjs에 13케이스 기존재 → 제외
 *
 * NOTE: // @vitest-environment node 어노테이션 필수 — 이 어노테이션이 없으면
 *   vi.mock("fs") 가 collect-data.mjs 내부의 ESM static import writeFileSync 를
 *   가로채지 못해 supabaseOnlyMode 테스트가 실제 public/data/*.json 을 오염시킴.
 *   environmentMatchGlobs("node") 로는 불충분 — 파일 단위 어노테이션 필요.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// writeFileSync 호이스트 스파이 — supabaseOnlyMode 테스트에서 실제 파일 오염 차단
// mockCreateClient — supabaseOnlyMode 테스트에서 per-test 설정 가능한 createClient 스파이
const { writeFileSpy, mockCreateClient } = vi.hoisted(() => ({
  writeFileSpy: vi.fn(),
  mockCreateClient: vi.fn(),
}));

// 모듈 초기화 부수효과 차단
vi.mock("@supabase/supabase-js", () => ({ createClient: mockCreateClient }));
vi.mock("./collectors/_shared.mjs", async (importOriginal) => {
  const orig = await importOriginal();
  return { ...orig, loadEnv: vi.fn() };
});
// fs.writeFileSync 스텁 — 실제 public/data/*.json 오염 차단 (supabaseOnlyMode 테스트 전용)
// @vitest-environment node 어노테이션이 있어야 collect-data.mjs ESM binding 에도 적용됨
vi.mock("fs", async () => {
  const real = /** @type {any} */ (await vi.importActual("fs"));
  return { ...real, writeFileSync: writeFileSpy };
});

const {
  resolveBuilder, isValidGu, parseAddress, mapItem, getLawdCd,
  AREA_CODE_REGION, BUILDER_ALIASES, VALID_REGIONS, GU_LAWD_MAP, REGION_LAWD_PREFIX,
  supabaseOnlyMode,
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

  // 세션 445: 청약홈 회차 공급분(작은 units)이 분모로 들어가 100% 초과 폭발 → 무력화(null).
  //   용인 칸타빌 (임의공급 3차) 실측: units=3 unsold=39 → 1300% → null.
  it("회차 폭발값(>100%)은 unsoldRate=null 무력화 (unsold 수는 보존)", () => {
    const apt = mapItem(createApplyhomeItem({
      TOT_SUPLY_HSHLDCO: "3",
      REMNDR_HSHLDCO: "39",
    }), 0, false);
    expect(apt.unsold).toBe(39);   // unsold 수 자체는 보존 (미분양 단지 식별용)
    expect(apt.unsoldRate).toBeNull(); // 1300% → 무력화
  });

  it("정확히 100%는 유지 (전량 미분양 = 가능값)", () => {
    const apt = mapItem(createApplyhomeItem({
      TOT_SUPLY_HSHLDCO: "50",
      REMNDR_HSHLDCO: "50",
    }), 0, false);
    expect(apt.unsoldRate).toBe(100);
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
// getLawdCd — 법정동코드 매핑 (28케이스: 기본9 + 중복키 해소 검증19)
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

  // ── 중복 키 해소 검증 (중첩 구조 전환 후) ──
  // 중구 — 6개 지역
  it("서울 중구 → 11140", () => {
    expect(getLawdCd("서울", "중구")).toBe("11140");
  });
  it("부산 중구 → 26110", () => {
    expect(getLawdCd("부산", "중구")).toBe("26110");
  });
  it("인천 중구 → 28110", () => {
    expect(getLawdCd("인천", "중구")).toBe("28110");
  });
  it("대구 중구 → 27110", () => {
    expect(getLawdCd("대구", "중구")).toBe("27110");
  });
  it("대전 중구 → 30140", () => {
    expect(getLawdCd("대전", "중구")).toBe("30140");
  });
  it("울산 중구 → 31110", () => {
    expect(getLawdCd("울산", "중구")).toBe("31110");
  });

  // 동구 — 5개 지역
  it("부산 동구 → 26170", () => {
    expect(getLawdCd("부산", "동구")).toBe("26170");
  });
  it("인천 동구 → 28120", () => {
    expect(getLawdCd("인천", "동구")).toBe("28120");
  });
  it("대구 동구 → 27140", () => {
    expect(getLawdCd("대구", "동구")).toBe("27140");
  });
  it("대전 동구 → 30110", () => {
    expect(getLawdCd("대전", "동구")).toBe("30110");
  });
  it("울산 동구 → 31170", () => {
    expect(getLawdCd("울산", "동구")).toBe("31170");
  });

  // 서구 — 4개 지역
  it("부산 서구 → 26140", () => {
    expect(getLawdCd("부산", "서구")).toBe("26140");
  });
  it("인천 서구 → 28260", () => {
    expect(getLawdCd("인천", "서구")).toBe("28260");
  });
  it("대전 서구 → 30170", () => {
    expect(getLawdCd("대전", "서구")).toBe("30170");
  });

  // 남구/북구 — 대표 검증
  it("부산 남구 → 26290", () => {
    expect(getLawdCd("부산", "남구")).toBe("26290");
  });
  it("광주 북구 → 29170", () => {
    expect(getLawdCd("광주", "북구")).toBe("29170");
  });

  // 강서구 — 서울/부산 구분
  it("서울 강서구 → 11500", () => {
    expect(getLawdCd("서울", "강서구")).toBe("11500");
  });
  it("부산 강서구 → 26440", () => {
    expect(getLawdCd("부산", "강서구")).toBe("26440");
  });

  // null 가드
  it("gu가 null이면 prefix 폴백", () => {
    expect(getLawdCd("서울", null)).toBe("11000");
  });
  it("gu가 undefined이면 prefix 폴백", () => {
    expect(getLawdCd("서울", undefined)).toBe("11000");
  });
});

// ============================================================
// 상수 검증 (5케이스)
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

  it("GU_LAWD_MAP은 17개 region 중첩 구조", () => {
    expect(Object.keys(GU_LAWD_MAP)).toHaveLength(17);
    expect(GU_LAWD_MAP["서울"]).toBeDefined();
    expect(GU_LAWD_MAP["서울"]["강남구"]).toBe("11680");
    expect(GU_LAWD_MAP["경남"]).toBeDefined();
    expect(GU_LAWD_MAP["제주"]["서귀포시"]).toBe("50130");
  });

  it("GU_LAWD_MAP 각 region의 코드는 5자리 문자열", () => {
    for (const [region, guMap] of Object.entries(GU_LAWD_MAP)) {
      for (const [gu, code] of Object.entries(guMap)) {
        expect(code).toMatch(/^\d{5}$/);
      }
    }
  });
});

// ============================================================
// supabaseOnlyMode (3케이스)
// ============================================================
describe("supabaseOnlyMode", () => {
  beforeEach(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    writeFileSpy.mockReset();
    mockCreateClient.mockReset();
    vi.restoreAllMocks();
    // vi.resetModules() 제거 — @vitest-environment node + 상단 top-level import 로 대체.
    // vi.doMock + vi.resetModules 패턴은 fs mock 을 무력화시키므로 사용 금지.
  });

  it("SUPABASE_URL/ANON_KEY 없으면 process.exit(1)", async () => {
    // env 없으면 supabaseOnlyMode 은 process.exit(1) 즉시 호출
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit called");
    });
    await expect(supabaseOnlyMode()).rejects.toThrow("exit called");
    expect(exitSpy).toHaveBeenCalledWith(1);
    // fs.writeFileSync 는 exit 이전에 도달하지 않음 — 방어적 확인
    expect(writeFileSpy).not.toHaveBeenCalled();
  });

  it("apartments_flat SELECT 결과로 4 JSON 파일 출력 + 외부 fetch 0회", async () => {
    process.env.SUPABASE_URL = "https://test.supabase.co";
    process.env.SUPABASE_ANON_KEY = "test-anon";

    // global fetch mock — 호출되면 fail
    const fetchSpy = vi.fn(() => Promise.reject(new Error("fetch must not be called")));
    vi.stubGlobal("fetch", fetchSpy);

    // supabase client mock — apartments_flat 1565 rows (>= MIN_COUNT, 회귀 가드도 통과)
    const mockRows = Array.from({ length: 1565 }, (_, i) => ({
      id: `ah-${i}`,
      name: `테스트단지${i}`,
      region: "서울",
      count: 100,
      psr: 1.0,
      pir: 5.0,
      dataReliability: 80,
      priceByArea: { 84: 50000 },
      rentByArea: null,
      jeonseByArea: null,
      priceByFloor: null,
    }));

    // selectAll 이 호출하는 queryFn(client).range() 가 데이터 반환
    const rangeMock = vi.fn().mockResolvedValueOnce({ data: mockRows, error: null }).mockResolvedValue({ data: [], error: null });
    const selectMock = vi.fn(() => ({ range: rangeMock }));
    const fromMock = vi.fn(() => ({ select: selectMock }));
    mockCreateClient.mockReturnValue({ from: fromMock });

    await supabaseOnlyMode();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(fromMock).toHaveBeenCalledWith("apartments_flat");

    // 19 파일 write 호출 확인 (apartments/list/meta 3 + 상세 버킷 16, 세션 468 → PR2 로 prices 제외)
    // (실제 디스크 쓰기 0회 — vi.mock("fs") 스파이가 가로챔)
    expect(writeFileSpy).toHaveBeenCalledTimes(19);
    const callPaths = writeFileSpy.mock.calls.map(c => c[0]);
    expect(callPaths.some(p => String(p).endsWith("apartments.json"))).toBe(true);
    expect(callPaths.some(p => String(p).endsWith("apartments-list.json"))).toBe(true);
    // PR2(세션 495) — 구 prices 파일은 더 이상 생성하지 않는다(가격배열은 상세 버킷이 싣는다).
    expect(callPaths.some(p => String(p).endsWith("apartments-prices.json"))).toBe(false);
    expect(callPaths.some(p => String(p).endsWith("meta.json"))).toBe(true);
    // 상세 버킷 16개 — 0·15 존재 + 총 16개
    expect(callPaths.some(p => String(p).endsWith("apartments-detail-16-0.json"))).toBe(true);
    expect(callPaths.some(p => String(p).endsWith("apartments-detail-16-15.json"))).toBe(true);
    expect(callPaths.filter(p => /apartments-detail-16-\d+\.json$/.test(String(p)))).toHaveLength(16);

    // meta.json write 의 body 검증 (JSON.stringify 결과에서 count + supabaseOnly 추출)
    const metaCall = writeFileSpy.mock.calls.find(c => String(c[0]).endsWith("meta.json"));
    const meta = JSON.parse(metaCall[1]);
    expect(meta.count).toBe(1565);
    expect(meta.phases.supabaseOnly).toEqual({ ok: true, count: 1565 });
  });

  it("count < 1000 이면 회귀 가드 fail (process.exit(1))", async () => {
    process.env.SUPABASE_URL = "https://test.supabase.co";
    process.env.SUPABASE_ANON_KEY = "test-anon";

    const mockRows = Array.from({ length: 500 }, (_, i) => ({ id: `ah-${i}` }));
    const rangeMock = vi.fn().mockResolvedValueOnce({ data: mockRows, error: null }).mockResolvedValue({ data: [], error: null });
    const fromMock = vi.fn(() => ({ select: () => ({ range: rangeMock }) }));
    mockCreateClient.mockReturnValue({ from: fromMock });

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit called");
    });

    await expect(supabaseOnlyMode()).rejects.toThrow("exit called");
    expect(exitSpy).toHaveBeenCalledWith(1);
    // fs.writeFileSync 는 exit 이전에 도달하지 않음 — 방어적 확인
    expect(writeFileSpy).not.toHaveBeenCalled();
  });

  it("동적 임계값: 12% 초과 감소 시 회귀 가드 발동 (세션 311)", async () => {
    process.env.SUPABASE_URL = "https://test.supabase.co";
    process.env.SUPABASE_ANON_KEY = "test-anon";

    // 시나리오: 이전 1424 → 신규 1224 (diff -200, 임계값 max(150, ceil(1224*0.12))=150 초과)
    const mockRows = Array.from({ length: 1224 }, (_, i) => ({ id: `ah-${i}` }));
    const rangeMock = vi.fn().mockResolvedValueOnce({ data: mockRows, error: null }).mockResolvedValue({ data: [], error: null });
    const fromMock = vi.fn(() => ({ select: () => ({ range: rangeMock }) }));
    mockCreateClient.mockReturnValue({ from: fromMock });

    // 실측 public/data/apartments.json (count=1424, git tracked) 가 existsSync=true 박힘 →
    // JSON.parse(real fs readFileSync) 박힘 → prevCount=1424, diff=-200 → 임계값 -150 초과 → exit(1)
    // process.exit 가 throw 박힘이라 catch 블록 박힘 → call.length 직접 검증 (rejects.toThrow 불가)
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit called");
    });

    await supabaseOnlyMode();
    expect(exitSpy).toHaveBeenCalledWith(1);
    // writeOutputs 도달 0 (catch 후 후속 흐름 진행 박힘이지만 mockRows 만 박힘 검증)
  });

  it("동적 임계값: 12% 이내 감소 시 통과 (세션 311)", async () => {
    process.env.SUPABASE_URL = "https://test.supabase.co";
    process.env.SUPABASE_ANON_KEY = "test-anon";

    // 시나리오: 이전 1424 → 신규 1340 (-84, 5.9% < 12% → 통과)
    const mockRows = Array.from({ length: 1340 }, (_, i) => ({
      id: `ah-${i}`,
      priceByArea: null,
      rentByArea: null,
      jeonseByArea: null,
      priceByFloor: null,
    }));
    const rangeMock = vi.fn().mockResolvedValueOnce({ data: mockRows, error: null }).mockResolvedValue({ data: [], error: null });
    const fromMock = vi.fn(() => ({ select: () => ({ range: rangeMock }) }));
    mockCreateClient.mockReturnValue({ from: fromMock });

    // 19 JSON write 박힘 (3 + 상세 버킷 16, 회귀 가드 통과 → writeOutputs 도달, 세션 468 → PR2 로 prices 제외)
    await supabaseOnlyMode();
    expect(writeFileSpy).toHaveBeenCalledTimes(19);
  });
});
