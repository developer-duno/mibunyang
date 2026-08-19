// @ts-check
/**
 * transit-match.mjs 테스트 — 교통 매칭 순수 함수 검증
 *
 * 대상: haversine · isStationOpened · buildNaverStations · filterCityDevs
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";

// 채점 상수는 **소스에서 직접 읽는다**. 여기에 값을 적어두면 상수만 바꿔도 테스트가 따라오지
// 않아 "둘이 어긋난 채 초록불"이 된다. 정규식은 좌변까지 고정해 주석줄에 안 걸리게 한다 —
// [[guards-must-be-mutation-tested]] §"소스 grep 가드" 답습.
const COLLECTOR_SRC = readFileSync(new URL("./transit-match.mjs", import.meta.url), "utf8");
const TIERS_SRC = readFileSync(new URL("../../src/constants/scoringTiers.ts", import.meta.url), "utf8");

/** `TRANSIT_CERTAINTY` 객체 리터럴에서 키만 뽑는다. */
const CERTAINTY_KEYS = (() => {
  const body = TIERS_SRC.match(/^export const TRANSIT_CERTAINTY: Record<string, number> = \{([\s\S]*?)^\};$/m)?.[1];
  return body ? [...body.matchAll(/^\s{2}([^\s:]+):\s*\d+,$/gm)].map((m) => m[1]) : [];
})();

/** 수집기가 내보내는 상태 낱말 목록. */
const KNOWN_STATUSES_SRC = (() => {
  const body = COLLECTOR_SRC.match(/^const KNOWN_STATUSES = \[([^\]]*)\];$/m)?.[1];
  return body ? [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]) : [];
})();

const FALLBACK_STATUS_SRC = COLLECTOR_SRC.match(/^const FALLBACK_STATUS = "([^"]+)";$/m)?.[1];

/** `scoreFuture` 가 파싱하는 정규식을 소스 그대로 되살린다. */
const TRANSIT_DEV_PATTERN = (() => {
  const lit = TIERS_SRC.match(/^export const TRANSIT_DEV_PATTERN = \/(.+)\/;$/m)?.[1];
  return lit ? new RegExp(lit) : null;
})();

// _shared.mjs 모킹
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return {
    ...orig,
    loadEnv: vi.fn(),
    getSupabase: vi.fn(),
    log: vi.fn(),
    logError: vi.fn(),
    ROOT: orig.ROOT,
  };
});

const { haversine, isStationOpened, buildNaverStations, filterCityDevs } = await import("./transit-match.mjs");

/**
 * 네이버 `dev_plans` `kind='station'` 행 픽스처.
 * ⚠️ 좌표는 `??` 가 아니라 **키 존재 여부**로 채운다 — `??` 면 `{lat: null}` 을 넘겨도 기본값으로
 * 되메워져서 "좌표 없음" 케이스를 아예 못 만든다(이 테스트가 실제로 그렇게 헛돌았다).
 */
const stationRow = (/** @type {Record<string, any>} */ o = {}) => ({
  name: o.name ?? "운정역(2024년12월예정)",
  lat: "lat" in o ? o.lat : 37.7143,
  lng: "lng" in o ? o.lng : 126.7436,
  raw: {
    railName: o.railName ?? "신안산선(공사중)",
    developmentPlanStation: {
      openDate: o.openDate ?? "2027",
      stationName: o.stationName ?? o.name ?? "운정역(2024년12월예정)",
    },
  },
});

// ── haversine (transit-match) ─────────────────────────────────
describe("haversine (transit-match)", () => {
  it("같은 좌표 → 거리 0", () => {
    expect(haversine(37.5, 127.0, 37.5, 127.0)).toBe(0);
  });

  it("서울↔부산 약 325km", () => {
    // 서울시청: 37.5665, 126.9780 / 부산시청: 35.1796, 129.0756
    const dist = haversine(37.5665, 126.9780, 35.1796, 129.0756);
    expect(dist).toBeGreaterThan(300);
    expect(dist).toBeLessThan(350);
  });

  it("근거리 (~1km) 계산", () => {
    // 약 0.009도 ≈ 1km
    const dist = haversine(37.5, 127.0, 37.509, 127.0);
    expect(dist).toBeGreaterThan(0.8);
    expect(dist).toBeLessThan(1.2);
  });

  it("반환값은 km 단위 (양수)", () => {
    const dist = haversine(37.5, 127.0, 37.6, 127.1);
    expect(dist).toBeGreaterThan(0);
  });
});

// ── isStationOpened (세션520) ─────────────────────────────────
describe("isStationOpened — 개통분 판별", () => {
  it("예정 연월이 지났으면 개통", () => {
    expect(isStationOpened("2024.12", "2026-08")).toBe(true);
  });

  it("예정 연월이 아직이면 미개통", () => {
    expect(isStationOpened("2027", "2026-08")).toBe(false);
  });

  it("월이 없으면 그 해 **말**로 본다 — 1월로 읽으면 아직 안 연 역이 개통 처리된다", () => {
    // "2026" 은 2026-12 로 해석돼야 2026-08 기준 미개통이다.
    expect(isStationOpened("2026", "2026-08")).toBe(false);
    // 해가 완전히 지났으면 월과 무관하게 개통.
    expect(isStationOpened("2025", "2026-08")).toBe(true);
  });

  it("같은 달이면 아직 개통 아님 (경계)", () => {
    expect(isStationOpened("2026.08", "2026-08")).toBe(false);
    expect(isStationOpened("2026.07", "2026-08")).toBe(true);
  });

  it("연도를 못 읽으면 개통으로 단정하지 않는다", () => {
    for (const v of [null, undefined, "", "미정", "예정"]) {
      expect(isStationOpened(v, "2026-08")).toBe(false);
    }
  });
});

// ── buildNaverStations (세션520) ──────────────────────────────
describe("buildNaverStations — 시드와 같은 모양으로 정규화", () => {
  it("역 이름 끝의 '역'을 뗀다 — 호출부가 다시 붙이므로 안 떼면 '운정역역'이 나간다", () => {
    const [st] = buildNaverStations([stationRow({ stationName: "운정역(2024년12월예정)" })], "2026-08");
    expect(st.name).toBe("운정");
    expect(`${st.name}역`).toBe("운정역");
  });

  it("노선명·역명의 괄호를 걷어낸다", () => {
    const [st] = buildNaverStations(
      [stationRow({ railName: "대전지하철2호선(공사중)", stationName: "정부청사역(2028년예정)", openDate: "2028" })],
      "2026-08",
    );
    expect(st.project).toBe("대전지하철2호선");
    expect(st.name).toBe("정부청사");
  });

  it("조립된 문자열이 scoreFuture 의 TRANSIT_DEV_PATTERN 을 통과한다", () => {
    expect(TRANSIT_DEV_PATTERN).not.toBeNull();
    const rows = [
      stationRow({ railName: "신안산선(공사중)", stationName: "여의도역(2027년예정)" }),
      stationRow({ railName: "수도권광역급행철도(덕정-수원간)(공사중)", stationName: "정부과천청사역(2028년예정)" }),
    ];
    for (const st of buildNaverStations(rows, "2026-08")) {
      expect(`${st.project} ${st.name}역 ${st.status}`).toMatch(/** @type {RegExp} */ (TRANSIT_DEV_PATTERN));
    }
  });

  it("이미 개통한 역은 제외한다 (입지 축 subwayDist 와 이중 계상 차단)", () => {
    const rows = [
      stationRow({ openDate: "2024.12", stationName: "운정역(2024년12월예정)" }),
      stationRow({ openDate: "2028", stationName: "호매실역(2029년예정)" }),
    ];
    const out = buildNaverStations(rows, "2026-08");
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("호매실");
  });

  it("괄호 안 확실성 낱말을 상태로 쓴다", () => {
    const [st] = buildNaverStations([stationRow({ railName: "신안산선(공사중)" })], "2026-08");
    expect(st.status).toBe("공사중");
  });

  it("표기가 빠진 행은 **같은 노선 형제 행**의 상태를 물려받는다", () => {
    // 원본이 같은 노선을 어떤 행엔 "위례선(공사중)", 어떤 행엔 "위례선" 으로 적는다(실측 2건).
    const rows = [
      stationRow({ railName: "위례선(공사중)", stationName: "마천역(2027년예정)" }),
      stationRow({ railName: "위례선", stationName: "복정역(2027년예정)" }),
    ];
    const out = buildNaverStations(rows, "2026-08");
    expect(out.map((s) => s.status)).toEqual(["공사중", "공사중"]);
  });

  it("형제 행도 없으면 폴백 상태 — 근거 없이 높은 확실성을 주지 않는다", () => {
    const [st] = buildNaverStations([stationRow({ railName: "이름만있는선" })], "2026-08");
    expect(st.status).toBe(FALLBACK_STATUS_SRC);
  });

  it("괄호가 구간명이면 확실성으로 쓰지 않는다", () => {
    const [st] = buildNaverStations([stationRow({ railName: "GTX-A(운정동탄)", openDate: "2030" })], "2026-08");
    expect(st.status).toBe(FALLBACK_STATUS_SRC);
    expect(st.project).toBe("GTX-A");
  });

  it("좌표가 없으면 버린다", () => {
    expect(buildNaverStations([stationRow({ lat: null }), stationRow({ lng: null })], "2026-08")).toHaveLength(0);
  });

  it("이름이 비면 버린다 — '역 공사중' 같은 깨진 문자열이 나가지 않게", () => {
    expect(buildNaverStations([stationRow({ stationName: "(예정)" })], "2026-08")).toHaveLength(0);
    expect(buildNaverStations([stationRow({ railName: "(공사중)" })], "2026-08")).toHaveLength(0);
  });

  it("빈 입력·null 을 견딘다", () => {
    expect(buildNaverStations([], "2026-08")).toEqual([]);
    expect(buildNaverStations(/** @type {any} */ (null), "2026-08")).toEqual([]);
  });
});

// ── filterCityDevs (세션520) ──────────────────────────────────
describe("filterCityDevs — 도시개발 후보 정리", () => {
  const dev = (/** @type {Record<string, any>} */ o) => ({ name: "지구", lat: 37.5, lng: 127.0, ...o });

  it("지구단위 중 부분준공은 뺀다 — 이미 입주한 곳은 앞으로 좋아질 몫이 없다", () => {
    const out = filterCityDevs([
      dev({ kind: "jigu", progression_step: "부분준공" }),
      dev({ kind: "jigu", progression_step: "실시계획" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].progression_step).toBe("실시계획");
  });

  it("LH 지구는 단계와 무관하게 남긴다 — 원본에 단계가 전부 null 이라 같은 걸러내기를 못 한다", () => {
    const out = filterCityDevs([
      dev({ kind: "lh_zone", progression_step: null }),
      dev({ kind: "lh_zone", progression_step: "부분준공" }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("좌표가 없으면 버린다", () => {
    expect(filterCityDevs([dev({ kind: "jigu", lat: null }), dev({ kind: "lh_zone", lng: null })])).toHaveLength(0);
  });

  it("빈 입력·null 을 견딘다", () => {
    expect(filterCityDevs([])).toEqual([]);
    expect(filterCityDevs(/** @type {any} */ (null))).toEqual([]);
  });
});

// ── 동기화 가드 (세션520) ─────────────────────────────────────
describe("KNOWN_STATUSES ↔ TRANSIT_CERTAINTY 동기화", () => {
  it("두 목록을 소스에서 실제로 읽어냈다 (정규식이 죽으면 아래 비교가 무의미해진다)", () => {
    expect(CERTAINTY_KEYS.length).toBeGreaterThan(0);
    expect(KNOWN_STATUSES_SRC.length).toBeGreaterThan(0);
    expect(FALLBACK_STATUS_SRC).toBeTruthy();
    expect(TRANSIT_DEV_PATTERN).not.toBeNull();
  });

  it("수집기가 내보내는 상태는 전부 채점이 아는 낱말이다", () => {
    // 여기 없는 낱말을 내보내면 채점이 기본값(12)으로 떨어져 조용히 낮은 점수가 된다.
    for (const s of KNOWN_STATUSES_SRC) expect(CERTAINTY_KEYS).toContain(s);
  });

  it("폴백 상태도 채점이 아는 낱말이다", () => {
    expect(CERTAINTY_KEYS).toContain(FALLBACK_STATUS_SRC);
  });
});
