import { useState, useCallback, useRef, useEffect } from "react";
import { TOKEN_KEY } from "@/lib/authToken";

/**
 * 마케팅 수신 동의 모달 상태 훅
 * - 카카오 신규 가입(needsMarketingConsent) 직후 open
 * - submit(consent): POST /api/auth/kakao-consent 로 기록 후 모달 닫음
 * 동의/거부 둘 다 서버에 기록(서버 측 null=미선택 상태 해소)
 */
type ShowToast = (_msg: string) => void;

export function useMarketingConsent(showToast: ShowToast) {
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentSubmitting, setConsentSubmitting] = useState(false);
  const showToastRef = useRef(showToast);
  useEffect(() => { showToastRef.current = showToast; }, [showToast]);

  const openConsent = useCallback(() => setConsentOpen(true), []);

  const submitConsent = useCallback(async (consent: boolean) => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) { setConsentOpen(false); return; }
    setConsentSubmitting(true);
    try {
      const res = await fetch("/api/auth/kakao-consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, consent }),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (data.ok && consent) showToastRef.current("마케팅 수신에 동의하셨습니다");
    } catch {
      // best-effort — 기록 실패해도 모달은 닫음(서비스 이용엔 영향 0, 다음 로그인 시 재요청)
    } finally {
      setConsentSubmitting(false);
      setConsentOpen(false);
    }
  }, []);

  return { consentOpen, consentSubmitting, openConsent, submitConsent };
}
