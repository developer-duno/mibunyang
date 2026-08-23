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
import { SCHOOL_GRADE_TIERS, schoolGradeLegend } from "@/constants/scoringTiers";

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
          regionMedians: maint == null ? {} : { 경기: { pir: 5, psr: 0.8, unsoldRate: 15, supplyRatio: 100, maint } },
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
});
