import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  PricePositionBox,
  scopeHeadText,
  compareRows,
  dongFactParts,
  complexJeonseText,
  effectiveScope,
  PRICE_SOURCE_TEXT,
} from "./PricePositionBox";
import type { Apt } from "@/types/scoring";

/**
 * 시세 탭 맨 위 상자 — 머리 줄(범위) · 비교 표 · 동네 사실 줄 · 출처 (세션589 · 609 라 · 651).
 *
 * 세션651(사장님 결정 — 공공기관 준거): "적정가"·"저렴/비쌈/수준" 판정어·색·"적정가 대비 위치" 눈금을 지우고
 * 비교 대상의 사실과 출처만 적는다. 이 파일은 그 문장들을 **리터럴**로 잠그고, 옛 판정어가 돌아오면 red 가 되게
 * 부재도 함께 단언한다(.claude/rules/meta/guards-must-be-mutation-tested.md "파생 가드").
 */

const apt = (over: Record<string, unknown> = {}) => ({ id: "t", name: "t", ...over }) as unknown as Apt;

/** 같은 범위로 계산된 점수 캐시(재계산 뒤) */
const cat = (scope: "complex" | "dong_peer" | "none", deviation: string, fairPrice = 48000) => ({
  fairPrice,
  deviation,
  fairPriceScope: scope,
});

const T1_SALE = {
  price: 42000,
  area: 84.97,
  cmpScope: "complex",
  cmpFairPrice: 48000,
  cmpN: 7,
  cmpMonths: 12,
  cmpAreaMode: "same_area",
  cmpSrc: "sale",
};
const T1_PRESALE = { ...T1_SALE, cmpSrc: "presale", cmpN: 4 };
const T2 = {
  price: 50440,
  area: 59.9,
  cmpScope: "dong_peer",
  cmpFairPrice: 52000,
  cmpN: 5,
  cmpMonths: 12,
  cmpAreaMode: "same_area",
  cmpSrc: "sale",
};
const T3 = { cmpScope: "none", cmpFairPrice: null, cmpN: 0, cmpMonths: 12, cmpAreaMode: null, cmpSrc: null };
const DONG = {
  n: 4,
  min: 30000,
  median: 35000,
  max: 41000,
  build_year_min: 1996,
  build_year_max: 2004,
  age_gap_years: 22,
  peer_n: 0,
  peer_median: null,
};

/** 손님 문자열에 판정어가 없다 — 옛 문구로 되돌리면 red */
const JUDGE_WORDS = /적정가|저렴|비쌈|저평가|고평가/;

describe("머리 줄 — cmpScope 와 일치하는 문장 (§5-4 · 세션651 W3)", () => {
  it("T1 매매: 이 단지 같은 평수(전용 N㎡) 실거래와 견주면", () => {
    expect(scopeHeadText(apt(T1_SALE))).toBe("이 단지 같은 평수(전용 84.97㎡) 실거래와 견주면");
  });

  it("T1 분양권: 이 단지 같은 평수(전용 N㎡) 분양권 거래와 견주면", () => {
    expect(scopeHeadText(apt(T1_PRESALE))).toBe("이 단지 같은 평수(전용 84.97㎡) 분양권 거래와 견주면");
  });

  it("T2: 같은 동 비슷한 연식(±10년)·같은 평수 … 실거래와 견주면 (보조 범위의 폭을 밝힌다)", () => {
    expect(scopeHeadText(apt(T2))).toBe("같은 동 비슷한 연식(±10년)·같은 평수(전용 59.9㎡) 실거래와 견주면");
  });

  it("T3: 비교할 실거래가 아직 없어요", () => {
    expect(scopeHeadText(apt(T3))).toBe("비교할 실거래가 아직 없어요");
  });

  it("면적을 모르면 '(전용 N㎡)' 토막을 뺀다", () => {
    expect(scopeHeadText(apt({ ...T1_SALE, area: null }))).toBe("이 단지 같은 평수 실거래와 견주면");
  });

  it("㎡당 환산이면 '비슷한 평수' + 그 폭을 괄호로 밝힌다", () => {
    expect(scopeHeadText(apt({ ...T1_SALE, cmpAreaMode: "per_m2" }))).toBe(
      "이 단지 비슷한 평수(전용 84.97㎡) 실거래와 견주면 (면적 20㎡ 이내 ㎡당 환산)"
    );
  });

  it("cmpScope 가 undefined(옛 캐시·옛 JSON) 면 머리 줄이 없고 옛 눈금도 없다", () => {
    expect(scopeHeadText(apt())).toBeNull();
    const { container } = render(<PricePositionBox priceCat={{ fairPrice: 48000, deviation: "12.4" }} apt={apt()} />);
    expect(screen.queryByTestId("price-scope-head")).toBeNull();
    expect(container.textContent).not.toContain("적정가 대비 위치");
    expect(container.firstChild).toBeNull(); // 범위를 모르면 차이도 말하지 않는다
  });

  it("cmpScope 가 null(trade_stats 행 없음) 이어도 '거래 없음' 이라 말하지 않는다", () => {
    expect(scopeHeadText(apt({ cmpScope: null }))).toBeNull();
    expect(effectiveScope(apt({ cmpScope: null }))).toBeNull();
  });

  it("범위가 complex 여도 비교 중앙값이 없으면 T3 문장 — 점수(scorePrice)와 같은 판정", () => {
    expect(scopeHeadText(apt({ ...T1_SALE, cmpFairPrice: 0 }))).toBe("비교할 실거래가 아직 없어요");
  });
});

describe("비교 표 — 분양가 · 중앙값 · 차이 · 전세가율 (세션651 W3)", () => {
  const rowsOf = (a: Apt, c: Parameters<typeof compareRows>[1]) =>
    compareRows(a, c).map((r) => `${r.label} | ${r.value}`);

  it("T1 매매: 분양가 / 이 단지 실거래 중앙값 (N건 · 최근 M개월) / 차이 분양가가 X% 낮음", () => {
    expect(rowsOf(apt(T1_SALE), cat("complex", "12.5"))).toEqual([
      "분양가 | 4억 2,000만",
      "이 단지 실거래 중앙값 | 4억 8,000만 (7건 · 최근 12개월)",
      "차이 | 분양가가 12.5% 낮음",
    ]);
  });

  it("T1 분양권: 중앙값 줄 이름이 '이 단지 분양권 거래 중앙값', 음수면 '높음'", () => {
    expect(rowsOf(apt(T1_PRESALE), cat("complex", "-15.6"))).toEqual([
      "분양가 | 4억 2,000만",
      "이 단지 분양권 거래 중앙값 | 4억 8,000만 (4건 · 최근 12개월)",
      "차이 | 분양가가 15.6% 높음",
    ]);
  });

  it("T2: '같은 동 또래 실거래 중앙값' · ±10% 안이어도 판정 없이 숫자 그대로", () => {
    expect(rowsOf(apt(T2), cat("dong_peer", "3.0", 52000))).toEqual([
      "분양가 | 5억 440만",
      "같은 동 또래 실거래 중앙값 | 5억 2,000만 (5건 · 최근 12개월)",
      "차이 | 분양가가 3.0% 낮음",
    ]);
  });

  it("차이 0 이면 '분양가가 같음'", () => {
    expect(compareRows(apt(T1_SALE), cat("complex", "0.0")).find((r) => r.key === "gap")?.value).toBe("분양가가 같음");
  });

  it("기간은 cmpMonths 값으로 적는다 (12 를 손으로 박지 않는다)", () => {
    expect(compareRows(apt({ ...T1_SALE, cmpMonths: 6 }), undefined).find((r) => r.key === "median")?.value).toBe(
      "4억 8,000만 (7건 · 최근 6개월)"
    );
  });

  it("점수 캐시가 다른 범위(재계산 전)면 차이 줄을 비운다 — 서로 다른 기준의 숫자를 나란히 두지 않는다", () => {
    const old = { fairPrice: 50000, deviation: "25.0" }; // fairPriceScope 없음 = 전환 전 캐시
    expect(compareRows(apt(T1_SALE), old).map((r) => r.key)).toEqual(["price", "median"]);
    const { container } = render(<PricePositionBox priceCat={old} apt={apt(T1_SALE)} />);
    expect(container.textContent).not.toContain("25");
  });

  it("분양가가 없으면 분양가·차이 줄을 빼고 0 으로 적지 않는다", () => {
    expect(compareRows(apt({ ...T1_SALE, price: null }), cat("complex", "12.5")).map((r) => r.key)).toEqual(["median"]);
  });

  it("T3 에는 가격 줄이 없다", () => {
    expect(compareRows(apt(T3), cat("none", "0.0", 0))).toEqual([]);
  });
});

describe("상자 — 머리 줄 · 표 · 출처, 판정어·눈금 없음 (세션651)", () => {
  it("T1 매매: 머리 줄이 맨 위, 그 아래 표, 맨 아래 출처 줄", () => {
    const { container } = render(<PricePositionBox priceCat={cat("complex", "12.5")} apt={apt(T1_SALE)} />);
    const head = screen.getByTestId("price-scope-head");
    const table = screen.getByTestId("price-compare-table");
    const src = screen.getByTestId("price-source");
    expect(head.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(table.compareDocumentPosition(src) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(src.textContent).toBe(
      "출처: 국토교통부 아파트 실거래가(공공데이터포털) · 같은 집 기준 = 한국부동산원 실거래가격지수 정의(단지·면적 같음)"
    );
    expect(src.textContent).toBe(PRICE_SOURCE_TEXT);
    expect(container.textContent).toContain("분양가가 12.5% 낮음");
  });

  it("판정어·눈금이 돌아오지 않는다 — 큰 괴리여도", () => {
    for (const [scope, dev, a] of [
      ["complex", "35.0", T1_SALE],
      ["complex", "-40.0", T1_PRESALE],
      ["dong_peer", "5.0", T2],
    ] as const) {
      const { container, unmount } = render(
        <PricePositionBox priceCat={cat(scope, dev, a.cmpFairPrice)} apt={apt({ ...a, dongFact: DONG })} />
      );
      expect(container.textContent).not.toMatch(JUDGE_WORDS);
      expect(container.textContent).not.toContain("위치");
      expect(container.querySelector('[role="meter"], [data-testid="position-gauge"]')).toBeNull();
      unmount();
    }
  });

  it("값 글자에 초록·빨강을 칠하지 않는다 — 줄마다 같은 중립 색", () => {
    render(<PricePositionBox priceCat={cat("complex", "-40.0")} apt={apt(T1_SALE)} />);
    const colors = new Set(
      Array.from(screen.getByTestId("price-compare-table").querySelectorAll<HTMLElement>("span")).map(
        (s) => s.style.color
      )
    );
    expect(colors.size).toBeLessThanOrEqual(2); // 이름 색 하나 + 값 색 하나
  });

  it("T3: 표·출처 없이 머리 줄만", () => {
    const { container } = render(<PricePositionBox priceCat={cat("none", "0.0", 0)} apt={apt(T3)} />);
    expect(screen.getByTestId("price-scope-head").textContent).toBe("비교할 실거래가 아직 없어요");
    expect(screen.queryByTestId("price-source")).toBeNull();
    expect(container.textContent).not.toMatch(JUDGE_WORDS);
  });

  it("아무 칸도 없으면 상자 자체를 안 그린다", () => {
    const { container } = render(<PricePositionBox priceCat={{ fairPrice: 0, deviation: "0.0" }} apt={apt()} />);
    expect(container.firstChild).toBeNull();
  });

  it("PSR 줄은 없다 (세션607 다) PSR 축 삭제) — psr 값이 있어도", () => {
    const { container } = render(
      <PricePositionBox priceCat={cat("complex", "12.4")} apt={apt({ ...T1_SALE, psr: 0.9 })} />
    );
    expect(screen.queryByTestId("psr-gauge")).toBeNull();
    expect(container.textContent).not.toMatch(/PSR|구 실거래가/);
  });

  it("글자에 '점수' 가 없다 (값이지 점수가 아니다 — 비로그인에게도 공개)", () => {
    const { container } = render(
      <PricePositionBox priceCat={cat("dong_peer", "3.0", 52000)} apt={apt({ ...T2, dongFact: DONG })} />
    );
    expect(container.textContent).not.toContain("점수");
  });
});

describe("동네 사실 줄 — T2·T3 (§5-4 · R5)", () => {
  it("T2: 건수 · 최저 ~ 최고 · 준공 연도 (이 단지보다 약 N년 오래됨)", () => {
    render(<PricePositionBox priceCat={cat("dong_peer", "3.0", 52000)} apt={apt({ ...T2, dongFact: DONG })} />);
    expect(screen.getByTestId("dong-fact-line").textContent).toBe(
      "같은 동·같은 평수 실거래 4건 · 최저 3억 ~ 최고 4억 1,000만 · 1996~2004년에 지은 집 (이 단지보다 약 22년 오래됨)"
    );
  });

  it("T3 에도 보인다 (동네 거래는 있는데 또래가 3건 미만)", () => {
    render(<PricePositionBox priceCat={cat("none", "0.0", 0)} apt={apt({ ...T3, dongFact: DONG })} />);
    expect(screen.getByTestId("price-scope-head").textContent).toBe("비교할 실거래가 아직 없어요");
    expect(screen.getByTestId("dong-fact-line")).toBeTruthy();
  });

  it("T1 에는 안 보인다 (같은 단지 거래가 이미 기준)", () => {
    expect(dongFactParts(apt({ ...T1_SALE, dongFact: DONG }))).toBeNull();
  });

  it("dongFact.n 이 0 이거나 없으면 줄 자체가 없다", () => {
    expect(dongFactParts(apt({ ...T2, dongFact: { ...DONG, n: 0 } }))).toBeNull();
    expect(dongFactParts(apt({ ...T2, dongFact: null }))).toBeNull();
    expect(dongFactParts(apt(T2))).toBeNull();
    render(
      <PricePositionBox priceCat={cat("dong_peer", "3.0", 52000)} apt={apt({ ...T2, dongFact: { ...DONG, n: 0 } })} />
    );
    expect(screen.queryByTestId("dong-fact-line")).toBeNull();
    expect(screen.getByTestId("price-scope-head")).toBeTruthy(); // 양성 앵커
  });

  it("연식 차이 부호 — 음수면 '새 집', 0·null 이면 괄호 토막 생략", () => {
    expect(dongFactParts(apt({ ...T2, dongFact: { ...DONG, age_gap_years: -6.4 } }))?.year).toBe(
      "1996~2004년에 지은 집 (이 단지보다 약 6년 새 집)"
    );
    expect(dongFactParts(apt({ ...T2, dongFact: { ...DONG, age_gap_years: 0 } }))?.year).toBe("1996~2004년에 지은 집");
    expect(dongFactParts(apt({ ...T2, dongFact: { ...DONG, age_gap_years: null } }))?.year).toBe(
      "1996~2004년에 지은 집"
    );
  });

  it("같은 해에 지은 집들은 연도 하나, 연도를 모르면 연도 토막을 뺀다", () => {
    expect(dongFactParts(apt({ ...T2, dongFact: { ...DONG, build_year_min: 2001, build_year_max: 2001 } }))?.year).toBe(
      "2001년에 지은 집 (이 단지보다 약 22년 오래됨)"
    );
    expect(
      dongFactParts(apt({ ...T2, dongFact: { ...DONG, build_year_min: null, build_year_max: null } }))?.year
    ).toBeNull();
  });

  it("준공 연도 토막은 가격 토막과 같은 줄·같은 글자 크기 (§8)", () => {
    render(<PricePositionBox priceCat={cat("dong_peer", "3.0", 52000)} apt={apt({ ...T2, dongFact: DONG })} />);
    const line = screen.getByTestId("dong-fact-line");
    const price = line.querySelector<HTMLElement>('[data-part="price"]');
    const year = line.querySelector<HTMLElement>('[data-part="year"]');
    expect(price?.parentElement).toBe(line);
    expect(year?.parentElement).toBe(line);
    // 토막 자신은 글자 크기를 정하지 않는다 — 줄 하나의 크기를 같이 물려받는다
    expect(price?.style.fontSize).toBe("");
    expect(year?.style.fontSize).toBe("");
  });
});

describe("같은 단지 전세가율 — 산식 (R3 · 세션651 W3)", () => {
  it("값이 있으면 표의 '전세가율' 줄에 '72.3% (전세 N건 ÷ 매매 M건)'", () => {
    const a = apt({ ...T1_SALE, complexJeonseRate: 62.37, complexJeonseN: 5, complexSaleN: 7 });
    expect(complexJeonseText(a)).toBe("62.4% (전세 5건 ÷ 매매 7건)");
    render(<PricePositionBox priceCat={cat("complex", "12.4")} apt={a} />);
    expect(screen.getByTestId("complex-jeonse").textContent).toBe("전세가율62.4% (전세 5건 ÷ 매매 7건)");
  });

  it("건수 칸이 없으면 비율만", () => {
    expect(complexJeonseText(apt({ complexJeonseRate: 72 }))).toBe("72%");
  });

  it("값이 없으면 칸 자체를 안 그린다 — 옛 구 전세가율(jeonseRate)로 대신하지 않는다", () => {
    const a = apt({ ...T1_SALE, complexJeonseRate: null, jeonseRate: 71 });
    expect(complexJeonseText(a)).toBeNull();
    const { container } = render(<PricePositionBox priceCat={cat("complex", "12.4")} apt={a} />);
    expect(screen.queryByTestId("complex-jeonse")).toBeNull();
    expect(container.textContent).not.toContain("전세가율");
  });
});
