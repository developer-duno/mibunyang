import { memo } from "react";
import { PROFILES } from "@/constants/profiles";
import { C, F } from "@/theme";

const cardStyle = {
  background: C.card,
  borderRadius: 12,
  padding: 14,
  border: `1px solid ${C.border}`,
  boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
  marginBottom: 12,
};
const titleStyle = { fontSize: F.md, fontWeight: 800, color: C.text, marginBottom: 10 };
const guideItem = { marginBottom: 10 };
const guideTitle = { fontSize: F.base, fontWeight: 700, color: C.text };
const guideDesc = { fontSize: F.sm, color: C.sub, lineHeight: 1.6, marginTop: 2 };

export const FAQSection = memo(function FAQSection() {
  return (
    <div style={cardStyle}>
      <div style={titleStyle}>자주 묻는 질문</div>
      {[
        {
          q: "점수는 어떻게 산출되나요?",
          a: "6개 카테고리(가격·입지·상품·혜택·안전·미래)별 점수를 AHP 계층분석법으로 가중 합산합니다. 41개 이상의 공공데이터·실거래·네이버 시세를 기반으로 0~100점 척도로 산출됩니다.",
        },
        {
          q: "데이터는 얼마나 자주 업데이트되나요?",
          a: "네이버 시세와 미분양 현황은 매일, 청약·무순위 정보는 매주, 실거래가는 매월 초(6일 전후), 인구·인프라·학교 등은 매월 자동 수집됩니다.",
        },
        {
          q: "S/A/B/C/D 등급의 기준은?",
          a: "S등급 90점 이상, A등급 80~89점, B+등급 70~79점, B등급 60~69점, C등급 50~59점, D등급 50점 미만입니다. 등급은 선택한 프로필에 따라 달라질 수 있습니다.",
        },
        {
          q: "프로필마다 순위가 다른 이유는?",
          // 세션514: 수치를 **`PROFILES` 에서 파생**한다. 손으로 적힌 옛 문구는 3칸이 전부 어긋나
          //   있었다(투자 가격 30↔35 · 안전 25↔30, 교육 입지 45↔50). #398(세션513)이 같은 파일의
          //   다른 줄만 고치고 이 줄을 놓친 자리 — GuideSections 가 이미 쓰는 방식으로 맞춘다.
          a:
            `프로필별로 6개 카테고리의 가중치가 다르기 때문입니다. 예를 들어 '${PROFILES.invest.name}' 프로필은 ` +
            `가격(${PROFILES.invest.w.price}%)과 안전(${PROFILES.invest.w.risk}%)에, ` +
            `'${PROFILES.edu.name}' 프로필은 입지(${PROFILES.edu.w.location}%)에 높은 가중치를 부여합니다.`,
        },
        {
          q: "적정가 괴리도란?",
          a: "인근 단지 실거래 중위가에 신축 프리미엄, 면적 차이, 브랜드 보정을 적용한 '적정 추정가'와 실제 분양가의 차이(%)입니다. 양수(+)면 시세 대비 저렴, 음수(-)면 시세 대비 비싼 것입니다.",
        },
        {
          q: "데이터가 비어있는 단지가 있어요",
          a: "일부 단지는 공공데이터 미등록 또는 수집 지연으로 일부 지표가 비어있을 수 있습니다. 이 경우 지역 평균 또는 보수적 기본값으로 대체하여 점수를 산출합니다. 데이터신뢰도 점수에 반영됩니다.",
        },
        {
          q: "즐겨찾기·비교 목록은 어디에 저장되나요?",
          a: "브라우저의 로컬 저장소(localStorage)에 저장됩니다. 같은 브라우저에서는 유지되지만, 다른 브라우저나 시크릿 모드에서는 초기화됩니다. 비교 목록은 탭 간에도 동기화됩니다.",
        },
        {
          q: "필터 조건을 공유할 수 있나요?",
          // ⚠️ JS 문자열 안의 &apos; 는 JSX 엔티티로 해석되지 않고 화면에 글자 그대로 찍힌다 (세션 513 화면 실측).
          a: "네, 필터 활성 상태에서 '공유' 버튼을 누르면 현재 필터가 URL에 포함된 링크가 생성됩니다. 카카오톡, 문자, 링크 복사로 공유할 수 있습니다.",
        },
        {
          q: "비교 결과를 저장하려면?",
          a: "비교 분석 패널에서 PNG(이미지) 또는 PDF 버튼을 눌러 내보낼 수 있습니다. 공유 버튼으로 비교 링크를 보낼 수도 있습니다.",
        },
        {
          q: "혜택 금액은 어떻게 계산되나요?",
          // 서브지표 6종 중 5종은 전 단지 미수집 — "모두 합산합니다"는 거짓이었다 (세션 513,
          // ScoringEngine 혜택 desc 와 같은 정정. 문장 표준은 HeaderSection HELP_SECTIONS).
          a: "관리비 절감(지역 중앙값 대비 연간 절감분)을 만원 단위로 환산합니다. 분양가 할인·중도금 무이자·옵션 무상·발코니 확장·캐시백은 자료가 확보되면 합산에 반영됩니다.",
        },
      ].map((item, i) => (
        <div key={i} style={guideItem}>
          <div style={guideTitle}>Q. {item.q}</div>
          <div style={guideDesc}>{item.a}</div>
        </div>
      ))}
    </div>
  );
});
