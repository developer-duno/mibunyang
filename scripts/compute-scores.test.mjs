// @ts-check
/**
 * compute-scores.mjs 배선 가드 (세션 495).
 *
 * main() 을 실행하려면 Supabase·스코어링 엔진을 통째로 모킹해야 해서 비용이 크다.
 * 여기서 지키려는 건 로직이 아니라 **배선 두 가지**뿐이라 소스 직독으로 가드한다:
 *   1) collector_runs 기록 — 성공·실패·0건 세 경로 모두 recordCollectorRun 이 배선돼 있는가.
 *      (이 배선이 빠지면 점수 갱신이 며칠째 안 돼도 collector_runs·monitor 어디에도 신호가 없다 —
 *       세션 495 적대검증에서 "역대 0행" 으로 실측된 구멍.)
 *   2) isCLI 가드 — import 만으로 main() 이 돌아 실 DB 를 치는 회귀 방지.
 *
 * ⚠️ 소스 grep 가드는 주석·선언부에 매칭되면 통째로 무효다(guards-must-be-mutation-tested §소스 grep).
 *    주석을 걷어낸 사본에 검사하고, 패턴은 호출 문장 전체를 고정한다.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
// 순수 함수만 골라 import — isCLI 가드가 있어 import 만으로 main() 이 돌지 않는다.
import { findStaleScoreIds, isStaleClearSafe, clearStaleScores, STALE_CLEAR_MAX_RATIO } from "./compute-scores.mjs";

const src = readFileSync(new URL("./compute-scores.mjs", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

describe("compute-scores — collector_runs 기록 배선 (세션 495)", () => {
  it("PHASE 상수가 monitor 라벨과 같은 'compute-scores' 다", () => {
    expect(src).toMatch(/const\s+PHASE\s*=\s*["']compute-scores["']/);
  });

  it("정상 종료 경로에서 reporter.summary() 를 기록한다", () => {
    expect(src).toMatch(/await\s+recordCollectorRun\(\s*PHASE\s*,\s*reporter\.summary\(\)\s*\)/);
  });

  it("데이터 로드 실패 경로도 status failure 로 기록하고 죽는다 (무기록 사망 금지)", () => {
    expect(src).toMatch(
      /await\s+recordCollectorRun\(\s*PHASE\s*,\s*\{\s*\.\.\.reporter\.summary\(\)\s*,\s*status:\s*["']failure["']/,
    );
  });

  it("DB UPDATE 실패 건수를 reporter 에 합산한다 (계산 성공 + 반영 전멸 = success 방지)", () => {
    expect(src).toMatch(/if\s*\(dbFailed\s*>\s*0\)\s*reporter\.fail\(dbFailed\)/);
  });

  it("isCLI 가드 — import 만으로 main() 이 실행되지 않는다", () => {
    expect(src).toMatch(/const\s+isCLI\s*=\s*argv1\s*&&/);
    expect(src).toMatch(/if\s*\(isCLI\)\s*main\(\)\.catch/);
  });
});

// ── 낡은 점수 정리 (세션502) ──────────────────────────────────
// 여기는 grep 이 아니라 **실제 함수를 돌려** 가드한다. 순수 함수라 모킹 비용이 0 이다.
describe("compute-scores — VIEW 밖 낡은 점수 정리 (세션502)", () => {
  describe("findStaleScoreIds", () => {
    it("VIEW 에 없는 id 만 골라낸다", () => {
      const viewIds = new Set(["a", "b"]);
      const scored = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
      expect(findStaleScoreIds(viewIds, scored)).toEqual(["c", "d"]);
    });

    it("전부 VIEW 안이면 빈 배열", () => {
      expect(findStaleScoreIds(new Set(["a", "b"]), [{ id: "a" }, { id: "b" }])).toEqual([]);
    });

    it("점수 보유 행이 없으면 빈 배열", () => {
      expect(findStaleScoreIds(new Set(["a"]), [])).toEqual([]);
    });

    // ⚠️ 이 케이스가 가드의 핵심이다. 기준을 "채점 성공한 행" 으로 바꾸면 검증 실패로 스킵된
    //    VIEW 내 단지의 기존 점수까지 지워져 화면에서 점수가 사라진다.
    it("VIEW 안이지만 이번에 채점이 스킵된 단지는 지우지 않는다", () => {
      const viewIds = new Set(["a", "skipped", "c"]); // VIEW 전량 (채점 성공 여부와 무관)
      const scored = [{ id: "a" }, { id: "skipped" }, { id: "c" }, { id: "outside" }];
      expect(findStaleScoreIds(viewIds, scored)).toEqual(["outside"]);
    });
  });

  describe("isStaleClearSafe", () => {
    it("세션502 실측값(579/2622 = 22%)은 안전 범위", () => {
      expect(isStaleClearSafe(579, 2622)).toBe(true);
    });

    it("한도 경계값은 통과시킨다", () => {
      expect(isStaleClearSafe(40, 100)).toBe(true);
      expect(STALE_CLEAR_MAX_RATIO).toBe(0.4);
    });

    // VIEW 조회가 일부만 돌아온 회차를 흉내낸다 — 멀쩡한 점수를 쓸어버리면 안 된다.
    it("한도를 넘으면 막는다 (부분 조회 사고 방어)", () => {
      expect(isStaleClearSafe(41, 100)).toBe(false);
      expect(isStaleClearSafe(2122, 2622)).toBe(false);
    });

    it("0건이거나 값이 이상하면 안전하지 않다고 본다", () => {
      expect(isStaleClearSafe(0, 0)).toBe(false);
      expect(isStaleClearSafe(-1, 100)).toBe(false);
      expect(isStaleClearSafe(NaN, 100)).toBe(false);
      expect(isStaleClearSafe(10, NaN)).toBe(false);
    });
  });

  // clearStaleScores 는 grep 이 아니라 가짜 클라이언트로 **실제 실행**해 가드한다.
  // (grep 만 두면 안전판 호출을 통째로 들어내도 초록불이 남는다 — 세션502 뮤테이션에서 실증.)
  describe("clearStaleScores (가짜 Supabase 로 실행)", () => {
    /**
     * `.from().select().not()` → selectAll 이 `.range()` 로 페이지네이션.
     * `.from().update().in().select()` → 그대로 await.
     * @param {{ scored?: string[], updateError?: string|null }} cfg
     */
    function makeFake({ scored = [], updateError = null } = {}) {
      const log = { updatedBatches: /** @type {string[][]} */ ([]), patches: /** @type {any[]} */ ([]) };
      const build = () => {
        const st = { isUpdate: false, ids: /** @type {string[]} */ ([]) };
        /** @type {any} */
        const b = {
          select: () => b,
          not: () => b,
          update: (/** @type {any} */ patch) => { st.isUpdate = true; log.patches.push(patch); return b; },
          in: (/** @type {string} */ _c, /** @type {string[]} */ vals) => {
            st.ids = vals; log.updatedBatches.push(vals); return b;
          },
          range: (/** @type {number} */ f, /** @type {number} */ t) =>
            Promise.resolve({ data: scored.slice(f, t + 1).map((id) => ({ id })), error: null }),
          then: (/** @type {any} */ res, /** @type {any} */ rej) =>
            Promise.resolve(
              st.isUpdate && updateError
                ? { data: null, error: { message: updateError } }
                : { data: st.ids.map((id) => ({ id })), error: null },
            ).then(res, rej),
        };
        return b;
      };
      return { from: () => build(), _log: log };
    }

    it("VIEW 밖 행만 비운다", async () => {
      const sb = makeFake({ scored: ["a", "b", "c", "outside"] });
      const failed = await clearStaleScores(sb, new Set(["a", "b", "c"]), { dryRun: false });
      expect(failed).toBe(0);
      expect(sb._log.updatedBatches).toEqual([["outside"]]);
      expect(sb._log.patches).toEqual([{ cats_cache: null }]);
    });

    it("지울 게 없으면 UPDATE 를 아예 안 친다", async () => {
      const sb = makeFake({ scored: ["a", "b"] });
      expect(await clearStaleScores(sb, new Set(["a", "b"]), { dryRun: false })).toBe(0);
      expect(sb._log.updatedBatches).toEqual([]);
    });

    // ⚠️ 핵심 안전판. VIEW 조회가 일부만 돌아온 회차를 흉내낸다 —
    //    이 가드가 없으면 멀쩡한 단지 점수를 통째로 지운다.
    it("안전 한도를 넘으면 지우지 않고 실패 1 을 돌려준다", async () => {
      const scored = Array.from({ length: 100 }, (_, i) => `id${i}`);
      const sb = makeFake({ scored });
      const failed = await clearStaleScores(sb, new Set(scored.slice(0, 50)), { dryRun: false });
      expect(failed).toBe(1); // collector_runs 에 실패로 남아야 사람이 본다
      expect(sb._log.updatedBatches).toEqual([]); // 한 건도 안 지웠다
    });

    // 아래 두 케이스는 안전 한도(40%) 안쪽으로 잡는다 — 넘기면 한도 가드가 먼저 걸려
    // dryRun·UPDATE 경로에 도달하지 못한다(테스트를 처음 쓸 때 실제로 여기 걸렸다).
    it("dryRun 이면 DB 를 건드리지 않는다", async () => {
      const scored = Array.from({ length: 10 }, (_, i) => `id${i}`);
      const sb = makeFake({ scored });
      expect(await clearStaleScores(sb, new Set(scored.slice(0, 9)), { dryRun: true })).toBe(0);
      expect(sb._log.updatedBatches).toEqual([]);
    });

    it("UPDATE 가 깨지면 그 건수를 실패로 돌려준다 (조용한 성공 금지)", async () => {
      const scored = Array.from({ length: 10 }, (_, i) => `id${i}`);
      const sb = makeFake({ scored, updateError: "RLS 거부" });
      expect(await clearStaleScores(sb, new Set(scored.slice(0, 8)), { dryRun: false })).toBe(2);
    });

    it("1,000행을 넘어도 전부 본다 (PostgREST 페이지 제한 회피)", async () => {
      const scored = Array.from({ length: 2500 }, (_, i) => `id${i}`);
      const sb = makeFake({ scored });
      // 뒤 500건만 VIEW 밖 → 20% 라 안전 한도 안
      await clearStaleScores(sb, new Set(scored.slice(0, 2000)), { dryRun: false });
      expect(sb._log.updatedBatches.flat()).toHaveLength(500);
    });
  });

  // 배선 가드 — 정리 단계가 main() 에 실제로 꽂혀 있고 기준이 "VIEW 전량" 인지.
  // 좌변까지 고정해 함수 선언부에 매칭되지 않게 한다(guards-must-be-mutation-tested §소스 grep).
  it("main() 이 VIEW 전량 id 로 정리를 호출하고 실패 건수를 dbFailed 에 합산한다", () => {
    expect(src).toMatch(
      /dbFailed\s*\+=\s*await\s+clearStaleScores\(\s*sb\s*,\s*new Set\(allApartments\.map\(\(a\)\s*=>\s*a\.id\)\)\s*\)/,
    );
  });
});
