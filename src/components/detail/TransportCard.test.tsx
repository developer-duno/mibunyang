import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TransportCard } from "./TransportCard";
import { makeApt } from "@/__tests__/factories";
import type { Apt } from "@/types/scoring";

/**
 * TransportCard — 입지 탭 "교통 상세" 전용 카드 (세션508 PR-3b B1).
 *
 * 이 파일이 이어받은 것: `DataSectionBlock.test.jsx` 의 "교통 상세" 값 렌더 검증
 * (역 이름·노선·정류장·null → "—")은 그 필드들이 `LOCATION_SECTIONS` 를 떠나면서
 * DataSectionBlock 이 더는 그리지 않는다 — 여기가 새 자리다.
 */

function apt(over: Record<string, unknown> = {}): Apt {
  return makeApt(over) as unknown as Apt;
}

describe("TransportCard — 기본 접힘 + 존재 게이트", () => {
  it("6필드가 전부 null 이면 아예 렌더하지 않는다", () => {
    const { container } = render(
      <TransportCard
        apt={apt({
          subwayName: null,
          subwayLines: null,
          busRoutes: null,
          busStopNames: null,
          icDist: null,
          ktxDist: null,
        })}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("값이 하나라도 있으면 헤더만 보이고 본문은 접혀 있다", () => {
    render(<TransportCard apt={apt()} />);
    expect(screen.getByText("교통 상세")).toBeInTheDocument();
    expect(screen.queryByText("영통역")).toBeNull();
  });

  it("헤더 클릭 시 펼쳐지고 aria-expanded 가 바뀐다", () => {
    render(<TransportCard apt={apt()} />);
    const toggle = screen.getByRole("button", { expanded: false });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("영통역")).toBeInTheDocument();
  });
});

describe("TransportCard — 펼치면 6필드를 그린다 (fieldMeta fmt 그대로 재사용)", () => {
  it("역 이름·노선·버스 노선수·정류장을 표시한다", () => {
    render(<TransportCard apt={apt()} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("영통역")).toBeInTheDocument();
    expect(screen.getByText("1호선")).toBeInTheDocument();
    expect(screen.getByText("10개")).toBeInTheDocument();
    // busStopNames fmt: 콤마 분리 후 ", " join (DataSectionBlock 시절과 동일 표기)
    expect(screen.getByText("영통역입구, 삼성아파트")).toBeInTheDocument();
  });

  it("6개 필드 줄이 정확히 그려진다 (data-field)", () => {
    const { container } = render(<TransportCard apt={apt()} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(container.querySelectorAll("[data-field]").length).toBe(6);
  });

  it("null 필드는 '—' 로 표시한다", () => {
    render(<TransportCard apt={apt({ subwayName: null, subwayLines: null, busStopNames: null })} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(3);
  });
});

describe("TransportCard — 센티널 문구는 fieldMeta.fmt 그대로 (v1 오류 정정 대상)", () => {
  it("icDist=99 → '반경 밖' (측정은 했고 90km 넘게 멀다는 뜻, '미수집' 아님)", () => {
    render(<TransportCard apt={apt({ icDist: 99 })} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("반경 밖")).toBeInTheDocument();
    expect(screen.queryByText("미수집")).toBeNull();
  });

  it("ktxDist=99 → '반경 밖'", () => {
    render(<TransportCard apt={apt({ ktxDist: 99, icDist: null })} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("반경 밖")).toBeInTheDocument();
  });

  it("icDist=5(반경 안) → 'km' 값 그대로 표시", () => {
    render(<TransportCard apt={apt({ icDist: 5 })} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("5km")).toBeInTheDocument();
  });

  it("icDist=null → '—' (fmt 자체가 null 만 미수집 취급, 99 와 다른 갈래)", () => {
    render(<TransportCard apt={apt({ icDist: null })} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
