// @ts-check
/**
 * 청약홈(applyhome) 출처 미분양 값의 만료 기준 C6 (세션569, 사장님 결정 2026-09-24 🟡8)
 *
 *   B — 경쟁률 수집기(collect-applyhome): 그 값의 회차 평형별 미달이 0 이면 0 으로(출처 applyhome 유지)
 *   A — KOSIS 수집기(collect-unsold-kosis): 공고일(unsold_as_of) + 6개월이 지나면 KOSIS 추정으로
 *   seed(collect-applyhome-seed): 새 행에 공고일 저장 — collect-applyhome-seed.test.mjs 에서 본다
 *
 * 시각은 전부 밖에서 넣는다(`now`) — 시험이 실제 시각에 기대지 않게(flaky-time-check).
 * 2회차 시험 = 자기 출력(1회차 결과를 DB 에 반영한 모양) 위에서 다시 돌려 잠기지 않는지·변화 0 인지.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return { ...orig, loadEnv: vi.fn(), getSupabase: vi.fn(), log: vi.fn(), logError: vi.fn() };
});

const shared = await import("./_shared.mjs");
const { isApplyhomeExpired, APPLYHOME_EXPIRY_MONTHS, formatApplyhomeNoDate, parseApplyhomeNoDate, joinRunMessage } = shared;
const { planUnsoldUpdates, shouldSkipKosisFill, applyhomeStatus, evaluateZeroBreaker } = await import("./collect-unsold-kosis.mjs");
const { computeShortfall, aggregateByApartment, planApplyhomeUnsold, evaluateApplyhomeZeroBreaker, parseApplyhomeExpectZero, B_ZERO_DEFAULT_LIMIT } =
  await import("./collect-applyhome.mjs");

/** 2026-10-09 06:00 KST — 10/09 05:30 미분양 러너 직후 시각 */
const NOW_1009 = new Date("2026-10-08T21:00:00Z");

// ── 공용 판정 isApplyhomeExpired ─────────────────────────────
describe("isApplyhomeExpired — 공고일 + 6개월 (KST 날짜, 경계 당일은 안 지남)", () => {
  it("기간 상수는 6개월(사장님 결정 C6)", () => {
    expect(APPLYHOME_EXPIRY_MONTHS).toBe(6);
  });

  it("세션569 8곳의 공고일로 10/09 판정 — 봉담(03-16)·운정(04-03) 만료, 나머지 6곳은 유효", () => {
    /** 청약홈 원문(2026-09-24 캐시) 공고일 — 값을 만든 회차 기준 */
    const asOf = {
      "봉담(4차)": "2026-03-16", "천왕(11차)": "2026-08-14", "운정(임의)": "2026-04-03",
      "D3(임의2차)": "2026-09-03", "서수원(임의2차)": "2026-08-27",
      "르네오션": "2026-05-12", "청주": "2026-06-01", "강릉": "2026-06-05",
    };
    const expired = Object.entries(asOf).filter(([, d]) => isApplyhomeExpired(d, NOW_1009)).map(([k]) => k);
    // 봉담 03-16 + 6개월 = 09-16 < 10-09 → 만료도 맞다
    expect(expired).toEqual(["봉담(4차)", "운정(임의)"]);
  });

  it("경계: 공고 + 6개월 당일은 유지, 다음 날 만료 (KST 자정 기준)", () => {
    // 2026-10-09 KST 00:30 = 2026-10-08T15:30Z
    const kst1009 = new Date("2026-10-08T15:30:00Z");
    expect(isApplyhomeExpired("2026-04-09", kst1009)).toBe(false); // 당일
    expect(isApplyhomeExpired("2026-04-08", kst1009)).toBe(true);  // 하루 지남
    // UTC 로는 아직 10-08 이지만 KST 로는 10-09 — UTC 로 계산하면 04-08 을 "당일"로 봐 false 가 된다
    expect(isApplyhomeExpired("2026-04-08", new Date("2026-10-08T14:59:00Z"))).toBe(false); // KST 23:59 10-08
  });

  it("5개월 지남 → 유지 / 7개월 지남 → 만료", () => {
    expect(isApplyhomeExpired("2026-05-09", NOW_1009)).toBe(false);
    expect(isApplyhomeExpired("2026-03-09", NOW_1009)).toBe(true);
  });

  it("월 넘김·연 넘김(08-31 + 6 = 02월, 11-15 + 6 = 다음 해 05-15)", () => {
    expect(isApplyhomeExpired("2026-08-31", new Date("2027-02-28T03:00:00Z"))).toBe(false);
    expect(isApplyhomeExpired("2026-08-31", new Date("2027-03-01T03:00:00Z"))).toBe(true);
    expect(isApplyhomeExpired("2026-11-15", new Date("2027-05-15T03:00:00Z"))).toBe(false);
    expect(isApplyhomeExpired("2026-11-15", new Date("2027-05-16T03:00:00Z"))).toBe(true);
  });

  it("공고일이 없거나 형식이 어긋나면 null(판정 불가) — 서기 20만년으로 통과하지 않는다", () => {
    expect(isApplyhomeExpired(null, NOW_1009)).toBeNull();
    expect(isApplyhomeExpired(undefined, NOW_1009)).toBeNull();
    expect(isApplyhomeExpired("20260403", NOW_1009)).toBeNull();
    expect(isApplyhomeExpired("202604-03", NOW_1009)).toBeNull();
    expect(isApplyhomeExpired("2026-13-01", NOW_1009)).toBeNull();
    expect(isApplyhomeExpired("2026-04-03T00:00:00Z", NOW_1009)).toBeNull();
  });
});

// ── 공고일 없음 마커 ──────────────────────────────────────────
describe("APPLYHOME_NO_DATE 마커 — REGION_UNRESOLVED 와 같은 방식(error_message, status 불변)", () => {
  it("형식 = APPLYHOME_NO_DATE n=<수>: id…, 없으면 null", () => {
    expect(formatApplyhomeNoDate([])).toBeNull();
    expect(formatApplyhomeNoDate(["ah-1", "ah-2"])).toBe("APPLYHOME_NO_DATE n=2: ah-1, ah-2");
  });

  it("21건 이상이면 앞 20개 + … — n 은 전체 수", () => {
    const ids = Array.from({ length: 23 }, (_, i) => `ah-${i}`);
    const m = /** @type {string} */ (formatApplyhomeNoDate(ids));
    expect(m.startsWith("APPLYHOME_NO_DATE n=23: ah-0, ")).toBe(true);
    expect(m.endsWith("ah-19, …")).toBe(true);
    expect(parseApplyhomeNoDate(m)?.ids).toHaveLength(20);
  });

  it("실패 사유 뒤에 붙어도(joinRunMessage) 읽힌다 — 명단 그대로", () => {
    const msg = joinRunMessage("KOSIS 에러: 타임아웃", formatApplyhomeNoDate(["ah-2026910109", "ah-2026910133"]));
    expect(parseApplyhomeNoDate(msg)).toEqual({ n: 2, ids: ["ah-2026910109", "ah-2026910133"] });
    expect(parseApplyhomeNoDate("KOSIS 에러만")).toBeNull();
    expect(parseApplyhomeNoDate(null)).toBeNull();
  });
});

// ── A: KOSIS 수집기 ───────────────────────────────────────────
describe("A — collect-unsold-kosis: applyhome 만료 판정 (now 주입)", () => {
  /** @param {Partial<any>} o */
  const apt = (o = {}) => ({
    id: "ah-9", name: "청약홈단지", region: "경기", gu: "수원시", units: 500,
    unsold: 30, unsold_rate: 6, naver_sell_count: null, presale_type: null,
    unsold_source: "applyhome", unsold_as_of: "2026-05-09", ...o,
  });
  const KOSIS = { "경기": { "수원시": 50 } };

  it("5개월 → skip_preserved(존중) / 7개월 → write(KOSIS 로 덮음, 출처 kosis 로 쓰일 행)", () => {
    const p5 = planUnsoldUpdates({ apartments: [apt({ unsold_as_of: "2026-05-09" })], unsoldByRegionGu: KOSIS, now: NOW_1009 });
    expect(p5[0].action).toBe("skip_preserved");
    expect(p5[0].applyhomeExpired).toBe(false);

    const p7 = planUnsoldUpdates({ apartments: [apt({ unsold_as_of: "2026-03-09" })], unsoldByRegionGu: KOSIS, now: NOW_1009 });
    expect(p7[0].action).toBe("write");
    expect(p7[0].newEstimate).toBe(50);
    expect(p7[0].applyhomeExpired).toBe(true);
    expect(p7[0].currentSource).toBe("applyhome");
  });

  it("같은 행이라도 now 가 바뀌면 판정이 바뀐다 — now 주입이 실제로 쓰인다", () => {
    const row = apt({ unsold_as_of: "2026-05-09" });
    expect(planUnsoldUpdates({ apartments: [row], unsoldByRegionGu: KOSIS, now: new Date("2026-09-08T21:00:00Z") })[0].action).toBe("skip_preserved");
    expect(planUnsoldUpdates({ apartments: [row], unsoldByRegionGu: KOSIS, now: new Date("2026-12-08T21:00:00Z") })[0].action).toBe("write");
    expect(shouldSkipKosisFill(row, new Date("2026-09-08T21:00:00Z"))).toBe(true);
    expect(shouldSkipKosisFill(row, new Date("2026-12-08T21:00:00Z"))).toBe(false);
  });

  it("만료된 applyhome 이 KOSIS 0 을 받으면 write_zero — 차단기(값>0→0)에도 세어진다", () => {
    const plan = planUnsoldUpdates({ apartments: [apt({ unsold_as_of: "2026-03-09" })], unsoldByRegionGu: { "경기": { "수원시": 0 } }, now: NOW_1009 });
    expect(plan[0].action).toBe("write_zero");
    expect(evaluateZeroBreaker(plan, 1).fired).toBe(false);
    expect(evaluateZeroBreaker(plan, 0).fired).toBe(true);
  });

  it("공고일 없음 → skip_applyhome_no_date(존중 유지, 조용히 넘기지 않고 따로 센다)", () => {
    const plan = planUnsoldUpdates({ apartments: [apt({ unsold_as_of: null })], unsoldByRegionGu: KOSIS, now: NOW_1009 });
    expect(plan[0].action).toBe("skip_applyhome_no_date");
    expect(plan[0].currentUnsold).toBe(30);
    expect(applyhomeStatus({ unsold_source: "applyhome", unsold_as_of: null }, NOW_1009)).toBe("no_date");
    // 차단기 대상 action 이 아니다(존중이므로 값 변화 없음)
    expect(evaluateZeroBreaker(plan, null).denominator).toBe(0);
  });

  it("kosis·NULL 출처는 공고일과 무관(이 규칙은 applyhome 에만)", () => {
    const k = planUnsoldUpdates({ apartments: [apt({ unsold_source: "kosis", unsold_as_of: null })], unsoldByRegionGu: KOSIS, now: NOW_1009 });
    expect(k[0].action).toBe("write");
    expect(k[0].applyhomeExpired).toBe(false);
  });

  it("임대형 applyhome 은 만료돼도 skip_lease(KOSIS 가 임대는 안 건드린다 — 규칙2 가 먼저)", () => {
    const plan = planUnsoldUpdates({ apartments: [apt({ unsold_as_of: "2026-03-09", presale_type: "국민임대" })], unsoldByRegionGu: KOSIS, now: NOW_1009 });
    expect(plan[0].action).toBe("skip_lease");
  });

  it("★2회차 — 7개월 만료로 write → DB 반영(출처 kosis) → 다음 회차 KOSIS 가 바뀌면 다시 갱신(잠기지 않음)", () => {
    const round1 = planUnsoldUpdates({ apartments: [apt({ unsold_as_of: "2026-03-09" })], unsoldByRegionGu: KOSIS, now: NOW_1009 });
    expect(round1[0].action).toBe("write");
    // collect-unsold-kosis main 의 write 가 쓰는 모양 그대로(unsold·rate·source=kosis, unsold_as_of 는 건드리지 않음)
    const dbAfter = apt({ unsold_as_of: "2026-03-09", unsold: round1[0].newEstimate, unsold_rate: round1[0].newRate, unsold_source: "kosis" });
    const round2 = planUnsoldUpdates({ apartments: [dbAfter], unsoldByRegionGu: { "경기": { "수원시": 80 } }, now: new Date("2026-11-08T21:00:00Z") });
    expect(round2[0].action).toBe("write");
    expect(round2[0].newEstimate).toBe(80);
    const round3 = planUnsoldUpdates({ apartments: [{ ...dbAfter, unsold: 80, unsold_rate: 16 }], unsoldByRegionGu: { "경기": { "수원시": 0 } }, now: new Date("2026-12-08T21:00:00Z") });
    expect(round3[0].action).toBe("write_zero"); // 0 도 자기 출력 위에서 정상 갱신
  });

  it("★2회차 — 5개월 존중 행은 다음 회차(6개월 경과 뒤)에 풀린다(영구 동결 아님)", () => {
    const row = apt({ unsold_as_of: "2026-05-09" });
    const r1 = planUnsoldUpdates({ apartments: [row], unsoldByRegionGu: KOSIS, now: NOW_1009 });
    expect(r1[0].action).toBe("skip_preserved");
    const r2 = planUnsoldUpdates({ apartments: [row], unsoldByRegionGu: KOSIS, now: new Date("2026-11-09T21:00:00Z") });
    expect(r2[0].action).toBe("write");
  });
});

describe("A — collect-unsold-kosis main 배선 (소스)", () => {
  const src = readFileSync(fileURLToPath(new URL("./collect-unsold-kosis.mjs", import.meta.url)), "utf8")
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ");

  it("main 이 planUnsoldUpdates 에 now 를 넘긴다 — 빠지면 실제 시각 기본값으로 돌아 시험과 어긋난다", () => {
    expect(src).toMatch(/const plan = planUnsoldUpdates\(\{ apartments: apartmentsTyped, unsoldByRegionGu, now \}\);/);
  });

  it("공고일 없음 마커가 collector_runs 기록에 실린다(성공 경로·실패 경로 둘 다)", () => {
    expect(src).toMatch(/noDateMarker = formatApplyhomeNoDate\(noDateIds\);/);
    expect(src).toMatch(/errorMessage: joinRunMessage\(errorMessage, noDateMarker\)/);
    expect(src).toMatch(/noDateMarker \? \{ ok, errorMessage: noDateMarker \} : \{ ok \}/);
  });
});

// ── B: 경쟁률 수집기 ──────────────────────────────────────────
/** 2026-09-21 applyhome_events 원본 모양(평형별 행) */
const row = (/** @type {string} */ no, /** @type {number} */ supply, /** @type {string} */ req, /** @type {string} */ ty = "084.9800A") => ({
  REQ_CNT: req, HOUSE_TY: ty, PBLANC_NO: no, CMPET_RATE: "", SUPLY_HSHLDCO: supply, HOUSE_MANAGE_NO: no, REMNDR_HSHLD_PBLANC_TYCD: "01",
});

describe("B — computeShortfall (평형별 미달 합, 원본 CMPET_RATE △N 과 같은 값)", () => {
  it("서수원 에피트(2025910280): 공급 48·신청 46 → 2 (원본 △2)", () => {
    expect(computeShortfall([row("2025910280", 48, "46")])).toBe(2);
  });

  it("청주 푸르지오 함정 — 합계는 신청 > 공급인데 평형별 미달이 있다", () => {
    const items = [row("X", 47, "572", "A"), row("X", 30, "12", "B"), row("X", 14, "31", "C")];
    expect(computeShortfall(items)).toBe(18); // 47·14 는 넘침(0), 30-12=18
    const agg = aggregateByApartment(items).X;
    expect(agg.applicants).toBeGreaterThan(agg.supply);
    expect(agg.shortfall).toBe(18);
  });

  it("모든 평형이 신청 ≥ 공급 → 0 (완판 신호)", () => {
    expect(computeShortfall([row("Y", 9, "26"), row("Y", 1, "1")])).toBe(0);
  });

  it("공급 합이 0 이면 null — 완판(0)으로 읽히지 않는다", () => {
    expect(computeShortfall([row("Z", 0, "0")])).toBeNull();
    expect(computeShortfall([])).toBeNull();
  });

  it("신청 수가 숫자가 아니면 0 으로 본다(미달이 크게 잡히는 쪽 = 0 쓰기 안 남)", () => {
    expect(computeShortfall([row("W", 5, "")])).toBe(5);
  });
});

describe("B — planApplyhomeUnsold (그 값의 회차 평형별 미달 0 → 0, 출처 applyhome 유지)", () => {
  it("seed 행(값 = 그 회차 공급) + 미달 0 → zero", () => {
    expect(planApplyhomeUnsold({ unsold: 10, unsold_source: "applyhome" }, { supply: 10, shortfall: 0 }).action).toBe("zero");
  });

  it("미달이 있으면 keep(값 불변 — B′ 갱신은 이번 결정 밖)", () => {
    expect(planApplyhomeUnsold({ unsold: 106, unsold_source: "applyhome" }, { supply: 106, shortfall: 98 })).toEqual({ action: "keep", reason: "shortfall_positive" });
  });

  it("값이 다른 회차 것이면 keep — 세션569 5곳(운정 3 ↔ 옛 분양 회차 공급 311)", () => {
    expect(planApplyhomeUnsold({ unsold: 3, unsold_source: "applyhome" }, { supply: 311, shortfall: 0 })).toEqual({ action: "keep", reason: "other_round" });
  });

  it("kosis·NULL 출처는 건드리지 않는다", () => {
    expect(planApplyhomeUnsold({ unsold: 10, unsold_source: "kosis" }, { supply: 10, shortfall: 0 }).reason).toBe("not_applyhome");
    expect(planApplyhomeUnsold({ unsold: 10, unsold_source: null }, { supply: 10, shortfall: 0 }).reason).toBe("not_applyhome");
  });

  it("미달 모름(null)이면 keep", () => {
    expect(planApplyhomeUnsold({ unsold: 10, unsold_source: "applyhome" }, { supply: 10, shortfall: null }).reason).toBe("shortfall_unknown");
  });

  it("지금 운영 applyhome 8곳(2026-09-21 경쟁률) — 전부 keep(첫 실행 0 쓰기 0건)", () => {
    const eight = [
      [0, 128, 96], [0, 8, 1], [3, 311, 199], [0, 130, 69], [2, 48, 2], [63, 63, 57], [130, 270, 96], [106, 106, 98],
    ];
    for (const [unsold, supply, shortfall] of eight) {
      expect(planApplyhomeUnsold({ unsold, unsold_source: "applyhome" }, { supply, shortfall }).action).toBe("keep");
    }
  });

  it("★2회차 — 1회차 zero 를 반영한 뒤(unsold 0, 출처 applyhome) 같은 경쟁률로 다시 돌리면 변화 0", () => {
    const agg = { supply: 12, shortfall: 0 };
    const r1 = planApplyhomeUnsold({ unsold: 12, unsold_source: "applyhome" }, agg);
    expect(r1.action).toBe("zero");
    const dbAfter = { unsold: 0, unsold_source: "applyhome" }; // collect-applyhome 이 쓰는 모양(출처 유지)
    expect(planApplyhomeUnsold(dbAfter, agg).action).toBe("keep");
  });
});

describe("B — 완판 0 쓰기 차단기", () => {
  it("기본 상한 10건 — 초과면 발동, 이하면 통과", () => {
    expect(B_ZERO_DEFAULT_LIMIT).toBe(10);
    expect(evaluateApplyhomeZeroBreaker(10, null).fired).toBe(false);
    expect(evaluateApplyhomeZeroBreaker(11, null).fired).toBe(true);
  });

  it("--expect-zero 는 정확히 같을 때만 통과(많아도 적어도 발동)", () => {
    expect(evaluateApplyhomeZeroBreaker(33, 33).fired).toBe(false);
    expect(evaluateApplyhomeZeroBreaker(32, 33).fired).toBe(true);
    expect(evaluateApplyhomeZeroBreaker(34, 33).fired).toBe(true);
    expect(parseApplyhomeExpectZero(["node", "x", "--expect-zero=33"])).toEqual({ expectZero: 33, invalid: false });
    expect(parseApplyhomeExpectZero(["node", "x", "--expect-zero=-1"])).toEqual({ expectZero: null, invalid: true });
    expect(parseApplyhomeExpectZero(["node", "x"])).toEqual({ expectZero: null, invalid: false });
  });
});

describe("B — collect-applyhome main 배선 (소스)", () => {
  const src = readFileSync(fileURLToPath(new URL("./collect-applyhome.mjs", import.meta.url)), "utf8")
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ");

  it("스트리퍼 뒤에도 표적이 남아 있다", () => {
    expect(src).toContain("evaluateApplyhomeZeroBreaker(");
    expect(src).toContain("competition_shortfall: agg.shortfall");
  });

  it("차단기 판정과 미리보기 저장이 첫 DB 쓰기(경쟁률 UPDATE)보다 앞이다", () => {
    const breakerAt = src.indexOf("const breaker = evaluateApplyhomeZeroBreaker(");
    const impactAt = src.indexOf("writeFileSync(impactOutPath");
    const firstWrite = src.indexOf('await sb.from("apartments").update(');
    expect(breakerAt).toBeGreaterThan(0);
    expect(impactAt).toBeGreaterThan(0);
    expect(breakerAt).toBeLessThan(firstWrite);
    expect(impactAt).toBeLessThan(firstWrite);
  });

  it("0 쓰기는 계획 때의 값·출처가 그대로일 때만(WHERE) + 출처는 바꾸지 않는다", () => {
    expect(src).toMatch(/\.update\(\{ unsold: 0, unsold_rate: 0, updated_at: [^}]*\}\)\s*\.eq\("id", aptId\)\.eq\("unsold_source", "applyhome"\)\.eq\("unsold", /);
    expect(src).not.toMatch(/unsold_source: "kosis"/);
  });
});
