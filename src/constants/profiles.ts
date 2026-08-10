export type Category = "location" | "product" | "price" | "risk" | "benefit" | "future";

export type ProfileKey = "live" | "invest" | "newlywed" | "edu" | "retire";

export type Profile = {
  name: string;
  desc: string;
  w: Record<Category, number>;
};

/**
 * benefit 가중치는 5개 프로필 전부 0 이다 (2026-08-11, 사장님 결정).
 *
 * 실측 근거(운영 스냅샷 n=1,646 — 세션에서 재실측, retry2.json): scoreBenefit() 서브지표 6종 중
 * 5종(분양가 할인·중도금 무이자·옵션 무상·발코니 확장·캐시백)은 **전 단지 채움 0건**이고, 유일하게
 * 채워지는 관리비 절감(maintSave)마저 카테고리 총점(sc)을 81.0%가 0점, 평균 0.24점(고유값 5개:
 * 0~4)으로 만든다. 상대평가(비교 엔진)에서 거의 전 단지가 동점인 지표는 순위를 바꾸지 못한 채
 * 점수만 균일하게 부풀린다 — 그래서 가중치를 0으로 낮춰 최종 점수 기여를 없앤다.
 *
 * 단, 데이터 자체(scoreBenefit() 의 totalWon/rate)는 지운 게 아니다 — 실제 혜택 금액이 있는
 * 단지가 520/1,646(31.6%, 중앙값 102만원)라 화면에는 "총 혜택 약 N만원" 같은 **사실 라벨**로
 * 남아 있다(DetailModal 종합 탭). "점수로는 못 쓰지만 있는 단지에는 있다고 알려준다"가 목표.
 *
 * 재분배 원칙 — 뺀 가중치는 그 프로필이 원래 가장 중시하던 축으로 보낸다(프로필 성격 유지):
 *   - live(입지 40 최우선)      → location 로
 *   - invest(가격30·안전25)     → price·risk 로 균등 분배
 *   - newlywed(입지30=가격30)   → price 로 (신혼은 자금 여력이 더 급한 축)
 *   - edu(입지 45 최우선)       → location 로
 *   - retire(상품 25, 입지 다음) → product 로 (은퇴는 사는 집 자체가 중요)
 * 5개 프로필 전부 합계는 여전히 100 (불변식, src/scoring/CLAUDE.md).
 *
 * 되살리는 방법(데이터가 채워지면) — scoreBenefit()·subs 6종·Cats.benefit 은 전부 그대로 남아있다.
 * ① 이 5개 profile.w 의 benefit 을 원하는 값으로 올리고 위 재분배분(location/price/risk/product)을
 *    그만큼 되돌려 합계 100 을 맞춘다(옛 값: live5·invest10·newlywed10·edu5·retire5).
 * ② `src/components/DetailModal.tsx` 의 `.filter(([k]) => k !== "benefit")` 2곳(미니카드·CatPanel
 *    score tab)을 지운다 — 그러면 benefit 이 다시 점수 카테고리 6개 중 하나로 보인다.
 * ③ `src/constants/aptVerdict.ts` 의 `CAT_KEYS` 에 "benefit" 을 다시 넣는다(강점/보완 후보 복귀).
 */
export const PROFILES: Record<ProfileKey, Profile> = {
  live: {
    name: "실거주",
    desc: "살기 좋은 곳",
    w: { location: 45, product: 20, price: 20, risk: 10, benefit: 0, future: 5 },
  },
  invest: {
    name: "투자",
    desc: "수익률 중심",
    w: { location: 15, product: 10, price: 35, risk: 30, benefit: 0, future: 10 },
  },
  newlywed: {
    name: "신혼부부",
    desc: "합리적 내 집",
    w: { location: 30, product: 15, price: 40, risk: 10, benefit: 0, future: 5 },
  },
  edu: {
    name: "자녀교육",
    desc: "학군 최우선",
    w: { location: 50, product: 20, price: 15, risk: 10, benefit: 0, future: 5 },
  },
  retire: {
    name: "은퇴",
    desc: "편안한 노후",
    w: { location: 35, product: 30, price: 20, risk: 15, benefit: 0, future: 0 },
  },
};

/**
 * 가중치 **동점 시 tie-break** 순서. 화면 표시 순서가 아니다.
 * 화면 순서는 `constants/catOrder.ts` 의 `CAT_DISPLAY_ORDER` — 순서가 서로 다르므로 혼동 금지.
 */
const CAT_TIEBREAK_ORDER: Category[] = ["location", "product", "price", "risk", "benefit", "future"];

/** PROFILES 가중치에서 상위 N 카테고리 key. 0점 제외 + 동점은 CAT_TIEBREAK_ORDER(선언 순서) 우선. */
export function getTopCats(w: Record<Category, number>, n = 2): Category[] {
  return CAT_TIEBREAK_ORDER.filter((c) => w[c] > 0)
    .sort((a, b) => w[b] - w[a] || CAT_TIEBREAK_ORDER.indexOf(a) - CAT_TIEBREAK_ORDER.indexOf(b))
    .slice(0, n);
}
