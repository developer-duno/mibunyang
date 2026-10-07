import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PricePositionBox, scopeHeadText, dongFactParts, complexJeonseText, effectiveScope } from "./PricePositionBox";
import type { Apt } from "@/types/scoring";

/**
 * 시세 탭 맨 위 상자 — 머리 줄(범위) · 적정가 눈금 · 동네 사실 줄 · 같은 단지 전세가율 (세션589 · 세션609 라).
 *
 * 적정가 눈금의 위치·색·게이트는 `DetailModal.test.jsx` "적정가 대비 위치 게이지" 묶음이 모달 경유로 지킨다
 * (그 픽스처에는 새 칸이 없다 = 옛 JSON 경로). 여기는 **새 칸(cmpScope 등)이 있을 때의 문장**을 본다.
 *
 * ⚠️ 기대 문장은 **리터럴**로 적는다 — 상수에서 읽어 비교하면 상수가 바뀔 때 같이 따라가 아무것도 못 잡는다
 *    (.claude/rules/meta/guards-must-be-mutation-tested.md "파생 가드"). 설계서 §8 "범위 문구 = cmp_scope 와 일치(시험)".
 */

const apt = (over: Record<string, unknown> = {}) => ({ id: "t", name: "t", ...over }) as unknown as Apt;

/** 같은 범위로 계산된 점수 캐시(재계산 뒤) */
const cat = (scope: "complex" | "dong_peer" | "none", deviation: string, fairPrice = 48000) => ({
  fairPrice,
  deviation,
  fairPriceScope: scope,
});

const T1_SALE = {
  cmpScope: "complex",
  cmpFairPrice: 48000,
  cmpN: 7,
  cmpMonths: 12,
  cmpAreaMode: "same_area",
  cmpSrc: "sale",
};
const T1_PRESALE = { ...T1_SALE, cmpSrc: "presale", cmpN: 4 };
const T2 = {
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

describe("머리 줄 — cmpScope 와 일치하는 문장 (§5-4 · §8)", () => {
  it("T1 매매: 이 단지 실거래 N건 (최근 12개월) 기준 — 적정가 X, 분양가는 Y% 저렴", () => {
    expect(scopeHeadText(apt(T1_SALE), cat("complex", "12.4"))).toBe(
      "이 단지 실거래 7건 (최근 12개월) 기준 — 적정가 4억 8,000만, 분양가는 12% 저렴"
    );
  });

  it("T1 분양권: 이 단지 분양권 거래 N건 (최근 12개월) 기준 …", () => {
    expect(scopeHeadText(apt(T1_PRESALE), cat("complex", "-15.6"))).toBe(
      "이 단지 분양권 거래 4건 (최근 12개월) 기준 — 적정가 4억 8,000만, 분양가는 16% 비쌈"
    );
  });

  it("T2: 같은 동 비슷한 연식(±10년)·같은 평수 실거래 N건 기준 …", () => {
    expect(scopeHeadText(apt(T2), cat("dong_peer", "3.0", 52000))).toBe(
      "같은 동 비슷한 연식(±10년)·같은 평수 실거래 5건 기준 — 적정가 5억 2,000만, 분양가는 적정가 수준"
    );
  });

  it("T3: 비교할 실거래가 아직 없어요", () => {
    expect(scopeHeadText(apt(T3), cat("none", "0.0", 0))).toBe("비교할 실거래가 아직 없어요");
  });

  it("cmpScope 가 undefined(옛 캐시·옛 JSON) 면 머리 줄이 없다 — 상자는 옛 모양(적정가 대비 위치)", () => {
    expect(scopeHeadText(apt(), cat("complex", "12.4"))).toBeNull();
    render(<PricePositionBox priceCat={{ fairPrice: 48000, deviation: "12.4" }} apt={apt()} />);
    expect(screen.queryByTestId("price-scope-head")).toBeNull();
    expect(screen.getByText("적정가 대비 위치")).toBeTruthy(); // 양성 앵커 — 옛 경로는 그대로 그린다
  });

  it("cmpScope 가 null(trade_stats 행 없음) 이어도 '거래 없음' 이라 말하지 않는다", () => {
    expect(scopeHeadText(apt({ cmpScope: null }), undefined)).toBeNull();
    expect(effectiveScope(apt({ cmpScope: null }))).toBeNull();
  });

  it("범위가 complex 여도 적정가가 없으면 T3 문장 — 점수(scorePrice)와 같은 판정", () => {
    expect(scopeHeadText(apt({ ...T1_SALE, cmpFairPrice: 0 }), undefined)).toBe("비교할 실거래가 아직 없어요");
  });

  it("중립대 경계(±10%)는 '적정가 수준' — 카드 칩과 같은 경계", () => {
    expect(scopeHeadText(apt(T1_SALE), cat("complex", "10.0"))).toMatch(/분양가는 적정가 수준$/);
    expect(scopeHeadText(apt(T1_SALE), cat("complex", "10.1"))).toMatch(/분양가는 10% 저렴$/);
    expect(scopeHeadText(apt(T1_SALE), cat("complex", "-10.1"))).toMatch(/분양가는 10% 비쌈$/);
  });

  it("기간은 cmpMonths 값으로 적는다 (12 를 손으로 박지 않는다)", () => {
    expect(scopeHeadText(apt({ ...T1_SALE, cmpMonths: 6 }), undefined)).toBe(
      "이 단지 실거래 7건 (최근 6개월) 기준 — 적정가 4억 8,000만"
    );
  });

  it("㎡당 환산이면 그 사실을 붙인다", () => {
    expect(scopeHeadText(apt({ ...T1_SALE, cmpAreaMode: "per_m2" }), undefined)).toBe(
      "이 단지 실거래 7건 (최근 12개월) 기준 (면적 20㎡ 이내 ㎡당 환산) — 적정가 4억 8,000만"
    );
  });

  it("점수 캐시가 다른 범위(재계산 전)면 분양가 비교 토막과 눈금을 비운다", () => {
    const old = { fairPrice: 50000, deviation: "25.0" }; // fairPriceScope 없음 = 전환 전 캐시
    expect(scopeHeadText(apt(T1_SALE), old)).toBe("이 단지 실거래 7건 (최근 12개월) 기준 — 적정가 4억 8,000만");
    const { container } = render(<PricePositionBox priceCat={old} apt={apt(T1_SALE)} />);
    expect(container.textContent).not.toContain("25% 저렴");
    expect(container.textContent).not.toContain("비쌈"); // 눈금 왼쪽 끝 글자도 없다
  });
});

describe("상자 — 머리 줄과 눈금", () => {
  it("T1 매매: 머리 줄이 맨 위, 그 아래 작은 제목 '적정가 대비 위치' 와 눈금", () => {
    const { container } = render(<PricePositionBox priceCat={cat("complex", "12.4")} apt={apt(T1_SALE)} />);
    const head = screen.getByTestId("price-scope-head");
    expect(head.textContent).toContain("이 단지 실거래 7건");
    const sub = screen.getByText("적정가 대비 위치");
    // 머리 줄이 먼저(문서 순서) — 작은 제목은 머리 줄보다 글자가 작다
    expect(head.compareDocumentPosition(sub) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(sub.style.fontWeight).toBe("600");
    expect(container.textContent).toContain("+12% 저렴"); // 눈금 가운데 글자
  });

  it("T3: 눈금 없이 머리 줄만", () => {
    const { container } = render(<PricePositionBox priceCat={cat("none", "0.0", 0)} apt={apt(T3)} />);
    expect(screen.getByTestId("price-scope-head").textContent).toBe("비교할 실거래가 아직 없어요");
    expect(container.textContent).not.toContain("저렴");
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

describe("같은 단지 전세가율 (R3)", () => {
  it("값이 있으면 '이 단지 전세 N건 ÷ 매매 M건'", () => {
    const a = apt({ ...T1_SALE, complexJeonseRate: 62.37, complexJeonseN: 5, complexSaleN: 7 });
    expect(complexJeonseText(a)).toBe("전세가율 62.4% · 이 단지 전세 5건 ÷ 매매 7건");
    render(<PricePositionBox priceCat={cat("complex", "12.4")} apt={a} />);
    expect(screen.getByTestId("complex-jeonse").textContent).toBe("전세가율 62.4% · 이 단지 전세 5건 ÷ 매매 7건");
  });

  it("값이 없으면 칸 자체를 안 그린다 — 옛 구 전세가율(jeonseRate)로 대신하지 않는다", () => {
    const a = apt({ ...T1_SALE, complexJeonseRate: null, jeonseRate: 71 });
    expect(complexJeonseText(a)).toBeNull();
    const { container } = render(<PricePositionBox priceCat={cat("complex", "12.4")} apt={a} />);
    expect(screen.queryByTestId("complex-jeonse")).toBeNull();
    expect(container.textContent).not.toContain("전세가율");
  });
});
