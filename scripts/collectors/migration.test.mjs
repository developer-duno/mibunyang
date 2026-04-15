/**
 * migration.mjs 테스트 — KOSIS DT_1B26001_A01 파서 검증
 *
 * 대상: normalizeC1Name, mapC1, aggregateKosisRows, C1_TO_REGION
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = await importOriginal();
  return {
    ...orig,
    loadEnv: vi.fn(),
    getSupabase: vi.fn(),
    log: vi.fn(),
    logError: vi.fn(),
    recordApiQuota: vi.fn(),
    REGION_LAWD_PREFIX: orig.REGION_LAWD_PREFIX,
  };
});

process.env.KOSIS_MIGRATION_KEY = "test-key";

const { normalizeC1Name, mapC1, aggregateKosisRows, C1_TO_REGION } = await import("./migration.mjs");

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
describe("aggregateKosisRows", () => {
  const mkRow = (C1, C1_NM, PRD_DE, ITM_NM, DT) => ({ C1, C1_NM, PRD_DE, ITM_NM, DT });

  it("빈 배열 → period null, entries []", () => {
    expect(aggregateKosisRows([])).toEqual({ period: null, entries: [] });
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
