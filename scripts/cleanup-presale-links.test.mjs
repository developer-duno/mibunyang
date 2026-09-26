// @ts-check
/**
 * cleanup-presale-links.mjs 시험 (세션578) — 판정·동작 분류·prices 선택·안전장치.
 * DB 대신 가짜 Supabase 클라이언트(`_fake-supabase.test-helper.mjs`)와 메모리 파일시스템으로
 * `run()` 을 dry-run → --apply 까지 끝까지 돌린다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import {
  findContaminatedLinks, expectedValues, selectPricesToDelete, checkCurrentValues, run,
  PRESALE_FIELDS, SNAP_FIELDS, APT_COLS,
} from "./cleanup-presale-links.mjs";
import { makeFakeSupabase, makeMemFs } from "./_fake-supabase.test-helper.mjs";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const CWD = "F:/fake-cwd";

/**
 * @param {Record<string, any> & { id: string }} p
 */
function apt(p) {
  /** @type {Record<string, any>} */
  const r = {
    id: p.id, name: p.name ?? p.id, region: p.region ?? "서울", gu: "gu" in p ? p.gu : "마포구", // gu:null(세종)을 그대로 살린다
    lat: p.lat ?? null, lng: p.lng ?? null, naver_presale_no: p.naver_presale_no ?? null,
    naver_presale_seq: p.naver_presale_seq ?? null,
  };
  for (const f of PRESALE_FIELDS) r[f] = p[f] ?? null;
  return r;
}

/** 음성아이파크(ap-6026677) ← 서울원아이파크(ap-6027751) 실사고 모양 */
function fixtureTables() {
  return {
    apartments: [
      apt({ id: "ap-6027751", name: "서울원아이파크", region: "서울", gu: "노원구", lat: 37.62, lng: 127.06,
        naver_presale_no: "6027751", naver_presale_seq: "9", presale_min_price: 89900, presale_pp: 3861 }),
      apt({ id: "ap-6026677", name: "음성아이파크", region: "충북", gu: "음성군", lat: 36.94, lng: 127.69,
        naver_presale_no: "6027751", naver_presale_seq: "9", presale_min_price: 89900, presale_pp: 3861,
        presale_type: "민간분양", presale_schedule: { scheduleName: "청약", dateInfo: "2026-09-01" },
        presale_fetched_at: "2026-09-10T00:00:00+00:00" }),
      apt({ id: "ah-9000001", name: "노원 어딘가 단지", region: "경기", gu: "양주시", lat: 37.8, lng: 127.05,
        naver_presale_no: "6027751", presale_min_price: 89900, presale_pp: 3861 }),
      // 같은 시군구 — 대상 아님
      apt({ id: "ah-9000002", name: "서울원 옆", region: "서울", gu: "노원구", naver_presale_no: "6027751" }),
      // 주인 행 없음 — 대상 아님
      apt({ id: "ah-9000003", name: "주인없음", region: "부산", gu: "해운대구", naver_presale_no: "6999999" }),
    ],
    prices: [
      { id: 1, apartment_id: "ap-6026677", house_type: "presale_min", price: 33300, pp: 1100, recorded_at: "2026-08-10" },
      { id: 2, apartment_id: "ap-6026677", house_type: "presale_min", price: 89900, pp: 3861, recorded_at: "2026-08-17" },
      { id: 3, apartment_id: "ap-6026677", house_type: "presale_min", price: 89900, pp: 3861, recorded_at: "2026-08-24" },
      { id: 4, apartment_id: "ap-6026677", house_type: "presale_min", price: 89900, pp: 3861, recorded_at: "2026-08-31" },
      { id: 5, apartment_id: "ap-6026677", house_type: "presale_min", price: 89900, pp: 3861, recorded_at: "2026-09-10" },
      { id: 6, apartment_id: "ap-6026677", house_type: "084.99A", price: 89900, pp: 3861, recorded_at: "2026-09-10" },
      { id: 7, apartment_id: "ap-6027751", house_type: "presale_min", price: 89900, pp: 3861, recorded_at: "2026-09-10" },
      // 가격은 같고 평당가만 다르거나 비어 있는 행 — (price, pp) 둘 다 같아야 지운다(검사관 M2)
      { id: 8, apartment_id: "ap-6026677", house_type: "presale_min", price: 89900, pp: 3900, recorded_at: "2026-07-01" },
      { id: 9, apartment_id: "ap-6026677", house_type: "presale_min", price: 89900, pp: null, recorded_at: "2026-07-08" },
    ],
  };
}

describe("findContaminatedLinks — 판정 (T1-1)", () => {
  it("다른 시군구·다른 시도면 대상, 같은 시군구·주인 없음·자기 번호는 제외", () => {
    const t = findContaminatedLinks(/** @type {any} */ (fixtureTables().apartments));
    expect(t.map((x) => x.id)).toEqual(["ah-9000001", "ap-6026677"]);
    const ap = t.find((x) => x.id === "ap-6026677");
    expect(ap?.ownerId).toBe("ap-6027751");
    expect(ap?.action).toBe("ap-restore");
    expect(ap?.km).toBeGreaterThan(80);
    expect(t.find((x) => x.id === "ah-9000001")?.action).toBe("unlink");
  });

  it("세종은 region 이 같으면 gu 가 null 이어도 제외", () => {
    const rows = [
      apt({ id: "ap-7000001", region: "세종", gu: null, naver_presale_no: "7000001" }),
      apt({ id: "ah-7000002", region: "세종", gu: null, naver_presale_no: "7000001" }),
    ];
    expect(findContaminatedLinks(/** @type {any} */ (rows))).toEqual([]);
  });

  it("한 낱말 '청주시' ↔ 두 낱말 '청주시 서원구' 는 같은 시군구(제외), 다른 일반구는 대상", () => {
    const rows = [
      apt({ id: "ap-7100001", region: "충북", gu: "청주시 서원구", naver_presale_no: "7100001" }),
      apt({ id: "ah-7100002", region: "충북", gu: "청주시", naver_presale_no: "7100001" }),
      apt({ id: "ah-7100003", region: "충북", gu: "청주시 흥덕구", naver_presale_no: "7100001" }),
    ];
    expect(findContaminatedLinks(/** @type {any} */ (rows)).map((x) => x.id)).toEqual(["ah-7100003"]);
  });

  it("--ids-file 명단이 있으면 그 안에서만 판정(주인은 전량에서 찾는다)", () => {
    const t = findContaminatedLinks(/** @type {any} */ (fixtureTables().apartments), { onlyIds: new Set(["ap-6026677"]) });
    expect(t.map((x) => x.id)).toEqual(["ap-6026677"]);
  });
});

describe("APT_COLS — 사본 19칸이 조회에서 빠지지 않는다", () => {
  it("APT_COLS 가 19칸을 다 담고, selectAll 의 select 리터럴과 같다", () => {
    const cols = APT_COLS.split(",").map((c) => c.trim());
    for (const f of SNAP_FIELDS) expect(cols).toContain(f);
    const src = readFileSync(new URL("./cleanup-presale-links.mjs", import.meta.url), "utf8");
    expect(src).toContain(`s.from("apartments").select("${APT_COLS}")`);
  });
});

describe("expectedValues — 동작 분류 (T1-2·T1-4)", () => {
  it("ap-* 는 자기 번호로 복원·seq null·분양 17칸 null", () => {
    const v = expectedValues("ap-6026677");
    expect(v.naver_presale_no).toBe("6026677");
    expect(v.naver_presale_seq).toBeNull();
    expect(Object.keys(v)).toHaveLength(19);
    for (const f of PRESALE_FIELDS) expect(v[f]).toBeNull();
  });
  it("그 외 id 는 번호도 null", () => {
    const v = expectedValues("ah-9000001");
    expect(v.naver_presale_no).toBeNull();
    expect(SNAP_FIELDS.every((f) => v[f] === null)).toBe(true);
  });

  it("--keep-lease-type 켬 + 임대 계열(행복주택) → presale_type 만 현재값, 나머지 16칸 null·번호 정상 처리", () => {
    const v = expectedValues("ah-9000001", { keepLeaseType: true, currentPresaleType: "행복주택" });
    expect(v.presale_type).toBe("행복주택");
    expect(v.naver_presale_no).toBeNull();
    const others = PRESALE_FIELDS.filter((f) => f !== "presale_type");
    expect(others.every((f) => v[f] === null)).toBe(true);
  });

  it("--keep-lease-type 꺼짐 + 임대 계열이어도 presale_type 은 기존대로 null", () => {
    const v = expectedValues("ah-9000001", { keepLeaseType: false, currentPresaleType: "행복주택" });
    expect(v.presale_type).toBeNull();
  });

  it("--keep-lease-type 켬 + 임대 계열 아님(민간분양) → presale_type 도 null(기존과 동일)", () => {
    const v = expectedValues("ah-9000001", { keepLeaseType: true, currentPresaleType: "민간분양" });
    expect(v.presale_type).toBeNull();
  });
});

describe("selectPricesToDelete — (price, pp) 같은 presale_min 행만 (T1-4)", () => {
  it("음성아이파크: 89900/3861 presale_min 4행 삭제 · 33300/1100 유지 · 다른 house_type·다른 단지 유지", () => {
    const { prices } = fixtureTables();
    const sel = selectPricesToDelete({ id: "ap-6026677", presale_min_price: 89900, presale_pp: 3861 }, /** @type {any} */ (prices));
    expect(sel.map((p) => p.id)).toEqual([2, 3, 4, 5]);
  });
  it("가격만 같고 평당가가 다르거나(3900) 비어 있으면(null) 지우지 않는다 (검사관 M2)", () => {
    const { prices } = fixtureTables();
    const sel = selectPricesToDelete({ id: "ap-6026677", presale_min_price: 89900, presale_pp: 3861 }, /** @type {any} */ (prices));
    const ids = sel.map((p) => p.id);
    expect(ids).not.toContain(8);
    expect(ids).not.toContain(9);
  });
  it("지금 분양가가 비었으면 아무것도 고르지 않는다", () => {
    const { prices } = fixtureTables();
    expect(selectPricesToDelete({ id: "ap-6026677", presale_min_price: null, presale_pp: null }, /** @type {any} */ (prices))).toEqual([]);
  });
});

describe("checkCurrentValues — 현재값 달라짐 skip (T1-5)", () => {
  it("사본과 DB 값이 한 칸이라도 다르면 skip 하고 이유를 남긴다", () => {
    const current = Object.fromEntries(SNAP_FIELDS.map((f) => [f, null]));
    const snap = [
      { id: "a", name: "같음", current: { ...current, naver_presale_no: "1" } },
      { id: "b", name: "달라짐", current: { ...current, naver_presale_no: "2", presale_pp: 3861 } },
    ];
    const db = [
      apt({ id: "a", naver_presale_no: "1" }),
      apt({ id: "b", naver_presale_no: "2", presale_pp: 4000 }),
    ];
    const { toApply, staleSkipped } = checkCurrentValues(snap, /** @type {any} */ (db));
    expect(toApply.map((t) => t.id)).toEqual(["a"]);
    expect(staleSkipped[0].reason).toBe("현재값 달라짐: presale_pp DB=4000 사본=3861");
  });
});

describe("run — 안전장치·끝까지 (T1-3·T1-5·T1-6)", () => {
  it("--apply 에 --from 이 없으면 거부(code 1)하고 DB 를 건드리지 않는다", async () => {
    const sb = makeFakeSupabase(fixtureTables());
    const r = await run({ argv: ["--apply"], sb, cwd: CWD, ...makeMemFs() });
    expect(r.code).toBe(1);
    expect(sb.calls).toHaveLength(0);
  });

  it("dry-run 에 --out 이 없으면 거부(code 1)", async () => {
    const sb = makeFakeSupabase(fixtureTables());
    const r = await run({ argv: [], sb, cwd: CWD, ...makeMemFs() });
    expect(r.code).toBe(1);
    expect(sb.calls).toHaveLength(0);
  });

  it("대상이 1,000 을 넘으면 거부(code 1)하고 파일을 쓰지 않는다", async () => {
    const rows = [apt({ id: "ap-8000000", region: "서울", gu: "노원구", naver_presale_no: "8000000" })];
    for (let i = 0; i < 1001; i++) {
      rows.push(apt({ id: `ah-${String(i).padStart(5, "0")}`, region: "부산", gu: "해운대구", naver_presale_no: "8000000" }));
    }
    const sb = makeFakeSupabase({ apartments: rows, prices: [] });
    const fs = makeMemFs();
    const r = await run({ argv: ["--out=plan.json"], sb, cwd: CWD, ...fs });
    expect(r.code).toBe(1);
    expect(r.targets).toBe(1001);
    expect(fs.files.size).toBe(0);
  });

  it("dry-run → 사본 3종 · 같은 시각 재실행은 덮어쓰지 않고 거부 · --apply --from 으로 반영·검증", async () => {
    const tables = fixtureTables();
    const sb = makeFakeSupabase(tables);
    const fs = makeMemFs();
    const now = new Date(2026, 8, 26, 9, 30, 5);
    const r1 = await run({ argv: ["--out=plan.json"], sb, cwd: CWD, now, ...fs });
    expect(r1.code).toBe(0);
    expect(r1.targets).toBe(2);
    expect(r1.pricesToDelete).toBe(4);
    const beforePath = resolve(CWD, "plan.json") + ".before.20260926-093005.json";
    expect(r1.beforePath).toBe(beforePath);
    expect(fs.files.has(resolve(CWD, "plan.json"))).toBe(true);
    expect(fs.files.has(resolve(CWD, "plan.json") + ".restore.20260926-093005.json")).toBe(true);
    const before = JSON.parse(/** @type {string} */ (fs.files.get(beforePath)));
    const ap = before.targets.find((/** @type {any} */ t) => t.id === "ap-6026677");
    expect(ap.current.naver_presale_no).toBe("6027751");
    expect(ap.current.presale_pp).toBe(3861);
    expect(ap.prices.map((/** @type {any} */ p) => p.id)).toEqual([2, 3, 4, 5]);
    // dry-run 은 DB 를 쓰지 않는다
    expect(sb.calls.every((c) => c.op === "select")).toBe(true);

    // 같은 시각으로 다시 → 사본 덮어쓰기 거부
    const before1 = fs.files.get(beforePath);
    const r2 = await run({ argv: ["--out=plan.json"], sb, cwd: CWD, now, ...fs });
    expect(r2.code).toBe(1);
    expect(fs.files.get(beforePath)).toBe(before1);

    // 반영
    const r3 = await run({ argv: ["--apply", `--from=${beforePath}`], sb, cwd: CWD, ...fs });
    expect(r3.code).toBe(0);
    expect(r3.ok).toBe(2);
    expect(r3.pricesDeleted).toBe(4);
    const eum = tables.apartments.find((a) => a.id === "ap-6026677");
    expect(eum?.naver_presale_no).toBe("6026677");
    expect(eum?.presale_pp).toBeNull();
    expect(eum?.presale_schedule).toBeNull();
    const ah = tables.apartments.find((a) => a.id === "ah-9000001");
    expect(ah?.naver_presale_no).toBeNull();
    // 서울원아이파크(주인)·같은 시군구 행은 그대로
    expect(tables.apartments.find((a) => a.id === "ap-6027751")?.presale_pp).toBe(3861);
    expect(tables.apartments.find((a) => a.id === "ah-9000002")?.naver_presale_no).toBe("6027751");
    expect(sb.tables.prices.map((p) => p.id)).toEqual([1, 6, 7, 8, 9]);
  });

  it("사본 뒤 DB 가 바뀐 행은 반영하지 않는다(현재값 달라짐 skip)", async () => {
    const tables = fixtureTables();
    const sb = makeFakeSupabase(tables);
    const fs = makeMemFs();
    const r1 = await run({ argv: ["--out=plan.json"], sb, cwd: CWD, now: new Date(2026, 8, 26, 10, 0, 0), ...fs });
    // 그 사이 수집기가 음성아이파크 평당가를 바꿨다
    const eum = tables.apartments.find((a) => a.id === "ap-6026677");
    if (eum) eum.presale_pp = 4000;
    const r2 = await run({ argv: ["--apply", `--from=${r1.beforePath}`], sb, cwd: CWD, ...fs });
    expect(r2.staleSkipped).toBe(1);
    expect(r2.ok).toBe(1);
    expect(eum?.naver_presale_no).toBe("6027751");
    expect(sb.tables.prices.filter((p) => p.apartment_id === "ap-6026677")).toHaveLength(8);
  });

  it("prices 삭제가 일부 행을 안 지우면(돌려주지 않으면) 사후검증이 잡아 code 1 (검사관 M5)", async () => {
    const tables = fixtureTables();
    const fs = makeMemFs();
    const r1 = await run({ argv: ["--out=plan.json"], sb: makeFakeSupabase(tables), cwd: CWD, now: new Date(2026, 8, 26, 12, 0, 0), ...fs });
    const sb = makeFakeSupabase(tables, { failDeleteIds: new Set([3]) });
    const r2 = await run({ argv: ["--apply", `--from=${r1.beforePath}`], sb, cwd: CWD, ...fs });
    expect(r2.ok).toBe(2);
    expect(r2.fail).toBe(0);
    expect(r2.pricesDeleted).toBe(3);
    expect(sb.tables.prices.some((p) => p.id === 3)).toBe(true);
    expect(r2.code).toBe(1);
  });

  it("성공은 돌아온 행으로만 센다 — UPDATE 가 행을 안 돌려주면 실패로 세고 code 1", async () => {
    const tables = fixtureTables();
    const fs = makeMemFs();
    const sbDry = makeFakeSupabase(tables);
    const r1 = await run({ argv: ["--out=plan.json"], sb: sbDry, cwd: CWD, now: new Date(2026, 8, 26, 11, 0, 0), ...fs });
    const sb = makeFakeSupabase(tables, { failUpdateIds: new Set(["ap-6026677"]) });
    const r2 = await run({ argv: ["--apply", `--from=${r1.beforePath}`], sb, cwd: CWD, ...fs });
    expect(r2.ok).toBe(1);
    expect(r2.fail).toBe(1);
    expect(r2.code).toBe(1);
    // 실패한 단지의 prices 는 지우지 않는다
    expect(sb.tables.prices.filter((p) => p.apartment_id === "ap-6026677")).toHaveLength(8);
  });
});

describe("run — --keep-lease-type dry-run (세션578 🔴2 후속)", () => {
  it("임대 계열 유형 오염 대상은 전이표에 [유형 유지] 표시 + 계획 summary 에 keepLeaseType·keptLeaseTypeCount", async () => {
    const tables = {
      apartments: [
        apt({ id: "ap-6027751", name: "서울원아이파크", region: "서울", gu: "노원구",
          naver_presale_no: "6027751", presale_min_price: 89900, presale_pp: 3861 }),
        // --keep-lease-type 대상 — 임대 계열(행복주택), 다른 시군구 오염
        apt({ id: "ah-9000004", name: "임대유지단지", region: "경기", gu: "성남시",
          naver_presale_no: "6027751", presale_type: "행복주택" }),
      ],
      prices: [],
    };
    const sb = makeFakeSupabase(tables);
    const fs = makeMemFs();
    const r = await run({ argv: ["--out=plan.json", "--keep-lease-type"], sb, cwd: CWD, now: new Date(2026, 8, 26, 13, 0, 0), ...fs });
    expect(r.code).toBe(0);
    expect(r.targets).toBe(1);
    const plan = JSON.parse(/** @type {string} */ (fs.files.get(resolve(CWD, "plan.json"))));
    expect(plan.summary.keepLeaseType).toBe(true);
    expect(plan.summary.keptLeaseTypeCount).toBe(1);
    const target = plan.plan.find((/** @type {any} */ t) => t.id === "ah-9000004");
    expect(target.expected.presale_type).toBe("행복주택");
    expect(target.expected.naver_presale_no).toBeNull();
  });
});
