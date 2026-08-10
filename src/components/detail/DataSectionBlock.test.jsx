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
  // ⚠️ 세션508 PR-3b B1: 옛 대상이던 "교통 상세" 섹션은 `LOCATION_SECTIONS` 에서 완전히
  //    빠지고 전용 카드(`detail/TransportCard`)로 승격했다 — 그 컴포넌트가 이제 역 이름·
  //    노선·정류장 값을 그린다(검증은 `TransportCard.test.tsx`). 이 파일이 보던 "일반 동작"
  //    (헤더·접힘·키보드·도넛) 검증은 잔존 섹션("치안/환경")으로 옮긴다.

  // 헤더(제목) 항상 표시 — 접힌 상태에서도
  it("기본 접힘 상태에서 섹션 제목 헤더를 표시한다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<DataSectionBlock section={/** @type {any} */ (find("치안/환경"))} apt={apt} />);
    expect(screen.getByText("치안/환경")).toBeTruthy();
  });

  // 기본 접힘 — 본문 숨김
  it("기본 접힘이면 본문(필드값)은 숨겨져 있다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<DataSectionBlock section={/** @type {any} */ (find("치안/환경"))} apt={apt} />);
    expect(screen.queryByText("그린")).toBeNull();
  });

  // 클릭 시 펼침 (아코디언)
  it("헤더 클릭 시 본문이 펼쳐진다 — 치안/환경 필드 표시", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<DataSectionBlock section={/** @type {any} */ (find("치안/환경"))} apt={apt} />);
    fireEvent.click(screen.getByText("치안/환경"));
    // view="그린"(조망) · noise=55(소음dB) — makeApt 기본값
    expect(screen.getByText("그린")).toBeTruthy();
    expect(screen.getByText("55dB")).toBeTruthy();
  });

  // aria-expanded 토글
  // 세션 412: 치안/환경에 hint 추가 → 헤더 토글 + ? 트리거 둘 다 role=button.
  // 헤더 토글은 aria-expanded 보유로 특정(? 트리거는 expanded 속성 없음).
  it("aria-expanded가 클릭으로 변경된다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<DataSectionBlock section={/** @type {any} */ (find("치안/환경"))} apt={apt} />);
    const toggle = screen.getByRole("button", { expanded: false });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  // 키보드 접근성 — Enter
  it("Enter 키로 펼칠 수 있다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<DataSectionBlock section={/** @type {any} */ (find("치안/환경"))} apt={apt} />);
    fireEvent.keyDown(screen.getByRole("button", { expanded: false }), { key: "Enter" });
    expect(screen.getByText("그린")).toBeTruthy();
  });

  // 키보드 접근성 — Space
  it("Space 키로 펼칠 수 있다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<DataSectionBlock section={/** @type {any} */ (find("치안/환경"))} apt={apt} />);
    fireEvent.keyDown(screen.getByRole("button", { expanded: false }), { key: " " });
    expect(screen.getByText("그린")).toBeTruthy();
  });

  // 채움률 도넛 — hasAny 섹션 헤더에 표시 (접힌 상태에서도)
  it("데이터 있는 섹션은 접힌 상태에서도 헤더 채움률 도넛(role=img)을 표시한다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<DataSectionBlock section={/** @type {any} */ (find("치안/환경"))} apt={apt} />);
    expect(screen.getByRole("img", { name: /치안\/환경.*채움률/ })).toBeTruthy();
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

  // ⚠️ 세션508 PR-3c C3: 옛 대상이던 경쟁률 콤마 포맷 2건은 그림(`charts/PresaleTimeline`)
  //    으로 이관됐다 — `competitionRate`·`competitionSupply`·`competitionApplicants` 가
  //    PRESALE_SECTIONS.grid 에서 빠지고 청약 진행 그림 아래 실값 병기로 옮겨갔다. 콤마
  //    포맷("437,995 : 1") 검증은 `PresaleTimeline.test.tsx` 가 이미 갖고 있다.

  // 세션 505: 경쟁률이 비어도 계약해제율은 남는다 — hideWhenEmpty 를 뗀 이유가 이것이다
  it("경쟁률이 비어도 '분양 안전' 섹션은 사라지지 않는다 (계약해제율이 남는다)", () => {
    const apt = /** @type {any} */ (makeApt({ competitionRate: null, cancelRatio6m: 3.4 }));
    render(<DataSectionBlock section={/** @type {any} */ (find("분양 안전"))} apt={apt} />);
    expect(screen.getByText("분양 안전")).toBeTruthy();
  });

  // 세션508 PR-3b: 교통 필드 null → "—" 검증은 TransportCard.test.tsx 로 이관했다
  // (subwayName·subwayLines·busStopNames 는 이제 LOCATION_SECTIONS 를 안 거친다).

  // pairs 섹션 렌더 — 세션 505 로 "생활인프라 (반경 1km)" 실제 섹션은 없앴다(거리 점 그림이
  // 개수까지 병기해 흡수). ⚠️ 세션508 PR-3b B1: `InfrastructureSection`(pairs 실제 렌더)은
  // 죽은 코드로 삭제됐다 — DataSectionBlock 은 이제 `section.pairs` 를 안 읽는다. 다만
  // `fieldsOf()`(lib/dataSections)는 여전히 pairs 를 채움률 계산에 펼치므로, 이 테스트는
  // "InfrastructureSection이 렌더한다"가 아니라 "pairs 필드도 채움률 도넛 계산에 들어간다"만
  // 정직하게 검증한다(주입 섹션이라 실제 4그룹엔 pairs 를 쓰는 곳이 없다).
  it("pairs 필드도 채움률 도넛 계산에 들어간다 (렌더는 안 함 — InfrastructureSection 삭제)", () => {
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
    render(<DataSectionBlock section={/** @type {any} */ (find("치안/환경"))} apt={apt} defaultOpen />);
    expect(screen.getByText("그린")).toBeTruthy();
  });

  // 세션 411 — hint 있는 섹션 헤더에 ? 도움말 + 클릭이 섹션 토글과 분리(stopPropagation)
  it("hint 있는 섹션('분양 안전')은 헤더에 ? 도움말을 표시한다", () => {
    const apt = /** @type {any} */ (makeApt({ competitionRate: 5.2 }));
    render(<DataSectionBlock section={/** @type {any} */ (find("분양 안전"))} apt={apt} />);
    expect(screen.getByLabelText("분양 안전 풀이 보기")).toBeInTheDocument();
  });

  it("? 클릭은 섹션을 펼치지 않는다 (stopPropagation — 토글과 분리)", () => {
    const apt = /** @type {any} */ (makeApt({ cancelRatio6m: 3.4 }));
    render(<DataSectionBlock section={/** @type {any} */ (find("분양 안전"))} apt={apt} />);
    // 헤더 토글 button = aria-expanded 보유 (? 트리거도 role=button 이라 expanded 로 특정)
    const toggle = screen.getByRole("button", { expanded: false });
    fireEvent.click(screen.getByLabelText("분양 안전 풀이 보기"));
    // 섹션은 여전히 접힘(? 클릭이 부모 토글로 전파 안 됨), 도움말만 표시
    // ⚠️ 세션508 PR-3c C3: 청약경쟁 3필드가 그림으로 옮겨가며 hint 문구도 계약해제율
    //    중심으로 바뀌었다("몇 대 1" 문구는 이제 없다).
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("tooltip")).toHaveTextContent(/계약해제율/);
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
    // 거래 건수를 "N건"으로 병기한다 (세션508 PR-3b B3)
    expect(screen.getByText("3건")).toBeTruthy();
  });

  // 세션508 PR-3b B3 — priceByFloor 가 비면 빈 틀을 남기지 않는다.
  // (초안의 "94.2% 채움" 은 어느 모수로도 재현 안 되는 값이었다 → 실측 = 1,488단지,
  //  정적 JSON n=1,597 기준 93.2% / 운영 API n=1,646 기준 90.4%. 세션509 정정)
  it("PriceByFloorBlock — priceByFloor가 비어 있으면 null (빈 틀 금지)", () => {
    const apt = /** @type {any} */ (makeApt({ priceByFloor: [] }));
    const { container } = render(<PriceByFloorBlock apt={apt} />);
    expect(container.firstChild).toBeNull();
  });

  // avgFloor·floorRange 흡수 — SourceComparison "평균 거래 층수" 행과 PRICE_SECTIONS.grid
  // "거래 층수 범위"를 문장으로 대체한 자리 (세션508 PR-3b B3).
  it("PriceByFloorBlock — 평균 거래 층수·거래 층 범위를 문장으로 흡수한다", () => {
    const apt = /** @type {any} */ (
      makeApt({
        priceByFloor: [{ group: "저층", avg: 50000, count: 3 }],
        avgFloor: 10,
        // 라이브 실측 형식 — DB 값에는 단위가 없다("1~23", 1,488건 전수). 픽스처에 "층"을
        // 붙여두면 컴포넌트가 단위를 안 붙여도 테스트가 통과해 화면과 어긋난다(세션508 실사고).
        floorRange: "1~20",
      })
    );
    render(<PriceByFloorBlock apt={apt} />);
    expect(screen.getByText(/평균 거래 층수 10층/)).toBeTruthy();
    expect(screen.getByText(/거래 층 1~20층/)).toBeTruthy();
  });

  // 폴백 가드 — SourceComparison 이 하던 은폐(우리 값이 없어 네이버 값을 대신 앉힌 상태를
  // "미수집"으로 감춤)를 그대로 이관한다. 안 하면 네이버 값을 우리가 잰 값처럼 말하게 된다.
  it("PriceByFloorBlock — _fallbackAvgFloor 면 평균 거래 층수를 문장에서 뺀다", () => {
    const apt = /** @type {any} */ (
      makeApt({
        priceByFloor: [{ group: "저층", avg: 50000, count: 3 }],
        avgFloor: 10,
        _fallbackAvgFloor: true,
        // 라이브 실측 형식 — DB 값에는 단위가 없다("1~23", 1,488건 전수). 픽스처에 "층"을
        // 붙여두면 컴포넌트가 단위를 안 붙여도 테스트가 통과해 화면과 어긋난다(세션508 실사고).
        floorRange: "1~20",
      })
    );
    render(<PriceByFloorBlock apt={apt} />);
    // 폴백인 우리 값(10층)을 그대로 말하면 네이버 값을 우리가 잰 값처럼 말하는 것과 같다.
    expect(screen.queryByText(/평균 거래 층수/)).toBeNull();
    // floorRange 는 대응하는 폴백 플래그가 없다 — 남아 있어야 한다.
    expect(screen.getByText(/거래 층 1~20층/)).toBeTruthy();
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
