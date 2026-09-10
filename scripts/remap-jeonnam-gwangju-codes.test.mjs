// @ts-check
/**
 * remap-jeonnam-gwangju-codes.mjs 순수 함수 테스트 (세션545 PR-E §3).
 *
 * 이 도구는 **DB 를 지운다**(항목 d). 그래서 "무엇을 지울지" 를 정하는 판정과,
 * "지워도 되는가" 를 정하는 fail-close 임계 둘 다 가드가 필요하다.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("./collectors/_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return { ...orig, loadEnv: vi.fn(), getSupabase: vi.fn() };
});

const {
  planBjdRemap, planRegionSplit, planGyeonggiGwangju, planGuFix,
  tradeTwinKey, computeTwinRatio, chunkIds, verifyResiduals,
  TWIN_RATIO_MIN, TARGET_REGIONS, MERGED_SIDO_NAME, GU_FIX_IDS, ID_CHUNK,
} = await import("./remap-jeonnam-gwangju-codes.mjs");

/** @param {Record<string, unknown>} o */
const apt = (o) => ({ id: "x", region: null, gu: null, address: null, bjd_code: null, ...o });
/** @param {Record<string, unknown>} o */
const trade = (o) => ({
  id: 1, region: "광주", gu: "광주시", deal_month: "202601",
  area: 84.9, price: 50000, floor: 10, trade_type: "sale", ...o,
});

// ── (a) bjd_code ──────────────────────────────────────────────
describe("planBjdRemap (a)", () => {
  it("앞5만 갈아끼우고 뒷자리는 그대로 둔다", () => {
    const { updates } = planBjdRemap([
      apt({ id: "ap-1", region: "전남", bjd_code: "4615011000" }),
    ]);
    expect(updates).toEqual([{ id: "ap-1", from: "4615011000", to: "1215011000" }]);
  });

  it("광주 5구도 옮긴다", () => {
    const { updates } = planBjdRemap([apt({ id: "ap-2", region: "광주", bjd_code: "2917010900" })]);
    expect(updates[0].to).toBe("1230010900");
  });

  it("통합 이름으로 박힌 region 도 대상", () => {
    expect(TARGET_REGIONS.has(MERGED_SIDO_NAME)).toBe(true);
    const { updates } = planBjdRemap([
      apt({ id: "ap-3", region: MERGED_SIDO_NAME, bjd_code: "4623025000" }), // 광양시 46230 → 12190
    ]);
    expect(updates[0].to).toBe("1219025000");
  });

  it("다른 지역 행은 앞5가 표에 있어도 건드리지 않는다", () => {
    const { updates, manual } = planBjdRemap([
      apt({ id: "ap-4", region: "경기", bjd_code: "4615011000" }),
    ]);
    expect(updates).toEqual([]);
    expect(manual).toEqual([]);
  });

  it("이미 새 코드(12…)면 건너뛴다 — 멱등", () => {
    const rows = [apt({ id: "ap-5", region: "전남", bjd_code: "1215011000" })];
    expect(planBjdRemap(rows).updates).toEqual([]);
  });

  it("표에 없는 앞5 는 수동 refit 대상으로 **분리 보고**하고 손대지 않는다", () => {
    const { updates, manual } = planBjdRemap([
      apt({ id: "ah-2026910076", region: "전남", bjd_code: "4413011000" }),
    ]);
    expect(updates).toEqual([]);
    expect(manual).toEqual([{ id: "ah-2026910076", bjd_code: "4413011000", region: "전남" }]);
  });

  it("★ (c) 가 경기로 되돌릴 행은 '수동 refit' 으로 세지 않는다 — 그 41610… 은 이미 맞는 값", () => {
    // 라이브 실측: 이 제외가 없으면 manual 이 3 → 8 로 부풀어 가짜 refit 대상 5곳이 보고된다.
    const rows = [
      apt({ id: "ap-6025476", region: "광주", gu: "광주시", address: "경기도 광주시 양벌동", bjd_code: "4161025300" }),
      apt({ id: "ah-2026910076", region: "광주", gu: "북구", address: "광주 북구", bjd_code: "4413310800" }),
    ];
    const { updates, manual } = planBjdRemap(rows);
    expect(updates).toEqual([]);
    expect(manual.map((m) => m.id)).toEqual(["ah-2026910076"]);
  });

  it("bjd_code 가 없거나 5자리 미만이면 조용히 건너뛴다", () => {
    const r = planBjdRemap([
      apt({ id: "a", region: "전남", bjd_code: null }),
      apt({ id: "b", region: "전남", bjd_code: "461" }),
    ]);
    expect(r.updates).toEqual([]);
    expect(r.manual).toEqual([]);
  });
});

// ── (b) region 분할 ───────────────────────────────────────────
describe("planRegionSplit (b)", () => {
  it("gu 로 광주/전남을 가른다", () => {
    const { updates } = planRegionSplit([
      apt({ id: "a", region: MERGED_SIDO_NAME, gu: "광양시" }),
      apt({ id: "b", region: MERGED_SIDO_NAME, gu: "북구" }),
    ]);
    expect(updates).toEqual([
      { id: "a", gu: "광양시", to: "전남" },
      { id: "b", gu: "북구", to: "광주" },
    ]);
  });

  it("gu 가 없으면 **쓰지 않고** skip 으로 보고한다", () => {
    const { updates, skipped } = planRegionSplit([apt({ id: "c", region: MERGED_SIDO_NAME, gu: null })]);
    expect(updates).toEqual([]);
    expect(skipped).toEqual([{ id: "c", gu: null }]);
  });

  // ⚠️ gu 가 **있는데 시군구가 아닌** 경우(지구·블록)도 skip 이어야 한다. 분할 헬퍼가
  //    else 폴백이던 시절엔 이런 행이 조용히 "전남" 으로 쓰였다 — 사람이 봐야 하는 행이다.
  it("gu 가 시군구가 아니면(지구·블록) 쓰지 않고 skip", () => {
    const { updates, skipped } = planRegionSplit([
      apt({ id: "d", region: MERGED_SIDO_NAME, gu: "첨단3지구" }),
    ]);
    expect(updates).toEqual([]);
    expect(skipped).toEqual([{ id: "d", gu: "첨단3지구" }]);
  });

  it("이미 갈린 region 은 대상 아님", () => {
    expect(planRegionSplit([apt({ id: "d", region: "전남", gu: "순천시" })]).updates).toEqual([]);
  });
});

// ── (c) 경기 광주시 오라벨 ────────────────────────────────────
describe("planGyeonggiGwangju (c)", () => {
  it("region=광주 ∧ gu=광주시 ∧ 주소가 경기도로 시작 → 대상", () => {
    const out = planGyeonggiGwangju([
      apt({ id: "ap-6025476", region: "광주", gu: "광주시", address: "경기도 광주시 양벌동 1" }),
    ]);
    expect(out.map((o) => o.id)).toEqual(["ap-6025476"]);
  });

  it("주소가 경기도로 시작하지 않으면 **손대지 않는다** — 못 믿는 행은 건너뛴다", () => {
    expect(
      planGyeonggiGwangju([
        apt({ id: "x", region: "광주", gu: "광주시", address: "광주광역시 서구 1" }),
        apt({ id: "y", region: "광주", gu: "광주시", address: null }),
      ]),
    ).toEqual([]);
  });

  it("gu 가 광주시가 아니면 대상 아님 (진짜 광주광역시 단지 보호)", () => {
    expect(
      planGyeonggiGwangju([apt({ id: "z", region: "광주", gu: "북구", address: "경기도 광주시 1" })]),
    ).toEqual([]);
  });
});

// ── (e) gu 지구이름 ───────────────────────────────────────────
describe("planGuFix (e)", () => {
  it("id 를 못 박아 그 한 곳만 고른다 — 같은 지구의 이웃(190)은 건드리지 않는다", () => {
    // ⚠️ 190(A8블록)은 **의도적으로 빠져 있다** — 주소가 "장성군 진원면"(전남)이라
    //    광주/북구로 덮으면 맞는 값을 틀린 값으로 바꾼다(2차 리뷰 중 실측). 다시 넣지 말 것.
    expect(GU_FIX_IDS).toEqual(["ah-2026910189"]);
    expect(GU_FIX_IDS).not.toContain("ah-2026910190");
    const out = planGuFix([
      apt({ id: "ah-2026910189", region: "광주", gu: "첨단3지구" }),
      // 라이브와 같은 꼴: 같은 지구·같은 gu 쓰레기값이지만 region 은 이미 전남(=맞는 값)
      apt({ id: "ah-2026910190", region: "전남", gu: "첨단3지구" }),
      apt({ id: "ah-9999999999", region: "광주", gu: "첨단3지구" }),
    ]);
    expect(out.map((o) => o.id)).toEqual(["ah-2026910189"]);
  });
});

// ── (d) trades 쌍둥이 ─────────────────────────────────────────
describe("computeTwinRatio (d) — 삭제 fail-close", () => {
  it("고유키에서 region·gu 만 뺀 것이 쌍둥이 열쇠다", () => {
    expect(tradeTwinKey(trade({ region: "광주", gu: "광주시" })))
      .toBe(tradeTwinKey(trade({ region: "경기", gu: "광주시" })));
  });

  it("한 항목이라도 다르면 다른 거래", () => {
    expect(tradeTwinKey(trade({ price: 1 }))).not.toBe(tradeTwinKey(trade({ price: 2 })));
    expect(tradeTwinKey(trade({ floor: 1 }))).not.toBe(tradeTwinKey(trade({ floor: 2 })));
    expect(tradeTwinKey(trade({ trade_type: "sale" }))).not.toBe(tradeTwinKey(trade({ trade_type: "jeonse" })));
  });

  it("전부 쌍둥이가 있으면 ratio 1 · 통과", () => {
    const targets = [trade({ id: 1 }), trade({ id: 2, price: 60000 })];
    const gyeonggi = targets.map((t) => ({ ...t, region: "경기", id: t.id + 100 }));
    const r = computeTwinRatio(targets, gyeonggi);
    expect(r).toMatchObject({ total: 2, twins: 2, ratio: 1, passes: true });
    expect(r.missing).toEqual([]);
  });

  it("★ 임계 미만이면 passes=false — 지우려는 근거(중복 수집)가 무너진 것이다", () => {
    // 100건 중 98건만 쌍둥이 = 98% < 99%
    const targets = Array.from({ length: 100 }, (_, i) => trade({ id: i, price: 10000 + i }));
    const gyeonggi = targets.slice(0, 98).map((t) => ({ ...t, region: "경기" }));
    const r = computeTwinRatio(targets, gyeonggi);
    expect(r.twins).toBe(98);
    expect(r.ratio).toBeCloseTo(0.98, 5);
    expect(r.ratio).toBeLessThan(TWIN_RATIO_MIN);
    expect(r.passes).toBe(false);
    expect(r.missing).toHaveLength(2);
  });

  it("임계 딱 맞으면 통과 (99/100 = 0.99)", () => {
    const targets = Array.from({ length: 100 }, (_, i) => trade({ id: i, price: 10000 + i }));
    const gyeonggi = targets.slice(0, 99).map((t) => ({ ...t, region: "경기" }));
    const r = computeTwinRatio(targets, gyeonggi);
    expect(r.ratio).toBeCloseTo(0.99, 5);
    expect(r.passes).toBe(true);
  });

  it("경기 쪽이 통째로 비면 passes=false (0/N)", () => {
    const r = computeTwinRatio([trade({ id: 1 })], []);
    expect(r).toMatchObject({ twins: 0, ratio: 0, passes: false });
  });

  it("대상이 0건이면 passes=false — 지울 게 없다", () => {
    expect(computeTwinRatio([], [])).toMatchObject({ total: 0, passes: false });
  });

  it("임계값 자체가 99% 로 박혀 있다", () => {
    expect(TWIN_RATIO_MIN).toBe(0.99);
  });

  // ⚠️ 옛 판본은 `--apply` 에서 `.delete().eq("region","광주").eq("gu","광주시")` 로 조건을
  //    통째로 지웠다. 그러면 **쌍둥이가 없는 행**(경기 쪽에 같은 거래가 없는 = 오라벨된
  //    유일본)까지 사라진다. 삭제 대상과 relabel 대상을 id 로 갈라 둬야 그럴 수 없다.
  it("★ 쌍둥이 있는 id 와 없는 id 를 갈라 돌려준다", () => {
    const targets = [
      trade({ id: 1, price: 10000 }),
      trade({ id: 2, price: 20000 }),
      trade({ id: 3, price: 30000 }), // 경기 쪽에 없음
    ];
    const gyeonggi = [
      { ...trade({ id: 101, price: 10000 }), region: "경기" },
      { ...trade({ id: 102, price: 20000 }), region: "경기" },
    ];
    const r = computeTwinRatio(targets, gyeonggi);
    expect(r.twinIds).toEqual([1, 2]);
    expect(r.nonTwinIds).toEqual([3]);
    // 두 집합은 겹치지 않고 합치면 전체다 — 어느 행도 두 처분을 동시에 받지 않는다.
    expect(r.twinIds.length + r.nonTwinIds.length).toBe(r.total);
    expect(r.twinIds.filter((id) => r.nonTwinIds.includes(id))).toEqual([]);
    expect(r.twinIds).toHaveLength(r.twins);
    expect(r.nonTwinIds).toHaveLength(r.missing.length);
  });

  it("전부 쌍둥이면 nonTwinIds 는 빈 배열 (relabel 대상 0)", () => {
    const targets = [trade({ id: 7 }), trade({ id: 8, price: 60000 })];
    const gyeonggi = targets.map((t) => ({ ...t, region: "경기", id: Number(t.id) + 100 }));
    const r = computeTwinRatio(targets, gyeonggi);
    expect(r.twinIds).toEqual([7, 8]);
    expect(r.nonTwinIds).toEqual([]);
  });
});

// ── chunkIds ──────────────────────────────────────────────────
describe("chunkIds — `.in(\"id\", […])` 청크", () => {
  it("301개는 150 단위로 3덩이 (150·150·1) 이고 순서·전량이 보존된다", () => {
    const ids = Array.from({ length: 301 }, (_, i) => i + 1);
    const chunks = chunkIds(ids);
    expect(chunks).toHaveLength(3);
    expect(chunks.map((c) => c.length)).toEqual([150, 150, 1]);
    expect(chunks.flat()).toEqual(ids); // 유실·중복 0
  });

  it("기본 청크 크기가 150 으로 박혀 있다", () => {
    expect(ID_CHUNK).toBe(150);
    expect(chunkIds(Array.from({ length: 150 }, (_, i) => i))).toHaveLength(1);
    expect(chunkIds(Array.from({ length: 151 }, (_, i) => i))).toHaveLength(2);
  });

  it("빈 목록은 덩이 0 — 빈 `.in()` 을 쏘지 않는다", () => {
    expect(chunkIds([])).toEqual([]);
  });

  it("잘못된 size 는 조용히 넘기지 않고 던진다", () => {
    expect(() => chunkIds([1, 2], 0)).toThrow(/1 이상/);
    expect(() => chunkIds([1, 2], 1.5)).toThrow(/1 이상/);
  });
});

// ── 되읽기 검증 ───────────────────────────────────────────────
//
// ⚠️ `head:true` 조회는 표가 없거나 조회가 어긋나도 `count: null` 을 조용히 돌려준다.
//    옛 판본의 `(leftD ?? 0) > 0` 은 그 null 을 **0(=잔여 없음, 성공)** 으로 뒤집어 읽었다.
describe("verifyResiduals — 되읽기 판정", () => {
  const ok = { leftA: 0, leftB: 0, leftC: 0, leftE: 0, leftD: 0, tradesApplied: true };

  it("전부 0 이면 문제 없음", () => {
    expect(verifyResiduals(ok)).toEqual([]);
  });

  it("★ d 재조회 count 가 null/undefined 면 실패 — 0 으로 읽지 않는다", () => {
    expect(verifyResiduals({ ...ok, leftD: null })).toHaveLength(1);
    expect(verifyResiduals({ ...ok, leftD: undefined })).toHaveLength(1);
    expect(verifyResiduals({ ...ok, leftD: null })[0]).toMatch(/count 가 null/);
    // 쓰기를 건너뛴 경우에도 조회 실패는 실패다
    expect(verifyResiduals({ ...ok, leftD: null, tradesApplied: false })).toHaveLength(1);
  });

  it("★ e 가 되읽기에서 광주/북구가 아니면 실패 (쓰기가 조용히 안 먹은 경우)", () => {
    const problems = verifyResiduals({ ...ok, leftE: 2 });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/e 미반영 2곳/);
  });

  it("a·b·c 잔여도 각각 잡는다", () => {
    expect(verifyResiduals({ ...ok, leftA: 1 })[0]).toMatch(/a 잔여 1/);
    expect(verifyResiduals({ ...ok, leftB: 3 })[0]).toMatch(/b 잔여 3/);
    expect(verifyResiduals({ ...ok, leftC: 5 })[0]).toMatch(/c 잔여 5/);
    expect(verifyResiduals({ leftA: 1, leftB: 1, leftC: 1, leftE: 1, leftD: 1, tradesApplied: true }))
      .toHaveLength(5);
  });

  it("쓰기를 건너뛴(fail-close) 경우 d 잔여는 정상 — 지우지 않았으니 남아 있다", () => {
    expect(verifyResiduals({ ...ok, leftD: 4242, tradesApplied: false })).toEqual([]);
    expect(verifyResiduals({ ...ok, leftD: 4242, tradesApplied: true })[0]).toMatch(/d 잔여 4242/);
  });
});

// ── 배선 가드 ─────────────────────────────────────────────────
//
// ⚠️ (d) 의 처분은 **순수 함수 테스트로는 못 지킨다** — computeTwinRatio 가 id 를 갈라 줘도
//    main() 이 그걸 무시하고 조건 삭제를 쏘면 그만이다(그게 라운드1 의 실제 결함이었다).
//    그래서 쓰기 경로를 소스에서 직접 검사한다.
describe("배선 — (d) 삭제/relabel 은 id 로 갈라 쏜다", () => {
  /** @returns {Promise<string>} 주석을 걷어낸 소스 (줄머리 블록주석 + 줄머리 줄주석) */
  async function loadSrc() {
    const { readFileSync } = await import("node:fs");
    return readFileSync(new URL("./remap-jeonnam-gwangju-codes.mjs", import.meta.url), "utf8")
      .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, " ")
      .replace(/^[ \t]*\/\/.*$/gm, " ");
  }

  it("검사 대상이 주석 제거 후에도 남아 있다 (스트리퍼 자체 점검)", async () => {
    const src = await loadSrc();
    expect(src).toContain("chunkIds");
    expect(src).toContain('.from("trades")');
  });

  it("★ 쌍둥이는 id 청크로 삭제한다", async () => {
    const src = await loadSrc();
    expect(src).toMatch(/for \(const chunk of chunkIds\(d\.twinIds\)\)/);
    expect(src).toMatch(/\.from\("trades"\)\.delete\(\)\.in\("id", chunk\)/);
  });

  it("★ 쌍둥이 없는 행은 지우지 않고 경기로 relabel 한다", async () => {
    const src = await loadSrc();
    expect(src).toMatch(/for \(const chunk of chunkIds\(d\.nonTwinIds\)\)/);
    expect(src).toMatch(/\.from\("trades"\)\.update\(\{ region: "경기" \}\)\.in\("id", chunk\)/);
  });

  it("★ 조건 통삭제(.eq(region).eq(gu) 뒤 delete)가 **없다** — 유일본까지 지우는 경로", async () => {
    const src = await loadSrc();
    // delete() 는 반드시 id 청크와 함께여야 한다. region/gu 조건만으로 지우면 안 된다.
    expect(src).not.toMatch(/\.delete\(\)[\s\S]{0,120}?\.eq\("region"/);
    const deletes = [...src.matchAll(/\.delete\(\)/g)];
    expect(deletes).toHaveLength(1); // 삭제 경로는 하나뿐
  });

  it("★ 되읽기 검증이 verifyResiduals 를 거친다 (`?? 0` 로 null 을 삼키지 않는다)", async () => {
    const src = await loadSrc();
    expect(src).toMatch(/const problems = verifyResiduals\(\{/);
    expect(src).toMatch(/leftE: leftEIds\.length/);
    expect(src).toMatch(/tradesApplied: d\.passes/);
    // (e) 되읽기: region·gu 를 실제로 확인한다
    expect(src).toMatch(/r\.region !== "광주" \|\| r\.gu !== "북구"/);
    // 옛 판정식이 되살아나면 red
    expect(src).not.toMatch(/\(leftD \?\? 0\) > 0/);
  });
});

describe("배선 — selectAll 커서 키", () => {
  it("apartments·trades 조회가 'id' 커서를 쓰고 select 에도 id 가 있다", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./remap-jeonnam-gwangju-codes.mjs", import.meta.url), "utf8");
    // 무키 호출 0 — scripts/_selectall-keycol-coverage.test.mjs 가 전수로도 잡지만,
    // 이 도구는 2,600행+ apartments 와 79만행 trades 를 훑으므로 여기서도 못 박는다.
    const calls = [...src.matchAll(/selectAll\(/g)];
    expect(calls.length).toBeGreaterThanOrEqual(4);
    expect(src).toContain('.select("id, region, gu, address, bjd_code")');
    expect(src).toContain('.select("id, region, gu, deal_month, area, price, floor, trade_type")');
    // 3번째 인자가 "id" 인 호출 수 == selectAll 호출 수 (하나라도 무키면 어긋난다)
    expect(src.match(/sb,\s*"id"/g)?.length ?? 0).toBe(calls.length);
  });
});
