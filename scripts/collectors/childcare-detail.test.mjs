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

const { parseChildcareDetailXml, mergeDetailIntoFacility, isNetworkError } = await import("./childcare-detail.mjs");

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
    // resume skip 키 — main L249 if (fac.crtypename) 가 보는 키
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
