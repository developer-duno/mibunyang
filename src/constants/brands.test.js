// @ts-check
import { describe, it, expect } from "vitest";
import { BUILDER_ALIASES, resolveBuilder, BRAND_TIER, AGE_PREMIUM, LAYOUT_SCORE, NOXIOUS_PENALTY } from "./brands";

describe("resolveBuilder", () => {
  it('null → "기타"', () => {
    expect(resolveBuilder(null)).toBe("기타");
  });
  it('undefined → "기타"', () => {
    expect(resolveBuilder(undefined)).toBe("기타");
  });
  it('빈 문자열 → "기타"', () => {
    expect(resolveBuilder("")).toBe("기타");
  });
  it("공백만 → 빈 문자열 (trim 결과)", () => {
    expect(resolveBuilder("   ")).toBe("");
  });

  it("별칭 매핑 정상 동작", () => {
    expect(resolveBuilder("지에스건설")).toBe("GS건설");
    expect(resolveBuilder("현대건설(주)")).toBe("현대건설");
    expect(resolveBuilder("삼성물산건설부문")).toBe("삼성물산");
  });

  it("앞뒤 공백 트림 후 매핑", () => {
    expect(resolveBuilder("  지에스건설  ")).toBe("GS건설");
  });

  it("미등록 시공사는 원본 반환", () => {
    expect(resolveBuilder("무명건설")).toBe("무명건설");
  });

  it("이미 정규명인 경우 그대로 반환", () => {
    expect(resolveBuilder("GS건설")).toBe("GS건설");
  });
});

describe("BUILDER_ALIASES", () => {
  it("모든 별칭 값이 BRAND_TIER에 존재하거나 유효한 이름", () => {
    Object.values(BUILDER_ALIASES).forEach((canonical) => {
      expect(typeof canonical).toBe("string");
      expect(canonical.length).toBeGreaterThan(0);
    });
  });
});

describe("BRAND_TIER", () => {
  it("15개 이상 시공사 등록", () => {
    expect(Object.keys(BRAND_TIER).length).toBeGreaterThanOrEqual(15);
  });

  Object.entries(BRAND_TIER).forEach(([name, info]) => {
    it(`${name}: score 5~20, adj 0.9~1.1, tier/label 존재`, () => {
      expect(info.score).toBeGreaterThanOrEqual(5);
      expect(info.score).toBeLessThanOrEqual(20);
      expect(info.adj).toBeGreaterThanOrEqual(0.9);
      expect(info.adj).toBeLessThanOrEqual(1.1);
      expect(info.tier.length).toBeGreaterThan(0);
      expect(info.label.length).toBeGreaterThan(0);
    });
  });

  it("1군Super는 score=20, adj=1.05", () => {
    ["현대건설", "삼성물산", "GS건설"].forEach((b) => {
      expect(BRAND_TIER[b].score).toBe(20);
      expect(BRAND_TIER[b].adj).toBe(1.05);
    });
  });
});

describe("AGE_PREMIUM", () => {
  it("min 기준 오름차순 정렬", () => {
    for (let i = 1; i < AGE_PREMIUM.length; i++) {
      expect(AGE_PREMIUM[i].min).toBeGreaterThanOrEqual(AGE_PREMIUM[i - 1].min);
    }
  });

  it("구간 연속 (gaps 없음)", () => {
    for (let i = 1; i < AGE_PREMIUM.length; i++) {
      expect(AGE_PREMIUM[i].min).toBe(AGE_PREMIUM[i - 1].max);
    }
  });

  it("coeff 는 상식 범위 안 (0.5~2.0)", () => {
    AGE_PREMIUM.forEach((r) => {
      expect(r.coeff).toBeGreaterThan(0.5);
      expect(r.coeff).toBeLessThan(2.0);
    });
  });

  // 세션529 정정: 옛 가드는 "coeff > 1.0" + "나이가 많을수록 커진다"였다. 둘 다 "오래될수록
  // 재건축 기대로 비싸진다"는 **검증된 적 없는 가설**을 지키고 있었다 — parseCompletion 결함으로
  // 이 표 자체가 한 번도 안 쓰였기 때문에 아무도 실측과 대조하지 못했다. 파서를 고쳐 처음 재보니
  // 방향이 반대였다(brands.ts AGE_PREMIUM 주석의 실측 근거 참조). 가드도 실측 방향으로 뒤집는다.
  it("coeff 는 나이가 많을수록 작아진다 (비증가) — 실측 방향", () => {
    for (let i = 1; i < AGE_PREMIUM.length; i++) {
      expect(AGE_PREMIUM[i].coeff).toBeLessThanOrEqual(AGE_PREMIUM[i - 1].coeff);
    }
  });
});

describe("LAYOUT_SCORE", () => {
  it("5개 평면 구조 존재", () => {
    expect(Object.keys(LAYOUT_SCORE)).toHaveLength(5);
  });
  it("4베이판상이 가장 높은 점수", () => {
    expect(LAYOUT_SCORE["4베이판상"]).toBe(Math.max(...Object.values(LAYOUT_SCORE)));
  });
  it("모든 점수 양수", () => {
    Object.values(LAYOUT_SCORE).forEach((v) => expect(v).toBeGreaterThan(0));
  });
});

describe("NOXIOUS_PENALTY", () => {
  it("모든 페널티가 음수", () => {
    Object.values(NOXIOUS_PENALTY).forEach((v) => expect(v).toBeLessThan(0));
  });
  it("소각장이 가장 큰 페널티", () => {
    expect(NOXIOUS_PENALTY["소각장"]).toBe(Math.min(...Object.values(NOXIOUS_PENALTY)));
  });
});
