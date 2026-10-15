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
import { esc, aptFacts, buildAptHtml, buildAptJsonLd, buildHomeSkeleton, buildUpcomingHtml, buildSitemap } from "./postbuild-prerender.mjs";

/** index.html 의 관련 태그만 추린 최소 틀 (실제 파일과 같은 형태) */
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

  it("지하철 9999(10km 안에 역 없음)는 거리를 쓰지 않는다 — 이름만 남거나 줄이 없다", () => {
    const withName = aptFacts({ id: "x", name: "n", subwayDist: 9999, subwayName: "우장산역" });
    expect(withName).toContain("지하철: 우장산역");
    expect(withName.join(" | ")).not.toContain("9999");
    const noName = aptFacts({ id: "x", name: "n", subwayDist: 9999 });
    expect(noName.some((f) => f.includes("지하철"))).toBe(false);
    expect(noName.join(" | ")).not.toContain("9999");
  });

  it("지하철 거리가 숫자가 아니거나 음수여도 거리는 쓰지 않는다", () => {
    expect(aptFacts({ id: "x", name: "n", subwayDist: "abc", subwayName: "A역" })).toContain("지하철: A역");
    expect(aptFacts({ id: "x", name: "n", subwayDist: -5 }).some((f) => f.includes("지하철"))).toBe(false);
  });

  it("좌표 공유(coordShared)면 지하철·버스 줄이 없다", () => {
    const facts = aptFacts({ ...APT, coordShared: true });
    expect(facts.some((f) => f.includes("지하철"))).toBe(false);
    expect(facts.some((f) => f.includes("버스"))).toBe(false);
  });

  it("버스는 노선 수 — 0 이면 줄이 없고 12 면 '버스: 12개 노선'", () => {
    expect(aptFacts({ id: "x", name: "n", busRoutes: 0 }).some((f) => f.includes("버스"))).toBe(false);
    expect(aptFacts({ id: "x", name: "n", busRoutes: 12 })).toContain("버스: 12개 노선");
    expect(aptFacts({ id: "x", name: "n", busRoutes: 12 }).join(" ")).not.toContain("정류장");
  });

  it("준공은 화면(fmtCompletion)과 같은 말 — 6자리면 'YYYY년 MM월', 아니면 원문", () => {
    expect(aptFacts({ id: "x", name: "n", completion: "202007" })).toContain("준공: 2020년 07월");
    expect(aptFacts({ id: "x", name: "n", completion: "2029 미" })).toContain("준공: 2029 미");
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

  it("og:description 과 twitter:description 도 단지 요약 정보로 치환된다 (홈 문구가 아니라)", () => {
    expect(html).toContain(
      `<meta property="og:description" content="강서　크라운팰리스（서울） (서울 강서구) 분양가·미분양 정보.`,
    );
    expect(html).toContain(
      `<meta name="twitter:description" content="강서　크라운팰리스（서울） (서울 강서구) 분양가·미분양 정보.`,
    );
    expect(html).not.toContain(
      `<meta property="og:description" content="전국 미분양 아파트를 6개 카테고리 41개 지표로 비교 분석" />`,
    );
    expect(html).not.toContain(
      `<meta name="twitter:description" content="전국 미분양 아파트를 6개 카테고리 41개 지표로 비교 분석" />`,
    );
  });

  it("틀을 망가뜨리지 않는다 — 치환은 각 1곳뿐", () => {
    expect((html.match(/rel="canonical"/g) ?? [])).toHaveLength(1);
    expect((html.match(/<title>/g) ?? [])).toHaveLength(1);
  });
});

describe("buildUpcomingHtml — /upcoming 정적 페이지 프리렌더", () => {
  const html = buildUpcomingHtml(TEMPLATE);

  it("canonical 과 og:url 이 /upcoming 주소다", () => {
    expect(html).toContain(
      `<link rel="canonical" href="https://www.xn--hg3bi2ac4o1ig57cnoa.com/upcoming" />`,
    );
    expect(html).toContain(
      `<meta property="og:url" content="https://www.xn--hg3bi2ac4o1ig57cnoa.com/upcoming" />`,
    );
  });

  it("제목과 설명이 분양 예정 캘린더 안내로 치환된다", () => {
    expect(html).toContain("<title>분양 예정 아파트 캘린더·일정 | 전국 미분양 비교 엔진</title>");
    expect(html).toContain(
      `<meta property="og:title" content="분양 예정 아파트 캘린더·일정 | 전국 미분양 비교 엔진" />`,
    );
    expect(html).toContain(
      `<meta property="og:description" content="전국 분양 예정·청약 일정 및 분양 현황을 캘린더와 단지 목록으로 확인하고 비교 분석해 보세요." />`,
    );
  });

  it("본문에 분양 예정 안내 골격이 실려 있다", () => {
    expect(html).toContain("<h1>전국 분양 예정 아파트</h1>");
    expect(html).not.toMatch(/<div id="root"[^>]*>\s*<\/div>/);
  });
});

describe("buildSitemap — 단지를 구글이 발견할 수 있게", () => {
  const xml = buildSitemap(["ah-1", "ap-2"]);

  it("lastmod 를 쓰지 않는다 (실제 변경일을 모르므로 빌드 날짜를 넣지 않는다)", () => {
    expect(xml).not.toContain("lastmod");
  });

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

describe("buildHomeSkeleton — 홈에서 지역별 단지로 건너갈 링크", () => {
  /** @param {string} region @param {number} n */
  const mk = (region, n, prefix = "p") =>
    Array.from({ length: n }, (_, i) => ({ id: `${prefix}-${region || "none"}-${i + 1}`, name: `${region || "무지역"}단지${i + 1}`, region }));
  const list = [
    ...mk("서울", 10),
    ...mk("인천", 2),
    ...mk("경기", 2),
    ...mk("부산", 1),
    ...mk("", 1),
  ];
  list.push({ id: "x-1", name: "<b>위험</b>단지", region: "경기" });
  const html = buildHomeSkeleton(list);

  it("지역 이름도 esc 한다", () => {
    const h = buildHomeSkeleton([{ id: "r-1", name: "단지", region: "<r>" }]);
    expect(h).toContain("&lt;r&gt; (1곳)");
    expect(h).not.toContain("<r>");
  });

  it("기존 h1·소개·주요 기능과 마지막 안내문을 유지한다", () => {
    expect(html).toContain("<h1>전국 미분양 비교 엔진</h1>");
    expect(html).toContain("<h2>주요 기능</h2>");
    expect(html.startsWith('<div id="root" class="notranslate">')).toBe(true);
    expect(html).toContain("<p>화면이 보이지 않으면 JavaScript 를 활성화해 주세요.</p>");
  });

  it("분양 예정 링크가 있다", () => {
    expect(html).toContain('<h2>분양 예정</h2><p><a href="/upcoming">분양 예정 아파트 일정 보기</a></p>');
    expect(html).toContain("<h2>지역별 단지</h2>");
  });

  it("지역마다 묶고 지역 이름·곳 수를 적는다", () => {
    expect(html).toContain("<h3>서울 (10곳)</h3>");
    expect(html).toContain("<h3>경기 (3곳)</h3>");
    expect(html).toContain("<h3>기타 (1곳)</h3>");
  });

  it("지역 순서 = 단지 수 많은 순, 같으면 이름순 (region 빈 단지는 '기타')", () => {
    const order = [...html.matchAll(/<h3>([^ ]+) \(/g)].map((m) => m[1]);
    expect(order).toEqual(["서울", "경기", "인천", "기타", "부산"]);
  });

  it("지역마다 목록 순서대로 앞 8곳만 링크하고 나머지는 '외 N곳'(링크 아님)", () => {
    const seoul = html.split("<h3>서울 (10곳)</h3>")[1].split("<h3>")[0];
    expect((seoul.match(/<a href=/g) ?? [])).toHaveLength(8);
    expect(seoul).toContain('<a href="/apt/p-%EC%84%9C%EC%9A%B8-1">');
    expect(seoul).toContain("<li>외 2곳</li>");
    expect(seoul).not.toContain("서울단지9");
    expect(seoul.indexOf("서울단지1<")).toBeLessThan(seoul.indexOf("서울단지2<"));
    const busan = html.split("<h3>부산 (1곳)</h3>")[1].split("<h3>")[0];
    expect(busan).not.toContain("외 ");
  });

  it("단지 이름은 이스케이프한다 (마크업이 깨지지 않게)", () => {
    expect(html).toContain("&lt;b&gt;위험&lt;/b&gt;단지");
    expect(html).not.toContain("<b>위험");
  });

  it("id/name 없는 항목은 건너뛴다", () => {
    const h = buildHomeSkeleton(/** @type {any[]} */ ([null, { id: "a" }, { name: "n" }, { id: "ok", name: "정상", region: "서울" }]));
    expect(h).toContain("<h3>서울 (1곳)</h3>");
    expect(h).not.toContain("기타");
  });
});

describe("buildAptHtml — JSON-LD", () => {
  /** @param {string} html */
  const ldOf = (html) => {
    const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(m).toBeTruthy();
    return JSON.parse(m ? m[1] : "null");
  };

  it("</head> 바로 앞에 JSON-LD 하나, 파싱 가능하고 화면 값만 담는다", () => {
    const html = buildAptHtml(TEMPLATE, APT);
    expect((html.match(/application\/ld\+json/g) ?? [])).toHaveLength(1);
    expect(html).toMatch(/<\/script>\s*<\/head>/);
    const ld = ldOf(html);
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("ApartmentComplex");
    expect(ld.name).toBe(APT.name);
    expect(ld.url).toBe("https://www.xn--hg3bi2ac4o1ig57cnoa.com/apt/ah-2020910001");
    expect(ld.address).toEqual({
      "@type": "PostalAddress",
      addressCountry: "KR",
      addressRegion: "서울",
      addressLocality: "강서구",
      streetAddress: "화곡6동",
    });
    expect(ld.numberOfAccommodationUnits).toBe(50);
  });

  it("값이 없으면 키를 뺀다 (units 0·null, 주소 없음)", () => {
    const zero = ldOf(buildAptHtml(TEMPLATE, { ...APT, units: 0 }));
    expect("numberOfAccommodationUnits" in zero).toBe(false);
    const bare = ldOf(buildAptHtml(TEMPLATE, { id: "x", name: "이름만", region: null, gu: "", dong: "  ", units: null }));
    expect("numberOfAccommodationUnits" in bare).toBe(false);
    expect("address" in bare).toBe(false);
    const partial = buildAptJsonLd({ id: "x", name: "n", region: "서울" }, "u");
    expect(JSON.parse(partial).address).toEqual({ "@type": "PostalAddress", addressCountry: "KR", addressRegion: "서울" });
  });

  it("이름에 </script> 가 들어 있어도 스크립트가 끊기지 않는다", () => {
    const html = buildAptHtml(TEMPLATE, { ...APT, name: 'A</script><img src=x onerror=alert(1)>' });
    const block = (html.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/) ?? [""])[0];
    expect(block.slice(block.indexOf(">") + 1, -"</script>".length)).not.toContain("<");
    expect(ldOf(html).name).toBe('A</script><img src=x onerror=alert(1)>');
    expect((html.match(/<\/script>/g) ?? [])).toHaveLength(1);
  });

  it("이름이 </script><script>alert(1)</script> 여도 블록 안에 <, >, & 가 날것으로 없고 JSON.parse 하면 원래 이름이 나온다", () => {
    const evil = "</script><script>alert(1)</script> & x" + String.fromCharCode(0x2028);
    const html = buildAptHtml(TEMPLATE, { ...APT, name: evil });
    const block = (html.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/) ?? [""])[0];
    const inner = block.slice(block.indexOf(">") + 1, -"</script>".length);
    expect(inner).not.toMatch(/[<>&\u2028\u2029]/);
    expect(inner).toContain("\\u003c/script\\u003e");
    expect((block.match(/<\/script/g) ?? [])).toHaveLength(1);
    expect(JSON.parse(inner).name).toBe(evil);
  });

  it("템플릿에 </head> 가 정확히 1개가 아니면 throw", () => {
    expect(() => buildAptHtml(TEMPLATE.replace("</head>", ""), APT)).toThrow();
    expect(() => buildAptHtml(TEMPLATE + "</head>", APT)).toThrow();
  });
});

describe("aptFacts — 역 이름 없으면 지하철 줄 없음(화면과 같게)", () => {
  it("이름 없이 거리만 있으면 줄을 만들지 않는다", () => {
    expect(aptFacts({ id: 1, name: "n", subwayDist: 500 }).some((f) => f.startsWith("지하철"))).toBe(false);
  });
  it("이름과 정상 거리가 있으면 이름 + 거리", () => {
    expect(aptFacts({ id: 1, name: "n", subwayName: "강남역", subwayDist: 499.6 })).toContain("지하철: 강남역 500m");
  });
});
