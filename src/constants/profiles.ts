export type Category = "location" | "product" | "price" | "risk" | "benefit" | "future";

export type ProfileKey = "live" | "invest" | "newlywed" | "edu" | "retire";

import type { LocationSubWeights } from "@/constants/scoringTiers";

export type Profile = {
  name: string;
  desc: string;
  w: Record<Category, number>;
  /**
   * 입지 5서브 비중 오버라이드 (합 1.00). 없으면 `LOCATION_SUB_WEIGHTS`(기준 비중)를 쓴다.
   * 카테고리 축(`w`)만으로는 프로필이 갈리지 않아 세션526에 추가한 두 번째 축이다.
   */
  locW?: LocationSubWeights;
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
/**
 * 세션526 — 프로필 변별력 수술 (가 + 나). 근거·시뮬 전문:
 * `docs/superpowers/specs/2026-08-24-profile-discrimination-remeasure.md`
 *
 * 문제: 손님이 프로필을 바꿔도 추천이 거의 같았다. 실거주–자녀교육 피어슨 상관 **0.992**,
 * 상위10 겹침 **9/10** — "프로필을 고르는 의미"가 사실상 없었다. 세션525의 학군 재척도로
 * 재료(학군 sd 12.5→27.6)는 좋아졌는데 상관은 오히려 올랐다(0.989→0.992). 즉 원인은
 * 데이터가 아니라 **구조**였다 — ① 카테고리 가중치가 프로필끼리 거의 평행하고
 * ② 입지 내부 5서브 비중이 전 프로필 공통이라, 입지를 아무리 크게 줘도 "같은 입지 점수"를
 * 크게 곱할 뿐 순위가 안 바뀌었다.
 *
 * 수술 (가) 카테고리 가중치 — edu·retire 만 벌린다(live/invest/newlywed 무변경):
 *   - edu:    location 50→**70**, product 20→10, price 15→10, risk 10→5 (future 5 유지)
 *   - retire: location 35→**25**, product 30→**45**, price 20→15, risk 15 유지 (future 0 유지)
 * 수술 (나) 입지 내부 비중 `locW` — 프로필이 "입지의 무엇을" 보는지 갈라준다.
 *   같은 입지 총점을 곱하던 것을 **다른 입지 총점**으로 만드는 축이라 (가)만으로는 안 되던
 *   순위 분리가 일어난다. live/invest 는 기준 비중(`LOCATION_SUB_WEIGHTS`) 그대로.
 *
 * 시뮬 결과(정적 JSON 기준): 실거주–자녀교육 0.992 → **0.906**,
 * 자녀교육–은퇴 0.958 → **0.560**, 10쌍 평균 상위50 겹침 63% → **48%**.
 *
 * 되돌리는 방법: edu.w = {location:50,product:20,price:15,risk:10,benefit:0,future:5},
 * retire.w = {location:35,product:30,price:20,risk:15,benefit:0,future:0}, 그리고 아래
 * `locW` 3개를 지운다(지우면 전 프로필이 기준 비중으로 복귀 — 옛 동작과 동일).
 * ⚠️ locW 를 지울 땐 FAQSection.tsx 의 서브 비중 문장도 함께 지울 것 — `locW?.school ?? 0`
 * 가드라 크래시는 없지만 "학군(0%)" 같은 거짓 문구가 조용히 남는다(문구-산식 한 쌍 룰).
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
    // 아이가 아직 없거나 어린 단계 — 학군 비중을 낮추고 출퇴근(교통)·생활편의(인프라)를 올린다.
    locW: { transport: 0.3, school: 0.15, infra: 0.3, env: 0.1, noxSafe: 0.15 },
  },
  edu: {
    name: "자녀교육",
    desc: "학군 최우선",
    w: { location: 70, product: 10, price: 10, risk: 5, benefit: 0, future: 5 },
    // "학군 최우선"이라는 이름값을 실제 산식에 반영한다 — 입지의 절반 이상을 학군에 준다.
    locW: { transport: 0.15, school: 0.55, infra: 0.15, env: 0.05, noxSafe: 0.1 },
  },
  retire: {
    name: "은퇴",
    desc: "편안한 노후",
    w: { location: 25, product: 45, price: 15, risk: 15, benefit: 0, future: 0 },
    // 통학·통근이 끝난 단계 — 학군은 최소로, 의료·편의(인프라)와 조용·쾌적(자연환경)을 크게.
    locW: { transport: 0.15, school: 0.05, infra: 0.3, env: 0.3, noxSafe: 0.2 },
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
