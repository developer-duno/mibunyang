// @ts-check
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AdminUnitSupply } from "./AdminUnitSupply";
import { makeApt } from "@/__tests__/factories";

// 세션 405: 구 ExpertUnitPlaceholder.test 단언 이식 (전문가 대시보드 폐지·관리자 이식)

describe("AdminUnitSupply", () => {
  it("동/호수 현황 제목을 표시한다", () => {
    const apt = /** @type {any} */ (makeApt({ units: 1000, unsold: 150, unsoldRate: 15 }));
    render(<AdminUnitSupply apt={apt} />);
    expect(screen.getByText(/동\/호수 현황/)).toBeTruthy();
  });

  it("총 세대, 미분양, 미분양률을 표시한다", () => {
    const apt = /** @type {any} */ (makeApt({ units: 1000, unsold: 150, unsoldRate: 15 }));
    render(<AdminUnitSupply apt={apt} />);
    expect(screen.getByText("총 세대")).toBeTruthy();
    expect(screen.getByText("1,000")).toBeTruthy();
    expect(screen.getByText("미분양")).toBeTruthy();
    expect(screen.getByText("150")).toBeTruthy();
    expect(screen.getByText("미분양률")).toBeTruthy();
    expect(screen.getByText("15.0%")).toBeTruthy();
  });

  // 세션538: 옛 단언은 `getByText("0")` 이었다 — units 가 없을 때 "0" 을 찍는 건
  // "총 세대가 0세대"라는 거짓이다. 화면 표(`FIELD_META.units.fmt`)는 이미 v<=1 을
  // "정보 없음"으로 가리고 있었는데 이 카드만 0을 찍어 한 모달 안에서 말이 갈렸다.
  it("units가 null이면 '—'을 표시한다 (0세대짜리 단지는 없다)", () => {
    const apt = /** @type {any} */ (makeApt({ units: null, unsold: null, unsoldRate: null }));
    render(<AdminUnitSupply apt={apt} />);
    expect(screen.queryByText("0")).toBeNull();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(1);
  });

  it("unsold가 null이면 '—'을 표시한다", () => {
    const apt = /** @type {any} */ (makeApt({ units: 500, unsold: null, unsoldRate: null }));
    render(<AdminUnitSupply apt={apt} />);
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(1);
  });

  it("unsoldRate가 null이고 units > 0이면 unsold/units로 계산한다", () => {
    const apt = /** @type {any} */ (makeApt({ units: 200, unsold: 30, unsoldRate: null }));
    render(<AdminUnitSupply apt={apt} />);
    expect(screen.getByText("15.0%")).toBeTruthy();
  });

  it("평형별 데이터 미보유 시 미등록 안내와 예시를 표시한다 (빈 상태)", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<AdminUnitSupply apt={apt} />);
    expect(screen.getByText("동/호수 상세 데이터 미등록")).toBeTruthy();
    expect(screen.getByText(/향후 관리자 페이지에서/)).toBeTruthy();
    expect(screen.getByText(/예시: 101동 1201호/)).toBeTruthy();
  });

  it("unsoldRate가 있으면 그 값을 직접 사용한다", () => {
    const apt = /** @type {any} */ (makeApt({ units: 500, unsold: 100, unsoldRate: 20 }));
    render(<AdminUnitSupply apt={apt} />);
    expect(screen.getByText("20.0%")).toBeTruthy();
  });

  // 세션 — units 가 총세대수가 아니라 그 회차 공급 세대수인 자리(청약홈 계열)면 재계산이
  // 100%를 넘는다(15세대 중 미분양 47세대). VIEW·API·수집기와 같은 ">100 → 무효" 경계(세션445).
  // ⚠️ 뮤테이션 대상: `recalculated <= 100` 가드를 지우면 "313.3%" 가 찍혀 red 여야 한다.
  it("재계산 결과가 100%를 넘으면 무효 처리한다 (— 표시)", () => {
    const apt = /** @type {any} */ (makeApt({ units: 15, unsold: 47, unsoldRate: null }));
    render(<AdminUnitSupply apt={apt} />);
    expect(screen.queryByText(/313/)).toBeNull();
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(1);
  });

  it("재계산 결과가 정확히 100%면 그대로 표시한다 (경계값)", () => {
    const apt = /** @type {any} */ (makeApt({ units: 100, unsold: 100, unsoldRate: null }));
    render(<AdminUnitSupply apt={apt} />);
    expect(screen.getByText("100.0%")).toBeTruthy();
  });

  // 세션538 적대검증(high): 미분양률은 막아뒀는데 바로 옆 "총 세대" 칸은 원본을 그대로 찍어
  // "총 세대 15 / 미분양 47" 이 동시에 보였다. 판정 기준을 화면 표(`FIELD_META.units.fmt`)와
  // 같게 맞춘다 — 한 모달 안에서 두 자리가 다른 말을 하면 안 된다.
  // ⚠️ 뮤테이션 대상: `unitsUnknown` 을 지우고 `apt.units` 를 그대로 찍으면 red 여야 한다.
  it("미분양이 총세대수보다 크면 '총 세대'도 무효 처리한다 (분모가 그 회차 공급분인 자리)", () => {
    const apt = /** @type {any} */ (makeApt({ units: 15, unsold: 47, unsoldRate: null }));
    render(<AdminUnitSupply apt={apt} />);
    expect(screen.queryByText("15")).toBeNull(); // "총 세대 15" 가 사라져야 한다
    expect(screen.getByText("47")).toBeTruthy(); // 미분양 자체는 참이라 그대로 둔다
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2); // 총세대 + 미분양률
  });

  it("정상 단지(미분양 < 총세대수)는 총 세대를 그대로 보여준다 (대조군)", () => {
    const apt = /** @type {any} */ (makeApt({ units: 500, unsold: 100, unsoldRate: 20 }));
    render(<AdminUnitSupply apt={apt} />);
    expect(screen.getByText("500")).toBeTruthy();
    expect(screen.getByText("100")).toBeTruthy();
  });
});
