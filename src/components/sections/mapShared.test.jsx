// @ts-check
// 지도 공용 presentational 조각 단위 테스트 (세션 448) — MapShell·MyLocationButton.
// 두 지도(Kakao/Naver)가 공유하는 껍데기라 props 별 루트 div 속성·버튼 동작만 검증(SDK 무관).
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { createRef } from "react";
import { MapShell, MyLocationButton } from "./mapShared";

describe("MapShell", () => {
  it("height 미전달 + 모바일(isPC=false): 3분기 calc 기본값 (calc(100dvh - 140px))", () => {
    const { container } = render(
      <MapShell isPC={false} error={null}>
        <div />
      </MapShell>
    );
    expect(/** @type {HTMLElement} */ (container.firstChild).style.height).toBe("calc(100dvh - 140px)");
  });

  it("isPC=true: calc(100dvh - 180px)", () => {
    const { container } = render(
      <MapShell isPC error={null}>
        <div />
      </MapShell>
    );
    expect(/** @type {HTMLElement} */ (container.firstChild).style.height).toBe("calc(100dvh - 180px)");
  });

  it("isDesktop=true: calc(100dvh - 120px) (isPC 보다 우선)", () => {
    const { container } = render(
      <MapShell isPC isDesktop error={null}>
        <div />
      </MapShell>
    );
    expect(/** @type {HTMLElement} */ (container.firstChild).style.height).toBe("calc(100dvh - 120px)");
  });

  it("height 명시 전달 시 그 값 우선", () => {
    const { container } = render(
      <MapShell height="280px" error={null}>
        <div />
      </MapShell>
    );
    expect(/** @type {HTMLElement} */ (container.firstChild).style.height).toBe("280px");
  });

  it("fullscreen: 테두리 none + 라운드 0 (높이 calc 는 불변)", () => {
    const { container } = render(
      <MapShell isPC={false} fullscreen error={null}>
        <div />
      </MapShell>
    );
    const root = /** @type {HTMLElement} */ (container.firstChild);
    expect(root.style.borderStyle).toBe("none");
    expect(root.style.borderRadius).toBe("0px");
    expect(root.style.height).toBe("calc(100dvh - 140px)"); // 잘림 방지 — 불변
  });

  it("fullscreen 미전달(기본): 모바일 라운드 10px + 테두리 solid", () => {
    const { container } = render(
      <MapShell isPC={false} error={null}>
        <div />
      </MapShell>
    );
    const root = /** @type {HTMLElement} */ (container.firstChild);
    expect(root.style.borderRadius).toBe("10px");
    expect(root.style.borderStyle).not.toBe("none");
  });

  it("error truthy: 에러 오버레이 표시 + 메시지 본문", () => {
    render(
      <MapShell error="VITE_KAKAO_JS_KEY 미설정">
        <div />
      </MapShell>
    );
    expect(screen.getByText("지도를 불러올 수 없습니다")).toBeInTheDocument();
    expect(screen.getByText("VITE_KAKAO_JS_KEY 미설정")).toBeInTheDocument();
  });

  it("error null: 에러 오버레이 미표시", () => {
    render(
      <MapShell error={null}>
        <div />
      </MapShell>
    );
    expect(screen.queryByText("지도를 불러올 수 없습니다")).toBeNull();
  });

  it("children 은 루트 div 안에 렌더", () => {
    render(
      <MapShell error={null}>
        <div data-testid="child" />
      </MapShell>
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  it("forwardRef: mapRef 가 지도 div 에 부착됨 (루트의 첫 자식)", () => {
    const ref = createRef();
    const { container } = render(
      <MapShell error={null} ref={ref}>
        <div />
      </MapShell>
    );
    // ref 는 루트의 첫 자식(지도 div) — 두 지도가 여기에 SDK 지도를 마운트
    expect(ref.current).toBe(/** @type {HTMLElement} */ (container.firstChild).firstChild);
  });
});

describe("MyLocationButton", () => {
  it("aria-label='현위치' 버튼 렌더 + type=button", () => {
    render(<MyLocationButton onClick={vi.fn()} />);
    const btn = screen.getByLabelText("현위치");
    expect(btn).toBeInTheDocument();
    expect(btn.getAttribute("type")).toBe("button");
  });

  it("클릭 시 onClick 발화", () => {
    const onClick = vi.fn();
    render(<MyLocationButton onClick={onClick} />);
    fireEvent.click(screen.getByLabelText("현위치"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
