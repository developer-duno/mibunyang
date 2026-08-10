// @ts-check
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SourceComparison, diffText } from "./SourceComparison";
import { makeApt } from "@/__tests__/factories";

/**
 * 두 출처 대조표 (세션 507 PR-2).
 *
 * 이 파일이 지키는 핵심은 **폴백 처리**다 — 우리 값이 없어 네이버 값을 빌려 쓴 줄에서
 * 같은 숫자를 두 열에 그리면 "차이 0% = 믿을 만"이라는 거짓 상호검증이 된다.
 */

/** 3행이 모두 성립하는 단지 (세션508 PR-3b B3 — "평균 거래 층수" 행은 층별가 계단
 *  카드로 옮겨서 4행 → 3행) */
const full = (over = {}) =>
  /** @type {any} */ (
    makeApt({
      nearbyMedian: 50000,
      naverNearbyMedian: 55000,
      jeonseRate: 70,
      naverJeonseRate: 68,
      nearbyBuildYear: 2010,
      naverBuildYear: 2012,
      naverSellCount: 12,
      naverJeonseCount: 5,
      naverWolseCount: 3,
      naverNearbyCount: 30,
      naverFetchedAt: "2026-08-01T00:00:00Z",
      ...over,
    })
  );

describe("SourceComparison", () => {
  it("세 항목을 공공데이터·네이버·차이 세 열로 나란히 그린다", () => {
    render(<SourceComparison apt={full()} />);
    expect(screen.getByText("같은 값을 두 곳에서 재봤어요")).toBeTruthy();
    for (const label of ["주변 시세", "전세가율", "주변 건축연도"]) {
      expect(screen.getByText(label), `${label} 행이 없다`).toBeTruthy();
    }
    // "평균 거래 층수"는 층별가 계단 카드로 옮겼다 — 이 표에는 더는 없다 (세션508 PR-3b B3)
    expect(screen.queryByText("평균 거래 층수")).toBeNull();
    expect(screen.getByText("공공데이터")).toBeTruthy();
    expect(screen.getByText("네이버")).toBeTruthy();
    expect(screen.getByText("차이")).toBeTruthy();
  });

  it("차이를 항목별 단위(%·%p·년)로 적는다", () => {
    render(<SourceComparison apt={full()} />);
    expect(screen.getByText("+10%")).toBeTruthy(); // 50000 → 55000
    expect(screen.getByText("-2%p")).toBeTruthy(); // 70 → 68
    expect(screen.getByText("+2년")).toBeTruthy(); // 2010 → 2012
  });

  // ── 이 PR 의 정직성 핵심 ──
  it("폴백 플래그가 켜진 줄은 우리 열을 '미수집'으로, 차이는 '—'로 그린다", () => {
    // `sanitizeTransaction` 이 우리 값 자리에 네이버 값을 그대로 넣은 상태를 재현.
    // 플래그를 안 보면 55,000 이 두 열에 앉아 "차이 0%"라는 거짓 안심을 준다.
    const apt = full({ nearbyMedian: 55000, _fallbackNearbyMedian: true });
    render(<SourceComparison apt={apt} />);
    const row = /** @type {HTMLElement} */ (screen.getByText("주변 시세").closest("tr"));
    expect(row.textContent).toContain("미수집");
    expect(row.textContent).toContain("—");
    expect(row.textContent, "폴백인데 차이 0% 를 그렸다 — 거짓 상호검증").not.toContain("0%");
  });

  it("전세가율 폴백(상수 40)도 같은 규칙으로 '미수집' 처리한다", () => {
    // 전세가율만 폴백 방향이 다르다 — 네이버가 아니라 상수 40 으로 채워진다.
    const apt = full({ jeonseRate: 40, _fallbackJeonseRate: true });
    render(<SourceComparison apt={apt} />);
    const row = /** @type {HTMLElement} */ (screen.getByText("전세가율").closest("tr"));
    expect(row.textContent).toContain("미수집");
    expect(row.textContent, "근거 없는 상수 40 을 우리 값으로 그렸다").not.toContain("40%");
  });

  it("한쪽만 없으면 행은 남기고 그 칸만 '미수집' (차이는 '—')", () => {
    const apt = full({ naverJeonseRate: null });
    render(<SourceComparison apt={apt} />);
    const row = /** @type {HTMLElement} */ (screen.getByText("전세가율").closest("tr"));
    expect(row.textContent).toContain("70%"); // 우리 값은 그대로 보여준다
    expect(row.textContent).toContain("미수집");
  });

  it("양쪽 다 없는 행은 숨긴다", () => {
    const apt = full({ nearbyBuildYear: null, naverBuildYear: null });
    render(<SourceComparison apt={apt} />);
    expect(screen.queryByText("주변 건축연도")).toBeNull();
    expect(screen.getByText("주변 시세"), "다른 행까지 사라졌다").toBeTruthy();
  });

  it("매물 수 칩과 각주(주변 단지 수·수집 시점)를 그린다", () => {
    const { container } = render(<SourceComparison apt={full()} />);
    expect(screen.getByText("매매 12건")).toBeTruthy();
    expect(screen.getByText("전세 5건")).toBeTruthy();
    expect(screen.getByText("월세 3건")).toBeTruthy();
    expect(container.textContent).toContain("주변 30개 단지 기준");
    expect(container.textContent).toContain("두 출처가 가까우면");
  });

  it("null 인 칩·각주 조각은 통째로 생략한다", () => {
    const { container } = render(<SourceComparison apt={full({ naverWolseCount: null, naverNearbyCount: null })} />);
    expect(screen.queryByText(/^월세/)).toBeNull();
    expect(container.textContent).not.toContain("단지 기준");
    expect(screen.getByText("매매 12건"), "남은 칩까지 사라졌다").toBeTruthy();
  });

  it("네이버 값이 하나도 없으면 컴포넌트 자체를 안 그린다", () => {
    const apt = /** @type {any} */ (
      makeApt({
        naverNearbyMedian: null,
        naverJeonseRate: null,
        naverBuildYear: null,
        naverAvgFloor: null,
        naverSellCount: null,
        naverJeonseCount: null,
        naverWolseCount: null,
        naverNearbyCount: null,
        naverFetchedAt: null,
      })
    );
    const { container } = render(<SourceComparison apt={apt} />);
    expect(container.firstChild).toBeNull();
  });

  it("헤더에 ? 도움말이 있고, 두 출처를 왜 대는지 설명한다", () => {
    render(<SourceComparison apt={full()} />);
    expect(screen.getByLabelText("두 출처 대조 풀이 보기")).toBeTruthy();
  });
});

describe("diffText — 차이 계산", () => {
  it("비율은 우리 값을 분모로 삼는다", () => {
    expect(diffText(100, 110, "percent")).toBe("+10%");
    expect(diffText(100, 90, "percent")).toBe("-10%");
  });

  it("퍼센트 지표는 %p, 연·층은 그대로 뺀다", () => {
    expect(diffText(70, 68, "percentPoint")).toBe("-2%p");
    expect(diffText(2010, 2012, "year")).toBe("+2년");
    expect(diffText(10, 11.5, "floor")).toBe("+1.5층");
  });

  it("분모가 0 이거나 숫자가 아니면 못 잰다(null)", () => {
    // Infinity 를 "+Infinity%" 로 그리면 그 자체가 거짓 표시다
    expect(diffText(0, 5, "percent")).toBeNull();
    expect(diffText(Number.NaN, 5, "percent")).toBeNull();
    expect(diffText(5, Number.NaN, "floor")).toBeNull();
  });
});
