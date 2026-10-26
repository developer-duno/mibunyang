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
      return `<h3>${esc(r)} (${apts.length}곳)</h3><ul>${items}${more}</ul>`;
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

/**
 * subwayDist 센티널("10km 안에 역 없음" 표시값). 정본 = src/constants/sentinels.ts `SENTINEL.subwayDist`
 * (.ts 라 node 빌드 스크립트에서 import 하지 않고 같은 값을 둔다 — 바꾸면 양쪽을 같이).
 * `>=` 로 본다(isSentinel 과 같음).
 */
const SUBWAY_SENTINEL = 9999;

/**
 * YYYYMM(6자리 숫자) → "YYYY년 MM월", 아니면 원문 그대로. 화면 `src/lib/format.ts` fmtCompletion 과 같은 규칙.
 * @param {unknown} v
 * @returns {string}
 */
function fmtCompletion(v) {
  const s = String(v);
  if (!/^\d{6}$/.test(s)) return s;
  return `${s.slice(0, 4)}년 ${s.slice(4, 6)}월`;
}

/**
 * 단지 1건의 사람이 읽는 요약 문장. 화면(AptCard)에 나오는 값만 쓴다.
 * 교통 줄은 화면 `TransportCard.tsx` transportFacts 와 같은 규칙 — 좌표 공유(coordShared)면 교통 줄 전체 생략,
 * 지하철 거리가 센티널·비정상이면 거리는 쓰지 않는다.
 * @param {Record<string, any>} a
 * @returns {string[]}
 */
export function aptFacts(a) {
  /** @type {string[]} */
  const out = [];
  const where = [a.region, a.gu, a.dong].filter(Boolean).join(" ");
  if (where) out.push(`위치: ${where}`);
  if (a.price != null) out.push(`분양가: ${Number(a.price).toLocaleString()}만원`);
  if (a.area != null) out.push(`전용면적: ${a.area}㎡`);
  if (a.builder) out.push(`시공사: ${a.builder}`);
  if (a.units != null) out.push(`총 세대수: ${Number(a.units).toLocaleString()}세대`);
  if (a.unsold != null) out.push(`미분양: ${Number(a.unsold).toLocaleString()}세대`);
  if (a.coordShared !== true) {
    const name = typeof a.subwayName === "string" ? a.subwayName.trim() : "";
    const d = Number(a.subwayDist);
    const distOk = a.subwayDist != null && Number.isFinite(d) && d >= 0 && d < SUBWAY_SENTINEL;
    // 화면(TransportCard transportFacts)은 역 이름이 있을 때만 지하철 줄을 만든다 — 이름 없이 거리만은 쓰지 않는다
    if (name) out.push(`지하철: ${name}${distOk ? ` ${Math.round(d)}m` : ""}`);
    const bus = Number(a.busRoutes);
    if (a.busRoutes != null && Number.isFinite(bus) && bus > 0) out.push(`버스: ${Math.round(bus)}개 노선`);
  }
  if (a.completion) out.push(`준공: ${fmtCompletion(a.completion)}`);
  return out;
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
 * @param {string} template dist/index.html 원본 (프리렌더 주입 전)
 * @param {Array<Record<string, any>>} list
 * @returns {{ pages: Array<{ id: string, html: string }>, sitemapIds: string[], thin: { count: number, ids: string[], names: string[], applied: boolean, cap: number } }}
 */
export function buildAptPages(template, list) {
  const thin = planThin(list);
  const noindexIds = new Set(thin.applied ? thin.ids : []);
  /** @type {Array<{ id: string, html: string }>} */
  const pages = [];
  /** @type {string[]} */
  const sitemapIds = [];
  for (const a of list) {
    if (!a || !a.id || !a.name) continue;
    const id = String(a.id);
    const noindex = noindexIds.has(id);
    pages.push({ id, html: buildAptHtml(template, a, { noindex }) });
    if (!noindex) sitemapIds.push(id);
  }
  return { pages, sitemapIds, thin };
}

/** 템플릿에 robots 메타가 이미 있는지 — 있으면 단지 장에 둘이 생기거나 전 장에 퍼진다. */
const ROBOTS_META_RE = /<meta\b[^>]*\bname\s*=\s*["']?robots\b/i;

/**
 * 단지 페이지 HTML 생성. 홈 index.html 을 틀로 삼아 head 5곳 + #root 를 바꾼다.
 *
 * @param {string} template dist/index.html 원본 (프리렌더 주입 **전**)
 * @param {Record<string, any>} a 단지 1건
 * @param {{ noindex?: boolean }} [opts] noindex = 얇은 단지 검색 제외(세션668)
 * @returns {string}
 */
export function buildAptHtml(template, a, opts = {}) {
  if (ROBOTS_META_RE.test(template)) {
    throw new Error('[postbuild-prerender] 템플릿(index.html)에 이미 name="robots" 메타가 있습니다 — 단지 장 noindex 와 겹칩니다');
  }
  const where = [a.region, a.gu].filter(Boolean).join(" ");
  // 제목은 화면(DetailModal.tsx:200)이 만드는 것과 **글자 그대로 같아야** 한다.
  // 다르면 검색결과 제목과 실제 페이지 제목이 어긋난다.
  const title = `${a.name}${where ? ` (${where})` : ""} 분양가·미분양 | 미분양 비교`;
  const facts = aptFacts(a);
  const desc = `${a.name}${where ? ` (${where})` : ""} 분양가·미분양 정보. ${facts.slice(0, 4).join(" · ")}`;
  const url = `${ORIGIN}/apt/${encodeURIComponent(a.id)}`;

  const body =
    `<div id="root" class="notranslate">` +
    `<main style="max-width:960px;margin:0 auto;padding:24px;font-family:sans-serif">` +
    `<h1>${esc(a.name)}</h1>` +
    `<p>${esc(desc)}</p>` +
    `<h2>단지 정보</h2><ul>${facts.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` +
    `<p><a href="/">전국 미분양 아파트 비교 목록으로</a></p>` +
    `<p>화면이 보이지 않으면 JavaScript 를 활성화해 주세요.</p>` +
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
  html = html.replace(ROOT_RE, body);
  if (html.split("</head>").length !== 2) {
    throw new Error("[postbuild-prerender] 템플릿에 </head> 가 정확히 1개가 아닙니다 — JSON-LD 를 넣을 자리를 못 정함");
  }
  const ld = `<script type="application/ld+json">${buildAptJsonLd(a, url)}</script>`;
  const robots = opts.noindex ? `<meta name="robots" content="noindex,follow" />\n` : "";
  html = html.replace("</head>", () => `${ld}\n${robots}</head>`);
  return html;
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
  // 스크립트 블록 탈출·HTML 파싱 오해를 막는 문자는 모두 유니코드 이스케이프(결과 문자열이 백슬래시+u+4자리)로.
  /** @type {Record<string, string>} */
  const ESCAPES = { "<": "\\u003c", ">": "\\u003e", "&": "\\u0026", "\u2028": "\\u2028", "\u2029": "\\u2029" };
  return JSON.stringify(ld).replace(/[<>&\u2028\u2029]/g, (c) => ESCAPES[c]);
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
 * sitemap.xml 생성. 고정 경로 + 단지 전량.
 * `<lastmod>` 는 쓰지 않는다 — 실제 변경일을 모르는데 빌드 날짜를 넣으면 매일 전 페이지가 "오늘 바뀜"이 된다(구글 지침).
 * @param {string[]} ids
 * @returns {string}
 */
export function buildSitemap(ids) {
  const urls = [
    { loc: `${ORIGIN}/`, pri: "1.0" },
    { loc: `${ORIGIN}/upcoming`, pri: "0.8" },
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

  const out = html.replace(ROOT_RE, () => buildHomeSkeleton(list));
  writeFileSync(DIST_INDEX, out, "utf-8");
  console.log("[postbuild-prerender] dist/index.html #root 에 검색봇용 골격 주입 완료");

  // ── /upcoming 정적 페이지 ──
  const upcomingDir = join(DIST, "upcoming");
  mkdirSync(upcomingDir, { recursive: true });
  writeFileSync(join(upcomingDir, "index.html"), buildUpcomingHtml(template), "utf-8");
  console.log("[postbuild-prerender] dist/upcoming/index.html 프리렌더 주입 완료");

  // ── 단지별 정적 페이지 + sitemap (세션 504) ──

  const { pages, sitemapIds, thin } = buildAptPages(template, list);
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

  writeFileSync(DIST_SITEMAP, buildSitemap(sitemapIds), "utf-8");
  console.log(
    `[postbuild-prerender] 단지 페이지 ${pages.length}개 생성 (dist/apt/{id}/index.html) + sitemap ${sitemapIds.length + 2}개 URL`,
  );
}

// CLI 로 직접 실행할 때만 돈다 (세션 504).
// 이 파일은 이제 순수 함수(buildAptHtml·buildSitemap·aptFacts·esc)를 export 하는데,
// 가드가 없으면 테스트가 import 하는 순간 main() 이 돌아 dist 를 건드린다.
// scripts/CLAUDE.md 의 isCLI 패턴 답습.
const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) main();
