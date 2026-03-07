import { memo } from "react";
import { C } from "@/theme";

const STATUS_TABS = [
  { key: "pending", label: "대기중", color: "#92400E", bg: "#FFFBEB" },
  { key: "approved", label: "승인됨", color: C.green, bg: C.greenLight },
  { key: "rejected", label: "거부됨", color: C.red, bg: C.redLight },
  { key: "all", label: "전체", color: C.text, bg: C.slate100 },
];

const SPECIALTY_BADGE = {
  "부동산 중개": { color: "#1D4ED8", bg: "#DBEAFE" },
  "분양 컨설팅": { color: "#7C3AED", bg: "#EDE9FE" },
  "감정평가": { color: "#059669", bg: "#D1FAE5" },
  "건축/설계": { color: "#EA580C", bg: "#FFF7ED" },
  "기타": { color: C.muted, bg: C.slate100 },
};

export const AdminDashboard = memo(function AdminDashboard({ admin, onLogout }) {
  return (
    <div style={{ padding: "0 16px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>전문가 신청 관리</div>
          <div style={{ fontSize: 11, color: C.muted }}>{admin.users.length}건</div>
        </div>
        <button onClick={() => admin.handleAdminLogout(onLogout)} style={{
          background: C.redLight, color: C.red, border: `1px solid #FECACA`, borderRadius: 6,
          padding: "6px 14px", fontSize: 11, fontWeight: 700, cursor: "pointer"
        }}>로그아웃</button>
      </div>

      {/* Status Tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        {STATUS_TABS.map(t => {
          const active = admin.selectedStatus === t.key;
          return (
            <button key={t.key} onClick={() => admin.setSelectedStatus(t.key)} style={{
              flex: 1, padding: "8px 4px", fontSize: 12, fontWeight: active ? 700 : 500,
              background: active ? t.bg : C.white, color: active ? t.color : C.muted,
              border: active ? `1.5px solid ${t.color}` : `1px solid ${C.border}`,
              borderRadius: 6, cursor: "pointer", transition: "all .15s"
            }}>{t.label}</button>
          );
        })}
      </div>

      {admin.adminLoading && (
        <div style={{ textAlign: "center", padding: 20, color: C.muted, fontSize: 12 }}>로딩 중...</div>
      )}

      {!admin.adminLoading && admin.users.length === 0 && (
        <div style={{ background: C.card, borderRadius: 12, padding: "40px 20px", border: `1px solid ${C.border}`, textAlign: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 4 }}>
            {admin.selectedStatus === "pending" ? "대기중인 신청이 없습니다" : "해당 상태의 사용자가 없습니다"}
          </div>
        </div>
      )}

      {/* User Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 12 }}>
        {admin.users.map(user => {
          const badge = SPECIALTY_BADGE[user.specialty] || SPECIALTY_BADGE["기타"];
          const statusLabel = user.status === "approved" ? "승인됨" : user.status === "rejected" ? "거부됨" : "대기중";
          const statusStyle = STATUS_TABS.find(t => t.key === user.status) || STATUS_TABS[0];

          return (
            <div key={user.email} style={{
              background: C.card, borderRadius: 10, border: `1px solid ${C.border}`, padding: 16,
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)"
            }}>
              {/* Header row */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: C.text }}>{user.name}</div>
                  <div style={{ fontSize: 11, color: C.muted }}>{user.email}</div>
                </div>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 4,
                  color: statusStyle.color, background: statusStyle.bg
                }}>{statusLabel}</span>
              </div>

              {/* Info grid */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 12px", marginBottom: 10 }}>
                {user.affiliation && (
                  <div>
                    <div style={{ fontSize: 10, color: C.muted, marginBottom: 1 }}>소속</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{user.affiliation}</div>
                  </div>
                )}
                {user.phone && (
                  <div>
                    <div style={{ fontSize: 10, color: C.muted, marginBottom: 1 }}>연락처</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{user.phone}</div>
                  </div>
                )}
                {user.specialty && (
                  <div>
                    <div style={{ fontSize: 10, color: C.muted, marginBottom: 1 }}>전문 분야</div>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 6px", borderRadius: 3, color: badge.color, background: badge.bg }}>{user.specialty}</span>
                  </div>
                )}
                {user.license && (
                  <div>
                    <div style={{ fontSize: 10, color: C.muted, marginBottom: 1 }}>자격증</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{user.license}</div>
                  </div>
                )}
                {user.experience != null && (
                  <div>
                    <div style={{ fontSize: 10, color: C.muted, marginBottom: 1 }}>경력</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{user.experience}년</div>
                  </div>
                )}
                <div>
                  <div style={{ fontSize: 10, color: C.muted, marginBottom: 1 }}>가입일</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{new Date(user.createdAt).toLocaleDateString("ko-KR")}</div>
                </div>
              </div>

              {/* Bio */}
              {user.bio && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 10, color: C.muted, marginBottom: 2 }}>자기소개</div>
                  <div style={{ fontSize: 12, color: C.sub, lineHeight: 1.6, background: C.slate100, borderRadius: 6, padding: "8px 10px" }}>{user.bio}</div>
                </div>
              )}

              {/* Review note */}
              {user.reviewNote && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 10, color: C.muted, marginBottom: 2 }}>관리자 메모</div>
                  <div style={{ fontSize: 11, color: C.sub, fontStyle: "italic" }}>{user.reviewNote}</div>
                </div>
              )}

              {/* Action buttons for pending users */}
              {user.status === "pending" && (
                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                  <button
                    disabled={admin.reviewLoading === user.email}
                    onClick={() => admin.handleReview(user.email, "approve")}
                    style={{
                      flex: 1, padding: "10px", fontSize: 13, fontWeight: 700,
                      background: C.green, color: C.white, border: "none", borderRadius: 6,
                      cursor: admin.reviewLoading === user.email ? "default" : "pointer",
                      opacity: admin.reviewLoading === user.email ? 0.6 : 1, minHeight: 40
                    }}>승인</button>
                  <button
                    disabled={admin.reviewLoading === user.email}
                    onClick={() => admin.handleReview(user.email, "reject")}
                    style={{
                      flex: 1, padding: "10px", fontSize: 13, fontWeight: 700,
                      background: C.white, color: C.red, border: `1.5px solid ${C.red}`, borderRadius: 6,
                      cursor: admin.reviewLoading === user.email ? "default" : "pointer",
                      opacity: admin.reviewLoading === user.email ? 0.6 : 1, minHeight: 40
                    }}>거부</button>
                </div>
              )}

              {/* Re-approve for rejected users */}
              {user.status === "rejected" && (
                <button
                  disabled={admin.reviewLoading === user.email}
                  onClick={() => admin.handleReview(user.email, "approve")}
                  style={{
                    width: "100%", padding: "8px", fontSize: 12, fontWeight: 700,
                    background: C.white, color: C.green, border: `1.5px solid ${C.green}`, borderRadius: 6,
                    cursor: admin.reviewLoading === user.email ? "default" : "pointer", marginTop: 4
                  }}>재승인</button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});
