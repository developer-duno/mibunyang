// @ts-check
import { describe, it, expect } from "vitest";
import { classifyMoveIn, classifyTier } from "@/lib/classify";

// NOW_YM = "YYYYMM" 형식, 현재 달
const NOW_YM = `${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, "0")}`;

/* ── 테스트 데이터 팩토리 ── */
function makeApt(overrides = {}) {
  return { completion: "202501", unsoldRate: 10, builder: "현대건설", region: "서울", gu: "강남구", ...overrides };
}

describe("classifyMoveIn — 입주 상태 분류", () => {
  // 정상 케이스: completion이 미래 → 입주예정
  it("completion >= NOW_YM → '입주예정'", () => {
    expect(classifyMoveIn(makeApt({ completion: "209912" }))).toBe("입주예정");
  });

  // 정상 케이스: 과거 + unsoldRate > 0 → 미입주
  it("과거 completion + unsoldRate > 0 → '미입주'", () => {
    expect(classifyMoveIn(makeApt({ completion: "202001", unsoldRate: 5 }))).toBe("미입주");
  });

  // 정상 케이스: 과거 + unsoldRate === 0 → 입주완료
  it("과거 completion + unsoldRate === 0 → '입주완료'", () => {
    expect(classifyMoveIn(makeApt({ completion: "202001", unsoldRate: 0 }))).toBe("입주완료");
  });

  // 에러 케이스: completion null → null
  it("completion null → null 반환", () => {
    expect(classifyMoveIn(makeApt({ completion: null }))).toBeNull();
  });

  // 에러 케이스: completion 빈 문자열 → null
  it("completion 빈 문자열 → null 반환", () => {
    expect(classifyMoveIn(makeApt({ completion: "" }))).toBeNull();
  });

  // 경계값: unsoldRate null → 0 취급 → 입주완료
  it("과거 completion + unsoldRate null → '입주완료'", () => {
    expect(classifyMoveIn(makeApt({ completion: "202001", unsoldRate: null }))).toBe("입주완료");
  });

  // 경계값: unsoldRate undefined → 0 취급 → 입주완료
  it("과거 completion + unsoldRate undefined → '입주완료'", () => {
    expect(classifyMoveIn(makeApt({ completion: "202001", unsoldRate: undefined }))).toBe("입주완료");
  });

  // 경계값: completion === NOW_YM (이번 달) → 입주예정
  it("completion === NOW_YM → '입주예정'", () => {
    expect(classifyMoveIn(makeApt({ completion: NOW_YM }))).toBe("입주예정");
  });
});

describe("classifyTier — 시공사 등급 분류", () => {
  // 정상 케이스: 1군Super 시공사 → 1군
  it("현대건설(1군Super) → '1군'", () => {
    expect(classifyTier(makeApt({ builder: "현대건설" }))).toBe("1군");
  });

  // 정상 케이스: 1군 시공사
  it("GS건설(1군) → '1군'", () => {
    expect(classifyTier(makeApt({ builder: "GS건설" }))).toBe("1군");
  });

  // 정상 케이스: 2군 시공사
  it("한화건설(2군) → '2군'", () => {
    expect(classifyTier(makeApt({ builder: "한화건설" }))).toBe("2군");
  });

  // 정상 케이스: 미등록 시공사 → 기타
  it("알 수 없는 시공사 → '기타'", () => {
    expect(classifyTier(makeApt({ builder: "무명건설" }))).toBe("기타");
  });

  // 에러 케이스: builder null → 기타
  it("builder null → '기타'", () => {
    expect(classifyTier(makeApt({ builder: null }))).toBe("기타");
  });

  // 에러 케이스: builder undefined → 기타
  it("builder undefined → '기타'", () => {
    expect(classifyTier(makeApt({ builder: undefined }))).toBe("기타");
  });

  // 에러 케이스: builder 빈 문자열 → 기타
  it("builder 빈 문자열 → '기타'", () => {
    expect(classifyTier(makeApt({ builder: "" }))).toBe("기타");
  });
});
