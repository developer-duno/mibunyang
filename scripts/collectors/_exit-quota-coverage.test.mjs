// @ts-check
/**
 * exit ↔ 쿼터 기록 순서 회귀 가드 (세션 496)
 *
 * scripts/CLAUDE.md "Exit Code 정책" — **recordApiQuota 완료 후 exit 호출 (쿼터 기록 보장)**.
 *
 * 왜 가드가 필요한가:
 *   Node 에서 `try` 안의 `process.exit()` 은 **대기 중인 `finally` 를 실행하지 않는다**(실측).
 *   그래서 아래 구조는 실패 종료 때마다 API 쿼터 기록이 통째로 유실된다 — 그런데 성공 경로는
 *   멀쩡히 기록되므로 로그만 봐서는 절대 안 드러난다.
 *
 *       try { ...; process.exit(1); }        // ← finally 를 건너뜀
 *       finally { await recordApiQuota(...); }
 *
 *   세션 395 가 이 결함을 9개 파일에서 고쳤지만 collect-applyhome / -seed 두 개를 놓쳤고,
 *   1년 가까이 아무도 몰랐다. **파일별 수동 점검이 반복해서 놓치는 종류의 결함**이라
 *   전 수집기를 기계로 훑는다.
 *
 * 두 가지 정답 패턴 (둘 다 통과):
 *   1. try/catch/finally 문 **전체가 끝난 뒤** exit — collect-market-stats.mjs
 *      → `try` 안에 조기 `return` 이 없을 때만 안전하다.
 *   2. `shouldExit1` 플래그 + `finally` 안 recordApiQuota **await 직후** exit
 *      → `try` 안에 조기 `return`(dry-run 등)이 있으면 이쪽만 안전하다.
 *
 *   ⚠️ 패턴 1 을 조기 `return` 이 있는 파일에 쓰면 회귀다 — 그 줄에 도달하지 못해
 *      exit 0(성공)으로 끝난다. PR #331 에서 실제로 냈다가 node 실측으로 잡은 사고.
 *
 * 답습 자산:
 *   scripts/collectors/_graceful-coverage.test.mjs (같은 성격의 전수 가드 — 구조·주석 처리 답습)
 *   .claude/rules/meta/guards-must-be-mutation-tested.md (가드는 고장 내서 검증한다)
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import path from "path";

const COLLECTORS_DIR = path.resolve(process.cwd(), "scripts/collectors");

/**
 * 아직 안 고쳐진 파일 — **현재 비어 있다(예외 0)**.
 *
 * 여기 이름을 적으면 "지금 결함이 있다"고 선언하는 것이고, 아래 테스트가 **정말 아직
 * 결함 상태인지까지 확인**한다. 누가 고치면 red 가 되어 "여기서 지워라"라고 알려준다 —
 * 고친 뒤에도 예외가 남아 영구 구멍이 되는 것(가짜 초록불)을 막기 위해서다.
 * 새 결함을 여기 적어 미루기보다 고치는 쪽이 기본값이다.
 */
/** @type {Set<string>} */
const KNOWN_BROKEN = new Set();

/**
 * 주석을 걷어낸 사본. 주석 처리된 코드가 "안전장치가 박혀 있다"는 증거가 되면 안 되고,
 * 반대로 주석 안의 `process.exit(` 예시가 결함으로 오탐돼도 안 된다.
 * (_graceful-coverage.test.mjs stripComments 답습 — 중괄호 균형이 깨지지 않게 공백으로 치환)
 * @param {string} src
 * @returns {string}
 */
export function stripComments(src) {
  return src
    // ── 블록 주석은 **두 번에 나눠** 지운다. 한 정규식으로는 두 위험을 동시에 못 막는다.
    //
    // ⚠️ 위험 ① — 문자열 안 `*/*` 를 주석 시작으로 오인 (세션531 박제, 이 파일만 미반영이었다):
    //    `"Accept": "application/json, text/plain, */*"` 의 가운데 `/*` 를 주석 시작으로 읽으면
    //    그 뒤 첫 `*/`(다음 JSDoc 닫기)까지 **실제 코드가 통째로 지워진다**. 그러면 그 구간을
    //    겨누는 검사가 무엇을 넣어도 통과한다(`extractQuotaTryFinally` 가 null → `if (!found) return;`).
    //    이 저장소에서 `*/*` 를 가진 수집기 = naver-presale·naver-listings·naver-devplan 3개.
    //
    // ⚠️ 위험 ② — 줄머리 고정만 쓰면 **줄 중간 블록 주석을 못 지운다**:
    //    `finally { await recordApiQuota(); /* process.exit(1); */ }` 처럼 주석 처리된 exit 이
    //    남아 "안전장치가 있다"로 오인된다(같은 파일 위쪽 "주석으로 가려진 finally-exit" 테스트가
    //    정확히 이걸 지킨다 — 세션539 에서 고정만 걸었다가 그 테스트가 red 로 잡아냈다).
    //
    // 1단계: 줄머리 블록 주석(JSDoc 등) — 문자열 리터럴은 줄머리에서 시작하지 않으니 안전하다.
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, (m) => m.replace(/[^\n]/g, " "))
    // 2단계: 줄 중간 블록 주석 — 단 `*` 바로 뒤의 `/*`(= `*/*` 의 일부)는 제외해 위험 ①을 막는다.
    .replace(/(?<!\*)\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
}

/**
 * `open` 위치의 `{` 에 대응하는 `}` 위치를 중괄호 균형으로 찾는다.
 * @param {string} src
 * @param {number} open
 * @returns {number} 대응하는 `}` 인덱스 (못 찾으면 -1)
 */
function matchBrace(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * recordApiQuota 를 부르는 `finally` 블록과, 그에 대응하는 `try` 블록을 뽑는다.
 * @param {string} src  주석이 걷어내진 소스
 * @returns {{ tryBody: string; finallyBody: string } | null}
 */
export function extractQuotaTryFinally(src) {
  for (let idx = src.indexOf("finally"); idx !== -1; idx = src.indexOf("finally", idx + 1)) {
    const open = src.indexOf("{", idx);
    if (open === -1) break;
    const end = matchBrace(src, open);
    if (end === -1) break;
    const finallyBody = src.slice(open, end + 1);
    if (!/recordApiQuota\s*\(/.test(finallyBody)) continue;

    // 대응하는 try = 이 finally 직전의 `try`
    const tryPos = src.lastIndexOf("try", idx);
    if (tryPos === -1) return { tryBody: "", finallyBody };
    const tOpen = src.indexOf("{", tryPos);
    const tEnd = matchBrace(src, tOpen);
    return { tryBody: tEnd === -1 ? "" : src.slice(tOpen, tEnd + 1), finallyBody };
  }
  return null;
}

const EXIT_REGEX = /process\.exit\s*\(/;
/** 조기 중단용 bare `return;` (값 반환 return 은 제외 — 여기선 main() 만 다룬다) */
const BARE_RETURN_REGEX = /(^|[^\w.$])return\s*;/;
const EXIT_FLAG_REGEX = /shouldExit\w*/i;

describe("extractQuotaTryFinally / stripComments — 가드 자체 검증", () => {
  it("try 안 exit 을 잡아낸다", () => {
    const src = "try { process.exit(1); } finally { await recordApiQuota(p,k,n); }";
    const r = extractQuotaTryFinally(src);
    expect(r).not.toBeNull();
    expect(EXIT_REGEX.test(/** @type {{tryBody:string}} */ (r).tryBody)).toBe(true);
  });

  it("finally 안 exit 은 try 쪽으로 새지 않는다", () => {
    const src = "try { const a = 1; } finally { await recordApiQuota(p,k,n); if (f) process.exit(1); }";
    const r = /** @type {{tryBody:string; finallyBody:string}} */ (extractQuotaTryFinally(src));
    expect(EXIT_REGEX.test(r.tryBody)).toBe(false);
    expect(EXIT_REGEX.test(r.finallyBody)).toBe(true);
  });

  it("recordApiQuota 없는 finally 는 무시한다", () => {
    expect(extractQuotaTryFinally("try { a(); } finally { b(); }")).toBeNull();
  });

  it("중첩 블록이 있어도 try 경계를 정확히 끊는다", () => {
    const src = "try { if (x) { y(); } for (;;) { break; } } finally { await recordApiQuota(p,k,n); }";
    const r = /** @type {{tryBody:string}} */ (extractQuotaTryFinally(src));
    expect(EXIT_REGEX.test(r.tryBody)).toBe(false);
    expect(r.tryBody).toContain("for (;;)");
  });

  it("주석으로 가려진 exit 은 결함으로 오탐하지 않는다", () => {
    const raw = "try { // process.exit(1);\n a(); } finally { await recordApiQuota(p,k,n); }";
    expect(EXIT_REGEX.test(/** @type {{tryBody:string}} */ (extractQuotaTryFinally(raw)).tryBody))
      .toBe(true); // 주석 처리 안 하면 오탐하는 것이 원래 성질
    const r = /** @type {{tryBody:string}} */ (extractQuotaTryFinally(stripComments(raw)));
    expect(EXIT_REGEX.test(r.tryBody)).toBe(false);
  });

  it("주석으로 가려진 finally-exit 은 안전장치로 안 쳐준다", () => {
    const raw = "try { a(); } finally { await recordApiQuota(p,k,n); /* if (f) process.exit(1); */ }";
    const r = /** @type {{finallyBody:string}} */ (extractQuotaTryFinally(stripComments(raw)));
    expect(EXIT_REGEX.test(r.finallyBody)).toBe(false);
  });
});

describe("exit ↔ 쿼터 기록 순서 회귀 가드 (세션 496)", () => {
  const FILES = readdirSync(COLLECTORS_DIR)
    .filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs") && !f.startsWith("_"))
    .sort();

  it("KNOWN_BROKEN 항목 = 모두 실제 파일", () => {
    for (const name of KNOWN_BROKEN) {
      expect(FILES.includes(name), `KNOWN_BROKEN 항목 ${name} 가 실제 파일 아님 (오타/stale)`).toBe(true);
    }
  });

  it("검사 대상이 0개면 가드가 무의미하다 — 최소 1개 이상", () => {
    const targets = FILES.filter((f) =>
      extractQuotaTryFinally(stripComments(readFileSync(path.join(COLLECTORS_DIR, f), "utf8"))),
    );
    expect(targets.length).toBeGreaterThan(0);
  });

  for (const f of FILES) {
    it(`${f}: try 안 process.exit 금지 (쿼터 기록 보장)`, () => {
      const src = stripComments(readFileSync(path.join(COLLECTORS_DIR, f), "utf8"));
      const found = extractQuotaTryFinally(src);
      if (!found) return; // finally 로 쿼터를 기록하지 않는 파일 = 대상 아님

      const exitInTry = EXIT_REGEX.test(found.tryBody);

      if (KNOWN_BROKEN.has(f)) {
        // 아직 안 고쳐진 파일 — 고쳐졌으면 KNOWN_BROKEN 에서 빼야 한다(영구 구멍 방지)
        expect(
          exitInTry,
          `${f}: 이미 고쳐졌다 → KNOWN_BROKEN 에서 이 줄을 지울 것 (PR #331 머지 등)`,
        ).toBe(true);
        return;
      }

      expect(
        exitInTry,
        `${f}: try 안 process.exit() 은 finally 의 recordApiQuota 를 건너뛴다 (실패 종료 시 쿼터 유실). ` +
          `shouldExit1 플래그 + finally 안 recordApiQuota await 직후 exit 으로 바꿀 것 — collect-applyhome.mjs 답습`,
      ).toBe(false);
    });

    it(`${f}: 조기 return 이 있으면 exit 은 finally 안에 (try/finally 뒤로 빼면 exit 0 회귀)`, () => {
      const src = stripComments(readFileSync(path.join(COLLECTORS_DIR, f), "utf8"));
      const found = extractQuotaTryFinally(src);
      if (!found) return;
      // 이 규칙은 "exit 플래그 패턴을 쓰는 파일"에만 건다 — 플래그가 없으면 애초에 비정상 종료가 없다
      if (!EXIT_FLAG_REGEX.test(src)) return;
      if (!BARE_RETURN_REGEX.test(found.tryBody)) return;

      expect(
        EXIT_REGEX.test(found.finallyBody),
        `${f}: try 안에 조기 return 이 있는데 exit 이 finally 밖에 있다 — 그 경로는 exit 줄에 ` +
          `도달하지 못해 실패인데 exit 0(성공)으로 끝난다. exit 을 finally 안 recordApiQuota await 직후로 옮길 것`,
      ).toBe(true);
    });
  }
});

// ── 세션539 C-1: 주석 제거기가 문자열 안 `*/*` 를 먹지 않는다 ────────────────
/**
 * 세션531 이 `.claude/rules/meta/guards-must-be-mutation-tested.md` 에 박제한 결함의 재발 가드다.
 * 줄머리 고정이 없는 정규식은 `"Accept": "…, * / *"`(공백 없이) 안의 `/ *` 를 주석 시작으로 읽어
 * 그 뒤 첫 `* /` 까지 실제 코드를 통째로 지운다 — 그러면 그 구간을 겨누는 이 파일의 검사들이
 * **무엇을 넣어도 통과**한다(검사 대상이 애초에 없으니까).
 *
 * ⚠️ 이 가드는 "겨누는 문자열이 사본에 실제로 남아 있는가"를 먼저 확인한다 — 그게 빠지면
 *    가드가 무엇을 검사하는지도 모르는 채 초록불이 된다.
 */
describe("stripComments — 문자열 리터럴 안의 주석 기호를 먹지 않는다 (세션539 C-1)", () => {
  // ⚠️ 검사 대상은 **실제로 지워지는 구간 안**에 있어야 한다. 옛 정규식은 `*/*` 의 `/*` 부터
  //    **다음 `*/`(아래 JSDoc 닫기)까지**를 먹으므로, 그 뒤에 있는 `AFTER_COMMENT` 는 옛 판본에서도
  //    멀쩡히 살아남는다 — 그걸 검사하면 가드가 아무것도 안 지킨다(세션539 에서 실제로 그렇게
  //    썼다가 뮤테이션이 green 이라 잡았다). 그래서 **두 `*/` 사이**의 줄을 겨눈다.
  const SAMPLE = [
    "const HEADERS = {",
    '  Accept: "application/json, text/plain, */*",',
    '  "sec-fetch-site": "same-origin",', // ← 옛 판본이 먹는 구간
    "};",
    "",
    "/**",
    " * 진짜 블록 주석 — 이건 지워져야 한다.",
    " */",
    "const AFTER_COMMENT = 1;",
  ].join("\n");

  it("`*/*` 와 다음 `*/` 사이의 실제 코드가 사본에 그대로 남는다", () => {
    const out = stripComments(SAMPLE);
    expect(out).toContain('"sec-fetch-site": "same-origin"');
    expect(out).toContain("};");
    expect(out).toContain("const AFTER_COMMENT = 1;");
  });

  it("줄머리에서 시작하는 진짜 블록 주석은 지운다", () => {
    const out = stripComments(SAMPLE);
    expect(out).not.toContain("진짜 블록 주석");
  });

  it("줄 수가 보존된다 (중괄호 균형·줄번호 어긋남 방지)", () => {
    expect(stripComments(SAMPLE).split("\n").length).toBe(SAMPLE.split("\n").length);
  });

  // 실측(세션539): 옛 정규식이 먹는 줄 수 — naver-presale 32줄(57~95) · naver-listings 11줄(81~91)
  // · naver-devplan 11줄(120~130). 세 파일 모두 같은 헤더 블록이라 `sec-fetch-site` 가 공통 표적이다.
  for (const f of ["naver-presale.mjs", "naver-listings.mjs", "naver-devplan.mjs"]) {
    it(`${f}: \`*/*\` 뒤 헤더 블록이 사본에서 안 잘린다`, async () => {
      const { readFileSync } = await import("node:fs");
      const src = readFileSync(new URL(`./${f}`, import.meta.url), "utf-8");
      // 전제 확인 — `*/*` 가 사라지면 이 가드는 아무것도 안 지키는 셈이라 그 사실을 시끄럽게 알린다.
      expect(src, `${f} 에 '*/*' 가 없다 — 이 가드의 전제가 깨졌다`).toContain("*/*");
      expect(src).toContain("sec-fetch-site");
      expect(stripComments(src), `${f}: 옛 정규식이면 이 줄이 공백이 된다`).toContain("sec-fetch-site");
    });
  }
});
