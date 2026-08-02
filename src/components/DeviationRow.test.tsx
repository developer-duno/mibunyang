import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DeviationRow, ROW_HEIGHT } from "./DeviationRow";
import { CARD_DEVIATION_FIELDS, deviationSpec } from "@/constants/deviationFields";
import type { Deviation } from "@/lib/deviation";

const priceSpec = deviationSpec("price")!;
const subwaySpec = deviationSpec("subwayDist")!;

function dev(over: Partial<Deviation> = {}): Deviation {
  return { state: "ok", fav: 70, text: "12% 싸요", tone: "good", nationalFallback: false, ...over };
}

/** 렌더된 행의 자식 요소들 */
function rowOf(container: HTMLElement) {
  const row = container.querySelector('[role="img"]') as HTMLElement;
  return { row, kids: [...row.children] as HTMLElement[] };
}

describe("DeviationRow — 막대 방향", () => {
  it("유리하면 막대가 중앙선 오른쪽에 붙는다", () => {
    const { container } = render(
      <DeviationRow spec={priceSpec} dev={dev({ fav: 80, tone: "good" })} value={50000} regionLabel="경기" />
    );
    const bar = container.querySelector('[style*="left: 50%"][style*="border-radius: 99px"]') as HTMLElement;
    expect(bar).toBeTruthy();
    expect(bar.style.width).toBe("30%"); // |80 - 50|
  });

  it("불리하면 막대가 중앙선 왼쪽에 붙는다", () => {
    const { container } = render(
      <DeviationRow
        spec={priceSpec}
        dev={dev({ fav: 20, tone: "bad", text: "8% 비싸요" })}
        value={50000}
        regionLabel="경기"
      />
    );
    const bar = container.querySelector('[style*="right: 50%"][style*="border-radius: 99px"]') as HTMLElement;
    expect(bar).toBeTruthy();
    expect(bar.style.width).toBe("30%"); // |20 - 50|
  });

  it("막대 폭은 절대 50%를 넘지 않는다 (트랙 절반을 벗어나면 반대쪽을 침범한다)", () => {
    for (const fav of [0, 1, 50, 99, 100]) {
      const { container, unmount } = render(
        <DeviationRow spec={priceSpec} dev={dev({ fav })} value={1} regionLabel="경기" />
      );
      const bar = container.querySelector('[style*="border-radius: 99px"][style*="%"]') as HTMLElement | null;
      if (bar?.style.width.endsWith("%")) {
        expect(parseFloat(bar.style.width)).toBeLessThanOrEqual(50);
      }
      unmount();
    }
  });
});

describe("DeviationRow — 행 높이는 상태와 무관하게 고정", () => {
  const states: Array<[string, Deviation]> = [
    ["정상", dev()],
    ["미수집", dev({ state: "missing", fav: null, text: "미수집", tone: "neutral" })],
    ["표본부족", dev({ state: "sparse", fav: null, text: "비교할 단지가 적어요", tone: "neutral" })],
    ["다같음", dev({ state: "uniform", fav: null, text: "이 지역은 다 같아요", tone: "neutral" })],
  ];

  for (const [name, d] of states) {
    it(`${name} 행도 높이 ${ROW_HEIGHT}px`, () => {
      const { container } = render(<DeviationRow spec={priceSpec} dev={d} value={50000} regionLabel="경기" />);
      const { row } = rowOf(container);
      expect(row.style.height).toBe(`${ROW_HEIGHT}px`);
    });
  }
});

describe("DeviationRow — 긴 안내문이 레이아웃을 밀지 않는다", () => {
  /**
   * 실측 근거(세션 487): 값 슬롯 최대 폭이 "59% 가까워요" = 83px 이고,
   * 1024 3열에서 트랙이 75px 까지 좁아진다. "비교할 단지가 적어요"(10자, 약 140px)를
   * 같은 자리에 넣으면 넘친다 → 비교가 성립하지 않는 줄은 트랙·끝말을 그리지 않는다.
   */
  it("표본부족·다같음 줄은 트랙과 끝말을 그리지 않는다", () => {
    for (const state of ["sparse", "uniform"] as const) {
      const { container, unmount } = render(
        <DeviationRow
          spec={subwaySpec}
          dev={dev({ state, fav: null, text: "비교할 단지가 적어요", tone: "neutral" })}
          value={null}
          regionLabel="경기"
        />
      );
      const { kids } = rowOf(container);
      expect(kids).toHaveLength(2); // 라벨 + 안내문뿐
      expect(container.textContent).not.toContain(subwaySpec.lowWord);
      unmount();
    }
  });

  it("정상·미수집 줄은 라벨·끝말2·트랙·값 5개를 그린다", () => {
    for (const state of ["ok", "missing"] as const) {
      const { container, unmount } = render(
        <DeviationRow spec={priceSpec} dev={dev({ state })} value={50000} regionLabel="경기" />
      );
      expect(rowOf(container).kids).toHaveLength(5);
      unmount();
    }
  });

  it("값 슬롯은 줄바꿈하지 않는다 (두 줄로 넘치면 행 높이 고정이 깨진다)", () => {
    const { container } = render(
      <DeviationRow spec={subwaySpec} dev={dev({ text: "59% 가까워요" })} value={300} regionLabel="경기" />
    );
    const { kids } = rowOf(container);
    expect(kids[4].style.whiteSpace).toBe("nowrap");
  });
});

describe("DeviationRow — 미수집 표시", () => {
  it("트랙에 회색 해칭을 깐다 (색 말고 형태로도 구분)", () => {
    const { container } = render(
      <DeviationRow
        spec={subwaySpec}
        dev={dev({ state: "missing", fav: null, text: "미수집", tone: "neutral" })}
        value={9999}
        regionLabel="경기"
      />
    );
    const { kids } = rowOf(container);
    expect(kids[2].style.backgroundImage).toContain("repeating-linear-gradient");
  });

  it("미수집이면 막대를 그리지 않는다", () => {
    const { container } = render(
      <DeviationRow
        spec={subwaySpec}
        dev={dev({ state: "missing", fav: null, text: "미수집", tone: "neutral" })}
        value={null}
        regionLabel="경기"
      />
    );
    expect(container.querySelector('[style*="left: 50%"][style*="border-radius: 99px"]')).toBeNull();
  });
});

describe("DeviationRow — 스크린리더", () => {
  it("행 전체가 하나의 role=img 로 읽힌다", () => {
    render(<DeviationRow spec={priceSpec} dev={dev()} value={50000} regionLabel="경기" />);
    expect(screen.getByRole("img")).toBeInTheDocument();
  });

  it("aria-label 에 '점수' 글자가 없다 (DetailModal 테스트 쿼리와 충돌 차단)", () => {
    render(<DeviationRow spec={priceSpec} dev={dev()} value={50000} regionLabel="경기" />);
    expect(screen.getByRole("img").getAttribute("aria-label")).not.toContain("점수");
  });

  it("눈으로 보는 조각들은 aria-hidden — 같은 내용을 두 번 읽지 않게", () => {
    const { container } = render(<DeviationRow spec={priceSpec} dev={dev()} value={50000} regionLabel="경기" />);
    const { kids } = rowOf(container);
    // 라벨은 aria-label 에 이미 들어 있고, 끝말·트랙·값도 중복이라 숨긴다
    expect(kids.slice(1).every((k) => k.getAttribute("aria-hidden") === "true")).toBe(true);
  });
});

describe("카드 3줄 정의", () => {
  it("분양가·미분양·역세권 순서가 고정 — 30장을 훑을 때 '셋째 줄은 역세권'이 학습되게", () => {
    expect(CARD_DEVIATION_FIELDS.map((f) => f.field)).toEqual(["price", "unsoldRate", "subwayDist"]);
  });
});
