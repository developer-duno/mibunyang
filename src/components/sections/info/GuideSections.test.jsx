// @ts-check
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { PROFILES, getTopCats } from "@/constants/profiles";
import { GuideSections, CAT_LABEL } from "./GuideSections";

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

  /**
   * 세션 513 — 프로필 안내의 가중치 수치가 `PROFILES` 와 어긋나 있었다(16칸 중 7칸).
   * 여기서 **숫자를 적지 않는다** — 소스에서 읽어 렌더 결과와 대조한다.
   * 가중치를 바꾸면 가드가 저절로 따라오고, 안내문만 옛 리터럴로 되돌리면 빨개진다.
   */
  describe("프로필 안내 = PROFILES 파생", () => {
    for (const key of /** @type {import("@/constants/profiles").ProfileKey[]} */ (Object.keys(PROFILES))) {
      it(`${key} — 상위 3개 카테고리 가중치가 PROFILES 와 일치`, () => {
        const w = PROFILES[key].w;
        const t = guideText();
        expect(t).toContain(PROFILES[key].name);
        for (const c of getTopCats(w, 3)) {
          const want = `${CAT_LABEL[c]} ${w[c]}%`;
          expect(t, `${key} 안내문에 "${want}" 가 없다 (손으로 적은 옛 수치로 되돌아갔나?)`).toContain(want);
        }
      });
    }

    // ⚠️ benefit 가중치는 5개 프로필 전부 0 이다(profiles.ts 주석). 되살리는 날
    //    (그 주석의 ① 단계)에는 이 가드도 함께 갱신할 것 — 그때는 "혜택 N%" 가 참이 된다.
    it('"혜택 N%" 를 말하지 않는다 — benefit 가중치가 전부 0 인 동안은 거짓', () => {
      expect(guideText()).not.toMatch(/혜택\s*\(?\d+%/);
    });
  });

  describe("혜택 문구 = 코드가 실제로 보는 것만", () => {
    // 카드가 그리는 라벨은 `res.cats.benefit?.wonSource || "혜택"` 이다 (세션 512).
    it('"총 혜택 금액" 이라 말하지 않는다', () => {
      expect(guideText()).not.toContain("총 혜택 금액");
    });

    // 혜택 필터 판정은 `filterEngine.ts` 의 `totalWon > 0` 하나뿐.
    it("혜택 필터를 금액 유무로 설명한다", () => {
      expect(guideText()).toContain("혜택 금액이 있는 단지");
    });
  });

  // JS 문자열 안의 &apos; 는 JSX 엔티티로 해석되지 않고 화면에 글자 그대로 찍힌다
  // (세션 513 화면 실측 — 검색·최소점수·혜택필터·관심매물 4곳이 실제로 깨져 있었다).
  // JSX 본문의 &apos; 는 파싱돼 textContent 에 안 나오므로 이 가드는 깨진 것만 잡는다.
  it('"&apos;" 가 손님 화면에 글자 그대로 찍히지 않는다', () => {
    expect(guideText()).not.toContain("&apos;");
  });
});
