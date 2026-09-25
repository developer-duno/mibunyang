import { memo, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { C, F } from "@/theme";
import { IconClose } from "./icons";
import {
  FEEDBACK_KINDS,
  FEEDBACK_MESSAGE_MAX,
  FEEDBACK_MESSAGE_MIN_UI,
  type FeedbackKind,
} from "@/constants/feedbackKinds";
import { BIZ_CONSENT_TEXT, BIZ_CONTENT_MIN, BIZ_LIMITS, type BizInquiryState } from "@/hooks/useBizInquiry";

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
  /** 의견 탭 = 로그인 필수. 비로그인이면 폼 대신 로그인 안내 (세션 577) */
  isLoggedIn: boolean;
  /** 의견 탭 "카카오 로그인하고 의견 보내기" */
  onLoginRequest: () => void;
  /** 업체 문의 탭 상태·전송 (useBizInquiry) */
  biz: BizInquiryState;
};

type InquiryTab = "feedback" | "biz";

const INQUIRY_TABS: readonly { key: InquiryTab; label: string; sub: string | null }[] = [
  { key: "feedback", label: "의견 보내기", sub: null },
  { key: "biz", label: "🏢 업체 문의", sub: "시행사·분양업체" },
];

const labelStyle: CSSProperties = { fontSize: F.sm, fontWeight: 700, color: C.text, display: "block" };
const inputStyle: CSSProperties = {
  width: "100%",
  marginTop: 4,
  marginBottom: 10,
  padding: "10px 12px",
  fontSize: F.base,
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  background: C.white,
  color: C.text,
  fontFamily: "inherit",
  boxSizing: "border-box",
  minHeight: 44,
};
const reqMark = (
  <span style={{ color: C.red }} aria-hidden="true">
    *
  </span>
);

export const FEEDBACK_CONSENT_TEXT =
  "답장을 위해 카카오 계정 이메일·이름, 의견 내용, 보던 화면과 접속 환경(브라우저 정보)을 저장하는 데 동의합니다 (1년 뒤 자동 삭제)";

/**
 * 문의하기 모달 (세션574 의견 폼 → 세션 577 A-12 통합) — App 에서 lazyNamed 로 불러온다.
 * 탭 2개(같은 크기): "의견 보내기"(기본, 로그인 필수 — POST /api/feedback) · "🏢 업체 문의"(시행사·분양업체,
 * 로그인 불필요 — POST /api/consults consultType "업체문의"). 입구는 이 모달 하나(메뉴 "문의"·떠 있는 버튼·
 * 상세 "이 단지 문의하기"). 탭 상태는 모달이 열릴 때마다 의견 탭으로 시작한다(App 이 열릴 때만 그린다).
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
  isLoggedIn,
  onLoginRequest,
  biz,
}: FeedbackFormProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<InquiryTab>("feedback");

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
            문의하기
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

        <div role="tablist" aria-label="문의 종류" style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          {INQUIRY_TABS.map((t) => {
            const selected = activeTab === t.key;
            // 업체 문의 = 수익 창구라 안 골라도 파란 테두리·글자로 눈에 띄게 (사장님 2026-09-26)
            const tone = t.key === "biz" ? C.blue : C.indigo;
            const toneLight = t.key === "biz" ? C.blueLight : C.indigoLight;
            const emphasized = selected || t.key === "biz";
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                id={`inquiry-tab-${t.key}`}
                aria-selected={selected}
                aria-controls={`inquiry-panel-${t.key}`}
                onClick={() => setActiveTab(t.key)}
                style={{
                  flex: 1,
                  minHeight: 56,
                  padding: "8px 6px",
                  borderRadius: 10,
                  border: `1.5px solid ${emphasized ? tone : C.border}`,
                  background: selected ? toneLight : C.white,
                  color: emphasized ? tone : C.sub,
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 2,
                  boxSizing: "border-box",
                }}
              >
                <span style={{ fontSize: F.base, fontWeight: selected ? 800 : 600 }}>{t.label}</span>
                {t.sub && <span style={{ fontSize: F.micro, fontWeight: 500, color: C.muted }}>{t.sub}</span>}
              </button>
            );
          })}
        </div>

        {activeTab === "feedback" ? (
          <div role="tabpanel" id="inquiry-panel-feedback" aria-labelledby="inquiry-tab-feedback">
            {isLoggedIn ? (
              <>
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

                <label
                  htmlFor="feedback-message"
                  style={{ fontSize: F.sm, fontWeight: 700, color: C.text, display: "block" }}
                >
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
              </>
            ) : (
              <div style={{ padding: "8px 0 4px", textAlign: "center" }}>
                <div style={{ fontSize: F.base, color: C.text, marginBottom: 12, lineHeight: 1.6 }}>
                  의견은 카카오 로그인 후 보낼 수 있어요
                </div>
                <button
                  type="button"
                  onClick={onLoginRequest}
                  style={{
                    width: "100%",
                    padding: 14,
                    fontSize: F.base,
                    fontWeight: 800,
                    color: "#191919",
                    background: "#FEE500",
                    border: "none",
                    borderRadius: 8,
                    cursor: "pointer",
                    minHeight: 48,
                  }}
                >
                  카카오 로그인하고 의견 보내기
                </button>
              </div>
            )}
          </div>
        ) : (
          <BizInquiryPanel biz={biz} />
        )}
      </div>
    </div>
  );
});

/** 업체 문의 탭 — 로그인 없이 회사명·담당자·연락처를 남긴다 (세션 577 A-12) */
function BizInquiryPanel({ biz }: { biz: BizInquiryState }) {
  const len = biz.content.trim().length;
  const remaining = BIZ_LIMITS.content - biz.content.length;
  return (
    <div role="tabpanel" id="inquiry-panel-biz" aria-labelledby="inquiry-tab-biz" data-testid="biz-inquiry-form">
      <div
        style={{
          fontSize: F.sm,
          color: C.blue,
          background: C.blueLight,
          borderRadius: 8,
          padding: "8px 10px",
          marginBottom: 12,
          lineHeight: 1.6,
        }}
      >
        분양 홍보·광고·제휴를 원하시는 시행사·분양업체는 남겨 주세요. 로그인 없이 보낼 수 있어요.
      </div>

      <label htmlFor="biz-company" style={labelStyle}>
        회사명
      </label>
      <input
        id="biz-company"
        value={biz.company}
        onChange={(e) => biz.setCompany(e.target.value)}
        maxLength={BIZ_LIMITS.company}
        aria-required="true"
        autoComplete="organization"
        style={inputStyle}
      />

      <label htmlFor="biz-contact" style={labelStyle}>
        담당자
      </label>
      <input
        id="biz-contact"
        value={biz.contact}
        onChange={(e) => biz.setContact(e.target.value)}
        maxLength={BIZ_LIMITS.contact}
        aria-required="true"
        autoComplete="name"
        style={inputStyle}
      />

      <label htmlFor="biz-phone" style={labelStyle}>
        연락처
      </label>
      <input
        id="biz-phone"
        type="tel"
        inputMode="tel"
        value={biz.phone}
        onChange={(e) => biz.setPhone(e.target.value)}
        maxLength={20}
        placeholder="010-0000-0000"
        aria-required="true"
        autoComplete="tel"
        style={inputStyle}
      />

      <label htmlFor="biz-email" style={labelStyle}>
        이메일 (선택)
      </label>
      <input
        id="biz-email"
        type="email"
        value={biz.email}
        onChange={(e) => biz.setEmail(e.target.value)}
        maxLength={BIZ_LIMITS.email}
        autoComplete="email"
        style={inputStyle}
      />

      <label htmlFor="biz-apartment" style={labelStyle}>
        관련 단지 (선택)
      </label>
      <input
        id="biz-apartment"
        value={biz.apartment}
        onChange={(e) => biz.setApartment(e.target.value)}
        maxLength={BIZ_LIMITS.apartment}
        style={inputStyle}
      />

      <label htmlFor="biz-content" style={labelStyle}>
        내용
      </label>
      <textarea
        id="biz-content"
        value={biz.content}
        onChange={(e) => biz.setContent(e.target.value)}
        maxLength={BIZ_LIMITS.content}
        rows={4}
        placeholder="문의하실 내용을 적어 주세요"
        aria-required="true"
        aria-describedby="biz-count"
        style={{ ...inputStyle, marginBottom: 0, resize: "vertical" }}
      />
      <div
        id="biz-count"
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: F.xs,
          color: C.muted,
          marginTop: 4,
          marginBottom: 10,
        }}
      >
        <span>{len < BIZ_CONTENT_MIN ? `${BIZ_CONTENT_MIN}자 이상 적어 주세요` : ""}</span>
        <span>남은 글자 {remaining}자</span>
      </div>

      <div style={{ fontSize: F.xs, color: C.muted, marginBottom: 8 }}>
        {reqMark} 회사명·담당자·연락처·내용·동의는 꼭 채워 주세요
      </div>

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
          checked={biz.consent}
          onChange={(e) => biz.setConsent(e.target.checked)}
          aria-required="true"
          style={{ marginTop: 2, minWidth: 16, minHeight: 16 }}
        />
        <span>
          {reqMark} {BIZ_CONSENT_TEXT}
        </span>
      </label>

      <button
        type="button"
        onClick={biz.submit}
        disabled={!biz.canSubmit}
        style={{
          width: "100%",
          padding: 14,
          fontSize: F.base,
          fontWeight: 800,
          color: C.white,
          background: biz.canSubmit ? C.blue : C.muted,
          border: "none",
          borderRadius: 8,
          cursor: biz.canSubmit ? "pointer" : "default",
          minHeight: 48,
        }}
      >
        {biz.submitting ? "보내는 중..." : "보내기"}
      </button>
    </div>
  );
}
