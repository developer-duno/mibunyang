// @ts-check
/**
 * 세션696 반B 감시 묶음 — ㉕ 기준일 상수 만료 예고(B6) · ⑥-c 시세 범위 빈칸(B8) · 소유권 정본 infra 칸(B7 e) · ⑬ 조치 문구(B7 g).
 * ⚠️ 날짜는 전부 밖에서 넣는다 — 실제 오늘에 기대면 12/17 부터 CI 가 빨개진다(BACKLOG 365 원문 처방).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  checkRuleExpiry,
  readStressLocalUntil,
  runRuleExpiryCheck,
  RULE_EXPIRY_WARN_DAYS,
  checkTradeRangeGap,
  fetchTradeRangeGapCount,
  checkLocalFailures,
  loadOwnershipRegistry,
} from "./monitor-collectors.mjs";
import { formatIssue } from "./notify-telegram.mjs";
import { INFRA_KAKAO_COLUMNS } from "./fix-placeholder-addresses.mjs";
import { STRESS_RATE_LOCAL_UNTIL } from "@/constants/loanRules";

const SRC = readFileSync(fileURLToPath(new URL("./monitor-collectors.mjs", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
/** KST 날짜·시각 → Date. @param {string} kst "YYYY-MM-DDTHH:MM" */
const atKst = (kst) => new Date(`${kst}:00+09:00`);

describe("㉕ 기준일 상수 만료 예고 — checkRuleExpiry(세션696 B6)", () => {
  it("문턱은 14일(리터럴 — BACKLOG 365 「만료 14일 전」)", () => {
    expect(RULE_EXPIRY_WARN_DAYS).toBe(14);
  });
  it("마지막 날 2026-12-31: 12/16 조용 · 12/17(14일 남음) 알림 · 12/31(0일) 알림", () => {
    expect(checkRuleExpiry("2026-12-31", atKst("2026-12-16T09:00"))).toEqual([]);
    const d17 = checkRuleExpiry("2026-12-31", atKst("2026-12-17T09:00"));
    expect(d17.map((i) => i.detail)).toEqual(["STRESS_RATE_LOCAL_UNTIL(2026-12-31)까지 14일 남음 — 지방 스트레스 가산 0.75%p 유예가 끝납니다"]);
    expect(d17[0].kind).toBe("rule-expiry");
    expect(d17[0].at).toBe("until:2026-12-31");
    expect(checkRuleExpiry("2026-12-31", atKst("2026-12-31T09:00"))[0].detail).toContain("0일 남음");
  });
  it("오늘은 KST 날짜로 센다 — 12/16 23:30 KST 조용 · 12/17 00:30 KST 알림(UTC 로는 둘 다 12/16)", () => {
    expect(checkRuleExpiry("2026-12-31", atKst("2026-12-16T23:30"))).toEqual([]);
    expect(checkRuleExpiry("2026-12-31", atKst("2026-12-17T00:30"))).toHaveLength(1);
  });
  it("지난 뒤에도 상수가 그대로면 매일 알림(지난 날 수) — 같은 상수면 같은 열쇠", () => {
    const is = checkRuleExpiry("2026-12-31", atKst("2027-01-05T09:00"));
    expect(is[0].detail).toBe("STRESS_RATE_LOCAL_UNTIL(2026-12-31)가 5일 지났는데 상수가 그대로 — 잔금 계산기가 끝난 규칙으로 계산 중");
    expect(is[0].at).toBe("until:2026-12-31");
  });
  it("꼴이 틀리거나 없는 날짜면 던진다(침묵하지 않음)", () => {
    expect(() => checkRuleExpiry("2026-02-30", atKst("2026-01-01T09:00"))).toThrow(/없는 날짜/);
    expect(() => checkRuleExpiry("20261231", atKst("2026-01-01T09:00"))).toThrow(/YYYY-MM-DD/);
  });
  it("readStressLocalUntil — import 없이 글자로 읽은 값 = 실제 상수(한쪽만 바뀌면 빨강) · CRLF 도 읽고 줄이 없으면 던진다", () => {
    expect(readStressLocalUntil()).toBe(STRESS_RATE_LOCAL_UNTIL);
    expect(readStressLocalUntil('/** x */\r\nexport const STRESS_RATE_LOCAL_UNTIL = "2027-06-30";\r\nexport const Y = 1;\r\n')).toBe("2027-06-30");
    expect(() => readStressLocalUntil('export const STRESS_RATE_LOCAL_END = "2027-06-30";')).toThrow(/STRESS_RATE_LOCAL_UNTIL/);
  });
  it("감시는 loanRules.ts 를 import 하지 않는다(alias-loader 없는 node 로 돌아 TS·확장자 없는 import 에서 감시 전체가 죽는다)", () => {
    expect(SRC).not.toMatch(/^import[^\n]*loanRules/m);
    expect(SRC).not.toMatch(/import\([^)]*loanRules/);
  });
  it("runRuleExpiryCheck — 주입한 날짜로 판정 · 읽기 실패는 실행 실패 1건", async () => {
    expect(await runRuleExpiryCheck({ now: atKst("2026-12-16T09:00"), readUntil: () => "2026-12-31" })).toEqual([]);
    expect((await runRuleExpiryCheck({ now: atKst("2026-12-20T09:00"), readUntil: () => "2026-12-31" })).map((i) => i.kind)).toEqual(["rule-expiry"]);
    const bad = await runRuleExpiryCheck({ now: atKst("2026-12-20T09:00"), readUntil: () => { throw new Error("줄 없음"); } });
    expect(bad.map((i) => i.detail)).toEqual(["㉕ 기준일 상수 만료 예고 실행 실패 — 줄 없음"]);
  });
  it("배선 — main 이 매일 ㉕ 를 부른다(runDailyGuardedChecks 밖 · 주석 줄 아님)", () => {
    const mainAt = SRC.indexOf("async function main() {");
    const call = SRC.match(/^ {4}issues = issues\.concat\(await runRuleExpiryCheck\(\)\);$/m);
    expect(mainAt).toBeGreaterThan(0);
    expect(call?.index ?? -1).toBeGreaterThan(mainAt);
  });
  it("텔레그램 문구 — 제목·조치가 있고 undefined 가 없다", () => {
    const text = formatIssue(checkRuleExpiry("2026-12-31", atKst("2026-12-20T09:00"))[0]);
    expect(text).toContain("<b>기준일 상수 만료 임박</b>");
    expect(text).toContain("[조치]");
    expect(text).not.toContain("undefined");
  });
});

describe("⑥-c 시세 범위 빈칸 — 적정가 있음 + 최저가 빈칸 = 0(세션696 B8 · BACKLOG 382)", () => {
  it("0 이면 침묵 · 1 이상이면 1건(nulls)", () => {
    expect(checkTradeRangeGap(0)).toEqual([]);
    const is = checkTradeRangeGap(1);
    expect(is.map((i) => i.detail)).toEqual(["trade_stats 적정가(cmp_fair_price)는 있는데 최저가(cmp_min)가 빈 행 1개 — 범위 계산 회귀 의심(기대 0)"]);
    expect(is[0].kind).toBe("nulls");
    expect(formatIssue(is[0])).not.toContain("undefined");
  });
  it("fetchTradeRangeGapCount — trade_stats 에서 cmp_fair_price 있음 · cmp_min NULL 을 head 로 센다 · 오류·count null 은 던진다", async () => {
    /** @type {any[]} */ const calls = [];
    /** @param {any} resp */
    const fake = (resp) => ({
      from: (/** @type {string} */ t) => {
        /** @type {any} */ const q = { t, ops: [] };
        /** @type {any} */ const api = {
          select: (/** @type {string} */ c, /** @type {any} */ o) => { q.ops.push(`select:${c}:${o?.head === true}:${o?.count}`); return api; },
          not: (/** @type {string} */ c, /** @type {string} */ op, /** @type {any} */ v) => { q.ops.push(`not:${c}:${op}:${v}`); return api; },
          is: (/** @type {string} */ c, /** @type {any} */ v) => { q.ops.push(`is:${c}:${v}`); return api; },
          then: (/** @type {any} */ ok, /** @type {any} */ bad) => { calls.push(q); return Promise.resolve(resp).then(ok, bad); },
        };
        return api;
      },
    });
    expect(await fetchTradeRangeGapCount(fake({ count: 0, error: null }))).toBe(0);
    expect(calls).toEqual([{ t: "trade_stats", ops: ["select:*:true:exact", "not:cmp_fair_price:is:null", "is:cmp_min:null"] }]);
    await expect(fetchTradeRangeGapCount(fake({ count: null, error: { message: "boom" } }))).rejects.toThrow(/boom/);
    await expect(fetchTradeRangeGapCount(fake({ count: null, error: null }))).rejects.toThrow(/count=null/);
  });
  it("배선 — main 의 ⑥-c 블록이 조회 결과를 판정에 넘긴다(fail-open)", () => {
    expect(SRC).toMatch(/runFailOpenCheck\("⑥-c 시세 범위 빈칸 점검", async \(\) => \{\n\s+const gap = await fetchTradeRangeGapCount\(\);\n\s+const rangeIssues = checkTradeRangeGap\(gap\);/);
  });
});

describe("세션696 B7 — 소유권 정본 infra 칸 · ⑬ 조치 문구", () => {
  it("(e) fix-placeholder·fix-sosa 의 infra 쓰는 칸 = INFRA_KAKAO_COLUMNS 를 다 담는다(상수 기반이라 감사가 못 보는 자리 · 두 곳 같음)", () => {
    const reg = /** @type {any} */ (loadOwnershipRegistry());
    const ph = reg.writers.mibunyang["scripts/fix-placeholder-addresses.mjs"].infra;
    const sosa = reg.writers.mibunyang["scripts/fix-sosa-coordinates.mjs"].infra;
    for (const c of INFRA_KAKAO_COLUMNS) {
      expect(ph).toContain(c);
      expect(sosa).toContain(c);
    }
    expect([...ph].sort()).toEqual([...sosa].sort());
  });
  it("(g) ⑬ 조치 줄 — Actions 수집기(infra)에도 맞게 워크플로 로그를 가리킨다", () => {
    const now = new Date("2026-11-04T00:00:00Z");
    const is = checkLocalFailures([{ collector: "infra", status: "failure", ok_count: 0, fail_count: 3, error_message: "x", finished_at: "2026-11-03T20:00:00Z" }], { now });
    const act = (is[0].lines ?? []).find((l) => l.startsWith("[조치]")) ?? "";
    expect(act).toContain("collect-infra.yml");
    expect(act).toContain("kosis-local.log"); // 로컬 러너 안내도 그대로
  });
});
