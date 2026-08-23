// @ts-check
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ScoringEngine } from "./ScoringEngine";

/**
 * 엔진 설명이 **실제 산식과 어긋나지 않는지** 지키는 가드 (세션 513).
 *
 * 사고 기록 — 세션511 이 미래가치 4축을 전면 재설계(키워드 매칭 폐기 → 거리 등급 + 고정
 * 가중치)했는데 이 안내문만 옛 산식 그대로 남아 "GTX·KTX·광역철도", "신도시·재건축·특구",
 * "테크노밸리", "데이터 없는 항목은 인구에 가중치 집중"을 계속 말하고 있었다.
 * 혜택·할인도 서브지표 6종 중 5종이 전 단지 미수집인데 "전부 …점수화합니다"라고 단언했다.
 * **재지 않는 것을 말하지 않는다**([[score-meaning-and-wording-are-a-pair]]).
 *
 * 잔재 검사는 손님이 실제로 읽는 한글 문구로 한다.
 */
describe("ScoringEngine — 재지 않는 것을 말하지 않는다", () => {
  /** 화면에 실제로 렌더되는 글자 전체 */
  function engineText() {
    const { container } = render(<ScoringEngine />);
    return container.textContent || "";
  }

  const REMOVED = [
    ["GTX·KTX", "미래가치 노선급 표(TRANSIT_GRADE)에 KTX 는 없다 — 입지 축이 재는 값"],
    ["광역철도", "같은 이유로 노선급 표에 없다"],
    ["인구에 가중치 집중", "동적 재분배는 세션511 에 폐기 — 지금은 고정 가중치"],
    ["테크노밸리", "산업축은 이름 키워드가 아니라 산업단지까지 거리를 잰다"],
    ["점수화합니다", "혜택 6종 중 5종은 전 단지 미수집 — '전부 점수화'는 거짓"],
  ];

  for (const [word, why] of REMOVED) {
    it(`"${word}" 를 말하지 않는다 — ${why}`, () => {
      expect(engineText(), `안내문에 "${word}" 가 남아 있다 (${why})`).not.toContain(word);
    });
  }

  it("미래가치는 지금 산식대로 말한다 — 고정 가중치 · 거리 등급", () => {
    const t = engineText();
    expect(t).toContain("고정 가중치");
    // 세션520: 도시축 출처가 LH 사업지구 하나가 아니게 됐다(네이버 지구단위 135건 합류).
    // "LH 사업지구까지 거리" 라고 못 박으면 그 135건을 안 세는 것처럼 말하는 셈이라 "개발지구" 로
    // 넓혔다 — 재는 것만 말한다는 이 파일의 원칙 그대로다.
    expect(t).toContain("개발지구");
    expect(t).toContain("산업단지");
  });

  it("혜택은 채워진 항목만 말하고, 나머지는 대기 중이라고 말한다", () => {
    expect(engineText()).toContain("자료가 확보되면");
  });

  // ⚠️ KTX 는 입지 축(ktxDist)이 실제로 재는 값이라 파일 전체에는 1회 남아 있는 게 정상이다.
  //    `not.toContain("KTX")` 같은 전면 금지 단언을 쓰면 참인 문장을 지우게 된다.
  it("입지 축의 KTX 설명은 그대로 남는다 (입지는 실제로 KTX 거리를 잰다)", () => {
    expect(engineText()).toContain("KTX");
  });
});
