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
// 이 수집기는 두 원본을 import 하지 못해 복제한다 — 점수표는 .ts 라서, 학교명 판정은
// schools-neis.mjs 가 KAKAO_KEY 없으면 import 즉시 process.exit 하기 때문이다.
// 복제본이 원본에서 조용히 어긋나지 않게 **직접 import 해서** 대조한다.
describe("거울 사본 동기화 (calc-school-walk ↔ scoringTiers.ts · schools-neis.mjs)", () => {
  it("가산점 표 거울이 한 칸도 어긋나지 않는다", async () => {
    const { SCHOOL_WALK_BONUS, SCHOOL_WALK_FAR_ADJ } = await import("@/constants/scoringTiers");
    expect(SCHOOL_WALK_BONUS_MIRROR).toEqual(SCHOOL_WALK_BONUS.map((t) => ({ max: t.max, score: t.score })));
    expect(SCHOOL_WALK_FAR_ADJ_MIRROR).toBe(SCHOOL_WALK_FAR_ADJ);
  });

  it("학교명 판정이 schools-neis.mjs 와 같은 답을 낸다", async () => {
    const saved = process.env.KAKAO_KEY;
    process.env.KAKAO_KEY = saved || "test-key"; // 그 모듈은 키가 없으면 import 즉시 종료한다
    try {
      const neis = await import("./schools-neis.mjs");
      const names = [
        "서울초등학교", "행복중학교", "한빛고등학교", "하늘대안학교", "초등학교",
        "  서울초등학교  ", "행복초등학교앞 정류장", "서울초등학교 병설유치원", "학교앞", "", "초등",
      ];
      for (const n of names) expect(isSchoolPlace(n)).toBe(neis.isSchoolPlace(n));
      // 판정이 전부 한쪽으로 쏠리면 이 대조는 의미가 없다 — 참·거짓이 둘 다 나와야 한다.
      expect(new Set(names.map((n) => isSchoolPlace(n))).size).toBe(2);
    } finally {
      if (saved === undefined) delete process.env.KAKAO_KEY;
      else process.env.KAKAO_KEY = saved;
    }
  });
});
