// @ts-check
/**
 * 정적 단지 장 본문(세션672 PR-S4) — 장 단위 규칙 시험. 줄 글자 자체의 화면 같음 시험은 src/utils/aptStaticBody.test.jsx.
 *
 * 막는 것:
 *  - 꾸러미(상세 버킷) 없이 조용히 얇은 장을 만든다(빌드는 빨개야 한다)
 *  - 꾸러미 칸(공고명·학교·평형 표)이 본문에 안 닿는다(목록 행만 읽음)
 *  - 꼬리 두 줄이 단지 장에 되살아나거나, 홈·분양 예정·허브에서 사라진다
 *  - 출처 줄이 빠지거나 두 번 · S3 블록 자리(마지막 절 뒤 · 출처 앞)가 바뀐다
 *  - 요약 p 와 meta·og·twitter description 이 갈라진다
 * 픽스처 = src/utils/aptStaticBody.fixture.json(운영 자료에서 뽑은 진짜 단지) → 실제 빌드처럼 목록·꾸러미로 쪼갬(static-outputs).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, mkdtempSync, writeFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAptHtml, buildAptPages, buildHomeSkeleton, buildUpcomingHtml, buildRegionPages, loadDetailMap } from "./postbuild-prerender.mjs";
import { buildListData, buildDetailBuckets, detailBucketName } from "./static-outputs.mjs";
import { SOURCE_TEXT, buildAptSections } from "../src/utils/aptStaticBody.mjs";

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

/** @type {Array<Record<string, any>>} */
const FULL = JSON.parse(readFileSync(new URL("../src/utils/aptStaticBody.fixture.json", import.meta.url), "utf-8")).data;
// 실제 빌드와 같은 쪼개기 — 목록(상세 전용 칸 빠짐) + 꾸러미 16개
const LIST = /** @type {Array<Record<string, any>>} */ (buildListData(FULL));
const BUCKETS = buildDetailBuckets(FULL);
const DETAILS = new Map(BUCKETS.flatMap((b) => b.data).map((r) => [String(/** @type {any} */ (r).id), /** @type {Record<string, any>} */ (r)]));
const { pages } = buildAptPages(TEMPLATE, LIST, DETAILS);
/** @param {string} id */
const pageOf = (id) => /** @type {{ html: string }} */ (pages.find((p) => p.id === id)).html;
/** @param {string} html */
const rootOf = (html) => html.slice(html.indexOf('<div id="root"'), html.indexOf("</main>"));
/** @param {string} s @param {string} sub */
const countOf = (s, sub) => s.split(sub).length - 1;
const TAIL_HOME = "전국 미분양 아파트 비교 목록으로";
const TAIL_JS = "화면이 보이지 않으면 JavaScript 를 활성화해 주세요.";

describe("본문 = 목록 행 ∪ 꾸러미 행", () => {
  it("목록에는 꾸러미 칸이 없고(쪼개기 확인) 본문에는 꾸러미 칸 값이 닿는다 — 공고명·학교·평형 표", () => {
    const withNotice = /** @type {Record<string, any>} */ (FULL.find((a) => a.noticeName && a.noticeName !== a.name));
    expect(LIST.find((a) => a.id === withNotice.id)?.noticeName).toBeUndefined();
    expect(rootOf(pageOf(withNotice.id))).toContain(`<li>공고명: ${withNotice.noticeName.replace(/&/g, "&amp;")}</li>`);
    const g = rootOf(pageOf("ah-2025910101"));
    expect(g).toContain("<li>서울고척초등학교(초) 305m</li>");
    expect(g).toContain("<h3>이 단지 평형별 분양권 거래 (최근 12개월)</h3>");
    expect(g).toContain("<li>★ 60㎡대 · 분양권 9.7억~12억 5건</li>");
  });
  it("장마다 본문 절 = buildAptSections(목록 ∪ 꾸러미) 그대로", () => {
    for (const a of LIST) {
      const m = { ...a, ...DETAILS.get(String(a.id)) };
      const root = rootOf(pageOf(String(a.id)));
      for (const s of buildAptSections(m)) {
        expect(root).toContain(`<h2>${s.title}</h2>`);
        for (const l of s.lines) expect(root).toContain(l.h3 ? `<h3>` : `<li>`);
      }
      expect(countOf(root, "<h2>")).toBe(buildAptSections(m).length + (root.includes("가까운 단지 (직선거리)</h2>") ? 1 : 0));
    }
  });
});

describe("장 모양 — 출처 1줄 · S3 블록 자리 · 꼬리 줄", () => {
  it("출처 줄이 장마다 정확히 1번, 본문 맨 끝", () => {
    for (const p of pages) {
      const root = rootOf(p.html);
      expect(countOf(root, SOURCE_TEXT)).toBe(1);
      expect(root.endsWith(`<p>${SOURCE_TEXT}</p>`)).toBe(true);
    }
  });
  it("S3 블록(경로 줄)은 마지막 절 뒤 · 출처 앞", () => {
    for (const p of pages) {
      const root = rootOf(p.html);
      const iNav = root.indexOf('<nav aria-label="breadcrumb">');
      const iLastSection = root.lastIndexOf("<h2>", iNav);
      expect(iNav).toBeGreaterThan(-1);
      expect(iLastSection).toBeGreaterThan(-1);
      expect(root.indexOf("<h2>", iNav) === -1 || root.slice(iNav).includes("가까운 단지 (직선거리)</h2>")).toBe(true);
      expect(iNav).toBeLessThan(root.indexOf(SOURCE_TEXT));
    }
  });
  it("꼬리 두 줄 = 단지 장 0 · 홈·분양 예정·허브 장은 그대로", () => {
    for (const p of pages) {
      expect(p.html).not.toContain(TAIL_HOME);
      expect(p.html).not.toContain(TAIL_JS);
    }
    expect(buildHomeSkeleton(LIST)).toContain(TAIL_JS);
    const up = buildUpcomingHtml(TEMPLATE);
    expect(up).toContain(TAIL_HOME);
    expect(up).toContain(TAIL_JS);
    for (const h of buildRegionPages(TEMPLATE, LIST).pages) expect(h.html).toContain(TAIL_JS);
  });
});

describe("요약 p = meta description = og·twitter description (새 꼴) · title 그대로", () => {
  const html = pageOf("ah-2025910101");
  const want =
    "고척 푸르지오 힐스테이트 (서울 구로구) 분양가·미분양 정보. 주소: 서울시 구로구 고척동 · 분양가: 9억 870만 (전용 59.95㎡) · 총 983세대 · 미분양 29세대 · 입주: 2028년 08월";
  it("목업 글자 그대로", () => {
    expect(html).toContain(`<p>${want}</p>`);
    expect(html).toContain(`<meta name="description" content="${want}" />`);
    expect(html).toContain(`<meta property="og:description" content="${want}" />`);
    expect(html).toContain(`<meta name="twitter:description" content="${want}" />`);
  });
  it("장마다 요약 p 와 세 description 이 같은 글", () => {
    for (const p of pages) {
      const desc = /<meta name="description" content="([^"]*)" \/>/.exec(p.html)?.[1];
      expect(desc).toBeTruthy();
      expect(p.html).toContain(`<p>${desc}</p>`);
      expect(p.html).toContain(`<meta property="og:description" content="${desc}" />`);
      expect(p.html).toContain(`<meta name="twitter:description" content="${desc}" />`);
    }
  });
  it("title·JSON-LD 2개는 그대로", () => {
    expect(html).toContain("<title>고척 푸르지오 힐스테이트 (서울 구로구) 분양가·미분양 | 미분양 비교</title>");
    expect(countOf(html, "application/ld+json")).toBe(2);
  });
});

describe("꾸러미 지도는 필수 — 빠지면 던짐(빌드 빨강)", () => {
  const a = LIST[0];
  it("buildAptPages·buildAptHtml 에 지도가 없거나 그 단지 행이 없으면 던진다", () => {
    expect(() => buildAptPages(TEMPLATE, LIST, /** @type {any} */ (undefined))).toThrow(/꾸러미/);
    expect(() => buildAptHtml(TEMPLATE, a, /** @type {any} */ ({}))).toThrow(/꾸러미/);
    expect(() => buildAptHtml(TEMPLATE, a, /** @type {any} */ (undefined))).toThrow(/꾸러미/);
    expect(() => buildAptHtml(TEMPLATE, a, { details: new Map() })).toThrow(/꾸러미/);
  });

  /** @param {(dir: string) => void} fn */
  const withDir = (fn) => {
    const dir = mkdtempSync(join(tmpdir(), "s672-buckets-"));
    try {
      for (const b of BUCKETS) {
        writeFileSync(join(dir, detailBucketName(b.bucket)), JSON.stringify({ ok: true, n: 16, bucket: b.bucket, data: b.data }));
      }
      fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  it("loadDetailMap — 정상이면 목록 유효 단지 전부의 지도", () => {
    withDir((dir) => {
      const m = loadDetailMap(dir, LIST);
      expect(m.size).toBe(LIST.length);
      expect(m.get("ah-2025910101")?.nearbySchools?.length).toBeGreaterThan(0);
    });
  });
  it("loadDetailMap — 꾸러미 파일 하나라도 없으면 던진다", () => {
    withDir((dir) => {
      unlinkSync(join(dir, detailBucketName(5)));
      expect(() => loadDetailMap(dir, LIST)).toThrow(/apartments-detail-16-5\.json 없음/);
    });
  });
  it("loadDetailMap — 행 합이 목록 유효 행 수와 다르면 던진다(다른 회차)", () => {
    withDir((dir) => {
      expect(() => loadDetailMap(dir, [...LIST, { id: "new-1", name: "새 단지" }])).toThrow(/행 합/);
    });
  });
  it("loadDetailMap — 수는 같아도 목록 단지가 꾸러미에 없으면 던진다", () => {
    withDir((dir) => {
      const swapped = [...LIST.slice(1), { id: "zz-404", name: "없는 단지" }];
      expect(() => loadDetailMap(dir, swapped)).toThrow(/없는 단지 1곳/);
    });
  });
  it("main() — 꾸러미를 목록 직후·첫 쓰기 전에 읽고, 실패면 exit 1", () => {
    const src = readFileSync(new URL("./postbuild-prerender.mjs", import.meta.url), "utf-8");
    const body = src.slice(src.indexOf("function main() {"), src.indexOf("// CLI 로 직접 실행"));
    const iLoad = body.indexOf('details = loadDetailMap(join(DIST, "data"), list);');
    expect(iLoad).toBeGreaterThan(0);
    expect(iLoad).toBeLessThan(body.indexOf("writeFileSync(DIST_INDEX"));
    expect(body.slice(iLoad, body.indexOf("writeFileSync(DIST_INDEX"))).toMatch(/catch \(e\) \{[\s\S]*?process\.exit\(1\);/);
  });
});
