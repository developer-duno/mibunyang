// @ts-check
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { PROFILES, getTopCats } from "@/constants/profiles";
import { SORT_OPTIONS } from "@/constants/sortOptions";
import { FILTER_PRESETS } from "@/constants/filterPresets";
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

  // 세션539 A-5① — 옛 "정렬 (12가지)"는 손 적힌 숫자였다. 실제 SORT_OPTIONS 는 17개인데
  // 관리비순·치안안전·주차넉넉·병원가까움·공원가까움 5개가 안내에서 빠져 있었다.
  // useDataPipeline.ts:69-104 에 비교 함수가 이미 구현돼 있고 SortPanel.tsx 가 SORT_OPTIONS
  // 전체를 slice 없이 렌더하므로 드롭다운엔 17개가 다 뜬다 — 살아있는데 안내만 몰랐다.
  describe("정렬 안내 = SORT_OPTIONS 파생 (세션539 A-5①)", () => {
    it("정렬 안내 제목이 SORT_OPTIONS.length 를 그대로 담는다", () => {
      expect(guideText()).toContain(`정렬 (${SORT_OPTIONS.length}가지)`);
    });

    // 옛 리터럴 "12가지"로 되돌리면(또는 SORT_OPTIONS 가 늘어도 문구를 안 고치면) red.
    it('"정렬 (12가지)" 로 손 적힌 옛 문구가 아니다', () => {
      expect(guideText()).not.toContain("정렬 (12가지)");
    });

    it("SORT_OPTIONS 의 모든 정렬이 안내에 나타난다 — 관리비·치안안전·주차·병원·공원 포함", () => {
      const t = guideText();
      for (const o of SORT_OPTIONS) {
        // unsoldRate 는 GuideSections 안에서 pcLabel("미분양많은순")로 override 되어 뜬다.
        const expected = o.key === "unsoldRate" ? "미분양많은순" : o.mobileLabel;
        expect(t, `"${expected}"(${o.key}) 이 안내에 없다`).toContain(expected);
      }
    });
  });

  // 세션539 A-5② — 신혼부부 프리셋(areaMin:60·areaMax:85)을 "소형"이라 불러, 바로 위 면적·
  // 세대수 안내("소형(60㎡ 이하)")와 같은 화면에서 같은 단어가 두 정의를 갖는 자기모순이었다.
  describe("필터 프리셋 안내 = FILTER_PRESETS 파생 (세션539 A-5②)", () => {
    it("프리셋 개수·설명이 FILTER_PRESETS 에서 그대로 들어간다", () => {
      const t = guideText();
      expect(t).toContain(`${FILTER_PRESETS.length}가지`);
      for (const p of FILTER_PRESETS) {
        expect(t, `"${p.label}(${p.desc})" 가 안내에 없다`).toContain(`${p.label}(${p.desc})`);
      }
    });

    it("신혼부부 프리셋을 더 이상 '소형'이라 부르지 않는다 — 실제 범위(60~85㎡)와 어긋났다", () => {
      expect(guideText()).not.toMatch(/신혼부부\([^)]*소형/);
    });
  });

  // 세션539 A-6 후속 — 편차 스트립의 모집단 이름은 헤더·도움말·스크린리더·이 안내문 **네 곳**에
  // 손으로 적혀 있다. 대조군(`regionalStats.ts:90`)이 `region` 하나로만 묶어 오피스텔·재건축이
  // 섞이므로 "아파트"는 그 모집단을 잘못 부르는 이름이다. 한 곳만 고치면 화면이 두 말을 한다.
  describe("막대 안내의 모집단 이름 (세션539 A-6 후속)", () => {
    it('막대 3줄 설명이 "아파트들"이라고 모집단을 단정하지 않는다', () => {
      const t = guideText();
      expect(t).toMatch(/막대 3줄[\s\S]{0,80}분양 단지들의 한가운데 값/);
      expect(t).not.toMatch(/막대 3줄[\s\S]{0,80}아파트들의 한가운데 값/);
    });
  });
});
