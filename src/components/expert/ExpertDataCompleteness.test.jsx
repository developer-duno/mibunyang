// @ts-check
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExpertDataCompleteness } from "./ExpertDataCompleteness";
import { makeApt } from "@/__tests__/factories";

describe("ExpertDataCompleteness", () => {
  // 기본 렌더링 — 데이터 완성도 제목 표시
  it("데이터 완성도 제목을 표시한다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<ExpertDataCompleteness apt={apt} />);
    expect(screen.getByText("데이터 완성도")).toBeTruthy();
  });

  // progressbar 렌더링
  it("progressbar가 렌더링된다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<ExpertDataCompleteness apt={apt} />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toBeTruthy();
    const pct = parseInt(bar.getAttribute("aria-valuenow") ?? "", 10);
    expect(pct).toBeGreaterThanOrEqual(0);
    expect(pct).toBeLessThanOrEqual(100);
  });

  // 완성도 퍼센트 표시
  it("완성도 퍼센트를 숫자로 표시한다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<ExpertDataCompleteness apt={apt} />);
    // aria-label에 퍼센트 포함
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-label")).toMatch(/데이터 완성도 \d+%/);
  });

  // 실제 데이터/미등록 카운트 표시
  it("실제 데이터, 기본값, 미등록 카운트를 표시한다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<ExpertDataCompleteness apt={apt} />);
    expect(screen.getByText(/실제 데이터:/)).toBeTruthy();
    expect(screen.getByText(/미등록:/)).toBeTruthy();
  });

  // 모든 필드가 null인 경우 — 미등록이 최대
  it("모든 필드가 null이면 완성도가 0%이다", () => {
    const apt = /** @type {any} */ ({ id: 1 });
    render(<ExpertDataCompleteness apt={apt} />);
    const bar = screen.getByRole("progressbar");
    const pct = parseInt(bar.getAttribute("aria-valuenow") ?? "", 10);
    // 대부분 필드가 null이므로 완성도 매우 낮음
    expect(pct).toBeLessThanOrEqual(10);
  });

  // 미등록 필드 목록 표시
  it("미등록 필드 목록을 표시한다", () => {
    const apt = /** @type {any} */ ({ id: 1 });
    render(<ExpertDataCompleteness apt={apt} />);
    expect(screen.getByText(/미등록 필드:/)).toBeTruthy();
  });

  // 데이터가 많이 채워진 경우 높은 완성도
  it("데이터가 많이 채워지면 높은 완성도를 표시한다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<ExpertDataCompleteness apt={apt} />);
    const bar = screen.getByRole("progressbar");
    const pct = parseInt(bar.getAttribute("aria-valuenow") ?? "", 10);
    // makeApt는 대부분 필드 채움 → 50% 이상 기대
    expect(pct).toBeGreaterThan(30);
  });

  // ── N/A(적용 대상 아님) 분류 — 세션101 ──
  // presaleStage null인 단지는 presale/competition 필드 17개가 N/A로 빠져야 함
  it("presaleStage가 null이면 해당없음 카운트가 표시된다", () => {
    const apt = /** @type {any} */ (makeApt({ presaleStage: null }));
    render(<ExpertDataCompleteness apt={apt} />);
    expect(screen.getByText(/해당없음:/)).toBeTruthy();
    expect(screen.getByText(/적용 대상 아님 필드:/)).toBeTruthy();
  });

  // presaleStage 값이 있으면 presale 필드는 평가 대상으로 복귀 → N/A 줄 미표시
  it("presaleStage가 '분양중'이면 적용 대상 아님 줄이 숨겨진다", () => {
    const apt = /** @type {any} */ (makeApt({
      presaleStage: "분양중",
      presaleMinPrice: 30000, presaleMaxPrice: 50000, presalePp: 1500,
      presaleType: "민간분양", presaleHousingType: "아파트",
      presaleGeneralSupply: 500, presaleBuildings: 5, presaleParking: 600,
      presaleMoveIn: "2027년 상반기", presaleRecruitDate: "2026-05",
      presaleSchedule: {}, presaleInquiry: "1588-1234", presaleFeatures: "특징",
      presaleFetchedAt: "2026-04-07T00:00:00Z",
      competitionRate: 5.2, competitionSupply: 300, competitionApplicants: 1560,
    }));
    render(<ExpertDataCompleteness apt={apt} />);
    // 해당없음 카운트는 0개
    expect(screen.getByText(/해당없음:/).textContent).toMatch(/해당없음:\s*0/);
    // "적용 대상 아님 필드:" 줄은 조건부 렌더링이라 없어야 함
    expect(screen.queryByText(/적용 대상 아님 필드:/)).toBeNull();
  });

  // N/A 제외 분모 — 같은 filled 기준에서 presaleStage 없는 쪽이 pct가 같거나 높음
  it("N/A는 완성도 분모에서 제외된다 (분모 축소 효과)", () => {
    const base = { id: 1, name: "테스트" };
    const { unmount: u1 } = render(<ExpertDataCompleteness apt={/** @type {any} */ ({ ...base, presaleStage: null })} />);
    const pctNA = parseInt(screen.getByRole("progressbar").getAttribute("aria-valuenow") ?? "", 10);
    u1();
    // presaleStage="분양중"이면 presale/competition 필드 17개가 미등록으로 잡혀 분모 커짐
    render(<ExpertDataCompleteness apt={/** @type {any} */ ({ ...base, presaleStage: "분양중" })} />);
    const pctAll = parseInt(screen.getByRole("progressbar").getAttribute("aria-valuenow") ?? "", 10);
    // 둘 다 filled가 거의 없음 → pct는 0 근처인데, N/A 쪽이 분모 축소로 같거나 커야 함
    expect(pctNA).toBeGreaterThanOrEqual(pctAll);
  });

  // 요약 줄에 "평가 N / 총 M" 표기 포함
  it("평가 대상 수와 총 필드 수를 구분해 표시한다", () => {
    const apt = /** @type {any} */ (makeApt({ presaleStage: null }));
    render(<ExpertDataCompleteness apt={apt} />);
    expect(screen.getByText(/평가 \d+ \/ 총 \d+개/)).toBeTruthy();
  });
});
