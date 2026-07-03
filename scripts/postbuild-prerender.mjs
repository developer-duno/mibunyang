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
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_INDEX = resolve(__dirname, "..", "dist", "index.html");

// 봇이 읽을 홈 화면 정적 골격. 사용자 화면엔 React 가 교체하므로 미노출.
// aria-hidden 불필요(React 가 즉시 비움). 화면에 실제 노출되는 정보만 담아 cloaking 회피.
const SKELETON = `<div id="root" class="notranslate"><main style="max-width:960px;margin:0 auto;padding:24px;font-family:sans-serif"><h1>전국 미분양 비교 엔진</h1><p>전국 미분양·분양 예정 아파트를 6개 카테고리 41개 지표로 AHP 점수화하고, 실거주·투자·신혼·교육·은퇴 5가지 사용자 프로필 가중치를 적용해 개인 맞춤 추천을 제공하는 다기준 의사결정 엔진입니다.</p><h2>주요 기능</h2><ul><li>전국 미분양 아파트 비교 분석</li><li>분양 예정 단지 정보</li><li>실거주·투자·신혼·교육·은퇴 프로필별 맞춤 점수</li><li>입지·가격·안전도·미래가치·환경 등 다기준 평가</li></ul><p>화면이 보이지 않으면 JavaScript 를 활성화해 주세요.</p></main></div>`;

// #root 빈 div 를 골격으로 교체. class/속성 순서 변경에 견디게 느슨한 매칭
// (적대검증 권고 — Vite/Rolldown 미래 버전이 속성을 바꿔도 매치되게).
const ROOT_RE = /<div id="root"[^>]*>\s*<\/div>/;

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

  const out = html.replace(ROOT_RE, SKELETON);
  writeFileSync(DIST_INDEX, out, "utf-8");
  console.log("[postbuild-prerender] dist/index.html #root 에 검색봇용 골격 주입 완료");
}

main();
