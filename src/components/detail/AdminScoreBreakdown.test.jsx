// @ts-check
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AdminScoreBreakdown } from "./AdminScoreBreakdown";
import { makeScoredItem } from "@/__tests__/factories";

// 세션 405: 구 ExpertScoreBreakdown.test + ExpertScoreSummary.test 단언 이식 (전문가 대시보드 폐지·관리자 이식)

describe("AdminScoreBreakdown", () => {
  // ── 구 ExpertScoreBreakdown 단언 ──
  // 세션607(시세 비교 범위 좁히기 다): 옛 단언 = "주변중위가 × 연식계수(미준공은 '신축 프리미엄') × 면적보정 ×
  //   브랜드보정" 줄이 보인다(세션405·528). 적정가가 같은 단지·같은 동 또래 실거래라 계수를 곱하지 않게 되어
  //   (설계서 D8·R5) 그 줄은 거짓이 된다 → 엔진이 준 비교 범위·건수를 보여 주고 계수 줄은 없다.
  it("적정가 산출 과정 = 비교 범위·건수·기간, 계수 곱셈 줄은 없다", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem({ price: 50000, cmpMonths: 12 }));
    res.cats.price.fairPriceN = 7;
    render(<AdminScoreBreakdown apt={apt} res={res} profile="live" />);
    expect(screen.getByText("적정가 산출 과정")).toBeTruthy();
    expect(screen.getByText("이 단지 실거래")).toBeTruthy();
    expect(screen.getByText("7건 · 최근 12개월")).toBeTruthy();
    expect(screen.getByText(/보정 계수: 없음/)).toBeTruthy();
    for (const old of [/주변중위가/, /연식계수/, /신축 프리미엄/, /면적보정/, /브랜드보정/]) {
      expect(screen.queryByText(old)).toBeNull();
    }
  });

  it.each([
    [{ fairPriceScope: "complex", fairPriceSrc: "presale" }, "이 단지 분양권 거래"],
    [{ fairPriceScope: "dong_peer", fairPriceSrc: "sale" }, "같은 동 비슷한 연식(±10년)·같은 평수 실거래"],
    [{ fairPriceScope: "none", fairPriceSrc: null }, "비교할 실거래 없음 (괴리도 중립)"],
  ])("범위 %o → '%s'", (scopeRes, label) => {
    const { apt, res } = /** @type {any} */ (makeScoredItem());
    Object.assign(res.cats.price, scopeRes);
    render(<AdminScoreBreakdown apt={apt} res={res} profile="live" />);
    expect(screen.getByText(label)).toBeTruthy();
  });

  it("세션607 보완(B1) — 범위 칸이 아예 없으면(옛 점수 캐시) '갱신 전'으로 알리고 '실거래 없음'과 섞지 않는다", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem());
    delete res.cats.price.fairPriceScope;
    delete res.cats.price.fairPriceSrc;
    render(<AdminScoreBreakdown apt={apt} res={res} profile="live" />);
    expect(screen.getByText("점수 캐시 갱신 전 (03:00 재계산 뒤 표시)")).toBeTruthy();
    expect(screen.queryByText(/비교할 실거래 없음/)).toBeNull();
  });

  it("범위 none 이면 건수·기간 줄을 그리지 않는다", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem());
    res.cats.price.fairPriceScope = "none";
    render(<AdminScoreBreakdown apt={apt} res={res} profile="live" />);
    expect(screen.queryByText(/건수·기간/)).toBeNull();
  });

  it("6개 카테고리 섹션의 총점을 표시한다", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem());
    render(<AdminScoreBreakdown apt={apt} res={res} profile="live" />);
    const totalLabels = screen.getAllByText(/총점:/);
    expect(totalLabels.length).toBe(6);
  });

  it("서브항목 테이블 헤더를 표시한다", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem());
    render(<AdminScoreBreakdown apt={apt} res={res} profile="live" />);
    const subHeaders = screen.getAllByText("서브항목");
    expect(subHeaders.length).toBeGreaterThan(0);
  });

  it("프로필에 따른 가중치를 표시한다", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem());
    render(<AdminScoreBreakdown apt={apt} res={res} profile="live" />);
    // live 프로필: location=45% (2026-08-11: benefit 5 → location 재분배, constants/profiles.ts)
    expect(screen.getByText(/프로필 가중치: 45%/)).toBeTruthy();
  });

  it("엔진 fairPrice 가 0(판정 못 함)이면 괴리도 N/A로 표시된다", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem({ nearbyMedian: 0 }));
    render(<AdminScoreBreakdown apt={apt} res={res} profile="live" />);
    expect(screen.getByText(/괴리도 N\/A%/)).toBeTruthy();
  });

  /**
   * 세션527 적대검증 회귀 가드 — 이 화면은 **엔진이 계산한 fairPrice/deviation 을 그대로 써야 한다.**
   * 옛 코드는 `nearbyMedian × ageCoeff × areaAdj × brand` 로 자체 재계산했는데, fairPrice 1순위가
   * 평형별 실거래 버킷 매칭으로 바뀐 뒤 **같은 모달에 서로 다른 괴리율 두 개**가 떴다.
   * ⚠️ 이 가드가 없으면 화면이 자체 재계산으로 되돌아가도 초록불이다(세션508·512 함정).
   */
  it("엔진이 준 fairPrice·deviation 을 그대로 표시한다 (자체 재계산 금지)", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem({ nearbyMedian: 55000, price: 50000 }));
    // 엔진 값이 자체 재계산 결과(55000×보정)와 확연히 다르게 되도록 일부러 멀리 둔다.
    res.cats.price.fairPrice = 999000;
    res.cats.price.deviation = "-88.8";
    render(<AdminScoreBreakdown apt={apt} res={res} profile="live" />);
    expect(screen.getByText(/999,000만원/)).toBeTruthy();
    expect(screen.getByText(/괴리도 -88\.8%/)).toBeTruthy();
  });

  // 세션607: 옛 "버킷 경로면 '평형별 실거래' 로 설명하고 면적보정 줄을 감춘다" 는 버킷 경로 삭제로 대상이 없어졌다.
  it("㎡당 환산(per_m2)이면 그 방식을 밝힌다 — 같은 평수 거래가 모자라 넓힌 값", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem({ area: 100, cmpAreaMode: "per_m2", cmpMonths: 12 }));
    render(<AdminScoreBreakdown apt={apt} res={res} profile="live" />);
    expect(screen.getByText(/면적 20㎡ 이내 ㎡당 환산 × 100㎡/)).toBeTruthy();
  });

  it("존재하지 않는 프로필이면 크래시 없이 렌더링한다", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem());
    expect(() =>
      render(<AdminScoreBreakdown apt={apt} res={res} profile={/** @type {any} */ ("unknown")} />)
    ).not.toThrow();
  });

  it("기여도(점수 x 가중치)를 올바르게 표시한다", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem());
    render(<AdminScoreBreakdown apt={apt} res={res} profile="live" />);
    const contributions = screen.getAllByText(/\d+\.\d+점/);
    expect(contributions.length).toBeGreaterThan(0);
  });

  // ── 구 ExpertScoreSummary 단언 ──
  it("최종 가중 합계 제목을 프로필명과 함께 표시한다", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem());
    render(<AdminScoreBreakdown apt={apt} res={res} profile="live" />);
    expect(screen.getByText(/최종 가중 합계.*실거주/)).toBeTruthy();
  });

  it("합계 행에 100%가 표시된다", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem());
    render(<AdminScoreBreakdown apt={apt} res={res} profile="live" />);
    expect(screen.getByText("합계")).toBeTruthy();
    expect(screen.getByText("100%")).toBeTruthy();
  });

  it("총점과 등급을 표시한다", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem({}, { total: 85 }));
    render(<AdminScoreBreakdown apt={apt} res={res} profile="live" />);
    // 합본 컴포넌트라 카테고리 총점 표("총점: 85점")와 합계 행("85점 (A)")이 공존 가능 — 복수 허용
    expect(screen.getAllByText(/85점/).length).toBeGreaterThanOrEqual(1);
  });

  it("투자 프로필 가중치를 반영한다", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem());
    render(<AdminScoreBreakdown apt={apt} res={res} profile="invest" />);
    expect(screen.getByText(/투자/)).toBeTruthy();
  });

  // ── 세션 405 신규: 도시등급(구 ExpertAptHeader) + 인쇄 + profile 기본값 ──
  it("도시등급을 표시한다 (구 전문가 헤더 이식)", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem());
    render(<AdminScoreBreakdown apt={apt} res={res} profile="live" />);
    expect(screen.getByText(/도시등급:/)).toBeTruthy();
  });

  it("인쇄 버튼이 렌더링된다 (data-no-print)", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem());
    render(<AdminScoreBreakdown apt={apt} res={res} profile="live" />);
    const printBtn = screen.getByRole("button", { name: "분석 결과 인쇄" });
    expect(printBtn).toBeTruthy();
    expect(printBtn.getAttribute("data-no-print")).not.toBeNull();
  });

  it("profile 미전달 시 live 폴백으로 렌더링한다", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem());
    render(<AdminScoreBreakdown apt={apt} res={res} />);
    expect(screen.getByText(/최종 가중 합계.*실거주/)).toBeTruthy();
  });

  /**
   * 세션534 PR-2 후속(적대검증이 찾은 놓친 자리) — 적정가 요약줄의 색·배경·문구가 **부호 단독**
   * (적정가 > 단지가면 무조건 저평가·초록)이 아니라 **±DEV_NEUTRAL_BAND_PCT 중립대 3분기**여야 한다.
   * DetailModal SC0 와 같은 규칙(같은 상수). 추정 오차보다 작은 차이로 "저평가/고평가"를 단정하지 않는다.
   *
   * ⚠️ 색만 밴드로 바꾸고 문구를 부호로 두면 "색=중립인데 문구=저평가" 모순이 생긴다 —
   * 색·배경·문구 셋을 하나의 tone 에서 파생하는지 함께 잠근다.
   * 실제 렌더 경로(render + DOM 색 조회)를 지난다 — 순수 계산만 테스트하지 않는다.
   */
  describe("AdminScoreBreakdown — 적정가 요약줄 중립대 3분기 색·문구 (SC0 답습)", () => {
    // jsdom 은 hex → rgb 로 정규화한다. C.green #16A34A / C.red #DC2626 / C.muted #6B7280 /
    // C.greenLight #EDFCF2 / C.redLight #FEF2F2 / C.amberLight #FFF9EB.
    const GREEN = "rgb(22, 163, 74)";
    const RED = "rgb(220, 38, 38)";
    const MUTED = "rgb(107, 114, 128)";
    const GREEN_LIGHT = "rgb(237, 252, 242)";
    const RED_LIGHT = "rgb(254, 242, 242)";
    const AMBER_LIGHT = "rgb(255, 249, 235)";

    /** 적정가 요약줄(= 적정가 … | 괴리도 …) 엘리먼트를 찾는다. */
    /** @param {string | number} deviation @param {number} [fairPrice] */
    const summaryEl = (deviation, fairPrice = 200000) => {
      const { apt, res } = /** @type {any} */ (makeScoredItem({ nearbyMedian: 55000, price: 50000 }));
      res.cats.price.fairPrice = fairPrice;
      res.cats.price.deviation = String(deviation);
      const { container } = render(<AdminScoreBreakdown apt={apt} res={res} profile="live" />);
      const el = [...container.querySelectorAll("div")].find((d) => (d.textContent ?? "").startsWith("= 적정가"));
      return /** @type {HTMLElement} */ (el);
    };

    it("중립대 안(+3%)은 초록이 아니라 중립 — 색·배경·문구 셋 다 중립 (부호 단독이면 red)", () => {
      const el = summaryEl("3.0");
      expect(el.style.color).toBe(MUTED);
      expect(el.style.background).toBe(AMBER_LIGHT);
      expect(el.textContent).toContain("적정가 수준");
      expect(el.textContent).not.toContain("저평가");
    });

    it("중립대 안(-3%)도 빨강이 아니라 중립", () => {
      const el = summaryEl("-3.0");
      expect(el.style.color).toBe(MUTED);
      expect(el.style.background).toBe(AMBER_LIGHT);
      expect(el.textContent).toContain("적정가 수준");
      expect(el.textContent).not.toContain("고평가");
    });

    it("밴드 위(+15%)는 초록·저평가", () => {
      const el = summaryEl("15.0");
      expect(el.style.color).toBe(GREEN);
      expect(el.style.background).toBe(GREEN_LIGHT);
      expect(el.textContent).toContain("저평가");
    });

    it("밴드 아래(-15%)는 빨강·고평가", () => {
      const el = summaryEl("-15.0");
      expect(el.style.color).toBe(RED);
      expect(el.style.background).toBe(RED_LIGHT);
      expect(el.textContent).toContain("고평가");
    });

    it("fairPrice≤0(괴리도 N/A) 이면 부재를 초록/빨강으로 오표시하지 않고 중립", () => {
      const el = summaryEl("0.0", 0); // fairPrice=0 → devPct="N/A" → Number NaN → 중립
      expect(el.textContent).toContain("괴리도 N/A%");
      expect(el.style.color).toBe(MUTED);
      expect(el.style.background).toBe(AMBER_LIGHT);
      expect(el.textContent).toContain("적정가 수준");
    });
  });
});

/**
 * 세션607: 옛 블록 "운영 실제 형식(YYYYMM) 라벨 분기"(세션529 — 준공월에 따라 '신축 프리미엄'/'연식계수' 라벨,
 * 화면 계수 = getAgeCoeff, 브랜드보정 = resolveBuilder 정규화 값)는 적정가에 계수를 곱하지 않게 되어(설계서 D8·R5)
 * 대상이 없어졌다. 남는 뜻 = **어떤 준공월·시공사 표기에서도 계수 줄이 되살아나지 않는다**(실전 형식 YYYYMM 포함).
 */
describe("AdminScoreBreakdown — 계수 줄이 되살아나지 않는다 (세션607)", () => {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  /** @param {number} y @param {number} m */
  const ym = (y, m) => `${y}${String(m).padStart(2, "0")}`;
  const Y = kst.getUTCFullYear();
  const M = kst.getUTCMonth() + 1;

  it.each([[ym(Y + 2, M)], [ym(Y, M)], [ym(Y - 6, M)], ["미정"], [""]])("준공 %s → 계수 줄 없음", (completion) => {
    const { apt, res } = /** @type {any} */ (makeScoredItem({ completion, builder: "지에스건설(주)" }));
    const { container } = render(<AdminScoreBreakdown apt={apt} res={res} profile="live" />);
    expect(container.textContent ?? "").not.toMatch(/×\s*(신축 프리미엄|연식계수|면적보정|브랜드보정)/);
  });
});
