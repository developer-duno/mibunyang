// @ts-check
/**
 * postbuild-prerender 순수 함수 테스트 (세션 504, 감사 단계 2-C).
 *
 * 배경 — 세션503 이 `/apt/{id}` 주소를 열었지만 검색에는 쓸모가 없었다. 라이브 실측(2026-08-08):
 *   1. `sitemap.xml` 에 URL 이 **2개**뿐이었다(홈·/upcoming). 단지 페이지는 구글이 **발견조차 못 함**.
 *      (세션503 인계문의 "sitemap 2,043개" 는 사실이 아니었다.)
 *   2. 모든 주소의 `canonical` 이 루트 고정 → 발견해도 **홈의 사본**으로 무시된다.
 *      JS 가 canonical 을 바꾸는 코드도 0건이었다(전수 grep).
 *   3. 프리렌더가 홈 골격 하나뿐 → JS 안 도는 봇(네이버 Yeti·카톡)에겐 전부 홈.
 *
 * 이 테스트는 그 셋이 되돌아오는 것을 막는다.
 */
import { describe, it, expect } from "vitest";
import { esc, aptFacts, buildAptHtml, buildSitemap } from "./postbuild-prerender.mjs";

/** index.html 의 관련 태그만 추린 최소 틀 (실제 파일과 같은 형태) */
const TEMPLATE = [
  `<!DOCTYPE html><html lang="ko"><head>`,
  `<meta name="description" content="전국 미분양 아파트를 6개 카테고리 41개 지표로 비교 분석" />`,
  `<meta property="og:title" content="미분양 비교 엔진 v3.0" />`,
  `<meta property="og:url" content="https://www.xn--hg3bi2ac4o1ig57cnoa.com/" />`,
  `<meta name="twitter:title" content="미분양 비교 엔진 v3.0" />`,
  `<link rel="canonical" href="https://www.xn--hg3bi2ac4o1ig57cnoa.com/" />`,
  `<title>미분양 비교 엔진 v3.0</title>`,
  `</head><body><div id="root" class="notranslate"></div></body></html>`,
].join("\n");

const APT = {
  id: "ah-2020910001",
  name: "강서　크라운팰리스（서울）",
  region: "서울",
  gu: "강서구",
  dong: "화곡6동",
  price: 24400,
  area: 20.11,
  builder: "강서크라운팰리스",
  units: 50,
  unsold: 7,
  subwayDist: 1173,
  subwayName: "우장산역",
  busRoutes: 18,
};

describe("esc — HTML 이스케이프", () => {
  it("꺾쇠·따옴표·앰퍼샌드를 막는다 (단지명에 섞여도 마크업이 깨지지 않게)", () => {
    expect(esc(`<b>"A"&B</b>`)).toBe("&lt;b&gt;&quot;A&quot;&amp;B&lt;/b&gt;");
  });

  it("null/undefined 는 빈 문자열", () => {
    expect(esc(null)).toBe("");
    expect(esc(undefined)).toBe("");
  });
});

describe("aptFacts — 화면에 실제 나오는 값만 문장으로", () => {
  it("있는 값만 담는다", () => {
    const facts = aptFacts(APT);
    expect(facts.join(" | ")).toMatch(/위치: 서울 강서구 화곡6동/);
    expect(facts.join(" | ")).toMatch(/분양가: 24,400만원/);
    expect(facts.join(" | ")).toMatch(/지하철: 우장산역 1173m/);
  });

  it("없는 값은 문장을 만들지 않는다 (빈칸·null 을 '정보 있음' 처럼 보이게 하지 않기)", () => {
    const facts = aptFacts({ id: "x", name: "이름만", region: null, price: null, builder: null });
    expect(facts.some((f) => f.includes("분양가"))).toBe(false);
    expect(facts.some((f) => f.includes("시공사"))).toBe(false);
  });

  it("0 은 값이다 — 미분양 0세대를 빠뜨리지 않는다", () => {
    const facts = aptFacts({ id: "x", name: "n", unsold: 0 });
    expect(facts.some((f) => f === "미분양: 0세대")).toBe(true);
  });
});

describe("buildAptHtml — 단지마다 제 canonical·제목·본문", () => {
  const html = buildAptHtml(TEMPLATE, APT);

  it("canonical 이 그 단지 주소다 (루트가 아니라)", () => {
    expect(html).toContain(
      `<link rel="canonical" href="https://www.xn--hg3bi2ac4o1ig57cnoa.com/apt/ah-2020910001" />`,
    );
    expect(html).not.toContain(`<link rel="canonical" href="https://www.xn--hg3bi2ac4o1ig57cnoa.com/" />`);
  });

  it("og:url 도 그 단지 주소다 (카톡·페북 공유)", () => {
    expect(html).toContain(`content="https://www.xn--hg3bi2ac4o1ig57cnoa.com/apt/ah-2020910001"`);
  });

  it("제목이 화면(DetailModal)이 만드는 것과 글자 그대로 같다", () => {
    // DetailModal.tsx:200 — `${name}${where ? ` (${where})` : ""} 분양가·미분양 | 미분양 비교`
    const expected = "강서　크라운팰리스（서울） (서울 강서구) 분양가·미분양 | 미분양 비교";
    expect(html).toContain(`<title>${expected}</title>`);
    expect(html).toContain(`<meta property="og:title" content="${expected}" />`);
  });

  it("h1 이 단지명 하나다 (홈 h1 과 겹쳐 2개가 되지 않게)", () => {
    const h1s = html.match(/<h1>/g) ?? [];
    expect(h1s).toHaveLength(1);
    expect(html).toContain("<h1>강서　크라운팰리스（서울）</h1>");
  });

  it("본문에 단지 정보가 실려 있다 (JS 안 도는 봇이 읽을 것)", () => {
    expect(html).toMatch(/분양가: 24,400만원/);
    expect(html).toMatch(/시공사: 강서크라운팰리스/);
    expect(html).not.toMatch(/<div id="root"[^>]*>\s*<\/div>/); // 빈 root 가 남으면 안 된다
  });

  it("틀을 망가뜨리지 않는다 — 치환은 각 1곳뿐", () => {
    expect((html.match(/rel="canonical"/g) ?? [])).toHaveLength(1);
    expect((html.match(/<title>/g) ?? [])).toHaveLength(1);
  });
});

describe("buildSitemap — 단지를 구글이 발견할 수 있게", () => {
  const xml = buildSitemap(["ah-1", "ap-2"], "2026-08-08");

  it("고정 경로 2개 + 단지 전량이 들어간다", () => {
    expect((xml.match(/<url>/g) ?? [])).toHaveLength(4);
    expect(xml).toContain("<loc>https://www.xn--hg3bi2ac4o1ig57cnoa.com/</loc>");
    expect(xml).toContain("<loc>https://www.xn--hg3bi2ac4o1ig57cnoa.com/upcoming</loc>");
    expect(xml).toContain("<loc>https://www.xn--hg3bi2ac4o1ig57cnoa.com/apt/ah-1</loc>");
  });

  it("단지 주소가 buildAptHtml 의 canonical 과 정확히 같다", () => {
    // 다르면 구글이 "sitemap 과 canonical 이 어긋난다" 고 본다 (공식 문서 경고).
    const html = buildAptHtml(TEMPLATE, { ...APT, id: "ah-1" });
    const canonical = html.match(/rel="canonical" href="([^"]+)"/)?.[1];
    expect(canonical).toBeTruthy();
    expect(xml).toContain(`<loc>${canonical}</loc>`);
  });

  it("유효한 XML 머리와 닫는 태그를 갖는다", () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml.trimEnd().endsWith("</urlset>")).toBe(true);
  });
});
