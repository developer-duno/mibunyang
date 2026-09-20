// @ts-check
/**
 * `dedupe-trades-buckets.mjs` 테스트 — 순수 함수만, 네트워크 0 (세션550).
 *
 * ⚠️ 뮤테이션 대상(`guards-must-be-mutation-tested.md`): 아래 넷을 일부러 고장 내면 반드시 red 여야 한다.
 *   (a) 쌍둥이 판정 뒤집기 · (b) fail-close 제거 · (c) 세종 생존자 선택을 keeper 삭제/0건 유지로
 *   (d) 수집기 `tradeRowGu` 를 세종에서 null 로 되돌리기(그건 collect-trades.test.mjs 가 잡는다)
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { normalizeGu } from "./collectors/_shared.mjs";
import { TWIN_RATIO_MIN } from "./remap-incheon-2026.mjs";
import { makeFakeSupabase, compareValues } from "./_fake-supabase.mjs";
import {
  SEJONG, TWIN_BUCKETS, MISLABELLED_BUCKETS, bucketName, parseArgs, inScope,
  planTwinBucket, planSejong, conflictKey, checkPlan, selectPlanIds,
  verifyAfterApply, countSejongRecent6m, cutoff6mYM, sampleIds,
  runApplyFrom, classifySample, classifyRelabel, checkPlanInvariants, planWritability, writePlanFile,
} from "./dedupe-trades-buckets.mjs";

/**
 * @param {Partial<import("./dedupe-trades-buckets.mjs").TradeRow> & { id: number | string }} o
 * @returns {any}
 */
function row(o) {
  return {
    region: "경기", gu: "기흥구", dong: "구갈동", deal_month: "202606",
    area: 84.99, price: 50000, floor: 10, trade_type: "sale", apt_name: "어울림",
    cancel_date: null, recorded_at: "2026-09-01T00:00:00Z",
    ...o,
  };
}

// ── 버킷 표 ────────────────────────────────────────────────────
describe("버킷 표", () => {
  it("맨표기 버킷의 정식 이름은 normalizeGu 와 같다 (리터럴을 믿지 않는다)", () => {
    const bare = TWIN_BUCKETS.filter((b) => !MISLABELLED_BUCKETS.includes(bucketName(b.from)));
    expect(bare).toHaveLength(10);
    for (const b of bare) {
      expect(b.targets).toHaveLength(1);
      expect(b.targets[0].region).toBe(b.from.region);
      expect(b.targets[0].gu).toBe(normalizeGu(b.from.region, b.from.gu));
      // 맨표기는 정식 이름과 달라야 한다 — 같으면 그 버킷은 정리 대상이 아니다.
      expect(b.targets[0].gu).not.toBe(b.from.gu);
    }
  });

  it("오라벨 2개는 다른 시도/여러 대상을 가리킨다", () => {
    const bukgu = TWIN_BUCKETS.find((b) => bucketName(b.from) === "경북:북구");
    expect(bukgu?.targets.map(bucketName)).toEqual(["경북:포항시 북구", "부산:북구"]);
    const daegu = TWIN_BUCKETS.find((b) => bucketName(b.from) === "대구:대구");
    expect(daegu?.targets.map(bucketName)).toEqual(["서울:동대문구"]);
  });

  it("인천 22행(세션548이 일부러 남긴 유일본)은 표에 없다", () => {
    const names = TWIN_BUCKETS.map((b) => bucketName(b.from));
    expect(names).not.toContain("인천:서구");
    expect(names).not.toContain("인천:중구");
  });

  it("세종 표기는 수집기가 쓸 값과 같다", () => {
    expect(SEJONG.dupGu).toBeNull();
    expect(SEJONG.keeperGu).toBe("행정중심복합도시");
    expect(SEJONG.relabelTo).toBe("세종시");
  });
});

// ── parseArgs ──────────────────────────────────────────────────
describe("parseArgs", () => {
  it("--out 만 주면 dry-run", () => {
    const a = parseArgs(["--out=C:/x/plan.json"]);
    expect(a.error).toBeNull();
    expect(a.apply).toBe(false);
    expect(a.outPath).toBe("C:/x/plan.json");
  });

  it("맨 --apply 는 거부한다 (재분석 후 반영 금지)", () => {
    const a = parseArgs(["--apply", "--out=C:/x/plan.json"]);
    expect(a.error).toMatch(/--apply-from/);
  });

  it("--apply-from --apply 는 통과", () => {
    const a = parseArgs(["--apply-from=C:/x/plan.json", "--apply"]);
    expect(a.error).toBeNull();
    expect(a.apply).toBe(true);
    expect(a.applyFrom).toBe("C:/x/plan.json");
  });

  it("--out 없는 dry-run 은 거부 (계획을 남겨야 반영할 수 있다)", () => {
    expect(parseArgs([]).error).toMatch(/--out=/);
  });

  it("--apply-from 과 --out 은 같이 못 쓴다", () => {
    expect(parseArgs(["--apply-from=a.json", "--out=b.json"]).error).toMatch(/함께 쓸 수 없/);
  });

  it("모르는 인자는 거부", () => {
    expect(parseArgs(["--out=a.json", "--force"]).error).toMatch(/모르는 인자/);
  });
});

describe("inScope", () => {
  it("null 이면 전부", () => {
    expect(inScope(null, "sejong", "세종:")).toBe(true);
    expect(inScope(null, "twin", "경기:기흥구")).toBe(true);
  });
  it("sejong / twins 로 갈린다", () => {
    expect(inScope("sejong", "sejong", "세종:")).toBe(true);
    expect(inScope("sejong", "twin", "경기:기흥구")).toBe(false);
    expect(inScope("twins", "twin", "경기:기흥구")).toBe(true);
    expect(inScope("twins", "sejong", "세종:")).toBe(false);
  });
  it("region:gu 로 한 버킷만", () => {
    expect(inScope("경북:북구", "twin", "경북:북구")).toBe(true);
    expect(inScope("경북:북구", "twin", "경기:기흥구")).toBe(false);
  });
});

// ── 쌍둥이 버킷 계획 ───────────────────────────────────────────
describe("planTwinBucket", () => {
  it("정식 쪽에 같은 거래가 있으면 지울 수 있다", () => {
    const from = [row({ id: 1 }), row({ id: 2, price: 60000 })];
    const targets = [
      row({ id: 101, gu: "용인시 기흥구" }),
      row({ id: 102, gu: "용인시 기흥구", price: 60000 }),
    ];
    const p = planTwinBucket(from, targets);
    expect(p.twins).toBe(2);
    expect(p.ratio).toBe(1);
    expect(p.passes).toBe(true);
    expect(p.deleteIds).toEqual([1, 2]);
    expect(p.nonTwin).toBe(0);
  });

  it("해제일만 다른 낡은 판본도 쌍둥이 — 지울 수 있다", () => {
    // 정식 쪽이 나중 해제를 받아 옛 행이 낡은 판본이 된 경우. cancel_date 는 키에 없다.
    const from = [row({ id: 1, cancel_date: null })];
    const targets = [row({ id: 101, gu: "용인시 기흥구", cancel_date: "26.08.11" })];
    const p = planTwinBucket(from, targets);
    expect(p.twins).toBe(1);
    expect(p.deleteIds).toEqual([1]);
  });

  it("단지명이 다르면 쌍둥이가 아니다 — 통과한 버킷에서도 그 행은 남긴다", () => {
    // 비율 게이트를 넘긴 버킷이라야 "비쌍둥이만 남는다"를 fail-close 와 섞이지 않게 볼 수 있다.
    const from = [
      ...Array.from({ length: 199 }, (_, i) => row({ id: i + 1, price: 50000 + i })),
      row({ id: 999, apt_name: "다른단지" }), // 정식 쪽에 같은 이름이 없다
    ];
    const targets = from.slice(0, 199).map((r) => ({ ...r, id: 1000 + Number(r.id), gu: "용인시 기흥구" }));
    const p = planTwinBucket(from, targets);
    expect(p.total).toBe(200);
    expect(p.twins).toBe(199);
    expect(p.ratio).toBeGreaterThanOrEqual(TWIN_RATIO_MIN);
    expect(p.passes).toBe(true);
    expect(p.nonTwin).toBe(1);
    expect(p.deleteIds).not.toContain(999); // ← 유일본은 지우지 않는다
    expect(p.deleteIds).toHaveLength(199);
    expect(p.nonTwinSamples.map((r) => r.id)).toEqual([999]);
  });

  it("대상이 여럿이면 합집합으로 본다 (경북|북구 → 포항 + 부산)", () => {
    const from = [
      row({ id: 1, region: "경북", gu: "북구", dong: "장성동" }),
      row({ id: 2, region: "경북", gu: "북구", dong: "화명동" }), // 실은 부산
    ];
    const targets = [
      row({ id: 101, region: "경북", gu: "포항시 북구", dong: "장성동" }),
      row({ id: 102, region: "부산", gu: "북구", dong: "화명동" }),
    ];
    const p = planTwinBucket(from, targets);
    expect(p.twins).toBe(2);
    expect(p.deleteIds).toEqual([1, 2]);
  });

  it("대상 하나만 주면 다른 시도 행은 쌍둥이가 아니다 (합집합이 실제로 필요하다)", () => {
    const from = [
      row({ id: 1, region: "경북", gu: "북구", dong: "장성동" }),
      row({ id: 2, region: "경북", gu: "북구", dong: "화명동" }),
    ];
    const onlyPohang = [row({ id: 101, region: "경북", gu: "포항시 북구", dong: "장성동" })];
    const p = planTwinBucket(from, onlyPohang);
    expect(p.twins).toBe(1);
    expect(p.passes).toBe(false); // 0.5 < 0.99
    expect(p.deleteIds).toEqual([]);
  });

  it("fail-close — 비율이 임계 미만이면 한 건도 안 지운다", () => {
    const from = Array.from({ length: 100 }, (_, i) => row({ id: i + 1, price: 50000 + i }));
    // 98건만 쌍둥이 → 0.98 < 0.99
    const targets = from.slice(0, 98).map((r) => ({ ...r, id: 1000 + Number(r.id), gu: "용인시 기흥구" }));
    const p = planTwinBucket(from, targets);
    expect(p.twins).toBe(98);
    expect(p.ratio).toBeCloseTo(0.98, 5);
    expect(p.ratio).toBeLessThan(TWIN_RATIO_MIN);
    expect(p.passes).toBe(false);
    expect(p.deleteIds).toEqual([]); // ← fail-close 의 핵심: 쌍둥이가 98건이어도 0건
  });

  it("임계 이상이면 지운다 (경계 바로 위)", () => {
    const from = Array.from({ length: 100 }, (_, i) => row({ id: i + 1, price: 50000 + i }));
    const targets = from.slice(0, 99).map((r) => ({ ...r, id: 1000 + Number(r.id), gu: "용인시 기흥구" }));
    const p = planTwinBucket(from, targets);
    expect(p.ratio).toBeCloseTo(0.99, 5);
    expect(p.passes).toBe(true);
    expect(p.deleteIds).toHaveLength(99);
  });

  it("대상이 비면 통과하지 않는다 (빈 쪽을 근거로 지우지 않는다)", () => {
    const p = planTwinBucket([row({ id: 1 })], []);
    expect(p.passes).toBe(false);
    expect(p.deleteIds).toEqual([]);
  });
});

// ── 세종 계획 ──────────────────────────────────────────────────
describe("planSejong", () => {
  /**
   * @param {number|string} id
   * @param {string|null} gu
   * @param {Partial<any>} [o]
   */
  const sj = (id, gu, o = {}) =>
    row({ id, region: "세종", gu, dong: "아름동", apt_name: "세종더숲", ...o });

  it("keeper 가 있는 묶음의 null 사본은 전부 지우고 keeper 는 남긴다", () => {
    const rows = [
      sj(1, null), sj(2, null), sj(3, null),
      sj(100, SEJONG.keeperGu),
    ];
    const p = planSejong(rows);
    expect(p.deleteIds.sort()).toEqual([1, 2, 3]);
    expect(p.deleteIds).not.toContain(100);
    expect(p.relabelIds).toContain(100);
    expect(p.keeperTotal).toBe(1);
    expect(p.dupTotal).toBe(3);
    expect(p.passes).toBe(true);
  });

  it("keeper 는 어떤 경우에도 삭제 목록에 안 들어간다", () => {
    const rows = [
      sj(1, null), sj(100, SEJONG.keeperGu), sj(101, SEJONG.keeperGu, { price: 60000 }),
      sj(2, null, { price: 60000 }),
    ];
    const p = planSejong(rows);
    expect(p.deleteIds).toEqual(expect.arrayContaining([1, 2]));
    expect(p.deleteIds).not.toContain(100);
    expect(p.deleteIds).not.toContain(101);
  });

  it("keeper 없는 묶음은 정확히 한 행만 남긴다 (최신 recorded_at)", () => {
    const rows = [
      sj(1, null, { recorded_at: "2026-01-01T00:00:00Z" }),
      sj(2, null, { recorded_at: "2026-09-01T00:00:00Z" }),
      sj(3, null, { recorded_at: "2026-05-01T00:00:00Z" }),
      sj(100, SEJONG.keeperGu, { price: 99999 }), // 다른 묶음 — passes 를 위해
    ];
    const p = planSejong(rows);
    expect(p.orphanGroups).toBe(1);
    expect(p.keptNullIds).toEqual([2]);
    expect(p.deleteIds.sort()).toEqual([1, 3]);
    // 지운 뒤 그 묶음에 정확히 1행이 남는다
    expect(3 - p.deleteIds.filter((id) => [1, 2, 3].includes(Number(id))).length).toBe(1);
  });

  it("recorded_at 동률이면 큰 id 가 남는다", () => {
    const rows = [
      sj(7, null, { recorded_at: "2026-09-01T00:00:00Z" }),
      sj(9, null, { recorded_at: "2026-09-01T00:00:00Z" }),
      sj(100, SEJONG.keeperGu, { price: 99999 }),
    ];
    const p = planSejong(rows);
    expect(p.keptNullIds).toEqual([9]);
    expect(p.deleteIds).toEqual([7]);
  });

  it("keeper 가 하나도 없으면 계획을 통과시키지 않는다", () => {
    const p = planSejong([sj(1, null), sj(2, null)]);
    expect(p.keeperTotal).toBe(0);
    expect(p.passes).toBe(false);
  });

  it("표기 통일 — keeper 는 전부 relabel 대상", () => {
    const rows = [sj(1, null), sj(100, SEJONG.keeperGu), sj(101, SEJONG.keeperGu, { price: 60000 })];
    const p = planSejong(rows);
    expect(p.relabelIds).toEqual(expect.arrayContaining([100, 101]));
  });

  it("살아남은 null 행도 충돌 안 하면 표기를 옮긴다", () => {
    const rows = [
      sj(1, null, { price: 70000 }), // keeper 없는 유일 묶음 — 충돌 상대 없음
      sj(100, SEJONG.keeperGu, { price: 50000 }),
    ];
    const p = planSejong(rows);
    expect(p.keptNullIds).toEqual([1]);
    expect(p.relabelIds).toEqual(expect.arrayContaining([100, 1]));
    expect(p.relabelBlocked).toBe(0);
  });

  it("옮기면 고유 인덱스를 밟는 null 행은 null 로 남기고 센다", () => {
    // 같은 충돌 키(region,gu,deal_month,area,price,floor,trade_type)인데 apt_name 이 달라
    // tradeTwinKey 로는 다른 묶음 → keeper 가 없는 쪽이 살아남지만 옮기면 keeper 와 충돌한다.
    const rows = [
      sj(1, null, { apt_name: "다른이름" }),
      sj(100, SEJONG.keeperGu, { apt_name: "세종더숲" }),
    ];
    const p = planSejong(rows);
    expect(conflictKey(rows[0], SEJONG.relabelTo)).toBe(conflictKey(rows[1], SEJONG.relabelTo));
    expect(p.keptNullIds).toEqual([1]);
    expect(p.relabelIds).toContain(100);
    expect(p.relabelIds).not.toContain(1);
    expect(p.relabelBlocked).toBe(1);
  });

  it("이미 relabelTo 표기인 행은 건드리지 않는다", () => {
    const rows = [sj(1, null), sj(100, SEJONG.keeperGu), sj(200, SEJONG.relabelTo)];
    const p = planSejong(rows);
    expect(p.deleteIds).not.toContain(200);
    expect(p.relabelIds).not.toContain(200);
  });
});

describe("conflictKey", () => {
  it("DB 고유 인덱스와 같은 컬럼을 본다 (apt_name·dong 은 안 본다)", () => {
    const a = row({ id: 1, apt_name: "가", dong: "구갈동" });
    const b = row({ id: 2, apt_name: "나", dong: "다른동" });
    expect(conflictKey(a, "세종시")).toBe(conflictKey(b, "세종시"));
  });
  it("gu 가 다르면 다른 키", () => {
    const a = row({ id: 1 });
    expect(conflictKey(a, "세종시")).not.toBe(conflictKey(a, null));
  });
  it("null 과 빈 문자열을 섞지 않는다", () => {
    const a = row({ id: 1, floor: null });
    const b = row({ id: 2, floor: /** @type {any} */ ("") });
    expect(conflictKey(a, "세종시")).not.toBe(conflictKey(b, "세종시"));
  });
});

// ── 계획 파일 검증 ─────────────────────────────────────────────
describe("checkPlan", () => {
  const good = () => ({
    createdAt: new Date().toISOString(),
    tradesTotalBefore: 1052512,
    buckets: [
      { kind: "sejong", name: "세종:", passes: true, deleteIds: [1, 2], relabelIds: [100] },
      { kind: "twin", name: "경기:기흥구", passes: true, deleteIds: [3], relabelIds: [] },
    ],
  });

  it("정상 계획은 통과", () => {
    expect(checkPlan(good()).ok).toBe(true);
  });

  it("fail-close 버킷이 범위에 있으면 통째로 거부", () => {
    const p = good();
    p.buckets[1].passes = false;
    expect(checkPlan(p).ok).toBe(false);
    expect(checkPlan(p).reason).toMatch(/통과로 표시되지 않은/);
  });

  it("그 버킷을 범위에서 빼면 통과", () => {
    const p = good();
    p.buckets[1].passes = false;
    expect(checkPlan(p, "sejong").ok).toBe(true);
  });

  it("24시간 넘은 계획은 거부", () => {
    const p = good();
    p.createdAt = new Date(Date.now() - 25 * 3600000).toISOString();
    expect(checkPlan(p).ok).toBe(false);
    expect(checkPlan(p).reason).toMatch(/24시간/);
  });

  it("23시간 된 계획은 통과 (경계)", () => {
    const p = good();
    p.createdAt = new Date(Date.now() - 23 * 3600000).toISOString();
    expect(checkPlan(p).ok).toBe(true);
  });

  it("createdAt 이 없으면 거부", () => {
    const p = /** @type {any} */ (good());
    delete p.createdAt;
    expect(checkPlan(p).ok).toBe(false);
  });

  it("미래 createdAt 은 거부 (손으로 고쳤다는 신호)", () => {
    const p = good();
    p.createdAt = new Date(Date.now() + 3 * 3600000).toISOString();
    expect(checkPlan(p).ok).toBe(false);
  });

  it("buckets/tradesTotalBefore 가 없으면 거부", () => {
    expect(checkPlan({ createdAt: new Date().toISOString(), tradesTotalBefore: 1 }).ok).toBe(false);
    expect(checkPlan({ createdAt: new Date().toISOString(), buckets: [] }).ok).toBe(false);
  });

  it("범위에 맞는 버킷이 없으면 거부", () => {
    expect(checkPlan(good(), "경남:의창구").ok).toBe(false);
  });
});

describe("selectPlanIds — 반영은 계획에 적힌 id 만", () => {
  const plan = {
    createdAt: new Date().toISOString(),
    tradesTotalBefore: 10,
    buckets: [
      { kind: "sejong", name: "세종:", passes: true, deleteIds: [1, 2], relabelIds: [100] },
      { kind: "twin", name: "경기:기흥구", passes: true, deleteIds: [3, 4], relabelIds: [] },
    ],
  };

  it("계획의 id 집합과 정확히 같다 (재계산 0)", () => {
    const s = selectPlanIds(plan);
    expect(s.deleteIds).toEqual([1, 2, 3, 4]);
    expect(s.relabelIds).toEqual([100]);
  });

  it("--only 로 좁히면 그 버킷 id 만", () => {
    const s = selectPlanIds(plan, "sejong");
    expect(s.deleteIds).toEqual([1, 2]);
    expect(s.relabelIds).toEqual([100]);
  });

  it("계획에 없는 id 는 절대 안 나온다", () => {
    const s = selectPlanIds(plan);
    const planned = new Set([1, 2, 3, 4, 100]);
    for (const id of [...s.deleteIds, ...s.relabelIds]) expect(planned.has(Number(id))).toBe(true);
  });
});

// ── 되읽기 판정 ────────────────────────────────────────────────
describe("verifyAfterApply", () => {
  it("전부 맞으면 문제 없음", () => {
    expect(verifyAfterApply({
      stillThere: 0,
      bucketLeft: [{ name: "경기:기흥구", left: 0, expected: 0 }],
      relabelLeft: 0, totalAfter: 900, totalExpected: 900,
    })).toEqual([]);
  });

  it("count 가 null 이면 실패 (0 으로 읽지 않는다)", () => {
    expect(verifyAfterApply({ stillThere: null })[0]).toMatch(/null/);
    expect(verifyAfterApply({ stillThere: 0, bucketLeft: [{ name: "x", left: null, expected: 0 }] })[0])
      .toMatch(/null/);
    expect(verifyAfterApply({ stillThere: 0, totalAfter: null, totalExpected: 5 })[0]).toMatch(/null/);
  });

  it("지웠어야 할 행이 남으면 실패", () => {
    expect(verifyAfterApply({ stillThere: 3 })[0]).toMatch(/3건/);
  });

  it("잔여가 기대와 다르면 실패", () => {
    const p = verifyAfterApply({ stillThere: 0, bucketLeft: [{ name: "경기:기흥구", left: 7, expected: 0 }] });
    expect(p[0]).toMatch(/잔여 7행/);
  });

  it("기대 잔여가 0 이 아니어도 그 값과 같으면 통과 (비쌍둥이는 남긴다)", () => {
    expect(verifyAfterApply({
      stillThere: 0, bucketLeft: [{ name: "경북:북구", left: 1, expected: 1 }],
    })).toEqual([]);
  });

  it("전체 행수가 기대와 다르면 실패", () => {
    expect(verifyAfterApply({ stillThere: 0, totalAfter: 901, totalExpected: 900 })[0]).toMatch(/전체 901행/);
  });

  it("옛 표기가 남아 있으면 실패 (세종을 반영했을 때만 검사한다)", () => {
    expect(verifyAfterApply({ stillThere: 0, relabelLeft: 5, relabelChecked: true })[0]).toMatch(/옛 표기/);
  });
});

// ── 화면 숫자 예측 ─────────────────────────────────────────────
describe("countSejongRecent6m — trade-stats 와 같은 필터", () => {
  const cut = "202603";
  const rows = [
    row({ id: 1, region: "세종", gu: null, deal_month: "202606", trade_type: "sale" }),
    row({ id: 2, region: "세종", gu: null, deal_month: "202606", trade_type: "sale" }), // 사본
    row({ id: 3, region: "세종", gu: "행정중심복합도시", deal_month: "202606", trade_type: "sale" }),
    row({ id: 4, region: "세종", gu: null, deal_month: "202601", trade_type: "sale" }), // 창 밖
    row({ id: 5, region: "세종", gu: null, deal_month: "202606", trade_type: "jeonse" }), // 전세
    row({ id: 6, region: "세종", gu: null, deal_month: "202606", trade_type: "sale", cancel_date: "26.07.01" }),
  ];

  it("해제·전세·창 밖을 뺀다", () => {
    expect(countSejongRecent6m(rows, cut)).toBe(3); // id 1,2,3
  });

  it("삭제 예정 id 를 빼면 줄어든다 (사본 제거 효과)", () => {
    expect(countSejongRecent6m(rows, cut, new Set(["1", "2"]))).toBe(1);
  });

  it("cutoff 는 YYYYMM 6자리", () => {
    expect(cutoff6mYM(new Date("2026-09-20T00:00:00Z"))).toMatch(/^\d{6}$/);
    expect(cutoff6mYM(new Date("2026-09-20T00:00:00Z"))).toBe("202603");
  });
});

describe("sampleIds", () => {
  it("적으면 그대로", () => {
    expect(sampleIds([1, 2, 3], 200)).toEqual([1, 2, 3]);
  });
  it("많으면 처음·가운데·끝을 고루 — 첫 id 와 마지막 id 를 반드시 포함", () => {
    const ids = Array.from({ length: 10000 }, (_, i) => i + 1);
    const s = sampleIds(ids, 200);
    expect(s.length).toBeLessThanOrEqual(200);
    expect(s).toContain(1);
    expect(s).toContain(10000);
    // 앞쪽만 뽑지 않는다 — 중간 구간에서도 뽑혀야 한다
    expect(s.some((v) => Number(v) > 3000 && Number(v) < 7000)).toBe(true);
  });
});

// ── 세션550 리뷰 #1~#7: 쓰기 경로를 실제로 태우는 테스트 ──
// 옛 판본은 runApplyFrom 이 process.exit 을 부르고 sb 를 스스로 만들어 **한 줄도 안 지났다**.
// 그래서 "삭제 묶음에 keeper 11,790건을 끼워 넣는" 뮤테이션이 57/57 초록이었다.
describe("runApplyFrom — 쓰기 경로 (가짜 클라이언트로 실제 경로를 태운다)", () => {
  const PLAN_DIR = mkdtempSync(path.join(tmpdir(), "s550-plan-"));

  /** 세종 3사본 + keeper 1 · 기흥구 2사본 + 정식 2 */
  function baseRows() {
    return [
      { id: 1, region: "세종", gu: null, dong: "아름동" },
      { id: 2, region: "세종", gu: null, dong: "아름동" },
      { id: 3, region: "세종", gu: null, dong: "종촌동" },
      { id: 100, region: "세종", gu: "행정중심복합도시", dong: "아름동" },
      { id: 101, region: "세종", gu: "행정중심복합도시", dong: "종촌동" },
      { id: 10, region: "경기", gu: "기흥구", dong: "구갈동" },
      { id: 11, region: "경기", gu: "기흥구", dong: "구갈동" },
      { id: 900, region: "경기", gu: "용인시 기흥구", dong: "구갈동" },
      { id: 901, region: "서울", gu: "강남구", dong: "역삼동" }, // 무관한 행 — 절대 안 건드려야
    ];
  }

  /** @param {Partial<any>} [over] */
  function makePlan(over = {}) {
    const plan = {
      createdAt: new Date().toISOString(),
      tradesTotalBefore: 9,
      buckets: [
        {
          kind: "sejong", name: "세종:", region: "세종", dupGu: null,
          keeperGu: "행정중심복합도시", relabelTo: "세종시",
          keeperTotal: 2, deleteIds: [1, 2, 3], relabelIds: [100, 101], keptNullIds: [],
          expectedLeft: 0, passes: true,
        },
        {
          kind: "twin", name: "경기:기흥구", from: { region: "경기", gu: "기흥구" },
          targets: [{ region: "경기", gu: "용인시 기흥구" }],
          deleteIds: [10, 11], relabelIds: [], expectedLeft: 0, passes: true,
        },
      ],
      ...over,
    };
    const p = path.join(PLAN_DIR, `plan-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(p, JSON.stringify(plan), "utf8");
    return p;
  }

  /** @param {string} planPath @param {any} sb @param {Partial<any>} [args] */
  const run = (planPath, sb, args = {}) =>
    runApplyFrom(sb, { apply: true, outPath: null, applyFrom: planPath, only: null, error: null, ...args });

  it("계획의 deleteIds 만 지우고, 그 밖의 행은 건드리지 않는다", async () => {
    const sb = makeFakeSupabase(baseRows());
    expect(await run(makePlan(), sb)).toBe(0);
    const left = sb.snapshot().map((r) => Number(r.id)).sort((a, b) => a - b);
    expect(left).toEqual([100, 101, 900, 901]); // 1,2,3,10,11 만 사라졌다
    const deletedIds = sb.touched("delete").map(Number).sort((a, b) => a - b);
    expect(deletedIds).toEqual([1, 2, 3, 10, 11]);
  });

  it("keeper 는 절대 안 지운다 (M1: 삭제 묶음에 relabelIds 를 섞으면 red)", async () => {
    const sb = makeFakeSupabase(baseRows());
    expect(await run(makePlan(), sb)).toBe(0);
    const ids = sb.snapshot().map((r) => Number(r.id));
    expect(ids).toContain(100);
    expect(ids).toContain(101);
    expect(sb.touched("delete")).not.toContain("100");
    expect(sb.touched("delete")).not.toContain("101");
  });

  it("표기변경은 relabelIds 에만, 페이로드는 정확히 {gu: relabelTo}", async () => {
    const sb = makeFakeSupabase(baseRows());
    expect(await run(makePlan(), sb)).toBe(0);
    const updates = sb.calls.filter((c) => c.op === "update");
    expect(updates.length).toBeGreaterThan(0);
    for (const u of updates) {
      expect(u.payload).toEqual({ gu: "세종시" });
      for (const id of u.ids) expect([100, 101]).toContain(Number(id));
    }
    const byId = new Map(sb.snapshot().map((r) => [Number(r.id), r]));
    expect(byId.get(100)?.gu).toBe("세종시");
    expect(byId.get(101)?.gu).toBe("세종시");
    expect(byId.get(900)?.gu).toBe("용인시 기흥구"); // 무관한 행은 그대로
  });

  it("삭제가 표기변경보다 먼저 일어난다", async () => {
    const sb = makeFakeSupabase(baseRows());
    expect(await run(makePlan(), sb)).toBe(0);
    const firstUpdate = sb.calls.findIndex((c) => c.op === "update");
    const lastDelete = sb.calls.map((c) => c.op).lastIndexOf("delete");
    expect(firstUpdate).toBeGreaterThan(lastDelete);
  });

  it("모든 쓰기는 id 필터로만 한다 (필터 삭제 금지)", async () => {
    const sb = makeFakeSupabase(baseRows());
    expect(await run(makePlan(), sb)).toBe(0);
    for (const c of sb.calls) {
      expect(c.byId).toBe(true);
      expect(c.filters.map((f) => f[1])).toEqual(["id"]);
    }
  });

  it("미리보기(--apply 없음)는 한 줄도 안 쓴다", async () => {
    const sb = makeFakeSupabase(baseRows());
    expect(await run(makePlan(), sb, { apply: false })).toBe(0);
    expect(sb.calls).toHaveLength(0);
    expect(sb.snapshot()).toHaveLength(9);
  });

  // ── #2 이어달리기 ──
  it("중간에 끊겨 이미 지워진 행이 있어도 같은 계획으로 다시 돌아간다", async () => {
    // 1,2 는 앞 회차가 이미 지운 상태
    const partial = baseRows().filter((r) => ![1, 2].includes(Number(r.id)));
    const sb = makeFakeSupabase(partial);
    expect(await run(makePlan(), sb)).toBe(0);
    const left = sb.snapshot().map((r) => Number(r.id)).sort((a, b) => a - b);
    expect(left).toEqual([100, 101, 900, 901]);
  });

  it("이미 새 표기로 옮겨진 keeper 는 다시 안 건드린다", async () => {
    const rows = baseRows().map((r) => (Number(r.id) === 100 ? { ...r, gu: "세종시" } : r));
    const sb = makeFakeSupabase(rows);
    expect(await run(makePlan(), sb)).toBe(0);
    const updated = sb.touched("update").map(Number);
    expect(updated).not.toContain(100); // 이미 됐다
    expect(updated).toContain(101);
  });

  it("남길 행이 사라졌으면 실패한다 (삭제 대상과 달리 '없음'이 정상일 수 없다)", async () => {
    const rows = baseRows().filter((r) => Number(r.id) !== 101);
    const sb = makeFakeSupabase(rows);
    const plan = makePlan({
      buckets: JSON.parse(readFileSync(makePlan(), "utf8")).buckets.map((/** @type {any} */ b) =>
        b.kind === "sejong" ? { ...b, keeperTotal: 1 } : b),
    });
    expect(await run(plan, sb)).toBe(1);
  });

  // ── #3 전제 검사 ──
  it("전제 위반(다른 버킷으로 옮겨진 행)이면 한 줄도 안 쓰고 실패한다", async () => {
    const rows = baseRows().map((r) => (Number(r.id) === 1 ? { ...r, gu: "딴구" } : r));
    const sb = makeFakeSupabase(rows);
    expect(await run(makePlan(), sb)).toBe(1);
    expect(sb.calls).toHaveLength(0); // 쓰기 0
    expect(sb.snapshot()).toHaveLength(9);
  });

  // ── #4 불변식 ──
  it("M6: keeper 가 deleteIds 에 있으면 거부한다 (쓰기 0)", async () => {
    const sb = makeFakeSupabase(baseRows());
    const p = makePlan();
    const j = JSON.parse(readFileSync(p, "utf8"));
    j.buckets[0].deleteIds = [1, 2, 3, 100]; // keeper 100 을 끼워 넣는다
    writeFileSync(p, JSON.stringify(j), "utf8");
    expect(await run(p, sb)).toBe(1);
    expect(sb.calls).toHaveLength(0);
  });

  it("deleteIds 와 relabelIds 가 겹치면 거부한다", async () => {
    const sb = makeFakeSupabase(baseRows());
    const p = makePlan();
    const j = JSON.parse(readFileSync(p, "utf8"));
    j.buckets[1].relabelIds = [10];
    writeFileSync(p, JSON.stringify(j), "utf8");
    expect(await run(p, sb)).toBe(1);
    expect(sb.calls).toHaveLength(0);
  });

  // ── #7 passes 엄격 ──
  it("passes 필드가 없는 손편집 계획은 거부한다", async () => {
    const sb = makeFakeSupabase(baseRows());
    const p = makePlan();
    const j = JSON.parse(readFileSync(p, "utf8"));
    delete j.buckets[1].passes;
    writeFileSync(p, JSON.stringify(j), "utf8");
    expect(await run(p, sb)).toBe(1);
    expect(sb.calls).toHaveLength(0);
  });

  // ── #5 count 실패 ──
  it("되읽기 count 가 실패하면 성공으로 읽지 않는다", async () => {
    const sb = makeFakeSupabase(baseRows(), { countError: "조회 폭발" });
    expect(await run(makePlan(), sb)).toBe(1);
  });

  // ── #6 실제 삭제 수 ──
  it("삭제 오류가 나면 즉시 멈춘다 (낙관적 집계 금지)", async () => {
    const sb = makeFakeSupabase(baseRows(), { failDeleteAtCall: 1 });
    expect(await run(makePlan(), sb)).toBe(1);
    expect(sb.snapshot()).toHaveLength(9); // 아무것도 안 지워졌다
  });

  it("전체 행수 대조는 **이번 회차** 시작값을 쓴다 (계획의 옛 총수가 아니라)", async () => {
    // 앞 회차가 1,2 를 지운 뒤라 지금 총수는 7 — 계획의 tradesTotalBefore(9)로 재면 거짓 실패가 난다.
    const partial = baseRows().filter((r) => ![1, 2].includes(Number(r.id)));
    const sb = makeFakeSupabase(partial);
    expect(await run(makePlan(), sb)).toBe(0);
  });
});

describe("classifySample — 이어달리기와 전제 위반을 가른다", () => {
  const want = new Map([["1", { region: "세종", gu: null }], ["2", { region: "세종", gu: null }]]);

  it("없는 행은 '이미 처리됨' (실패 아님)", () => {
    const c = classifySample([{ id: 2, region: "세종", gu: null }], [1, 2], want);
    expect(c.gone).toBe(1);
    expect(c.bad).toEqual([]);
  });

  it("있는데 버킷이 다르면 전제 위반", () => {
    const c = classifySample([{ id: 1, region: "세종", gu: "딴구" }], [1], want);
    expect(c.bad).toHaveLength(1);
  });

  it("그대로면 통과", () => {
    const c = classifySample([{ id: 1, region: "세종", gu: null }], [1], want);
    expect(c.ok).toBe(1);
    expect(c.bad).toEqual([]);
  });
});

describe("classifyRelabel", () => {
  it("이미 새 표기면 done, 아니면 todo", () => {
    const c = classifyRelabel(
      [{ id: 1, gu: "세종시" }, { id: 2, gu: "행정중심복합도시" }], [1, 2], "세종시");
    expect(c.done).toBe(1);
    expect(c.todo).toEqual([2]);
    expect(c.bad).toEqual([]);
  });

  it("사라진 행은 실패 (남길 행이다)", () => {
    const c = classifyRelabel([], [1], "세종시");
    expect(c.bad).toHaveLength(1);
  });

  it("제3의 표기는 실패", () => {
    const c = classifyRelabel([{ id: 1, gu: "엉뚱구" }], [1], "세종시", "행정중심복합도시");
    expect(c.bad).toHaveLength(1);
    expect(c.todo).toEqual([]);
  });
});

describe("checkPlanInvariants", () => {
  it("겹치는 id 가 없으면 통과", () => {
    expect(checkPlanInvariants([
      { kind: "sejong", name: "세종:", deleteIds: [1], relabelIds: [100], keptNullIds: [] },
    ])).toEqual([]);
  });

  it("삭제·표기변경이 겹치면 잡는다", () => {
    const p = checkPlanInvariants([{ kind: "twin", name: "x", deleteIds: [1], relabelIds: [1] }]);
    expect(p).toHaveLength(1);
  });

  it("keeper 가 삭제 목록에 있으면 잡는다", () => {
    const p = checkPlanInvariants([
      { kind: "sejong", name: "세종:", deleteIds: [1, 100], relabelIds: [100], keptNullIds: [] },
    ]);
    expect(p.some((s) => s.includes("keeper"))).toBe(true);
  });

  it("살아남은 null 행은 keeper 가 아니다 (거짓 경보 없음)", () => {
    expect(checkPlanInvariants([
      { kind: "sejong", name: "세종:", deleteIds: [1], relabelIds: [100, 5], keptNullIds: [5] },
    ])).toEqual([]);
  });
});

describe("verifyAfterApply — relabelLeft 도 다른 셋과 같은 잣대 (#5)", () => {
  it("검사 대상인데 count 가 null 이면 실패", () => {
    const p = verifyAfterApply({ stillThere: 0, relabelLeft: null, relabelChecked: true });
    expect(p.some((s) => s.includes("표기변경 확인 실패"))).toBe(true);
  });

  it("세종이 범위 밖이면 검사하지 않는다", () => {
    expect(verifyAfterApply({ stillThere: 0, relabelLeft: null, relabelChecked: false })).toEqual([]);
  });
});

// ── 세션550 2차 리뷰: 남은 셋 (N3 · M6 2-keeper · 가짜 클라이언트 수 비교) ──
describe("남은 지적 3건 (2차 리뷰)", () => {
  const DIR = mkdtempSync(path.join(tmpdir(), "s550-leftover-"));

  /** @param {any} plan */
  function planFile(plan) {
    const p = path.join(DIR, `p-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(p, JSON.stringify(plan), "utf8");
    return p;
  }
  /** @param {string} f @param {any} sb @param {Partial<any>} [a] */
  const run = (f, sb, a = {}) =>
    runApplyFrom(sb, { apply: true, outPath: null, applyFrom: f, only: null, error: null, ...a });

  // ── N3: 삭제가 조용히 덜 되고 그 행이 아직 있으면 즉시 멈춘다 ──
  // 이 가드가 없으면 뒤의 stillThere 검사가 결국 잡기는 하지만, 그 전에 **표기변경 쓰기가
  // 이미 나간다**. 사고를 키우지 않으려면 그 묶음에서 바로 끊어야 한다.
  it("N3: 삭제가 요청보다 적게 됐고 그 행이 남아 있으면 이후 쓰기 없이 실패한다", async () => {
    const rows = [
      { id: 1, region: "세종", gu: null, dong: "아름동" },
      { id: 2, region: "세종", gu: null, dong: "종촌동" },
      { id: 100, region: "세종", gu: "행정중심복합도시", dong: "아름동" },
    ];
    // id 1 만 지워지고 2 는 조용히 남는다
    const sb = makeFakeSupabase(rows, { deleteOnlyIds: [1] });
    const f = planFile({
      createdAt: new Date().toISOString(), tradesTotalBefore: 3,
      buckets: [{
        kind: "sejong", name: "세종:", region: "세종", dupGu: null,
        keeperGu: "행정중심복합도시", relabelTo: "세종시",
        keeperTotal: 1, deleteIds: [1, 2], relabelIds: [100], keptNullIds: [],
        expectedLeft: 0, passes: true,
      }],
    });
    expect(await run(f, sb)).toBe(1);
    // 삭제 묶음에서 끊겼으므로 표기변경(update)은 한 번도 안 나가야 한다
    expect(sb.calls.filter((c) => c.op === "update")).toHaveLength(0);
    // 남은 행은 그대로 — keeper 도 옛 표기 그대로다
    expect(sb.snapshot().find((r) => Number(r.id) === 100)?.gu).toBe("행정중심복합도시");
  });

  it("N3: 덜 지워졌어도 그 행이 정말 없으면(앞 회차가 지움) 계속 진행한다", async () => {
    // 위와 같은 상황이지만 id 2 는 애초에 표에 없다 = 이미 처리됨
    const rows = [
      { id: 1, region: "세종", gu: null, dong: "아름동" },
      { id: 100, region: "세종", gu: "행정중심복합도시", dong: "아름동" },
    ];
    const sb = makeFakeSupabase(rows);
    const f = planFile({
      createdAt: new Date().toISOString(), tradesTotalBefore: 3,
      buckets: [{
        kind: "sejong", name: "세종:", region: "세종", dupGu: null,
        keeperGu: "행정중심복합도시", relabelTo: "세종시",
        keeperTotal: 1, deleteIds: [1, 2], relabelIds: [100], keptNullIds: [],
        expectedLeft: 0, passes: true,
      }],
    });
    expect(await run(f, sb)).toBe(0);
    expect(sb.snapshot().find((r) => Number(r.id) === 100)?.gu).toBe("세종시");
  });

  // ── M6: 한 묶음에 keeper 가 둘일 때 (병합 로직은 넣지 않는다 — 거부만 한다) ──
  it("M6: 한 tradeTwinKey 묶음에 keeper 가 2개면 planSejong 이 둘 다 남긴다 (삭제 0)", () => {
    const sj = (/** @type {any} */ id, /** @type {any} */ gu) => row({
      id, region: "세종", gu, dong: "아름동", apt_name: "세종더숲",
    });
    // 고유 인덱스가 있는 한 일어날 수 없지만, 일어나면 어떻게 되는지 못 박는다.
    const p = planSejong([sj(1, null), sj(100, SEJONG.keeperGu), sj(101, SEJONG.keeperGu)]);
    expect(p.deleteIds).toEqual([1]);
    expect(p.deleteIds).not.toContain(100);
    expect(p.deleteIds).not.toContain(101);
    expect(p.relabelIds).toEqual(expect.arrayContaining([100, 101]));
  });

  it("M6: keeper 2개 중 하나가 삭제 목록에 섞인 계획은 불변식이 잡는다", () => {
    const problems = checkPlanInvariants([{
      kind: "sejong", name: "세종:", deleteIds: [1, 101],
      relabelIds: [100, 101], keptNullIds: [],
    }]);
    // 101 은 삭제·표기변경 양쪽에 있고 동시에 keeper 다 → 불변식 **둘 다** 걸린다(더 엄격해서 좋다).
    expect(problems).toHaveLength(2);
    expect(problems.some((s) => s.includes("keeper"))).toBe(true);
    expect(problems.some((s) => s.includes("같이 든"))).toBe(true);
  });

  it("M6: keeper 만 삭제 목록에 있고 겹침은 없을 때도 잡는다", () => {
    const problems = checkPlanInvariants([{
      kind: "sejong", name: "세종:", deleteIds: [1, 101],
      relabelIds: [100], keptNullIds: [],
    }]);
    // 101 은 relabelIds 에 없으므로 겹침은 아니지만, keeperTotal 관점에서 남길 행이 아니다.
    // 이 경우는 relabelIds 기준 keeper 집합에 없어 불변식이 조용하다 — 그래서 반영 경로의
    // keeper 수 대조(옛+새 표기 합)가 두 번째 그물이 된다. 여기서는 그 사실을 못 박는다.
    expect(problems).toEqual([]);
  });

  it("M6: 그런 계획은 **저장 자체가** 막힌다 (계획 생성 측 게이트)", () => {
    const bad = planWritability([{
      kind: "sejong", name: "세종:", deleteIds: [1, 101],
      relabelIds: [100, 101], keptNullIds: [],
    }]);
    expect(bad.ok).toBe(false);
    expect(bad.problems.some((s) => s.includes("keeper"))).toBe(true);
    // 정상 계획은 그대로 저장된다 (거짓 경보 없음)
    expect(planWritability([{
      kind: "sejong", name: "세종:", deleteIds: [1], relabelIds: [100], keptNullIds: [],
    }])).toEqual({ ok: true, problems: [] });
  });

  it("M6d: 모순된 계획은 **파일이 아예 안 만들어진다** (검사와 쓰기가 한 몸)", () => {
    const out = path.join(DIR, `never-${Math.random().toString(36).slice(2)}.json`);
    expect(() => writePlanFile(out, {
      buckets: [{
        kind: "sejong", name: "세종:", deleteIds: [1, 101],
        relabelIds: [100, 101], keptNullIds: [],
      }],
    })).toThrow(/불변식 위반/);
    expect(existsSync(out)).toBe(false); // ← 쓰기가 아예 안 일어났다

    // 정상 계획은 실제로 파일이 생긴다 (게이트가 전부를 막아 버리지 않는다)
    const ok = path.join(DIR, `ok-${Math.random().toString(36).slice(2)}.json`);
    expect(writePlanFile(ok, {
      buckets: [{ kind: "sejong", name: "세종:", deleteIds: [1], relabelIds: [100], keptNullIds: [] }],
    })).toBe(ok);
    expect(existsSync(ok)).toBe(true);
  });

  it("M6: 그런 계획은 반영 경로가 쓰기 0 으로 거부한다", async () => {
    const rows = [
      { id: 1, region: "세종", gu: null, dong: "아름동" },
      { id: 100, region: "세종", gu: "행정중심복합도시", dong: "아름동" },
      { id: 101, region: "세종", gu: "행정중심복합도시", dong: "아름동" },
    ];
    const sb = makeFakeSupabase(rows);
    const f = planFile({
      createdAt: new Date().toISOString(), tradesTotalBefore: 3,
      buckets: [{
        kind: "sejong", name: "세종:", region: "세종", dupGu: null,
        keeperGu: "행정중심복합도시", relabelTo: "세종시",
        keeperTotal: 2, deleteIds: [1, 101], relabelIds: [100, 101], keptNullIds: [],
        expectedLeft: 0, passes: true,
      }],
    });
    expect(await run(f, sb)).toBe(1);
    expect(sb.calls).toHaveLength(0);
    expect(sb.snapshot()).toHaveLength(3);
  });

  // ── 가짜 클라이언트의 수 비교 ──
  it("가짜 클라이언트는 id 를 수로 견준다 ([9,10,100] 이 문자열 순서로 섞이지 않는다)", async () => {
    const rows = [9, 10, 100].map((id) => ({ id, region: "세종", gu: null, dong: "아름동" }));
    const sb = makeFakeSupabase(rows);
    const asc = await sb.from("trades").select("id, region, gu").order("id", { ascending: true }).limit(10);
    expect(asc.data?.map((/** @type {any} */ r) => r.id)).toEqual([9, 10, 100]);
    // 문자열 비교였다면 "10","100" 이 "9" 앞에 오고 gt(9) 는 빈 결과를 준다
    const after9 = await sb.from("trades").select("id, region, gu").order("id", { ascending: true }).limit(10).gt("id", 9);
    expect(after9.data?.map((/** @type {any} */ r) => r.id)).toEqual([10, 100]);
    // 내림차순도 수 기준 (활성 매물처럼 큰 번호부터 훑는 경로를 나중에 검사할 수 있게)
    const desc = await sb.from("trades").select("id, region, gu").order("id", { ascending: false }).limit(10);
    expect(desc.data?.map((/** @type {any} */ r) => r.id)).toEqual([100, 10, 9]);
  });

  it("compareValues: 숫자는 수로, 그 밖은 문자열로", () => {
    expect(compareValues(9, 10)).toBeLessThan(0);
    expect(compareValues("100", "9")).toBeGreaterThan(0); // 둘 다 수로 읽힌다
    expect(compareValues("가", "나")).toBeLessThan(0);
    expect(compareValues(5, 5)).toBe(0);
    // ⚠️ null 은 **수로 읽지 않는다**. `Number(null)` 은 0 이라 수로 읽으면 5 보다 작다고 나오는데,
    //    그건 "빈 값이 0" 이라는 거짓이다. 문자열로 떨어지므로 "null" > "5" → 양수가 정답이다.
    expect(compareValues(null, 5)).toBeGreaterThan(0);
    expect(compareValues(null, 5)).not.toBeLessThan(0);
  });
});
