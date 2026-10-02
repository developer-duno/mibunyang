// @ts-check
/**
 * molit-building-info.mjs 테스트 — 건물 상세 수집기 검증
 *
 * 대상: extractBuildingInfo, updateBuilding, fetchAptDetail, E2E 시나리오
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// _shared.mjs 모킹 — 외부 호출 차단
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return {
    ...orig,
    loadEnv: vi.fn(),
    getSupabase: vi.fn(),
    sleep: vi.fn(),
    log: vi.fn(),
    logError: vi.fn(),
    recordApiQuota: vi.fn(),
    recordCollectorRun: vi.fn(),
  };
});

// _molit-api.mjs 모킹 — molitApiCall·fetchSidoAptList 제어(main() 경로 시험용, 세션589)
const mockMolitApiCall = vi.fn();
const mockFetchSidoAptList = vi.fn();
vi.mock("./_molit-api.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return { ...orig, molitApiCall: mockMolitApiCall, fetchSidoAptList: mockFetchSidoAptList };
});

// MOLIT_KEY 설정 — process.exit 방지
process.env.MOLIT_KEY = "test-key";

const { extractBuildingInfo, updateBuilding, fetchAptDetail, onlyEmptyFields, main } = await import("./molit-building-info.mjs");
const { getSupabase, recordCollectorRun } = /** @type {any} */ (await import("./_shared.mjs"));
const { KaptResultError } = await import("./_molit-api.mjs");

// ── 팩토리 ───────────────────────────────────────────────────
/**
 * @param {any} [overrides]
 * @returns {any}
 */
function makeDetail(overrides = {}) {
  return {
    kaptdPcnt: "200",     // 지상 주차
    kaptdPcntu: "500",    // 지하 주차
    kaptdaCnt: "1000",    // 세대수
    ktownFlrNo: "25",     // 최고층
    codeHeatNm: "개별난방",
    codeHallNm: "복도식",
    ...overrides,
  };
}

/**
 * @param {any} [updateResult]
 * @returns {any}
 */
function makeMockSb(updateResult = { error: null }) {
  const eq = vi.fn().mockResolvedValue(updateResult);
  const update = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ update });
  return { from, update, eq };
}

// ── extractBuildingInfo ──────────────────────────────────────
describe("extractBuildingInfo", () => {
  it("기본값으로 4개 필드 모두 정확히 추출", () => {
    const info = extractBuildingInfo(makeDetail());
    expect(info.parking_ratio).toBe(0.7);
    expect(info.max_floor).toBe(25);
    expect(info.heating).toBe("개별난방");
    expect(info.corridor_type).toBe("복도식");
  });

  // parking_ratio 엣지케이스
  const parkingCases = [
    ["주차 0대 → null", { kaptdPcnt: "0", kaptdPcntu: "0" }, null],
    ["세대수 0 → null", { kaptdaCnt: "0" }, null],
    ["필드 누락 → null", { kaptdPcnt: null, kaptdPcntu: null, kaptdaCnt: null }, null],
    ["반올림 검증 (333/1000=0.33)", { kaptdPcnt: "333", kaptdPcntu: "0" }, 0.33],
    // 0-sentinel 화석화 방어(세션538) — 반올림 결과가 0.00 이면 "값"이 아니라 "안 잰 것".
    // 주차 대수는 0 이상인데 세대수가 커서 비율이 0.005 미만이면 Math.round 가 0 으로 뭉갠다.
    // 0대/세대인 아파트는 없으므로 이 세 케이스는 실제 라이브에서 나온 값(적대검증 실측).
    ["0.00 로 반올림 (1/300)", { kaptdPcnt: "1", kaptdPcntu: "0", kaptdaCnt: "300" }, null],
    ["0.00 로 반올림 (1/201)", { kaptdPcnt: "1", kaptdPcntu: "0", kaptdaCnt: "201" }, null],
    ["0.00 로 반올림 (2/500)", { kaptdPcnt: "2", kaptdPcntu: "0", kaptdaCnt: "500" }, null],
    // 경계 확인 — 0.005 이상은 0.01 로 살아남아야 한다(전량 null 로 뭉개면 안 됨)
    ["경계 — 0.01 로 살아남음 (3/300=0.01)", { kaptdPcnt: "3", kaptdPcntu: "0", kaptdaCnt: "300" }, 0.01],
  ];
  for (const [label, overrides, expected] of parkingCases) {
    it(`parking_ratio — ${label}`, () => {
      expect(extractBuildingInfo(makeDetail(overrides)).parking_ratio).toBe(expected);
    });
  }

  // max_floor 엣지케이스
  const floorCases = [
    [null, null], ["abc", null], ["0", null], ["25", 25],
  ];
  for (const [input, expected] of floorCases) {
    it(`max_floor — ktownFlrNo="${input}" → ${expected}`, () => {
      expect(extractBuildingInfo(makeDetail({ ktownFlrNo: input })).max_floor).toBe(expected);
    });
  }

  // heating + corridor 엣지케이스
  const textCases = [
    ["정상값", "개별난방", "복도식", "개별난방", "복도식"],
    ["빈 문자열 → null", "", "", null, null],
    ["null → null", null, null, null, null],
  ];
  for (const [label, heat, corr, expHeat, expCorr] of textCases) {
    it(`heating/corridor — ${label}`, () => {
      const info = extractBuildingInfo(makeDetail({ codeHeatNm: heat, codeHallNm: corr }));
      expect(info.heating).toBe(expHeat);
      expect(info.corridor_type).toBe(expCorr);
    });
  }
});

// ── updateBuilding ───────────────────────────────────────────
describe("updateBuilding", () => {
  it("non-null 필드만 UPDATE + updated_at + 성공 반환", async () => {
    const sb = makeMockSb();
    const info = { parking_ratio: 0.7, max_floor: null, heating: "개별난방", corridor_type: null };
    const ok = await updateBuilding(sb, "apt-1", /** @type {any} */ (info), false);

    expect(ok).toBe(true);
    const updateArg = sb.from("apartments").update.mock.calls[0][0];
    expect(updateArg.parking_ratio).toBe(0.7);
    expect(updateArg.heating).toBe("개별난방");
    expect(updateArg.updated_at).toBeDefined();
    // null 필드는 포함되지 않아야 함
    expect(updateArg).not.toHaveProperty("max_floor");
    expect(updateArg).not.toHaveProperty("corridor_type");
  });

  it("전부 null → DB 호출 없이 false 반환", async () => {
    const sb = makeMockSb();
    const info = { parking_ratio: null, max_floor: null, heating: null, corridor_type: null };
    const ok = await updateBuilding(sb, "apt-1", /** @type {any} */ (info), false);

    expect(ok).toBe(false);
    expect(sb.from).not.toHaveBeenCalled();
  });

  it("dryRun=true → DB 미호출 + true 반환", async () => {
    const sb = makeMockSb();
    const info = { parking_ratio: 0.5, max_floor: 20, heating: "지역난방", corridor_type: "계단식" };
    const ok = await updateBuilding(sb, "apt-1", /** @type {any} */ (info), true);

    expect(ok).toBe(true);
    expect(sb.from).not.toHaveBeenCalled();
  });

  it("Supabase 에러 → false + logError 호출", async () => {
    const sb = makeMockSb({ error: { message: "DB 실패" } });
    const info = { parking_ratio: 0.5, max_floor: null, heating: null, corridor_type: null };
    const ok = await updateBuilding(sb, "apt-1", /** @type {any} */ (info), false);

    expect(ok).toBe(false);
  });
});

// ── fetchAptDetail ───────────────────────────────────────────
describe("fetchAptDetail", () => {
  beforeEach(() => {
    mockMolitApiCall.mockReset();
  });

  it("bass + dtl 모두 성공 → 병합된 객체 반환", async () => {
    mockMolitApiCall
      .mockResolvedValueOnce({ response: { body: { item: { kaptdaCnt: "500", ktownFlrNo: "20" } } } })
      .mockResolvedValueOnce({ response: { body: { item: { kaptdPcnt: "100", kaptdEcnt: "3" } } } });

    const detail = await fetchAptDetail("K001");
    expect(detail).not.toBeNull();
    expect(detail?.kaptdaCnt).toBe("500");
    expect(detail?.kaptdPcnt).toBe("100");
  });

  // 부분 실패 시나리오
  const partialCases = [
    ["bass만 성공", { response: { body: { item: { kaptdaCnt: "300" } } } }, { response: { body: null } }, "kaptdaCnt"],
    ["dtl만 성공", { response: { body: null } }, { response: { body: { item: { kaptdEcnt: "2" } } } }, "kaptdEcnt"],
    ["둘 다 실패 → null", { response: { body: null } }, { response: { body: null } }, null],
  ];
  for (const [label, bassRes, dtlRes, checkField] of partialCases) {
    it(/** @type {string} */ (label), async () => {
      mockMolitApiCall.mockResolvedValueOnce(bassRes).mockResolvedValueOnce(dtlRes);
      const detail = await fetchAptDetail("K001");
      if (checkField === null) {
        expect(detail).toBeNull();
      } else {
        expect(detail).not.toBeNull();
        expect(/** @type {any} */ (detail)?.[/** @type {string} */ (checkField)]).toBeDefined();
      }
    });
  }
});

// ── E2E 시나리오 ─────────────────────────────────────────────
describe("E2E 시나리오", () => {
  beforeEach(() => {
    mockMolitApiCall.mockReset();
  });

  it("상세조회 → 추출 → 업데이트 파이프라인", async () => {
    // fetchAptDetail → bass + dtl 성공
    mockMolitApiCall
      .mockResolvedValueOnce({ response: { body: { item: { kaptdaCnt: "800", ktownFlrNo: "30", codeHeatNm: "지역난방", codeHallNm: "혼합식" } } } })
      .mockResolvedValueOnce({ response: { body: { item: { kaptdPcnt: "200", kaptdPcntu: "600" } } } });

    const detail = await fetchAptDetail("K001");
    expect(detail).not.toBeNull();

    const info = extractBuildingInfo(/** @type {any} */ (detail));
    expect(info.parking_ratio).toBe(1);     // (200+600)/800
    expect(info.max_floor).toBe(30);
    expect(info.heating).toBe("지역난방");
    expect(info.corridor_type).toBe("혼합식");

    // updateBuilding 성공
    const sb = makeMockSb();
    const ok = await updateBuilding(sb, "apt-1", info, false);
    expect(ok).toBe(true);
    expect(sb.from).toHaveBeenCalledWith("apartments");
  });

  it("0.00 로 반올림되는 실전 값 → 추출~업데이트 전 구간에서 parking_ratio 가 안 실린다 (세션538)", async () => {
    // 세션538 적대검증 실측 재현: 주차 1대 / 세대 300 → 반올림 0.00.
    mockMolitApiCall
      .mockResolvedValueOnce({ response: { body: { item: { kaptdaCnt: "300", ktownFlrNo: "15", codeHeatNm: "개별난방", codeHallNm: "계단식" } } } })
      .mockResolvedValueOnce({ response: { body: { item: { kaptdPcnt: "1", kaptdPcntu: "0" } } } });

    const detail = await fetchAptDetail("K002");
    const info = extractBuildingInfo(/** @type {any} */ (detail));
    expect(info.parking_ratio).toBeNull(); // 0 이 아니라 null — "미수집" 취급

    const sb = makeMockSb();
    await updateBuilding(sb, "apt-2", info, false);
    const updateArg = sb.update.mock.calls[0][0];
    expect(updateArg.parking_ratio).toBeUndefined(); // 화면·점수 sentinel(0) 이 다시 안 박힘
    expect(updateArg.max_floor).toBe(15); // 다른 필드는 정상 반영(전부 null 처리로 뭉개지지 않음)
  });

  it("빈 상세 → 추출 건너뛰기 (main 로직 재현)", async () => {
    mockMolitApiCall
      .mockResolvedValueOnce({ response: { body: null } })
      .mockResolvedValueOnce({ response: { body: null } });

    const detail = await fetchAptDetail("K999");
    expect(detail).toBeNull();
    // detail이 null이면 extractBuildingInfo를 호출하지 않음 (main에서 continue)
  });
});

// ── K6 빈칸만 채움 (세션589) ────────────────────────────────────
// 옛 동작: 최고층만 비어도 주차·난방·복도유형까지 K-apt 값으로 덮었다(조사반 G R1-G2).
describe("onlyEmptyFields — 값이 이미 있는 칸은 안 덮는다", () => {
  const info = { parking_ratio: 1.5, max_floor: 30, heating: "지역난방", corridor_type: "계단식" };

  it("빈칸(null·0·빈 문자열)만 남기고 값 있는 칸은 null 로 뺀다", () => {
    expect(onlyEmptyFields(info, { parking_ratio: 1.2, max_floor: null, heating: "개별난방", corridor_type: "" }))
      .toEqual({ parking_ratio: null, max_floor: 30, heating: null, corridor_type: "계단식" });
    expect(onlyEmptyFields(info, { parking_ratio: 0, max_floor: 0, heating: null, corridor_type: null })).toEqual(info);
  });

  it("전부 차 있으면 쓸 것이 없다 → updateBuilding 이 DB 를 안 부른다", async () => {
    const sb = makeMockSb();
    const ok = await updateBuilding(sb, "a", onlyEmptyFields(info, { parking_ratio: 1, max_floor: 20, heating: "개별난방", corridor_type: "복도식" }), false);
    expect(ok).toBe(false);
    expect(sb.from).not.toHaveBeenCalled();
  });
});

// ── main() 실전 경로 — 게이트·사용승인일·빈칸만·결과 코드 (세션589 T4) ─────────
describe("main() — 세션589 게이트 실전 경로", () => {
  /** 2026-10-11(일) 05:30 KST */
  const NOW = new Date("2026-10-10T20:30:00Z");
  /** @type {any} */
  let exitSpy;
  const LIST = [
    { kaptCode: "K-SDT", kaptName: "신동탄 롯데캐슬아파트", bjdCode: "4159510500", as1: "경기도", as2: "화성병점구", as3: "반월동" },
    { kaptCode: "K-DT2", kaptName: "동탄2 롯데캐슬", bjdCode: "4159711100", as1: "경기도", as2: "화성동탄구", as3: "장지동" },
  ];
  /** @param {string} id @param {string|null} completion @param {Record<string, unknown>} [f] */
  const target = (id, completion, f = {}) => ({ id, name: "신동탄롯데캐슬", region: "경기", gu: "화성시", address: null,
    parking_ratio: null, max_floor: null, heating: null, corridor_type: null, completion, bjd_code: "4159510500", ...f });

  /** @param {any[]} rows */
  function makeMainSb(rows) {
    /** @type {Array<{ id: string; row: any }>} */
    const updates = [];
    const sb = {
      from: () => ({
        select: () => ({ or: () => ({ order: () => ({ limit: () => ({
          gt: () => Promise.resolve({ data: [], error: null }),
          /** @param {any} res @param {any} rej */
          then: (res, rej) => Promise.resolve({ data: rows, error: null }).then(res, rej),
        }) }) }) }),
        /** @param {any} row */
        update: (row) => ({ eq: (/** @type {string} */ _c, /** @type {string} */ id) => { updates.push({ id, row }); return Promise.resolve({ error: null }); } }),
      }),
    };
    return { sb, updates };
  }

  /** @param {any} bass @param {any} [dtl] */
  function routeDetail(bass, dtl = { kaptdPcnt: "300", kaptdPcntu: "900" }) {
    mockMolitApiCall.mockImplementation(async (/** @type {string} */ _p, /** @type {string} */ _b, /** @type {string} */ ep) => {
      if (bass instanceof Error) throw bass;
      return { response: { body: { item: ep === "getAphusBassInfoV5" ? bass : dtl } } };
    });
  }

  beforeEach(() => {
    mockMolitApiCall.mockReset();
    mockFetchSidoAptList.mockReset();
    recordCollectorRun.mockClear();
    exitSpy = vi.spyOn(process, "exit").mockImplementation(/** @type {any} */ (() => undefined));
  });
  afterEach(() => { exitSpy.mockRestore(); });

  it("맞는 단지(K-SDT)로 빈칸만 채운다 — 값 있는 주차·난방은 K-apt 값이 달라도 안 덮는다", async () => {
    const { sb, updates } = makeMainSb([target("t1", "201806", { parking_ratio: 1.1, heating: "개별난방" })]);
    getSupabase.mockReturnValue(sb);
    mockFetchSidoAptList.mockResolvedValue(LIST);
    routeDetail({ kaptdaCnt: "600", ktownFlrNo: "29", codeHeatNm: "지역난방", codeHallNm: "계단식", kaptUsedate: "20180629" });
    await main({ now: NOW });
    expect(mockMolitApiCall.mock.calls[0][3]).toEqual({ kaptCode: "K-SDT" });
    expect(updates).toHaveLength(1);
    const row = updates[0].row;
    expect(row.max_floor).toBe(29);
    expect(row.corridor_type).toBe("계단식");
    expect(row.parking_ratio).toBeUndefined(); // 1.1 그대로(K-apt 2.0 으로 안 덮음)
    expect(row.heating).toBeUndefined(); // 개별난방 그대로
  });

  it("입주 전·완공월 모름은 부르지도 않는다 · 사용승인일 25개월 차이는 쓰지 않는다", async () => {
    const { sb, updates } = makeMainSb([target("pre", "202711"), target("nocomp", null), target("far", "201806")]);
    getSupabase.mockReturnValue(sb);
    mockFetchSidoAptList.mockResolvedValue(LIST);
    routeDetail({ kaptdaCnt: "600", ktownFlrNo: "29", kaptUsedate: "20200701" });
    await main({ now: NOW });
    expect(mockMolitApiCall).toHaveBeenCalledTimes(2); // far 1곳만 (기본+상세)
    expect(updates).toEqual([]);
    expect(recordCollectorRun).toHaveBeenCalledWith("molit-building", expect.objectContaining({ ok: 0, skip: 3, fail: 0 }));
  });

  it("R2 — 04 면 회차를 멈추고 KAPT_RESULT_04 로 실패 기록", async () => {
    const { sb } = makeMainSb([target("a", "201806"), target("b", "201806")]);
    getSupabase.mockReturnValue(sb);
    mockFetchSidoAptList.mockResolvedValue(LIST);
    routeDetail(new KaptResultError("04", "HTTP_ERROR", "getAphusBassInfoV5"));
    await main({ now: NOW });
    expect(mockMolitApiCall).toHaveBeenCalledTimes(1);
    const rec = recordCollectorRun.mock.calls.at(-1)[1];
    expect(rec.errorMessage).toMatch(/^KAPT_RESULT_04/);
    expect(rec.fail).toBeGreaterThan(0);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  // ── 세션589 보완 B1·B4 ──────────────────────────────────────
  /** @param {string} hhmm KST 2026-10-11 의 시각 */
  const kst = (hhmm) => new Date(`2026-10-11T${hhmm}:00+09:00`);

  it("B1 — 시작이 2u 창 5분 전 안(06:16)이면 K-apt 를 안 부르고 SIBLING_KAPT_WINDOW 로 남긴다", async () => {
    const { sb, updates } = makeMainSb([target("a", "201806"), target("b", "201806")]);
    getSupabase.mockReturnValue(sb);
    mockFetchSidoAptList.mockResolvedValue(LIST);
    routeDetail({ kaptdaCnt: "600", ktownFlrNo: "29", kaptUsedate: "20180629" });
    await main({ now: NOW, clock: () => kst("06:16") });
    expect(mockFetchSidoAptList).not.toHaveBeenCalled();
    expect(mockMolitApiCall).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
    expect(recordCollectorRun).toHaveBeenCalledWith("molit-building", expect.objectContaining({ ok: 0, skip: 2, fail: 0, errorMessage: expect.stringMatching(/^SIBLING_KAPT_WINDOW .*남은 2곳/) }));
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("B1 — 06:14 에는 계속, 다음 단지 차례가 06:16 이면 그 자리에서 멈춘다", async () => {
    const { sb, updates } = makeMainSb([target("a", "201806"), target("b", "201806"), target("c", "201806")]);
    getSupabase.mockReturnValue(sb);
    mockFetchSidoAptList.mockResolvedValue(LIST);
    routeDetail({ kaptdaCnt: "600", ktownFlrNo: "29", kaptUsedate: "20180629" });
    const times = [kst("06:10"), kst("06:14"), kst("06:16")]; // 목록 · 단지 a · 단지 b
    let k = 0;
    await main({ now: NOW, clock: () => times[Math.min(k++, times.length - 1)] });
    expect(updates.map((u) => u.id)).toEqual(["a"]);
    expect(recordCollectorRun).toHaveBeenCalledWith("molit-building", expect.objectContaining({ ok: 1, skip: 2, errorMessage: expect.stringMatching(/^SIBLING_KAPT_WINDOW .*남은 2곳/) }));
  });

  it("B4 — 결과 코드 아닌 실패가 연속 5건이면 KAPT_FETCH_FAIL 로 멈춘다", async () => {
    const { sb, updates } = makeMainSb(Array.from({ length: 7 }, (_, i) => target(`t${i}`, "201806")));
    getSupabase.mockReturnValue(sb);
    mockFetchSidoAptList.mockResolvedValue(LIST);
    routeDetail(new Error("getAphusBassInfoV5: 3회 재시도 소진 (마지막 상태: 503)"));
    await main({ now: NOW });
    expect(mockMolitApiCall).toHaveBeenCalledTimes(5); // 기본정보에서 던져 상세는 안 부른다 · 여섯째 단지는 안 부른다
    expect(updates).toEqual([]);
    const rec = recordCollectorRun.mock.calls.at(-1)[1];
    expect(rec.fail).toBe(5);
    expect(rec.errorMessage).toMatch(/^KAPT_FETCH_FAIL 연속 5건/);
  });
});
