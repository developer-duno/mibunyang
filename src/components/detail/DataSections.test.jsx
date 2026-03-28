import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DataSections } from "./DataSections";
import { makeApt } from "@/__tests__/factories";

describe("DataSections", () => {
  // 기본 렌더링 — 접힌 상태
  it("초기 상태에서 '공공데이터 상세' 제목을 표시한다", () => {
    const apt = makeApt();
    render(<DataSections apt={apt} />);
    expect(screen.getByText("공공데이터 상세")).toBeTruthy();
  });

  // 초기 상태에서 섹션 내용은 숨김
  it("초기 상태에서 세부 섹션 내용은 숨겨져 있다", () => {
    const apt = makeApt();
    render(<DataSections apt={apt} />);
    expect(screen.queryByText("단지 기본정보")).toBeNull();
  });

  // 클릭하면 6개 섹션 제목 표시
  it("토글 클릭 시 6개 데이터 섹션 제목을 표시한다", () => {
    const apt = makeApt();
    render(<DataSections apt={apt} />);
    fireEvent.click(screen.getByText("공공데이터 상세"));
    expect(screen.getByText("단지 기본정보")).toBeTruthy();
    expect(screen.getByText("생활인프라 (반경 1km)")).toBeTruthy();
    expect(screen.getByText("교통 상세")).toBeTruthy();
    expect(screen.getByText("시장/투자 지표")).toBeTruthy();
    expect(screen.getByText("네이버 교차검증")).toBeTruthy();
    expect(screen.getByText("네이버 분양정보")).toBeTruthy();
  });

  // 출처 표시
  it("토글 클릭 시 출처 정보를 표시한다", () => {
    const apt = makeApt();
    render(<DataSections apt={apt} />);
    fireEvent.click(screen.getByText("공공데이터 상세"));
    expect(screen.getByText(/청약홈.*카카오/)).toBeTruthy();
  });

  // null 데이터 안전성 — 모든 필드가 null이어도 크래시 없음
  it("모든 필드가 null이어도 크래시 없이 렌더링한다", () => {
    const apt = {
      id: 1, name: null, region: null, gu: null, dong: null,
      price: null, area: null, units: null, unsold: null,
      unsoldRate: null, pp: null, builder: null, completion: null,
      hospital: null, mart: null, conv: null, park: null,
      subwayDist: null, busRoutes: null, nearbyMedian: null,
      dataReliability: null, heating: null, layout: null,
    };
    expect(() => {
      const { container } = render(<DataSections apt={apt} />);
      fireEvent.click(screen.getByText("공공데이터 상세"));
    }).not.toThrow();
  });

  // 데이터가 없는 섹션은 "데이터 수집 중..." 표시
  it("데이터가 없는 섹션은 '데이터 수집 중...'을 표시한다", () => {
    // 네이버 관련 필드 전부 null인 아파트
    const apt = makeApt({
      naverNearbyMedian: null, naverJeonseRate: null,
      naverSellCount: null, naverJeonseCount: null,
      naverWolseCount: null, naverSchoolWalkMin: null,
      naverNearbyCount: null, naverFetchedAt: null,
    });
    render(<DataSections apt={apt} />);
    fireEvent.click(screen.getByText("공공데이터 상세"));
    // 네이버 교차검증 섹션에 "데이터 수집 중..." 표시
    const collecting = screen.getAllByText("데이터 수집 중...");
    expect(collecting.length).toBeGreaterThan(0);
  });

  // aria-expanded 속성 검증
  it("토글 버튼의 aria-expanded가 올바르게 변경된다", () => {
    const apt = makeApt();
    render(<DataSections apt={apt} />);
    const toggle = screen.getByRole("button");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  // 키보드 접근성
  it("Enter 키로 토글할 수 있다", () => {
    const apt = makeApt();
    render(<DataSections apt={apt} />);
    const toggle = screen.getByRole("button");
    fireEvent.keyDown(toggle, { key: "Enter" });
    expect(screen.getByText("단지 기본정보")).toBeTruthy();
  });

  // 주변 편의시설 데이터가 있으면 표시
  it("nearbyFacilities가 있으면 주변 편의시설 상세를 표시한다", () => {
    const apt = makeApt({
      nearbyFacilities: [
        { name: "이마트", dist: 200 },
        { name: "올리브영", dist: 450 },
      ],
    });
    render(<DataSections apt={apt} />);
    fireEvent.click(screen.getByText("공공데이터 상세"));
    expect(screen.getByText("이마트")).toBeTruthy();
    expect(screen.getByText("200m")).toBeTruthy();
  });

  // 교통 상세 필드 표시 — subwayName, subwayLines, busStopNames
  it("교통 상세 섹션에 지하철역명/노선/버스정류장이 표시된다", () => {
    const apt = makeApt({
      subwayName: "강남역", subwayLines: "2호선,신분당선",
      busStopNames: "강남역사거리,역삼동주민센터,삼성중앙역",
    });
    render(<DataSections apt={apt} />);
    fireEvent.click(screen.getByText("공공데이터 상세"));
    expect(screen.getByText("강남역")).toBeTruthy();
    expect(screen.getByText("2호선,신분당선")).toBeTruthy();
    // busStopNames: 콤마 분리 후 최대 5개, 쉼표+공백으로 join
    expect(screen.getByText("강남역사거리, 역삼동주민센터, 삼성중앙역")).toBeTruthy();
  });

  // 교통 상세 필드 null → "—" 표시
  it("교통 상세 필드가 null이면 '—'을 표시한다", () => {
    const apt = makeApt({ subwayName: null, subwayLines: null, busStopNames: null });
    render(<DataSections apt={apt} />);
    fireEvent.click(screen.getByText("공공데이터 상세"));
    // "—" 표시 (fieldMeta fmt 기본값)
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(3);
  });

  // announcementUrl이 있으면 링크 표시
  it("announcementUrl이 있으면 모집공고 링크를 표시한다", () => {
    const apt = makeApt({ announcementUrl: "https://example.com" });
    render(<DataSections apt={apt} />);
    fireEvent.click(screen.getByText("공공데이터 상세"));
    expect(screen.getByText("모집공고 원문 보기")).toBeTruthy();
  });
});
