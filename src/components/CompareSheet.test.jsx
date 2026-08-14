// @ts-check
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CompareSheet } from "./CompareSheet";
import { makeScoredItem } from "@/__tests__/factories";

/** @returns {any} */
function makeItem(
  /** @type {any} */ id,
  /** @type {any} */ name,
  total = 75,
  /** @type {Record<string, unknown>} */ benefitOver = {}
) {
  return makeScoredItem(
    { id, name, region: "경기", gu: "수원시", price: 50000 },
    {
      total,
      cats: {
        price: { label: "가격 매력도", total: 70, subs: [] },
        location: { label: "입지·생활권", total: 80, subs: [] },
        product: { label: "상품성", total: 65, subs: [] },
        // 실측(세션512): 금액이 있는 548곳은 **전부** 관리비 절감 단독이다 — 기본값을 그 모양으로.
        benefit: { label: "혜택·할인", total: 60, totalWon: 1000, wonSource: "관리비 절감", subs: [], ...benefitOver },
        risk: { label: "안전도", total: 85, subs: [] },
        future: { label: "미래가치", total: 72, subs: [] },
      },
    }
  );
}

describe("CompareSheet", () => {
  // 2개 미만이면 null 반환
  it("items가 1개면 아무것도 렌더링하지 않음", () => {
    const { container } = render(<CompareSheet items={[makeItem(1, "아파트A")]} onClose={vi.fn()} profile="live" />);
    expect(container.innerHTML).toBe("");
  });

  it("items가 0개면 아무것도 렌더링하지 않음", () => {
    const { container } = render(<CompareSheet items={[]} onClose={vi.fn()} profile="live" />);
    expect(container.innerHTML).toBe("");
  });

  // 2개 이상이면 비교 테이블 렌더링
  it("2개 이상이면 비교 분석 제목 표시", () => {
    const items = [makeItem(1, "아파트A"), makeItem(2, "아파트B")];
    render(<CompareSheet items={items} onClose={vi.fn()} profile="live" />);
    expect(screen.getByText("비교 분석")).toBeInTheDocument();
  });

  // 아파트 이름 표시 (마지막 단어만 사용)
  it("아파트 이름이 테이블 헤더에 표시", () => {
    const items = [makeItem(1, "힐스테이트 수원"), makeItem(2, "래미안 판교")];
    render(<CompareSheet items={items} onClose={vi.fn()} profile="live" />);
    // 동일 점수이므로 추천에도 표시될 수 있음 → getAllByText 사용
    expect(screen.getAllByText("수원").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("판교").length).toBeGreaterThanOrEqual(1);
  });

  // 종합 점수 표시
  it("종합 점수가 표시됨", () => {
    const items = [makeItem(1, "A", 82), makeItem(2, "B", 63)];
    render(<CompareSheet items={items} onClose={vi.fn()} profile={/** @type {any} */ ("live")} />);
    expect(screen.getByText("82")).toBeInTheDocument();
    expect(screen.getByText("63")).toBeInTheDocument();
  });

  // 최고 점수에 '최고' 하이라이트
  it("최고 종합 점수에 '최고' 라벨 표시", () => {
    const items = [makeItem(1, "A", 80), makeItem(2, "B", 65)];
    render(<CompareSheet items={items} onClose={vi.fn()} profile={/** @type {any} */ ("live")} />);
    expect(screen.getByText("최고")).toBeInTheDocument();
  });

  // 닫기 버튼
  it("닫기 버튼 클릭 시 onClose 호출", () => {
    const onClose = vi.fn();
    const items = [makeItem(1, "A"), makeItem(2, "B")];
    render(<CompareSheet items={items} onClose={onClose} profile={/** @type {any} */ ("live")} />);
    fireEvent.click(screen.getByLabelText("비교 닫기"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // 공유 버튼 (onShare 제공 시)
  it("onShare 제공 시 공유 버튼 표시", () => {
    const items = [makeItem(1, "A"), makeItem(2, "B")];
    render(<CompareSheet items={items} onShare={vi.fn()} onClose={vi.fn()} profile={/** @type {any} */ ("live")} />);
    expect(screen.getByLabelText("비교 결과 공유하기")).toBeInTheDocument();
  });

  it("onShare 미제공 시 공유 버튼 미표시", () => {
    const items = [makeItem(1, "A"), makeItem(2, "B")];
    render(<CompareSheet items={items} onClose={vi.fn()} profile={/** @type {any} */ ("live")} />);
    expect(screen.queryByLabelText("비교 결과 공유하기")).toBeNull();
  });

  // 카테고리별 점수 행 표시
  it("카테고리별 점수 행이 표시됨", () => {
    const items = [makeItem(1, "A"), makeItem(2, "B")];
    render(<CompareSheet items={items} onClose={vi.fn()} profile={/** @type {any} */ ("live")} />);
    expect(screen.getByText("종합")).toBeInTheDocument();
    expect(screen.getByText("분양가")).toBeInTheDocument();
    expect(screen.getByText("관리비 절감")).toBeInTheDocument(); // 혜택 행 (라벨은 파생 — 아래 블록)
    expect(screen.getByText("규제현황")).toBeInTheDocument();
    expect(screen.getByText("LTV한도")).toBeInTheDocument();
    expect(screen.getByText("필요자본")).toBeInTheDocument();
  });

  // ── 혜택 행 라벨은 파생이다 (세션512) ────────────────────────────────────────
  //
  // ⚠️ 카드·상세는 `wonSource` 파생으로 바꿨는데 이 행만 `"관리비 절감 등 혜택"` 으로 손에 적혀
  //    있었다. 지금은 우연히 맞지만 다른 혜택이 채워지면 조용히 거짓이 된다.
  //    각 테스트는 **옛 하드코딩이 돌아오면 red** 가 되도록 그 문자열의 부재를 함께 단언한다
  //    (.claude/rules/meta/guards-must-be-mutation-tested.md).
  describe("혜택 행 라벨 (세션512)", () => {
    it("구성이 한 종류면 그 이름을 쓴다", () => {
      const items = [makeItem(1, "A"), makeItem(2, "B")];
      render(<CompareSheet items={items} onClose={vi.fn()} profile={/** @type {any} */ ("live")} />);
      expect(screen.getByText("관리비 절감")).toBeInTheDocument();
      expect(screen.queryByText("관리비 절감 등 혜택")).toBeNull(); // 옛 하드코딩
    });

    it("구성이 서로 다르면 '혜택 합계'", () => {
      const items = [
        makeItem(1, "A", 75, { wonSource: "관리비 절감" }),
        makeItem(2, "B", 75, { wonSource: "분양가 할인" }),
      ];
      render(<CompareSheet items={items} onClose={vi.fn()} profile={/** @type {any} */ ("live")} />);
      expect(screen.getByText("혜택 합계")).toBeInTheDocument();
      expect(screen.queryByText("관리비 절감 등 혜택")).toBeNull();
    });

    // 폴백이 "혜택" 이면 혜택 **점수** 행(라벨 "혜택")과 같은 말이 두 줄 생긴다 — 그래서 "혜택 금액".
    it("금액이 없으면 구성을 주장하지 않는다 — '혜택 금액' (점수 행과 겹치지 않게)", () => {
      const items = [
        makeItem(1, "A", 75, { totalWon: 0, wonSource: "" }),
        makeItem(2, "B", 75, { totalWon: 0, wonSource: "" }),
      ];
      render(<CompareSheet items={items} onClose={vi.fn()} profile={/** @type {any} */ ("live")} />);
      expect(screen.getByText("혜택 금액")).toBeInTheDocument();
      expect(screen.getAllByText("혜택")).toHaveLength(1); // 점수 행 하나뿐
      expect(screen.queryByText("관리비 절감 등 혜택")).toBeNull();
    });
  });

  // 3개 비교
  it("3개 아이템도 정상 렌더링", () => {
    const items = [makeItem(1, "A", 80), makeItem(2, "B", 70), makeItem(3, "C", 60)];
    render(<CompareSheet items={items} onClose={vi.fn()} profile={/** @type {any} */ ("live")} />);
    const headers = screen.getAllByRole("columnheader");
    // 항목 헤더(1) + 아파트 3개 = 4
    expect(headers).toHaveLength(4);
  });

  // --- 바 차트 테스트 ---

  it("종합/카테고리 행에 점수 비례 바가 렌더링됨", () => {
    // 종합 80점 → 바 너비 80%, 카테고리 각 점수에 비례하는 바 존재
    const items = [makeItem(1, "A", 80), makeItem(2, "B", 60)];
    const { container } = render(
      <CompareSheet items={items} onClose={vi.fn()} profile={/** @type {any} */ ("live")} />
    );
    // 바는 gradient background가 있는 inner div — 최소 8개 (종합 2 + 카테고리 6×2 = 14개)
    const bars = container.querySelectorAll('div[style*="linear-gradient"]');
    expect(bars.length).toBeGreaterThanOrEqual(8);
  });

  it("score=0 또는 null일 때 바가 안전하게 렌더링됨 (너비 0%)", () => {
    const items = [
      makeScoredItem(
        { id: 1, name: "A", region: "경기", gu: "수원시", price: 50000 },
        {
          total: 0,
          cats: {
            price: { label: "가격 매력도", total: 0, subs: [] },
            location: { label: "입지·생활권", total: null, subs: [] },
            product: { label: "상품성", total: 0, subs: [] },
            benefit: { label: "혜택·할인", total: 0, totalWon: 0, subs: [] },
            risk: { label: "안전도", total: 0, subs: [] },
            future: { label: "미래가치", total: 0, subs: [] },
          },
        }
      ),
      makeItem(2, "B", 50),
    ];
    const { container } = render(
      <CompareSheet items={items} onClose={vi.fn()} profile={/** @type {any} */ ("live")} />
    );
    // 0% 바 확인 — 렌더링 에러 없이 표시되어야 함
    const zeroBars = container.querySelectorAll('div[style*="width: 0%"]');
    expect(zeroBars.length).toBeGreaterThanOrEqual(1);
  });

  it("카테고리 바는 catCol 색상을 사용", () => {
    const items = [makeItem(1, "A", 80), makeItem(2, "B", 70)];
    const { container } = render(<CompareSheet items={items} onClose={vi.fn()} profile="live" />);
    // 바 트랙(배경 #ECEEF4)과 내부 gradient 바가 존재하는지 확인
    const tracks = container.querySelectorAll('div[style*="border-radius: 99px"]');
    // 종합 2트랙 + 카테고리 6×2=12트랙 → 트랙+바 총 28개 (각 트랙 안에 바 1개)
    expect(tracks.length).toBeGreaterThanOrEqual(14);
  });

  // --- 프로필 기준 추천 요약 테스트 ---

  it("프로필 기준 추천 요약이 표시됨", () => {
    const items = [makeItem(1, "힐스테이트 A", 80), makeItem(2, "래미안 B", 65)];
    render(<CompareSheet items={items} onClose={vi.fn()} profile="live" />);
    // "실거주 기준 추천" 텍스트가 표시되어야 함
    expect(screen.getByText(/실거주 기준 추천/)).toBeInTheDocument();
    // 최고 점수 아파트 이름 + 점수가 추천 영역에 표시
    expect(screen.getByText(/80점/)).toBeInTheDocument();
  });

  it("invest 프로필일 때 '투자 기준 추천' 표시", () => {
    const items = [makeItem(1, "아파트 X", 70), makeItem(2, "아파트 Y", 90)];
    render(<CompareSheet items={items} onClose={vi.fn()} profile="invest" />);
    expect(screen.getByText(/투자 기준 추천/)).toBeInTheDocument();
    // Y가 90점으로 최고 → 추천 영역에 점수 표시
    expect(screen.getByText(/90점/)).toBeInTheDocument();
  });

  it("profile 미전달 시 기본값(실거주) 폴백", () => {
    const items = [makeItem(1, "A단지", 75), makeItem(2, "B단지", 80)];
    render(<CompareSheet items={items} onClose={vi.fn()} profile={/** @type {any} */ ("live")} />);
    expect(screen.getByText(/실거주 기준 추천/)).toBeInTheDocument();
  });

  // --- 비로그인 블러 테스트 ---

  it("isLoggedIn=false일 때 점수가 '??'로 표시되고 추천 요약 숨김", () => {
    const items = [makeItem(1, "A", 82), makeItem(2, "B", 63)];
    render(<CompareSheet items={items} onClose={vi.fn()} profile={/** @type {any} */ ("live")} isLoggedIn={false} />);
    // 실제 점수(82, 63)는 DOM에 없어야 함
    expect(screen.queryByText("82")).toBeNull();
    expect(screen.queryByText("63")).toBeNull();
    // "??" 텍스트가 표시되어야 함
    expect(screen.getAllByText("??").length).toBeGreaterThanOrEqual(2);
    // 추천 요약 숨김
    expect(screen.queryByText(/기준 추천/)).toBeNull();
    // 로그인 CTA 표시
    expect(screen.getByText("점수 분석을 보려면 로그인하세요")).toBeInTheDocument();
    // 팩트 데이터(분양가, 규제 등)는 여전히 표시
    expect(screen.getByText("분양가")).toBeInTheDocument();
    expect(screen.getByText("규제현황")).toBeInTheDocument();
  });

  it("isLoggedIn=false일 때 export/공유 버튼 숨김", () => {
    const items = [makeItem(1, "A"), makeItem(2, "B")];
    render(
      <CompareSheet
        items={items}
        onShare={vi.fn()}
        onClose={vi.fn()}
        isLoggedIn={false}
        profile={/** @type {any} */ ("live")}
      />
    );
    expect(screen.queryByLabelText("이미지 내보내기")).toBeNull();
    expect(screen.queryByLabelText("PDF 내보내기")).toBeNull();
    expect(screen.queryByLabelText("비교 결과 공유하기")).toBeNull();
    // 닫기 버튼은 여전히 표시
    expect(screen.getByLabelText("비교 닫기")).toBeInTheDocument();
  });
});

/**
 * 세션 487 PR-0 회귀 가드 — 비교표 6행의 순서가 서버 catsCache 의 JSON 키
 * 직렬화 순서에 기대지 않는지. 이전 코드는 `Object.keys(items[0].res.cats)`
 * 였기에 수집기가 필드 대입 순서만 바꿔도 행 순서가 조용히 뒤집혔다.
 */
describe("CompareSheet — 카테고리 행 순서 (catsCache 키 순서와 무관)", () => {
  /**
   * cats 를 임의의 키 순서로 만들어 주는 팩토리
   * @returns {any}
   */
  function makeItemWithCatOrder(/** @type {any} */ id, /** @type {string[]} */ keyOrder) {
    /** @type {any} */
    const byKey = {
      price: { label: "가격 매력도", total: 70, subs: [] },
      location: { label: "입지·생활권", total: 80, subs: [] },
      product: { label: "상품성", total: 65, subs: [] },
      benefit: { label: "혜택·할인", total: 60, totalWon: 1000, subs: [] },
      risk: { label: "안전도", total: 85, subs: [] },
      future: { label: "미래가치", total: 72, subs: [] },
    };
    /** @type {any} */
    const cats = {};
    for (const k of keyOrder) cats[k] = byKey[k];
    return makeScoredItem({ id, name: `아파트${id}`, region: "경기", gu: "수원시", price: 50000 }, { total: 75, cats });
  }

  /** 렌더된 표에서 카테고리 행 라벨을 DOM 차례대로 뽑는다 */
  function catRowLabels(/** @type {any} */ container) {
    const wanted = new Set(["가격 매력도", "입지", "혜택", "상품성", "안전도", "미래가치"]);
    return [...container.querySelectorAll("tbody tr")]
      .map((tr) => tr.querySelector("td")?.textContent?.trim())
      .filter((t) => t && wanted.has(t));
  }

  const EXPECTED = ["가격 매력도", "입지", "혜택", "상품성", "안전도", "미래가치"];

  it("운영 catsCache 키 순서(risk>price>future>benefit>product>location)여도 화면은 고정 순서", () => {
    const order = ["risk", "price", "future", "benefit", "product", "location"];
    const { container } = render(
      <CompareSheet
        items={[makeItemWithCatOrder(1, order), makeItemWithCatOrder(2, order)]}
        onClose={vi.fn()}
        isLoggedIn
        profile={/** @type {any} */ ("live")}
      />
    );
    expect(catRowLabels(container)).toEqual(EXPECTED);
  });

  it("키 순서를 완전히 뒤집어도 화면 순서는 그대로 (이 PR 의 존재 이유)", () => {
    const order = ["location", "product", "benefit", "future", "price", "risk"];
    const { container } = render(
      <CompareSheet
        items={[makeItemWithCatOrder(1, order), makeItemWithCatOrder(2, order)]}
        onClose={vi.fn()}
        isLoggedIn
        profile={/** @type {any} */ ("live")}
      />
    );
    expect(catRowLabels(container)).toEqual(EXPECTED);
  });
});
