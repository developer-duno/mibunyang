// 소비자용 서브지표 해석 매핑 테이블
// 엔진(engine.js) 수정 없이 표현 계층에서만 활용
// 각 키는 engine.js subs[].name과 정확히 일치해야 함 (34개)

export const SUB_CONTEXT = {
  price: {
    "적정가 괴리도": {
      interpret: (sc) => sc >= 70 ? "주변 시세 대비 저렴" : sc >= 40 ? "적정 수준" : "주변 대비 비쌈",
      benchmark: "±5% 이내 적정",
    },
    "전세가율": {
      interpret: (sc) => sc >= 70 ? "투자 안정성 높음" : sc >= 40 ? "보통 수준" : "전세가 낮아 주의",
      benchmark: "70~80% 우수",
    },
    "PIR": {
      interpret: (sc) => sc >= 70 ? "소득 대비 부담 적음" : sc >= 40 ? "보통 부담" : "소득 대비 부담 큼",
      benchmark: "3배 이하 우수",
    },
    "PSR": {
      interpret: (sc) => sc >= 70 ? "주변 대비 합리적" : sc >= 40 ? "시세 수준" : "주변 대비 고가",
      benchmark: "0.85 이하 우수",
    },
    "데이터 신뢰도": {
      interpret: (sc) => sc >= 70 ? "데이터 충분" : sc >= 40 ? "일부 추정치 포함" : "데이터 부족",
      benchmark: "70% 이상 권장",
    },
  },
  location: {
    "교통": {
      interpret: (sc) => sc >= 70 ? "대중교통 우수" : sc >= 40 ? "교통 보통" : "교통 불편",
      benchmark: "역세권 500m 이내",
    },
    "학군": {
      interpret: (sc) => sc >= 70 ? "우수 학군" : sc >= 40 ? "보통 학군" : "학군 미흡",
      benchmark: "우수 등급 이상",
    },
    "생활인프라": {
      interpret: (sc) => sc >= 70 ? "편의시설 풍부" : sc >= 40 ? "기본 인프라 갖춤" : "편의시설 부족",
      benchmark: "병원3+, 마트2+",
    },
    "자연환경": {
      interpret: (sc) => sc >= 70 ? "환경 쾌적" : sc >= 40 ? "환경 보통" : "소음/조망 불리",
      benchmark: "55dB 이하 쾌적",
    },
    "혐오시설": {
      interpret: (sc) => sc >= 70 ? "주변 깨끗" : sc >= 40 ? "소규모 시설 존재" : "혐오시설 근접 주의",
      benchmark: "없음이 최적",
    },
  },
  product: {
    "브랜드": {
      interpret: (sc) => sc >= 15 ? "1군 브랜드" : sc >= 10 ? "2군 브랜드" : "중소 건설사",
      benchmark: "1군 15점+",
    },
    "세대수": {
      interpret: (sc) => sc >= 13 ? "대단지" : sc >= 7 ? "중규모" : "소규모 단지",
      benchmark: "1,000세대+ 대단지",
    },
    "주차": {
      interpret: (sc) => sc >= 12 ? "주차 여유" : sc >= 8 ? "주차 보통" : "주차 부족",
      benchmark: "1.3대/세대 이상",
    },
    "용적률": {
      interpret: (sc) => sc >= 7 ? "쾌적한 밀도" : sc >= 5 ? "보통 밀도" : "과밀 우려",
      benchmark: "200% 이하 쾌적",
    },
    "에너지": {
      interpret: (sc) => sc >= 7 ? "고효율 에너지" : sc >= 5 ? "보통 효율" : "에너지 효율 낮음",
      benchmark: "1등급 최우수",
    },
    "전용률": {
      interpret: (sc) => sc >= 8 ? "실사용 면적 넓음" : sc >= 6 ? "전용률 보통" : "전용률 낮음",
      benchmark: "80%+ 우수",
    },
    "평면": {
      interpret: (sc) => sc >= 7 ? "우수 평면 구조" : sc >= 5 ? "보통 평면" : "평면 아쉬움",
      benchmark: "판상형 4Bay 최적",
    },
    "내진": {
      interpret: (sc) => sc >= 5 ? "내진설계 적용" : "내진설계 미적용",
      benchmark: "적용 필수",
    },
    "구조": {
      interpret: (sc) => sc >= 4 ? "고층 조망 유리" : sc >= 3 ? "중층 규모" : "저층 규모",
      benchmark: "25층+ 고층",
    },
  },
  // benefit: 도트/해석 미적용 (score가 비례 배분값이므로 info 직접 표시)
  benefit: {
    "분양가 할인": { interpret: null, benchmark: null },
    "중도금 무이자": { interpret: null, benchmark: null },
    "옵션 무상": { interpret: null, benchmark: null },
    "발코니 확장": { interpret: null, benchmark: null },
    "캐시백": { interpret: null, benchmark: null },
  },
  risk: {
    "미분양률": {
      interpret: (sc) => sc >= 70 ? "분양 순조" : sc >= 40 ? "미분양 주의" : "미분양 심각",
      benchmark: "5% 이하 안전",
    },
    "거래량": {
      interpret: (sc) => sc >= 70 ? "거래 활발" : sc >= 40 ? "거래 보통" : "거래 침체",
      benchmark: "6개월 30건+ 활발",
    },
    "대출/잔금": {
      interpret: (sc) => sc >= 70 ? "대출 양호" : sc >= 40 ? "대출 보통" : "대출 부담 주의",
      benchmark: "DSR 40% 이내",
    },
    "시공사 재무": {
      interpret: (sc) => sc >= 70 ? "재무 안정" : sc >= 40 ? "재무 보통" : "재무 리스크 주의",
      benchmark: "AA등급, 부채비율 150% 이하",
    },
    "규제": {
      interpret: (sc) => sc >= 70 ? "비규제 지역" : sc >= 40 ? "규제 일부" : "규제 지역 주의",
      benchmark: "비규제 지역 유리",
    },
    "공급량": {
      interpret: (sc) => sc >= 70 ? "공급 적정" : sc >= 40 ? "공급 보통" : "공급 과잉 주의",
      benchmark: "공급비율 100% 이하",
    },
    "시장환경": {
      interpret: (sc) => sc >= 70 ? "시장 호조" : sc >= 40 ? "시장 보합" : "시장 침체 주의",
      benchmark: "인구 증가 지역",
    },
    "경쟁률": {
      interpret: (sc) => sc >= 70 ? "청약 인기" : sc >= 40 ? "경쟁 보통" : "미달 주의",
      benchmark: "3:1 이상 인기",
    },
    "계약해제율": {
      interpret: (sc) => sc >= 70 ? "계약 해제 적음" : sc >= 40 ? "해제율 보통" : "계약 해제 주의",
      benchmark: "3% 이하 안전",
    },
  },
  future: {
    "교통개발": {
      interpret: (sc) => sc >= 70 ? "대형 교통 호재" : sc >= 40 ? "교통 개발 진행" : "교통 호재 없음",
      benchmark: "착공/기존 노선 인접",
    },
    "도시개발": {
      interpret: (sc) => sc >= 70 ? "대규모 개발" : sc >= 40 ? "중규모 개발" : "개발 계획 없음",
      benchmark: "신도시/테크노밸리급",
    },
    "인구/산업": {
      interpret: (sc) => sc >= 70 ? "인구 유입 활발" : sc >= 40 ? "인구 보합" : "인구 유출 주의",
      benchmark: "인구 증가율 +0.5%+",
    },
  },
};

// scoreProduct 서브별 최대 점수 (시각화 정규화용)
// 출처: engine.js scoreProduct maxPossible = 20+15+15+10+10+10+10+5+5
export const PRODUCT_MAX = {
  "브랜드": 20, "세대수": 15, "주차": 15, "용적률": 10,
  "에너지": 10, "전용률": 10, "평면": 10, "내진": 5, "구조": 5,
};
