// @ts-check
import { describe, it, expect } from "vitest";
import {
  BUILDER_ALIASES,
  resolveBuilder,
  BRAND_TIER,
  AGE_PREMIUM,
  LAYOUT_SCORE,
  NOXIOUS_PENALTY,
  stripBuilderTail,
  consortiumRep,
} from "./brands";

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

// 세션676 PR-C — VIEW builder 「대표사 외 N」·공고 표기 꼬리 · 새 별칭(계획서 v2 C2-3·C2-5)
describe("resolveBuilder — 꼬리 떼기·새 별칭 (세션676)", () => {
  it("「 외 N」「등」「컨소시엄」을 떼고 대표사로 판정", () => {
    expect(resolveBuilder("현대건설 외 2")).toBe("현대건설");
    expect(resolveBuilder("GS건설 외 1")).toBe("GS건설");
    expect(resolveBuilder("지에스건설(주) 등")).toBe("GS건설");
    expect(resolveBuilder("현대건설 주식회사 컨소시엄")).toBe("현대건설");
    expect(resolveBuilder("금호건설(주) 외 3사")).toBe("금호건설");
    expect(BRAND_TIER[resolveBuilder("현대건설 외 2")].tier).toBe("1군Super");
  });
  it("가운데 「외」·꼬리만 있는 글자는 그대로", () => {
    expect(stripBuilderTail("가나 외 건설")).toBe("가나 외 건설");
    expect(stripBuilderTail("컨소시엄")).toBe("컨소시엄");
  });
  it("운영 실제 이름 — 꼬리처럼 보여도 끝이 아니면 안 잘린다(검사관 B 🟠1 반례 · 세션677)", () => {
    for (const r of [
      "두류야외음악당지역주택조합",
      "호원초등학교주변지구 주택재개발정비사업조합",
      "대현청실 외2 가로주택정비사업조합",
    ])
      expect(stripBuilderTail(r), r).toBe(r);
  });
  it("👤 D8 뒤 의도 동작 — 숫자 없는 「 외」(VIEW 「GS건설 외」)·꼬리 여러 마디·숫자 세 자리까지", () => {
    // 「가나건설 외」 는 VIEW 가 낸 「대표사 외」(수 모름) 꼴이라 대표사로 뗀다. 원표 글자가 우연히 이 꼴이어도
    // builders 조인이 안 맞아 부채비율이 null → 「대표사 부채비율」 칩이 안 뜬다(검사관 A 확인 — 결함 아님).
    expect(stripBuilderTail("가나건설 외")).toBe("가나건설");
    expect(resolveBuilder("GS건설 외")).toBe("GS건설");
    expect(resolveBuilder("GS건설 외 1개사 컨소시엄")).toBe("GS건설");
    expect(stripBuilderTail("가나건설 컨소시엄 등")).toBe("가나건설");
    expect(stripBuilderTail("가나건설 외 1234")).toBe("가나건설 외 1234");
    expect(stripBuilderTail("가나건설 외 999")).toBe("가나건설");
  });
  it("새 별칭 — 옛 이름·한글 음차·법인 정식명·(주)한화 계열", () => {
    expect(resolveBuilder("(주)포스코건설")).toBe("포스코이앤씨");
    expect(resolveBuilder("계룡건설산업(주)")).toBe("계룡건설");
    expect(resolveBuilder("에스케이에코플랜트 주식회사")).toBe("SK에코플랜트");
    expect(resolveBuilder("아이파크현대산업개발(주)")).toBe("HDC현대산업개발");
    for (const r of ["(주)한화 건설부문", "(주)한화건설부문", "(주)한화", "㈜한화", "주식회사 한화", "(주) 한화"])
      expect(resolveBuilder(r), r).toBe("한화건설");
    expect(resolveBuilder("금호산업(주)")).toBe("금호건설");
    expect(resolveBuilder("SK건설(주)")).toBe("SK에코플랜트");
  });
});

describe("consortiumRep — VIEW 「대표사 외 N」·「대표사 외」 (세션676 D6 · 세션677 D8)", () => {
  it("숫자 없는 「GS건설 외」(수 모름)도 대표사로 인정", () => {
    expect(consortiumRep("GS건설 외")).toBe("GS건설");
    expect(consortiumRep("현대건설 외")).toBe("현대건설");
    expect(consortiumRep("외")).toBeNull();
  });
  it("「현대건설 외 2」 → 현대건설 · 혼자·꼬리 다른 꼴·비문자는 null", () => {
    expect(consortiumRep("현대건설 외 2")).toBe("현대건설");
    expect(consortiumRep("에이치제이중공업 건설부문 외 1")).toBe("에이치제이중공업 건설부문");
    expect(consortiumRep("현대건설")).toBeNull();
    expect(consortiumRep("지에스건설(주) 등")).toBeNull();
    expect(consortiumRep("현대건설 외 0")).toBeNull();
    expect(consortiumRep(null)).toBeNull();
    expect(consortiumRep(3)).toBeNull();
  });
});
