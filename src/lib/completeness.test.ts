import { describe, it, expect } from "vitest";
import { computeCompleteness } from "./completeness";
import { FIELD_META } from "@/constants/fieldMeta";
import { makeApt } from "@/__tests__/factories";
import type { Apt } from "@/types/scoring";

// makeApt(JS factory)는 id:number 등 Apt(id:string)와 미세 불일치 → 테스트 입력용 cast.
const apt = (o = {}): Apt => makeApt(o) as unknown as Apt;

describe("computeCompleteness", () => {
  // 1. 빈 배열 → pct 0 (0나눗셈 가드)
  it("빈 필드 배열이면 pct 0", () => {
    const r = computeCompleteness([], apt());
    expect(r.pct).toBe(0);
    expect(r.total).toBe(0);
    expect(r.evalTotal).toBe(0);
  });

  // 2. 전부 채움 → 100
  it("모든 필드가 값 있으면 pct 100", () => {
    const r = computeCompleteness(["region", "gu", "dong"], apt());
    expect(r.filled).toBe(3);
    expect(r.pct).toBe(100);
  });

  // 3. na(competition + presaleStage:null) 분모 제외
  it("presaleStage=null이면 competition 필드가 na로 분모에서 빠진다", () => {
    const a = apt({ presaleStage: null, competitionRate: null });
    const r = computeCompleteness(["region", "competitionRate"], a);
    // competitionRate는 na (presaleNA), region은 filled → evalTotal=1, pct=100
    expect(r.na).toBe(1);
    expect(r.evalTotal).toBe(1);
    expect(r.pct).toBe(100);
  });

  // 4. estimated → 0.5 가중
  it("지역추정(_fallbackPir) 필드는 0.5로 가중된다", () => {
    const a = apt({ pir: 5, _fallbackPir: true });
    const r = computeCompleteness(["pir"], a);
    expect(r.estimated).toBe(1);
    expect(r.filled).toBe(0);
    // (0 + 1*0.5)/1 = 50%
    expect(r.pct).toBe(50);
  });

  // 5. isDefault(unsoldRate:0) → default 분류 (filled 아님)
  it("unsoldRate가 0이면 기본값(default) 분류", () => {
    const a = apt({ unsoldRate: 0 });
    const r = computeCompleteness(["unsoldRate"], a);
    expect(r.defaults).toBe(1);
    expect(r.filled).toBe(0);
    expect(r.defaultFields.length).toBe(1);
  });

  // 6. missing(null) → 분모 포함, 분자 제외
  it("null 필드는 missing — 분모 포함, pct 낮춤", () => {
    const a = apt({ crimeSafetyGrade: null });
    const r = computeCompleteness(["region", "crimeSafetyGrade"], a);
    expect(r.missing).toBe(1);
    expect(r.evalTotal).toBe(2);
    // 1 filled / 2 = 50%
    expect(r.pct).toBe(50);
  });

  // 7. countField 0 = filled (사장님 결정: 0개도 진짜 데이터)
  it("생활인프라 개수 0개는 filled로 센다 (isDefault 없음)", () => {
    const a = apt({ hospital: 0 });
    const r = computeCompleteness(["hospital"], a);
    expect(r.filled).toBe(1);
    expect(r.missing).toBe(0);
    expect(r.pct).toBe(100);
  });

  // 8. ExpertDataCompleteness 동일성 — 전체 비-hidden 필드 기준 (drift 가드)
  it("전체 비-hidden 필드 기준 pct는 ExpertDataCompleteness와 동일 로직", () => {
    const allFields = Object.keys(FIELD_META).filter(
      (k) => !(FIELD_META as Record<string, { hidden?: boolean }>)[k].hidden,
    );
    const a = apt();
    const r = computeCompleteness(allFields, a);
    // ExpertDataCompleteness.tsx와 동일: evalTotal = total - na, pct = round((filled+estimated*0.5)/evalTotal*100)
    expect(r.total).toBe(allFields.length);
    expect(r.evalTotal).toBe(r.total - r.na);
    const expected =
      r.evalTotal > 0 ? Math.round(((r.filled + r.estimated * 0.5) / r.evalTotal) * 100) : 0;
    expect(r.pct).toBe(expected);
    // makeApt는 대부분 채움 → 0보다 큼
    expect(r.pct).toBeGreaterThan(0);
  });

  // 9. 공기업/신탁/조합 시공사 + 등급 없음 → 신용등급 na (개념상 해당없음)
  it("공기업(LH공사) 시공사 + 등급 null이면 신용등급이 na로 분모에서 빠진다", () => {
    const a = apt({ builder: "LH공사", builderCreditGrade: null });
    const r = computeCompleteness(["region", "builderCreditGrade"], a);
    expect(r.na).toBe(1);
    expect(r.naFields).toContain("시공사 신용등급");
    expect(r.evalTotal).toBe(1); // region만 평가, builderCreditGrade는 na
    expect(r.pct).toBe(100);
  });

  // 10. 민간 시공사 + 등급 없음 → missing (na 아님, 채워야 할 데이터)
  it("민간 시공사 + 등급 null이면 신용등급이 missing (na 아님)", () => {
    const a = apt({ builder: "(주)길성종합건설", builderCreditGrade: null });
    const r = computeCompleteness(["region", "builderCreditGrade"], a);
    expect(r.na).toBe(0);
    expect(r.missing).toBe(1);
    expect(r.missingFields).toContain("시공사 신용등급");
  });

  // 11. 공기업이라도 등급이 실제로 있으면 filled (na 아님 — v==null 가드)
  it("등급이 실제로 있으면 공기업이어도 filled로 센다", () => {
    const a = apt({ builder: "부산도시공사", builderCreditGrade: "A" });
    const r = computeCompleteness(["builderCreditGrade"], a);
    expect(r.filled).toBe(1);
    expect(r.na).toBe(0);
    expect(r.missing).toBe(0);
  });
});
