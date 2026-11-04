// @ts-check
/**
 * 빌드 방어 시험(세션697 — BACKLOG 「세션674 2단 맹점 🟠1」 처방 ①).
 *
 * 왜: 단지 장 반복에 단지별 방어가 없어 단지 한 곳의 본문 예외가 postbuild 전체를 죽였다 → 그날 배포 전체 실패
 *   (앱 자료·허브·사이트맵·그날 합친 코드까지 어제 상태). 이제 그 장만 얇은 본문(h1·요약 한 줄·출처)으로 만들고 계속 가며,
 *   실패 수·id 는 seo-thin.json(bodyErrors·bodyErrorIds)에 남아 감시 ㉓ 가 본다. 템플릿 결함은 모든 장이 같이 깨지므로 지금처럼 던진다.
 * 실패를 일으키는 두 길(둘 다 실전에 있는 꼴):
 *   ① 꾸러미 지도에 그 단지 행이 없음(buildAptHtml 이 던짐 — main 은 loadDetailMap 이 먼저 막지만 buildAptPages 단독으로는 열림)
 *   ② 꾸러미 행의 칸을 읽는 순간 예외(본문 사본 버그 흉내 — getter 가 던진다)
 */
import { describe, it, expect } from "vitest";
import {
  buildAptPages, buildAptHtml, buildAptThinHtml, assertAptTemplate, seoThinRecord, BODY_ERROR_IDS_MAX,
} from "./postbuild-prerender.mjs";
import { SOURCE_TEXT } from "../src/utils/aptStaticBody.mjs";
import { createNearbyIndex } from "../src/utils/nearbyComplexes.mjs";

const TEMPLATE = [
  `<!DOCTYPE html><html lang="ko"><head>`,
  `<meta name="description" content="전국 미분양 아파트를 6개 카테고리 41개 지표로 비교 분석" />`,
  `<meta property="og:title" content="미분양 비교 엔진 v3.0" />`,
  `<meta property="og:description" content="전국 미분양 아파트를 6개 카테고리 41개 지표로 비교 분석" />`,
  `<meta property="og:url" content="https://www.xn--hg3bi2ac4o1ig57cnoa.com/" />`,
  `<meta name="twitter:title" content="미분양 비교 엔진 v3.0" />`,
  `<meta name="twitter:description" content="전국 미분양 아파트를 6개 카테고리 41개 지표로 비교 분석" />`,
  `<link rel="canonical" href="https://www.xn--hg3bi2ac4o1ig57cnoa.com/" />`,
  `<title>미분양 비교 엔진 v3.0</title>`,
  `</head><body><div id="root" class="notranslate"></div></body></html>`,
].join("\n");

/** @param {string} id @param {Record<string, any>} [o] */
const full = (id, o = {}) => ({ id, name: `단지${id}`, region: "서울", gu: "강서구", nearbyMedian: 1200, hospital: 3, price: 50000, units: 300, ...o });
/** @param {string} id */
const thinApt = (id) => full(id, { nearbyMedian: null, hospital: null });
/** @param {Array<Record<string, any>>} rows */
const D = (rows) => new Map(rows.map((a) => [String(a.id), { id: a.id }]));
/** 칸을 읽는 순간 던지는 꾸러미 행(본문 사본 버그 흉내) @param {string} id */
const explodingDetail = (id) => {
  const row = { id };
  Object.defineProperty(row, "units", { enumerable: true, get: () => { throw new Error("사본 버그 첫 줄\n둘째 줄 스택"); } });
  return row;
};
/** @param {string} html @param {string} sel */
const pick = (html, sel) => (html.match(new RegExp(`<${sel}>([^<]*)</${sel}>`)) ?? [])[1];
/** @param {string} s @param {string} sub */
const countOf = (s, sub) => s.split(sub).length - 1;

describe("C1 단지별 방어 — 한 곳이 던져도 나머지는 정상 장, 빌드는 계속", () => {
  const list = [full("a1"), full("bad"), full("a3")];
  const details = D([list[0], list[2]]); // bad 행 없음 → buildAptHtml 이 던진다
  const r = buildAptPages(TEMPLATE, list, details);

  it("장은 3개 전부 · 순서 그대로 · 실패 1곳만 기록", () => {
    expect(r.pages.map((p) => p.id)).toEqual(["a1", "bad", "a3"]);
    expect(r.errors).toEqual([{ id: "bad", message: "[postbuild-prerender] 상세 꾸러미에 단지 bad 행이 없습니다" }]);
    expect(r.thin.bodyErrors).toBe(1);
    expect(r.thin.bodyErrorIds).toEqual(["bad"]);
  });
  it("정상 장은 buildAptHtml 결과 그대로(방어가 정상 장을 바꾸지 않는다)", () => {
    const a1 = r.pages.find((p) => p.id === "a1")?.html;
    expect(a1).toBe(buildAptHtml(TEMPLATE, list[0], { noindex: false, nearby: createNearbyIndex(list), details }));
    expect(a1).toContain("<h2>");
  });
  it("실패 장은 얇은 본문 — h1 · 요약 한 줄 · 출처 한 줄, 본문 절(h2 기본 정보 등) 없음", () => {
    const html = /** @type {string} */ (r.pages.find((p) => p.id === "bad")?.html);
    expect(html).toContain("<h1>단지bad</h1>");
    expect(html).toContain("<p>단지bad (서울 강서구) 분양가·미분양 정보.</p>");
    expect(html).toContain(`<p>${SOURCE_TEXT}</p>`);
    expect(html).not.toContain("기본 정보");
    expect(countOf(html, '<div id="root"')).toBe(1);
  });
  it("실패 장 head 는 정상 장과 같은 규칙 — 제목 글자 같음 · canonical·og:url 은 그 단지 · description 은 요약 한 줄", () => {
    const html = /** @type {string} */ (r.pages.find((p) => p.id === "bad")?.html);
    const normal = buildAptHtml(TEMPLATE, list[1], { details: D([list[1]]) });
    expect(pick(html, "title")).toBe(pick(normal, "title"));
    expect(pick(html, "title")).toBe("단지bad (서울 강서구) 분양가·미분양 | 미분양 비교");
    expect(html).toContain(`<link rel="canonical" href="https://www.xn--hg3bi2ac4o1ig57cnoa.com/apt/bad" />`);
    expect(html).toContain(`<meta property="og:url" content="https://www.xn--hg3bi2ac4o1ig57cnoa.com/apt/bad" />`);
    expect(html).toContain(`<meta name="description" content="단지bad (서울 강서구) 분양가·미분양 정보." />`);
    expect(html).toContain(`<meta name="twitter:title" content="단지bad (서울 강서구) 분양가·미분양 | 미분양 비교" />`);
    expect(html).not.toContain("미분양 비교 엔진 v3.0");
  });
  it("실패 장도 구조화 정보 2개(단지·경로 줄)와 경로 줄이 붙는다(만들 수 있으면)", () => {
    const html = /** @type {string} */ (r.pages.find((p) => p.id === "bad")?.html);
    expect(countOf(html, '<script type="application/ld+json">')).toBe(2);
    expect(html).toContain('"@type":"ApartmentComplex"');
    expect(html).toContain('"@type":"BreadcrumbList"');
    expect(html).toContain('<nav aria-label="breadcrumb">');
  });
  it("사이트맵 판정은 그대로 — 얇지 않은 실패 장은 사이트맵에 남고 robots 없음", () => {
    expect(r.sitemapIds).toEqual(["a1", "bad", "a3"]);
    expect(r.pages.every((p) => !p.html.includes('name="robots"'))).toBe(true);
  });
});

describe("C1·C2 — 얇은 판정(noindex) 단지가 실패해도 noindex·사이트맵 제외는 그대로", () => {
  it("thin 단지의 본문이 던지면 얇은 본문 + robots noindex 1개 + 사이트맵 제외", () => {
    const list = [full("a1"), thinApt("t1")];
    const r = buildAptPages(TEMPLATE, list, D([list[0]]));
    const t1 = /** @type {string} */ (r.pages.find((p) => p.id === "t1")?.html);
    expect(countOf(t1, '<meta name="robots" content="noindex,follow" />')).toBe(1);
    expect(r.sitemapIds).toEqual(["a1"]);
    expect(r.thin.ids).toEqual(["t1"]);
    expect(r.thin.bodyErrorIds).toEqual(["t1"]);
  });
});

describe("C1·C3 — 본문 사본 예외(칸 읽기에서 던짐)도 그 장만 · 오류는 첫 줄만", () => {
  it("getter 예외 → 얇은 본문 · message = 첫 줄", () => {
    const list = [full("a1"), full("x9")];
    const details = new Map([["a1", { id: "a1" }], ["x9", explodingDetail("x9")]]);
    const r = buildAptPages(TEMPLATE, list, /** @type {any} */ (details));
    expect(r.errors).toEqual([{ id: "x9", message: "사본 버그 첫 줄" }]);
    expect(r.pages.find((p) => p.id === "x9")?.html).toContain("<h1>단지x9</h1>");
    expect(r.thin.bodyErrors).toBe(1);
  });
});

describe("C3 — 실패 수는 전부, id 는 앞 20개", () => {
  it("25곳 실패 → bodyErrors 25 · bodyErrorIds 20개(앞에서부터) · 장 26개", () => {
    const list = [full("ok"), ...Array.from({ length: 25 }, (_, i) => full(`f${i}`))];
    const r = buildAptPages(TEMPLATE, list, D([list[0]]));
    expect(BODY_ERROR_IDS_MAX).toBe(20);
    expect(r.pages).toHaveLength(26);
    expect(r.thin.bodyErrors).toBe(25);
    expect(r.thin.bodyErrorIds).toEqual(Array.from({ length: 20 }, (_, i) => `f${i}`));
    expect(r.errors).toHaveLength(25);
  });
  it("seoThinRecord — builtAt 은 주입한 시각 ISO · 나머지 칸은 thin 그대로", () => {
    const r = buildAptPages(TEMPLATE, [full("a1")], D([full("a1")]));
    const rec = seoThinRecord(r.thin, new Date("2026-11-05T18:05:00.000Z"));
    expect(rec).toEqual({ ...r.thin, builtAt: "2026-11-05T18:05:00.000Z" });
    expect(JSON.parse(JSON.stringify(rec)).bodyErrors).toBe(0);
  });
});

describe("C4 — 템플릿 결함·지도 없음은 단지별 방어로 넘기지 않고 던진다(빌드 빨강)", () => {
  const list = [full("a1"), full("a2")];
  it("robots 메타가 있는 템플릿 → buildAptPages 가 던진다(얇은 본문 2장으로 조용히 넘어가지 않게)", () => {
    const bad = TEMPLATE.replace("</head>", `<meta name="robots" content="index" />\n</head>`);
    expect(() => buildAptPages(bad, list, D(list))).toThrow(/robots/);
    expect(() => assertAptTemplate(bad)).toThrow(/robots/);
  });
  it("</head> 가 2개인 템플릿 → 던진다", () => {
    const bad = TEMPLATE.replace("<body>", "<body></head>");
    expect(() => buildAptPages(bad, list, D(list))).toThrow(/<\/head>/);
  });
  it("지도 자체가 없으면 던진다(종전 그대로)", () => {
    expect(() => buildAptPages(TEMPLATE, list, /** @type {any} */ (undefined))).toThrow(/꾸러미/);
  });
  it("정상 템플릿은 assertAptTemplate 통과", () => {
    expect(() => assertAptTemplate(TEMPLATE)).not.toThrow();
  });
});

describe("C2 — 얇은 본문 만들기 자체는 던지지 않는다(칩·구조화 정보가 실패하면 뺀다)", () => {
  it("가까운 단지 색인이 깨져 있으면 경로 줄·경로 구조화 정보만 빠지고 장은 나온다", () => {
    const html = buildAptThinHtml(TEMPLATE, full("z1"), { nearby: /** @type {any} */ ({}) });
    expect(html).toContain("<h1>단지z1</h1>");
    expect(html).not.toContain('<nav aria-label="breadcrumb">');
    expect(html).not.toContain('"@type":"BreadcrumbList"');
    expect(html).toContain('"@type":"ApartmentComplex"');
    expect(html).toContain(`<p>${SOURCE_TEXT}</p>`);
  });
  it("지역·구가 비어도 제목·요약이 깨지지 않는다", () => {
    const html = buildAptThinHtml(TEMPLATE, { id: "n1", name: "이름만" });
    expect(pick(html, "title")).toBe("이름만 분양가·미분양 | 미분양 비교");
    expect(html).toContain("<p>이름만 분양가·미분양 정보.</p>");
  });
  it("noindex 를 주면 robots 1개", () => {
    expect(countOf(buildAptThinHtml(TEMPLATE, full("z2"), { noindex: true }), 'name="robots"')).toBe(1);
  });
});
