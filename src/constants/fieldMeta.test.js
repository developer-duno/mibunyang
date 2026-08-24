// @ts-check
import { describe, it, expect } from "vitest";
import { FIELD_META, FIELD_SECTIONS } from "./fieldMeta";

describe("FIELD_META", () => {
  const keys = Object.keys(FIELD_META);

  it("104개 이상 필드 정의", () => {
    expect(keys.length).toBeGreaterThanOrEqual(104);
  });

  // 모든 필드: label·section·fmt 스키마 검증
  it("모든 필드에 label(string)·section(string)·fmt(function) 존재", () => {
    for (const key of keys) {
      const meta = FIELD_META[key];
      expect(typeof meta.label, `필드 ${key}: label이 string이 아님`).toBe("string");
      expect(meta.label.length, `필드 ${key}: label이 빈 문자열`).toBeGreaterThan(0);
      expect(typeof meta.section, `필드 ${key}: section이 string이 아님`).toBe("string");
      expect(typeof meta.fmt, `필드 ${key}: fmt가 function이 아님`).toBe("function");
    }
  });

  // fmt 함수 null 안전성 검증 — 가장 중요
  it("모든 fmt 함수가 null/undefined/0 입력에 에러 없이 동작", () => {
    const edgeCases = [null, undefined, 0];
    for (const key of keys) {
      const { fmt } = FIELD_META[key];
      for (const val of edgeCases) {
        expect(() => fmt(val), `필드 ${key}: fmt(${val}) 에러 발생`).not.toThrow();
      }
    }
  });

  // 특수 케이스
  it("builder fmt: BRAND_TIER 시공사 포맷팅", () => {
    expect(FIELD_META.builder.fmt("현대건설")).toContain("1군Super");
  });

  // 세션513 — fmt 가 resolveBuilder 를 거치지 않으면 법인격 표기 변형이 전부 "(기타)"로 떨어진다.
  it("builder fmt: 법인격 표기 변형도 resolveBuilder 로 등급을 찾는다", () => {
    expect(FIELD_META.builder.fmt("지에스건설 주식회사")).toBe("지에스건설 주식회사 (1군Super)");
    expect(FIELD_META.builder.fmt("디엘이앤씨 주식회사")).toBe("디엘이앤씨 주식회사 (1군)");
  });

  // 세션513 — 조합·신탁·공공은 배점표의 "기타(3군·미등재 5점)"가 아니라 브랜드 등급의 대상이 아니다.
  it('builder fmt: 조합·신탁·공공 → "(브랜드 해당없음)" — "(기타)"는 3군 건설사로 읽힌다', () => {
    expect(FIELD_META.builder.fmt("한국토지주택공사")).toBe("한국토지주택공사 (브랜드 해당없음)");
    expect(FIELD_META.builder.fmt("(주)무궁화신탁")).toContain("브랜드 해당없음");
    expect(FIELD_META.builder.fmt("둔촌주공아파트주택재건축정비사업조합")).toContain("브랜드 해당없음");
  });

  it("builder fmt: 미등록 시공사 → (기타)", () => {
    expect(FIELD_META.builder.fmt("무명건설")).toContain("기타");
  });

  it('units fmt: 1 이하 → "정보 없음"', () => {
    expect(FIELD_META.units.fmt(1)).toBe("정보 없음");
    expect(FIELD_META.units.fmt(0)).toBe("정보 없음");
  });

  it('units fmt: 정상 → "X,XXX세대"', () => {
    expect(FIELD_META.units.fmt(1500)).toContain("세대");
  });

  it('subwayDist fmt: 9000 이상 → "없음(9999)"', () => {
    expect(FIELD_META.subwayDist.fmt(9999)).toContain("없음");
  });

  // 세션465: KTX/IC 수집 sentinel = 99 (측정 반경 밖) — "99km" 실측치 위장 차단
  it('ktxDist fmt: sentinel 99 → "반경 밖", 실측치는 km 표시', () => {
    expect(FIELD_META.ktxDist.fmt(99)).toBe("반경 밖");
    expect(FIELD_META.ktxDist.fmt(12.5)).toBe("12.5km");
    expect(FIELD_META.ktxDist.fmt(null)).toBe("—");
    expect(FIELD_META.ktxDist.isDefault?.(99)).toBe(true);
    expect(FIELD_META.ktxDist.isDefault?.(12.5)).toBe(false);
  });

  it('icDist fmt: sentinel 99 → "반경 밖", 실측치는 km 표시', () => {
    expect(FIELD_META.icDist.fmt(99)).toBe("반경 밖");
    expect(FIELD_META.icDist.fmt(2.3)).toBe("2.3km");
    expect(FIELD_META.icDist.fmt(null)).toBe("—");
    expect(FIELD_META.icDist.isDefault?.(99)).toBe(true);
    expect(FIELD_META.icDist.isDefault?.(2.3)).toBe(false);
  });

  it('noxious fmt: 빈 배열 → "없음"', () => {
    expect(FIELD_META.noxious.fmt([])).toBe("없음");
  });

  it('noxious fmt: ["소각장", "묘지"] → 콤마 조인', () => {
    expect(FIELD_META.noxious.fmt(["소각장", "묘지"])).toBe("소각장, 묘지");
  });

  it('hugGuarantee fmt: true → "있음"', () => {
    expect(FIELD_META.hugGuarantee.fmt(true)).toBe("있음");
  });

  // 세션 508: 수집률 0% 라 실데이터는 전부 null — "없음"으로 표시하면 거짓("모름" ≠ "보증 없음")
  it('hugGuarantee fmt: null/undefined → "미수집", false → "없음"', () => {
    expect(FIELD_META.hugGuarantee.fmt(null)).toBe("미수집");
    expect(FIELD_META.hugGuarantee.fmt(undefined)).toBe("미수집");
    expect(FIELD_META.hugGuarantee.fmt(false)).toBe("없음");
  });

  it('builderCreditGrade fmt: 공기업/신탁/조합 + 등급없음 → "해당없음"', () => {
    expect(FIELD_META.builderCreditGrade.fmt(null, { builder: "SH공사" })).toBe("해당없음");
    expect(FIELD_META.builderCreditGrade.fmt(null, { builder: "(주)무궁화신탁" })).toBe("해당없음");
    expect(FIELD_META.builderCreditGrade.fmt(null, { builder: "둔촌주공아파트주택재건축정비사업조합" })).toBe(
      "해당없음"
    );
    // 세션389: LH 정식 법인명 — "토지주택공사" 토큰 추가로 "미등록"→"해당없음"
    expect(FIELD_META.builderCreditGrade.fmt(null, { builder: "한국토지주택공사" })).toBe("해당없음");
    expect(FIELD_META.builderCreditGrade.fmt(null, { builder: "한국토지주택공사 경기남부지역본부" })).toBe("해당없음");
    expect(FIELD_META.builderCreditGrade.fmt(null, { builder: "한국토지주택공사,지에스건설(주),금호건설(주)" })).toBe(
      "해당없음"
    );
  });

  it('builderCreditGrade fmt: 민간 + 등급없음 → "—"', () => {
    expect(FIELD_META.builderCreditGrade.fmt(null, { builder: "(주)대원" })).toBe("—");
    expect(FIELD_META.builderCreditGrade.fmt(null, {})).toBe("—");
  });

  it("builderCreditGrade fmt: 등급 있으면 그대로 표시", () => {
    expect(FIELD_META.builderCreditGrade.fmt("A", { builder: "GS건설" })).toBe("A");
    expect(FIELD_META.builderCreditGrade.fmt("A", { builder: "부산도시공사" })).toBe("A");
  });

  it("psr fmt: 숫자 → toFixed(2)", () => {
    expect(FIELD_META.psr.fmt(0.85)).toBe("0.85");
  });

  // 분양정보 필드 테스트
  it("presaleSchedule fmt: JSONB 객체 → 문자열", () => {
    const schedule = { scheduleName: "입주자모집공고", dateInfo: "2026-03-01" };
    const result = FIELD_META.presaleSchedule.fmt(schedule);
    expect(result).toContain("입주자모집공고");
  });

  it('presaleSchedule fmt: null → "—"', () => {
    expect(FIELD_META.presaleSchedule.fmt(null)).toBe("—");
  });
});

describe("FIELD_SECTIONS", () => {
  it("9개 섹션 존재", () => {
    expect(FIELD_SECTIONS).toHaveLength(9);
  });

  // 모든 섹션: fields가 FIELD_META에 존재 + 중복 없음
  it("모든 섹션의 fields가 FIELD_META에 존재하고 중복 없음", () => {
    for (const section of FIELD_SECTIONS) {
      const unique = new Set(section.fields);
      expect(unique.size, `섹션 "${section.key}": 중복 필드 발견`).toBe(section.fields.length);
      for (const f of section.fields) {
        expect(FIELD_META, `섹션 "${section.key}": 필드 "${f}"가 FIELD_META에 없음`).toHaveProperty(f);
      }
    }
  });

  it("hidden 아닌 모든 FIELD_META 키가 FIELD_SECTIONS에 포함", () => {
    const allSectionFields = FIELD_SECTIONS.flatMap((s) => s.fields);
    for (const key of Object.keys(FIELD_META)) {
      if (FIELD_META[key].hidden) continue; // hidden 필드는 섹션 미포함 허용
      expect(allSectionFields, `필드 "${key}"가 어떤 섹션에도 없음`).toContain(key);
    }
  });

  // ⚠️ 뮤테이션 대상: completion 의 fmt 를 `(v) => fmtMoveIn(v)` 로 되돌리면 red 여야 한다.
  //    `fmt` 는 2번째 인자로 행 전체를 받는다 — 안 넘기면 원문 대체가 통째로 죽는다.
  describe("completion — 잘린 값은 네이버 원문으로 대체 (세션530)", () => {
    it("잘린 값이면 같은 행의 원문을 보여준다", () => {
      expect(FIELD_META.completion.fmt("2029 미", { presaleMoveIn: "2029 미정" })).toBe("2029 미정");
    });
    it("정상 YYYYMM 은 정본을 쓴다", () => {
      expect(FIELD_META.completion.fmt("202812", { presaleMoveIn: "2030-05" })).toBe("2028년 12월");
    });
    it("원문이 없으면 저장된 값 그대로", () => {
      expect(FIELD_META.completion.fmt("미정", {})).toBe("미정");
    });
  });
});
