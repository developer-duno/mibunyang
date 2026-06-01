// @ts-check
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PresaleInfo } from "./PresaleInfo";
import { usePresaleDetail } from "@/hooks/usePresaleDetail";
import { makeApt } from "@/__tests__/factories";

// analytics mock (trackEvent 호출 방지)
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

// usePresaleDetail mock — 기본은 schedule 없음(jsdom fetch 불가 대체). 케이스별로 주입.
vi.mock("@/hooks/usePresaleDetail", () => ({
  usePresaleDetail: vi.fn(() => ({ schedule: null, units: [], loading: false, error: null })),
}));

describe("PresaleInfo", () => {
  // presaleStage·schedule 둘 다 없으면 아무것도 렌더링하지 않음.
  // (mock 기본값 schedule=null → presaleStage null + schedule null이라 일정-only 분기도 null 반환)
  it("presaleStage가 null이고 schedule도 없으면 null을 반환한다", () => {
    const apt = /** @type {any} */ (makeApt({ presaleStage: null }));
    const { container } = render(<PresaleInfo apt={apt} />);
    expect(container.firstChild).toBeNull();
  });

  // 게이트 분리: presaleStage가 null이어도 청약홈 일정(schedule)이 있으면 일정-only 카드 노출.
  // (6/13 cron 적재 ah- 단지 = presaleStage 영구 NULL이라 이 분기로만 일정이 보임)
  it("presaleStage가 null이어도 schedule이 있으면 청약홈 일정 카드를 표시한다", () => {
    vi.mocked(usePresaleDetail).mockReturnValueOnce(
      /** @type {any} */ ({
        schedule: { house_manage_no: "2026000123", recruit_date: "2026-05-19", general_rank1_bgnde: "2026-05-26", winner_announce_date: "2026-06-02", pblanc_url: "https://applyhome.example/x" },
        units: [], loading: false, error: null,
      })
    );
    const apt = /** @type {any} */ (makeApt({ presaleStage: null }));
    render(<PresaleInfo apt={apt} />);
    expect(screen.getByText("청약홈 공식 분양 일정")).toBeTruthy();
    expect(screen.getByText("모집공고")).toBeTruthy();
    expect(screen.getByText("청약홈 공고 보기")).toBeTruthy();
    // 네이버 분양정보 본문은 안 뜸 (presaleStage 없음)
    expect(screen.queryByText("네이버 분양정보")).toBeNull();
  });

  // presaleStage가 있으면 섹션 표시
  it("presaleStage가 있으면 네이버 분양정보를 표시한다", () => {
    const apt = /** @type {any} */ (makeApt({
      presaleStage: "분양중", presaleType: "민간분양",
      presaleMinPrice: 30000, presaleMaxPrice: 50000, presalePp: 2000,
    }));
    render(<PresaleInfo apt={apt} />);
    expect(screen.getByText("네이버 분양정보")).toBeTruthy();
    expect(screen.getByText("분양중")).toBeTruthy();
  });

  // 가격 범위 표시
  it("분양가 범위를 올바르게 표시한다", () => {
    const apt = /** @type {any} */ (makeApt({
      presaleStage: "분양중", presaleMinPrice: 30000, presaleMaxPrice: 50000,
    }));
    render(<PresaleInfo apt={apt} />);
    expect(screen.getByText("분양가 범위")).toBeTruthy();
  });

  // null 안전성: presaleStage만 있고 나머지 전부 null
  it("presaleStage만 있고 나머지 null이어도 크래시 없다", () => {
    const apt = /** @type {any} */ (makeApt({ presaleStage: "분양예정" }));
    expect(() => render(<PresaleInfo apt={apt} />)).not.toThrow();
    expect(screen.getByText("분양예정")).toBeTruthy();
  });

  // 네이버 링크 표시
  it("naverPresaleNo + naverPresaleSeq가 있으면 링크를 표시한다", () => {
    const apt = /** @type {any} */ (makeApt({
      presaleStage: "분양중", naverPresaleNo: "6025041", naverPresaleSeq: "9033181",
    }));
    render(<PresaleInfo apt={apt} />);
    expect(screen.getByText("네이버 분양정보 보기")).toBeTruthy();
  });
});
