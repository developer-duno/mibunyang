import { useState, useCallback } from "react";
import { TOKEN_KEY } from "@/lib/authToken";
import { FEEDBACK_MESSAGE_MAX, FEEDBACK_MESSAGE_MIN_UI, type FeedbackKind } from "@/constants/feedbackKinds";

/** 의견에 자동으로 붙는 "지금 보던 화면" (App 이 아는 선까지 — 상세 모달 안 탭은 모른다). */
export type FeedbackContext = {
  /** 화면 이름 — "목록"·"지도"·"상세" 등 */
  page: string;
  apartmentId?: string | null;
  apartmentName?: string | null;
};

type UseFeedbackArgs = {
  showToast: (_msg: string) => void;
  /** 비로그인(의견 탭의 로그인 버튼)·토큰 만료(401) 때 로그인 안내 모달을 연다 */
  onLoginRequired: () => void;
  context: FeedbackContext;
};

export const FEEDBACK_SENT_TOAST = "의견을 보냈어요. 고맙습니다!";
export const FEEDBACK_TOO_MANY_TOAST = "요청이 많아요. 잠시 뒤 다시 보내 주세요";

/** App 탭 키 → 손님이 아는 화면 이름 */
const PAGE_NAMES: Record<string, string> = {
  home: "홈",
  list: "목록",
  map: "지도",
  upcoming: "곧 분양",
  adminLogin: "관리자 로그인",
  admin: "관리자",
  kakaoCallback: "로그인 처리",
};

/**
 * App 이 아는 선까지의 문맥 — 상세 모달이 열려 있으면 "상세" + 그 단지, 아니면 탭 이름(목록에서 비교 시트가
 * 열려 있으면 "비교"). 상세 모달 안의 탭(시세·점수 등)은 모달 내부 상태라 여기서는 모른다.
 */
export function buildFeedbackContext(
  tab: string,
  showComp: boolean,
  detail: { id: string; name?: string | null } | null
): FeedbackContext {
  if (detail) return { page: "상세", apartmentId: detail.id, apartmentName: detail.name || null };
  if (tab === "list" && showComp) return { page: "비교" };
  return { page: PAGE_NAMES[tab] ?? tab };
}

/** 화면에 보여 줄 문맥 한 줄 — "상세 · 힐스테이트○○ (ap-6028351)" */
export function feedbackContextLabel(ctx: FeedbackContext): string {
  const apt = ctx.apartmentName
    ? ctx.apartmentId
      ? `${ctx.apartmentName} (${ctx.apartmentId})`
      : ctx.apartmentName
    : ctx.apartmentId || "";
  return [ctx.page, apt].filter(Boolean).join(" · ");
}

/**
 * 손님 "의견 보내기" 상태·전송 (세션574) + 문의 모달 열고 닫기.
 * - 열기: 로그인 여부와 무관하게 연다(세션 577 A-12 — 모달이 "문의하기"로 통합돼 업체 문의 탭은 로그인이
 *   필요 없다). 비로그인이면 의견 탭 안에서 "카카오 로그인하고 의견 보내기"(requestLogin) 로 안내한다.
 * - 보내기: POST /api/feedback (Authorization: Bearer <authToken>). 성공하면 입력을 비우고 닫는다.
 *   닫기만 하면 쓰던 글은 남겨 둔다(실수로 닫아도 다시 열면 그대로).
 */
export function useFeedback({ showToast, onLoginRequired, context }: UseFeedbackArgs) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<FeedbackKind | null>(null);
  const [message, setMessage] = useState("");
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const trimmedLength = message.trim().length;
  const canSubmit =
    !submitting &&
    kind != null &&
    consent &&
    trimmedLength >= FEEDBACK_MESSAGE_MIN_UI &&
    trimmedLength <= FEEDBACK_MESSAGE_MAX;

  const openFeedback = useCallback(() => setOpen(true), []);

  const closeFeedback = useCallback(() => setOpen(false), []);

  /** 의견 탭의 "카카오 로그인하고 의견 보내기" — 문의 모달을 닫고 로그인 안내 모달로 */
  const requestLogin = useCallback(() => {
    setOpen(false);
    onLoginRequired();
  }, [onLoginRequired]);

  const submit = useCallback(async () => {
    if (!canSubmit || kind == null) return;
    let token: string | null = null;
    try {
      token = localStorage.getItem(TOKEN_KEY);
    } catch {
      token = null;
    }
    if (!token) {
      setOpen(false);
      onLoginRequired();
      return;
    }
    setSubmitting(true);
    try {
      const r = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          kind,
          message: message.trim(),
          consent: true,
          page: context.page || undefined,
          apartmentId: context.apartmentId || undefined,
          apartmentName: context.apartmentName || undefined,
        }),
      });
      if (r.status === 201) {
        setMessage("");
        setKind(null);
        setConsent(false);
        setOpen(false);
        showToast(FEEDBACK_SENT_TOAST);
        return;
      }
      if (r.status === 429) {
        showToast(FEEDBACK_TOO_MANY_TOAST);
        return;
      }
      if (r.status === 401) {
        // 토큰 만료·로그아웃 — 쓰던 글은 남기고 로그인 안내로
        setOpen(false);
        onLoginRequired();
        return;
      }
      const j = (await r.json().catch(() => null)) as { error?: string } | null;
      showToast(j?.error || "의견을 보내지 못했어요. 잠시 뒤 다시 시도해 주세요");
    } catch {
      showToast("서버에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요");
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, kind, message, context, showToast, onLoginRequired]);

  return {
    open,
    openFeedback,
    closeFeedback,
    requestLogin,
    kind,
    setKind,
    message,
    setMessage,
    consent,
    setConsent,
    submitting,
    canSubmit,
    submit,
  };
}
