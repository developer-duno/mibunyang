// @ts-check
/**
 * schools-neis.mjs 테스트 — 학군 점수 순수 함수 검증
 *
 * 대상: calcRawScore, rescaleSchoolScore, calcScore, gradeFromScore, isSchoolPlace, calcQualityBonus,
 *       normalizeSchoolName, fetchNeisSchoolInfo, enrichWithNeis,
 *       getAcademicYear, fetchNeisClassInfo,
 *       fetchStudentBulk, enrichWithStudents, calcDensityBonus
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const { calcRawScore, calcScore, rescaleSchoolScore, RESCALE_ANCHORS_MIRROR, GRADE_TIERS_MIRROR, GRADE_FALLBACK_MIRROR, gradeFromScore, isSchoolPlace, calcQualityBonus, normalizeSchoolName, fetchNeisSchoolInfo, enrichWithNeis, getAcademicYear, fetchNeisClassInfo, fetchStudentBulk, enrichWithStudents, calcDensityBonus, buildEnrichedIds, STALE_DAYS_FOR_SKIP, parseIdsArg, selectTargetsByIds, shouldRefuseLocalWriteWithoutSchoolInfo, selectProcessList, searchKakao, KAKAO_MAX_PAGES } = await import("./schools-neis.mjs");
const sharedMock = await import("./_shared.mjs");

// 소스를 직접 읽어 배선(어느 쿼리로 훑는지)을 검사한다 — transit-match.test.mjs 답습 패턴.
const COLLECTOR_SRC = readFileSync(new URL("./schools-neis.mjs", import.meta.url), "utf8");

// ── 팩토리 ───────────────────────────────────────────────────
/** Kakao 검색 결과 팩토리 (distance 포함)
 * @param {number} distance
 */
function makeSchool(distance) {
  return { place_name: "테스트학교", distance: String(distance) };
}

// ── calcRawScore (원점수 산식 — 상한 없음) ────────────────────
describe("calcRawScore", () => {
  it("모든 배열 비어있음 → 기본 점수 50", () => {
    expect(calcRawScore([], [], [])).toBe(50);
  });

  it("초등학교 500m 이내 → +15", () => {
    expect(calcRawScore([makeSchool(300)], [], [])).toBe(65); // 50 + 15
  });

  it("초등학교 500m 초과 1000m 이내 → +10", () => {
    expect(calcRawScore([makeSchool(700)], [], [])).toBe(60); // 50 + 10
  });

  it("초등학교 500m 경계값 → +15 (500 이하)", () => {
    expect(calcRawScore([makeSchool(500)], [], [])).toBe(65); // 50 + 15
  });

  it("초등학교 501m → +10", () => {
    expect(calcRawScore([makeSchool(501)], [], [])).toBe(60); // 50 + 10
  });

  it("중학교 1000m 이내 → +8", () => {
    expect(calcRawScore([], [makeSchool(800)], [])).toBe(58); // 50 + 8
  });

  it("중학교 1000m 초과 → +4", () => {
    expect(calcRawScore([], [makeSchool(1500)], [])).toBe(54); // 50 + 4
  });

  it("고등학교 1000m 이내 → +5", () => {
    expect(calcRawScore([], [], [makeSchool(900)])).toBe(55); // 50 + 5
  });

  it("고등학교 1000m 초과 → +2", () => {
    expect(calcRawScore([], [], [makeSchool(2000)])).toBe(52); // 50 + 2
  });

  it("복합 시나리오 — 초등 2개 + 중학 1개 + 고등 1개", () => {
    const elem = [makeSchool(300), makeSchool(800)]; // +15 +10
    const middle = [makeSchool(500)]; // +8
    const high = [makeSchool(900)]; // +5
    // 50 + 15 + 10 + 8 + 5 = 88
    expect(calcRawScore(elem, middle, high)).toBe(88);
  });

  // 세션524 — 원점수의 상한 클램프(Math.min(...,100))를 없앴다. 그 클램프가 실측 72.1%를
  // 100 하나로 뭉개 A등급 87.5% 를 만들었다(scoringTiers.ts SCHOOL_RESCALE_ANCHORS 주석).
  // 원점수는 이제 학교가 많을수록 계속 오른다 — 자르는 대신 재척도가 0~100 으로 옮긴다.
  it("학교가 많으면 100 을 넘어간다 — 원점수는 안 자른다", () => {
    const elem = [makeSchool(100), makeSchool(200), makeSchool(300)]; // +15 × 3 = 45
    const middle = [makeSchool(100)]; // +8
    const high = [makeSchool(100)]; // +5
    expect(calcRawScore(elem, middle, high)).toBe(108); // 50 + 45 + 8 + 5
    expect(calcRawScore(elem, middle, high)).toBeGreaterThan(100); // 옛 클램프면 red
  });

  it("distance가 문자열이어도 Number() 변환 처리", () => {
    expect(calcRawScore([{ distance: "499" }], [], [])).toBe(65); // 50 + 15
  });
});

// ── rescaleSchoolScore (세션524 — 상대 재척도) ────────────────
// 옛 코드는 원점수를 `Math.min(raw, 100)` 으로 잘랐고, 그 클램프가 실측 2,771곳 중
// 72.1%(1,998곳)를 100 하나로 뭉갰다(A등급 87.5% · D등급 0곳). 자르는 대신 실측 분위
// 앵커로 옮긴다 — 근거 분포는 scoringTiers.ts `SCHOOL_RESCALE_ANCHORS` 주석.
describe("rescaleSchoolScore", () => {
  it("앵커 값은 정의된 점수 그대로 나온다", () => {
    for (const { raw, score } of RESCALE_ANCHORS_MIRROR) {
      expect(rescaleSchoolScore(raw)).toBe(score);
    }
  });

  it("앵커 사이는 선형 보간 — 중앙값과 상위10% 의 한가운데는 80점", () => {
    // 중앙값 124(60점) ~ 상위10% 162(100점) 의 중간 raw 143 → 60 + 0.5*40 = 80
    expect(rescaleSchoolScore(143)).toBe(80);
    // 하위10% 76(20점) ~ 중앙값 124(60점) 의 중간 raw 100 → 20 + 0.5*40 = 40
    expect(rescaleSchoolScore(100)).toBe(40);
  });

  it("최고 앵커를 넘으면 100 에서 멈춘다 (실측 최대 213)", () => {
    expect(rescaleSchoolScore(162)).toBe(100);
    expect(rescaleSchoolScore(213)).toBe(100);
    expect(rescaleSchoolScore(999)).toBe(100);
  });

  it("최저 앵커 이하는 0 (원점수 시작값 50 = 근접 학교 0개)", () => {
    expect(rescaleSchoolScore(50)).toBe(0);
    expect(rescaleSchoolScore(0)).toBe(0);
    expect(rescaleSchoolScore(-10)).toBe(0);
  });

  it("단조 증가 — 학교가 늘면 점수가 내려가지 않는다", () => {
    let prev = -1;
    for (let raw = 40; raw <= 220; raw++) {
      const v = rescaleSchoolScore(raw);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("옛 클램프였다면 같아졌을 값들이 서로 갈린다 — 변별력 회귀 가드", () => {
    // 옛 산식: raw 124·162·213 이 전부 100 이었다(원점수 100 초과가 72.1%).
    const vals = [124, 162, 213].map((r) => rescaleSchoolScore(r));
    expect(new Set(vals).size).toBeGreaterThan(1);
    expect(rescaleSchoolScore(124)).toBeLessThan(rescaleSchoolScore(162));
  });
});

// ── calcScore = 재척도(원점수) ────────────────────────────────
describe("calcScore — 저장되는 0~100 점수", () => {
  it("원점수를 재척도한 값과 같다", () => {
    const elem = [makeSchool(300), makeSchool(800)];
    const middle = [makeSchool(500)];
    const high = [makeSchool(900)];
    expect(calcScore(elem, middle, high)).toBe(rescaleSchoolScore(calcRawScore(elem, middle, high)));
  });

  it("근접 학교 0개(원점수 50)면 0점 — 옛 산식은 50점이었다", () => {
    expect(calcRawScore([], [], [])).toBe(50);
    expect(calcScore([], [], [])).toBe(0);
  });

  it("학교가 아주 많은 단지만 만점 — 옛 산식의 만점 남발을 막는다", () => {
    // 초등 3 + 중 1 + 고 1 = 원점수 108 → 아직 만점이 아니다(옛 산식은 100 = 만점).
    const many = [makeSchool(100), makeSchool(200), makeSchool(300)];
    expect(calcScore(many, [makeSchool(100)], [makeSchool(100)])).toBeLessThan(100);
  });

  it("항상 0~100 안에 든다", () => {
    const huge = Array.from({ length: 30 }, () => makeSchool(100));
    expect(calcScore(huge, huge, huge)).toBe(100);
    expect(calcScore([], [], [])).toBeGreaterThanOrEqual(0);
  });
});

// ── gradeFromScore (세션524 — 경계 재설정) ───────────────────
// 옛 경계 80/60/40 을 새 척도에 그대로 두면 A 가 27.1% 가 된다("네 곳 중 한 곳이 A").
// 실측(n=2,771): A 17.2% · B 33.4% · C 39.8% · D 9.6%.
describe("gradeFromScore", () => {
  it("경계 숫자를 안 박고 상수에서 뽑는다 — 한쪽만 바꾸면 red", () => {
    for (const { min, grade } of GRADE_TIERS_MIRROR) {
      expect(gradeFromScore(min)).toBe(grade);
      expect(gradeFromScore(min - 1)).not.toBe(grade);
    }
    const lowest = Math.min(...GRADE_TIERS_MIRROR.map((t) => t.min));
    expect(gradeFromScore(lowest - 1)).toBe(GRADE_FALLBACK_MIRROR);
  });

  it("90점 이상 → A", () => {
    expect(gradeFromScore(90)).toBe("A");
    expect(gradeFromScore(100)).toBe("A");
  });

  it("60~89점 → B", () => {
    expect(gradeFromScore(60)).toBe("B");
    expect(gradeFromScore(89)).toBe("B");
  });

  it("20~59점 → C", () => {
    expect(gradeFromScore(20)).toBe("C");
    expect(gradeFromScore(59)).toBe("C");
  });

  it("20점 미만 → D", () => {
    expect(gradeFromScore(19)).toBe("D");
    expect(gradeFromScore(0)).toBe("D");
  });

  it("옛 경계(80/60/40)로 되돌아가면 red", () => {
    expect(gradeFromScore(80)).toBe("B"); // 옛 경계면 A
    expect(gradeFromScore(40)).toBe("C"); // 옛 경계도 C 지만 아래 줄이 가른다
    expect(gradeFromScore(39)).toBe("C"); // 옛 경계면 D
    expect(gradeFromScore(85)).not.toBe("A");
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

// ── calcRawScore + 품질 보정 ───────────────────────────────────
describe("calcRawScore 품질 보정", () => {
  it("고등학교에 highSchoolType 없으면 기존 점수와 동일", () => {
    const high = [makeSchool(900)]; // +5
    expect(calcRawScore([], [], high)).toBe(55); // 50 + 5
  });

  it("특목고 1km 이내 → 거리(+5) + 품질(+7) = 62", () => {
    const high = [{ distance: "800", highSchoolType: "특수목적고등학교" }];
    expect(calcRawScore([], [], high)).toBe(62); // 50 + 5 + 7
  });

  it("자율고 1km 초과 → 거리(+2) + 품질(+5) = 57", () => {
    const high = [{ distance: "1500", highSchoolType: "자율고등학교" }];
    expect(calcRawScore([], [], high)).toBe(57); // 50 + 2 + 5
  });

  it("특성화고만 → 거리(+5) + 품질(-2) = 53", () => {
    const high = [{ distance: "800", highSchoolType: "특성화고등학교" }];
    expect(calcRawScore([], [], high)).toBe(53); // 50 + 5 + (-2)
  });

  it("품질 보정으로 100 을 넘어도 안 자른다", () => {
    const elem = [makeSchool(100), makeSchool(200), makeSchool(300)]; // +45
    const high = [{ distance: "100", highSchoolType: "특수목적고등학교" }]; // +5 +7
    expect(calcRawScore(elem, [], high)).toBe(107); // 50 + 45 + 5 + 7
  });

  it("품질 보정으로 0 미만 시 클램핑", () => {
    // 특성화고 여러 개로 음수 가능성 테스트 (기본 50이므로 실제로는 어려움)
    expect(calcRawScore([], [], [])).toBeGreaterThanOrEqual(0);
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

// ── calcRawScore + 밀도 보정 ──────────────────────────────────
describe("calcRawScore 밀도 보정", () => {
  it("allSchools 미전달 → 기존 점수와 동일", () => {
    expect(calcRawScore([makeSchool(300)], [], [])).toBe(65); // 50 + 15
  });

  it("allSchools에 학생수 있으면 밀도 보정 적용", () => {
    const all = [{ students: 500, classes: 20 }]; // 25명/반 → +2
    expect(calcRawScore([], [], [], all)).toBe(52); // 50 + 0 + 2
  });

  it("밀도 보정 합산 (100 이하 구간)", () => {
    const elem = [makeSchool(100), makeSchool(200), makeSchool(300)]; // +45
    const all = [{ students: 500, classes: 20 }]; // +2
    // 50 + 45 + 2 = 97 → 97 (100 이하이므로 OK)
    expect(calcRawScore(elem, [], [], all)).toBe(97);
  });

  it("밀도 보정 + 품질 보정 합산", () => {
    const high = [{ distance: "800", highSchoolType: "특수목적고등학교" }]; // +5+7
    const all = [{ students: 500, classes: 20 }]; // +2
    // 50 + 5 + 7 + 2 = 64
    expect(calcRawScore([], [], high, all)).toBe(64);
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

// ── 세션524: 거울 상수 동기화 가드 ────────────────────────────
// 수집기(.mjs)는 `src/constants/scoringTiers.ts` 를 import 할 수 없어 값을 복제한다.
// **직접 import 해서** 대조한다 — 소스를 정규식으로 긁으면 줄 끝 주석 하나에 항목이 안 잡혀
// "어긋난 채 초록불"이 된다(세션520 실증, transit-match.test.mjs 답습).
describe("재척도 상수 동기화 (scoringTiers.ts ↔ schools-neis.mjs)", () => {
  it("앵커 표가 한 칸도 어긋나지 않는다", async () => {
    const { SCHOOL_RESCALE_ANCHORS } = await import("@/constants/scoringTiers");
    expect(RESCALE_ANCHORS_MIRROR).toEqual(SCHOOL_RESCALE_ANCHORS.map((a) => ({ raw: a.raw, score: a.score })));
  });

  it("등급 경계표가 한 칸도 어긋나지 않는다", async () => {
    const { SCHOOL_GRADE_TIERS, SCHOOL_GRADE_FALLBACK } = await import("@/constants/scoringTiers");
    expect(GRADE_TIERS_MIRROR).toEqual(SCHOOL_GRADE_TIERS.map((t) => ({ min: t.min, grade: t.grade })));
    expect(GRADE_FALLBACK_MIRROR).toBe(SCHOOL_GRADE_FALLBACK);
  });

  it("두 구현이 같은 값을 낸다 — 산식이 갈리면 red", async () => {
    const tiers = await import("@/constants/scoringTiers");
    for (let raw = 40; raw <= 220; raw += 1) {
      expect(rescaleSchoolScore(raw)).toBe(tiers.rescaleSchoolScore(raw));
    }
  });

  it("등급 경계는 앵커 값 위에 놓인다 — B=중앙값 · C=하위10%", async () => {
    // 경계가 앵커에서 떨어져 나가면 "B 이상 = 중간 이상" 이라는 뜻이 깨진다.
    const { SCHOOL_RESCALE_ANCHORS } = await import("@/constants/scoringTiers");
    const anchorScores = new Set(SCHOOL_RESCALE_ANCHORS.map((a) => a.score));
    expect(anchorScores.has(GRADE_TIERS_MIRROR.find((t) => t.grade === "B")?.min ?? -1)).toBe(true);
    expect(anchorScores.has(GRADE_TIERS_MIRROR.find((t) => t.grade === "C")?.min ?? -1)).toBe(true);
  });
});

// ── 세션524: 관측값 앵커 가드 ─────────────────────────────────
// 파생 가드(상수↔거울 대조)만 두면 **상수를 잘못 바꿔도 양쪽이 함께 따라가며 전부 초록**이 된다
// (세션514 실증). 그래서 상수가 스스로 근거로 든 **실측 분위**를 여기 적고 그 근방인지 본다.
// 적는 값은 티어가 아니라 관측값이라 "숫자를 테스트에 박지 마라" 원칙과 충돌하지 않는다.
describe("관측값 앵커 (2026-08-23 전수 실측, n=2,771)", () => {
  // schools.nearby_schools 를 calcRawScore 로 재계산한 원점수 분위
  const OBSERVED = { p10: 76, median: 124, p90: 162 };

  it("앵커가 실측 분위의 ±15% 안에 있다", () => {
    const byScore = Object.fromEntries(RESCALE_ANCHORS_MIRROR.map((a) => [a.score, a.raw]));
    for (const [score, obs] of [[20, OBSERVED.p10], [60, OBSERVED.median], [100, OBSERVED.p90]]) {
      const ratio = byScore[score] / obs;
      expect(ratio).toBeGreaterThan(0.85);
      expect(ratio).toBeLessThan(1.15);
    }
  });

  it("만점 앵커가 중앙값보다 확실히 높다 — 만점이 '상위 10%'라는 뜻을 지킨다", () => {
    const byScore = Object.fromEntries(RESCALE_ANCHORS_MIRROR.map((a) => [a.score, a.raw]));
    expect(byScore[100]).toBeGreaterThan(byScore[60]);
    expect(byScore[100]).toBeGreaterThanOrEqual(OBSERVED.median * 1.2);
  });
});

// 세션539 B-1: main() 이 schools 테이블을 훑던 무정렬 OFFSET → 고유키(apartment_id) 커서
// 회귀 가드. 같은 파일 rescaleOnly()(§L444)는 이미 .order("apartment_id") 를 붙인 정답
// 패턴이었는데 main() 만 빠져 있었다(unordered-pagination-loses-rows.md §1). select 문자열
// 리터럴 조각으로 고정 — toContain("apartment_id") 류는 옆 옵션 줄에 오매칭된다
// ([[guards-must-be-mutation-tested]] §"소스 grep 가드").
// 세션567 — 초등 필터만 isElementarySchoolDoc(분교장 포함·개교 예정 제외)를 쓰고
// 중·고는 기존 isSchoolPlace(이름) 그대로인지 소스로 확인한다. main() 은 Supabase/Kakao 를
// 실제로 호출해 무거운 mocking 없이는 단위테스트가 어렵다
// ([[guards-must-be-mutation-tested]] "테스트가 실제로 지나는 경로를 지나는가").
describe("초등 필터 배선 — isElementarySchoolDoc, 중/고는 isSchoolPlace 유지 (세션567)", () => {
  it("elem 필터는 isElementarySchoolDoc(s) 를 쓴다", () => {
    expect(COLLECTOR_SRC).toMatch(
      /elem\.filter\([\s\S]{0,120}?=>\s*isElementarySchoolDoc\(s\)\)/,
    );
  });

  it("middle/high 필터는 여전히 isSchoolPlace\\(s\\.place_name\\) 를 쓴다", () => {
    expect(COLLECTOR_SRC).toMatch(/middle\.filter\([\s\S]{0,120}?=>\s*isSchoolPlace\(s\.place_name\)\)/);
    expect(COLLECTOR_SRC).toMatch(/high\.filter\([\s\S]{0,120}?=>\s*isSchoolPlace\(s\.place_name\)\)/);
  });

  it("공유 모듈을 import 하고 로컬 SCHOOL_SUFFIX_RE 선언이 없다", () => {
    expect(COLLECTOR_SRC).toMatch(
      /import \{ isSchoolPlace, isElementarySchoolDoc \} from "\.\/_school-place\.mjs";/,
    );
    expect(COLLECTOR_SRC).not.toMatch(/const\s+SCHOOL_SUFFIX_RE\s*=/);
  });
});

describe("schools 페이징 — 고유키 커서 회귀 가드 (세션539 B-1)", () => {
  it("main() 은 selectAll(..., sb, \"apartment_id\") 커서로 schools 를 훑는다", () => {
    expect(COLLECTOR_SRC.includes('.select("apartment_id, nearby_schools, updated_at")')).toBe(true);
    expect(COLLECTOR_SRC).toMatch(
      /selectAll\(\(s\) => s\.from\("schools"\)\.select\("apartment_id, nearby_schools, updated_at"\), sb, "apartment_id"\)/,
    );
  });

  it("main() 은 schools 를 무정렬 .range() 손제작 루프로 훑지 않는다", () => {
    // rescaleOnly() 는 이미 .order() 를 붙인 별개 루프라 이 검사 대상이 아니다 — main() 의
    // allSchoolRows 조회만 겨눈다.
    expect(COLLECTOR_SRC).not.toMatch(
      /allSchoolRows[\s\S]{0,40}\[\][\s\S]{0,300}?from\("schools"\)[\s\S]{0,200}?\.range\(/,
    );
  });
});

// ── 세션567: --ids 지정 단지만 다시 보기 ────────────────────────
// 배경 — 대전 서구 18행(탄방초 용문분교장 영향)의 schools.updated_at 이 전부 2026-09-22 라
// buildEnrichedIds 의 30일 skip 에 걸려 10/22 이후에야 자연 재처리된다. 지정한 id 는 그
// skip 을 무시하고 즉시 재처리한다.
describe("parseIdsArg — --ids= 인자 해석", () => {
  it("--ids=a,b,c → [\"a\",\"b\",\"c\"]", () => {
    expect(parseIdsArg(["node", "script.mjs", "--ids=a,b,c"])).toEqual(["a", "b", "c"]);
  });

  it("공백이 섞여도 trim 한다", () => {
    expect(parseIdsArg(["--ids= a , b ,c "])).toEqual(["a", "b", "c"]);
  });

  it("빈 항목(연속 쉼표)은 걸러낸다", () => {
    expect(parseIdsArg(["--ids=a,,b,"])).toEqual(["a", "b"]);
  });

  it("--ids 인자가 없으면 null", () => {
    expect(parseIdsArg(["node", "script.mjs", "--dry-run"])).toBeNull();
  });

  it("--ids= (값이 빈 문자열)이면 빈 배열", () => {
    expect(parseIdsArg(["--ids="])).toEqual([]);
  });

  it("단일 id 도 배열로", () => {
    expect(parseIdsArg(["--ids=ah-2021910187"])).toEqual(["ah-2021910187"]);
  });
});

describe("selectTargetsByIds — 대상 선정(좌표 없음 제외·존재하지 않는 id 보고)", () => {
  const apts = [
    { id: "a", name: "A아파트", lat: 37.1, lng: 127.1 },
    { id: "b", name: "B아파트", lat: null, lng: null }, // 좌표 없음
    { id: "c", name: "C아파트", lat: 37.2, lng: 127.2 },
  ];

  it("좌표 있는 id 만 targets 에 들어간다", () => {
    const { targets } = selectTargetsByIds(apts, ["a", "c"]);
    expect(targets.map((t) => t.id)).toEqual(["a", "c"]);
  });

  it("좌표 없는 id 는 targets 에서 빠지고 noCoord 에 보고된다", () => {
    const { targets, noCoord } = selectTargetsByIds(apts, ["a", "b"]);
    expect(targets.map((t) => t.id)).toEqual(["a"]);
    expect(noCoord).toEqual([{ id: "b", name: "B아파트" }]);
  });

  it("존재하지 않는 id 는 missing 에 보고되고 targets 에서 빠진다", () => {
    const { targets, missing } = selectTargetsByIds(apts, ["a", "zzz-not-exist"]);
    expect(targets.map((t) => t.id)).toEqual(["a"]);
    expect(missing).toEqual(["zzz-not-exist"]);
  });

  it("forceIds 는 지정한 id 전부를 담는다(좌표 없음/존재하지 않음 포함) — 30일 skip 무시 대상", () => {
    const { forceIds } = selectTargetsByIds(apts, ["a", "b", "zzz-not-exist"]);
    expect(forceIds).toEqual(new Set(["a", "b", "zzz-not-exist"]));
  });

  it("혼합 — targets/missing/noCoord 이 각각 정확히 갈린다", () => {
    const { targets, missing, noCoord } = selectTargetsByIds(apts, ["a", "b", "c", "zzz"]);
    expect(targets.map((t) => t.id)).toEqual(["a", "c"]);
    expect(missing).toEqual(["zzz"]);
    expect(noCoord).toEqual([{ id: "b", name: "B아파트" }]);
  });
});

// 세션567 — main() 이 forceIds 로 enrichedIds(30일 skip)를 실제로 무시하는지 소스로 확인한다.
// main() 은 Supabase/Kakao 를 실제로 호출해 무거운 mocking 없이는 단위테스트가 어렵다.
describe("--ids 배선 — 30일 skip 무시가 실제로 걸려 있다 (세션567)", () => {
  it("forceIds 에 있는 id 를 enrichedIds 에서 지운다 — 주석 처리(무효화)되지 않은 실행문", () => {
    // 줄머리(들여쓰기 허용)에 "//" 가 없는 실행문만 인정한다 — 주석 처리해도 부분
    // 문자열은 그대로 남으므로 좌변(줄머리)까지 고정해야 무효화를 잡는다
    // ([[guards-must-be-mutation-tested]] "소스 grep 가드는 주석 처리에도 매칭된다").
    expect(COLLECTOR_SRC).toMatch(
      /^[ \t]*for \(const id of forceIds\) enrichedIds\.delete\(id\);/m,
    );
  });

  it("parseIdsArg/selectTargetsByIds 를 main() 에서 실제로 부른다", () => {
    expect(COLLECTOR_SRC).toMatch(/const\s+idsArg\s*=\s*parseIdsArg\(process\.argv\);/);
    expect(COLLECTOR_SRC).toMatch(/const\s+sel\s*=\s*selectTargetsByIds\(apts,\s*idsArg\);/);
  });
});

// ── 세션567: SCHOOLINFO_KEY 없이 로컬 실쓰기 차단 ────────────────
// 배경 — 운영 워크플로 2개(collect-schools.yml·collect-naver-listings-incremental.yml)는
// SCHOOLINFO_KEY 를 주입해 calcDensityBonus(±5 원점수) 를 반영하지만 로컬 .env.local 에는
// 없다. 그대로 로컬에서 실제 쓰기를 돌리면 같은 단지가 다른 잣대로 채점돼 운영 DB 에 섞인다.
describe("shouldRefuseLocalWriteWithoutSchoolInfo — 로컬 실쓰기 차단 판정 (세션567)", () => {
  it("로컬 + 열쇠없음 + 실제 쓰기(dry-run 아님·rescale-only 아님) → true", () => {
    expect(shouldRefuseLocalWriteWithoutSchoolInfo({ dryRun: false, rescaleOnly: false, hasSchoolInfoKey: false, inCI: false })).toBe(true);
  });

  it("dry-run 이면 → false (미리보기만이라 안전)", () => {
    expect(shouldRefuseLocalWriteWithoutSchoolInfo({ dryRun: true, rescaleOnly: false, hasSchoolInfoKey: false, inCI: false })).toBe(false);
  });

  it("rescale-only 면 → false (외부 API·점수 재료 재수집 0, 이미 저장된 값만 재계산)", () => {
    expect(shouldRefuseLocalWriteWithoutSchoolInfo({ dryRun: false, rescaleOnly: true, hasSchoolInfoKey: false, inCI: false })).toBe(false);
  });

  it("CI(GitHub Actions) 안이면 → false (워크플로가 열쇠를 항상 주입, 기존 경고만 동작 유지)", () => {
    expect(shouldRefuseLocalWriteWithoutSchoolInfo({ dryRun: false, rescaleOnly: false, hasSchoolInfoKey: false, inCI: true })).toBe(false);
  });

  it("SCHOOLINFO_KEY 가 있으면 → false (로컬이어도 같은 잣대로 채점되므로 안전)", () => {
    expect(shouldRefuseLocalWriteWithoutSchoolInfo({ dryRun: false, rescaleOnly: false, hasSchoolInfoKey: true, inCI: false })).toBe(false);
  });

  it("네 조건이 전부 위험(false) 방향이어야만 true — 어느 하나라도 안전 방향이면 false", () => {
    const safeCombos = [
      { dryRun: true, rescaleOnly: false, hasSchoolInfoKey: false, inCI: false },
      { dryRun: false, rescaleOnly: true, hasSchoolInfoKey: false, inCI: false },
      { dryRun: false, rescaleOnly: false, hasSchoolInfoKey: true, inCI: false },
      { dryRun: false, rescaleOnly: false, hasSchoolInfoKey: false, inCI: true },
    ];
    for (const combo of safeCombos) {
      expect(shouldRefuseLocalWriteWithoutSchoolInfo(combo)).toBe(false);
    }
  });
});

describe("shouldRefuseLocalWriteWithoutSchoolInfo 호출 배선 — main() 안 위치 (세션567)", () => {
  it("main() 이 이 함수를 실제로 부르고 true 면 exit(1) 한다 — 주석 처리되지 않은 실행문", () => {
    expect(COLLECTOR_SRC).toMatch(
      /^[ \t]*if \(shouldRefuseLocalWriteWithoutSchoolInfo\(\{[\s\S]{0,200}?\}\)\) \{[\s\S]{0,300}?process\.exit\(1\);/m,
    );
  });

  it("inCI 판정은 process.env.GITHUB_ACTIONS === \"true\" 를 쓴다", () => {
    expect(COLLECTOR_SRC).toMatch(
      /const\s+inCI\s*=\s*process\.env\.GITHUB_ACTIONS\s*===\s*"true";/,
    );
  });

  it("호출 위치가 apartments 대상 조회(selectAll)보다 앞에 있다 — DB 접근 전에 멈춰야 한다", () => {
    // "shouldRefuseLocalWriteWithoutSchoolInfo({" 만으로 indexOf 하면 파일 상단의
    // 함수 선언(`export function shouldRefuseLocalWriteWithoutSchoolInfo({ dryRun, ... })`)에
    // 먼저 걸려 호출부 위치를 검사하지 못한다([[guards-must-be-mutation-tested]] "소스 grep
    // 가드는 선언부에도 매칭된다") — `if (` 를 좌변에 고정해 호출문만 잡는다.
    const guardCallIdx = COLLECTOR_SRC.indexOf("if (shouldRefuseLocalWriteWithoutSchoolInfo({");
    const selectAptsIdx = COLLECTOR_SRC.indexOf('selectAll((s) => s.from("apartments")');
    expect(guardCallIdx).toBeGreaterThan(-1);
    expect(selectAptsIdx).toBeGreaterThan(-1);
    expect(guardCallIdx).toBeLessThan(selectAptsIdx);
  });
});

// ── 세션568: --limit 의미 수정 — 오래된 순 + 굶주림 방지 ────────────
// 배경 — 옛 로직(targets.slice(0, limit))은 좌표 있는 단지를 id 순으로 앞에서부터 잘라
// skip 판정보다 먼저 상한을 적용했다. --limit 을 걸면 id 순 뒤쪽의 진짜 오래된 단지가
// 영영 처리되지 않았다(굶주림). selectProcessList 는 신선한 행을 먼저 걸러내고, 나머지를
// updated_at 오래된 순(행 없음/null 이 맨 앞)으로 정렬한 뒤 상한을 자른다.
describe("selectProcessList — 오래된 순 상한 + 굶주림 방지 (세션568)", () => {
  /**
   * @param {string} id
   * @param {Record<string, unknown>} [extra]
   */
  const T = (id, extra = {}) => ({ id, name: id, lat: 37.0, lng: 127.0, ...extra });

  it("id 순서상 뒤쪽에 몰린 오래된 행도 상한 안에 들어간다 — 굶주림 방지", () => {
    // a·b·c 는 신선(최근), z 는 오래됨(가장 먼저 처리돼야 함). id 순으로 자르면 z 는 영영 안 뽑힌다.
    const targets = [T("a"), T("b"), T("c"), T("z")];
    const enrichedIds = new Set(); // 전부 처리 대상(신선하지 않음) — updated_at 로만 순서를 가른다
    const updatedAtById = new Map([
      ["a", "2026-09-20T00:00:00.000Z"],
      ["b", "2026-09-21T00:00:00.000Z"],
      ["c", "2026-09-22T00:00:00.000Z"],
      ["z", "2020-01-01T00:00:00.000Z"], // 가장 오래됨 — id 순으로는 맨 뒤지만 결과에선 맨 앞
    ]);
    const { toProcess } = selectProcessList(targets, enrichedIds, updatedAtById, 1);
    expect(toProcess.map((t) => t.id)).toEqual(["z"]);
  });

  it("신선한(30일 이내 보강 완료) 단지는 상한 안에서도 제외된다", () => {
    const targets = [T("fresh"), T("stale")];
    const enrichedIds = new Set(["fresh"]);
    const updatedAtById = new Map([
      ["fresh", "2026-09-23T00:00:00.000Z"],
      ["stale", "2020-01-01T00:00:00.000Z"],
    ]);
    const { toProcess, skippedFresh } = selectProcessList(targets, enrichedIds, updatedAtById, 10);
    expect(toProcess.map((t) => t.id)).toEqual(["stale"]);
    expect(skippedFresh).toBe(1);
  });

  it("오래된 순 정렬 — updated_at 없음(null/undefined)이 가장 먼저 처리된다", () => {
    const targets = [T("has-date"), T("never-collected")];
    const enrichedIds = new Set();
    const updatedAtById = new Map([["has-date", "2026-01-01T00:00:00.000Z"]]); // never-collected 는 맵에 없음
    const { toProcess } = selectProcessList(targets, enrichedIds, updatedAtById, 10);
    expect(toProcess.map((t) => t.id)).toEqual(["never-collected", "has-date"]);
  });

  it("--ids(forceIds) 지정분은 30일 skip 도 상한도 무시하고 전부 포함된다", () => {
    // forced 2건 + limit 1 이어도 forced 는 전부 포함되고, 남는 자리가 있으면 rest 에서 채운다.
    const targets = [T("forced-1"), T("forced-2"), T("rest-old"), T("rest-new")];
    const enrichedIds = new Set(["forced-1"]); // forceIds 가 없으면 skip 됐을 것 — forceIds 가 이를 무시
    const updatedAtById = new Map([
      ["forced-1", "2026-09-23T00:00:00.000Z"],
      ["forced-2", "2026-09-23T00:00:00.000Z"],
      ["rest-old", "2020-01-01T00:00:00.000Z"],
      ["rest-new", "2026-09-23T00:00:00.000Z"],
    ]);
    const forceIds = new Set(["forced-1", "forced-2"]);
    const { toProcess } = selectProcessList(targets, enrichedIds, updatedAtById, 1, forceIds);
    // forced 2건이 상한(1)을 넘어도 전부 포함 — rest 는 상한 초과로 0건 채택
    expect(toProcess.map((t) => t.id)).toEqual(["forced-1", "forced-2"]);
  });

  it("limit 이 Infinity 면 전부 포함(오래된 순 정렬만)", () => {
    const targets = [T("a"), T("b")];
    const enrichedIds = new Set();
    const updatedAtById = new Map([
      ["a", "2026-09-23T00:00:00.000Z"],
      ["b", "2020-01-01T00:00:00.000Z"],
    ]);
    const { toProcess, deferred } = selectProcessList(targets, enrichedIds, updatedAtById, Infinity);
    expect(toProcess.map((t) => t.id)).toEqual(["b", "a"]);
    expect(deferred).toBe(0);
  });
});

describe("main() 배선 — selectProcessList 를 실제로 쓴다 (세션568)", () => {
  it("targets 는 candidates.slice(0, limit) 대신 selectProcessList 의 toProcess 다", () => {
    expect(COLLECTOR_SRC).toMatch(
      /const\s*\{\s*toProcess:\s*targets,\s*skippedFresh,\s*deferred\s*\}\s*=\s*selectProcessList\(candidates,\s*enrichedIds,\s*updatedAtById,\s*limit,\s*forceIds\);/,
    );
    // 옛 "candidates 확정 직후 slice(0, limit)" 패턴이 되살아나면 굶주림이 재발한다
    expect(COLLECTOR_SRC).not.toMatch(/targets\s*=\s*targets\.slice\(0,\s*limit\);/);
  });
});

// ── 세션568: schools.updated_at 트리거를 nearby_schools 컬럼 지정으로 좁힌 마이그레이션 ──
describe("마이그레이션 — schools 트리거가 nearby_schools 컬럼 지정이다 (세션568)", () => {
  const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "supabase", "migrations");
  const MIGRATION_FILE = "20260924000300_schools_updated_trigger_nearby_only.sql";
  const migrationSql = readFileSync(path.join(MIGRATIONS_DIR, MIGRATION_FILE), "utf8");

  it("CREATE TRIGGER trg_schools_updated 가 UPDATE OF nearby_schools 를 쓴다", () => {
    expect(migrationSql).toMatch(
      /CREATE TRIGGER trg_schools_updated\s+BEFORE UPDATE OF nearby_schools ON public\.schools/,
    );
  });

  it("DROP TRIGGER IF EXISTS 로 옛 트리거를 먼저 지운다", () => {
    expect(migrationSql).toMatch(/DROP TRIGGER IF EXISTS trg_schools_updated ON public\.schools;/);
  });

  it("자체검사(DO $$ … RAISE EXCEPTION)가 있다", () => {
    expect(migrationSql).toMatch(/DO \$\$[\s\S]*RAISE EXCEPTION[\s\S]*\$\$;/);
  });

  it("되돌리기 파일이 존재하고 원래 형태(컬럼 지정 없는 BEFORE UPDATE)로 되돌린다", () => {
    const rollbackSql = readFileSync(
      path.join(MIGRATIONS_DIR, "_rollbacks", "20260924000301_rollback_schools_updated_trigger_nearby_only.sql"),
      "utf8",
    );
    expect(rollbackSql).toMatch(/CREATE TRIGGER trg_schools_updated\s+BEFORE UPDATE ON public\.schools/);
    expect(rollbackSql).not.toMatch(/UPDATE OF nearby_schools/);
  });
});

// ── searchKakao — SC4 분류 + is_end 까지 최대 3쪽 (세션569) ─────────
// 세션569 측정: 분류 없이 1쪽 15건만 받으면 표본 40곳 중 24곳에서 학교 목록이 잘렸다.
// fetchWithRetry 를 가짜 응답으로 바꿔 요청 URL·쪽 반복·상한·중복 제거를 본다.
describe("searchKakao — SC4 + is_end 까지 최대 3쪽 (세션569)", () => {
  const fetchMock = vi.mocked(sharedMock.fetchWithRetry);

  /**
   * @param {number} n 문서 수
   * @param {boolean} isEnd
   * @param {number} [startId]
   */
  function page(n, isEnd, startId = 1) {
    const documents = Array.from({ length: n }, (_, i) => ({ id: String(startId + i), place_name: `학교${startId + i}`, distance: String(100 + startId + i) }));
    return /** @type {any} */ ({ json: async () => ({ documents, meta: { is_end: isEnd } }) });
  }

  it("요청 URL 에 category_group_code=SC4 와 기존 파라미터(sort·radius·size)가 들어간다", async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(page(3, true));
    await searchKakao(37.5, 127.0, "초등학교", 1000);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("category_group_code=SC4");
    expect(url).toContain("sort=distance");
    expect(url).toContain("radius=1000");
    expect(url).toContain("size=15");
    expect(url).toContain("page=1");
  });

  it("1쪽 15건(is_end=false) + 2쪽 2건(is_end=true) → 17건, 호출 2회, 2쪽은 page=2", async () => {
    fetchMock.mockReset();
    vi.mocked(sharedMock.sleep).mockClear();
    fetchMock.mockResolvedValueOnce(page(15, false, 1)).mockResolvedValueOnce(page(2, true, 16));
    const docs = await searchKakao(37.5, 127.0, "중학교", 2000);
    expect(docs).toHaveLength(17);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // 쪽 사이 대기 — 2쪽이면 정확히 1번, 기존 질의 간격과 같은 100ms
    expect(sharedMock.sleep).toHaveBeenCalledTimes(1);
    expect(sharedMock.sleep).toHaveBeenCalledWith(100);
    expect(String(fetchMock.mock.calls[1][0])).toContain("page=2");
    expect(docs.map((d) => d.id)).toEqual(Array.from({ length: 17 }, (_, i) => String(i + 1))); // 쪽 순서대로 이어 붙임
  });

  it("1쪽이 is_end=true 면 호출 1회로 끝난다", async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(page(5, true));
    const docs = await searchKakao(37.5, 127.0, "고등학교", 2000);
    expect(docs).toHaveLength(5);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("meta 가 없는 응답이면 다음 쪽을 부르지 않는다(호출 1회)", async () => {
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(/** @type {any} */ ({ json: async () => ({ documents: [{ id: "1", place_name: "학교1", distance: "100" }] }) }))
      .mockResolvedValueOnce(page(15, true, 2));
    const docs = await searchKakao(37.5, 127.0, "초등학교", 1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(docs).toHaveLength(1);
  });

  it("3쪽에도 is_end=false 면 3쪽에서 멈춘다(호출 3회, 45건)", async () => {
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(page(15, false, 1))
      .mockResolvedValueOnce(page(15, false, 16))
      .mockResolvedValueOnce(page(15, false, 31))
      .mockResolvedValueOnce(page(15, false, 46));
    const docs = await searchKakao(37.5, 127.0, "중학교", 2000);
    expect(KAKAO_MAX_PAGES).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(docs).toHaveLength(45);
  });

  it("쪽 경계에서 겹친 같은 id 는 한 번만 담는다", async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(page(15, false, 1)).mockResolvedValueOnce(page(3, true, 14)); // 14·15 중복
    const docs = await searchKakao(37.5, 127.0, "초등학교", 1000);
    expect(docs).toHaveLength(16);
    expect(new Set(docs.map((d) => d.id)).size).toBe(16);
  });
});

// ── 세션569: NEIS 분교장 매칭 ──────────────────────────────────
// 픽스처 = 2026-09-24 NEIS schoolInfo 실응답(필드 일부). "탄방초등학교" 조회 → 본교+분교 2건,
// "용문분교장" 조회 → 분교 1건, "탄방초등학교 용문분교장"(카카오 표기, 공백) 조회 → 0건(INFO-200).
const { branchQueryName, pickBranchRow } = await import("./schools-neis.mjs");
const NEIS_ROW_TANBANG = { SCHUL_NM: "대전탄방초등학교", SCHUL_KND_SC_NM: "초등학교", FOND_SC_NM: "공립", ATPT_OFCDC_SC_CODE: "G10", SD_SCHUL_CODE: "7451116", FOND_YMD: "19740301" };
const NEIS_ROW_YONGMUN = { SCHUL_NM: "대전탄방초등학교용문분교장", SCHUL_KND_SC_NM: "초등학교", FOND_SC_NM: "공립", ATPT_OFCDC_SC_CODE: "G10", SD_SCHUL_CODE: "7451353", FOND_YMD: "20250901" };
const KAKAO_YONGMUN = "탄방초등학교 용문분교장"; // DB schools.nearby_schools 실표기(18행)

describe("branchQueryName — 분교 이름이면 분교 부분만 (세션569)", () => {
  it("카카오 실표기 '탄방초등학교 용문분교장' → '용문분교장'", () => {
    expect(branchQueryName(KAKAO_YONGMUN)).toBe("용문분교장");
  });
  it("공백 없는 표기도 같은 결과", () => {
    expect(branchQueryName("탄방초등학교용문분교장")).toBe("용문분교장");
  });
  it("분교가 아닌 학교는 null — 기존 조회 경로 그대로", () => {
    expect(branchQueryName("대전탄방초등학교")).toBeNull();
    expect(branchQueryName("강남중학교")).toBeNull();
  });
});

describe("pickBranchRow — 끝 일치 + 유일할 때만 (세션569)", () => {
  it("'용문분교장' 실응답 1건 → 분교 행(7451353)", () => {
    expect(pickBranchRow(KAKAO_YONGMUN, [NEIS_ROW_YONGMUN])?.SD_SCHUL_CODE).toBe("7451353");
  });
  it("'탄방초등학교' 실응답(본교+분교) → 본교가 아니라 분교 행", () => {
    expect(pickBranchRow(KAKAO_YONGMUN, [NEIS_ROW_TANBANG, NEIS_ROW_YONGMUN])?.SD_SCHUL_CODE).toBe("7451353");
  });
  it("본교 행만 있으면 null — 본교 정보를 분교에 붙이지 않는다", () => {
    expect(pickBranchRow(KAKAO_YONGMUN, [NEIS_ROW_TANBANG])).toBeNull();
  });
  it("(가상) 같은 분교장 이름이 다른 본교 밑에 둘 → 카카오 이름에 본교가 없으면 null, 있으면 그 본교 것", () => {
    const other = { ...NEIS_ROW_YONGMUN, SCHUL_NM: "경기가상초등학교용문분교장", SD_SCHUL_CODE: "9999999" };
    expect(pickBranchRow("용문분교장", [NEIS_ROW_YONGMUN, other])).toBeNull();
    expect(pickBranchRow(KAKAO_YONGMUN, [NEIS_ROW_YONGMUN, other])?.SD_SCHUL_CODE).toBe("7451353");
  });
});

describe("fetchNeisSchoolInfo 분교장 배선 — NEIS_KEY 있을 때 (세션569)", () => {
  /** @param {Array<Record<string, any>>} rows */
  const resp = (rows) => /** @type {any} */ ({ json: async () => (rows.length ? { schoolInfo: [{ head: [] }, { row: rows }] } : { RESULT: { CODE: "INFO-200" } }) });

  /** NEIS_KEY 를 켠 새 모듈 인스턴스(모듈 상수라 다시 불러와야 한다) */
  async function freshWithKey() {
    process.env.NEIS_KEY = "test-neis";
    vi.resetModules();
    const mod = await import("./schools-neis.mjs");
    const shared = await import("./_shared.mjs");
    delete process.env.NEIS_KEY;
    return { mod, fetchMock: vi.mocked(shared.fetchWithRetry) };
  }

  it("분교 이름은 분교 부분('용문분교장')으로 조회하고 분교 행 정보를 붙인다", async () => {
    const { mod, fetchMock } = await freshWithKey();
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(resp([NEIS_ROW_TANBANG, NEIS_ROW_YONGMUN]));
    const info = await mod.fetchNeisSchoolInfo(KAKAO_YONGMUN);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain(`SCHUL_NM=${encodeURIComponent("용문분교장")}`);
    expect(url).not.toContain(encodeURIComponent(KAKAO_YONGMUN));
    expect(url).toContain("pSize=100");
    expect(info?.neisCode).toBe("7451353");
    expect(info?.schoolType).toBe("공립");
    expect(info?.founded).toBe(2025);
  });

  it("분교 행을 못 맞추면 null — 본교(rows[0])로 떨어지지 않는다", async () => {
    const { mod, fetchMock } = await freshWithKey();
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(resp([NEIS_ROW_TANBANG]));
    expect(await mod.fetchNeisSchoolInfo(KAKAO_YONGMUN)).toBeNull();
  });

  it("분교가 아닌 학교는 옛 경로 그대로(원래 이름·pSize=5·정확 일치 우선)", async () => {
    const { mod, fetchMock } = await freshWithKey();
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(resp([NEIS_ROW_TANBANG, NEIS_ROW_YONGMUN]));
    const info = await mod.fetchNeisSchoolInfo("대전탄방초등학교");
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain(`SCHUL_NM=${encodeURIComponent("대전탄방초등학교")}`);
    expect(url).toContain("pSize=5");
    expect(info?.neisCode).toBe("7451116");
  });

  it("실행 끝에 '분교장 미매칭 N' 을 로그로 남긴다 — 주석 아닌 실행문", () => {
    expect(COLLECTOR_SRC).toMatch(/^[ \t]*if \(NEIS_KEY\) log\(PHASE, `분교장 NEIS 매칭 \$\{neisBranchMatched\} · 분교장 미매칭 \$\{neisBranchUnmatched\}`\);/m);
  });
});

// ── 세션569: --ids 경로의 불필요한 조회 제거 ────────────────────
// --ids 면 대상이 전부 forceIds 라 전체 schools 조회(30일 skip·오래된 순 정렬 재료)가 쓰이지
// 않고, 옛 값(oldById)은 dry-run 출력에만 쓰인다. 줄머리 고정 = 주석 처리 무효화도 잡는다.
describe("--ids 조회 절약 배선 (세션569)", () => {
  it("--ids 면 전체 schools 조회를 건너뛴다(없으면 옛 조회 그대로)", () => {
    expect(COLLECTOR_SRC).toMatch(
      /^[ \t]*const allSchoolRows = idsArg != null \? \[\] : \/\*\* @type \{Array<Record<string, any>>\} \*\/ \(\r?\n[ \t]*await selectAll\(\(s\) => s\.from\("schools"\)\.select\("apartment_id, nearby_schools, updated_at"\), sb, "apartment_id"\)/m,
    );
  });

  it("옛 값(oldById)은 dry-run 일 때만 조회한다", () => {
    expect(COLLECTOR_SRC).toMatch(/^[ \t]*if \(dryRun && forceIds\.size > 0\) \{/m);
    expect(COLLECTOR_SRC).not.toMatch(/^[ \t]*if \(forceIds\.size > 0\) \{/m);
  });

  it("oldById 를 읽는 곳은 dry-run 분기 안 한 곳뿐이다", () => {
    const reads = [...COLLECTOR_SRC.matchAll(/oldById\.get\(/g)];
    expect(reads).toHaveLength(1);
    const at = /** @type {number} */ (reads[0].index);
    const dryIdx = COLLECTOR_SRC.lastIndexOf("if (dryRun) {", at);
    const upsertIdx = COLLECTOR_SRC.indexOf('from("schools").upsert(', at);
    expect(dryIdx).toBeGreaterThan(-1);
    expect(upsertIdx).toBeGreaterThan(at); // 실제 쓰기(upsert)보다 앞 = dry-run 분기 안
  });
});
