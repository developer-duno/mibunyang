import { memo } from "react";
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
const divider = { borderTop: `1px solid ${C.border}`, marginTop: 10, paddingTop: 10 };

export const ScoringEngine = memo(function ScoringEngine() {
  return (
    <div style={cardStyle}>
      <div style={titleStyle}>스코어링 엔진 구조</div>
      {[
        {
          title: "가격 매력도 (6개 지표)",
          desc: "적정가괴리도(신축프리미엄·면적·브랜드 보정) + 전세가율 + PIR(소득대비 부담률) + PSR(분양가/시세 비율) + 데이터신뢰도 + 택지비비율. 주변 실거래가와 비교하여 얼마나 저평가되었는지 분석합니다.",
        },
        {
          title: "입지·생활권 (5개 지표)",
          desc: "교통접근성(도시등급별 보정: 특별시↔군 지하철·버스·IC·KTX 가중치 자동 조정) + 학군(초등 도보거리) + 생활인프라(병원·마트·편의점·공원·카페·문화·은행·약국) + 환경(조망·소음·채광) + 혐오시설(500m 이내 감점).",
        },
        {
          title: "상품성 (9개 지표)",
          desc: "브랜드티어(1군 20점~기타 5점) + 세대수(대단지 가산) + 주차비(1.5대↑ 우수) + 용적률(200%↓ 쾌적) + 에너지등급 + 전용률(80%↑ 우수) + 평면(판상형>혼합>타워) + 내진설계 + 구조(층수).",
        },
        {
          title: "혜택·할인 (6개 지표)",
          // 서브지표 6종 중 5종은 전 단지 미수집이라 "전부 점수화합니다"는 거짓이었다.
          // 문장 표준은 HeaderSection HELP_SECTIONS 의 혜택·할인 줄 (세션 513).
          desc: "관리비 절감(지역 중앙값 대비 절감분)을 만원 단위로 환산합니다. 분양가 할인·중도금 무이자·옵션 무상·발코니 확장·캐시백은 자료가 확보되면 반영됩니다.",
        },
        {
          title: "안전도 (11개 지표)",
          desc: "미분양률 + 청약경쟁률 + 거래량(유동성) + 대출/잔금(DSR40%) + 시공사재무(DART 신용등급·부채비율) + 규제현황 + 공급량 + 시장환경(인구증감) + 계약해제율 + 치안 안전 + 초기분양률.",
        },
        {
          title: "미래가치 (4개 지표)",
          // 세션511 재설계 후의 실제 산식만 말한다 — 노선급 표(scoringTiers TRANSIT_GRADE)에
          // KTX·광역철도는 없고, 도시·산업축은 이름 키워드가 아니라 **거리 등급**이다.
          // "데이터 없는 항목은 인구에 가중치 집중"(동적 재분배)도 그때 폐기됐다 (세션 513).
          desc: "인구 증감률(순이동 보정) + 교통개발(예정 노선의 진행 단계·거리·노선급: GTX·도시철도·경전철·트램) + 도시개발(LH 사업지구까지 거리) + 산업개발(산업단지까지 거리). 네 축을 고정 가중치로 합산합니다.",
        },
      ].map((item, i) => (
        <div key={i} style={guideItem}>
          <div style={guideTitle}>{item.title}</div>
          <div style={guideDesc}>{item.desc}</div>
        </div>
      ))}

      <div style={divider}>
        <div style={{ fontSize: F.base, fontWeight: 700, color: C.blue, marginBottom: 6 }}>도시등급별 교통 보정</div>
        <div style={{ fontSize: F.xs, color: C.sub, lineHeight: 1.6 }}>
          특별시(S) · 광역시(A) · 특례시(B) · 일반시(C) · 군(D) 등급별로 지하철·버스·IC·KTX 가중치가 자동 조정됩니다.
          예: 서울에서는 지하철 접근성이 중요하지만, 군 지역에서는 IC 거리가 더 중요하게 반영됩니다.
        </div>
      </div>

      <div style={divider}>
        <div style={{ fontSize: F.base, fontWeight: 700, color: C.text, marginBottom: 4 }}>학술 기반</div>
        <div style={{ fontSize: F.xs, color: C.sub, lineHeight: 1.6 }}>
          AHP 계층분석법(황규성·장형진 2016) · 헤도닉 가격모형 · 한국부동산원 공시가격 조사체계 · 국토연구원 GTX 영향
          분석(2024) · 하자심사분쟁조정위 데이터
        </div>
      </div>
    </div>
  );
});
