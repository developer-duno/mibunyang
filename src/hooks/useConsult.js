import { useState, useCallback, useEffect } from "react";

export function useConsult(showToast, favoriteIds) {
  const [consultForm, setConsultForm] = useState({ name: "", phone: "", interestedApts: [], budgetMin: "", budgetMax: "", consultType: "방문상담", message: "" });
  const [consultSubmitted, setConsultSubmitted] = useState(false);
  const [submittedConsults, setSubmittedConsults] = useState(() => {
    try { return JSON.parse(localStorage.getItem("mibunyang_consults") || "[]"); } catch { return []; }
  });
  const handleConsultSubmit = useCallback(() => {
    if (!consultForm.name?.trim() || !consultForm.phone?.trim()) {
      showToast("이름과 연락처를 입력해주세요");
      return;
    }
    const entry = { ...consultForm, interestedApts: [...favoriteIds], submittedAt: new Date().toISOString(), id: Date.now().toString() };
    setSubmittedConsults(prev => [...prev, entry]);
    setConsultSubmitted(true);
    showToast("상담 신청이 완료되었습니다");
  }, [showToast, favoriteIds, consultForm]);
  useEffect(() => { try { localStorage.setItem("mibunyang_consults", JSON.stringify(submittedConsults)); } catch {} }, [submittedConsults]);
  return { consultForm, setConsultForm, consultSubmitted, setConsultSubmitted, submittedConsults, handleConsultSubmit };
}
