import { memo } from "react";
import { CITY_TIER } from "@/constants/regions";
import { C } from "@/theme";

const cardStyle = { background: C.card, borderRadius: 12, padding: 14, border: `1px solid ${C.border}`, boxShadow: "0 1px 3px rgba(0,0,0,0.04)", marginBottom: 12 };
const titleStyle = { fontSize: 15, fontWeight: 800, color: C.text, marginBottom: 10 };
const titleBlue = { ...titleStyle, color: C.blue };
const guideItem = { marginBottom: 10 };
const guideTitle = { fontSize: 13, fontWeight: 700, color: C.text };
const guideDesc = { fontSize: 12, color: C.sub, lineHeight: 1.6, marginTop: 2 };
const divider = { borderTop: `1px solid ${C.border}`, marginTop: 10, paddingTop: 10 };

/**
 * InfoPage - 스코어링 엔진 구조 + 소비자용 사용 가이드 + FAQ
 * Props:
 *   expertLoggedIn: boolean - 전문가 로그인 상태
 *   onExpertLoginClick: () => void - 전문가 로그인 탭 이동
 */
export const InfoPage = memo(function InfoPage({ expertLoggedIn, onExpertLoginClick }) {
  return (
    <div style={{ padding: "0 16px", maxWidth: 640, margin: "0 auto" }}>
      {/* 스코어링 엔진 구조 (기존) */}
      <div style={cardStyle}>
        <div style={titleStyle}>스코어링 엔진 구조</div>
        {[
          { title: "가격 매력도", desc: "적정가괴리도(신축프리미엄·면적·브랜드 보정) + 전세가율 + PIR(소득대비) + PSR(분양가/시세) + 데이터신뢰도" },
          { title: "입지·생활권", desc: "교통접근성(도시등급별 보정: 특별시↔군 지하철·버스·IC·KTX 가중치 자동 조정) + 학군 + 생활인프라(8개 카테고리) + 환경 + 혐오시설" },
          { title: "상품성", desc: "브랜드티어(4단계) + 세대수 + 주차비 + 용적률 + 에너지등급 + 전용률 + 평면구조 + 내진설계 + 구조(층수)" },
          { title: "혜택·할인", desc: "원화환산(분양가할인 + 중도금무이자 + 옵션무상 + 발코니확장 + 캐시백) ÷ 분양가" },
          { title: "안전도", desc: "미분양률 + 거래량 + 대출/잔금(DSR) + 시공사재무(DART) + 규제 + 공급파이프라인 + 시장환경" },
          { title: "미래가치", desc: "교통개발(GTX·KTX·광역철도) + 도시개발 + 인구/산업유입" },
        ].map((item, i) => (
          <div key={i} style={guideItem}>
            <div style={guideTitle}>{item.title}</div>
            <div style={guideDesc}>{item.desc}</div>
          </div>
        ))}

        <div style={divider}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.blue, marginBottom: 6 }}>도시등급별 교통 보정 (NEW)</div>
          <div style={{ fontSize: 11, color: C.sub, lineHeight: 1.6 }}>
            {Object.entries(CITY_TIER).map(([k, v]) =>
              `${v.label}(${k}): 지하철×${v.subwayW} 버스×${v.busW} IC×${v.icW} KTX×${v.ktxW}`
            ).join(" | ")}
          </div>
        </div>

        <div style={divider}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 4 }}>학술 기반</div>
          <div style={{ fontSize: 11, color: C.sub, lineHeight: 1.6 }}>
            AHP 계층분석법(황규성·장형진 2016) · 헤도닉 가격모형 · 한국부동산원 공시가격 조사체계 · 국토연구원 GTX 영향 분석(2024) · 하자심사분쟁조정위 데이터
          </div>
        </div>
      </div>

      {/* 소비자용 사용 가이드 */}
      <div style={cardStyle}>
        <div style={titleBlue}>사용 가이드</div>
        {[
          { title: "검색·필터", desc: "상단 검색창에 단지명, 건설사, 지역명을 입력하세요. 초성 검색도 지원합니다(예: 'ㅎㄴ' → 한남). 시/도와 시군구 드롭다운으로 지역을 좁히고, 예산 범위(억 단위)를 설정하면 조건에 맞는 단지만 표시됩니다." },
          { title: "프로필 선택", desc: "상단 5개 버튼으로 분석 관점을 전환합니다. 실거주(입지 중심), 투자(가격·안전 중심), 신혼(가격·입지 균형), 교육(학군 중심), 은퇴(입지·상품 중심). 프로필에 따라 같은 단지도 순위가 달라집니다." },
          { title: "정렬", desc: "종합(현재 프로필 총점), 저가순(분양가 낮은 순), 가격매력(시세 대비 저평가), 입지(생활편의·교통), 안전(리스크 낮은 순) 5가지로 정렬할 수 있습니다." },
          { title: "단지 카드", desc: "각 카드에는 종합점수, 등급(S/A/B/C/D), 6개 카테고리 점수, 분양가, 지역, 혜택이 표시됩니다. 카드를 터치하면 상세 분석 모달이 열립니다." },
          { title: "비교 기능", desc: "카드 우측 체크 아이콘을 눌러 2~4개 단지를 선택한 뒤, 하단 '비교' 탭을 누르면 나란히 비교할 수 있습니다. 카테고리별 점수 차이를 한눈에 확인하세요." },
          { title: "즐겨찾기", desc: "카드 좌측 하트 아이콘으로 관심 단지를 저장합니다. 즐겨찾기는 브라우저에 저장되어 다음 방문 시에도 유지됩니다." },
          { title: "상세 분석", desc: "카드를 터치하면 인근 시세(매매/전세), 학군 정보, 대출 분석(LTV/DSR/갭투자), 공공데이터 상세가 모달로 표시됩니다." },
          { title: "상담 신청", desc: "하단 '상담' 탭에서 이름, 연락처, 관심 단지, 예산, 상담 유형을 입력하고 신청하세요. 파트너 전문가가 확인 후 연락드립니다." },
        ].map((item, i) => (
          <div key={i} style={guideItem}>
            <div style={guideTitle}>{item.title}</div>
            <div style={guideDesc}>{item.desc}</div>
          </div>
        ))}
      </div>

      {/* FAQ */}
      <div style={cardStyle}>
        <div style={titleStyle}>자주 묻는 질문</div>
        {[
          { q: "점수는 어떻게 산출되나요?", a: "6개 카테고리(가격·입지·상품·혜택·안전·미래)별 점수를 AHP 계층분석법으로 가중 합산합니다. 34개 이상의 공공데이터·실거래·네이버 시세를 기반으로 0~100점 척도로 산출됩니다." },
          { q: "데이터는 얼마나 자주 업데이트되나요?", a: "미분양 현황과 네이버 시세는 매일, 실거래가는 매월 1/15일, 인구·인프라·학교 등은 매월 자동 수집됩니다. 마지막 업데이트 일시는 목록 상단에 표시됩니다." },
          { q: "S/A/B/C/D 등급의 기준은?", a: "S등급 90점 이상, A등급 80~89점, B등급 65~79점, C등급 50~64점, D등급 50점 미만입니다. 등급은 선택한 프로필에 따라 달라질 수 있습니다." },
          { q: "프로필마다 순위가 다른 이유는?", a: "프로필별로 6개 카테고리의 가중치가 다르기 때문입니다. 예를 들어 '투자' 프로필은 가격(30%)과 안전(25%)에 높은 가중치를, '교육' 프로필은 입지(45%)에 높은 가중치를 부여합니다." },
          { q: "적정가 괴리도란?", a: "인근 단지 실거래 중위가에 신축 프리미엄, 면적 차이, 브랜드 보정을 적용한 '적정 추정가'와 실제 분양가의 차이(%)입니다. 음수(-)일수록 시세 대비 저렴합니다." },
          { q: "데이터가 비어있는 단지가 있어요", a: "일부 단지는 공공데이터 미등록 또는 수집 지연으로 일부 지표가 비어있을 수 있습니다. 이 경우 지역 평균 또는 보수적 기본값으로 대체하여 점수를 산출합니다." },
        ].map((item, i) => (
          <div key={i} style={guideItem}>
            <div style={guideTitle}>Q. {item.q}</div>
            <div style={guideDesc}>{item.a}</div>
          </div>
        ))}
      </div>

      {/* 전문가 로그인 CTA */}
      {!expertLoggedIn && (
        <div style={cardStyle}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 8 }}>파트너 전문가 전용</div>
          <div style={{ fontSize: 12, color: C.sub, lineHeight: 1.6, marginBottom: 10 }}>
            부동산 전문가라면 69개 세부 지표, 스코어 산출 과정, 데이터 완성도를 상세히 확인할 수 있는 전문가 대시보드를 이용하세요.
          </div>
          <button onClick={onExpertLoginClick} style={{
            width: "100%", background: C.indigoLight, border: `1.5px solid ${C.indigo}`, color: C.indigo, fontSize: 13, fontWeight: 700,
            cursor: "pointer", padding: "12px", borderRadius: 6, minHeight: 44
          }}>전문가 로그인</button>
        </div>
      )}
    </div>
  );
});
