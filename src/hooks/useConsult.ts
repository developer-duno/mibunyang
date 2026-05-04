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
}

export interface SubmittedConsult extends ConsultForm {
  submittedAt?: string;
  id?: string;
}

export function useConsult(showToast: (_msg: string) => void, favoriteIds: string[]) {
  const [consultForm, setConsultForm] = useState<ConsultForm>({ name: "", phone: "", interestedApts: [], budgetMin: "", budgetMax: "", consultType: "방문상담", message: "" });
  const [consultSubmitted, setConsultSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submittedConsults, setSubmittedConsults] = useState<SubmittedConsult[]>([]);

  const handleConsultSubmit = useCallback(async () => {
    if (!consultForm.name?.trim() || !consultForm.phone?.trim()) {
      showToast("이름과 연락처를 입력해주세요");
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
      try { json = await res.json() as { ok?: boolean; error?: string }; } catch { throw new Error("서버 응답 오류"); }
      if (!json?.ok) throw new Error(json?.error || "서버 오류");
      setConsultSubmitted(true);
      showToast("상담 신청이 완료되었습니다");
    } catch {
      // API 실패 시 localStorage 폴백 (개인정보 마스킹)
      const fallback: SubmittedConsult = { ...entry, name: maskName(entry.name), phone: maskPhone(entry.phone), submittedAt: new Date().toISOString(), id: Date.now().toString() };
      const updated = [...submittedConsults, fallback];
      setSubmittedConsults(updated);
      try { localStorage.setItem("mibunyang_consults", JSON.stringify(updated)); } catch { /* noop: localStorage 쿼터 초과 등 무시 */ }
      setConsultSubmitted(true);
      showToast("상담 신청이 저장되었습니다 (오프라인)");
    } finally {
      setSubmitting(false);
    }
  }, [showToast, favoriteIds, consultForm, submitting, submittedConsults]);

  // 전문가용: 서버에서 상담 목록 조회
  const fetchConsults = useCallback(async (token: string) => {
    try {
      const res = await fetch("/api/consults", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json() as { ok?: boolean; data?: SubmittedConsult[] };
      if (json.ok && Array.isArray(json.data)) {
        setSubmittedConsults(json.data);
      }
    } catch {
      // 네트워크 오류 시 기존 상태 유지
    }
  }, []);

  return { consultForm, setConsultForm, consultSubmitted, setConsultSubmitted, submitting, submittedConsults, handleConsultSubmit, fetchConsults };
}
