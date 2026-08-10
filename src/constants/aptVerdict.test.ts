import { describe, it, expect } from "vitest";
import { aptVerdict } from "./aptVerdict";
import type { Cats, Res } from "@/types/scoring";

// 종합 탭 "판정 한 줄" — 세션508 PR-3a A1. ProfileWeightBar.test.tsx 의 강점/보완·noData 케이스를
// 이관(§PR-3a 회귀 가드) + blind·슬림 catsCache 신규 2케이스.
function mkRes(total: number, label: string, over: Partial<Res> = {}): Res {
  return { total, label, subs: [], ...over };
}

function mkCats(totals: Partial<Record<keyof Cats, number>> = {}): Cats {
  return {
    price: mkRes(totals.price ?? 50, "가격 매력도"),
    location: mkRes(totals.location ?? 50, "입지·생활권"),
    product: mkRes(totals.product ?? 50, "상품성"),
    benefit: mkRes(totals.benefit ?? 50, "혜택·할인"),
    risk: mkRes(totals.risk ?? 50, "안전도"),
    future: mkRes(totals.future ?? 50, "미래가치"),
  };
}

describe("aptVerdict — 등급 문구", () => {
  it("total=85 → S 아닌 A등급 (gr 90 미만)", () => {
    expect(aptVerdict(85, mkCats())?.startsWith("A등급")).toBe(true);
  });
  it("total=92 → S등급", () => {
    expect(aptVerdict(92, mkCats())?.startsWith("S등급")).toBe(true);
  });
  it("total=40 → D등급", () => {
    expect(aptVerdict(40, mkCats())?.startsWith("D등급")).toBe(true);
  });
});

describe("aptVerdict — 최고/최저 total 선정 (SHORT_LABEL 어휘)", () => {
  it("입지90 최고·가격20 최저 → '입지 강점 · 가격 보완'", () => {
    const v = aptVerdict(70, mkCats({ location: 90, price: 20 }));
    expect(v).toContain("입지 강점");
    expect(v).toContain("가격 보완");
  });
});

describe("aptVerdict — benefit 은 후보에서 완전히 제외 (2026-08-11, 점수 가중치 0)", () => {
  it("benefit total=10(최저)이지만 noData=true → 보완 후보에서 빠지고 다음 최저(future=30)가 보완", () => {
    const cats = mkCats({ benefit: 10, future: 30, location: 90 });
    cats.benefit = mkRes(10, "혜택·할인", { noData: true });
    const v = aptVerdict(70, cats);
    expect(v).not.toContain("혜택 보완");
    expect(v).toContain("미래 보완");
  });
  it("benefit total=99(최고)에 noData=false 여도 → 강점 후보에서 빠진다 (가중치 0 이라 실제 기여 0)", () => {
    const cats = mkCats({ benefit: 99, location: 20, price: 30, product: 40, risk: 50, future: 60 });
    cats.benefit = mkRes(99, "혜택·할인", { noData: false });
    const v = aptVerdict(70, cats);
    expect(v).not.toContain("혜택 강점");
    expect(v).toContain("미래 강점");
  });
});

describe("aptVerdict — blind(total 없음)", () => {
  it("total=null → null (DetailModal 의 `blind ? null : res.total` 패턴과 동일 입력)", () => {
    expect(aptVerdict(null, mkCats())).toBeNull();
  });
  it("total=undefined → null", () => {
    expect(aptVerdict(undefined, mkCats())).toBeNull();
  });
});

describe("aptVerdict — 빈 cats(슬림 catsCache 대비)", () => {
  it("cats=null → null (NaN·'—등급' 금지)", () => {
    expect(aptVerdict(80, null)).toBeNull();
  });
  it("cats={} (후보 0개) → null", () => {
    expect(aptVerdict(80, {} as Cats)).toBeNull();
  });
});
