// @ts-check
/**
 * childcare-info.mjs 테스트 — cpmsapi021 XML 파싱 / 시군구 집계 / GU_LAWD_MAP 답습 (세션 252 W6-D 옵션 ε)
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return { ...orig, loadEnv: vi.fn(), getMibuyangSupabase: vi.fn(), getSupabase: vi.fn() };
});

const { parseChildcareXml, aggregateChildcare, listAllSgg } = await import("./childcare-info.mjs");

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
