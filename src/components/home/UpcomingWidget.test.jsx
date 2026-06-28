// @ts-check
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { UpcomingWidget } from "./UpcomingWidget";

/** @param {number} days */
function isoDaysFromNow(days) {
  const d = new Date(Date.now() + days * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function makeData(overrides = {}) {
  const iso = isoDaysFromNow(2);
  return {
    ok: true,
    stages: {
      plan: [{ id: "u1", name: "홈테스트1차", region: "경기", presaleStage: "분양계획", presaleRecruitDate: iso }],
      apply: [{ id: "u2", name: "홈테스트2차", region: "서울", presaleStage: "청약중", presaleRecruitDate: null }],
      sale: [
        { id: "u3", name: "자유텍스트단지", region: "부산", presaleStage: "분양중", presaleRecruitDate: "2099 미정" },
      ],
    },
    totals: { plan: 1, apply: 1, sale: 1 },
    calendar: { [iso]: [{ id: "u1", event: "apply_start" }] },
    ...overrides,
  };
}

describe("UpcomingWidget", () => {
  it("정상: 이번주 건수 + D-day 임박 단지명 렌더", () => {
    render(<UpcomingWidget data={makeData()} error={false} onRetry={vi.fn()} onExpand={vi.fn()} />);
    expect(screen.getByText(/이번 주 일정 1건/)).toBeInTheDocument();
    expect(screen.getByText("홈테스트1차")).toBeInTheDocument();
  });
  it("recruitDate null·자유텍스트(Invalid Date)는 임박 목록 제외", () => {
    render(<UpcomingWidget data={makeData()} error={false} onRetry={vi.fn()} onExpand={vi.fn()} />);
    expect(screen.queryByText("홈테스트2차")).toBeNull();
    expect(screen.queryByText("자유텍스트단지")).toBeNull();
  });
  it("YYYY-MM(월 단위, 미래)도 임박 목록 포함 — 그 달 1일 해석 (라이브 46행 형식)", () => {
    const data = makeData();
    const future = new Date(Date.now() + 90 * 86400000);
    data.stages.apply = /** @type {any} */ ([
      {
        id: "u4",
        name: "월단위단지",
        region: "대전",
        presaleStage: "청약중",
        presaleRecruitDate: `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, "0")}`,
      },
    ]);
    render(<UpcomingWidget data={data} error={false} onRetry={vi.fn()} onExpand={vi.fn()} />);
    expect(screen.getByText("월단위단지")).toBeInTheDocument();
  });
  it("완전 빈상태(이번주 0 + 임박 0): 단일 '예정된 청약 일정이 없습니다' (0건 줄 겹침 제거)", () => {
    render(
      <UpcomingWidget
        data={makeData({ stages: { plan: [], apply: [], sale: [] }, calendar: {} })}
        error={false}
        onRetry={vi.fn()}
        onExpand={vi.fn()}
      />
    );
    expect(screen.getByText("예정된 청약 일정이 없습니다")).toBeInTheDocument();
    expect(screen.queryByText(/이번 주 일정/)).toBeNull(); // 빈상태에선 "0건" 줄 미노출
  });
  it("이번주 일정은 있으나 임박 청약 없음: '이번 주 일정 N건' + '임박한 청약은 없어요'", () => {
    // calendar 에 이번주 이벤트 1건 두되, stages 의 recruitDate 는 전부 과거/null → imminent 0
    const iso = isoDaysFromNow(1);
    const data = makeData({
      stages: {
        plan: [
          {
            id: "p1",
            name: "과거단지",
            region: "경기",
            presaleStage: "분양계획",
            presaleRecruitDate: isoDaysFromNow(-30),
          },
        ],
        apply: [],
        sale: [],
      },
      calendar: { [iso]: [{ id: "p1", event: "apply_start" }] },
    });
    render(<UpcomingWidget data={data} error={false} onRetry={vi.fn()} onExpand={vi.fn()} />);
    expect(screen.getByText(/이번 주 일정 1건/)).toBeInTheDocument();
    expect(screen.getByText("임박한 청약은 없어요")).toBeInTheDocument();
  });
  it("로딩(data=null, error=false): 스켈레톤 / 실패(error=true): 재시도", () => {
    const { container, unmount } = render(
      <UpcomingWidget data={null} error={false} onRetry={vi.fn()} onExpand={vi.fn()} />
    );
    expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy();
    unmount();
    const onRetry = vi.fn();
    render(<UpcomingWidget data={null} error={true} onRetry={onRetry} onExpand={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "재시도" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
  it("행 클릭 = onExpand (상세 직진입 금지 — 홈 상세 게이트 정책)", () => {
    const onExpand = vi.fn();
    render(<UpcomingWidget data={makeData()} error={false} onRetry={vi.fn()} onExpand={onExpand} />);
    fireEvent.click(screen.getByText("홈테스트1차"));
    expect(onExpand).toHaveBeenCalled();
  });
});
