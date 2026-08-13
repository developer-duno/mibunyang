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

    it("관리비 비교 기준은 중앙값이다 — '평균'이라 하지 않는다", () => {
      const r = scoreBenefit(apt({ price: 50000, _regionAvgMaint: 20, avgMaintenanceCost: 15 }));
      expect(sub(r, "관리비 절감")?.detail).toMatch(/중앙값/);
      expect(sub(r, "관리비 절감")?.detail).not.toMatch(/지역 평균/);
    });
  });

  describe("학군 — 등급은 점수에서 파생된다", () => {
    // `schools-neis.mjs gradeFromScore`: 80↑ A · 60↑ B · 40↑ C. "B=80점" 대응은 성립 불가.
    it("등급↔점수 1:1 대응을 주장하지 않고 실제 점수를 보여준다", () => {
      const d = sub(scoreLocation(apt({ schoolGrade: "B", schoolScore: 71 })), "학군")?.detail;
      expect(d).toContain("B 71점");
      expect(d).toContain("A 80↑");
      expect(d).not.toMatch(/B=80/); // 옛 거짓 대응
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
