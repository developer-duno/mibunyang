// @ts-check
/**
 * `_trade-deals.mjs` 시험 — 픽스처는 조사 2차가 받아 둔 **실제 국토부 응답 사본**(세션589,
 * `.omc/artifacts/session589/scope/research2/raw/`)을 50행 이내로 자른 것이다.
 *   sale-11680-202608          매매(RTMSDataSvcAptTradeDev) 강남 · 50/95
 *   rent-11680-202608          전월세(RTMSDataSvcAptRent) 강남 · 50/1139(월세 29 · 전세 21)
 *   presale-12300-202605       분양권(RTMSDataSvcSilvTrade) 광주·전남 12300 · 30/30("입" 4 · 해제 2)
 *   sale-hwaseong-41597-202608 매매 화성 동탄구 새 코드 · 50/139
 *   sale-odd-jibun             매매 원문 중 landCd ≠ 1(산 2 · BL-n 5 · 가- 3 · 지구BL 7) 11행 — 사본 36,788행 중 206행이 이 꼴
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildDealRow, isOwnershipRight, dealKey, planReplace, getTagAny, saveDealsForKey, isMissingTable, DEAL_DROP_RATIO,
  keepNewestCompleteBatches, fetchTradeDealsWindow,
} from "./_trade-deals.mjs";
import { fakeSb, fakeClock, batchCounts } from "./__fixtures__/trade-deals/fake-sb.mjs";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__", "trade-deals");
/** @param {string} name @returns {{ meta: any; items: any[] }} */
const fx = (name) => JSON.parse(readFileSync(path.join(DIR, name), "utf8"));

const SALE = fx("sale-11680-202608.json");
const RENT = fx("rent-11680-202608.json");
const PRESALE = fx("presale-12300-202605.json");
const HWASEONG = fx("sale-hwaseong-41597-202608.json");
const ODD = fx("sale-odd-jibun.json");

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
    expect(rows.filter((r) => r?.apt_dong).length).toBe(3);
  });

  it("첫 행 값 그대로(한양2 · 압구정동 493 · 79억 · 147.41㎡ · 압구정로 347)", () => {
    expect(rows[0]).toEqual({
      trade_type: "sale", region: "서울", gu: "강남구", sgg_cd: "11680",
      umd_cd: "11000", umd_nm: "압구정동", jibun: "493", jibun_main: "493", jibun_sub: "0",
      road_nm: "압구정로", road_bonbun: "347", road_bubun: null,
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
});

describe("지번 본번·부번 — 세 종류가 같은 원문에 같은 답(검사관 A 지적 3)", () => {
  const sale = /** @type {const} */ ({ type: "sale", region: "서울", gu: "강남구", sggCd: "11680", month: "202608" });
  /** landCd·bonbun 을 뺀 같은 원문 = 전월세·분양권·옛 매매 창구가 보는 꼴 @param {any} it */
  const jibunOnly = (it) => ({ dealAmount: it.dealAmount, excluUseAr: it.excluUseAr, jibun: it.jibun });

  it("landCd 1 인 매매 50행: bonbun/bubun 길과 jibun 가르기 길이 같은 답", () => {
    for (const it of SALE.items) {
      expect(it.landCd).toBe("1");
      const a = buildDealRow(it, sale);
      const b = buildDealRow(jibunOnly(it), sale);
      expect([a?.jibun_main, a?.jibun_sub]).toEqual([b?.jibun_main, b?.jibun_sub]);
      expect(a?.jibun_main).toMatch(/^[1-9]\d*$/);
    }
  });

  it("landCd ≠ 1(산·BL-n·가-·지구BL) 은 bonbun 이 있어도 둘 다 null — 산·블록·가-류 각 1행 이상", () => {
    const byLand = new Map();
    for (const it of ODD.items) {
      const r = buildDealRow(it, sale);
      expect(r?.jibun_main).toBeNull();
      expect(r?.jibun_sub).toBeNull();
      expect(r?.jibun).toBe(it.jibun); // 원문 지번은 그대로 남는다
      // 같은 원문을 jibun 만으로 봐도(전월세·분양권 길) 같은 답
      const b = buildDealRow(jibunOnly(it), sale);
      expect([b?.jibun_main, b?.jibun_sub]).toEqual([null, null]);
      byLand.set(it.landCd, (byLand.get(it.landCd) ?? 0) + 1);
    }
    expect(ODD.items.find((i) => i.jibun === "산96-8" && i.bonbun === "0096")).toBeTruthy(); // bonbun 은 있다 — 쓰면 '산' 이 사라진다
    for (const c of ["2", "3", "5", "7"]) expect(byLand.get(c) ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("jibun 가르기: '734' → 734/0 · '660-1' → 660/1 · '0'·'A4BL'·'산12' → null", () => {
    const j = (/** @type {string} */ s) => {
      const r = buildDealRow({ dealAmount: "1", excluUseAr: "1", jibun: s }, { ...sale, type: "presale" });
      return [r?.jibun_main, r?.jibun_sub];
    };
    expect(j("734")).toEqual(["734", "0"]);
    expect(j("660-1")).toEqual(["660", "1"]);
    expect(j("0")).toEqual([null, null]);
    expect(j("A4BL")).toEqual([null, null]);
    expect(j("산12")).toEqual([null, null]);
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

  it("전세 행: apt_seq·contract_type 채움 · umd_cd·apt_dong·거래구분·해제일 null(원문에 없음)", () => {
    const kept = rows.filter(Boolean);
    for (const r of kept) {
      expect(r?.apt_seq).toMatch(/^11680-\d+$/);
      expect(r?.umd_cd).toBeNull();
      expect(r?.apt_dong).toBeNull();
      expect(r?.dealing_type).toBeNull();
      expect(r?.cancel_date).toBeNull();
    }
    const first = kept.find((r) => r?.apt_name === "현대7차(73~77,82,85동)");
    expect(first).toMatchObject({
      apt_seq: "11680-421", umd_cd: null, umd_nm: "압구정동", contract_type: "신규",
      jibun: "456", jibun_main: "456", jibun_sub: "0", price: 170000, deal_day: 26,
    });
    for (const r of kept) expect([null, "신규", "갱신"]).toContain(r?.contract_type);
  });

  it("도로명: 전월세 원문은 소문자 칸(roadnm…)이고 건물번호를 붙여 준다 → 떼어 매매와 같은 꼴", () => {
    const it = RENT.items.find((i) => i.aptNm === "현대7차(73~77,82,85동)");
    expect(it.roadnm).toBe("압구정로 201");
    expect(buildDealRow(it, ctx)).toMatchObject({ road_nm: "압구정로", road_bonbun: "201", road_bubun: null });
    const kept = rows.filter(Boolean);
    expect(kept.filter((r) => r?.road_nm).length).toBe(kept.length);
    for (const r of kept) expect(r?.road_nm).not.toMatch(/\s\d+(-\d+)?$/);
  });
});

describe("buildDealRow — 분양권 사본 ('입' = 입주권 제외 · 해제일)", () => {
  const ctx = /** @type {const} */ ({ type: "presale", region: "광주", gu: "북구", sggCd: "12300", month: "202605" });
  const rows = buildAll(PRESALE.items, ctx);

  it("null 행 수 = 사본의 '입' 개수(4) · 나머지 26행 · apt_seq·도로명 null", () => {
    const ip = PRESALE.items.filter((i) => i.ownershipGbn === "입").length;
    expect(ip).toBe(4);
    expect(rows.filter((r) => r === null)).toHaveLength(ip);
    PRESALE.items.forEach((it, k) => {
      expect(rows[k] === null).toBe(it.ownershipGbn === "입");
    });
    for (const r of rows.filter(Boolean)) {
      expect(r?.apt_seq).toBeNull();
      expect(r?.umd_cd).toBeNull();
      expect(r?.road_nm).toBeNull();
      expect(r?.umd_nm).toBeTruthy();
    }
  });

  it("분양권 해제 거래: cancel_date·dealing_type 이 채워진다(검사관 C1)", () => {
    const it = PRESALE.items.find((i) => i.aptNm === "힐스테이트 중외공원 3블록" && i.cdealDay);
    expect(it?.cdealDay).toBe("26.06.11");
    expect(buildDealRow(it, ctx)).toMatchObject({ cancel_date: "26.06.11", dealing_type: "중개거래" });
    expect(rows.filter((r) => r?.cancel_date).length).toBe(2);
    expect(rows.filter((r) => r?.dealing_type).length).toBe(26);
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
});

describe("buildDealRow — 화성 새 코드 사본(41597 동탄구) — 양성 대조군", () => {
  it("sgg_cd = 넘긴 코드 · gu = '화성시'", () => {
    const rows = buildAll(HWASEONG.items, { type: "sale", region: "경기", gu: "화성시", sggCd: "41597", month: "202608" });
    expect(rows.filter(Boolean)).toHaveLength(50);
    for (const r of rows) { expect(r?.sgg_cd).toBe("41597"); expect(r?.gu).toBe("화성시"); }
  });
});

describe("dealKey · planReplace(완성 = 행 수 = batch_rows)", () => {
  it("dealKey 글자", () => expect(dealKey("41597", "202608", "sale")).toBe("41597|202608|sale"));

  it("기존 0개 → 지울 것 없음", () => {
    expect(planReplace([], "NEW")).toEqual({ keepBatchId: null, keepRows: 0, staleBatchIds: [], deleteBatchIds: [] });
  });

  it("기존 완성 1개 → 그대로 남기고(저장 전), 저장 뒤 지울 대상", () => {
    expect(planReplace([{ batch_id: "A", recorded_at: "2026-09-06T05:30:00Z", batch_rows: 5, count: 5 }], "NEW"))
      .toEqual({ keepBatchId: "A", keepRows: 5, staleBatchIds: [], deleteBatchIds: ["A"] });
  });

  it("가장 새 것이 반쪽(X 2/5) · 옛 완성 O(5/5) → O 를 남기고 X 를 지운다(검사관 A 지적 2)", () => {
    expect(planReplace([
      { batch_id: "X", recorded_at: "2026-09-20T00:00:00Z", batch_rows: 5, count: 2 },
      { batch_id: "O", recorded_at: "2026-09-06T00:00:00Z", batch_rows: 5, count: 5 },
    ], "NEW")).toEqual({ keepBatchId: "O", keepRows: 5, staleBatchIds: ["X"], deleteBatchIds: ["X", "O"] });
  });

  it("batch 3개(완성 A·완성 B·반쪽 C) → 가장 새 완성 B 만 남긴다(정렬 방향 가드)", () => {
    const p = planReplace([
      { batch_id: "A", recorded_at: "2026-08-06T00:00:00Z", batch_rows: 3, count: 3 },
      { batch_id: "C", recorded_at: "2026-10-06T00:00:00Z", batch_rows: 9, count: 4 },
      { batch_id: "B", recorded_at: "2026-09-06T00:00:00Z", batch_rows: 7, count: 7 },
    ], "NEW");
    expect(p).toEqual({ keepBatchId: "B", keepRows: 7, staleBatchIds: ["C", "A"], deleteBatchIds: ["C", "B", "A"] });
  });

  it("batch_rows 가 없는 batch(표지 없음)는 완성으로 안 본다 · 새 batch 는 지울 것에 넣지 않는다", () => {
    expect(planReplace([{ batch_id: "Q", recorded_at: "2026-09-06T00:00:00Z", batch_rows: null, count: 4 }], "NEW").keepBatchId).toBeNull();
    expect(planReplace([{ batch_id: "NEW", recorded_at: "2026-10-03T00:00:00Z", batch_rows: 1, count: 1 }], "NEW").deleteBatchIds).toEqual([]);
  });
});

// ── saveDealsForKey — 메모리 가짜 supabase 로 교체 방식 증명 ────────────────
const KEY = { sgg_cd: "41597", deal_month: "202608", trade_type: "sale" };
const OTHER_CODE = { sgg_cd: "41595", deal_month: "202608", trade_type: "sale" };
const OTHER_MONTH = { sgg_cd: "41597", deal_month: "202607", trade_type: "sale" };
const OTHER_TYPE = { sgg_cd: "41597", deal_month: "202608", trade_type: "jeonse" };
const OLD_T = "2026-09-06T05:40:00.000Z";
/** @param {number} n @param {any} [key] */
const newRows = (n, key = KEY) => Array.from({ length: n }, (_, i) => /** @type {any} */ ({ ...key, price: 1000 + i }));
/** 완성 batch 흔적 @param {any} key @param {string} batch @param {number} n @param {string} [t] @param {number} [want] */
const seedBatch = (key, batch, n, t = OLD_T, want = n) => Array.from({ length: n }, () => ({ ...key, batch_id: batch, batch_rows: want, recorded_at: t }));
const noSleep = async () => {};

describe("saveDealsForKey — 교체 방식", () => {
  it("완성 O + 반쪽 X + 새 회차 → 새 것만 남는다 · 다른 코드·다른 달·다른 종류는 그대로", async () => {
    const sb = fakeSb([
      ...seedBatch(KEY, "O", 3, "2026-08-06T05:40:00.000Z"),
      ...seedBatch(KEY, "X", 2, OLD_T, 5),
      ...seedBatch(OTHER_CODE, "O", 4),
      ...seedBatch(OTHER_MONTH, "O", 6),
      ...seedBatch(OTHER_TYPE, "O", 7),
    ]);
    const res = await saveDealsForKey(sb, KEY, newRows(1203), "NEW", { sleep: noSleep, now: fakeClock() });
    expect(res).toMatchObject({ status: "ok", inserted: 1203, deleted: 3, staleDeleted: 2 });
    expect(batchCounts(sb, KEY)).toEqual({ NEW: 1203 });
    expect(sb.state.insertCalls).toBe(3); // 500 · 500 · 203
    expect(sb.state.rows.filter((/** @type {any} */ r) => r.batch_id === "NEW").every((/** @type {any} */ r) => r.batch_rows === 1203)).toBe(true);
    expect(batchCounts(sb, OTHER_CODE)).toEqual({ O: 4 });
    expect(batchCounts(sb, OTHER_MONTH)).toEqual({ O: 6 });
    expect(batchCounts(sb, OTHER_TYPE)).toEqual({ O: 7 });
  });

  it("탐침 재현: 완성 O 5 + 반쪽 X 2 → 다음 회차 insert 실패 → O 가 남는다(검사관 A 지적 2)", async () => {
    const sb = fakeSb([...seedBatch(KEY, "O", 5, "2026-08-06T05:40:00.000Z"), ...seedBatch(KEY, "X", 2, OLD_T, 5)],
      { failInsert: (chunk) => chunk[0]?.batch_id === "Y" });
    const res = await saveDealsForKey(sb, KEY, newRows(5), "Y", { sleep: noSleep, now: fakeClock() });
    expect(res.status).toBe("fail");
    expect(batchCounts(sb, KEY)).toEqual({ O: 5 });
  });

  it("새 행 0건이면 조회·쓰기·지우기 전부 안 한다(옛 회차 그대로)", async () => {
    const sb = fakeSb(seedBatch(KEY, "OLD", 1));
    const res = await saveDealsForKey(sb, KEY, [], "NEW", { sleep: noSleep });
    expect(res.status).toBe("empty");
    expect(sb.state.fromCalls).toBe(0);
    expect(batchCounts(sb, KEY)).toEqual({ OLD: 1 });
  });

  it("되돌리기는 그 열쇠만 — 같은 batch 로 먼저 저장한 다른 열쇠는 남는다", async () => {
    const sb = fakeSb([], { failInsert: (chunk) => chunk[0]?.sgg_cd === "41595" });
    const clock = fakeClock();
    const ok = await saveDealsForKey(sb, KEY, newRows(3), "NEW", { sleep: noSleep, now: clock });
    const bad = await saveDealsForKey(sb, OTHER_CODE, newRows(3, OTHER_CODE), "NEW", { sleep: noSleep, now: clock });
    expect(ok.status).toBe("ok");
    expect(bad.status).toBe("fail");
    expect(bad.error).toMatch(/이번 회차분 되돌림/);
    expect(batchCounts(sb, KEY)).toEqual({ NEW: 3 });
    expect(batchCounts(sb, OTHER_CODE)).toEqual({});
  });

  it("insert 가 계속 실패하면 3회 시도 뒤 되돌리고 옛 회차를 남긴다 · 한 번만 실패하면 재시도로 성공", async () => {
    const sb = fakeSb(seedBatch(KEY, "OLD", 1), { failInsert: (_c, n) => n === 1 });
    const ok = await saveDealsForKey(sb, KEY, newRows(600), "NEW", { sleep: noSleep, now: fakeClock() });
    expect(ok.status).toBe("ok");
    expect(batchCounts(sb, KEY)).toEqual({ NEW: 600 });

    const sb2 = fakeSb(seedBatch(KEY, "OLD", 1), { failInsert: (_c, n) => n >= 1 });
    const bad = await saveDealsForKey(sb2, KEY, newRows(600), "NEW", { sleep: noSleep, now: fakeClock() });
    expect(bad.status).toBe("fail");
    expect(sb2.state.insertCalls).toBe(4); // 첫 배치 1 + 둘째 배치 3회
    expect(batchCounts(sb2, KEY)).toEqual({ OLD: 1 });
  });

  it("조회가 한 번 흔들려도 재시도로 성공한다(검사관 C7)", async () => {
    const sb = fakeSb(seedBatch(KEY, "OLD", 2), { failSelectTimes: 1 });
    const res = await saveDealsForKey(sb, KEY, newRows(2), "NEW", { sleep: noSleep, now: fakeClock() });
    expect(res.status).toBe("ok");
    expect(batchCounts(sb, KEY)).toEqual({ NEW: 2 });
  });

  it("마지막 지우기가 실패하면 경고(실패 아님) — 새 완성 batch 와 옛 것이 남는다(검사관 C7)", async () => {
    const sb = fakeSb(seedBatch(KEY, "OLD", 1), { failDelete: (f) => f.ne.some(([k, v]) => k === "batch_id" && v === "NEW") });
    const res = await saveDealsForKey(sb, KEY, newRows(5), "NEW", { sleep: noSleep, now: fakeClock() });
    expect(res.status).toBe("ok");
    expect(res.warn).toMatch(/옛 회차 지우기 실패/);
    expect(batchCounts(sb, KEY)).toEqual({ NEW: 5, OLD: 1 });
  });

  it("넣기 응답만 오류(서버엔 들어감) → 재시도 중복으로 행 수가 넘치면 되돌리고 fail — 옛 완성 O 600 이 남는다(검사관 B 지적 1)", async () => {
    const sb = fakeSb(seedBatch(KEY, "O", 600, "2026-08-06T05:40:00.000Z"), { commitThenError: (chunk, n) => chunk[0]?.batch_id === "N" && n === 0 });
    const res = await saveDealsForKey(sb, KEY, newRows(600), "N", { sleep: noSleep, now: fakeClock() });
    expect(res.status).toBe("fail");
    expect(res.error).toMatch(/행 수 1100 ≠ batch_rows 600/);
    expect(batchCounts(sb, KEY)).toEqual({ O: 600 });
  });

  it("① 흔적 지우기는 이번 회차 시작 뒤에 든 batch(늦게 시작한 B 의 진행 중 반쪽)를 안 지운다(검사관 B 지적 4)", async () => {
    const sb = fakeSb([
      ...seedBatch(KEY, "O", 4, "2026-08-06T05:40:00.000Z"),
      ...seedBatch(KEY, "B", 2, "2026-10-06T00:00:30.000Z", 5), // A 보다 늦게(00:00:30) 시작해 5행 중 2행까지 넣은 B
    ]);
    const res = await saveDealsForKey(sb, KEY, newRows(4), "A", {
      sleep: noSleep, runStartedAt: "2026-10-06T00:00:10.000Z", now: fakeClock(Date.UTC(2026, 9, 6, 0, 1, 0)),
    });
    expect(res.status).toBe("ok");
    expect(batchCounts(sb, KEY)).toEqual({ B: 2, A: 4 }); // O 는 ④ 가 지우고, B 는 ①·④ 둘 다 남긴다
  });

  it(`급감 차단기: 완성본 100행인데 새 행 ${100 * DEAL_DROP_RATIO - 1}행 → 보류(옛 것 유지) · 절반 이상이면 교체`, async () => {
    const sb = fakeSb(seedBatch(KEY, "OLD", 100));
    const held = await saveDealsForKey(sb, KEY, newRows(49), "NEW", { sleep: noSleep, now: fakeClock() });
    expect(held).toMatchObject({ status: "held", keepRows: 100 });
    expect(sb.state.insertCalls).toBe(0);
    expect(batchCounts(sb, KEY)).toEqual({ OLD: 100 });
    const ok = await saveDealsForKey(sb, KEY, newRows(50), "NEW2", { sleep: noSleep, now: fakeClock() });
    expect(ok.status).toBe("ok");
    expect(batchCounts(sb, KEY)).toEqual({ NEW2: 50 });
  });

  it("표가 없으면(PGRST205) 재시도 없이 no-table 한 번", async () => {
    const sb = fakeSb([], { missingTable: true });
    const res = await saveDealsForKey(sb, KEY, newRows(3), "NEW", { sleep: noSleep });
    expect(res.status).toBe("no-table");
    expect(sb.state.selectCalls).toBe(1);
    expect(isMissingTable({ code: "PGRST205", message: "x" })).toBe(true);
    expect(isMissingTable({ code: "42P01", message: "relation \"trade_deals\" does not exist" })).toBe(true);
    expect(isMissingTable({ code: "57014", message: "statement timeout" })).toBe(false);
  });

  it("동시에 도는 두 회차(같은 열쇠, 시작 차이 0~25틱) — 어떤 차이에서도 행이 0 이 되지 않고 완성 batch 가 남는다(검사관 A 지적 1)", async () => {
    const tick = () => new Promise((r) => setImmediate(r));
    for (const lag of [0, 1, 3, 8, 15, 25]) {
      const sb = fakeSb(seedBatch(KEY, "O", 1000, "2026-08-06T05:40:00.000Z"));
      const clock = fakeClock();
      const pX = saveDealsForKey(sb, KEY, newRows(1000), "X", { batchSize: 100, sleep: noSleep, now: clock });
      for (let i = 0; i < lag; i++) await tick();
      const pY = saveDealsForKey(sb, KEY, newRows(1000), "Y", { batchSize: 100, sleep: noSleep, now: clock });
      await Promise.all([pX, pY]);
      const counts = batchCounts(sb, KEY);
      const complete = Object.entries(counts).filter(([, n]) => n === 1000).map(([b]) => b);
      expect(sb.state.rows.length, `lag=${lag} ${JSON.stringify(counts)}`).toBeGreaterThan(0);
      expect(complete.length, `lag=${lag} ${JSON.stringify(counts)}`).toBeGreaterThanOrEqual(1);
    }
  });
});

// ── 읽는 쪽: 열쇠마다 가장 새 완성 batch 만 (시세 비교 범위 좁히기 나, 세션590) ──
describe("keepNewestCompleteBatches — 반쪽 batch 는 읽지 않는다", () => {
  /**
   * @param {string} sgg @param {string} month @param {string} type @param {string} batch
   * @param {number} n 실제로 넣을 행 수 @param {number} batchRows 완성 표시 @param {string} at
   */
  const mk = (sgg, month, type, batch, n, batchRows, at) =>
    Array.from({ length: n }, (_, i) => ({ sgg_cd: sgg, deal_month: month, trade_type: type, batch_id: batch, batch_rows: batchRows, recorded_at: at, i }));
  const ids = (/** @type {any[]} */ rows) => [...new Set(rows.map((r) => r.batch_id))].sort();

  it("완성 하나 → 그대로", () => {
    const res = keepNewestCompleteBatches(mk("41591", "202608", "sale", "A", 3, 3, "2026-10-01T00:00:00Z"));
    expect(res.rows.length).toBe(3);
    expect(res.droppedKeys).toEqual([]);
  });

  it("완성 둘 → recorded_at 이 늦은 것만", () => {
    const rows = [
      ...mk("41591", "202608", "sale", "OLD", 4, 4, "2026-09-06T05:30:00Z"),
      ...mk("41591", "202608", "sale", "NEW", 5, 5, "2026-10-03T05:30:00Z"),
    ];
    const res = keepNewestCompleteBatches(rows);
    expect(ids(res.rows)).toEqual(["NEW"]);
    expect(res.rows.length).toBe(5);
  });

  it("미완성만(행 2 ≠ batch_rows 5) → 그 열쇠는 통째로 빠지고 droppedKeys 에 남는다", () => {
    const res = keepNewestCompleteBatches(mk("41591", "202608", "jeonse", "HALF", 2, 5, "2026-10-03T05:30:00Z"));
    expect(res.rows).toEqual([]);
    expect(res.droppedKeys).toEqual(["41591|202608|jeonse"]);
  });

  it("완성(옛) + 미완성(새) → 완성만 — 반쪽 batch 가 더 새로워도 읽지 않는다", () => {
    const rows = [
      ...mk("41591", "202608", "sale", "DONE", 3, 3, "2026-09-06T05:30:00Z"),
      ...mk("41591", "202608", "sale", "HALF", 4, 6, "2026-10-03T05:30:00Z"),
    ];
    const res = keepNewestCompleteBatches(rows);
    expect(ids(res.rows)).toEqual(["DONE"]);
    expect(res.droppedKeys).toEqual([]);
  });

  it("행 수가 batch_rows 보다 많은 batch(재시도로 넘침)도 미완성", () => {
    const res = keepNewestCompleteBatches(mk("41591", "202608", "sale", "OVER", 6, 5, "2026-10-03T05:30:00Z"));
    expect(res.rows).toEqual([]);
  });

  it("열쇠 셋 섞임 — 열쇠마다 따로 고른다", () => {
    const rows = [
      ...mk("41591", "202608", "sale", "A1", 2, 2, "2026-09-06T00:00:00Z"),
      ...mk("41591", "202608", "sale", "A2", 3, 3, "2026-10-03T00:00:00Z"),
      ...mk("41591", "202608", "jeonse", "B1", 2, 2, "2026-10-03T00:00:00Z"),
      ...mk("41593", "202608", "sale", "C1", 1, 3, "2026-10-03T00:00:00Z"),
      ...mk("41591", "202607", "sale", "D1", 2, 2, "2026-10-03T00:00:00Z"),
    ];
    const res = keepNewestCompleteBatches(rows);
    expect(ids(res.rows)).toEqual(["A2", "B1", "D1"]);
    expect(res.rows.length).toBe(3 + 2 + 2);
    expect(res.droppedKeys).toEqual(["41593|202608|sale"]);
  });

  it("insert 묶음마다 recorded_at 이 달라도 batch 단위로 센다(최댓값 = batch 시각)", () => {
    const rows = [
      ...mk("41591", "202608", "sale", "X", 2, 4, "2026-10-03T05:30:00Z"),
      ...mk("41591", "202608", "sale", "X", 2, 4, "2026-10-03T05:30:02Z"),
      ...mk("41591", "202608", "sale", "Y", 3, 3, "2026-10-03T05:30:01Z"),
    ];
    expect(ids(keepNewestCompleteBatches(rows).rows)).toEqual(["X"]);
  });
});

describe("fetchTradeDealsWindow — 고유 키 커서 · 완성 batch 만 · 실패는 던진다", () => {
  /** 가짜 supabase: select 칸·필터·커서를 기록하고 id 오름차순으로 pageSize 씩 준다 */
  const fakeWindowSb = (/** @type {any[]} */ table, /** @type {{ error?: any }} */ opt = {}) => {
    const state = { selects: /** @type {string[]} */ ([]), gte: /** @type {any[]} */ ([]), calls: 0 };
    return {
      state,
      from(/** @type {string} */ t) {
        expect(t).toBe("trade_deals");
        /** @type {any} */
        const q = { _gt: null, _lim: 1000, _gte: null };
        q.select = (/** @type {string} */ s) => { state.selects.push(s); return q; };
        q.gte = (/** @type {string} */ c, /** @type {any} */ v) => { q._gte = [c, v]; state.gte.push([c, v]); return q; };
        q.order = (/** @type {string} */ c, /** @type {any} */ o) => { expect(c).toBe("id"); expect(o.ascending).toBe(true); return q; };
        q.limit = (/** @type {number} */ n) => { q._lim = n; return q; };
        q.gt = (/** @type {string} */ c, /** @type {any} */ v) => { expect(c).toBe("id"); q._gt = v; return q; };
        q.then = (/** @type {any} */ res, /** @type {any} */ rej) => {
          state.calls++;
          if (opt.error) return Promise.resolve({ data: null, error: opt.error }).then(res, rej);
          const data = table
            .filter((r) => r.deal_month >= q._gte[1] && (q._gt == null || r.id > q._gt))
            .sort((a, b) => a.id - b.id)
            .slice(0, q._lim)
            .map((r) => ({ ...r }));
          return Promise.resolve({ data, error: null }).then(res, rej);
        };
        return q;
      },
    };
  };
  const row = (/** @type {number} */ id, /** @type {string} */ month, /** @type {string} */ batch, /** @type {number} */ br) =>
    ({ id, sgg_cd: "41591", deal_month: month, trade_type: "sale", batch_id: batch, batch_rows: br, recorded_at: "2026-10-03T05:30:00Z", price: id });

  it("페이지 경계를 넘어 전량 받고(커서) 반쪽 batch 는 뺀다 · 기본 칸을 덧붙인다", async () => {
    const table = [
      ...Array.from({ length: 5 }, (_, i) => row(i + 1, "202608", "OK", 5)),
      ...Array.from({ length: 2 }, (_, i) => row(i + 10, "202607", "HALF", 4)),
      row(20, "202501", "OLDMONTH", 1),
    ];
    const sb = fakeWindowSb(table);
    const res = await fetchTradeDealsWindow(sb, { fromMonth: "202510", cols: "price,apt_seq", pageSize: 3 });
    expect(res.total).toBe(7);
    expect(res.rows.map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
    expect(res.droppedKeys).toEqual(["41591|202607|sale"]);
    expect(sb.state.gte[0]).toEqual(["deal_month", "202510"]);
    for (const c of ["id", "batch_id", "batch_rows", "recorded_at", "sgg_cd", "deal_month", "trade_type", "price", "apt_seq"]) {
      expect(sb.state.selects[0].split(",")).toContain(c);
    }
    expect(sb.state.calls).toBe(3); // 3 + 3 + 1
  });

  it("조회 실패는 던진다(조용한 [] 금지)", async () => {
    const sb = fakeWindowSb([], { error: { message: "statement timeout", code: "57014" } });
    await expect(fetchTradeDealsWindow(sb, { fromMonth: "202510", cols: "price" })).rejects.toThrow(/trade_deals 조회 실패/);
  });

  it("fromMonth 꼴이 틀리면 DB 를 보기 전에 던진다", async () => {
    const sb = fakeWindowSb([]);
    await expect(fetchTradeDealsWindow(sb, { fromMonth: "2025-10", cols: "price" })).rejects.toThrow(/YYYYMM/);
    expect(sb.state.calls).toBe(0);
  });
});
