import { gr, SHORT_LABEL } from "@/theme";
import type { Category } from "@/constants/profiles";
import type { Cats } from "@/types/scoring";

// 종합 탭 "판정 한 줄" — 세션508 PR-3a A1. `ProfileWeightBar` 의 강점(최고 total)·보완(최저 total)
// 판정 로직(benefit noData 제외)을 그대로 옮겼다 — ProfileWeightBar 는 profile && !blind 일 때만
// 떠서 비로그인·프로필 미선택 손님은 결론 문장을 못 봤다. 이 판정 한 줄이 상위 개념이라 항상 뜬다.
//
// ⚠️ 세션526 전제 갱신: 이 함수는 **여전히 가중치를 안 본다**(최고/최저 total 만 본다). 다만 입력
// `cats` 의 `location.total` 이 이제 프로필별(`PROFILES[*].locW`)로 달라질 수 있어, 같은 단지라도
// 프로필에 따라 판정 한 줄이 달라질 수 있다. "cats 는 프로필과 무관"이라는 옛 전제는 더 이상 참이 아니다.
//
// 문구는 점수 서술에 한정한다 — "사도 된다/좋다/추천" 류는 투자 조언으로 읽힐 수 있어 금지.
//
// benefit 은 후보에서 완전히 제외한다(2026-08-11) — PROFILES 5개 전부 가중치 0(constants/profiles.ts)
// 이라 더 이상 "점수 카테고리"가 아니다. total(0~100 원점수)이 마침 최고/최저였다는 이유로
// "혜택 강점/보완"이라 말하면, 실제 종합 점수에는 0% 기여했는데 강점처럼 읽히는 거짓이 된다.
// 옛 로직은 noData 일 때만 걸렀는데, 이제는 noData 여부와 무관하게 항상 제외한다.
const CAT_KEYS: Category[] = ["location", "product", "price", "risk", "future"];

function shortLabel(label?: string): string {
  return (SHORT_LABEL as Record<string, string>)[label ?? ""] || label || "";
}

/**
 * `${등급}등급 — ${최고 강점} 강점 · ${최저 보완} 보완`.
 *
 * - blind(비로그인) 판단은 호출부(DetailModal) 소관 — 이 함수는 점수 유무만 본다.
 * - 슬림 catsCache(subs=[]·cats 비어 있음) 대비: total 이 없거나 후보가 0개면 null.
 *   호출부가 렌더를 생략해야 NaN·"—등급" 같은 거짓 표시가 안 생긴다.
 */
export function aptVerdict(total: number | null | undefined, cats: Cats | null | undefined): string | null {
  if (total == null || !cats) return null;
  const candidates = CAT_KEYS.map((k) => ({ k, cat: cats[k] })).filter(({ cat }) => cat != null);
  if (candidates.length === 0) return null;
  const best = candidates.reduce((a, b) => (b.cat.total > a.cat.total ? b : a));
  const worst = candidates.reduce((a, b) => (b.cat.total < a.cat.total ? b : a));
  return `${gr(total).l}등급 — ${shortLabel(best.cat.label)} 강점 · ${shortLabel(worst.cat.label)} 보완`;
}
