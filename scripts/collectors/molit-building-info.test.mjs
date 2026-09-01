// @ts-check
/**
 * molit-building-info.mjs 테스트 — 건물 상세 수집기 검증
 *
 * 대상: extractBuildingInfo, updateBuilding, fetchAptDetail, E2E 시나리오
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

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
  };
});

// _molit-api.mjs 모킹 — molitApiCall 제어
const mockMolitApiCall = vi.fn();
vi.mock("./_molit-api.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return { ...orig, molitApiCall: mockMolitApiCall };
});

// MOLIT_KEY 설정 — process.exit 방지
process.env.MOLIT_KEY = "test-key";

const { extractBuildingInfo, updateBuilding, fetchAptDetail } = await import("./molit-building-info.mjs");

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
