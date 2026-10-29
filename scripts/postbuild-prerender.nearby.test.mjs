// @ts-check
/**
 * 정적 단지 장의 경로 줄 + 같은 구 가까운 단지 블록 시험 (세션671 PR-S3 · 결정 40~43).
 *
 * 막는 것:
 *  - 블록이 정적 장에서 빠지거나 자리가 바뀜(사실 ul 뒤 · 전국 목록 링크 앞)
 *  - 앱과 정적 장이 다른 단지·다른 순서·다른 글자·다른 허브 판정을 보임(cloaking, 결정 27) — 같은 함수·짝 시험
 *  - 전체 보기 N 이 그 허브 h1 의 N 과 어긋남
 *  - BreadcrumbList JSON-LD 가 빠지거나 첫째 스크립트를 덮음
 */
import { describe, it, expect } from "vitest";
import { buildAptHtml, buildAptPages, buildRegionPages, nearbyBlockHtml, regionHubPath, SIDO_LIST } from "./postbuild-prerender.mjs";
import { buildNearbyBlock, createNearbyIndex } from "../src/utils/nearbyComplexes.mjs";
import { REGION_HUB_RULES } from "../src/lib/regionPath.ts";

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

const KM_PER_DEG = (2 * Math.PI * 6371) / 360;
/**
 * @param {string} id @param {number} km @param {Record<string, unknown>} [o]
 * @returns {Record<string, any>}
 */
const apt = (id, km, o = {}) => ({
  id,
  name: `단지${id}`,
  region: "서울",
  gu: "구로구",
  lat: 37.5 + km / KM_PER_DEG,
  lng: 126.9,
  unsold: 5,
  price: 50000,
  hospital: 3,
  nearbyMedian: 60000,
  ...o,
});

/** 상세 꾸러미 지도(세션672 필수) — 빈 행 */
/** @param {Array<Record<string, any>>} rows */
const D = (rows) => new Map(rows.map((a) => [String(a.id), { id: a.id }]));

const LIST = [
  apt("s", 0, { name: "신영지웰" }),
  apt("a", 0.91, { unsold: 29 }),
  apt("b", 1.72, { unsold: 0 }),
  apt("c", 1.28, { coordShared: true }),
  apt("d", 0.5, { unsold: null }),
  apt("lone", 0, { gu: "금천구" }),
  apt("sj1", 0, { region: "세종", gu: null }),
  apt("sj2", 4.0, { region: "세종", gu: null }),
  apt("bad1", 0, { gu: "가/나구" }),
  apt("bad2", 1, { gu: "가/나구" }),
  // 얇은 단지(가격·병원·주변 시세 셋 다 없음) — noindex 장에도 블록이 붙어야 한다
  apt("thin", 2.0, { price: null, hospital: null, nearbyMedian: null }),
  // 시도 17종 밖 — 앱·정적 모두 허브 링크 없음(짝 시험이 isSido 판정까지 맞대게)
  apt("out1", 0, { region: "안심뉴타운", gu: null }),
  apt("out2", 1, { region: "안심뉴타운", gu: null }),
];

const SIDO_SET = new Set(SIDO_LIST);
const STATIC_RULES = { isSido: (/** @type {string} */ s) => SIDO_SET.has(s), hubPath: regionHubPath };
// 앱이 실제로 쓰는 규칙 객체 그대로(NearbyBlock.tsx 가 쓰는 것) — 시험 안에서 따로 만들지 않는다
const APP_RULES = REGION_HUB_RULES;

/** @param {string} html */
const rootOf = (html) => html.slice(html.indexOf('<div id="root"'), html.indexOf("</main>"));

describe("정적 단지 장 — 블록 자리·글자", () => {
  const idx = createNearbyIndex(LIST);
  const html = buildAptHtml(TEMPLATE, LIST[0], { nearby: idx, details: D(LIST) });
  const root = rootOf(html);

  // 세션672: 블록 자리 = 본문 마지막 절 뒤 · 출처 줄 앞(옛 「사실 ul 뒤 · 전국 목록 링크 앞」 — 단지 정보 절·전국 링크가 없어짐)
  it("본문 마지막 절 뒤 · 출처 줄 앞에 경로 줄 → 머리글 → ul → 전체 보기", () => {
    const iFacts = root.lastIndexOf("</ul>", root.indexOf('<nav aria-label="breadcrumb">'));
    const iNav = root.indexOf('<nav aria-label="breadcrumb">');
    const iHead = root.indexOf("<h2>구로구 가까운 단지 (직선거리)</h2>");
    const iAll = root.indexOf("구로구 분양·미분양 6곳 전체 보기 ›");
    const iHome = root.indexOf("<p>출처: 청약홈(국토교통부)");
    expect(iFacts).toBeGreaterThan(-1);
    expect(iFacts).toBeLessThan(iNav);
    expect(iNav).toBeLessThan(iHead);
    expect(iHead).toBeLessThan(iAll);
    expect(iAll).toBeLessThan(iHome);
  });

  it("경로 줄 = 허브 꼴(전국·시도·구 링크, 단지 이름은 글자)", () => {
    expect(root).toContain(
      `<nav aria-label="breadcrumb"><a href="/">전국</a> › <a href="/region/%EC%84%9C%EC%9A%B8">서울</a> › <a href="/region/%EC%84%9C%EC%9A%B8/%EA%B5%AC%EB%A1%9C%EA%B5%AC">구로구</a> › 신영지웰</nav>`,
    );
  });

  it("칩 줄 = 미분양 남은 단지 가까운 순 → 나머지 · 글자는 앱과 같은 함수", () => {
    const lis = [...root.matchAll(/<li><a href="\/apt\/([^"]+)">[^<]*<\/a> — ([^<]*)<\/li>/g)].map((m) => [m[1], m[2]]);
    expect(lis).toEqual([
      ["a", "0.9km · 미분양 29세대"],
      ["c", "미분양 5세대"], // coordShared → 거리 글자 없음(순서엔 1.28km 그대로)
      ["thin", "2.0km · 미분양 5세대"],
      ["d", "0.5km · 미분양 —"],
      ["b", "1.7km · 분양 완료"],
    ]);
  });

  it("칩 0개(구에 혼자)면 경로 줄만 — 머리글·ul·전체 보기 없음", () => {
    const lone = rootOf(buildAptHtml(TEMPLATE, LIST[5], { nearby: idx, details: D(LIST) }));
    expect(lone).toContain('<nav aria-label="breadcrumb">');
    expect(lone).not.toContain("가까운 단지");
    expect(lone).not.toContain("전체 보기");
    expect(lone.match(/<ul>/g)).toHaveLength(1); // 기본 정보 ul 하나뿐(이 픽스처는 다른 절 값이 없다)
  });

  it("세종: 시도 허브로 · 폴더로 못 쓰는 구: 구 칸 링크 없음·전체 보기 없음", () => {
    const sj = rootOf(buildAptHtml(TEMPLATE, LIST[6], { nearby: idx, details: D(LIST) }));
    expect(sj).toContain(`<nav aria-label="breadcrumb"><a href="/">전국</a> › <a href="/region/%EC%84%B8%EC%A2%85">세종</a> › 단지sj1</nav>`);
    expect(sj).toContain("<h2>세종 가까운 단지 (직선거리)</h2>");
    expect(sj).toContain('<p><a href="/region/%EC%84%B8%EC%A2%85">세종 분양·미분양 2곳 전체 보기 ›</a></p>');
    const bad = rootOf(buildAptHtml(TEMPLATE, LIST[8], { nearby: idx, details: D(LIST) }));
    expect(bad).toContain(" › 가/나구 › 단지bad1</nav>");
    expect(bad).toContain("<h2>가/나구 가까운 단지 (직선거리)</h2>");
    expect(bad).not.toContain("전체 보기");
  });

  it("색인을 안 넘기면 이 단지 하나뿐 → 경로 줄만", () => {
    const solo = rootOf(buildAptHtml(TEMPLATE, LIST[0], { details: D(LIST) }));
    expect(solo).toContain('<nav aria-label="breadcrumb">');
    expect(solo).not.toContain("가까운 단지");
  });
});

describe("정적 단지 장 — BreadcrumbList JSON-LD(두 번째 스크립트)", () => {
  it("첫째 = 단지(ApartmentComplex) 그대로, 둘째 = 경로 줄 · 절대 주소 · 마지막 = canonical", () => {
    const html = buildAptHtml(TEMPLATE, LIST[0], { nearby: createNearbyIndex(LIST), details: D(LIST) });
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    expect(blocks).toHaveLength(2);
    expect(blocks[0]["@type"]).toBe("ApartmentComplex");
    expect(blocks[1]).toEqual({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "전국", item: `${ORIGIN}/` },
        { "@type": "ListItem", position: 2, name: "서울", item: `${ORIGIN}/region/%EC%84%9C%EC%9A%B8` },
        { "@type": "ListItem", position: 3, name: "구로구", item: `${ORIGIN}/region/%EC%84%9C%EC%9A%B8/%EA%B5%AC%EB%A1%9C%EA%B5%AC` },
        { "@type": "ListItem", position: 4, name: "신영지웰", item: `${ORIGIN}/apt/s` },
      ],
    });
  });

  it("링크 없는 칸(폴더로 못 쓰는 구)은 목록에서 빠진다", () => {
    const html = buildAptHtml(TEMPLATE, LIST[8], { nearby: createNearbyIndex(LIST), details: D(LIST) });
    const ld = JSON.parse([...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)][1][1]);
    expect(ld.itemListElement.map((/** @type {any} */ x) => x.name)).toEqual(["전국", "서울", "단지bad1"]);
  });
});

describe("buildAptPages — 목록 전체 색인 · noindex 장에도 블록", () => {
  it("모든 장이 같은 목록에서 칩을 고르고, 얇은 단지(noindex) 장에도 블록이 있다", () => {
    const { pages, thin } = buildAptPages(TEMPLATE, LIST, D(LIST));
    expect(thin.ids).toEqual(["thin"]);
    const thinPage = /** @type {{ html: string }} */ (pages.find((p) => p.id === "thin"));
    expect(thinPage.html).toContain('<meta name="robots" content="noindex,follow" />');
    expect(thinPage.html).toContain("<h2>구로구 가까운 단지 (직선거리)</h2>");
    const sPage = /** @type {{ html: string }} */ (pages.find((p) => p.id === "s"));
    expect(sPage.html).toContain('<li><a href="/apt/a">단지a</a> — 0.9km · 미분양 29세대</li>');
  });
});

describe("앱 ↔ 정적 짝 — 같은 블록 · 허브 h1 N 과 같은 수", () => {
  it("앱 규칙(regionPath.ts)과 정적 규칙으로 만든 블록이 단지마다 똑같다", () => {
    const idx = createNearbyIndex(LIST);
    for (const a of LIST) {
      expect(buildNearbyBlock(a, idx, APP_RULES)).toEqual(buildNearbyBlock(a, idx, STATIC_RULES));
    }
  });

  it("정적 장 블록 HTML = 같은 블록을 그린 것(다른 계산 경로 없음)", () => {
    const idx = createNearbyIndex(LIST);
    const html = buildAptHtml(TEMPLATE, LIST[0], { nearby: idx, details: D(LIST) });
    expect(html).toContain(nearbyBlockHtml(buildNearbyBlock(LIST[0], idx, APP_RULES)));
  });

  it("전체 보기 N = 그 허브 장 h1 의 N (구 허브 · 세종 시도 허브)", () => {
    const idx = createNearbyIndex(LIST);
    const { pages } = buildRegionPages(TEMPLATE, LIST);
    /** @param {string} path */
    const h1N = (path) => {
      const p = pages.find((x) => x.path === path);
      const m = p?.html.match(/<h1>[^<]*?(\d+)곳/);
      return m ? Number(m[1]) : -1;
    };
    const guro = buildNearbyBlock(LIST[0], idx, STATIC_RULES);
    expect(guro.all?.count).toBe(h1N(regionHubPath("서울", "구로구")));
    expect(guro.all?.count).toBe(6);
    const sj = buildNearbyBlock(LIST[6], idx, STATIC_RULES);
    expect(sj.all?.count).toBe(h1N(regionHubPath("세종")));
    // 폴더로 못 쓰는 구는 허브가 없다 — 앱도 정적도 전체 보기 없음
    expect(pages.some((p) => p.segments[1] === "가/나구")).toBe(false);
    expect(buildNearbyBlock(LIST[8], idx, STATIC_RULES).all).toBeNull();
  });
});
