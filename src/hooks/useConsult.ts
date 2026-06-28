import { useState, useCallback } from "react";
import { maskName, maskPhone } from "@/lib/format";

export interface ConsultForm {
  name: string;
  phone: string;
  interestedApts: string[];
  budgetMin: string;
  budgetMax: string;
  consultType: string;
  message: string;
  consent: boolean;
}

export interface SubmittedConsult extends ConsultForm {
  submittedAt?: string;
  id?: string;
}

export function useConsult(showToast: (_msg: string) => void, favoriteIds: string[]) {
  const [consultForm, setConsultForm] = useState<ConsultForm>({
    name: "",
    phone: "",
    interestedApts: [],
    budgetMin: "",
    budgetMax: "",
    consultType: "방문상담",
    message: "",
    consent: false,
  });
  const [consultSubmitted, setConsultSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submittedConsults, setSubmittedConsults] = useState<SubmittedConsult[]>([]);

  const handleConsultSubmit = useCallback(async () => {
    if (!consultForm.name?.trim() || !consultForm.phone?.trim()) {
      showToast("이름과 연락처를 입력해주세요");
      return;
    }
    if (consultForm.consent !== true) {
      showToast("개인정보 수집·이용 동의가 필요합니다");
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    const entry: ConsultForm = { ...consultForm, interestedApts: [...favoriteIds] };
    try {
      const res = await fetch("/api/consults", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry),
      });
      let json: { ok?: boolean; error?: string } | undefined;
      try {
        json = (await res.json()) as { ok?: boolean; error?: string };
      } catch {
        throw new Error("서버 응답 오류");
      }
      if (!json?.ok) throw new Error(json?.error || "서버 오류");
      setConsultSubmitted(true);
      showToast("상담 신청이 완료되었습니다");
    } catch {
      // API 실패 시 localStorage 폴백 (개인정보 마스킹)
      const fallback: SubmittedConsult = {
        ...entry,
        name: maskName(entry.name),
        phone: maskPhone(entry.phone),
        submittedAt: new Date().toISOString(),
        id: Date.now().toString(),
      };
      const updated = [...submittedConsults, fallback];
      setSubmittedConsults(updated);
      try {
        localStorage.setItem("mibunyang_consults", JSON.stringify(updated));
      } catch {
        /* noop: localStorage 쿼터 초과 등 무시 */
      }
      setConsultSubmitted(true);
      showToast("상담 신청이 저장되었습니다 (오프라인)");
    } finally {
      setSubmitting(false);
    }
  }, [showToast, favoriteIds, consultForm, submitting, submittedConsults]);

  // 서버 상담 목록 조회(fetchConsults)는 세션 405 에 AdminConsults(관리자 대시보드) 자체 fetch 로 이관.
  // submittedConsults 는 handleConsultSubmit 오프라인 폴백 저장소로 보존.
  return {
    consultForm,
    setConsultForm,
    consultSubmitted,
    setConsultSubmitted,
    submitting,
    submittedConsults,
    handleConsultSubmit,
  };
}
