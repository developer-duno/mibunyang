import { memo } from "react";
import { C, F } from "@/theme";
import { GuideSections } from "./info/GuideSections";
import { ScoringEngine } from "./info/ScoringEngine";
import { FAQSection } from "./info/FAQSection";

const cardStyle = { background: C.card, borderRadius: 12, padding: 14, border: `1px solid ${C.border}`, boxShadow: "0 1px 3px rgba(0,0,0,0.04)", marginBottom: 12 };
const titleStyle = { fontSize: F.md, fontWeight: 800, color: C.text, marginBottom: 10 };
const titleBlue = { ...titleStyle, color: C.blue };
const guideDesc = { fontSize: F.sm, color: C.sub, lineHeight: 1.6, marginTop: 2 };
const tipBox = { background: C.blueLight, borderRadius: 8, padding: "8px 10px", marginTop: 6, marginBottom: 6 };
const tipText = { fontSize: F.xs, color: C.blue, lineHeight: 1.6 };

/**
 * InfoPage - 스코어링 엔진 구조 + 소비자용 사용 가이드 + FAQ
 * Props:
 *   expertLoggedIn: boolean - 전문가 로그인 상태
 *   onExpertLoginClick: () => void - 전문가 로그인 탭 이동
 */
export const InfoPage = memo(function InfoPage({ expertLoggedIn, onExpertLoginClick }) {
  return (
    <div style={{ padding: "0 16px", maxWidth: 640, margin: "0 auto" }}>

      {/* 1. 시작하기 */}
      <div style={cardStyle}>
        <div style={titleBlue}>미분양 아파트 비교 엔진</div>
        <div style={guideDesc}>
          전국 1,400여 개 미분양 아파트를 6개 카테고리, 37개 이상의 지표로 분석하여 점수화합니다.
          공공데이터, 실거래가, 네이버 시세 등 다양한 데이터를 자동 수집하여 객관적인 비교를 돕습니다.
        </div>
        <div style={tipBox}>
          <div style={tipText}>
            <b>핵심 흐름:</b> 프로필 선택 → 필터로 조건 설정 → 카드 비교 → 상세 분석 → 상담 신청
          </div>
        </div>
      </div>

      <GuideSections />

      <ScoringEngine />

      <FAQSection />

      {/* 전문가 로그인 CTA */}
      {!expertLoggedIn && (
        <div style={cardStyle}>
          <div style={{ fontSize: F.base, fontWeight: 700, color: C.text, marginBottom: 8 }}>파트너 전문가 전용</div>
          <div style={{ fontSize: F.sm, color: C.sub, lineHeight: 1.6, marginBottom: 10 }}>
            부동산 전문가라면 69개 세부 지표, 스코어 산출 과정, 데이터 완성도를 상세히 확인할 수 있는 전문가 대시보드를 이용하세요.
            모든 카테고리의 서브스코어와 계산 근거를 투명하게 제공합니다.
          </div>
          <button onClick={onExpertLoginClick} style={{
            width: "100%", background: C.indigoLight, border: `1.5px solid ${C.indigo}`, color: C.indigo, fontSize: F.base, fontWeight: 700,
            cursor: "pointer", padding: "12px", borderRadius: 6, minHeight: 44
          }}>전문가 로그인</button>
        </div>
      )}
    </div>
  );
});
