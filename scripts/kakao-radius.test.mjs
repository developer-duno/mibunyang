// @vitest-environment node
// @ts-check
/**
 * Kakao Local API 반경 상한 레포 전수 가드 (세션 497)
 *
 * 사고: `transport-tago.mjs` 의 IC(30000)·KTX(80000) 와 `collect-data.mjs` 의 KTX(30000) 이
 * **서로 다른 파일에서 독립적으로** 상한을 넘겨 박혀 있었다. Kakao 는 radius>20000 요청을
 * HTTP 400 ValidationError 로 거절하는데, 두 곳 다 실패를 삼키는 폴백(빈 배열 / 99 센티널)이
 * 있어 수집기는 계속 "성공"으로 보였고 DB 에는 센티널만 쌓였다. 한 파일만 고치면 다른 파일이
 * 같은 방식으로 살아남으므로 파일 단위가 아니라 레포 단위로 잠근다.
 *
 * 여기서 잡는 것 = URL 에 **숫자로 박힌** radius (`...&radius=30000&...`).
 * 변수로 넘기는 `radius=${radius}` 형태는 정적으로 알 수 없으므로 호출부 상수 쪽에서 잠근다
 * (예: transport-tago.test.mjs 의 RADIUS 테스트).
 */
import { describe, it, expect } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/** 공식 문서(developers.kakao.com/docs/ko/local/dev-guide)상 radius 는 0~20000(m) */
const KAKAO_MAX_RADIUS_M = 20000;

const SCRIPTS_DIR = "scripts";

/**
 * 줄 주석(`// ...`)을 걷어낸다. URL 의 `://` 는 주석이 아니므로 보호한다.
 * 주석에 적힌 예시 숫자까지 잡으면 정상 코드가 빨강이 되어 CI 가 영구히 막힌다.
 *
 * @param {string} line
 * @returns {string}
 */
function stripLineComment(line) {
  const TOKEN = "__SCHEME_SLASHES__";
  const masked = line.split("://").join(`:${TOKEN}`);
  const idx = masked.indexOf("//");
  const kept = idx === -1 ? masked : masked.slice(0, idx);
  return kept.split(`:${TOKEN}`).join("://");
}

/**
 * 본문에서 숫자로 박힌 radius 중 상한을 넘는 것을 찾는다.
 *
 * @param {string} text
 * @returns {{ line: number, radius: number }[]}
 */
export function findOversizedRadii(text) {
  /** @type {{ line: number, radius: number }[]} */
  const hits = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const code = stripLineComment(lines[i]);
    for (const m of code.matchAll(/\bradius=(\d+)\b/g)) {
      const radius = Number(m[1]);
      if (radius > KAKAO_MAX_RADIUS_M) hits.push({ line: i + 1, radius });
    }
  }
  return hits;
}

/** @returns {Promise<string[]>} scripts 하위 .mjs 전량 (테스트 파일 제외) */
async function listScripts() {
  const entries = /** @type {string[]} */ (
    await readdir(SCRIPTS_DIR, { recursive: true })
  );
  return entries
    .filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs"))
    .map((f) => path.posix.join(SCRIPTS_DIR, f.split(path.sep).join("/")));
}

describe("Kakao radius 상한 — scripts 전수", () => {
  it("숫자로 박힌 radius 가 20000m 를 넘는 곳이 없다", async () => {
    const files = await listScripts();
    expect(files.length).toBeGreaterThan(0); // 스캔 대상 0건이면 가드가 무의미하다

    /** @type {string[]} */
    const violations = [];
    for (const file of files) {
      const text = await readFile(file, "utf8");
      for (const { line, radius } of findOversizedRadii(text)) {
        violations.push(`${file}:${line} radius=${radius} (상한 ${KAKAO_MAX_RADIUS_M})`);
      }
    }
    expect(violations).toEqual([]);
  });
});

describe("findOversizedRadii — 판정 로직", () => {
  it("상한 초과를 잡는다", () => {
    expect(findOversizedRadii("fetch(`?radius=30000&sort=distance`)")).toEqual([
      { line: 1, radius: 30000 },
    ]);
  });

  it("정확히 20000 은 통과 (경계 — Kakao 가 받아주는 최대값)", () => {
    expect(findOversizedRadii("fetch(`?radius=20000`)")).toEqual([]);
  });

  it("20001 은 잡는다 (경계 바로 위)", () => {
    expect(findOversizedRadii("fetch(`?radius=20001`)")).toEqual([
      { line: 1, radius: 20001 },
    ]);
  });

  it("줄 주석 안의 숫자는 무시한다 — 정상 코드를 빨갛게 만들면 CI 가 막힌다", () => {
    expect(findOversizedRadii("// 옛날에는 radius=80000 이었다")).toEqual([]);
  });

  it("URL 의 :// 를 주석으로 오인하지 않는다", () => {
    const src = 'fetch(`https://dapi.kakao.com/v2/local/search/keyword.json?radius=30000`)';
    expect(findOversizedRadii(src)).toEqual([{ line: 1, radius: 30000 }]);
  });

  it("radiusKm 처럼 이름만 비슷한 변수는 건드리지 않는다", () => {
    expect(findOversizedRadii("const radiusKm = 30000;")).toEqual([]);
  });

  it("여러 줄에서 각각 잡고 줄 번호를 정확히 준다", () => {
    const src = ["ok radius=1000", "bad radius=30000", "", "bad radius=80000"].join("\n");
    expect(findOversizedRadii(src)).toEqual([
      { line: 2, radius: 30000 },
      { line: 4, radius: 80000 },
    ]);
  });
});
