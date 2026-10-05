// @ts-check
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SchoolInfo } from "./SchoolInfo";
import { makeApt } from "@/__tests__/factories";

/**
 * 학군 · 버스 (세션591 L4 — 옛 "학군 정보" 카드).
 *
 * 바뀐 것: ① 제목 "학군 정보" → "학군 · 버스" ② 초·중·고 가장 가까운 학교 3줄은 거리 점 그림의 0~1km 줄로
 * 옮겼다(`charts/DistanceDots.test.tsx` 가 지킨다) — 학교 이름·거리는 이제 "전체 N개 학교 보기" 표에서만
 * 보인다 ③ 등급 배지 + 초등 도보 → 칩 하나 ④ 옛 "교통 상세" 카드의 정류장 이름이 칩으로 합류했다.
 * 학교 표("더 보기")·1km 안 개수·등급 색·도보 색·좌표 공유 감춤은 그대로다.
 */

/** 정류장 없는 단지 — 팩토리 기본값에 정류장이 있어 "아무것도 안 그린다" 시험엔 지워야 한다 */
const noBus = { busStopNames: null };

describe("SchoolInfo", () => {
  it("학교도 정류장도 없으면 아무것도 렌더링하지 않는다 (빈 배열·null·undefined)", () => {
    for (const nearbySchools of [[], null, undefined]) {
      const apt = /** @type {any} */ (makeApt({ ...noBus, nearbySchools }));
      const { container, unmount } = render(<SchoolInfo apt={/** @type {any} */ (apt)} />);
      expect(container.innerHTML).toBe("");
      unmount();
    }
  });

  it("학교가 없어도 정류장이 있으면 '학군 · 버스' 칸에 버스 칩만 그린다 (정류장이 이 칸으로 합류)", () => {
    const apt = makeApt({ nearbySchools: [], busStopNames: "영통역입구,삼성아파트" });
    const { container } = render(<SchoolInfo apt={/** @type {any} */ (apt)} />);
    expect(screen.getByText("학군 · 버스")).toBeTruthy();
    expect(container.querySelector('[data-chip="bus"]')?.textContent).toBe("버스 정류장 영통역입구 · 삼성아파트");
    expect(screen.queryByText(/전체.*학교 보기/)).toBeNull(); // 학교가 없으니 표 버튼도 없다
  });

  it("학교가 있으면 제목과 '전체 N개 학교 보기' — 학교 이름은 접힌 상태에선 안 보인다 (최근접 3줄은 거리 그림으로)", () => {
    const apt = makeApt({
      nearbySchools: [
        { name: "영통초등학교", type: "초", distance: 300 },
        { name: "영통중학교", type: "중", distance: 800 },
      ],
    });
    render(<SchoolInfo apt={/** @type {any} */ (apt)} />);
    expect(screen.getByText("학군 · 버스")).toBeTruthy();
    expect(screen.getByText("전체 2개 학교 보기")).toBeTruthy();
    expect(screen.queryByText("영통초등학교")).toBeNull();
    fireEvent.click(screen.getByText(/전체.*학교 보기/));
    expect(screen.getByText("영통초등학교")).toBeTruthy();
    expect(screen.getByText("영통중학교")).toBeTruthy();
  });

  it("schoolGrade가 null이면 등급 배지를 표시하지 않는다", () => {
    const apt = makeApt({
      schoolGrade: null,
      nearbySchools: [{ name: "테스트초등학교", type: "초", distance: 500 }],
    });
    const { container } = render(<SchoolInfo apt={/** @type {any} */ (apt)} />);
    for (const g of ["A", "B", "C", "D"]) expect(screen.queryByText(g)).toBeNull();
    expect(container.querySelector('[data-chip="school"]')).toBeNull(); // 등급·도보 둘 다 없으면 칩 자체가 없다
  });

  // 학군 등급 배지 — schools-neis gradeFromScore 가 쓰는 A/B/C/D (세션 441 색 버그 수정)
  // A=초록(우수) / B=파랑(양호) / C=주황(보통) / D=빨강(미흡). 세션591: 배지가 칩 안으로 들어갔다.
  it("schoolGrade가 'A'이면 배지를 초록으로 표시한다 (칩 '학군 A' 안)", () => {
    const apt = makeApt({
      schoolGrade: "A",
      nearbySchools: [{ name: "강남초등학교", type: "초", distance: 200 }],
    });
    const { container } = render(<SchoolInfo apt={/** @type {any} */ (apt)} />);
    const badge = screen.getByText("A");
    expect(badge.style.color).toBe("rgb(22, 163, 74)");
    expect(container.querySelector('[data-chip="school"]')?.textContent).toContain("학군 A");
  });

  it("schoolGrade가 'B'이면 배지를 파랑으로 표시한다", () => {
    const apt = makeApt({
      schoolGrade: "B",
      nearbySchools: [{ name: "서초초등학교", type: "초", distance: 400 }],
    });
    render(<SchoolInfo apt={/** @type {any} */ (apt)} />);
    expect(screen.getByText("B").style.color).toBe("rgb(37, 99, 235)");
  });

  it("schoolGrade가 'D'이면 배지를 빨강으로 표시한다", () => {
    const apt = makeApt({
      schoolGrade: "D",
      nearbySchools: [{ name: "변두리초등학교", type: "초", distance: 600 }],
    });
    render(<SchoolInfo apt={/** @type {any} */ (apt)} />);
    expect(screen.getByText("D").style.color).toBe("rgb(220, 38, 38)");
  });

  it("표에서 distance가 null이면 '—', 1km 이상은 km 로 표시한다", () => {
    const apt = makeApt({
      nearbySchools: [
        { name: "테스트초등학교", type: "초", distance: null },
        { name: "먼고등학교", type: "고", distance: 1500 },
      ],
    });
    render(<SchoolInfo apt={/** @type {any} */ (apt)} />);
    fireEvent.click(screen.getByText(/전체.*학교 보기/));
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.getByText("1.5km")).toBeTruthy();
  });

  it("'전체 보기' 버튼 클릭 시 상세 테이블이 나타난다 ('더 보기' — 긴 목록이라 남긴다, V1 예외)", () => {
    const apt = makeApt({
      nearbySchools: [
        { name: "가까운초등학교", type: "초", distance: 200 },
        { name: "먼초등학교", type: "초", distance: 800 },
        { name: "테스트중학교", type: "중", distance: 500 },
      ],
    });
    const { container } = render(<SchoolInfo apt={/** @type {any} */ (apt)} />);
    expect(container.querySelector("table")).toBeNull();
    fireEvent.click(screen.getByText(/전체.*학교 보기/));
    expect(container.querySelector("table")).toBeTruthy();
    fireEvent.click(screen.getByText("접기"));
    expect(container.querySelector("table")).toBeNull();
  });

  it("founded가 있는 학교가 있으면 확장 시 설립년 컬럼을 표시한다", () => {
    const apt = makeApt({
      nearbySchools: [
        { name: "오래된학교", type: "초", distance: 300, founded: "1980" },
        { name: "다른학교", type: "초", distance: 500 },
      ],
    });
    render(<SchoolInfo apt={/** @type {any} */ (apt)} />);
    fireEvent.click(screen.getByText(/전체.*학교 보기/));
    expect(screen.getByText("설립년")).toBeTruthy();
    expect(screen.getByText("1980")).toBeTruthy();
  });

  it("highSchoolType이 있으면 표의 구분에 함께 표시한다", () => {
    const apt = makeApt({
      nearbySchools: [{ name: "영재고등학교", type: "고", highSchoolType: "과학고", distance: 600 }],
    });
    render(<SchoolInfo apt={/** @type {any} */ (apt)} />);
    fireEvent.click(screen.getByText("학교 정보 보기")); // 1곳 — 세션594 문장
    expect(screen.getByText("고(과학고)")).toBeTruthy();
  });

  it("1km 이내 학교 개수를 유형별로 표시한다", () => {
    const apt = makeApt({
      nearbySchools: [
        { name: "가나초등학교", type: "초", distance: 300 },
        { name: "다라초등학교", type: "초", distance: 800 },
        { name: "마바초등학교", type: "초", distance: 1500 },
        { name: "사아중학교", type: "중", distance: 600 },
      ],
    });
    render(<SchoolInfo apt={/** @type {any} */ (apt)} />);
    expect(screen.getByText(/초 2/)).toBeTruthy();
    expect(screen.getByText(/중 1/)).toBeTruthy();
  });

  it("학교가 아닌 이름(학원 등)은 세지 않는다", () => {
    const apt = makeApt({
      nearbySchools: [
        { name: "가나초등학교", type: "초", distance: 300 },
        { name: "다라수학학원", type: "초", distance: 100 },
      ],
    });
    render(<SchoolInfo apt={/** @type {any} */ (apt)} />);
    // 1곳이면 "전체 1개" 대신 "학교 정보 보기"(세션594 사장님 결정) — 2곳 이상 문장은 위 시험이 지킨다
    expect(screen.getByText("학교 정보 보기")).toBeTruthy();
    expect(screen.queryByText(/전체 1개/)).toBeNull();
  });

  it("정류장 칩 — 앞 3개 + '외 N', '미정차' 정류장은 빼고 센다 (옛 '교통 상세' 카드에서 합류, 세션591 L3 · 보완 F7)", () => {
    const apt = makeApt({
      busStopNames: "한신아파트,농수산물시장,평촌IC(미정차),꿈마을단지,귀인중학교",
      nearbySchools: [{ name: "가나초등학교", type: "초", distance: 300 }],
    });
    const { container } = render(<SchoolInfo apt={/** @type {any} */ (apt)} />);
    expect(container.querySelector('[data-chip="bus"]')?.textContent).toBe(
      "버스 정류장 한신아파트 · 농수산물시장 · 꿈마을단지 외 1"
    );
  });

  // 초등 도보거리 (세션508 PR-3b B2) — AptCard 칩 관례(≤5분 초록·6분~ 회색·null 숨김) 그대로. 세션591: 학군 칩 안.
  describe("초등 도보거리 (세션508 PR-3b B2)", () => {
    it("≤5분 → '초등 도보 N분' 초록 강조 · 등급과 한 칩('학군 A · 초등 도보 3분')", () => {
      const apt = makeApt({
        schoolGrade: "A",
        naverSchoolWalkMin: 3,
        nearbySchools: [{ name: "테스트초등학교", type: "초", distance: 300 }],
      });
      const { container } = render(<SchoolInfo apt={/** @type {any} */ (apt)} />);
      const line = screen.getByText("초등 도보 3분");
      expect(line.style.color).toBe("rgb(22, 163, 74)");
      expect(container.querySelector('[data-chip="school"]')?.textContent).toBe("학군 A · 초등 도보 3분");
    });

    it("6분~ → 회색 중립", () => {
      const apt = makeApt({
        naverSchoolWalkMin: 10,
        nearbySchools: [{ name: "테스트초등학교", type: "초", distance: 300 }],
      });
      render(<SchoolInfo apt={/** @type {any} */ (apt)} />);
      expect(screen.getByText("초등 도보 10분").style.color).not.toBe("rgb(22, 163, 74)");
    });

    it("naverSchoolWalkMin null → 줄 자체를 숨긴다 (미수집 placeholder 금지)", () => {
      const apt = makeApt({
        naverSchoolWalkMin: null,
        nearbySchools: [{ name: "테스트초등학교", type: "초", distance: 300 }],
      });
      render(<SchoolInfo apt={/** @type {any} */ (apt)} />);
      expect(screen.queryByText(/초등 도보/)).toBeNull();
      expect(screen.queryByText("미수집")).toBeNull();
    });

    it("naverSchoolWalkMin 미설정(undefined) → 줄 자체를 숨긴다", () => {
      const apt = makeApt({
        nearbySchools: [{ name: "테스트초등학교", type: "초", distance: 300 }],
      });
      render(<SchoolInfo apt={/** @type {any} */ (apt)} />);
      expect(screen.queryByText(/초등 도보/)).toBeNull();
    });

    it("학교·정류장이 다 없으면 naverSchoolWalkMin 이 있어도 칸 자체가 안 뜬다 (현행 게이트 유지)", () => {
      const apt = makeApt({ ...noBus, naverSchoolWalkMin: 3, nearbySchools: [] });
      const { container } = render(<SchoolInfo apt={/** @type {any} */ (apt)} />);
      expect(container.innerHTML).toBe("");
    });
  });

  // 사장님 추가 결정(세션568-3) — 학교 이름·거리·등급·도보 분·정류장은 좌표로 잰 값이라
  // 좌표 공유 시 이 단지 것이 아니다. 경고문 대신 값 자체를 감추고 사실 한 줄만 남긴다.
  describe("좌표 자리표시 의심 — 이름·거리는 감추고 '위치 확인 중' 한 줄 (세션568-3)", () => {
    it("coordShared=true 면 학교·등급·도보·정류장이 안 보이고 '위치 확인 중' 한 줄만 보인다", () => {
      const apt = makeApt({
        coordShared: true,
        schoolGrade: "A",
        naverSchoolWalkMin: 3,
        busStopNames: "영통역입구,삼성아파트",
        nearbySchools: [
          { name: "영통초등학교", type: "초", distance: 300 },
          { name: "영통중학교", type: "중", distance: 800 },
        ],
      });
      const { container } = render(<SchoolInfo apt={/** @type {any} */ (apt)} />);
      expect(screen.getByText("학군 · 버스")).toBeTruthy(); // 양성 앵커 — 칸이 그려졌다
      expect(container.querySelector('[data-state="coord-unknown"]')?.textContent).toBe("위치 확인 중");
      expect(screen.queryByText("영통초등학교")).toBeNull();
      expect(screen.queryByText("A")).toBeNull();
      expect(screen.queryByText("초등 도보 3분")).toBeNull();
      expect(screen.queryByText(/버스 정류장/)).toBeNull();
      expect(screen.queryByText(/전체.*학교 보기/)).toBeNull();
    });

    it("경고 문구는 없다 — 신뢰도 변명이 아니라 사실 서술", () => {
      const apt = makeApt({
        coordShared: true,
        nearbySchools: [{ name: "영통초등학교", type: "초", distance: 300 }],
      });
      render(<SchoolInfo apt={/** @type {any} */ (apt)} />);
      expect(screen.getByText("위치 확인 중")).toBeTruthy(); // 양성 앵커
      expect(screen.queryByText(/정확하지 않을 수 있습니다/)).toBeNull();
    });

    it("coordShared=false 면 그대로 — 등급·표가 보인다 (양성 앵커)", () => {
      const apt = makeApt({
        coordShared: false,
        schoolGrade: "A",
        nearbySchools: [{ name: "영통초등학교", type: "초", distance: 300 }],
      });
      render(<SchoolInfo apt={/** @type {any} */ (apt)} />);
      expect(screen.getByText("A")).toBeTruthy();
      fireEvent.click(screen.getByText("학교 정보 보기")); // 1곳 — 세션594 문장
      expect(screen.getByText("영통초등학교")).toBeTruthy();
      expect(screen.queryByText("위치 확인 중")).toBeNull();
    });
  });
});
