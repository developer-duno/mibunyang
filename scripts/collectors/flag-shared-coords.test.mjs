// @ts-check
/**
 * `flag-shared-coords.mjs` 회귀 가드 (세션560).
 *
 * ⚠️ 이 수집기의 핵심 설계는 **판정을 직접 하지 않는 것**이다. 세션560에 직접 구현하려다
 * 숫자가 29 → 36 → 95자리로 출렁였다(회차 분리를 결함으로 오판). 그래서 정정 도구의
 * `findTruePlaceholders`(조건: `tier === "none"`)를 그대로 쓴다.
 * 아래 첫 describe 가 **그 위임이 살아 있는지**를 지킨다 — 누가 다시 자체 규칙을 넣으면 red.
 */
import { describe, it, expect } from "vitest";
import { flaggedFromDump } from "./flag-shared-coords.mjs";

/**
 * 덤프 한 줄 만들기
 * @param {string} id
 * @param {string} name
 * @param {number | null} lat
 * @param {number | null} lng
 * @param {string} [tier]
 */
const row = (id, name, lat, lng, tier = "none") => ({ id, name, lat, lng, tier });

describe("flaggedFromDump — 판정은 정정 도구에 위임한다", () => {
  it("세 출처가 실패(none)한 행들만 자리표시로 잡는다", () => {
    const dump = {
      rosterSize: 10,
      rows: [
        // 같은 좌표 · 서로 다른 단지 → 자리표시
        row("a1", "가나아파트", 37.5, 127.0),
        row("a2", "다라아파트", 37.5, 127.0),
        // 멀쩡한 좌표
        row("b1", "마바아파트", 37.6, 127.1),
      ],
    };
    const out = flaggedFromDump(dump);
    expect(out.has("a1")).toBe(true);
    expect(out.has("a2")).toBe(true);
    expect(out.has("b1")).toBe(false);
  });

  it("⚠️ 출처가 있는 행(tier !== none)은 같은 좌표라도 안 잡는다 — 이게 회차 분리를 살린다", () => {
    const dump = {
      rosterSize: 10,
      rows: [
        row("c1", "가나아파트", 37.5, 127.0, "A2"),
        row("c2", "다라아파트", 37.5, 127.0, "A2"),
      ],
    };
    expect(flaggedFromDump(dump).size).toBe(0);
  });

  it("같은 단지의 회차 분리는 잡지 않는다 (핵심이름이 하나)", () => {
    const dump = {
      rosterSize: 10,
      rows: [
        row("d1", "가나아파트", 37.5, 127.0),
        row("d2", "가나아파트(무순위)", 37.5, 127.0),
        row("d3", "가나아파트 임의공급", 37.5, 127.0),
      ],
    };
    expect(flaggedFromDump(dump).size).toBe(0);
  });

  it("좌표가 없는 행은 대상이 아니다", () => {
    const dump = {
      rosterSize: 10,
      rows: [row("e1", "가나아파트", null, null), row("e2", "다라아파트", null, null)],
    };
    expect(flaggedFromDump(dump).size).toBe(0);
  });
});

describe("flaggedFromDump — fail-close", () => {
  it("로스터가 0건인 덤프는 거부한다 (외부 API 가 죽은 회차로 표시를 내리면 안 된다)", () => {
    expect(() => flaggedFromDump({ rosterSize: 0, rows: [] })).toThrow(/로스터/);
  });
  it("rows 가 없으면 거부한다", () => {
    expect(() => flaggedFromDump({ rosterSize: 10 })).toThrow(/rows/);
    expect(() => flaggedFromDump(null)).toThrow(/rows/);
  });
});
