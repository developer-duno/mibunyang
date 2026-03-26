import { describe, it, expect } from 'vitest';
import { FIELD_META, FIELD_SECTIONS } from './fieldMeta';

describe('FIELD_META', () => {
  const keys = Object.keys(FIELD_META);

  it('85개 이상 필드 정의', () => {
    expect(keys.length).toBeGreaterThanOrEqual(85);
  });

  keys.forEach((key) => {
    const meta = FIELD_META[key];

    it(`${key}: label 존재`, () => {
      expect(typeof meta.label).toBe('string');
      expect(meta.label.length).toBeGreaterThan(0);
    });

    it(`${key}: section 존재`, () => {
      expect(typeof meta.section).toBe('string');
    });

    it(`${key}: fmt 함수 존재`, () => {
      expect(typeof meta.fmt).toBe('function');
    });

    // fmt 함수 null 안전성 검증 — 가장 중요
    it(`${key}: fmt(null) 에러 없이 동작`, () => {
      expect(() => meta.fmt(null)).not.toThrow();
    });

    it(`${key}: fmt(undefined) 에러 없이 동작`, () => {
      expect(() => meta.fmt(undefined)).not.toThrow();
    });

    it(`${key}: fmt(0) 에러 없이 동작`, () => {
      expect(() => meta.fmt(0)).not.toThrow();
    });
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
});

describe('FIELD_SECTIONS', () => {
  it('9개 섹션 존재', () => {
    expect(FIELD_SECTIONS).toHaveLength(9);
  });

  FIELD_SECTIONS.forEach((section) => {
    it(`섹션 "${section.key}": fields가 FIELD_META에 모두 존재`, () => {
      section.fields.forEach((f) => {
        expect(FIELD_META).toHaveProperty(f);
      });
    });

    it(`섹션 "${section.key}": 중복 필드 없음`, () => {
      const unique = new Set(section.fields);
      expect(unique.size).toBe(section.fields.length);
    });
  });

  it('모든 FIELD_META 키가 FIELD_SECTIONS에 포함', () => {
    const allSectionFields = FIELD_SECTIONS.flatMap((s) => s.fields);
    Object.keys(FIELD_META).forEach((key) => {
      expect(allSectionFields).toContain(key);
    });
  });
});
