// @ts-check
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DataSectionBlock, NearbyFacilitiesBlock, PriceByFloorBlock, AnnouncementLink } from "./DataSectionBlock";
import { LOCATION_SECTIONS, PRESALE_SECTIONS, OVERVIEW_SECTIONS } from "@/lib/dataSections";
import { makeApt } from "@/__tests__/factories";

// 그룹 상수에서 제목으로 섹션 찾기 (구 DATA_SECTIONS 단언을 섹션 단위로 이전)
/** @param {string} title */
const find = (title) =>
  [...OVERVIEW_SECTIONS, ...LOCATION_SECTIONS, ...PRESALE_SECTIONS].find((s) => s.title === title);

/**
 * 일반 동작(헤더·접힘·키보드·도넛) 검증용 섹션 — 세션591 이전 실제 "치안/환경" 섹션과 같은 모양.
 *
 * 세션591 L5 에 그 실제 섹션이 `detail/LocationEnvBlock` 칩으로 해체돼 `LOCATION_SECTIONS` 가 비었다.
 * 이 컴포넌트는 종합("단지 기본정보")·시세("이 동네 거래 시세")·분양("분양 안전") 탭이 여전히 쓰므로,
 * 동작 시험은 지우지 않고 같은 모양의 섹션 객체를 직접 주입해 이어 간다.
 */
const ENV_FIXTURE = {
  title: "치안/환경",
  grid: ["crimeSafetyGrade", "airQuality", "noxious", "noxiousDist", "view", "noise"],
  hint: "주변 치안 안전등급, 대기질(미세먼지), 혐오시설, 조망·소음(dB) 시험용 섹션이에요.",
};

describe("DataSectionBlock", () => {
  // ⚠️ 세션508 PR-3b B1: 옛 대상이던 "교통 상세" 섹션은 `LOCATION_SECTIONS` 에서 완전히
  //    빠지고 전용 카드(`detail/TransportCard`)로 승격했다. 이 파일이 보던 "일반 동작"
  //    (헤더·접힘·키보드·도넛) 검증은 잔존 섹션("치안/환경")으로 옮겼고, 세션591 에 그 섹션마저
  //    칩으로 해체돼 같은 모양의 주입 섹션(ENV_FIXTURE)으로 이어 간다.

  // 헤더(제목) 항상 표시 — 접힌 상태에서도
  it("기본 접힘 상태에서 섹션 제목 헤더를 표시한다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<DataSectionBlock section={/** @type {any} */ (ENV_FIXTURE)} apt={apt} />);
    expect(screen.getByText("치안/환경")).toBeTruthy();
  });

  // 기본 접힘 — 본문 숨김
  it("기본 접힘이면 본문(필드값)은 숨겨져 있다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<DataSectionBlock section={/** @type {any} */ (ENV_FIXTURE)} apt={apt} />);
    expect(screen.queryByText("그린")).toBeNull();
  });

  // 클릭 시 펼침 (아코디언)
  it("헤더 클릭 시 본문이 펼쳐진다 — 치안/환경 필드 표시", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<DataSectionBlock section={/** @type {any} */ (ENV_FIXTURE)} apt={apt} />);
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
    render(<DataSectionBlock section={/** @type {any} */ (ENV_FIXTURE)} apt={apt} />);
    const toggle = screen.getByRole("button", { expanded: false });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  // 키보드 접근성 — Enter
  it("Enter 키로 펼칠 수 있다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<DataSectionBlock section={/** @type {any} */ (ENV_FIXTURE)} apt={apt} />);
    fireEvent.keyDown(screen.getByRole("button", { expanded: false }), { key: "Enter" });
    expect(screen.getByText("그린")).toBeTruthy();
  });

  // 키보드 접근성 — Space
  it("Space 키로 펼칠 수 있다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<DataSectionBlock section={/** @type {any} */ (ENV_FIXTURE)} apt={apt} />);
    fireEvent.keyDown(screen.getByRole("button", { expanded: false }), { key: " " });
    expect(screen.getByText("그린")).toBeTruthy();
  });

  // 채움률 도넛 — hasAny 섹션 헤더에 표시 (접힌 상태에서도)
  it("데이터 있는 섹션은 접힌 상태에서도 헤더 채움률 도넛(role=img)을 표시한다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<DataSectionBlock section={/** @type {any} */ (ENV_FIXTURE)} apt={apt} />);
    expect(screen.getByRole("img", { name: /치안\/환경.*채움률/ })).toBeTruthy();
  });

  // 빈 섹션 — 세션595 D3: 옛 판은 제목 상자를 그리고 펼치면 "데이터 수집 중..."을 띄웠다(우리 수집 상태를 손님에게
  //   말하는 글). 이제 필드가 전부 null 이면 섹션 자체를 안 그린다 — 전 섹션 기본(옛 hideWhenEmpty 칸은 뺐다).
  const ALL_NULL_ENV = {
    crimeSafetyGrade: null,
    airQuality: null,
    noxious: null,
    noxiousDist: null,
    view: null,
    noise: null,
  };
  it("모든 필드가 null인 섹션은 렌더 없음 — 제목·도넛·'수집 중' 글자 0", () => {
    const apt = /** @type {any} */ (makeApt(ALL_NULL_ENV));
    const { container } = render(<DataSectionBlock section={/** @type {any} */ (ENV_FIXTURE)} apt={apt} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText("치안/환경")).toBeNull();
    expect(container.textContent).not.toMatch(/수집/);
  });

  it("필드가 하나라도 있으면 그린다 (양성 대조 — 소음만 있는 섹션)", () => {
    const apt = /** @type {any} */ (makeApt({ ...ALL_NULL_ENV, noise: 55 }));
    render(<DataSectionBlock section={/** @type {any} */ (ENV_FIXTURE)} apt={apt} />);
    expect(screen.getByText("치안/환경")).toBeTruthy();
    fireEvent.click(screen.getByText("치안/환경"));
    expect(screen.getByText("55dB")).toBeTruthy();
  });

  // 세션 507 Q6 — 일조는 전 단지 "양호"(변별력 0)라 표에서 뺐다. 세션591 에 그 실제 섹션이 없어졌으므로
  //   이 검사는 "입지 탭 표가 되살아나지 않는다"로 바뀐다. 칩 쪽 일조 없음은 `LocationEnvBlock.test.tsx`.
  it("입지 탭 '치안/환경' 표는 되살아나지 않는다 (세션591 — 칩으로 해체, 일조는 어디에도 없다)", () => {
    expect(find("치안/환경")).toBeUndefined();
    expect(LOCATION_SECTIONS.flatMap((s) => s.grid ?? [])).not.toContain("sunlight");
  });

  // 옛 hideWhenEmpty 시험(세션 505)은 세션595 에 칸이 빠지며 위 "모든 필드가 null 이면 렌더 없음" 시험으로 합쳤다 —
  //   플래그 없이도(전 섹션 기본) 같은 결과다. 실제 섹션 하나로도 확인한다.
  //   ⚠️ 세션609 라: 그 실제 섹션('이 동네 거래 시세')은 세션589 에 접힘째 없어졌다(사장님 결정 V1·V11 — 시세 탭은
  //   섹션 0). 빈 섹션 숨김은 위 합성 섹션 시험이 지키고, 여기는 그 섹션이 되살아나지 않는지만 잠근다.
  it("시세 탭 '이 동네 거래 시세' 섹션은 되살아나지 않는다 (세션589 — 시세 탭 섹션 0)", () => {
    expect(find("이 동네 거래 시세")).toBeUndefined();
  });

  // ⚠️ 세션508 PR-3c C3: 옛 대상이던 경쟁률 콤마 포맷 2건은 그림(`charts/PresaleTimeline`)
  //    으로 이관됐다 — `competitionRate`·`competitionSupply`·`competitionApplicants` 가
  //    PRESALE_SECTIONS.grid 에서 빠지고 청약 진행 그림 아래 실값 병기로 옮겨갔다. 콤마
  //    포맷("437,995 : 1") 검증은 `PresaleTimeline.test.tsx` 가 이미 갖고 있다.

  // 세션591 P3 — 옛 "분양 안전" 접힘(계약해제율 1칸)은 해체됐다. 계약해제율은 시·군·구 값이라
  //   `detail/RegionStats` 눈금으로 옮겼다(그쪽 도달은 RegionStats.test.jsx · tabExtraFields.test.ts).
  it("분양 탭 '분양 안전' 표는 되살아나지 않는다 (세션591 — 계약해제율은 지역 통계 눈금으로)", () => {
    expect(find("분양 안전")).toBeUndefined();
    expect(PRESALE_SECTIONS).toEqual([]);
  });

  // 세션508 PR-3b: 교통 필드 null → "—" 검증은 TransportCard.test.tsx 로 이관했다
  // (subwayName·subwayLines·busStopNames 는 이제 LOCATION_SECTIONS 를 안 거친다).

  // highlight 섹션 — 강조줄 분기 검증.
  // ⚠️ 세션589: 옛 대상이던 시세 탭 "이 동네 거래 시세"(PIR·PSR 강조줄)는 접힘째 없앴다
  //    (PSR 은 시세 탭 맨 위 게이지, PIR 은 종합 탭 편차 줄). 강조줄 분기 자체는 그대로라
  //    남은 highlight 섹션("단지 기본정보" — 데이터 신뢰도)으로 옮겨 검증한다.
  it("'단지 기본정보' 섹션은 펼치면 강조 필드(데이터 신뢰도)를 표시한다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<DataSectionBlock section={/** @type {any} */ (find("단지 기본정보"))} apt={apt} />);
    fireEvent.click(screen.getByText("단지 기본정보"));
    // HighlightField 도메인 설명 포함
    expect(screen.getByText(/핵심 데이터 수집 완성도/)).toBeTruthy();
  });

  // 세션589 — 그 접힘이 섹션 목록으로 되돌아오면(= 시세 탭에 접힘이 되살아나면) red.
  it("'이 동네 거래 시세' 섹션은 더는 없다 (시세 탭 접힘 삭제, 세션589)", () => {
    expect(find("이 동네 거래 시세")).toBeUndefined();
  });

  // defaultOpen=true 면 처음부터 펼침
  it("defaultOpen=true면 처음부터 본문이 보인다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<DataSectionBlock section={/** @type {any} */ (ENV_FIXTURE)} apt={apt} defaultOpen />);
    expect(screen.getByText("그린")).toBeTruthy();
  });

  // 세션 411 — hint 있는 섹션 헤더에 ? 도움말 + 클릭이 섹션 토글과 분리(stopPropagation)
  // ⚠️ 세션591 P3: 옛 대상이던 "분양 안전" 섹션이 해체돼 같은 동작을 주입 섹션(ENV_FIXTURE)으로 이어 간다.
  it("hint 있는 섹션은 헤더에 ? 도움말을 표시한다", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<DataSectionBlock section={/** @type {any} */ (ENV_FIXTURE)} apt={apt} />);
    expect(screen.getByLabelText("치안/환경 풀이 보기")).toBeInTheDocument();
  });

  it("? 클릭은 섹션을 펼치지 않는다 (stopPropagation — 토글과 분리)", () => {
    const apt = /** @type {any} */ (makeApt());
    render(<DataSectionBlock section={/** @type {any} */ (ENV_FIXTURE)} apt={apt} />);
    // 헤더 토글 button = aria-expanded 보유 (? 트리거도 role=button 이라 expanded 로 특정)
    const toggle = screen.getByRole("button", { expanded: false });
    fireEvent.click(screen.getByLabelText("치안/환경 풀이 보기"));
    // 섹션은 여전히 접힘(? 클릭이 부모 토글로 전파 안 됨), 도움말만 표시
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("tooltip")).toHaveTextContent(/치안 안전등급/);
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
    expect(screen.getByText("층별 매매가 (시·군·구 전체 실거래)")).toBeTruthy();
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
