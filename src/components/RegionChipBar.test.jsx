// @ts-check
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RegionChipBar } from "./RegionChipBar";

const baseProps = () => ({
  regions: ["서울", "대전", "세종"],
  active: "전국",
  onSelect: vi.fn(),
  favorites: /** @type {string[]} */ ([]),
  onToggleFavorite: vi.fn(),
});

describe("RegionChipBar", () => {
  it("전국 + 지역 칩 렌더, 활성 칩 aria-pressed", () => {
    render(<RegionChipBar {...baseProps()} active="대전" />);
    expect(screen.getByRole("button", { name: "전국" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "대전" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "서울" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("칩 클릭 → onSelect 발화", () => {
    const props = baseProps();
    render(<RegionChipBar {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "세종" }));
    expect(props.onSelect).toHaveBeenCalledWith("세종");
  });

  it("★ 관심지역은 맨 앞 정렬 + ★ prefix", () => {
    render(<RegionChipBar {...baseProps()} favorites={["세종"]} />);
    const labels = screen.getAllByRole("button").map((b) => b.textContent);
    // 전국 → ★ 세종 → 서울 → 대전 → ★ 편집
    expect(labels[0]).toBe("전국");
    expect(labels[1]).toBe("★ 세종");
    expect(labels[labels.length - 1]).toBe("★ 편집");
  });

  it("편집 모드: 칩 클릭 = onToggleFavorite (onSelect 미발화), 완료로 복귀", () => {
    const props = baseProps();
    render(<RegionChipBar {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "관심지역 편집 모드" }));
    fireEvent.click(screen.getByRole("button", { name: "대전 관심지역 등록" }));
    expect(props.onToggleFavorite).toHaveBeenCalledWith("대전");
    expect(props.onSelect).not.toHaveBeenCalled();
    // 완료 → 일반 모드 복귀
    fireEvent.click(screen.getByRole("button", { name: "관심지역 편집 모드" }));
    fireEvent.click(screen.getByRole("button", { name: "대전" }));
    expect(props.onSelect).toHaveBeenCalledWith("대전");
  });

  it("편집 모드: 전국 칩은 토글 대상 아님", () => {
    const props = baseProps();
    render(<RegionChipBar {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "관심지역 편집 모드" }));
    fireEvent.click(screen.getByRole("button", { name: "전국" }));
    expect(props.onToggleFavorite).not.toHaveBeenCalled();
    expect(props.onSelect).not.toHaveBeenCalled();
  });
});
