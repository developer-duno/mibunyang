// @ts-check
/**
 * calc-school-walk.mjs 테스트 — 초등학교 도보시간 순수 함수 검증
 *
 * 대상: findNearestElemSchool, calcWalkingMinutes, nearestElemFromKakaoDocs, planWalkUpdates
 *
 * 세션566: 무정렬 페이징 → selectAll 커서 정정 + 1km 안에 초등학교가 없는 단지를 카카오로
 * 재탐색하는 로직 추가. planWalkUpdates 가 "이미 계산 가능(direct)" vs "재탐색 필요
 * (needLookup)" 를 정확히 가르는지가 이 정정의 핵심이라 뮤테이션 대상이다.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";

// _shared.mjs 모킹
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return {
    ...orig,
    loadEnv: vi.fn(),
    getSupabase: vi.fn(),
    log: vi.fn(),
    logError: vi.fn(),
    selectAll: vi.fn(),
    fetchWithRetry: vi.fn(),
    sleep: vi.fn(() => Promise.resolve()),
    createReporter: vi.fn(() => ({
      success: vi.fn(), fail: vi.fn(), skip: vi.fn(), interrupted: vi.fn(() => false),
      summary: vi.fn(() => ({ elapsed: "0.0", ok: 0, fail: 0, skip: 0, total: 0 })),
    })),
  };
});

const {
  findNearestElemSchool,
  calcWalkingMinutes,
  nearestElemFromKakaoDocs,
  planWalkUpdates,
  isSchoolPlace,
  SCHOOL_WALK_BONUS_MIRROR,
  SCHOOL_WALK_FAR_ADJ_MIRROR,
} = await import("./calc-school-walk.mjs");

// 소스를 직접 읽어 두 수집기가 정말 공유 모듈을 쓰는지 확인한다(세션567).
const COLLECTOR_SRC = readFileSync(new URL("./calc-school-walk.mjs", import.meta.url), "utf-8");

// ── findNearestElemSchool ─────────────────────────────────────
describe("findNearestElemSchool", () => {
  it("초등학교 1개 → 해당 거리 반환", () => {
    expect(findNearestElemSchool([{ type: "초", distance: 300 }])).toBe(300);
  });

  it("초등학교 여러 개 → 최소 거리", () => {
    const schools = [
      { type: "초", distance: 500 },
      { type: "초", distance: 200 },
      { type: "초", distance: 800 },
    ];
    expect(findNearestElemSchool(schools)).toBe(200);
  });

  it("초등학교 없음 (중/고만) → null", () => {
    const schools = [
      { type: "중", distance: 300 },
      { type: "고", distance: 500 },
    ];
    expect(findNearestElemSchool(schools)).toBeNull();
  });

  it("빈 배열 → null", () => {
    expect(findNearestElemSchool([])).toBeNull();
  });

  it("null 입력 → null", () => {
    expect(findNearestElemSchool(null)).toBeNull();
  });

  it("distance 0인 초등학교 → 무시", () => {
    const schools = [{ type: "초", distance: 0 }, { type: "초", distance: 400 }];
    expect(findNearestElemSchool(schools)).toBe(400);
  });

  it("중학교/고등학교 섞여도 초등학교만 선택 (type mutation 방지)", () => {
    const schools = [
      { type: "중", distance: 100 },  // 더 가깝지만 무시
      { type: "초", distance: 300 },  // 선택됨
      { type: "고", distance: 50 },   // 더 가깝지만 무시
    ];
    expect(findNearestElemSchool(schools)).toBe(300);
  });

  it("여러 초등학교 중 최소 거리 검증 (Math.min mutation 방지)", () => {
    const schools = [
      { type: "초", distance: 500 },
      { type: "초", distance: 200 },
      { type: "초", distance: 800 },
    ];
    const result = findNearestElemSchool(schools);
    expect(result).toBe(200);
    expect(result).not.toBe(800); // Math.max mutation 감지
  });
});

// ── calcWalkingMinutes ────────────────────────────────────────
describe("calcWalkingMinutes", () => {
  it("350m / 70(m/분) → 5분 (올림)", () => {
    expect(calcWalkingMinutes(350)).toBe(5); // 350/70 = 5.0
  });

  it("400m / 70(m/분) → 6분 (올림)", () => {
    expect(calcWalkingMinutes(400)).toBe(6); // 400/70 = 5.71 → ceil = 6
  });

  it("distance 0 → null", () => {
    expect(calcWalkingMinutes(0)).toBeNull();
  });

  it("distance null → null", () => {
    expect(calcWalkingMinutes(null)).toBeNull();
  });

  it("커스텀 속도 80m/분", () => {
    expect(calcWalkingMinutes(320, 80)).toBe(4); // 320/80 = 4.0
  });

  it("2,000m 초과 거리도 정확히 올림 계산 (16~20분·20분초과 티어가 실제로 나오는지)", () => {
    expect(calcWalkingMinutes(1200)).toBe(18); // 1200/70 = 17.14 → 18분 (16~20분 구간, -5)
    expect(calcWalkingMinutes(1600)).toBe(23); // 1600/70 = 22.86 → 23분 (20분초과 구간, -10)
  });
});

// ── nearestElemFromKakaoDocs ──────────────────────────────────
describe("nearestElemFromKakaoDocs", () => {
  it("초등학교 POI 1개 → 그 거리", () => {
    const docs = [{ place_name: "서울초등학교", distance: "850" }];
    expect(nearestElemFromKakaoDocs(docs)).toBe(850);
  });

  it("여러 후보 중 최소 거리 (진짜 학교만)", () => {
    const docs = [
      { place_name: "먼초등학교", distance: "1800" },
      { place_name: "가까운초등학교", distance: "1200" },
    ];
    expect(nearestElemFromKakaoDocs(docs)).toBe(1200);
  });

  it("비학교 POI(정류장) 섞여도 필터링 — isSchoolPlace 게이트가 살아 있는지", () => {
    const docs = [
      { place_name: "행복초등학교앞 정류장", distance: "100" }, // 더 가깝지만 학교 아님
      { place_name: "행복초등학교", distance: "900" },
    ];
    expect(nearestElemFromKakaoDocs(docs)).toBe(900);
  });

  it("병설유치원 섞여도 필터링", () => {
    const docs = [
      { place_name: "인천봉수초등학교 병설유치원", distance: "50" },
      { place_name: "인천봉수초등학교", distance: "700" },
    ];
    expect(nearestElemFromKakaoDocs(docs)).toBe(700);
  });

  it("학교 POI가 전혀 없으면 null", () => {
    const docs = [
      { place_name: "행복초등학교앞 정류장", distance: "100" },
      { place_name: "정약용체육관", distance: "200" },
    ];
    expect(nearestElemFromKakaoDocs(docs)).toBeNull();
  });

  it("빈 배열/undefined → null", () => {
    expect(nearestElemFromKakaoDocs([])).toBeNull();
    expect(nearestElemFromKakaoDocs(/** @type {any} */ (undefined))).toBeNull();
  });

  // 세션567 — 카카오 keyword.json "초등학교" 라이브 실측(2026-09-23) 그대로. 오션포레
  // (ah-2026910156)는 1km 안에 등재 초등학교가 없어 needLookup 이었는데, 5km 재탐색에서
  // 옛 이름 화이트리스트는 "…금산분교장"이 "학교"로 안 끝나 버렸다(49분 → 실제로는 1,980m).
  it("오션포레 실측 — 금산분교장 포함시 1,980m(29분), 제외시 더 먼 학교로 밀림", () => {
    const docs = [
      { place_name: "인천영종초등학교 금산분교장", category_name: "교육,학문 > 학교 > 초등학교", distance: "1980" },
      { place_name: "인천영종초등학교 금산분교장 교무실", category_name: "교육,학문 > 학교부속시설", distance: "1985" },
      { place_name: "먼초등학교", category_name: "교육,학문 > 학교 > 초등학교", distance: "3430" },
    ];
    expect(nearestElemFromKakaoDocs(docs)).toBe(1980);
    expect(calcWalkingMinutes(nearestElemFromKakaoDocs(docs) ?? 0)).toBe(29); // ceil(1980/70)=29
  });

  it("개교 예정 학교는 더 가까워도 제외된다", () => {
    const docs = [
      { place_name: "미단초중학교 (2028년 3월 예정)", category_name: "교육,학문 > 학교 > 초등학교", distance: "500" },
      { place_name: "정상초등학교", category_name: "교육,학문 > 학교 > 초등학교", distance: "2000" },
    ];
    expect(nearestElemFromKakaoDocs(docs)).toBe(2000);
  });
});

// ── planWalkUpdates ───────────────────────────────────────────
describe("planWalkUpdates", () => {
  it("nearby_schools 에 초등학교가 있으면 direct 로 분류 (needLookup 아님)", () => {
    const apartments = [{ id: "a1", lat: 37.5, lng: 127.0 }];
    const schoolsById = new Map([["a1", [{ type: "초", distance: 300 }]]]);
    const { direct, needLookup } = planWalkUpdates({ apartments, schoolsById });
    expect(direct).toEqual([{ id: "a1", walkMin: 5, minDist: 300 }]);
    expect(needLookup).toEqual([]);
  });

  it("nearby_schools 에 중/고만 있으면 needLookup 으로 분류 (direct 아님) — 핵심 뮤테이션 표적", () => {
    const apartments = [{ id: "a2", lat: 37.5, lng: 127.0 }];
    const schoolsById = new Map([["a2", [{ type: "중", distance: 300 }, { type: "고", distance: 500 }]]]);
    const { direct, needLookup } = planWalkUpdates({ apartments, schoolsById });
    expect(direct).toEqual([]);
    expect(needLookup).toEqual([{ id: "a2", lat: 37.5, lng: 127.0 }]);
  });

  it("nearby_schools 가 빈 배열이면 needLookup 으로 분류", () => {
    const apartments = [{ id: "a3", lat: 37.5, lng: 127.0 }];
    const schoolsById = new Map([["a3", []]]);
    const { direct, needLookup } = planWalkUpdates({ apartments, schoolsById });
    expect(direct).toEqual([]);
    expect(needLookup).toEqual([{ id: "a3", lat: 37.5, lng: 127.0 }]);
  });

  it("schools 행 자체가 없는 단지(Map 에 키 없음)도 needLookup", () => {
    const apartments = [{ id: "a4", lat: 37.5, lng: 127.0 }];
    const schoolsById = new Map();
    const { direct, needLookup } = planWalkUpdates({ apartments, schoolsById });
    expect(direct).toEqual([]);
    expect(needLookup).toEqual([{ id: "a4", lat: 37.5, lng: 127.0 }]);
  });

  it("좌표가 없으면 direct 도 needLookup 도 아니다 (조회 수단이 없음)", () => {
    const apartments = [{ id: "a5", lat: null, lng: null }];
    const schoolsById = new Map();
    const { direct, needLookup } = planWalkUpdates({ apartments, schoolsById });
    expect(direct).toEqual([]);
    expect(needLookup).toEqual([]);
  });

  it("여러 단지 혼합 — direct/needLookup 이 각각 정확히 갈린다", () => {
    const apartments = [
      { id: "d1", lat: 37.1, lng: 127.1 },
      { id: "n1", lat: 37.2, lng: 127.2 },
      { id: "skip1", lat: null, lng: null },
    ];
    const schoolsById = new Map([
      ["d1", [{ type: "초", distance: 200 }]],
      ["n1", [{ type: "중", distance: 100 }]],
    ]);
    const { direct, needLookup } = planWalkUpdates({ apartments, schoolsById });
    expect(direct.map(d => d.id)).toEqual(["d1"]);
    expect(needLookup.map(n => n.id)).toEqual(["n1"]);
  });

  // 세션567 — coord_shared(좌표 불명, 세션560)인 단지는 direct/needLookup 어느 쪽으로도
  // 안 가고 clear 로 빠져야 한다. 가짜 좌표로 카카오를 조회하면 안 된다(사장님 결정).
  describe("coord_shared 단지는 clear 로 분류된다 (세션567)", () => {
    it("nearby_schools 에 초등학교가 있어도 coord_shared 면 direct 아닌 clear", () => {
      const apartments = [{ id: "cs1", lat: 37.1, lng: 127.1, coord_shared: true }];
      const schoolsById = new Map([["cs1", [{ type: "초", distance: 200 }]]]);
      const { direct, needLookup, clear } = planWalkUpdates({ apartments, schoolsById });
      expect(direct).toEqual([]);
      expect(needLookup).toEqual([]);
      expect(clear).toEqual([{ id: "cs1" }]);
    });

    it("좌표가 있어도 coord_shared 면 카카오 재탐색(needLookup) 대상이 아니다", () => {
      const apartments = [{ id: "cs2", lat: 37.1, lng: 127.1, coord_shared: true }];
      const schoolsById = new Map();
      const { needLookup, clear } = planWalkUpdates({ apartments, schoolsById });
      expect(needLookup).toEqual([]);
      expect(clear).toEqual([{ id: "cs2" }]);
    });

    it("coord_shared: false 또는 null 또는 미설정 — 평소대로 direct/needLookup", () => {
      const apartments = [
        { id: "a", lat: 37.1, lng: 127.1, coord_shared: false },
        { id: "b", lat: 37.1, lng: 127.1, coord_shared: null },
        { id: "c", lat: 37.1, lng: 127.1 },
      ];
      const schoolsById = new Map([
        ["a", [{ type: "초", distance: 200 }]],
        ["b", [{ type: "초", distance: 200 }]],
        ["c", [{ type: "초", distance: 200 }]],
      ]);
      const { direct, clear } = planWalkUpdates({ apartments, schoolsById });
      expect(direct.map(d => d.id).sort()).toEqual(["a", "b", "c"]);
      expect(clear).toEqual([]);
    });

    it("혼합 — direct/needLookup/clear 세 그룹이 동시에 정확히 갈린다", () => {
      const apartments = [
        { id: "d1", lat: 37.1, lng: 127.1 },
        { id: "n1", lat: 37.2, lng: 127.2 },
        { id: "cs1", lat: 37.3, lng: 127.3, coord_shared: true },
      ];
      const schoolsById = new Map([
        ["d1", [{ type: "초", distance: 200 }]],
        ["n1", [{ type: "중", distance: 100 }]],
        ["cs1", [{ type: "초", distance: 200 }]], // 있어도 clear 가 우선
      ]);
      const { direct, needLookup, clear } = planWalkUpdates({ apartments, schoolsById });
      expect(direct.map(d => d.id)).toEqual(["d1"]);
      expect(needLookup.map(n => n.id)).toEqual(["n1"]);
      expect(clear.map(c => c.id)).toEqual(["cs1"]);
    });
  });
});

// ── 세션566: dry-run 은 KAKAO_KEY 부재로 exit 1 하지 않는다 ──────────────
// main() 은 Supabase/Kakao 를 실제로 호출해 무거운 mocking 없이는 단위테스트가 어렵다
// (guards-must-be-mutation-tested.md "테스트가 그 코드가 실제로 지나는 경로를 지나는가").
// 대신 소스를 직접 grep 해 exit 조건에 `!dryRun` 게이트가 실제로 배선돼 있는지 확인한다.
// ⚠️ 좌변(`if (result.fail > 0`)까지 고정 — 부분 문자열만 찾으면 선언부·주석에 걸려
// 껍데기가 된다(guards-must-be-mutation-tested.md 세션491 사고 답습).
describe("dry-run 은 KAKAO_KEY 부재만으로 exit 1 하지 않는다 (세션566)", () => {
  const src = readFileSync(new URL("./calc-school-walk.mjs", import.meta.url), "utf-8");

  it("exit 조건이 dryRun 을 실제로 검사한다", () => {
    expect(src).toMatch(
      /if \(result\.fail > 0 \|\| \(!dryRun && partialNoKey\)\) process\.exit\(1\);/,
    );
  });

  it("dry-run 안내 로그가 실제로 찍힌다", () => {
    expect(src).toMatch(/if \(dryRun && partialNoKey\) \{/);
    expect(src).toMatch(/KAKAO_KEY 없음 — 재탐색 \$\{needLookup\.length\}곳은 미리보기에서 빠졌다/);
  });
});

// ── 세션566: 거울 사본 동기화 가드 (schools-neis.test.mjs 관례 답습) ──────────
// 점수표(.ts)는 이 수집기가 import 할 수 없어 여전히 복제한다.
describe("거울 사본 동기화 (calc-school-walk ↔ scoringTiers.ts)", () => {
  it("가산점 표 거울이 한 칸도 어긋나지 않는다", async () => {
    const { SCHOOL_WALK_BONUS, SCHOOL_WALK_FAR_ADJ } = await import("@/constants/scoringTiers");
    expect(SCHOOL_WALK_BONUS_MIRROR).toEqual(SCHOOL_WALK_BONUS.map((t) => ({ max: t.max, score: t.score })));
    expect(SCHOOL_WALK_FAR_ADJ_MIRROR).toBe(SCHOOL_WALK_FAR_ADJ);
  });
});

// ── 세션567: 학교명 판정은 이제 복제본이 아니라 공유 모듈 `_school-place.mjs` 를 쓴다.
// "거울이 어긋나지 않는다"를 값 대조로 재확인할 필요가 없어졌고(같은 함수이므로 항상 같다),
// 대신 **소스에 로컬 복제본이 부활하지 않았는지**를 grep 으로 지킨다
// ([[guards-must-be-mutation-tested]] "소스 grep 가드는 좌변까지 고정" — 선언문 형태로 고정해
// 주석·부분 문자열에 걸리는 껍데기를 피한다).
describe("학교명 판정 — 공유 모듈만 쓰고 로컬 복제본이 없다 (세션567)", () => {
  it("calc-school-walk.mjs 는 ./_school-place.mjs 를 import 한다", () => {
    expect(COLLECTOR_SRC).toMatch(
      /import \{ isSchoolPlace, isElementarySchoolDoc \} from "\.\/_school-place\.mjs";/,
    );
  });

  it("calc-school-walk.mjs 안에 로컬 SCHOOL_SUFFIX_RE 선언이 없다 (사본 부활 방지)", () => {
    expect(COLLECTOR_SRC).not.toMatch(/const\s+SCHOOL_SUFFIX_RE\s*=/);
  });

  it("schools-neis.mjs 도 ./_school-place.mjs 를 import 하고 로컬 선언이 없다", () => {
    const neisSrc = readFileSync(new URL("./schools-neis.mjs", import.meta.url), "utf-8");
    expect(neisSrc).toMatch(/import \{[^}]*isSchoolPlace[^}]*isElementarySchoolDoc[^}]*\} from "\.\/_school-place\.mjs";/);
    expect(neisSrc).not.toMatch(/const\s+SCHOOL_SUFFIX_RE\s*=/);
  });
});
