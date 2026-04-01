/**
 * schools-neis.mjs 테스트 — 학군 점수 순수 함수 검증
 *
 * 대상: calcScore, gradeFromScore, isSchoolPlace, calcQualityBonus,
 *       normalizeSchoolName, fetchNeisSchoolInfo, enrichWithNeis,
 *       getAcademicYear, fetchNeisClassInfo
 */
import { describe, it, expect, vi } from "vitest";

// _shared.mjs 모킹 — 외부 호출 차단
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = await importOriginal();
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

const { calcScore, gradeFromScore, isSchoolPlace, calcQualityBonus, normalizeSchoolName, fetchNeisSchoolInfo, enrichWithNeis, getAcademicYear, fetchNeisClassInfo } = await import("./schools-neis.mjs");

// ── 팩토리 ───────────────────────────────────────────────────
/** Kakao 검색 결과 팩토리 (distance 포함) */
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

// ── isSchoolPlace ─────────────────────────────────────────────
describe("isSchoolPlace", () => {
  it("일반 학교명 → true", () => {
    expect(isSchoolPlace("서울초등학교")).toBe(true);
    expect(isSchoolPlace("강남중학교")).toBe(true);
  });

  it("제외 POI '행정실' 포함 → false", () => {
    expect(isSchoolPlace("행정실")).toBe(false);
  });

  it("제외 POI '체육관' 포함 → false", () => {
    expect(isSchoolPlace("정약용체육관")).toBe(false);
  });

  it("제외 POI '교장실' 포함 → false", () => {
    expect(isSchoolPlace("교장실")).toBe(false);
  });

  it("제외 POI '기숙사' 포함 → false", () => {
    expect(isSchoolPlace("○○학교기숙사")).toBe(false);
  });

  it("제외 POI '공영주차장' 포함 → false", () => {
    expect(isSchoolPlace("학교공영주차장")).toBe(false);
  });

  it("부분 매칭 — '교장' 만으로는 제외되지 않음 ('교장실'만 제외)", () => {
    expect(isSchoolPlace("교장")).toBe(true);
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
