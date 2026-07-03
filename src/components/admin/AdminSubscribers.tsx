import { memo, useEffect, useRef, useState } from "react";
import { C, F } from "@/theme";
import { TOKEN_KEY } from "@/lib/authToken";

/**
 * AdminSubscribers — 분양 알림 구독자 통계 + 최근 발송 로그 (세션 467 PR2).
 * 마운트 시 자체 fetch (AdminConsults 패턴 답습). phone 은 서버가 마스킹해 원문 미노출.
 */

type SubscriberStats = {
  total: number;
  active: number;
  optedOut: number;
  byScope: { apartment: number; region: number; nationwide: number };
};

type NotificationLogItem = {
  id: number;
  apartmentId: string;
  apartmentName: string;
  houseManageNo: string;
  eventDate: string | null;
  channel: string;
  status: string;
  failReason: string | null;
  createdAt: string | null;
  phoneMasked: string;
};

type SubscribersResponse = {
  ok?: boolean;
  stats?: SubscriberStats;
  logs?: NotificationLogItem[];
  logsError?: string;
  error?: string;
};

const STATUS_LABEL: Record<string, string> = {
  sent: "발송",
  dry_run: "모의",
  pending: "대기",
  failed: "실패",
};

export const AdminSubscribers = memo(function AdminSubscribers() {
  const [stats, setStats] = useState<SubscriberStats | null>(null);
  const [logs, setLogs] = useState<NotificationLogItem[]>([]);
  const [logsNote, setLogsNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    []
  );

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setError("인증이 필요합니다");
      setLoading(false);
      return;
    }
    fetch("/api/admin/subscribers", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((j: SubscribersResponse) => {
        if (!mountedRef.current) return;
        if (j.ok && j.stats) {
          setStats(j.stats);
          setLogs(Array.isArray(j.logs) ? j.logs : []);
          if (j.logsError) setLogsNote(j.logsError);
        } else setError(j.error || "구독자 현황 조회에 실패했습니다");
      })
      .catch(() => {
        if (mountedRef.current) setError("서버 연결 실패");
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });
  }, []);

  return (
    <div data-testid="admin-subscribers" style={{ marginBottom: 16 }}>
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
        <span style={{ fontSize: F.sm, fontWeight: 700, color: C.indigo }}>분양 알림 구독자</span>
        <span style={{ fontSize: F.xs, color: C.indigo }}>
          {loading ? "..." : stats ? `활성 ${stats.active}명 / 철회 ${stats.optedOut}명` : ""}
        </span>
      </div>

      {loading ? (
        <div style={{ padding: "16px 0", textAlign: "center", fontSize: F.sm, color: C.muted }}>
          구독자 현황 로딩 중...
        </div>
      ) : error ? (
        <div style={{ background: C.redLight, borderRadius: 8, padding: "12px 14px", fontSize: F.sm, color: C.red }}>
          {error}
        </div>
      ) : (
        <>
          {stats && (
            <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              {[
                { label: "단지 구독", value: stats.byScope.apartment },
                { label: "지역 구독", value: stats.byScope.region },
                { label: "전국 구독", value: stats.byScope.nationwide },
              ].map((s) => (
                <div
                  key={s.label}
                  style={{
                    flex: "1 1 90px",
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 10,
                    padding: "10px 12px",
                    textAlign: "center",
                  }}
                >
                  <div style={{ fontSize: F.lg, fontWeight: 800, color: C.text }}>{s.value}</div>
                  <div style={{ fontSize: F.xs, color: C.muted }}>{s.label}</div>
                </div>
              ))}
            </div>
          )}

          {logsNote && (
            <div
              style={{
                background: C.redLight,
                borderRadius: 8,
                padding: "10px 12px",
                fontSize: F.xs,
                color: C.red,
                marginBottom: 8,
              }}
            >
              {logsNote}
            </div>
          )}

          {logs.length === 0 ? (
            <div
              style={{
                background: C.card,
                borderRadius: 12,
                padding: "24px 20px",
                border: `1px solid ${C.border}`,
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: F.sm, color: C.muted }}>
                아직 발송 이력이 없습니다 (주간 월요일 발송기가 기록하면 여기에 표시됩니다)
              </div>
            </div>
          ) : (
            logs.map((l) => (
              <div
                key={l.id}
                style={{
                  background: C.card,
                  borderRadius: 10,
                  border: `1px solid ${C.border}`,
                  padding: "10px 14px",
                  marginBottom: 6,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <div style={{ fontSize: F.xs, color: C.sub, lineHeight: 1.7, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: C.text }}>{l.apartmentName}</div>
                  <div>
                    {l.phoneMasked} · 접수 {l.eventDate ?? "-"} ·{" "}
                    {l.createdAt ? new Date(l.createdAt).toLocaleString("ko-KR") : ""}
                  </div>
                  {l.failReason && <div style={{ color: C.red }}>{l.failReason}</div>}
                </div>
                <span
                  style={{
                    fontSize: F.micro,
                    fontWeight: 700,
                    color: l.status === "failed" ? C.red : l.status === "sent" ? C.green : C.muted,
                    whiteSpace: "nowrap",
                  }}
                >
                  {STATUS_LABEL[l.status] ?? l.status}
                </span>
              </div>
            ))
          )}
        </>
      )}
    </div>
  );
});
