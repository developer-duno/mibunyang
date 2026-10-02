// @ts-check
/**
 * _match-gates.mjs 시험 — 수집기 짝 짓기 게이트 (세션589)
 *
 * 설계서 `docs/superpowers/specs/2026-10-02-collector-match-gates.md` §5 가 이름을 댄 **실제 사례**를
 * 그대로 넣는다(조사반 G 가 저장한 K-apt 시도 목록 원문 `kapt_list_41.json` 과 DB 스냅숏
 * `snap_apartments.json`, 2026-10-02 오전 — 이름·법정동코드·완공월은 원문 그대로 옮겼다).
 * 시각은 전부 인자로 넣는다 — 실제 시각에 기대지 않는다(`now` 고정).
 */
import { describe, it, expect, vi, afterEach } from "vitest";

// _shared.mjs — loadEnv/getSupabase 차단 (sync-naver-complex 를 거리 판정 정본으로 import 하므로)
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return { ...orig, loadEnv: vi.fn(), getSupabase: vi.fn(), getMibuyangSupabase: vi.fn(), log: vi.fn(), logError: vi.fn() };
});

const G = await import("./_match-gates.mjs");
const { withinMatchRange, distanceM } = await import("./sync-naver-complex.mjs");
const { findBestMatch } = await import("./_molit-api.mjs");

/** 2026-10-02 12:00 KST — 이번 달 = 2026-10 */
const NOW = new Date("2026-10-02T03:00:00Z");

/**
 * KST 시각으로 Date 를 만든다("2026-10-02 06:20" → UTC 21:20 전날).
 * @param {string} kst "YYYY-MM-DD HH:MM"
 */
const kstAt = (kst) => new Date(`${kst.replace(" ", "T")}:00+09:00`);

// ── K-apt 목록 원문(kapt_list_41.json · 경기 "41") 발췌 ──────────────
const L = {
  동탄2롯데캐슬: { kaptCode: "K-DT2", kaptName: "동탄2 롯데캐슬", bjdCode: "4159711100", as1: "경기도", as2: "화성동탄구", as3: "장지동" },
  신동탄롯데캐슬: { kaptCode: "K-SDT", kaptName: "신동탄 롯데캐슬아파트", bjdCode: "4159510500", as1: "경기도", as2: "화성병점구", as3: "반월동" },
  신동탄포레자이: { kaptCode: "K-SDF", kaptName: "신동탄포레자이아파트", bjdCode: "4159510500", as1: "경기도", as2: "화성병점구", as3: "반월동" },
  광명철산도덕: { kaptCode: "A10027643", kaptName: "광명철산도덕파크타운", bjdCode: "4121010200", as1: "경기도", as2: "광명시", as3: "철산동" },
  오산호반라포레: { kaptCode: "K-OSH", kaptName: "오산호반써밋라포레", bjdCode: "4137010400", as1: "경기도", as2: "오산시", as3: "궐동" },
  예미지센트럴에듀: { kaptCode: "K-YMC", kaptName: "예미지센트럴에듀", bjdCode: "4159332024", as1: "경기도", as2: "화성효행구", as3: "비봉면" },
  평택지제역자이: { kaptCode: "K-PTJ", kaptName: "평택지제역자이아파트", bjdCode: "4122012000", as1: "경기도", as2: "평택시", as3: "세교동" },
  원종역해모로: { kaptCode: "K-WJ", kaptName: "원종역해모로아스트라", bjdCode: "4119610400", as1: "경기도", as2: "부천오정구", as3: "원종동" },
  궁전: { kaptCode: "A10020067", kaptName: "궁전아파트", bjdCode: "4111112900", as1: "경기도", as2: "수원장안구", as3: "파장동" },
};
const LIST_41 = Object.values(L);

/**
 * DB 스냅숏(snap_apartments.json) 꼴의 아파트 행.
 * @param {string} name @param {string | null} completion @param {string | null} bjd @param {string | null} gu
 * @param {string} [region]
 */
const apt = (name, completion, bjd, gu, region = "경기") => ({ name, completion, bjd_code: bjd, gu, region });

// ── 완공월 ─────────────────────────────────────────────────────
describe("completionMonthIndex / isMovedIn", () => {
  it("형식표 — YYYYMM · YYYY-MM(-DD) 만 받고 나머지는 null", () => {
    expect(G.completionMonthIndex("202610")).toBe(2026 * 12 + 9);
    expect(G.completionMonthIndex("2026-10")).toBe(2026 * 12 + 9);
    expect(G.completionMonthIndex("2026-1-05")).toBe(2026 * 12);
    expect(G.completionMonthIndex("20266")).toBeNull(); // "2026.6" 이 잘린 값 — 서기 20266년으로 통과하면 안 된다
    expect(G.completionMonthIndex("202613")).toBeNull(); // 13월 → 2027-01 로 넘기지 않는다
    expect(G.completionMonthIndex("202600")).toBeNull();
    expect(G.completionMonthIndex("미정")).toBeNull();
    expect(G.completionMonthIndex("2030 미")).toBeNull();
    expect(G.completionMonthIndex("")).toBeNull();
    expect(G.completionMonthIndex(null)).toBeNull();
  });

  it("입주 후 = 완공월이 이번 달(KST)보다 앞 — 이번 달·다음 달·모름은 거짓", () => {
    expect(G.isMovedIn("202609", NOW)).toBe(true);
    expect(G.isMovedIn("202610", NOW)).toBe(false); // 이번 달 = 입주 전(scorePrice isPresale 와 같은 경계)
    expect(G.isMovedIn("202611", NOW)).toBe(false);
    expect(G.isMovedIn(null, NOW)).toBe(false);
    expect(G.isMovedIn("미정", NOW)).toBe(false);
  });

  it("월 경계는 KST 로 판정 — UTC 9/30 15:30 은 KST 10/01 00:30", () => {
    const edge = new Date("2026-09-30T15:30:00Z");
    expect(G.monthIndexKst(edge)).toBe(2026 * 12 + 9);
    expect(G.isMovedIn("202609", edge)).toBe(true);
    expect(G.isMovedIn("202610", edge)).toBe(false);
  });

  // src/scoring/scorePrice.ts 의 parseCompletionMonth 는 export 되지 않아 isPresale 로 맞댄다.
  // 시스템 시각을 두 번 고정한다: ① 아주 먼 과거(1900-01) — 그러면 isPresale(x) 는 "x 가 해석되는가"와
  // 같다 ② 2026-10 — 그러면 isPresale(x) 는 "x 가 이번 달 이후인가"와 같다. 두 판정이 모든 입력에서 같아야
  // 두 파서가 같은 값을 낸다(null 여부 + 경계).
  describe("scorePrice.ts parseCompletionMonth 와 같은 입력표로 맞대기", () => {
    afterEach(() => { vi.useRealTimers(); });
    const INPUTS = ["20266", "202613", "2026-10", "2026-10-15", "2026-1", "202610", "202609", "202611", "199912", "미정", "2030 미", "[1회]20", "", " 202605 ", null, undefined];

    it("① 해석 가능 여부(null)가 같다", async () => {
      const path = "../../src/scoring/scorePrice.ts";
      const { isPresale } = /** @type {any} */ (await import(/* @vite-ignore */ path));
      vi.useFakeTimers();
      vi.setSystemTime(new Date("1900-01-15T00:00:00Z"));
      for (const x of INPUTS) {
        expect(isPresale(x), `입력 ${JSON.stringify(x)}`).toBe(G.completionMonthIndex(x) != null);
      }
    });

    it("② 이번 달 경계가 같다 (isPresale = !isMovedIn, 해석 가능한 입력에서)", async () => {
      const path = "../../src/scoring/scorePrice.ts";
      const { isPresale } = /** @type {any} */ (await import(/* @vite-ignore */ path));
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
      for (const x of INPUTS) {
        if (G.completionMonthIndex(x) == null) continue;
        expect(isPresale(x), `입력 ${JSON.stringify(x)}`).toBe(!G.isMovedIn(x, NOW));
      }
    });
  });
});

// ── 이름 ───────────────────────────────────────────────────────
describe("cleanMatchName / namesCompatible", () => {
  it("회차 낱말·괄호를 떼고 로마 숫자를 아라비아로", () => {
    expect(G.cleanMatchName("평택지제역자이 무순위(사후) 1차")).toBe("평택지제역자이");
    expect(G.cleanMatchName("반월자이 더 파크(1차)")).toBe("반월자이 더 파크");
    expect(G.cleanMatchName("검단신도시롯데캐슬넥스티엘Ⅲ")).toBe("검단신도시롯데캐슬넥스티엘3");
    expect(G.cleanMatchName(null)).toBe("");
  });

  it("형제 블록·다른 차수는 같은 단지가 아니다", () => {
    expect(G.namesCompatible("검단신도시롯데캐슬넥스티엘Ⅲ", "검단신도시롯데캐슬넥스티엘Ⅰ")).toBe(false);
    expect(G.namesCompatible("힐스테이트레이크송도5차", "힐스테이트레이크송도4차")).toBe(false);
    expect(G.namesCompatible("원종역해모로아스트라3차", "원종역해모로아스트라2차")).toBe(false);
    expect(G.namesCompatible("수원 엘리프 한신더휴(C3블록)", "수원 엘리프 한신더휴(D3블록)")).toBe(false);
    expect(G.namesCompatible("어떤단지(AB23BL)", "어떤단지(AA23BL)")).toBe(false);
  });

  it("한쪽에만 차수·로마 숫자가 있으면 막지 않는다(아는 차이만 막는다)", () => {
    expect(G.namesCompatible("검단신도시롯데캐슬넥스티엘Ⅲ", "검단신도시롯데캐슬넥스티엘")).toBe(true);
    expect(G.namesCompatible("반월자이 더 파크(1차)", "(주)이오티앤디 반월자이더 파크아파트")).toBe(true);
    expect(G.namesCompatible("원종역해모로아스트라3차", "원종역해모로아스트라")).toBe(true);
  });

  it("공고 회차(무순위 2차)는 단지 차수로 안 본다", () => {
    expect(G.namesCompatible("파라곤 무순위 2차", "파라곤 1단지")).toBe(true);
  });
});

// ── 같은 시군구 (K2) ────────────────────────────────────────────
describe("sameSigungu", () => {
  it("법정동코드 앞 5자리로 본다", () => {
    expect(G.sameSigungu(apt("x", "202001", "4121010400", "광명시"), L.광명철산도덕)).toBe(true);
    expect(G.sameSigungu(apt("x", "202001", "4159510500", "화성시"), L.동탄2롯데캐슬)).toBe(false); // 41595 ↔ 41597
  });

  it("코드가 없으면 구 이름 글자 — '수원시 장안구' ↔ '수원장안구'", () => {
    expect(G.sameSigungu(apt("x", "202001", null, "수원시 장안구"), L.궁전)).toBe(true);
    expect(G.sameSigungu(apt("x", "202001", null, "수원시 권선구"), L.궁전)).toBe(false);
    expect(G.sameSigungu(apt("x", "202001", null, "광명시"), L.광명철산도덕)).toBe(true);
  });

  it("코드도 구도 없으면 거짓 — 세종(시도 = 시)만 참", () => {
    expect(G.sameSigungu(apt("x", "202001", null, null), L.광명철산도덕)).toBe(false);
    const sejong = { kaptCode: "A10023365", kaptName: "수루배마을9단지", bjdCode: "3611010100", as1: "세종특별자치시", as2: null, as3: "반곡동" };
    expect(G.sameSigungu(apt("x", "202001", null, null, "세종"), sejong)).toBe(true);
  });

  it("광주·전남은 같은 목록 '12' 를 받지만 시군구 코드가 가른다", () => {
    // 스냅숏: 광주 북구 1230010900 · 전남 광양시 1219010100
    const 광주단지 = apt("운암동 한국아델리움57 에듀힐즈", "201501", "1230010900", "북구", "광주");
    const 전남목록 = { kaptCode: "K-GY", kaptName: "운암동 한국아델리움 에듀힐즈", bjdCode: "1219010100", as1: "전남광주통합특별시", as2: "광양시", as3: "중동" };
    const 광주목록 = { kaptCode: "K-UA", kaptName: "운암 한국아델리움 에듀힐즈", bjdCode: "1230010900", as1: "전남광주통합특별시", as2: "광주북구", as3: "운암동" };
    expect(G.sameSigungu(광주단지, 전남목록)).toBe(false);
    expect(G.pickKaptMatch(광주단지, [전남목록], { now: NOW }).match).toBeNull();
    expect(G.pickKaptMatch(광주단지, [전남목록, 광주목록], { now: NOW }).match?.kaptCode).toBe("K-UA");
  });
});

// ── K-apt 짝 (K1·K3·K5) — 설계서 §5 실제 사례 ─────────────────────
describe("pickKaptMatch — 실제 사례", () => {
  it("신동탄롯데캐슬 — 옛 짝(동탄2 롯데캐슬, 다른 구)에서 맞는 단지로 바뀐다", () => {
    const a = apt("신동탄롯데캐슬", "201806", "4159510500", "화성시");
    expect(findBestMatch(a.name, a.gu, LIST_41)?.kaptCode).toBe("K-DT2"); // 옛 동작(대조) — 이것이 바뀐다
    const r = G.pickKaptMatch(a, LIST_41, { now: NOW });
    expect(r.match?.kaptCode).toBe("K-SDT");
    expect(r.score).toBeGreaterThanOrEqual(0.8);
  });

  it("광명소하파크타워 → 광명철산도덕파크타운: 같은 시군구지만 이름 0.56 — 거부", () => {
    const r = G.pickKaptMatch(apt("광명소하파크타워", "202510", "4121010400", "광명시"), LIST_41, { now: NOW });
    expect(r.match).toBeNull();
    expect(r.reason).toMatch(/이름 유사도/);
  });

  it("오산 A-13블록 호반써밋 → 오산호반써밋라포레: 이름 0.46 — 거부", () => {
    const r = G.pickKaptMatch(apt("오산세교2지구 A-13블록 호반써밋", "202606", "4137011700", "오산시"), LIST_41, { now: NOW });
    expect(r.match).toBeNull();
    expect(r.reason).toMatch(/이름 유사도/);
  });

  it("예미지센트럴에듀·평택지제역자이 — 이름 0.6~0.7 대의 진짜(지번·세대수 일치)는 유지", () => {
    const y = G.pickKaptMatch(apt("화성 비봉지구 B3블록 예미지 센트럴에듀", "202501", "4159332024", "화성시"), LIST_41, { now: NOW });
    expect(y.match?.kaptCode).toBe("K-YMC");
    expect(y.score).toBeGreaterThanOrEqual(0.6);
    expect(y.score).toBeLessThan(0.7);
    const p = G.pickKaptMatch(apt("평택지제역자이 무순위(사후) 1차", "202306", "4122011800", "평택시"), LIST_41, { now: NOW });
    expect(p.match?.kaptCode).toBe("K-PTJ");
  });

  it("원종역해모로아스트라3차 — 입주 전(202806)이라 거부, 입주 후여도 2차와는 차수 충돌로 거부", () => {
    const a = apt("원종역해모로아스트라3차", "202806", "4119610400", "부천시 오정구");
    const r = G.pickKaptMatch(a, LIST_41, { now: NOW });
    expect(r.match).toBeNull();
    expect(r.reason).toMatch(/입주 전/);
    const moved = { ...a, completion: "202301" };
    const second = { kaptCode: "K-WJ2", kaptName: "원종역해모로아스트라2차", bjdCode: "4119610400", as2: "부천오정구", as3: "원종동" };
    const r2 = G.pickKaptMatch(moved, [second], { now: NOW });
    expect(r2.match).toBeNull();
    expect(r2.reason).toMatch(/차수·블록 충돌/);
  });

  it("걸러 놓고 고르기 — 점수가 더 높은 충돌 후보를 건너뛰고 남은 후보 중 최고를 고른다", () => {
    const a = apt("힐스테이트레이크송도5차", "202301", "2818510600", "연수구", "인천");
    const four = { kaptCode: "K-4", kaptName: "힐스테이트레이크송도4차", bjdCode: "2818510600", as2: "연수구", as3: "송도동" };
    const plain = { kaptCode: "K-P", kaptName: "힐스테이트 레이크송도 아파트", bjdCode: "2818510600", as2: "연수구", as3: "송도동" };
    expect(G.pickKaptMatch(a, [four, plain], { now: NOW }).match?.kaptCode).toBe("K-P");
  });

  it("완공월 모름은 매칭 안 함(K5)", () => {
    const r = G.pickKaptMatch(apt("휴먼시아41단지 국민임대", null, "4146510700", "용인시 수지구"), LIST_41, { now: NOW });
    expect(r.match).toBeNull();
    expect(r.reason).toMatch(/완공월 모름/);
    expect(G.pickKaptMatch(apt("신동탄롯데캐슬", "미정", "4159510500", "화성시"), LIST_41, { now: NOW }).match).toBeNull();
  });

  it("입주 전 단지는 매칭 안 함 — 이번 달 완공도 입주 전", () => {
    expect(G.pickKaptMatch(apt("신동탄롯데캐슬", "202610", "4159510500", "화성시"), LIST_41, { now: NOW }).match).toBeNull();
    expect(G.pickKaptMatch(apt("신동탄롯데캐슬", "202609", "4159510500", "화성시"), LIST_41, { now: NOW }).match?.kaptCode).toBe("K-SDT");
  });

  it("같은 시군구 후보가 없으면 거부", () => {
    const r = G.pickKaptMatch(apt("신동탄롯데캐슬", "201806", "4111110100", "수원시 장안구"), [L.신동탄롯데캐슬], { now: NOW });
    expect(r.match).toBeNull();
    expect(r.reason).toBe("같은 시군구 후보 없음");
  });

  it("이름 하한 0.6 경계 — 0.6 은 통과", () => {
    // 일신건영휴먼하임 ↔ 일신건영 역곡휴먼빌 아파트 = 정확히 0.60 (스냅숏 실측)
    const a = apt("일신건영휴먼하임", "202212", "4119410400", "부천시 소사구");
    const k = { kaptCode: "K-IS", kaptName: "일신건영 역곡휴먼빌 아파트", bjdCode: "4119410400", as2: "부천소사구", as3: "괴안동" };
    const r = G.pickKaptMatch(a, [k], { now: NOW });
    expect(r.score).toBe(0.6);
    expect(r.match?.kaptCode).toBe("K-IS");
  });
});

// ── 사용승인일 (K4) ─────────────────────────────────────────────
describe("usedateConsistent", () => {
  it("±24개월 경계 — 24 통과 · 25 거부", () => {
    expect(G.usedateConsistent("202306", "20250615")).toBe(true); // +24
    expect(G.usedateConsistent("202306", "20250701")).toBe(false); // +25
    expect(G.usedateConsistent("202306", "20210601")).toBe(true); // −24
    expect(G.usedateConsistent("202306", "20210501")).toBe(false); // −25
    expect(G.usedateConsistent("202306", "20230612")).toBe(true);
  });

  it("표본의 확실한 가짜 2곳(289개월 · 36개월)을 잡는다", () => {
    expect(G.usedateConsistent("202510", "20010907")).toBe(false); // 광명소하파크타워 ↔ 광명철산도덕파크타운
    expect(G.usedateConsistent("202606", "20230601")).toBe(false); // 오산 A-13블록 ↔ 오산호반써밋라포레
  });

  it("어느 쪽이든 모르면 거짓", () => {
    expect(G.usedateConsistent(null, "20230601")).toBe(false);
    expect(G.usedateConsistent("202306", "")).toBe(false);
    expect(G.usedateConsistent("202306", undefined)).toBe(false);
    expect(G.usedateConsistent("202306", "2023")).toBe(false);
  });
});

// ── 네이버 단지 짝 (N1) ─────────────────────────────────────────
describe("pickNaverComplexForListing", () => {
  const deps = { withinRange: withinMatchRange, distance: distanceM };
  /** 위도 1도 ≈ 111.2km → 0.001도 ≈ 111m */
  const at = (/** @type {number} */ dLatDeg) => ({ latitude: 37.5 + dLatDeg, longitude: 127.0 });
  /** @param {string} no @param {string} name @param {number} dLat */
  const cpx = (no, name, dLat) => ({ complex_no: no, complex_name: name, ...at(dLat) });
  const me = (/** @type {string} */ name) => ({ name, lat: 37.5, lng: 127.0 });

  it("형제 블록 — 넥스티엘Ⅲ ← Ⅰ 거부", () => {
    expect(G.pickNaverComplexForListing(me("검단신도시롯데캐슬넥스티엘Ⅲ"), [cpx("1", "검단신도시롯데캐슬넥스티엘Ⅰ", 0.001)], deps)).toBeNull();
  });

  it("다른 차수 — 레이크송도5차 ← 4차 거부", () => {
    expect(G.pickNaverComplexForListing(me("힐스테이트레이크송도5차"), [cpx("1", "힐스테이트레이크송도4차", 0.001)], deps)).toBeNull();
  });

  it("이름 0.75 아래는 거부 — 동탄 C7블록 예미지시그너스 ← 동탄역예미지시그너스(0.64)", () => {
    expect(G.pickNaverComplexForListing(me("화성동탄2지구 C7블록 예미지시그너스"), [cpx("1", "동탄역예미지시그너스(주상복합)", 0)], deps)).toBeNull();
  });

  it("500m 밖은 거부 · 좌표 없으면 거부(fail-close)", () => {
    expect(G.pickNaverComplexForListing(me("더샵오포센트리체"), [cpx("1", "더샵오포센트리체", 0.0046)], deps)).toBeNull(); // ≈ 511m
    expect(G.pickNaverComplexForListing(me("더샵오포센트리체"), [cpx("1", "더샵오포센트리체", 0.0044)], deps)?.complex_no).toBe("1"); // ≈ 489m
    expect(G.pickNaverComplexForListing({ name: "더샵오포센트리체", lat: null, lng: null }, [cpx("1", "더샵오포센트리체", 0)], deps)).toBeNull();
  });

  it("여럿이 통과하면 가장 가까운 단지 — 후보 순서와 무관", () => {
    const far = cpx("A-far", "트리풀시티레이크포레", 0.003);
    const near = cpx("Z-near", "트리풀시티레이크포레", 0.001);
    expect(G.pickNaverComplexForListing(me("트리풀시티 레이크포레(갑천3BL)"), [far, near], deps)?.complex_no).toBe("Z-near");
    expect(G.pickNaverComplexForListing(me("트리풀시티 레이크포레(갑천3BL)"), [near, far], deps)?.complex_no).toBe("Z-near");
  });

  it("통과한 게 없으면 null", () => {
    expect(G.pickNaverComplexForListing(me("어떤단지"), [], deps)).toBeNull();
  });
});

// ── 2u 창 (R3) ─────────────────────────────────────────────────
describe("inSiblingKaptWindow — 경계 시각(KST)", () => {
  const cases = /** @type {Array<[string, boolean]>} */ ([
    ["2026-10-05 06:19", false],
    ["2026-10-05 06:20", true],
    ["2026-10-05 08:25", true],
    ["2026-10-05 08:26", false],
    ["2026-10-05 12:39", false],
    ["2026-10-05 12:40", true],
    ["2026-10-05 15:15", true],
    ["2026-10-05 15:16", false],
    ["2026-10-05 20:59", false],
    ["2026-10-05 21:00", true],
    ["2026-10-05 23:30", true],
    ["2026-10-05 23:31", false],
    ["2026-10-05 05:30", false], // 러너 05:30 회차는 창 밖
  ]);
  for (const [t, want] of cases) {
    it(`${t} → ${want ? "창 안" : "창 밖"}`, () => {
      expect(G.inSiblingKaptWindow(kstAt(t))).toBe(want);
    });
  }
});
