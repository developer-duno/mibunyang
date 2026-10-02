// @ts-check
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  ATTACH_MAX_M,
  normalizeComplexName,
  assignComplexKeys,
  parseComplexExceptions,
  missingExceptionIds,
  findMixedBundles,
  isPresaleOwner,
  pickRepresentativeId,
  pickMaterialId,
  pickBundleUnits,
} from "./_same-complex.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
/** @type {{ exceptions: unknown, rows: Array<{ id: string, name: string, region: string, gu: string | null, lat: number | null, lng: number | null, presale_type: string | null, naver_presale_no: string | null, presale_min_price: number | null, units: number | null, unit_source: string | null }>, expectedKeys: Record<string, string> }} */
const fx = JSON.parse(readFileSync(join(HERE, "_same-complex.fixture.json"), "utf8"));
const EXCEPTIONS_PATH = join(HERE, "..", "..", "docs", "audits", "same-complex-exceptions.json");
// 동작 시험은 표본 안의 **얼린 사본**으로 본다 — 운영 명단을 고칠 때마다 시험이 깨지지 않게(세션589 검사관 C #1).
const FROZEN_EX = parseComplexExceptions(fx.exceptions);

/**
 * 시드 고정 섞기(같은 시드 = 같은 순열). 결정성 시험용.
 * @template T @param {readonly T[]} arr @param {number} seed @returns {T[]}
 */
function seededShuffle(arr, seed) {
  const a = [...arr];
  let s = seed >>> 0;
  const next = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

describe("normalizeComplexName — 이름을 뼈대·블록 토큰·임대 낱말로 가른다", () => {
  it("띄어쓰기만 다른 청약홈·네이버 이름은 같은 뼈대", () => {
    expect(normalizeComplexName("힐스테이트 등촌역").skel).toBe("힐스테이트등촌역");
    expect(normalizeComplexName("힐스테이트등촌역").skel).toBe("힐스테이트등촌역");
  });

  it("괄호 안·밖의 블록 표기는 토큰으로 빠지고 뼈대는 같다", () => {
    const a = normalizeComplexName("래미안 센트리폴(1BL)");
    const b = normalizeComplexName("래미안센트리폴2BL");
    expect(a.skel).toBe("래미안센트리폴");
    expect(b.skel).toBe("래미안센트리폴");
    expect([...a.bl]).toEqual(["1BL"]);
    expect([...b.bl]).toEqual(["2BL"]);
  });

  it("블럭·블록·하이픈 표기를 한 꼴로 — C-4BL → C4BL, 18블록 → 18BL", () => {
    expect([...normalizeComplexName("오포자이 디 오브 C-4BL").bl]).toEqual(["C4BL"]);
    expect([...normalizeComplexName("에코델타시티 푸르지오 센터파크(18블록)").bl]).toEqual(["18BL"]);
    expect([...normalizeComplexName("시흥 롯데캐슬 시그니처(1블럭)").bl]).toEqual(["1BL"]);
  });

  it("로마 숫자는 지우지 않고 숫자로 — 루체Ⅰ 과 루체Ⅱ 는 다른 뼈대", () => {
    expect(normalizeComplexName("시흥거모 루체Ⅰ").skel).toBe("시흥거모루체1");
    expect(normalizeComplexName("시흥거모 루체Ⅱ").skel).toBe("시흥거모루체2");
  });

  it("회차 낱말은 떼고 단지 차수는 남긴다", () => {
    expect(normalizeComplexName("포레나 미아(무순위 7차)").skel).toBe("포레나미아");
    expect(normalizeComplexName("송도자이 더 스타 불법행위재공급").skel).toBe("송도자이더스타");
    expect(normalizeComplexName("금강펜테리움 6차 센트럴파크").skel).toBe("금강펜테리움6차센트럴파크");
  });

  it("끝의 '아파트' 와 괄호 N차를 뗀다", () => {
    expect(normalizeComplexName("세운 푸르지오 헤리시티 아파트 (4차)").skel).toBe("세운푸르지오헤리시티");
  });

  it("(오) 는 오피스텔 표시만 남기고 뼈대는 아파트 행과 같다", () => {
    const a = normalizeComplexName("더샵송도그란테르G5-3블록(오)");
    const b = normalizeComplexName("더샵송도그란테르G5-3블록");
    expect(a.isOfficetel).toBe(true);
    expect(b.isOfficetel).toBe(false);
    expect(a.skel).toBe(b.skel);
  });

  it("임대 낱말은 뼈대에서 빠져 열쇠의 임대 칸으로 간다", () => {
    const n = normalizeComplexName("마곡지구9단지 국민임대");
    expect(n.skel).toBe("마곡지구");
    expect(n.lease).toBe("국민임대");
    expect([...n.dan]).toEqual(["9단지"]);
  });

  it("전각 괄호·SK VIEW·& 표기 차이를 흡수한다", () => {
    expect(normalizeComplexName("위례포레자이（하남）").skel).toBe("위례포레자이");
    expect(normalizeComplexName("송도 Luxe Ocean SK VIEW(10차)").skel).toBe("송도LUXEOCEANSK뷰");
    expect(normalizeComplexName("동탄포레파크자연&푸르지오").skel).toBe("동탄포레파크자연앤푸르지오");
  });

  it("이름이 없으면 던지지 않고 빈 뼈대", () => {
    expect(normalizeComplexName(null).skel).toBe("");
    expect(normalizeComplexName(undefined).skel).toBe("");
  });
});

describe("assignComplexKeys — 시제품 v1 과 같은 답(표본 121행)", () => {
  const keys = assignComplexKeys(fx.rows);
  const same = (/** @type {string} */ a, /** @type {string} */ b) => keys.get(a) === keys.get(b);

  it("표본 전 행의 열쇠가 시제품 열쇠와 글자 그대로 같다", () => {
    expect(fx.rows.length).toBe(121);
    const diff = fx.rows.filter((r) => keys.get(r.id) !== fx.expectedKeys[r.id]).map((r) => `${r.id} ${r.name}: ${keys.get(r.id)} ≠ ${fx.expectedKeys[r.id]}`);
    expect(diff).toEqual([]);
  });

  it.each([
    ["등촌역 청약홈↔네이버", "ah-2025910001", "ap-6027802"],
    ["래미안 1BL 청약홈↔네이버", "ah-2025910188", "ap-6026645"],
    ["검단 AB22 청약홈↔네이버", "ah-2026910215", "ap-6028408"],
    ["세종자이 더 시티 ↔ (산울마을2단지)", "ah-2021910092", "ah-2025910171"],
    ["세종자이 더 시티 ↔ L1블록(산울마을2단지)", "ah-2021910092", "ah-2025930006"],
    ["에코델타 센터파크 ↔ (18BL)", "ah-2025930019", "ah-2026930001"],
    ["송도 하늘채 (M2-3-1,2BL) ↔ 임의공급 2차", "ah-2022910274", "ah-2024910171"],
    ["송도자이 더 스타 ↔ 불법행위재공급", "ah-2022910021", "ah-2025930047"],
    ["그란테르 G5-3BL(오) ↔ G5-3블록", "ap-6028403", "ap-6028448"],
    ["세운 헤리시티 아파트 ↔ 아파트 (3차)", "ah-2021910042", "ah-2024910065"],
    ["창원자이 더 스카이 [창원시]↔[창원시 성산구]", "ah-2026910102", "ap-6028237"],
    ["송도 Luxe Ocean SK VIEW 회차들", "ah-2022910085", "ah-2022910343"],
    ["포레나 미아 ↔ (무순위 7차)", "ah-2022910253", "ah-2023910054"],
    ["고덕 자연앤 하우스디 (국민)(2차) ↔ (민영)", "ah-2025910215", "ah-2025910173"],
    ["힐스테이트 초곡 ↔ (2차)", "ah-2021910063", "ah-2026910032"],
    ["성성자이 레이크파크 1회차 ↔ 2회차", "ap-6027766", "ap-6027959"],
  ])("한 묶음: %s", (_label, a, b) => {
    expect(keys.has(a) && keys.has(b)).toBe(true);
    expect(same(a, b)).toBe(true);
  });

  it.each([
    ["래미안 1BL ↔ 2BL", "ah-2025910188", "ah-2025910189"],
    ["래미안 네이버 1BL ↔ 2BL", "ap-6026645", "ap-6027743"],
    ["세종 리버파크 H3 ↔ H4", "ah-2024910240", "ah-2024910241"],
    ["서수원 에피트 M1 ↔ M2BL", "ah-2025910280", "ah-2025910279"],
    ["시흥 롯데캐슬 1블럭 ↔ 2블럭", "ap-6027058", "ap-6027059"],
    ["용인 경남아너스빌 H2BL 1단지 ↔ 2단지", "ah-2026910003", "ah-2025930027"],
    ["검단 AB22 ↔ AB23", "ap-6028408", "ap-6028499"],
    ["시흥거모 루체Ⅰ ↔ 루체Ⅱ(청약홈)", "ah-2025910268", "ah-2025910269"],
    ["시흥거모 루체Ⅰ ↔ 루체Ⅱ(네이버)", "ap-6028213", "ap-6028215"],
    ["우면2지구 장기전세 ↔ 국민임대", "ap-6001350", "ap-6006900"],
    ["2-1BL 분양 ↔ 2-1BL 민간임대", "ap-6027481", "ap-6028455"],
    ["첨단3지구 A6 청약홈↔네이버(구 칸이 틀린 행 — 행을 고치기 전엔 따로)", "ah-2026910248", "ap-6028551"],
  ])("다른 묶음: %s", (_label, a, b) => {
    expect(keys.has(a) && keys.has(b)).toBe(true);
    expect(same(a, b)).toBe(false);
  });

  it("임대인 행과 아닌 행이 한 묶음에 섞이지 않는다", () => {
    /** @type {Map<string, Set<boolean>>} */
    const byKey = new Map();
    for (const r of fx.rows) {
      const k = /** @type {string} */ (keys.get(r.id));
      if (!byKey.has(k)) byKey.set(k, new Set());
      /** @type {Set<boolean>} */ (byKey.get(k)).add(k.includes("#L1#"));
    }
    expect([...byKey.values()].every((s) => s.size === 1)).toBe(true);
  });
});

describe("assignComplexKeys — 묶음 맥락 규칙(작은 예)", () => {
  const base = { region: "경기", gu: "화성시", presale_type: null };
  const one = { ...base, id: "ah-1", name: "가나다 자이(1BL)", lat: 37.0, lng: 127.0 };
  const two = { ...base, id: "ah-2", name: "가나다 자이(2BL)", lat: 37.01, lng: 127.0 }; // 약 1.1km
  const bareNear = { ...base, id: "ap-3", name: "가나다자이", lat: 37.0005, lng: 127.0 }; // 1BL 에서 약 56m
  const bareFar = { ...base, id: "ap-4", name: "가나다자이", lat: 37.005, lng: 127.0 }; // 두 무리 모두에서 300m 넘음
  const bareNoCoord = { ...base, id: "ap-5", name: "가나다자이", lat: null, lng: null };

  it("블록 무리가 하나뿐이면 토큰 없는 행과 한 묶음(토큰은 열쇠에 안 들어간다)", () => {
    const k = assignComplexKeys([one, bareFar]);
    expect(k.get("ah-1")).toBe(k.get("ap-4"));
    expect(k.get("ah-1")).toBe("가나다자이###L0#경기#화성시");
  });

  it("서로 다른 블록 무리가 둘이면 갈라지고, 토큰 없는 행은 300m 안의 무리에 붙는다", () => {
    const k = assignComplexKeys([one, two, bareNear]);
    expect(k.get("ah-1")).not.toBe(k.get("ah-2"));
    expect(k.get("ap-3")).toBe(k.get("ah-1"));
    expect(k.get("ah-1")).toBe("가나다자이#1BL##L0#경기#화성시");
  });

  it(`어느 무리와도 ${ATTACH_MAX_M}m 넘게 떨어졌거나 좌표가 없으면 그 행만의 카드`, () => {
    const k = assignComplexKeys([one, two, bareFar, bareNoCoord]);
    expect(k.get("ap-4")).toBe("가나다자이#보류:ap-4##L0#경기#화성시");
    expect(k.get("ap-5")).toBe("가나다자이#보류:ap-5##L0#경기#화성시");
  });

  it("시도나 구(첫 낱말)가 다르면 같은 이름이어도 따로", () => {
    const k = assignComplexKeys([
      { ...base, id: "ah-1", name: "가나다 자이", lat: null, lng: null },
      { ...base, id: "ah-2", name: "가나다 자이", gu: "수원시 장안구", lat: null, lng: null },
      { ...base, id: "ah-3", name: "가나다 자이", gu: "화성시 동탄구", lat: null, lng: null },
    ]);
    expect(k.get("ah-1")).not.toBe(k.get("ah-2"));
    expect(k.get("ah-1")).toBe(k.get("ah-3")); // 구 첫 낱말이 같으면 한 묶음(창원시 ↔ 창원시 성산구)
  });

  it("임대 유형 행은 이름이 같아도 분양 행과 따로", () => {
    const k = assignComplexKeys([
      { ...base, id: "ap-1", name: "가나다 자이", lat: null, lng: null },
      { ...base, id: "ap-2", name: "가나다 자이", presale_type: "국민임대", lat: null, lng: null },
    ]);
    expect(k.get("ap-1")).not.toBe(k.get("ap-2"));
  });

  it("이름이 빈 행끼리는 묶지 않는다", () => {
    const k = assignComplexKeys([
      { ...base, id: "ah-1", name: "", lat: null, lng: null },
      { ...base, id: "ah-2", name: null, lat: null, lng: null },
    ]);
    expect(k.get("ah-1")).toBe("#only:ah-1");
    expect(k.get("ah-2")).toBe("#only:ah-2");
  });

  it("빈 목록이면 빈 결과", () => {
    expect(assignComplexKeys([]).size).toBe(0);
  });

  it("토큰 없는 행이 두 무리와 거리가 같으면 입력 순서와 무관하게 '가장 작은 id 를 가진 무리'에 붙는다(세션589 검사관 A #8)", () => {
    const at = { lat: 37.0, lng: 127.0 };
    const b1 = { ...base, ...at, id: "ah-1", name: "가나다 자이(1BL)" };
    const b2 = { ...base, ...at, id: "ah-2", name: "가나다 자이(2BL)" };
    const bare = { ...base, ...at, id: "ap-3", name: "가나다자이" };
    for (const order of [[b1, b2, bare], [b2, b1, bare], [bare, b2, b1]]) {
      expect(assignComplexKeys(order).get("ap-3")).toBe("가나다자이#1BL##L0#경기#화성시");
    }
    // 라벨 글자순이 아니라 id 로 정한다 — 2BL 무리의 id 가 더 작으면 2BL 에 붙는다
    const c1 = { ...b1, id: "ah-9" };
    const c2 = { ...b2, id: "ah-1" };
    for (const order of [[c1, c2, bare], [c2, c1, bare]]) {
      expect(assignComplexKeys(order).get("ap-3")).toBe("가나다자이#2BL##L0#경기#화성시");
    }
  });
});

describe("assignComplexKeys — 입력 순서와 무관하다(표본 121행을 섞어도 열쇠가 같다)", () => {
  it.each([["예외 없음", undefined], ["얼린 예외 사본", "frozen"]])("%s", (_label, mode) => {
    const ex = mode === "frozen" ? FROZEN_EX : undefined;
    const ref = assignComplexKeys(fx.rows, ex);
    for (const seed of [1, 7, 42, 589, 2026, 31337, 99991, 123456789]) {
      const k = assignComplexKeys(seededShuffle(fx.rows, seed), ex);
      const diff = fx.rows.filter((r) => k.get(r.id) !== ref.get(r.id)).map((r) => `${seed} ${r.id}`);
      expect(diff).toEqual([]);
    }
  });
});

describe("예외 명단 — 운영 파일은 모양만 본다", () => {
  it("운영 예외 명단(docs/audits/same-complex-exceptions.json)은 모양 검사를 통과한다 — 내용은 못 박지 않는다(고치는 날 시험이 깨지지 않게)", () => {
    expect(() => parseComplexExceptions(JSON.parse(readFileSync(EXCEPTIONS_PATH, "utf8")))).not.toThrow();
  });
});

describe("예외 명단 — always(묶음) · isolate(떼어 냄) (표본 안의 얼린 사본으로)", () => {
  const ex = FROZEN_EX;

  it("얼린 사본의 모양: 묶음 7쌍 · 떼어 냄 3행", () => {
    expect(ex.always).toHaveLength(7);
    expect(ex.isolate).toEqual(["ap-6025160", "ap-6004117", "ap-6014027"]);
  });

  it("얼린 사본의 id 는 전부 표본에 있다", () => {
    expect(missingExceptionIds(ex, new Set(fx.rows.map((r) => r.id)))).toEqual([]);
  });

  it("always 는 두 id 가 속한 묶음을 통째로 합친다 — 한화 포레나 미아 4행 + 포레나 미아 9행", () => {
    const before = assignComplexKeys(fx.rows);
    const after = assignComplexKeys(fx.rows, ex);
    expect(before.get("ah-2022910158")).not.toBe(before.get("ah-2022910253"));
    const k = after.get("ah-2022910158");
    expect(after.get("ah-2022910253")).toBe(k);
    expect(fx.rows.filter((r) => after.get(r.id) === k)).toHaveLength(13);
  });

  it("isolate 는 그 행만 떼어 낸다 — 마곡지구 장기전세 ↔ 마곡지구9단지 장기전세", () => {
    const before = assignComplexKeys(fx.rows);
    const after = assignComplexKeys(fx.rows, ex);
    expect(before.get("ap-6025160")).toBe(before.get("ap-6020893"));
    expect(after.get("ap-6025160")).not.toBe(after.get("ap-6020893"));
    expect(after.get("ap-6020893")).toBe(before.get("ap-6020893"));
  });

  it("예외를 다 적용하면 표본의 묶음 수가 7 줄고 3 는다", () => {
    const n = (/** @type {Map<string, string>} */ m) => new Set(m.values()).size;
    expect(n(assignComplexKeys(fx.rows, ex)) - n(assignComplexKeys(fx.rows))).toBe(-7 + 3);
  });

  it("명단의 id 가 행 목록에 없어도 던지지 않고, 빠진 id 는 따로 알려 준다", () => {
    const some = fx.rows.slice(0, 5);
    expect(() => assignComplexKeys(some, ex)).not.toThrow();
    expect(missingExceptionIds({ always: [["ah-1", "ap-2"]], isolate: ["ap-3"] }, new Set(["ah-1"]))).toEqual(["ap-2", "ap-3"]);
  });

  it.each([
    ["객체가 아님", null],
    ["배열이 없음", { always: [] }],
    ["쌍이 아님", { always: [{ ids: ["ah-1"] }], isolate: [] }],
    ["같은 id 두 번", { always: [{ ids: ["ah-1", "ah-1"] }], isolate: [] }],
    ["id 꼴이 아님", { always: [], isolate: [{ id: "x-1" }] }],
    ["같은 id 가 always 와 isolate 양쪽에", { always: [{ ids: ["ah-1", "ap-2"] }], isolate: [{ id: "ap-2" }] }],
  ])("모양이 틀린 명단은 던진다: %s", (_label, bad) => {
    expect(() => parseComplexExceptions(bad)).toThrow();
  });

  it("isolate 에 같은 id 가 두 번 있으면 던진다 — 열쇠가 '#only:…#only:…' 로 겹친다(세션589 검사관 A #9)", () => {
    expect(() => parseComplexExceptions({ always: [], isolate: [{ id: "ap-3" }, { id: "ap-4" }, { id: "ap-3" }] })).toThrow(/isolate 에 같은 id 가 두 번.*ap-3/);
  });
});

describe("findMixedBundles — 예외 명단이 임대·분양이나 시도를 섞으면 찾아낸다", () => {
  const ex = FROZEN_EX;

  it("표본 + 얼린 예외 사본으로는 섞인 묶음이 없다", () => {
    expect(findMixedBundles(fx.rows, assignComplexKeys(fx.rows, ex))).toEqual([]);
  });

  it("always 가 분양 행과 임대 행을 묶으면 '임대·분양 섞임'", () => {
    const rows = [
      { id: "ap-1", name: "가나다 자이", region: "경기", gu: "화성시", lat: null, lng: null, presale_type: null },
      { id: "ap-2", name: "가나다 자이 행복주택", region: "경기", gu: "화성시", lat: null, lng: null, presale_type: null },
    ];
    expect(findMixedBundles(rows, assignComplexKeys(rows))).toEqual([]);
    const mixed = findMixedBundles(rows, assignComplexKeys(rows, { always: [["ap-1", "ap-2"]] }));
    expect(mixed).toHaveLength(1);
    expect(mixed[0].why).toBe("임대·분양 섞임");
    expect(mixed[0].ids).toEqual(["ap-1", "ap-2"]);
  });

  it("always 가 다른 시도의 행을 묶으면 '시도 섞임'", () => {
    const rows = [
      { id: "ah-1", name: "가나다 자이", region: "경기", gu: "광주시", lat: null, lng: null, presale_type: null },
      { id: "ah-2", name: "가나다 자이", region: "광주", gu: "북구", lat: null, lng: null, presale_type: null },
    ];
    const mixed = findMixedBundles(rows, assignComplexKeys(rows, { always: [["ah-1", "ah-2"]] }));
    expect(mixed.map((m) => m.why)).toEqual(["시도 섞임"]);
  });
});

describe("대표 행·재료 행·묶음 세대수", () => {
  const ahOld = { id: "ah-2021910063", name: "힐스테이트 초곡", units: 1866, unit_source: "molit" };
  const ahNew = { id: "ah-2026910032", name: "힐스테이트 초곡 (2차)", units: 1866, unit_source: "molit" };
  const owner = { id: "ap-6027802", name: "힐스테이트등촌역", naver_presale_no: "6027802", presale_min_price: 103400, units: 543, unit_source: "naver_presale" };
  const ahWithCopy = { id: "ah-2025910001", name: "힐스테이트 등촌역", naver_presale_no: "6027802", presale_min_price: 103400, units: 417, unit_source: "molit" };
  const off = { id: "ap-6028403", name: "더샵송도그란테르G5-3블록(오)", naver_presale_no: "6028403", presale_min_price: 61700, units: 100, unit_source: "naver_presale" };
  const apt = { id: "ap-6028448", name: "더샵송도그란테르G5-3블록", naver_presale_no: "6028448", presale_min_price: 120300, units: 900, unit_source: "naver_presale" };

  it("번호 주인 = 자기 분양 번호를 쥔 네이버 행뿐", () => {
    expect(isPresaleOwner(owner)).toBe(true);
    expect(isPresaleOwner(ahWithCopy)).toBe(false);
    expect(isPresaleOwner({ id: "ap-1", name: "x", naver_presale_no: "2" })).toBe(false);
    expect(isPresaleOwner({ id: "ap-1", name: "x", naver_presale_no: null })).toBe(false);
    expect(isPresaleOwner({ id: "ap-6027802", name: "x", naver_presale_no: 6027802 })).toBe(true);
  });

  it("대표 = 청약홈 행 중 가장 오래된 공고(D11)", () => {
    expect(pickRepresentativeId([ahNew, ahOld])).toBe("ah-2021910063");
    expect(pickRepresentativeId([owner, ahWithCopy])).toBe("ah-2025910001");
  });

  it("대표 = 청약홈 행이 없으면 네이버 행 중 id 가 가장 작은 것, (오) 는 맨 뒤", () => {
    expect(pickRepresentativeId([apt, off])).toBe("ap-6028448");
    expect(pickRepresentativeId([{ id: "ap-6027959", name: "성성자이 2회차" }, { id: "ap-6027766", name: "성성자이 1회차" }])).toBe("ap-6027766");
    expect(pickRepresentativeId([off])).toBe("ap-6028403");
  });

  it("재료 = 번호 주인 네이버 행이 있으면 그 행(청약홈 행보다 먼저)", () => {
    expect(pickMaterialId([ahWithCopy, owner])).toBe("ap-6027802");
  });

  it("재료 = 번호 주인이 여럿이면 최저가가 낮은 쪽, 같으면 id 작은 쪽", () => {
    const r1 = { id: "ap-6027373", name: "광양 1회차", naver_presale_no: "6027373", presale_min_price: 32100 };
    const r2 = { id: "ap-6027995", name: "광양 2회차", naver_presale_no: "6027995", presale_min_price: 53980 };
    expect(pickMaterialId([r2, r1])).toBe("ap-6027373");
    const s1 = { id: "ap-6027766", name: "성성 1회차", naver_presale_no: "6027766", presale_min_price: 53800 };
    const s2 = { id: "ap-6027959", name: "성성 2회차", naver_presale_no: "6027959", presale_min_price: 53800 };
    expect(pickMaterialId([s2, s1])).toBe("ap-6027766");
    const noPrice = { id: "ap-6020000", name: "값 없음", naver_presale_no: "6020000", presale_min_price: null };
    expect(pickMaterialId([noPrice, r2])).toBe("ap-6027995");
  });

  it("재료 = 번호 주인이 없으면 가장 최근 청약홈 행(지금 화면의 대표와 같다)", () => {
    expect(pickMaterialId([ahOld, ahNew])).toBe("ah-2026910032");
  });

  it("재료 = (오) 행은 아파트 행이 하나라도 있으면 쓰지 않는다", () => {
    expect(pickMaterialId([off, apt])).toBe("ap-6028448");
    expect(pickMaterialId([off])).toBe("ap-6028403");
  });

  it("세대수 = 네이버 분양 > 네이버 단지 표 > 국토부 > 청약홈 > 출처 없음", () => {
    expect(pickBundleUnits([ahWithCopy, owner])).toEqual({ units: 543, source: "naver_presale", fromId: "ap-6027802" });
    expect(pickBundleUnits([
      { id: "ah-1", name: "a", units: 300, unit_source: "applyhome" },
      { id: "ah-2", name: "a", units: 500, unit_source: "molit" },
      { id: "ah-3", name: "a", units: 416, unit_source: "naver" },
    ])).toEqual({ units: 416, source: "naver", fromId: "ah-3" });
    expect(pickBundleUnits([
      { id: "ah-1", name: "a", units: 300, unit_source: null },
      { id: "ah-2", name: "a", units: 90, unit_source: "applyhome" },
    ])).toEqual({ units: 90, source: "applyhome", fromId: "ah-2" });
  });

  it("세대수 = 같은 순위면 큰 값(네이버 회차 행은 합치지 않는다)", () => {
    expect(pickBundleUnits([
      { id: "ap-1", name: "1회차", naver_presale_no: "1", units: 1104, unit_source: "naver_presale" },
      { id: "ap-2", name: "2회차", naver_presale_no: "2", units: 1104, unit_source: "naver_presale" },
    ])).toEqual({ units: 1104, source: "naver_presale", fromId: "ap-1" });
    expect(pickBundleUnits([ahOld, { ...ahNew, units: 1900 }])?.units).toBe(1900);
  });

  it("세대수 = naver_presale 표시가 맨 앞 순위인 것은 번호 주인 행뿐 — 주인 아닌 행의 값은 주인 값에 진다", () => {
    const nonOwner = { id: "ah-2025910257", name: "김해 안동 에피트", naver_presale_no: null, units: 1539, unit_source: "naver_presale" };
    const ownerRow = { id: "ap-6026000", name: "김해안동에피트", naver_presale_no: "6026000", units: 1600, unit_source: "naver_presale" };
    expect(pickBundleUnits([nonOwner, ownerRow])).toEqual({ units: 1600, source: "naver_presale", fromId: "ap-6026000" });
    // 주인이 없으면 주인 아닌 네이버 값이 국토부보다는 앞선다
    expect(pickBundleUnits([nonOwner, { id: "ah-1", name: "a", units: 299, unit_source: "molit" }])?.units).toBe(1539);
    // 네이버 단지 표 값(naver)과는 같은 순위 — 큰 값
    expect(pickBundleUnits([nonOwner, { id: "ah-2", name: "a", units: 1700, unit_source: "naver" }])?.units).toBe(1700);
  });

  it("세대수 = (오) 행과 1 이하는 재료가 아니다. 남는 게 없으면 null", () => {
    expect(pickBundleUnits([off, apt])).toEqual({ units: 900, source: "naver_presale", fromId: "ap-6028448" });
    expect(pickBundleUnits([off])).toBeNull();
    expect(pickBundleUnits([{ id: "ah-1", name: "a", units: 1, unit_source: "applyhome" }, { id: "ah-2", name: "a", units: null }])).toBeNull();
  });
});
