import type { Category } from "@/constants/profiles";
import type { Res } from "@/types/scoring";

// 카테고리 total → 상세 모달 종합 탭 미니카드의 "결론 1줄" 단일 출처 (세션 409 D2b).
// 임계 70/50 = gr()(theme/index.ts) 등급 경계(B+ >=70 / C >=50)와 inclusive >= 정렬 —
// 미니카드가 등급 배지와 결론 문구를 나란히 노출하므로 톤 모순을 0으로 맞춘다.
// 엔진/점수 로직은 무변경: 여기는 표현 계층(CatPanel 의 서브항목 interpret 과 달리 카테고리 total 용).
const VERDICT: Record<Category, (_t: number) => string> = {
  price: (t) => (t >= 70 ? "가격 매력 높음" : t >= 50 ? "가격 적정 수준" : "주변 대비 부담"),
  location: (t) => (t >= 70 ? "입지 우수" : t >= 50 ? "입지 양호" : "입지 아쉬움"),
  product: (t) => (t >= 70 ? "상품성 우수" : t >= 50 ? "상품성 무난" : "상품성 미흡"),
  risk: (t) => (t >= 70 ? "안전성 높음" : t >= 50 ? "안전성 보통" : "위험 요소 주의"),
  benefit: (t) => (t >= 70 ? "혜택 풍부" : t >= 50 ? "혜택 양호" : "혜택 적음"),
  future: (t) => (t >= 70 ? "미래가치 밝음" : t >= 50 ? "성장 잠재력 보통" : "미래가치 제한적"),
};

/**
 * 미니카드 결론 1줄.
 * - price 는 적정가 괴리(deviation) 실측을 우선 반영 (실증 근거). dev = (fairPrice - price)/fairPrice*100
 *   이라 양수 = 분양가가 적정가보다 쌈 (scorePrice.ts:127, DetailModal 핵심지표 색 규약과 동일).
 * - fairPrice > 0 이 "가격 데이터 보유"의 정직한 판별자 — 데이터 부재 분기(scorePrice.ts:116)만
 *   정확히 fairPrice=0 + deviation="0.0" 을 내므로, deviation 값만으로는 진짜 0% 괴리와 구분 불가.
 * - benefit 은 점수축 의미가 다름(할인 환산) — noData 면 점수 문구 대신 "혜택 정보 없음".
 */
export function catVerdict(k: string, cat: Res): string {
  if (k === "benefit" && cat.noData) return "혜택 정보 없음";
  if (k === "price") {
    const hasPriceData = (Number(cat.fairPrice) || 0) > 0;
    const d = cat.deviation != null ? Number(cat.deviation) : NaN;
    if (hasPriceData && Number.isFinite(d)) {
      if (d > 0) return `적정가 대비 ${Math.abs(d).toFixed(0)}% 저렴`;
      if (d < 0) return `적정가 대비 ${Math.abs(d).toFixed(0)}% 비쌈`;
      return "적정가 수준";
    }
  }
  const fn = VERDICT[k as Category];
  return fn ? fn(cat.total) : "—";
}
