// @ts-check
/**
 * 지역 허브 정적 장 시험 (세션669 PR-S2 · 결정 26·27·30·31·34·36·37).
 *
 * 허브는 단지 1,678장을 홈 한 장에만 매달지 않게 하는 중간 장이다. 이 시험이 막는 것:
 *  - 앱(`src/lib/regionPath.ts`)과 정적 장의 주소가 어긋남(공백·한글) → canonical 과 앱 진입이 다른 주소
 *  - 값 표기가 화면 함수와 어긋남(사본 drift) → 봇과 사람이 다른 글을 봄
 *  - 1~2곳 구 허브가 색인됨 · 시도 아닌 지역 값으로 허브가 생김 · 폴더로 못 쓰는 이름
 */
import { describe, it, expect } from "vitest";
import {
  SIDO_LIST,
  HUB_NOINDEX_MAX,
  regionHubPath,
  fmtPriceNode,
  fmtMoveInNode,
  hubUnsoldText,
  hubUnitsText,
  hubAptOrder,
  sidoStatLine,
  guStatLine,
  buildRegionPages,
  buildSitemap,
  buildHomeSkeleton,
} from "./postbuild-prerender.mjs";
import { VALID_REGIONS } from "./collectors/_shared.mjs";
import { SIDO_LIST as APP_SIDO_LIST, buildRegionPath, parseRegionPath } from "../src/lib/regionPath.ts";
import { fmtPrice, fmtMoveIn } from "../src/lib/format.ts";
import { FIELD_META } from "../src/constants/fieldMeta.ts";

const ORIGIN = "https://www.xn--hg3bi2ac4o1ig57cnoa.com";
const TEMPLATE = [
  `<!DOCTYPE html><html lang="ko"><head>`,
  `<meta name="description" content="홈 설명" />`,
  `<meta property="og:title" content="홈" />`,
  `<meta property="og:description" content="홈 설명" />`,
  `<meta property="og:url" content="${ORIGIN}/" />`,
  `<meta name="twitter:title" content="홈" />`,
  `<meta name="twitter:description" content="홈 설명" />`,
  `<link rel="canonical" href="${ORIGIN}/" />`,
  `<title>홈</title>`,
  `</head><body><div id="root" class="notranslate"></div></body></html>`,
].join("\n");

/** @param {string} html @param {string} needle */
const countOf = (html, needle) => html.split(needle).length - 1;

/**
 * @param {string} id @param {Record<string, any>} [o]
 * @returns {Record<string, any>}
 */
const apt = (id, o = {}) => ({
  id,
  name: `단지${id}`,
  region: "서울",
  gu: "구로구",
  price: 50000,
  units: 100,
  unsold: 5,
  completion: "202701",
  nearbyMedian: 1,
  hospital: 1,
  housingSupplyLevel: 93.9,
  popGrowth: -0.4,
  fertilityRate: 0.725,
  ...o,
});

const LIST = [
  // 구로구 3곳 — 미분양 남음 2 (0 하나)
  apt("g1", { name: "나단지", units: 300, unsold: 3 }),
  apt("g2", { name: "가단지", units: 300, unsold: 9 }),
  apt("g3", { name: "완판단지", units: 900, unsold: 0 }),
  // 강서구 2곳 — 얇은 단지(주변 시세·병원·분양가 중 둘 이상 빔) 포함해도 2곳 → noindex
  apt("k1", { gu: "강서구", fertilityRate: 0.6 }),
  apt("k2", { gu: "강서구", nearbyMedian: null, hospital: null, price: null }),
  // 중구 1곳 → noindex
  apt("j1", { gu: "중구", unsold: null }),
  // 경기 "수원시 권선구" 3곳 — 공백 든 이름 · 얇은 단지 하나 포함해도 3곳이면 색인
  apt("w1", { region: "경기", gu: "수원시 권선구", housingSupplyLevel: 99, popGrowth: 0.3 }),
  apt("w2", { region: "경기", gu: "수원시 권선구", housingSupplyLevel: 99, popGrowth: 0.3, nearbyMedian: null, hospital: null }),
  apt("w3", { region: "경기", gu: "수원시 권선구", housingSupplyLevel: 99, popGrowth: 0.3 }),
  // 세종 — 구 빈 행 2곳(시도 허브에 단지 줄로)
  apt("s1", { region: "세종", gu: "", housingSupplyLevel: 100, popGrowth: 1.2 }),
  apt("s2", { region: "세종", gu: null, housingSupplyLevel: 100, popGrowth: 1.2, unsold: 0 }),
  // 시도 아닌 지역 값(옛 사본 실례 "안심뉴타운")·폴더로 못 쓰는 구 이름
  apt("x1", { region: "안심뉴타운", gu: "어딘가" }),
  apt("x2", { gu: "a/b" }),
  apt("x3", { gu: "..", region: "경기" }),
  // id·name 없음
  { id: "", name: "이름만", region: "서울", gu: "구로구" },
];

const R = buildRegionPages(TEMPLATE, LIST);
/** @param {string} seg */
const page = (seg) => R.pages.find((p) => p.segments.join("/") === seg);

describe("시도 17종 — 정본·앱·정적이 같은 목록", () => {
  it("정적 SIDO_LIST = _shared VALID_REGIONS = 앱 SIDO_LIST (순서까지)", () => {
    expect(SIDO_LIST).toEqual([...VALID_REGIONS]);
    expect(SIDO_LIST).toEqual([...APP_SIDO_LIST]);
    expect(SIDO_LIST).toHaveLength(17);
  });
});

describe("주소 짝 — 정적 regionHubPath 와 앱 buildRegionPath 가 같은 문자열", () => {
  const cases = /** @type {Array<[string, string | null]>} */ ([
    ["서울", null],
    ["서울", "구로구"],
    ["경기", "수원시 권선구"],
    ["세종", null],
    ["경남", "창원시 마산합포구"],
  ]);
  it.each(cases)("%s / %s", (sido, gu) => {
    expect(regionHubPath(sido, gu)).toBe(buildRegionPath(sido, gu));
    expect(parseRegionPath(regionHubPath(sido, gu))).toEqual({ region: sido, gu });
  });
  it("공백은 %20, 한글은 퍼센트 인코딩", () => {
    expect(regionHubPath("경기", "수원시 권선구")).toBe(
      "/region/%EA%B2%BD%EA%B8%B0/%EC%88%98%EC%9B%90%EC%8B%9C%20%EA%B6%8C%EC%84%A0%EA%B5%AC",
    );
  });
});

describe("값 표기 = 화면 함수와 같은 결과 (사본 drift 막기)", () => {
  it.each([24675, 10000, 5000, 90870, 123456, 0, -1, null, undefined])("분양가 %s", (v) => {
    expect(fmtPriceNode(v)).toBe(fmtPrice(/** @type {any} */ (v)));
  });
  it("24675 → '2억 4,675만'", () => {
    expect(fmtPriceNode(24675)).toBe("2억 4,675만");
  });
  it.each(/** @type {Array<[any, any]>} */ ([
    ["202701", null],
    ["2029 미", "2029 미정"],
    ["2029 미", null],
    [null, "2026-09"],
    [null, null],
    ["", "  "],
  ]))("입주 %s / %s", (c, m) => {
    expect(fmtMoveInNode(c, m)).toBe(fmtMoveIn(c, m));
  });
  it("미분양 남음·모름은 화면 상세(FIELD_META unsold)와 같은 말, 0 은 사장님 확인 시안의 말 '미분양 0 (분양 완료)'", () => {
    const fmt = /** @type {(v: any) => string} */ (FIELD_META.unsold.fmt);
    expect(hubUnsoldText(1234)).toBe(`미분양 ${fmt(1234)}`);
    expect(hubUnsoldText(null)).toBe(`미분양 ${fmt(null)}`);
    expect(hubUnsoldText(0)).toBe("미분양 0 (분양 완료)");
  });
  it.each(/** @type {Array<[any, any]>} */ ([
    [983, 29],
    [null, 3],
    [1, 0],
    [15, 47],
    [1200, null],
  ]))("총 세대 %s (미분양 %s) = FIELD_META units", (u, s) => {
    const fmt = /** @type {(v: any, a: any) => string} */ (FIELD_META.units.fmt);
    expect(hubUnitsText(u, s)).toBe(fmt(u, { unsold: s }));
  });
});

describe("구 허브 — 그 구 단지 전부, 제목·순서·링크", () => {
  const p = /** @type {NonNullable<ReturnType<typeof page>>} */ (page("서울/구로구"));
  it("폴더 = 원문 이름, 장이 있다", () => {
    expect(p).toBeTruthy();
    expect(p.segments).toEqual(["서울", "구로구"]);
  });
  it("h1·title = 결정 34 꼴 + 시도(결정 38) (미분양 0 단지도 센다)", () => {
    expect(p.html).toContain("<h1>서울 구로구 분양·미분양 아파트 3곳 (미분양 남음 2곳)</h1>");
    expect(p.html).toContain("<title>서울 구로구 분양·미분양 아파트 3곳 (미분양 남음 2곳) | 미분양 비교</title>");
    expect(p.html).toContain('<meta property="og:title" content="서울 구로구 분양·미분양 아파트 3곳 (미분양 남음 2곳) | 미분양 비교" />');
    expect(p.html).toContain('<meta name="twitter:title" content="서울 구로구 분양·미분양 아파트 3곳 (미분양 남음 2곳) | 미분양 비교" />');
    expect(p.html).toContain('<meta name="description" content="서울 구로구 분양·미분양 아파트 3곳 (미분양 남음 2곳) — ');
    expect(countOf(p.html, "<h1>")).toBe(1);
  });
  it("canonical·og:url = 인코딩된 절대 주소", () => {
    const url = `${ORIGIN}/region/%EC%84%9C%EC%9A%B8/%EA%B5%AC%EB%A1%9C%EA%B5%AC`;
    expect(p.html).toContain(`<link rel="canonical" href="${url}" />`);
    expect(p.html).toContain(`<meta property="og:url" content="${url}" />`);
    expect(countOf(p.html, 'rel="canonical"')).toBe(1);
  });
  it("빵부스러기 전국 › 서울(시도 허브) › 구로구 + 줄 끝 링크 둘", () => {
    expect(p.html).toContain('<a href="/">전국</a> › <a href="/region/%EC%84%9C%EC%9A%B8">서울</a> › 구로구');
    expect(p.html).toContain('<a href="/region/%EC%84%9C%EC%9A%B8">서울 전체 보기 ›</a>');
    expect(p.html).toContain('<a href="/">전국 목록으로 ›</a>');
  });
  it("순서 = 미분양 남은 단지 먼저 → 총 세대수 많은 순 → 이름순", () => {
    const order = [...p.html.matchAll(/<a href="\/apt\/([^"]+)">/g)].map((m) => m[1]);
    expect(order).toEqual(["g2", "g1", "g3"]); // 가단지·나단지(같은 300세대 → 이름순) → 완판단지(900세대여도 뒤)
  });
  it("단지 줄 = /apt 링크 + 분양가 + 미분양/총 + 입주, 0 은 '미분양 0 (분양 완료)'", () => {
    expect(p.html).toContain('<li><a href="/apt/g2">가단지</a> · 분양가 5억 · 미분양 9세대 / 총 300세대 · 입주 2027년 01월</li>');
    expect(p.html).toContain("미분양 0 (분양 완료) / 총 900세대");
  });
  it("점수·등급 0 (결정 27)", () => {
    expect(p.html).not.toMatch(/점수|등급/);
  });
  it("통계 한 줄 — 시도 두 값 + 그 구 합계출산율(화면 RegionStats·FIELD_META 와 같은 말)", () => {
    expect(p.html).toContain("<p>서울 주택보급률 93.9% · 서울 인구 증감 -0.4% · 구로구 합계출산율 0.725명</p>");
  });
  it("출산율이 구 안에서 갈리면(강서구) 그 칸만 뺀다", () => {
    expect(/** @type {any} */ (page("서울/강서구")).html).toContain("<p>서울 주택보급률 93.9% · 서울 인구 증감 -0.4%</p>");
  });
  it("시도 허브에는 출산율을 싣지 않는다", () => {
    expect(/** @type {any} */ (page("서울")).html).not.toContain("합계출산율");
  });
  it("BreadcrumbList JSON-LD 하나, 파싱 가능", () => {
    const m = /<script type="application\/ld\+json">([^<]*)<\/script>/.exec(p.html);
    expect(m).toBeTruthy();
    const ld = JSON.parse(/** @type {RegExpExecArray} */ (m)[1]);
    expect(ld["@type"]).toBe("BreadcrumbList");
    expect(ld.itemListElement.map((/** @type {any} */ x) => [x.position, x.name])).toEqual([
      [1, "전국"],
      [2, "서울"],
      [3, "구로구"],
    ]);
    expect(ld.itemListElement[2].item).toBe(`${ORIGIN}/region/%EC%84%9C%EC%9A%B8/%EA%B5%AC%EB%A1%9C%EA%B5%AC`);
  });
  it("3곳 구 허브는 robots 메타 0개", () => {
    expect(countOf(p.html, 'name="robots"')).toBe(0);
    expect(p.noindex).toBe(false);
  });
});

describe("1~2곳 구 허브 = noindex,follow + 사이트맵 제외 (결정 31) · 시도 허브는 늘 색인", () => {
  it("기준값은 2", () => {
    expect(HUB_NOINDEX_MAX).toBe(2);
  });
  it("2곳(얇은 단지 포함해 2곳) 구 허브 → noindex 1개, </head> 앞", () => {
    const p = /** @type {any} */ (page("서울/강서구"));
    expect(p.noindex).toBe(true);
    expect(countOf(p.html, '<meta name="robots" content="noindex,follow" />')).toBe(1);
    expect(p.html.indexOf('name="robots"')).toBeLessThan(p.html.indexOf("</head>"));
  });
  it("1곳 구 허브 → noindex", () => {
    expect(/** @type {any} */ (page("서울/중구")).noindex).toBe(true);
  });
  it("3곳(얇은 단지 1곳 포함) 구 허브 → 색인", () => {
    expect(/** @type {any} */ (page("경기/수원시 권선구")).noindex).toBe(false);
  });
  it("시도 허브는 단지가 적어도 noindex 아님", () => {
    const sejong = /** @type {any} */ (page("세종"));
    expect(sejong.noindex).toBe(false);
    expect(countOf(sejong.html, 'name="robots"')).toBe(0);
  });
  it("사이트맵 = 시도 0.7 + 색인 구 0.6 만 (noindex 구 없음) · lastmod 없음", () => {
    const locs = R.sitemapEntries.map((e) => e.loc);
    expect(locs).toContain(`${ORIGIN}/region/%EC%84%9C%EC%9A%B8`);
    expect(locs).toContain(`${ORIGIN}/region/%EC%84%9C%EC%9A%B8/%EA%B5%AC%EB%A1%9C%EA%B5%AC`);
    expect(locs).not.toContain(`${ORIGIN}/region/%EC%84%9C%EC%9A%B8/%EA%B0%95%EC%84%9C%EA%B5%AC`);
    expect(locs).not.toContain(`${ORIGIN}/region/%EC%84%9C%EC%9A%B8/%EC%A4%91%EA%B5%AC`);
    for (const p of R.pages) {
      const inMap = locs.includes(`${ORIGIN}${p.path}`);
      expect(inMap).toBe(!p.noindex);
    }
    expect(R.sitemapEntries.filter((e) => e.pri === "0.7")).toHaveLength(3);
    const xml = buildSitemap(["a1"], R.sitemapEntries);
    expect(xml).toContain(`<loc>${ORIGIN}/region/%EC%84%9C%EC%9A%B8</loc><priority>0.7</priority>`);
    expect(xml).not.toContain("lastmod");
    expect(countOf(xml, "<url>")).toBe(2 + R.sitemapEntries.length + 1);
  });
});

describe("이름 방어 — 공백·한글·시도 아닌 값·폴더로 못 쓰는 이름·0곳 시도", () => {
  it("공백 든 구 이름: 폴더는 원문, canonical 은 %20", () => {
    const p = /** @type {any} */ (page("경기/수원시 권선구"));
    expect(p.segments).toEqual(["경기", "수원시 권선구"]);
    expect(p.html).toContain(`href="${ORIGIN}/region/%EA%B2%BD%EA%B8%B0/%EC%88%98%EC%9B%90%EC%8B%9C%20%EA%B6%8C%EC%84%A0%EA%B5%AC"`);
  });
  it("시도 아닌 지역 값(안심뉴타운)은 허브를 안 만들고 센다", () => {
    expect(R.pages.some((p) => p.segments[0] === "안심뉴타운")).toBe(false);
    expect(R.skipped.notSido).toBe(1);
  });
  it("'/'·'..' 든 구 이름은 구 허브만 안 만든다 — 그 단지는 시도 허브에 단지 줄로(보완 F4)", () => {
    expect(R.skipped.badName).toBe(2);
    expect(R.pages.some((p) => p.segments.some((s) => s.includes("/") || s.includes("..")))).toBe(false);
    expect(/** @type {any} */ (page("서울")).html).toContain('<li><a href="/apt/x2">');
    expect(/** @type {any} */ (page("경기")).html).toContain('<li><a href="/apt/x3">');
    expect(/** @type {any} */ (page("경기")).html).toContain("<h1>경기 분양·미분양 아파트 4곳 (미분양 남음 4곳)</h1>");
    expect(R.pages.filter((p) => p.html.includes("/apt/x2"))).toHaveLength(1);
  });
  it("단지 0곳 시도(부산)는 허브가 없다 · 시도 허브는 있는 시도만", () => {
    expect(page("부산")).toBeUndefined();
    expect(R.pages.filter((p) => p.segments.length === 1).map((p) => p.segments[0])).toEqual(["서울", "세종", "경기"]);
  });
  it("id·name 없는 행은 세지 않는다", () => {
    expect(/** @type {any} */ (page("서울/구로구")).html).toContain("3곳");
  });
});

describe("시도 허브 (결정 36) — 구 목록 + 단지 수, 구 빈 단지는 단지 줄로", () => {
  it("서울: h1 은 시도 전체 수, 구 목록은 단지 수 많은 순 → 이름순", () => {
    const p = /** @type {any} */ (page("서울"));
    expect(p.html).toContain("<h1>서울 분양·미분양 아파트 7곳 (미분양 남음 5곳)</h1>"); // 폴더로 못 쓰는 구(x2)도 센다(F4)
    const gus = [...p.html.matchAll(/<li><a href="\/region\/[^"]+">([^<]+)<\/a> (\d+)곳 \(미분양 남음 (\d+)곳\)<\/li>/g)].map(
      (m) => `${m[1]}:${m[2]}:${m[3]}`,
    );
    expect(gus).toEqual(["구로구:3:2", "강서구:2:2", "중구:1:0"]);
    expect(p.html).toContain('<a href="/region/%EC%84%9C%EC%9A%B8/%EA%B5%AC%EB%A1%9C%EA%B5%AC">구로구</a>');
    // 단지 줄은 구 허브 몫(중복 없음) — 시도 허브엔 폴더로 못 쓰는 구의 단지(x2)만
    expect(countOf(p.html, '<li><a href="/apt/')).toBe(1);
  });
  it("세종(구 빈 행): 구 목록 없이 단지 줄 2개, 빵부스러기 전국 › 세종", () => {
    const p = /** @type {any} */ (page("세종"));
    expect(p.html).toContain("<h1>세종 분양·미분양 아파트 2곳 (미분양 남음 1곳)</h1>");
    expect(p.html).not.toContain("<h2>시군구</h2>");
    expect(countOf(p.html, '<li><a href="/apt/')).toBe(2);
    expect(p.html).toContain('<a href="/">전국</a> › 세종');
  });
});

describe("시도 통계 한 줄 — 시도 안에서 값이 하나일 때만", () => {
  it("값이 갈리면 그 칸을 뺀다(시도 단위가 아니라는 뜻)", () => {
    const line = sidoStatLine("서울", [apt("a", { popGrowth: -0.4 }), apt("b", { popGrowth: 0.1 })]);
    expect(line).toBe("서울 주택보급률 93.9%");
  });
  it("둘 다 없으면 빈 문자열 → 허브에 통계 줄 없음", () => {
    expect(sidoStatLine("서울", [apt("a", { popGrowth: null, housingSupplyLevel: null })])).toBe("");
  });
  it("양수 인구 증감은 + 를 붙인다(화면과 같게)", () => {
    expect(sidoStatLine("경기", [apt("a", { popGrowth: 0.3, housingSupplyLevel: null })])).toBe("경기 인구 증감 +0.3%");
  });
});

describe("guStatLine — 구 합계출산율, 구 안에서 값 하나일 때만 (보완 F3)", () => {
  it("같으면 '{구} 합계출산율 {v}명'", () => {
    expect(guStatLine("구로구", [apt("a"), apt("b")])).toBe("구로구 합계출산율 0.725명");
  });
  it("갈리면·전부 없으면 빈 문자열", () => {
    expect(guStatLine("구로구", [apt("a"), apt("b", { fertilityRate: 0.8 })])).toBe("");
    expect(guStatLine("구로구", [apt("a", { fertilityRate: null })])).toBe("");
  });
});

describe("hubAptOrder 경계", () => {
  it("미분양 모름(null)은 남음 아님으로, 세대 모름은 뒤로", () => {
    const xs = [apt("a", { unsold: null, units: 10 }), apt("b", { unsold: 1, units: null }), apt("c", { unsold: 1, units: 5 })];
    expect([...xs].sort(hubAptOrder).map((x) => x.id)).toEqual(["c", "b", "a"]);
  });
});

describe("허브 장 틀 검사 — 단지 장과 같은 방식", () => {
  it("템플릿에 robots 메타가 있으면 throw", () => {
    const bad = TEMPLATE.replace("</head>", '<meta name="robots" content="all" /></head>');
    expect(() => buildRegionPages(bad, LIST)).toThrow(/robots/);
  });
  it("</head> 가 둘이면 throw", () => {
    const bad = TEMPLATE.replace("</head>", "</head></head>");
    expect(() => buildRegionPages(bad, LIST)).toThrow(/<\/head>/);
  });
});

describe("홈 골격 지역 제목 = 시도 허브 링크 (결정 37)", () => {
  it("17종만 링크, 밖 값·기타는 링크 없음, href 는 앱 buildRegionPath 와 같다", () => {
    const h = buildHomeSkeleton(/** @type {any[]} */ ([
      { id: "1", name: "a", region: "서울" },
      { id: "2", name: "b", region: "안심뉴타운" },
      { id: "3", name: "c", region: "" },
    ]));
    expect(h).toContain(`<h3><a href="${buildRegionPath("서울")}">서울</a> (1곳)</h3>`);
    expect(h).toContain("<h3>안심뉴타운 (1곳)</h3>");
    expect(h).toContain("<h3>기타 (1곳)</h3>");
  });
});
