// @ts-check
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AdminScoreBreakdown } from "./AdminScoreBreakdown";
import { makeScoredItem } from "@/__tests__/factories";
import { getAgeCoeff } from "@/scoring/engine";
import { BRAND_TIER, resolveBuilder } from "@/constants/brands";

// 세션 405: 구 ExpertScoreBreakdown.test + ExpertScoreSummary.test 단언 이식 (전문가 대시보드 폐지·관리자 이식)

describe("AdminScoreBreakdown", () => {
  // ── 구 ExpertScoreBreakdown 단언 ──
  it("적정가 산출 과정을 표시한다", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem({ nearbyMedian: 55000, price: 50000 }));
    render(<AdminScoreBreakdown apt={apt} res={res} profile="live" />);
    expect(screen.getByText("적정가 산출 과정")).toBeTruthy();
    expect(screen.getByText(/주변중위가/)).toBeTruthy();
    expect(screen.getByText(/연식계수/)).toBeTruthy();
    expect(screen.getByText(/면적보정/)).toBeTruthy();
    expect(screen.getByText(/브랜드보정/)).toBeTruthy();
  });

  /**
   * 세션528 결함B 처방 — 미준공(분양 예정) 단지는 "연식계수"가 아니라 "신축 프리미엄" 라벨이어야
   * 정직하다(같은 ageCoeff 값이 이제 두 가지 다른 현상을 나타내므로, brands.ts 주석 참조).
   * 적대검증(세션528)이 잡은 가드 갭: 팩토리 기본 completion(2025-06-01)이 과거로 고정돼 있어
   * 위 테스트는 항상 "연식계수" 분기만 지나고, presale=true 분기(신축 프리미엄)는 이 파일의
   * 어떤 테스트도 렌더하지 않아 그 분기를 지워도 전체 테스트가 초록불을 유지했다.
   */
  it("미준공(분양 예정) 단지는 '신축 프리미엄' 라벨을 표시한다 (연식계수 아님)", () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1); // 실행 시점 기준 상대값 — 하드코딩 날짜 금지
    const { apt, res } = /** @type {any} */ (makeScoredItem({ completion: future.toISOString().slice(0, 10) }));
    render(<AdminScoreBreakdown apt={apt} res={res} profile="live" />);
    expect(screen.getByText(/신축 프리미엄/)).toBeTruthy();
    expect(screen.queryByText(/^×\s*연식계수/)).toBeNull();
  });

  it("준공된 단지는 '연식계수' 라벨을 표시한다 (신축 프리미엄 아님)", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem({ completion: "2020-01-01" }));
    render(<AdminScoreBreakdown apt={apt} res={res} profile="live" />);
    expect(screen.getByText(/연식계수/)).toBeTruthy();
    expect(screen.queryByText(/신축 프리미엄/)).toBeNull();
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

  it("nearbyMedian이 0이면 괴리도 N/A로 표시된다", () => {
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

  it("버킷 경로면 '평형별 실거래' 로 설명하고 면적보정 줄을 감춘다", () => {
    const { apt, res } = /** @type {any} */ (makeScoredItem({ nearbyMedian: 55000, price: 50000, area: 100 }));
    res.cats.price.fairPrice = 200000;
    res.cats.price.deviation = "10.0";
    res.cats.price.fairPriceFromAreaBucket = true;
    render(<AdminScoreBreakdown apt={apt} res={res} profile="live" />);
    expect(screen.getByText(/평형별 실거래/)).toBeTruthy();
    // 버킷은 이미 그 평형대 실거래라 면적보정을 곱하지 않는다 — 그 줄이 뜨면 거짓 설명이 된다.
    expect(screen.queryByText(/면적보정/)).toBeNull();
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
 * 세션529: **운영 실제 형식(대시 없는 "YYYYMM")** 으로 라벨 분기를 검사한다.
 *
 * ⚠️ 위 세션528 테스트들은 completion 을 전부 `"2020-01-01"` 같은 대시 형식으로 넣는데,
 * 그 형식은 **운영 DB 에 0건**이다(2026-08-24 실측 `apartments_flat` 2,227행: YYYYMM 1,802 ·
 * 빈값 374 · 비정형 51 · 대시 0). 세션529가 고친 결함이 정확히 "가드는 있는데 넣은 값이
 * 실전 형식이 아니라 결함 분기를 안 지났다"는 것이었으므로(`guards-must-be-mutation-tested.md`
 * §"테스트가 실제 경로를 지나는가"), 같은 씨앗을 여기서 뽑는다.
 *
 * 날짜는 **실행 시점 상대값**으로 만든다 — 고정 YYYYMM 을 박으면 그 달이 지나는 순간
 * 경계 케이스가 조용히 다른 뜻이 된다(`timezone-consistency.md` §4).
 */
describe("AdminScoreBreakdown — 운영 실제 형식(YYYYMM) 라벨 분기", () => {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  /** @param {number} y @param {number} m */
  const ym = (y, m) => `${y}${String(m).padStart(2, "0")}`;
  const Y = kst.getUTCFullYear();
  const M = kst.getUTCMonth() + 1;
  const thisMonth = ym(Y, M);
  const lastMonth = M === 1 ? ym(Y - 1, 12) : ym(Y, M - 1);
  const future = ym(Y + 2, M);
  const old6y = ym(Y - 6, M);

  /** 화면에 실제로 찍힌 "× <라벨>: <값>" 을 뽑는다. */
  /** @param {string | null | undefined} completion */
  const readCoeffRow = (completion) => {
    const { apt, res } = /** @type {any} */ (makeScoredItem({ completion, nearbyMedian: 55000, price: 50000 }));
    const { container } = render(<AdminScoreBreakdown apt={apt} res={res} profile="live" />);
    const m = (container.textContent ?? "").match(/×\s*(신축 프리미엄|연식계수)\s*:\s*([\d.]+)/);
    return m ? { label: m[1], value: m[2] } : null;
  };

  it.each([
    [() => future, "신축 프리미엄", "2년 뒤 예정 = 미준공"],
    [() => thisMonth, "신축 프리미엄", "이번 달 준공 — 화면(classify.ts `>= NOW_YM`)과 같은 경계라 '입주예정' 쪽"],
    [() => lastMonth, "연식계수", "지난 달 준공 = 준공완료 (경계 바로 아래)"],
    [() => old6y, "연식계수", "6년 전 준공"],
    [() => "미정", "연식계수", "비정형 — 미상(중립)으로 빠진다"],
    [() => "", "연식계수", "빈값 — 미상(중립)으로 빠진다"],
  ])("%s → %s 라벨 (%s)", (getComp, expectedLabel) => {
    const row = readCoeffRow(getComp());
    expect(row).not.toBeNull();
    expect(row?.label).toBe(expectedLabel);
  });

  it("화면은 엔진의 계수를 그대로 표시한다 (역산·재계산하지 않는다)", () => {
    for (const comp of [future, thisMonth, lastMonth, old6y, "미정", ""]) {
      const row = readCoeffRow(comp);
      expect(row?.value).toBe(getAgeCoeff(comp).toFixed(2));
    }
  });

  it("이번 달과 지난 달은 서로 다른 라벨로 갈린다 (경계가 한 칸이라도 밀리면 red)", () => {
    expect(readCoeffRow(thisMonth)?.label).toBe("신축 프리미엄");
    expect(readCoeffRow(lastMonth)?.label).toBe("연식계수");
  });

  /**
   * 세션529 적대검증: 이 패널이 `BRAND_TIER[apt.builder]` 를 **직조회**해서, 법인 표기를 쓰는
   * 단지에서 화면 곱셈이 바로 밑 "= 적정가" 와 안 맞았다(운영 2,227곳 중 **50곳** — 예:
   * "지에스건설(주)" 화면 1.00 vs 엔진 1.05). 엔진은 `resolveBuilder` 를 거친다.
   * 세션513이 `scorePrice` 에서 고친 것과 같은 결함 — 정규화는 `builder` 를 읽는 **모든 자리**에서.
   */
  it("브랜드보정이 엔진과 같은 값이다 — 법인 표기도 정규화해서 조회한다", () => {
    // 별칭이 필요한 실제 표기(운영 DB 실측). 직조회하면 1.00 으로 떨어진다.
    const { apt, res } = /** @type {any} */ (makeScoredItem({ builder: "지에스건설(주)" }));
    render(<AdminScoreBreakdown apt={apt} res={res} profile="live" />);
    const expected = BRAND_TIER[resolveBuilder("지에스건설(주)")]?.adj ?? 1.0;
    expect(expected).toBeGreaterThan(1.0); // 별칭 해석이 실제로 필요한 표기인지 먼저 잠근다
    expect(screen.getByText(new RegExp(`브랜드보정`))).toBeTruthy();
    const shown = screen.getByText(expected.toFixed(2));
    expect(shown).toBeTruthy();
  });
});
