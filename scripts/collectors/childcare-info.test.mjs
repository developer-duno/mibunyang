// @ts-check
/**
 * childcare-info.mjs 테스트 — cpmsapi021 XML 파싱 / 시군구 집계 / GU_LAWD_MAP 답습 (세션 252 W6-D 옵션 ε)
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return { ...orig, loadEnv: vi.fn(), getMibuyangSupabase: vi.fn(), getSupabase: vi.fn() };
});

const { parseChildcareXml, aggregateChildcare, listAllSgg, assertNoErrorCode, pickLatestPerKey, mergePreserveCoords } = await import("./childcare-info.mjs");

describe("parseChildcareXml", () => {
  // sample 응답 박제 (2026-05-16 실 API 호출 서울 종로구 arcode=11110 응답)
  // 기술문서 spec (crtelno/crfaxno) 환각 정정 = 실제 응답은 crtel/crfax (no `no` suffix)
  const sampleXml = `<response>
    <item>
      <stcode>11110000013</stcode>
      <crname>아동회관어린이집</crname>
      <crtel>02-763-6038</crtel>
      <crfax>050-5845-6038</crfax>
      <craddr>서울특별시 종로구 지봉로13길 14</craddr>
      <crhome></crhome>
      <crcapat>65</crcapat>
    </item>
    <item>
      <stcode>11110000014</stcode>
      <crname>부암어린이집</crname>
      <crtel>02-396-6226</crtel>
      <crfax>02-396-6227</crfax>
      <craddr>서울특별시 종로구 세검정로6다길 10-7</craddr>
      <crhome>https://buarm.kidsnote.ac</crhome>
      <crcapat>92</crcapat>
    </item>
    <item>
      <stcode>45190000025</stcode>
      <crname>우주가정어린이집</crname>
      <crtel>063-635-1054</crtel>
      <crfax>063-635-1054</crfax>
      <craddr>전라북도 남원시 오들1길 20</craddr>
      <crhome />
      <crcapat>19</crcapat>
    </item>
  </response>`;

  it("3건 정상 파싱", () => {
    const items = parseChildcareXml(sampleXml);
    expect(items).toHaveLength(3);
  });

  it("첫 item 7필드 추출 자리", () => {
    const items = parseChildcareXml(sampleXml);
    const it0 = items[0];
    expect(it0.stcode).toBe("11110000013");
    expect(it0.crname).toBe("아동회관어린이집");
    expect(it0.crtel).toBe("02-763-6038");
    expect(it0.crfax).toBe("050-5845-6038");
    expect(it0.craddr).toBe("서울특별시 종로구 지봉로13길 14");
    expect(it0.crhome).toBe("");
    expect(it0.crcapat).toBe(65);
  });

  it("crcapat number 자리 = parseInt", () => {
    const items = parseChildcareXml(sampleXml);
    expect(items[1].crcapat).toBe(92);
    expect(items[2].crcapat).toBe(19);
  });

  it("빈 태그 (<crhome />) 자리 = '' fallback", () => {
    const items = parseChildcareXml(sampleXml);
    expect(items[2].crhome).toBe("");
  });

  it("응답 0건 자리 = []", () => {
    const empty = `<response></response>`;
    expect(parseChildcareXml(empty)).toEqual([]);
  });

  it("stcode 또는 crname 부재 시 skip", () => {
    const partial = `<response>
      <item>
        <crname>이름만</crname>
        <crcapat>50</crcapat>
      </item>
      <item>
        <stcode>11111111111</stcode>
        <crname>정상 어린이집</crname>
        <crcapat>30</crcapat>
      </item>
    </response>`;
    const items = parseChildcareXml(partial);
    expect(items).toHaveLength(1);
    expect(items[0].crname).toBe("정상 어린이집");
  });

  it("crcapat 부재 자리 = 0 fallback", () => {
    const noCapat = `<response>
      <item>
        <stcode>99999999999</stcode>
        <crname>정원미박제</crname>
      </item>
    </response>`;
    const items = parseChildcareXml(noCapat);
    expect(items[0].crcapat).toBe(0);
  });
});

describe("aggregateChildcare", () => {
  /** @type {any} */
  const items = [
    { stcode: "A", crname: "A어린이집", crtel: "", crfax: "", craddr: "", crhome: "", crcapat: 50 },
    { stcode: "B", crname: "B어린이집", crtel: "", crfax: "", craddr: "", crhome: "", crcapat: 30 },
    { stcode: "C", crname: "C어린이집", crtel: "", crfax: "", craddr: "", crhome: "", crcapat: 0 },
  ];

  it("count = items.length", () => {
    const agg = aggregateChildcare(items, "2026-05-16");
    expect(agg.count).toBe(3);
  });

  it("total_capacity = sum(crcapat)", () => {
    const agg = aggregateChildcare(items, "2026-05-16");
    expect(agg.total_capacity).toBe(80);
  });

  it("facilities 자리 = items raw 보존", () => {
    const agg = aggregateChildcare(items, "2026-05-16");
    expect(agg.facilities).toHaveLength(3);
    expect(agg.facilities[0].crcapat).toBe(50);
  });

  it("fetched_at 자리 = 입력값 그대로", () => {
    const agg = aggregateChildcare(items, "2026-05-16");
    expect(agg.fetched_at).toBe("2026-05-16");
  });

  it("빈 items 자리 = count 0, total_capacity 0", () => {
    const agg = aggregateChildcare([], "2026-05-16");
    expect(agg.count).toBe(0);
    expect(agg.total_capacity).toBe(0);
    expect(agg.facilities).toEqual([]);
  });
});

describe("listAllSgg", () => {
  it("전체 시군구 250+ 자리", () => {
    const list = listAllSgg();
    expect(list.length).toBeGreaterThan(240);
  });

  it("서울 종로구 11110 자리 포함", () => {
    const list = listAllSgg();
    const jongno = list.find(s => s.region === "서울" && s.gu === "종로구");
    expect(jongno).toBeDefined();
    expect(jongno?.arcode).toBe("11110");
  });

  it("세종 자리 = 세종시 36110", () => {
    const list = listAllSgg();
    const sejong = list.find(s => s.region === "세종");
    expect(sejong?.gu).toBe("세종시");
    expect(sejong?.arcode).toBe("36110");
  });

  it("arcode 5자 형식 자리", () => {
    const list = listAllSgg();
    for (const s of list) {
      expect(s.arcode).toMatch(/^\d{5}$/);
    }
  });
});

describe("assertNoErrorCode", () => {
  it("정상 item 응답 = 통과 (결과코드 없음)", () => {
    const ok = `<response><item><stcode>11110000001</stcode><crname>가</crname></item></response>`;
    expect(() => assertNoErrorCode(ok)).not.toThrow();
  });

  it("INFO-200 (검색결과 없음) = 통과 (정상 0건)", () => {
    const empty = `<response><resultCode>INFO-200</resultCode></response>`;
    expect(() => assertNoErrorCode(empty)).not.toThrow();
  });

  it("INFO-300 (일 요청 초과) = throw", () => {
    const over = `<response><resultCode>INFO-300</resultCode></response>`;
    expect(() => assertNoErrorCode(over)).toThrow(/INFO-300/);
  });

  it("INFO-400 (키 만료) = throw", () => {
    const expired = `<response><resultCode>INFO-400</resultCode></response>`;
    expect(() => assertNoErrorCode(expired)).toThrow(/INFO-400/);
  });

  it("INFO-100 (인증키 무효) = throw", () => {
    const badKey = `<response><resultCode>INFO-100</resultCode></response>`;
    expect(() => assertNoErrorCode(badKey)).toThrow(/INFO-100/);
  });

  it("ERROR-100 (필수항목 누락) = throw", () => {
    const err = `<response><code>ERROR-100</code></response>`;
    expect(() => assertNoErrorCode(err)).toThrow(/ERROR-100/);
  });

  it("태그명에 무관 — 본문 어디에 있어도 탐지", () => {
    const loose = `오류: INFO-300 일 요청 건수를 초과하였습니다`;
    expect(() => assertNoErrorCode(loose)).toThrow(/INFO-300/);
  });
});

describe("pickLatestPerKey", () => {
  it("같은 (region,gu) 다중 스냅샷 → 최신 recorded_at id 1개만", () => {
    const regions = [
      { id: 1, region: "경기", gu: "남양주시", recorded_at: "2026-01-01" },
      { id: 2, region: "경기", gu: "남양주시", recorded_at: "2026-03-01" },
      { id: 3, region: "경기", gu: "남양주시", recorded_at: "2026-02-01" },
    ];
    const map = pickLatestPerKey(regions);
    expect(map.size).toBe(1);
    expect(map.get("경기|남양주시")?.id).toBe(2);  // 2026-03-01 = 최신
    expect(map.get("경기|남양주시")?.recorded_at).toBe("2026-03-01");
  });

  it("단일 행 → 그 id", () => {
    const map = pickLatestPerKey([{ id: 7, region: "서울", gu: "종로구", recorded_at: "2026-05-01" }]);
    expect(map.get("서울|종로구")?.id).toBe(7);
  });

  it("빈 입력 → 빈 Map", () => {
    expect(pickLatestPerKey([]).size).toBe(0);
  });

  it("gu null (시도 집계행) 제외 — childcare 는 시군구 단위만", () => {
    const regions = [
      { id: 10, region: "서울", gu: null, recorded_at: "2026-05-01" },
      { id: 11, region: "서울", gu: "강남구", recorded_at: "2026-05-01" },
    ];
    const map = pickLatestPerKey(regions);
    expect(map.size).toBe(1);
    expect(map.has("서울|강남구")).toBe(true);
  });
});

describe("mergePreserveCoords", () => {
  // 신규 집계 (cpmsapi021 7필드, 좌표 없음)
  const newAgg = {
    count: 2,
    total_capacity: 100,
    facilities: [
      { stcode: "11110000013", crname: "아동회관어린이집(개명)", crtel: "02-111", crfax: "", craddr: "서울 종로구 1", crhome: "", crcapat: 40 },
      { stcode: "11110000099", crname: "신규어린이집", crtel: "02-999", crfax: "", craddr: "서울 종로구 9", crhome: "", crcapat: 60 },
    ],
    fetched_at: "2026-06-04",
  };
  // 기존 최신행 (childcare-detail 이 11110000013 에 좌표/70필드 보강해둠)
  const prevChildcare = {
    count: 1,
    total_capacity: 30,
    facilities: [
      { stcode: "11110000013", crname: "아동회관어린이집", crtel: "02-111-OLD", crfax: "", craddr: "서울 종로구 1", crhome: "", crcapat: 30, la: "37.5", lo: "126.9", crtypename: "국공립", cctvinstlcnt: 5 },
    ],
    fetched_at: "2026-05-01",
  };

  it("stcode 일치 시 기존 좌표·70필드 보존 + 7필드는 신규값 갱신", () => {
    const merged = /** @type {any} */ (mergePreserveCoords(newAgg, prevChildcare));
    const f = merged.facilities.find((/** @type {any} */ x) => x.stcode === "11110000013");
    // 기존 추가 필드 보존
    expect(f.la).toBe("37.5");
    expect(f.lo).toBe("126.9");
    expect(f.crtypename).toBe("국공립");
    expect(f.cctvinstlcnt).toBe(5);
    // 7필드는 신규값으로 갱신
    expect(f.crname).toBe("아동회관어린이집(개명)");
    expect(f.crtel).toBe("02-111");
    expect(f.crcapat).toBe(40);
  });

  it("신규 시설 (기존에 없던 stcode) 은 7필드만 — 좌표 없음", () => {
    const merged = /** @type {any} */ (mergePreserveCoords(newAgg, prevChildcare));
    const f = merged.facilities.find((/** @type {any} */ x) => x.stcode === "11110000099");
    expect(f.crname).toBe("신규어린이집");
    expect(f.la).toBeUndefined();
    expect(f.crtypename).toBeUndefined();
  });

  it("count/total_capacity/fetched_at 는 항상 신규 집계값", () => {
    const merged = mergePreserveCoords(newAgg, prevChildcare);
    expect(merged.count).toBe(2);
    expect(merged.total_capacity).toBe(100);
    expect(merged.fetched_at).toBe("2026-06-04");
  });

  it("prevChildcare null → newAgg 그대로 (신규 시설만)", () => {
    const merged = /** @type {any} */ (mergePreserveCoords(newAgg, null));
    expect(merged.facilities).toHaveLength(2);
    expect(merged.facilities[0].la).toBeUndefined();
  });

  it("prevChildcare.facilities 없음 → newAgg 그대로", () => {
    const merged = mergePreserveCoords(newAgg, /** @type {any} */ ({ count: 0, total_capacity: 0, fetched_at: "2026-05-01" }));
    expect(merged.facilities).toHaveLength(2);
  });
});
