// @ts-check
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DataSectionBlock, NearbyFacilitiesBlock, PriceByFloorBlock, AnnouncementLink } from "./DataSectionBlock";
import { LOCATION_SECTIONS, PRICE_SECTIONS, PRESALE_SECTIONS, OVERVIEW_SECTIONS } from "@/lib/dataSections";
import { makeApt } from "@/__tests__/factories";

// 그룹 상수에서 제목으로 섹션 찾기 (구 DATA_SECTIONS 단언을 섹션 단위로 이전)
/** @param {string} title */
const find = (title) =>
  [...OVERVIEW_SECTIONS, ...LOCATION_SECTIONS, ...PRICE_SECTIONS, ...PRESALE_SECTIONS].find((s) => s.title === title);

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
  // 세션 412: 교통 상세에 hint 추가 → 헤더 토글 + ? 트리거 둘 다 role=button.
  // 헤더 토글은 aria-expanded 보유로 특정(? 트리거는 expanded 속성 없음).
  it("aria-expanded가 클릭으로 변경된다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<DataSectionBlock section={/** @type {any} */ (find("교통 상세"))} apt={apt} />);
    const toggle = screen.getByRole("button", { expanded: false });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  // 키보드 접근성 — Enter
  it("Enter 키로 펼칠 수 있다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<DataSectionBlock section={/** @type {any} */ (find("교통 상세"))} apt={apt} />);
    fireEvent.keyDown(screen.getByRole("button", { expanded: false }), { key: "Enter" });
    expect(screen.getByText("영통역")).toBeTruthy();
  });

  // 키보드 접근성 — Space
  it("Space 키로 펼칠 수 있다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<DataSectionBlock section={/** @type {any} */ (find("교통 상세"))} apt={apt} />);
    fireEvent.keyDown(screen.getByRole("button", { expanded: false }), { key: " " });
    expect(screen.getByText("영통역")).toBeTruthy();
  });

  // 채움률 도넛 — hasAny 섹션 헤더에 표시 (접힌 상태에서도)
  it("데이터 있는 섹션은 접힌 상태에서도 헤더 채움률 도넛(role=img)을 표시한다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<DataSectionBlock section={/** @type {any} */ (find("교통 상세"))} apt={apt} />);
    expect(screen.getByRole("img", { name: /교통 상세.*채움률/ })).toBeTruthy();
  });

  // 빈 섹션 — 도넛 없음 + 펼치면 "데이터 수집 중..."
  // ⚠️ 세션 507: 옛 대상이던 "네이버 교차검증" 섹션은 사라졌다(두 출처 대조표가 대체).
  //    분기 자체는 그대로라 잔존 섹션("치안/환경")으로 옮겨 검증한다.
  it("모든 필드가 null인 섹션은 도넛이 없고, 펼치면 '데이터 수집 중...'만 표시한다", () => {
    const apt = /** @type {any} */ (
      makeApt({
        crimeSafetyGrade: null,
        airQuality: null,
        noxious: null,
        noxiousDist: null,
        view: null,
        noise: null,
      })
    );
    render(<DataSectionBlock section={/** @type {any} */ (find("치안/환경"))} apt={apt} />);
    // 도넛 없음
    expect(screen.queryByRole("img", { name: /치안\/환경.*채움률/ })).toBeNull();
    // 펼치면 "데이터 수집 중..."
    fireEvent.click(screen.getByText("치안/환경"));
    expect(screen.getByText("데이터 수집 중...")).toBeTruthy();
  });

  // 세션 507 Q6 — 일조는 전 단지 "양호"(변별력 0)라 표에서 뺐다. 되돌아오면 여기가 빨개진다.
  it("치안/환경 섹션을 펼쳐도 '일조'는 없다 (세션 507 — 전 단지 같은 값)", () => {
    const apt = /** @type {any} */ (makeApt({ sunlight: "양호" }));
    render(<DataSectionBlock section={/** @type {any} */ (find("치안/환경"))} apt={apt} />);
    fireEvent.click(screen.getByText("치안/환경"));
    expect(screen.queryByText("일조")).toBeNull();
  });

  // hideWhenEmpty — 세션 505 로 실제 섹션에서는 사라졌지만(청약 경쟁이 "분양 안전"에 합쳐지며
  // 게이트를 뗐다) 컴포넌트 분기는 남아 있다. 섹션 객체를 직접 주입해 정직하게 검증한다.
  it("hideWhenEmpty 섹션은 데이터 없으면 렌더하지 않는다", () => {
    const apt = /** @type {any} */ (makeApt()); // competitionRate 미설정
    const section = /** @type {any} */ ({
      title: "가상 섹션",
      grid: ["competitionRate"],
      hideWhenEmpty: true,
    });
    const { container } = render(<DataSectionBlock section={section} apt={apt} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText("가상 섹션")).toBeNull();
  });

  // 경쟁률 노출 + 콤마 포맷 (세션 505: "청약 경쟁 현황" → "분양 안전"으로 합침)
  it("경쟁률이 있으면 '분양 안전' 섹션과 콤마 포맷 값을 표시한다", () => {
    const apt = /** @type {any} */ (
      makeApt({ competitionRate: 437995, competitionSupply: 300, competitionApplicants: 12000000 })
    );
    render(<DataSectionBlock section={/** @type {any} */ (find("분양 안전"))} apt={apt} />);
    expect(screen.getByText("분양 안전")).toBeTruthy();
    fireEvent.click(screen.getByText("분양 안전"));
    expect(screen.getByText("437,995:1")).toBeTruthy();
  });

  // presaleStage=null이어도 경쟁률 있으면 노출 (세션365 게이트 준수)
  it("presaleStage=null이어도 경쟁률 있으면 노출한다", () => {
    const apt = /** @type {any} */ (makeApt({ presaleStage: null, competitionRate: 5.2 }));
    render(<DataSectionBlock section={/** @type {any} */ (find("분양 안전"))} apt={apt} />);
    fireEvent.click(screen.getByText("분양 안전"));
    expect(screen.getByText("5.2:1")).toBeTruthy();
  });

  // 세션 505: 경쟁률이 비어도 계약해제율은 남는다 — hideWhenEmpty 를 뗀 이유가 이것이다
  it("경쟁률이 비어도 '분양 안전' 섹션은 사라지지 않는다 (계약해제율이 남는다)", () => {
    const apt = /** @type {any} */ (makeApt({ competitionRate: null, cancelRatio6m: 3.4 }));
    render(<DataSectionBlock section={/** @type {any} */ (find("분양 안전"))} apt={apt} />);
    expect(screen.getByText("분양 안전")).toBeTruthy();
  });

  // 교통 필드 null → "—"
  it("교통 필드가 null이면 '—'을 표시한다", () => {
    const apt = /** @type {any} */ (makeApt({ subwayName: null, subwayLines: null, busStopNames: null }));
    render(<DataSectionBlock section={/** @type {any} */ (find("교통 상세"))} apt={apt} />);
    fireEvent.click(screen.getByText("교통 상세"));
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(3);
  });

  // pairs 섹션 렌더 — 세션 505 로 "생활인프라 (반경 1km)" 실제 섹션은 없앴다
  // (거리 점 그림이 개수까지 병기해 흡수). 컴포넌트의 pairs 분기는 남아 있어 주입으로 검증한다.
  it("pairs 섹션은 인프라 개수/거리를 표시한다", () => {
    const apt = /** @type {any} */ (makeApt());
    const section = /** @type {any} */ ({
      title: "가상 인프라",
      pairs: [
        ["hospital", "hospitalDist"],
        ["mart", "martDist"],
      ],
    });
    render(<DataSectionBlock section={section} apt={apt} />);
    expect(screen.getByRole("img", { name: /가상 인프라.*채움률/ })).toBeTruthy();
  });

  // 이 동네 거래 시세 — highlight 섹션 (세션 507: 옛 "시장/투자 지표" 를 갈아 낀 이름)
  it("'이 동네 거래 시세' 섹션은 펼치면 PIR 등 강조 필드를 표시한다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<DataSectionBlock section={/** @type {any} */ (find("이 동네 거래 시세"))} apt={apt} />);
    fireEvent.click(screen.getByText("이 동네 거래 시세"));
    // pir=5 (HighlightField 도메인 설명 포함)
    expect(screen.getByText(/연소득 대비 분양가/)).toBeTruthy();
  });

  // 세션 507 — 인구증감률은 이 단지 값이 아니라 시·도 통계라 이 표에서 내려갔다.
  // 강조줄에 되돌아오면 다시 단지 값처럼 읽히므로 그 자리를 잠근다.
  it("'이 동네 거래 시세' 강조줄에 인구증감률이 없다 (지역 통계로 이동)", () => {
    const apt = /** @type {any} */ (makeApt({ popGrowth: 0.3 }));
    render(<DataSectionBlock section={/** @type {any} */ (find("이 동네 거래 시세"))} apt={apt} />);
    fireEvent.click(screen.getByText("이 동네 거래 시세"));
    expect(screen.queryByText("인구증감률")).toBeNull();
    expect(screen.queryByText(/양수면 유입 지역/)).toBeNull();
  });

  // defaultOpen=true 면 처음부터 펼침
  it("defaultOpen=true면 처음부터 본문이 보인다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<DataSectionBlock section={/** @type {any} */ (find("교통 상세"))} apt={apt} defaultOpen />);
    expect(screen.getByText("영통역")).toBeTruthy();
  });

  // 세션 411 — hint 있는 섹션 헤더에 ? 도움말 + 클릭이 섹션 토글과 분리(stopPropagation)
  it("hint 있는 섹션('분양 안전')은 헤더에 ? 도움말을 표시한다", () => {
    const apt = /** @type {any} */ (makeApt({ competitionRate: 5.2 }));
    render(<DataSectionBlock section={/** @type {any} */ (find("분양 안전"))} apt={apt} />);
    expect(screen.getByLabelText("분양 안전 풀이 보기")).toBeInTheDocument();
  });

  it("? 클릭은 섹션을 펼치지 않는다 (stopPropagation — 토글과 분리)", () => {
    const apt = /** @type {any} */ (makeApt({ competitionRate: 5.2 }));
    render(<DataSectionBlock section={/** @type {any} */ (find("분양 안전"))} apt={apt} />);
    // 헤더 토글 button = aria-expanded 보유 (? 트리거도 role=button 이라 expanded 로 특정)
    const toggle = screen.getByRole("button", { expanded: false });
    fireEvent.click(screen.getByLabelText("분양 안전 풀이 보기"));
    // 섹션은 여전히 접힘(? 클릭이 부모 토글로 전파 안 됨), 도움말만 표시
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("tooltip")).toHaveTextContent(/몇 대 1/);
  });

  // 세션 412: 모든 실제 섹션이 hint 를 가지므로, hint 없는 섹션 객체를 직접 주입해
  // DataSectionBlock 의 조건부 렌더(section.hint && <HelpHint/>)를 정직하게 검증.
  it("hint 없는 섹션은 헤더에 ? 도움말이 없다", () => {
    const apt = /** @type {any} */ (makeApt());
    const noHintSection = /** @type {any} */ ({ title: "테스트 섹션", grid: ["subwayName", "subwayLines"] });
    render(<DataSectionBlock section={noHintSection} apt={apt} />);
    expect(screen.queryByLabelText(/풀이 보기$/)).toBeNull();
  });
});

describe("부가블록 3종", () => {
  it("NearbyFacilitiesBlock — nearbyFacilities가 있으면 표시", () => {
    const apt = /** @type {any} */ (
      makeApt({
        nearbyFacilities: [
          { name: "이마트", dist: 200 },
          { name: "올리브영", dist: 450 },
        ],
      })
    );
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
    const apt = /** @type {any} */ (
      makeApt({
        priceByFloor: [{ group: "저층", avg: 50000, count: 3 }],
      })
    );
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
