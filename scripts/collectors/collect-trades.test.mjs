// @ts-check
/**
 * collect-trades.mjs 테스트 — 법정동코드 조회, XML 파싱 검증
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 세션 503: fetchTradeRows 의 실패 집계를 검증하려면 외부 호출을 우리가 조종해야 한다.
const fetchMock = vi.fn();

// loadEnv + 외부 API 호출 방지
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return {
    ...orig,
    loadEnv: vi.fn(),
    getMibuyangSupabase: vi.fn(),
    getSupabase: vi.fn(),
    fetchWithRetry: (/** @type {unknown[]} */ ...a) => fetchMock(...a),
    sleep: vi.fn(), // 월당 200ms 대기 제거 (테스트 속도)
  };
});

const { getLawdCd, extractItems, getTag, TRADE_CONFIGS, buildApiUrl, parseOnlyFilter, fetchTradeRows, tradeRowGu,
  collectRegion, groupDealsByKey } = await import("./collect-trades.mjs");
const { GU_LAWD_CODES } = await import("./_shared.mjs");

describe("parseOnlyFilter (세션94 단계 C)", () => {
  it("--only=경기:화성시 → '경기:화성시'", () => {
    expect(parseOnlyFilter(["node", "collect-trades.mjs", "--only=경기:화성시"])).toBe("경기:화성시");
  });
  it("플래그 없음 → null", () => {
    expect(parseOnlyFilter(["node", "collect-trades.mjs", "--months=6"])).toBeNull();
  });
  it(":누락 시 throw (9 GATE 5 해소)", () => {
    expect(() => parseOnlyFilter(["node", "collect-trades.mjs", "--only=경기"])).toThrow(/형식 오류/);
  });
});

describe("getLawdCd", () => {
  // 정상 매핑 — 중첩 구조 region 내 직접 조회
  it("서울 강남구 → 11680", () => {
    expect(getLawdCd("서울", "강남구")).toBe("11680");
  });

  // 경기도 시군구 — region 내 직접 조회
  it("경기 화성시 → 41591", () => {
    expect(getLawdCd("경기", "화성시")).toBe("41591");
  });

  // 동명이구 — 부산 해운대구 (중첩 구조로 정확한 매칭)
  it("부산 해운대구 → 26350", () => {
    expect(getLawdCd("부산", "해운대구")).toBe("26350");
  });

  // 존재하지 않는 시군구 → 시도 prefix + "000" fallback
  it("서울의 미지 구는 시도 코드 '11000'을 반환한다", () => {
    expect(getLawdCd("서울", "없는구")).toBe("11000");
  });

  // 완전 미지 지역 → null
  it("존재하지 않는 시도는 null을 반환한다", () => {
    expect(getLawdCd("미지시도", "미지구")).toBeNull();
  });
});

describe("extractItems", () => {
  // 정상 XML에서 item 추출
  it("XML에서 item 요소를 추출한다", () => {
    const xml = `
      <response><body><items>
        <item><거래금액>50000</거래금액><건축년도>2020</건축년도></item>
        <item><거래금액>60000</거래금액><건축년도>2021</건축년도></item>
      </items></body></response>`;
    const items = extractItems(xml);
    expect(items).toHaveLength(2);
    expect(items[0]).toContain("50000");
  });

  // 빈 XML
  it("item이 없는 XML은 빈 배열을 반환한다", () => {
    expect(extractItems("<response><body></body></response>")).toEqual([]);
  });

  // 빈 문자열
  it("빈 문자열은 빈 배열을 반환한다", () => {
    expect(extractItems("")).toEqual([]);
  });
});

describe("getTag", () => {
  const item = "<item><거래금액>50000</거래금액><건축년도>2020</건축년도></item>";

  // 정상 태그 추출
  it("지정 태그의 값을 추출한다", () => {
    expect(getTag(item, "거래금액")).toBe("50000");
    expect(getTag(item, "건축년도")).toBe("2020");
  });

  // 존재하지 않는 태그
  it("존재하지 않는 태그는 빈 문자열을 반환한다", () => {
    expect(getTag(item, "없는태그")).toBe("");
  });

  // 공백 포함 값은 trim
  it("태그 값의 앞뒤 공백을 제거한다", () => {
    const item2 = "<item><거래금액>  50000  </거래금액></item>";
    expect(getTag(item2, "거래금액")).toBe("50000");
  });
});

describe("AptTradeDev XML 파싱", () => {
  // AptTradeDev API 응답의 신규 필드 파싱 검증
  const devItem = `<item><aptNm>현대비젼21</aptNm><dealAmount>40,000</dealAmount><excluUseAr>33.1</excluUseAr><floor>24</floor><buildYear>1999</buildYear><umdNm>도곡동</umdNm><dealingGbn>직거래</dealingGbn><cdealDay> </cdealDay><buyerGbn>개인</buyerGbn><slerGbn>개인</slerGbn><dealDay>19</dealDay></item>`;

  it("aptNm(아파트명)을 추출한다", () => {
    expect(getTag(devItem, "aptNm")).toBe("현대비젼21");
  });

  it("dealingGbn(거래유형)을 추출한다", () => {
    expect(getTag(devItem, "dealingGbn")).toBe("직거래");
  });

  it("cdealDay(해제일) 공백은 빈 문자열로 반환된다", () => {
    // cdealDay가 공백이면 trim 후 빈 문자열 → cancel_date는 null 처리
    expect(getTag(devItem, "cdealDay")).toBe("");
  });

  it("cdealDay(해제일)에 값이 있으면 추출한다", () => {
    const cancelItem = `<item><cdealDay>26.03.20</cdealDay></item>`;
    expect(getTag(cancelItem, "cdealDay")).toBe("26.03.20");
  });

  it("기존 필드(dealAmount, excluUseAr, floor)는 동일하게 파싱된다", () => {
    expect(getTag(devItem, "dealAmount")).toBe("40,000");
    expect(getTag(devItem, "excluUseAr")).toBe("33.1");
    expect(getTag(devItem, "floor")).toBe("24");
  });
});

describe("SilvTrade XML 파싱", () => {
  // 분양권전매 API 응답 파싱 검증
  const silvItem = `<item><aptNm>동탄역 롯데캐슬</aptNm><dealAmount>55,000</dealAmount><excluUseAr>84.99</excluUseAr><floor>15</floor><buildYear>2024</buildYear><umdNm>오산동</umdNm></item>`;

  it("분양권전매 aptNm 추출", () => {
    expect(getTag(silvItem, "aptNm")).toBe("동탄역 롯데캐슬");
  });

  it("분양권전매 기본 필드 파싱", () => {
    expect(getTag(silvItem, "dealAmount")).toBe("55,000");
    expect(getTag(silvItem, "excluUseAr")).toBe("84.99");
    expect(getTag(silvItem, "floor")).toBe("15");
  });
});

// ── TRADE_CONFIGS 구조 검증 ─────────────────────────────────
describe("TRADE_CONFIGS", () => {
  // 3가지 타입 모두 존재
  it("sale, jeonse, presale 3가지 타입이 존재한다", () => {
    expect(Object.keys(TRADE_CONFIGS)).toEqual(["sale", "jeonse", "presale"]);
  });

  // 각 타입에 필수 키 존재
  for (const [type, config] of Object.entries(TRADE_CONFIGS)) {
    it(`${type}: 필수 키(endpoint, label, priceTag, validate, buildRow)가 존재한다`, () => {
      expect(config.endpoint).toBeTruthy();
      expect(config.label).toBeTruthy();
      expect(config.priceTag).toBeTruthy();
      expect(typeof config.validate).toBe("function");
      expect(typeof config.buildRow).toBe("function");
    });
  }

  // sale에만 fallbackEndpoint 존재
  it("sale에만 fallbackEndpoint가 있다", () => {
    expect(TRADE_CONFIGS.sale.fallbackEndpoint).toBeTruthy();
    expect(TRADE_CONFIGS.jeonse.fallbackEndpoint).toBeUndefined();
    expect(TRADE_CONFIGS.presale.fallbackEndpoint).toBeUndefined();
  });

  // presale에만 skipUnregistered 존재
  it("presale에만 skipUnregistered가 true이다", () => {
    expect(TRADE_CONFIGS.presale.skipUnregistered).toBe(true);
    expect(TRADE_CONFIGS.sale.skipUnregistered).toBeUndefined();
  });
});

// ── buildApiUrl 검증 ────────────────────────────────────────
describe("buildApiUrl", () => {
  it("올바른 URL을 생성한다", () => {
    const url = buildApiUrl("https://apis.data.go.kr/test/api", "11680", "202603");
    expect(url).toContain("serviceKey=");
    expect(url).toContain("LAWD_CD=11680");
    expect(url).toContain("DEAL_YMD=202603");
    expect(url).toContain("numOfRows=9999");
  });
});

// ── TRADE_CONFIGS.buildRow 검증 ─────────────────────────────
describe("TRADE_CONFIGS.buildRow", () => {
  /** 테스트용 base 행 팩토리 */
  function makeBase() {
    return { region: "서울", gu: "강남구", dong: "역삼동", deal_month: "202603", area: 84.99, price: 50000, floor: 10, build_year: 2020 };
  }

  it("sale: 비폴백 시 apt_name, dealing_type, cancel_date 포함", () => {
    const item = `<item><aptNm>래미안</aptNm><dealingGbn>중개</dealingGbn><cdealDay>26.03.01</cdealDay></item>`;
    const row = TRADE_CONFIGS.sale.buildRow(item, makeBase(), false);
    expect(row.trade_type).toBe("sale");
    expect(row.apt_name).toBe("래미안");
    expect(row.dealing_type).toBe("중개");
    expect(row.cancel_date).toBe("26.03.01");
    expect(row.deposit).toBeNull();
  });

  it("sale: 폴백 시 apt_name, dealing_type, cancel_date 미포함", () => {
    const item = `<item></item>`;
    const row = TRADE_CONFIGS.sale.buildRow(item, makeBase(), true);
    expect(row.apt_name).toBeUndefined();
    expect(row.dealing_type).toBeUndefined();
    expect(row.cancel_date).toBeUndefined();
  });

  it("jeonse: deposit = price와 동일", () => {
    const row = /** @type {any} */ (TRADE_CONFIGS.jeonse.buildRow)("<item/>", makeBase());
    expect(row.trade_type).toBe("jeonse");
    expect(row.deposit).toBe(50000);
  });

  it("presale: apt_name 포함, deposit null", () => {
    const item = `<item><aptNm>동탄역 캐슬</aptNm></item>`;
    const row = /** @type {any} */ (TRADE_CONFIGS.presale.buildRow)(item, makeBase());
    expect(row.trade_type).toBe("presale");
    expect(row.apt_name).toBe("동탄역 캐슬");
    expect(row.deposit).toBeNull();
  });
});

// ── TRADE_CONFIGS.validate 검증 ─────────────────────────────
describe("TRADE_CONFIGS.validate", () => {
  it("sale: price > 0 && area > 0 이면 true", () => {
    expect(/** @type {any} */ (TRADE_CONFIGS.sale.validate)(50000, 84.99)).toBe(true);
    expect(/** @type {any} */ (TRADE_CONFIGS.sale.validate)(0, 84.99)).toBe(false);
    expect(/** @type {any} */ (TRADE_CONFIGS.sale.validate)(50000, 0)).toBe(false);
  });

  it("jeonse: deposit > 0 && monthlyRent === 0 && area > 0 이면 true", () => {
    // monthlyRent=0인 순수 전세만 수집
    const pureJeonse = "<item><monthlyRent>0</monthlyRent></item>";
    const monthly = "<item><monthlyRent>50</monthlyRent></item>";
    expect(TRADE_CONFIGS.jeonse.validate(30000, 60, pureJeonse)).toBe(true);
    expect(TRADE_CONFIGS.jeonse.validate(30000, 60, monthly)).toBe(false);
    expect(TRADE_CONFIGS.jeonse.validate(0, 60, pureJeonse)).toBe(false);
  });

  it("presale: price > 0 && area > 0 이면 true", () => {
    expect(/** @type {any} */ (TRADE_CONFIGS.presale.validate)(55000, 84.99)).toBe(true);
    expect(/** @type {any} */ (TRADE_CONFIGS.presale.validate)(0, 84.99)).toBe(false);
  });
});

// ── 세션 503: 수집 0건의 두 가지 뜻을 구분한다 ──
// 2026-08-06 회차가 2시간 31분 동안 전 호출 `fetch failed` 로 0건을 받고도 워크플로가 **초록불**로
// 끝나 실거래가 2개월 공백이 아무도 모르게 지나갔다. 실패를 세지 않으면 "부를 게 없어 0건"과
// "전부 실패해서 0건"이 구분되지 않는다.
describe("fetchTradeRows — API 실패 집계 (세션 503)", () => {
  it("호출이 전부 실패하면 실패 횟수를 월 수만큼 센다 (수집 0건이어도)", async () => {
    fetchMock.mockRejectedValue(new Error("fetch failed"));
    const r = await fetchTradeRows(
      "11110",
      ["202607", "202606", "202605"],
      "sale",
      { region: "서울", gu: "종로구" },
      new Set(),
      false
    );
    expect(r.rows).toEqual([]);
    expect(r.apiCalls).toBe(0);
    expect(r.apiFails).toBe(3); // ← 이 줄이 "조용한 0건"을 막는 근거
  });

  it("정상 응답이면 실패는 0 이다 (거짓 경보 차단)", async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => "<response><body><items></items></body></response>" });
    const r = await fetchTradeRows(
      "11110",
      ["202607"],
      "sale",
      { region: "서울", gu: "종로구" },
      new Set(),
      false
    );
    expect(r.apiFails).toBe(0);
  });
});

// ── 세션550: 세종 행의 gu 가 null 이면 고유 인덱스가 영영 충돌하지 않는다 ──
// Postgres 고유 인덱스는 NULL 을 서로 다른 값으로 보므로, gu=null 로 저장된 세종 거래는
// upsert 의 ON CONFLICT 가 한 번도 안 걸려 **회차마다 같은 거래가 새 행으로** 들어갔다
// (2026-09-20 실측 68,352행 = 실제 11,812건). 손님 화면 "세종 6개월 10,916건"이 그래서 부풀었다.
describe("tradeRowGu — 세종 gu 채움 (세션550)", () => {
  it("세종은 gu 가 없어도 '세종시' 로 저장한다", () => {
    expect(tradeRowGu("세종", null)).toBe("세종시");
    expect(tradeRowGu("세종", undefined)).toBe("세종시");
    expect(tradeRowGu("세종", "")).toBe("세종시");
  });

  it("gu 가 있으면 그대로 쓴다 (세종 포함)", () => {
    expect(tradeRowGu("서울", "강남구")).toBe("강남구");
    expect(tradeRowGu("세종", "세종시")).toBe("세종시");
  });

  it("세종이 아닌 지역의 빈 gu 는 null 그대로 — 이 변경은 세종만 건드린다", () => {
    expect(tradeRowGu("경기", null)).toBeNull();
    expect(tradeRowGu("부산", undefined)).toBeNull();
  });

  it("GU_LAWD_MAP·regions 와 같은 표기라 LAWD_CD 조회가 그대로 된다", () => {
    expect(getLawdCd("세종", tradeRowGu("세종", null))).toBe("36110");
  });
});

// 헬퍼만 맞아도 **행 만드는 자리가 그 헬퍼를 안 쓰면** 소용이 없다 — 실제 수집 경로로 확인한다.
describe("fetchTradeRows — 세종 행은 gu 가 절대 null 이 아니다 (세션550)", () => {
  const sejongXml = `<response><body><items>
    <item><aptNm>세종더숲</aptNm><excluUseAr>84.99</excluUseAr><dealAmount>50,000</dealAmount><floor>10</floor><buildYear>2020</buildYear><umdNm>아름동</umdNm></item>
    <item><aptNm>세종파크</aptNm><excluUseAr>59.97</excluUseAr><dealAmount>40,000</dealAmount><floor>7</floor><buildYear>2018</buildYear><umdNm>종촌동</umdNm></item>
  </items></body></response>`;

  it("regionGuPairs 의 {세종, gu:null} 로 수집해도 저장 행의 gu 는 '세종시'", async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => sejongXml });
    const r = await fetchTradeRows("36110", ["202608"], "sale", { region: "세종", gu: null }, new Set(), false);
    expect(r.rows).toHaveLength(2);
    for (const row of r.rows) {
      expect(row.gu).not.toBeNull();
      expect(row.gu).toBe("세종시");
    }
  });

  it("회차 안 중복 제거 키도 저장값 기준 — 같은 거래를 두 번 담지 않는다", async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => sejongXml });
    const seen = new Set();
    const first = await fetchTradeRows("36110", ["202608"], "sale", { region: "세종", gu: null }, seen, false);
    const second = await fetchTradeRows("36110", ["202608"], "sale", { region: "세종", gu: null }, seen, false);
    expect(first.rows).toHaveLength(2);
    expect(second.rows).toHaveLength(0);
  });

  it("upsert 충돌 키(region,gu,deal_month,area,price,floor,trade_type)에 null 이 없다", async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => sejongXml });
    const r = await fetchTradeRows("36110", ["202608"], "sale", { region: "세종", gu: null }, new Set(), false);
    for (const row of r.rows) {
      const conflictKey = [row.region, row.gu, row.deal_month, row.area, row.price, row.floor, row.trade_type];
      expect(conflictKey.some((v) => v == null)).toBe(false);
    }
  });

  it("세종이 아닌 지역은 옛 동작 그대로 (gu 가 그대로 실린다)", async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => sejongXml });
    const r = await fetchTradeRows("11110", ["202608"], "sale", { region: "서울", gu: "종로구" }, new Set(), false);
    expect(r.rows.every((row) => row.gu === "종로구")).toBe(true);
  });
});

// ── 세션589: 같은 응답으로 trade_deals 행도 만든다 (시세 비교 범위 좁히기 가) ──
// 픽스처 = 조사 2차가 받아 둔 실제 국토부 응답 사본(_trade-deals.test.mjs 머리 주석).
// trades 행 만들기·seen·validate 는 그대로 — 아래는 두 집합의 관계와 화성 4코드 순회를 본다.
describe("fetchTradeRows · collectRegion — trade_deals (세션589)", () => {
  const FX = path.join(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__", "trade-deals");
  /** @param {string} name @returns {any[]} */
  const items = (name) => JSON.parse(readFileSync(path.join(FX, name), "utf8")).items;
  /** @param {any[]} list */
  const toXml = (list) => "<response><body><items>" +
    list.map((o) => "<item>" + Object.entries(o).map(([k, v]) => `<${k}>${v}</${k}>`).join("") + "</item>").join("") +
    "</items></body></response>";
  /** @param {string} xml */
  const respond = (xml) => fetchMock.mockImplementation(async () => ({ ok: true, text: async () => xml }));

  it("매매 사본: deals 50 ≥ rows · deals 는 apt_seq·umd_cd·sgg_cd 를 갖는다", async () => {
    respond(toXml(items("sale-11680-202608.json")));
    const r = await fetchTradeRows("11680", ["202608"], "sale", { region: "서울", gu: "강남구" }, new Set(), false);
    expect(r.deals).toHaveLength(50);
    expect(r.deals.length).toBeGreaterThanOrEqual(r.rows.length);
    expect(r.skippedOwnership).toBe(0);
    for (const d of r.deals) {
      expect(d.sgg_cd).toBe("11680");
      expect(d.apt_seq).toMatch(/^11680-/);
      expect(d.umd_cd).toMatch(/^\d{5}$/);
      expect(d.gu).toBe("강남구");
    }
  });

  it("trades 열쇠로 접히는 두 거래(같은 달·면적·값·층, 다른 단지)가 deals 에는 두 행", async () => {
    const a = { aptNm: "가단지", aptSeq: "11680-1", umdNm: "대치동", umdCd: "10600", jibun: "1", bonbun: "0001", bubun: "0000", dealAmount: "100,000", excluUseAr: "84.9", floor: "10", buildYear: "2000", dealDay: "3" };
    const b = { ...a, aptNm: "나단지", aptSeq: "11680-2", jibun: "2", bonbun: "0002", dealDay: "17" };
    respond(toXml([a, b]));
    const r = await fetchTradeRows("11680", ["202608"], "sale", { region: "서울", gu: "강남구" }, new Set(), false);
    expect(r.rows).toHaveLength(1);
    expect(r.deals).toHaveLength(2);
    expect(r.deals.map((d) => d.apt_seq)).toEqual(["11680-1", "11680-2"]);
  });

  it("전월세 사본: 월세 29행은 둘 다 없음 · 전세 deals 21 ≥ rows", async () => {
    respond(toXml(items("rent-11680-202608.json")));
    const r = await fetchTradeRows("11680", ["202608"], "jeonse", { region: "서울", gu: "강남구" }, new Set(), false);
    expect(r.deals).toHaveLength(21);
    expect(r.deals.length).toBeGreaterThanOrEqual(r.rows.length);
    expect(r.deals.every((d) => d.umd_cd === null && d.apt_seq)).toBe(true);
  });

  it("분양권 사본: '입' 4행은 skippedOwnership 로 세고 deals 에 없다 — trades rows 에는 지금처럼 들어 있다", async () => {
    const src = items("presale-12300-202605.json");
    respond(toXml(src));
    const r = await fetchTradeRows("12300", ["202605"], "presale", { region: "광주", gu: "북구" }, new Set(), false);
    expect(r.skippedOwnership).toBe(4);
    expect(r.deals).toHaveLength(26);
    // trades 행은 '입' 도 그대로(2u 가 읽는 표의 내용 불변) — 접힘이 없으면 원문 30 그대로
    const ipKeys = src.filter((i) => i.ownershipGbn === "입")
      .map((i) => `${Math.round(parseFloat(i.excluUseAr) * 100) / 100}|${parseInt(i.dealAmount.replace(/,/g, ""))}|${i.floor}`);
    const rowKeys = new Set(r.rows.map((x) => `${x.area}|${x.price}|${x.floor}`));
    expect(ipKeys).toHaveLength(4);
    for (const k of ipKeys) expect(rowKeys.has(k)).toBe(true);
    // 분양권: deals = 접힘 복원분 − '입'
    expect(r.deals.length).toBe(src.length - 4);
  });

  it("화성시 collectRegion: 4코드 × 3종류 × 월 수만큼 부르고, trades 행 gu 는 '화성시' 그대로", async () => {
    /** @type {string[]} */
    const urls = [];
    const xml = toXml(items("sale-hwaseong-41597-202608.json"));
    fetchMock.mockImplementation(async (/** @type {string} */ url) => { urls.push(url); return { ok: true, text: async () => xml }; });
    /** @type {Array<[string, string, number]>} */
    const seenDeals = [];
    const months = ["202608", "202607"];
    const r = await collectRegion({ region: "경기", gu: "화성시" }, GU_LAWD_CODES("경기", "화성시"), months, {
      seen: new Set(), fallbackUsed: false,
      onDeals: async (code, type, res) => { seenDeals.push([code, type, res.deals.length]); },
    });
    expect(urls).toHaveLength(4 * 3 * months.length);
    const lawd = new Set(urls.map((u) => /LAWD_CD=(\d+)/.exec(u)?.[1]));
    expect([...lawd]).toEqual(["41591", "41593", "41595", "41597"]);
    expect(seenDeals).toHaveLength(12);
    expect(new Set(seenDeals.map(([c]) => c))).toEqual(new Set(["41591", "41593", "41595", "41597"]));
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.rows.every((row) => row.gu === "화성시")).toBe(true);
    expect(r.stopped).toBeNull();
  });

  it("다른 지역은 1코드 — 강남구 3종류 × 월 수", async () => {
    /** @type {string[]} */
    const urls = [];
    fetchMock.mockImplementation(async (/** @type {string} */ url) => { urls.push(url); return { ok: true, text: async () => "<response></response>" }; });
    await collectRegion({ region: "서울", gu: "강남구" }, GU_LAWD_CODES("서울", "강남구"), ["202608"], { seen: new Set(), fallbackUsed: false });
    expect(urls).toHaveLength(3);
    expect(urls.every((u) => u.includes("LAWD_CD=11680"))).toBe(true);
  });

  it("shouldStop 이 'budget' 이면 첫 호출 전에 멈춘다", async () => {
    /** @type {string[]} */
    const urls = [];
    fetchMock.mockImplementation(async (/** @type {string} */ url) => { urls.push(url); return { ok: true, text: async () => "" }; });
    const r = await collectRegion({ region: "경기", gu: "화성시" }, GU_LAWD_CODES("경기", "화성시"), ["202608"], {
      seen: new Set(), fallbackUsed: false, shouldStop: () => "budget",
    });
    expect(urls).toHaveLength(0);
    expect(r.stopped).toBe("budget");
  });

  it("groupDealsByKey: 받은 달은 0건이어도 빈 열쇠로 남는다(0건 = 지우지 않음의 재료)", async () => {
    respond(toXml(items("sale-hwaseong-41597-202608.json")));
    const r = await fetchTradeRows("41597", ["202608"], "sale", { region: "경기", gu: "화성시" }, new Set(), false);
    const m = groupDealsByKey("41597", "sale", ["202608", "202607"], r.deals);
    expect([...m.keys()]).toEqual(["41597|202608|sale", "41597|202607|sale"]);
    expect(m.get("41597|202608|sale")).toHaveLength(50);
    expect(m.get("41597|202607|sale")).toHaveLength(0);
  });

  it("호출이 실패한 달은 deals 가 0 — 열쇠 교체 재료가 생기지 않는다", async () => {
    fetchMock.mockRejectedValue(new Error("fetch failed"));
    const r = await fetchTradeRows("41597", ["202608"], "sale", { region: "경기", gu: "화성시" }, new Set(), false);
    expect(r.deals).toEqual([]);
    expect(r.apiFails).toBe(1);
  });
});
