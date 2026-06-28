import { memo } from "react";
import { C, F } from "@/theme";
import { GuideSections } from "./info/GuideSections";
import { ScoringEngine } from "./info/ScoringEngine";
import { FAQSection } from "./info/FAQSection";

const cardStyle = {
  background: C.card,
  borderRadius: 12,
  padding: 14,
  border: `1px solid ${C.border}`,
  boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
  marginBottom: 12,
};
const titleStyle = { fontSize: F.md, fontWeight: 800, color: C.text, marginBottom: 10 };
const titleBlue = { ...titleStyle, color: C.blue };
const guideDesc = { fontSize: F.sm, color: C.sub, lineHeight: 1.6, marginTop: 2 };
const tipBox = { background: C.blueLight, borderRadius: 8, padding: "8px 10px", marginTop: 6, marginBottom: 6 };
const tipText = { fontSize: F.xs, color: C.blue, lineHeight: 1.6 };

/**
 * InfoPage - 스코어링 엔진 구조 + 소비자용 사용 가이드 + FAQ + 로그인/로그아웃 입구 (세션 405)
 * - 비로그인: 카카오 로그인 카드 (능동 로그인 입구 — 구 전문가 폼의 카카오 버튼 대체)
 * - 로그인(카카오 손님 포함): 작은 로그아웃 버튼 — 모바일 유일 로그아웃 경로
 * - 관리자 미로그인: 맨 아래 작은 "관리자 로그인" 텍스트 링크 (관리자 유일 입구)
 */
type InfoPageProps = {
  isLoggedIn: boolean;
  adminLoggedIn: boolean;
  onAdminLoginClick: () => void;
  onKakaoLogin: () => void;
  kakaoLoading?: boolean;
  onLogout: () => void;
  onConsultClick: () => void;
  consentMarketing?: boolean | null; // 현재 마케팅 동의 상태 (true/false/null) — D3
  consentSubmitting?: boolean; // 동의 토글 처리 중
  onToggleMarketingConsent?: () => void; // 마케팅 동의 켜기/끄기
};
export const InfoPage = memo(function InfoPage({
  isLoggedIn,
  adminLoggedIn,
  onAdminLoginClick,
  onKakaoLogin,
  kakaoLoading,
  onLogout,
  onConsultClick,
  consentMarketing,
  consentSubmitting,
  onToggleMarketingConsent,
}: InfoPageProps) {
  return (
    <div style={{ padding: "0 16px", maxWidth: 640, margin: "0 auto" }}>
      {/* 1. 시작하기 */}
      <div style={cardStyle}>
        <div style={titleBlue}>미분양 아파트 비교 엔진</div>
        <div style={guideDesc}>
          전국 1,400여 개 미분양 아파트를 6개 카테고리, 37개 이상의 지표로 분석하여 점수화합니다. 공공데이터, 실거래가,
          네이버 시세 등 다양한 데이터를 자동 수집하여 객관적인 비교를 돕습니다.
        </div>
        <div style={tipBox}>
          <div style={tipText}>
            <b>핵심 흐름:</b> 프로필 선택 → 필터로 조건 설정 → 카드 비교 → 상세 분석 → 상담 신청
          </div>
        </div>
      </div>

      {/* 2. 전문가 상담 진입 — 모바일 5탭에서 상담 탭이 빠지는 대신 정보 페이지가 정식 입구 (spec D4) */}
      <div style={cardStyle}>
        <div style={titleStyle}>전문가 상담 신청</div>
        <div style={guideDesc}>
          관심 단지와 예산을 남기면 전문가가 연락드립니다. 관심매물로 등록한 단지는 자동으로 상담 목록에 포함됩니다.
        </div>
        <button
          onClick={onConsultClick}
          style={{
            width: "100%",
            background: C.blue,
            border: "none",
            color: C.white,
            fontSize: F.base,
            fontWeight: 700,
            cursor: "pointer",
            padding: "12px",
            borderRadius: 6,
            minHeight: 44,
            marginTop: 8,
          }}
        >
          상담 신청하기
        </button>
      </div>

      <GuideSections />

      <ScoringEngine />

      <FAQSection />

      {/* 로그인 / 로그아웃 (세션 405 — 구 전문가 CTA 카드 대체) */}
      {!isLoggedIn ? (
        <div style={cardStyle}>
          <div style={{ fontSize: F.base, fontWeight: 700, color: C.text, marginBottom: 8 }}>로그인</div>
          <div style={{ fontSize: F.sm, color: C.sub, lineHeight: 1.6, marginBottom: 10 }}>
            로그인하면 단지 점수와 상세 분석을 모두 볼 수 있어요.
          </div>
          <button
            type="button"
            onClick={onKakaoLogin}
            disabled={kakaoLoading}
            style={{
              width: "100%",
              minHeight: 44,
              padding: "12px",
              fontSize: F.base,
              fontWeight: 700,
              background: kakaoLoading ? "#E5D85C" : "#FEE500",
              color: "#191919",
              border: "none",
              borderRadius: 6,
              cursor: kakaoLoading ? "default" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M9 1C4.58 1 1 3.79 1 7.21c0 2.17 1.44 4.08 3.62 5.18l-.93 3.4c-.08.3.26.54.52.36l4.07-2.68c.24.02.47.03.72.03 4.42 0 8-2.79 8-6.22S13.42 1 9 1z"
                fill="#191919"
              />
            </svg>
            {kakaoLoading ? "처리 중..." : "카카오로 시작하기"}
          </button>
          {/* 개인정보 수집 안내 (카카오 동의항목과 화면 일치 — 심사 기준) */}
          <div style={{ fontSize: F.micro, color: C.muted, lineHeight: 1.5, marginTop: 8 }}>
            카카오 로그인 시 닉네임·이메일(필수), 전화번호·프로필 사진(선택)을 수집합니다. 전화번호는 맞춤 분양 정보
            안내 및 상담 연결에 사용되며, 동의하지 않아도 이용할 수 있어요.{" "}
            <a
              href="/privacy.html"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: C.muted, textDecoration: "underline" }}
            >
              개인정보 처리방침
            </a>
          </div>
        </div>
      ) : (
        <div style={cardStyle}>
          <div style={{ fontSize: F.sm, color: C.sub, marginBottom: 8 }}>로그인 상태입니다.</div>

          {/* 마케팅 수신 동의 토글 (D3) — 일반 손님만. privacy.html "언제든 철회 가능" 약속 이행 */}
          {!adminLoggedIn && onToggleMarketingConsent && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "12px 14px",
                marginBottom: 10,
                background: C.bg,
                borderRadius: 8,
                border: `1px solid ${C.border}`,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: F.sm, fontWeight: 600, color: C.text }}>마케팅 정보 수신</div>
                <div style={{ fontSize: F.xs, color: C.muted, lineHeight: 1.5, marginTop: 2 }}>
                  신규 분양 알림·맞춤 추천·이벤트 소식
                  {consentMarketing === true ? " 받는 중" : consentMarketing === false ? " 받지 않음" : " 미선택"}
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={consentMarketing === true}
                aria-label="마케팅 정보 수신 동의"
                disabled={consentSubmitting}
                onClick={onToggleMarketingConsent}
                style={{
                  flexShrink: 0,
                  width: 52,
                  height: 30,
                  borderRadius: 15,
                  border: "none",
                  background: consentMarketing === true ? C.green : C.borderStrong,
                  cursor: consentSubmitting ? "default" : "pointer",
                  position: "relative",
                  transition: "background .15s",
                  opacity: consentSubmitting ? 0.6 : 1,
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    top: 3,
                    left: consentMarketing === true ? 25 : 3,
                    width: 24,
                    height: 24,
                    borderRadius: "50%",
                    background: C.white,
                    transition: "left .15s",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.3)",
                  }}
                />
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={onLogout}
            style={{
              background: C.slate100,
              border: `1px solid ${C.border}`,
              color: C.sub,
              fontSize: F.sm,
              fontWeight: 600,
              cursor: "pointer",
              padding: "10px 16px",
              borderRadius: 6,
              minHeight: 40,
            }}
          >
            로그아웃
          </button>
        </div>
      )}

      {/* 관리자 입구 — 손님 눈에 띄지 않는 작은 텍스트 링크 (세션 405 결정) */}
      {!adminLoggedIn && (
        <div style={{ textAlign: "center", padding: "4px 0 12px" }}>
          <button
            type="button"
            onClick={onAdminLoginClick}
            style={{
              background: "transparent",
              border: "none",
              color: C.muted,
              fontSize: F.xs,
              cursor: "pointer",
              padding: "8px 12px",
            }}
          >
            관리자 로그인
          </button>
        </div>
      )}
    </div>
  );
});
