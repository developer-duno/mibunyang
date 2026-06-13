// @ts-check
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AdminDataAudit } from "./AdminDataAudit";
import { makeApt } from "@/__tests__/factories";

// 구 DataSections adminMode 단언 이전 (세션 408 D2a — 점수 탭 직접 렌더, showData 토글 폐기).
describe("AdminDataAudit", () => {
  // 즉시 노출 — 관리자 완성도(진행바)는 토글 없이 항상 표시
  it("관리자 기준 완성도(필드명 목록 포함)가 즉시 표시된다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<AdminDataAudit apt={/** @type {any} */ (apt)} profile="live" />);
    expect(screen.getByTestId("admin-completeness")).toBeTruthy();
    // 관리자 기준 라벨 (소비자 도넛과 모집단 다름 명시 — 세션 380 답습)
    expect(screen.getByText(/데이터 완성도 — 관리자 기준 \d+필드/)).toBeTruthy();
    // 필드명 목록 4종 중 최소 1종 (makeApt 기본값에 미수집 필드 존재)
    expect(screen.getAllByText(/미등록 필드:|기본값 필드:|지역추정 필드:|적용 대상 아님 필드:/).length).toBeGreaterThan(0);
  });

  // 138필드 토글 버튼 — 기본 접힘
  it("기본 상태에서 '전체 138필드 보기' 버튼은 있고 전수 표는 숨김", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<AdminDataAudit apt={/** @type {any} */ (apt)} />);
    expect(screen.getByText("전체 138필드 보기")).toBeTruthy();
    expect(screen.queryByTestId("admin-full-fields")).toBeNull();
  });

  // 138필드 토글 ON → 전수 표 + 버튼 라벨 전환
  it("'전체 138필드 보기' 클릭 시 9섹션 전수 표가 보이고 라벨이 '요약 보기'로 전환된다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<AdminDataAudit apt={/** @type {any} */ (apt)} profile="live" />);
    fireEvent.click(screen.getByText("전체 138필드 보기"));
    expect(screen.getByTestId("admin-full-fields")).toBeTruthy();
    expect(screen.getByText("요약 보기")).toBeTruthy();
  });

  // 토글 재클릭 → 전수 표 숨김
  it("'요약 보기' 재클릭 시 전수 표가 사라진다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<AdminDataAudit apt={/** @type {any} */ (apt)} />);
    fireEvent.click(screen.getByText("전체 138필드 보기"));
    fireEvent.click(screen.getByText("요약 보기"));
    expect(screen.queryByTestId("admin-full-fields")).toBeNull();
  });

  // aria-pressed 토글 상태
  it("토글 버튼 aria-pressed가 클릭으로 변경된다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<AdminDataAudit apt={/** @type {any} */ (apt)} />);
    const btn = screen.getByRole("button", { name: /138필드/ });
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-pressed")).toBe("true");
  });
});
