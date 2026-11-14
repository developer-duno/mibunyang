// @vitest-environment node
// ↑ 이 파일은 DOM 이 아니라 디스크의 소스 파일을 읽는다(jsdom 에서는 import.meta.url 이 http:// 라 readFileSync 가 못 읽는다).
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stripComments } from "../../../../scripts/_source-mask.mjs";

/**
 * 손님 안내문(FAQ·가이드·엔진 설명) 폴더의 판정어 가드 — 세션716(BACKLOG A-22 「판정어 가드 정규식 확장」).
 *
 * 세션651(#790, 사장님 결정 — 공공기관 준거)이 "적정가"·"저평가"·"저렴/비쌈" 판정어를 손님 화면에서 뺐는데,
 * 그 가드(`src/scoring/wordingHonesty.test.js` 「가격 축 손님 문자열에 판정어가 없다」)는 함수 출력만 봐서
 * 이 폴더의 안내문은 범위 밖이었다(세션651 맹점 검사관 🟡 — `.omc/artifacts/session651/review-blind.md:65`).
 * 여기는 이 폴더의 소스 파일(시험 제외)을 **주석을 걷어낸 뒤** 훑어 판정어가 0건인지 본다.
 * 주석은 옛 문구의 이력(「"적정가 대비 저평가"(판정어) → …」)을 적고 있어 걷어내야 한다 — 걷어내는 도구는
 * 저장소 공용 `scripts/_source-mask.mjs` `stripComments`(문자열 안 `*\/*` 를 주석으로 오인하지 않는 판본).
 *
 * ⚠️ 변이 대상: 아무 안내문 글자에 판정어를 넣으면(예: FAQSection 의 「실거래 중앙값」 → 「적정가」) 빨강.
 */
const DIR = fileURLToPath(new URL(".", import.meta.url));
const JUDGE = /적정가|저평가|고평가|저렴|비쌈|싸요/;

const files = readdirSync(DIR)
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f))
  .sort();

describe("손님 안내문 폴더(sections/info) — 판정어 0건 (세션716)", () => {
  it("검사 대상 파일이 실제로 있다(빈 목록으로 초록이 되지 않게)", () => {
    expect(files).toEqual(expect.arrayContaining(["FAQSection.tsx", "GuideSections.tsx", "ScoringEngine.tsx"]));
  });

  it.each(files)("%s — 주석을 뺀 소스에 판정어가 없다", (f) => {
    const raw = readFileSync(DIR + f, "utf8");
    const code = stripComments(raw);
    // 양성 앵커 — 걷어낸 사본에 안내문 글자가 남아 있다(스트리퍼가 코드를 먹어 초록이 되는 것을 막는다)
    expect(code, f).toMatch(/실거래/);
    const hits = code
      .split("\n")
      .map((line, i) => ({ line: i + 1, text: line.trim() }))
      .filter((l) => JUDGE.test(l.text));
    expect(hits, `${f} 판정어 줄`).toEqual([]);
  });

  // 대조군 — 주석을 안 걷어내면 옛 문구 이력 때문에 걸린다. 걷어내기가 실제로 일을 하고 있다는 증거
  // (이 대조가 깨지면 = 주석의 옛 문구가 다 지워진 것 · 그땐 이 단언만 지우면 된다).
  it("대조군 — 원본(주석 포함)에는 판정어가 있다", () => {
    const rawHits = files.filter((f) => JUDGE.test(readFileSync(DIR + f, "utf8")));
    expect(rawHits.length).toBeGreaterThan(0);
  });
});
