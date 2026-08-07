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
        schedule: {
          house_manage_no: "2026000123",
          recruit_date: "2026-05-19",
          general_rank1_bgnde: "2026-05-26",
          winner_announce_date: "2026-06-02",
          pblanc_url: "https://applyhome.example/x",
        },
        units: [],
        loading: false,
        error: null,
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
    const apt = /** @type {any} */ (
      makeApt({
        presaleStage: "분양중",
        presaleType: "민간분양",
        presaleMinPrice: 30000,
        presaleMaxPrice: 50000,
        presalePp: 2000,
      })
    );
    render(<PresaleInfo apt={apt} />);
    expect(screen.getByText("네이버 분양정보")).toBeTruthy();
    expect(screen.getByText("분양중")).toBeTruthy();
  });

  // 가격 범위 표시
  it("분양가 범위를 올바르게 표시한다", () => {
    const apt = /** @type {any} */ (
      makeApt({
        presaleStage: "분양중",
        presaleMinPrice: 30000,
        presaleMaxPrice: 50000,
      })
    );
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
    const apt = /** @type {any} */ (
      makeApt({
        presaleStage: "분양중",
        naverPresaleNo: "6025041",
        naverPresaleSeq: "9033181",
      })
    );
    render(<PresaleInfo apt={apt} />);
    expect(screen.getByText("네이버 분양정보 보기")).toBeTruthy();
  });
});

// 규제 7종 "공고 당시 규제" 행 (세션 496)
// 설계: docs/superpowers/specs/2026-08-07-regulation-flags-ui-design.md
describe("PresaleInfo — 공고 당시 규제", () => {
  /** @param {Record<string, any>} extra */
  const withSchedule = (extra) =>
    vi.mocked(usePresaleDetail).mockReturnValueOnce(
      /** @type {any} */ ({
        schedule: { house_manage_no: "2026000123", recruit_date: "2026-03-30", ...extra },
        units: [],
        loading: false,
        error: null,
      })
    );

  it("해당 규제를 REGULATION_FLAGS 차례로 · 구분해 보여준다", () => {
    withSchedule({
      price_cap_applied: true,
      adjustment_target_area: true,
      speculation_overheated: true,
    });
    render(<PresaleInfo apt={/** @type {any} */ (makeApt({ presaleStage: null }))} />);
    expect(screen.getByText("조정대상지역 · 투기과열지구 · 분양가상한제")).toBeTruthy();
  });

  // ★ 이 설계의 핵심 — 시점 문구가 빠지면 옛 공고 단지에서 거짓이 된다.
  //   2021 공고에 조정대상지역 Y 인 단지가 화면 모수에 실제로 있다(라이브 실측 79건).
  it("옛 공고여도 '2021.05 공고 기준'이 반드시 함께 뜬다", () => {
    withSchedule({ recruit_date: "2021-05-14", adjustment_target_area: true });
    render(<PresaleInfo apt={/** @type {any} */ (makeApt({ presaleStage: null }))} />);
    expect(screen.getByText("조정대상지역")).toBeTruthy();
    expect(screen.getByText("2021.05 공고 기준")).toBeTruthy();
  });

  it("규제가 전부 false 면 행 자체가 없다", () => {
    withSchedule({ adjustment_target_area: false, price_cap_applied: false });
    render(<PresaleInfo apt={/** @type {any} */ (makeApt({ presaleStage: null }))} />);
    expect(screen.queryByText("공고 당시 규제")).toBeNull();
  });

  it("규제가 전부 null(미수집)이어도 행 자체가 없다", () => {
    withSchedule({ adjustment_target_area: null, price_cap_applied: null });
    render(<PresaleInfo apt={/** @type {any} */ (makeApt({ presaleStage: null }))} />);
    expect(screen.queryByText("공고 당시 규제")).toBeNull();
  });

  it("recruit_date 가 없으면 규제명은 내되 기준 문구만 생략한다", () => {
    withSchedule({ recruit_date: null, general_rank1_bgnde: "2026-04-08", redevelopment_biz: true });
    render(<PresaleInfo apt={/** @type {any} */ (makeApt({ presaleStage: null }))} />);
    expect(screen.getByText("정비사업")).toBeTruthy();
    expect(screen.queryByText(/공고 기준$/)).toBeNull();
  });

  it("네이버 분양정보(presaleStage 있음) 경로에서도 규제 행이 뜬다", () => {
    withSchedule({ large_scale_district: true });
    render(<PresaleInfo apt={/** @type {any} */ (makeApt({ presaleStage: "분양중" }))} />);
    expect(screen.getByText("대규모 택지개발지구")).toBeTruthy();
    expect(screen.getByText("2026.03 공고 기준")).toBeTruthy();
  });
});
