// @ts-check
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NearbyChildcareSection } from "./NearbyChildcareSection";
import { makeApt } from "@/__tests__/factories";

describe("NearbyChildcareSection", () => {
  // 어린이집 데이터가 없으면 아무것도 렌더링하지 않음
  it("nearbyChildcare가 빈 배열이면 아무것도 렌더링하지 않는다", () => {
    const apt = makeApt({ nearbyChildcare: [] });
    const { container } = render(<NearbyChildcareSection apt={/** @type {any} */ (apt)} />);
    expect(container.innerHTML).toBe("");
  });

  it("nearbyChildcare가 null이면 아무것도 렌더링하지 않는다", () => {
    const apt = makeApt({ nearbyChildcare: null });
    const { container } = render(<NearbyChildcareSection apt={/** @type {any} */ (apt)} />);
    expect(container.innerHTML).toBe("");
  });

  it("nearbyChildcare가 undefined이면 아무것도 렌더링하지 않는다", () => {
    const apt = makeApt();
    const { container } = render(<NearbyChildcareSection apt={/** @type {any} */ (apt)} />);
    expect(container.innerHTML).toBe("");
  });

  // 어린이집 데이터가 있으면 헤더 + 목록 렌더링
  it("어린이집 데이터가 있으면 헤더와 목록을 렌더링한다", () => {
    const apt = makeApt({
      nearbyChildcare: [
        { name: "햇살어린이집", distance: 320, type: "국공립" },
        { name: "별빛어린이집", distance: 700, type: "민간" },
      ],
    });
    render(<NearbyChildcareSection apt={/** @type {any} */ (apt)} />);
    expect(screen.getByText("어린이집")).toBeTruthy();
    expect(screen.getByText("2곳 (1km)")).toBeTruthy();
    expect(screen.getByText("햇살어린이집")).toBeTruthy();
    expect(screen.getByText("별빛어린이집")).toBeTruthy();
  });

  // 1km 이상 거리는 km 단위로 표시
  it("1km 이상 거리는 km 단위로 표시한다", () => {
    const apt = makeApt({
      nearbyChildcare: [{ name: "먼어린이집", distance: 1200, type: "가정" }],
    });
    render(<NearbyChildcareSection apt={/** @type {any} */ (apt)} />);
    expect(screen.getByText("1.2km")).toBeTruthy();
  });

  // 행 클릭 시 70필드 펼침
  it("행 클릭 시 상세 정보가 펼쳐진다", () => {
    const apt = makeApt({
      nearbyChildcare: [
        {
          name: "구립참행복어린이집",
          distance: 320,
          type: "국공립",
          capacity: 80,
          enrolled: 75,
          cctv: 12,
          dataStdDate: "2026-02-01",
        },
      ],
    });
    render(<NearbyChildcareSection apt={/** @type {any} */ (apt)} />);
    // 접힌 상태: 자료기준일 안 보임
    expect(screen.queryByText(/자료기준일/)).toBeNull();
    // 행 클릭
    fireEvent.click(screen.getByText("구립참행복어린이집"));
    // 펼침: 정원/현원/CCTV/자료기준일 표시
    expect(screen.getByText("80명")).toBeTruthy();
    expect(screen.getByText("75명")).toBeTruthy();
    expect(screen.getByText("12대")).toBeTruthy();
    expect(screen.getByText("자료기준일 2026-02-01")).toBeTruthy();
  });

  // 70필드 미수집 시 "업데이트 예정" 라벨
  it("70필드 미수집(type/cctv null)이면 '업데이트 예정' 라벨을 표시한다", () => {
    const apt = makeApt({
      nearbyChildcare: [
        { name: "기초정보어린이집", distance: 400, type: null, cctv: null, capacity: 50, dataStdDate: null },
      ],
    });
    render(<NearbyChildcareSection apt={/** @type {any} */ (apt)} />);
    // 목록 행 — 유형 null → 라벨
    expect(screen.getAllByText("업데이트 예정").length).toBeGreaterThan(0);
    // 펼침 — null 필드 + 자료기준일도 라벨
    fireEvent.click(screen.getByText("기초정보어린이집"));
    expect(screen.getByText("자료기준일 업데이트 예정")).toBeTruthy();
    // 채워진 정원은 정상 표시
    expect(screen.getByText("50명")).toBeTruthy();
  });

  // 한 번에 하나만 펼침 (다른 행 클릭 시 이전 행 접힘)
  it("다른 행을 클릭하면 이전 행은 접힌다", () => {
    const apt = makeApt({
      nearbyChildcare: [
        { name: "첫째어린이집", distance: 100, type: "국공립", capacity: 30 },
        { name: "둘째어린이집", distance: 200, type: "민간", capacity: 60 },
      ],
    });
    render(<NearbyChildcareSection apt={/** @type {any} */ (apt)} />);
    fireEvent.click(screen.getByText("첫째어린이집"));
    expect(screen.getByText("30명")).toBeTruthy();
    fireEvent.click(screen.getByText("둘째어린이집"));
    expect(screen.queryByText("30명")).toBeNull();
    expect(screen.getByText("60명")).toBeTruthy();
  });
});
