// @ts-check
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { InfrastructureSection } from "./InfrastructureSection";

// DataSections 의 생활인프라 pairs 구조 (반경 1km)
const PAIRS = /** @type {ReadonlyArray<readonly [string, string | null]>} */ ([
  ["hospital", "hospitalDist"], ["mart", "martDist"], ["conv", "convDist"],
  ["park", "parkDist"], ["pharmacy", null], ["cafe", null],
  ["culture", null], ["bank", null],
  ["childcare", "childcareDist"], ["emergency", "emergencyDist"],
]);

function renderSection(overrides = {}) {
  const apt = /** @type {any} */ ({
    hospital: 3, mart: 2, conv: 5, park: 2, pharmacy: 3, cafe: 10,
    culture: 2, bank: 2, childcare: 4, emergency: 1,
    ...overrides,
  });
  return render(<InfrastructureSection pairs={PAIRS} apt={apt} />);
}

describe("InfrastructureSection 거리 미니바", () => {
  // 거리 텍스트는 항상 유지 (데이터 삭제 0)
  it("거리값이 있으면 거리 텍스트를 그대로 표시한다", () => {
    renderSection({ hospitalDist: 159 });
    expect(screen.getByText(/159m/)).toBeTruthy();
  });

  // 1km 막대 대상: hospitalDist 거리가 있으면 progressbar 1개 생성
  it("hospitalDist 거리가 있으면 막대(progressbar)를 표시한다", () => {
    renderSection({ hospitalDist: 200 });
    const bars = screen.getAllByRole("progressbar");
    expect(bars.length).toBeGreaterThan(0);
  });

  // 막대 비율: 가까울수록 길게 — 0m=100, 1000m=0
  it("거리 0m면 막대 100%, 1000m면 0% (가까울수록 길게)", () => {
    const { unmount } = renderSection({ hospitalDist: 0, martDist: null, convDist: null, parkDist: null, childcareDist: null, emergencyDist: null });
    // hospitalDist=0 → (1000-0)/10 = 100
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
    unmount();
    renderSection({ hospitalDist: 1000, martDist: null, convDist: null, parkDist: null, childcareDist: null, emergencyDist: null });
    // hospitalDist=1000 → (1000-1000)/10 = 0
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("0");
  });

  // 막대 비율 중간값: 500m → 50
  it("거리 500m면 막대 50%", () => {
    renderSection({ hospitalDist: 500, martDist: null, convDist: null, parkDist: null, childcareDist: null, emergencyDist: null });
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("50");
  });

  // emergencyDist 는 1km 범위 밖 → 막대 없음 (텍스트만)
  it("emergencyDist 는 막대를 만들지 않고 거리 텍스트만 표시한다", () => {
    renderSection({ emergencyDist: 1431, hospitalDist: null, martDist: null, convDist: null, parkDist: null, childcareDist: null });
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByText(/1431m/)).toBeTruthy();
  });

  // martDist 는 막대 없음 (채움률 41% → 텍스트만), dimmed 와 무관하게 막대 제외
  it("martDist 는 막대를 만들지 않는다 (채움률 낮음)", () => {
    renderSection({ martDist: 646, hospitalDist: null, convDist: null, parkDist: null, childcareDist: null, emergencyDist: null });
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByText(/646m/)).toBeTruthy();
  });

  // distField 가 null 인 항목(pharmacy 등)은 막대 없음
  it("distField 가 null 인 항목은 막대를 만들지 않는다", () => {
    renderSection({ hospitalDist: null, martDist: null, convDist: null, parkDist: null, childcareDist: null, emergencyDist: null });
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  // count=0 이면 dimmed (기존 동작 유지) + 거리 null 이면 막대 없음
  it("count 가 0 이고 거리 null 이면 라벨만 표시하고 막대는 없다", () => {
    const apt = /** @type {any} */ ({ hospital: 0, hospitalDist: null });
    render(<InfrastructureSection pairs={/** @type {any} */ ([["hospital", "hospitalDist"]])} apt={apt} />);
    expect(screen.getByText("병원")).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  // 막대 대상 4종(hospital/conv/park/childcare) 모두 거리 있으면 막대 4개
  it("hospital/conv/park/childcare 거리가 모두 있으면 막대 4개", () => {
    renderSection({ hospitalDist: 100, convDist: 96, parkDist: 224, childcareDist: 170, martDist: 646, emergencyDist: 1431 });
    // mart, emergency 는 제외 → 4개
    expect(screen.getAllByRole("progressbar").length).toBe(4);
  });
});
