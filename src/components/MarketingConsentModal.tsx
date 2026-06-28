import { memo, useState } from "react";
import { C, F } from "@/theme";
import { trackEvent } from "@/lib/analytics";

/**
 * 마케팅 수신 동의 모달 — 카카오 신규 가입 직후 1회 표시
 * 개인정보보호법상 수집·이용 동의는 수집 시점에 받아야 하므로 별도 모달로 분리.
 * Props: open, onSubmit(consent: boolean) — 동의/거부 둘 다 서버에 기록(null=미선택 해소)
 */
type MarketingConsentModalProps = {
  open: boolean;
  onSubmit: (_consent: boolean) => void;
  submitting?: boolean;
};

export const MarketingConsentModal = memo(function MarketingConsentModal({
  open,
  onSubmit,
  submitting,
}: MarketingConsentModalProps) {
  const [checked, setChecked] = useState(false);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="마케팅 수신 동의"
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        background: "rgba(0,0,0,0.5)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: 16,
      }}
    >
      <div
        style={{
          background: C.card,
          borderRadius: 16,
          padding: "28px 24px",
          maxWidth: 380,
          width: "100%",
          border: `1px solid ${C.border}`,
        }}
      >
        <div style={{ fontSize: 36, marginBottom: 10, textAlign: "center" }}>📬</div>

        <div style={{ fontSize: F.xl, fontWeight: 800, color: C.text, marginBottom: 8, textAlign: "center" }}>
          가입을 환영합니다!
        </div>
        <div style={{ fontSize: F.base, color: C.muted, lineHeight: 1.6, marginBottom: 20, textAlign: "center" }}>
          새로운 분양·미분양 정보와 혜택 소식을
          <br />
          가장 먼저 받아보시겠어요?
        </div>

        {/* 동의 체크박스 */}
        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            padding: "14px 16px",
            borderRadius: 10,
            background: checked ? C.greenLight : C.bg,
            border: `1px solid ${checked ? C.greenBorder : C.border}`,
            cursor: "pointer",
            marginBottom: 18,
            transition: "background .15s, border-color .15s",
          }}
        >
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            style={{ width: 18, height: 18, marginTop: 1, accentColor: C.green, cursor: "pointer", flexShrink: 0 }}
          />
          <span style={{ fontSize: F.sm, color: C.text, lineHeight: 1.5 }}>
            <strong>(선택)</strong> 마케팅 정보 수신에 동의합니다.
            <br />
            <span style={{ color: C.muted, fontSize: F.xs }}>
              신규 분양 알림, 맞춤 추천, 이벤트 소식을 받습니다. 언제든 철회할 수 있어요.
            </span>
          </span>
        </label>

        {/* 동의하고 시작하기 */}
        <button
          type="button"
          disabled={submitting}
          onClick={() => {
            trackEvent("marketing_consent", { consent: checked });
            onSubmit(checked);
          }}
          style={{
            width: "100%",
            minHeight: 44,
            padding: "12px 16px",
            background: submitting ? C.slate100 : C.green,
            color: submitting ? C.muted : C.white,
            fontSize: F.md,
            fontWeight: 700,
            border: "none",
            borderRadius: 8,
            cursor: submitting ? "default" : "pointer",
            marginBottom: 10,
            transition: "background .15s",
          }}
        >
          {submitting ? "처리 중..." : checked ? "동의하고 시작하기" : "동의 없이 시작하기"}
        </button>

        <div style={{ fontSize: F.micro, color: C.muted, textAlign: "center", lineHeight: 1.5 }}>
          동의하지 않아도 서비스 이용에는 제한이 없습니다.
        </div>
      </div>
    </div>
  );
});
