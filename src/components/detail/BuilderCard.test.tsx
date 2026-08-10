import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BuilderCard } from "./BuilderCard";
import { makeApt } from "@/__tests__/factories";
import type { Apt } from "@/types/scoring";

// factories.js 는 plain .js(타입 미검사)라 makeApt() 반환값이 Apt 와 구조적으로 어긋난다.
// .tsx 파일은 JSDoc `@type` 캐스트를 적용 안 해서(그건 @ts-check .js 전용) 명시 캐스트한다.
function apt(overrides: Record<string, unknown> = {}): Apt {
  return makeApt(overrides) as unknown as Apt;
}

describe("BuilderCard — 게이트·기본 접힘", () => {
  it("3필드가 전부 null 이면 렌더하지 않는다", () => {
    const { container } = render(
      <BuilderCard apt={apt({ builder: null, builderCreditGrade: null, builderDebtRatio: null })} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("하나라도 있으면 렌더한다 — 기본은 접힘(TransportCard 패턴)", () => {
    render(<BuilderCard apt={apt({ builder: "현대건설", builderCreditGrade: null, builderDebtRatio: null })} />);
    expect(screen.getByText("시공사 정보")).toBeTruthy();
    expect(screen.queryByText("시공사")).toBeNull(); // 본문(label)은 접힌 상태에서 안 보임
  });

  it("헤더 클릭으로 펼쳐진다", () => {
    render(<BuilderCard apt={apt()} />);
    fireEvent.click(screen.getByText("시공사 정보"));
    expect(screen.getByText("시공사")).toBeTruthy();
  });
});

describe("BuilderCard — builderCreditGrade (fmt 그대로 재사용, 해당없음/미수집 구분)", () => {
  it("등급이 있으면 그대로 보여준다", () => {
    render(<BuilderCard apt={apt({ builderCreditGrade: "AA" })} />);
    fireEvent.click(screen.getByText("시공사 정보"));
    expect(screen.getByText("AA")).toBeTruthy();
  });

  it("등급 null + 신탁/조합 등 시공사면 '해당없음' (신용등급 개념 자체가 없다)", () => {
    render(<BuilderCard apt={apt({ builder: "OO자산신탁", builderCreditGrade: null })} />);
    fireEvent.click(screen.getByText("시공사 정보"));
    expect(screen.getByText("해당없음")).toBeTruthy();
  });

  it("등급 null + 일반 시공사면 '—' (진짜 미수집, 대형사도 포함)", () => {
    render(<BuilderCard apt={apt({ builder: "삼성물산", builderCreditGrade: null })} />);
    fireEvent.click(screen.getByText("시공사 정보"));
    expect(screen.getByText("—")).toBeTruthy();
  });
});

describe("BuilderCard — builderDebtRatio (scoreRisk.ts:240 판정 이관, fmt 미재사용)", () => {
  it("값이 있고 폴백이 아니면 '%'로 보여준다", () => {
    render(<BuilderCard apt={apt({ builderDebtRatio: 120, _fallbackBuilderDebt: undefined })} />);
    fireEvent.click(screen.getByText("시공사 정보"));
    expect(screen.getByText("120%")).toBeTruthy();
  });

  it("값이 null 이면 '미수집'", () => {
    render(<BuilderCard apt={apt({ builderDebtRatio: null })} />);
    fireEvent.click(screen.getByText("시공사 정보"));
    expect(screen.getByText("미수집")).toBeTruthy();
  });

  it("값이 있어도 _fallbackBuilderDebt 면 '미수집' (지역 평균 대체값을 재값처럼 말하지 않는다, #368 일관)", () => {
    render(<BuilderCard apt={apt({ builderDebtRatio: 250, _fallbackBuilderDebt: true })} />);
    fireEvent.click(screen.getByText("시공사 정보"));
    expect(screen.getByText("미수집")).toBeTruthy();
    expect(screen.queryByText("250%")).toBeNull();
  });
});

describe("BuilderCard — hugGuarantee 제외 (사장님 확정, Q6 유지)", () => {
  it("HUG 보증 필드는 그리지 않는다", () => {
    render(<BuilderCard apt={apt({ hugGuarantee: true })} />);
    fireEvent.click(screen.getByText("시공사 정보"));
    expect(screen.queryByText(/HUG/)).toBeNull();
  });
});
