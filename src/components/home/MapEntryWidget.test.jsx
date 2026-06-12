// @ts-check
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MapEntryWidget } from "./MapEntryWidget";

describe("MapEntryWidget", () => {
  it("비로그인: 잠금 안내판 렌더 (D5)", () => {
    render(<MapEntryWidget isLoggedIn={false} onExpand={vi.fn()} />);
    expect(screen.getByText("로그인하면 지도가 열려요")).toBeInTheDocument();
  });
  it("비로그인: 잠금 클릭 시 onExpand (handleNavClick('map') 게이트 → LoginPromptModal trigger='map')", () => {
    const onExpand = vi.fn();
    render(<MapEntryWidget isLoggedIn={false} onExpand={onExpand} />);
    fireEvent.click(screen.getByRole("button", { name: /로그인하고 지도 열기/ }));
    expect(onExpand).toHaveBeenCalledTimes(1);
  });
  it("로그인: '지도 열기' CTA 렌더 (미니지도 임베드는 M2)", () => {
    render(<MapEntryWidget isLoggedIn={true} onExpand={vi.fn()} />);
    expect(screen.getByRole("button", { name: "지도 열기" })).toBeInTheDocument();
    expect(screen.queryByText("로그인하면 지도가 열려요")).toBeNull();
  });
  it("로그인: CTA 클릭 시 onExpand", () => {
    const onExpand = vi.fn();
    render(<MapEntryWidget isLoggedIn={true} onExpand={onExpand} />);
    fireEvent.click(screen.getByRole("button", { name: "지도 열기" }));
    expect(onExpand).toHaveBeenCalledTimes(1);
  });
});
