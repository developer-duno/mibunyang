import { memo, useCallback, useEffect, useRef, useState } from "react";
import { C, F } from "@/theme";
import { TOKEN_KEY } from "@/lib/authToken";
import { feedbackKindLabel } from "@/constants/feedbackKinds";

/**
 * AdminFeedback — 손님 의견 목록 (세션574, 관리자 대시보드 섹션). AdminConsults 패턴 복사.
 * GET /api/feedback offset/limit(50) + "더 보기", PATCH 처리 표시, DELETE 삭제(확인 1회).
 */
const PAGE_SIZE = 50;

export type FeedbackItem = {
  id: number;
  userEmail: string;
  userName: string | null;
  kind: string;
  message: string;
  page: string | null;
  apartmentId: string | null;
  apartmentName: string | null;
  userAgent: string | null;
  status: "new" | "done";
  createdAt: string;
  handledAt: string | null;
};

type FeedbackResponse = { ok?: boolean; data?: FeedbackItem[]; count?: number; error?: string };

const KIND_TONE: Record<string, { bg: string; fg: string }> = {
  bug: { bg: C.redLight, fg: C.red },
  data: { bg: C.amberLight, fg: C.amber },
  suggest: { bg: C.blueLight, fg: C.blue },
  other: { bg: C.slate100, fg: C.sub },
};

function authHeader(): Record<string, string> | null {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : null;
}

export const AdminFeedback = memo(function AdminFeedback() {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    []
  );

  useEffect(() => {
    const headers = authHeader();
    if (!headers) {
      setError("인증이 필요합니다");
      setLoading(false);
      return;
    }
    fetch(`/api/feedback?offset=0&limit=${PAGE_SIZE}`, { headers })
      .then((r) => r.json())
      .then((j: FeedbackResponse) => {
        if (!mountedRef.current) return;
        if (j.ok && Array.isArray(j.data)) {
          setItems(j.data);
          setTotal(typeof j.count === "number" ? j.count : null);
        } else setError(j.error || "의견 목록 조회에 실패했습니다");
      })
      .catch(() => {
        if (mountedRef.current) setError("서버 연결 실패");
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });
  }, []);

  const handleLoadMore = useCallback(() => {
    if (loadingMore) return;
    const headers = authHeader();
    if (!headers) return;
    setLoadingMore(true);
    fetch(`/api/feedback?offset=${items.length}&limit=${PAGE_SIZE}`, { headers })
      .then((r) => r.json())
      .then((j: FeedbackResponse) => {
        if (!mountedRef.current) return;
        if (j.ok && Array.isArray(j.data)) {
          const page = j.data;
          // id dedup — offset 페이징 중 새 의견이 들어와 경계가 밀려도 중복 없이
          setItems((cur) => {
            const seen = new Set(cur.map((c) => c.id));
            return [...cur, ...page.filter((c) => !seen.has(c.id))];
          });
          if (typeof j.count === "number") setTotal(j.count);
        } else setError(j.error || "의견 목록 조회에 실패했습니다");
      })
      .catch(() => {
        if (mountedRef.current) setError("서버 연결 실패");
      })
      .finally(() => {
        if (mountedRef.current) setLoadingMore(false);
      });
  }, [loadingMore, items.length]);

  const handleToggle = useCallback((item: FeedbackItem) => {
    const headers = authHeader();
    if (!headers) return;
    const next = item.status === "done" ? "new" : "done";
    fetch("/api/feedback", {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id, status: next }),
    })
      .then((r) => r.json())
      .then((j: { ok?: boolean; error?: string }) => {
        if (!mountedRef.current) return;
        if (j.ok) {
          setItems((cur) =>
            cur.map((c) =>
              c.id === item.id
                ? { ...c, status: next, handledAt: next === "done" ? new Date().toISOString() : null }
                : c
            )
          );
        } else setError(j.error || "처리 상태 변경에 실패했습니다");
      })
      .catch(() => {
        if (mountedRef.current) setError("서버 연결 실패");
      });
  }, []);

  const handleDelete = useCallback((id: number) => {
    if (!window.confirm("이 의견을 삭제할까요? 보낸 이의 이메일·이름과 내용이 영구 삭제됩니다.")) return;
    const headers = authHeader();
    if (!headers) return;
    fetch(`/api/feedback?id=${encodeURIComponent(String(id))}`, { method: "DELETE", headers })
      .then((r) => r.json())
      .then((j: { ok?: boolean; error?: string }) => {
        if (!mountedRef.current) return;
        if (j.ok) {
          setItems((cur) => cur.filter((c) => c.id !== id));
          setTotal((t) => (typeof t === "number" ? Math.max(0, t - 1) : t));
        } else setError(j.error || "삭제에 실패했습니다");
      })
      .catch(() => {
        if (mountedRef.current) setError("서버 연결 실패");
      });
  }, []);

  const hasMore = total != null && items.length < total;
  const smallBtn = {
    fontSize: F.xs,
    fontWeight: 600,
    borderRadius: 6,
    padding: "4px 10px",
    cursor: "pointer",
    minHeight: 28,
  } as const;

  return (
    <div data-testid="admin-feedback" style={{ marginBottom: 16 }}>
      <div
        style={{
          background: C.indigoLight,
          borderRadius: 8,
          padding: "10px 14px",
          marginBottom: 12,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span style={{ fontSize: F.sm, fontWeight: 700, color: C.indigo }}>손님 의견</span>
        <span style={{ fontSize: F.xs, color: C.indigo }}>
          {loading ? "..." : `총 ${total ?? items.length}건 (${items.length}건 표시 중)`}
        </span>
      </div>

      {loading ? (
        <div style={{ padding: "16px 0", textAlign: "center", fontSize: F.sm, color: C.muted }}>
          의견 목록 로딩 중...
        </div>
      ) : error ? (
        <div style={{ background: C.redLight, borderRadius: 8, padding: "12px 14px", fontSize: F.sm, color: C.red }}>
          {error}
        </div>
      ) : items.length === 0 ? (
        <div
          style={{
            background: C.card,
            borderRadius: 12,
            padding: "40px 20px",
            border: `1px solid ${C.border}`,
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: F.md, fontWeight: 700, color: C.text, marginBottom: 4 }}>
            아직 받은 의견이 없습니다
          </div>
          <div style={{ fontSize: F.sm, color: C.muted }}>손님이 의견 버튼으로 보내면 여기에 표시됩니다</div>
        </div>
      ) : (
        <>
          {items.map((f) => {
            const tone = KIND_TONE[f.kind] ?? KIND_TONE.other;
            const done = f.status === "done";
            const who = f.userName ? `${f.userName} (${f.userEmail})` : f.userEmail;
            const apt = f.apartmentName
              ? f.apartmentId
                ? `${f.apartmentName} (${f.apartmentId})`
                : f.apartmentName
              : f.apartmentId || "";
            const where = [f.page, apt].filter(Boolean).join(" · ");
            return (
              <div
                key={f.id}
                data-testid="admin-feedback-item"
                style={{
                  background: C.card,
                  borderRadius: 10,
                  border: `1px solid ${C.border}`,
                  padding: 14,
                  marginBottom: 8,
                  opacity: done ? 0.6 : 1,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 8,
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span
                      style={{
                        fontSize: F.xs,
                        fontWeight: 700,
                        color: tone.fg,
                        background: tone.bg,
                        borderRadius: 999,
                        padding: "2px 8px",
                      }}
                    >
                      {feedbackKindLabel(f.kind)}
                    </span>
                    <span style={{ fontSize: F.xs, fontWeight: 700, color: done ? C.green : C.amber }}>
                      {done ? "처리 완료" : "새 의견"}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: F.micro, color: C.muted }}>
                      {f.createdAt ? new Date(f.createdAt).toLocaleString("ko-KR") : ""}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleToggle(f)}
                      aria-label={done ? `의견 ${f.id} 새 의견으로 되돌리기` : `의견 ${f.id} 처리 완료로 표시`}
                      style={{
                        ...smallBtn,
                        color: C.indigo,
                        background: C.indigoLight,
                        border: `1px solid ${C.indigo}30`,
                      }}
                    >
                      {done ? "되돌리기" : "처리 완료"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(f.id)}
                      aria-label={`의견 ${f.id} 삭제`}
                      style={{ ...smallBtn, color: C.red, background: C.redLight, border: `1px solid ${C.redBorder}` }}
                    >
                      삭제
                    </button>
                  </div>
                </div>
                <div
                  style={{ fontSize: F.sm, color: C.text, lineHeight: 1.6, whiteSpace: "pre-wrap", marginBottom: 6 }}
                >
                  {f.message}
                </div>
                <div style={{ fontSize: F.xs, color: C.sub, lineHeight: 1.8 }}>
                  <div>보낸 이: {who}</div>
                  {where && <div>화면: {where}</div>}
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
                style={{
                  padding: "10px 32px",
                  borderRadius: 8,
                  border: `1px solid ${C.border}`,
                  background: C.card,
                  color: C.text,
                  fontSize: F.base,
                  fontWeight: 600,
                  cursor: loadingMore ? "default" : "pointer",
                  minHeight: 44,
                  opacity: loadingMore ? 0.6 : 1,
                }}
              >
                {loadingMore ? "불러오는 중..." : `더 보기 (${(total ?? items.length) - items.length}개 남음)`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
});
