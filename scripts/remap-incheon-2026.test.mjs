// @ts-check
/**
 * remap-incheon-2026.mjs 순수 함수 + 배선 테스트 (세션546 PR-F2 §3).
 *
 * 이 도구는 **좌표로 gu 를 다시 정하고** trades 행을 **지운다**. 그래서 가드가 두 겹이다:
 *   ① 판정 게이트 — 좌표가 인천 밖을 가리키면 그 단지를 다른 시도로 옮겨 버린다.
 *   ② 삭제 fail-close — "백필이 같은 거래를 새 gu 로 다시 넣었다" 가 무너지면 아무것도 안 지운다.
 *
 * 배선 가드(소스 grep)는 **줄머리를 고정**하고 주석을 걷어낸 사본에서 본다 —
 * 선언부·주석에 걸리는 정규식은 뮤테이션에 초록불을 준다(guards-must-be-mutation-tested).
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("./collectors/_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return { ...orig, loadEnv: vi.fn(), getSupabase: vi.fn() };
});

const {
  planIncheonTargets, buildIncheonUpdate, buildIdsUpdate,
  planHwaseongGu, planNormalizeGu,
  tradeTwinKey, inTradeWindow, filterTradeRows, computeTwinRatio,
  chunkIds, verifyApplied, verifyResiduals, parseArgs,
  REGION, RETIRED, NEW_GU, OLD_BJD_PREFIX,
  TRADE_WINDOW_FROM, TRADE_WINDOW_TO, TWIN_RATIO_MIN, ID_CHUNK,
} = await import("./remap-incheon-2026.mjs");

// ── 픽스처 ────────────────────────────────────────────────────
/** @param {Record<string, unknown>} [o] */
const apt = (o = {}) => ({
  id: "ap-1", region: "인천", gu: null, dong: null, bjd_code: null,
  lat: 37.49, lng: 126.51, name: "테스트단지", ...o,
});

/**
 * 카카오 `coord2regioncode` 응답 — 스펙 §0-1 실측(영종 운남동 `2815510200`).
 * @param {Record<string, unknown>} [b] 법정동(B) 덮어쓰기
 * @param {Record<string, unknown> | null} [h] 행정동(H) 덮어쓰기(null 이면 H 없음)
 */
const docs = (b = {}, h = {}) => ({
  legal: {
    region_type: "B", region_1depth_name: "인천광역시", region_2depth_name: "영종구",
    region_3depth_name: "운남동", code: "2815510200", ...b,
  },
  admin: h === null ? null : {
    region_type: "H", region_1depth_name: "인천광역시", region_2depth_name: "영종구",
    region_3depth_name: "영종동", code: "2815551000", ...h,
  },
});

/** @param {Record<string, unknown>} [o] */
const trade = (o = {}) => ({
  id: 1, region: "인천", gu: "서구", dong: "당하동", deal_month: "202605",
  area: 84.9, price: 50000, floor: 10, trade_type: "sale", apt_name: "검단어반", ...o,
});

// ── (A) 대상 선정 ─────────────────────────────────────────────
describe("planIncheonTargets — 네 분기", () => {
  it("은퇴 gu 는 대상", () => {
    const { targets } = planIncheonTargets([apt({ id: "a", gu: "서구", bjd_code: "2826011400" })]);
    expect(targets.map((r) => r.id)).toEqual(["a"]);
  });

  it("bjd_code 가 없으면 대상 (조회 키 자체가 없다)", () => {
    const { targets } = planIncheonTargets([apt({ id: "b", gu: "서해구", bjd_code: null })]);
    expect(targets.map((r) => r.id)).toEqual(["b"]);
  });

  it("bjd 앞5 가 옛 코드면 gu 가 새 이름이어도 대상", () => {
    const { targets } = planIncheonTargets([apt({ id: "c", gu: "검단구", bjd_code: "2826011400" })]);
    expect(targets.map((r) => r.id)).toEqual(["c"]);
  });

  it("새 gu + 새 bjd 는 대상 아님 — 멱등", () => {
    const { targets } = planIncheonTargets([apt({ id: "d", gu: "검단구", bjd_code: "2829010400" })]);
    expect(targets).toEqual([]);
  });

  it("좌표가 없으면 판정 불가 — noCoord 로 뺀다", () => {
    const { targets, skipped } = planIncheonTargets([
      apt({ id: "e", gu: "중구", lat: null, lng: 126.5 }),
      apt({ id: "f", gu: "중구", lat: 37.4, lng: null }),
    ]);
    expect(targets).toEqual([]);
    expect(skipped.noCoord).toEqual(["e", "f"]);
  });

  it("다른 지역 행은 건드리지 않는다", () => {
    const { targets } = planIncheonTargets([
      apt({ id: "g", region: "부산", gu: "중구", bjd_code: null }),
    ]);
    expect(targets).toEqual([]);
  });

  it("옛 접두 상수 = 28110/28140/28260 (28120 은 카카오가 줄 수 없는 값)", () => {
    expect([...OLD_BJD_PREFIX].sort()).toEqual(["28110", "28140", "28260"]);
    expect([...RETIRED].sort()).toEqual(["동구", "서구", "중구"]);
    expect(NEW_GU.sort()).toEqual(["검단구", "서해구", "영종구", "제물포구"]);
    expect(REGION).toBe("인천");
  });
});

// ── (B) 판정 게이트 ───────────────────────────────────────────
describe("buildIncheonUpdate — 게이트", () => {
  it("정상 — 영종 픽스처로 gu·dong·bjd 를 새로 쓴다", () => {
    const v = buildIncheonUpdate(apt({ gu: "중구", dong: "운남동", bjd_code: "2811014600" }), docs());
    expect(v.action).toBe("update");
    expect(v.updates).toEqual({ gu: "영종구", dong: "영종동", bjd_code: "2815510200" });
    expect(v.before).toEqual({ gu: "중구", dong: "운남동", bjd_code: "2811014600" });
  });

  it("dong 은 행정동(H) 우선 — H 가 없으면 법정동(B)", () => {
    const v = buildIncheonUpdate(apt({ gu: "중구" }), docs({}, null));
    expect(v.updates?.dong).toBe("운남동");
  });

  it("법정동(B) 문서가 없으면 skip:noLegal", () => {
    const v = buildIncheonUpdate(apt({ gu: "중구" }), { legal: null, admin: docs().admin });
    expect(v).toEqual({ action: "skip", reason: "noLegal" });
  });

  it("좌표가 인천 밖이면 skip:outOfRegion — 시도 이름", () => {
    const v = buildIncheonUpdate(
      apt({ gu: "중구" }),
      docs({ region_1depth_name: "경기도", region_2depth_name: "김포시", code: "4157010100" },
        { region_1depth_name: "경기도", region_2depth_name: "김포시" }),
    );
    expect(v).toEqual({ action: "skip", reason: "outOfRegion" });
  });

  it("시도 이름이 인천이어도 법정동코드 접두가 28 이 아니면 skip:outOfRegion", () => {
    const v = buildIncheonUpdate(apt({ gu: "중구" }), docs({ code: "4157010100" }));
    expect(v).toEqual({ action: "skip", reason: "outOfRegion" });
  });

  it("표에 없는 gu 는 skip:unknownGu", () => {
    const v = buildIncheonUpdate(
      apt({ gu: "중구" }),
      docs({ region_2depth_name: "없는구" }, { region_2depth_name: "없는구" }),
    );
    expect(v).toEqual({ action: "skip", reason: "unknownGu" });
  });

  it("은퇴 gu 를 다시 주면 skip:unknownGu — 표에 남아 있어도 채택하지 않는다", () => {
    const v = buildIncheonUpdate(
      apt({ gu: "중구" }),
      docs({ region_2depth_name: "중구" }, { region_2depth_name: "중구" }),
    );
    expect(v).toEqual({ action: "skip", reason: "unknownGu" });
  });

  it("셋 다 같으면 unchanged — 다시 돌려도 쓰기 0", () => {
    const v = buildIncheonUpdate(
      apt({ gu: "영종구", dong: "영종동", bjd_code: "2815510200" }),
      docs(),
    );
    expect(v).toEqual({ action: "unchanged" });
  });
});

// ── (B-2) --ids 게이트 ────────────────────────────────────────
describe("buildIdsUpdate — 지역 일치 게이트", () => {
  it("전남광주통합특별시 + 남구 → 광주 통과", () => {
    const v = buildIdsUpdate(
      apt({ id: "ah-1", region: "광주", gu: "남구", bjd_code: "4413310800", dong: null }),
      docs(
        { region_1depth_name: "전남광주통합특별시", region_2depth_name: "남구", region_3depth_name: "지석동", code: "1227012000" },
        { region_1depth_name: "전남광주통합특별시", region_2depth_name: "남구", region_3depth_name: "대촌동" },
      ),
    );
    expect(v.action).toBe("update");
    expect(v.updates?.bjd_code).toBe("1227012000");
    expect(v.updates?.dong).toBe("대촌동");
    expect(v.updates?.gu).toBeUndefined(); // gu 는 이미 맞다
  });

  it("좌표가 다른 시도(서울)면 skip:outOfRegion — 맞는 값을 틀린 값으로 덮지 않는다", () => {
    const v = buildIdsUpdate(
      apt({ id: "ah-2", region: "광주", gu: "남구" }),
      docs(
        { region_1depth_name: "서울특별시", region_2depth_name: "중구", region_3depth_name: "명동", code: "1114010300" },
        { region_1depth_name: "서울특별시", region_2depth_name: "중구", region_3depth_name: "명동" },
      ),
    );
    expect(v).toEqual({ action: "skip", reason: "outOfRegion" });
  });

  it("화성특례시 → 화성시 — gu 표기 오염도 곁다리로 고친다", () => {
    const v = buildIdsUpdate(
      apt({ id: "ah-3", region: "경기", gu: "화성특례시", bjd_code: null }),
      docs(
        { region_1depth_name: "경기도", region_2depth_name: "화성시", region_3depth_name: "봉담읍", code: "4159325024" },
        { region_1depth_name: "경기도", region_2depth_name: "화성시 효행구", region_3depth_name: "봉담읍" },
      ),
    );
    expect(v.action).toBe("update");
    expect(v.updates?.gu).toBe("화성시");
    expect(v.updates?.bjd_code).toBe("4159325024");
    expect(v.before?.gu).toBe("화성특례시");
  });

  it("법정동코드가 10자리가 아니면 skip:badCode", () => {
    const v = buildIdsUpdate(
      apt({ id: "ah-4", region: "경기", gu: "화성시" }),
      docs({ region_1depth_name: "경기도", region_2depth_name: "화성시", code: "41593" },
        { region_1depth_name: "경기도", region_2depth_name: "화성시" }),
    );
    expect(v).toEqual({ action: "skip", reason: "badCode" });
  });

  it("시도를 못 가르면(시군구 토큰이 명단에 없음) skip", () => {
    const v = buildIdsUpdate(
      apt({ id: "ah-5", region: "전남", gu: "순천시" }),
      docs({ region_1depth_name: "전남광주통합특별시", region_2depth_name: "A4블록", code: "1215032028" },
        { region_1depth_name: "전남광주통합특별시", region_2depth_name: "A4블록" }),
    );
    expect(v).toEqual({ action: "skip", reason: "outOfRegion" });
  });
});

// ── (C) 화성 ──────────────────────────────────────────────────
describe("planHwaseongGu — 화성 한정", () => {
  it("화성특례시·화성시 N구 5곳을 화성시로", () => {
    const rows = planHwaseongGu([
      apt({ id: "h1", region: "경기", gu: "화성특례시" }),
      apt({ id: "h2", region: "경기", gu: "화성특례시" }),
      apt({ id: "h3", region: "경기", gu: "화성시 동탄구" }),
      apt({ id: "h4", region: "경기", gu: "화성시 동탄구" }),
      apt({ id: "h5", region: "경기", gu: "화성시 동탄구" }),
    ]);
    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((r) => r.to))).toEqual(new Set(["화성시"]));
    expect(rows.map((r) => r.id)).toEqual(["h1", "h2", "h3", "h4", "h5"]);
  });

  it("bare 비법정구(동탄구)도 대상", () => {
    const rows = planHwaseongGu([apt({ id: "h6", region: "경기", gu: "동탄구" })]);
    expect(rows).toEqual([{ id: "h6", from: "동탄구", to: "화성시" }]);
  });

  it("이미 '화성시' 면 대상 아님 — 멱등", () => {
    expect(planHwaseongGu([apt({ id: "h7", region: "경기", gu: "화성시" })])).toEqual([]);
  });

  it("⚠️ 권선구는 대상 아님 — 필터를 normalizeGu!==gu 전체로 넓히면 경기 130행이 딸려온다", () => {
    const rows = planHwaseongGu([
      apt({ id: "k1", region: "경기", gu: "권선구" }),
      apt({ id: "k2", region: "경기", gu: "오정구" }),
      apt({ id: "k3", region: "경기", gu: "처인구" }),
      apt({ id: "k4", region: "경기", gu: "덕양구" }),
    ]);
    expect(rows).toEqual([]);
  });

  it("다른 지역의 같은 이름은 대상 아님", () => {
    expect(planHwaseongGu([apt({ id: "k5", region: "인천", gu: "동탄구" })])).toEqual([]);
  });
});

// ── (D) 전 지역 정규화 (옵트인) ───────────────────────────────
describe("planNormalizeGu — 목록만", () => {
  it("정규화가 바꿀 행을 전부 모은다", () => {
    const rows = planNormalizeGu([
      apt({ id: "n1", region: "경기", gu: "권선구" }),
      apt({ id: "n2", region: "경기", gu: "화성특례시" }),
      apt({ id: "n3", region: "서울", gu: "강남구" }), // 안 바뀜
    ]);
    expect(rows).toEqual([
      { id: "n1", region: "경기", from: "권선구", to: "수원시 권선구" },
      { id: "n2", region: "경기", from: "화성특례시", to: "화성시" },
    ]);
  });

  it("gu 나 region 이 비면 건드리지 않는다", () => {
    expect(planNormalizeGu([apt({ id: "n4", gu: null }), apt({ id: "n5", region: null, gu: "중구" })]))
      .toEqual([]);
  });
});

// ── (E) trades ────────────────────────────────────────────────
describe("tradeTwinKey — null 은 빈 문자열로 접는다", () => {
  it("jeonse 의 apt_name null 은 옛 행·새 행 둘 다 null 이라 키가 맞는다", () => {
    const a = trade({ id: 1, gu: "서구", trade_type: "jeonse", apt_name: null });
    const b = trade({ id: 2, gu: "검단구", trade_type: "jeonse", apt_name: null });
    expect(tradeTwinKey(a)).toBe(tradeTwinKey(b));
    expect(tradeTwinKey(a)).toBe("당하동|202605|84.9|50000|10|jeonse|");
  });

  it("region·gu 는 키에 안 들어간다 (그게 갈린 축이다)", () => {
    expect(tradeTwinKey(trade({ gu: "서구" }))).toBe(tradeTwinKey(trade({ gu: "검단구" })));
  });

  it("dong·층·가격이 다르면 다른 키", () => {
    expect(tradeTwinKey(trade({ floor: 10 }))).not.toBe(tradeTwinKey(trade({ floor: 11 })));
    expect(tradeTwinKey(trade({ dong: "당하동" }))).not.toBe(tradeTwinKey(trade({ dong: "원당동" })));
  });
});

describe("inTradeWindow — 창 경계 (절대 월 리터럴)", () => {
  it("창은 202509~202608", () => {
    expect(TRADE_WINDOW_FROM).toBe("202509");
    expect(TRADE_WINDOW_TO).toBe("202608");
  });

  it("하한 202509 는 포함 · 202508 은 제외", () => {
    expect(inTradeWindow("202509")).toBe(true);
    expect(inTradeWindow("202508")).toBe(false);
  });

  it("상한 202608 은 포함 · 202609 는 제외", () => {
    expect(inTradeWindow("202608")).toBe(true);
    expect(inTradeWindow("202609")).toBe(false);
  });

  it("빈 값은 창 밖", () => {
    expect(inTradeWindow(null)).toBe(false);
    expect(inTradeWindow("")).toBe(false);
  });

  it("filterTradeRows 가 창과 타입을 함께 건다", () => {
    const rows = [
      trade({ id: 1, deal_month: "202508" }),
      trade({ id: 2, deal_month: "202509" }),
      trade({ id: 3, deal_month: "202601", trade_type: "presale" }),
    ];
    expect(filterTradeRows(rows).map((r) => r.id)).toEqual([2, 3]);
    expect(filterTradeRows(rows, ["sale"]).map((r) => r.id)).toEqual([2]);
  });
});

describe("computeTwinRatio — 삭제 fail-close", () => {
  /** @param {number} n @param {Record<string, unknown>} [o] */
  const many = (n, o = {}) =>
    Array.from({ length: n }, (_, i) => trade({ id: i + 1, floor: i + 1, ...o }));

  it("전부 쌍둥이면 통과 · 삭제 대상은 옛 행 id", () => {
    const olds = many(10, { gu: "서구" });
    const news = many(10, { gu: "검단구" }).map((r, i) => ({ ...r, id: 100 + i }));
    const d = computeTwinRatio(olds, news);
    expect(d.ratio).toBe(1);
    expect(d.passes).toBe(true);
    expect(d.twinIds).toHaveLength(10);
  });

  it("⚠️ 0.98 은 통과하면 안 된다 — 임계 0.99 를 0.97 로 내리면 이 줄이 무너진다", () => {
    const olds = many(50, { gu: "서구" });
    const news = many(49, { gu: "검단구" }).map((r, i) => ({ ...r, id: 100 + i }));
    const d = computeTwinRatio(olds, news);
    expect(d.twins).toBe(49);
    expect(d.ratio).toBeCloseTo(0.98, 6);
    expect(d.passes).toBe(false);
    expect(TWIN_RATIO_MIN).toBe(0.99);
  });

  it("쌍둥이 없는 행 표본을 최대 20건 돌려준다 (사람이 눈으로 본다)", () => {
    const olds = many(30, { gu: "서구" });
    const d = computeTwinRatio(olds, []);
    expect(d.passes).toBe(false);
    expect(d.nonTwinSamples).toHaveLength(20);
  });

  it("옛 행이 0이면 통과하지 않는다 — 0/0 을 성공으로 읽지 않는다", () => {
    const d = computeTwinRatio([], many(5, { gu: "검단구" }));
    expect(d.total).toBe(0);
    expect(d.ratio).toBe(0);
    expect(d.passes).toBe(false);
  });

  it("presale 이 안 받아진 상황 재현 — 494/13758 이 비쌍둥이면 fail-close", () => {
    const olds = [...many(1000, { gu: "서구" })];
    const news = many(964, { gu: "검단구" }).map((r, i) => ({ ...r, id: 5000 + i }));
    const d = computeTwinRatio(olds, news);
    expect(d.ratio).toBeCloseTo(0.964, 3);
    expect(d.passes).toBe(false);
  });
});

// ── 되읽기 ────────────────────────────────────────────────────
describe("verifyApplied / verifyResiduals", () => {
  it("쓴 값과 다르면 그 id 를 돌려준다", () => {
    const applied = [{ id: "a", updates: { gu: "검단구", bjd_code: "2829010400" } }];
    expect(verifyApplied([apt({ id: "a", gu: "검단구", bjd_code: "2829010400" })], applied)).toEqual([]);
    expect(verifyApplied([apt({ id: "a", gu: "서구", bjd_code: "2829010400" })], applied)).toEqual(["a"]);
  });

  it("되읽기에 행 자체가 없으면 불일치", () => {
    expect(verifyApplied([], [{ id: "a", updates: { gu: "검단구" } }])).toEqual(["a"]);
  });

  it("⚠️ count 가 null 이면 실패 — 0 으로 읽지 않는다", () => {
    expect(verifyResiduals({ leftCount: null, checkCount: true, applied: true })).toHaveLength(1);
    expect(verifyResiduals({ leftCount: undefined, checkCount: true, applied: true })).toHaveLength(1);
    expect(verifyResiduals({ leftCount: 0, checkCount: true, applied: true })).toEqual([]);
  });

  it("잔여가 남으면 실패", () => {
    expect(verifyResiduals({ leftCount: 3, checkCount: true, applied: true })).toHaveLength(1);
    // --types= 로 좁혀 돌렸으면 다른 타입이 남는 게 정상
    expect(verifyResiduals({ leftCount: 3, checkCount: true, applied: false })).toEqual([]);
  });

  it("불일치가 없으면 통과", () => {
    expect(verifyResiduals({ mismatched: [] })).toEqual([]);
    expect(verifyResiduals({ mismatched: ["a"] })).toHaveLength(1);
  });
});

describe("chunkIds", () => {
  it("기본 청크 150", () => {
    expect(ID_CHUNK).toBe(150);
    expect(chunkIds(Array.from({ length: 301 }, (_, i) => i)).map((c) => c.length)).toEqual([150, 150, 1]);
  });
  it("size 가 0 이하면 무한루프 대신 즉시 실패", () => {
    expect(() => chunkIds([1, 2], 0)).toThrow();
  });
});

// ── 인자 ──────────────────────────────────────────────────────
describe("parseArgs — 모드는 배타적", () => {
  it("기본은 incheon", () => {
    expect(parseArgs([])).toMatchObject({ mode: "incheon", apply: false, error: null });
  });

  it("모드 두 개는 거부", () => {
    expect(parseArgs(["--hwaseong", "--trades-cleanup"]).error).toMatch(/모드는 하나씩만/);
  });

  it("모르는 인자는 거부", () => {
    expect(parseArgs(["--force"]).error).toMatch(/모르는 인자/);
  });

  it("--out= 은 값이 있어야 한다", () => {
    expect(parseArgs(["--out="]).error).toMatch(/--out=/);
  });

  it("--ids= 는 쉼표로 갈라 받는다", () => {
    expect(parseArgs(["--ids=a, b ,c"])).toMatchObject({ mode: "ids", ids: ["a", "b", "c"] });
    expect(parseArgs(["--ids="]).error).toMatch(/--ids=/);
  });

  it("--types= 는 trades-cleanup 전용 + 값 검증", () => {
    expect(parseArgs(["--trades-cleanup", "--types=sale,jeonse"]).types).toEqual(["sale", "jeonse"]);
    expect(parseArgs(["--trades-cleanup", "--types=lease"]).error).toMatch(/--types=/);
    expect(parseArgs(["--types=sale"]).error).toMatch(/trades-cleanup/);
  });

  it("⚠️ --normalize-gu --apply 는 --i-reviewed-the-list 없이는 못 쓴다", () => {
    expect(parseArgs(["--normalize-gu", "--apply"]).error).toMatch(/i-reviewed-the-list/);
    expect(parseArgs(["--normalize-gu", "--apply", "--i-reviewed-the-list"]).error).toBeNull();
    expect(parseArgs(["--normalize-gu"]).error).toBeNull(); // dry-run 은 그냥 된다
  });
});

// ── 배선 가드 ─────────────────────────────────────────────────
/**
 * 주석을 **줄 수를 보존한 채** 지운다. 한 방 정규식은 Accept 헤더의 별-슬래시-별을 주석 시작으로
 * 오인해 코드를 통째로 먹는다 — 그러면 아래 가드는 무엇을 넣어도 통과한다(세션531 실사고).
 * @param {string} src
 * @returns {string}
 */
function stripComments(src) {
  const blank = (/** @type {string} */ m) => m.replace(/[^\n]/g, " ");
  return src
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, blank)
    .replace(/(?<!\*)\/\*[\s\S]*?\*\//g, blank)
    .replace(/^[ \t]*\/\/[^\n]*/gm, blank);
}

/** @param {string} rel */
const readSrc = (rel) => stripComments(readFileSync(new URL(rel, import.meta.url), "utf8"));

describe("배선 — reverse-geocode 의 normalizeGu 재대입 위치", () => {
  const src = readSrc("./collectors/reverse-geocode.mjs");

  it("gu 재대입이 소스에 있다 (줄머리 고정 — 선언부·주석에 안 걸린다)", () => {
    expect(src).toMatch(/^\s*gu = normalizeGu\(region, gu\)/m);
  });

  it("⚠️ 재대입은 VALID_REGIONS 검사 **뒤** · updates 조립 **앞** 이어야 한다", () => {
    const iValid = src.indexOf("VALID_REGIONS.includes(region)");
    const iNorm = src.search(/^\s*gu = normalizeGu\(region, gu\)/m);
    const iUpdates = src.indexOf("const updates = {");
    expect(iValid).toBeGreaterThan(-1);
    expect(iNorm).toBeGreaterThan(-1);
    expect(iUpdates).toBeGreaterThan(-1);
    // 앞으로 옮기면 region 이 아직 카카오 원문("경기도")이라 별칭표 키가 안 맞고,
    // normalizeRegion(region, gu) 이 gu 를 인자로 받으므로 지역 판정까지 달라진다.
    expect(iNorm).toBeGreaterThan(iValid);
    expect(iNorm).toBeLessThan(iUpdates);
  });

  it("normalizeGu 를 실제로 import 한다", () => {
    expect(src).toMatch(/import\s*\{[^}]*\bnormalizeGu\b[^}]*\}\s*from\s*"\.\/_shared\.mjs"/);
  });
});

describe("배선 — naver-presale 의 buildNewApartment", () => {
  const src = readSrc("./collectors/naver-presale.mjs");
  const start = src.indexOf("export function buildNewApartment(");
  const body = src.slice(start, src.indexOf("\n}", start));

  it("buildNewApartment 안에서 gu 를 정규화한다", () => {
    expect(start).toBeGreaterThan(-1);
    expect(body).toMatch(/gu:\s*normalizeGu\(finalRegion/);
  });

  it("region 폴백을 적용한 뒤의 값을 넘긴다 (별칭표 키가 17지역 약칭이라)", () => {
    expect(body).toMatch(/const finalRegion = region \?\? regionFallback;/);
    expect(body).toMatch(/region:\s*finalRegion,/);
  });
});

describe("배선 — 이 도구 자신", () => {
  const src = readSrc("./remap-incheon-2026.mjs");

  it("⚠️ 쓰기(.update/.delete)는 전부 dry-run 조기 반환 **뒤**에 있다", () => {
    const iGuard = src.indexOf("if (!apply) {");
    expect(iGuard).toBeGreaterThan(-1);
    const writes = [...src.matchAll(/\.(update|delete)\(/g)];
    expect(writes.length).toBeGreaterThan(0);
    for (const m of writes) expect(m.index).toBeGreaterThan(iGuard);
  });

  it("⚠️ selectAll 호출은 전부 고유키 커서 — 무정렬 OFFSET 은 큰 표에서 행이 샌다", () => {
    const calls = [...src.matchAll(/selectAll\(/g)];
    expect(calls.length).toBeGreaterThan(0);
    // 검사값은 **인자 자리 리터럴 조각**으로 고정한다 — 근처 옵션 줄에 매칭되는 toContain 은
    // select 에서 키를 빼도 초록불을 준다(세션535 M4).
    expect(src.match(/sb,\s*"id"\s*,?\s*\)/g)?.length ?? 0).toBe(calls.length);
  });

  it("⚠️ trades 조회 select 에 커서 키와 쌍둥이 키 컬럼이 전부 들어 있다", () => {
    const m = src.match(/const TRADE_COLUMNS = "([^"]+)"/);
    const cols = (m?.[1] ?? "").split(",").map((s) => s.trim());
    for (const c of ["id", "dong", "deal_month", "area", "price", "floor", "trade_type", "apt_name"]) {
      expect(cols, `TRADE_COLUMNS 에 ${c} 가 없다`).toContain(c);
    }
  });

  it("⚠️ 은퇴 명단을 복사하지 않고 _shared 의 RETIRED_GU 에서 가져온다", () => {
    expect(src).toMatch(/RETIRED_GU\[REGION\]/);
    // 표를 리터럴로 복사하면 한쪽만 고쳐져 어긋난다.
    expect(src).not.toMatch(/new Set\(\["중구",\s*"동구",\s*"서구"\]\)/);
  });
});
