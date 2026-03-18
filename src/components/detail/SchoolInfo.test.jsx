import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SchoolInfo } from "./SchoolInfo";
import { makeApt } from "@/__tests__/factories";

describe("SchoolInfo", () => {
  // 학교 데이터가 없으면 아무것도 렌더링하지 않음
  it("nearbySchools가 빈 배열이면 아무것도 렌더링하지 않는다", () => {
    const apt = makeApt({ nearbySchools: [] });
    const { container } = render(<SchoolInfo apt={apt} />);
    expect(container.innerHTML).toBe("");
  });

  // nearbySchools가 null이면 빈 배열 폴백
  it("nearbySchools가 null이면 아무것도 렌더링하지 않는다", () => {
    const apt = makeApt({ nearbySchools: null });
    const { container } = render(<SchoolInfo apt={apt} />);
    expect(container.innerHTML).toBe("");
  });

  // nearbySchools가 undefined이면 빈 배열 폴백
  it("nearbySchools가 undefined이면 아무것도 렌더링하지 않는다", () => {
    const apt = makeApt();
    const { container } = render(<SchoolInfo apt={apt} />);
    expect(container.innerHTML).toBe("");
  });

  // 학교 데이터가 있으면 테이블 렌더링
  it("학교 데이터가 있으면 학군 정보 테이블을 렌더링한다", () => {
    const apt = makeApt({
      nearbySchools: [
        { name: "영통초등학교", type: "초등", distance: 300 },
        { name: "영통중학교", type: "중등", distance: 800 },
      ],
    });
    render(<SchoolInfo apt={apt} />);
    expect(screen.getByText("학군 정보")).toBeTruthy();
    expect(screen.getByText("영통초등학교")).toBeTruthy();
    expect(screen.getByText("영통중학교")).toBeTruthy();
  });

  // schoolGrade가 null이면 등급 배지 렌더링하지 않음
  it("schoolGrade가 null이면 등급 배지를 표시하지 않는다", () => {
    const apt = makeApt({
      schoolGrade: null,
      nearbySchools: [{ name: "테스트초", type: "초등", distance: 500 }],
    });
    render(<SchoolInfo apt={apt} />);
    expect(screen.queryByText("최우수")).toBeNull();
    expect(screen.queryByText("우수")).toBeNull();
  });

  // schoolGrade가 "최우수"이면 배지 표시
  it("schoolGrade가 '최우수'이면 배지를 표시한다", () => {
    const apt = makeApt({
      schoolGrade: "최우수",
      nearbySchools: [{ name: "강남초", type: "초등", distance: 200 }],
    });
    render(<SchoolInfo apt={apt} />);
    expect(screen.getByText("최우수")).toBeTruthy();
  });

  // schoolGrade가 "우수"이면 배지 표시
  it("schoolGrade가 '우수'이면 배지를 표시한다", () => {
    const apt = makeApt({
      schoolGrade: "우수",
      nearbySchools: [{ name: "서초초", type: "초등", distance: 400 }],
    });
    render(<SchoolInfo apt={apt} />);
    expect(screen.getByText("우수")).toBeTruthy();
  });

  // distance가 null인 경우 "—" 표시
  it("distance가 null이면 '—'을 표시한다", () => {
    const apt = makeApt({
      nearbySchools: [{ name: "테스트초", type: "초등", distance: null }],
    });
    render(<SchoolInfo apt={apt} />);
    expect(screen.getByText("—")).toBeTruthy();
  });

  // 1km 이상 거리는 km 단위로 표시
  it("1km 이상 거리는 km 단위로 표시한다", () => {
    const apt = makeApt({
      nearbySchools: [{ name: "먼학교", type: "고등", distance: 1500 }],
    });
    render(<SchoolInfo apt={apt} />);
    expect(screen.getByText("1.5km")).toBeTruthy();
  });

  // founded, classes 컬럼 조건부 표시
  it("founded가 있는 학교가 있으면 설립 컬럼을 표시한다", () => {
    const apt = makeApt({
      nearbySchools: [
        { name: "오래된학교", type: "초등", distance: 300, founded: "1980" },
      ],
    });
    render(<SchoolInfo apt={apt} />);
    expect(screen.getByText("설립")).toBeTruthy();
    expect(screen.getByText("1980")).toBeTruthy();
  });

  // highSchoolType 표시
  it("highSchoolType이 있으면 구분에 함께 표시한다", () => {
    const apt = makeApt({
      nearbySchools: [
        { name: "영재고", type: "고등", highSchoolType: "과학고", distance: 600 },
      ],
    });
    render(<SchoolInfo apt={apt} />);
    expect(screen.getByText("고등(과학고)")).toBeTruthy();
  });
});
