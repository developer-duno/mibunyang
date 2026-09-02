// @ts-check
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AptCard } from "./AptCard";
import { makeApt } from "@/__tests__/factories";
import { computeRegionalStats } from "@/scoring/regionalStats";

/** 경기 21단지 — G1 지역 기준(n≥20)을 넘긴다 */
function gyeonggiStats() {
  return computeRegionalStats(
    Array.from(
      { length: 21 },
      (_, i) => /** @type {any} */ ({ region: "경기", pp: 1000 + i * 40, unsoldRate: i, subwayDist: 200 + i * 50 })
    )
  );
}

/** @returns {any} */
function makeRes(over = {}) {
  return {
    total: 75,
    cats: {
      price: { label: "가격 매력도", total: 70, subs: [{ info: "-3.5%", name: "적정가괴리", score: 70 }] },
      location: { label: "입지·생활권", total: 80, subs: [{ info: "역세권(500m)", name: "지하철", score: 80 }] },
      product: { label: "상품성", total: 65, subs: [] },
      benefit: { label: "혜택·할인", total: 60, totalWon: 1500, rate: 3, subs: [] },
      risk: { label: "안전도", total: 85, subs: [] },
      future: { label: "미래가치", total: 72, subs: [] },
    },
    ...over,
  };
}

/** @returns {any} */
function makeProps(over = {}) {
  return {
    apt: makeApt({ region: "경기", price: 33000, pp: 1200, unsoldRate: 4, subwayDist: 300, subwayName: "판교" }),
    res: makeRes(),
    rank: 1,
    onDetail: vi.fn(),
    isComp: false,
    onComp: vi.fn(),
    isFav: false,
    onFav: vi.fn(),
    profileWeights: { location: 40, product: 20, price: 20, risk: 10, benefit: 5, future: 5 },
    isDesktop: false,
    regionStats: gyeonggiStats(),
    ...over,
  };
}

/**
 * 세션 505: 되돌림용 피처 플래그(`VITE_FEATURE_DEVIATION_STRIP`)가 졸업했다.
 * 이제 스트립을 켜고 끄는 유일한 조건은 **지역 분포가 있느냐**라, 아래 테스트들도
 * 환경변수 대신 `regionStats` 를 레버로 쓴다(검증하는 화면 거동은 전과 같다).
 */
describe("편차 스트립 — 렌더 조건", () => {
  it("지역 분포가 있으면 스트립 3줄이 나온다", () => {
    render(<AptCard {...makeProps()} />);
    // 세션539 A-6: 대조군이 오피스텔·재건축을 섞어 그룹핑해 "아파트"라 단정할 수 없다 —
    // 중립어(분양 단지)로 정정.
    expect(screen.getByText(/경기 분양 단지 한가운데 값과 비교/)).toBeInTheDocument();
  });

  it("regionStats 가 없으면 안 그린다 (미수집 3줄짜리 빈 블록 방지)", () => {
    render(<AptCard {...makeProps({ regionStats: null })} />);
    expect(screen.queryByText(/분양 단지 한가운데 값과 비교/)).toBeNull();
  });
});

describe("편차 스트립 — 역세권 칩 대체", () => {
  // 세션 510 PR-4: 역세권 칩은 강점(good) 층이라 상한(2개)이 적용된다. 이 픽스처의 기본 apt 는
  // discountPct=5·transitDev="GTX-C 착공"(둘 다 factories.js 기본값) 이라는 순위가 더 높은 강점
  // 칩 2개를 이미 채우고 있어 역세권 칩이 접힘으로 밀린다 — 정보를 지운 게 아니라
  // "지표 N개 더"를 펼치면 그대로 있다(더 강한 가드: 접힘 목록에 실제로 들어있는지까지 확인).
  it("스트립을 못 그리면 예전 역세권 칩이 그대로 있다 (접힘 펼쳐서 확인)", () => {
    render(<AptCard {...makeProps({ regionStats: null })} />);
    fireEvent.click(screen.getByRole("button", { name: /^지표 \d+개 더/ }));
    expect(screen.getByText(/판교 300m 역세권/)).toBeInTheDocument();
  });

  it("스트립을 그리면 역세권 칩이 빠진다 (스트립 3번째 줄이 흡수)", () => {
    render(<AptCard {...makeProps()} />);
    expect(screen.queryByText(/판교 300m 역세권/)).toBeNull();
  });
});

describe("카테고리 3칸 — 스트립 유무에 따라 숫자/등급", () => {
  it("스트립을 못 그리면 점수 숫자를 보여준다", () => {
    render(<AptCard {...makeProps({ regionStats: null })} />);
    expect(screen.getByText("80")).toBeInTheDocument(); // location total
  });

  it("스트립을 그리면 등급 문자로 압축한다 (숫자는 상세 팝업에 그대로)", () => {
    render(<AptCard {...makeProps()} />);
    expect(screen.queryByText("80")).toBeNull();
    // gr(80) 등급 문자가 대신 나온다
    expect(screen.getAllByText(/^[A-F][+-]?$/).length).toBeGreaterThanOrEqual(3);
  });

  it("비로그인은 스트립 유무와 무관하게 '??' (점수 블라인드 정책 불변)", () => {
    render(<AptCard {...makeProps({ isLoggedIn: false })} />);
    expect(screen.getAllByText("??").length).toBeGreaterThan(0);
  });
});

describe("memo comparator — 스트립이 읽는 값이 바뀌면 반드시 다시 그린다", () => {
  /**
   * 이 프로젝트가 세 번(세션 430·461·479) 당한 사고다 — 새 UI 가 읽는 필드를
   * comparator 에 안 넣으면 값이 바뀌어도 화면이 옛것 그대로 남는다.
   * comparator 를 `CARD_DEVIATION_FIELDS` 상수에서 돌게 만들었으므로,
   * 세 필드 각각이 실제로 리렌더를 유발하는지 확인한다.
   */
  const cases = [
    ["pp", 1200, 4000, /비싸요|평균 수준/],
    ["unsoldRate", 4, 19, /많아요|평균 수준/],
    ["subwayDist", 300, 1400, /멀어요|평균 수준/],
  ];

  for (const [field, before, after, expected] of cases) {
    it(`${field} 가 바뀌면 화면 문구가 따라 바뀐다`, () => {
      const props = makeProps({
        apt: makeApt({ region: "경기", price: 33000, pp: 1200, unsoldRate: 4, subwayDist: 300 }),
      });
      const { rerender, container } = render(<AptCard {...props} />);
      const firstText = container.textContent ?? "";

      const nextApt = makeApt({ region: "경기", price: 33000, pp: 1200, unsoldRate: 4, subwayDist: 300 });
      /** @type {any} */ (nextApt)[String(field)] = after;
      rerender(<AptCard {...props} apt={nextApt} />);

      const secondText = container.textContent ?? "";
      expect(secondText, `${field}: ${before} → ${after} 인데 화면이 그대로다`).not.toBe(firstText);
      expect(secondText).toMatch(/** @type {RegExp} */ (expected));
    });
  }

  it("총 분양가(price)가 바뀌어도 다시 그린다 — 편차 목록에서 빠졌지만 머리글에 표시된다", () => {
    const props = makeProps();
    const { rerender, container } = render(<AptCard {...props} />);
    const first = container.textContent ?? "";
    // ⚠️ **price 하나만** 바꾼다. 다른 추적 필드(subwayName 등)까지 같이 달라지면
    //    그쪽 때문에 다시 그려져 이 가드가 무는지 알 수 없다 — 실제로 그 함정에 걸렸다.
    rerender(<AptCard {...props} apt={{ ...props.apt, price: 77000 }} />);
    expect(container.textContent, "총 분양가가 바뀌었는데 카드가 그대로다").not.toBe(first);
  });

  it("region 이 바뀌면 비교 기준이 바뀌므로 다시 그린다", () => {
    const props = makeProps();
    const { rerender, container } = render(<AptCard {...props} />);
    expect(container.textContent).toContain("경기 분양 단지 한가운데 값과 비교");

    rerender(
      <AptCard {...props} apt={makeApt({ region: "서울", price: 33000, pp: 1200, unsoldRate: 4, subwayDist: 300 })} />
    );
    expect(container.textContent).toContain("서울 분양 단지 한가운데 값과 비교");
  });

  it("regionStats 참조가 바뀌면 다시 그린다 (데이터 갱신)", () => {
    const props = makeProps();
    const { rerender, container } = render(<AptCard {...props} />);
    const first = container.textContent ?? "";

    // 훨씬 비싼 지역 분포로 교체 → 같은 단지가 '싸다' 쪽으로 이동해야 한다
    const pricier = computeRegionalStats(
      Array.from(
        { length: 21 },
        (_, i) => /** @type {any} */ ({ region: "경기", pp: 3000 + i * 40, unsoldRate: i, subwayDist: 200 + i * 50 })
      )
    );
    rerender(<AptCard {...props} regionStats={pricier} />);
    expect(container.textContent).not.toBe(first);
    expect(container.textContent).toMatch(/싸요/);
  });

  it("카테고리 총점만 바뀌어도 다시 그린다 (총점 합이 같은 경우 방어)", () => {
    const props = makeProps();
    const { rerender, container } = render(<AptCard {...props} />);
    const first = container.textContent ?? "";

    // res.total 은 그대로 두고 카테고리 구성만 뒤바꾼다
    const swapped = makeRes();
    swapped.cats.location.total = 30;
    swapped.cats.price.total = 95;
    rerender(<AptCard {...props} res={swapped} />);
    expect(container.textContent, "총점이 같고 카테고리만 달라졌는데 화면이 그대로다").not.toBe(first);
  });
});
