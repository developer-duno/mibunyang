import { memo } from "react";
import { CITY_TIER } from "@/constants/regions";
import { C } from "@/theme";

/**
 * InfoPage - 스코어링 엔진 구조 안내 페이지
 * Props:
 *   expertLoggedIn: boolean - 전문가 로그인 상태
 *   onExpertLoginClick: () => void - 전문가 로그인 탭 이동
 */
export const InfoPage = memo(function InfoPage({ expertLoggedIn, onExpertLoginClick }) {
  return (
    <div style={{ padding: "0 16px", maxWidth: 640, margin: "0 auto" }}>
      <div style={{ background: C.card, borderRadius: 12, padding: 14, border: `1px solid ${C.border}`, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: C.text, marginBottom: 10 }}>스코어링 엔진 구조</div>
        {[
          { title: "가격 매력도", desc: "적정가괴리도(신축프리미엄·면적·브랜드 보정) + 전세가율 + PIR(소득대비) + PSR(분양가/시세) + 데이터신뢰도" },
          { title: "입지·생활권", desc: "교통접근성(도시등급별 보정: 특별시↔군 지하철·버스·IC·KTX 가중치 자동 조정) + 학군 + 생활인프라(8개 카테고리) + 환경 + 혐오시설" },
          { title: "상품성", desc: "브랜드티어(4단계) + 세대수 + 주차비 + 용적률 + 에너지등급 + 전용률 + 평면구조 + 내진설계 + 구조(층수)" },
          { title: "혜택·할인", desc: "원화환산(분양가할인 + 중도금무이자 + 옵션무상 + 발코니확장 + 캐시백) ÷ 분양가" },
          { title: "안전도", desc: "미분양률 + 거래량 + 대출/잔금(DSR) + 시공사재무(DART) + 규제 + 공급파이프라인 + 시장환경" },
          { title: "미래가치", desc: "교통개발(GTX·KTX·광역철도) + 도시개발 + 인구/산업유입" },
        ].map((item, i) => (
          <div key={i} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{item.title}</div>
            <div style={{ fontSize: 12, color: C.sub, lineHeight: 1.6, marginTop: 2 }}>{item.desc}</div>
          </div>
        ))}

        <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 10, paddingTop: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.blue, marginBottom: 6 }}>도시등급별 교통 보정 (NEW)</div>
          <div style={{ fontSize: 11, color: C.sub, lineHeight: 1.6 }}>
            {Object.entries(CITY_TIER).map(([k, v]) =>
              `${v.label}(${k}): 지하철×${v.subwayW} 버스×${v.busW} IC×${v.icW} KTX×${v.ktxW}`
            ).join(" | ")}
          </div>
        </div>

        <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 10, paddingTop: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 4 }}>학술 기반</div>
          <div style={{ fontSize: 11, color: C.sub, lineHeight: 1.6 }}>
            AHP 계층분석법(황규성·장형진 2016) · 헤도닉 가격모형 · 한국부동산원 공시가격 조사체계 · 국토연구원 GTX 영향 분석(2024) · 하자심사분쟁조정위 데이터
          </div>
        </div>

        {!expertLoggedIn && (
          <div style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, padding: 16, marginTop: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 8 }}>파트너 전문가 전용</div>
            <button onClick={onExpertLoginClick} style={{
              width: "100%", background: C.indigoLight, border: `1.5px solid ${C.indigo}`, color: C.indigo, fontSize: 13, fontWeight: 700,
              cursor: "pointer", padding: "12px", borderRadius: 6, minHeight: 44
            }}>전문가 로그인</button>
          </div>
        )}
      </div>
    </div>
  );
});
