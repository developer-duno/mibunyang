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
  SAME_HOME_BASIS_TEXT,
  priceSourceText,
  rangeBar,
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

  it("면적은 소수 둘째까지만 — 저장값이 넷째 자리여도 84.7684 → 84.77 (사장님 결정 10/18)", () => {
    expect(scopeHeadText(apt({ ...T1_SALE, area: 84.7684 }))).toBe("이 단지 같은 평수(전용 84.77㎡) 실거래와 견주면");
    expect(scopeHeadText(apt({ ...T1_SALE, area: 59.9 }))).toBe("이 단지 같은 평수(전용 59.9㎡) 실거래와 견주면");
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
    expect(src.textContent).toBe(priceSourceText(apt(T1_SALE)));
    expect(container.textContent).toContain("분양가가 12.5% 낮음");
  });

  // 세션651 검사관 보완: "같은 집 기준 = 부동산원 정의(단지·면적 같음)" 는 같은 단지 · 같은 면적일 때만 참이다.
  //   ㎡당 환산(가까운 면적)·같은 동 또래(다른 단지)에 붙이면 거짓 — 국토부 출처만. 범위 조건을 빼면 red.
  it.each([
    ["T1 매매 · 같은 면적", { ...T1_SALE }, true],
    // 세션651 재검사: 분양권 거래 비교엔 붙이지 않는다 — 부동산원 실거래가격지수는 매매 거래 기준
    ["T1 분양권 · 같은 면적 (분양권이면 국토부 출처만)", { ...T1_PRESALE }, false],
    ["T1 · ㎡당 환산", { ...T1_SALE, cmpAreaMode: "per_m2" }, false],
    ["T2 같은 동 또래 · 같은 면적", { ...T2 }, false],
    ["T2 같은 동 또래 · ㎡당 환산", { ...T2, cmpAreaMode: "per_m2" }, false],
  ] as const)("출처 줄 — %s → 부동산원 '같은 집' 토막 %s", (_n, over, sameHome) => {
    const a = apt(over);
    const scope = over.cmpScope as "complex" | "dong_peer";
    render(<PricePositionBox priceCat={cat(scope, "5.0", over.cmpFairPrice)} apt={a} />);
    const src = screen.getByTestId("price-source").textContent;
    expect(src).toBe(sameHome ? `${PRICE_SOURCE_TEXT} · ${SAME_HOME_BASIS_TEXT}` : PRICE_SOURCE_TEXT);
    expect(src?.includes("한국부동산원")).toBe(sameHome);
    expect(src).toContain("국토교통부 아파트 실거래가"); // 거래 자료 출처는 늘 있다
  });

  it("전세가율 줄만 있을 때(범위 없음)도 국토부 출처만", () => {
    const a = apt({ complexJeonseRate: 72, complexJeonseN: 5, complexSaleN: 8 });
    render(<PricePositionBox priceCat={undefined} apt={a} />);
    expect(screen.getByTestId("price-source").textContent).toBe(PRICE_SOURCE_TEXT);
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

// ── 세션661 실거래 범위 — 「범위 + 가운데 값 작게」(사장님 결정 ①⑥⑦ · 설계서 v2 §4-1) ──────────
describe("실거래 범위 — 범위 있을 때 줄 구성 · 없을 때 옛 구성 (세션661)", () => {
  const RANGE = { cmpMin: 45000, cmpMax: 52000 };
  const T1R = { ...T1_SALE, ...RANGE, cmpN: 13 };

  it("범위 있음 — 줄 순서 price · range · median · gap · jeonseRange · jeonse, 가운데 값만 small · range 에 sub", () => {
    const a = apt({
      ...T1R,
      complexJeonseMin: 31000,
      complexJeonseMax: 36000,
      complexJeonseN: 3,
      complexJeonseRate: 62.4,
      complexSaleN: 13,
    });
    const rows = compareRows(a, cat("complex", "12.5"));
    expect(rows.map((r) => r.key)).toEqual(["price", "range", "median", "gap", "jeonseRange", "jeonse"]);
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by.range).toEqual({
      key: "range",
      label: "이 단지 실거래",
      value: "4억 5,000만 ~ 5억 2,000만",
      sub: "13건 · 최근 12개월",
    });
    expect(by.median).toEqual({ key: "median", label: "가운데 값", value: "4억 8,000만", small: true });
    expect(by.jeonseRange).toEqual({ key: "jeonseRange", label: "전세", value: "3억 1,000만 ~ 3억 6,000만 (3건)" });
    expect(rows.filter((r) => r.small).map((r) => r.key)).toEqual(["median"]);
    // 옛 중앙값 줄 이름("… 중앙값")은 범위 모드에 없다
    expect(rows.some((r) => r.label.endsWith("중앙값"))).toBe(false);
  });

  it("설계서 예시 — 58,000~64,200 · 13건 · 12개월 → 「5억 8,000만 ~ 6억 4,200만」 + 「13건 · 최근 12개월」", () => {
    const a = apt({ ...T1_SALE, cmpFairPrice: 61000, cmpMin: 58000, cmpMax: 64200, cmpN: 13 });
    const r = compareRows(a, cat("complex", "5", 61000)).find((x) => x.key === "range");
    expect([r?.value, r?.sub]).toEqual(["5억 8,000만 ~ 6억 4,200만", "13건 · 최근 12개월"]);
  });

  it("㎡당 환산이면 sub 끝에 「 · ㎡당 환산」", () => {
    const a = apt({ ...T1R, cmpAreaMode: "per_m2" });
    expect(compareRows(a, cat("complex", "12.5")).find((r) => r.key === "range")?.sub).toBe(
      "13건 · 최근 12개월 · ㎡당 환산"
    );
  });

  it("범위 없음(반영 전 · null · undefined) — 지금 줄 구성 그대로(중앙값 큰 글씨, 범위·막대·전세 범위 없음)", () => {
    for (const r of [{}, { cmpMin: null, cmpMax: null }, { cmpMin: 45000, cmpMax: null }]) {
      const a = apt({ ...T1_SALE, ...r, complexJeonseMin: 31000, complexJeonseMax: 36000 });
      const rows = compareRows(a, cat("complex", "12.5"));
      expect(rows.map((x) => x.key)).toEqual(["price", "median", "gap"]);
      expect(rows[1]).toEqual({
        key: "median",
        label: "이 단지 실거래 중앙값",
        value: "4억 8,000만 (7건 · 최근 12개월)",
      });
      expect(rangeBar(a)).toBeNull();
    }
  });

  it("반대 방향 — 범위 none 이면 cmpMin·cmpMax 가 있어도 범위 줄·막대 없음", () => {
    const a = apt({ ...T3, price: 42000, cmpMin: 45000, cmpMax: 52000 });
    expect(compareRows(a, cat("none", "0", 0)).map((r) => r.key)).toEqual([]);
    expect(rangeBar(a)).toBeNull();
    const { container } = render(<PricePositionBox priceCat={cat("none", "0", 0)} apt={a} />);
    expect(container.querySelector('[data-row="range"]')).toBeNull();
    expect(screen.queryByTestId("price-range-bar")).toBeNull();
  });

  it("전세 범위 줄 — 둘 다 유한수일 때만 · 같은 동 또래 상자에서는 「이 단지 전세」", () => {
    const one = apt({ ...T1R, complexJeonseMin: 31000, complexJeonseMax: null });
    expect(compareRows(one, cat("complex", "12.5")).some((r) => r.key === "jeonseRange")).toBe(false);
    const t2 = apt({
      ...T2,
      cmpMin: 49000,
      cmpMax: 56000,
      complexJeonseMin: 30000,
      complexJeonseMax: 30000,
      complexJeonseN: 1,
    });
    const jr = compareRows(t2, cat("dong_peer", "3")).find((r) => r.key === "jeonseRange");
    expect(jr).toEqual({ key: "jeonseRange", label: "이 단지 전세", value: "3억 (1건)" });
    expect(compareRows(t2, cat("dong_peer", "3")).find((r) => r.key === "range")?.label).toBe("같은 동 또래 실거래");
  });

  it("렌더 — data-row range·median 과 sub 줄 · 막대 data-testid · 판정어 없음", () => {
    const a = apt({ ...T1R, price: 47000 });
    const { container } = render(<PricePositionBox priceCat={cat("complex", "2.1")} apt={a} />);
    const range = container.querySelector('[data-row="range"]');
    expect(range?.textContent).toBe("이 단지 실거래4억 5,000만 ~ 5억 2,000만");
    expect(range?.textContent).toContain(" ~ ");
    expect(container.querySelector('[data-row-sub="range"]')?.textContent).toBe("13건 · 최근 12개월");
    expect(container.querySelector('[data-row="median"]')?.textContent).toBe("가운데 값4억 8,000만");
    expect(screen.getByTestId("price-range-bar")).toBeTruthy();
    expect(container.textContent).not.toMatch(JUDGE_WORDS);
  });
});

describe("실거래 범위 막대 — 위치 · 끝 고정 · 최저=최고 (세션661 · 사장님 결정 ⑦)", () => {
  const T1R = { ...T1_SALE, cmpMin: 45000, cmpMax: 52000 };

  it("범위 안 — 분양가 자리 비율(%) · clamped 없음 · aria 문장", () => {
    const b = rangeBar(apt({ ...T1R, price: 47000 }));
    expect(b?.clamped).toBeNull();
    expect(b?.pos).toBeCloseTo(((47000 - 45000) / 7000) * 100, 6);
    expect(b?.aria).toBe("실거래 최저 4억 5,000만 ~ 최고 5억 2,000만, 분양가 4억 7,000만");
  });

  it("범위 밖 — 끝에 붙이고(0 · 100) 화면 글자 없음", () => {
    const low = rangeBar(apt({ ...T1R, price: 42000 }));
    expect([low?.pos, low?.clamped]).toEqual([0, "low"]);
    const high = rangeBar(apt({ ...T1R, price: 60000 }));
    expect([high?.pos, high?.clamped]).toEqual([100, "high"]);
    const { container } = render(
      <PricePositionBox priceCat={cat("complex", "12.5")} apt={apt({ ...T1R, price: 42000 })} />
    );
    const bar = screen.getByTestId("price-range-bar");
    expect(bar.getAttribute("data-clamped")).toBe("low");
    expect(bar.textContent).toBe(""); // 막대에는 글자를 쓰지 않는다(보조기기용 aria-label 만)
    expect(bar.getAttribute("aria-label")).toContain("분양가 4억 2,000만");
    expect((container.querySelector('[data-part="price-dot"]') as HTMLElement | null)?.style.left).toBe("0%");
  });

  it("최저 = 최고 — 막대 없음(0÷0) · 범위 줄은 값 하나", () => {
    const a = apt({ ...T1_SALE, cmpMin: 48000, cmpMax: 48000 });
    expect(rangeBar(a)).toBeNull();
    expect(compareRows(a, cat("complex", "12.5")).find((r) => r.key === "range")?.value).toBe("4억 8,000만");
    render(<PricePositionBox priceCat={cat("complex", "12.5")} apt={a} />);
    expect(screen.queryByTestId("price-range-bar")).toBeNull();
  });

  it("분양가 모름 — 막대 없음", () => {
    expect(rangeBar(apt({ ...T1R, price: null }))).toBeNull();
  });
});

describe("같은 동 또래 + 범위 — 동네 사실 줄 가격 토막 없음(건수·연식만, 사장님 결정 ⑥)", () => {
  it("dong_peer + 범위 있음 → price null · 건수·연식은 남는다", () => {
    const parts = dongFactParts(apt({ ...T2, cmpMin: 49000, cmpMax: 56000, completion: "202401", dongFact: DONG }));
    expect(parts?.price).toBeNull();
    expect(parts?.count).toBe("같은 동·같은 평수 실거래 4건");
    expect(parts?.year).toBe("1996~2004년에 지은 집 (이 단지보다 약 22년 오래됨)");
  });

  it("dong_peer + 범위 없음 · none → 가격 토막 그대로", () => {
    expect(dongFactParts(apt({ ...T2, dongFact: DONG }))?.price).toBe("최저 3억 ~ 최고 4억 1,000만");
    expect(dongFactParts(apt({ ...T3, cmpMin: 49000, cmpMax: 56000, dongFact: DONG }))?.price).toBe(
      "최저 3억 ~ 최고 4억 1,000만"
    );
  });
});
