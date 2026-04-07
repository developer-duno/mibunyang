import { memo, useState, useCallback } from "react";
import { PROFILES } from "@/constants/profiles";
import { C } from "@/theme";
import { IconHelp } from "@/components/icons";

/** 도움말 모달 (데스크톱/모바일 공용) */
function HelpModal({ onClose }) {
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", top: 0, right: 0, bottom: 0, left: 0, background: "rgba(0,0,0,0.5)", zIndex: 500 }} />
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: "calc(100% - 32px)", maxWidth: 480, maxHeight: "80dvh", background: C.white, borderRadius: 16, zIndex: 501, boxShadow: "0 20px 60px rgba(0,0,0,0.3)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: C.text }}>도움말</span>
          <button onClick={onClose} aria-label="닫기" style={{ background: C.slate100, border: "none", borderRadius: 6, padding: "6px 12px", fontSize: 12, fontWeight: 700, color: C.muted, cursor: "pointer", minHeight: 36 }}>닫기</button>
        </div>
        <div style={{ overflowY: "auto", padding: "12px 16px 20px" }}>
          {HELP_SECTIONS.map((sec, si) => (
            <div key={si} style={{ marginBottom: si < HELP_SECTIONS.length - 1 ? 16 : 0 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: si === 0 ? C.blue : si === 1 ? C.green : C.amber, marginBottom: 8, paddingBottom: 4, borderBottom: `1px solid ${C.border}` }}>{sec.title}</div>
              {sec.items.map((item, i) => (
                <div key={i} style={{ marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{item.t}</span>
                  <span style={{ fontSize: 11, color: C.sub, marginLeft: 6 }}>{item.d}</span>
                </div>
              ))}
            </div>
          ))}
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.6 }}>도시등급별 교통 보정: 특별시(S) · 광역시(A) · 특례시(B) · 일반시(C) · 군(D) 등급에 따라 지하철·버스·IC·KTX 가중치가 자동 조정됩니다.</div>
            <div style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>학술 기반: AHP 계층분석법 · 헤도닉 가격모형 · 국토연구원 GTX 분석(2024)</div>
          </div>
        </div>
      </div>
    </>
  );
}

const HELP_SECTIONS = [
  { title: "스코어링 엔진 (6개 카테고리 · 34+ 지표)", items: [
    { t: "가격 매력도", d: "적정가 괴리도(신축프리미엄·면적·브랜드 보정) + 전세가율 + PIR + PSR + 데이터신뢰도" },
    { t: "입지·생활권", d: "교통접근성(도시등급별 자동 보정) + 학군 + 생활인프라(8개) + 환경 + 혐오시설" },
    { t: "상품성", d: "브랜드티어 + 세대수 + 주차비 + 용적률 + 에너지등급 + 전용률 + 평면 + 내진설계" },
    { t: "혜택·할인", d: "분양가할인 + 중도금무이자 + 옵션무상 + 발코니확장 + 캐시백" },
    { t: "안전도", d: "미분양률 + 거래량 + 대출/DSR + 시공사재무(DART) + 규제 + 공급 + 시장환경" },
    { t: "미래가치", d: "교통개발(GTX·KTX) + 도시개발 + 인구 + 산업개발" },
  ]},
  { title: "사용 가이드", items: [
    { t: "검색·필터", d: "단지명·건설사·지역명 검색 (초성 지원). 시/도·시군구 필터, 예산 범위(억) 설정" },
    { t: "프로필", d: "실거주·투자·신혼·교육·은퇴 5개 관점 전환. 프로필에 따라 순위가 달라집니다" },
    { t: "비교", d: "카드 체크로 2~4개 선택 → 하단 '비교' 탭에서 나란히 비교" },
    { t: "상세 분석", d: "카드 터치 → 인근 시세, 학군, 대출 분석(LTV/DSR/갭투자) 확인" },
    { t: "상담", d: "하단 '상담' 탭에서 관심 단지·예산과 함께 신청하면 전문가가 연락" },
  ]},
  { title: "자주 묻는 질문", items: [
    { t: "등급 기준", d: "S(90+) A(80~89) B(65~79) C(50~64) D(50미만). 프로필에 따라 달라집니다" },
    { t: "데이터 업데이트", d: "미분양·시세: 매일 / 실거래: 매월 / 인프라·학교: 매월 자동 수집" },
    { t: "데이터가 비어있어요", d: "미등록 시 지역 평균 또는 보수적 기본값으로 대체 산출합니다" },
  ]},
];

/**
 * 헤더 섹션 — 데스크톱: 고정 상단 바 + 네비 / 모바일: 블루 그라디언트
 */
export const HeaderSection = memo(function HeaderSection({ profile, onProfileChange, apartmentCount, isDesktop, tab, onNavClick, showComp, compCount, expertLoggedIn, containerMaxWidth }) {
  const [helpOpen, setHelpOpen] = useState(false);
  const toggleHelp = useCallback(() => setHelpOpen(v => !v), []);
  const closeHelp = useCallback(() => setHelpOpen(false), []);

  const navItems = expertLoggedIn
    ? [{ l: "대시보드", k: "expert" }, { l: "상담목록", k: "expertConsults" }, { l: "소비자뷰", k: "list" }]
    : [{ l: "목록", k: "list" }, { l: "지도", k: "map" }, { l: "비교", k: "compare" }, { l: "상담", k: "consult" }, { l: "정보", k: "info" }];

  if (isDesktop) {
    return (
      <>
        <div style={{ position: "fixed", top: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: containerMaxWidth, background: C.white, borderBottom: `1.5px solid ${C.borderStrong}`, padding: "0 24px", height: 60, display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 50, boxShadow: C.shadowSm, transition: "max-width .3s" }}>
          {/* 좌측: 로고 */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: C.blue, letterSpacing: -0.5, whiteSpace: "nowrap" }}>미분양 비교</h1>
            <span style={{ fontSize: 11, color: C.muted, whiteSpace: "nowrap" }}>{apartmentCount}개 단지</span>
          </div>

          {/* 중앙: 프로필 탭 */}
          <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
            {Object.entries(PROFILES).map(([k, p]) => (
              <button key={k} onClick={() => onProfileChange(k)} aria-pressed={profile === k} style={{
                background: "none", border: "none", borderBottom: profile === k ? `2px solid ${C.blue}` : "2px solid transparent",
                color: profile === k ? C.blue : C.sub, fontSize: 13, fontWeight: profile === k ? 700 : 500,
                padding: "18px 12px", cursor: "pointer", transition: "all .15s", whiteSpace: "nowrap"
              }}>{p.name}</button>
            ))}
          </div>

          {/* 우측: 네비 + 도움말 */}
          <div style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0 }}>
            {navItems.map(n => {
              const isActive = n.k === "compare" ? (showComp && tab === "list") : (tab === n.k && !(n.k === "list" && showComp));
              return (
                <button key={n.k} aria-current={(!["compare", "logout"].includes(n.k) && tab === n.k) ? "page" : undefined} onClick={() => onNavClick(n.k)} style={{
                  background: isActive ? C.blueLight : "transparent", color: isActive ? C.blue : C.muted,
                  border: "none", borderRadius: 6, padding: "7px 14px", fontSize: 13, fontWeight: isActive ? 700 : 500,
                  cursor: "pointer", transition: "all .15s", minHeight: 36, whiteSpace: "nowrap"
                }}>{n.l}{n.k === "compare" && compCount >= 2 ? `(${compCount})` : ""}</button>
              );
            })}
            {expertLoggedIn && (
              <button onClick={() => onNavClick("logout")} style={{ background: "none", border: "none", color: C.muted, fontSize: 11, fontWeight: 500, padding: "6px 8px", cursor: "pointer", minHeight: 36 }}>로그아웃</button>
            )}
            <button onClick={toggleHelp} aria-label="도움말" style={{
              background: helpOpen ? C.blueLight : C.slate100, color: helpOpen ? C.blue : C.muted,
              border: "none", borderRadius: 6, width: 36, height: 36, minHeight: 36,
              cursor: "pointer", transition: "all .15s",
              display: "flex", alignItems: "center", justifyContent: "center"
            }}><IconHelp size={18} /></button>
          </div>
        </div>

        {/* 도움말 모달 — 데스크톱 */}
        {helpOpen && <HelpModal onClose={closeHelp} />}
      </>
    );
  }

  /* ── 모바일: 화이트 테마 ── */
  return (
    <div style={{ background: C.white, padding: 16, borderBottom: `1.5px solid ${C.borderStrong}`, color: C.text, position: "relative" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: C.blue, letterSpacing: -.5 }}>전국 미분양 비교 엔진</h1>
          <p style={{ margin: "2px 0 0", fontSize: 12, color: C.sub, fontWeight: 500 }}>전국 {apartmentCount}개 단지 · 6개 항목 · 34+ 지표</p>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button onClick={toggleHelp} aria-label="도움말" style={{
            background: helpOpen ? C.blueLight : C.slate100,
            color: helpOpen ? C.blue : C.muted,
            border: "none", borderRadius: 8, width: 32, height: 32, minHeight: 36,
            fontSize: 15, fontWeight: 800, cursor: "pointer", transition: "all .2s",
            display: "flex", alignItems: "center", justifyContent: "center"
          }}>?</button>
          <div style={{ background: C.slate100, borderRadius: 8, padding: "6px 10px", fontSize: 11, fontWeight: 600, color: C.muted }}>v3.0</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, justifyContent: "center", overflowX: "auto", paddingBottom: 2, WebkitOverflowScrolling: "touch" }}>
        {Object.entries(PROFILES).map(([k, p]) => (
          <button key={k} onClick={() => onProfileChange(k)} aria-pressed={profile === k} style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
            background: profile === k ? C.blueLight : C.slate100,
            color: profile === k ? C.blue : C.sub,
            border: `1.5px solid ${profile === k ? C.blueBorder : C.border}`,
            borderRadius: 8, padding: "8px 0", minHeight: 44, cursor: "pointer", transition: "all .2s",
            boxShadow: profile === k ? "0 2px 8px rgba(37,99,235,0.15)" : "none"
          }}>
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: -0.3 }}>{p.name}</span>
          </button>
        ))}
      </div>

      {helpOpen && <HelpModal onClose={closeHelp} />}
    </div>
  );
});
