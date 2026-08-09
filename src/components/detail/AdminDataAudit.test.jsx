// @ts-check
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AdminDataAudit } from "./AdminDataAudit";
import { FIELD_META } from "@/constants/fieldMeta";
import { makeApt } from "@/__tests__/factories";

// 버튼 문구의 숫자는 여기서도 박제하지 않는다. 컴포넌트(L14~15)는 세션 487 에 이미 박제를
// 걷어냈는데 이 테스트만 옛 숫자를 들고 있어, 필드 하나만 늘려도 기능은 멀쩡한 채 4건이 빨개졌다
// (세션 505 공시가격 추가 때 실제로 터짐). 소스와 같은 식으로 세어 스스로 따라오게 한다.
const NON_HIDDEN_COUNT = Object.keys(FIELD_META).filter((k) => !FIELD_META[k].hidden).length;
const OPEN_LABEL = `전체 ${NON_HIDDEN_COUNT}필드 보기`;

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
    expect(screen.getAllByText(/미등록 필드:|기본값 필드:|지역추정 필드:|적용 대상 아님 필드:/).length).toBeGreaterThan(
      0
    );
  });

  // 전수 필드 토글 버튼 — 기본 접힘
  it("기본 상태에서 '전체 N필드 보기' 버튼은 있고 전수 표는 숨김", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<AdminDataAudit apt={/** @type {any} */ (apt)} />);
    expect(screen.getByText(OPEN_LABEL)).toBeTruthy();
    expect(screen.queryByTestId("admin-full-fields")).toBeNull();
  });

  // 전수 필드 토글 ON → 전수 표 + 버튼 라벨 전환
  it("'전체 N필드 보기' 클릭 시 9섹션 전수 표가 보이고 라벨이 '요약 보기'로 전환된다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<AdminDataAudit apt={/** @type {any} */ (apt)} profile="live" />);
    fireEvent.click(screen.getByText(OPEN_LABEL));
    expect(screen.getByTestId("admin-full-fields")).toBeTruthy();
    expect(screen.getByText("요약 보기")).toBeTruthy();
  });

  // 토글 재클릭 → 전수 표 숨김
  it("'요약 보기' 재클릭 시 전수 표가 사라진다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<AdminDataAudit apt={/** @type {any} */ (apt)} />);
    fireEvent.click(screen.getByText(OPEN_LABEL));
    fireEvent.click(screen.getByText("요약 보기"));
    expect(screen.queryByTestId("admin-full-fields")).toBeNull();
  });

  // aria-pressed 토글 상태
  it("토글 버튼 aria-pressed가 클릭으로 변경된다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<AdminDataAudit apt={/** @type {any} */ (apt)} />);
    const btn = screen.getByRole("button", { name: new RegExp(`${NON_HIDDEN_COUNT}필드`) });
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-pressed")).toBe("true");
  });
});
