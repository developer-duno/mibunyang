import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

  // 학교 데이터가 있으면 요약(nearest) 렌더링
  it("학교 데이터가 있으면 학군 정보와 요약을 렌더링한다", () => {
    const apt = makeApt({
      nearbySchools: [
        { name: "영통초등학교", type: "초", distance: 300 },
        { name: "영통중학교", type: "중", distance: 800 },
      ],
    });
    render(<SchoolInfo apt={apt} />);
    expect(screen.getByText("학군 정보")).toBeTruthy();
    // 요약에서 초/중 최근접 학교 표시
    expect(screen.getByText("영통초등학교")).toBeTruthy();
    expect(screen.getByText("영통중학교")).toBeTruthy();
  });

  // schoolGrade가 null이면 등급 배지 렌더링하지 않음
  it("schoolGrade가 null이면 등급 배지를 표시하지 않는다", () => {
    const apt = makeApt({
      schoolGrade: null,
      nearbySchools: [{ name: "테스트초", type: "초", distance: 500 }],
    });
    render(<SchoolInfo apt={apt} />);
    expect(screen.queryByText("최우수")).toBeNull();
    expect(screen.queryByText("우수")).toBeNull();
  });

  // schoolGrade가 "최우수"이면 배지 표시
  it("schoolGrade가 '최우수'이면 배지를 표시한다", () => {
    const apt = makeApt({
      schoolGrade: "최우수",
      nearbySchools: [{ name: "강남초", type: "초", distance: 200 }],
    });
    render(<SchoolInfo apt={apt} />);
    expect(screen.getByText("최우수")).toBeTruthy();
  });

  // schoolGrade가 "우수"이면 배지 표시
  it("schoolGrade가 '우수'이면 배지를 표시한다", () => {
    const apt = makeApt({
      schoolGrade: "우수",
      nearbySchools: [{ name: "서초초", type: "초", distance: 400 }],
    });
    render(<SchoolInfo apt={apt} />);
    expect(screen.getByText("우수")).toBeTruthy();
  });

  // distance가 null인 경우 "—" 표시
  it("distance가 null이면 '—'을 표시한다", () => {
    const apt = makeApt({
      nearbySchools: [{ name: "테스트초", type: "초", distance: null }],
    });
    render(<SchoolInfo apt={apt} />);
    expect(screen.getByText("—")).toBeTruthy();
  });

  // 1km 이상 거리는 km 단위로 표시 — 요약에서 확인
  it("1km 이상 거리는 km 단위로 표시한다", () => {
    const apt = makeApt({
      nearbySchools: [{ name: "먼학교", type: "고", distance: 1500 }],
    });
    render(<SchoolInfo apt={apt} />);
    expect(screen.getByText("1.5km")).toBeTruthy();
  });

  // "더 보기" 클릭 시 전체 테이블 표시
  it("'전체 보기' 버튼 클릭 시 상세 테이블이 나타난다", () => {
    const apt = makeApt({
      nearbySchools: [
        { name: "가까운초", type: "초", distance: 200 },
        { name: "먼초", type: "초", distance: 800 },
        { name: "테스트중", type: "중", distance: 500 },
      ],
    });
    const { container } = render(<SchoolInfo apt={apt} />);
    // 접힌 상태: 테이블 없음
    expect(container.querySelector("table")).toBeNull();
    // 버튼 클릭
    fireEvent.click(screen.getByText(/전체.*학교 보기/));
    // 확장 상태: 테이블 보임
    expect(container.querySelector("table")).toBeTruthy();
    // 접기
    fireEvent.click(screen.getByText("접기"));
    expect(container.querySelector("table")).toBeNull();
  });

  // founded, classes 컬럼 — 확장 테이블에서 표시
  it("founded가 있는 학교가 있으면 확장 시 설립 컬럼을 표시한다", () => {
    const apt = makeApt({
      nearbySchools: [
        { name: "오래된학교", type: "초", distance: 300, founded: "1980" },
        { name: "다른학교", type: "초", distance: 500 },
      ],
    });
    render(<SchoolInfo apt={apt} />);
    // 확장 테이블 열기
    fireEvent.click(screen.getByText(/전체.*학교 보기/));
    expect(screen.getByText("설립")).toBeTruthy();
    expect(screen.getByText("1980")).toBeTruthy();
  });

  // highSchoolType 표시 — 요약에서 확인 가능
  it("highSchoolType이 있으면 구분에 함께 표시한다", () => {
    const apt = makeApt({
      nearbySchools: [
        { name: "영재고", type: "고", highSchoolType: "과학고", distance: 600 },
      ],
    });
    render(<SchoolInfo apt={apt} />);
    expect(screen.getByText("고(과학고)")).toBeTruthy();
  });

  // 1km 이내 개수 표시
  it("1km 이내 학교 개수를 유형별로 표시한다", () => {
    const apt = makeApt({
      nearbySchools: [
        { name: "초1", type: "초", distance: 300 },
        { name: "초2", type: "초", distance: 800 },
        { name: "초3", type: "초", distance: 1500 },
        { name: "중1", type: "중", distance: 600 },
      ],
    });
    render(<SchoolInfo apt={apt} />);
    // "초 2 · 중 1 (1km)" 형태
    expect(screen.getByText(/초 2/)).toBeTruthy();
    expect(screen.getByText(/중 1/)).toBeTruthy();
  });
});
