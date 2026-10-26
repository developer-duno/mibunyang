// @ts-check
/**
 * regulation-seed.mjs 테스트 — 규제지역 순수 함수 검증
 *
 * 대상: buildRegulatedSet, makeRegionKey
 */
import { describe, it, expect, vi } from "vitest";

// _shared.mjs 모킹
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return {
    ...orig,
    loadEnv: vi.fn(),
    getSupabase: vi.fn(),
    log: vi.fn(),
    ROOT: orig.ROOT,
  };
});

const { buildRegulatedSet, makeRegionKey, isRegulatedArea, buildBjdPrefixRules, isRegulatedApt } = await import(
  "./regulation-seed.mjs"
);

const { readFileSync } = await import("fs");
const { resolve } = await import("path");
const { ROOT } = await import("./_shared.mjs");
const realZones = JSON.parse(readFileSync(resolve(ROOT, "src/data/regulation-zones.json"), "utf8"));

// ── buildRegulatedSet ─────────────────────────────────────────
describe("buildRegulatedSet", () => {
  it("투기과열지구 + 조정대상지역 → 합산 Set", () => {
    const zones = {
      "투기과열지구": ["서울 강남구", "서울 서초구"],
      "조정대상지역": ["경기 수원시", "서울 강남구"], // 중복
    };
    const result = buildRegulatedSet(zones);
    expect(result.size).toBe(3); // 중복 제거
    expect(result.has("서울 강남구")).toBe(true);
    expect(result.has("경기 수원시")).toBe(true);
  });

  it("빈 zones → 빈 Set", () => {
    const result = buildRegulatedSet({});
    expect(result.size).toBe(0);
  });

  it("한쪽만 있는 경우", () => {
    const zones = { "투기과열지구": ["서울 종로구"] };
    const result = buildRegulatedSet(zones);
    expect(result.size).toBe(1);
    expect(result.has("서울 종로구")).toBe(true);
  });

  it("null 리스트 → 무시", () => {
    const zones = { "투기과열지구": null, "조정대상지역": ["경기 성남시"] };
    const result = buildRegulatedSet(zones);
    expect(result.size).toBe(1);
  });

  it("_guAliases 도 조회 키에 담는다 (DB 표기 흔들림 흡수)", () => {
    const zones = { "투기과열지구": ["경기 성남시 분당구"], "_guAliases": ["경기 분당구"] };
    const result = buildRegulatedSet(zones);
    expect(result.has("경기 성남시 분당구")).toBe(true);
    expect(result.has("경기 분당구")).toBe(true);
  });
});

// ── isRegulatedArea ───────────────────────────────────────────
describe("isRegulatedArea — 실제 regulation-zones.json 기준", () => {
  const regulated = buildRegulatedSet(realZones);

  it("서울은 어느 구든 규제 (시도 단독 폴백 — 없으면 서울 전체가 새어 나간다)", () => {
    for (const gu of ["강남구", "양천구", "노원구", "중랑구", "금천구"]) {
      expect(isRegulatedArea(regulated, "서울", gu)).toBe(true);
    }
  });

  it("경기 12곳 공식 표기 → 규제", () => {
    for (const gu of [
      "과천시", "광명시", "성남시 분당구", "성남시 수정구", "성남시 중원구",
      "수원시 영통구", "수원시 장안구", "수원시 팔달구", "안양시 동안구",
      "용인시 수지구", "의왕시", "하남시",
    ]) {
      expect(isRegulatedArea(regulated, "경기", gu)).toBe(true);
    }
  });

  it("경기 시 이름 없는 DB 표기 → 규제", () => {
    for (const gu of ["분당구", "수정구", "중원구", "영통구", "장안구", "팔달구", "동안구", "수지구"]) {
      expect(isRegulatedArea(regulated, "경기", gu)).toBe(true);
    }
  });

  it("지정 안 된 곳은 규제 아님", () => {
    expect(isRegulatedArea(regulated, "부산", "해운대구")).toBe(false);
    expect(isRegulatedArea(regulated, "경기", "평택시")).toBe(false);
    expect(isRegulatedArea(regulated, "경기", "용인시 처인구")).toBe(false);
    expect(isRegulatedArea(regulated, "경기", "안양시 만안구")).toBe(false);
  });

  it("region 이 비면 폴백이 발동하지 않는다 (빈 문자열이 키로 새지 않게)", () => {
    expect(isRegulatedArea(regulated, null, null)).toBe(false);
    expect(isRegulatedArea(regulated, "", "")).toBe(false);
  });

  it("2026-07-01 추가 지정 — 구리시·용인시 기흥구 → 규제 (DB gu 표기 그대로)", () => {
    expect(isRegulatedArea(regulated, "경기", "구리시")).toBe(true);
    expect(isRegulatedArea(regulated, "경기", "용인시 기흥구")).toBe(true);
  });

  it("화성시는 이름 키만으로는 규제가 아니다 (동탄구만 지정 — 법정동코드 규칙이 가른다)", () => {
    expect(isRegulatedArea(regulated, "경기", "화성시")).toBe(false);
  });
});

// ── 법정동코드 규칙 (화성시 동탄구) ──────────────────────────────
describe("buildBjdPrefixRules · isRegulatedApt — 실제 regulation-zones.json 기준", () => {
  const regulated = buildRegulatedSet(realZones);
  const rules = buildBjdPrefixRules(realZones, regulated);

  it("41597 규칙 하나 — 시도 경기 · 시 화성시 · 동 이름 머리 '동탄'", () => {
    expect(rules).toEqual([{ prefix: "41597", region: "경기", city: "화성시", dongPrefix: "동탄" }]);
  });

  // 화성시 4구 코드 = _shared.mjs HWASEONG_LAWD_CODES 주석 순서(만세 41591·효행 41593·병점 41595·동탄 41597)
  it("동탄구 코드(41597)로 시작하면 규제 — 동 이름이 '동탄'이 아니어도(반송동·여울동 등)", () => {
    for (const [code, dong] of [
      ["4159711500", "동탄6동"],
      ["4159711100", "반송동"],
      ["4159712000", "여울동"],
    ]) {
      expect(isRegulatedApt(regulated, rules, { region: "경기", gu: "화성시", bjd_code: code, dong })).toBe(true);
    }
  });

  it.each(["41591", "41593", "41595"])("화성 나머지 구(%s)는 비규제 — 동 이름이 동탄으로 시작해도 코드가 이긴다", (p) => {
    expect(
      isRegulatedApt(regulated, rules, { region: "경기", gu: "화성시", bjd_code: `${p}25000`, dong: "남양읍" })
    ).toBe(false);
    expect(
      isRegulatedApt(regulated, rules, { region: "경기", gu: "화성시", bjd_code: `${p}25000`, dong: "동탄구" })
    ).toBe(false);
  });

  it("법정동코드가 비었고 gu 화성시 + dong '동탄…' → 규제 (코드 없는 행 실측 3)", () => {
    for (const code of [null, undefined, ""]) {
      expect(isRegulatedApt(regulated, rules, { region: "경기", gu: "화성시", bjd_code: code, dong: "동탄구" })).toBe(
        true
      );
    }
  });

  it("법정동코드가 비었어도 동탄이 아니면(효행구) 비규제 · 다른 시의 '동탄' 동 이름은 비규제", () => {
    expect(isRegulatedApt(regulated, rules, { region: "경기", gu: "화성시", bjd_code: null, dong: "효행구" })).toBe(
      false
    );
    expect(isRegulatedApt(regulated, rules, { region: "경기", gu: "오산시", bjd_code: null, dong: "동탄로" })).toBe(
      false
    );
  });

  it("이름 키 규제는 그대로 — 서울·구리시·기흥구, 지방은 비규제", () => {
    expect(isRegulatedApt(regulated, rules, { region: "서울", gu: "강남구", bjd_code: "1168010100" })).toBe(true);
    expect(isRegulatedApt(regulated, rules, { region: "경기", gu: "구리시", bjd_code: "4131010100" })).toBe(true);
    expect(isRegulatedApt(regulated, rules, { region: "경기", gu: "용인시 기흥구", bjd_code: "4146310100" })).toBe(
      true
    );
    expect(isRegulatedApt(regulated, rules, { region: "부산", gu: "해운대구", bjd_code: "2635010100" })).toBe(false);
  });

  it("규칙의 이름이 규제 목록에서 빠지면 규칙도 꺼진다 (목록이 단일 출처)", () => {
    const z = {
      ...realZones,
      투기과열지구: realZones["투기과열지구"].filter((/** @type {string} */ x) => x !== "경기 화성시 동탄구"),
    };
    z["조정대상지역"] = z["투기과열지구"];
    const reg = buildRegulatedSet(z);
    expect(buildBjdPrefixRules(z, reg)).toEqual([]);
  });

  // 세션592 보완 F4 — 규칙이 0개면 이름 키 말고는 아무것도 규제로 잡지 않는다.
  // ⚠️ 변이 대상: 규칙 없이도 코드·동 이름만으로 참을 돌려주게 바꾸면 빨강.
  it("규칙이 0개면 동탄 코드·동 이름이어도 비규제 (이름 키 규제는 그대로)", () => {
    expect(isRegulatedApt(regulated, [], { region: "경기", gu: "화성시", bjd_code: "4159711500", dong: "동탄6동" })).toBe(
      false
    );
    expect(isRegulatedApt(regulated, [], { region: "경기", gu: "화성시", bjd_code: null, dong: "동탄구" })).toBe(false);
    expect(isRegulatedApt(regulated, [], { region: "서울", gu: "강남구", bjd_code: "1168010100" })).toBe(true);
  });

  // ⚠️ 변이 대상: 코드 없는 행의 동 이름 규칙에서 시도 비교(`region === r.region`)를 빼면 빨강.
  it("코드가 없고 동 이름이 '동탄…'이어도 다른 시도의 같은 시 이름이면 비규제", () => {
    expect(isRegulatedApt(regulated, rules, { region: "충남", gu: "화성시", bjd_code: null, dong: "동탄1동" })).toBe(
      false
    );
  });

  // 세션593 — 세션592 검사관 변이 M18(startsWith → includes)이 살아남았던 자리.
  // ⚠️ 변이 대상: 동 이름 비교를 "들어 있으면"으로 넓히면 빨강.
  it("코드가 없을 때 동 이름은 머리로 시작해야만 맞다 — 가운데 '동탄'이 들어 있으면 비규제", () => {
    for (const dong of ["신동탄동", "남동탄1동", "봉담읍 동탄로"]) {
      expect(isRegulatedApt(regulated, rules, { region: "경기", gu: "화성시", bjd_code: null, dong })).toBe(false);
    }
    // 대조군: 머리로 시작하면 규제
    expect(isRegulatedApt(regulated, rules, { region: "경기", gu: "화성시", bjd_code: null, dong: "동탄1동" })).toBe(
      true
    );
  });

  // 세션593 — 세션592 검사관 변이 M19(`r.dongPrefix !== ""` 삭제)가 살아남았던 자리.
  // 지정 이름이 "시도 시" 두 낱말뿐이면 동 이름 머리가 빈 규칙이 생긴다 — 빈 머리는 아무 동에도 맞지 않아야 한다.
  // ⚠️ 변이 대상: 빈 머리 보호를 지우면 ""로 시작하는 모든 동이 규제가 되어 빨강.
  it("동 이름 머리가 빈 규칙은 코드 없는 행의 어떤 동에도 맞지 않는다", () => {
    const emptyRule = [{ prefix: "41590", region: "경기", city: "화성시", dongPrefix: "" }];
    for (const dong of ["동탄1동", "남양읍", ""]) {
      expect(isRegulatedApt(regulated, emptyRule, { region: "경기", gu: "화성시", bjd_code: null, dong })).toBe(
        false
      );
    }
    // 코드가 있으면 코드 규칙은 그대로 산다(빈 머리 보호가 코드 판정까지 끄지 않는다)
    expect(
      isRegulatedApt(regulated, emptyRule, { region: "경기", gu: "화성시", bjd_code: "4159012000", dong: "남양읍" })
    ).toBe(true);
  });

  it("_bjdPrefixZones 가 없거나 배열이면 규칙 0", () => {
    expect(buildBjdPrefixRules({}, regulated)).toEqual([]);
    expect(buildBjdPrefixRules({ _bjdPrefixZones: ["41597"] }, regulated)).toEqual([]);
  });
});

// ── makeRegionKey ─────────────────────────────────────────────
describe("makeRegionKey", () => {
  it("region + gu → '서울 강남구'", () => {
    expect(makeRegionKey("서울", "강남구")).toBe("서울 강남구");
  });

  it("gu null → 'region'만", () => {
    expect(makeRegionKey("세종", null)).toBe("세종");
  });

  it("region null → 'gu'만", () => {
    expect(makeRegionKey(null, "강남구")).toBe("강남구");
  });

  it("모두 null → 빈 문자열", () => {
    expect(makeRegionKey(null, null)).toBe("");
  });

  it("undefined 처리 → null과 동일", () => {
    expect(makeRegionKey(undefined, undefined)).toBe("");
  });
});

// ── 차단기(세션662 — 사장님 결정 10/26: 하루 50곳(단지) 넘게 바뀌면 멈춤, 진짜 지정·해제 날은 --force) ──
const {
  evaluateRegBreaker, planRegulationChanges, countChangesBySido, countChangedPlaces, runRegulationSeed, parseSeedArgs, main,
  REG_BREAKER_MAX_ROWS,
} = await import("./regulation-seed.mjs");

/** @param {number} n 서로 다른 단지 n곳(묶음 열쇠 = id) */
const fakeChanges = (n) => Array.from({ length: n }, (_, i) => ({ id: `c${i}` }));
const BREAKER_51 = "REG_BREAKER 바뀔 단지 51곳(행 51개) > 50곳 — 표를 확인하고 --force(Actions daily-deploy 수동 실행 regulation_force)로";

describe("evaluateRegBreaker — 상한 판정(단지 수 = complex_key || id 고유 개수)", () => {
  it("상한은 50", () => {
    expect(REG_BREAKER_MAX_ROWS).toBe(50);
  });
  it("빈 목록 · 50곳은 통과, 51곳은 걸림(머리말 REG_BREAKER · 곳·행 둘 다 적음)", () => {
    expect(evaluateRegBreaker([])).toEqual({ tripped: false, over: false, places: 0, reason: null });
    expect(evaluateRegBreaker(fakeChanges(50)).tripped).toBe(false);
    const r = evaluateRegBreaker(fakeChanges(51));
    expect(r.tripped).toBe(true);
    expect(r.reason).toBe(BREAKER_51);
  });
  it("51행이지만 30곳(같은 묶음 열쇠)이면 통과", () => {
    const ch = Array.from({ length: 51 }, (_, i) => ({ id: `r${i}`, bundle: `k${i % 30}` }));
    expect(countChangedPlaces(ch)).toBe(30);
    expect(evaluateRegBreaker(ch)).toMatchObject({ tripped: false, over: false, places: 30 });
  });
  it("묶음 열쇠가 없는 행은 id 로 각각 센다", () => {
    const ch = [{ id: "a", bundle: null }, { id: "b" }, { id: "c", bundle: "k" }, { id: "d", bundle: "k" }];
    expect(countChangedPlaces(ch)).toBe(3);
  });
  it("force 면 51곳도 통과(over 는 그대로 true)", () => {
    expect(evaluateRegBreaker(fakeChanges(51), { force: true })).toEqual({ tripped: false, over: true, places: 51, reason: null });
  });
  it("max 를 주면 그 값으로 판정", () => {
    expect(evaluateRegBreaker(fakeChanges(3), { max: 2 }).tripped).toBe(true);
    expect(evaluateRegBreaker(fakeChanges(2), { max: 2 }).tripped).toBe(false);
  });
});

describe("planRegulationChanges · countChangesBySido", () => {
  const regulated = new Set(["서울"]);
  it("지금 값과 판정이 다른 행만 모은다(null 은 false 와 다르다) · bundle = complex_key || id", () => {
    const apts = [
      { id: "a", complex_key: "ka", region: "서울", gu: "강남구", dong: null, bjd_code: null, is_regulated: true },
      { id: "b", complex_key: "kb", region: "서울", gu: "마포구", dong: null, bjd_code: null, is_regulated: false },
      { id: "c", complex_key: null, region: "부산", gu: "해운대구", dong: null, bjd_code: null, is_regulated: null },
      { id: "d", region: "부산", gu: "중구", dong: null, bjd_code: null, is_regulated: false },
    ];
    expect(planRegulationChanges(regulated, [], apts)).toEqual([
      { id: "b", bundle: "kb", region: "서울", gu: "마포구", prev: false, next: true },
      { id: "c", bundle: "c", region: "부산", gu: "해운대구", prev: null, next: false },
    ]);
  });
  it("complex_key 가 빈 문자열인 행은 id 로 각각 센다(한 묶음으로 뭉치지 않는다)", () => {
    const apts = ["e1", "e2"].map((id) => ({ id, complex_key: "", region: "서울", gu: "마포구", dong: null, bjd_code: null, is_regulated: false }));
    expect(countChangedPlaces(planRegulationChanges(regulated, [], apts))).toBe(2);
  });
  it("시도별 개수는 단지(곳) 기준 · 많은 순", () => {
    const ch = [
      { region: "경기", bundle: "g1" }, { region: "서울", bundle: "s1" }, { region: "서울", bundle: "s1" }, { region: "서울", bundle: "s2" }, { region: null },
    ].map((x, i) => ({ id: `${i}`, gu: null, prev: false, next: true, ...x }));
    expect(countChangesBySido(/** @type {any} */ (ch))).toBe("서울 2 · 경기 1 · (시도 없음) 1");
  });
});

describe("parseSeedArgs — 실행 인자", () => {
  it("없음 · --dry-run · --force · 둘 다", () => {
    expect(parseSeedArgs(["node", "x.mjs"])).toEqual({ dry: false, force: false });
    expect(parseSeedArgs(["node", "x.mjs", "--dry-run"])).toEqual({ dry: true, force: false });
    expect(parseSeedArgs(["node", "x.mjs", "--force"])).toEqual({ dry: false, force: true });
    expect(parseSeedArgs(["node", "x.mjs", "--dry-run", "--force"])).toEqual({ dry: true, force: true });
  });
});

const seedRegulated = new Set(["서울"]);
/** @param {number} n 바뀔 단지 수(전부 서울 · 지금 false → 규제, 묶음 열쇠 각각) */
const makeApts = (n) => [
  ...Array.from({ length: n }, (_, i) => ({ id: `s${i}`, complex_key: `k${i}`, region: "서울", gu: "마포구", dong: null, bjd_code: null, is_regulated: false })),
  { id: "keep", complex_key: "kk", region: "부산", gu: "중구", dong: null, bjd_code: null, is_regulated: false },
];
const makeSb = () => {
  /** @type {Array<{ values: any, id: any }>} */
  const calls = [];
  const sb = {
    from: (/** @type {string} */ table) => ({
      update: (/** @type {any} */ values) => ({
        eq: async (/** @type {string} */ _col, /** @type {any} */ id) => {
          calls.push({ values: { table, ...values }, id });
          return { error: null };
        },
      }),
    }),
  };
  return { sb, calls };
};
const makeRpt = () => {
  let ok = 0, fail = 0, skip = 0;
  return {
    interrupted: () => false,
    success: (n = 1) => { ok += n; },
    fail: (n = 1) => { fail += n; },
    skip: (n = 1) => { skip += n; },
    summary: () => ({ ok, fail, skip, status: fail > 0 ? "failure" : "success" }),
  };
};

describe("runRegulationSeed — 판정 → 쓰기 연결부(모의 supabase)", () => {
  const regulated = seedRegulated;

  it("51곳이면 update 0회 · failure(REG_BREAKER) 기록 · exitCode 1", async () => {
    const { sb, calls } = makeSb();
    const record = vi.fn(async () => {});
    const res = await runRegulationSeed({ sb, apts: makeApts(51), regulated, prefixRules: [], rpt: makeRpt(), record });
    expect(calls).toHaveLength(0);
    expect(res).toMatchObject({ tripped: true, updated: 0, exitCode: 1 });
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith("regulation-seed", { status: "failure", ok: 0, fail: 0, skip: 52, errorMessage: BREAKER_51 });
  });

  it("50곳이면 update 50회(바뀔 행만) · success 기록 · exitCode 0", async () => {
    const { sb, calls } = makeSb();
    const record = vi.fn(async () => {});
    const res = await runRegulationSeed({ sb, apts: makeApts(50), regulated, prefixRules: [], rpt: makeRpt(), record });
    expect(calls).toHaveLength(50);
    expect(calls.every((c) => c.values.table === "apartments" && c.values.is_regulated === true)).toBe(true);
    expect(calls.map((c) => c.id)).not.toContain("keep");
    expect(res).toMatchObject({ tripped: false, updated: 50, exitCode: 0 });
    expect(record).toHaveBeenCalledWith("regulation-seed", expect.objectContaining({ ok: 50, fail: 0, skip: 1, status: "success" }));
  });

  it("51행이지만 같은 단지 묶음으로 30곳이면 update 51회 · exitCode 0", async () => {
    const { sb, calls } = makeSb();
    const apts = makeApts(51).map((a, i) => (a.id === "keep" ? a : { ...a, complex_key: `k${i % 30}` }));
    const res = await runRegulationSeed({ sb, apts, regulated, prefixRules: [], rpt: makeRpt(), record: vi.fn(async () => {}) });
    expect(calls).toHaveLength(51);
    expect(res).toMatchObject({ tripped: false, exitCode: 0 });
  });

  it("51곳 + force 면 update 51회 · exitCode 0", async () => {
    const { sb, calls } = makeSb();
    const res = await runRegulationSeed({ sb, apts: makeApts(51), regulated, prefixRules: [], rpt: makeRpt(), force: true, record: vi.fn(async () => {}) });
    expect(calls).toHaveLength(51);
    expect(res).toMatchObject({ tripped: false, updated: 51, exitCode: 0 });
  });

  it("dry-run 은 걸려도 update 0회 · 기록 0 · exitCode 0", async () => {
    const { sb, calls } = makeSb();
    const record = vi.fn(async () => {});
    const res = await runRegulationSeed({ sb, apts: makeApts(51), regulated, prefixRules: [], rpt: makeRpt(), dry: true, record });
    expect(calls).toHaveLength(0);
    expect(record).not.toHaveBeenCalled();
    expect(res).toMatchObject({ tripped: true, exitCode: 0 });
  });

  it("'강제 통과' 로그는 상한을 넘었을 때만 · 상한 안이면 '영향 없음'", async () => {
    const shared = await import("./_shared.mjs");
    const logMock = /** @type {import('vitest').Mock} */ (/** @type {unknown} */ (shared.log));
    /** @param {number} n */
    const lines = async (n) => {
      logMock.mockClear();
      await runRegulationSeed({ sb: makeSb().sb, apts: makeApts(n), regulated, prefixRules: [], rpt: makeRpt(), force: true, record: vi.fn(async () => {}) });
      return logMock.mock.calls.map((c) => String(c[1]));
    };
    const over = await lines(51);
    expect(over.some((l) => l.startsWith("강제 통과(--force) — 바뀔 단지 51곳이 상한 50곳을 넘지만"))).toBe(true);
    const under = await lines(10);
    expect(under.some((l) => l.startsWith("강제 통과(--force)"))).toBe(false);
    expect(under.some((l) => l.includes("상한 안(10곳 ≤ 50곳)이라 영향 없음"))).toBe(true);
  });
});

describe("main — 인자 읽기 · exitCode 전달(DB·표 주입)", () => {
  const zones = { 투기과열지구: ["서울"] };
  /**
   * @param {string[]} extra
   * @param {number} n
   */
  const runMain = async (extra, n) => {
    const { sb, calls } = makeSb();
    const record = vi.fn(async () => {});
    const before = process.exitCode;
    process.exitCode = undefined;
    try {
      const code = await main({ argv: ["node", "regulation-seed.mjs", ...extra], sb, zones, apts: makeApts(n), rpt: makeRpt(), record });
      return { code, exitCode: process.exitCode, calls, record };
    } finally {
      process.exitCode = before;
    }
  };

  it("인자 없이 51곳 → update 0회 · process.exitCode 1", async () => {
    const r = await runMain([], 51);
    expect(r.calls).toHaveLength(0);
    expect(r.code).toBe(1);
    expect(r.exitCode).toBe(1);
  });

  it("--force 로 51곳 → update 51회 · process.exitCode 그대로(설정 안 함)", async () => {
    const r = await runMain(["--force"], 51);
    expect(r.calls).toHaveLength(51);
    expect(r.code).toBe(0);
    expect(r.exitCode).toBeUndefined();
  });

  it("운영 조회는 차단기가 단지를 셀 complex_key 를 함께 읽는다(위 시험은 apts 를 주입해 이 줄을 안 지난다)", () => {
    const src = readFileSync(resolve(ROOT, "scripts/collectors/regulation-seed.mjs"), "utf8");
    expect(src).toContain('s.from("apartments").select("id, complex_key, region, gu, dong, bjd_code, is_regulated"), sb, "id")');
  });

  it("daily-deploy 의 강제 통과 배선 — env 는 입력 그대로(기본값 대체 없음) · 조건은 정확히 \"true\" · else 쪽엔 --force 없음", () => {
    const yml = readFileSync(resolve(ROOT, ".github/workflows/daily-deploy.yml"), "utf8").replace(/\r\n/g, "\n");
    const envLines = yml.split("\n").filter((l) => /^\s*REG_FORCE:/.test(l));
    expect(envLines).toEqual(["          REG_FORCE: ${{ inputs.regulation_force }}"]);
    const block = [
      '          if [ "$REG_FORCE" = "true" ]; then',
      "            node scripts/collectors/regulation-seed.mjs --force",
      "          else",
      "            node scripts/collectors/regulation-seed.mjs",
      "          fi",
    ].join("\n");
    expect(yml).toContain(block);
    expect(yml.split("\n").filter((l) => l.includes("$REG_FORCE"))).toEqual(['          if [ "$REG_FORCE" = "true" ]; then']);
  });

  it("--dry-run 으로 51곳 → update 0회 · 기록 0 · process.exitCode 그대로", async () => {
    const r = await runMain(["--dry-run"], 51);
    expect(r.calls).toHaveLength(0);
    expect(r.record).not.toHaveBeenCalled();
    expect(r.exitCode).toBeUndefined();
  });
});
