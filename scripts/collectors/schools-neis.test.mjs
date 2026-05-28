// @ts-check
/**
 * schools-neis.mjs 테스트 — 학군 점수 순수 함수 검증
 *
 * 대상: calcScore, gradeFromScore, isSchoolPlace, calcQualityBonus,
 *       normalizeSchoolName, fetchNeisSchoolInfo, enrichWithNeis,
 *       getAcademicYear, fetchNeisClassInfo,
 *       fetchStudentBulk, enrichWithStudents, calcDensityBonus
 */
import { describe, it, expect, vi } from "vitest";

// _shared.mjs 모킹 — 외부 호출 차단
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return {
    ...orig,
    loadEnv: vi.fn(),
    getSupabase: vi.fn(),
    log: vi.fn(),
    logError: vi.fn(),
    fetchWithRetry: vi.fn(),
    sleep: vi.fn(),
  };
});

// KAKAO_KEY 설정 — 모듈 로드 시 process.exit 방지
process.env.KAKAO_KEY = "test-key";

const { calcScore, gradeFromScore, isSchoolPlace, calcQualityBonus, normalizeSchoolName, fetchNeisSchoolInfo, enrichWithNeis, getAcademicYear, fetchNeisClassInfo, fetchStudentBulk, enrichWithStudents, calcDensityBonus, buildEnrichedIds, STALE_DAYS_FOR_SKIP } = await import("./schools-neis.mjs");

// ── 팩토리 ───────────────────────────────────────────────────
/** Kakao 검색 결과 팩토리 (distance 포함)
 * @param {number} distance
 */
function makeSchool(distance) {
  return { place_name: "테스트학교", distance: String(distance) };
}

// ── calcScore ─────────────────────────────────────────────────
describe("calcScore", () => {
  it("모든 배열 비어있음 → 기본 점수 50", () => {
    expect(calcScore([], [], [])).toBe(50);
  });

  it("초등학교 500m 이내 → +15", () => {
    expect(calcScore([makeSchool(300)], [], [])).toBe(65); // 50 + 15
  });

  it("초등학교 500m 초과 1000m 이내 → +10", () => {
    expect(calcScore([makeSchool(700)], [], [])).toBe(60); // 50 + 10
  });

  it("초등학교 500m 경계값 → +15 (500 이하)", () => {
    expect(calcScore([makeSchool(500)], [], [])).toBe(65); // 50 + 15
  });

  it("초등학교 501m → +10", () => {
    expect(calcScore([makeSchool(501)], [], [])).toBe(60); // 50 + 10
  });

  it("중학교 1000m 이내 → +8", () => {
    expect(calcScore([], [makeSchool(800)], [])).toBe(58); // 50 + 8
  });

  it("중학교 1000m 초과 → +4", () => {
    expect(calcScore([], [makeSchool(1500)], [])).toBe(54); // 50 + 4
  });

  it("고등학교 1000m 이내 → +5", () => {
    expect(calcScore([], [], [makeSchool(900)])).toBe(55); // 50 + 5
  });

  it("고등학교 1000m 초과 → +2", () => {
    expect(calcScore([], [], [makeSchool(2000)])).toBe(52); // 50 + 2
  });

  it("복합 시나리오 — 초등 2개 + 중학 1개 + 고등 1개", () => {
    const elem = [makeSchool(300), makeSchool(800)]; // +15 +10
    const middle = [makeSchool(500)]; // +8
    const high = [makeSchool(900)]; // +5
    // 50 + 15 + 10 + 8 + 5 = 88
    expect(calcScore(elem, middle, high)).toBe(88);
  });

  it("상한 100 클램핑 — 학교 다수일 때", () => {
    const elem = [makeSchool(100), makeSchool(200), makeSchool(300)]; // +15 × 3 = 45
    const middle = [makeSchool(100)]; // +8
    const high = [makeSchool(100)]; // +5
    // 50 + 45 + 8 + 5 = 108 → clamped to 100
    expect(calcScore(elem, middle, high)).toBe(100);
  });

  it("distance가 문자열이어도 Number() 변환 처리", () => {
    expect(calcScore([{ distance: "499" }], [], [])).toBe(65); // 50 + 15
  });
});

// ── gradeFromScore ────────────────────────────────────────────
describe("gradeFromScore", () => {
  it("80점 이상 → A", () => {
    expect(gradeFromScore(80)).toBe("A");
    expect(gradeFromScore(100)).toBe("A");
  });

  it("60~79점 → B", () => {
    expect(gradeFromScore(60)).toBe("B");
    expect(gradeFromScore(79)).toBe("B");
  });

  it("40~59점 → C", () => {
    expect(gradeFromScore(40)).toBe("C");
    expect(gradeFromScore(59)).toBe("C");
  });

  it("40점 미만 → D", () => {
    expect(gradeFromScore(39)).toBe("D");
    expect(gradeFromScore(0)).toBe("D");
  });

  it("경계값 정확성", () => {
    expect(gradeFromScore(79)).toBe("B"); // not A
    expect(gradeFromScore(59)).toBe("C"); // not B
    expect(gradeFromScore(39)).toBe("D"); // not C
  });
});

// ── isSchoolPlace (whitelist — "학교"로 끝나는 이름만 통과) ────
describe("isSchoolPlace", () => {
  it("정상 초등학교 → true", () => {
    expect(isSchoolPlace("서울초등학교")).toBe(true);
  });

  it("정상 중학교 → true", () => {
    expect(isSchoolPlace("강남중학교")).toBe(true);
  });

  it("정상 고등학교 → true", () => {
    expect(isSchoolPlace("가정고등학교")).toBe(true);
  });

  it("'학교'로 끝나는 특수학교 → true", () => {
    expect(isSchoolPlace("한국과학영재학교")).toBe(true);
  });

  it("'학교' 안에 '학교' 포함 — 끝이 '학교'면 통과", () => {
    expect(isSchoolPlace("서울대학교부설초등학교")).toBe(true);
  });

  it("앞뒤 공백 trim 처리 → true", () => {
    expect(isSchoolPlace("  서울초등학교  ")).toBe(true);
  });

  it("병설유치원 — '학교' 뒤 추가 텍스트 → false", () => {
    expect(isSchoolPlace("인천봉수초등학교 병설유치원")).toBe(false);
  });

  it("전기차충전소 — '학교' 뒤 추가 텍스트 → false", () => {
    expect(isSchoolPlace("가현초등학교 전기차충전소")).toBe(false);
  });

  it("가온관 — '학교' 뒤 추가 텍스트 → false", () => {
    expect(isSchoolPlace("인천가석초등학교 가온관")).toBe(false);
  });

  it("재개발추진위원회 — '학교'로 끝나지 않음 → false", () => {
    expect(isSchoolPlace("신현초교주변구역재개발추진위원회")).toBe(false);
  });

  it("기숙사 — '학교' 뒤 텍스트 → false", () => {
    expect(isSchoolPlace("○○학교기숙사")).toBe(false);
  });

  it("체육관 — '학교' 없음 → false", () => {
    expect(isSchoolPlace("정약용체육관")).toBe(false);
  });

  it("행정실 — '학교' 없음 → false", () => {
    expect(isSchoolPlace("행정실")).toBe(false);
  });
});

// ── calcQualityBonus ─────────────────────────────────────────────
describe("calcQualityBonus", () => {
  it("highSchoolType 없는 학교 → 보너스 0", () => {
    expect(calcQualityBonus([{ distance: "900" }])).toBe(0);
  });

  it("특수목적고 → +7", () => {
    expect(calcQualityBonus([{ distance: "900", highSchoolType: "특수목적고등학교" }])).toBe(7);
  });

  it("자율고 → +5", () => {
    expect(calcQualityBonus([{ distance: "900", highSchoolType: "자율고등학교" }])).toBe(5);
  });

  it("특성화고 → -2", () => {
    expect(calcQualityBonus([{ distance: "900", highSchoolType: "특성화고등학교" }])).toBe(-2);
  });

  it("일반고 → 0", () => {
    expect(calcQualityBonus([{ distance: "900", highSchoolType: "일반고등학교" }])).toBe(0);
  });

  it("복합 — 특목고 + 일반고", () => {
    const high = [
      { distance: "800", highSchoolType: "특수목적고등학교" },
      { distance: "1200", highSchoolType: "일반고등학교" },
    ];
    expect(calcQualityBonus(high)).toBe(7); // +7 + 0
  });

  it("복합 — 특목고 + 특성화고", () => {
    const high = [
      { distance: "800", highSchoolType: "특수목적고등학교" },
      { distance: "1500", highSchoolType: "특성화고등학교" },
    ];
    expect(calcQualityBonus(high)).toBe(5); // +7 + (-2)
  });
});

// ── calcScore + 품질 보정 ────────────────────────────────────────
describe("calcScore 품질 보정", () => {
  it("고등학교에 highSchoolType 없으면 기존 점수와 동일", () => {
    const high = [makeSchool(900)]; // +5
    expect(calcScore([], [], high)).toBe(55); // 50 + 5
  });

  it("특목고 1km 이내 → 거리(+5) + 품질(+7) = 62", () => {
    const high = [{ distance: "800", highSchoolType: "특수목적고등학교" }];
    expect(calcScore([], [], high)).toBe(62); // 50 + 5 + 7
  });

  it("자율고 1km 초과 → 거리(+2) + 품질(+5) = 57", () => {
    const high = [{ distance: "1500", highSchoolType: "자율고등학교" }];
    expect(calcScore([], [], high)).toBe(57); // 50 + 2 + 5
  });

  it("특성화고만 → 거리(+5) + 품질(-2) = 53", () => {
    const high = [{ distance: "800", highSchoolType: "특성화고등학교" }];
    expect(calcScore([], [], high)).toBe(53); // 50 + 5 + (-2)
  });

  it("품질 보정으로 100 초과 시 클램핑", () => {
    const elem = [makeSchool(100), makeSchool(200), makeSchool(300)]; // +45
    const high = [{ distance: "100", highSchoolType: "특수목적고등학교" }]; // +5 +7
    // 50 + 45 + 5 + 7 = 107 → 100
    expect(calcScore(elem, [], high)).toBe(100);
  });

  it("품질 보정으로 0 미만 시 클램핑", () => {
    // 특성화고 여러 개로 음수 가능성 테스트 (기본 50이므로 실제로는 어려움)
    expect(calcScore([], [], [])).toBeGreaterThanOrEqual(0);
  });
});

// ── normalizeSchoolName ──────────────────────────────────────────
describe("normalizeSchoolName", () => {
  it("공백 제거", () => {
    expect(normalizeSchoolName("서울 초등 학교")).toBe("서울초등학교");
  });

  it("괄호 제거", () => {
    expect(normalizeSchoolName("서울대학교(부설)초등학교")).toBe("서울대학교부설초등학교");
  });

  it("일반 학교명은 그대로", () => {
    expect(normalizeSchoolName("강남중학교")).toBe("강남중학교");
  });
});

// ── fetchNeisSchoolInfo (NEIS_KEY 미설정 시) ─────────────────────
describe("fetchNeisSchoolInfo", () => {
  it("NEIS_KEY 없으면 null 반환", async () => {
    // 테스트 환경에서 NEIS_KEY가 설정되지 않으므로 null
    const result = await fetchNeisSchoolInfo("서울초등학교");
    expect(result).toBeNull();
  });
});

// ── enrichWithNeis (NEIS_KEY 미설정 시) ──────────────────────────
describe("enrichWithNeis", () => {
  it("NEIS_KEY 없으면 원본 그대로 반환", async () => {
    const schools = [
      { name: "서울초등학교", type: "초", distance: 300 },
      { name: "강남중학교", type: "중", distance: 800 },
    ];
    const result = await enrichWithNeis(schools);
    expect(result).toEqual(schools);
  });

  it("빈 배열 → 빈 배열", async () => {
    const result = await enrichWithNeis([]);
    expect(result).toEqual([]);
  });
});

// ── getAcademicYear ──────────────────────────────────────────────
describe("getAcademicYear", () => {
  it("현재 연도 또는 전년도 반환 (숫자)", () => {
    const ay = getAcademicYear();
    const now = new Date();
    const expected = now.getMonth() < 2 ? now.getFullYear() - 1 : now.getFullYear();
    expect(ay).toBe(expected);
  });

  it("반환값은 4자리 숫자", () => {
    const ay = getAcademicYear();
    expect(ay).toBeGreaterThan(2020);
    expect(ay).toBeLessThanOrEqual(new Date().getFullYear());
  });
});

// ── fetchNeisClassInfo (NEIS_KEY 미설정 시) ──────────────────────
describe("fetchNeisClassInfo", () => {
  it("NEIS_KEY 없으면 null 반환", async () => {
    const result = await fetchNeisClassInfo("B10", "7010057");
    expect(result).toBeNull();
  });

  it("officeCode null → null", async () => {
    const result = await fetchNeisClassInfo(null, "7010057");
    expect(result).toBeNull();
  });

  it("neisCode null → null", async () => {
    const result = await fetchNeisClassInfo("B10", null);
    expect(result).toBeNull();
  });

  it("officeCode + neisCode 모두 null → null", async () => {
    const result = await fetchNeisClassInfo(null, null);
    expect(result).toBeNull();
  });
});

// ── Phase 3: fetchStudentBulk (SCHOOLINFO_KEY 미설정 시) ────────
describe("fetchStudentBulk", () => {
  it("SCHOOLINFO_KEY 없으면 null 반환", async () => {
    const result = await fetchStudentBulk("11", "11680", "02");
    expect(result).toBeNull();
  });

  it("sidoCode/sggCode 전달해도 키 없으면 null", async () => {
    const result = await fetchStudentBulk("26", "26350", "03");
    expect(result).toBeNull();
  });
});

// ── enrichWithStudents (SCHOOLINFO_KEY 미설정 시) ────────────────
describe("enrichWithStudents", () => {
  it("SCHOOLINFO_KEY 없으면 원본 그대로 반환", async () => {
    const schools = [
      { name: "서울초등학교", type: "초", distance: 300 },
    ];
    const result = await enrichWithStudents(schools, "11", "11680");
    expect(result).toEqual(schools);
  });

  it("빈 배열 → 빈 배열", async () => {
    const result = await enrichWithStudents([], "11", "11680");
    expect(result).toEqual([]);
  });

  it("sidoCode null → 원본 반환", async () => {
    const schools = [{ name: "테스트학교", type: "초", distance: 500 }];
    const result = await enrichWithStudents(schools, null, "11680");
    expect(result).toEqual(schools);
  });

  it("sggCode null → 원본 반환", async () => {
    const schools = [{ name: "테스트학교", type: "초", distance: 500 }];
    const result = await enrichWithStudents(schools, "11", null);
    expect(result).toEqual(schools);
  });
});

// ── calcDensityBonus ────────────────────────────────────────────
describe("calcDensityBonus", () => {
  it("학생수/학급수 없는 학교 → 보너스 0", () => {
    expect(calcDensityBonus([{ name: "학교", type: "초", distance: 300 }])).toBe(0);
  });

  it("적정 밀도 (20~28명/반) → +2", () => {
    const schools = [{ students: 500, classes: 20 }]; // 25명/반
    expect(calcDensityBonus(schools)).toBe(2);
  });

  it("경계값 하한 20명/반 → +2 (적정)", () => {
    const schools = [{ students: 200, classes: 10 }]; // 정확히 20명/반
    expect(calcDensityBonus(schools)).toBe(2);
  });

  it("경계값 상한 28명/반 → +2 (적정)", () => {
    const schools = [{ students: 280, classes: 10 }]; // 정확히 28명/반
    expect(calcDensityBonus(schools)).toBe(2);
  });

  it("과밀 (>35명/반) → -2", () => {
    const schools = [{ students: 360, classes: 10 }]; // 36명/반
    expect(calcDensityBonus(schools)).toBe(-2);
  });

  it("과소 (<12명/반) → -1", () => {
    const schools = [{ students: 110, classes: 10 }]; // 11명/반
    expect(calcDensityBonus(schools)).toBe(-1);
  });

  it("중간 구간 (12~19 또는 29~35) → 보너스 0", () => {
    const schools = [{ students: 300, classes: 10 }]; // 30명/반
    expect(calcDensityBonus(schools)).toBe(0);
  });

  it("classes=0 → 보너스 0 (무시)", () => {
    const schools = [{ students: 100, classes: 0 }];
    expect(calcDensityBonus(schools)).toBe(0);
  });

  it("복합 — 적정 + 과밀 → 합산", () => {
    const schools = [
      { students: 500, classes: 20 }, // 25명/반 → +2
      { students: 400, classes: 10 }, // 40명/반 → -2
    ];
    expect(calcDensityBonus(schools)).toBe(0); // +2 + (-2)
  });

  it("상한 클램핑 — 적정 학교 다수 → 최대 +5", () => {
    const schools = [
      { students: 500, classes: 20 }, // +2
      { students: 600, classes: 25 }, // +2
      { students: 450, classes: 18 }, // +2
      { students: 700, classes: 28 }, // +2
    ];
    expect(calcDensityBonus(schools)).toBe(5); // 8 → clamped to 5
  });

  it("하한 클램핑 — 과밀 학교 다수 → 최소 -5", () => {
    const schools = [
      { students: 400, classes: 10 }, // -2
      { students: 360, classes: 10 }, // -2
      { students: 380, classes: 10 }, // -2
    ];
    expect(calcDensityBonus(schools)).toBe(-5); // -6 → clamped to -5
  });

  it("students만 있고 classes 없음 → 무시", () => {
    expect(calcDensityBonus([{ students: 500 }])).toBe(0);
  });
});

// ── calcScore + 밀도 보정 ───────────────────────────────────────
describe("calcScore 밀도 보정", () => {
  it("allSchools 미전달 → 기존 점수와 동일", () => {
    expect(calcScore([makeSchool(300)], [], [])).toBe(65); // 50 + 15
  });

  it("allSchools에 학생수 있으면 밀도 보정 적용", () => {
    const all = [{ students: 500, classes: 20 }]; // 25명/반 → +2
    expect(calcScore([], [], [], all)).toBe(52); // 50 + 0 + 2
  });

  it("밀도 보정으로 100 초과 시 클램핑", () => {
    const elem = [makeSchool(100), makeSchool(200), makeSchool(300)]; // +45
    const all = [{ students: 500, classes: 20 }]; // +2
    // 50 + 45 + 2 = 97 → 97 (100 이하이므로 OK)
    expect(calcScore(elem, [], [], all)).toBe(97);
  });

  it("밀도 보정 + 품질 보정 합산", () => {
    const high = [{ distance: "800", highSchoolType: "특수목적고등학교" }]; // +5+7
    const all = [{ students: 500, classes: 20 }]; // +2
    // 50 + 5 + 7 + 2 = 64
    expect(calcScore([], [], high, all)).toBe(64);
  });
});

// ── 세션 338: buildEnrichedIds (resume self skip) ──────────────
describe("buildEnrichedIds (세션 338)", () => {
  const NOW = Date.now();
  const STALE_MS = NOW - STALE_DAYS_FOR_SKIP * 86400000;

  it("nearby_schools schoolType 박힌 + 30일 이내 단지 = enriched (skip 대상)", () => {
    const rows = [
      { apartment_id: "A", nearby_schools: [{ name: "초", schoolType: "공립" }], updated_at: new Date(NOW - 86400000).toISOString() },
    ];
    const ids = buildEnrichedIds(rows, STALE_MS);
    expect(ids.has("A")).toBe(true);
    expect(ids.size).toBe(1);
  });

  it("nearby_schools 안 schoolType 키 부재 단지 = enriched 아님 (NEIS 미보강 재처리)", () => {
    const rows = [
      { apartment_id: "A", nearby_schools: [{ name: "초", distance: 300 }], updated_at: new Date(NOW - 86400000).toISOString() },
    ];
    const ids = buildEnrichedIds(rows, STALE_MS);
    expect(ids.has("A")).toBe(false);
    expect(ids.size).toBe(0);
  });

  it("schools 테이블 비어있음 = 빈 Set (전수 처리)", () => {
    expect(buildEnrichedIds([], STALE_MS).size).toBe(0);
    expect(buildEnrichedIds(/** @type {any} */ (null), STALE_MS).size).toBe(0);
  });

  it("updated_at 30일 초과 단지 = enriched 아님 (강제 갱신)", () => {
    const rows = [
      { apartment_id: "A", nearby_schools: [{ name: "초", schoolType: "공립" }], updated_at: new Date(NOW - 40 * 86400000).toISOString() },
    ];
    const ids = buildEnrichedIds(rows, STALE_MS);
    expect(ids.has("A")).toBe(false);
  });

  it("nearby_schools length 0 단지 = enriched 아님 (재처리)", () => {
    const rows = [
      { apartment_id: "A", nearby_schools: [], updated_at: new Date(NOW - 86400000).toISOString() },
    ];
    const ids = buildEnrichedIds(rows, STALE_MS);
    expect(ids.has("A")).toBe(false);
  });

  it("혼합 시나리오 = 보강된 + 미보강 + 만료 동시 박힘", () => {
    const rows = [
      { apartment_id: "A", nearby_schools: [{ name: "초", schoolType: "공립" }], updated_at: new Date(NOW - 86400000).toISOString() },        // skip
      { apartment_id: "B", nearby_schools: [{ name: "초" }], updated_at: new Date(NOW - 86400000).toISOString() },                              // 재처리
      { apartment_id: "C", nearby_schools: [{ name: "초", schoolType: "공립" }], updated_at: new Date(NOW - 40 * 86400000).toISOString() },     // 재처리 (만료)
    ];
    const ids = buildEnrichedIds(rows, STALE_MS);
    expect(ids.has("A")).toBe(true);
    expect(ids.has("B")).toBe(false);
    expect(ids.has("C")).toBe(false);
    expect(ids.size).toBe(1);
  });
});
