// @ts-check
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NaverListingLine } from "./NaverListingLine";
import { makeApt } from "@/__tests__/factories";

/**
 * 네이버 매물 현황 한 줄 (세션589, 사장님 결정 V10).
 *
 * 옛 두 출처 대조표(`SourceComparison`, 세션 507)를 대체한다. 이 파일이 지키는 핵심은
 * **빠진 줄이 되돌아오지 않는 것** — '주변 시세'(면적 무관 중위 두 개)와 '전세가율' 대조 줄, 3열 표.
 */

/** 옛 대조표가 그리던 값이 전부 있는 단지 */
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
      naverFetchedAt: "2026-08-01T03:00:00Z",
      ...over,
    })
  );

describe("NaverListingLine", () => {
  it("매물 수 · 주변 단지 건축연도 · 수집 시점을 한 줄로 적는다", () => {
    render(<NaverListingLine apt={full()} />);
    expect(screen.getByTestId("naver-listing-line").textContent).toBe(
      "네이버 매물 현황 매매 12건 · 전세 5건 · 월세 3건 · 주변 단지 평균 건축연도 2012년 (수집 8/1)"
    );
  });

  // ⚠️ 뮤테이션 대상: 대조 줄(주변 시세·전세가율)을 되살리면 red.
  it("'주변 시세'·'전세가율' 줄과 3열 표는 없다 — 값이 있어도 안 그린다 (V10)", () => {
    const { container } = render(<NaverListingLine apt={full()} />);
    const text = container.textContent ?? "";
    for (const gone of ["주변 시세", "전세가율", "공공데이터", "차이", "같은 값을 두 곳에서", "미수집"]) {
      expect(text, `'${gone}' 가 되살아났다`).not.toContain(gone);
    }
    // 면적 무관 중위값 두 개와 우리측 건축연도·네이버 전세가율·주변 단지 수
    for (const gone of ["5억", "5억 5,000만", "55,000", "50,000", "2010", "68%", "70%", "30개"]) {
      expect(text, `뺀 값 '${gone}' 이 보인다`).not.toContain(gone);
    }
    expect(container.querySelector("table")).toBeNull();
    // ? 도움말도 없다 — 비교가 없으니 풀이할 것도 없다
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("없는 매물 종류는 건너뛴다", () => {
    render(<NaverListingLine apt={full({ naverWolseCount: null })} />);
    const text = screen.getByTestId("naver-listing-line").textContent ?? "";
    expect(text).toContain("매매 12건 · 전세 5건 · 주변 단지");
    expect(text).not.toContain("월세");
  });

  it("0건은 값이다 — 적는다 (null 과 구분)", () => {
    render(<NaverListingLine apt={full({ naverSellCount: 0 })} />);
    expect(screen.getByTestId("naver-listing-line").textContent).toContain("매매 0건");
  });

  it("건축연도가 없으면 매물 수만 적는다", () => {
    render(<NaverListingLine apt={full({ naverBuildYear: null })} />);
    const text = screen.getByTestId("naver-listing-line").textContent ?? "";
    expect(text).toBe("네이버 매물 현황 매매 12건 · 전세 5건 · 월세 3건 (수집 8/1)");
  });

  it("매물 수가 하나도 없고 건축연도만 있으면 건축연도만 적는다", () => {
    render(<NaverListingLine apt={full({ naverSellCount: null, naverJeonseCount: null, naverWolseCount: null })} />);
    expect(screen.getByTestId("naver-listing-line").textContent).toBe(
      "네이버 매물 현황 주변 단지 평균 건축연도 2012년 (수집 8/1)"
    );
  });

  it("수집 시점이 없거나 읽을 수 없으면 괄호째 뺀다", () => {
    const a = render(<NaverListingLine apt={full({ naverFetchedAt: null })} />);
    expect(a.container.textContent).not.toContain("수집");
    a.unmount();
    const b = render(<NaverListingLine apt={full({ naverFetchedAt: "모름" })} />);
    expect(b.container.textContent).not.toContain("수집");
    expect(b.container.textContent).not.toContain("NaN");
  });

  it("적을 사실이 하나도 없으면 상자 자체를 안 그린다 — 수집 시점·옛 대조 값만 있어도", () => {
    const apt = full({
      naverSellCount: null,
      naverJeonseCount: null,
      naverWolseCount: null,
      naverBuildYear: null,
    });
    const { container } = render(<NaverListingLine apt={apt} />);
    expect(container.firstChild).toBeNull();
  });

  it("네이버 값이 전혀 없는 단지(기본 팩토리)도 안 그린다", () => {
    const { container } = render(<NaverListingLine apt={/** @type {any} */ (makeApt())} />);
    expect(container.firstChild).toBeNull();
  });
});
