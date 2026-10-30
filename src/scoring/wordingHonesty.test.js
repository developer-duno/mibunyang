// @ts-check
//
// 엔진이 내는 `info`/`detail` 문구가 **실제로 잰 것**과 어긋나지 않는지 잠근다 (세션512 전수 조사).
//
// PR #393·#394 가 `subContext.ts`(판정표)를 고쳤다면 여기는 **엔진 쪽 문구**다. 둘은 별도 출처라
// 한쪽만 고치면 같은 거짓이 옆 파일에서 살아남는다 — 실제로 세션510이 `scoreFuture` 를 고쳤는데
// `subContext` 가 남아 704곳이 거짓을 읽고 있었다(.claude/rules/meta/score-meaning-and-wording-are-a-pair.md).
//
// ⚠️ 각 테스트는 **옛 문구가 돌아오면 red** 가 되도록 옛 문자열의 부재를 함께 단언한다.
//    통과만 보는 가드는 껍데기다(.claude/rules/meta/guards-must-be-mutation-tested.md).
import { describe, it, expect } from "vitest";
import { scoreBenefit, scoreLocation, scoreProduct, scoreRisk, calcCats } from "@/scoring/engine";
import { SCHOOL_GRADE_TIERS, schoolGradeLegend, DEV_BAND_LABEL } from "@/constants/scoringTiers";
import { SUB_CONTEXT } from "@/constants/subContext";
import { catVerdict } from "@/constants/catVerdict";
import { buildCardChips } from "@/constants/cardChips";
import { fmtPriceGap } from "@/lib/format";
import { scopeHeadText, compareRows, priceSourceText } from "@/components/detail/PricePositionBox";
import { computeDeviation, deviationAriaLabel } from "@/lib/deviation";
import { deviationSpec, formatDeviationValue } from "@/constants/deviationFields";
import { computeRegionalStats } from "@/scoring/regionalStats";

/** @param {Record<string, unknown>} o */
const apt = (o) => /** @type {any} */ (o);
/** @param {{subs: Array<{name: string, info?: string, detail?: string}>}} res @param {string} name */
const sub = (res, name) => res.subs.find((s) => s.name === name);

describe("엔진 문구 정직성 (세션512)", () => {
  describe("혜택 — 안 재본 것을 '없다'고 하지 않는다", () => {
    // 실측: 이 5종의 원본 필드는 정적 JSON 1,646곳 **전부 null** 이다.
    // ⚠️ **반드시 calcCats 를 지난다.** `sanitize` 가 discountPct·cashback·avgMaintenanceCost 를
    //    null→0 으로 눌러서, scoreBenefit 을 직접 부르는 테스트는 이 결함을 못 잡는다 —
    //    실제로 이 가드를 직접 호출로 썼을 때 green 인데 화면(실전 경로)에서는 "할인 없음"이 그대로
    //    나왔다. [[guards-must-be-mutation-tested]] §"테스트가 실제 경로를 지나는가".
    it("원본이 null 이면 '미수집' — calcCats(실전 경로)에서도 그렇다", () => {
      const cats = calcCats(apt({ id: 1, price: 50000, region: "경기" }), { regionMedians: {} });
      for (const name of ["분양가 할인", "중도금 무이자", "옵션 무상", "발코니 확장", "캐시백"]) {
        expect(sub(cats.benefit, name)?.detail).toBe("미수집");
        expect(sub(cats.benefit, name)?.detail).not.toMatch(/없음/); // 옛 문구로 되돌아가면 red
      }
      expect(sub(cats.benefit, "관리비 절감")?.detail).toBe("미수집");
    });

    it("확인된 0/false 일 때만 '없음'", () => {
      const r = scoreBenefit(
        apt({ price: 50000, discountPct: 0, loanFree: false, optionFree: false, balconyFree: false, cashback: 0 })
      );
      expect(sub(r, "분양가 할인")?.detail).toBe("할인 없음");
      expect(sub(r, "캐시백")?.detail).toBe("캐시백 없음");
    });

    // 합계 금액이 있는 548곳은 **전부** 관리비 절감 단독인데 화면은 "총 혜택"이라 불렀다.
    it("합계 라벨은 실제 구성에서 파생한다 — 단독이면 그 이름", () => {
      const one = scoreBenefit(apt({ price: 50000, _regionAvgMaint: 20, avgMaintenanceCost: 15 }));
      expect(one.wonSource).toBe("관리비 절감");
      const many = scoreBenefit(apt({ price: 50000, discountPct: 5, _regionAvgMaint: 20, avgMaintenanceCost: 15 }));
      expect(many.wonSource).toBe("혜택 합계");
      expect(scoreBenefit(apt({ price: 50000 })).wonSource).toBe("");
    });

    // ⚠️ 세션512 실측 — "관리비 비교 불가" 623곳 중 **561곳(90%)** 은 단지값도 지역 중앙값도
    //    있는데 단지가 더 비싸 절감이 0인 경우였다. 비교를 **했고 진 것**인데 "비교 불가"라
    //    부르면 잰 적 없다는 뜻이 된다.
    //    ⚠️ 반드시 calcCats 를 지난다 — `sanitize` 가 avgMaintenanceCost 를 null→0 으로 누르므로
    //    직접 호출 테스트는 `_noMaint` 분기를 실전과 다르게 본다([[guards-must-be-mutation-tested]]).
    describe("관리비 — '비교 불가'와 '비교해서 진 것'을 가른다", () => {
      /** @param {Record<string, unknown>} o @param {number|undefined} [maint] */
      const cats = (o, maint) =>
        calcCats(apt({ id: 1, price: 50000, region: "경기", ...o }), {
          regionMedians: maint == null ? {} : { 경기: { pir: 5, unsoldRate: 15, supplyRatio: 100, maint } },
        });
      /** @param {Record<string, unknown>} o @param {number} [maint] */
      const maintDetail = (o, maint) => sub(cats(o, maint).benefit, "관리비 절감")?.detail;

      it("원본이 null 이면 '미수집' — 비교 여부를 말하지 않는다", () => {
        expect(maintDetail({}, 20)).toBe("미수집");
      });

      it("단지값·지역 중앙값 둘 다 있고 단지가 더 비싸면 그렇게 말한다", () => {
        expect(maintDetail({ avgMaintenanceCost: 25 }, 20)).toBe("지역 중앙값보다 비쌈 (절감 없음)");
        // 옛 문구로 되돌리면 red — 561곳이 읽던 거짓
        expect(maintDetail({ avgMaintenanceCost: 25 }, 20)).not.toBe("관리비 비교 불가");
      });

      it("지역 중앙값과 같으면 '비쌈'이라 하지 않는다 (중앙값 = 어느 단지의 값)", () => {
        expect(maintDetail({ avgMaintenanceCost: 20 }, 20)).toBe("지역 중앙값과 같음 (절감 없음)");
        expect(maintDetail({ avgMaintenanceCost: 20 }, 20)).not.toMatch(/비쌈/);
      });

      it("지역 중앙값이 없으면 그때만 '비교 불가'", () => {
        expect(maintDetail({ avgMaintenanceCost: 25 })).toBe("관리비 비교 불가");
      });

      it("절감이 있으면 금액 문구 그대로 (점수·금액 무변경)", () => {
        const c = cats({ avgMaintenanceCost: 15 }, 20);
        expect(sub(c.benefit, "관리비 절감")?.detail).toMatch(/^연 ~60만원/);
        expect(c.benefit.totalWon).toBe(60);
      });
    });

    it("관리비 비교 기준은 중앙값이다 — '평균'이라 하지 않는다", () => {
      const r = scoreBenefit(apt({ price: 50000, _regionAvgMaint: 20, avgMaintenanceCost: 15 }));
      expect(sub(r, "관리비 절감")?.detail).toMatch(/중앙값/);
      expect(sub(r, "관리비 절감")?.detail).not.toMatch(/지역 평균/);
    });
  });

  describe("학군 — 등급은 점수에서 파생된다", () => {
    // 등급 경계는 `SCHOOL_GRADE_TIERS` 에서 파생된다. "B=80점" 대응은 성립 불가.
    // ⚠️ 기대값을 숫자로 적지 않는다 — 세션524에 경계가 80/60/40 → 90/60/20 으로 바뀌었고,
    //    적어 뒀으면 문구가 옛 경계에 남아도 초록불이었다. 상수에서 읽어 대조한다.
    it("등급↔점수 1:1 대응을 주장하지 않고 실제 점수를 보여준다", () => {
      const d = sub(scoreLocation(apt({ schoolGrade: "B", schoolScore: 71 })), "학군")?.detail;
      expect(d).toContain("B 71점");
      expect(d).toContain(schoolGradeLegend());
      for (const t of SCHOOL_GRADE_TIERS) expect(d).toContain(`${t.grade} ${t.min}↑`);
      expect(d).not.toMatch(/B=80/); // 옛 거짓 대응
    });

    it("옛 경계(A 80↑)를 그대로 적어 두지 않는다 — 상수와 어긋나면 red", () => {
      const d = sub(scoreLocation(apt({ schoolGrade: "B", schoolScore: 71 })), "학군")?.detail;
      const aMin = SCHOOL_GRADE_TIERS.find((t) => t.grade === "A")?.min;
      expect(aMin).toBe(90);
      expect(d).not.toContain("A 80↑");
    });

    it("등급이 없으면 점수도 감춘다 — ?? 50 폴백을 '실측 50점'처럼 보이지 않게", () => {
      const d = sub(scoreLocation(apt({})), "학군")?.detail;
      expect(d).toContain("미수집");
      expect(d).not.toMatch(/50점/);
    });
  });

  describe("상품성 — 배점표를 그대로 옮긴다", () => {
    it("브랜드 legend 가 BRAND_TIER 와 한 칸도 밀리지 않는다", () => {
      const d = sub(scoreProduct(apt({ builder: "현대건설" })), "브랜드")?.detail;
      expect(d).toContain("1군Super 20점");
      expect(d).not.toMatch(/1군 20점/); // 옛 legend (한 칸 밀림)
    });

    it("평면 legend 에 없는 값('혼합형')을 말하지 않는다", () => {
      const d = sub(scoreProduct(apt({ layout: "3베이판상" })), "평면")?.detail;
      expect(d).not.toMatch(/혼합형/); // 배점표에도 데이터에도 없는 값
      expect(d).toContain("4베이판상 10");
      expect(d).toContain("4베이타워 8"); // 베이 수가 판상/타워보다 먼저다
    });
  });

  describe("치안 — 범죄등급이 없으면 그 사실을 적는다", () => {
    // 등급은 점수의 0.7 을 차지한다. 없는 채로 "치안 우수"라 말하면 경찰서 거리 하나로 단정하는 것.
    it("등급 미수집이면 info 에 '미수집'이 들어가 판정이 감춰진다", () => {
      const i = sub(scoreRisk(apt({ policeDist: 685, police: 2 })), "치안 안전")?.info;
      expect(i).toContain("미수집");
      expect(i).toContain("경찰 685m"); // 잰 것은 그대로 보여준다
    });

    it("등급이 있으면 그대로 보여준다", () => {
      const i = sub(scoreRisk(apt({ crimeSafetyGrade: 2, policeDist: 685 })), "치안 안전")?.info;
      expect(i).toContain("2등급");
      expect(i).not.toContain("미수집");
    });
  });

  // 세션593 — 수도권은 비규제여도 주택구입 대출이 최대 6억(2025-06-28 시행)이라 "거래 자유"는 틀린 말이다.
  describe("규제 — 비규제를 '거래 자유'라 하지 않는다", () => {
    it("비규제 단지 detail = '비규제 (대출 최대 70%)' (calcCats 경유)", () => {
      const cats = calcCats(apt({ id: 1, price: 50000, region: "부산", gu: "해운대구", isRegulated: false }), {
        regionMedians: {},
      });
      expect(sub(cats.risk, "규제")?.detail).toBe("비규제 (대출 최대 70%)");
      expect(sub(cats.risk, "규제")?.detail).not.toMatch(/자유/); // 옛 문구로 되돌아가면 red
    });

    it("규제지역 detail 은 그대로", () => {
      const cats = calcCats(apt({ id: 1, price: 50000, region: "서울", gu: "강남구", isRegulated: true }), {
        regionMedians: {},
      });
      expect(sub(cats.risk, "규제")?.detail).toBe("규제지역 (매매·대출 제약)");
    });
  });
});

/// ── 괴리도 — 어느 잣대로 잰 값인지 말한다 (세션531 · 세션607 개정) ─────────────────
//
// 세션531: 면적을 모르면 옛 적정가가 **동네 전체 거래의 총액 중위값**이 되어 이 축이 "비싼가"가 아니라
// "큰가"를 쟀다(corr(면적, 괴리도) 버킷 −0.097 vs 폴백 −0.699). 그래서 경로마다 출처를 밝혔다.
// 세션607(시세 비교 범위 좁히기 다): 그 폴백 경로가 **전부 없어졌다** — 적정가는 같은 단지·같은 동 또래
// 실거래(`cmpFairPrice`)뿐이다(설계서 §5-3). 옛 단언("면적 미상"·"평수대별 실거래 기준" 문구가 붙는다)은
// 대상이 없어졌고, 남는 뜻 = **문구가 그 비교 범위를 그대로 말한다**·옛 출처 문구가 돌아오지 않는다.
//
// ⚠️ **반드시 `calcCats` 를 지난다** — 실전 경로(sanitize → scorePrice).
describe("괴리도 — 잰 잣대를 밝힌다 (세션531 · 세션607)", () => {
  /** 같은 단지 매매 5건(최근 12개월) 기준 최소 입력 */
  const scopedApt = (over = {}) =>
    apt({
      id: 1,
      region: "경기",
      price: 50000,
      completion: "202001",
      cmpScope: "complex",
      cmpSrc: "sale",
      cmpFairPrice: 50000,
      cmpN: 5,
      cmpMonths: 12,
      cmpAreaMode: "same_area",
      ...over,
    });

  it("같은 단지 실거래 기준이면 그 범위·건수·기간을 적는다", () => {
    const cats = calcCats(scopedApt({ area: 84 }), { regionMedians: {} });
    expect(sub(cats.price, "실거래 대비 분양가")?.detail).toContain(
      "이 단지 같은 평수 실거래 5건(최근 12개월) 중앙값 대비"
    );
  });

  it("면적 미상이어도 옛 '면적 미상' 문구를 붙이지 않는다 (같은 평수 실거래라 면적 편향 경로가 없다)", () => {
    const cats = calcCats(scopedApt({ area: null }), { regionMedians: {} });
    expect(sub(cats.price, "실거래 대비 분양가")?.detail).not.toContain("면적 미상");
  });

  it("버킷(priceByArea)·시도 평균이 있어도 옛 출처 문구는 돌아오지 않는다", () => {
    const cats = calcCats(
      scopedApt({
        area: 84,
        avgPriceSqm: 7000,
        priceByArea: [{ area: 85, min: 40000, avg: 50000, max: 60000, count: 12 }],
      }),
      { regionMedians: {} }
    );
    const d = sub(cats.price, "실거래 대비 분양가")?.detail ?? "";
    expect(d).not.toContain("평수대별 실거래 기준");
    expect(d).not.toContain("광역 시도 평균");
    expect(d).not.toContain("주변 시세");
  });

  // 세션651(사장님 결정 — 공공기관 준거): detail 은 판정 밴드 안내(`DEV_BAND_LABEL` "±10% 적정 · …")를
  //   싣지 않는다 — 산술 차이 + 비교 기준만. 옛 하드코딩 문구(세션531 이전)도 돌아오면 안 된다.
  it("detail 에 판정 밴드 안내가 없다 — 산술 차이 + 비교 기준만", () => {
    const cats = calcCats(scopedApt({ area: 84, price: 45000 }), { regionMedians: {} });
    const d = sub(cats.price, "실거래 대비 분양가")?.detail ?? "";
    expect(d).toBe("분양가가 10.0% 낮음 — 이 단지 같은 평수 실거래 5건(최근 12개월) 중앙값 대비");
    expect(d).not.toContain(DEV_BAND_LABEL);
    expect(d).not.toMatch(/적정|만점|최하/);
    expect(d).not.toContain("±10~20% 주의");
    expect(d).not.toContain("20%↑ 과대");
  });

  // 아래 상수(`DEV_BAND_LABEL`)는 손님 문구에서 빠졌지만(세션651) 점수표 설명 상수로 남아 있다 — 산식과 맞는지 계속 잠근다.
  it("밴드 안내 상수가 실제 산식과 맞는다 — 만점·바닥 경계를 그대로 말한다", () => {
    // 파생 문자열이므로 **산식 쪽에서** 두 경계를 독립 재현해 맞댄다.
    // (표에서 읽어 표와 비교하면 항등식이 된다 — [[guards-must-be-mutation-tested]])
    // 세션607: 적정가 = cmpFairPrice 그대로(계수 없음)지만, 엔진이 낸 fairPrice 에서 역산하는 꼴은 그대로 둔다
    //   (계수가 다시 끼어들면 이 가드가 먼저 어긋난다).
    /** @param {Record<string, unknown>} over */
    const probe = (over) => /** @type {any} */ (calcCats(scopedApt({ area: 84, ...over }), { regionMedians: {} }));
    const fair = Number(probe({ price: 1 }).price.fairPrice);
    expect(fair).toBe(50000);
    /** @param {number} dev */
    const at = (dev) =>
      /** @type {any} */ (sub(probe({ price: fair * (1 - dev / 100) }).price, "실거래 대비 분양가"))?.score ?? -1;
    const full = Number(/\+(\d+(?:\.\d+)?)%↑ 만점/.exec(DEV_BAND_LABEL)?.[1]);
    const zero = Number(/−(\d+(?:\.\d+)?)%↓ 최하/.exec(DEV_BAND_LABEL)?.[1]);
    expect(Number.isFinite(full)).toBe(true);
    expect(Number.isFinite(zero)).toBe(true);
    // 문구가 말한 지점에서 실제로 만점/바닥이어야 한다
    expect(at(full)).toBe(97);
    expect(at(full - 0.5)).toBeLessThan(97);
    expect(at(-zero)).toBe(0);
    expect(at(-zero + 0.5)).toBeGreaterThan(0);
  });
});

// ── 가격 축 손님 문자열 — 판정어 부정 가드 (세션651 · 사장님 결정 "공공기관 준거") ──────
//
// "적정가"라는 이름(공공기관 원문에 없는 우리 판정어)·±10% 판정("저렴/비쌈/수준")을 손님 화면에서 없앴다.
// 이 묶음은 가격 축의 **손님 문자열이 만들어지는 자리 전부**(엔진 detail·점수 탭 판정표·카테고리 한 줄·
// 카드 칩·시세 탭 머리 줄과 표)를 실전 입력 여러 개로 돌려 판정어가 **0건**인지 본다.
// 어느 한 자리라도 옛 문구로 되돌리면 red 다(변이 실증은 세션651 작업 보고의 변이 표).
// 범위 밖: 관리비(혜택 축 "지역 중앙값보다 비쌈")는 가격 판정이 아니라 다른 축의 사실 비교다.
describe("가격 축 손님 문자열에 판정어가 없다 (세션651)", () => {
  const JUDGE = /적정가|저렴|비쌈/;
  const SCOPES = /** @type {const} */ ([
    { cmpScope: "complex", cmpSrc: "sale", cmpAreaMode: "same_area" },
    { cmpScope: "complex", cmpSrc: "presale", cmpAreaMode: "same_area" },
    { cmpScope: "dong_peer", cmpSrc: "sale", cmpAreaMode: "per_m2" },
  ]);
  // 분양가 = 비교 중앙값 × (1 − dev/100) — 옛 밴드 안·밖·경계·큰 괴리를 다 지난다
  const DEVS = [35, 18.8, 10.1, 10, 3.2, 0, -3.2, -10, -10.1, -40];
  /** @param {Record<string, unknown>} scope @param {number} dev */
  const mk = (scope, dev) =>
    apt({
      id: "ah-1",
      region: "경기",
      area: 84.97,
      completion: "202001",
      price: Math.round(60000 * (1 - dev / 100)),
      cmpFairPrice: 60000,
      cmpN: 12,
      cmpMonths: 12,
      complexJeonseRate: 72.3,
      complexJeonseN: 5,
      complexSaleN: 8,
      ...scope,
    });

  /** @param {any} a */
  const customerStrings = (a) => {
    const cats = /** @type {any} */ (calcCats(a, { regionMedians: {} }));
    const out = [];
    for (const s of cats.price.subs) {
      out.push(s.detail ?? "");
      const ctx = /** @type {any} */ (SUB_CONTEXT.price)[s.name];
      if (ctx?.interpret) out.push(ctx.interpret(s.score, s.info));
      if (ctx?.benchmark) out.push(ctx.benchmark);
    }
    out.push(catVerdict("price", cats.price));
    const chips = buildCardChips(a, /** @type {any} */ ({ total: 70, cats }), {
      isLoggedIn: true,
      showDeviation: true,
      nowYm: "202610",
    });
    for (const c of chips) if (c.layer === "core" || c.id.startsWith("jeonse")) out.push(c.text);
    out.push(scopeHeadText(a) ?? "");
    for (const r of compareRows(a, cats.price)) out.push(`${r.label} ${r.value}`);
    out.push(priceSourceText(a));
    return { out, cats, chips };
  };

  it("범위 3종 × 괴리 10종 — 판정어 0건", () => {
    let checked = 0;
    for (const scope of SCOPES)
      for (const dev of DEVS) {
        const { out } = customerStrings(mk(scope, dev));
        for (const s of out) {
          expect(s, `${scope.cmpScope}/${scope.cmpSrc} dev=${dev}: ${s}`).not.toMatch(JUDGE);
          checked++;
        }
      }
    expect(checked).toBeGreaterThan(300); // 양성 앵커 — 빈 목록으로 초록이 되지 않게
  });

  // 세션661 실거래 범위 — 새 줄 글자("가운데 값"·"이 단지 전세"·범위 칩)도 같은 금칙어 검사를 지난다
  it("실거래 범위가 있을 때(범위 줄 · 가운데 값 · 전세 범위 · 범위 칩)도 판정어 0건", () => {
    const RANGE = { cmpMin: 52000, cmpMax: 66000, complexJeonseMin: 38000, complexJeonseMax: 46000 };
    const seen = new Set();
    let checked = 0;
    for (const scope of SCOPES)
      for (const dev of DEVS) {
        const { out } = customerStrings(mk({ ...scope, ...RANGE }, dev));
        for (const s of out) {
          expect(s, `${scope.cmpScope} dev=${dev}: ${s}`).not.toMatch(JUDGE);
          const m = /^(가운데 값|이 단지 전세|전세) /.exec(s);
          if (m) seen.add(m[1]);
          checked++;
        }
      }
    expect(checked).toBeGreaterThan(300);
    // 양성 앵커 — 새 줄이 실제로 검사 대상에 들어왔다(범위 모드가 안 켜지면 red)
    expect([...seen].sort()).toEqual(["가운데 값", "이 단지 전세", "전세"]);
  });

  // 비교 대상이 없는 단지(범위 none · 분양가 없음 · 칸 없음)도 판정어 없이 빠진다 — catVerdict·subContext 가 같은 어휘
  // 세션651 보완 ④(사장님 결정): 종합 탭·카드 편차 줄의 평당가·전세가율도 가격 축 손님 문자열이다 —
  //   끝말·값 문구·스크린리더 문장 어디에도 유불리 판정어("싸요/비싸요"·"높아요/낮아요"·"유리")가 없고 색은 중립.
  // 세션652(사장님 결정 ② 값 그대로): 미분양·역세권·소득부담·관리비 4줄도 같은 규칙 — 6필드 전부.
  it("편차 줄 평당가·전세가율·미분양·역세권·소득부담·관리비 — 판정어 0건 · 색 중립 (끝말·값 문구·스크린리더)", () => {
    const DEV_JUDGE =
      /싸|비싸|유리|좋|높아요|낮아요|평균 수준|가벼워요|무거워요|가볍|무겁|적어요|많아요|적다|많다|가까워요|멀어요/;
    const stats = computeRegionalStats(
      Array.from(
        { length: 41 },
        (_, i) =>
          /** @type {any} */ ({
            region: "경기",
            pp: 1000 + i * 50,
            complexJeonseRate: 40 + i * 1.5,
            unsoldRate: i, // 중앙값 20
            subwayDist: 100 + i * 50, // 중앙값 1100
            pir: 3 + i * 0.5, // 중앙값 13
            avgMaintenanceCost: 10 + i * 0.5, // 중앙값 20
          })
      )
    );
    let checked = 0;
    for (const [field, values] of /** @type {const} */ ([
      ["pp", [900, 1000, 1500, 2000, 2010, 2500, 3000, 3500]],
      ["complexJeonseRate", [35, 40, 55, 70, 70.2, 85, 100, 130]],
      ["unsoldRate", [0, 1, 10, 20, 20.2, 30, 40, 60]],
      ["subwayDist", [50, 100, 600, 1100, 1105, 2000, 2500, 5000]],
      ["pir", [2, 3, 8, 13, 13.1, 18, 23, 40]],
      ["avgMaintenanceCost", [5, 10, 15, 20, 20.05, 25, 30, 60]],
    ])) {
      const spec = /** @type {any} */ (deviationSpec(field));
      expect(spec.neutral, field).toBe(true);
      for (const v of values) {
        const d = computeDeviation(spec, v, "경기", stats);
        const texts = [
          spec.lowWord,
          spec.highWord,
          d.text,
          deviationAriaLabel(spec, d, "경기", formatDeviationValue(spec, v)),
        ];
        for (const t of texts) {
          expect(t, `${field}=${v}: ${t}`).not.toMatch(DEV_JUDGE);
          expect(t, `${field}=${v}: ${t}`).not.toMatch(JUDGE);
          checked++;
        }
        expect(d.tone, `${field}=${v}`).toBe("neutral");
      }
    }
    expect(checked).toBe(192); // 양성 앵커 — 6필드 × 8값 × 4문자열
  });

  it("비교 대상이 없는 단지도 판정어 0건 — '비교할 실거래 없음'", () => {
    for (const over of [
      { cmpScope: "none", cmpFairPrice: null, cmpN: 0 },
      { cmpScope: "complex", price: 0 },
      { cmpScope: undefined, cmpFairPrice: undefined },
    ]) {
      const a = mk(SCOPES[0], 0);
      const { out, cats } = customerStrings(apt({ ...a, ...over }));
      for (const s of out) expect(s, `${JSON.stringify(over)}: ${s}`).not.toMatch(JUDGE);
      expect(catVerdict("price", cats.price), JSON.stringify(over)).toBe("비교할 실거래 없음");
    }
  });

  // 전세가율은 몇 %가 좋은지 공공기관 기준이 없다 — 점수 탭 detail·판정·카드 칩 어디에도 좋음/나쁨 말이 없다
  it("전세가율 문자열에 판정어가 없다 — 산식만 (적정·위험·과열·높음·낮음·주의)", () => {
    for (const jr of [35, 55, 66.1, 75, 85, 151.1]) {
      const a = mk(SCOPES[0], 5);
      const { cats, chips } = customerStrings(apt({ ...a, complexJeonseRate: jr }));
      const s = /** @type {any} */ (cats.price.subs.find((/** @type {any} */ x) => x.name === "전세가율"));
      const ctx = /** @type {any} */ (SUB_CONTEXT.price)["전세가율"];
      const texts = [
        s.detail,
        ctx.interpret(s.score, s.info),
        ctx.benchmark,
        chips.find((c) => c.id === "jeonseRate")?.text,
      ];
      for (const t of texts) expect(t, `jr=${jr}: ${t}`).not.toMatch(/적정|위험|과열|높음|낮음|주의/);
      expect(s.detail).toBe(`${jr}% — 같은 단지 같은 평수 전세 가운데값 ÷ 매매 가운데값 (전세 5건 · 매매 8건)`);
    }
  });

  // 세션651 검사관 보완: "같음" 문턱이 자리마다 달랐다(종합 탭 0.05% · 카테고리 한 줄 0.5%) — 같은 단지를
  //   한 화면은 "같음", 다른 화면은 "0.3% 낮음"이라 불렀다. 이제 `priceGapParts` 하나가 판정한다.
  //   W4 점수 탭 판정 · W7 카테고리 한 줄 · W8 종합 탭 핵심지표(`fmtPriceGap` 그대로)가 같은 숫자·같은 판정이어야 한다.
  it.each([
    [0.3, "분양가가 0.3% 낮음", "실거래보다 0.3% 낮은 분양가"],
    [-0.3, "분양가가 0.3% 높음", "실거래보다 0.3% 높은 분양가"],
    [0.04, "분양가가 같음", "실거래와 같은 분양가"],
    [-0.04, "분양가가 같음", "실거래와 같은 분양가"],
    [12.34, "분양가가 12.3% 낮음", "실거래보다 12.3% 낮은 분양가"],
  ])("괴리 %s%% — 점수 탭·카테고리 한 줄·종합 탭이 같은 말 (세션651)", (dev, gap, verdict) => {
    const info = `${dev > 0 ? "+" : ""}${dev.toFixed(1)}%`; // scorePrice info 꼴
    const w4 = /** @type {any} */ (SUB_CONTEXT.price)["실거래 대비 분양가"].interpret(50, info);
    const w7 = catVerdict("price", /** @type {any} */ ({ total: 50, fairPrice: 60000, deviation: dev.toFixed(1) }));
    const w8 = fmtPriceGap(Number(dev.toFixed(1))); // DetailModal 핵심지표: fmtPriceGap(Number(deviation))
    expect(w4).toBe(gap);
    expect(w8).toBe(gap);
    expect(w7).toBe(verdict);
  });

  it("양성 앵커 — 가드가 실제 문구를 지난다 (빈 문자열 통과 방지)", () => {
    const { out, chips } = customerStrings(mk(SCOPES[0], 18.8));
    expect(out).toContain("실거래보다 18.8% 낮은 분양가"); // catVerdict
    expect(out).toContain("분양가가 18.8% 낮음"); // 점수 탭 판정
    expect(out).toContain("차이 분양가가 18.8% 낮음"); // 시세 탭 표
    expect(chips.find((c) => c.id === "priceCompare")?.text).toBe("이 단지 실거래 중앙 6억 (12건·12개월)");
    expect(chips.find((c) => c.id === "jeonseRate")?.text).toBe(
      "전세가율 72.3% · 전세 가운데값 ÷ 매매 가운데값 (전세 5건 · 매매 8건)"
    );
  });
});

// ── 미래가치 3축 — 원문이 있으면 detail 이 "없음"이라 하지 않는다 (SC3, PR-2) ──────
//
// info 는 원문(transitDev/cityDev/indStr)을 그대로 보여주는데, 미매칭이면 detail 만
// "…없음 (0점)" 이라 한 줄 안에서 서로 다른 말을 했다(값 있는데 낮은 점수 ≠ 부재).
// 이제 detail 도 info 와 같은 조건(원문 유무)으로 갈린다.
// ⚠️ 반드시 calcCats 를 지난다 — sanitize 가 transitDev/cityDev/industryDev 를 str() 로 지난다.
// ⚠️ 옛 문구("…없음")로 되돌리면 red 가 되도록 원문-있음 케이스에서 그 부재를 함께 단언한다.
describe("미래가치 3축 — 원문이 있으면 '없음'이라 하지 않는다 (SC3)", () => {
  /** @param {Record<string, unknown>} over */
  const future = (over) =>
    calcCats(apt({ id: 1, price: 50000, region: "경기", ...over }), { regionMedians: {} }).future;
  /** @param {Record<string, unknown>} over @param {string} name */
  const detailOf = (over, name) => sub(future(over), name)?.detail;
  /** @param {Record<string, unknown>} over @param {string} name */
  const scoreOf = (over, name) => future(over).subs.find((s) => s.name === name)?.score;

  it("교통개발: 원문 있으나 형식 미매칭이면 '형식을 해석하지 못함' (0점) — '없음' 아님", () => {
    const d = detailOf({ transitDev: "알 수 없는 형식" }, "교통개발");
    expect(d).toContain("형식을 해석하지 못함");
    expect(d).not.toContain("교통개발 없음"); // 원문이 있는데 '없음'이라 하면 거짓
    expect(scoreOf({ transitDev: "알 수 없는 형식" }, "교통개발")).toBe(0); // 점수는 무변경
  });
  it("교통개발: 원문이 아예 없으면 '교통개발 없음' 유지", () => {
    expect(detailOf({}, "교통개발")).toBe("교통개발 없음 (0점)");
  });

  it("도시개발: 원문 있으나 미매칭 → '형식을 해석하지 못함' (0점) — '없음' 아님", () => {
    const d = detailOf({ cityDev: "택지지구(거리없음)" }, "도시개발");
    expect(d).toContain("형식을 해석하지 못함");
    expect(d).not.toContain("개발지구 없음");
  });
  it("도시개발: 원문 없으면 '개발지구 없음' 유지", () => {
    expect(detailOf({}, "도시개발")).toBe("반경 5km 안에 개발지구 없음 (0점)");
  });

  it("산업개발: 원문 있으나 미매칭 → '형식을 해석하지 못함' (0점) — '없음' 아님", () => {
    const d = detailOf({ industryDev: "산단(거리없음)" }, "산업개발");
    expect(d).toContain("형식을 해석하지 못함");
    expect(d).not.toContain("산업단지 없음");
  });
  it("산업개발: 원문 없으면 '산업단지 없음' 유지", () => {
    expect(detailOf({}, "산업개발")).toBe("반경 5km 안에 산업단지 없음 (0점)");
  });

  it("매칭되면 거리 설명이 그대로 (형식 미해석 문구를 붙이지 않는다)", () => {
    const d = detailOf({ industryDev: "테크노밸리 1.5km" }, "산업개발");
    expect(d).toContain("산업단지까지 1.5km");
    expect(d).not.toContain("형식을 해석하지 못함");
  });
});
