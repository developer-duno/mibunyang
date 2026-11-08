// @ts-check
/**
 * 미래 기준일 가드 · 상한 표식 읽기 (세션697 👤 결정 ① 「무시+경보」 · ② 「새로 걸린 단지만 알림」 11/04 17:0x)
 *
 *   A1 — _shared.mjs isAsOfFuture · asOfRespectState: 기준일(YYYY-MM-DD)이 오늘 KST 날짜보다 뒤면 「미래」(당일은 아님)
 *   A2 — collect-unsold-kosis: 미래 기준일 applyhome·govlist 는 존중하지 않는다(만료와 같은 길 — KOSIS 가 정함)
 *   B1 — collect-unsold-kosis parseListedCap: KOSIS_LISTED_CAP 표식에서 id 를 뽑는다(formatListedCap 의 짝)
 *   (A3 명단 계획 사유는 _govlist-plan.test.mjs · A4 VIEW 는 _view-unsold-govlist-sql.test.mjs · A5·B2~B4 감시는 monitor-future-asof-cap.test.mjs)
 *
 * 시각은 전부 밖에서 넣는다(`now`) — 시험이 실제 시각에 기대지 않게(flaky-time-check).
 * 기대값 출처 = 지시서 brief-guard.md ③ 표의 예시값(now=2026-11-04T15:00Z = KST 11/05).
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return { ...orig, loadEnv: vi.fn(), getSupabase: vi.fn(), log: vi.fn(), logError: vi.fn() };
});

const { isAsOfFuture, asOfRespectState, kstDayOf, isApplyhomeExpired, APPLYHOME_EXPIRY_MONTHS, GOVLIST_EXPIRY_MONTHS, joinRunMessage } = await import("./_shared.mjs");
const { shouldSkipKosisFill, applyhomeStatus, govlistStatus, isGovlistRespected, planUnsoldUpdates, formatListedCap, parseListedCap, KOSIS_LISTED_CAP_MARKER } =
  await import("./collect-unsold-kosis.mjs");

/** 2026-11-04T15:00Z = KST 11/05 00:00 — 지시서 A1 예시 시각 */
const NOW = new Date("2026-11-04T15:00:00Z");

describe("A1 — isAsOfFuture · asOfRespectState (KST 날짜 · 당일은 미래 아님)", () => {
  it("지시서 예시: KST 11/05 에 \"2026-11-05\" 미래 아님 · \"2026-11-06\" 미래 · \"2027-09-30\" 미래", () => {
    expect(isAsOfFuture("2026-11-05", NOW)).toBe(false);
    expect(isAsOfFuture("2026-11-06", NOW)).toBe(true);
    expect(isAsOfFuture("2027-09-30", NOW)).toBe(true);
    expect(isAsOfFuture("2026-11-04", NOW)).toBe(false);
  });
  it("KST 날짜 경계 — UTC 14:59(KST 23:59 11/04)엔 11-05 가 미래 · UTC 15:00(KST 11/05 00:00)엔 아님", () => {
    expect(isAsOfFuture("2026-11-05", new Date("2026-11-04T14:59:00Z"))).toBe(true);
    expect(isAsOfFuture("2026-11-05", new Date("2026-11-04T15:00:00Z"))).toBe(false);
  });
  it("달·해 넘김: 12-31 기준 KST 12/31 → 01-01 미래 · 2026-12-01 은 11/05 에 미래", () => {
    expect(isAsOfFuture("2027-01-01", new Date("2026-12-31T03:00:00Z"))).toBe(true);
    expect(isAsOfFuture("2026-12-31", new Date("2026-12-31T03:00:00Z"))).toBe(false);
    expect(isAsOfFuture("2026-12-01", NOW)).toBe(true);
  });
  it("형식 오류는 isApplyhomeExpired 와 같이 null", () => {
    for (const bad of [null, undefined, "20261106", "2026-11-06T00:00:00Z", "2026-13-01", "202611-06"]) {
      expect(isAsOfFuture(bad, NOW)).toBeNull();
      expect(isApplyhomeExpired(bad, NOW)).toBeNull();
    }
  });
  it("asOfRespectState: 미래 → future · 당일 → valid · 만료 → expired · 형식 오류 → no_date (만료 판정은 그대로)", () => {
    expect(asOfRespectState("2027-09-30", NOW, GOVLIST_EXPIRY_MONTHS)).toBe("future");
    expect(asOfRespectState("2026-11-05", NOW, GOVLIST_EXPIRY_MONTHS)).toBe("valid");
    expect(asOfRespectState("2026-05-05", NOW, GOVLIST_EXPIRY_MONTHS)).toBe("valid"); // 05-05 + 6개월 = 11-05 당일
    expect(asOfRespectState("2026-05-04", NOW, GOVLIST_EXPIRY_MONTHS)).toBe("expired");
    expect(asOfRespectState(null, NOW, GOVLIST_EXPIRY_MONTHS)).toBe("no_date");
    // isApplyhomeExpired 는 미래에 false — 감시 ⑫(a)(h) 가 미래 행을 「만료」로 세지 않는 근거(지금 판정 그대로)
    expect(isApplyhomeExpired("2027-09-30", NOW, GOVLIST_EXPIRY_MONTHS)).toBe(false);
  });
  it("kstDayOf: 사유 글자용 KST 날짜", () => {
    expect(kstDayOf(NOW)).toBe("2026-11-05");
    expect(kstDayOf(new Date("2026-11-04T14:59:00Z"))).toBe("2026-11-04");
  });
});

describe("A2 — collect-unsold-kosis: 미래 기준일 applyhome·govlist 는 존중하지 않는다", () => {
  /** @param {Record<string, unknown>} o */
  const g = (o = {}) => ({ unsold: null, units: 500, region: "대구", gu: "달서구", unsold_source: "govlist", unsold_as_of: "2026-09-30", ...o });
  /** @param {Record<string, unknown>} o */
  const ah = (o = {}) => ({ unsold: 30, units: 500, region: "경기", gu: "수원시", unsold_source: "applyhome", unsold_as_of: "2026-10-01", ...o });

  it("지시서 예시: as_of 2027-09-30 govlist 행 → KOSIS 가 덮는다(존중 안 함) · 같은 행 9월 기준은 존중", () => {
    expect(govlistStatus(g({ unsold_as_of: "2027-09-30" }), NOW)).toBe("future");
    expect(shouldSkipKosisFill(g({ unsold_as_of: "2027-09-30" }), NOW)).toBe(false);
    expect(isGovlistRespected(g({ unsold_as_of: "2027-09-30" }), NOW)).toBe(false);
    expect(shouldSkipKosisFill(g(), NOW)).toBe(true);
    expect(isGovlistRespected(g(), NOW)).toBe(true);
  });
  it("applyhome 도 같은 길 — 미래 공고일은 존중 안 함 · 당일 공고일은 존중", () => {
    expect(applyhomeStatus(ah({ unsold_as_of: "2026-11-06" }), NOW)).toBe("future");
    expect(shouldSkipKosisFill(ah({ unsold_as_of: "2026-11-06" }), NOW)).toBe(false);
    expect(applyhomeStatus(ah({ unsold_as_of: "2026-11-05" }), NOW)).toBe("valid");
    expect(shouldSkipKosisFill(ah({ unsold_as_of: "2026-11-05" }), NOW)).toBe(true);
  });
  it("날짜 없음은 지금처럼 존중 유지(no_date) · 만료는 그대로 존중 안 함", () => {
    expect(shouldSkipKosisFill(g({ unsold_as_of: null }), NOW)).toBe(true);
    expect(shouldSkipKosisFill(ah({ unsold_as_of: null }), NOW)).toBe(true);
    expect(shouldSkipKosisFill(ah({ unsold_as_of: "2026-04-01" }), NOW)).toBe(false);
  });
  it("planUnsoldUpdates 경로(실전 진입점): 미래 govlist·applyhome 행이 KOSIS 값을 받는다(write) · 만료 표시는 안 켠다", () => {
    const base = { name: "단지", unsold_rate: null, naver_sell_count: null, presale_type: null, unit_source: null, naver_presale_no: null, complex_key: null, unsold_listed_total: null };
    const apartments = [
      { ...base, id: "ah-fg", region: "대구", gu: "달서구", units: 500, unsold: null, unsold_source: "govlist", unsold_as_of: "2027-09-30" },
      { ...base, id: "ah-fa", region: "경기", gu: "수원시", units: 500, unsold: 30, unsold_source: "applyhome", unsold_as_of: "2026-12-01" },
      { ...base, id: "ah-vg", region: "대구", gu: "달서구", name: "다른", units: 500, unsold: null, unsold_source: "govlist", unsold_as_of: "2026-09-30" },
    ];
    const plan = planUnsoldUpdates({ apartments, unsoldByRegionGu: { 대구: { 달서구: 100 }, 경기: { 수원시: 50 } }, now: NOW });
    const by = Object.fromEntries(plan.map((p) => [p.id, p]));
    expect(by["ah-fg"].action).toBe("write");
    expect(by["ah-fa"].action).toBe("write");
    expect(by["ah-fa"].newEstimate).toBe(50);
    expect(by["ah-vg"].action).toBe("skip_preserved"); // 대조군: 유효 명단은 그대로 존중
    expect(by["ah-fg"].govlistExpired).toBe(false);
    expect(by["ah-fa"].applyhomeExpired).toBe(false);
  });
  it("main 배선(소스): 미래 기준일 명단을 경고 로그로 남기고 govlist 「존중」 건수에서 뺀다", () => {
    const src = readFileSync(fileURLToPath(new URL("./collect-unsold-kosis.mjs", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
    expect(src).toContain('const futureApts = apartmentsTyped.filter((a) => applyhomeStatus(a, now) === "future" || govlistStatus(a, now) === "future");');
    expect(src).toContain("logError(PHASE, `[경고][미래 기준일] ${futureApts.length}건");
    expect(src).toMatch(/const govlistRespectedIds = plan\.filter\(\(p\) => .*!futureSet\.has\(p\.id\)\)/);
    // 존중 판정은 공용 함수 한 곳 — 옛 isApplyhomeExpired 직접 호출이 수집기에 돌아오면 미래 행이 다시 영구 존중된다
    expect(src).not.toMatch(/isApplyhomeExpired\(/);
    expect(src).toContain("return asOfRespectState(apt.unsold_as_of, now, APPLYHOME_EXPIRY_MONTHS);");
    expect(APPLYHOME_EXPIRY_MONTHS).toBe(6);
  });
});

describe("B1 — parseListedCap (formatListedCap 의 짝)", () => {
  it("지시서 예시: `KOSIS_LISTED_CAP n=2: ap-1, ap-2` → [ap-1, ap-2] · 잘리지 않음", () => {
    expect(parseListedCap("KOSIS_LISTED_CAP n=2: ap-1, ap-2")).toEqual({ n: 2, ids: ["ap-1", "ap-2"], truncated: false });
  });
  it("수집기가 남기는 꼴 그대로 — 다른 표식 뒤·앞에 ` | ` 로 붙어도 찾는다", () => {
    const cap = /** @type {string} */ (formatListedCap(["ah-1", "ah-2"]));
    expect(cap.startsWith(`${KOSIS_LISTED_CAP_MARKER} n=2: `)).toBe(true);
    const msg = joinRunMessage(joinRunMessage("KOSIS_BUNDLE_APPLIED", "APPLYHOME_NO_DATE n=1: ah-9") ?? null, joinRunMessage("GOVLIST_NO_DATE n=1: ah-8", cap) ?? null);
    expect(parseListedCap(msg)).toEqual({ n: 2, ids: ["ah-1", "ah-2"], truncated: false });
    expect(parseListedCap(`${cap} | GOVLIST_NO_DATE n=1: ah-8`)?.ids).toEqual(["ah-1", "ah-2"]);
  });
  it("25곳 → 앞 20개 + 「, …」 → ids 20개 · truncated", () => {
    const ids = Array.from({ length: 25 }, (_, i) => `ah-${String(i).padStart(3, "0")}`);
    const p = parseListedCap(formatListedCap(ids));
    expect(p?.n).toBe(25);
    expect(p?.ids).toEqual(ids.slice(0, 20));
    expect(p?.truncated).toBe(true);
  });
  it("표식이 없거나 글자가 아니면 null", () => {
    expect(parseListedCap(null)).toBeNull();
    expect(parseListedCap("KOSIS_BUNDLE_APPLIED")).toBeNull();
    expect(parseListedCap(undefined)).toBeNull();
  });
});
