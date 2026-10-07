// @ts-check
/**
 * childcare-detail.mjs 테스트 — cpmsapi030 XML 70 필드 파싱 / 7→70 필드 머지 (세션 255 W6-D2)
 *
 * sample XML 은 2026-05-16 운영키 실 API 호출 (서울 종로구 11110000013) 응답 형태 답습.
 * 운영 응답 태그 = 대표자명만 대문자 CRREPNAME, 나머지 72개 소문자. EM_CNT_A9 는 응답에 부재
 * (코드 EM_KEYS 16개 중 A9 는 0 fallback — graceful, test #7 커버).
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return { ...orig, loadEnv: vi.fn(), getMibuyangSupabase: vi.fn(), getSupabase: vi.fn() };
});

const {
  parseChildcareDetailXml,
  mergeDetailIntoFacility,
  isNetworkError,
  assertNoQuotaError,
  QuotaExceededError,
  buildDetailUrl,
  parseRegionDetailXml,
  mergeRegionDetails,
  decideRunStatus,
  selectLatestRegions,
  resolveArcode,
  planRegion,
  processRegion,
} = await import("./childcare-detail.mjs");

describe("parseChildcareDetailXml", () => {
  // cpmsapi030 응답 = 단일 item 블록 (1 stcode = 1 시설). 70 필드 현실값 sample.
  const sampleXml = `<response><item>
    <stcode>11110000013</stcode>
    <crname>아동회관어린이집</crname>
    <la>37.5812</la>
    <lo>127.0042</lo>
    <sidoname>서울특별시</sidoname>
    <sigunname>종로구</sigunname>
    <zipcode>03051</zipcode>
    <craddr>서울특별시 종로구 지봉로13길 14</craddr>
    <crtypename>국공립</crtypename>
    <crstatusname>정상</crstatusname>
    <crtelno>02-763-6038</crtelno>
    <crfaxno>050-5845-6038</crfaxno>
    <crhome></crhome>
    <CRREPNAME>홍길동</CRREPNAME>
    <nrtrroomcnt>6</nrtrroomcnt>
    <nrtrroomsize>320</nrtrroomsize>
    <plgrdco>1</plgrdco>
    <cctvinstlcnt>12</cctvinstlcnt>
    <chcrtescnt>2</chcrtescnt>
    <crcargbname>승합차</crcargbname>
    <crcapat>65</crcapat>
    <crchcnt>58</crchcnt>
    <crcnfmdt>1995-03-01</crcnfmdt>
    <crpausebegindt></crpausebegindt>
    <crpauseenddt></crpauseenddt>
    <crabldt></crabldt>
    <datastdrdt>2026-05-01</datastdrdt>
    <crspec>비고없음</crspec>
    <CLASS_CNT_00>1</CLASS_CNT_00>
    <CLASS_CNT_01>1</CLASS_CNT_01>
    <CLASS_CNT_02>1</CLASS_CNT_02>
    <CLASS_CNT_03>1</CLASS_CNT_03>
    <CLASS_CNT_04>1</CLASS_CNT_04>
    <CLASS_CNT_05>1</CLASS_CNT_05>
    <CLASS_CNT_M2>0</CLASS_CNT_M2>
    <CLASS_CNT_M3>0</CLASS_CNT_M3>
    <CLASS_CNT_M5>0</CLASS_CNT_M5>
    <CLASS_CNT_SP>0</CLASS_CNT_SP>
    <CLASS_CNT_TOT>6</CLASS_CNT_TOT>
    <CHILD_CNT_00>5</CHILD_CNT_00>
    <CHILD_CNT_01>8</CHILD_CNT_01>
    <CHILD_CNT_02>12</CHILD_CNT_02>
    <CHILD_CNT_03>14</CHILD_CNT_03>
    <CHILD_CNT_04>10</CHILD_CNT_04>
    <CHILD_CNT_05>9</CHILD_CNT_05>
    <CHILD_CNT_M2>0</CHILD_CNT_M2>
    <CHILD_CNT_M3>0</CHILD_CNT_M3>
    <CHILD_CNT_M5>0</CHILD_CNT_M5>
    <CHILD_CNT_SP>0</CHILD_CNT_SP>
    <CHILD_CNT_TOT>58</CHILD_CNT_TOT>
    <EM_CNT_0Y>3</EM_CNT_0Y>
    <EM_CNT_1Y>2</EM_CNT_1Y>
    <EM_CNT_2Y>1</EM_CNT_2Y>
    <EM_CNT_4Y>1</EM_CNT_4Y>
    <EM_CNT_6Y>1</EM_CNT_6Y>
    <EM_CNT_A1>1</EM_CNT_A1>
    <EM_CNT_A2>0</EM_CNT_A2>
    <EM_CNT_A3>0</EM_CNT_A3>
    <EM_CNT_A4>0</EM_CNT_A4>
    <EM_CNT_A5>0</EM_CNT_A5>
    <EM_CNT_A6>0</EM_CNT_A6>
    <EM_CNT_A7>0</EM_CNT_A7>
    <EM_CNT_A8>0</EM_CNT_A8>
    <EM_CNT_A9>0</EM_CNT_A9>
    <EM_CNT_A10>0</EM_CNT_A10>
    <EM_CNT_TOT>10</EM_CNT_TOT>
    <EW_CNT_00>2</EW_CNT_00>
    <EW_CNT_01>3</EW_CNT_01>
    <EW_CNT_02>1</EW_CNT_02>
    <EW_CNT_03>0</EW_CNT_03>
    <EW_CNT_04>0</EW_CNT_04>
    <EW_CNT_05>0</EW_CNT_05>
    <EW_CNT_M6>0</EW_CNT_M6>
    <EW_CNT_TOT>6</EW_CNT_TOT>
  </item></response>`;

  it("위치/기본 단일 필드 추출", () => {
    const d = parseChildcareDetailXml(sampleXml);
    expect(d?.stcode).toBe("11110000013");
    expect(d?.crname).toBe("아동회관어린이집");
    expect(d?.la).toBe("37.5812");
    expect(d?.lo).toBe("127.0042");
    expect(d?.crtypename).toBe("국공립");
    expect(d?.crstatusname).toBe("정상");
    expect(d?.crtelno).toBe("02-763-6038");
    expect(d?.crrepname).toBe("홍길동");
  });

  it("number 필드 parseInt", () => {
    const d = parseChildcareDetailXml(sampleXml);
    expect(d?.nrtrroomcnt).toBe(6);
    expect(d?.cctvinstlcnt).toBe(12);
    expect(d?.crcapat).toBe(65);
    expect(d?.crchcnt).toBe(58);
  });

  it("CLASS_CNT 11키 + CHILD_CNT 11키", () => {
    const d = parseChildcareDetailXml(sampleXml);
    expect(Object.keys(d?.class_cnt ?? {})).toHaveLength(11);
    expect(Object.keys(d?.child_cnt ?? {})).toHaveLength(11);
    expect(d?.class_cnt.TOT).toBe(6);
    expect(d?.child_cnt.TOT).toBe(58);
    expect(d?.child_cnt["03"]).toBe(14);
  });

  it("EM_CNT 16키 + EW_CNT 8키", () => {
    const d = parseChildcareDetailXml(sampleXml);
    expect(Object.keys(d?.em_cnt ?? {})).toHaveLength(16);
    expect(Object.keys(d?.ew_cnt ?? {})).toHaveLength(8);
    expect(d?.em_cnt.TOT).toBe(10);
    expect(d?.ew_cnt.TOT).toBe(6);
  });

  it("item 블록 부재 시 null", () => {
    expect(parseChildcareDetailXml("<response></response>")).toBeNull();
  });

  it("stcode/crname 부재 시 null", () => {
    const noStcode = `<response><item><crname>이름만</crname></item></response>`;
    expect(parseChildcareDetailXml(noStcode)).toBeNull();
  });

  it("누락 number 태그 = 0 fallback (폐원 시설 시뮬)", () => {
    // crstatusname=폐원 시설은 CLASS/CHILD/EM/EW 태그 부재 가능
    const closed = `<response><item>
      <stcode>11110000099</stcode>
      <crname>폐원어린이집</crname>
      <crstatusname>폐원</crstatusname>
    </item></response>`;
    const d = parseChildcareDetailXml(closed);
    expect(d?.crstatusname).toBe("폐원");
    expect(d?.crcapat).toBe(0);
    expect(d?.cctvinstlcnt).toBe(0);
    expect(d?.class_cnt.TOT).toBe(0);
    expect(d?.em_cnt.TOT).toBe(0);
  });

  it("빈 태그 → '' / 누락 string 태그 → null", () => {
    const d = parseChildcareDetailXml(sampleXml);
    // <crhome></crhome> 빈 태그 → ''
    expect(d?.crhome).toBe("");
    // sample 에 없는 string 태그 → null
    const minimal = `<response><item><stcode>11110000013</stcode><crname>최소</crname></item></response>`;
    const m = parseChildcareDetailXml(minimal);
    expect(m?.crtypename).toBeNull();
    expect(m?.la).toBeNull();
  });
});

describe("mergeDetailIntoFacility", () => {
  it("기존 crtel/crfax 보존 + crtypename(resume skip 키) 채움 + 배열 spread", () => {
    /** @type {import("./childcare-detail.mjs").ExistingFacility} */
    const facility = {
      stcode: "11110000013",
      crname: "아동회관어린이집",
      crtel: "02-763-6038",
      crfax: "050-5845-6038",
    };
    const detail = parseChildcareDetailXml(
      `<response><item>
        <stcode>11110000013</stcode>
        <crname>아동회관어린이집</crname>
        <crtypename>국공립</crtypename>
        <CLASS_CNT_TOT>6</CLASS_CNT_TOT>
        <EM_CNT_TOT>10</EM_CNT_TOT>
      </item></response>`
    );
    const merged = mergeDetailIntoFacility(facility, /** @type {any} */ (detail));
    // 기존 7 필드 중 살아남는 2개 (detail 이 나머지 덮어씀)
    expect(merged.crtel).toBe("02-763-6038");
    expect(merged.crfax).toBe("050-5845-6038");
    // 상세가 붙었다는 표시
    expect(merged.crtypename).toBe("국공립");
    // 70 필드 배열 spread
    expect(merged.class_cnt.TOT).toBe(6);
    expect(merged.em_cnt.TOT).toBe(10);
  });

  it("crtel/crfax undefined 시 '' fallback", () => {
    /** @type {import("./childcare-detail.mjs").ExistingFacility} */
    const facility = { stcode: "11110000013", crname: "이름" };
    const detail = parseChildcareDetailXml(
      `<response><item><stcode>11110000013</stcode><crname>이름</crname><crtypename>민간</crtypename></item></response>`
    );
    const merged = mergeDetailIntoFacility(facility, /** @type {any} */ (detail));
    expect(merged.crtel).toBe("");
    expect(merged.crfax).toBe("");
  });
});

describe("isNetworkError (circuit breaker 판정)", () => {
  it("fetch failed = 네트워크 실패 (해외 IP 차단 raw 로그 메시지)", () => {
    expect(isNetworkError("fetch failed")).toBe(true);
    expect(isNetworkError("세종 세종시 36110000291: fetch failed")).toBe(true);
  });

  it("재시도 소진 = 네트워크 실패 (fetchWithRetry 종결 메시지)", () => {
    expect(isNetworkError("fetchWithRetry: 3회 재시도 소진")).toBe(true);
  });

  it("Node 시스템 에러 코드 = 네트워크 실패", () => {
    for (const code of ["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"]) {
      expect(isNetworkError(`request to ... failed, reason: ${code}`)).toBe(true);
    }
  });

  it("timeout/aborted = 네트워크 실패 (AbortSignal.timeout)", () => {
    expect(isNetworkError("The operation was aborted due to timeout")).toBe(true);
    expect(isNetworkError("This operation was aborted")).toBe(true);
  });

  it("HTTP 4xx/5xx = 네트워크 실패 아님 (시설별 개별 사정 — circuit 대상 아님)", () => {
    expect(isNetworkError("HTTP 404")).toBe(false);
    expect(isNetworkError("HTTP 500")).toBe(false);
    expect(isNetworkError("응답 부재")).toBe(false);
    expect(isNetworkError("CHILDCARE_BASIC_API_KEY 환경변수 필요")).toBe(false);
  });
});

describe("assertNoQuotaError (INFO-300/400 전역 종료 신호)", () => {
  // 사고 답습(세션 400): 가드 부재 시 INFO-300 응답이 <item> 없어 null → "응답 부재 skip" 로 묻혀
  // 1000건 쿼터 초과가 success 로 기록됨(데이터 0건인데 모니터 정상). 실 응답 형태 답습.
  it("INFO-300 (일 요청 1000건 초과) = QuotaExceededError throw", () => {
    const xml = `<response><errmsg>일 요청 건수(1000건)를 초과하였습니다.</errmsg><errcode>INFO-300</errcode></response>`;
    expect(() => assertNoQuotaError(xml)).toThrow(QuotaExceededError);
    try {
      assertNoQuotaError(xml);
    } catch (e) {
      expect(/** @type {any} */ (e).code).toBe("INFO-300");
    }
  });

  it("INFO-400 (키 만료) = QuotaExceededError throw", () => {
    const xml = `<response><errcode>INFO-400</errcode></response>`;
    expect(() => assertNoQuotaError(xml)).toThrow(QuotaExceededError);
  });

  it("정상 detail 응답 (item 블록) = throw 없음", () => {
    const xml = `<response><item><stcode>11110000013</stcode><crname>정상</crname></item></response>`;
    expect(() => assertNoQuotaError(xml)).not.toThrow();
  });

  it("INFO-200 (검색결과 없음) = throw 없음 (시설 개별 사정, 응답 부재 skip 유지)", () => {
    // INFO-200 은 그 시설만 detail 없음 → null 반환 → "응답 부재 skip" 으로 처리되어야 함.
    const xml = `<response><errcode>INFO-200</errcode></response>`;
    expect(() => assertNoQuotaError(xml)).not.toThrow();
  });

  it("QuotaExceededError = name/code 보존", () => {
    const err = new QuotaExceededError("INFO-300");
    expect(err.name).toBe("QuotaExceededError");
    expect(err.code).toBe("INFO-300");
    expect(err).toBeInstanceOf(Error);
  });
});

// 세션606 — 시군구 단위 호출(arcode = GU_LAWD_MAP, stcode 없음) · 최신행만 · 상세만 merge · 0건 차단기
describe("buildDetailUrl — 시군구 하나 질의", () => {
  it("key 먼저, arcode 만 — stcode 는 질의에 없다(빈 값도 금지: 2u 실측 ERROR-100)", () => {
    const url = buildDetailUrl("K", "41480");
    expect(url).toBe("http://api.childcare.go.kr/mediate/rest/cpmsapi030/cpmsapi030/request?key=K&arcode=41480");
    expect(url).not.toMatch(/stcode/i);
  });
});

describe("parseRegionDetailXml — 시군구 응답의 <item> 전부", () => {
  const regionXml = `<response><item><stcode>41480000001</stcode><crname>가</crname><crtypename>국공립</crtypename><CRREPNAME>대표가</CRREPNAME><la>37.7</la></item>
<item><stcode>41480000002</stcode><crname>나</crname><crtypename>민간</crtypename></item>
<item><stcode>41480000003</stcode><crname>다</crname><crtypename>가정</crtypename></item>
<item><crname>번호없음</crname></item></response>`;
  it("블록마다 파싱 — 3건(stcode 없는 블록은 버림), 대문자 태그 그대로", () => {
    const ds = parseRegionDetailXml(regionXml);
    expect(ds.map((d) => d.stcode)).toEqual(["41480000001", "41480000002", "41480000003"]);
    expect(ds[0].crrepname).toBe("대표가");
    expect(ds[2].crtypename).toBe("가정");
  });
  it("INFO-200 0건 응답 → 빈 배열", () => {
    expect(parseRegionDetailXml("<response><errcode>INFO-200</errcode></response>")).toEqual([]);
  });
});

describe("mergeRegionDetails — 상세만 덧입힘(시설 추가·삭제 0) · 멱등", () => {
  const facilities = [
    { stcode: "A1", crname: "가", crtel: "02-1" },
    { stcode: "A2", crname: "나", crtel: "02-2" },
    { stcode: "A3", crname: "다", crtel: "02-3" },
  ];
  const details = /** @type {any[]} */ ([
    { stcode: "A1", crname: "가", crtypename: "국공립", class_cnt: { TOT: 3 } },
    { stcode: "A3", crname: "다", crtypename: "민간", class_cnt: { TOT: 1 } },
    { stcode: "ZZ", crname: "응답에만", crtypename: "가정", class_cnt: { TOT: 0 } },
  ]);
  it("응답에만 있는 시설은 더하지 않고, 응답에 없는 시설은 그대로 둔다", () => {
    const m = mergeRegionDetails(facilities, details);
    expect(m.facilities.map((f) => f.stcode)).toEqual(["A1", "A2", "A3"]);
    expect(m.matched).toBe(2);
    expect(m.facilities[1]).toBe(facilities[1]);
    expect(/** @type {any} */ (m.facilities[0]).crtypename).toBe("국공립");
    expect(/** @type {any} */ (m.facilities[0]).crtel).toBe("02-1");
    expect(m.changed).toBe(true);
  });
  it("같은 상세를 다시 덧입히면 바뀜 없음 — 키 순서가 달라도(jsonb 왕복)", () => {
    const first = mergeRegionDetails(facilities, details).facilities;
    const reordered = first.map((f) => Object.fromEntries(Object.entries(f).reverse()));
    const again = mergeRegionDetails(/** @type {any} */ (reordered), details);
    expect(again.changed).toBe(false);
  });
});

describe("decideRunStatus — (0건 + 실패) ÷ 시도 > 10% · 전역 종료 = failure", () => {
  const base = { attempted: 260, zeroRegions: 0, failedRegions: 0, updateFails: 0, stopReason: null, interrupted: false };
  it("260 중 27곳 0건 = failure / 26곳(정확히 10%) = success / 15곳 = success", () => {
    expect(decideRunStatus({ ...base, zeroRegions: 27 }).status).toBe("failure");
    expect(decideRunStatus({ ...base, zeroRegions: 26 }).status).toBe("success");
    expect(decideRunStatus({ ...base, zeroRegions: 15 }).status).toBe("success");
  });
  it("호출 실패도 분자에 — 실패 20 + 0건 10 = 30/260 → failure, 실패 30 단독도 failure", () => {
    const v = decideRunStatus({ ...base, failedRegions: 20, zeroRegions: 10 });
    expect(v.status).toBe("failure");
    expect(v.errorMessage).toMatch(/실패 20/);
    expect(decideRunStatus({ ...base, failedRegions: 30 }).status).toBe("failure");
  });
  it("분모는 응답 수가 아니라 시도 수 — 실패 10 + 0건 16 = 26/260(10%) → success (응답 250 으로 나누면 10.4%)", () => {
    expect(decideRunStatus({ ...base, failedRegions: 10, zeroRegions: 16 }).status).toBe("success");
  });
  it("전역 종료(연속 네트워크 실패 · INFO-300) = failure + 사유", () => {
    const net = decideRunStatus({ ...base, attempted: 5, failedRegions: 5, stopReason: "연속 네트워크 실패 5 시군구 전역 종료" });
    expect(net.status).toBe("failure");
    expect(net.errorMessage).toMatch(/전역 종료/);
    const quota = decideRunStatus({ ...base, attempted: 3, stopReason: "INFO-300 전역 종료" });
    expect(quota.status).toBe("failure");
  });
  it("UPDATE 실패 = failure · 정상 = success(errorMessage null) · 중단 신호 = partial", () => {
    expect(decideRunStatus({ ...base, updateFails: 1 }).status).toBe("failure");
    expect(decideRunStatus(base)).toEqual({ status: "success", errorMessage: null });
    expect(decideRunStatus({ ...base, interrupted: true }).status).toBe("partial");
  });
  it("시도 0 이면 비율 판정 안 함", () => {
    expect(decideRunStatus({ ...base, attempted: 0 }).status).toBe("success");
  });
});

describe("selectLatestRegions — (region, gu) 최신행만", () => {
  it("옛 recorded_at 행은 빠지고, 같은 날짜면 id 큰 쪽", () => {
    const rows = /** @type {any[]} */ ([
      { id: 1, region: "경기", gu: "파주시", recorded_at: "2026-09-01", childcare: null },
      { id: 5, region: "경기", gu: "파주시", recorded_at: "2026-10-01", childcare: null },
      { id: 2, region: "서울", gu: "강남구", recorded_at: "2026-10-01", childcare: null },
      { id: 7, region: "서울", gu: "강남구", recorded_at: "2026-10-01", childcare: null },
      { id: 9, region: "서울", gu: null, recorded_at: "2026-10-01", childcare: null },
    ]);
    expect(selectLatestRegions(rows).map((r) => r.id).sort((a, b) => a - b)).toEqual([5, 7]);
  });
});

describe("resolveArcode — GU_LAWD_MAP 코드(시설번호 앞자리 아님)", () => {
  it("파주 41480 · 구례 12730 · 일반구 수원시 장안구 41111", () => {
    expect(resolveArcode("경기", "파주시")).toBe("41480");
    expect(resolveArcode("전남", "구례군")).toBe("12730");
    expect(resolveArcode("경기", "수원시 장안구")).toBe("41111");
  });
  it("제주는 제주 수집기의 49xxx(탐침 10/07: 49110 270건 · 50110 INFO-200 0건)", () => {
    expect(resolveArcode("제주", "제주시")).toBe("49110");
    expect(resolveArcode("제주", "서귀포시")).toBe("49130");
  });
  it("표에 없으면 null — 프로토타입 키도 null", () => {
    expect(resolveArcode("경기", "없는시")).toBeNull();
    expect(resolveArcode("서울", "constructor")).toBeNull();
    expect(resolveArcode("경기", null)).toBeNull();
  });
});

describe("mergeDetailIntoFacility — 좌표 보존 · info 소유 7필드 유지 (세션606 보완)", () => {
  it("새 la/lo 가 빈 값·null 이면 옛 좌표를 지킨다", () => {
    const fac = { stcode: "A1", crname: "가", la: "37.77", lo: "126.78" };
    const m1 = mergeDetailIntoFacility(fac, /** @type {any} */ ({ stcode: "A1", crname: "가", la: "", lo: null }));
    expect(m1.la).toBe("37.77");
    expect(m1.lo).toBe("126.78");
    const m2 = mergeDetailIntoFacility(fac, /** @type {any} */ ({ stcode: "A1", crname: "가", la: "37.80", lo: "126.80" }));
    expect(m2.la).toBe("37.80");
  });
  it("info 소유 7필드는 기존 값 유지 — crname 이 다른 응답이 와도 바뀜 없음", () => {
    const fac = { stcode: "A1", crname: "가(목록)", crtel: "02-1", craddr: "목록 주소", crhome: "", crcapat: 40 };
    const detail = /** @type {any} */ ({ stcode: "A1", crname: "가(상세)", craddr: "상세 주소", crhome: "http://x", crcapat: 41, crtypename: "민간", class_cnt: { TOT: 2 } });
    const merged = mergeDetailIntoFacility(fac, detail);
    expect(merged.crname).toBe("가(목록)");
    expect(merged.craddr).toBe("목록 주소");
    expect(merged.crcapat).toBe(40);
    expect(merged.crtypename).toBe("민간");
    const again = mergeRegionDetails(/** @type {any} */ ([merged]), [{ ...detail, crname: "가(상세 바뀜)" }]);
    expect(again.changed).toBe(false);
  });
});

describe("mergeRegionDetails — 안쪽 값 경계", () => {
  it("class_cnt.TOT 하나만 바뀐 응답 → changed true", () => {
    const fac = [{ stcode: "A1", crname: "가" }];
    const d1 = /** @type {any} */ ({ stcode: "A1", crname: "가", crtypename: "민간", class_cnt: { TOT: 2, "00": 1 } });
    const first = mergeRegionDetails(fac, [d1]).facilities;
    const d2 = { ...d1, class_cnt: { TOT: 3, "00": 1 } };
    expect(mergeRegionDetails(/** @type {any} */ (first), [d2]).changed).toBe(true);
    expect(mergeRegionDetails(/** @type {any} */ (first), [d1]).changed).toBe(false);
  });
});

describe("planRegion · processRegion — 시군구 하나 처리(main 은 결과대로만)", () => {
  /** @param {string} region @param {string} gu @param {any[]} facilities */
  const row = (region, gu, facilities) => /** @type {any} */ ({ id: 1, region, gu, recorded_at: "2026-10-01", childcare: { facilities } });
  it("arcode 는 GU_LAWD_MAP 코드 — 시설번호 앞자리(40400)가 아니다", () => {
    const p = planRegion(row("경기", "파주시", [{ stcode: "40400000031", crname: "가" }]));
    expect(p).toEqual({ action: "call", arcode: "41480", facilities: [{ stcode: "40400000031", crname: "가" }] });
  });
  it("시설 0곳 = 호출 안 함(none) · 코드 없음 = noArcode", () => {
    expect(planRegion(row("경기", "파주시", [])).action).toBe("none");
    expect(planRegion(/** @type {any} */ ({ id: 1, region: "경기", gu: "파주시", recorded_at: "x", childcare: null })).action).toBe("none");
    expect(planRegion(row("경기", "없는시", [{ stcode: "1", crname: "가" }])).action).toBe("noArcode");
  });
  it("0건 응답 → zero true + 응답 코드, 시설 0곳이면 zero 로 세지 않는다", () => {
    const xml = "<response><errcode>INFO-200</errcode></response>";
    const z = processRegion({ facilities: [{ stcode: "A1", crname: "가" }], xml });
    expect(z.zero).toBe(true);
    expect(z.code).toBe("INFO-200");
    expect(z.changed).toBe(false);
    expect(processRegion({ facilities: [], xml }).zero).toBe(false);
  });
  it("정상 응답 → merged · changed", () => {
    const xml = "<response><item><stcode>A1</stcode><crname>가</crname><crtypename>민간</crtypename></item></response>";
    const out = processRegion({ facilities: [{ stcode: "A1", crname: "가" }, { stcode: "A2", crname: "나" }], xml });
    expect(out.zero).toBe(false);
    expect(out.parsed).toBe(1);
    expect(out.matched).toBe(1);
    expect(out.changed).toBe(true);
    expect(/** @type {any} */ (out.merged[0]).crtypename).toBe("민간");
    expect(out.merged).toHaveLength(2);
  });
});
