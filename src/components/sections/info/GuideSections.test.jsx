// @ts-check
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { GuideSections } from "./GuideSections";

/**
 * 손님용 안내문이 **화면과 어긋나지 않는지** 지키는 가드 (세션 487 PR-4).
 *
 * 사고 기록 — 세션 409 에 레이더 차트를 없앴는데 안내문은 "모달에 레이더 차트가 있다"고
 * 계속 말하고 있었다. 화면에 없는 기능을 손님에게 안내하고 있었던 것이다.
 * 그 다음엔 PR-3 이 카테고리 점수 숫자를 등급 문자로 바꿨는데 안내문은 "바 차트로 점수가
 * 표시된다"고 남아 있었다. **UI 를 고칠 때 안내문을 같이 안 고치면 매번 이렇게 어긋난다.**
 *
 * 잔재 검사는 영어 식별자가 아니라 **손님이 실제로 읽는 한글 문구**로 한다
 * (세션 484 #268 에서 영어만 grep 해 놓치고 재발한 선례).
 */
describe("GuideSections — 없는 기능을 안내하지 않는다", () => {
  /** 화면에 실제로 렌더되는 글자 전체 */
  function guideText() {
    const { container } = render(<GuideSections />);
    return container.textContent || "";
  }

  const REMOVED = [
    ["레이더", "세션 409 에 제거된 기능"],
    ["바 차트", "PR-3 에서 등급 문자로 바뀜"],
  ];

  for (const [word, why] of REMOVED) {
    it(`"${word}" 를 안내하지 않는다 — ${why}`, () => {
      expect(guideText(), `안내문에 "${word}" 가 남아 있다 (${why})`).not.toContain(word);
    });
  }

  it("지금 화면에 있는 것은 안내한다 — 지역 비교 막대·등급 문자", () => {
    const t = guideText();
    expect(t).toContain("평당가");
    expect(t).toContain("오른쪽으로 길수록");
    expect(t).toContain("등급 문자");
  });

  it("막대 읽는 규칙이 한 문장으로 들어 있다 (외울 게 하나여야 한다)", () => {
    expect(guideText()).toMatch(/막대가 오른쪽으로 길수록 이 단지가 유리/);
  });

  it("자료 없음 표시(회색 빗금)도 설명한다", () => {
    expect(guideText()).toContain("회색 빗금");
  });
});
