/**
 * 수집기 영어명 → 한글 라벨 매핑 (수집기 모니터링 화면용).
 *
 * 키는 collector_runs / api_quota_log 에 기록되는 collector 문자열.
 * 매핑에 없는 수집기는 영어 이름을 그대로 노출한다 (fallback).
 */
const COLLECTOR_LABELS: Record<string, string> = {
  "air-quality": "대기질",
  "applyhome": "청약홈 분양정보",
  "avg-income": "지역 평균소득",
  "childcare-detail": "어린이집 상세",
  "childcare-info": "어린이집 정보",
  "collect-building-hub": "건축물대장",
  "collect-maintenance": "관리비",
  "collect-trades": "실거래가",
  "emergency": "응급의료시설",
  "housing-permits": "주택 인허가",
  "kosis-housing-supply-ratio": "주택보급률",
  "kosis-unsold": "미분양 통계",
  "market-stats": "주택시장 통계",
  "migration": "인구 순이동",
  "molit-building-info": "건축물 정보",
  "molit-units": "단지 세대수",
  "population": "인구",
  "population-sex-age": "성·연령별 인구",
  "schools": "학교 정보",
  "transport-tago": "대중교통",
  "naver-listings": "네이버 매물",
  "naver-presale": "네이버 분양정보",
  "dart-builders": "시공사 재무",
  "infra-kakao": "주변 인프라",
  "crime-safety": "치안 안전",
};

/** 수집기 영어명을 한글 라벨로. 매핑에 없으면 영어 그대로 반환. */
export function collectorLabel(name: string): string {
  return COLLECTOR_LABELS[name] ?? name;
}

/**
 * 데이터 테이블명 → 한글 라벨 (데이터 갱신 시각 카드용).
 * collector-status API 의 dataFreshness 키와 1:1.
 */
const TABLE_LABELS: Record<string, string> = {
  apartments: "아파트",
  infra: "주변시설",
  schools: "학교",
  transport: "교통",
  builders: "시공사",
  trade_stats: "실거래 통계",
  regions: "지역 통계",
};

/** 테이블 영어명을 한글 라벨로. 매핑에 없으면 영어 그대로 반환. */
export function tableLabel(name: string): string {
  return TABLE_LABELS[name] ?? name;
}
