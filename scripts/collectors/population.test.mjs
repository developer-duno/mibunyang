// @ts-check
/**
 * population.mjs 테스트 — 지역명 해석, 시군구 파싱, 시도행 집계(세션546) 검증
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";

// loadEnv + 외부 API 호출 방지
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return { ...orig, loadEnv: vi.fn(), getMibuyangSupabase: vi.fn(), getSupabase: vi.fn() };
});

const {
  resolveRegion,
  parseGu,
  parseHouseholds,
  rawParents,
  pickCanonicalPopulationRows,
  sumSidoFromRaw,
  buildSidoRows,
  buildGuRows,
  summarizeGrowth,
  parseTargetArg,
  parseFocusArg,
} = await import("./population.mjs");

// ── 픽스처 헬퍼 (행안부 응답 형태 그대로) ─────────────────────
/**
 * @param {string} ctpvNm
 * @param {string} sggNm
 * @param {number} pop
 * @param {number} [hh]
 */
const sgg = (ctpvNm, sggNm, pop, hh) => ({ ctpvNm, sggNm, totNmprCnt: String(pop), hhCnt: String(hh ?? 0) });
/**
 * lv=1 시도 합계행 — 실측상 `sggNm` 이 빈 값이다.
 * @param {string} ctpvNm
 * @param {number} pop
 * @param {number} [hh]
 */
const sido = (ctpvNm, pop, hh) => ({ ctpvNm, sggNm: "", totNmprCnt: String(pop), hhCnt: String(hh ?? 0) });

// 경기 화성 — 행안부는 시 합계행과 신설 4구를 **둘 다** 준다(2026-09-11 실측 202607).
// 별칭표가 4구를 "화성시" 로 접으므로 canonical 키가 하나로 모인다.
const HWASEONG = [
  sgg("경기도", "화성시", 999673, 433881),
  sgg("경기도", "화성시 만세구", 234363, 100000),
  sgg("경기도", "화성시 효행구", 160788, 70000),
  sgg("경기도", "화성시 병점구", 175045, 80000),
  sgg("경기도", "화성시 동탄구", 429477, 183881),
];

// 경기 전체 픽스처 — 실측 55행을 그대로 옮기지 않고 **합이 맞도록** 줄였다.
// 마지막 행은 나머지 시·군을 한 줄로 뭉친 **합성 행**이다(개별 값은 이 테스트의 관심사가 아니다).
// 원문 부모 제외 합 = 999,673(화성 4구) + 1,190,000(수원 2구) + 480,000 + 11,098,484 = 13,768,157
const GYEONGGI_RAW = [
  ...HWASEONG,
  sgg("경기도", "수원시", 1190000, 500000),
  sgg("경기도", "수원시 장안구", 290000, 120000),
  sgg("경기도", "수원시 팔달구", 900000, 380000),
  sgg("경기도", "김포시", 480000, 200000),
  sgg("경기도", "나머지시군(합성)", 11098484, 4700000),
];
const GYEONGGI_LV1_POP = 13768157;

// 같은 수원을 **bare 구 형태**로 받은 경우(별칭표 `forms` 에 "장안구"·"팔달구" 로 실재).
// 값은 위 GYEONGGI_RAW 의 수원 3행과 **같다** — 구 2행 합(290,000 + 900,000)이 시 합계와 정확히
// 같아야 "한 번만 더해졌다"를 숫자 하나로 단언할 수 있다.
// 고치기 전: 부모가 안 잡혀 1,190,000 + 1,190,000 = 2,380,000 (세션546 리뷰 실측 재현).
const SUWON_BARE = [
  sgg("경기도", "수원시", 1190000, 500000),
  sgg("경기도", "장안구", 290000, 120000),
  sgg("경기도", "팔달구", 900000, 380000),
];
const SUWON_TOTAL_POP = 1190000;

// 인천 — 2026 개편으로 중구·동구 → 제물포·영종, 서구 → 서해·검단 (실측 202507 10행 / 202607 11행)
const INCHEON_COMMON_PREV = [
  sgg("인천광역시", "미추홀구", 396000, 180000),
  sgg("인천광역시", "연수구", 390000, 160000),
  sgg("인천광역시", "남동구", 493000, 220000),
  sgg("인천광역시", "부평구", 480000, 220000),
  sgg("인천광역시", "계양구", 282000, 125000),
  sgg("인천광역시", "강화군", 68000, 35000),
  sgg("인천광역시", "옹진군", 55957, 28000),
];
const INCHEON_PREV_RAW = [
  sgg("인천광역시", "중구", 173592, 80000),
  sgg("인천광역시", "동구", 57125, 28000),
  sgg("인천광역시", "서구", 645541, 280000),
  ...INCHEON_COMMON_PREV,
];
const INCHEON_COMMON_CUR = [
  sgg("인천광역시", "미추홀구", 395000, 181000),
  sgg("인천광역시", "연수구", 393000, 162000),
  sgg("인천광역시", "남동구", 492000, 221000),
  sgg("인천광역시", "부평구", 478000, 219000),
  sgg("인천광역시", "계양구", 279000, 124000),
  sgg("인천광역시", "강화군", 68500, 35500),
  sgg("인천광역시", "옹진군", 54932, 27500),
];
const INCHEON_CUR_RAW = [
  sgg("인천광역시", "제물포구", 99299, 50000),
  sgg("인천광역시", "영종구", 138091, 60000),
  sgg("인천광역시", "서해구", 392173, 175000),
  sgg("인천광역시", "검단구", 273735, 120000),
  ...INCHEON_COMMON_CUR,
];
const INCHEON_CUR_LV1_POP = 3063730;   // = 903,298(신설 4구) + 2,160,432(기존 7)
const INCHEON_PREV_LV1_POP = 3041215;  // = 876,258(옛 3구)  + 2,164,957(기존 7)
// ⚠️ 세대수는 일부러 시군구 합(1,375,000)과 **다르게** 둔다 — 시도행 households 가 lv=1 에서
//    오는지, 시군구 합에서 오는지를 이 차이가 가른다(뮤테이션 ⑥ 표적).
const INCHEON_CUR_LV1_HH = 1416363;

// 전남광주통합특별시 (2026-07-01~) — lv=1 은 통합 1행, lv=2 는 27 시군구
const GWANGJU_GU = [
  sgg("전남광주통합특별시", "동구", 105000, 48000),
  sgg("전남광주통합특별시", "서구", 280000, 125000),
  sgg("전남광주통합특별시", "남구", 200000, 90000),
  sgg("전남광주통합특별시", "북구", 420000, 190000),
  sgg("전남광주통합특별시", "광산구", 379801, 160000),
];
const GWANGJU_SUM = 1384801;
/** @type {Array<[string, number]>} */
const JEONNAM_PAIRS = [
  ["순천시", 270000], ["여수시", 260000], ["목포시", 210000], ["나주시", 120000], ["광양시", 150000],
  ["무안군", 95000], ["해남군", 62000], ["화순군", 60000], ["영암군", 50000], ["고흥군", 60000],
  ["보성군", 35000], ["장흥군", 34000], ["강진군", 32000], ["완도군", 45000], ["진도군", 30000],
  ["신안군", 38000], ["담양군", 45000], ["곡성군", 27000], ["구례군", 24000], ["함평군", 30000],
  ["영광군", 52000], ["장성군", 43976],
];
const JEONNAM_GU = JEONNAM_PAIRS.map(([nm, p]) => sgg("전남광주통합특별시", nm, p, Math.round(p * 0.45)));
const JEONNAM_SUM = 1772976;
const UNIFIED_SUM = GWANGJU_SUM + JEONNAM_SUM; // 3,157,777
// 작년(202507) — lv=1 이 광주·전남을 따로 주던 때. 시군구 합이 lv=1 과 **정확히 같다**(실측).
const GWANGJU_GU_PREV = [
  sgg("광주광역시", "동구", 106000, 48500),
  sgg("광주광역시", "서구", 283000, 126000),
  sgg("광주광역시", "남구", 202000, 91000),
  sgg("광주광역시", "북구", 424000, 192000),
  sgg("광주광역시", "광산구", 383538, 162000),
];
const GWANGJU_SUM_PREV = 1398538;
const JEONNAM_GU_PREV = JEONNAM_PAIRS.map(([nm, p]) =>
  sgg("전라남도", nm, nm === "장성군" ? p + 9207 : p, Math.round(p * 0.45)),
);
const JEONNAM_SUM_PREV = 1782183;

// ── rawParents (시도 집계 중복 차단, 원문 sggNm 기준) ─────────
//
// 이 가드가 진짜 필요한 케이스는 **한 시도 안에 "구를 가진 시"와 "구가 없는 시·군"이 함께
// 있을 때**다(세션501: 옛 코드가 구 없는 시·군까지 통째로 날려 111개 시·군 누락).
// 세션546 은 거기에 하나를 더한다 — **접힌 이름이 아니라 원문 sggNm** 을 봐야 한다.
// "화성시 동탄구" 는 별칭표에서 "화성시"(공백 없음)로 접히므로, 접힌 이름을 보면 부모가
// 안 잡혀 화성 인구가 시도 합에 두 번 들어간다(경기 +999,673).
describe("rawParents (시도 집계 중복 차단 — 원문 sggNm)", () => {
  it("구를 가진 시의 합계행만 제외한다 — 구 없는 시·군은 남는다", () => {
    const parents = rawParents([
      sgg("경기도", "수원시", 1190000),
      sgg("경기도", "수원시 장안구", 290000),
      sgg("경기도", "수원시 팔달구", 900000),
      sgg("경기도", "김포시", 480000),   // 구 없음 — 반드시 살아남아야 한다
      sgg("경기도", "양평군", 120000),   // 군 — 반드시 살아남아야 한다
    ]);
    expect(parents.has("경기:수원시")).toBe(true);
    expect(parents.has("경기:김포시")).toBe(false);
    expect(parents.has("경기:양평군")).toBe(false);
    expect(parents.size).toBe(1);
  });

  it("⚠️ 화성 — 별칭표가 접는 이름도 **원문**으로는 부모가 잡힌다 (세션546 진앙)", () => {
    const parents = rawParents(HWASEONG);
    expect([...parents]).toEqual(["경기:화성시"]);
    // 접힌 이름(gu)만 보면 "화성시 동탄구" → "화성시" 라 공백이 사라져 하나도 안 잡힌다.
    expect(HWASEONG.every((i) => !(parseGu(i.ctpvNm, i.sggNm)?.gu ?? "").includes(" "))).toBe(true);
  });

  it("경북 실제 형태 — 포항시만 빠지고 나머지 시·군은 전부 남는다", () => {
    const items = [
      sgg("경상북도", "포항시", 490000),
      sgg("경상북도", "포항시 남구", 230000),
      sgg("경상북도", "포항시 북구", 260000),
      sgg("경상북도", "안동시", 155000),
      sgg("경상북도", "구미시", 405000),
      sgg("경상북도", "울릉군", 9000),
    ];
    const parents = rawParents(items);
    expect([...parents]).toEqual(["경북:포항시"]);
    const kept = items.filter((i) => !parents.has(`${parseGu(i.ctpvNm, i.sggNm)?.region}:${i.sggNm}`));
    expect(kept.map((i) => i.sggNm)).toEqual(["포항시 남구", "포항시 북구", "안동시", "구미시", "울릉군"]);
  });

  it("자치구 이름이 한 단어인 시도(서울)는 아무것도 제외하지 않는다 — 무회귀", () => {
    expect(rawParents([
      sgg("서울특별시", "종로구", 140000),
      sgg("서울특별시", "강남구", 550000),
      sgg("서울특별시", "송파구", 650000),
    ]).size).toBe(0);
  });

  it("같은 시 이름이 다른 시도에 있어도 서로 간섭하지 않는다", () => {
    const parents = rawParents([
      sgg("경기도", "광주시", 390000),        // 구 없음
      sgg("경상남도", "창원시", 1000000),
      sgg("경상남도", "창원시 성산구", 220000),
    ]);
    expect(parents.has("경남:창원시")).toBe(true);
    expect(parents.has("경기:광주시")).toBe(false);
  });

  it("sggNm 이 비었거나(세종) 지역 판정 불가면 무시한다", () => {
    expect(rawParents([sgg("세종특별자치시", "", 390972)]).size).toBe(0);
    expect(rawParents([sgg("미지의땅", "무언가 구", 100)]).size).toBe(0);
  });

  // ⚠️ 세션546 독립 리뷰 — 원문만 보는 반대 구멍.
  // 행안부가 시 이름 없이 "장안구" 로 주는 형태는 별칭표(`sigungu-aliases.json`)에
  // `forms: [… , "장안구"]` 로 **실제 등재**돼 있다. 원문에 공백이 없어 부모가 하나도 안 잡히면
  // 수원시 합계행이 살아남아 시도 합에 두 번 들어간다(고치기 전 실측 1,190,000 → 2,380,000).
  // 현재 응답은 공백 든 형태라 주경로는 무사하지만, fallback/split 경로가 이 합을 그대로
  // 시도행으로 저장하므로 응답 형태가 바뀌는 날 조용히 거짓이 된다.
  it("⚠️ bare 구 형태('장안구')도 부모가 잡힌다 — 정규화된 gu 의 앞 토큰 (세션546 리뷰)", () => {
    // 전제 확인: 별칭표가 bare 구를 실제로 펴 준다 (이게 아니면 아래 단언이 무의미하다)
    expect(parseGu("경기도", "장안구")).toEqual({ region: "경기", gu: "수원시 장안구", folded: true });
    expect(rawParents(SUWON_BARE).has("경기:수원시")).toBe(true);
  });

  it("⚠️ 화성 무회귀 — 접힌 gu(공백 없음)는 부모 후보에 안 들어간다", () => {
    // 공백 없는 gu 까지 부모로 등록하면 "화성시" 4구가 자기 부모를 만들어 통째로 사라진다.
    // 잡히는 경로는 **원문** "화성시 동탄구" 하나뿐이어야 한다.
    expect([...rawParents(HWASEONG)]).toEqual(["경기:화성시"]);
    expect(HWASEONG.every((i) => !(parseGu(i.ctpvNm, i.sggNm)?.gu ?? "").includes(" "))).toBe(true);
  });

  it("⚠️ 구 없는 시·군은 정규화 뒤에도 부모가 되지 않는다 — 자기 제외 금지 (세션501 무회귀)", () => {
    // `gu.split(" ")[0]` 를 공백 없이도 더하면 "김포시" 가 자기 자신을 부모로 등록해 사라진다.
    expect(rawParents([
      sgg("경기도", "김포시", 480000),
      sgg("경기도", "양평군", 120000),
      sgg("경기도", "수원시", 1190000),   // 구가 함께 오지 않은 시 합계행도 살아남아야 한다
    ]).size).toBe(0);
  });
});

// ── pickCanonicalPopulationRows ──────────────────────────────
describe("pickCanonicalPopulationRows (키당 1행 — 접힘 이중계상 차단)", () => {
  it("T1 화성 5행 → 1행, 시 단위 원문이 이긴다 (households 도 함께)", () => {
    const { rows, collapsed, foldedOnly } = pickCanonicalPopulationRows(HWASEONG);
    expect(rows).toHaveLength(1);
    expect(rows[0].region).toBe("경기");
    expect(rows[0].gu).toBe("화성시");
    expect(rows[0].population).toBe(999673);
    expect(rows[0].households).toBe(433881);
    expect(collapsed).toBe(4);
    expect(foldedOnly).toEqual([]);
  });

  it("T1 순서를 뒤집어도 같다 — 접힌 구가 먼저 와도 시 단위가 이긴다", () => {
    const { rows, collapsed, foldedOnly } = pickCanonicalPopulationRows([...HWASEONG].reverse());
    expect(rows).toHaveLength(1);
    expect(rows[0].population).toBe(999673);
    expect(rows[0].households).toBe(433881);
    expect(collapsed).toBe(4);
    expect(foldedOnly).toEqual([]);
  });

  it("T2 접힌 원문만 둘 → 먼저 온 것 + foldedOnly 에 키", () => {
    const { rows, collapsed, foldedOnly } = pickCanonicalPopulationRows([HWASEONG[1], HWASEONG[2]]);
    expect(rows).toHaveLength(1);
    expect(rows[0].population).toBe(234363); // 만세구 (먼저 온 것)
    expect(collapsed).toBe(1);
    expect(foldedOnly).toEqual(["경기|화성시"]);
  });

  it("접히지 않는 시·구는 각각 살아남는다 (수원)", () => {
    const { rows, collapsed } = pickCanonicalPopulationRows([
      sgg("경기도", "수원시", 1190000),
      sgg("경기도", "수원시 장안구", 290000),
      sgg("경기도", "수원시 팔달구", 900000),
    ]);
    expect(rows.map((r) => r.gu)).toEqual(["수원시", "수원시 장안구", "수원시 팔달구"]);
    expect(collapsed).toBe(0);
  });

  it("인구 0 이하 / 지역 판정 불가 행은 버린다", () => {
    const { rows } = pickCanonicalPopulationRows([
      sgg("경기도", "김포시", 0),
      sgg("미지의땅", "무언가시", 100),
      sgg("경기도", "김포시", 480000),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].population).toBe(480000);
  });
});

// ── sumSidoFromRaw ───────────────────────────────────────────
describe("sumSidoFromRaw (원문 부모 제외 시도 합)", () => {
  // ⚠️ 세션546 리뷰 — 시 이름 없이 오는 형태에서 시 합계행이 살아남아 두 번 셈되던 자리.
  // 인구뿐 아니라 **세대수도 함께** 두 배가 됐으므로 둘 다 단언한다.
  it("⚠️ bare 구 형태('장안구')에서도 수원이 한 번만 더해진다 — 1,190,000 (세션546 리뷰)", () => {
    expect(sumSidoFromRaw(SUWON_BARE)["경기"]).toEqual({
      population: SUWON_TOTAL_POP,   // 고치기 전 2,380,000
      households: 500000,            // 고치기 전 1,000,000
    });
  });

  it("화성이 한 번만 더해진다 — 경기 13,768,157", () => {
    expect(sumSidoFromRaw(GYEONGGI_RAW)["경기"].population).toBe(GYEONGGI_LV1_POP);
  });

  it("인천 신설 4구 포함 전량 합산 — 3,063,730", () => {
    expect(sumSidoFromRaw(INCHEON_CUR_RAW)["인천"].population).toBe(INCHEON_CUR_LV1_POP);
  });

  it("통합 시도는 sggNm 으로 광주/전남이 갈린다", () => {
    const s = sumSidoFromRaw([...GWANGJU_GU, ...JEONNAM_GU]);
    expect(s["광주"].population).toBe(GWANGJU_SUM);
    expect(s["전남"].population).toBe(JEONNAM_SUM);
  });

  it("세종은 1행이어도 합산된다", () => {
    expect(sumSidoFromRaw([sgg("세종특별자치시", "", 390972, 170000)])["세종"]).toEqual({
      population: 390972,
      households: 170000,
    });
  });
});

// ── buildSidoRows ────────────────────────────────────────────
const RECORDED_AT = "2026-07-01";
/** @param {Array<{region: string}>} rows @param {string} region */
const pick = (rows, region) => /** @type {any} */ (rows.find((r) => r.region === region));

describe("buildSidoRows (시도행 = lv=1 API 값)", () => {
  it("T4(a) 인천 — pop_growth 0.7, households 는 lv=1 값 그대로", () => {
    const { rows, checks } = buildSidoRows({
      sidoCur: [sido("인천광역시", INCHEON_CUR_LV1_POP, INCHEON_CUR_LV1_HH)],
      sidoPrev: [sido("인천광역시", INCHEON_PREV_LV1_POP, 1400000)],
      rawCur: INCHEON_CUR_RAW,
      rawPrev: INCHEON_PREV_RAW,
      recordedAt: RECORDED_AT,
    });
    const r = pick(rows, "인천");
    expect(r.population).toBe(INCHEON_CUR_LV1_POP);
    expect(r.pop_growth).toBe(0.7);
    // ⚠️ 시군구 households 합(1,375,000)이 아니라 lv=1 값이어야 한다.
    expect(r.households).toBe(INCHEON_CUR_LV1_HH);
    expect(r.households).not.toBe(sumSidoFromRaw(INCHEON_CUR_RAW)["인천"].households);
    expect(r.gu).toBeNull();
    expect(r.recorded_at).toBe(RECORDED_AT);
    // 옛 D4(전년 키 일치 합 = 2,164,957) 였다면 +41.5% 가 나온다.
    expect(r.pop_growth).not.toBe(41.5);
    expect(checks.filter((c) => c.level === "error")).toEqual([]);
  });

  it("T4(b) 경기 — 시군구 합과 lv=1 이 일치, 교차검증 경고 0", () => {
    const { rows, checks } = buildSidoRows({
      sidoCur: [sido("경기도", GYEONGGI_LV1_POP, 6181804)],
      sidoPrev: [sido("경기도", 13728157, 6100000)],
      rawCur: GYEONGGI_RAW,
      rawPrev: GYEONGGI_RAW,
      recordedAt: RECORDED_AT,
    });
    expect(pick(rows, "경기").population).toBe(GYEONGGI_LV1_POP);
    expect(pick(rows, "경기").households).toBe(6181804);
    expect(checks).toEqual([]);
  });

  it("교차검증 — lv=1 과 시군구 합이 0.5% 넘게 벌어지면 error", () => {
    const { checks } = buildSidoRows({
      sidoCur: [sido("경기도", GYEONGGI_LV1_POP + 999673, 6181804)],
      sidoPrev: [sido("경기도", 13728157, 6100000)],
      rawCur: GYEONGGI_RAW,
      rawPrev: GYEONGGI_RAW,
      recordedAt: RECORDED_AT,
    });
    const errs = checks.filter((c) => c.level === "error");
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toContain("경기");
  });

  it("T4(c) 통합 시도행 → 광주·전남 두 행, 합이 3,157,777", () => {
    const { rows, checks } = buildSidoRows({
      sidoCur: [sido("전남광주통합특별시", UNIFIED_SUM, 1500000)],
      sidoPrev: [sido("광주광역시", GWANGJU_SUM_PREV, 640000), sido("전라남도", JEONNAM_SUM_PREV, 850000)],
      rawCur: [...GWANGJU_GU, ...JEONNAM_GU],
      rawPrev: [...GWANGJU_GU_PREV, ...JEONNAM_GU_PREV],
      recordedAt: RECORDED_AT,
    });
    expect(pick(rows, "광주").population).toBe(GWANGJU_SUM);
    expect(pick(rows, "전남").population).toBe(JEONNAM_SUM);
    expect(pick(rows, "광주").population + pick(rows, "전남").population).toBe(UNIFIED_SUM);
    expect(checks.filter((c) => c.level === "error")).toEqual([]);
  });

  // ⚠️ 세션546 리뷰(L2) — 분할 합 검증만 **정확 일치**로 조인다.
  // 통합 시도행과 분할 합은 같은 응답 안의 **같은 사람들을 두 방식으로 센 것**이라 정확히
  // 같아야 한다(실측 차이 0). 여기에 교차검증용 0.5% 를 그대로 쓰면 통합 시도 3,157,777 기준
  // 약 1.6만 명이 어긋나도 조용히 통과한다. 시도별 교차검증(lv=1 vs 시군구 합)은 서로 다른
  // 집계 단위라 0.5% 를 그대로 둔다 — 바로 위 "교차검증" 테스트가 그쪽을 지킨다.
  it("⚠️ 분할 합 검증은 정확 일치 — 1명만 어긋나도 error (세션546 리뷰 L2)", () => {
    const off = (/** @type {number} */ d) => buildSidoRows({
      // 통합 시도행 값만 d 만큼 흔든다. 분할 합(GWANGJU_GU + JEONNAM_GU)은 그대로 3,157,777.
      sidoCur: [sido("전남광주통합특별시", UNIFIED_SUM + d, 1500000)],
      sidoPrev: [sido("광주광역시", GWANGJU_SUM_PREV, 640000), sido("전라남도", JEONNAM_SUM_PREV, 850000)],
      rawCur: [...GWANGJU_GU, ...JEONNAM_GU],
      rawPrev: [...GWANGJU_GU_PREV, ...JEONNAM_GU_PREV],
      recordedAt: RECORDED_AT,
    }).checks.filter((c) => c.level === "error");

    expect(off(0)).toEqual([]);          // 정확히 같으면 조용하다
    expect(off(1)).toEqual([]);          // ±1명은 허용 (SPLIT_SUM_MAX_DIFF)
    expect(off(2)).toHaveLength(1);      // 2명부터 시끄럽다 — 0.5% 였다면 여기서 침묵했다
    expect(off(2)[0].message).toContain("분할 합");
    // 0.5% 안쪽(약 1.5만 명)도 반드시 잡혀야 한다. 이 단언이 옛 비율 오차와의 갈림길이다.
    const within = Math.floor(UNIFIED_SUM * 0.004);   // 12,631명 — 옛 기준으로는 통과
    expect(within).toBeGreaterThan(1000);             // 픽스처가 의미 있는 크기인지 확인
    expect(off(within)).toHaveLength(1);
  });

  it("T4(d) 작년 lv=1 에 광주·전남이 따로 있으면 그 값이 prev — −1.0 / −0.5", () => {
    const { rows } = buildSidoRows({
      sidoCur: [sido("전남광주통합특별시", UNIFIED_SUM, 1500000)],
      sidoPrev: [sido("광주광역시", GWANGJU_SUM_PREV, 640000), sido("전라남도", JEONNAM_SUM_PREV, 850000)],
      rawCur: [...GWANGJU_GU, ...JEONNAM_GU],
      rawPrev: [...GWANGJU_GU_PREV, ...JEONNAM_GU_PREV],
      recordedAt: RECORDED_AT,
    });
    expect(pick(rows, "광주").pop_growth).toBe(-1.0);
    expect(pick(rows, "전남").pop_growth).toBe(-0.5);
  });

  it("T4(d2) 작년 시군구 합이 lv=1 과 달라도 **lv=1 을 쓴다** (뮤테이션 ⑧ 표적)", () => {
    // 작년 광주 시군구 합을 일부러 1,300,000 으로 낮춘다. lv=1(1,398,538)을 쓰면 −1.0,
    // 시군구 합을 쓰면 +6.5 가 나온다 — 어느 쪽을 썼는지가 이 한 수로 갈린다.
    const prevGwangju = GWANGJU_GU_PREV.map((r, i) => (i === 4 ? sgg("광주광역시", "광산구", 285000, 130000) : r));
    expect(prevGwangju.reduce((s, r) => s + Number(r.totNmprCnt), 0)).toBe(1300000);
    const { rows, checks } = buildSidoRows({
      sidoCur: [sido("전남광주통합특별시", UNIFIED_SUM, 1500000)],
      sidoPrev: [sido("광주광역시", GWANGJU_SUM_PREV, 640000), sido("전라남도", JEONNAM_SUM_PREV, 850000)],
      rawCur: [...GWANGJU_GU, ...JEONNAM_GU],
      rawPrev: [...prevGwangju, ...JEONNAM_GU_PREV],
      recordedAt: RECORDED_AT,
    });
    expect(pick(rows, "광주").pop_growth).toBe(-1.0);
    // 어긋남 자체는 시끄럽게 남는다(그래야 사람이 본다) — 값을 조용히 바꾸지는 않는다.
    expect(checks.some((c) => c.level === "error" && c.message.includes("광주"))).toBe(true);
  });

  it("T4(e) lv=1 실패(빈 배열) → 시군구 합 fallback, 화성이 한 번만", () => {
    const { rows, checks, fallbackCur } = buildSidoRows({
      sidoCur: [],
      sidoPrev: [sido("경기도", 13728157, 6100000)],
      rawCur: GYEONGGI_RAW,
      rawPrev: GYEONGGI_RAW,
      recordedAt: RECORDED_AT,
    });
    expect(fallbackCur).toBe(true);
    expect(pick(rows, "경기").population).toBe(GYEONGGI_LV1_POP);
    // 부모 제외를 접힌 이름으로 하면 화성 999,673 이 한 번 더 들어가 14,767,830 이 된다.
    expect(pick(rows, "경기").population).not.toBe(GYEONGGI_LV1_POP + 999673);
    expect(checks.some((c) => c.level === "warn" && c.message.includes("lv=1 실패"))).toBe(true);
  });

  it("작년 시도 값이 아예 없으면 pop_growth null + error", () => {
    const { rows, checks } = buildSidoRows({
      sidoCur: [sido("경기도", GYEONGGI_LV1_POP, 6181804)],
      sidoPrev: [],
      rawCur: GYEONGGI_RAW,
      rawPrev: [],
      recordedAt: RECORDED_AT,
    });
    expect(pick(rows, "경기").pop_growth).toBeNull();
    expect(checks.some((c) => c.level === "error" && c.message.includes("작년 시도 인구 없음"))).toBe(true);
  });
});

// ── buildGuRows (D3 — 전년 없어도 저장) ──────────────────────
describe("buildGuRows (전년 키가 없어도 인구·세대는 저장한다)", () => {
  it("T3 인천 신설 4구 — population·households 있고 pop_growth 만 null", () => {
    const curRows = pickCanonicalPopulationRows(INCHEON_CUR_RAW).rows;
    const prevRows = pickCanonicalPopulationRows(INCHEON_PREV_RAW).rows;
    const { rows, noPrev } = buildGuRows({ curRows, prevRows, recordedAt: RECORDED_AT });

    expect(rows).toHaveLength(11);
    for (const name of ["제물포구", "영종구", "서해구", "검단구"]) {
      const r = /** @type {any} */ (rows.find((x) => x.gu === name));
      expect(r, `${name} 행이 사라졌다 — 옛 continue 회귀`).toBeTruthy();
      expect(r.population).toBeGreaterThan(0);
      expect(r.households).toBeGreaterThan(0);
      expect(r.pop_growth).toBeNull();
    }
    // 신설 4구 인구 합 = 903,298 — 옛 코드는 이걸 통째로 버렸다.
    const newGu = rows.filter((r) => ["제물포구", "영종구", "서해구", "검단구"].includes(r.gu));
    expect(newGu.reduce((s, r) => s + r.population, 0)).toBe(903298);

    // 기존 7구는 숫자가 나온다
    const 계양 = /** @type {any} */ (rows.find((r) => r.gu === "계양구"));
    expect(계양.pop_growth).toBe(-1.1); // (279000-282000)/282000 = -1.06%
    expect(noPrev).toHaveLength(4);
    expect(summarizeGrowth(rows).noPrev).toBe(4);
  });

  it("옛 값이 있으면 증감률을 계산하고 recorded_at 을 붙인다", () => {
    const { rows, noPrev } = buildGuRows({
      curRows: [{ region: "경기", gu: "김포시", population: 480000, households: 200000 }],
      prevRows: [{ region: "경기", gu: "김포시", population: 470000 }],
      recordedAt: RECORDED_AT,
    });
    expect(rows[0]).toEqual({
      region: "경기", gu: "김포시", pop_growth: 2.1,
      population: 480000, households: 200000, recorded_at: RECORDED_AT,
    });
    expect(noPrev).toEqual([]);
  });

  it("전년 인구가 0 이면 나눗셈 대신 null (Infinity 방지)", () => {
    const { rows } = buildGuRows({
      curRows: [{ region: "경기", gu: "김포시", population: 480000, households: null }],
      prevRows: [{ region: "경기", gu: "김포시", population: 0 }],
      recordedAt: RECORDED_AT,
    });
    expect(rows[0].pop_growth).toBeNull();
    expect(rows[0].households).toBeNull();
  });
});

// ── summarizeGrowth (T8) ─────────────────────────────────────
describe("summarizeGrowth — null 행은 평균 분모에 안 들어간다", () => {
  it("T8 null 4행 + 값 2행 → 분모 2", () => {
    const s = summarizeGrowth([
      { pop_growth: null }, { pop_growth: null }, { pop_growth: null }, { pop_growth: null },
      { pop_growth: 2.0 }, { pop_growth: -4.0 },
    ]);
    expect(s.withGrowth).toBe(2);
    expect(s.noPrev).toBe(4);
    expect(s.positive).toBe(1);
    expect(s.negative).toBe(1);
    expect(s.avg).toBe("-1.00"); // null 을 0 으로 셌다면 -0.33
  });

  it("전부 null 이면 N/A", () => {
    expect(summarizeGrowth([{ pop_growth: null }]).avg).toBe("N/A");
    expect(summarizeGrowth([]).avg).toBe("N/A");
  });
});

// ── CLI 인자 ─────────────────────────────────────────────────
describe("parseTargetArg / parseFocusArg", () => {
  it("T9 --target=202607 → { year: 2026, month: 7 }", () => {
    expect(parseTargetArg(["node", "x.mjs", "--target=202607"])).toEqual({ year: 2026, month: 7 });
  });

  it("없으면 null (기존 −2개월 유지)", () => {
    expect(parseTargetArg(["node", "x.mjs", "--dry-run"])).toBeNull();
  });

  it("형식이 틀리면 조용히 넘어가지 않고 throw", () => {
    expect(() => parseTargetArg(["--target=2026-07"])).toThrow();
    expect(() => parseTargetArg(["--target=202613"])).toThrow();
  });

  it("--focus 는 콤마로 나눈다", () => {
    expect(parseFocusArg(["--focus=경기:화성시,인천:제물포구"])).toEqual(["경기:화성시", "인천:제물포구"]);
    expect(parseFocusArg(["--dry-run"])).toEqual([]);
  });
});

// ── 배선 가드 (T5·T6) ────────────────────────────────────────
//
// 순수 함수가 맞아도 main 이 안 부르면 실제 수집은 고장난 채다.
// ⚠️ 주석을 걷어낸 사본에 돌린다 — 주석 처리된 코드에 매칭되면 가드가 죽은 채 통과한다.
//    스트리퍼는 `scripts/_selectall-keycol-coverage.test.mjs` 의 것과 **같은 두 단계**다.
//    (그 파일을 import 하면 그 파일의 describe 130여 개가 여기서 한 번 더 등록되므로 옮겨 적는다.)
/** @param {string} src */
function stripComments(src) {
  const blank = (/** @type {string} */ m) => m.replace(/[^\n]/g, " ");
  return src
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, blank)   // 줄머리 블록 주석
    .replace(/(?<!\*)\/\*[\s\S]*?\*\//g, blank)    // 줄 중간 블록 주석 (문자열 안 `*/*` 제외)
    .replace(/^[ \t]*\/\/[^\n]*/gm, blank);        // 줄머리 줄 주석
}

describe("배선 가드 — main 이 새 경로를 실제로 쓴다", () => {
  const raw = readFileSync(new URL("./population.mjs", import.meta.url), "utf8");
  const src = stripComments(raw);

  it("스트리퍼가 검사 대상을 먹지 않았다 (표적 존재 확인)", () => {
    for (const needle of ["fetchSidoTotals", "pickCanonicalPopulationRows", "buildSidoRows", "buildGuRows", "rawParents"]) {
      expect(src, `${needle} 가 사라졌다 — 스트리퍼가 코드를 먹었다`).toContain(needle);
    }
  });

  // ⚠️ 세션546 리뷰(L4) — 개수만 세면 `curYear` 를 두 번 부르고 `prevYear` 를 지운 변종이
  // 그대로 통과한다(그러면 증감률이 항상 0 이 되는데 아무도 못 본다). cur·prev 를 **각 1건씩**
  // 따로 단언한다.
  it("T5 시도 합계(lv=1)를 올해·작년 **각각 한 번씩** 부른다", () => {
    const cur = src.match(/fetchSidoTotals\(\s*curYear\s*,\s*curMonth\s*\)/g) ?? [];
    const prev = src.match(/fetchSidoTotals\(\s*prevYear\s*,\s*curMonth\s*\)/g) ?? [];
    expect(cur, "fetchSidoTotals(curYear, curMonth) 가 정확히 1회여야 한다").toHaveLength(1);
    expect(prev, "fetchSidoTotals(prevYear, curMonth) 가 정확히 1회여야 한다").toHaveLength(1);
    // 다른 형태(연도 리터럴 등)로 새어 나가지 않았는지 총량도 함께 본다.
    expect(src.match(/fetchSidoTotals\(/g) ?? []).toHaveLength(3);   // 선언 1 + 호출 2
  });

  // ⚠️ 세션546 리뷰(L4) — `buildSidoRows(` 존재만 보면 **인자가 바뀌어도** 통과한다.
  // 이 함수는 `canonCur/canonPrev`(접힌 행)가 아니라 **원문 행** `rawCur/rawPrev` 를 받아야 한다:
  // 접힌 행에 원문 부모 집합을 적용하면 화성 999,673 이 통째로 빠진다(스펙 §2-C v3).
  it("T5 buildSidoRows 에 **원문 행**(rawCur/rawPrev)이 들어간다", () => {
    expect(src).toMatch(/const\s+sido\s*=\s*buildSidoRows\(\s*\{[^}]*\brawCur\s*:\s*curItems\b/);
    expect(src).toMatch(/const\s+sido\s*=\s*buildSidoRows\(\s*\{[^}]*\brawPrev\s*:\s*prevItems\b/);
    // canonical(접힌) 행이 시도 집계로 새어 들어가면 안 된다.
    expect(src).not.toMatch(/buildSidoRows\(\s*\{[^}]*canon(?:Cur|Prev)/);
  });

  it("T5 canonical dedup 을 올해·작년 **두 번** 거친다", () => {
    const calls = src.match(/const\s+canon(?:Cur|Prev)\s*=\s*pickCanonicalPopulationRows\(/g) ?? [];
    expect(calls).toHaveLength(2);
  });

  it("T5 시도행은 buildSidoRows, 시군구행은 buildGuRows 가 만든다", () => {
    expect(src).toMatch(/const\s+sido\s*=\s*buildSidoRows\(/);
    expect(src).toMatch(/const\s+gu\s*=\s*buildGuRows\(/);
  });

  it("T5 전년 없으면 행째 버리던 옛 줄이 없다", () => {
    expect(src).not.toMatch(/^\s*if\s*\(!curPop\s*\|\|\s*!prevPop\)\s*continue;/m);
  });

  it("T6 부모 제외는 **원문 items** 로 판정한다", () => {
    // 좌변까지 고정한다 — `export function rawParents(items)` 선언부에 매칭되면 가드가 무효라서.
    expect(src).toMatch(/const\s+parents\s*=\s*rawParents\(\s*items\s*\)/);
    // 옛 로직의 흔적이 남아 있으면 안 된다 (되돌림 방지).
    expect(src).not.toMatch(/hasGuLevel/);
    expect(src).not.toMatch(/pickParentCities/);
  });

  it("T6 API 호출 카운트에 시도 합계 2회가 들어간다", () => {
    expect(src).toMatch(/apiCalls\s*\+=\s*SIDO_CODES\.length\s*\*\s*2\s*\+\s*2/);
  });
});

// ── 기존 순수 함수 (회귀) ────────────────────────────────────
describe("resolveRegion", () => {
  it("'경기도' → '경기'", () => {
    expect(resolveRegion("경기도")).toBe("경기");
  });

  it("'서울특별시' → '서울'", () => {
    expect(resolveRegion("서울특별시")).toBe("서울");
  });

  it("'세종특별자치시' → '세종'", () => {
    expect(resolveRegion("세종특별자치시")).toBe("세종");
  });

  it("null 입력 시 null을 반환한다", () => {
    expect(resolveRegion(null)).toBeNull();
  });

  it("매칭 불가한 문자열은 null을 반환한다", () => {
    expect(resolveRegion("미지의땅")).toBeNull();
  });
});

describe("parseGu", () => {
  it("(서울특별시, '강남구') — 자치구 직접 (sggNm 단어 1개)", () => {
    expect(parseGu("서울특별시", "강남구")).toEqual({ region: "서울", gu: "강남구", folded: false });
  });

  it("(경기도, '수원시 팔달구') — 자치구 단위 (sggNm 그대로)", () => {
    expect(parseGu("경기도", "수원시 팔달구")).toEqual({ region: "경기", gu: "수원시 팔달구", folded: false });
  });

  it("(경기도, '수원시') — 시 합계 행", () => {
    expect(parseGu("경기도", "수원시")).toEqual({ region: "경기", gu: "수원시", folded: false });
  });

  it("화성 신설구는 시 단위로 접힌다 — folded 로 표시된다 (세션546)", () => {
    // 이 표시가 없으면 pickCanonicalPopulationRows 가 시 값과 구 값을 구분하지 못한다.
    expect(parseGu("경기도", "화성시 동탄구")).toEqual({ region: "경기", gu: "화성시", folded: true });
    expect(parseGu("경기도", "화성시")).toEqual({ region: "경기", gu: "화성시", folded: false });
  });

  it("(세종특별자치시, anything) → 세종 + 세종시", () => {
    expect(parseGu("세종특별자치시", "")).toEqual({ region: "세종", gu: "세종시", folded: false });
    expect(parseGu("세종특별자치시", "어진동")).toEqual({ region: "세종", gu: "세종시", folded: false });
  });

  it("sggNm 부재 + 비세종 시 null", () => {
    expect(parseGu("경기도", null)).toBeNull();
    expect(parseGu("경기도", "")).toBeNull();
    expect(parseGu("경기도", undefined)).toBeNull();
  });

  it("ctpvNm 매칭 불가 시 null", () => {
    expect(parseGu("미지의땅", "수원시")).toBeNull();
    expect(parseGu(null, "강남구")).toBeNull();
  });
});

describe("parseHouseholds", () => {
  it("'72618' → 72618", () => {
    expect(parseHouseholds("72618")).toBe(72618);
  });

  it("'4,097,562' → 4097562 (콤마 제거)", () => {
    expect(parseHouseholds("4,097,562")).toBe(4097562);
  });

  it("숫자 1234 → 1234", () => {
    expect(parseHouseholds(1234)).toBe(1234);
  });

  it("0 / 음수 / 빈값 / null / undefined → null", () => {
    expect(parseHouseholds("0")).toBeNull();
    expect(parseHouseholds("-100")).toBeNull();
    expect(parseHouseholds("")).toBeNull();
    expect(parseHouseholds(null)).toBeNull();
    expect(parseHouseholds(undefined)).toBeNull();
  });

  it("비숫자 문자열 → null", () => {
    expect(parseHouseholds("abc")).toBeNull();
  });
});

// ── 전남광주통합특별시 (2026-07-01) — 세션545 ─────────────────
//
// ⚠️ 이 가드가 없으면 `"전남광주통합특별시".includes("광주")` 가 참이라 **27 시군구 전부**가
// 광주로 붙는다(전남 22 시군 포함). 그러면 광주 인구가 몇 배로 부풀고 전남은 통째로 빈다 —
// 에러 하나 없이. 그래서 "resolveRegion 이 null 을 준다" 와 "parseGu 가 갈라 준다" 를 함께 잠근다.
describe("전남광주통합특별시 분할 (세션545)", () => {
  it("resolveRegion 은 통합 이름을 못 가른다 → null", () => {
    expect(resolveRegion("전남광주통합특별시")).toBeNull();
  });

  it("parseGu: 통합 + 순천시 → 전남", () => {
    expect(parseGu("전남광주통합특별시", "순천시")).toEqual({ region: "전남", gu: "순천시", folded: false });
  });

  it("parseGu: 통합 + 동구 → 광주", () => {
    expect(parseGu("전남광주통합특별시", "동구")).toEqual({ region: "광주", gu: "동구", folded: false });
  });

  it("parseGu: 통합 + 무안군 → 전남 / 통합 + 광산구 → 광주", () => {
    expect(parseGu("전남광주통합특별시", "무안군")?.region).toBe("전남");
    expect(parseGu("전남광주통합특별시", "광산구")?.region).toBe("광주");
  });

  it("parseGu: 통합인데 sggNm 이 비면 null (시도 합계행은 버린다)", () => {
    expect(parseGu("전남광주통합특별시", "")).toBeNull();
    expect(parseGu("전남광주통합특별시", null)).toBeNull();
  });

  // ⚠️ 분할 헬퍼가 "광주 5구가 아니면 전남" 이던 시절엔 시군구가 아닌 토큰도 전남 행으로
  //    적재됐다. 없는 시군구 이름으로 regions 행이 생기면 화면에서 영영 안 붙는다.
  it("parseGu: 시군구가 아닌 sggNm(지구·블록)은 null — 없는 전남 행을 만들지 않는다", () => {
    expect(parseGu("전남광주통합특별시", "첨단3지구")).toBeNull();
    expect(parseGu("전남광주통합특별시", "A7블록")).toBeNull();
  });

  it("기존 시도명은 회귀 없음", () => {
    expect(parseGu("전라남도", "순천시")).toEqual({ region: "전남", gu: "순천시", folded: false });
    expect(parseGu("광주광역시", "북구")).toEqual({ region: "광주", gu: "북구", folded: false });
  });

  it("시도 집계는 region 키로 도므로 광주·전남이 자연히 갈린다", () => {
    const items = [
      sgg("전남광주통합특별시", "동구", 105000),
      sgg("전남광주통합특별시", "북구", 420000),
      sgg("전남광주통합특별시", "순천시", 270000),
      sgg("전남광주통합특별시", "무안군", 95000),
    ];
    const s = sumSidoFromRaw(items);
    expect(s["광주"].population).toBe(525000);
    expect(s["전남"].population).toBe(365000);
    // 시 합계행 제외 대상이 생기지 않는다(자치구 이름이 한 단어라 부모 시가 안 잡힌다)
    expect(rawParents(items).size).toBe(0);
  });
});

// ── 부분 매칭 모호성 (세션545 적대검증) ──────────────────────
//
// 처음엔 `/통합특별시/` 로 그 이름 하나만 막았다. 적대검증이 **표기가 한 글자만 달라도**
// 빠져나가는 것을 재현했다: "전남광주특별시" 는 그 정규식에 안 걸리고, 부분 매칭 루프에서
// `.includes("광주")` 가 먼저 참이 되어 **27 시군구 전부가 광주**로 굳는다.
// 처방은 이름을 열거해 막는 게 아니라 **둘 이상 걸리면 포기**하는 것이다.
describe("resolveRegion — 부분 매칭이 모호하면 판정하지 않는다 (세션545)", () => {
  it("전남·광주가 동시에 걸리는 이름은 표기가 달라도 전부 null", () => {
    for (const nm of ["전남광주통합특별시", "전남광주특별시", "전남광주통합시", "광주전남통합특별시", "전남광주자치시"]) {
      expect(resolveRegion(nm)).toBeNull();
    }
  });

  it("한 곳만 걸리는 이름은 그대로 판정한다 (회귀 0)", () => {
    expect(resolveRegion("서울시")).toBe("서울");
    expect(resolveRegion("경기도")).toBe("경기");
    expect(resolveRegion("전라남도")).toBe("전남");
    expect(resolveRegion("광주광역시")).toBe("광주");
  });

  it("아무것도 안 걸리면 null", () => {
    expect(resolveRegion("미지의땅")).toBeNull();
    expect(resolveRegion(null)).toBeNull();
  });

  it("프로토타입 키는 표에 없는 것으로 본다", () => {
    expect(resolveRegion("constructor")).toBeNull();
    expect(resolveRegion("toString")).toBeNull();
  });
});
