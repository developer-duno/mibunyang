// @ts-check
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { NOXIOUS_KEYWORDS } from "./noxious.mjs";

/**
 * 혐오시설 **수집 카테고리 ↔ 감점표** 동기화 가드 (세션510 ①-2).
 *
 * ## 왜 필요한가
 *
 * 두 목록이 서로 다른 파일에 손으로 적혀 있어서 조용히 갈라졌다. 2026-08-11 운영 실측(n=1,646):
 *   - 혐오시설 보유 **1,119곳** 중 감점을 받는 건 **56곳(5.0%)** 뿐
 *   - `고압선`(수집기) vs `고압송전탑`(감점표) **이름 어긋남으로 63곳이 감점 누락**
 *   - 감점표의 `묘지`·`철도인접`·`유흥가` 는 수집기가 **아예 만들지 않는** 죽은 키
 *
 * 화면은 빨간 경고를 띄우는데 점수는 안 깎이는 상태가 오래 유지됐고, **테스트도 로그도 이걸 안 잡았다.**
 * 두 파일을 각각 봐서는 드러나지 않기 때문이다 — 맞대봐야 보인다.
 *
 * ## 이 가드가 막는 것
 *
 * 1. 수집기에 카테고리를 추가하고 감점표를 안 고치는 것 → 화면만 경고, 점수는 침묵
 * 2. 감점표에 수집기가 안 만드는 키를 넣는 것 → 영영 발동 안 하는 죽은 규칙
 * 3. 이름을 한쪽만 바꾸는 것 → 이번 사고의 재발
 *
 * ⚠️ `brands.ts` 는 TypeScript 라 이 Node 테스트에서 import 할 수 없다. 소스를 읽어 키를 뽑는다.
 *    정규식은 **줄 시작을 고정**해 주석·문자열에 걸리지 않게 한다(룰 §"소스 grep 가드").
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const BRANDS = readFileSync(resolve(ROOT, "src/constants/brands.ts"), "utf8");

/**
 * `export const <NAME>: Record<...> = { ... };` 블록에서 최상위 키만 뽑는다
 * @param {string} constName
 * @returns {string[]}
 */
function keysOf(constName) {
  const start = BRANDS.indexOf(`export const ${constName}`);
  if (start === -1) throw new Error(`${constName} 를 brands.ts 에서 못 찾았다`);
  const open = BRANDS.indexOf("{", start);
  const close = BRANDS.indexOf("\n};", open);
  if (open === -1 || close === -1) throw new Error(`${constName} 블록 경계를 못 찾았다`);
  const body = BRANDS.slice(open + 1, close);
  // 각 줄의 `키:` — 줄 시작 고정이라 주석(`// …`)이나 문자열 안 콜론에 안 걸린다
  return body
    .split("\n")
    .map((l) => l.match(/^\s{2}([가-힣A-Za-z_][가-힣A-Za-z0-9_]*)\s*:/))
    .filter((m) => m != null)
    .map((m) => /** @type {RegExpMatchArray} */ (m)[1]);
}

const penaltyKeys = new Set(keysOf("NOXIOUS_PENALTY"));
const noPenaltyKeys = new Set(keysOf("NOXIOUS_NO_PENALTY"));
const collected = new Set(NOXIOUS_KEYWORDS.map((k) => k.category));

describe("혐오시설 수집 카테고리 ↔ 감점표 동기화 (세션510)", () => {
  it("가드 자체가 살아 있다 — 세 목록이 전부 비어 있지 않다", () => {
    // 정규식이 죽으면 아래 단언들이 빈 집합끼리 비교하며 조용히 통과한다.
    expect(penaltyKeys.size).toBeGreaterThan(0);
    expect(noPenaltyKeys.size).toBeGreaterThan(0);
    expect(collected.size).toBeGreaterThan(0);
  });

  it("수집기가 만드는 카테고리는 전부 감점표나 '감점 0' 목록 중 한 곳에 있다", () => {
    // 빠뜨리면 화면은 경고를 띄우는데 점수는 침묵한다 — 손님에게 서로 다른 말을 하게 된다.
    const orphans = [...collected].filter((c) => !penaltyKeys.has(c) && !noPenaltyKeys.has(c));
    expect(orphans, `수집은 되는데 감점 여부가 안 정해진 카테고리: ${orphans.join(", ")}`).toEqual([]);
  });

  it("감점표의 모든 키를 수집기가 실제로 만든다 — 죽은 규칙 금지", () => {
    // 옛 표의 묘지·철도인접·유흥가가 정확히 이 경우였다(수집기가 안 만들어 영영 발동 0).
    const dead = [...penaltyKeys].filter((k) => !collected.has(k));
    expect(dead, `수집기가 만들지 않는 죽은 감점 키: ${dead.join(", ")}`).toEqual([]);
  });

  it("'감점 0' 목록도 수집기가 실제로 만드는 것만 담는다", () => {
    const dead = [...noPenaltyKeys].filter((k) => !collected.has(k));
    expect(dead, `수집기가 만들지 않는데 예외 목록에 있는 키: ${dead.join(", ")}`).toEqual([]);
  });

  it("한 카테고리가 감점표와 '감점 0' 목록에 동시에 들어가지 않는다", () => {
    const both = [...penaltyKeys].filter((k) => noPenaltyKeys.has(k));
    expect(both, `두 목록에 동시에 있는 키: ${both.join(", ")}`).toEqual([]);
  });

  it("감점 값은 전부 음수다 — 부호를 잘못 넣으면 혐오시설이 가점이 된다", () => {
    for (const k of penaltyKeys) {
      const m = BRANDS.match(new RegExp(`^\\s{2}${k}\\s*:\\s*(-?\\d+)`, "m"));
      expect(m, `${k} 의 감점 값을 못 읽었다`).toBeTruthy();
      expect(Number(/** @type {RegExpMatchArray} */ (m)[1]), `${k} 감점 값이 음수가 아니다`).toBeLessThan(0);
    }
  });
});
