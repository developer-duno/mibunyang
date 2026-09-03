import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DeviationStrip, stripHeight } from "./DeviationStrip";
import { CARD_DEVIATION_FIELDS, OVERVIEW_DEVIATION_FIELDS } from "@/constants/deviationFields";
import { computeRegionalStats } from "@/scoring/regionalStats";
import type { Apt } from "@/types/scoring";

/** 경기 21단지 — G1 지역 기준(n≥20)을 넘긴다 */
function gyeonggiStats() {
  const rows = Array.from(
    { length: 21 },
    (_, i) =>
      ({
        region: "경기",
        price: 30000 + i * 1000,
        unsoldRate: i,
        subwayDist: 200 + i * 50,
      }) as unknown as Apt
  );
  return computeRegionalStats(rows);
}

/** 제주 10단지 — 시도 임계 미달이라 전국으로 폴백된다 */
function jejuFallbackStats() {
  const jeju = Array.from(
    { length: 10 },
    (_, i) => ({ region: "제주", price: 20000 + i * 500, unsoldRate: i, subwayDist: 300 }) as unknown as Apt
  );
  const gyeonggi = Array.from(
    { length: 15 },
    (_, i) =>
      ({ region: "경기", price: 40000 + i * 900, unsoldRate: i + 3, subwayDist: 500 + i * 30 }) as unknown as Apt
  );
  return computeRegionalStats([...jeju, ...gyeonggi]);
}

function apt(over: Record<string, unknown> = {}): Apt {
  return { region: "경기", price: 33000, unsoldRate: 4, subwayDist: 300, ...over } as unknown as Apt;
}

describe("DeviationStrip — 블록 골격", () => {
  it("필드 수만큼 줄을 그린다", () => {
    render(<DeviationStrip apt={apt()} fields={CARD_DEVIATION_FIELDS} regionStats={gyeonggiStats()} />);
    expect(screen.getAllByRole("img")).toHaveLength(3);
  });

  it("팝업용 8줄도 같은 컴포넌트로 그린다 (카드에서 배운 읽는 법이 그대로 통해야 한다)", () => {
    render(<DeviationStrip apt={apt()} fields={OVERVIEW_DEVIATION_FIELDS} regionStats={gyeonggiStats()} />);
    expect(screen.getAllByRole("img")).toHaveLength(8);
  });

  it("헤더에 지역 이름을 쓰고 '중위값' 같은 전문어는 쓰지 않는다", () => {
    const { container } = render(
      <DeviationStrip apt={apt()} fields={CARD_DEVIATION_FIELDS} regionStats={gyeonggiStats()} />
    );
    expect(screen.getByText(/경기 분양 단지 한가운데 값과 비교/)).toBeInTheDocument();
    expect(container.textContent).not.toContain("중위값");
    expect(container.textContent).not.toContain("백분위");
  });

  it("region 이 비면 '전국'으로 부른다", () => {
    render(<DeviationStrip apt={apt({ region: "" })} fields={CARD_DEVIATION_FIELDS} regionStats={gyeonggiStats()} />);
    expect(screen.getByText(/전국 분양 단지 한가운데 값과 비교/)).toBeInTheDocument();
  });

  // 세션539 A-6 — 대조군(regionalStats.ts:90)이 `region` 하나로만 묶여 오피스텔·재건축이
  // 섞여 있는데 헤더가 "아파트"라고 단정했다. 모집단을 단정하지 않는 중립어(분양 단지)로
  // 고정한다 — "아파트"로 되돌리면 이 단언이 깨진다.
  it('헤더가 "아파트"라고 모집단을 단정하지 않는다 (세션539 A-6)', () => {
    render(<DeviationStrip apt={apt()} fields={CARD_DEVIATION_FIELDS} regionStats={gyeonggiStats()} />);
    expect(screen.queryByText(/아파트 한가운데 값과 비교/)).not.toBeInTheDocument();
  });

  // 세션539 A-6 후속 — 헤더와 `lib/deviation.ts` 만 고쳤을 때 **같은 위젯의 도움말('?')이
  // 여전히 "아파트들의 한가운데 값"이라 말하고 있었다**. 한 위젯이 두 말을 하는 자리라
  // 헤더 가드만으로는 못 잡는다(도움말은 클릭 전엔 DOM 에 없다) — 실제로 열어서 읽는다.
  // ⚠️ 나중에 대조군을 유형별로 가르기로 하면 헤더·도움말·스크린리더 **셋을 함께** 고쳐야 한다.
  it('도움말도 "아파트"라고 모집단을 단정하지 않는다 (세션539 A-6 후속)', () => {
    render(<DeviationStrip apt={apt()} fields={CARD_DEVIATION_FIELDS} regionStats={gyeonggiStats()} />);
    fireEvent.click(screen.getByRole("button", { name: /지역 비교 풀이 보기/ }));
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toContain("분양 단지");
    expect(tip.textContent).not.toContain("아파트");
  });
});

describe("DeviationStrip — 높이 고정 (무한스크롤에서 스크롤이 안 튀게)", () => {
  it("값이 다 있든 다 없든 줄 수가 같다", () => {
    const full = render(<DeviationStrip apt={apt()} fields={CARD_DEVIATION_FIELDS} regionStats={gyeonggiStats()} />);
    const fullRows = full.container.querySelectorAll('[role="img"]').length;
    full.unmount();

    const empty = render(
      <DeviationStrip
        apt={apt({ price: null, unsoldRate: null, subwayDist: 9999 })}
        fields={CARD_DEVIATION_FIELDS}
        regionStats={gyeonggiStats()}
      />
    );
    expect(empty.container.querySelectorAll('[role="img"]')).toHaveLength(fullRows);
  });

  it("결측이어도 '미수집'으로 자리를 지킨다 (행을 지우지 않는다)", () => {
    render(
      <DeviationStrip
        apt={apt({ price: null, unsoldRate: null, subwayDist: 9999 })}
        fields={CARD_DEVIATION_FIELDS}
        regionStats={gyeonggiStats()}
      />
    );
    expect(screen.getAllByText("미수집")).toHaveLength(3);
  });

  it("stripHeight 는 줄 수만으로 결정된다", () => {
    expect(stripHeight(3)).toBe(96); // 실측값과 일치 (헤더16+여백4+행22×3+간격5×2)
    expect(stripHeight(8)).toBe(231);
    expect(stripHeight(3)).toBe(stripHeight(3)); // 상태와 무관
  });
});

describe("DeviationStrip — 전국 폴백 배지", () => {
  it("지역 표본이 모자라 전국 기준을 썼으면 한 번만 알린다", () => {
    render(
      <DeviationStrip
        apt={apt({ region: "제주", price: 21000, unsoldRate: 2, subwayDist: 300 })}
        fields={CARD_DEVIATION_FIELDS}
        regionStats={jejuFallbackStats()}
      />
    );
    expect(screen.getAllByText("일부 전국 기준")).toHaveLength(1);
  });

  it("지역 기준으로 그렸으면 배지가 없다", () => {
    render(<DeviationStrip apt={apt()} fields={CARD_DEVIATION_FIELDS} regionStats={gyeonggiStats()} />);
    expect(screen.queryByText("일부 전국 기준")).toBeNull();
  });
});

describe("DeviationStrip — 통계가 없을 때", () => {
  it("regionStats 가 null 이면 전부 미수집으로 그린다 (크래시 0)", () => {
    render(<DeviationStrip apt={apt()} fields={CARD_DEVIATION_FIELDS} regionStats={null} />);
    expect(screen.getAllByText("미수집")).toHaveLength(3);
  });
});
