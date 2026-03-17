import { memo } from "react";
import { PROFILES } from "@/constants/profiles";
import { C } from "@/theme";

/**
 * 헤더 섹션 — 프로필 선택 버튼 5개, 단지 수, v3.0 뱃지, 데코 원
 * Props: profile, onProfileChange, apartmentCount
 */
export const HeaderSection = memo(function HeaderSection({ profile, onProfileChange, apartmentCount }) {
  return (
    <div style={{ background: "linear-gradient(135deg,#2563EB 0%,#1E40AF 100%)", padding: "16px 16px 16px", borderRadius: "0 0 24px 24px", color: C.white, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: -30, right: -30, width: 120, height: 120, borderRadius: "50%", background: "rgba(255,255,255,0.04)" }} />
      <div style={{ position: "absolute", bottom: -20, left: 20, width: 60, height: 60, borderRadius: "50%", background: "rgba(255,255,255,0.03)" }} />
      <div style={{ position: "relative" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, letterSpacing: -.5 }}>전국 미분양 비교 엔진</h1>
            <p style={{ margin: "2px 0 0", fontSize: 12, opacity: .75, fontWeight: 500 }}>전국 {apartmentCount}개 단지 · 6개 항목 · 34+ 지표</p>
          </div>
          <div style={{ background: "rgba(255,255,255,0.15)", borderRadius: 8, padding: "6px 10px", fontSize: 11, fontWeight: 600 }}>v3.0</div>
        </div>
        <div style={{ display: "flex", gap: 6, justifyContent: "center", overflowX: "auto", paddingBottom: 2, WebkitOverflowScrolling: "touch" }}>
          {Object.entries(PROFILES).map(([k, p]) => (
            <button key={k} onClick={() => onProfileChange(k)} aria-pressed={profile === k} style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
              background: profile === k ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.12)",
              color: profile === k ? C.blue : "rgba(255,255,255,0.9)",
              border: `1.5px solid ${profile === k ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.2)"}`,
              borderRadius: 8, padding: "8px 0", minHeight: 44, cursor: "pointer", transition: "all .2s",
              boxShadow: profile === k ? "0 2px 8px rgba(37,99,235,0.15)" : "none"
            }}>
              <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: -0.3 }}>{p.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
});
