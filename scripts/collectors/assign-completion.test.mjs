// @ts-check
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  MIN_GAP_MONTHS,
  CHANGE_BREAKER_MAX_ROWS,
  CHANGE_BREAKER_RATIO,
  UPDATE_CONCURRENCY,
  UPDATE_BATCH_DELAY_MS,
  BUILD_YEAR_SAMPLE,
  DECISIONS_PATH,
  planCompletionUpdates,
  parseCompletionDecisions,
  evaluateChangeBreaker,
  parseArgs,
  fetchBuildYears,
  neededAptSeqs,
  kstYm,
  modeOf,
  isYm,
  main,
} from "./assign-completion.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const NOW_YM = "202610";

// 입력은 운영 형식 그대로(세션624 실측): completion·move_in_ym = "YYYYMM" 문자열 · build_year = 정수 ·
// link_key = apt_seq "41463-123" · method = "jibun+name" | "name" | "manual" | "bundle" · id 접두 ah-/ap-
/**
 * @param {string} id
 * @param {string | null} completion
 * @param {{ key?: string | null, lot?: number | null, name?: string }} [o]
 */
const row = (id, completion, o = {}) => ({ id, name: o.name ?? id, completion, complex_key: o.key ?? null, lot_main: o.lot ?? null });
/** @param {string} apartment_id @param {string} move_in_ym @param {string} [hmn] */
const notice = (apartment_id, move_in_ym, hmn = `h-${apartment_id}`) => ({ apartment_id, house_manage_no: hmn, move_in_ym });
/** @param {string} apartment_id @param {string} link_key @param {string} [method] */
const link = (apartment_id, link_key, method = "jibun+name") => ({ apartment_id, link_key, method });
const NO_YEARS = new Map();
/** @param {ReturnType<typeof planCompletionUpdates>} plan @param {string} id */
const upd = (plan, id) => plan.updates.find((u) => u.id === id);

describe("planCompletionUpdates — 설계서 §2-1 예시", () => {
  it("송도 4차 꼴: 자기 공고 202507 · 묶음 남의 공고 202310 · 지금 202612(미래) · 연도 없음 → future_unverified(안 바뀜)", () => {
    const rows = [row("ah-2025910300", "202612", { key: "송도4" }), row("ap-1", "202310", { key: "송도4" })];
    const sch = [notice("ah-2025910300", "202507"), notice("ap-1", "202310")];
    const plan = planCompletionUpdates(rows, sch, [], NO_YEARS, [], NOW_YM);
    expect(plan.updates).toEqual([]);
    expect(plan.skipped).toEqual({ future_unverified: 1 });
  });

  it("같은 입력에 지금 202605(과거) · minGap 1 → 남의 202310 이 아니라 자기 공고 202507(own_notice)", () => {
    const rows = [row("ah-2025910300", "202605", { key: "송도4" }), row("ap-1", "202310", { key: "송도4" })];
    const sch = [notice("ah-2025910300", "202507", "2025000123"), notice("ap-1", "202310")];
    const plan = planCompletionUpdates(rows, sch, [], NO_YEARS, [], NOW_YM, { minGap: 1 });
    expect(plan.updates).toEqual([
      { id: "ah-2025910300", prev: "202605", next: "202507", source: "own_notice", houseManageNo: "2025000123", buildYear: null, gapMonths: 10, flags: ["no_year"] },
    ]);
  });

  it("금빛 꼴: 묶음 지번 1003/1008 · 3차 자기 공고 없음 · 묶음 최솟값 202305 · 지금 202408 · 건축 2024 → year_mismatch(안 바뀜)", () => {
    const rows = [row("ah-2023910001", "202305", { key: "금빛", lot: 1003 }), row("ah-2024910002", "202408", { key: "금빛", lot: 1008 })];
    const sch = [notice("ah-2023910001", "202305")];
    const links = [link("ah-2024910002", "41463-3063")];
    const plan = planCompletionUpdates(rows, sch, links, new Map([["41463-3063", 2024]]), [], NOW_YM);
    expect(plan.updates).toEqual([]);
    expect(plan.skipped).toEqual({ not_earlier: 1, year_mismatch: 1 });
  });

  it("금빛 꼴에 연도가 없으면 지번 2종이라 mixed_lots(다른 건물일 수 있다 — 열쇠가 1개여도)", () => {
    const rows = [row("ah-2023910001", "202305", { key: "금빛", lot: 1003 }), row("ah-2024910002", "202408", { key: "금빛", lot: 1008 })];
    const plan = planCompletionUpdates(rows, [notice("ah-2023910001", "202305")], [], NO_YEARS, [], NOW_YM);
    expect(plan.updates).toEqual([]);
    expect(plan.skipped.mixed_lots).toBe(1);
  });

  it("지번 2종이어도 건축년도가 후보 연도와 같으면 통과(mixed_but_year_ok)", () => {
    const rows = [row("ah-2023910001", "202305", { key: "금빛", lot: 1003 }), row("ah-2024910002", "202408", { key: "금빛", lot: 1008 })];
    const links = [link("ah-2024910002", "41463-3063")];
    const plan = planCompletionUpdates(rows, [notice("ah-2023910001", "202305")], links, new Map([["41463-3063", 2023]]), [], NOW_YM);
    expect(upd(plan, "ah-2024910002")).toMatchObject({ next: "202305", source: "bundle_notice", buildYear: 2023, flags: ["mixed_but_year_ok"] });
  });

  it("디센트 0027: 묶음 공고 202412 · 지금 202508 · 연도 없음 → minGap 1 이면 202412 no_year gap 8 / 12 면 not_earlier / 기본값도 not_earlier", () => {
    const rows = [row("ah-2026910027", "202508", { key: "디센트2" }), row("ap-9", "202412", { key: "디센트2" })];
    const sch = [notice("ap-9", "202412")];
    const one = planCompletionUpdates(rows, sch, [], NO_YEARS, [], NOW_YM, { minGap: 1 });
    expect(upd(one, "ah-2026910027")).toMatchObject({ next: "202412", source: "bundle_notice", gapMonths: 8, flags: ["no_year"] });
    expect(planCompletionUpdates(rows, sch, [], NO_YEARS, [], NOW_YM, { minGap: 12 }).skipped).toEqual({ not_earlier: 1 });
    // 기본값(인자 없음) = 12 — 매일 --apply 가 1~11개월 행으로 차단기에 걸리지 않게(설계서 §8 결정 2)
    expect(planCompletionUpdates(rows, sch, [], NO_YEARS, [], NOW_YM).skipped).toEqual({ not_earlier: 1 });
  });
});

describe("planCompletionUpdates — 경계와 보호", () => {
  it("다른 건물: 묶음 안 active 열쇠(method ≠ bundle)가 2종이면 mixed_buildings", () => {
    const rows = [row("ah-1", "202501", { key: "K" }), row("ap-2", "202201", { key: "K" }), row("ap-3", "202301", { key: "K" })];
    const links = [link("ap-2", "11111-1", "name"), link("ap-3", "11111-2", "jibun+name")];
    const plan = planCompletionUpdates(rows, [notice("ap-2", "202201")], links, NO_YEARS, [], NOW_YM);
    expect(plan.skipped).toEqual({ mixed_buildings: 1 });
  });

  it("묶음 전파(method bundle) 줄은 다른 건물로 세지 않는다 — 열쇠 1종이면 반영", () => {
    const rows = [row("ah-1", "202501", { key: "K" }), row("ap-2", "202201", { key: "K" })];
    const links = [link("ap-2", "11111-1", "name"), link("ah-1", "11111-9", "bundle")];
    const plan = planCompletionUpdates(rows, [notice("ap-2", "202201")], links, NO_YEARS, [], NOW_YM);
    expect(upd(plan, "ah-1")).toMatchObject({ next: "202201", flags: ["no_year"] });
  });

  it("자기 공고 후보에는 다른 건물 보호를 걸지 않는다(그 행 자신의 공고)", () => {
    const rows = [row("ah-1", "202501", { key: "K", lot: 1 }), row("ap-2", "202201", { key: "K", lot: 2 })];
    const plan = planCompletionUpdates(rows, [notice("ah-1", "202301")], [], NO_YEARS, [], NOW_YM);
    expect(upd(plan, "ah-1")).toMatchObject({ next: "202301", source: "own_notice" });
  });

  it("미래 행이라도 건축년도가 후보 연도와 같으면 바꾼다", () => {
    const rows = [row("ah-1", "202907", { key: "K" }), row("ap-2", "202403", { key: "K" })];
    const links = [link("ah-1", "28237-5")];
    const plan = planCompletionUpdates(rows, [notice("ap-2", "202403")], links, new Map([["28237-5", 2024]]), [], NOW_YM);
    expect(upd(plan, "ah-1")).toMatchObject({ prev: "202907", next: "202403", buildYear: 2024, flags: [] });
  });

  it("이번 달과 같은 지금 값도 미래로 본다(아직 입주 전)", () => {
    const rows = [row("ah-1", NOW_YM), row("ah-1x", "202201")];
    const plan = planCompletionUpdates(rows, [notice("ah-1", "202301")], [], NO_YEARS, [], NOW_YM);
    expect(plan.skipped.future_unverified).toBe(1);
  });

  it("후보가 지금보다 늦거나 같으면 not_earlier, 차이가 정확히 minGap 이면 반영", () => {
    const rows = [row("ah-late", "202301"), row("ah-same", "202301"), row("ah-edge", "202301")];
    const sch = [notice("ah-late", "202305"), notice("ah-same", "202301"), notice("ah-edge", "202201")];
    const plan = planCompletionUpdates(rows, sch, [], NO_YEARS, [], NOW_YM);
    expect(plan.skipped).toEqual({ not_earlier: 2 });
    expect(upd(plan, "ah-edge")).toMatchObject({ next: "202201", gapMonths: 12 });
    expect(planCompletionUpdates(rows, sch, [], NO_YEARS, [], NOW_YM, { minGap: 13 }).updates).toEqual([]);
  });

  it("건축년도: 열쇠가 여럿이면 최빈값 · 동률이면 year_ambiguous · 동률 열쇠(null)만 있으면 year_ambiguous", () => {
    const rows = [row("ah-1", "202501"), row("ah-2", "202501"), row("ah-3", "202501")];
    const sch = [notice("ah-1", "202301"), notice("ah-2", "202301"), notice("ah-3", "202301")];
    const links = [link("ah-1", "a"), link("ah-1", "b"), link("ah-1", "c"), link("ah-2", "a"), link("ah-2", "d"), link("ah-3", "t")];
    const years = new Map([["a", 2023], ["b", 2023], ["c", 2024], ["d", 2024], ["t", null]]);
    const plan = planCompletionUpdates(rows, sch, links, years, [], NOW_YM);
    expect(upd(plan, "ah-1")).toMatchObject({ next: "202301", buildYear: 2023, flags: [] });
    expect(plan.skipped).toEqual({ year_ambiguous: 2 });
  });

  it("행 자신의 연결이 없으면 묶음 연결로 건축년도를 본다", () => {
    const rows = [row("ah-1", "202501", { key: "K" }), row("ap-2", "202301", { key: "K" })];
    const links = [link("ap-2", "z")];
    const plan = planCompletionUpdates(rows, [notice("ap-2", "202301")], links, new Map([["z", 2021]]), [], NOW_YM);
    expect(plan.skipped).toEqual({ year_mismatch: 1 });
  });

  it("사람 판정 keep 이면 제안하지 않는다(human_keep)", () => {
    const rows = [row("ah-1", "202501"), row("ah-2", "202501")];
    const sch = [notice("ah-1", "202301"), notice("ah-2", "202301")];
    const plan = planCompletionUpdates(rows, sch, [], NO_YEARS, [{ id: "ah-1", action: "keep" }], NOW_YM);
    expect(plan.updates.map((u) => u.id)).toEqual(["ah-2"]);
    expect(plan.skipped).toEqual({ human_keep: 1 });
    expect(plan.candidates).toBe(1);
  });

  it("ap-* 행은 보지 않고, 지금 값이 YYYYMM 이 아니면 not_ym", () => {
    const rows = [row("ap-1", "202501"), row("ah-1", null), row("ah-2", "2025-01"), row("ah-3", "202513")];
    const sch = [notice("ap-1", "202301"), notice("ah-1", "202301"), notice("ah-2", "202301"), notice("ah-3", "202301")];
    const plan = planCompletionUpdates(rows, sch, [], NO_YEARS, [], NOW_YM);
    expect(plan.updates).toEqual([]);
    expect(plan.rows).toBe(3);
    expect(plan.skipped).toEqual({ not_ym: 3 });
  });

  it("묶음 열쇠가 빈 행은 혼자다 — 다른 빈 열쇠 행의 공고를 받지 않는다(no_source)", () => {
    const rows = [row("ah-1", "202501"), row("ah-2", "202201", { key: "" })];
    const plan = planCompletionUpdates(rows, [notice("ah-2", "202101")], [], NO_YEARS, [], NOW_YM);
    expect(plan.skipped).toEqual({ no_source: 1 });
    expect(upd(plan, "ah-2")).toMatchObject({ next: "202101" });
  });

  it("YYYYMM 이 아닌 공고 예정월은 후보에서 뺀다", () => {
    const rows = [row("ah-1", "202501")];
    const plan = planCompletionUpdates(rows, [notice("ah-1", "2023"), notice("ah-1", "202399"), notice("ah-1", "202302")], [], NO_YEARS, [], NOW_YM);
    expect(upd(plan, "ah-1")?.next).toBe("202302");
  });

  it("자기 출력 위에서 다시 돌리면 고칠 것이 없다(2회차 0건)", () => {
    const rows = [row("ah-1", "202501", { key: "K" }), row("ap-2", "202301", { key: "K" }), row("ah-3", "202601")];
    const sch = [notice("ap-2", "202301"), notice("ah-3", "202401")];
    const first = planCompletionUpdates(rows, sch, [], NO_YEARS, [], NOW_YM);
    expect(first.changed).toBe(2);
    for (const u of first.updates) /** @type {any} */ (rows.find((r) => r.id === u.id)).completion = u.next;
    expect(planCompletionUpdates(rows, sch, [], NO_YEARS, [], NOW_YM).changed).toBe(0);
  });

  it("minGap 이 1 이상 정수가 아니면 던진다", () => {
    expect(() => planCompletionUpdates([], [], [], NO_YEARS, [], NOW_YM, { minGap: 0 })).toThrow(/minGap/);
    expect(() => planCompletionUpdates([], [], [], NO_YEARS, [], "2026-10")).toThrow(/nowYm/);
  });
});

describe("작은 도구", () => {
  it("neededAptSeqs — ah-* 행이 든 묶음의 연결만, 중복 없이", () => {
    const rows = [row("ah-1", "202501", { key: "K" }), row("ap-2", "202301", { key: "K" }), row("ap-3", "202301", { key: "L" })];
    const links = [link("ap-2", "x"), link("ah-1", "x", "bundle"), link("ap-3", "y")];
    expect(neededAptSeqs(rows, links)).toEqual(["x"]);
  });

  it("kstYm — UTC 로는 전달인 시각도 KST 달로", () => {
    expect(kstYm(new Date("2026-09-30T15:30:00Z"))).toBe("202610");
    expect(kstYm(new Date("2026-09-30T14:59:00Z"))).toBe("202609");
  });

  it("modeOf · isYm", () => {
    expect(modeOf([2023, 2024, 2023])).toEqual({ value: 2023, tie: false });
    expect(modeOf([2023, 2024])).toEqual({ value: null, tie: true });
    expect(modeOf([])).toEqual({ value: null, tie: false });
    expect([isYm("202512"), isYm("202513"), isYm("2025-12"), isYm(202512)]).toEqual([true, false, false, false]);
  });
});

describe("parseCompletionDecisions — 사람 판정 파일", () => {
  it("꼴이 맞으면 keep 줄을 돌려준다", () => {
    const r = parseCompletionDecisions({ note: "n", updatedAt: "2026-10-11", decisions: [{ id: "ah-1", action: "keep", names: "가", why: "왜", approved: "2026-10-11" }] });
    expect(r.decisions).toEqual([{ id: "ah-1", action: "keep" }]);
  });

  it("id 가 두 번 나오면 던진다", () => {
    expect(() => parseCompletionDecisions({ decisions: [{ id: "ah-1", action: "keep" }, { id: "ah-1", action: "keep" }] })).toThrow(/두 번/);
  });

  it.each(["drop", "KEEP", null])("action 은 keep 만 — %s 이면 던진다", (action) => {
    expect(() => parseCompletionDecisions({ decisions: [{ id: "ah-1", action }] })).toThrow(/keep/);
  });

  it("decisions 배열이 없거나 id 가 비면 던진다", () => {
    expect(() => parseCompletionDecisions({})).toThrow();
    expect(() => parseCompletionDecisions([])).toThrow();
    expect(() => parseCompletionDecisions({ decisions: [{ action: "keep" }] })).toThrow(/id/);
  });

  it("운영 파일(docs/audits/completion-decisions.json)이 이 검사를 통과한다", () => {
    const raw = JSON.parse(readFileSync(DECISIONS_PATH, "utf8"));
    expect(Array.isArray(parseCompletionDecisions(raw).decisions)).toBe(true);
    expect(DECISIONS_PATH.replace(/\\/g, "/")).toMatch(/docs\/audits\/completion-decisions\.json$/);
  });
});

describe("evaluateChangeBreaker · 상수", () => {
  it(`바뀌는 행 ${CHANGE_BREAKER_MAX_ROWS} 이하는 통과, 11 은 막는다`, () => {
    expect(evaluateChangeBreaker({ changed: 10, candidates: 1385 }).tripped).toBe(false);
    const r = evaluateChangeBreaker({ changed: 11, candidates: 1385 });
    expect(r.tripped).toBe(true);
    expect(r.reason).toContain("11/1385");
  });

  it("비율이 10% 를 넘으면 막는다(작은 표)", () => {
    expect(evaluateChangeBreaker({ changed: 2, candidates: 20 }).tripped).toBe(false);
    expect(evaluateChangeBreaker({ changed: 3, candidates: 20 }).tripped).toBe(true);
    expect(evaluateChangeBreaker({ changed: 0, candidates: 0 }).tripped).toBe(false);
  });

  it("약속한 숫자 그대로(상수에서 읽어 맞대면 상수를 바꿔도 초록)", () => {
    expect(MIN_GAP_MONTHS).toBe(12);
    expect(CHANGE_BREAKER_MAX_ROWS).toBe(10);
    expect(CHANGE_BREAKER_RATIO).toBe(0.1);
    expect(UPDATE_CONCURRENCY).toBe(5);
    expect(UPDATE_BATCH_DELAY_MS).toBe(100);
    expect(BUILD_YEAR_SAMPLE).toBe(5);
  });
});

describe("parseArgs — 실행 인자", () => {
  it("기본은 미리보기 · minGap 12", () => {
    expect(parseArgs(["n", "s"])).toEqual({ apply: false, applyFrom: null, out: null, minGap: 12 });
  });

  it("--min-gap=12 · --min-gap=1", () => {
    expect(parseArgs(["n", "s", "--min-gap=12"]).minGap).toBe(12);
    expect(parseArgs(["n", "s", "--min-gap=1", "--apply-from=F:/p.json"])).toEqual({ apply: true, applyFrom: "F:/p.json", out: null, minGap: 1 });
  });

  it.each(["--min-gap=0", "--min-gap=abc", "--min-gap=", "--min-gap", "--min-gap=-1", "--min-gap=1.5", "--min-gap=012"])("%s → 던진다", (a) => {
    expect(() => parseArgs(["n", "s", a])).toThrow(/--min-gap/);
  });

  it("--min-gap 두 번 → 던진다", () => {
    expect(() => parseArgs(["n", "s", "--min-gap=1", "--min-gap=12"])).toThrow(/두 번/);
  });

  it.each(["--dry-run", "--force", "--APPLY", "plan.json", "--apply=1", "--expect-changed=3"])("모르는 인자는 받지 않는다 — %s", (a) => {
    expect(() => parseArgs(["n", "s", a])).toThrow(/모르는 인자/);
  });

  it("--apply-from·--apply 는 --out 과 같이 못 준다 · 경로가 비면 던진다", () => {
    expect(() => parseArgs(["n", "s", "--apply-from=F:/a.json", "--out=F:/b.json"])).toThrow(/같이 줄 수 없습니다/);
    expect(() => parseArgs(["n", "s", "--apply", "--out=F:/b.json"])).toThrow(/같이 줄 수 없습니다/);
    expect(() => parseArgs(["n", "s", "--apply-from="])).toThrow();
    expect(() => parseArgs(["n", "s", "--out"])).toThrow();
  });
});

/**
 * trade_deals 쿼리 흉내 — 열쇠별로 돌려줄 줄을 정하고, 호출을 센다.
 * @param {Record<string, Array<{ build_year: number }>>} byKey
 * @param {{ errorKey?: string }} [o]
 */
function fakeDealsSb(byKey, o = {}) {
  /** @type {Array<{ table: string, ops: Array<[string, unknown[]]> }>} */
  const calls = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const sb = {
    from(/** @type {string} */ table) {
      /** @type {Array<[string, unknown[]]>} */
      const ops = [];
      calls.push({ table, ops });
      /** @type {any} */
      const b = {
        select: (/** @type {unknown[]} */ ...a) => (ops.push(["select", a]), b),
        eq: (/** @type {unknown[]} */ ...a) => (ops.push(["eq", a]), b),
        not: (/** @type {unknown[]} */ ...a) => (ops.push(["not", a]), b),
        limit: (/** @type {unknown[]} */ ...a) => (ops.push(["limit", a]), b),
        then: (/** @type {(v: any) => void} */ res) => {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          const key = String(ops.find((x) => x[0] === "eq")?.[1][1]);
          setTimeout(() => {
            inFlight--;
            res(key === o.errorKey ? { data: null, error: { message: "boom" } } : { data: byKey[key] ?? [], error: null });
          }, 1);
        },
      };
      return b;
    },
  };
  return { sb, calls, maxInFlight: () => maxInFlight };
}

describe("fetchBuildYears — 열쇠마다 한 번씩", () => {
  it("열쇠 3개 → 호출 3회 · 조건 = apt_seq 같음 + build_year 있음 + limit 5", async () => {
    const { sb, calls } = fakeDealsSb({ k1: [{ build_year: 2020 }], k2: [{ build_year: 2021 }, { build_year: 2021 }, { build_year: 2019 }] });
    const m = await fetchBuildYears(sb, ["k1", "k2", "k3"]);
    expect(calls).toHaveLength(3);
    for (const [i, c] of calls.entries()) {
      expect(c.table).toBe("trade_deals");
      expect(c.ops).toEqual([["select", ["apt_seq,build_year"]], ["eq", ["apt_seq", `k${i + 1}`]], ["not", ["build_year", "is", null]], ["limit", [5]]]);
    }
    expect([...m]).toEqual([["k1", 2020], ["k2", 2021]]); // k3 = 자료 없음 → 빠짐
  });

  it("값이 동률이면 null · 동시 호출은 5개까지", async () => {
    const keys = ["a", "b", "c", "d", "e", "f", "g"];
    const { sb, calls, maxInFlight } = fakeDealsSb({ a: [{ build_year: 2020 }, { build_year: 2021 }] });
    const m = await fetchBuildYears(sb, keys);
    expect(m.get("a")).toBeNull();
    expect(calls).toHaveLength(7);
    expect(maxInFlight()).toBe(5);
  });

  it("조회 오류는 던진다(연도를 모르는 채로 no_year 로 지나가지 않게) · 중단 신호도 던진다", async () => {
    await expect(fetchBuildYears(fakeDealsSb({}, { errorKey: "b" }).sb, ["a", "b"])).rejects.toThrow(/건축년도 조회 실패\(b\)/);
    await expect(fetchBuildYears(fakeDealsSb({}).sb, ["a"], { interrupted: () => true })).rejects.toThrow(/중단/);
  });
});

// ── main 흐름 — 가짜 DB 로 돌린다(쓰기·기록·순서) ─────────────────────────────
/**
 * @param {{ apartments: any[], schedules?: any[], links?: any[], countDelta?: number, zeroIds?: string[], onUpdate?: (n: number) => void, decisions?: any[] }} o
 */
function makeEnv(o) {
  const db = { apartments: o.apartments, presale_schedule_official: o.schedules ?? [], apartment_trade_links: o.links ?? [] };
  /** @type {Array<{ id: unknown, completion: unknown, eqs: unknown[] }>} */
  const writes = [];
  let updateCount = 0;
  /** @param {string} table */
  const builder = (table) => {
    /** @type {{ table: string, head: boolean, update: any, eqs: Array<[string, unknown]> }} */
    const st = { table, head: false, update: null, eqs: [] };
    /** @type {any} */
    const b = {
      _st: st,
      select: (/** @type {string} */ _c, /** @type {any} */ opt) => { st.head = !!opt?.head; return b; },
      update: (/** @type {any} */ v) => { st.update = v; return b; },
      eq: (/** @type {string} */ c, /** @type {unknown} */ v) => { st.eqs.push([c, v]); return b; },
      then: (/** @type {(v: any) => void} */ res) => {
        /** @type {any[]} */
        const rows = /** @type {any} */ (db)[table].filter((/** @type {any} */ r) => st.eqs.every(([c, v]) => r[c] === v));
        if (st.head) return res({ count: rows.length + (table === "apartments" ? (o.countDelta ?? 0) : 0), error: null });
        if (st.update) {
          updateCount++;
          o.onUpdate?.(updateCount);
          writes.push({ id: st.eqs.find(([c]) => c === "id")?.[1], completion: st.update.completion, eqs: st.eqs.map(([c]) => c) });
          const hit = rows.filter((r) => !(o.zeroIds ?? []).includes(r.id));
          for (const r of hit) r.completion = st.update.completion;
          return res({ data: hit.map((r) => ({ id: r.id })), error: null });
        }
        return res({ data: rows, error: null });
      },
    };
    return b;
  };
  const sb = { from: builder };
  /** @type {string[]} */
  const selectAllKeyCols = [];
  const files = /** @type {Record<string, string>} */ ({ [DECISIONS_PATH]: JSON.stringify({ note: "t", updatedAt: "t", decisions: o.decisions ?? [] }) });
  const deps = {
    getSupabase: vi.fn(() => sb),
    selectAll: async (/** @type {(s: any) => any} */ fn, /** @type {any} */ s, /** @type {string} */ keyCol) => {
      selectAllKeyCols.push(keyCol);
      const b = fn(s);
      const st = b._st;
      return /** @type {any} */ (db)[st.table].filter((/** @type {any} */ r) => st.eqs.every((/** @type {[string, unknown]} */ [c, v]) => r[c] === v)).map((/** @type {any} */ r) => ({ ...r }));
    },
    recordCollectorRun: vi.fn(async () => {}),
    fetchBuildYears: vi.fn(async () => new Map()),
    now: () => new Date("2026-10-10T00:00:00Z"),
    readFileSync: (/** @type {string} */ p) => {
      if (!(p in files)) throw new Error(`없는 파일 ${p}`);
      return files[p];
    },
  };
  return { deps: /** @type {any} */ (deps), db, writes, files, selectAllKeyCols };
}

/**
 * 과거 행 n 개(각자 묶음, 자기 공고 202001 · 지금 202201 → 24개월 이르다) + 그대로 둘 행 k 개
 * @param {number} n
 * @param {number} [k]
 */
function scenario(n, k = 0) {
  /** @type {any[]} */
  const apartments = [];
  /** @type {any[]} */
  const schedules = [];
  for (let i = 0; i < n; i++) {
    apartments.push({ id: `ah-c${i}`, name: `바꿀${i}`, region: "경기", gu: "화성시", units: 10, completion: "202201", complex_key: null, lot_main: null, presale_type: null });
    schedules.push({ id: i + 1, apartment_id: `ah-c${i}`, house_manage_no: `h${i}`, move_in_ym: "202001" });
  }
  for (let i = 0; i < k; i++) {
    apartments.push({ id: `ah-s${i}`, name: `둘${i}`, region: "경기", gu: "화성시", units: 10, completion: "202001", complex_key: null, lot_main: null, presale_type: null });
    schedules.push({ id: 1000 + i, apartment_id: `ah-s${i}`, house_manage_no: `s${i}`, move_in_ym: "202001" });
  }
  return { apartments, schedules };
}

const recorded = (/** @type {any} */ deps) => deps.recordCollectorRun.mock.calls.map((/** @type {any[]} */ c) => c[1]);

describe("main 흐름 — 가짜 DB", () => {
  afterEach(() => {
    process.exitCode = undefined;
  });

  it("미리보기(인자 없음)는 쓰기 0 · 기록 0 · 세 표 모두 id 커서로 읽는다", async () => {
    const env = makeEnv(scenario(3));
    await main(env.deps, ["n", "s"]);
    expect(env.writes).toEqual([]);
    expect(env.deps.recordCollectorRun).not.toHaveBeenCalled();
    expect(env.selectAllKeyCols).toEqual(["id", "id", "id"]);
    expect(process.exitCode).toBeUndefined();
  });

  it("--out 은 새 파일로만 — 계획 파일을 쓰고, 같은 경로로 다시 주면 DB 를 보기 전에 던진다", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cmp-"));
    try {
      const out = join(dir, "plan.json");
      const env = makeEnv(scenario(2));
      await main(env.deps, ["n", "s", `--out=${out}`]);
      const plan = JSON.parse(readFileSync(out, "utf8"));
      expect(plan).toMatchObject({ rows: 2, candidates: 2, minGap: 12, changed: 2, skipped: {} });
      expect(plan.updates[0]).toMatchObject({ id: "ah-c0", prev: "202201", next: "202001", source: "own_notice", houseManageNo: "h0", name: "바꿀0", region: "경기", gu: "화성시", units: 10, lotMain: null, bundleLots: [] });
      const env2 = makeEnv(scenario(2));
      await expect(main(env2.deps, ["n", "s", `--out=${out}`])).rejects.toThrow(/이미 있습니다/);
      expect(env2.deps.getSupabase).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--apply-from 이 지금 계획과 같으면 쓴다 — 조건 = id 같음 + 이전 값 같음 · 성공 기록 1행", async () => {
    const env = makeEnv(scenario(12));
    const plan = planCompletionUpdates(env.db.apartments, env.db.presale_schedule_official, [], new Map(), [], "202610");
    env.files["F:/approved.json"] = JSON.stringify({ minGap: 12, updates: plan.updates });
    await main(env.deps, ["n", "s", "--apply-from=F:/approved.json"]);
    expect(env.writes).toHaveLength(12); // 차단기(10행) 위여도 승인 파일이면 쓴다
    expect(env.writes[0]).toEqual({ id: "ah-c0", completion: "202001", eqs: ["id", "completion"] });
    expect(env.db.apartments.every((r) => r.completion === "202001")).toBe(true);
    const rec = recorded(env.deps);
    expect(rec).toHaveLength(1);
    expect(rec[0]).toMatchObject({ status: "success", ok: 12, fail: 0, errorMessage: null });
  });

  it("--apply-from 파일에만 있는 줄 1 → CMP_PLAN_MISMATCH 기록 · 쓰기 0", async () => {
    const env = makeEnv(scenario(2));
    const plan = planCompletionUpdates(env.db.apartments, env.db.presale_schedule_official, [], new Map(), [], "202610");
    env.files["F:/approved.json"] = JSON.stringify({ minGap: 12, updates: [...plan.updates, { id: "ah-zz", prev: "202501", next: "202301" }] });
    await main(env.deps, ["n", "s", "--apply-from=F:/approved.json"]);
    expect(env.writes).toEqual([]);
    const rec = recorded(env.deps);
    expect(rec).toHaveLength(1);
    expect(rec[0].status).toBe("failure");
    expect(rec[0].errorMessage).toMatch(/^CMP_PLAN_MISMATCH /);
    expect(process.exitCode).toBe(1);
  });

  it("--apply-from 파일의 minGap 이 이번 실행과 다르면 DB 를 보기 전에 던진다", async () => {
    const env = makeEnv(scenario(2));
    env.files["F:/approved.json"] = JSON.stringify({ minGap: 1, updates: [] });
    await expect(main(env.deps, ["n", "s", "--apply-from=F:/approved.json"])).rejects.toThrow(/minGap/);
    expect(env.deps.getSupabase).not.toHaveBeenCalled();
  });

  it("매일 --apply 가 11행이면 CMP_BREAKER 기록 · 아무것도 안 쓴다", async () => {
    const env = makeEnv(scenario(11, 100));
    await main(env.deps, ["n", "s", "--apply"]);
    expect(env.writes).toEqual([]);
    const rec = recorded(env.deps);
    expect(rec).toHaveLength(1);
    expect(rec[0].errorMessage).toMatch(/^CMP_BREAKER 차단기 발동: 준공월이 바뀌는 행 11\/111/);
  });

  it("매일 --apply 가 한도 안(10행 · 10% 이하)이면 쓴다", async () => {
    const env = makeEnv(scenario(10, 100));
    await main(env.deps, ["n", "s", "--apply"]);
    expect(env.writes).toHaveLength(10);
    expect(recorded(env.deps)[0]).toMatchObject({ status: "success", ok: 10, skip: 100 });
  });

  it("조건부 UPDATE 가 0행을 돌려주면(그 사이 값이 바뀜) 실패로 센다 — CMP_WRITE · 종료 코드 1", async () => {
    const env = makeEnv({ ...scenario(3, 30), zeroIds: ["ah-c1"] });
    await main(env.deps, ["n", "s", "--apply"]);
    expect(env.writes).toHaveLength(3);
    const rec = recorded(env.deps)[0];
    expect(rec).toMatchObject({ status: "failure", ok: 2, fail: 1, errorMessage: "CMP_WRITE 1행 실패(0행 반환 포함)" });
    expect(process.exitCode).toBe(1);
  });

  it("쓰는 도중 SIGTERM → 그 묶음까지만 쓰고 멈춘다 · partial 기록", async () => {
    const env = makeEnv({ ...scenario(7), onUpdate: (n) => { if (n === 1) process.emit("SIGTERM"); } });
    const plan = planCompletionUpdates(env.db.apartments, env.db.presale_schedule_official, [], new Map(), [], "202610");
    env.files["F:/approved.json"] = JSON.stringify({ minGap: 12, updates: plan.updates });
    await main(env.deps, ["n", "s", "--apply-from=F:/approved.json"]);
    expect(env.writes).toHaveLength(UPDATE_CONCURRENCY);
    expect(recorded(env.deps)[0]).toMatchObject({ status: "partial", ok: 5 });
  });

  it("받은 행 수 ≠ 표의 행 수 → CMP_COUNT_MISMATCH 기록 · 건축년도 조회도 쓰기도 안 함", async () => {
    const env = makeEnv({ ...scenario(2), countDelta: 1 });
    await main(env.deps, ["n", "s", "--apply"]);
    expect(env.writes).toEqual([]);
    expect(env.deps.fetchBuildYears).not.toHaveBeenCalled();
    expect(recorded(env.deps)[0].errorMessage).toMatch(/^CMP_COUNT_MISMATCH apartments 받은 행 2 ≠ 표의 행 수 3/);
  });

  it("사람 판정 파일의 keep 행은 쓰지 않는다", async () => {
    const env = makeEnv({ ...scenario(2, 30), decisions: [{ id: "ah-c0", action: "keep" }] });
    await main(env.deps, ["n", "s", "--apply"]);
    expect(env.writes.map((w) => w.id)).toEqual(["ah-c1"]);
  });

  it("건축년도는 ah-* 묶음의 active 연결 열쇠로만 조회하고, 그 결과로 판정한다", async () => {
    const s = scenario(2, 30);
    const links = [
      { id: 1, apartment_id: "ah-c0", link_key: "41111-1", method: "name", link_kind: "apt_seq", status: "active" },
      { id: 2, apartment_id: "ah-c1", link_key: "41111-2", method: "name", link_kind: "apt_seq", status: "hold" },
      { id: 3, apartment_id: "ap-x", link_key: "41111-3", method: "name", link_kind: "apt_seq", status: "active" },
    ];
    const env = makeEnv({ ...s, links });
    env.deps.fetchBuildYears = vi.fn(async () => new Map([["41111-1", 2019]]));
    await main(env.deps, ["n", "s", "--apply"]);
    expect(env.deps.fetchBuildYears.mock.calls[0][1]).toEqual(["41111-1"]);
    expect(env.writes.map((w) => w.id)).toEqual(["ah-c1"]); // ah-c0 은 2019 ≠ 2020 → year_mismatch
  });
});

/** @param {string} s */
const stripComments = (s) =>
  s
    .replace(/\r\n/g, "\n")
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, "")
    .replace(/(?<!\*)\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
    .join("\n");

describe("정적 가드 — 이름·CLI 꼬리", () => {
  const src = stripComments(readFileSync(join(HERE, "assign-completion.mjs"), "utf8"));

  it("기록 이름(PHASE)은 'assign-completion' 그대로다 — 감시 ⑭ 가 이 이름으로 성공 기록을 찾는다", () => {
    expect(src.split("\n").filter((l) => l === 'const PHASE = "assign-completion";')).toHaveLength(1);
  });

  it("예외로 죽은 쓰기 실행도 CMP_ERROR 로 기록하고 종료 코드를 1 로 둔다(process.exit 없음)", () => {
    expect(src).toContain(
      [
        '    const wantedWrite = process.argv.some((a) => a === "--apply" || a.startsWith("--apply-from"));',
        '    if (wantedWrite) await recordCollectorRun(PHASE, { status: "failure", ok: 0, fail: 1, skip: 0, errorMessage: `CMP_ERROR ${msg}` });',
        "    process.exitCode = 1;",
      ].join("\n"),
    );
    expect(src).not.toMatch(/process\.exit\(/);
  });

  it("쓰는 칸은 completion 하나뿐이고, 이전 값 조건이 붙는다", () => {
    expect(src.match(/\.update\(\{[^}]*\}\)/g)).toEqual([".update({ completion: u.next })"]);
    expect(src).toContain('.update({ completion: u.next }).eq("id", u.id).eq("completion", u.prev).select("id")');
  });

  it("계획 파일은 새 파일로만(flag wx)", () => {
    expect(src).toContain(' + "\\n", { flag: "wx" });');
  });
});
