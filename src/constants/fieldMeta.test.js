import { describe, it, expect } from 'vitest';
import { FIELD_META, FIELD_SECTIONS } from './fieldMeta';

describe('FIELD_META', () => {
  const keys = Object.keys(FIELD_META);

  it('104개 이상 필드 정의', () => {
    expect(keys.length).toBeGreaterThanOrEqual(104);
  });

  // 모든 필드: label·section·fmt 스키마 검증
  it('모든 필드에 label(string)·section(string)·fmt(function) 존재', () => {
    for (const key of keys) {
      const meta = FIELD_META[key];
      expect(typeof meta.label, `필드 ${key}: label이 string이 아님`).toBe('string');
      expect(meta.label.length, `필드 ${key}: label이 빈 문자열`).toBeGreaterThan(0);
      expect(typeof meta.section, `필드 ${key}: section이 string이 아님`).toBe('string');
      expect(typeof meta.fmt, `필드 ${key}: fmt가 function이 아님`).toBe('function');
    }
  });

  // fmt 함수 null 안전성 검증 — 가장 중요
  it('모든 fmt 함수가 null/undefined/0 입력에 에러 없이 동작', () => {
    const edgeCases = [null, undefined, 0];
    for (const key of keys) {
      const { fmt } = FIELD_META[key];
      for (const val of edgeCases) {
        expect(() => fmt(val), `필드 ${key}: fmt(${val}) 에러 발생`).not.toThrow();
      }
    }
  });

  // 특수 케이스
  it('builder fmt: BRAND_TIER 시공사 포맷팅', () => {
    expect(FIELD_META.builder.fmt("현대건설")).toContain("1군Super");
  });

  it('builder fmt: 미등록 시공사 → (기타)', () => {
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

  it('noxious fmt: 빈 배열 → "없음"', () => {
    expect(FIELD_META.noxious.fmt([])).toBe("없음");
  });

  it('noxious fmt: ["소각장", "묘지"] → 콤마 조인', () => {
    expect(FIELD_META.noxious.fmt(["소각장", "묘지"])).toBe("소각장, 묘지");
  });

  it('hugGuarantee fmt: true → "있음"', () => {
    expect(FIELD_META.hugGuarantee.fmt(true)).toBe("있음");
  });

  it('psr fmt: 숫자 → toFixed(2)', () => {
    expect(FIELD_META.psr.fmt(0.85)).toBe("0.85");
  });

  // 분양정보 필드 테스트
  it('presaleSchedule fmt: JSONB 객체 → 문자열', () => {
    const schedule = { scheduleName: "입주자모집공고", dateInfo: "2026-03-01" };
    const result = FIELD_META.presaleSchedule.fmt(schedule);
    expect(result).toContain("입주자모집공고");
  });

  it('presaleSchedule fmt: null → "—"', () => {
    expect(FIELD_META.presaleSchedule.fmt(null)).toBe("—");
  });
});

describe('FIELD_SECTIONS', () => {
  it('10개 섹션 존재', () => {
    expect(FIELD_SECTIONS).toHaveLength(10);
  });

  // 모든 섹션: fields가 FIELD_META에 존재 + 중복 없음
  it('모든 섹션의 fields가 FIELD_META에 존재하고 중복 없음', () => {
    for (const section of FIELD_SECTIONS) {
      const unique = new Set(section.fields);
      expect(unique.size, `섹션 "${section.key}": 중복 필드 발견`).toBe(section.fields.length);
      for (const f of section.fields) {
        expect(FIELD_META, `섹션 "${section.key}": 필드 "${f}"가 FIELD_META에 없음`).toHaveProperty(f);
      }
    }
  });

  it('모든 FIELD_META 키가 FIELD_SECTIONS에 포함', () => {
    const allSectionFields = FIELD_SECTIONS.flatMap((s) => s.fields);
    for (const key of Object.keys(FIELD_META)) {
      expect(allSectionFields, `필드 "${key}"가 어떤 섹션에도 없음`).toContain(key);
    }
  });
});
