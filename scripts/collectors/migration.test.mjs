// @ts-check
/**
 * migration.mjs 테스트 — KOSIS DT_1B26001_A01 파서 검증
 *
 * 대상: normalizeC1Name, mapC1, aggregateKosisRows, C1_TO_REGION
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchWithRetryMock = vi.fn();

vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return {
    ...orig,
    loadEnv: vi.fn(),
    getSupabase: vi.fn(),
    log: vi.fn(),
    logError: vi.fn(),
    recordApiQuota: vi.fn(),
    recordCollectorRun: vi.fn(),
    REGION_LAWD_PREFIX: orig.REGION_LAWD_PREFIX,
    fetchWithRetry: (/** @type {unknown[]} */ ...args) => fetchWithRetryMock(...args),
  };
});

process.env.KOSIS_MIGRATION_KEY = "test-key";

const { normalizeC1Name, mapC1, aggregateKosisRows, detectDeadPrefixes, parseDT, C1_TO_REGION, fetchKosis, main } = await import("./migration.mjs");
const { recordCollectorRun, logError } = /** @type {any} */ (await import("./_shared.mjs"));

// ── normalizeC1Name ──────────────────────────────────────────
describe("normalizeC1Name", () => {
  it("공백 2칸 제거 '중  구' → '중구'", () => {
    expect(normalizeC1Name("중  구")).toBe("중구");
  });
  it("공백 없는 이름 유지", () => {
    expect(normalizeC1Name("강남구")).toBe("강남구");
  });
  it("null → null", () => {
    expect(normalizeC1Name(null)).toBeNull();
  });
});

// ── C1_TO_REGION ─────────────────────────────────────────────
describe("C1_TO_REGION", () => {
  it("주요 시도 매핑", () => {
    expect(C1_TO_REGION["11"]).toBe("서울");
    expect(C1_TO_REGION["26"]).toBe("부산");
    expect(C1_TO_REGION["41"]).toBe("경기");
    expect(C1_TO_REGION["36"]).toBe("세종");
  });
  it("강원 51(신) + 42(레거시 방어)", () => {
    expect(C1_TO_REGION["51"]).toBe("강원");
    expect(C1_TO_REGION["42"]).toBe("강원");
  });
  it("전북 52(신) + 45(레거시 방어)", () => {
    expect(C1_TO_REGION["52"]).toBe("전북");
    expect(C1_TO_REGION["45"]).toBe("전북");
  });
});

// ── mapC1 ────────────────────────────────────────────────────
describe("mapC1", () => {
  it("'00' 전국 → null (제외)", () => {
    expect(mapC1("00", "전국")).toBeNull();
  });
  it("2자리 시도 11 → { region: 서울, gu: null }", () => {
    expect(mapC1("11", "서울특별시")).toEqual({ region: "서울", gu: null });
  });
  it("5자리 시군구 11680 → { region: 서울, gu: 강남구 }", () => {
    expect(mapC1("11680", "강남구")).toEqual({ region: "서울", gu: "강남구" });
  });
  it("부산 중구 26110 ('중  구' 공백 정규화)", () => {
    expect(mapC1("26110", "중  구")).toEqual({ region: "부산", gu: "중구" });
  });
  it("서울 중구 11140 — 동명이구 prefix 구분", () => {
    expect(mapC1("11140", "중구")).toEqual({ region: "서울", gu: "중구" });
  });
  it("세종 5자리 → { region: 세종, gu: 세종시 }", () => {
    expect(mapC1("36110", "세종시")).toEqual({ region: "세종", gu: "세종시" });
  });
  it("강원 51 prefix → 강원 매핑", () => {
    expect(mapC1("51110", "춘천시")).toEqual({ region: "강원", gu: "춘천시" });
  });
  it("전북 52 prefix → 전북 매핑", () => {
    expect(mapC1("52110", "전주시")).toEqual({ region: "전북", gu: "전주시" });
  });
  it("알 수 없는 prefix → null", () => {
    expect(mapC1("99110", "알수없음")).toBeNull();
  });
  it("3자리 이상한 코드 → null", () => {
    expect(mapC1("111", "이상")).toBeNull();
  });
});

// ── aggregateKosisRows ───────────────────────────────────────
// 세션522 — gu 표기 통일 배선 가드.
// KOSIS 는 일반구를 압축형("수원장안구")으로 준다. normalizeC1Name 은 공백만 걷어낼 뿐이라
// 그 표기가 그대로 UPDATE 키가 됐고, canonical 행("수원시 장안구")은 net_migration 이 영영 비었다.
// 이 수집기는 UPDATE 전용이라 canonical 행이 없으면 못 채우는 게 정상 — 행 생성자는 population.mjs 다.
//
// ⚠️ 행동으로 검증한다 — 소스 grep 은 선언부·주석에 걸려 무효가 될 수 있다(세션491).
describe("mapC1 — gu 표기 통일 (세션522)", () => {
  it("압축형 일반구를 canonical 로 접는다", () => {
    expect(mapC1("41111", "수원장안구")).toEqual({ region: "경기", gu: "수원시 장안구" });
  });

  it("공백 든 표기도 (normalizeC1Name 뒤) canonical 로 접는다", () => {
    expect(mapC1("41111", "수원 장안구")).toEqual({ region: "경기", gu: "수원시 장안구" });
  });

  it("이미 canonical 인 2단 표기는 그대로", () => {
    // normalizeC1Name 이 공백을 지워 "수원시장안구" 가 되지만 별칭표가 다시 편다.
    expect(mapC1("41111", "수원시 장안구")).toEqual({ region: "경기", gu: "수원시 장안구" });
  });

  it("광역시 자치구는 손대지 않는다 (기존 동작 보존)", () => {
    expect(mapC1("11680", "강남구")).toEqual({ region: "서울", gu: "강남구" });
  });
});

describe("aggregateKosisRows", () => {
  /**
   * @param {string} C1
   * @param {string} C1_NM
   * @param {string} PRD_DE
   * @param {string} ITM_NM
   * @param {string} DT
   */
  const mkRow = (C1, C1_NM, PRD_DE, ITM_NM, DT) => ({ C1, C1_NM, PRD_DE, ITM_NM, DT });

  // 세션548 D3 — 반환 모양에 crossCheckFailures·unmappedAmbiguous 가 **추가**됐다(이름 변경 0).
  // toEqual 은 여분 키를 불일치로 보므로 핵심 두 칸만 본다.
  it("빈 배열 → period null, entries []", () => {
    expect(aggregateKosisRows([])).toMatchObject({ period: null, entries: [] });
    expect(aggregateKosisRows([]).crossCheckFailures).toBe(0);
  });

  it("최신 월만 선택 (202602 > 202601)", () => {
    const rows = [
      mkRow("11", "서울특별시", "202601", "순이동", "100"),
      mkRow("11", "서울특별시", "202602", "순이동", "200"),
    ];
    const { period, entries } = aggregateKosisRows(rows);
    expect(period).toBe("202602");
    expect(entries).toEqual([{ region: "서울", gu: null, net_migration: 200 }]);
  });

  it("순이동 ITM_NM 만 채택 — 총전입/총전출 제외", () => {
    const rows = [
      mkRow("11", "서울특별시", "202602", "총전입", "500000"),
      mkRow("11", "서울특별시", "202602", "총전출", "550000"),
      mkRow("11", "서울특별시", "202602", "순이동", "-50000"),
    ];
    const { entries } = aggregateKosisRows(rows);
    expect(entries).toHaveLength(1);
    expect(entries[0].net_migration).toBe(-50000);
  });

  it("전국('00') 제외", () => {
    const rows = [
      mkRow("00", "전국", "202602", "순이동", "0"),
      mkRow("11", "서울특별시", "202602", "순이동", "-100"),
    ];
    const { entries } = aggregateKosisRows(rows);
    expect(entries).toHaveLength(1);
    expect(entries[0].region).toBe("서울");
  });

  it("시도 + 시군구 혼합 처리", () => {
    const rows = [
      mkRow("11", "서울특별시", "202602", "순이동", "-1000"),
      mkRow("11680", "강남구", "202602", "순이동", "200"),
      mkRow("26", "부산광역시", "202602", "순이동", "-500"),
      mkRow("26110", "중  구", "202602", "순이동", "-30"),
    ];
    const { entries } = aggregateKosisRows(rows);
    expect(entries).toHaveLength(4);
    expect(entries).toContainEqual({ region: "서울", gu: null, net_migration: -1000 });
    expect(entries).toContainEqual({ region: "서울", gu: "강남구", net_migration: 200 });
    expect(entries).toContainEqual({ region: "부산", gu: "중구", net_migration: -30 });
  });

  it("DT 쉼표 구분 파싱", () => {
    const rows = [mkRow("11", "서울특별시", "202602", "순이동", "-12,345")];
    const { entries } = aggregateKosisRows(rows);
    expect(entries[0].net_migration).toBe(-12345);
  });

  it("NaN DT 필터링", () => {
    const rows = [
      mkRow("11", "서울특별시", "202602", "순이동", "invalid"),
      mkRow("26", "부산광역시", "202602", "순이동", "100"),
    ];
    const { entries } = aggregateKosisRows(rows);
    expect(entries).toHaveLength(1);
    expect(entries[0].region).toBe("부산");
  });
});

// ── fetchKosis (fetchWithRetry 연동) ─────────────────────────
// 세션104: KOSIS 호출을 _shared.mjs:fetchWithRetry 로 위임해 429/500/503
// 지수 백오프가 걸리는지 검증. 파서 로직은 위 블록들이 담당.
describe("fetchKosis — fetchWithRetry 위임", () => {
  beforeEach(() => {
    fetchWithRetryMock.mockReset();
  });

  it("성공 응답을 JSON 배열로 반환", async () => {
    const rows = [{ C1: "11", C1_NM: "서울특별시", PRD_DE: "202602", ITM_NM: "순이동", DT: "-100" }];
    fetchWithRetryMock.mockResolvedValueOnce({ text: async () => JSON.stringify(rows) });
    const result = await fetchKosis();
    expect(result).toEqual(rows);
    expect(fetchWithRetryMock).toHaveBeenCalledTimes(1);
    // 호출 URL에 KOSIS 파라미터 핵심값 포함
    const url = fetchWithRetryMock.mock.calls[0][0];
    expect(url).toContain("orgId=101");
    expect(url).toContain("tblId=DT_1B26001_A01");
  });

  it("fetchWithRetry 내부에서 재시도 후 성공한 응답을 그대로 사용", async () => {
    // fetchWithRetry 가 내부적으로 재시도를 처리했다는 가정 (단일 resolved 값만 반환)
    fetchWithRetryMock.mockResolvedValueOnce({ text: async () => "[]" });
    const result = await fetchKosis();
    expect(result).toEqual([]);
    expect(fetchWithRetryMock).toHaveBeenCalledTimes(1);
  });

  it("fetchWithRetry 최종 실패 시 KOSIS prefix 유지해 에러 전파", async () => {
    fetchWithRetryMock.mockRejectedValueOnce(new Error("HTTP 500"));
    await expect(fetchKosis()).rejects.toThrow("KOSIS HTTP 500");
  });

  it("KOSIS err 필드 응답은 명시적 에러로 전환", async () => {
    fetchWithRetryMock.mockResolvedValueOnce({
      text: async () => JSON.stringify({ err: "30", errMsg: "인증 실패" }),
    });
    await expect(fetchKosis()).rejects.toThrow(/KOSIS 에러 30/);
  });
});

// ── main() collector_runs 기록 하드닝 (KOSIS 러너 차단 사고, 세션 395) ──
// 기존엔 catch 부재 → throw 시 {ok:0, fail:0} 가짜 빈 success 행 (avg-income 同 quirk).
describe("main() recordCollectorRun 하드닝", () => {
  beforeEach(() => {
    fetchWithRetryMock.mockReset();
    recordCollectorRun.mockClear();
  });

  it("KOSIS fetch 실패 → rethrow + status=failure 기록 (가짜 success 행 차단)", async () => {
    fetchWithRetryMock.mockRejectedValue(new Error("HTTP 500"));
    await expect(main()).rejects.toThrow(/KOSIS HTTP 500/);
    expect(recordCollectorRun).toHaveBeenCalledWith(
      "migration",
      expect.objectContaining({ status: "failure" }),
    );
  });

  it("빈 응답 early-return 도 기록 (ok=0, fail=0)", async () => {
    fetchWithRetryMock.mockResolvedValue({ text: async () => "[]" });
    await main();
    expect(recordCollectorRun).toHaveBeenCalledTimes(1);
    expect(recordCollectorRun).toHaveBeenCalledWith(
      "migration",
      { ok: 0, fail: 0 },
    );
  });
});

// ── 전남광주통합특별시 (2026-07-01) — 세션545 ─────────────────
//
// 전환 시점은 API 마다 다르다. KOSIS 순이동은 2026-09-06 실측에도 **옛 코드**(29·46)로
// 275건을 정상 응답하므로 옛 코드 방어를 남기고, 새 코드(12xxx)는 시군구 이름으로 가른다.
// 2자리 "12" 단독은 못 가르므로 null — 조용히 한쪽으로 붙이면 시도 순이동이 통째로 틀어진다.
describe("mapC1 — 전남광주통합특별시 (세션545)", () => {
  it("옛 코드 방어: 46150 순천시 → 전남", () => {
    expect(mapC1("46150", "순천시")).toEqual({ region: "전남", gu: "순천시" });
  });

  it("옛 코드 방어: 29170 북구 → 광주", () => {
    expect(mapC1("29170", "북구")).toEqual({ region: "광주", gu: "북구" });
  });

  it("옛 2자리 방어: 46 → 전남 / 29 → 광주", () => {
    expect(mapC1("46", "전라남도")).toEqual({ region: "전남", gu: null });
    expect(mapC1("29", "광주광역시")).toEqual({ region: "광주", gu: null });
    expect(C1_TO_REGION["46"]).toBe("전남");
    expect(C1_TO_REGION["29"]).toBe("광주");
  });

  it("새 코드: 12210 동구 → 광주", () => {
    expect(mapC1("12210", "동구")).toEqual({ region: "광주", gu: "동구" });
  });

  it("새 코드: 12150 순천시 → 전남", () => {
    expect(mapC1("12150", "순천시")).toEqual({ region: "전남", gu: "순천시" });
  });

  // ⚠️ 이름이 없어도 **gu 까지** 코드로 안다. 옛 판본은 region 만 구하고 gu:null 로 버렸는데,
  //    migration 은 UPDATE 전용이라 gu 가 null 이면 시군구 행에 영영 안 붙는다(값이 있어도
  //    화면에는 "미수집"). 코드가 곧 시군구다 — 추측이 아니라 역참조다.
  it("새 코드인데 이름이 없으면 코드표 역참조로 region·gu 둘 다 구한다 (추측 금지)", () => {
    expect(mapC1("12300", null)).toEqual({ region: "광주", gu: "북구" });
    expect(mapC1("12110", "")).toEqual({ region: "전남", gu: "목포시" });
  });

  // ⚠️ 이름 표기가 흔들려도(시도가 붙어 오는 등) 코드가 이긴다. 이름에 맡기면 분할 헬퍼의
  //    명단 대조에서 떨어져 그 행이 통째로 버려진다(순이동 결측).
  it("이상한 이름표기보다 코드가 우선 — 12210 '광주동구' 도 광주", () => {
    expect(mapC1("12210", "광주동구")?.region).toBe("광주");
  });

  it("2자리 '12' 단독 → null (시도 단위 통합값은 못 가른다)", () => {
    expect(mapC1("12", "전남광주통합특별시")).toBeNull();
    expect(C1_TO_REGION["12"]).toBeUndefined();
  });
});

// ── 죽은 계열(dead series) + 시도 파생값 — 세션547 ─────────────
//
// 실측(KOSIS DT_1B26001_A01, 2026-09-19, 기준월 202607, 912행):
//   · prefix "12"(전남광주통합특별시) = 살아 있음. 시도행 총전입 25369 / 총전출 25813 / 순이동 -444.
//     5자리 27건 전부 non-zero 이고 그 순이동 합이 정확히 -444.
//   · prefix "29"(광주광역시)·"46"(전라남도) = **죽은 계열**. 시도·시군구 전부 0
//     (총전입 0 / 총전출 0 / 순이동 0). 에러도 결측도 아니라 "0" 이라 그대로 적재되면
//     살아 있는 값을 0 으로 덮는다 — 실제로 라이브 DB 의 광주·전남이 전 recorded_at 0 이었다.
//
// ⚠️ 판정 규칙은 이름이 아니라 **총전입 0 ∧ 총전출 0** 이다. 순이동만 보면 "진짜로 순이동이
//    0 인 살아 있는 지역" 과 구별이 안 된다.
describe("죽은 계열 제외 + 시도 파생값 (세션547)", () => {
  /**
   * 한 C1 에 대해 실제 응답과 같은 3행(총전입·총전출·순이동)을 만든다.
   * @param {string} C1
   * @param {string} C1_NM
   * @param {number} tin
   * @param {number} tout
   * @param {string} [PRD_DE]
   */
  const mkTriple = (C1, C1_NM, tin, tout, PRD_DE = "202607") => [
    { C1, C1_NM, PRD_DE, ITM_NM: "총전입", DT: String(tin) },
    { C1, C1_NM, PRD_DE, ITM_NM: "총전출", DT: String(tout) },
    { C1, C1_NM, PRD_DE, ITM_NM: "순이동", DT: String(tin - tout) },
  ];

  // 실측 값 그대로 — 12110 목포 -194 / 12130 여수 -232 / 12150 순천 -376 / 12170 나주 -1,
  // 광주 5구 = 나머지. 27건 합 = -444 (시도행과 일치).
  const 광주구 = /** @type {const} */ ([
    ["12210", "동  구", -30],
    ["12240", "서구", -40],
    ["12270", "남구", -20],
    ["12300", "북구", -50],
    ["12330", "광산구", -25],
  ]);
  const 전남시군 = /** @type {const} */ ([
    ["12110", "목포시", -194],
    ["12130", "여수시", -232],
    ["12150", "순천시", -376],
    ["12170", "나주시", -1],
    ["12190", "광양시", 524],
  ]);
  const 광주합 = 광주구.reduce((a, [, , v]) => a + v, 0); // -165
  const 전남합 = 전남시군.reduce((a, [, , v]) => a + v, 0); // -279
  const 통합합 = 광주합 + 전남합; // -444 (실측 시도행과 동일)

  /** 살아 있는 12 계열 (시도 + 시군구 10건) */
  const liveRows = [
    ...mkTriple("12", "전남광주통합특별시", 25369, 25369 - 통합합),
    ...광주구.flatMap(([c, n, v]) => mkTriple(c, n, 1000, 1000 - v)),
    ...전남시군.flatMap(([c, n, v]) => mkTriple(c, n, 1000, 1000 - v)),
  ];

  /** 죽은 29/46 계열 — 시도·시군구 전부 0 */
  const deadRows = [
    ...mkTriple("29", "광주광역시", 0, 0),
    ...mkTriple("46", "전라남도", 0, 0),
    ...mkTriple("29110", "동  구", 0, 0),
    ...mkTriple("29170", "북구", 0, 0),
    ...mkTriple("46110", "목포시", 0, 0),
    ...mkTriple("46150", "순천시", 0, 0),
  ];

  /** 정상 지역 대조군 — 서울(살아 있고 순이동 음수) */
  const seoulRows = [
    ...mkTriple("11", "서울특별시", 500000, 550000),
    ...mkTriple("11680", "강남구", 10000, 9800),
  ];

  it("죽은 29/46 + 살아있는 12 → 광주·전남 시도값이 시군구 합과 같다", () => {
    const { period, entries } = aggregateKosisRows([...deadRows, ...liveRows, ...seoulRows]);
    expect(period).toBe("202607");

    const 광주시도 = entries.filter((e) => e.region === "광주" && e.gu === null);
    const 전남시도 = entries.filter((e) => e.region === "전남" && e.gu === null);
    expect(광주시도).toEqual([{ region: "광주", gu: null, net_migration: 광주합 }]);
    expect(전남시도).toEqual([{ region: "전남", gu: null, net_migration: 전남합 }]);

    // 두 파생값의 합 = C1="12" 시도 통합값
    expect(광주합 + 전남합).toBe(통합합);
  });

  it("죽은 계열이 남긴 0 이 하나도 들어오지 않는다 (옛 동작과 다름)", () => {
    const { entries } = aggregateKosisRows([...deadRows, ...liveRows]);
    // 옛 동작: 광주·전남 시도가 net_migration 0 으로 적재됐다.
    expect(entries).not.toContainEqual({ region: "광주", gu: null, net_migration: 0 });
    expect(entries).not.toContainEqual({ region: "전남", gu: null, net_migration: 0 });
    // 죽은 5자리도 0 으로 시군구 행을 덮지 않는다.
    expect(entries.filter((e) => e.net_migration === 0)).toHaveLength(0);
    expect(entries.find((e) => e.region === "전남" && e.gu === "순천시")?.net_migration).toBe(-376);
  });

  it("행 순서 무관 — 죽은 행이 앞/뒤 어디에 있어도 결과 동일 (R4)", () => {
    const before = aggregateKosisRows([...deadRows, ...liveRows, ...seoulRows]);
    const after = aggregateKosisRows([...liveRows, ...seoulRows, ...deadRows]);
    const 정렬 = (/** @type {any[]} */ es) =>
      [...es].sort((a, b) => `${a.region}|${a.gu}`.localeCompare(`${b.region}|${b.gu}`));
    expect(정렬(after.entries)).toEqual(정렬(before.entries));
    expect(after.entries).toHaveLength(before.entries.length);
  });

  it("교차검증 불일치 → 시도 파생 entry 없음, 시군구는 그대로 (R3 fail-close)", () => {
    // 시도 통합값만 999 로 어긋나게 한다 (시군구는 그대로).
    const 어긋난시도 = mkTriple("12", "전남광주통합특별시", 25369, 25369 - 999);
    const rows = [
      ...deadRows,
      ...어긋난시도,
      ...광주구.flatMap(([c, n, v]) => mkTriple(c, n, 1000, 1000 - v)),
      ...전남시군.flatMap(([c, n, v]) => mkTriple(c, n, 1000, 1000 - v)),
    ];
    const { entries } = aggregateKosisRows(rows);
    expect(entries.filter((e) => e.gu === null)).toHaveLength(0);
    // 시군구는 전부 살아서 나간다
    expect(entries.filter((e) => e.region === "광주" && e.gu)).toHaveLength(5);
    expect(entries.filter((e) => e.region === "전남" && e.gu)).toHaveLength(5);
  });

  it("C1='12' 시도행 자체가 없으면 파생하지 않는다 (R3)", () => {
    const rows = [
      ...광주구.flatMap(([c, n, v]) => mkTriple(c, n, 1000, 1000 - v)),
      ...전남시군.flatMap(([c, n, v]) => mkTriple(c, n, 1000, 1000 - v)),
    ];
    const { entries } = aggregateKosisRows(rows);
    expect(entries.filter((e) => e.gu === null)).toHaveLength(0);
    expect(entries).toHaveLength(10);
  });

  it("정상 지역(서울)은 종전과 동일 — 시도행은 자기 값, 파생 아님 (R5)", () => {
    const { entries } = aggregateKosisRows([...deadRows, ...liveRows, ...seoulRows]);
    expect(entries).toContainEqual({ region: "서울", gu: null, net_migration: -50000 });
    expect(entries).toContainEqual({ region: "서울", gu: "강남구", net_migration: 200 });
  });

  it("전입·전출이 실제로 있는데 순이동만 0 인 지역은 죽은 계열이 아니다", () => {
    // ⚠️ 순이동만 보고 판정하면 이 지역이 통째로 버려진다.
    const rows = [...mkTriple("11", "서울특별시", 500000, 500000), ...mkTriple("11680", "강남구", 10000, 10000)];
    expect(detectDeadPrefixes(rows)).toEqual(new Set());
    const { entries } = aggregateKosisRows(rows);
    expect(entries).toContainEqual({ region: "서울", gu: null, net_migration: 0 });
    expect(entries).toContainEqual({ region: "서울", gu: "강남구", net_migration: 0 });
  });

  it("detectDeadPrefixes — 총전입 0 ∧ 총전출 0 인 prefix 만 집는다", () => {
    const dead = detectDeadPrefixes([...deadRows, ...liveRows, ...seoulRows]);
    expect(dead).toEqual(new Set(["29", "46"]));
  });

  it("한쪽만 0 이면 죽은 계열이 아니다 (∧ 조건)", () => {
    expect(detectDeadPrefixes(mkTriple("46", "전라남도", 0, 500))).toEqual(new Set());
    expect(detectDeadPrefixes(mkTriple("46", "전라남도", 500, 0))).toEqual(new Set());
  });
});

// ── 세션548 하드닝 (D1~D4) ────────────────────────────────────
//
// 전부 실제 경로(`aggregateKosisRows` / export 된 헬퍼)로 검증한다. 픽스처는 라이브 응답과
// 같은 모양 — 한 코드당 총전입·총전출·순이동 3행 + "동  구" 같은 공백 2칸 표기.
describe("세션548 D1 — 빈 DT 를 0 으로 읽지 않는다", () => {
  /**
   * @param {string} C1 @param {string} C1_NM
   * @param {any} tin @param {any} tout @param {any} net
   */
  const mkRaw = (C1, C1_NM, tin, tout, net) => [
    { C1, C1_NM, PRD_DE: "202607", ITM_NM: "총전입", DT: tin },
    { C1, C1_NM, PRD_DE: "202607", ITM_NM: "총전출", DT: tout },
    { C1, C1_NM, PRD_DE: "202607", ITM_NM: "순이동", DT: net },
  ];
  /** DT 필드 자체가 없는 3행 */
  const mkNoDt = (/** @type {string} */ C1, /** @type {string} */ C1_NM) => [
    { C1, C1_NM, PRD_DE: "202607", ITM_NM: "총전입" },
    { C1, C1_NM, PRD_DE: "202607", ITM_NM: "총전출" },
    { C1, C1_NM, PRD_DE: "202607", ITM_NM: "순이동", DT: "-777" },
  ];

  it("parseDT — 빈 값은 NaN, 진짜 0 은 0", () => {
    expect(parseDT("")).toBeNaN();
    expect(parseDT("   ")).toBeNaN();
    expect(parseDT(null)).toBeNaN();
    expect(parseDT(undefined)).toBeNaN();
    expect(parseDT("0")).toBe(0);
    expect(parseDT("-444")).toBe(-444);
    expect(parseDT("-12,345")).toBe(-12345);
  });

  it("총전입/총전출 DT 가 '' 여도 죽은 계열이 아니다 — 시도·시군구가 살아 남는다", () => {
    const rows = [...mkRaw("11", "서울특별시", "", "", "-50000"), ...mkRaw("11680", "강남구", "", "", "200")];
    expect(detectDeadPrefixes(rows)).toEqual(new Set());
    const { entries } = aggregateKosisRows(rows);
    expect(entries).toContainEqual({ region: "서울", gu: null, net_migration: -50000 });
    expect(entries).toContainEqual({ region: "서울", gu: "강남구", net_migration: 200 });
  });

  it("총전입/총전출 DT 가 null 이어도 죽은 계열이 아니다", () => {
    const rows = [...mkRaw("26", "부산광역시", null, null, "-1200"), ...mkRaw("26110", "중  구", null, null, "-30")];
    expect(detectDeadPrefixes(rows)).toEqual(new Set());
    const { entries } = aggregateKosisRows(rows);
    expect(entries).toContainEqual({ region: "부산", gu: null, net_migration: -1200 });
    expect(entries).toContainEqual({ region: "부산", gu: "중구", net_migration: -30 });
  });

  it("DT 필드 자체가 없어도 죽은 계열이 아니다", () => {
    const rows = [...mkNoDt("27", "대구광역시"), ...mkNoDt("27110", "중  구")];
    expect(detectDeadPrefixes(rows)).toEqual(new Set());
    const { entries } = aggregateKosisRows(rows);
    expect(entries).toContainEqual({ region: "대구", gu: null, net_migration: -777 });
    expect(entries).toContainEqual({ region: "대구", gu: "중구", net_migration: -777 });
  });

  it("순이동 DT 가 비면 0 으로 적재하지 않는다 (entry 자체가 없다)", () => {
    const rows = [...mkRaw("28", "인천광역시", "9000", "9100", ""), ...mkRaw("11", "서울특별시", "5", "6", "-1")];
    const { entries } = aggregateKosisRows(rows);
    expect(entries.find((e) => e.region === "인천")).toBeUndefined();
    expect(entries).toContainEqual({ region: "서울", gu: null, net_migration: -1 });
  });

  it("⚠️ 진짜 0 은 여전히 죽은 계열로 잡는다 (D1 고치면서 R1 을 잃지 않는다)", () => {
    const rows = [...mkRaw("46", "전라남도", "0", "0", "0"), ...mkRaw("46150", "순천시", "0", "0", "0")];
    expect(detectDeadPrefixes(rows)).toEqual(new Set(["46"]));
    expect(aggregateKosisRows(rows).entries).toHaveLength(0);
  });
});

describe("세션548 D2 — 2자리 행 없는 죽은 계열 + 중복 키", () => {
  /**
   * @param {string} C1 @param {string} C1_NM
   * @param {number} tin @param {number} tout
   */
  const mkTriple = (C1, C1_NM, tin, tout) => [
    { C1, C1_NM, PRD_DE: "202607", ITM_NM: "총전입", DT: String(tin) },
    { C1, C1_NM, PRD_DE: "202607", ITM_NM: "총전출", DT: String(tout) },
    { C1, C1_NM, PRD_DE: "202607", ITM_NM: "순이동", DT: String(tin - tout) },
  ];

  /** 살아 있는 전남 — 옛 코드 46 계열(시도행 포함) */
  const live = [
    ...mkTriple("46", "전라남도", 10376, 10376 + 376),
    ...mkTriple("46150", "순천시", 1000, 1376),
  ];
  /** 죽은 12 계열인데 **2자리 시도행이 없다** — 5자리 0 만 온다 */
  const deadNoSido = [
    ...mkTriple("12150", "순천시", 0, 0),
    ...mkTriple("12110", "목포시", 0, 0),
  ];

  it("2자리 행이 없어도 5자리가 전부 0 ∧ 0 이면 죽은 계열", () => {
    expect(detectDeadPrefixes(deadNoSido)).toEqual(new Set(["12"]));
  });

  it("5자리 중 하나라도 살아 있으면 죽은 계열이 아니다", () => {
    const mixed = [...mkTriple("12150", "순천시", 0, 0), ...mkTriple("12110", "목포시", 900, 1094)];
    expect(detectDeadPrefixes(mixed)).toEqual(new Set());
  });

  it("5자리가 0 이지만 총전입/총전출이 비면(NaN) 죽은 계열이 아니다", () => {
    const blank = [
      { C1: "12150", C1_NM: "순천시", PRD_DE: "202607", ITM_NM: "총전입", DT: "" },
      { C1: "12150", C1_NM: "순천시", PRD_DE: "202607", ITM_NM: "총전출", DT: "" },
      { C1: "12150", C1_NM: "순천시", PRD_DE: "202607", ITM_NM: "순이동", DT: "0" },
    ];
    expect(detectDeadPrefixes(blank)).toEqual(new Set());
  });

  it("죽은 0 행이 앞/뒤 어디에 있어도 결과가 같고, 살아 있는 값이 이긴다", () => {
    const 정렬 = (/** @type {any[]} */ es) =>
      [...es].sort((a, b) => `${a.region}|${a.gu}`.localeCompare(`${b.region}|${b.gu}`));
    // ① D2a 가 잡는 모양(전부 0) ② D2a 가 못 잡는 모양(5자리 하나가 살아 있음) 둘 다 본다.
    const d2aMiss = [
      ...mkTriple("12150", "순천시", 0, 0),
      ...mkTriple("12110", "목포시", 900, 1094),
    ];
    for (const zeros of [deadNoSido, d2aMiss]) {
      const before = aggregateKosisRows([...zeros, ...live]);
      const after = aggregateKosisRows([...live, ...zeros]);
      expect(정렬(after.entries)).toEqual(정렬(before.entries));
      for (const r of [before, after]) {
        expect(r.entries.find((e) => e.region === "전남" && e.gu === "순천시")?.net_migration).toBe(-376);
      }
    }
  });

  it("⚠️ entries 에 같은 region|gu 키가 두 번 나오지 않는다 (순차 UPDATE 라 순서가 값을 정한다)", () => {
    // ⚠️ `deadNoSido` 만으로는 이 단언이 **속 빈다** — 죽은 계열 판정(D2a)이 0 행을 먼저
    //    걷어내 중복 자체가 안 생기기 때문이다. 그래서 D2a 가 못 잡는 모양(5자리 하나가
    //    살아 있어 prefix 가 dead 가 아닌 경우)도 함께 넣는다. 이게 방어층이 실제로 일하는 자리다.
    const d2aMiss = [
      ...mkTriple("12150", "순천시", 0, 0),
      ...mkTriple("12110", "목포시", 900, 1094),
    ];
    const cases = [
      [...deadNoSido, ...live], [...live, ...deadNoSido],
      [...d2aMiss, ...live], [...live, ...d2aMiss],
    ];
    for (const rows of cases) {
      const { entries } = aggregateKosisRows(rows);
      const keys = entries.map((e) => `${e.region}|${e.gu ?? ""}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("⚠️ 방어층 — 죽은 계열 판정이 뚫려도 0 이 살아 있는 값을 못 덮는다", () => {
    // 죽은 판정을 피하려고 5자리 하나를 살려 둔다(그래서 12 prefix 는 dead 가 아니다).
    // 그래도 12150(0) 과 46150(-376) 은 같은 "전남|순천시" 키 → 하나만 남아야 한다.
    const rows = [
      ...mkTriple("12150", "순천시", 0, 0),
      ...mkTriple("12110", "목포시", 900, 1094),
      ...live,
    ];
    expect(detectDeadPrefixes(rows)).toEqual(new Set());
    for (const ordered of [rows, [...live, ...rows.slice(0, 6)]]) {
      const { entries } = aggregateKosisRows(ordered);
      const 순천 = entries.filter((e) => e.region === "전남" && e.gu === "순천시");
      expect(순천).toHaveLength(1);
      expect(순천[0].net_migration).toBe(-376);
    }
  });
});

describe("세션548 D3 — 교차검증 실패를 run 에 싣는다", () => {
  /**
   * @param {string} C1 @param {string} C1_NM
   * @param {number} tin @param {number} tout
   */
  const mkTriple = (C1, C1_NM, tin, tout) => [
    { C1, C1_NM, PRD_DE: "202607", ITM_NM: "총전입", DT: String(tin) },
    { C1, C1_NM, PRD_DE: "202607", ITM_NM: "총전출", DT: String(tout) },
    { C1, C1_NM, PRD_DE: "202607", ITM_NM: "순이동", DT: String(tin - tout) },
  ];

  const 시군구 = [
    ...mkTriple("12210", "동  구", 1000, 1030),
    ...mkTriple("12300", "북구", 1000, 1050),
    ...mkTriple("12110", "목포시", 1000, 1194),
  ];

  it("합이 어긋나면 crossCheckFailures ≥ 1 · 시도 파생 없음 · 시군구는 그대로", () => {
    const rows = [...mkTriple("12", "전남광주통합특별시", 25369, 25369 + 999), ...시군구];
    const { entries, crossCheckFailures } = aggregateKosisRows(rows);
    expect(crossCheckFailures).toBeGreaterThanOrEqual(1);
    expect(entries.filter((e) => e.gu === null)).toHaveLength(0);
    expect(entries.filter((e) => e.gu)).toHaveLength(3);
  });

  it("합이 맞으면 실패 0 + 시도 파생 있음", () => {
    const rows = [...mkTriple("12", "전남광주통합특별시", 25369, 25369 + 30 + 50 + 194), ...시군구];
    const { entries, crossCheckFailures } = aggregateKosisRows(rows);
    expect(crossCheckFailures).toBe(0);
    expect(entries).toContainEqual({ region: "광주", gu: null, net_migration: -80 });
    expect(entries).toContainEqual({ region: "전남", gu: null, net_migration: -194 });
  });

  it("⚠️ mapC1 이 못 가른 12xxx 코드를 세고 로그에 코드까지 적는다", () => {
    logError.mockClear();
    // 12999 는 코드표에 없다 → mapC1 null → 시군구 합에서 빠진다. 시도 통합값은 **12999 를 포함한**
    // 진짜 합(-274 + -80 = -354)이므로, 빠진 그 값만큼 교차검증이 깨진다.
    const rows = [
      ...mkTriple("12", "전남광주통합특별시", 25369, 25369 + 354),
      ...시군구,
      ...mkTriple("12999", "없는구", 1000, 1080),
    ];
    const { unmappedAmbiguous, crossCheckFailures } = aggregateKosisRows(rows);
    expect(unmappedAmbiguous).toContain("12999");
    expect(crossCheckFailures).toBeGreaterThanOrEqual(1);
    const msgs = logError.mock.calls.map((/** @type {any[]} */ c) => String(c[1]));
    // ⚠️ 코드가 "어딘가의 로그에" 있는 것으로는 부족하다 — **교차검증 실패 그 줄**에 있어야
    //    "왜 합이 어긋났나" 를 한 줄에서 읽는다. 별도 요약 줄만 보면 이 단언이 속 빈다.
    const xline = msgs.find((/** @type {string} */ m) => m.includes("교차검증 실패"));
    expect(xline, "교차검증 실패 로그가 없다").toBeTruthy();
    expect(xline).toMatch(/매핑 실패 5자리 1건/);
    expect(xline).toMatch(/12999/);
  });

  it("main() — 교차검증 실패가 collector_runs fail 로 올라간다 (깨끗한 success 아님)", async () => {
    fetchWithRetryMock.mockReset();
    recordCollectorRun.mockClear();
    const rows = [...mkTriple("12", "전남광주통합특별시", 25369, 25369 + 999), ...시군구];
    fetchWithRetryMock.mockResolvedValue({ text: async () => JSON.stringify(rows) });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(/** @type {any} */ (() => undefined));
    const argvSpy = vi.spyOn(process, "argv", "get").mockReturnValue(["node", "migration.mjs", "--dry-run"]);
    try {
      await main();
    } finally {
      argvSpy.mockRestore();
      exitSpy.mockRestore();
    }
    const arg = recordCollectorRun.mock.calls.at(-1)?.[1];
    expect(arg.fail).toBeGreaterThanOrEqual(1);
  });
});

describe("세션548 D4 — 모호 prefix 끼리 합을 빌려 쓰지 않는다", () => {
  /**
   * @param {string} C1 @param {string} C1_NM
   * @param {number} tin @param {number} tout
   */
  const mkTriple = (C1, C1_NM, tin, tout) => [
    { C1, C1_NM, PRD_DE: "202607", ITM_NM: "총전입", DT: String(tin) },
    { C1, C1_NM, PRD_DE: "202607", ITM_NM: "총전출", DT: String(tout) },
    { C1, C1_NM, PRD_DE: "202607", ITM_NM: "순이동", DT: String(tin - tout) },
  ];

  it("두 번째 모호 prefix 가 첫 prefix 의 시군구 합을 재사용하지 않는다", () => {
    // "11"(서울)도 모호하다고 주입한다 — 실제로는 아니지만, 표가 늘었을 때의 동작을 잰다.
    // 12 쪽 시군구 합(-80/-194)이 11 쪽 교차검증에 끼어들면 11 은 통과해 버린다.
    const rows = [
      ...mkTriple("12", "전남광주통합특별시", 1000, 1000 + 30 + 50 + 194),
      ...mkTriple("12210", "동  구", 1000, 1030),
      ...mkTriple("12300", "북구", 1000, 1050),
      ...mkTriple("12110", "목포시", 1000, 1194),
      // 11 계열 — 시도 통합값(-80)은 12 쪽 광주 합과 우연히 같다. 자기 시군구 합은 -5 뿐.
      ...mkTriple("11", "서울특별시", 1000, 1080),
      ...mkTriple("11680", "강남구", 1000, 1005),
    ];
    const { entries, crossCheckFailures } = aggregateKosisRows(rows, new Set(["12", "11"]));
    // 12 쪽은 정상 파생
    expect(entries).toContainEqual({ region: "광주", gu: null, net_migration: -80 });
    expect(entries).toContainEqual({ region: "전남", gu: null, net_migration: -194 });
    // 11 쪽은 자기 합(-5) ≠ 시도값(-80) 이므로 **파생하지 않는다**
    expect(entries.find((e) => e.region === "서울" && e.gu === null)).toBeUndefined();
    expect(crossCheckFailures).toBeGreaterThanOrEqual(1);
    // 시군구는 그대로 나간다
    expect(entries).toContainEqual({ region: "서울", gu: "강남구", net_migration: -5 });
  });

  it("기본 인자는 모듈 상수(AMBIGUOUS_PREFIXES) — 주입 없이도 종전과 같다", () => {
    const rows = [
      ...mkTriple("12", "전남광주통합특별시", 1000, 1000 + 30),
      ...mkTriple("12210", "동  구", 1000, 1030),
    ];
    expect(aggregateKosisRows(rows).entries).toContainEqual({ region: "광주", gu: null, net_migration: -30 });
  });
});
