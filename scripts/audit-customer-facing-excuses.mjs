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

/** 손님이 보는 컴포넌트 뿌리. */
const ROOTS = ["src/components"];

/**
 * 관리자 전용 — 검사 제외. 사장님이 보는 자리라 데이터 상태를 적는 게 **맞다**.
 * 파일명 기준으로 판정한다(경로가 아니라) — `detail/AdminDataAudit.tsx` 처럼 섞여 있어서다.
 */
const ADMIN_RE = /(^|\/)Admin[A-Z]/;

/**
 * 금지 문구 — **우리 값의 신뢰도를 변명하는** 표현만 담는다.
 *
 * ⚠️ "예정"·"평균"·"추정"·"표본" 은 넣지 않는다. 그건 값의 **성질**이라 사실 그대로이고,
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
      if (c === "\\") { out += "  "; i += 2; continue; }
      if (c === quote) quote = "";
      out += c;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; out += c; i++; continue; }
    if (c === "/" && nx === "/") {
      while (i < src.length && src[i] !== "\n") { out += " "; i++; }
      continue;
    }
    if (c === "/" && nx === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
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
 * @param {string} file
 * @param {string} raw
 * @returns {{ file: string, line: number, text: string, why: string }[]}
 */
export function findViolations(file, raw) {
  if (ADMIN_RE.test(file)) return [];
  const src = stripComments(raw);
  /** @type {{ file: string, line: number, text: string, why: string }[]} */
  const hits = [];
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const { re, why } of BANNED) {
      if (re.test(lines[i])) hits.push({ file, line: i + 1, text: lines[i].trim().slice(0, 90), why });
    }
  }
  return hits;
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
function walk(dir) {
  /** @type {string[]} */
  const acc = [];
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.posix.join(dir, e.name);
    if (e.isDirectory()) acc.push(...walk(p));
    else if (/\.(tsx|jsx)$/.test(e.name) && !/\.test\./.test(e.name)) acc.push(p);
  }
  return acc;
}

function main() {
  /** @type {{ file: string, line: number, text: string, why: string }[]} */
  const all = [];
  let scanned = 0;
  for (const root of ROOTS) {
    for (const f of walk(root)) {
      scanned++;
      all.push(...findViolations(f, fs.readFileSync(f, "utf8")));
    }
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
