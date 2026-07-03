// @ts-check
/**
 * collect-applyhome-seed.mjs 단위 테스트 (세션 466)
 * 대상: mapRow / filterCandidates / findDuplicate / dedupeWithinBatch / geocodeAddr
 */
import { describe, it, expect } from "vitest";
import {
  mapRow, filterCandidates, findDuplicate, dedupeWithinBatch, geocodeAddr, parseAddress,
} from "./collect-applyhome-seed.mjs";

/** @param {Record<string, unknown>} overrides */
function makeRaw(overrides = {}) {
  return {
    HOUSE_MANAGE_NO: "2026910168",
    HOUSE_NM: "해운대 마티안 디 에디션",
    HSSPLY_ADRES: "부산광역시 해운대구 중동 1615번지 일원",
    TOT_SUPLY_HSHLDCO: "26",
    RCRIT_PBLANC_DE: "2026-07-01",
    SUBSCRPT_AREA_CODE: "200",
    SUBSCRPT_AREA_CODE_NM: "부산광역시",
    BSNS_MBY_NM: "지에스건설(주)",
    MVN_PREARNGE_YM: "202811",
    PBLANC_URL: "https://www.applyhome.co.kr/x",
    HOUSE_SECD_NM: "무순위",
    ...overrides,
  };
}

// ── mapRow ─────────────────────────────────────────────────
describe("mapRow", () => {
  it("정상 행 → ah-* INSERT 행 (주소 파싱 + 회차분 unsold + rate 100)", () => {
    const apt = /** @type {any} */ (mapRow(makeRaw()));
    expect(apt.id).toBe("ah-2026910168");
    expect(apt.name).toBe("해운대 마티안 디 에디션");
    expect(apt.region).toBe("부산");
    expect(apt.gu).toBe("해운대구");
    expect(apt.dong).toBe("중동");
    expect(apt.address).toContain("해운대구");
    expect(apt.units).toBe(26);
    expect(apt.unsold).toBe(26);
    expect(apt.unsold_rate).toBe(100);
    expect(apt.announcement_url).toBe("https://www.applyhome.co.kr/x");
    expect(apt.unit_source).toBe("applyhome");
    expect(apt.lat).toBe(null);
    expect(apt._recruitDate).toBe("2026-07-01");
  });

  it("주소 파싱 실패 시 SUBSCRPT_AREA_CODE_NM 폴백", () => {
    const apt = /** @type {any} */ (mapRow(makeRaw({ HSSPLY_ADRES: null })));
    expect(apt.region).toBe("부산");
    expect(apt.address).toBe(null);
  });

  it("지역명 폴백도 없으면 SUBSCRPT_AREA_CODE 코드 폴백", () => {
    const apt = /** @type {any} */ (mapRow(makeRaw({ HSSPLY_ADRES: null, SUBSCRPT_AREA_CODE_NM: null, SUBSCRPT_AREA_CODE: "600" })));
    expect(apt.region).toBe("울산");
  });

  it("region 도출 전부 실패 → null (NOT NULL 위반 사전 차단)", () => {
    expect(mapRow(makeRaw({ HSSPLY_ADRES: "이상한 주소", SUBSCRPT_AREA_CODE_NM: null, SUBSCRPT_AREA_CODE: null }))).toBe(null);
  });

  it("HOUSE_MANAGE_NO 또는 HOUSE_NM 없으면 null", () => {
    expect(mapRow(makeRaw({ HOUSE_MANAGE_NO: "" }))).toBe(null);
    expect(mapRow(makeRaw({ HOUSE_NM: "" }))).toBe(null);
  });

  it("TOT_SUPLY_HSHLDCO 0/누락 → units 0, unsold null, rate null", () => {
    const apt = /** @type {any} */ (mapRow(makeRaw({ TOT_SUPLY_HSHLDCO: null })));
    expect(apt.units).toBe(0);
    expect(apt.unsold).toBe(null);
    expect(apt.unsold_rate).toBe(null);
  });
});

describe("parseAddress", () => {
  it("시도 정식명 → 약칭, gu/dong 규칙", () => {
    expect(parseAddress("경기도 남양주시 오남읍 양지리")).toEqual({ region: "경기", gu: "남양주시", dong: "오남읍" });
  });
  it("gu 자리가 번지 등 비정상 → gu/dong null", () => {
    const r = parseAddress("서울특별시 123-4번지");
    expect(r.region).toBe("서울");
    expect(r.gu).toBe(null);
    expect(r.dong).toBe(null);
  });
});

// ── filterCandidates ───────────────────────────────────────
describe("filterCandidates", () => {
  const SINCE = "2026-03-14";

  it("로스터 부재 + 공고일 >= since 만 통과 (경계일 포함)", () => {
    const rows = [
      makeRaw({ HOUSE_MANAGE_NO: "1", RCRIT_PBLANC_DE: "2026-03-14" }), // 경계 포함
      makeRaw({ HOUSE_MANAGE_NO: "2", RCRIT_PBLANC_DE: "2026-03-13" }), // 이전 제외
      makeRaw({ HOUSE_MANAGE_NO: "3", RCRIT_PBLANC_DE: "2026-07-01" }), // 로스터 존재 제외
    ];
    const { candidates, skippedExisting, skippedOld } = filterCandidates(rows, new Set(["ah-3"]), SINCE);
    expect(candidates.map((r) => String(r.HOUSE_MANAGE_NO))).toEqual(["1"]);
    expect(skippedExisting).toBe(1);
    expect(skippedOld).toBe(1);
  });

  it("같은 HOUSE_MANAGE_NO 중복 행은 1회만", () => {
    const rows = [makeRaw({ HOUSE_MANAGE_NO: "9" }), makeRaw({ HOUSE_MANAGE_NO: "9" })];
    const { candidates } = filterCandidates(rows, new Set(), SINCE);
    expect(candidates.length).toBe(1);
  });

  it("공고일 필드 없는 행은 skip 카운트", () => {
    const rows = [makeRaw({ HOUSE_MANAGE_NO: "1", RCRIT_PBLANC_DE: null }), makeRaw({ HOUSE_MANAGE_NO: "2" })];
    const { candidates, skippedNoDate } = filterCandidates(rows, new Set(), SINCE);
    expect(candidates.length).toBe(1);
    expect(skippedNoDate).toBe(1);
  });

  it("공고일 파싱 실패 50% 초과 → throw (API 형식 변경 가드)", () => {
    const rows = [
      makeRaw({ HOUSE_MANAGE_NO: "1", RCRIT_PBLANC_DE: "20260701" }),
      makeRaw({ HOUSE_MANAGE_NO: "2", RCRIT_PBLANC_DE: null }),
      makeRaw({ HOUSE_MANAGE_NO: "3" }),
    ];
    expect(() => filterCandidates(rows, new Set(), SINCE)).toThrow(/날짜 형식 변경/);
  });
});

// ── findDuplicate (좌표 정밀 판정 게이트) ──────────────────
describe("findDuplicate", () => {
  /** @param {Record<string, unknown>} o */
  const cand = (o = {}) => /** @type {any} */ ({
    id: "ah-1", name: "청계 노르웨이숲", region: "서울", gu: "중구", dong: null,
    address: "서울특별시 중구", lat: 37.5695, lng: 127.0204, units: 10, unsold: 10,
    unsold_rate: 100, builder: null, completion: null, announcement_url: null,
    unit_source: "applyhome", _recruitDate: "2026-07-01", ...o,
  });
  const existing = [
    { id: "ap-100", name: "청계노르웨이숲", region: "서울", lat: 37.5697, lng: 127.0206 }, // 동일 단지 (수십 m)
    { id: "ap-200", name: "완전다른이름아파트", region: "서울", lat: 37.5, lng: 127.0 },
  ];

  it("이름 유사 + 500m 이내 → skip (같은 아파트)", () => {
    const v = findDuplicate(cand(), existing);
    expect(v.action).toBe("skip");
    expect(/** @type {any} */ (v).matchedId).toBe("ap-100");
  });

  it("이름 유사해도 500m 초과 → insert (동명 이단지)", () => {
    const v = findDuplicate(cand({ lat: 37.62, lng: 127.10 }), existing); // 수 km 밖
    expect(v.action).toBe("insert");
  });

  it("이름 유사도 미달 → insert", () => {
    const v = findDuplicate(cand({ name: "전혀상관없는단지명칭" }), existing);
    expect(v.action).toBe("insert");
  });

  it("이름 유사 + 후보 좌표 없음 → defer (판정 불가 보류)", () => {
    const v = findDuplicate(cand({ lat: null, lng: null }), existing);
    expect(v.action).toBe("defer");
  });

  it("이름 유사해도 region 불일치 → insert (동명이지역 게이트)", () => {
    const v = findDuplicate(cand({ region: "부산" }), existing);
    expect(v.action).toBe("insert");
  });

  it("기존 행 좌표 없음 → defer", () => {
    const v = findDuplicate(cand(), [{ id: "ah-9", name: "청계노르웨이숲", region: "서울", lat: null, lng: null }]);
    expect(v.action).toBe("defer");
  });
});

// ── dedupeWithinBatch ──────────────────────────────────────
describe("dedupeWithinBatch", () => {
  /** @param {Record<string, unknown>} o */
  const cand = (o = {}) => /** @type {any} */ ({
    id: "ah-1", name: "같은단지 아파트", region: "경기", gu: null, dong: null,
    address: null, lat: 37.28, lng: 127.03, units: 5, unsold: 5, unsold_rate: 100,
    builder: null, completion: null, announcement_url: null,
    unit_source: "applyhome", _recruitDate: "2026-05-01", ...o,
  });

  it("신규끼리 같은 단지(이름 유사 + 근접) → 공고일 최신 1건만 유지", () => {
    const { kept, dropped } = dedupeWithinBatch([
      cand({ id: "ah-1", _recruitDate: "2026-05-01" }),
      cand({ id: "ah-2", _recruitDate: "2026-06-20" }),
    ]);
    expect(kept.map((c) => c.id)).toEqual(["ah-2"]);
    expect(dropped.length).toBe(1);
    expect(dropped[0].keptId).toBe("ah-2");
  });

  it("다른 단지끼리는 전부 유지", () => {
    const { kept, dropped } = dedupeWithinBatch([
      cand({ id: "ah-1", name: "가나다 아파트" }),
      cand({ id: "ah-2", name: "전혀다른 단지명", lat: 35.1, lng: 129.0 }),
    ]);
    expect(kept.length).toBe(2);
    expect(dropped.length).toBe(0);
  });
});

// ── geocodeAddr (search 주입) ──────────────────────────────
describe("geocodeAddr", () => {
  it("주소 검색 1차 성공", async () => {
    const search = async () => ({ lat: 37.5, lng: 127.0 });
    expect(await geocodeAddr("서울 중구 신당동 1", search)).toEqual({ lat: 37.5, lng: 127.0 });
  });

  it("1차 실패 → '일원' 꼬리 제거 재시도", async () => {
    /** @type {string[]} */
    const queries = [];
    const search = async (/** @type {string} */ q) => {
      queries.push(q);
      return q === "부산광역시 해운대구 중동 1615번지" ? { lat: 35.16, lng: 129.16 } : null;
    };
    const r = await geocodeAddr("부산광역시 해운대구 중동 1615번지 일원", search);
    expect(r).toEqual({ lat: 35.16, lng: 129.16 });
    expect(queries.length).toBe(2);
  });

  it("주소 검색 전부 실패 → 키워드 폴백", async () => {
    const search = async (/** @type {string} */ _q, /** @type {string} */ ep) =>
      ep === "keyword" ? { lat: 36.0, lng: 128.0 } : null;
    expect(await geocodeAddr("경북 어딘가 123", search)).toEqual({ lat: 36.0, lng: 128.0 });
  });

  it("주소 null → null (검색 호출 0)", async () => {
    const search = async () => { throw new Error("호출되면 안 됨"); };
    expect(await geocodeAddr(null, search)).toBe(null);
  });
});
