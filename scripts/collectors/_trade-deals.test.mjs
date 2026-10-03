// @ts-check
/**
 * `_trade-deals.mjs` 시험 — 픽스처는 조사 2차가 받아 둔 **실제 국토부 응답 사본**(세션589,
 * `.omc/artifacts/session589/scope/research2/raw/`)을 50행 이내로 자른 것이다.
 *   sale-11680-202608          매매(RTMSDataSvcAptTradeDev) 강남 · 50/95
 *   rent-11680-202608          전월세(RTMSDataSvcAptRent) 강남 · 50/1139(월세 29 · 전세 21)
 *   presale-12300-202605       분양권(RTMSDataSvcSilvTrade) 광주·전남 12300 · 30/30("입" 4)
 *   sale-hwaseong-41597-202608 매매 화성 동탄구 새 코드 · 50/139
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildDealRow, isOwnershipRight, dealKey, planReplace, getTagAny, saveDealsForKey,
} from "./_trade-deals.mjs";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__", "trade-deals");
/** @param {string} name @returns {{ meta: any; items: any[] }} */
const fx = (name) => JSON.parse(readFileSync(path.join(DIR, name), "utf8"));

const SALE = fx("sale-11680-202608.json");
const RENT = fx("rent-11680-202608.json");
const PRESALE = fx("presale-12300-202605.json");
const HWASEONG = fx("sale-hwaseong-41597-202608.json");

/**
 * @param {any[]} items
 * @param {{ type: "sale"|"jeonse"|"presale"; region: string; gu: string; sggCd: string; month: string }} ctx
 */
const buildAll = (items, ctx) => items.map((it) => buildDealRow(it, ctx));

describe("getTagAny — XML 과 칸 객체가 같은 값을 준다", () => {
  it("XML 문자열 · 객체 · 없는 칸", () => {
    const xml = "<item><aptSeq>11680-379</aptSeq><umdCd> 11000 </umdCd><aptDong></aptDong></item>";
    expect(getTagAny(xml, "aptSeq")).toBe("11680-379");
    expect(getTagAny(xml, "umdCd")).toBe("11000");
    expect(getTagAny(xml, "aptDong")).toBe("");
    expect(getTagAny(xml, "nope")).toBe("");
    expect(getTagAny({ aptSeq: "11680-379" }, "aptSeq")).toBe("11680-379");
    expect(getTagAny({}, "aptSeq")).toBe("");
  });
});

describe("buildDealRow — 매매 사본", () => {
  const ctx = /** @type {const} */ ({ type: "sale", region: "서울", gu: "강남구", sggCd: "11680", month: "202608" });
  const rows = buildAll(SALE.items, ctx);

  it("50행 전부 저장 대상 · apt_seq·umd_cd·jibun·deal_day 전부 채움", () => {
    expect(rows.filter(Boolean)).toHaveLength(50);
    for (const r of rows) {
      expect(r?.apt_seq).toMatch(/^11680-\d+$/);
      expect(r?.umd_cd).toMatch(/^\d{5}$/);
      expect(r?.jibun).toBeTruthy();
      expect(r?.deal_day).toBeGreaterThan(0);
    }
    // aptDong 은 원문에 칸은 있지만 대부분 빈칸 — 빈칸은 null, 값 있는 3행만 채움
    expect(rows.filter((r) => r?.apt_dong).length).toBe(3);
  });

  it("첫 행 값 그대로(한양2 · 압구정동 493 · 79억 · 147.41㎡)", () => {
    expect(rows[0]).toEqual({
      trade_type: "sale", region: "서울", gu: "강남구", sgg_cd: "11680",
      umd_cd: "11000", umd_nm: "압구정동", jibun: "493", jibun_main: "493", jibun_sub: "0",
      apt_seq: "11680-379", apt_name: "한양2", apt_dong: null,
      deal_month: "202608", deal_day: 29, area: 147.41, floor: 12, build_year: 1978, price: 790000,
      contract_type: null, dealing_type: "중개거래", cancel_date: null,
    });
  });

  it("면적은 trades 와 같은 반올림(소수 둘째) · 금액 쉼표 제거", () => {
    const r = buildDealRow({ dealAmount: "300,000", excluUseAr: "59.9885", jibun: "1032" }, ctx);
    expect(r?.area).toBe(59.99);
    expect(r?.price).toBe(300000);
  });

  it("금액 0·면적 0 은 null", () => {
    expect(buildDealRow({ dealAmount: "0", excluUseAr: "84.9" }, ctx)).toBeNull();
    expect(buildDealRow({ dealAmount: "50,000", excluUseAr: "0" }, ctx)).toBeNull();
    expect(buildDealRow({ dealAmount: "", excluUseAr: "" }, ctx)).toBeNull();
  });

  it("매매 지번은 bonbun·bubun(앞 0 제거) · 없으면 jibun 을 가른다(옛 창구 폴백)", () => {
    expect(buildDealRow({ dealAmount: "1", excluUseAr: "1", bonbun: "0012", bubun: "0003", jibun: "12-3" }, ctx))
      .toMatchObject({ jibun_main: "12", jibun_sub: "3" });
    expect(buildDealRow({ dealAmount: "1", excluUseAr: "1", jibun: "660-1" }, ctx))
      .toMatchObject({ jibun_main: "660", jibun_sub: "1", apt_seq: null, umd_cd: null });
  });
});

describe("buildDealRow — 전월세 사본", () => {
  const ctx = /** @type {const} */ ({ type: "jeonse", region: "서울", gu: "강남구", sggCd: "11680", month: "202608" });
  const rows = buildAll(RENT.items, ctx);

  it("월세 있는 29행은 null · 전세 21행만 남는다", () => {
    const monthly = RENT.items.filter((i) => i.monthlyRent !== "0").length;
    expect(monthly).toBe(29);
    expect(rows.filter(Boolean)).toHaveLength(50 - monthly);
    RENT.items.forEach((it, k) => { if (it.monthlyRent !== "0") expect(rows[k]).toBeNull(); });
  });

  it("전세 행: apt_seq·contract_type 채움 · umd_cd·apt_dong null(원문에 없음)", () => {
    const kept = rows.filter(Boolean);
    for (const r of kept) {
      expect(r?.apt_seq).toMatch(/^11680-\d+$/);
      expect(r?.umd_cd).toBeNull();
      expect(r?.apt_dong).toBeNull();
      expect(r?.dealing_type).toBeNull();
    }
    const first = kept.find((r) => r?.apt_name === "현대7차(73~77,82,85동)");
    expect(first).toMatchObject({
      apt_seq: "11680-421", umd_cd: null, umd_nm: "압구정동", contract_type: "신규",
      jibun: "456", jibun_main: "456", jibun_sub: "0", price: 170000, deal_day: 26,
    });
    // 계약 구분 빈칸은 null(신규/갱신만 글자)
    for (const r of kept) expect([null, "신규", "갱신"]).toContain(r?.contract_type);
  });
});

describe("buildDealRow — 분양권 사본 ('입' = 입주권 제외)", () => {
  const ctx = /** @type {const} */ ({ type: "presale", region: "광주", gu: "북구", sggCd: "12300", month: "202605" });
  const rows = buildAll(PRESALE.items, ctx);

  it("null 행 수 = 사본의 '입' 개수(4) · 나머지 26행 · apt_seq null", () => {
    const ip = PRESALE.items.filter((i) => i.ownershipGbn === "입").length;
    expect(ip).toBe(4);
    expect(rows.filter((r) => r === null)).toHaveLength(ip);
    PRESALE.items.forEach((it, k) => {
      expect(rows[k] === null).toBe(it.ownershipGbn === "입");
    });
    for (const r of rows.filter(Boolean)) {
      expect(r?.apt_seq).toBeNull();
      expect(r?.umd_cd).toBeNull();
      expect(r?.umd_nm).toBeTruthy();
    }
  });

  it("isOwnershipRight — 공백 섞여도 '입' · 빈칸·매매·전세는 false", () => {
    expect(isOwnershipRight({ ownershipGbn: " 입 " })).toBe(true);
    expect(isOwnershipRight({ ownershipGbn: "" })).toBe(false);
    expect(isOwnershipRight(SALE.items[0])).toBe(false);
    expect(isOwnershipRight("<item><ownershipGbn>입</ownershipGbn></item>")).toBe(true);
  });

  it("'입' 판정은 분양권에만 — 같은 item 을 매매로 넘기면 남는다", () => {
    const ipItem = PRESALE.items.find((i) => i.ownershipGbn === "입");
    expect(buildDealRow(ipItem, { ...ctx, type: "sale" })).not.toBeNull();
  });

  it("숫자 지번이 아니면(블록 표기 등) 본번·부번 null, jibun 원문은 그대로", () => {
    const odd = rows.filter((r) => r && r.jibun && !/^\d+(-\d+)?$/.test(r.jibun));
    expect(odd.length).toBeGreaterThan(0);
    for (const r of odd) { expect(r?.jibun_main).toBeNull(); expect(r?.jibun_sub).toBeNull(); }
  });
});

describe("buildDealRow — 화성 새 코드 사본(41597 동탄구) — 양성 대조군", () => {
  it("sgg_cd = 넘긴 코드 · gu = '화성시'", () => {
    const rows = buildAll(HWASEONG.items, { type: "sale", region: "경기", gu: "화성시", sggCd: "41597", month: "202608" });
    expect(rows.filter(Boolean)).toHaveLength(50);
    for (const r of rows) { expect(r?.sgg_cd).toBe("41597"); expect(r?.gu).toBe("화성시"); }
  });
});

describe("dealKey · planReplace", () => {
  it("dealKey 글자", () => expect(dealKey("41597", "202608", "sale")).toBe("41597|202608|sale"));

  it("기존 0개 → 지울 것 없음", () => {
    expect(planReplace([], "NEW")).toEqual({ keepBatchId: null, staleBatchIds: [], deleteBatchIds: [] });
  });

  it("기존 1개 → 저장 전엔 그대로, 저장 뒤 그것을 지운다", () => {
    expect(planReplace([{ batch_id: "A", recorded_at: "2026-09-06T05:30:00Z" }], "NEW"))
      .toEqual({ keepBatchId: "A", staleBatchIds: [], deleteBatchIds: ["A"] });
  });

  it("기존 2개(지난 회차가 죽은 흔적) → 가장 새 것만 남기고, 저장 뒤 새 것 제외 전부", () => {
    const p = planReplace([
      { batch_id: "OLD", recorded_at: "2026-08-06T05:30:00Z" },
      { batch_id: "MID", recorded_at: "2026-09-06T05:30:00Z" },
      { batch_id: "OLD", recorded_at: "2026-08-06T05:31:00Z" },
    ], "NEW");
    expect(p).toEqual({ keepBatchId: "MID", staleBatchIds: ["OLD"], deleteBatchIds: ["MID", "OLD"] });
  });

  it("목록에 새 batch 가 섞여 있어도 지울 것에 넣지 않는다", () => {
    expect(planReplace([{ batch_id: "NEW", recorded_at: "2026-10-03T00:00:00Z" }], "NEW").deleteBatchIds).toEqual([]);
  });
});

// ── saveDealsForKey — 메모리 가짜 supabase 로 교체 방식 증명 ────────────────
/**
 * trade_deals 하나만 흉내 낸다. select→match/neq/order/limit, insert, delete({count})→match/neq.
 * failInsertAt = n 번째 insert 호출(0부터)을 실패로. failFinalDelete = 마지막 delete 실패.
 * @param {any[]} seed
 * @param {{ failInsertAt?: number; failFinalDelete?: boolean }} [opt]
 */
function fakeSb(seed, opt = {}) {
  const state = { rows: seed.map((r, i) => ({ ...r, id: i + 1 })), clock: 1000, insertCalls: 0, deleteCalls: 0 };
  /** @param {any} r @param {Record<string, any>} eq @param {Array<[string, any]>} neq */
  const hit = (r, eq, neq) => Object.entries(eq).every(([k, v]) => r[k] === v) && neq.every(([k, v]) => r[k] !== v);
  const sb = {
    state,
    from() {
      return {
        select() {
          /** @type {Record<string, any>} */
          const eq = {};
          /** @type {Array<[string, any]>} */
          const ne = [];
          let desc = false; let lim = Infinity;
          const q = {
            match(/** @type {any} */ o) { Object.assign(eq, o); return q; },
            neq(/** @type {string} */ k, /** @type {any} */ v) { ne.push([k, v]); return q; },
            order(/** @type {string} */ _c, /** @type {any} */ o) { desc = !o?.ascending; return q; },
            limit(/** @type {number} */ n) { lim = n; return q; },
            then(/** @type {any} */ res) {
              const out = state.rows.filter((r) => hit(r, eq, ne))
                .sort((a, b) => (desc ? b.recorded_at - a.recorded_at : a.recorded_at - b.recorded_at)).slice(0, lim);
              return Promise.resolve({ data: out, error: null }).then(res);
            },
          };
          return q;
        },
        insert(/** @type {any[]} */ chunk) {
          const n = state.insertCalls++;
          if (opt.failInsertAt === n) return Promise.resolve({ error: { message: "boom" } });
          const t = ++state.clock;
          for (const r of chunk) state.rows.push({ ...r, id: state.rows.length + 1, recorded_at: t });
          return Promise.resolve({ error: null });
        },
        delete() {
          /** @type {Record<string, any>} */
          const eq = {};
          /** @type {Array<[string, any]>} */
          const ne = [];
          state.deleteCalls++;
          const q = {
            match(/** @type {any} */ o) { Object.assign(eq, o); return q; },
            neq(/** @type {string} */ k, /** @type {any} */ v) { ne.push([k, v]); return q; },
            then(/** @type {any} */ res) {
              // 마지막 지우기 = "이번 batch 가 아닌 것"(neq batch_id NEW)
              if (opt.failFinalDelete && ne.some(([k, v]) => k === "batch_id" && v === "NEW")) {
                return Promise.resolve({ error: { message: "delete boom" }, count: null }).then(res);
              }
              const before = state.rows.length;
              state.rows = state.rows.filter((r) => !hit(r, eq, ne));
              return Promise.resolve({ error: null, count: before - state.rows.length }).then(res);
            },
          };
          return q;
        },
      };
    },
  };
  return sb;
}

const KEY = { sgg_cd: "41597", deal_month: "202608", trade_type: "sale" };
const OTHER = { sgg_cd: "41595", deal_month: "202608", trade_type: "sale" };
/** @param {number} n */
const newRows = (n) => Array.from({ length: n }, (_, i) => /** @type {any} */ ({ ...KEY, price: 1000 + i }));
const noSleep = async () => {};
/** @param {any} sb @param {any} key */
const batchesOf = (sb, key) => [...new Set(sb.state.rows.filter((/** @type {any} */ r) =>
  r.sgg_cd === key.sgg_cd && r.deal_month === key.deal_month && r.trade_type === key.trade_type).map((/** @type {any} */ r) => r.batch_id))];

describe("saveDealsForKey — 교체 방식", () => {
  it("죽은 회차 흔적(OLD·MID) + 새 회차 → 새 것만 남는다 · 다른 열쇠는 그대로", async () => {
    const sb = fakeSb([
      ...Array.from({ length: 3 }, () => ({ ...KEY, batch_id: "OLD", recorded_at: 10 })),
      ...Array.from({ length: 2 }, () => ({ ...KEY, batch_id: "MID", recorded_at: 20 })),
      { ...OTHER, batch_id: "OLD", recorded_at: 10 },
    ]);
    const res = await saveDealsForKey(sb, KEY, newRows(1203), "NEW", { sleep: noSleep });
    expect(res).toEqual({ status: "ok", inserted: 1203, deleted: 2, staleDeleted: 3 });
    expect(batchesOf(sb, KEY)).toEqual(["NEW"]);
    expect(sb.state.insertCalls).toBe(3); // 500 · 500 · 203
    expect(batchesOf(sb, OTHER)).toEqual(["OLD"]);
  });

  it("새 행 0건이면 조회·쓰기·지우기 전부 안 한다(옛 회차 그대로)", async () => {
    const sb = fakeSb([{ ...KEY, batch_id: "OLD", recorded_at: 10 }]);
    const res = await saveDealsForKey(sb, KEY, [], "NEW", { sleep: noSleep });
    expect(res.status).toBe("empty");
    expect(sb.state.deleteCalls).toBe(0);
    expect(batchesOf(sb, KEY)).toEqual(["OLD"]);
  });

  it("insert 가 중간에 실패하면 이번 batch 를 되돌리고 옛 회차를 남긴다(재시도 3회)", async () => {
    const sb = fakeSb([{ ...KEY, batch_id: "OLD", recorded_at: 10 }], { failInsertAt: 1 });
    // failInsertAt=1 → 두 번째 배치의 첫 시도만 실패 → 재시도로 성공해야 한다
    const ok = await saveDealsForKey(sb, KEY, newRows(600), "NEW", { sleep: noSleep });
    expect(ok.status).toBe("ok");
    expect(batchesOf(sb, KEY)).toEqual(["NEW"]);

    // 매번 실패하는 경우
    const sb2 = fakeSb([{ ...KEY, batch_id: "OLD", recorded_at: 10 }]);
    const realFrom = sb2.from;
    let calls = 0;
    sb2.from = () => {
      const f = realFrom();
      const ins = f.insert;
      f.insert = (/** @type {any[]} */ c) => (++calls >= 2 ? Promise.resolve({ error: { message: "boom" } }) : ins(c));
      return f;
    };
    const bad = await saveDealsForKey(sb2, KEY, newRows(600), "NEW", { sleep: noSleep });
    expect(bad.status).toBe("fail");
    expect(bad.error).toMatch(/이번 회차분 되돌림/);
    expect(calls).toBe(4); // 첫 배치 1 + 둘째 배치 3회 시도
    expect(batchesOf(sb2, KEY)).toEqual(["OLD"]);
  });

  it("마지막 지우기가 실패하면 fail — 새 batch 는 남고(가장 새 것이라 읽기 정상) 옛 것도 남는다", async () => {
    const sb = fakeSb([{ ...KEY, batch_id: "OLD", recorded_at: 10 }], { failFinalDelete: true });
    const res = await saveDealsForKey(sb, KEY, newRows(5), "NEW", { sleep: noSleep });
    expect(res.status).toBe("fail");
    expect(batchesOf(sb, KEY).sort()).toEqual(["NEW", "OLD"]);
  });
});
