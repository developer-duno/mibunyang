// @ts-check
/**
 * `assign-trade-links.mjs` 시험 — 인자 허용 목록 · 표 없음 처리 · 거래 창 시작 달.
 * 계산 규칙은 `_trade-links.test.mjs` 가 본다(CLI 는 재료를 읽어 넘기고 쓰기만).
 */
import { describe, it, expect } from "vitest";
import { parseArgs, onMissingTable, fromMonthOf, assertOutFree, applyLinkPlan, CONTROL_PROBES, LINK_WINDOW_MONTHS } from "./assign-trade-links.mjs";

const argv = (/** @type {string[]} */ ...a) => ["node", "assign-trade-links.mjs", ...a];

describe("parseArgs — 아는 인자만", () => {
  it("인자 없음 = 미리보기", () => {
    expect(parseArgs(argv())).toEqual({ apply: false, applyFrom: null, out: null });
  });
  it("--apply · --apply-from · --out", () => {
    expect(parseArgs(argv("--apply"))).toEqual({ apply: true, applyFrom: null, out: null });
    expect(parseArgs(argv("--apply-from=C:/x/plan.json"))).toEqual({ apply: true, applyFrom: "C:/x/plan.json", out: null });
    expect(parseArgs(argv("--out=C:/x/new.json"))).toEqual({ apply: false, applyFrom: null, out: "C:/x/new.json" });
  });
  it("--dry-run 을 포함한 모르는 인자는 던진다(기록이 빠지는 사고 — 세션588)", () => {
    expect(() => parseArgs(argv("--dry-run"))).toThrow(/모르는 인자/);
    expect(() => parseArgs(argv("--force"))).toThrow(/모르는 인자/);
  });
  it("--out 은 미리보기에서만 — --apply·--apply-from 과 함께면 던진다", () => {
    expect(() => parseArgs(argv("--apply", "--out=C:/x/a.json"))).toThrow(/--out/);
    expect(() => parseArgs(argv("--apply-from=C:/x/p.json", "--out=C:/x/a.json"))).toThrow(/--out/);
  });
  it("값 없는 --out·--apply-from, 두 번 나온 인자, --apply 와 --apply-from 동시는 던진다", () => {
    expect(() => parseArgs(argv("--out"))).toThrow(/경로/);
    expect(() => parseArgs(argv("--apply-from"))).toThrow(/경로/);
    expect(() => parseArgs(argv("--out=a", "--out=b"))).toThrow(/두 번/);
    expect(() => parseArgs(argv("--apply", "--apply-from=C:/x/p.json"))).toThrow(/같이/);
  });
});

describe("--out 파일이 이미 있으면 던진다", () => {
  it("있는 파일 → 던짐 · 없는 파일·인자 없음 → 통과", () => {
    expect(() => assertOutFree("C:/x/plan.json", () => true)).toThrow(/이미 있습니다/);
    expect(() => assertOutFree("C:/x/plan.json", () => false)).not.toThrow();
    expect(() => assertOutFree(null, () => true)).not.toThrow();
  });
});

describe("표 없음(마이그 전)", () => {
  it("쓰기 실행이면 LINK_NO_TABLE 로 멈추고, 미리보기는 '지금 연결 0' 으로 진행", () => {
    expect(onMissingTable(true)).toEqual({ proceed: false, marker: "LINK_NO_TABLE" });
    expect(onMissingTable(false)).toEqual({ proceed: true, marker: null });
  });
});

describe("거래 창 시작 달(KST)", () => {
  it("2026-10-03 → 12개월 전 202510 · 해 경계 · KST 자정 경계", () => {
    expect(LINK_WINDOW_MONTHS).toBe(12);
    expect(fromMonthOf(new Date("2026-10-03T03:00:00Z"), 12)).toBe("202510");
    expect(fromMonthOf(new Date("2026-01-15T00:00:00Z"), 12)).toBe("202501");
    expect(fromMonthOf(new Date("2026-02-15T00:00:00Z"), 2)).toBe("202512");
    // UTC 로는 9월 30일 16시지만 KST 로는 10월 1일
    expect(fromMonthOf(new Date("2026-09-30T16:00:00Z"), 0)).toBe("202610");
  });
});

describe("applyLinkPlan — 이전 status 확인 · 돌아온 행 수로 셈(F11)", () => {
  /** 가짜 sb: 넣기는 넣은 수만큼, 지우기·고치기는 status 조건이 지금 값과 같을 때만 1행을 돌려준다 */
  const fake = (/** @type {Record<number, string>} */ statusById) => {
    const calls = { insert: 0, update: 0, delete: 0, eqStatus: /** @type {string[]} */ ([]) };
    return {
      calls,
      from() {
        /** @type {any} */
        const q = { _op: "", _id: null, _status: null, _n: 0 };
        q.insert = (/** @type {any[]} */ rows) => { calls.insert++; q._op = "insert"; q._n = rows.length; return q; };
        q.update = () => { calls.update++; q._op = "update"; return q; };
        q.delete = () => { calls.delete++; q._op = "delete"; return q; };
        q.eq = (/** @type {string} */ c, /** @type {any} */ v) => { if (c === "id") q._id = v; if (c === "status") { q._status = v; calls.eqStatus.push(v); } return q; };
        q.select = () => q;
        q.then = (/** @type {any} */ res, /** @type {any} */ rej) => {
          const data = q._op === "insert" ? Array.from({ length: q._n }, (_, i) => ({ id: i })) : statusById[q._id] === q._status ? [{ id: q._id }] : [];
          return Promise.resolve({ data, error: null }).then(res, rej);
        };
        return q;
      },
    };
  };
  const noWait = async () => {};

  it("이전 status 가 그대로면 성공, 그 사이 바뀌었으면(0행 반환) 실패로 센다 — 지우기·고치기 모두 이전 status 로 거른다", async () => {
    const sb = fake({ 1: "active", 2: "hold", 3: "rejected" });
    const plan = {
      add: [{ apartment_id: "a", link_kind: "apt_seq", link_key: "N" }],
      remove: [{ id: 1, status: "active" }, { id: 3, status: "active" }],
      change: [{ id: 2, prev: { status: "hold" }, next: { status: "active", method: "manual" } }],
    };
    const r = await applyLinkPlan(sb, plan, { sleepFn: noWait, now: () => "2026-10-08T00:00:00Z" });
    expect(r).toEqual({ ok: 3, fail: 1 }); // 넣기 1 + 지우기 1(id 1) + 고치기 1(id 2) 성공 · id 3 은 이미 rejected 라 0행 → 실패
    expect(sb.calls.eqStatus).toEqual(["active", "active", "hold"]);
  });

  it("G3 고치기(change)·넣기는 updated_at 을 그 시각으로 보낸다(감시 ⑰(c) hold 오래됨의 기준)", async () => {
    /** @type {any[]} */
    const sent = [];
    const sb = {
      from() {
        /** @type {any} */
        const q = {};
        q.insert = (/** @type {any[]} */ rows) => { sent.push(...rows.map((r) => ["insert", r.updated_at])); q._n = rows.length; return q; };
        q.update = (/** @type {any} */ p) => { sent.push(["update", p.updated_at]); return q; };
        q.delete = () => q;
        q.eq = () => q;
        q.select = () => q;
        q.then = (/** @type {any} */ res, /** @type {any} */ rej) => Promise.resolve({ data: Array.from({ length: q._n ?? 1 }, (_, i) => ({ id: i })), error: null }).then(res, rej);
        return q;
      },
    };
    await applyLinkPlan(sb, {
      add: [{ apartment_id: "a", link_kind: "apt_seq", link_key: "N" }], remove: [],
      change: [{ id: 2, prev: { status: "active" }, next: { status: "hold", hold_reason: "phase", method: "name" } }],
    }, { sleepFn: noWait, now: () => "2026-10-08T00:00:00Z" });
    expect(sent).toEqual([["insert", "2026-10-08T00:00:00Z"], ["update", "2026-10-08T00:00:00Z"]]);
  });

  it("중단 신호가 오면 더 쓰지 않는다", async () => {
    const sb = fake({ 1: "active" });
    const r = await applyLinkPlan(sb, { add: [], remove: [{ id: 1, status: "active" }], change: [] }, { interrupted: () => true, sleepFn: noWait });
    expect(r).toEqual({ ok: 0, fail: 0 });
    expect(sb.calls.delete).toBe(0);
  });
});

describe("대조군 찾기 목록", () => {
  it("10쌍 — 판정에는 쓰지 않는 눈 검수용", () => {
    expect(CONTROL_PROBES.length).toBe(10);
  });
});
