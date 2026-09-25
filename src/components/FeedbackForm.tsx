import { memo, useEffect, useRef } from "react";
import { C, F } from "@/theme";
import { IconClose } from "./icons";
import {
  FEEDBACK_KINDS,
  FEEDBACK_MESSAGE_MAX,
  FEEDBACK_MESSAGE_MIN_UI,
  type FeedbackKind,
} from "@/constants/feedbackKinds";

type FeedbackFormProps = {
  open: boolean;
  onClose: () => void;
  kind: FeedbackKind | null;
  onKindChange: (_k: FeedbackKind) => void;
  message: string;
  onMessageChange: (_v: string) => void;
  consent: boolean;
  onConsentChange: (_v: boolean) => void;
  submitting: boolean;
  canSubmit: boolean;
  onSubmit: () => void;
  /** 자동 첨부 줄 — "상세 · 힐스테이트○○ (ap-6028351)" */
  contextLabel: string;
  isPC?: boolean;
};

export const FEEDBACK_CONSENT_TEXT =
  "답장을 위해 카카오 계정 이메일·이름과 의견 내용을 저장하는 데 동의합니다 (1년 뒤 자동 삭제)";

/**
 * 의견 보내기 폼 (세션574) — App 에서 lazyNamed 로 불러온다.
 * 모달 관례는 ShareSheet 를 따른다: 바깥 클릭·Esc 로 닫기, role="dialog" aria-modal.
 * z-index 340 = 상세 모달(300)·의견 버튼(310) 위, 공유 시트(350)·토스트(400)·로그인 모달(9999) 아래.
 */
export const FeedbackForm = memo(function FeedbackForm({
  open,
  onClose,
  kind,
  onKindChange,
  message,
  onMessageChange,
  consent,
  onConsentChange,
  submitting,
  canSubmit,
  onSubmit,
  contextLabel,
  isPC,
}: FeedbackFormProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", h);
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", h);
  }, [open, onClose]);

  if (!open) return null;

  const len = message.trim().length;
  const remaining = FEEDBACK_MESSAGE_MAX - message.length;

  return (
    <div
      data-no-print
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        zIndex: 340,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: isPC ? "center" : "flex-end",
        justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-title"
        tabIndex={-1}
        data-testid="feedback-form"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.card,
          borderRadius: isPC ? 16 : "16px 16px 0 0",
          width: "100%",
          maxWidth: isPC ? 440 : 520,
          maxHeight: "90dvh",
          overflowY: "auto",
          padding: "16px 18px calc(18px + env(safe-area-inset-bottom, 0px))",
          boxShadow: isPC ? "0 8px 40px rgba(0,0,0,0.2)" : "0 -8px 30px rgba(0,0,0,0.15)",
          outline: "none",
          boxSizing: "border-box",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div id="feedback-title" style={{ fontSize: F.md, fontWeight: 800, color: C.text }}>
            의견 보내기
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            style={{
              background: "transparent",
              border: "none",
              color: C.muted,
              cursor: "pointer",
              minWidth: 44,
              minHeight: 44,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <IconClose />
          </button>
        </div>

        <div
          role="radiogroup"
          aria-label="의견 종류"
          style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}
        >
          {FEEDBACK_KINDS.map((k) => {
            const selected = kind === k.code;
            return (
              <label
                key={k.code}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "8px 12px",
                  minHeight: 36,
                  borderRadius: 999,
                  border: `1px solid ${selected ? C.indigo : C.border}`,
                  background: selected ? C.indigoLight : C.white,
                  color: selected ? C.indigo : C.sub,
                  fontSize: F.sm,
                  fontWeight: selected ? 700 : 500,
                  cursor: "pointer",
                  boxSizing: "border-box",
                }}
              >
                <input
                  type="radio"
                  name="feedback-kind"
                  value={k.code}
                  checked={selected}
                  onChange={() => onKindChange(k.code)}
                  style={{ margin: 0 }}
                />
                {k.label}
              </label>
            );
          })}
        </div>

        <label htmlFor="feedback-message" style={{ fontSize: F.sm, fontWeight: 700, color: C.text, display: "block" }}>
          내용
        </label>
        <textarea
          id="feedback-message"
          value={message}
          onChange={(e) => onMessageChange(e.target.value)}
          maxLength={FEEDBACK_MESSAGE_MAX}
          rows={5}
          placeholder="불편했던 점, 틀린 정보, 있었으면 하는 기능을 적어 주세요"
          aria-describedby="feedback-count"
          style={{
            width: "100%",
            marginTop: 6,
            padding: "10px 12px",
            fontSize: F.base,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            background: C.white,
            color: C.text,
            resize: "vertical",
            fontFamily: "inherit",
            boxSizing: "border-box",
          }}
        />
        <div
          id="feedback-count"
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: F.xs,
            color: C.muted,
            marginTop: 4,
            marginBottom: 10,
          }}
        >
          <span>{len < FEEDBACK_MESSAGE_MIN_UI ? `${FEEDBACK_MESSAGE_MIN_UI}자 이상 적어 주세요` : ""}</span>
          <span>남은 글자 {remaining}자</span>
        </div>

        {contextLabel && (
          <div
            data-testid="feedback-context"
            style={{
              fontSize: F.xs,
              color: C.sub,
              background: C.slate100,
              borderRadius: 6,
              padding: "6px 10px",
              marginBottom: 10,
            }}
          >
            현재 화면: {contextLabel}
          </div>
        )}

        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 6,
            fontSize: F.xs,
            color: C.sub,
            margin: "4px 0 14px",
            cursor: "pointer",
            lineHeight: 1.5,
          }}
        >
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => onConsentChange(e.target.checked)}
            aria-required="true"
            style={{ marginTop: 2, minWidth: 16, minHeight: 16 }}
          />
          <span>
            <span style={{ color: C.red }} aria-hidden="true">
              *
            </span>{" "}
            {FEEDBACK_CONSENT_TEXT}
          </span>
        </label>

        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit}
          style={{
            width: "100%",
            padding: 14,
            fontSize: F.base,
            fontWeight: 800,
            color: C.white,
            background: canSubmit ? C.indigo : C.muted,
            border: "none",
            borderRadius: 8,
            cursor: canSubmit ? "pointer" : "default",
            minHeight: 48,
          }}
        >
          {submitting ? "보내는 중..." : "보내기"}
        </button>
      </div>
    </div>
  );
});
