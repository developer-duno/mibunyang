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

/** 운영 도메인 (index.html 의 canonical·og:url 과 같아야 한다) */
const ORIGIN = "https://www.xn--hg3bi2ac4o1ig57cnoa.com";

// 봇이 읽을 홈 화면 정적 골격. 사용자 화면엔 React 가 교체하므로 미노출.
// aria-hidden 불필요(React 가 즉시 비움). 화면에 실제 노출되는 정보만 담아 cloaking 회피.
const SKELETON = `<div id="root" class="notranslate"><main style="max-width:960px;margin:0 auto;padding:24px;font-family:sans-serif"><h1>전국 미분양 비교 엔진</h1><p>전국 미분양·분양 예정 아파트를 6개 카테고리 41개 지표로 AHP 점수화하고, 실거주·투자·신혼·교육·은퇴 5가지 사용자 프로필 가중치를 적용해 개인 맞춤 추천을 제공하는 다기준 의사결정 엔진입니다.</p><h2>주요 기능</h2><ul><li>전국 미분양 아파트 비교 분석</li><li>분양 예정 단지 정보</li><li>실거주·투자·신혼·교육·은퇴 프로필별 맞춤 점수</li><li>입지·가격·안전도·미래가치·환경 등 다기준 평가</li></ul><p>화면이 보이지 않으면 JavaScript 를 활성화해 주세요.</p></main></div>`;

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
 * 단지 1건의 사람이 읽는 요약 문장. 화면(AptCard)에 나오는 값만 쓴다.
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
  if (a.subwayDist != null) {
    out.push(`지하철: ${a.subwayName ? `${a.subwayName} ` : ""}${Math.round(a.subwayDist)}m`);
  }
  if (a.busRoutes != null) out.push(`버스 정류장: ${a.busRoutes}개`);
  if (a.completion) out.push(`준공: ${a.completion}`);
  return out;
}

/**
 * 단지 페이지 HTML 생성. 홈 index.html 을 틀로 삼아 head 5곳 + #root 를 바꾼다.
 *
 * @param {string} template dist/index.html 원본 (프리렌더 주입 **전**)
 * @param {Record<string, any>} a 단지 1건
 * @returns {string}
 */
export function buildAptHtml(template, a) {
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
  html = html.replace(/<meta name="twitter:title" content="[^"]*"\s*\/>/, `<meta name="twitter:title" content="${esc(title)}" />`);
  html = html.replace(/<meta name="description" content="[^"]*"\s*\/>/, `<meta name="description" content="${esc(desc)}" />`);
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
  html = html.replace(ROOT_RE, body);
  return html;
}

/**
 * sitemap.xml 생성. 고정 경로 + 단지 전량.
 * @param {string[]} ids
 * @param {string} today YYYY-MM-DD
 * @returns {string}
 */
export function buildSitemap(ids, today) {
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
          `  <url><loc>${esc(u.loc)}</loc><lastmod>${today}</lastmod><priority>${u.pri}</priority></url>`,
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

  const out = html.replace(ROOT_RE, SKELETON);
  writeFileSync(DIST_INDEX, out, "utf-8");
  console.log("[postbuild-prerender] dist/index.html #root 에 검색봇용 골격 주입 완료");

  // ── 단지별 정적 페이지 + sitemap (세션 504) ──
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

  // KST 고정 (러너가 UTC 라 toISOString 은 날짜가 하루 밀린다 — scripts/CLAUDE.md today() 답습)
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());

  /** @type {string[]} */
  const ids = [];
  for (const a of list) {
    if (!a || !a.id || !a.name) continue;
    const dir = join(DIST, "apt", String(a.id));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), buildAptHtml(template, a), "utf-8");
    ids.push(String(a.id));
  }

  if (ids.length === 0) {
    console.error("[postbuild-prerender] 유효한 단지(id+name)가 0건 — sitemap 을 쓰지 않고 중단합니다.");
    process.exit(1);
  }

  writeFileSync(DIST_SITEMAP, buildSitemap(ids, today), "utf-8");
  console.log(
    `[postbuild-prerender] 단지 페이지 ${ids.length}개 생성 (dist/apt/{id}/index.html) + sitemap ${ids.length + 2}개 URL`,
  );
}

// CLI 로 직접 실행할 때만 돈다 (세션 504).
// 이 파일은 이제 순수 함수(buildAptHtml·buildSitemap·aptFacts·esc)를 export 하는데,
// 가드가 없으면 테스트가 import 하는 순간 main() 이 돌아 dist 를 건드린다.
// scripts/CLAUDE.md 의 isCLI 패턴 답습.
const argv1 = process.argv[1];
const isCLI = !!argv1 && import.meta.url.endsWith(argv1.replace(/\\/g, "/").split("/").pop() ?? "");
if (isCLI) main();
