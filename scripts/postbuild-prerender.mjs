// @ts-check
/**
 * postbuild 프리렌더 — dist/index.html 의 빈 #root 에 검색봇용 정적 골격 주입.
 *
 * 배경(세션 457 SEO 진단): SPA(React CSR)라 첫 HTML 의 <div id="root"></div> 가 비어
 * 있어 JS 미실행 봇(네이버 Yeti·카톡/페북 공유 크롤러)이 빈 페이지로 인식 → 검색·공유 누락.
 *
 * 처방: 빌드 후 dist/index.html 의 #root 안에 홈 화면의 핵심 텍스트(h1·서비스 설명·주요
 * 기능)를 정적 HTML 로 주입. 브라우저에서 main.tsx 의 ReactDOM.createRoot().render() 가
 * 실행되면 createRoot 는 #root 의 기존 자식을 전부 비우고 교체하므로(hydrateRoot 아님)
 * hydration mismatch 0 = 사용자 화면 무영향, 봇만 본문을 본다.
 *
 * Rolldown 무관: Vite 빌드 산출물(dist/index.html)을 사후 텍스트 후처리만 함.
 *
 * 실행: package.json "postbuild": "node scripts/postbuild-prerender.mjs" (vite build 후 자동).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
// 경로 줄 + 같은 구 가까운 단지(세션671 PR-S3) — 앱 DetailModal 과 같은 구현을 쓴다(복사 금지, 결정 27).
import { badDirName, buildNearbyBlock, createNearbyIndex } from "../src/utils/nearbyComplexes.mjs";
// 단지 장 본문(세션672 PR-S4) — 상세 창 탭 값을 화면과 같은 글자로(사본 + 같음 시험은 그 파일 쪽).
// 허브 장이 쓰던 표기 사본 3개(fmtPriceNode·fmtMoveInNode·hubUnitsText)도 그 파일로 옮겼다 — 여기서 다시 내보낸다.
import {
  SOURCE_TEXT,
  basicLinesNode,
  buildAptSections,
  fmtMoveInNode,
  fmtPriceNode,
  hubUnitsText,
} from "../src/utils/aptStaticBody.mjs";
import { DETAIL_BUCKET_COUNT, detailBucketName } from "../src/utils/bucketHash.mjs";

export { fmtMoveInNode, fmtPriceNode, hubUnitsText };

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(__dirname, "..", "dist");
const DIST_INDEX = resolve(DIST, "index.html");
const DIST_LIST = resolve(DIST, "data", "apartments-list.json");
const DIST_SITEMAP = resolve(DIST, "sitemap.xml");
const DIST_SEO_THIN = resolve(DIST, "data", "seo-thin.json");

/** 운영 도메인 (index.html 의 canonical·og:url 과 같아야 한다) */
const ORIGIN = "https://www.xn--hg3bi2ac4o1ig57cnoa.com";

// 봇이 읽을 홈 화면 정적 골격. 사용자 화면엔 React 가 교체하므로 미노출.
// aria-hidden 불필요(React 가 즉시 비움). 화면에 실제 노출되는 정보만 담아 cloaking 회피.
const SKELETON_HEAD = `<div id="root" class="notranslate"><main style="max-width:960px;margin:0 auto;padding:24px;font-family:sans-serif"><h1>전국 미분양 비교 엔진</h1><p>전국 미분양·분양 예정 아파트를 6개 카테고리 41개 지표로 AHP 점수화하고, 실거주·투자·신혼·교육·은퇴 5가지 사용자 프로필 가중치를 적용해 개인 맞춤 추천을 제공하는 다기준 의사결정 엔진입니다.</p><h2>주요 기능</h2><ul><li>전국 미분양 아파트 비교 분석</li><li>분양 예정 단지 정보</li><li>실거주·투자·신혼·교육·은퇴 프로필별 맞춤 점수</li><li>입지·가격·안전도·미래가치·환경 등 다기준 평가</li></ul>`;
const SKELETON_TAIL = `<p>화면이 보이지 않으면 JavaScript 를 활성화해 주세요.</p></main></div>`;

/** 홈 골격에서 지역마다 보여 줄 단지 링크 수 (홈 화면 목록에 실제 보이는 단지 앞쪽) */
const HOME_LINKS_PER_REGION = 8;

/**
 * 홈 골격 HTML (#root 통째). 기존 소개 + 분양 예정 링크 + 지역별 단지 링크.
 * 링크 단지는 홈 화면 목록에 실제로 보이는 단지(목록 순서 앞쪽)라 cloaking 이 아니다 —
 * JS 안 도는 봇이 홈에서 /apt/{id} 로 건너갈 길을 준다.
 * 지역 순서 = 단지 수 많은 순, 같으면 이름순. region 이 비면 "기타".
 *
 * @param {Array<Record<string, any>>} list apartments-list.json 의 단지 배열
 * @returns {string}
 */
export function buildHomeSkeleton(list) {
  /** @type {Map<string, Array<Record<string, any>>>} */
  const byRegion = new Map();
  for (const a of list) {
    if (!a || !a.id || !a.name) continue;
    const r = (typeof a.region === "string" && a.region.trim()) || "기타";
    const arr = byRegion.get(r);
    if (arr) arr.push(a);
    else byRegion.set(r, [a]);
  }
  const regions = [...byRegion.entries()].sort(
    (x, y) => y[1].length - x[1].length || (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0),
  );
  const sections = regions
    .map(([r, apts]) => {
      const items = apts
        .slice(0, HOME_LINKS_PER_REGION)
        .map((a) => `<li><a href="/apt/${encodeURIComponent(a.id)}">${esc(a.name)}</a></li>`)
        .join("");
      const more =
        apts.length > HOME_LINKS_PER_REGION ? `<li>외 ${apts.length - HOME_LINKS_PER_REGION}곳</li>` : "";
      // 시도 17종이면 제목이 시도 허브 링크(세션669 결정 37) — "기타"·밖 값은 링크 없음
      const head = SIDO_SET.has(r) ? `<a href="${esc(regionHubPath(r))}">${esc(r)}</a>` : esc(r);
      return `<h3>${head} (${apts.length}곳)</h3><ul>${items}${more}</ul>`;
    })
    .join("");
  return (
    SKELETON_HEAD +
    `<h2>분양 예정</h2><p><a href="/upcoming">분양 예정 아파트 일정 보기</a></p>` +
    `<h2>지역별 단지</h2>${sections}` +
    SKELETON_TAIL
  );
}

// #root 빈 div 를 골격으로 교체. class/속성 순서 변경에 견디게 느슨한 매칭
// (적대검증 권고 — Vite/Rolldown 미래 버전이 속성을 바꿔도 매치되게).
const ROOT_RE = /<div id="root"[^>]*>\s*<\/div>/;

// ── 단지별 정적 페이지 (세션 504, 감사 단계 2-C) ────────────────────
//
// 세션503 이 `/apt/{id}` 주소를 열었지만 **세 가지가 남아 그 주소가 검색에 쓸모가 없었다**:
//   1. 구글이 단지 페이지를 **모른다** — sitemap.xml 에 홈·/upcoming 2개뿐이었다
//      (인계문의 "sitemap 2,043개" 는 사실이 아니었다. 실측 2개).
//   2. 발견해도 **홈의 사본** 취급 — index.html 의 canonical 이 루트로 하드코딩돼 있고
//      JS 는 canonical 을 건드리지 않는다(전수 grep 0건). 모든 주소가 같은 canonical.
//   3. JS 를 안 돌리는 봇(네이버 Yeti·카톡)에겐 **전부 홈** — 프리렌더가 홈 골격 하나뿐.
//
// 처방 = 단지마다 `dist/apt/{id}/index.html` 을 만든다. 하나로 셋이 동시에 풀리고
// h1 중복(홈 h1 + 단지 h1)도 사라진다.
//
// ⚠️ 이게 성립하는 근거: Vercel 은 **파일 시스템을 rewrites 보다 먼저** 본다
// (공식 문서: "precedence is given to the filesystem prior to rewrites being applied").
// 그래서 vercel.json 의 `"/(.*)" → "/index.html"` catch-all 이 있어도 이 파일들이 이긴다.
// 이 전제가 깨지면(= rewrites 가 먼저 적용되면) 이 작업 전체가 무효다.
//
// ⚠️ cloaking 회피: 봇에게 보여주는 내용은 **화면에 실제로 나오는 값만** 쓴다
// (AptCard·DetailModal 이 노출하는 가격·면적·시공사·지하철·미분양). 사람이 못 보는
// 정보를 봇에게만 주면 검색엔진 정책 위반이다 — 기존 홈 골격 주석의 원칙을 그대로 잇는다.

/** @param {unknown} s @returns {string} */
export function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── 얇은 단지 검색 제외 (세션668 PR-S1 · 결정 28·29·32) ────────────────────
//
// 주변 시세·병원·분양가 중 둘 이상이 빈 단지 페이지는 글이 거의 없어 "얇은 대량 페이지"로 보일 수 있다.
// 그런 장은 noindex,follow(링크는 따라가게)로 검색에서 빼고 sitemap 에서도 뺀다 — 페이지 자체는 계속 만든다.
// 안전선: 얇은 수가 SEO_THIN_CAP 을 넘으면 수집 사고(칸이 통째로 빈 날)로 보고 그날은 하나도 적용하지 않는다
// (사고 하루에 수백 장이 검색에서 빠지는 것을 막는다). 매 빌드 dist/data/seo-thin.json 에 기록 → 감시 ㉓ 가 본다.

/** 얇은 단지 검색 제외 안전선 — 이보다 많으면 그날은 적용 안 함(결정 32). */
export const SEO_THIN_CAP = 15;

/**
 * 얇은 단지 = `[nearbyMedian, hospital, price]` 중 비어 있는(`== null`) 칸이 2개 이상. 0 은 빈칸이 아니다.
 * @param {Record<string, any>} a
 * @returns {boolean}
 */
export function isThinApt(a) {
  if (!a) return false;
  return [a.nearbyMedian, a.hospital, a.price].filter((v) => v == null).length >= 2;
}

/**
 * 유효 단지(id+name) 중 얇은 단지 명단과 적용 여부. 안전선 이하면 applied:true, 넘으면 false(ids 는 기록용으로 그대로).
 * @param {Array<Record<string, any>>} list
 * names = ids 와 같은 순서의 단지 이름(아침 브리핑 한 줄 · 결정 35).
 * @returns {{ count: number, ids: string[], names: string[], applied: boolean, cap: number }}
 */
export function planThin(list) {
  const thin = list.filter((a) => a && a.id && a.name && isThinApt(a));
  const ids = thin.map((a) => String(a.id));
  const names = thin.map((a) => String(a.name));
  return { count: ids.length, ids, names, applied: ids.length <= SEO_THIN_CAP, cap: SEO_THIN_CAP };
}

/**
 * 단지 페이지들 + sitemap 에 넣을 id + 얇은 단지 기록을 한 번에 만든다(main 이 파일로 쓴다).
 * applied 일 때만 얇은 단지에 noindex 를 달고 sitemap 에서 뺀다. 단지 HTML 은 얇아도 만든다(링크로 닿게).
 * 얇은 판정·허브·칩 후보는 목록만 본다 — 꾸러미(details)는 단지 장 본문에만 쓴다(세션672).
 * @param {string} template dist/index.html 원본 (프리렌더 주입 전)
 * @param {Array<Record<string, any>>} list
 * @param {Map<string, Record<string, any>>} details 상세 꾸러미 id → 행(loadDetailMap) — 빠지면 던진다
 * @returns {{ pages: Array<{ id: string, html: string }>, sitemapIds: string[], thin: { count: number, ids: string[], names: string[], applied: boolean, cap: number } }}
 */
export function buildAptPages(template, list, details) {
  if (!(details instanceof Map)) {
    throw new Error("[postbuild-prerender] buildAptPages 에 상세 꾸러미 지도(details)가 없습니다 — 단지 장 본문을 만들 수 없음");
  }
  const thin = planThin(list);
  const noindexIds = new Set(thin.applied ? thin.ids : []);
  // 같은 구 가까운 단지 칩의 후보 = 목록 전체(허브와 같은 목록 · 세션671)
  const nearby = createNearbyIndex(list);
  /** @type {Array<{ id: string, html: string }>} */
  const pages = [];
  /** @type {string[]} */
  const sitemapIds = [];
  for (const a of list) {
    if (!a || !a.id || !a.name) continue;
    const id = String(a.id);
    const noindex = noindexIds.has(id);
    pages.push({ id, html: buildAptHtml(template, a, { noindex, nearby, details }) });
    if (!noindex) sitemapIds.push(id);
  }
  return { pages, sitemapIds, thin };
}

/** 템플릿에 robots 메타가 이미 있는지 — 있으면 단지 장에 둘이 생기거나 전 장에 퍼진다. */
const ROBOTS_META_RE = /<meta\b[^>]*\bname\s*=\s*["']?robots\b/i;

/**
 * 본문 절 HTML — 절 제목 h2 · 평형 표 제목 h3 · 줄은 ul>li(h3 앞뒤로 ul 을 나눈다).
 * @param {import("../src/utils/aptStaticBody.mjs").BodySection[]} sections @returns {string}
 */
export function aptSectionsHtml(sections) {
  let html = "";
  for (const s of sections) {
    html += `<h2>${esc(s.title)}</h2>`;
    let open = false;
    for (const l of s.lines) {
      if (l.h3) {
        if (open) html += "</ul>";
        open = false;
        html += `<h3>${esc(l.text)}</h3>`;
        continue;
      }
      if (!open) html += "<ul>";
      open = true;
      html += `<li>${esc(l.text)}</li>`;
    }
    if (open) html += "</ul>";
  }
  return html;
}

/**
 * 단지 페이지 HTML 생성. 홈 index.html 을 틀로 삼아 head 5곳 + #root 를 바꾼다.
 * 본문 = h1 · 요약 p · 상세 창 탭 값 절(세션672 PR-S4 — 결정 47 순서) · 경로 줄·가까운 단지(S3) · 출처 한 줄.
 * 본문 값은 **목록 행 ∪ 꾸러미 행**(앱 상세 창 병합과 같은 방향 — 꾸러미 칸이 덮음)에서 읽는다.
 *
 * @param {string} template dist/index.html 원본 (프리렌더 주입 **전**)
 * @param {Record<string, any>} a 단지 1건(목록 행)
 * @param {{ noindex?: boolean, nearby?: import("../src/utils/nearbyComplexes.mjs").NearbyIndex, details?: Map<string, Record<string, any>>, now?: Date }} opts
 *   noindex = 얇은 단지 검색 제외(세션668) · nearby = 같은 구 가까운 단지 색인(세션671 — 없으면 이 단지 하나뿐인 색인 → 경로 줄만) ·
 *   details = 상세 꾸러미 지도(**필수** — 없거나 이 단지 행이 없으면 던진다: 조용히 얇은 장을 만들지 않게) · now = 입주 시기 지남 판정 시각(시험용)
 * @returns {string}
 */
export function buildAptHtml(template, a, opts) {
  if (ROBOTS_META_RE.test(template)) {
    throw new Error('[postbuild-prerender] 템플릿(index.html)에 이미 name="robots" 메타가 있습니다 — 단지 장 noindex 와 겹칩니다');
  }
  const details = opts?.details;
  if (!(details instanceof Map)) {
    throw new Error("[postbuild-prerender] buildAptHtml 에 상세 꾸러미 지도(details)가 없습니다");
  }
  const detail = details.get(String(a.id));
  if (!detail) {
    throw new Error(`[postbuild-prerender] 상세 꾸러미에 단지 ${String(a.id)} 행이 없습니다`);
  }
  const m = { ...a, ...detail };
  const where = [a.region, a.gu].filter(Boolean).join(" ");
  // 제목은 화면(DetailModal.tsx:200)이 만드는 것과 **글자 그대로 같아야** 한다.
  // 다르면 검색결과 제목과 실제 페이지 제목이 어긋난다.
  const title = `${a.name}${where ? ` (${where})` : ""} 분양가·미분양 | 미분양 비교`;
  const sections = buildAptSections(m, { now: opts.now });
  // 요약 = 기본 정보 앞 4줄(세션672 ③10 — 옛 aptFacts 꼴 대체) · meta·og·twitter description 도 같은 글
  // 도로명 줄은 요약에서만 뺀다(👤 결정 50 — 본문 기본 정보 절에는 그대로)
  const summary = basicLinesNode(m)
    .filter((l) => !l.startsWith("도로명: "))
    .slice(0, 4)
    .join(" · ");
  const desc = `${a.name}${where ? ` (${where})` : ""} 분양가·미분양 정보. ${summary}`;
  const url = `${ORIGIN}/apt/${encodeURIComponent(a.id)}`;
  const block = buildNearbyBlock(a, opts.nearby ?? createNearbyIndex([a]), NEARBY_HUB_RULES);

  // 꼬리 두 줄(「전국 미분양 아파트 비교 목록으로」 = 경로 줄 '전국' 과 같은 곳 · JavaScript 안내)은 단지 장에서 뺐다(세션672 ③9)
  const body =
    `<div id="root" class="notranslate">` +
    `<main style="max-width:960px;margin:0 auto;padding:24px;font-family:sans-serif">` +
    `<h1>${esc(a.name)}</h1>` +
    `<p>${esc(desc)}</p>` +
    aptSectionsHtml(sections) +
    nearbyBlockHtml(block) +
    `<p>${esc(SOURCE_TEXT)}</p>` +
    `</main></div>`;

  let html = template;
  // head 치환 — 각 태그는 index.html 에 정확히 1개씩 있다(빌드가 늘리지 않는다).
  html = html.replace(/<link rel="canonical" href="[^"]*"\s*\/>/, `<link rel="canonical" href="${esc(url)}" />`);
  html = html.replace(/<meta property="og:url" content="[^"]*"\s*\/>/, `<meta property="og:url" content="${esc(url)}" />`);
  html = html.replace(/<meta property="og:title" content="[^"]*"\s*\/>/, `<meta property="og:title" content="${esc(title)}" />`);
  html = html.replace(/<meta property="og:description" content="[^"]*"\s*\/>/, `<meta property="og:description" content="${esc(desc)}" />`);
  html = html.replace(/<meta name="twitter:title" content="[^"]*"\s*\/>/, `<meta name="twitter:title" content="${esc(title)}" />`);
  html = html.replace(/<meta name="twitter:description" content="[^"]*"\s*\/>/, `<meta name="twitter:description" content="${esc(desc)}" />`);
  html = html.replace(/<meta name="description" content="[^"]*"\s*\/>/, `<meta name="description" content="${esc(desc)}" />`);
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
  html = html.replace(ROOT_RE, () => body);
  if (html.split("</head>").length !== 2) {
    throw new Error("[postbuild-prerender] 템플릿에 </head> 가 정확히 1개가 아닙니다 — JSON-LD 를 넣을 자리를 못 정함");
  }
  const ld = `<script type="application/ld+json">${buildAptJsonLd(a, url)}</script>`;
  // 경로 줄 구조화 정보는 두 번째 스크립트로(허브 장과 같은 꼴 · 링크 있는 칸 + 단지 canonical)
  const crumbLd = `<script type="application/ld+json">${buildAptBreadcrumbLd(block, url)}</script>`;
  const robots = opts.noindex ? `<meta name="robots" content="noindex,follow" />\n` : "";
  html = html.replace("</head>", () => `${ld}\n${crumbLd}\n${robots}</head>`);
  return html;
}

// ── 단지 장 경로 줄 + 같은 구 가까운 단지 (세션671 PR-S3 · 결정 40~43) ────────────────────
// 계산은 src/utils/nearbyComplexes.mjs 한 곳 — 앱 상세 창과 같은 단지·같은 순서·같은 글자(cloaking 회피, 결정 27).

/** 허브 판정·주소 — 허브 생성기(buildRegionPages)와 같은 규칙 */
const NEARBY_HUB_RULES = {
  /** @param {string} s */
  isSido: (s) => SIDO_SET.has(s),
  hubPath: regionHubPath,
};

/**
 * 블록 HTML — 본문 마지막 절 뒤·출처 줄 앞에 들어간다(세션672). 칩 0개면 경로 줄만.
 * @param {import("../src/utils/nearbyComplexes.mjs").NearbyBlock} b @returns {string}
 */
export function nearbyBlockHtml(b) {
  const crumbs = b.crumbs.map((c) => (c.href ? `<a href="${esc(c.href)}">${esc(c.name)}</a>` : esc(c.name))).join(" › ");
  let html = `<nav aria-label="breadcrumb">${crumbs}</nav>`;
  if (b.chips.length === 0) return html;
  html +=
    `<h2>${esc(b.heading)} (직선거리)</h2>` +
    `<ul>${b.chips.map((c) => `<li><a href="${esc(c.href)}">${esc(c.name)}</a> — ${esc(c.meta)}</li>`).join("")}</ul>`;
  if (b.all) html += `<p><a href="${esc(b.all.href)}">${esc(b.all.label)}</a></p>`;
  return html;
}

/**
 * 단지 장 BreadcrumbList JSON-LD — 링크 있는 칸(전국·시도·구) + 단지(canonical). 절대 주소.
 * @param {import("../src/utils/nearbyComplexes.mjs").NearbyBlock} b @param {string} url canonical @returns {string}
 */
export function buildAptBreadcrumbLd(b, url) {
  const items = b.crumbs.filter((c) => c.href).map((c) => ({ name: c.name, item: `${ORIGIN}${c.href}` }));
  items.push({ name: b.crumbs[b.crumbs.length - 1].name, item: url });
  return ldStringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: c.item })),
  });
}

/**
 * 단지 페이지 구조화 데이터(JSON-LD). 화면에 보이는 값만 — 없는 값은 키째 뺀다(빈 문자열·null 금지).
 * `<` `>` `&` U+2028 U+2029 를 유니코드 이스케이프로 바꿔 단지명에 `</script>` 가 들어 있어도 스크립트가 끊기지 않게 한다.
 * @param {Record<string, any>} a
 * @param {string} url
 * @returns {string}
 */
export function buildAptJsonLd(a, url) {
  /** @param {unknown} v */
  const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  /** @type {Record<string, any>} */
  const address = {};
  if (str(a.region)) address.addressRegion = str(a.region);
  if (str(a.gu)) address.addressLocality = str(a.gu);
  if (str(a.dong)) address.streetAddress = str(a.dong);
  /** @type {Record<string, any>} */
  const ld = { "@context": "https://schema.org", "@type": "ApartmentComplex", name: String(a.name), url };
  if (Object.keys(address).length > 0) {
    ld.address = { "@type": "PostalAddress", addressCountry: "KR", ...address };
  }
  const units = Number(a.units);
  if (a.units != null && Number.isFinite(units) && units > 0) ld.numberOfAccommodationUnits = units;
  return ldStringify(ld);
}

// 스크립트 블록 탈출·HTML 파싱 오해를 막는 문자는 모두 유니코드 이스케이프(결과 문자열이 백슬래시+u+4자리)로.
// 단지 장·허브 장(세션669)이 같이 쓴다.
/** @type {Record<string, string>} */
const ESCAPES = { "<": "\\u003c", ">": "\\u003e", "&": "\\u0026", "\u2028": "\\u2028", "\u2029": "\\u2029" };

/** @param {unknown} obj @returns {string} */
function ldStringify(obj) {
  return JSON.stringify(obj).replace(/[<>&\u2028\u2029]/g, (c) => ESCAPES[c]);
}

/**
 * 분양 예정(/upcoming) 페이지 HTML 생성.
 * 홈 index.html 을 틀로 삼아 head (canonical, og, twitter, title, desc) + #root 를 바꾼다.
 *
 * @param {string} template dist/index.html 원본 (프리렌더 주입 전)
 * @returns {string}
 */
export function buildUpcomingHtml(template) {
  const title = "분양 예정 아파트 캘린더·일정 | 전국 미분양 비교 엔진";
  const desc = "전국 분양 예정·청약 일정 및 분양 현황을 캘린더와 단지 목록으로 확인하고 비교 분석해 보세요.";
  const url = `${ORIGIN}/upcoming`;

  const body =
    `<div id="root" class="notranslate">` +
    `<main style="max-width:960px;margin:0 auto;padding:24px;font-family:sans-serif">` +
    `<h1>전국 분양 예정 아파트</h1>` +
    `<p>${esc(desc)}</p>` +
    `<h2>주요 기능</h2>` +
    `<ul>` +
    `<li>전국 분양 예정 단지 일정 캘린더</li>` +
    `<li>지역별 분양 예정·청약중 단지 필터링</li>` +
    `<li>단지별 분양가 및 상세 분석 정보</li>` +
    `</ul>` +
    `<p><a href="/">전국 미분양 아파트 비교 목록으로</a></p>` +
    `<p>화면이 보이지 않으면 JavaScript 를 활성화해 주세요.</p>` +
    `</main></div>`;

  let html = template;
  html = html.replace(/<link rel="canonical" href="[^"]*"\s*\/>/, `<link rel="canonical" href="${esc(url)}" />`);
  html = html.replace(/<meta property="og:url" content="[^"]*"\s*\/>/, `<meta property="og:url" content="${esc(url)}" />`);
  html = html.replace(/<meta property="og:title" content="[^"]*"\s*\/>/, `<meta property="og:title" content="${esc(title)}" />`);
  html = html.replace(/<meta property="og:description" content="[^"]*"\s*\/>/, `<meta property="og:description" content="${esc(desc)}" />`);
  html = html.replace(/<meta name="twitter:title" content="[^"]*"\s*\/>/, `<meta name="twitter:title" content="${esc(title)}" />`);
  html = html.replace(/<meta name="twitter:description" content="[^"]*"\s*\/>/, `<meta name="twitter:description" content="${esc(desc)}" />`);
  html = html.replace(/<meta name="description" content="[^"]*"\s*\/>/, `<meta name="description" content="${esc(desc)}" />`);
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
  html = html.replace(ROOT_RE, body);
  return html;
}

/**
 * sitemap.xml 생성. 고정 경로 + 색인할 지역 허브(세션669) + 단지 전량.
 * `<lastmod>` 는 쓰지 않는다 — 실제 변경일을 모르는데 빌드 날짜를 넣으면 매일 전 페이지가 "오늘 바뀜"이 된다(구글 지침).
 * @param {string[]} ids
 * @param {Array<{ loc: string, pri: string }>} [hubs] 절대 주소(인코딩됨)·우선순위 — buildRegionPages 의 sitemapEntries
 * @returns {string}
 */
export function buildSitemap(ids, hubs = []) {
  const urls = [
    { loc: `${ORIGIN}/`, pri: "1.0" },
    { loc: `${ORIGIN}/upcoming`, pri: "0.8" },
    ...hubs,
    ...ids.map((id) => ({ loc: `${ORIGIN}/apt/${encodeURIComponent(id)}`, pri: "0.6" })),
  ];
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls
      .map(
        (u) =>
          `  <url><loc>${esc(u.loc)}</loc><priority>${u.pri}</priority></url>`,
      )
      .join("\n") +
    `\n</urlset>\n`
  );
}

// ── 지역 허브 정적 장 (세션669 PR-S2 · 결정 26·27·30·31·34·36·37) ────────────────────
//
// 단지 1,678장이 홈 한 장에만 매달린 모양을 풀려고 시도 17장 + 구 189장의 중간 장을 만든다.
// `dist/region/{시도}/index.html` · `dist/region/{시도}/{구}/index.html` (폴더 이름 = 원문 그대로, 공백 포함).
// 주소·canonical 은 encodeURIComponent(결정 26) — 앱 `src/lib/regionPath.ts` buildRegionPath 와 같은 문자열(짝 시험).
//
// ⚠️ cloaking 회피: 구 허브는 그 구 단지 **전부**(미분양 0·모름 포함, 결정 30) — 앱도 이 주소로 들어오면
// "미분양 없는 단지 숨김"을 끄고 같은 단지 집합을 보여 준다. 순서만 다르다(앱은 점수순, 여기는 점수를 싣지 않으려
// 미분양 남은 단지 먼저 → 총 세대수 많은 순 → 이름순). 값 표기는 화면 함수의 사본이고 같음 시험이 붙어 있다.
// 점수·등급·금융회사 이름은 싣지 않는다(결정 27).

/**
 * 시도 17종 — 정본 `scripts/collectors/_shared.mjs` VALID_REGIONS · 앱 `src/lib/regionPath.ts` SIDO_LIST.
 * 이 파일은 Vercel 빌드에서 돌고 `.vercelignore` 가 _shared.mjs 를 막으므로 import 하지 않고 같은 값을 둔다(같음 시험).
 */
export const SIDO_LIST = [
  "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종",
  "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주",
];
const SIDO_SET = new Set(SIDO_LIST);

/** 단지 수가 이 값 이하인 구 허브는 noindex,follow + 사이트맵 제외(결정 31). 시도 허브는 늘 색인. */
export const HUB_NOINDEX_MAX = 2;

/**
 * 허브 경로 — 앱 buildRegionPath 와 같은 문자열이어야 한다.
 * @param {string} sido @param {string | null} [gu] @returns {string}
 */
export function regionHubPath(sido, gu) {
  return `/region/${encodeURIComponent(sido)}${gu ? `/${encodeURIComponent(gu)}` : ""}`;
}

// fmtPriceNode·fmtMoveInNode·hubUnitsText(화면 표기 사본)는 세션672 에 src/utils/aptStaticBody.mjs 로 옮겼다(위 import · 다시 내보냄).

/**
 * 미분양 표시 — 남음이면 화면 상세(FIELD_META unsold)와 같은 "미분양 29세대", 0 이면 사장님이 시안
 * (`.omc/artifacts/session668/hub-mockup.html`)에서 확인한 말 "미분양 0 (분양 완료)", 모르면 화면처럼 "미분양 —".
 * @param {unknown} v @returns {string}
 */
export function hubUnsoldText(v) {
  if (v == null) return "미분양 —";
  const n = Number(v);
  if (n > 0) return `미분양 ${n.toLocaleString("ko-KR")}세대`;
  if (n === 0) return "미분양 0 (분양 완료)";
  return "미분양 —";
}

/** @param {Record<string, any>} a @returns {boolean} */
const hasUnsold = (a) => Number(a.unsold) > 0;

/**
 * 단지 줄 순서 — 미분양 남은 단지 먼저 → 총 세대수 많은 순(모름은 뒤) → 이름순.
 * @param {Record<string, any>} x @param {Record<string, any>} y @returns {number}
 */
export function hubAptOrder(x, y) {
  const ux = hasUnsold(x) ? 1 : 0;
  const uy = hasUnsold(y) ? 1 : 0;
  if (ux !== uy) return uy - ux;
  const nx = Number.isFinite(Number(x.units)) && x.units != null ? Number(x.units) : -1;
  const ny = Number.isFinite(Number(y.units)) && y.units != null ? Number(y.units) : -1;
  if (nx !== ny) return ny - nx;
  const a = String(x.name);
  const b = String(y.name);
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 단지 한 줄 HTML.
 * @param {Record<string, any>} a @returns {string}
 */
export function hubAptLine(a) {
  const parts = [
    `분양가 ${fmtPriceNode(a.price)}`,
    `${hubUnsoldText(a.unsold)} / 총 ${hubUnitsText(a.units, a.unsold)}`,
    `입주 ${fmtMoveInNode(a.completion, a.presaleMoveIn)}`,
  ];
  return `<li><a href="/apt/${encodeURIComponent(a.id)}">${esc(a.name)}</a> · ${esc(parts.join(" · "))}</li>`;
}

/**
 * 시도 통계 한 줄 — 화면 RegionStats 가 시도 이름을 붙여 그리는 두 칸(주택보급률·인구 증감)만, 그 시도 단지들이
 * **값 하나로 같을 때만**(시도 단위 값임을 이 자리에서 다시 확인 — 갈리면 그 칸을 뺀다). 구 단위 칸은 싣지 않는다.
 * @param {string} sido @param {Array<Record<string, any>>} apts 그 시도 단지 전부 @returns {string}
 */
export function sidoStatLine(sido, apts) {
  /** @param {string} f @returns {number | null} */
  const one = (f) => {
    const vals = new Set(apts.map((a) => a[f]).filter((v) => v != null && Number.isFinite(Number(v))).map(Number));
    return vals.size === 1 ? [...vals][0] : null;
  };
  /** @type {string[]} */
  const parts = [];
  const h = one("housingSupplyLevel");
  if (h != null) parts.push(`${sido} 주택보급률 ${h}%`);
  const p = one("popGrowth");
  if (p != null) parts.push(`${sido} 인구 증감 ${p > 0 ? "+" : ""}${p}%`);
  return parts.join(" · ");
}

/**
 * 구 통계 — 화면 RegionStats 가 구 이름을 붙여 그리는 합계출산율(시·군·구 단위, 표기 = FIELD_META `${v}명`)을
 * 그 구 단지들이 **값 하나로 같을 때만**. 최근 6개월 거래는 같은 구 안에서도 갈려 싣지 않는다(보완 F3).
 * @param {string} gu @param {Array<Record<string, any>>} apts 그 구 단지 전부 @returns {string}
 */
export function guStatLine(gu, apts) {
  const vals = new Set(apts.map((a) => a.fertilityRate).filter((v) => v != null && Number.isFinite(Number(v))).map(Number));
  return vals.size === 1 ? `${gu} 합계출산율 ${[...vals][0]}명` : "";
}

/** 허브 제목 꼴(결정 34) @param {string} place @param {number} n @param {number} m */
const hubTitle = (place, n, m) => `${place} 분양·미분양 아파트 ${n}곳 (미분양 남음 ${m}곳)`;

// 폴더 이름으로 못 쓰는 구 이름 판정(badDirName)은 src/utils/nearbyComplexes.mjs 에서 가져온다 —
// 단지 장 경로 줄이 "그 구 허브가 있나"를 같은 함수로 판정해야 한다(세션671).

/**
 * 허브 장 HTML — 틀(index.html 원본)의 head 를 단지 장과 같은 치환 꼴로 바꾼다.
 * @param {string} template
 * @param {{ url: string, title: string, desc: string, body: string, crumbs: Array<{ name: string, url: string }>, noindex: boolean }} o
 * @returns {string}
 */
function buildHubHtml(template, o) {
  if (ROBOTS_META_RE.test(template)) {
    throw new Error('[postbuild-prerender] 템플릿(index.html)에 이미 name="robots" 메타가 있습니다 — 허브 장 noindex 와 겹칩니다');
  }
  let html = template;
  html = html.replace(/<link rel="canonical" href="[^"]*"\s*\/>/, `<link rel="canonical" href="${esc(o.url)}" />`);
  html = html.replace(/<meta property="og:url" content="[^"]*"\s*\/>/, `<meta property="og:url" content="${esc(o.url)}" />`);
  html = html.replace(/<meta property="og:title" content="[^"]*"\s*\/>/, `<meta property="og:title" content="${esc(o.title)}" />`);
  html = html.replace(/<meta property="og:description" content="[^"]*"\s*\/>/, `<meta property="og:description" content="${esc(o.desc)}" />`);
  html = html.replace(/<meta name="twitter:title" content="[^"]*"\s*\/>/, `<meta name="twitter:title" content="${esc(o.title)}" />`);
  html = html.replace(/<meta name="twitter:description" content="[^"]*"\s*\/>/, `<meta name="twitter:description" content="${esc(o.desc)}" />`);
  html = html.replace(/<meta name="description" content="[^"]*"\s*\/>/, `<meta name="description" content="${esc(o.desc)}" />`);
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(o.title)}</title>`);
  html = html.replace(ROOT_RE, () => o.body);
  if (html.split("</head>").length !== 2) {
    throw new Error("[postbuild-prerender] 템플릿에 </head> 가 정확히 1개가 아닙니다 — 허브 JSON-LD 를 넣을 자리를 못 정함");
  }
  const ld = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: o.crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: c.url })),
  };
  const robots = o.noindex ? `<meta name="robots" content="noindex,follow" />\n` : "";
  html = html.replace("</head>", () => `<script type="application/ld+json">${ldStringify(ld)}</script>\n${robots}</head>`);
  return html;
}

/** @param {string} inner @returns {string} */
const hubBody = (inner) =>
  `<div id="root" class="notranslate">` +
  `<main style="max-width:960px;margin:0 auto;padding:24px;font-family:sans-serif">` +
  inner +
  `<p>화면이 보이지 않으면 JavaScript 를 활성화해 주세요.</p>` +
  `</main></div>`;

/**
 * 지역 허브 장 전부 + 사이트맵에 넣을 허브 주소.
 * - 시도가 17종 밖이면 건너뜀(skipped.notSido) · 구 이름이 폴더로 못 쓰는 꼴이면 그 구 허브만 안 만듦(skipped.badName — 단지 수)
 * - 구가 빈 단지(세종)·폴더로 못 쓰는 구의 단지는 시도 허브에 단지 줄로 직접 싣는다
 * - 구 허브 제목은 "{시도} {구} …"(결정 38 — 이름 같은 구가 여러 시도에 있다)
 * - 구 허브 단지 수(얇은 단지 포함) ≤ HUB_NOINDEX_MAX 면 noindex,follow + 사이트맵 제외
 * @param {string} template dist/index.html 원본 (프리렌더 주입 전)
 * @param {Array<Record<string, any>>} list
 * @returns {{ pages: Array<{ segments: string[], path: string, html: string, noindex: boolean }>, sitemapEntries: Array<{ loc: string, pri: string }>, skipped: { notSido: number, badName: number } }}
 */
export function buildRegionPages(template, list) {
  const skipped = { notSido: 0, badName: 0 };
  /** @type {Map<string, { all: Array<Record<string, any>>, noGu: Array<Record<string, any>>, byGu: Map<string, Array<Record<string, any>>> }>} */
  const bySido = new Map();
  for (const a of list) {
    if (!a || !a.id || !a.name) continue;
    const sido = typeof a.region === "string" ? a.region : "";
    if (!SIDO_SET.has(sido)) {
      skipped.notSido++;
      continue;
    }
    let gu = typeof a.gu === "string" && a.gu.trim() ? a.gu : "";
    // 폴더로 못 쓰는 구 이름은 구 허브만 안 만든다 — 그 단지는 시도 허브의 수에 세고 단지 줄로 직접 싣는다(보완 F4)
    if (gu && badDirName(gu)) {
      skipped.badName++;
      gu = "";
    }
    let s = bySido.get(sido);
    if (!s) {
      s = { all: [], noGu: [], byGu: new Map() };
      bySido.set(sido, s);
    }
    s.all.push(a);
    if (!gu) s.noGu.push(a);
    else {
      const arr = s.byGu.get(gu);
      if (arr) arr.push(a);
      else s.byGu.set(gu, [a]);
    }
  }

  /** @type {Array<{ segments: string[], path: string, html: string, noindex: boolean }>} */
  const pages = [];
  /** @type {Array<{ loc: string, pri: string }>} */
  const sidoEntries = [];
  /** @type {Array<{ loc: string, pri: string }>} */
  const guEntries = [];
  /** @param {string} a @param {string} b */
  const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const sidos = [...bySido.keys()].sort((x, y) => SIDO_LIST.indexOf(x) - SIDO_LIST.indexOf(y));

  for (const sido of sidos) {
    const s = /** @type {NonNullable<ReturnType<typeof bySido.get>>} */ (bySido.get(sido));
    const sidoPath = regionHubPath(sido);
    const sidoUrl = `${ORIGIN}${sidoPath}`;
    const stat = sidoStatLine(sido, s.all);
    const statHtml = stat ? `<p>${esc(stat)}</p>` : "";

    // ── 구 허브 ──
    const gus = [...s.byGu.entries()].sort((x, y) => y[1].length - x[1].length || byName(x[0], y[0]));
    for (const [gu, apts] of gus) {
      const sorted = [...apts].sort(hubAptOrder);
      const n = sorted.length;
      const m = sorted.filter(hasUnsold).length;
      // 결정 38 — 구 허브 제목엔 시도를 붙인다(중구·동구 같은 이름이 여러 시도에 있다)
      const title = hubTitle(`${sido} ${gu}`, n, m);
      const guStat = [stat, guStatLine(gu, apts)].filter(Boolean).join(" · ");
      const path = regionHubPath(sido, gu);
      const url = `${ORIGIN}${path}`;
      const names = sorted.slice(0, 3).map((a) => String(a.name));
      const desc = `${title} — ${names.join("·")}${n > 3 ? " 등" : ""} 단지별 분양가·미분양 세대·입주 시기.`;
      const noindex = n <= HUB_NOINDEX_MAX;
      const body = hubBody(
        `<nav aria-label="breadcrumb"><a href="/">전국</a> › <a href="${esc(sidoPath)}">${esc(sido)}</a> › ${esc(gu)}</nav>` +
          `<h1>${esc(title)}</h1>` +
          (guStat ? `<p>${esc(guStat)}</p>` : "") +
          `<ul>${sorted.map(hubAptLine).join("")}</ul>` +
          `<p><a href="${esc(sidoPath)}">${esc(sido)} 전체 보기 ›</a></p>` +
          `<p><a href="/">전국 목록으로 ›</a></p>`,
      );
      const html = buildHubHtml(template, {
        url,
        title: `${title} | 미분양 비교`,
        desc,
        body,
        crumbs: [
          { name: "전국", url: `${ORIGIN}/` },
          { name: sido, url: sidoUrl },
          { name: gu, url },
        ],
        noindex,
      });
      pages.push({ segments: [sido, gu], path, html, noindex });
      if (!noindex) guEntries.push({ loc: url, pri: "0.6" });
    }

    // ── 시도 허브(늘 색인) — 구 목록 + 단지 수, 구가 빈 단지는 단지 줄로 직접 ──
    const n = s.all.length;
    const m = s.all.filter(hasUnsold).length;
    const title = hubTitle(sido, n, m);
    const guItems = gus
      .map(([gu, apts]) => {
        const gm = apts.filter(hasUnsold).length;
        return `<li><a href="${esc(regionHubPath(sido, gu))}">${esc(gu)}</a> ${apts.length}곳 (미분양 남음 ${gm}곳)</li>`;
      })
      .join("");
    const noGuSorted = [...s.noGu].sort(hubAptOrder);
    const lead = gus.length > 0 ? gus.slice(0, 3).map(([gu]) => gu) : noGuSorted.slice(0, 3).map((a) => String(a.name));
    const leadMore = (gus.length > 0 ? gus.length : noGuSorted.length) > 3 ? " 등" : "";
    const desc = `${title} — ${lead.join("·")}${leadMore} ${gus.length > 0 ? "시군구별 단지 수와 목록" : "단지별 분양가·미분양 세대·입주 시기"}.`;
    const body = hubBody(
      `<nav aria-label="breadcrumb"><a href="/">전국</a> › ${esc(sido)}</nav>` +
        `<h1>${esc(title)}</h1>` +
        statHtml +
        (gus.length > 0 ? `<h2>시군구</h2><ul>${guItems}</ul>` : "") +
        (noGuSorted.length > 0 ? `<h2>${esc(sido)} 단지</h2><ul>${noGuSorted.map(hubAptLine).join("")}</ul>` : "") +
        `<p><a href="/">전국 목록으로 ›</a></p>`,
    );
    const html = buildHubHtml(template, {
      url: sidoUrl,
      title: `${title} | 미분양 비교`,
      desc,
      body,
      crumbs: [
        { name: "전국", url: `${ORIGIN}/` },
        { name: sido, url: sidoUrl },
      ],
      noindex: false,
    });
    pages.push({ segments: [sido], path: sidoPath, html, noindex: false });
    sidoEntries.push({ loc: sidoUrl, pri: "0.7" });
  }

  return { pages, sitemapEntries: [...sidoEntries, ...guEntries], skipped };
}

/**
 * 상세 꾸러미(`apartments-detail-16-N.json`, scripts/static-outputs.mjs buildDetailBuckets)를 전부 읽어 id → 행 지도.
 * 단지 장 본문의 꾸러미 칸(학교·평형 표·동네 사실·전세 범위·공고명)이 여기서 온다(세션672 PR-S4).
 * 파일이 하나라도 없거나 · 모양이 틀리거나 · id 있는 행 합이 목록의 id 있는 행 수와 다르거나 · 목록 단지가 꾸러미에 없으면 던진다
 * (main 이 목록이 없을 때처럼 빌드를 빨갛게 — 꾸러미 없이 조용히 얇은 장 1,678장을 내보내지 않게).
 * @param {string} dir 꾸러미가 있는 폴더(dist/data)
 * @param {Array<Record<string, any>>} list 목록 행
 * @param {number} [n] 꾸러미 수
 * @returns {Map<string, Record<string, any>>}
 */
export function loadDetailMap(dir, list, n = DETAIL_BUCKET_COUNT) {
  /** @type {Map<string, Record<string, any>>} */
  const map = new Map();
  let rows = 0;
  for (let i = 0; i < n; i++) {
    const file = join(dir, detailBucketName(i, n));
    if (!existsSync(file)) throw new Error(`상세 꾸러미 ${detailBucketName(i, n)} 없음 — 단지 장 본문을 만들 수 없습니다`);
    const parsed = JSON.parse(readFileSync(file, "utf-8"));
    const data = Array.isArray(parsed) ? parsed : parsed?.data;
    if (!Array.isArray(data)) throw new Error(`상세 꾸러미 ${detailBucketName(i, n)} 의 data 가 배열이 아닙니다`);
    for (const r of data) {
      if (r && r.id) {
        rows++;
        map.set(String(r.id), r);
      }
    }
  }
  // 행 합은 양쪽 같은 기준(id 있는 행)으로 센다 — 꾸러미 행엔 name 칸이 없어(static-outputs buildDetailBuckets)
  // 이름으로 거르면 이름 빈 목록 행 하나로 빌드 전체가 빨개진다(세션673). 장은 아래 valid(id+name)만 만든다.
  const listRows = list.filter((a) => a && a.id).length;
  if (rows !== listRows) {
    throw new Error(`상세 꾸러미 행 합 ${rows} ≠ 목록 단지 ${listRows} — 목록과 꾸러미가 다른 회차입니다`);
  }
  const valid = list.filter((a) => a && a.id && a.name);
  const missing = valid.filter((a) => !map.has(String(a.id))).map((a) => String(a.id));
  if (missing.length > 0) {
    throw new Error(`상세 꾸러미에 없는 단지 ${missing.length}곳 (${missing.slice(0, 5).join(",")}…)`);
  }
  return map;
}

function main() {
  if (!existsSync(DIST_INDEX)) {
    console.error(`[postbuild-prerender] dist/index.html 없음: ${DIST_INDEX}`);
    process.exit(1);
  }

  const html = readFileSync(DIST_INDEX, "utf-8");

  if (!ROOT_RE.test(html)) {
    // 빈 #root 를 못 찾음 = 빌드 산출물 구조 변경. 조용히 넘기지 말고 빌드를 빨갛게.
    console.error(
      "[postbuild-prerender] 빈 <div id=\"root\"></div> 패턴을 dist/index.html 에서 못 찾음. " +
        "Vite 출력 구조가 바뀌었는지 확인 (ROOT_RE 정규식 갱신 필요).",
    );
    process.exit(1);
  }

  // 단지 페이지의 틀은 **주입 전 원본**이다. 주입 후 HTML 을 틀로 쓰면 홈 골격이 섞인다.
  const template = html;

  // 홈 골격이 단지 링크를 담으므로 목록을 **먼저** 읽는다(없거나 비면 아무것도 쓰지 않고 중단 — 실패 동작 유지).
  if (!existsSync(DIST_LIST)) {
    // 조용히 넘어가면 "홈만 색인되는 상태" 가 그대로 굳는다. 빌드를 빨갛게.
    console.error(`[postbuild-prerender] ${DIST_LIST} 없음 — 단지 페이지를 만들 수 없습니다.`);
    process.exit(1);
  }

  const parsed = JSON.parse(readFileSync(DIST_LIST, "utf-8"));
  const list = Array.isArray(parsed) ? parsed : (parsed.data ?? []);
  if (!Array.isArray(list) || list.length === 0) {
    console.error("[postbuild-prerender] apartments-list.json 이 비었습니다 — 단지 페이지 0개.");
    process.exit(1);
  }

  // 상세 꾸러미(세션672) — 없거나 목록과 어긋나면 목록이 없을 때처럼 아무것도 쓰지 않고 중단.
  /** @type {Map<string, Record<string, any>>} */
  let details;
  try {
    details = loadDetailMap(join(DIST, "data"), list);
  } catch (e) {
    console.error(`[postbuild-prerender] ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  const out = html.replace(ROOT_RE, () => buildHomeSkeleton(list));
  writeFileSync(DIST_INDEX, out, "utf-8");
  console.log("[postbuild-prerender] dist/index.html #root 에 검색봇용 골격 주입 완료");

  // ── /upcoming 정적 페이지 ──
  const upcomingDir = join(DIST, "upcoming");
  mkdirSync(upcomingDir, { recursive: true });
  writeFileSync(join(upcomingDir, "index.html"), buildUpcomingHtml(template), "utf-8");
  console.log("[postbuild-prerender] dist/upcoming/index.html 프리렌더 주입 완료");

  // ── 단지별 정적 페이지 + sitemap (세션 504) ──

  const { pages, sitemapIds, thin } = buildAptPages(template, list, details);
  for (const p of pages) {
    const dir = join(DIST, "apt", p.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), p.html, "utf-8");
  }

  if (pages.length === 0) {
    console.error("[postbuild-prerender] 유효한 단지(id+name)가 0건 — sitemap 을 쓰지 않고 중단합니다.");
    process.exit(1);
  }

  // 얇은 단지 기록 — 매 빌드 쓴다(감시 ㉓ 가 운영에서 읽는다 · 세션668).
  writeFileSync(DIST_SEO_THIN, JSON.stringify(thin), "utf-8");
  console.log(
    `[postbuild-prerender] 얇은 단지 ${thin.count}곳 · applied=${thin.applied} (안전선 ${thin.cap}) · ${thin.ids.join(",") || "없음"}`,
  );

  // ── 지역 허브 정적 장 (세션669) ──
  const region = buildRegionPages(template, list);
  for (const p of region.pages) {
    const dir = join(DIST, "region", ...p.segments);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), p.html, "utf-8");
  }
  const hubNoindex = region.pages.filter((p) => p.noindex).length;
  console.log(
    `[postbuild-prerender] 지역 허브 ${region.pages.length}장 (시도 ${region.pages.filter((p) => p.segments.length === 1).length} · 구 ${region.pages.filter((p) => p.segments.length === 2).length} · noindex ${hubNoindex}) · 건너뜀: 시도 밖 ${region.skipped.notSido} · 구 허브 못 만든 구 이름 ${region.skipped.badName}(그 단지는 시도 허브에)`,
  );

  writeFileSync(DIST_SITEMAP, buildSitemap(sitemapIds, region.sitemapEntries), "utf-8");
  console.log(
    `[postbuild-prerender] 단지 페이지 ${pages.length}개 생성 (dist/apt/{id}/index.html) + sitemap ${sitemapIds.length + region.sitemapEntries.length + 2}개 URL`,
  );
}

// CLI 로 직접 실행할 때만 돈다 (세션 504).
// 이 파일은 이제 순수 함수(buildAptHtml·buildSitemap·loadDetailMap·esc)를 export 하는데,
// 가드가 없으면 테스트가 import 하는 순간 main() 이 돌아 dist 를 건드린다.
// scripts/CLAUDE.md 의 isCLI 패턴 답습.
const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) main();
