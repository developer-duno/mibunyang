// @ts-check
/**
 * collect-applyhome-seed.mjs 단위 테스트 (세션 466)
 * 대상: mapRow / filterCandidates / findDuplicate / dedupeWithinBatch / geocodeAddr
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

  it("★ 주소 검색 전부 실패 → null, 호출은 주소검색 2회뿐 (키워드는 여기서 안 부른다 — 세션541)", async () => {
    // 청약홈 공급주소는 블록식("…덕은도시개발구역 A4블록")이 흔한데 그걸 키워드로 던지면
    // 지역명이 지배해 **다른 단지**(DMC자이더리버) 좌표가 1위로 잡혔다. 키워드는
    // `geocodeApartmentByName` 이 단지명으로 게이트를 걸어 따로 한다.
    // 옛 코드는 여기서 3번째 호출(키워드 폴백)이 있었다 — 호출 수가 2 를 넘으면 그게 되살아난 것.
    /** @type {string[]} */
    const queries = [];
    const search = async (/** @type {string} */ q) => { queries.push(q); return null; };
    expect(await geocodeAddr("경북 어딘가 123 일원", search)).toBe(null);
    expect(queries).toEqual(["경북 어딘가 123 일원", "경북 어딘가 123"]);
  });

  it("주소 null → null (검색 호출 0)", async () => {
    const search = async () => { throw new Error("호출되면 안 됨"); };
    expect(await geocodeAddr(null, search)).toBe(null);
  });
});

// ── 키워드 배선 가드 (세션541) ─────────────────────────────
/**
 * ⚠️ 주석을 걷어낸 사본에 돌린다 — 주석 처리된 옛 코드가 가드를 속이지 못하게
 * (`guards-must-be-mutation-tested.md`). 줄 주석은 **줄머리만** 지운다(코드 안 `https://…`
 * URL 이 잘려 검사 범위가 조용히 깎이는 것을 막는다).
 */
const SRC = readFileSync(fileURLToPath(new URL("./collect-applyhome-seed.mjs", import.meta.url)), "utf8")
  .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, " ")
  .replace(/(?<!\*)\/\*[\s\S]*?\*\//g, " ")
  .replace(/^[ \t]*\/\/.*$/gm, " ");

const OLD_KEYWORD_FALLBACK = 'search(trimmed || addr, "keyword")';

describe("지오코딩 배선 — 주소는 주소검색, 키워드는 게이트 통과분만", () => {
  it("검사 대상이 주석 제거 후에도 남아 있다", () => {
    expect(SRC).toContain("geocodeApartmentByName");
    expect(SRC).toContain("_kakao-poi.mjs");
  });

  // ⚠️ import 검사를 정규식 리터럴로 쓰면 `audit-declared-deps` 가 이스케이프를 패키지 이름으로
  //    오검출한다(실측 exit 1). 상대경로 문자열은 그 감사가 건너뛴다.
  it("★ 단지명 키워드는 공유 게이트를 거친다", () => {
    expect(SRC).toContain('from "./_kakao-poi.mjs"');
    expect(SRC).toMatch(/const byName = await geocodeApartmentByName\(/);
  });

  // 세션541: geocode-missing 쪽 뮤테이션(M-E)에서 `gu` 를 빼도 초록이었던 사각을 여기서도 막는다 —
  // gu 가 빠지면 시군구 게이트 없이 시도만 남는다. 인자 형태를 고정한다.
  it("★ 호출부가 단지명·시도·시군구를 셋 다 넘긴다", () => {
    expect(SRC).toMatch(/geocodeApartmentByName\(\s*\{ name: cand\.name, sido: cand\.region, gu: cand\.gu \}/);
  });

  it("★ geocodeAddr 의 무검증 키워드 폴백이 부활하지 않았다", () => {
    expect(SRC).not.toContain(OLD_KEYWORD_FALLBACK);
  });

  // 세션541 2차: 주소검색 1위도 그냥 받으면 안 된다. 청약홈 공급주소는 지번 없는 표기가
  // 흔한데, 그런 질의에 카카오는 `address_type: REGION`(동/구 **중심점**)을 준다 —
  // geocode-missing 에서 없앤 자리표시와 같은 것이다. 정밀도 검사가 빠지면 red.
  it("★ 주소검색 1위를 그대로 받지 않는다 — isPreciseGeocode 로 중심점을 거른다", () => {
    expect(SRC).toMatch(/isPreciseGeocode\(doc, query\)/);
  });

  // 키워드는 반드시 `_kakao-poi.mjs` 게이트를 거친다 — 이 파일이 keyword.json 을 직접 부르면
  // 게이트를 우회하는 무검증 1위 채택이 되살아난 것이다(철자를 바꿔도 걸린다).
  it("★ 키워드(keyword.json)를 직접 부르지 않는다", () => {
    expect(SRC).not.toContain("keyword.json");
  });
});
