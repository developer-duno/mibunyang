// 지도 인프라 오버레이 카테고리 정의 — 순수 상수(SDK·React 무관, 세션 448).
// InfraOverlay 가 카카오 Places categorySearch 로 검색. 단일 출처 — 코드·반경·이모지를 여기서만 관리.
// 카카오 카테고리 그룹 코드: apis.map.kakao.com 공식. 반경은 카테고리 체감별 차등(편의점/카페 좁게, 마트/지하철 넓게).

export interface InfraCategory {
  key: string;
  label: string;
  /** 카카오 카테고리 그룹 코드 (categorySearch 용) */
  code: string;
  emoji: string;
  /** 검색 반경(m) */
  radius: number;
}

export const INFRA_CATEGORIES: InfraCategory[] = [
  { key: "subway", label: "지하철", code: "SW8", emoji: "🚇", radius: 1500 },
  { key: "hospital", label: "병원", code: "HP8", emoji: "🏥", radius: 1000 },
  { key: "mart", label: "마트", code: "MT1", emoji: "🛒", radius: 1500 },
  { key: "school", label: "학교", code: "SC4", emoji: "🏫", radius: 1000 },
  { key: "academy", label: "학원", code: "AC5", emoji: "📚", radius: 1000 },
  { key: "conv", label: "편의점", code: "CS2", emoji: "🏪", radius: 500 },
  { key: "pharmacy", label: "약국", code: "PM9", emoji: "💊", radius: 800 },
  { key: "cafe", label: "카페", code: "CE7", emoji: "☕", radius: 500 },
];
