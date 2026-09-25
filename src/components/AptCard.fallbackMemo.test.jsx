// @ts-check
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { AptCard } from "./AptCard";
import { makeApt } from "@/__tests__/factories";
import { computeRegionalStats } from "@/scoring/regionalStats";

/*
 * 세션576 D5-b — 카드 memo 비교 함수가 **추정 재료(spec.fallback.from)** 까지 보는지.
 *
 * 지금 카드 3줄(`CARD_DEVIATION_FIELDS`)에는 추정 폴백을 가진 줄이 없다(주차는 팝업 8줄에만 있다).
 * 그래서 실제 상수로는 이 경로를 시험할 수 없다 — 카드 3줄 중 역세권 줄에 가짜 폴백
 * (`presaleParking` 을 그대로 거리로 쓴다)을 달아, "추정 재료만 바뀐 카드가 다시 그려지는가"를 본다.
 * 나중에 누가 카드에 폴백 줄을 넣는 순간 이 경로가 실전이 된다(세션 430·461·479 사고 자리).
 */
vi.mock("@/constants/deviationFields", async (importOriginal) => {
  /** @type {any} */
  const mod = await importOriginal();
  return {
    ...mod,
    CARD_DEVIATION_FIELDS: mod.CARD_DEVIATION_FIELDS.map((/** @type {any} */ f) =>
      f.field === "subwayDist"
        ? {
            ...f,
            fallback: {
              from: ["presaleParking"],
              estimate: (/** @type {unknown} */ v) => (typeof v === "number" ? v : null),
            },
          }
        : f
    ),
  };
});

/** 경기 21단지 — 역세권 200~1,200m(가운데 700m) */
function gyeonggiStats() {
  return computeRegionalStats(
    Array.from(
      { length: 21 },
      (_, i) => /** @type {any} */ ({ region: "경기", pp: 1000 + i * 40, unsoldRate: i, subwayDist: 200 + i * 50 })
    )
  );
}

/**
 * @param {any} apt
 * @returns {any}
 */
function makeProps(apt) {
  return {
    apt,
    res: {
      total: 75,
      cats: {
        price: { label: "가격 매력도", total: 70, subs: [] },
        location: { label: "입지·생활권", total: 80, subs: [] },
        product: { label: "상품성", total: 65, subs: [] },
        benefit: { label: "혜택·할인", total: 60, totalWon: 0, rate: 0, subs: [] },
        risk: { label: "안전도", total: 85, subs: [] },
        future: { label: "미래가치", total: 72, subs: [] },
      },
    },
    rank: 1,
    onDetail: vi.fn(),
    isComp: false,
    onComp: vi.fn(),
    isFav: false,
    onFav: vi.fn(),
    profileWeights: { location: 40, product: 20, price: 20, risk: 10, benefit: 5, future: 5 },
    isDesktop: false,
    regionStats: gyeonggiStats(),
  };
}

describe("AptCard memo — 추정 재료만 바뀌어도 다시 그린다 (세션576 D5-b)", () => {
  it("presaleParking 만 다른 두 단지 → 비교 함수가 '다르다'고 보고 화면이 따라 바뀐다", () => {
    const before = makeApt({
      region: "경기",
      price: 33000,
      pp: 1200,
      unsoldRate: 4,
      subwayDist: null,
      presaleParking: 300,
    });
    const props = makeProps(before);
    const { rerender, container } = render(<AptCard {...props} />);
    const first = container.textContent ?? "";
    expect(first).toMatch(/가까워요/);

    // ⚠️ presaleParking **하나만** 바꾼다 — 다른 추적 필드가 같이 바뀌면 그쪽 때문에 다시 그려진다.
    rerender(<AptCard {...props} apt={{ ...before, presaleParking: 1400 }} />);
    const second = container.textContent ?? "";
    expect(second, "추정 재료만 바뀌었는데 카드가 옛 화면 그대로다").not.toBe(first);
    expect(second).toMatch(/멀어요/);
  });
});
