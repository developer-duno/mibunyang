import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { UnsoldEventCard } from "./UnsoldEventCard";
import { makeApt } from "@/__tests__/factories";
import type { Apt } from "@/types/scoring";

// factories.js 는 plain .js(타입 미검사)라 makeApt() 반환값이 Apt 와 구조적으로 어긋난다
// (예: id 기본값이 number). .tsx 파일은 JSDoc `@type` 캐스트를 적용 안 해서(그건 @ts-check
// .js 전용) `as unknown as Apt` 로 명시 캐스트한다 — ExtraFieldsAccordion.test.tsx 의 apt()
// 헬퍼와 같은 패턴.
function apt(overrides: Record<string, unknown> = {}): Apt {
  return makeApt(overrides) as unknown as Apt;
}

/**
 * UnsoldEventCard — 세션508 PR-3c C1.
 *
 * 라이브 실측 4케이스를 그대로 표로 검증한다:
 *  A) count>0, last 있음 — 흔한 경우, 문장이 온전하다
 *  B) count>0, last 없음(224건, 28.8%) — "마지막" 절만 생략, 횟수는 정직하게 남는다
 *  C) count=0, last 있음(540건, 42.6%) — v1 이 "이력 없어요"라 거짓말하던 자리. 마지막
 *     날짜가 있으니 없다고 말하면 안 된다
 *  D) count=0, last 없음 — 진짜 이력 없음
 */
describe("UnsoldEventCard — ah- 게이트", () => {
  it("id가 ah- 로 시작 안 하면 렌더하지 않는다 (비-ah 1,066건/52.2%는 구조적으로 늘 0)", () => {
    const { container } = render(
      <UnsoldEventCard apt={apt({ id: "molit-123", unsoldEventCount: 3, lastUnsoldEventAt: "2026-03-15" })} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("id가 ah- 로 시작하면 렌더한다", () => {
    const { container } = render(
      <UnsoldEventCard apt={apt({ id: "ah-123", unsoldEventCount: 0, lastUnsoldEventAt: null })} />
    );
    expect(container.firstChild).not.toBeNull();
  });
});

describe("UnsoldEventCard — count/lastUnsoldEventAt 4케이스", () => {
  it("A) count>0 · last 있음 — 횟수와 마지막 날짜를 함께 보여준다", () => {
    const { container } = render(
      <UnsoldEventCard apt={apt({ id: "ah-1", unsoldEventCount: 3, lastUnsoldEventAt: "2026-03-15" })} />
    );
    expect(container.textContent).toContain("추가 모집 3회");
    expect(container.textContent).toContain("마지막 2026.03");
  });

  it("B) count>0 · last 없음(28.8%) — 횟수는 남기고 '마지막' 절만 생략한다 (빈칸·Invalid Date 방지)", () => {
    const { container } = render(
      <UnsoldEventCard apt={apt({ id: "ah-2", unsoldEventCount: 2, lastUnsoldEventAt: null })} />
    );
    expect(container.textContent).toContain("추가 모집 2회");
    expect(container.textContent).not.toContain("마지막");
    expect(container.textContent).not.toContain("Invalid Date");
  });

  it("C) count=0 · last 있음(42.6%) — v1 이 '이력 없어요'라 거짓말하던 자리, 마지막 날짜는 정직하게 보여준다", () => {
    const { container } = render(
      <UnsoldEventCard apt={apt({ id: "ah-3", unsoldEventCount: 0, lastUnsoldEventAt: "2025-11-02" })} />
    );
    expect(container.textContent).not.toContain("이력 없어요");
    expect(container.textContent).not.toContain("이력이 없어요");
    expect(container.textContent).toContain("마지막 2025.11");
  });

  it("D) count=0 · last 없음 — 진짜 아무 이력도 없다 ('—'로 정직하게 표시, 횟수 0회로 우기지 않는다)", () => {
    const { container } = render(
      <UnsoldEventCard apt={apt({ id: "ah-4", unsoldEventCount: 0, lastUnsoldEventAt: null })} />
    );
    expect(container.textContent).toContain("추가 모집 —");
    expect(container.textContent).not.toContain("마지막");
  });
});

describe("UnsoldEventCard — 라벨 (손님 어휘, 관리자 용어 금지)", () => {
  it("라벨은 '추가 모집'이다 ('무순위 공고' 아님)", () => {
    const { container } = render(
      <UnsoldEventCard apt={apt({ id: "ah-5", unsoldEventCount: 1, lastUnsoldEventAt: "2026-01-01" })} />
    );
    expect(container.textContent).toContain("추가 모집");
    expect(container.textContent).not.toContain("무순위");
  });
});
