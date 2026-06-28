import { useState, useCallback, useRef, useEffect } from "react";
import { TOKEN_KEY } from "@/lib/authToken";

/**
 * 마케팅 수신 동의 상태 훅
 * - 카카오 신규 가입(needsMarketingConsent) 직후 모달 open
 * - submit(consent): POST /api/auth/kakao-consent 로 기록 후 모달 닫음
 * - 정보 탭 토글(D3): 로그인 손님이 언제든 동의/철회. setConsent 로 현재 상태 갱신.
 * 동의/거부 둘 다 서버에 기록(서버 측 null=미선택 상태 해소)
 *
 * 현재 동의 상태는 localStorage 에도 영속(CONSENT_KEY) — 새로고침/재방문 시 콜백 없이 복원.
 * 서버가 진실의 원천이며, 토글 시 서버 갱신 후 로컬도 동기화한다.
 */
type ShowToast = (_msg: string) => void;

const CONSENT_KEY = "mibunyang_consent_marketing";

/** localStorage 에서 동의 상태 복원 ("true"/"false"/없음 → boolean|null) */
function readStoredConsent(): boolean | null {
  try {
    const v = localStorage.getItem(CONSENT_KEY);
    if (v === "true") return true;
    if (v === "false") return false;
  } catch {
    /* noop: localStorage 미가용 무시 */
  }
  return null;
}

function writeStoredConsent(consent: boolean | null): void {
  try {
    if (consent === null) localStorage.removeItem(CONSENT_KEY);
    else localStorage.setItem(CONSENT_KEY, String(consent));
  } catch {
    /* noop: localStorage 미가용 무시 */
  }
}

export function useMarketingConsent(showToast: ShowToast) {
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentSubmitting, setConsentSubmitting] = useState(false);
  // 현재 동의 상태 (true=동의 / false=거부 / null=미선택·비로그인)
  const [consentMarketing, setConsentMarketing] = useState<boolean | null>(readStoredConsent);
  const showToastRef = useRef(showToast);
  useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);

  const openConsent = useCallback(() => setConsentOpen(true), []);

  /** 콜백/로그인 시 서버가 알려준 현재 동의 상태로 초기화 (localStorage 동기화) */
  const initConsent = useCallback((consent: boolean | null) => {
    setConsentMarketing(consent);
    writeStoredConsent(consent);
  }, []);

  const submitConsent = useCallback(async (consent: boolean) => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setConsentOpen(false);
      return;
    }
    setConsentSubmitting(true);
    try {
      const res = await fetch("/api/auth/kakao-consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, consent }),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (data.ok) {
        setConsentMarketing(consent);
        writeStoredConsent(consent);
        showToastRef.current(consent ? "마케팅 수신에 동의하셨습니다" : "마케팅 수신을 거부하셨습니다");
      } else {
        // 서버 미기록(ok:false) — 정보 탭 토글에서 무피드백 방지. 다음 로그인 시 재요청됨.
        showToastRef.current("잠시 후 다시 시도해주세요");
      }
    } catch {
      // best-effort — 네트워크 실패해도 모달/토글은 닫음(다음 로그인 시 재요청). 토글 무피드백 방지.
      showToastRef.current("잠시 후 다시 시도해주세요");
    } finally {
      setConsentSubmitting(false);
      setConsentOpen(false);
    }
  }, []);

  return { consentOpen, consentSubmitting, consentMarketing, openConsent, submitConsent, initConsent };
}
