import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DeviationStrip, stripHeight, deviationLegendText } from "./DeviationStrip";
import { LABEL_W_COMPACT, LABEL_W_WIDE } from "./DeviationRow";
import { CARD_DEVIATION_FIELDS, OVERVIEW_DEVIATION_FIELDS } from "@/constants/deviationFields";
import { computeRegionalStats } from "@/scoring/regionalStats";
import { computeDeviation } from "@/lib/deviation";
import { deviationSpec } from "@/constants/deviationFields";
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
    // 세션651: 전세가율 줄은 값이 없으면 안 그린다(hideWhenMissing) — 8줄을 보려면 값을 준다
    render(
      <DeviationStrip
        apt={apt({ complexJeonseRate: 72 })}
        fields={OVERVIEW_DEVIATION_FIELDS}
        regionStats={gyeonggiStats()}
      />
    );
    expect(screen.getAllByRole("img")).toHaveLength(8);
  });

  // 세션651(사장님 결정): 같은 단지 전세가율은 값이 없는 이유가 미수집이 아니라 "같은 평수 전세·매매 각 3건 미만"
  //   — "미수집" 대신 줄을 안 그린다(카드 칩 W2 와 같은 규칙). 옛 동작(미수집 줄)으로 되돌리면 red.
  it("팝업: 전세가율 값이 없으면 그 줄을 안 그린다 — '미수집'이라 하지 않는다 (세션651)", () => {
    const { container } = render(
      <DeviationStrip
        apt={apt({ complexJeonseRate: null })}
        fields={OVERVIEW_DEVIATION_FIELDS}
        regionStats={gyeonggiStats()}
      />
    );
    expect(screen.getAllByRole("img")).toHaveLength(7);
    expect(screen.queryByRole("img", { name: /^전세가율/ })).toBeNull();
    expect(container.textContent).not.toContain("전세가율");
  });

  it("카드 필드에는 줄을 숨기는 필드가 없다 — 카드마다 줄 수가 달라지면 무한스크롤이 튄다", () => {
    expect(CARD_DEVIATION_FIELDS.filter((f) => f.hideWhenMissing)).toEqual([]);
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

// 세션576 D5-b — 점수 탭은 `추정 1.13대/세대` 로 채점하는데 종합 탭 편차 막대만 `미수집` 이던 결함.
describe("DeviationStrip — 주차 추정 폴백 (세션576 D5-b)", () => {
  /** 경기 21단지, 주차 비율 0.625~1.625(가운데 1.125) — 추정치 1.125 가 정확히 가운데에 온다 */
  function parkingStats() {
    return computeRegionalStats(
      Array.from({ length: 21 }, (_, i) => ({ region: "경기", parkingRatio: 0.625 + i * 0.05 }) as unknown as Apt)
    );
  }
  /** 용문역 리체스트(ah-2023910096) 모양 — 실측 비율 없음 · 주차 99 · 총세대 59 · 일반분양 88 */
  const yongmun = { parkingRatio: null, presaleParking: 99, units: 59, presaleGeneralSupply: 88 };

  it("팝업: 실측 비율이 없으면 추정치 값만 보인다 — 막대 위치·비교 문구 없음", () => {
    render(
      <DeviationStrip
        apt={apt(yongmun)}
        fields={OVERVIEW_DEVIATION_FIELDS}
        regionStats={parkingStats()}
        compact={false}
      />
    );
    const row = screen.getByRole("img", { name: "주차 추정 1.13대/세대. 추정치라 지역 단지들과 견주지 않았습니다." });
    expect(row.textContent).toBe("주차추정 1.13대/세대");
    expect(row.querySelector('[style*="border-radius: 99px"][style*="width"]')).toBeNull();
  });

  it("카드(compact)도 같은 값 문구 하나 — `추정 1.13대/세대`", () => {
    render(<DeviationStrip apt={apt(yongmun)} fields={OVERVIEW_DEVIATION_FIELDS} regionStats={parkingStats()} />);
    expect(
      screen.getByRole("img", { name: "주차 추정 1.13대/세대. 추정치라 지역 단지들과 견주지 않았습니다." }).textContent
    ).toBe("주차추정 1.13대/세대");
  });

  it("추정할 수 없으면 지금처럼 `미수집` — 주차 0 / 3 초과(총세대 오염)", () => {
    for (const over of [
      { parkingRatio: null, presaleParking: 0, units: 500, presaleGeneralSupply: null },
      { parkingRatio: null, presaleParking: 1468, units: 5, presaleGeneralSupply: 102 },
    ]) {
      const { unmount, container } = render(
        <DeviationStrip
          apt={apt(over)}
          fields={OVERVIEW_DEVIATION_FIELDS}
          regionStats={parkingStats()}
          compact={false}
        />
      );
      expect(screen.getByRole("img", { name: "주차 자료가 아직 없습니다." })).toBeInTheDocument();
      expect(container.textContent).not.toContain("추정");
      unmount();
    }
  });

  it("실측 비율이 있으면 지금과 글자 하나 안 다르다 (`추정` 없음)", () => {
    const stats = parkingStats();
    const d = computeDeviation(deviationSpec("parkingRatio")!, 1.49, "경기", stats);
    const { container } = render(
      <DeviationStrip
        apt={apt({ ...yongmun, parkingRatio: 1.49 })}
        fields={OVERVIEW_DEVIATION_FIELDS}
        regionStats={stats}
        compact={false}
      />
    );
    expect(screen.getByText(`1.49대/세대 · ${d.text}`)).toBeInTheDocument();
    expect(container.textContent).not.toContain("추정");
  });
});

// 세션651(사장님 결정 — 공공기관 준거): 평당가·전세가율 줄은 좋고 나쁨을 말하지 않는다 — 색 중립 하나,
//   "싸요/비싸요"·"높아요/낮아요" 대신 한가운데 값과의 산술 차이. 도움말도 "오른쪽 = 유리"가 이 줄엔 아니라고 밝힌다.
describe("DeviationStrip — 평당가·전세가율 줄은 판정 없이 (세션651)", () => {
  /** 경기 21단지 — 평당가 1000~3000, 같은 단지 전세가율 50~90 */
  function ppJeonseStats() {
    return computeRegionalStats(
      Array.from(
        { length: 21 },
        (_, i) => ({ region: "경기", pp: 1000 + i * 100, complexJeonseRate: 50 + i * 2 }) as unknown as Apt
      )
    );
  }

  it.each([[{ pp: 1200, complexJeonseRate: 88 }], [{ pp: 2900, complexJeonseRate: 52 }]])(
    "값 글자는 판정어 없이, 색은 중립 회색 %o",
    (over) => {
      render(
        <DeviationStrip
          apt={apt(over)}
          fields={OVERVIEW_DEVIATION_FIELDS}
          regionStats={ppJeonseStats()}
          compact={false}
        />
      );
      for (const name of [/^평당가/, /^전세가율/]) {
        const row = screen.getByRole("img", { name });
        expect(row.textContent).toMatch(/%p? (높음|낮음)|같음/);
        expect(row.textContent).not.toMatch(/싸|비싸|높아요|낮아요|유리/);
        const value = row.lastElementChild as HTMLElement;
        expect(value.style.color).toBe("rgb(107, 114, 128)"); // C.muted — 옛 파랑/주황이면 red
      }
    }
  );

  // 세션652(사장님 결정 ② 값 그대로): 카드 3줄은 모두 neutral — 도움말은 "오른쪽 = 값이 큼" 한 규칙, "유리" 없음.
  it("카드 도움말: '오른쪽으로 길수록 값이 크다' 한 규칙 — '유리'·판정 줄 안내 없음", () => {
    render(<DeviationStrip apt={apt()} fields={CARD_DEVIATION_FIELDS} regionStats={gyeonggiStats()} />);
    fireEvent.click(screen.getByRole("button", { name: /지역 비교 풀이 보기/ }));
    const tip = screen.getByRole("tooltip").textContent ?? "";
    expect(tip).toContain("오른쪽으로 길수록 이 단지 값이 크고");
    expect(tip).toContain("역세권은 역까지 거리가 먼지·가까운지");
    expect(tip).not.toContain("유리");
  });

  it("팝업 도움말: 판정이 남은 줄(주차·전용률)만 이름을 들어 따로 알린다", () => {
    render(<DeviationStrip apt={apt()} fields={OVERVIEW_DEVIATION_FIELDS} regionStats={gyeonggiStats()} />);
    fireEvent.click(screen.getByRole("button", { name: /지역 비교 풀이 보기/ }));
    const tip = screen.getByRole("tooltip").textContent ?? "";
    expect(tip).toContain("단, 주차·전용률 줄은 좋고 나쁨도 함께 적어요");
  });
});

// 세션675 👤 「비교 막대 색 뜻 안내」 · 「'소득...' 잘림 고치기」 · 「깨진 글자 2개」(멂)
describe("DeviationStrip — 상세 종합 탭 색 뜻 한 줄 · 이름 칸 폭 (세션675)", () => {
  it("상세(compact=false)에만 색 뜻 한 줄 — 실제 색 규칙대로(회색 = 판정 없는 줄, 판정 줄만 파랑·주황)", () => {
    render(
      <DeviationStrip apt={apt()} fields={OVERVIEW_DEVIATION_FIELDS} regionStats={gyeonggiStats()} compact={false} />
    );
    const legend = screen.getByTestId("deviation-legend").textContent ?? "";
    expect(legend).toBe(
      "세로선 = 같은 지역 한가운데 값 · 회색 막대 = 이 단지 값이 그보다 크거나 작은 정도 · 주차·전용률 줄은 파랑 = 유리 · 주황 = 불리"
    );
  });

  it("판정 줄이 없는 목록(카드 3줄)이면 파랑·주황 절을 빼고, 카드에는 아예 안 그린다", () => {
    expect(deviationLegendText(CARD_DEVIATION_FIELDS)).not.toMatch(/파랑|주황/);
    render(<DeviationStrip apt={apt()} fields={CARD_DEVIATION_FIELDS} regionStats={gyeonggiStats()} />);
    expect(screen.queryByTestId("deviation-legend")).toBeNull();
  });

  it("이름 칸 = 카드 40px · 상세 52px(4글자 「소득부담」이 잘리지 않게) — 한 블록 안은 같은 폭", () => {
    const { container } = render(
      <DeviationStrip apt={apt()} fields={OVERVIEW_DEVIATION_FIELDS} regionStats={gyeonggiStats()} compact={false} />
    );
    const widths = [...container.querySelectorAll('[role="img"]')].map(
      (row) => (row.firstElementChild as HTMLElement).style.width
    );
    expect(widths.length).toBeGreaterThan(3);
    expect(new Set(widths)).toEqual(new Set([`${LABEL_W_WIDE}px`]));
    const card = render(<DeviationStrip apt={apt()} fields={CARD_DEVIATION_FIELDS} regionStats={gyeonggiStats()} />);
    const cardRow = card.container.querySelector('[role="img"]')?.firstElementChild as HTMLElement;
    expect(cardRow.style.width).toBe(`${LABEL_W_COMPACT}px`);
  });

  it("상세 값 슬롯은 끝을 2px 띄운다(굵은 끝 글자 「멂」이 창 끝에 붙어 잘려 보이지 않게)", () => {
    const { container } = render(
      <DeviationStrip apt={apt()} fields={OVERVIEW_DEVIATION_FIELDS} regionStats={gyeonggiStats()} compact={false} />
    );
    const row = container.querySelector('[role="img"][aria-label^="역세권"]') as HTMLElement;
    expect((row.lastElementChild as HTMLElement).style.paddingRight).toBe("2px");
  });
});
