// @ts-check
import { describe, it, expect } from "vitest";
import { findViolations, stripComments } from "./audit-customer-facing-excuses.mjs";

// 손님 화면 변명 문구 감사 — 이 가드 자체가 실효인지 검증한다(guards-must-be-mutation-tested).

describe("stripComments — 주석은 검사 대상이 아니다", () => {
  it("줄 주석 안의 금지어는 지워진다", () => {
    const out = stripComments(`const a = 1; // 정확하지 않을 수 있습니다\nconst b = 2;`);
    expect(out).not.toMatch(/정확하지 않을 수 있/);
    expect(out).toMatch(/const b = 2/);
  });

  it("블록/JSX 주석 안의 금지어도 지워진다 — 왜 안 다는지 설명하는 주석이 필요하다", () => {
    const out = stripComments(`{/* 여기엔 "정확하지 않을 수 있습니다" 를 달지 않는다 */}\n<div>ok</div>`);
    expect(out).not.toMatch(/정확하지 않을 수 있/);
    expect(out).toMatch(/<div>ok<\/div>/);
  });

  it("⚠️ 문자열 안의 // 를 주석으로 오인하지 않는다", () => {
    const out = stripComments(`const url = "https://example.com/a"; const t = "참고로만 봐 주세요";`);
    expect(out).toMatch(/참고로만 봐 주세요/); // 잘려나가면 안 된다
  });

  it("줄 수가 보존된다 — 위반 줄 번호가 어긋나면 안 된다", () => {
    const src = `a\n// 정확하지 않을 수 있습니다\nb\n참고로만 봐 주세요`;
    const out = stripComments(src);
    expect(out.split("\n").length).toBe(src.split("\n").length);
    expect(findViolations("src/components/X.tsx", src)[0].line).toBe(4);
  });
});

describe("findViolations — 무엇을 잡고 무엇을 넘기나", () => {
  const F = "src/components/detail/Card.tsx";

  it("신뢰도를 변명하는 문구를 잡는다", () => {
    for (const t of [
      "<div>이 값은 정확하지 않을 수 있습니다</div>",
      "<div>참고로만 봐 주세요</div>",
      "<div>그대로 믿지 마세요</div>",
      "<div>오차가 있을 수 있습니다</div>",
    ]) {
      expect(findViolations(F, t).length, t).toBeGreaterThan(0);
    }
  });

  it("⚠️ 값의 성질을 적는 말은 잡지 않는다 — 그건 사실이지 변명이 아니다", () => {
    for (const t of [
      "<div>입주 예정일 2027년 3월</div>",
      "<div>3년 평균 미세먼지</div>",
      "<div>분양가는 추정치입니다</div>",
      "<div>최근 6개월 3건</div>",
    ]) {
      expect(findViolations(F, t), t).toEqual([]);
    }
  });

  it("⚠️ 관리자 화면은 제외한다 — 거기는 사장님이 보는 자리라 적는 게 맞다", () => {
    const t = "<div>이 값은 정확하지 않을 수 있습니다</div>";
    expect(findViolations("src/components/admin/AdminDataAudit.tsx", t)).toEqual([]);
    expect(findViolations("src/components/detail/AdminScoreBreakdown.tsx", t)).toEqual([]);
    // 이름이 Admin 으로 시작하지 않으면 일반 화면이다
    expect(findViolations("src/components/detail/BuilderCard.tsx", t).length).toBeGreaterThan(0);
  });

  it("띄어쓰기가 달라도 잡는다 — 우회가 쉬우면 가드가 아니다", () => {
    expect(findViolations(F, "<div>정확하지  않을   수 있습니다</div>").length).toBeGreaterThan(0);
    expect(findViolations(F, "<div>참고로만  보세요</div>").length).toBeGreaterThan(0);
  });

  it("위반 보고에 이유가 함께 온다", () => {
    const [h] = findViolations(F, "<div>참고로만 봐 주세요</div>");
    expect(h.why).toMatch(/떠넘/);
    expect(h.file).toBe(F);
  });
});
