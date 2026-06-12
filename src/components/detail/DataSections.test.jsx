// @ts-check
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DataSections } from "./DataSections";
import { makeApt } from "@/__tests__/factories";

describe("DataSections", () => {
  // 기본 렌더링 — 접힌 상태
  it("초기 상태에서 '공공데이터 상세' 제목을 표시한다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<DataSections apt={/** @type {any} */ (apt)} />);
    expect(screen.getByText("공공데이터 상세")).toBeTruthy();
  });

  // 초기 상태에서 섹션 내용은 숨김
  it("초기 상태에서 세부 섹션 내용은 숨겨져 있다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<DataSections apt={/** @type {any} */ (apt)} />);
    expect(screen.queryByText("단지 기본정보")).toBeNull();
  });

  // 클릭하면 상시 표시 섹션 제목 표시 (경쟁률은 hideWhenEmpty라 기본 makeApt에선 숨김)
  it("토글 클릭 시 상시 데이터 섹션 제목을 표시한다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<DataSections apt={/** @type {any} */ (apt)} />);
    fireEvent.click(screen.getByText("공공데이터 상세"));
    expect(screen.getByText("단지 기본정보")).toBeTruthy();
    expect(screen.getByText("생활인프라 (반경 1km)")).toBeTruthy();
    expect(screen.getByText("교통 상세")).toBeTruthy();
    expect(screen.getByText("시장/투자 지표")).toBeTruthy();
    expect(screen.getByText("네이버 교차검증")).toBeTruthy();
    expect(screen.getByText("네이버 분양정보")).toBeTruthy();
  });

  // 청약 경쟁 현황 — 값 있으면 전용 섹션 + 콤마 포맷 표시
  it("경쟁률이 있으면 '청약 경쟁 현황' 섹션과 콤마 포맷 값을 표시한다", () => {
    const apt = /** @type {any} */ (makeApt({ competitionRate: 437995, competitionSupply: 300, competitionApplicants: 12000000 }));
    render(<DataSections apt={/** @type {any} */ (apt)} />);
    fireEvent.click(screen.getByText("공공데이터 상세"));
    expect(screen.getByText("청약 경쟁 현황")).toBeTruthy();
    expect(screen.getByText("437,995:1")).toBeTruthy();
  });

  // 청약 경쟁 현황 — 3필드 모두 없으면 섹션 자체를 숨김 (hideWhenEmpty)
  it("경쟁률 3필드가 모두 없으면 '청약 경쟁 현황' 섹션을 숨긴다 (hideWhenEmpty)", () => {
    const apt = /** @type {any} */ (makeApt()); // competitionRate 미설정
    render(<DataSections apt={/** @type {any} */ (apt)} />);
    fireEvent.click(screen.getByText("공공데이터 상세"));
    expect(screen.queryByText("청약 경쟁 현황")).toBeNull();
  });

  // 청약 경쟁 현황 — presaleStage=null이어도 경쟁률 있으면 노출 (세션365 게이트 준수)
  it("presaleStage=null이어도 경쟁률 있으면 노출한다", () => {
    const apt = /** @type {any} */ (makeApt({ presaleStage: null, competitionRate: 5.2 }));
    render(<DataSections apt={/** @type {any} */ (apt)} />);
    fireEvent.click(screen.getByText("공공데이터 상세"));
    expect(screen.getByText("청약 경쟁 현황")).toBeTruthy();
    expect(screen.getByText("5.2:1")).toBeTruthy();
  });

  // 출처 표시
  it("토글 클릭 시 출처 정보를 표시한다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<DataSections apt={/** @type {any} */ (apt)} />);
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
      render(<DataSections apt={/** @type {any} */ (apt)} />);
      fireEvent.click(screen.getByText("공공데이터 상세"));
    }).not.toThrow();
  });

  // 데이터가 없는 섹션은 "데이터 수집 중..." 표시
  it("데이터가 없는 섹션은 '데이터 수집 중...'을 표시한다", () => {
    // 네이버 관련 필드 전부 null인 아파트
    const apt = /** @type {any} */ (makeApt({
      naverNearbyMedian: null, naverJeonseRate: null,
      naverSellCount: null, naverJeonseCount: null,
      naverWolseCount: null, naverSchoolWalkMin: null,
      naverNearbyCount: null, naverFetchedAt: null,
    }));
    render(<DataSections apt={/** @type {any} */ (apt)} />);
    fireEvent.click(screen.getByText("공공데이터 상세"));
    // 네이버 교차검증 섹션에 "데이터 수집 중..." 표시
    const collecting = screen.getAllByText("데이터 수집 중...");
    expect(collecting.length).toBeGreaterThan(0);
  });

  // aria-expanded 속성 검증
  it("토글 버튼의 aria-expanded가 올바르게 변경된다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<DataSections apt={/** @type {any} */ (apt)} />);
    const toggle = screen.getByRole("button");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  // 키보드 접근성
  it("Enter 키로 토글할 수 있다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<DataSections apt={/** @type {any} */ (apt)} />);
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
    render(<DataSections apt={/** @type {any} */ (apt)} />);
    fireEvent.click(screen.getByText("공공데이터 상세"));
    expect(screen.getByText("이마트")).toBeTruthy();
    expect(screen.getByText("200m")).toBeTruthy();
  });

  // 교통 상세 필드 표시 — subwayName, subwayLines, busStopNames
  it("교통 상세 섹션에 지하철역명/노선/버스정류장이 표시된다", () => {
    const apt = /** @type {any} */ (makeApt({
      subwayName: "강남역", subwayLines: "2호선,신분당선",
      busStopNames: "강남역사거리,역삼동주민센터,삼성중앙역",
    }));
    render(<DataSections apt={/** @type {any} */ (apt)} />);
    fireEvent.click(screen.getByText("공공데이터 상세"));
    expect(screen.getByText("강남역")).toBeTruthy();
    expect(screen.getByText("2호선,신분당선")).toBeTruthy();
    // busStopNames: 콤마 분리 후 최대 5개, 쉼표+공백으로 join
    expect(screen.getByText("강남역사거리, 역삼동주민센터, 삼성중앙역")).toBeTruthy();
  });

  // 교통 상세 필드 null → "—" 표시
  it("교통 상세 필드가 null이면 '—'을 표시한다", () => {
    const apt = /** @type {any} */ (makeApt({ subwayName: null, subwayLines: null, busStopNames: null }));
    render(<DataSections apt={/** @type {any} */ (apt)} />);
    fireEvent.click(screen.getByText("공공데이터 상세"));
    // "—" 표시 (fieldMeta fmt 기본값)
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(3);
  });

  // announcementUrl이 있으면 링크 표시
  it("announcementUrl이 있으면 모집공고 링크를 표시한다", () => {
    const apt = /** @type {any} */ (makeApt({ announcementUrl: "https://example.com" }));
    render(<DataSections apt={/** @type {any} */ (apt)} />);
    fireEvent.click(screen.getByText("공공데이터 상세"));
    expect(screen.getByText("모집공고 원문 보기")).toBeTruthy();
  });

  // ── 채움률 도넛 (세션 380 PR-2) ──

  // 13. 접힌 상태에서도 헤더 전체 도넛 표시
  it("접힌 상태에서도 헤더 전체 채움률 도넛(role=img)을 표시한다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<DataSections apt={/** @type {any} */ (apt)} />);
    // 토글 미클릭 상태(showData=false)
    const donut = screen.getByRole("img", { name: /채움률/ });
    expect(donut).toBeTruthy();
    expect(donut.getAttribute("aria-label")).toMatch(/전체 채움률 \d+%/);
  });

  // 14. 펼치면 hasAny 서브섹션마다 도넛 표시 (factory 실측: 4섹션 hasAny)
  it("펼치면 데이터 있는 서브섹션에 도넛이 붙는다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<DataSections apt={/** @type {any} */ (apt)} />);
    fireEvent.click(screen.getByText("공공데이터 상세"));
    // 헤더 도넛 1 + hasAny 서브섹션 도넛들 → 2개 이상
    const donuts = screen.getAllByRole("img", { name: /채움률/ });
    expect(donuts.length).toBeGreaterThan(1);
    // 생활인프라 섹션 도넛 라벨 존재 (factory가 hospital 등 채움)
    expect(screen.getByRole("img", { name: /생활인프라.*채움률/ })).toBeTruthy();
  });

  // 15. 빈 섹션(hasAny=false)은 도넛 안 보임 — "데이터 수집 중..."만
  it("데이터 없는 섹션은 도넛이 없고 '데이터 수집 중...'만 표시한다", () => {
    // 네이버 교차검증 필드 전부 null → 그 섹션 hasAny=false
    const apt = /** @type {any} */ (makeApt({
      naverNearbyMedian: null, naverJeonseRate: null, naverSellCount: null,
      naverJeonseCount: null, naverWolseCount: null, naverSchoolWalkMin: null,
      naverNearbyCount: null, naverFetchedAt: null,
    }));
    render(<DataSections apt={/** @type {any} */ (apt)} />);
    fireEvent.click(screen.getByText("공공데이터 상세"));
    // "데이터 수집 중..." 존재
    expect(screen.getAllByText("데이터 수집 중...").length).toBeGreaterThan(0);
    // 네이버 교차검증 섹션 도넛은 없음 (그 라벨의 도넛 미존재)
    expect(screen.queryByRole("img", { name: /네이버 교차검증.*채움률/ })).toBeNull();
  });

  // 16. 토글 버튼은 여전히 1개 (도넛 img라 role 무충돌 — 회귀 가드)
  it("도넛 추가 후에도 토글 버튼(role=button)은 1개다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<DataSections apt={/** @type {any} */ (apt)} />);
    expect(screen.getByRole("button")).toBeTruthy(); // 단수 — 도넛은 img라 충돌 없음
  });

  // ── 관리자 모드 (세션 405 구 ExpertFieldTable·ExpertDataCompleteness 이식) ──
  it("adminMode 미전달(기본)이면 138필드 토글·관리자 완성도가 없다 — 소비자 무변경 가드", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<DataSections apt={/** @type {any} */ (apt)} />);
    fireEvent.click(screen.getByText("공공데이터 상세"));
    expect(screen.queryByText("전체 138필드 보기")).toBeNull();
    expect(screen.queryByTestId("admin-completeness")).toBeNull();
    expect(screen.queryByTestId("admin-full-fields")).toBeNull();
  });

  it("adminMode=true 펼침 시 138필드 토글 버튼과 관리자 기준 완성도(필드명 목록 포함)가 보인다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<DataSections apt={/** @type {any} */ (apt)} adminMode />);
    fireEvent.click(screen.getByText("공공데이터 상세"));
    expect(screen.getByText("전체 138필드 보기")).toBeTruthy();
    expect(screen.getByTestId("admin-completeness")).toBeTruthy();
    // 관리자 기준 라벨 (소비자 78필드 도넛과 모집단 다름 명시 — 세션 380 답습)
    expect(screen.getByText(/데이터 완성도 — 관리자 기준 \d+필드/)).toBeTruthy();
    // 필드명 목록 4종 중 최소 1종은 표시 (makeApt 기본값엔 미수집 필드 존재 — 복수 종 동시 표시 허용)
    expect(screen.getAllByText(/미등록 필드:|기본값 필드:|지역추정 필드:|적용 대상 아님 필드:/).length).toBeGreaterThan(0);
  });

  it("138필드 토글 ON 이면 9섹션 전수 표가 8섹션 요약을 대체하고, 부가 블록(출처)은 유지된다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<DataSections apt={/** @type {any} */ (apt)} adminMode profile="live" />);
    fireEvent.click(screen.getByText("공공데이터 상세"));
    fireEvent.click(screen.getByText("전체 138필드 보기"));
    expect(screen.getByTestId("admin-full-fields")).toBeTruthy();
    // 요약 전용 8섹션 제목은 사라지고 FIELD_SECTIONS 9섹션 라벨이 보임
    expect(screen.queryByText("단지 기본정보")).toBeNull();
    // 부가 블록(출처 footer)은 전수 모드에서도 유지
    expect(screen.getByText(/출처: 청약홈/)).toBeTruthy();
    // 토글 라벨이 "요약 보기"로 전환
    expect(screen.getByText("요약 보기")).toBeTruthy();
  });

  it("138필드 토글을 다시 누르면 요약(8섹션)으로 복귀한다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<DataSections apt={/** @type {any} */ (apt)} adminMode />);
    fireEvent.click(screen.getByText("공공데이터 상세"));
    fireEvent.click(screen.getByText("전체 138필드 보기"));
    fireEvent.click(screen.getByText("요약 보기"));
    expect(screen.queryByTestId("admin-full-fields")).toBeNull();
    expect(screen.getByText("단지 기본정보")).toBeTruthy();
  });
});
