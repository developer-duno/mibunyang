import { memo, useEffect } from "react";
import { C } from "@/theme";

export const ShareSheet = memo(function ShareSheet({ open, onKakao, onSMS, onCopy, onClose, isMobile, isPC }) {
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open, onClose]);

  if (!open) return null;

  const btnBase = { width: "100%", border: "none", borderRadius: 12, padding: "14px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer", minHeight: 48, display: "flex", alignItems: "center", gap: 10, transition: "all .15s" };

  return (
    <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, left: 0, zIndex: 350, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: isPC ? "center" : "flex-end", justifyContent: "center" }} onClick={onClose} role="dialog" aria-modal="true" aria-label="공유 방법 선택">
      <div style={{ background: C.card, borderRadius: isPC ? 20 : "20px 20px 0 0", width: "100%", maxWidth: isPC ? 400 : 520, padding: "12px 20px calc(20px + env(safe-area-inset-bottom, 0px))", boxShadow: isPC ? "0 8px 40px rgba(0,0,0,0.2)" : "0 -8px 30px rgba(0,0,0,0.15)" }} onClick={e => e.stopPropagation()}>
        <div onClick={onClose} style={{ width: 40, height: 4, background: C.border, borderRadius: 2, margin: "0 auto 16px", cursor: "pointer" }} />
        <div style={{ fontSize: 15, fontWeight: 800, color: C.text, marginBottom: 14, textAlign: "center" }}>공유하기</div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button onClick={onKakao} aria-label="카카오톡으로 공유" style={{ ...btnBase, background: "#FEE500", color: "#191919" }}>
            <span style={{ fontSize: 18 }}>&#x1F4AC;</span> 카카오톡
          </button>

          {isMobile && (
            <button onClick={onSMS} aria-label="문자로 공유" style={{ ...btnBase, background: "#34D399", color: "#FFFFFF" }}>
              <span style={{ fontSize: 18 }}>&#x1F4F1;</span> 문자 보내기
            </button>
          )}

          <button onClick={onCopy} aria-label="링크 복사" style={{ ...btnBase, background: C.slate100, color: C.slate600 }}>
            <span style={{ fontSize: 18 }}>&#x1F517;</span> 링크 복사
          </button>
        </div>
      </div>
    </div>
  );
});
