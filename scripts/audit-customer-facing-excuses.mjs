#!/usr/bin/env node
/**
 * 손님 화면에 **우리 데이터 결함을 변명하는 문구**가 들어가는 것을 막는다 (세션563)
 *
 * ## 무엇을 막는가
 *
 * 값이 못 미더울 때 화면에 "정확하지 않을 수 있습니다 / 참고로만 봐 주세요" 를 다는 것은
 * **해결이 아니라 떠넘기기**다. 손님은 그 값을 고칠 수도, 다른 데서 확인할 수도 없다.
 * 우리가 고치거나, 못 고치면 **사장님께 알리는 것**(monitor → 텔레그램 / 관리자 화면)이 일이다.
 *
 * > 사장님 지적(2026-09-23): "좌표경고를 왜 손님한테 보여줘 나한테 알려줘야지?"
 * > 그 자리에서 `TransportCard` 의 경고를 뺐고, 학교·어린이집으로 넓히려던 것을 되돌렸다.
 *
 * ## 무엇을 검사하는가
 *
 * 손님이 보는 컴포넌트(`src/components/**`)의 **JSX 텍스트**에서 금지 문구를 찾는다.
 * 관리자 전용 화면(`Admin*`)은 제외한다 — 거기는 사장님이 보는 자리라 오히려 적어야 한다.
 *
 * ## 무엇을 검사하지 '않는가' (오탐 방지)
 *
 * - **주석**(`//`, `/* *\/`)은 본다 — 다만 금지가 아니라 **허용**이다. 왜 안 다는지 설명하는
 *   주석이 오히려 필요하다(`TransportCard.tsx` 가 그렇다). 그래서 주석을 먼저 벗겨낸다.
 * - **값의 성질**을 적는 말(`예정`·`평균`·`추정`)은 금지하지 않는다. 그건 세상이 그런 것이지
 *   우리 잘못이 아니다. 금지 목록은 **신뢰도를 변명하는 표현**만 담는다.
 *
 * 실행: node scripts/audit-customer-facing-excuses.mjs
 * exit 0 = 통과 / exit 1 = 손님 화면에 변명 문구 발견
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 레포 루트 절대경로 — `scripts/` 의 부모.
 *
 * ⚠️ `process.cwd()` 기준으로 ROOTS 를 잡으면 **다른 cwd 에서 실행할 때 0개 파일을 스캔하고도
 * 조용히 통과**한다(세션563 리뷰어 지적 ②). `import.meta.url` 은 실행 위치와 무관하게
 * 이 파일 자신의 경로이므로, 여기서 레포 루트를 역산하면 cwd 에 흔들리지 않는다.
 */
const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url))).replace(/\\/g, "/");

/**
 * 손님이 보는 뿌리들.
 *
 * - `src/components` — 화면 컴포넌트(JSX 텍스트)
 * - `src/constants` — 컴포넌트가 렌더하는 **문구 상수**(`catHelp.ts`·`cardChips.ts`·`emptyText.ts`·
 *   `fieldMeta.ts`·`landing.ts` 등). 여기 박힌 변명 문구는 컴포넌트를 grep 해도 안 보인다
 *   (세션563 리뷰어 지적 ①).
 * - `src/App.tsx` — 최상위 진입 파일. 디렉토리가 아니라 **단일 파일**이라 `walk` 가 파일도
 *   그대로 받아들인다.
 */
export const ROOTS = [
  path.posix.join(REPO_ROOT, "src/components"),
  path.posix.join(REPO_ROOT, "src/constants"),
  path.posix.join(REPO_ROOT, "src/App.tsx"),
];

/**
 * 관리자 전용 — 검사 제외. 사장님이 보는 자리라 데이터 상태를 적는 게 **맞다**.
 * 파일명 기준으로 판정한다(경로가 아니라) — `detail/AdminDataAudit.tsx` 처럼 섞여 있어서다.
 */
const ADMIN_RE = /(^|\/)Admin[A-Z]/;

/**
 * 금지 문구 — **우리 값의 신뢰도를 변명하는** 표현.
 *
 * ⚠️ "예정"·"평균"·"추정" 은 넣지 않는다. 그건 값의 **성질**이라 사실 그대로이고,
 *    빼면 오히려 손님이 확정값으로 오해한다.
 */
const BANNED = [
  { re: /정확하지\s*않을\s*수\s*있/, why: "값의 신뢰도를 손님에게 변명한다" },
  { re: /참고로만\s*(봐|보)/, why: "판단 책임을 손님에게 떠넘긴다" },
  { re: /그대로\s*믿지\s*마/, why: "판단 책임을 손님에게 떠넘긴다" },
  { re: /정확도가\s*떨어질\s*수\s*있/, why: "값의 신뢰도를 손님에게 변명한다" },
  { re: /오차가\s*있을\s*수\s*있/, why: "값의 신뢰도를 손님에게 변명한다" },
  { re: /신뢰할\s*수\s*없/, why: "값의 신뢰도를 손님에게 변명한다" },
];

/**
 * **면제 신호** — 같은 줄에 이 말이 있으면 금지어가 있어도 통과시킨다 (세션563 적대검증 🔴).
 *
 * ## 왜 필요한가
 *
 * 처음 만든 감사는 문장의 **주어를 안 봐서**, 우리 수집 결함이든 국토부 신고 지연이든
 * 똑같이 막았다. 실측으로 다음 셋이 전부 차단됐다 — 셋 다 **넣어야 하는 문장**이다:
 *
 *   "본 정보는 참고 자료이며 투자 판단의 근거로 **신뢰할 수 없습니다**"   ← 면책 고지
 *   "실거래가는 국토부 공개자료로, 신고 지연으로 **오차가 있을 수 있습니다**" ← 제3자 출처 특성
 *   "추정가는 통계 모델 결과로 실제 거래가와 **정확하지 않을 수 있습니다**"   ← 진짜 추정치
 *
 * 이 사이트는 "적정 추정가"를 제시하고 갭투자액을 계산해 준다(`FAQSection.tsx`·`LoanAnalysis.tsx`).
 * 표시·광고의 공정화에 관한 법률상 추정·예측은 그것이 추정임을 밝혀야 하고, 공인중개사법상
 * 중개가 아님을 분명히 해야 한다. **그 고지를 이 감사가 막으면 안 된다.**
 *
 * ## 가르는 기준
 *
 * 금지 대상은 **우리가 못 채우거나 틀리게 채운 값**을 변명하는 말이다. 반면
 * **출처·성질을 밝히는 말**(추정·모델·국토부·공공데이터·신고·평균·예정·표본·법적 고지)이
 * 같은 줄에 있으면 그건 "무엇을 보고 있는지" 를 알려 주는 것이라 통과시킨다.
 *
 * ⚠️ 이 면제는 **같은 줄**만 본다. 줄을 갈라 회피할 수 있지만, 그러려면 일부러 그래야 한다 —
 *    실수로 떠넘기는 것을 막는 게 목적이고, 작정한 우회까지 막는 도구가 아니다.
 */
const EXEMPT = [
  /추정|예상|예측|모델|시뮬/,           // 값의 성질 — 진짜 추정치
  /국토부|공공데이터|공개자료|출처|원자료|신고\s*지연|제공받/, // 제3자 출처 특성
  /평균|중앙값|표본|통계/,               // 집계값의 성질
  /투자\s*판단|법적\s*책임|면책|중개\s*대상|참고\s*자료|보증하지/, // 법적 고지
];

/** 직전 토큰이 이것으로 끝나면 다음 `/` 는 나눗셈이 아니라 **정규식 시작**이다. */
const REGEX_PRECEDER = /(^|[=(,:;!&|?{}[\]+\-*%<>~^]|return|typeof|case)\s*$/;

/**
 * 주석을 지운다 — 주석에 적힌 금지어는 **설명**이지 화면에 나가는 글이 아니다.
 *
 * ⚠️ 문자열 안의 `//` 를 주석으로 오인하지 않도록, 줄 주석은 따옴표 밖일 때만 자른다.
 *    완벽한 파서가 아니라 **보수적으로** 동작한다 — 애매하면 지우지 않아 오탐(=검출) 쪽으로 기운다.
 * @param {string} src
 * @returns {string}
 */
export function stripComments(src) {
  let out = "";
  let i = 0;
  let quote = "";
  while (i < src.length) {
    const c = src[i];
    const nx = src[i + 1];
    if (quote) {
      // 이스케이프는 2글자를 통째로 건너뛴다 — 안 그러면 `"\\"` 의 닫는 따옴표를 놓친다.
      if (c === "\\") { out += "  "; i += 2; continue; }
      if (c === quote) quote = "";
      out += c;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; out += c; i++; continue; }
    // ⚠️ 정규식 리터럴 — `/https:\/\//` 의 `\/` 를 진짜 슬래시로 읽으면 `//` 를 줄 주석으로
    //    오인해 **그 줄 끝까지 지운다**(세션563 적대검증 🔴, 세션531 `*/*` 사고의 새 변종).
    //    앞 토큰이 값이 아닌 자리(연산자·여는 괄호·`return` 등)의 `/` 는 정규식 시작으로 본다.
    if (c === "/" && nx !== "/" && nx !== "*" && REGEX_PRECEDER.test(out)) {
      let k = i + 1;
      let inClass = false;
      while (k < src.length) {
        const ch = src[k];
        if (ch === "\\") { k += 2; continue; }
        if (ch === "[") inClass = true;
        else if (ch === "]") inClass = false;
        else if (ch === "/" && !inClass) break;
        else if (ch === String.fromCharCode(10)) break; // 정규식은 줄을 안 넘는다 — 오판이면 여기서 포기
        k++;
      }
      if (k < src.length && src[k] === "/") { out += src.slice(i, k + 1); i = k + 1; continue; }
      // 정규식이 아니었다 — 아래 일반 경로로 떨어진다(`/` 한 글자만 소비).
    }
    if (c === "/" && nx === "/") {
      while (i < src.length && src[i] !== "\n") { out += " "; i++; }
      continue;
    }
    if (c === "/" && nx === "*") {
      const end = src.indexOf("*/", i + 2);
      // ⚠️ 닫히지 않은 블록 주석이면 **지우지 않는다**(세션563 적대검증 🔴).
      //    파일 끝까지 지우면 그 뒤 모든 금지어가 사라져 감사가 통째로 눈먼다.
      //    문법 오류인 파일이므로 다른 게이트(typecheck)가 잡는다 — 여기선 보수적으로 남긴다.
      if (end === -1) { out += c; i++; continue; }
      const stop = end + 2;
      for (let k = i; k < stop; k++) out += src[k] === "\n" ? "\n" : " ";
      i = stop;
      continue;
    }
    // JSX 주석 `{/* ... */}` 은 위 블록 주석 가지가 먹는다.
    out += c;
    i++;
  }
  return out;
}

/**
 * 한 파일에서 위반을 찾는다.
 *
 * ## 왜 줄 단위로 안 보나 (세션563 적대검증 🔴)
 *
 * 처음엔 `lines[i]` 를 한 줄씩 검사했는데, **줄바꿈 하나로 100% 우회**됐다. JSX 텍스트는
 * prettier 가 상시 줄을 나누므로, 막으려던 그 문구가 포매터를 한 번 돌리면 스스로 빠져나간다.
 * 실측으로 다음 넷이 전부 통과했다(한 줄 대조군만 잡힘):
 *
 *   <div>
 이 값은 정확하지
 않을 수 있습니다
</div>
 *   {`정확하지 ${x} 않을 수 있습니다`}
 *   {"정확하지 않을" + " 수 있습니다"}
 *   정확하지{" "}않을 수 있습니다
 *
 * 그래서 **텍스트를 먼저 이어 붙여 정규화**한 뒤 찾는다. 줄 번호는 정규화 전 위치를 따로
 * 기억해 두었다가 되돌린다 — 안 그러면 보고가 쓸모없어진다.
 * @param {string} file
 * @param {string} raw
 * @returns {{ file: string, line: number, text: string, why: string }[]}
 */
export function findViolations(file, raw) {
  if (ADMIN_RE.test(file)) return [];
  const src = stripComments(raw);

  // 정규화 — 글자를 지우지 않고 **공백으로 바꿔** 길이를 보존한다. 그래야 오프셋으로
  // 원래 줄 번호를 되찾을 수 있다(길이가 변하면 위치가 어긋난다).
  const flat = src
    .replace(/\{\s*"[^"]*"\s*\}/g, (m) => " ".repeat(m.length)) // {" "} JSX 공백 표현
    .replace(/\$\{[^}]*\}/g, (m) => " ".repeat(m.length)) // 템플릿 보간
    .replace(/"\s*\+\s*"/g, (m) => " ".repeat(m.length)) // "a" + "b" 문자열 결합
    .replace(/[\r\n\t]/g, " ");

  // 오프셋 → 줄 번호 표
  const lineStarts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === String.fromCharCode(10)) lineStarts.push(i + 1);
  /** @param {number} off */
  const lineOf = (off) => {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= off) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };

  /** @type {{ file: string, line: number, text: string, why: string }[]} */
  const hits = [];
  for (const { re, why } of BANNED) {
    // 공백을 건너뛰며 찾도록 각 금지 정규식을 전역으로 다시 만든다.
    const g = new RegExp(re.source, "g");
    let m;
    while ((m = g.exec(flat)) !== null) {
      if (m.index === g.lastIndex) g.lastIndex++;
      const line = lineOf(m.index);
      // 면제 검사는 **그 문장이 놓인 맥락**(앞뒤 200자)에서 본다 — 출처·성질어가
      // 줄바꿈 건너편에 있어도 정당한 고지는 통과시켜야 한다.
      const ctx = flat.slice(Math.max(0, m.index - 200), m.index + 200);
      if (EXEMPT.some((ex) => ex.test(ctx))) continue;
      if (hits.some((h) => h.line === line && h.why === why)) continue;
      const rawLine = (src.split(String.fromCharCode(10))[line - 1] ?? "").trim();
      hits.push({ file, line, text: rawLine.slice(0, 90) || m[0], why });
    }
  }
  return hits.sort((a, b) => a.line - b.line);
}

/** 스캔 대상 확장자 — 텍스트 상수 파일은 JSX 없는 `.ts`/`.js`/`.mjs` 도 있다. */
const SCAN_EXT_RE = /\.(tsx|jsx|ts|js|mjs)$/;

/**
 * 파일 또는 디렉토리를 재귀적으로 훑어 대상 파일 목록을 모은다.
 *
 * `root` 가 디렉토리가 아니라 **파일 하나**(`src/App.tsx`)일 수도 있다 — ROOTS 는
 * "손님이 보는 진입점" 목록이지 디렉토리 목록이 아니다.
 * @param {string} root
 * @returns {string[]}
 */
function walk(root) {
  /** @type {string[]} */
  const acc = [];
  if (!fs.existsSync(root)) return acc;
  const stat = fs.statSync(root);
  if (stat.isFile()) {
    const name = path.posix.basename(root);
    if (SCAN_EXT_RE.test(name) && !/\.test\./.test(name)) acc.push(root);
    return acc;
  }
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    const p = path.posix.join(root, e.name);
    if (e.isDirectory()) acc.push(...walk(p));
    else if (SCAN_EXT_RE.test(e.name) && !/\.test\./.test(e.name)) acc.push(p);
  }
  return acc;
}

/**
 * @param {string[]} roots 스캔할 파일/디렉토리 목록 (기본 = {@link ROOTS})
 * @returns {number} 0 = 통과, 1 = 위반 발견 또는 스캔 파일 0개(사고 신호)
 */
export function main(roots = ROOTS) {
  /** @type {{ file: string, line: number, text: string, why: string }[]} */
  const all = [];
  let scanned = 0;
  for (const root of roots) {
    for (const f of walk(root)) {
      scanned++;
      all.push(...findViolations(f, fs.readFileSync(f, "utf8")));
    }
  }
  // ⚠️ 0개 파일 스캔은 "손님 화면에 문제 없음"이 아니라 **감사 자체가 헛돌았다**는 신호다
  // (다른 cwd 에서 실행됐거나 ROOTS 경로가 깨진 경우). 조용히 exit 0 을 주면 그 뒤로 이
  // 감사가 아무것도 안 보면서 CI 를 영원히 통과시킨다(세션563 리뷰어 지적 ②) — fail-close.
  if (scanned === 0) {
    console.error(`[audit-customer-facing-excuses] 스캔한 파일이 0개 — ROOTS 경로가 잘못됐거나 존재하지 않는다`);
    for (const root of roots) console.error(`  ROOT: ${root} (존재: ${fs.existsSync(root)})`);
    return 1;
  }
  if (all.length === 0) {
    console.log(`[audit-customer-facing-excuses] 통과 — 손님 화면 ${scanned}개 파일에 변명 문구 없음`);
    return 0;
  }
  console.error(`[audit-customer-facing-excuses] 손님 화면에 변명 문구 ${all.length}건`);
  for (const h of all) console.error(`  ${h.file}:${h.line}  ${h.why}\n      ${h.text}`);
  console.error(`
  우리 데이터가 틀린 것을 손님에게 알리는 것은 해결이 아니다.
    1) 고친다
    2) 못 고치면 monitor-collectors.mjs(텔레그램) 또는 관리자 화면으로 사장님께 알린다
    3) 그래도 화면에 뭔가 해야 하면 값을 빼거나 회색으로 둔다
  규칙: ~/.claude/rules/our-defect-is-not-customer-warning.md`);
  return 1;
}

// CLI 로 직접 실행될 때만 돈다 — 테스트가 import 하면 `process.exit` 이 테스트를 죽인다.
// ⚠️ `import.meta.url === "file://" + process.argv[1]` 꼴은 **Windows 에서 늘 거짓**이다
//    (`file:///F:/...` vs `F:\...`). 이 레포의 다른 감사들이 쓰는 **파일명 끝 비교**를 그대로 쓴다
//    (`audit-env-keys.mjs:446` 선례 — 세션539 전수 확인으로 정착한 관례).
const cliName = (process.argv[1] ?? "").split("/").pop()?.split(String.fromCharCode(92)).pop() ?? "";
const isCLI = cliName !== "" && import.meta.url.endsWith(cliName);
if (isCLI) process.exit(main());
