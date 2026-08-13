import { PRODUCT_MAX as _PM, TRANSIT_OPEN } from "@/constants/scoringTiers";

// 소비자용 서브지표 해석 매핑 테이블
// 엔진(engine.js) 수정 없이 표현 계층에서만 활용
// 각 키는 engine.js subs[].name과 정확히 일치해야 함 (36개)

type Category = "price" | "location" | "product" | "benefit" | "risk" | "future";

export type SubInterpret = {
  interpret: ((_sc: number, _info?: string) => string) | null;
  benchmark: string | null;
};

/**
 * 미래가치 3축(교통·도시·산업개발)의 `info` 에 **실제 측정값이 담겼는지** 판정한다.
 *
 * ⚠️ 이 판정이 없으면 "값이 있는데 없다고 말하는" 거짓이 난다. 세션511이 세 축을
 * 키워드 이진(있음/없음)에서 **거리 등급제**로 바꾸면서 `"평택포승BIX 4.7km"` 처럼
 * **값은 있는데 점수는 낮은** 제3의 상태가 생겼는데, 판정 문구표는 점수만 보고 있었다.
 * 그 결과 704곳(정적 JSON 1,646 중 42.8%)이 실제 산업단지·개발지구를 옆에 두고도
 * "산업 호재 없음"·"개발 계획 없음"을 보고 있었다(세션512 실측).
 *
 * `scoreFuture` 는 값이 없을 때만 `"없음"` 을 넣는다(scoreFuture.ts `info: indStr || "없음"`).
 * 따라서 `"없음"` 이 아니면 측정값이 있는 것이다.
 */
const hasDevValue = (info?: string): info is string => !!info && info !== "없음";

export const SUB_CONTEXT: Record<Category, Record<string, SubInterpret>> = {
  price: {
    "적정가 괴리도": {
      interpret: (sc) => (sc >= 70 ? "주변 시세 대비 저렴" : sc >= 40 ? "적정 수준" : "주변 대비 비쌈"),
      benchmark: "±5% 이내 적정",
    },
    전세가율: {
      interpret: (sc) => (sc >= 70 ? "투자 안정성 높음" : sc >= 40 ? "보통 수준" : "전세가 낮아 주의"),
      benchmark: "70~80% 우수",
    },
    PIR: {
      interpret: (sc) => (sc >= 70 ? "소득 대비 부담 적음" : sc >= 40 ? "보통 부담" : "소득 대비 부담 큼"),
      benchmark: "3배 이하 우수",
    },
    PSR: {
      interpret: (sc) => (sc >= 70 ? "주변 대비 합리적" : sc >= 40 ? "시세 수준" : "주변 대비 고가"),
      benchmark: "0.85 이하 우수",
    },
    "데이터 신뢰도": {
      interpret: (sc) => (sc >= 70 ? "데이터 충분" : sc >= 40 ? "일부 추정치 포함" : "데이터 부족"),
      benchmark: "70% 이상 권장",
    },
    택지비비율: {
      interpret: (sc) => (sc >= 70 ? "택지비 비중 높아 가격 안정" : sc >= 40 ? "택지비 보통" : "건축비 비중 높아 주의"),
      benchmark: "60% 이상 안정",
    },
  },
  location: {
    교통: {
      interpret: (sc) => (sc >= 70 ? "대중교통 우수" : sc >= 40 ? "교통 보통" : "교통 불편"),
      benchmark: "역세권 500m 이내",
    },
    학군: {
      interpret: (sc) => (sc >= 70 ? "우수 학군" : sc >= 40 ? "보통 학군" : "학군 미흡"),
      benchmark: "우수 등급 이상",
    },
    생활인프라: {
      interpret: (sc) => (sc >= 70 ? "편의시설 풍부" : sc >= 40 ? "기본 인프라 갖춤" : "편의시설 부족"),
      benchmark: "병원3+, 마트2+",
    },
    자연환경: {
      interpret: (sc) => (sc >= 70 ? "환경 쾌적" : sc >= 40 ? "환경 보통" : "소음/조망 불리"),
      benchmark: "55dB 이하 쾌적",
    },
    혐오시설: {
      interpret: (sc) => (sc >= 70 ? "주변 깨끗" : sc >= 40 ? "소규모 시설 존재" : "혐오시설 근접 주의"),
      benchmark: "없음이 최적",
    },
  },
  product: {
    브랜드: {
      interpret: (sc) => (sc >= 15 ? "1군 브랜드" : sc >= 10 ? "2군 브랜드" : "중소 건설사"),
      benchmark: "1군 15점+",
    },
    세대수: {
      interpret: (sc) => (sc >= 13 ? "대단지" : sc >= 7 ? "중규모" : "소규모 단지"),
      benchmark: "1,000세대+ 대단지",
    },
    주차: {
      interpret: (sc) => (sc >= 12 ? "주차 여유" : sc >= 8 ? "주차 보통" : "주차 부족"),
      benchmark: "1.3대/세대 이상",
    },
    용적률: {
      interpret: (sc) => (sc >= 7 ? "쾌적한 밀도" : sc >= 5 ? "보통 밀도" : "과밀 우려"),
      benchmark: "200% 이하 쾌적",
    },
    에너지: {
      interpret: (sc) => (sc >= 7 ? "고효율 에너지" : sc >= 5 ? "보통 효율" : "에너지 효율 낮음"),
      benchmark: "1등급 최우수",
    },
    전용률: {
      interpret: (sc) => (sc >= 8 ? "실사용 면적 넓음" : sc >= 6 ? "전용률 보통" : "전용률 낮음"),
      benchmark: "80%+ 우수",
    },
    평면: {
      interpret: (sc) => (sc >= 7 ? "우수 평면 구조" : sc >= 5 ? "보통 평면" : "평면 아쉬움"),
      benchmark: "판상형 4Bay 최적",
    },
    내진: {
      interpret: (sc) => (sc >= 5 ? "내진설계 적용" : "내진설계 미적용"),
      benchmark: "적용 필수",
    },
    구조: {
      interpret: (sc) => (sc >= 4 ? "고층 조망 유리" : sc >= 3 ? "중층 규모" : "저층 규모"),
      benchmark: "25층+ 고층",
    },
  },
  // benefit: 도트/해석 미적용 (score가 비례 배분값이므로 info 직접 표시)
  benefit: {
    "분양가 할인": { interpret: null, benchmark: null },
    "중도금 무이자": { interpret: null, benchmark: null },
    "옵션 무상": { interpret: null, benchmark: null },
    "발코니 확장": { interpret: null, benchmark: null },
    캐시백: { interpret: null, benchmark: null },
    "관리비 절감": { interpret: null, benchmark: null },
  },
  risk: {
    미분양률: {
      interpret: (sc) => (sc >= 70 ? "분양 순조" : sc >= 40 ? "미분양 주의" : "미분양 심각"),
      benchmark: "5% 이하 안전",
    },
    거래량: {
      interpret: (sc) => (sc >= 70 ? "거래 활발" : sc >= 40 ? "거래 보통" : "거래 침체"),
      benchmark: "6개월 30건+ 활발",
    },
    "대출/잔금": {
      interpret: (sc) => (sc >= 70 ? "대출 양호" : sc >= 40 ? "대출 보통" : "대출 부담 주의"),
      benchmark: "DSR 40% 이내",
    },
    "시공사 재무": {
      interpret: (sc) => (sc >= 70 ? "재무 안정" : sc >= 40 ? "재무 보통" : "재무 리스크 주의"),
      benchmark: "AA등급, 부채비율 150% 이하",
    },
    규제: {
      interpret: (sc) => (sc >= 70 ? "비규제 지역" : sc >= 40 ? "규제 일부" : "규제 지역 주의"),
      benchmark: "비규제 지역 유리",
    },
    공급량: {
      interpret: (sc) => (sc >= 70 ? "공급 적정" : sc >= 40 ? "공급 보통" : "공급 과잉 주의"),
      benchmark: "공급비율 100% 이하",
    },
    시장환경: {
      interpret: (sc) => (sc >= 70 ? "시장 호조" : sc >= 40 ? "시장 보합" : "시장 침체 주의"),
      benchmark: "인구 증가 지역",
    },
    경쟁률: {
      interpret: (sc) => (sc >= 70 ? "청약 인기" : sc >= 40 ? "경쟁 보통" : "미달 주의"),
      benchmark: "3:1 이상 인기",
    },
    계약해제율: {
      interpret: (sc) => (sc >= 70 ? "계약 해제 적음" : sc >= 40 ? "해제율 보통" : "계약 해제 주의"),
      benchmark: "3% 이하 안전",
    },
    "치안 안전": {
      interpret: (sc) => (sc >= 70 ? "치안 우수 지역" : sc >= 40 ? "치안 보통" : "치안 취약 주의"),
      benchmark: "1~2등급 안전",
    },
    초기분양률: {
      interpret: (sc) => (sc >= 70 ? "초기 분양 순조" : sc >= 40 ? "초기 분양 보통" : "초기 분양 저조 주의"),
      benchmark: "90% 이상 안전",
    },
  },
  // ⚠️ 미래가치 3축(교통·도시·산업개발)은 세션511부터 **거리**를 잰다. 그래서 문구도 거리로 말한다.
  //    옛 문구("대규모 개발"·"산업 유입 활발")는 축이 이름 키워드를 훑던 시절의 것이라,
  //    지금은 우리가 재지도 않은 규모·유입을 주장하는 셈이었다. `hasDevValue` 주석 참조.
  future: {
    교통개발: {
      interpret: (sc, info) =>
        !hasDevValue(info)
          ? "계획 노선 없음"
          : // 개통한 역은 입지 축(지하철 거리)이 이미 세므로 미래가치는 0점이다 — 그 0을 "없음"이라
            // 말하면 거짓이 된다(scoreFuture.ts 의 TRANSIT_OPEN 분기와 같은 자리).
            TRANSIT_OPEN.some((s) => info.includes(s))
            ? "이미 개통 — 입지 점수에 반영"
            : sc >= 70
              ? "대형 교통 호재 인접"
              : sc >= 40
                ? "교통 개발 진행"
                : "계획역 멀어 약함",
      benchmark: "착공·공사중 + 가까울수록 높음",
    },
    도시개발: {
      interpret: (sc, info) =>
        !hasDevValue(info)
          ? "반경 5km 내 개발지구 없음"
          : sc >= 70
            ? "개발지구 매우 가까움"
            : sc >= 40
              ? "개발지구 가까움"
              : "개발지구 멀어 약함",
      benchmark: "500m 이내 만점",
    },
    인구: {
      interpret: (sc) => (sc >= 70 ? "인구 유입 활발" : sc >= 40 ? "인구 보합" : "인구 유출 주의"),
      benchmark: "인구 증가율 +0.5%+",
    },
    산업개발: {
      interpret: (sc, info) =>
        !hasDevValue(info)
          ? "반경 5km 내 산업단지 없음"
          : sc >= 70
            ? "산업단지 매우 가까움"
            : sc >= 40
              ? "산업단지 가까움"
              : "산업단지 멀어 약함",
      benchmark: "1km 이내 만점",
    },
  },
};

// scoreProduct 서브별 최대 점수 (시각화 정규화용)
// 단일 출처: scoringTiers.js PRODUCT_MAX (영어 키) → 한글 키 변환
const _KEY_MAP: Record<string, string> = {
  brand: "브랜드",
  unit: "세대수",
  parking: "주차",
  far: "용적률",
  energy: "에너지",
  exclusive: "전용률",
  layout: "평면",
  quake: "내진",
  structure: "구조",
};
export const PRODUCT_MAX: Record<string, number> = Object.fromEntries(
  Object.entries(_PM).map(([k, v]) => [_KEY_MAP[k], v])
);
