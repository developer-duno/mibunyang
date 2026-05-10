// @ts-check
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InfraOverlay } from "./InfraOverlay";

describe("InfraOverlay", () => {
  // 정상: 4개 카테고리 버튼 렌더링
  it("4개 인프라 카테고리 버튼이 렌더링됨", () => {
    render(<InfraOverlay mapInstance={null} ready={false} />);
    expect(screen.getAllByRole("button")).toHaveLength(4);
  });

  // 토글 동작: 클릭 시 aria-pressed 변경
  it("버튼 클릭 시 활성화 토글", () => {
    render(<InfraOverlay mapInstance={null} ready={false} />);
    const btns = screen.getAllByRole("button");
    expect(btns[0].getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(btns[0]);
    expect(btns[0].getAttribute("aria-pressed")).toBe("true");
    // 다시 클릭하면 비활성화
    fireEvent.click(btns[0]);
    expect(btns[0].getAttribute("aria-pressed")).toBe("false");
  });

  // 다른 버튼 클릭 시 이전 버튼 비활성화 (단일 선택)
  it("다른 카테고리 선택 시 이전 비활성화", () => {
    render(<InfraOverlay mapInstance={null} ready={false} />);
    const btns = screen.getAllByRole("button");
    fireEvent.click(btns[0]);
    expect(btns[0].getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(btns[1]);
    expect(btns[0].getAttribute("aria-pressed")).toBe("false");
    expect(btns[1].getAttribute("aria-pressed")).toBe("true");
  });

  // ready=false일 때 크래시 없음
  it("ready=false일 때 크래시 없이 렌더링", () => {
    render(<InfraOverlay mapInstance={null} ready={false} />);
    expect(screen.getAllByRole("button")).toHaveLength(4);
  });
});
