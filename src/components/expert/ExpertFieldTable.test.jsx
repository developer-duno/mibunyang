// @ts-check
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExpertFieldTable } from "./ExpertFieldTable";
import { makeApt } from "@/__tests__/factories";

describe("ExpertFieldTable", () => {
  // 기본 렌더링 — 제목 표시
  it("제목을 표시한다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<ExpertFieldTable apt={apt} fields={["name", "region"]} title="단지 개요" color="#4338CA" />);
    expect(screen.getByText("단지 개요")).toBeTruthy();
  });

  // 필드 라벨과 값 표시
  it("필드 라벨과 포맷된 값을 표시한다", () => {
    const apt = /** @type {any} */ (makeApt({ area: 84 }));
    render(<ExpertFieldTable apt={apt} fields={["area", "price"]} title="테스트" />);
    expect(screen.getByText("전용면적")).toBeTruthy();
    expect(screen.getByText("84㎡")).toBeTruthy();
    expect(screen.getByText("분양가")).toBeTruthy();
  });

  // null 값은 "—"으로 표시 (이탈릭)
  it("null 값은 '—'으로 표시한다", () => {
    const apt = /** @type {any} */ (makeApt({ subwayDist: null }));
    render(<ExpertFieldTable apt={apt} fields={["subwayDist"]} title="테스트" />);
    expect(screen.getByText("—")).toBeTruthy();
  });

  // exclude로 특정 필드 제외
  it("exclude에 포함된 필드는 표시하지 않는다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<ExpertFieldTable apt={apt} fields={["nearbyMedian", "pir", "psr"]} title="가격" exclude={["nearbyMedian"]} />);
    expect(screen.queryByText("주변 아파트 시세")).toBeNull();
    expect(screen.getByText("PIR (소득대비)")).toBeTruthy();
  });

  // FIELD_META에 없는 필드는 무시
  it("FIELD_META에 없는 필드는 무시한다", () => {
    const apt = /** @type {any} */ (makeApt());
    expect(() => render(<ExpertFieldTable apt={apt} fields={["nonexistent", "area"]} title="테스트" />)).not.toThrow();
    expect(screen.getByText("전용면적")).toBeTruthy();
  });

  // isDefault인 필드에 경고 아이콘 표시
  it("기본값 필드에 경고 표시를 한다", () => {
    const apt = /** @type {any} */ (makeApt({ subwayDist: 9999 }));
    render(<ExpertFieldTable apt={apt} fields={["subwayDist"]} title="테스트" />);
    // subwayDist=9999 → isDefault=true → "없음(9999) ⚠"
    const text = screen.getByText(/없음\(9999\)/);
    expect(text.textContent).toContain("\u26A0");
  });

  // 빈 fields 배열
  it("빈 fields 배열이면 제목만 표시한다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<ExpertFieldTable apt={apt} fields={[]} title="빈 섹션" />);
    expect(screen.getByText("빈 섹션")).toBeTruthy();
  });

  // color prop이 제목에 적용됨
  it("color prop이 없어도 기본 색상으로 렌더링한다", () => {
    const apt = /** @type {any} */ (makeApt());
    expect(() => render(<ExpertFieldTable apt={apt} fields={["name"]} title="테스트" />)).not.toThrow();
  });
});
