import { memo, useCallback, useEffect, useRef, useState } from "react";
import { C, F } from "@/theme";
import { TOKEN_KEY } from "@/lib/authToken";
import type { SubmittedConsult } from "@/hooks/useConsult";

/**
 * AdminConsults — 상담 요청 목록 (세션 405 구 expertConsults 탭 이식, 관리자 대시보드 섹션).
 * 마운트 시 자체 fetch (CollectorMonitoring 패턴 — 구 useAppNavigation 탭 effect 의 이관).
 * GET /api/consults 페이지네이션 (세션 425) — offset/limit + "더 보기". count 로 총건수 표시.
 */
const PAGE_SIZE = 50; // API limit 과 일치 — 프론트는 항상 limit 명시 전송 (기본값 의존 안 함)

type AdminConsultsProps = {
  /** 단지 id → 이름 (AdminDashboard 의 scored 파생 — 관심단지 이름 표시용) */
  aptNames: Map<string, string>;
};

type ConsultsResponse = { ok?: boolean; data?: SubmittedConsult[]; count?: number; error?: string };

export const AdminConsults = memo(function AdminConsults({ aptNames }: AdminConsultsProps) {
  const [consults, setConsults] = useState<SubmittedConsult[]>([]);
  const [total, setTotal] = useState<number | null>(null); // supabase count 는 number|null
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  // 더보기 핸들러는 useEffect 의 지역 cancelled 를 못 보므로 컴포넌트 수명 가드를 ref 로 통일
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) { setError("인증이 필요합니다"); setLoading(false); return; }
    fetch(`/api/consults?offset=0&limit=${PAGE_SIZE}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then((j: ConsultsResponse) => {
        if (!mountedRef.current) return;
        if (j.ok && Array.isArray(j.data)) { setConsults(j.data); setTotal(typeof j.count === "number" ? j.count : null); }
        else setError(j.error || "상담 목록 조회에 실패했습니다");
      })
      .catch(() => { if (mountedRef.current) setError("서버 연결 실패"); })
      .finally(() => { if (mountedRef.current) setLoading(false); });
  }, []);

  const handleLoadMore = useCallback(() => {
    if (loadingMore) return; // 중복 클릭 가드
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    setLoadingMore(true);
    fetch(`/api/consults?offset=${consults.length}&limit=${PAGE_SIZE}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then((j: ConsultsResponse) => {
        if (!mountedRef.current) return;
        if (j.ok && Array.isArray(j.data)) {
          const page = j.data;
          // id dedup — offset 페이징 + 동시 INSERT 행 시프트 시 경계 중복 방어
          setConsults(cur => {
            const seen = new Set(cur.map(c => c.id));
            return [...cur, ...page.filter(c => !seen.has(c.id))];
          });
          if (typeof j.count === "number") setTotal(j.count);
        } else setError(j.error || "상담 목록 조회에 실패했습니다");
      })
      .catch(() => { if (mountedRef.current) setError("서버 연결 실패"); })
      .finally(() => { if (mountedRef.current) setLoadingMore(false); });
  }, [loadingMore, consults.length]);

  const handleDelete = useCallback((id: string | undefined) => {
    if (id == null) return;
    if (!window.confirm("이 상담 기록을 삭제할까요? 개인정보(이름·연락처)가 영구 삭제됩니다.")) return;
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    fetch(`/api/consults?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then((j: { ok?: boolean; error?: string }) => {
        if (!mountedRef.current) return;
        if (j.ok) {
          setConsults(cur => cur.filter(c => c.id !== id));
          setTotal(t => (typeof t === "number" ? Math.max(0, t - 1) : t));
        } else {
          setError(j.error || "삭제에 실패했습니다");
        }
      })
      .catch(() => { if (mountedRef.current) setError("서버 연결 실패"); });
  }, []);

  const hasMore = total != null && consults.length < total;

  return (
    <div data-testid="admin-consults" style={{ marginBottom: 16 }}>
      <div style={{ background: C.indigoLight, borderRadius: 8, padding: "10px 14px", marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: F.sm, fontWeight: 700, color: C.indigo }}>상담 요청 목록</span>
        <span style={{ fontSize: F.xs, color: C.indigo }}>{loading ? "..." : `총 ${total ?? consults.length}건 (${consults.length}건 표시 중)`}</span>
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
        <>
          {consults.map((c) => {
            const names = c.interestedApts.map(id => aptNames.get(id) ?? id);
            return (
              <div key={c.id} style={{ background: C.card, borderRadius: 10, border: `1px solid ${C.border}`, padding: 14, marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8 }}>
                  <span style={{ fontSize: F.base, fontWeight: 700, color: C.text }}>{c.name}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: F.micro, color: C.muted }}>{c.submittedAt ? new Date(c.submittedAt).toLocaleString("ko-KR") : ""}</span>
                    <button
                      type="button"
                      onClick={() => handleDelete(c.id)}
                      aria-label={`${c.name} 상담 기록 삭제`}
                      style={{ fontSize: F.xs, fontWeight: 600, color: C.red, background: C.redLight, border: `1px solid ${C.redBorder}`, borderRadius: 6, padding: "4px 10px", cursor: "pointer", minHeight: 28 }}
                    >삭제</button>
                  </div>
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
          })}
          {hasMore && (
            <div style={{ textAlign: "center", padding: "12px 0" }}>
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={loadingMore}
                style={{ padding: "10px 32px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.card, color: C.text, fontSize: F.base, fontWeight: 600, cursor: loadingMore ? "default" : "pointer", minHeight: 44, opacity: loadingMore ? 0.6 : 1 }}
              >
                {loadingMore ? "불러오는 중..." : `더 보기 (${(total ?? consults.length) - consults.length}개 남음)`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
});
