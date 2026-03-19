import { useState, useCallback } from "react";

export function useConsult(showToast, favoriteIds) {
  const [consultForm, setConsultForm] = useState({ name: "", phone: "", interestedApts: [], budgetMin: "", budgetMax: "", consultType: "방문상담", message: "" });
  const [consultSubmitted, setConsultSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submittedConsults, setSubmittedConsults] = useState([]);

  const handleConsultSubmit = useCallback(async () => {
    if (!consultForm.name?.trim() || !consultForm.phone?.trim()) {
      showToast("이름과 연락처를 입력해주세요");
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    const entry = { ...consultForm, interestedApts: [...favoriteIds] };
    try {
      const res = await fetch("/api/consults", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "서버 오류");
      setConsultSubmitted(true);
      showToast("상담 신청이 완료되었습니다");
    } catch (err) {
      // API 실패 시 localStorage 폴백
      const fallback = { ...entry, submittedAt: new Date().toISOString(), id: Date.now().toString() };
      setSubmittedConsults(prev => [...prev, fallback]);
      try { localStorage.setItem("mibunyang_consults", JSON.stringify([...submittedConsults, fallback])); } catch {}
      setConsultSubmitted(true);
      showToast("상담 신청이 저장되었습니다 (오프라인)");
    } finally {
      setSubmitting(false);
    }
  }, [showToast, favoriteIds, consultForm, submitting, submittedConsults]);

  // 전문가용: 서버에서 상담 목록 조회
  const fetchConsults = useCallback(async (token) => {
    try {
      const res = await fetch("/api/consults", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (json.ok && Array.isArray(json.data)) {
        setSubmittedConsults(json.data);
      }
    } catch {
      // 네트워크 오류 시 기존 상태 유지
    }
  }, []);

  return { consultForm, setConsultForm, consultSubmitted, setConsultSubmitted, submitting, submittedConsults, handleConsultSubmit, fetchConsults };
}
