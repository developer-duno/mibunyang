import { memo, useEffect, useState } from "react";
import { C, F } from "@/theme";
import type { SubmittedConsult } from "@/hooks/useConsult";

/**
 * AdminConsults — 상담 요청 목록 (세션 405 구 expertConsults 탭 이식, 관리자 대시보드 섹션).
 * 마운트 시 자체 fetch (CollectorMonitoring 패턴 — 구 useAppNavigation 탭 effect 의 이관).
 * GET /api/consults limit 100 고정 — 초과분 잘림 (후속: 페이지네이션 BACKLOG).
 */
type AdminConsultsProps = {
  /** 단지 id → 이름 (AdminDashboard 의 scored 파생 — 관심단지 이름 표시용) */
  aptNames: Map<string, string>;
};

export const AdminConsults = memo(function AdminConsults({ aptNames }: AdminConsultsProps) {
  const [consults, setConsults] = useState<SubmittedConsult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("expertToken");
    if (!token) { setError("인증이 필요합니다"); setLoading(false); return; }
    let cancelled = false;
    fetch("/api/consults", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then((j: { ok?: boolean; data?: SubmittedConsult[]; error?: string }) => {
        if (cancelled) return;
        if (j.ok && Array.isArray(j.data)) setConsults(j.data);
        else setError(j.error || "상담 목록 조회에 실패했습니다");
      })
      .catch(() => { if (!cancelled) setError("서버 연결 실패"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div data-testid="admin-consults" style={{ marginBottom: 16 }}>
      <div style={{ background: C.indigoLight, borderRadius: 8, padding: "10px 14px", marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: F.sm, fontWeight: 700, color: C.indigo }}>상담 요청 목록</span>
        <span style={{ fontSize: F.xs, color: C.indigo }}>{loading ? "..." : `${consults.length}건`}</span>
      </div>

      {loading ? (
        <div style={{ padding: "16px 0", textAlign: "center", fontSize: F.sm, color: C.muted }}>상담 목록 로딩 중...</div>
      ) : error ? (
        <div style={{ background: C.redLight, borderRadius: 8, padding: "12px 14px", fontSize: F.sm, color: C.red }}>{error}</div>
      ) : consults.length === 0 ? (
        <div style={{ background: C.card, borderRadius: 12, padding: "40px 20px", border: `1px solid ${C.border}`, textAlign: "center" }}>
          <div style={{ fontSize: F.md, fontWeight: 700, color: C.text, marginBottom: 4 }}>아직 상담 요청이 없습니다</div>
          <div style={{ fontSize: F.sm, color: C.muted }}>소비자가 상담을 신청하면 여기에 표시됩니다</div>
        </div>
      ) : (
        consults.map((c) => {
          const names = c.interestedApts.map(id => aptNames.get(id) ?? id);
          return (
            <div key={c.id} style={{ background: C.card, borderRadius: 10, border: `1px solid ${C.border}`, padding: 14, marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: F.base, fontWeight: 700, color: C.text }}>{c.name}</span>
                <span style={{ fontSize: F.micro, color: C.muted }}>{c.submittedAt ? new Date(c.submittedAt).toLocaleString("ko-KR") : ""}</span>
              </div>
              <div style={{ fontSize: F.xs, color: C.sub, lineHeight: 1.8 }}>
                <div>연락처: {c.phone}</div>
                <div>상담유형: {c.consultType}</div>
                <div>관심단지: {names.join(", ")}</div>
                {(c.budgetMin || c.budgetMax) && <div>예산: {c.budgetMin || "?"} ~ {c.budgetMax || "?"}만원</div>}
                {c.message && <div>메시지: {c.message}</div>}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
});
