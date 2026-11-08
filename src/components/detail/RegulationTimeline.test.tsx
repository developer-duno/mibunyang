import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { RegulationTimeline, _resetRegulationTimelineTracking } from "./RegulationTimeline";
import { trackEvent } from "@/lib/analytics";
import { makeApt } from "@/__tests__/factories";
import type { UnitChoice } from "@/hooks/useUnitChoice";
import type { Apt } from "@/types/scoring";

vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

// 시각은 밖에서 고정 — KST 2026-11-08 정오
const NOW = new Date("2026-11-08T03:00:00Z");

/** 평형표 결과 — 이 부품은 공고일·일정만 읽는다 */
const unitOf = (over: Partial<UnitChoice> = {}): UnitChoice =>
  ({
    hasPrice: true,
    aptPrice: 100000,
    chips: [],
    chipIdx: -1,
    select: () => {},
    price: 100000,
    unitLabel: null,
    schedule: null,
    firstRecruitDate: null,
    pending: false,
    ...over,
  }) as UnitChoice;

const seoulApt = (over: Record<string, unknown> = {}) =>
  makeApt({
    id: "ah-77",
    price: 100000,
    region: "서울",
    gu: "중구",
    isRegulated: true,
    presaleRecruitDate: "2024-05-10",
    presaleMoveIn: "2027-03",
    ...over,
  } as never) as unknown as Apt;

const views = () => vi.mocked(trackEvent).mock.calls.filter((c) => c[0] === "regulation_timeline_view");

describe("RegulationTimeline", () => {
  beforeEach(() => {
    vi.mocked(trackEvent).mockClear();
    _resetRegulationTimelineTracking();
  });

  it("결론 칩·시간표·바닥줄 testid 3개와 항목 속성(data-kind·data-mine·data-future)", () => {
    const { getByTestId } = render(<RegulationTimeline apt={seoulApt()} unit={unitOf()} now={NOW} />);
    const verdict = getByTestId("reg-verdict");
    expect(verdict.getAttribute("data-kind")).toBe("grandfather-may");
    expect(verdict.textContent).toBe("첫 공고가 지정보다 앞서요 → 집단대출은 종전 70% 가 될 수 있어요(금융사 심사)");
    const items = Array.from(getByTestId("reg-timeline").querySelectorAll("li"));
    expect(items.map((li) => li.getAttribute("data-kind"))).toEqual([
      "notice",
      "metro-cap",
      "designation",
      "today",
      "move-in",
    ]);
    expect(items.map((li) => li.getAttribute("data-mine"))).toEqual(["true", "false", "false", "false", "true"]);
    expect(items.map((li) => li.getAttribute("data-future"))).toEqual(["false", "false", "false", "false", "true"]);
    // 지정 전 공고(grandfather-may)일 때만 전매 꼬리
    expect(getByTestId("reg-basis").textContent).toBe(
      "2026년 10월 기준 · 금융위 10·15 대책 FAQ · 지정일 뒤 전매로 산 분양권은 종전 규정 제외"
    );
  });

  it("평형표의 첫 공고일(unit.firstRecruitDate)이 더 이르면 그 날짜를 첫 공고로 쓴다", () => {
    const { getByTestId } = render(
      <RegulationTimeline
        apt={seoulApt({ presaleRecruitDate: "2026-02-14" })}
        unit={unitOf({ firstRecruitDate: "2024-05-10" })}
        now={NOW}
      />
    );
    expect(getByTestId("reg-verdict").getAttribute("data-kind")).toBe("grandfather-may");
    expect(getByTestId("reg-timeline").textContent).toContain("(최근 공고 2026-02-14)");
  });

  it("바닥줄 — 지방은 금융위원회공고 · 수도권 비규제는 가계부채 관리 강화 방안(시행일 상수)", () => {
    const local = render(
      <RegulationTimeline
        apt={seoulApt({ region: "부산", gu: "해운대구", isRegulated: false })}
        unit={unitOf()}
        now={NOW}
      />
    );
    expect(local.getByTestId("reg-basis").textContent).toBe(
      "2026년 10월 기준 · 금융위원회공고 제2026-362호(3단계 스트레스 DSR)"
    );
    local.unmount();
    const metro = render(
      <RegulationTimeline
        apt={seoulApt({ region: "경기", gu: "평택시", isRegulated: false })}
        unit={unitOf()}
        now={NOW}
      />
    );
    expect(metro.getByTestId("reg-verdict").getAttribute("data-kind")).toBe("metro-free");
    expect(metro.getByTestId("reg-basis").textContent).toBe(
      "2026년 10월 기준 · 금융위 가계부채 관리 강화 방안(2025-06-28 시행)"
    );
  });

  it("규제인데 지정 뒤 공고면 바닥줄에 전매 꼬리가 없다", () => {
    const { getByTestId } = render(
      <RegulationTimeline apt={seoulApt({ presaleRecruitDate: "2026-02-14" })} unit={unitOf()} now={NOW} />
    );
    expect(getByTestId("reg-verdict").getAttribute("data-kind")).toBe("current-only");
    expect(getByTestId("reg-basis").textContent).toBe("2026년 10월 기준 · 금융위 10·15 대책 FAQ");
  });

  it("계측 — 같은 단지는 두 번 그려도 1회, _reset 뒤 다시 1회", () => {
    const apt = seoulApt();
    const a = render(<RegulationTimeline apt={apt} unit={unitOf()} now={NOW} />);
    a.unmount();
    const b = render(<RegulationTimeline apt={apt} unit={unitOf()} now={NOW} />);
    b.unmount();
    expect(views()).toEqual([
      ["regulation_timeline_view", { aptId: "ah-77", zone: "overheated", verdict: "grandfather-may" }],
    ]);
    _resetRegulationTimelineTracking();
    render(<RegulationTimeline apt={apt} unit={unitOf()} now={NOW} />);
    expect(views()).toHaveLength(2);
  });

  // 보완 7-2 — 평형표를 불러오는 동안(첫 공고일이 비어 결론이 쏠림)은 보내지 않고, 끝난 뒤 1회
  // ⚠️ 변이 대상: pending 가드를 지우면 첫 render 에서 notice-missing 으로 1회 나가 빨강.
  it("계측 — unit.pending 참이면 0회, 거짓으로 바뀐 뒤 1회(그때의 결론)", () => {
    const apt = seoulApt({ presaleRecruitDate: null });
    const r = render(<RegulationTimeline apt={apt} unit={unitOf({ pending: true })} now={NOW} />);
    expect(views()).toHaveLength(0);
    r.rerender(
      <RegulationTimeline apt={apt} unit={unitOf({ pending: false, firstRecruitDate: "2024-05-10" })} now={NOW} />
    );
    expect(views()).toEqual([
      ["regulation_timeline_view", { aptId: "ah-77", zone: "overheated", verdict: "grandfather-may" }],
    ]);
  });

  // 보완 7-3 — 바닥줄 출처는 그 단지의 경과규정 규칙별로(날짜는 rule.cutoff 에서)
  it("바닥줄 출처 — 송파(9·7) · 구리(2026-06-30 추가 지정) · 은평(10·15)", () => {
    const cases: Array<[string, string, string]> = [
      ["서울", "송파구", "2026년 10월 기준 · 금융위 9·7 대책 FAQ"],
      ["경기", "구리시", "2026년 10월 기준 · 금융위 2026-06-30 추가 지정 FAQ"],
      ["서울", "은평구", "2026년 10월 기준 · 금융위 10·15 대책 FAQ"],
    ];
    for (const [region, gu, text] of cases) {
      // 지정 뒤 공고(2026-08-01 · 세 규칙 모두 cutoff 뒤)라 전매 꼬리가 없다
      const r = render(
        <RegulationTimeline
          apt={seoulApt({ region, gu, presaleRecruitDate: "2026-08-01" })}
          unit={unitOf()}
          now={NOW}
        />
      );
      expect(r.getByTestId("reg-basis").textContent).toBe(text);
      r.unmount();
    }
  });

  // 보완 7-7 — 날짜 없는 줄(공고일 못 모음)은 「—」
  // ⚠️ 변이 대상: `—` 를 빈 글자로 바꾸면 빨강.
  it("공고일 없음 줄의 날짜 칸은 「—」", () => {
    const { getByTestId } = render(
      <RegulationTimeline apt={seoulApt({ presaleRecruitDate: null })} unit={unitOf()} now={NOW} />
    );
    expect(getByTestId("reg-verdict").getAttribute("data-kind")).toBe("notice-missing");
    const li = getByTestId("reg-timeline").querySelector('li[data-kind="notice-missing"]')!;
    expect(li.textContent?.startsWith("—이 단지 첫 입주자모집공고 · 아직 못 모았어요")).toBe(true);
  });
});
