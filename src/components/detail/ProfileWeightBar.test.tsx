import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProfileWeightBar } from "./ProfileWeightBar";
import { PROFILES } from "@/constants/profiles";
import type { Cats, Res } from "@/types/scoring";

// 세션 434 — 점수 근거 투명화 A: 프로필 가중치 막대 + 강점/보완 1줄 (표현 계층 전용).
function mkRes(total: number, label: string, over: Partial<Res> = {}): Res {
  return { total, label, subs: [], ...over };
}

// 6 카테고리 Cats. total 을 인자로 받아 강점(최고)·보완(최저) 판정 검증.
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

// ⚠️ 세션508 PR-3a: 강점/보완 요약 줄("weight-bar-summary") 2케이스는 `aptVerdict.test.ts` 로
// 이관했다 — 그 로직이 `aptVerdict`(종합 탭 "판정 한 줄")로 옮겨가며 이 컴포넌트는 막대만 남았다.
describe("ProfileWeightBar", () => {
  it("상위 3 가중치 카테고리 막대 렌더 (실거주 → 입지40·상품20·가격20)", () => {
    render(<ProfileWeightBar weights={PROFILES.live.w} cats={mkCats()} />);
    // SHORT_LABEL 라벨로 노출 (막대 1줄에 1회씩)
    expect(screen.getAllByText("입지").length).toBeGreaterThan(0);
    expect(screen.getAllByText("상품").length).toBeGreaterThan(0);
    expect(screen.getAllByText("가격").length).toBeGreaterThan(0);
    // 비중 % 표기 (최고 가중치 40%)
    expect(screen.getByText("40%")).toBeInTheDocument();
  });

  it("0점 가중치 카테고리는 막대 미표시 (은퇴 future=0)", () => {
    render(<ProfileWeightBar weights={PROFILES.retire.w} cats={mkCats()} />);
    // 은퇴 상위3 = 입지35·상품25·가격20 → '미래' 막대 없음
    expect(screen.queryByText("미래")).toBeNull();
  });

  it("기여분 숫자(N점)는 표시 안 함 — 비중 %만", () => {
    const { container } = render(<ProfileWeightBar weights={PROFILES.live.w} cats={mkCats()} />);
    // "32점" 같은 기여분 숫자가 없어야 함 (40% × 80 = 32). 점수 텍스트 부재 확인.
    expect(container.textContent).not.toMatch(/\d+점/);
  });

  it("요약 줄(weight-bar-summary)이 사라졌다 — aptVerdict 로 이관", () => {
    render(<ProfileWeightBar weights={PROFILES.live.w} cats={mkCats()} />);
    expect(screen.queryByTestId("weight-bar-summary")).toBeNull();
  });

  it("막대 행은 role=button 없음 (클릭 비유발 — 정보 표시 전용)", () => {
    render(<ProfileWeightBar weights={PROFILES.live.w} cats={mkCats()} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
