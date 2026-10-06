// @ts-check
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { haversine, matchNearestStation, mergeKeepingAnnual, stationsFromCoords, buildStationOnly, classifyStationOnly, planStationOnly, REALTIME_KEYS, evaluateStationChangeBreaker, parseExpectStationChanges, STATION_CHANGE_DEFAULT_LIMIT, parseStationList, runStationOnly } from "./collect-air-quality.mjs";

// 에어코리아 대기질 수집기 테스트 — 측정소 매칭 로직

describe("haversine (air-quality)", () => {
  it("서울↔부산 약 325km", () => {
    const dist = haversine(37.5666, 126.9784, 35.1796, 129.0756);
    expect(dist).toBeGreaterThan(300);
    expect(dist).toBeLessThan(350);
  });
});

describe("matchNearestStation", () => {
  const stations = [
    { station: "종로구", lat: 37.572, lng: 127.005, pm10: 45, pm25: 22, o3: 0.035, grade: "보통" },
    { station: "강남구", lat: 37.517, lng: 127.047, pm10: 38, pm25: 18, o3: 0.028, grade: "좋음" },
  ];

  // 정상: 가까운 측정소 매칭
  it("강남 단지는 강남구 측정소 매칭", () => {
    const apt = { lat: 37.510, lng: 127.040 };
    const result = matchNearestStation(/** @type {any} */ (apt), stations);
    expect(result?.station).toBe("강남구");
    expect(result?.pm25).toBe(18);
    expect(result?.grade).toBe("좋음");
    expect(result?.collected_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // 에러: 빈 측정소 목록
  it("측정소 0건 시 null 반환", () => {
    const result = matchNearestStation(/** @type {any} */ ({ lat: 37.5, lng: 127.0 }), []);
    expect(result).toBeNull();
  });
});

// ⚠️ 이 블록이 세션556 결함을 막는다 — `haversine` 은 **km** 를 주는데 `infra.air_station_dist` 는
//    **m** 로 표시된다(자매 레포 `naver-estate-web` `MbEnvironmentSection.tsx:137`).
//    그 환산이 없던 동안 제주 단지가 실제 503km 인데 자매 화면에 `(503m)` = "바로 옆 관측소" 로 보였다
//    (실측: 값 있는 2,602곳 중 1,347곳이 50km 초과, 중앙값 52.6km).
describe("matchNearestStation — stationDist 는 m 단위 (세션556)", () => {
  const stations = [
    { station: "종로구", lat: 37.572, lng: 127.005, pm10: 45, pm25: 22, o3: 0.035, grade: "보통" },
    { station: "강남구", lat: 37.517, lng: 127.047, pm10: 38, pm25: 18, o3: 0.028, grade: "좋음" },
  ];

  it("가까운 측정소면 수백~수천 m 범위", () => {
    const apt = { lat: 37.510, lng: 127.040 };
    const r = matchNearestStation(/** @type {any} */ (apt), stations);
    expect(r?.station).toBe("강남구");
    // 약 0.9km — km 로 저장하면 1 이 되고, m 면 900 안팎이다.
    expect(r?.stationDist).toBeGreaterThan(100);
    expect(r?.stationDist).toBeLessThan(5000);
  });

  // ⚠️ 뮤테이션 대상 — `* 1000` 을 지우면 red. 이 단언이 단위 회귀를 잡는다.
  it("먼 측정소도 m 단위 (제주 503km = 503,000m)", () => {
    const apt = { lat: 33.25, lng: 126.25 }; // 제주 대정 근처
    const r = matchNearestStation(/** @type {any} */ (apt), stations);
    expect(r?.stationDist).toBeGreaterThan(400000); // 400km 초과 = m 단위여야 나오는 수
    expect(r?.stationDist).toBeLessThan(600000);
  });

  it("haversine 결과의 정확히 1000배다", () => {
    const apt = { lat: 37.510, lng: 127.040 };
    const km = haversine(37.51, 127.04, 37.517, 127.047);
    const r = matchNearestStation(/** @type {any} */ (apt), stations);
    expect(r?.stationDist).toBe(Math.round(km * 1000));
  });

  it("측정소가 없으면 null 을 돌려준다(거리도 없음)", () => {
    expect(matchNearestStation(/** @type {any} */ ({ lat: 37.5, lng: 127 }), [])).toBeNull();
  });
});

describe("mergeKeepingAnnual — 매일 덮어쓰기에서 3년 평균을 지키는 자리 (세션560)", () => {
  const today = { pm25: 9, pm10: 13, o3: 0.033, grade: "보통", station: "강서구", collected_at: "2026-09-22" };
  const annual = { pm25: 18.27, pm10: 37.32, o3: 0.0319, years: "2022,2023,2024" };

  it("⚠️ 기존 annual 은 그대로 살아남는다 — 이게 깨지면 매일 새벽 전 단지의 채점값이 사라진다", () => {
    const merged = mergeKeepingAnnual({ ...today, pm25: 5, annual }, today);
    expect(merged.annual).toEqual(annual);
  });
  it("오늘 값은 새 값으로 갈린다(보존은 annual 한 칸뿐)", () => {
    const merged = mergeKeepingAnnual({ pm25: 99, grade: "매우나쁨", annual }, today);
    expect(merged.pm25).toBe(9);
    expect(merged.grade).toBe("보통");
  });
  it("기존에 annual 이 없으면 그냥 오늘 값 — 없는 키를 만들지 않는다", () => {
    const merged = mergeKeepingAnnual({ pm25: 99 }, today);
    expect(merged).toEqual(today);
    expect("annual" in merged).toBe(false);
  });
  it("기존 행 자체가 없어도(null/undefined) 안 죽는다", () => {
    expect(mergeKeepingAnnual(null, today)).toEqual(today);
    expect(mergeKeepingAnnual(undefined, today)).toEqual(today);
  });
});

// === station-only (세션603 — 사장님 결정 "대기질 실시간 멈춤, 측정소 배정만 유지") ===
describe("station-only — 측정소 배정만 (세션603)", () => {
  const coordMap = new Map([
    ["종로구", { lat: 37.572, lng: 127.005 }],
    ["강남구", { lat: 37.517, lng: 127.047 }],
  ]);
  const stations = stationsFromCoords(coordMap);
  const annual = { pm25: 18.27, pm10: 37.32, o3: 0.0319, years: "2022,2023,2024" };

  it("stationsFromCoords — 좌표 목록 전부, 실시간 값은 null", () => {
    expect(stations.map((s) => s.station)).toEqual(["종로구", "강남구"]);
    for (const s of stations) {
      expect([s.pm10, s.pm25, s.o3, s.grade]).toEqual([null, null, null, null]);
    }
  });

  it("⚠️ buildStationOnly — 실시간 키(pm10·pm25·o3·grade)가 없고 annual 은 보존된다", () => {
    const prev = { pm10: 30, pm25: 9, o3: 0.03, grade: "보통", station: "강서구", stationDist: 900, collected_at: "2026-09-29", annual };
    const next = buildStationOnly(prev, { station: "강남구", stationDist: 812, collected_at: "2026-10-13" });
    expect(next).toEqual({ station: "강남구", stationDist: 812, collected_at: "2026-10-13", annual });
    for (const k of REALTIME_KEYS) expect(k in next).toBe(false);
  });

  it("buildStationOnly — 기존 행이 없으면 annual 키를 만들지 않는다", () => {
    const next = buildStationOnly(null, { station: "강남구", stationDist: 812, collected_at: "2026-10-13" });
    expect(next).toEqual({ station: "강남구", stationDist: 812, collected_at: "2026-10-13" });
  });

  describe("classifyStationOnly — 바뀐 것만 쓰기", () => {
    const aq = { station: "강남구", stationDist: 812 };
    const infraOk = { air_station_name: "강남구", air_station_dist: 812 };
    it("⚠️ 측정소·거리 같고 실시간 키도 없고 infra 도 같으면 쓰지 않는다 (2회차부터 쓰기 ≈ 0)", () => {
      const r = classifyStationOnly({ station: "강남구", stationDist: 812, collected_at: "2026-10-13", annual }, aq, infraOk);
      expect(r).toEqual({ kind: "unchanged", write: false, hadRealtime: false, infraStale: false });
    });
    it("측정소·거리 같아도 실시간 키가 남아 있으면 지우러 쓴다 (첫 회차)", () => {
      const r = classifyStationOnly({ station: "강남구", stationDist: 812, grade: "보통" }, aq, infraOk);
      expect(r).toEqual({ kind: "realtimeOnly", write: true, hadRealtime: true, infraStale: false });
    });
    it("값이 null 인 실시간 키도 '남아 있음'으로 본다 (키 자체를 지운다)", () => {
      expect(classifyStationOnly({ station: "강남구", stationDist: 812, pm10: null }, aq, infraOk).write).toBe(true);
    });
    it("기존 station 없음 → new", () => {
      expect(classifyStationOnly(null, aq, infraOk).kind).toBe("new");
      expect(classifyStationOnly({ annual }, aq, infraOk).kind).toBe("new");
    });
    it("측정소가 바뀌면 stationChanged · 거리만 바뀌면 distOnly", () => {
      expect(classifyStationOnly({ station: "종로구", stationDist: 812 }, aq, infraOk).kind).toBe("stationChanged");
      expect(classifyStationOnly({ station: "강남구", stationDist: 900 }, aq, infraOk).kind).toBe("distOnly");
    });
    // 세션603 검사관 🟠: 옛 경로는 매주 infra 두 칸을 다시 써서 어긋남이 저절로 고쳐졌다 — 바뀐 것만 쓰면 그게 사라진다.
    it("⚠️ apartments 쪽이 같아도 infra 가 다르거나 행이 없으면 infraOnly 로 쓴다", () => {
      const same = { station: "강남구", stationDist: 812 };
      expect(classifyStationOnly(same, aq, { air_station_name: "종로구", air_station_dist: 812 })).toMatchObject({ kind: "infraOnly", write: true, infraStale: true });
      expect(classifyStationOnly(same, aq, { air_station_name: "강남구", air_station_dist: 812000 })).toMatchObject({ kind: "infraOnly", write: true });
      expect(classifyStationOnly(same, aq, { air_station_name: null, air_station_dist: null })).toMatchObject({ kind: "infraOnly", write: true });
      expect(classifyStationOnly(same, aq, undefined)).toMatchObject({ kind: "infraOnly", write: true });
    });
  });

  it("planStationOnly — 전이표 숫자·명단, annual 을 잃는 행 0", () => {
    const apts = [
      // 강남 근처 — 첫 회차 모양(실시간 키 있음, annual 있음)
      { id: "a1", name: "A", lat: 37.51, lng: 127.04, air_quality: { pm25: 9, grade: "보통", station: "강남구", stationDist: 0, annual } },
      // 이미 정리된 행 — 쓰기 없음
      { id: "a2", name: "B", lat: 37.517, lng: 127.047, air_quality: { station: "강남구", stationDist: 0, collected_at: "2026-10-13" } },
      // 새 단지
      { id: "a3", name: "C", lat: 37.572, lng: 127.005, air_quality: null },
      // 측정소가 바뀜 + 모르는 키
      { id: "a4", name: "D", lat: 37.572, lng: 127.005, air_quality: { station: "강남구", stationDist: 5000, foo: 1 } },
      // apartments 는 그대로인데 infra 행이 없음
      { id: "a5", name: "E", lat: 37.517, lng: 127.047, air_quality: { station: "강남구", stationDist: 0 } },
    ];
    const infra = new Map([
      ["a1", { air_station_name: "강남구", air_station_dist: 0 }],
      ["a2", { air_station_name: "강남구", air_station_dist: 0 }],
      ["a3", { air_station_name: null, air_station_dist: null }],
      ["a4", { air_station_name: "강남구", air_station_dist: 5000 }],
    ]);
    const plan = planStationOnly(apts, stations, infra);
    expect(plan.counts).toMatchObject({ targets: 5, writes: 4, realtimeRemoved: 1, new: 1, stationChanged: 1, infraOnly: 1, unchanged: 1, annualLost: 0, otherKeysDropped: 1, infraMissing: 1 });
    expect(plan.counts.distOnly + plan.counts.realtimeOnly).toBe(1); // a1 — 거리(0→실측)가 달라 distOnly
    expect(plan.stationChanged).toEqual([{ id: "a4", name: "D", from: "강남구", to: "종로구", fromDist: 5000, toDist: 0 }]);
    expect(plan.newlyAssigned).toEqual([{ id: "a3", name: "C", station: "종로구", dist: 0 }]);
    expect(plan.otherKeysDropped).toEqual([{ id: "a4", keys: ["foo"] }]);
    expect(plan.infraMissing).toEqual(["a5"]);
    expect(plan.writes.map((w) => [w.id, w.kind])).toEqual([["a1", "distOnly"], ["a3", "new"], ["a4", "stationChanged"], ["a5", "infraOnly"]]);
    const a1 = plan.writes[0].next;
    expect(a1.annual).toEqual(annual);
    expect("grade" in a1 || "pm25" in a1).toBe(false);
  });

  it("측정소가 0개면 전부 noMatch — 쓰기 0", () => {
    const plan = planStationOnly([{ id: "x", name: "X", lat: 37.5, lng: 127, air_quality: null }], []);
    expect(plan.counts).toMatchObject({ noMatch: 1, writes: 0 });
  });
});

describe("측정소 변경 차단기 (세션603)", () => {
  it("기본 = 측정소 바뀜+거리만 30 초과면 발동, 30 이하면 통과", () => {
    expect(evaluateStationChangeBreaker(30, null).fired).toBe(false);
    expect(evaluateStationChangeBreaker(31, null).fired).toBe(true);
    expect(STATION_CHANGE_DEFAULT_LIMIT).toBe(30);
  });
  it("--expect-station-changes=N 이면 정확히 같을 때만 통과(작아도 다르면 발동)", () => {
    expect(evaluateStationChangeBreaker(120, 120).fired).toBe(false);
    expect(evaluateStationChangeBreaker(119, 120).fired).toBe(true);
    expect(evaluateStationChangeBreaker(3, 0).fired).toBe(true);
  });
  it("인자 파싱 — 없음 null · 정수 · 음수/비정수 invalid", () => {
    expect(parseExpectStationChanges(["node", "x"])).toEqual({ expect: null, invalid: false });
    expect(parseExpectStationChanges(["--expect-station-changes=12"])).toEqual({ expect: 12, invalid: false });
    expect(parseExpectStationChanges(["--expect-station-changes=-1"])).toEqual({ expect: null, invalid: true });
    expect(parseExpectStationChanges(["--expect-station-changes=a"])).toEqual({ expect: null, invalid: true });
  });
});

describe("parseStationList — 측정소 목록 잘림 금지 (세션603)", () => {
  const item = (/** @type {string} */ name, /** @type {number} */ x, /** @type {number} */ y) => ({ stationName: name, dmX: String(x), dmY: String(y) });
  it("⚠️ totalCount 가 받은 건수보다 크면 던진다 (조용한 잘림 금지)", () => {
    const raw = { response: { body: { totalCount: 3, items: [item("A", 37.5, 127), item("B", 37.6, 127.1)] } } };
    expect(() => parseStationList(raw)).toThrow(/잘림/);
  });
  it("totalCount 와 받은 건수가 같으면 이름 → 좌표 맵", () => {
    const raw = { response: { body: { totalCount: 2, items: [item("A", 37.5, 127), item("B", 37.6, 127.1)] } } };
    const m = parseStationList(raw);
    expect([...m.keys()]).toEqual(["A", "B"]);
    expect(m.get("A")).toEqual({ lat: 37.5, lng: 127 });
  });
});

// === runStationOnly — 가짜 sb 로 흐름 확인 (세션603 검사관 🟡: skip 기록·좌표 0건·infra 0행) ===
/**
 * 아주 작은 가짜 Supabase — selectAll(커서) · update().eq()[.select()] · insert 만 흉내.
 * @param {{ apartments: any[]; infra: any[] }} tables
 */
function makeFakeSb(tables) {
  /** @type {{ table: string; values: any; id: unknown }[]} */
  const updates = [];
  /** @type {{ table: string; row: any }[]} */
  const inserts = [];
  const sb = {
    /** @param {string} table */
    from(table) {
      return {
        select() {
          const q = {
            order() { return q; },
            limit() { return q; },
            gt() { return { then: (/** @type {any} */ r) => r({ data: [], error: null }) }; },
            then(/** @type {any} */ r) { return r({ data: tables[/** @type {"apartments"|"infra"} */ (table)] ?? [], error: null }); },
          };
          return q;
        },
        /** @param {any} values */
        update(values) {
          return {
            /** @param {string} _col @param {unknown} id */
            eq(_col, id) {
              updates.push({ table, values, id });
              const rows = table === "infra" ? tables.infra.filter((r) => r.apartment_id === id) : [{ id }];
              const res = { data: null, error: null };
              return {
                then: (/** @type {any} */ r) => r(res),
                select: () => ({ then: (/** @type {any} */ r) => r({ data: rows.map((x) => ({ apartment_id: x.apartment_id ?? x.id })), error: null }) }),
              };
            },
          };
        },
        /** @param {any} row */
        insert(row) { inserts.push({ table, row }); return Promise.resolve({ error: null }); },
      };
    },
  };
  return { sb: /** @type {any} */ (sb), updates, inserts };
}

describe("runStationOnly — 흐름 (세션603)", () => {
  const coordMap = new Map([["강남구", { lat: 37.517, lng: 127.047 }]]);
  /** @type {string} */
  let backupDir;
  beforeEach(() => { backupDir = mkdtempSync(join(tmpdir(), "air-so-")); });
  afterEach(() => { rmSync(backupDir, { recursive: true, force: true }); });
  const runs = (/** @type {any[]} */ inserts) => inserts.filter((i) => i.table === "collector_runs").map((i) => i.row);
  const opts = (/** @type {any} */ recordSb, argv = ["node", "x", "--station-only"]) => ({ dryRun: false, argv, backupDir, recordSb });

  it("⚠️ 변화 없는 행은 skip 으로 기록된다 — 0건 성공으로 보여 감시가 울리지 않게", async () => {
    const f = makeFakeSb({
      apartments: [{ id: "u1", name: "U", lat: 37.517, lng: 127.047, air_quality: { station: "강남구", stationDist: 0 } }],
      infra: [{ apartment_id: "u1", air_station_name: "강남구", air_station_dist: 0 }],
    });
    const { exitCode } = await runStationOnly(f.sb, coordMap, opts(f.sb));
    expect(exitCode).toBe(0);
    expect(f.updates).toEqual([]); // 쓰기 0
    expect(runs(f.inserts)).toEqual([expect.objectContaining({ collector: "air-quality", status: "success", ok_count: 0, skip_count: 1 })]);
  });

  it("⚠️ 좌표 0건이면 아무것도 안 쓰고 실패 기록 + exitCode 1", async () => {
    const f = makeFakeSb({ apartments: [{ id: "n1", name: "N", lat: 37.5, lng: 127, air_quality: null }], infra: [] });
    const { exitCode } = await runStationOnly(f.sb, new Map(), opts(f.sb));
    expect(exitCode).toBe(1);
    expect(f.updates).toEqual([]);
    expect(runs(f.inserts)).toEqual([expect.objectContaining({ status: "failure" })]);
  });

  it("⚠️ infra 행이 없어 0행 갱신이면 success 로 세지 않는다(skip + 기록 문구)", async () => {
    const f = makeFakeSb({ apartments: [{ id: "m1", name: "M", lat: 37.517, lng: 127.047, air_quality: { grade: "보통" } }], infra: [] });
    const { exitCode } = await runStationOnly(f.sb, coordMap, opts(f.sb));
    expect(exitCode).toBe(0);
    expect(f.updates.map((u) => u.table)).toEqual(["apartments", "infra"]);
    const [run] = runs(f.inserts);
    expect(run).toMatchObject({ ok_count: 0, skip_count: 1, error_message: "INFRA_ROW_MISSING=1" });
  });

  it("쓰기 전에 되돌릴 사본(옛 air_quality·infra 두 칸)을 남긴다", async () => {
    const prev = { pm25: 9, grade: "보통", station: "종로구", stationDist: 5, annual: { pm25: 18 } };
    const f = makeFakeSb({
      apartments: [{ id: "b1", name: "B", lat: 37.517, lng: 127.047, air_quality: prev }],
      infra: [{ apartment_id: "b1", air_station_name: "종로구", air_station_dist: 5 }],
    });
    const { exitCode } = await runStationOnly(f.sb, coordMap, opts(f.sb, ["node", "x", "--station-only", "--expect-station-changes=1"]));
    expect(exitCode).toBe(0);
    const files = readdirSync(backupDir);
    expect(files).toHaveLength(1);
    const backup = JSON.parse(readFileSync(join(backupDir, files[0]), "utf8"));
    expect(backup.rows).toEqual([{ id: "b1", air_quality: prev, infra_row: true, air_station_name: "종로구", air_station_dist: 5 }]);
    const aptUpdate = f.updates.find((u) => u.table === "apartments");
    expect(aptUpdate?.values.air_quality).toEqual({ station: "강남구", stationDist: 0, collected_at: expect.any(String), annual: { pm25: 18 } });
  });

  it("⚠️ 측정소 변경이 승인 숫자와 다르면 아무것도 안 쓰고 실패", async () => {
    const f = makeFakeSb({
      apartments: [{ id: "c1", name: "C", lat: 37.517, lng: 127.047, air_quality: { station: "종로구", stationDist: 5 } }],
      infra: [{ apartment_id: "c1", air_station_name: "종로구", air_station_dist: 5 }],
    });
    const { exitCode } = await runStationOnly(f.sb, coordMap, opts(f.sb, ["node", "x", "--station-only", "--expect-station-changes=0"]));
    expect(exitCode).toBe(1);
    expect(f.updates).toEqual([]);
    expect(readdirSync(backupDir)).toEqual([]);
    expect(runs(f.inserts)).toEqual([expect.objectContaining({ status: "failure" })]);
  });
});
