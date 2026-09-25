import { memo, useState, useCallback } from "react";
import type { CSSProperties } from "react";
import { PROFILES } from "@/constants/profiles";
import { isFeatureUpcoming } from "@/constants/featureFlags";
import { C, F } from "@/theme";
import { IconHelp } from "@/components/icons";
import { InfoPage } from "./InfoPage";
import type { Profile } from "@/types/scoring";
import type { HeaderSectionProps, HelpModalProps } from "@/types/components/HeaderSection.types";

/* ── HelpModal 정적 스타일 (AptCard L18 패턴) ── */
const HM_S: Record<string, CSSProperties> = {
  backdrop: { position: "fixed", top: 0, right: 0, bottom: 0, left: 0, background: "rgba(0,0,0,0.5)", zIndex: 500 },
  panel: {
    position: "fixed",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    width: "calc(100% - 32px)",
    maxWidth: 480,
    maxHeight: "80dvh",
    background: C.white,
    borderRadius: 16,
    zIndex: 501,
    boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  },
  headerRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "14px 16px",
    borderBottom: `1px solid ${C.border}`,
    flexShrink: 0,
  },
  headerTitle: { fontSize: F.md, fontWeight: 800, color: C.text },
  closeBtn: {
    background: C.slate100,
    border: "none",
    borderRadius: 6,
    padding: "6px 12px",
    fontSize: F.sm,
    fontWeight: 700,
    color: C.muted,
    cursor: "pointer",
    minHeight: 36,
  },
  // 본문 = InfoPage(자체 좌우 16px 여백) — 패널은 위아래 여백만 (세션 577)
  scrollBody: { overflowY: "auto", padding: "12px 0 8px" },
};

/* ── HeaderSection 본체 정적 스타일 ── */
const HS_S: Record<string, CSSProperties> = {
  desktopLeft: { display: "flex", alignItems: "center", gap: 12, flexShrink: 0 },
  desktopH1: { margin: 0, fontSize: F.xl, fontWeight: 800, color: C.blue, letterSpacing: -0.5, whiteSpace: "nowrap" },
  desktopCount: { fontSize: F.xs, color: C.muted, whiteSpace: "nowrap" },
  desktopProfileWrap: { display: "flex", gap: 2, alignItems: "center" },
  desktopRight: { display: "flex", gap: 4, alignItems: "center", flexShrink: 0 },
  desktopLogoutBtn: {
    background: "none",
    border: "none",
    color: C.muted,
    fontSize: F.xs,
    fontWeight: 500,
    padding: "6px 8px",
    cursor: "pointer",
    minHeight: 36,
  },
  mobileHeaderRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  mobileH1: { margin: 0, fontSize: F.xl, fontWeight: 800, color: C.blue, letterSpacing: -0.5 },
  mobileSubtitle: { margin: "2px 0 0", fontSize: F.sm, color: C.sub, fontWeight: 500 },
  mobileTopRight: { display: "flex", gap: 6, alignItems: "center" },
  mobileVersion: {
    background: C.slate100,
    borderRadius: 8,
    padding: "6px 10px",
    fontSize: F.xs,
    fontWeight: 600,
    color: C.muted,
  },
  mobileProfileScroll: {
    display: "flex",
    gap: 6,
    justifyContent: "center",
    overflowX: "auto",
    paddingBottom: 2,
    WebkitOverflowScrolling: "touch",
  },
  mobileProfileLabel: { fontSize: F.base, fontWeight: 700, letterSpacing: -0.3 },
};

/**
 * 도움말 모달 (데스크톱/모바일 공용).
 * 세션 577(A-12): 본문 = InfoPage 그대로(소개·가이드·엔진·FAQ·로그인/로그아웃·마케팅 동의·관리자 로그인 링크).
 * 정보 탭이 없어져 이 패널이 그 내용의 유일한 입구다. "관리자 로그인" 링크는 패널을 닫고 관리자 로그인 화면으로.
 */
function HelpModal({ onClose, onAdminLoginClick, ...info }: HelpModalProps) {
  const goAdminLogin = useCallback(() => {
    onClose();
    onAdminLoginClick();
  }, [onClose, onAdminLoginClick]);
  return (
    <>
      <div onClick={onClose} style={HM_S.backdrop} />
      <div style={HM_S.panel}>
        <div style={HM_S.headerRow}>
          <span style={HM_S.headerTitle}>도움말</span>
          <button onClick={onClose} aria-label="닫기" style={HM_S.closeBtn}>
            닫기
          </button>
        </div>
        <div style={HM_S.scrollBody}>
          <InfoPage {...info} onAdminLoginClick={goAdminLogin} />
        </div>
      </div>
    </>
  );
}

/**
 * 헤더 섹션 — 데스크톱: 고정 상단 바 + 네비 / 모바일: 블루 그라디언트
 */
export const HeaderSection = memo(function HeaderSection({
  profile,
  onProfileChange,
  apartmentCount,
  isDesktop,
  tab,
  onNavClick,
  adminLoggedIn,
  isLoggedIn,
  containerMaxWidth,
  upcomingCount,
  kakaoLoading,
  onKakaoLogin,
  onLogout,
  onAdminLoginClick,
  consentMarketing,
  consentSubmitting,
  onToggleMarketingConsent,
}: HeaderSectionProps) {
  const [helpOpen, setHelpOpen] = useState(false);
  const toggleHelp = useCallback(() => setHelpOpen((v) => !v), []);
  const closeHelp = useCallback(() => setHelpOpen(false), []);

  const upcomingEnabled = isFeatureUpcoming();
  const upcomingLabel = upcomingCount != null && upcomingCount > 0 ? `📅 곧 분양 ${upcomingCount}개` : "📅 곧 분양";
  // 세션 405: 네비 분기 축 = adminLoggedIn (구 expertLoggedIn = 토큰 보유 — 카카오 손님 오노출 quirk 해소)
  // 세션 577(A-12): 손님 메뉴 = 목록·지도·(곧 분양)·문의 4개 — 휴대폰 BottomNav 와 같은 배열.
  // 홈·비교·상담·정보 삭제(비교 = 목록 안 버튼, 정보 = 도움말(?) 패널, 문의 = 문의 모달 열기).
  const navItems = adminLoggedIn
    ? [
        { l: "관리자", k: "admin" },
        { l: "소비자뷰", k: "list" },
        { l: "지도", k: "map" },
        ...(upcomingEnabled ? [{ l: upcomingLabel, k: "upcoming" }] : []),
      ]
    : [
        { l: "목록", k: "list" },
        { l: "지도", k: "map" },
        ...(upcomingEnabled ? [{ l: upcomingLabel, k: "upcoming" }] : []),
        { l: "문의", k: "inquiry" },
      ];

  if (isDesktop) {
    return (
      <>
        <div
          style={{
            position: "fixed",
            top: 0,
            left: "50%",
            transform: "translateX(-50%)",
            width: "100%",
            maxWidth: containerMaxWidth,
            background: C.white,
            borderBottom: `1.5px solid ${C.borderStrong}`,
            padding: "0 24px",
            height: 60,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            zIndex: 50,
            boxShadow: C.shadowSm,
            transition: "max-width .3s",
          }}
        >
          {/* 좌측: 로고 */}
          <div style={HS_S.desktopLeft}>
            <h1 style={HS_S.desktopH1}>미분양 비교</h1>
            <span style={HS_S.desktopCount}>{apartmentCount}개 단지</span>
          </div>

          {/* 중앙: 프로필 탭 */}
          <div style={HS_S.desktopProfileWrap}>
            {Object.entries(PROFILES).map(([k, p]) => (
              <button
                key={k}
                onClick={() => onProfileChange(k as Profile)}
                aria-pressed={profile === k}
                style={{
                  background: "none",
                  border: "none",
                  borderBottom: profile === k ? `2px solid ${C.blue}` : "2px solid transparent",
                  color: profile === k ? C.blue : C.sub,
                  fontSize: F.base,
                  fontWeight: profile === k ? 700 : 500,
                  padding: "18px 12px",
                  cursor: "pointer",
                  transition: "all .15s",
                  whiteSpace: "nowrap",
                }}
              >
                {p.name}
              </button>
            ))}
          </div>

          {/* 우측: 네비 + 도움말 */}
          <div style={HS_S.desktopRight}>
            {navItems.map((n) => {
              // 세션 577: 비교 탭이 없어져 목록은 비교 시트가 열려 있어도 활성 표시("문의"는 탭이 아니라 활성 없음)
              const isActive = tab === n.k;
              return (
                <button
                  key={n.k}
                  aria-current={tab === n.k ? "page" : undefined}
                  onClick={() => onNavClick(n.k)}
                  style={{
                    background: isActive ? C.blueLight : "transparent",
                    color: isActive ? C.blue : C.muted,
                    border: "none",
                    borderRadius: 6,
                    padding: "7px 14px",
                    fontSize: F.base,
                    fontWeight: isActive ? 700 : 500,
                    cursor: "pointer",
                    transition: "all .15s",
                    minHeight: 36,
                    whiteSpace: "nowrap",
                  }}
                >
                  {n.l}
                </button>
              );
            })}
            {/* 데스크톱 유일 로그아웃 — isLoggedIn(공용 토큰 축) 게이트 보존 (카카오 손님 포함, 세션 405 적대검증) */}
            {isLoggedIn && (
              <button onClick={() => onNavClick("logout")} style={HS_S.desktopLogoutBtn}>
                로그아웃
              </button>
            )}
            <button
              onClick={toggleHelp}
              aria-label="도움말"
              style={{
                background: helpOpen ? C.blueLight : C.slate100,
                color: helpOpen ? C.blue : C.muted,
                border: "none",
                borderRadius: 6,
                width: 36,
                height: 36,
                minHeight: 36,
                cursor: "pointer",
                transition: "all .15s",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <IconHelp size={18} />
            </button>
          </div>
        </div>

        {/* 도움말 모달 — 데스크톱 */}
        {helpOpen && (
          <HelpModal
            onClose={closeHelp}
            isLoggedIn={isLoggedIn}
            adminLoggedIn={adminLoggedIn}
            onAdminLoginClick={onAdminLoginClick}
            onKakaoLogin={onKakaoLogin}
            kakaoLoading={kakaoLoading}
            onLogout={onLogout}
            consentMarketing={consentMarketing}
            consentSubmitting={consentSubmitting}
            onToggleMarketingConsent={onToggleMarketingConsent}
          />
        )}
      </>
    );
  }

  /* ── 모바일: 화이트 테마 ── */
  return (
    <div
      style={{
        background: C.white,
        padding: 16,
        borderBottom: `1.5px solid ${C.borderStrong}`,
        color: C.text,
        position: "relative",
      }}
    >
      <div style={HS_S.mobileHeaderRow}>
        <div>
          <h1 style={HS_S.mobileH1}>전국 미분양 비교 엔진</h1>
          <p style={HS_S.mobileSubtitle}>전국 {apartmentCount}개 단지 · 6개 항목 · 41+ 지표</p>
        </div>
        <div style={HS_S.mobileTopRight}>
          <button
            onClick={toggleHelp}
            aria-label="도움말"
            style={{
              background: helpOpen ? C.blueLight : C.slate100,
              color: helpOpen ? C.blue : C.muted,
              border: "none",
              borderRadius: 8,
              width: 32,
              height: 32,
              minHeight: 36,
              fontSize: F.md,
              fontWeight: 800,
              cursor: "pointer",
              transition: "all .2s",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            ?
          </button>
          <div style={HS_S.mobileVersion}>v3.0</div>
        </div>
      </div>
      <div style={HS_S.mobileProfileScroll}>
        {Object.entries(PROFILES).map(([k, p]) => (
          <button
            key={k}
            onClick={() => onProfileChange(k as Profile)}
            aria-pressed={profile === k}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: profile === k ? C.blueLight : C.slate100,
              color: profile === k ? C.blue : C.sub,
              border: `1.5px solid ${profile === k ? C.blueBorder : C.border}`,
              borderRadius: 8,
              padding: "8px 0",
              minHeight: 44,
              cursor: "pointer",
              transition: "all .2s",
              boxShadow: profile === k ? "0 2px 8px rgba(37,99,235,0.15)" : "none",
            }}
          >
            <span style={HS_S.mobileProfileLabel}>{p.name}</span>
          </button>
        ))}
      </div>

      {helpOpen && (
        <HelpModal
          onClose={closeHelp}
          isLoggedIn={isLoggedIn}
          adminLoggedIn={adminLoggedIn}
          onAdminLoginClick={onAdminLoginClick}
          onKakaoLogin={onKakaoLogin}
          kakaoLoading={kakaoLoading}
          onLogout={onLogout}
          consentMarketing={consentMarketing}
          consentSubmitting={consentSubmitting}
          onToggleMarketingConsent={onToggleMarketingConsent}
        />
      )}
    </div>
  );
});
