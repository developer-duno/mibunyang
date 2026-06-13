// @ts-check
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DataSectionBlock, NearbyFacilitiesBlock, PriceByFloorBlock, AnnouncementLink } from "./DataSectionBlock";
import { LOCATION_SECTIONS, PRICE_SECTIONS, PRESALE_SECTIONS, OVERVIEW_SECTIONS } from "@/lib/dataSections";
import { makeApt } from "@/__tests__/factories";

// 그룹 상수에서 제목으로 섹션 찾기 (구 DATA_SECTIONS 단언을 섹션 단위로 이전)
/** @param {string} title */
const find = (title) =>
  [...OVERVIEW_SECTIONS, ...LOCATION_SECTIONS, ...PRICE_SECTIONS, ...PRESALE_SECTIONS].find(s => s.title === title);

describe("DataSectionBlock", () => {
  // 헤더(제목) 항상 표시 — 접힌 상태에서도
  it("기본 접힘 상태에서 섹션 제목 헤더를 표시한다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<DataSectionBlock section={/** @type {any} */ (find("교통 상세"))} apt={apt} />);
    expect(screen.getByText("교통 상세")).toBeTruthy();
  });

  // 기본 접힘 — 본문 숨김
  it("기본 접힘이면 본문(필드값)은 숨겨져 있다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<DataSectionBlock section={/** @type {any} */ (find("교통 상세"))} apt={apt} />);
    expect(screen.queryByText("영통역")).toBeNull();
  });

  // 클릭 시 펼침 (아코디언)
  it("헤더 클릭 시 본문이 펼쳐진다 — 교통 필드 표시", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<DataSectionBlock section={/** @type {any} */ (find("교통 상세"))} apt={apt} />);
    fireEvent.click(screen.getByText("교통 상세"));
    expect(screen.getByText("영통역")).toBeTruthy();
    expect(screen.getByText("1호선")).toBeTruthy();
    // busStopNames: 콤마 분리 후 쉼표+공백 join
    expect(screen.getByText("영통역입구, 삼성아파트")).toBeTruthy();
  });

  // aria-expanded 토글
  it("aria-expanded가 클릭으로 변경된다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<DataSectionBlock section={/** @type {any} */ (find("교통 상세"))} apt={apt} />);
    const toggle = screen.getByRole("button");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  // 키보드 접근성 — Enter
  it("Enter 키로 펼칠 수 있다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<DataSectionBlock section={/** @type {any} */ (find("교통 상세"))} apt={apt} />);
    fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });
    expect(screen.getByText("영통역")).toBeTruthy();
  });

  // 키보드 접근성 — Space
  it("Space 키로 펼칠 수 있다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<DataSectionBlock section={/** @type {any} */ (find("교통 상세"))} apt={apt} />);
    fireEvent.keyDown(screen.getByRole("button"), { key: " " });
    expect(screen.getByText("영통역")).toBeTruthy();
  });

  // 채움률 도넛 — hasAny 섹션 헤더에 표시 (접힌 상태에서도)
  it("데이터 있는 섹션은 접힌 상태에서도 헤더 채움률 도넛(role=img)을 표시한다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<DataSectionBlock section={/** @type {any} */ (find("교통 상세"))} apt={apt} />);
    expect(screen.getByRole("img", { name: /교통 상세.*채움률/ })).toBeTruthy();
  });

  // 빈 섹션 — 도넛 없음 + 펼치면 "데이터 수집 중..."
  it("모든 필드가 null인 섹션은 도넛이 없고, 펼치면 '데이터 수집 중...'만 표시한다", () => {
    const apt = /** @type {any} */ (makeApt({
      naverNearbyMedian: null, naverJeonseRate: null, naverSellCount: null,
      naverJeonseCount: null, naverWolseCount: null, naverSchoolWalkMin: null,
      naverNearbyCount: null, naverFetchedAt: null,
    }));
    render(<DataSectionBlock section={/** @type {any} */ (find("네이버 교차검증"))} apt={apt} />);
    // 도넛 없음
    expect(screen.queryByRole("img", { name: /네이버 교차검증.*채움률/ })).toBeNull();
    // 펼치면 "데이터 수집 중..."
    fireEvent.click(screen.getByText("네이버 교차검증"));
    expect(screen.getByText("데이터 수집 중...")).toBeTruthy();
  });

  // hideWhenEmpty — 청약 경쟁 빈 단지는 컴포넌트 자체 null 반환
  it("hideWhenEmpty 섹션은 데이터 없으면 렌더하지 않는다 (청약 경쟁)", () => {
    const apt = /** @type {any} */ (makeApt()); // competitionRate 미설정
    const { container } = render(<DataSectionBlock section={/** @type {any} */ (find("청약 경쟁 현황"))} apt={apt} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText("청약 경쟁 현황")).toBeNull();
  });

  // hideWhenEmpty — 경쟁률 있으면 노출 + 콤마 포맷
  it("경쟁률이 있으면 '청약 경쟁 현황' 섹션과 콤마 포맷 값을 표시한다", () => {
    const apt = /** @type {any} */ (makeApt({ competitionRate: 437995, competitionSupply: 300, competitionApplicants: 12000000 }));
    render(<DataSectionBlock section={/** @type {any} */ (find("청약 경쟁 현황"))} apt={apt} />);
    expect(screen.getByText("청약 경쟁 현황")).toBeTruthy();
    fireEvent.click(screen.getByText("청약 경쟁 현황"));
    expect(screen.getByText("437,995:1")).toBeTruthy();
  });

  // presaleStage=null이어도 경쟁률 있으면 노출 (세션365 게이트 준수)
  it("presaleStage=null이어도 경쟁률 있으면 노출한다", () => {
    const apt = /** @type {any} */ (makeApt({ presaleStage: null, competitionRate: 5.2 }));
    render(<DataSectionBlock section={/** @type {any} */ (find("청약 경쟁 현황"))} apt={apt} />);
    fireEvent.click(screen.getByText("청약 경쟁 현황"));
    expect(screen.getByText("5.2:1")).toBeTruthy();
  });

  // 교통 필드 null → "—"
  it("교통 필드가 null이면 '—'을 표시한다", () => {
    const apt = /** @type {any} */ (makeApt({ subwayName: null, subwayLines: null, busStopNames: null }));
    render(<DataSectionBlock section={/** @type {any} */ (find("교통 상세"))} apt={apt} />);
    fireEvent.click(screen.getByText("교통 상세"));
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(3);
  });

  // 생활인프라 — pairs 섹션 렌더
  it("생활인프라 섹션은 인프라 개수/거리를 표시한다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<DataSectionBlock section={/** @type {any} */ (find("생활인프라 (반경 1km)"))} apt={apt} />);
    expect(screen.getByRole("img", { name: /생활인프라.*채움률/ })).toBeTruthy();
  });

  // 시장/투자 지표 — highlight 섹션
  it("시장/투자 지표 섹션은 펼치면 PIR 등 강조 필드를 표시한다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<DataSectionBlock section={/** @type {any} */ (find("시장/투자 지표"))} apt={apt} />);
    fireEvent.click(screen.getByText("시장/투자 지표"));
    // pir=5 (HighlightField 도메인 설명 포함)
    expect(screen.getByText(/연소득 대비 분양가/)).toBeTruthy();
  });

  // defaultOpen=true 면 처음부터 펼침
  it("defaultOpen=true면 처음부터 본문이 보인다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<DataSectionBlock section={/** @type {any} */ (find("교통 상세"))} apt={apt} defaultOpen />);
    expect(screen.getByText("영통역")).toBeTruthy();
  });

  // 세션 411 — hint 있는 섹션 헤더에 ? 도움말 + 클릭이 섹션 토글과 분리(stopPropagation)
  it("hint 있는 섹션('청약 경쟁 현황')은 헤더에 ? 도움말을 표시한다", () => {
    const apt = /** @type {any} */ (makeApt({ competitionRate: 5.2 }));
    render(<DataSectionBlock section={/** @type {any} */ (find("청약 경쟁 현황"))} apt={apt} />);
    expect(screen.getByLabelText("청약 경쟁 현황 풀이 보기")).toBeInTheDocument();
  });

  it("? 클릭은 섹션을 펼치지 않는다 (stopPropagation — 토글과 분리)", () => {
    const apt = /** @type {any} */ (makeApt({ competitionRate: 5.2 }));
    render(<DataSectionBlock section={/** @type {any} */ (find("청약 경쟁 현황"))} apt={apt} />);
    // 헤더 토글 button = aria-expanded 보유 (? 트리거도 role=button 이라 expanded 로 특정)
    const toggle = screen.getByRole("button", { expanded: false });
    fireEvent.click(screen.getByLabelText("청약 경쟁 현황 풀이 보기"));
    // 섹션은 여전히 접힘(? 클릭이 부모 토글로 전파 안 됨), 도움말만 표시
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("tooltip")).toHaveTextContent(/몇 대 1/);
  });

  it("hint 없는 섹션('교통 상세')은 헤더에 ? 도움말이 없다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<DataSectionBlock section={/** @type {any} */ (find("교통 상세"))} apt={apt} />);
    expect(screen.queryByLabelText(/풀이 보기$/)).toBeNull();
  });
});

describe("부가블록 3종", () => {
  it("NearbyFacilitiesBlock — nearbyFacilities가 있으면 표시", () => {
    const apt = /** @type {any} */ (makeApt({
      nearbyFacilities: [{ name: "이마트", dist: 200 }, { name: "올리브영", dist: 450 }],
    }));
    render(<NearbyFacilitiesBlock apt={apt} />);
    expect(screen.getByText("이마트")).toBeTruthy();
    expect(screen.getByText("200m")).toBeTruthy();
  });

  it("NearbyFacilitiesBlock — nearbyFacilities 없으면 null", () => {
    const apt = /** @type {any} */ (makeApt());
    const { container } = render(<NearbyFacilitiesBlock apt={apt} />);
    expect(container.firstChild).toBeNull();
  });

  it("PriceByFloorBlock — priceByFloor가 있으면 층별 매매가 표시", () => {
    const apt = /** @type {any} */ (makeApt({
      priceByFloor: [{ group: "저층", avg: 50000, count: 3 }],
    }));
    render(<PriceByFloorBlock apt={apt} />);
    expect(screen.getByText("층별 매매가 (주변 실거래)")).toBeTruthy();
    expect(screen.getByText("저층")).toBeTruthy();
  });

  it("AnnouncementLink — announcementUrl이 있으면 '국토부 모집공고 원문' 링크", () => {
    const apt = /** @type {any} */ (makeApt({ announcementUrl: "https://example.com" }));
    render(<AnnouncementLink apt={apt} />);
    expect(screen.getByText("국토부 모집공고 원문 보기")).toBeTruthy();
  });

  it("AnnouncementLink — announcementUrl 없으면 null", () => {
    const apt = /** @type {any} */ (makeApt());
    const { container } = render(<AnnouncementLink apt={apt} />);
    expect(container.firstChild).toBeNull();
  });
});
