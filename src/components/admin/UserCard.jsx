import { C, F } from "@/theme";
import { STATUS_TABS, SPECIALTY_BADGE, STATUS_LABELS } from "./constants";

export function UserCard({ user, admin }) {
  const badge = SPECIALTY_BADGE[user.specialty] || SPECIALTY_BADGE["기타"];
  const statusLabel = STATUS_LABELS[user.status] || "대기중";
  const statusStyle = STATUS_TABS.find(t => t.key === user.status) || STATUS_TABS[0];

  return (
    <div style={{
      background: C.card, borderRadius: 10, border: `1px solid ${C.border}`, padding: 16,
      boxShadow: "0 1px 3px rgba(0,0,0,0.04)"
    }}>
      {/* Header row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          {admin.selectedStatus === "pending" && (
            <input type="checkbox" checked={admin.selectedEmails.has(user.email)}
              onChange={() => admin.toggleSelectEmail(user.email)}
              style={{ width: 16, height: 16, marginTop: 2, cursor: "pointer" }} />
          )}
          <div>
            <div style={{ fontSize: F.base, fontWeight: 800, color: C.text }}>{user.name}</div>
            <div style={{ fontSize: F.xs, color: C.muted }}>{user.email}</div>
          </div>
        </div>
        <span style={{
          fontSize: F.micro, fontWeight: 700, padding: "3px 8px", borderRadius: 4,
          color: statusStyle.color, background: statusStyle.bg
        }}>{statusLabel}</span>
      </div>

      {/* Info grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 12px", marginBottom: 10 }}>
        {user.affiliation && (
          <div>
            <div style={{ fontSize: F.micro, color: C.muted, marginBottom: 1 }}>소속</div>
            <div style={{ fontSize: F.sm, fontWeight: 600, color: C.text }}>{user.affiliation}</div>
          </div>
        )}
        {user.phone && (
          <div>
            <div style={{ fontSize: F.micro, color: C.muted, marginBottom: 1 }}>연락처</div>
            <div style={{ fontSize: F.sm, fontWeight: 600, color: C.text }}>{user.phone}</div>
          </div>
        )}
        {user.specialty && (
          <div>
            <div style={{ fontSize: F.micro, color: C.muted, marginBottom: 1 }}>전문 분야</div>
            <span style={{ fontSize: F.xs, fontWeight: 600, padding: "2px 6px", borderRadius: 3, color: badge.color, background: badge.bg }}>{user.specialty}</span>
          </div>
        )}
        {user.license && (
          <div>
            <div style={{ fontSize: F.micro, color: C.muted, marginBottom: 1 }}>자격증</div>
            <div style={{ fontSize: F.sm, fontWeight: 600, color: C.text }}>{user.license}</div>
          </div>
        )}
        {user.experience != null && (
          <div>
            <div style={{ fontSize: F.micro, color: C.muted, marginBottom: 1 }}>경력</div>
            <div style={{ fontSize: F.sm, fontWeight: 600, color: C.text }}>{user.experience}년</div>
          </div>
        )}
        <div>
          <div style={{ fontSize: F.micro, color: C.muted, marginBottom: 1 }}>가입일</div>
          <div style={{ fontSize: F.sm, fontWeight: 600, color: C.text }}>{new Date(user.createdAt).toLocaleDateString("ko-KR")}</div>
        </div>
      </div>

      {/* Bio */}
      {user.bio && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: F.micro, color: C.muted, marginBottom: 2 }}>자기소개</div>
          <div style={{ fontSize: F.sm, color: C.sub, lineHeight: 1.6, background: C.slate100, borderRadius: 6, padding: "8px 10px" }}>{user.bio}</div>
        </div>
      )}

      {/* Review note */}
      {user.reviewNote && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: F.micro, color: C.muted, marginBottom: 2 }}>관리자 메모</div>
          <div style={{ fontSize: F.xs, color: C.sub, fontStyle: "italic" }}>{user.reviewNote}</div>
        </div>
      )}

      {/* Action buttons for pending users */}
      {user.status === "pending" && (
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <button
            disabled={(admin.reviewLoading === user.email || admin.batchLoading)}
            onClick={() => admin.handleReview(user.email, "approve")}
            style={{
              flex: 1, padding: "10px", fontSize: F.base, fontWeight: 700,
              background: C.green, color: C.white, border: "none", borderRadius: 6,
              cursor: (admin.reviewLoading === user.email || admin.batchLoading) ? "default" : "pointer",
              opacity: (admin.reviewLoading === user.email || admin.batchLoading) ? 0.6 : 1, minHeight: 40
            }}>승인</button>
          <button
            disabled={(admin.reviewLoading === user.email || admin.batchLoading)}
            onClick={() => admin.handleReview(user.email, "reject")}
            style={{
              flex: 1, padding: "10px", fontSize: F.base, fontWeight: 700,
              background: C.white, color: C.red, border: `1.5px solid ${C.red}`, borderRadius: 6,
              cursor: (admin.reviewLoading === user.email || admin.batchLoading) ? "default" : "pointer",
              opacity: (admin.reviewLoading === user.email || admin.batchLoading) ? 0.6 : 1, minHeight: 40
            }}>거부</button>
        </div>
      )}

      {/* 강제 로그아웃 — approved 사용자 대상 */}
      {user.status === "approved" && (
        <button
          disabled={(admin.reviewLoading === user.email || admin.batchLoading)}
          onClick={() => admin.handleReview(user.email, "force-logout")}
          style={{
            width: "100%", padding: "8px", fontSize: F.sm, fontWeight: 700,
            background: C.white, color: "#DC2626", border: "1.5px solid #DC2626", borderRadius: 6,
            cursor: (admin.reviewLoading === user.email || admin.batchLoading) ? "default" : "pointer",
            opacity: (admin.reviewLoading === user.email || admin.batchLoading) ? 0.6 : 1, marginTop: 4, minHeight: 40
          }}>강제 로그아웃</button>
      )}

      {/* 재승인 — rejected 또는 suspended 사용자 대상 */}
      {(user.status === "rejected" || user.status === "suspended") && (
        <button
          disabled={(admin.reviewLoading === user.email || admin.batchLoading)}
          onClick={() => admin.handleReview(user.email, "approve")}
          style={{
            width: "100%", padding: "8px", fontSize: F.sm, fontWeight: 700,
            background: C.white, color: C.green, border: `1.5px solid ${C.green}`, borderRadius: 6,
            cursor: (admin.reviewLoading === user.email || admin.batchLoading) ? "default" : "pointer",
            opacity: (admin.reviewLoading === user.email || admin.batchLoading) ? 0.6 : 1, marginTop: 4, minHeight: 40
          }}>재승인</button>
      )}
    </div>
  );
}
