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

const { calcRawScore, calcScore, rescaleSchoolScore, RESCALE_ANCHORS_MIRROR, GRADE_TIERS_MIRROR, GRADE_FALLBACK_MIRROR, gradeFromScore, isSchoolPlace, calcQualityBonus, normalizeSchoolName, fetchNeisSchoolInfo, enrichWithNeis, getAcademicYear, fetchNeisClassInfo, fetchStudentBulk, enrichWithStudents, calcDensityBonus, buildEnrichedIds, STALE_DAYS_FOR_SKIP } = await import("./schools-neis.mjs");

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
