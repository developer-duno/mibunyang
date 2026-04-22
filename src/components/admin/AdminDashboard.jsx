import { memo, useState, useCallback } from "react";
import { C, F } from "@/theme";
import { AdminHelpGuide } from "./AdminHelpGuide";
import WeightEditor from "./WeightEditor";
import { SkeletonList } from "@/components/primitives";
import { STATUS_TABS, SPECIALTY_BADGE } from "./constants";
import { StatsSection } from "./StatsSection";
import { UserCard } from "./UserCard";

export const AdminDashboard = memo(function AdminDashboard({ admin, onLogout, onSwitchToExpert, profile, setProfile, customWeights, saveCustomWeights, scored, showToast = () => {} }) {
  const [helpOpen, setHelpOpen] = useState(false);

  // 고정 파라미터 핸들러 — 참조 안정화 (루프 내부 바인딩은 제외)
  const toggleHelp = useCallback(() => setHelpOpen(v => !v), []);
  const handleLogoutClick = useCallback(() => admin.handleAdminLogout(onLogout), [admin, onLogout]);
  const handleBatchApprove = useCallback(() => admin.handleBatchReview("approve"), [admin]);
  const handleBatchReject = useCallback(() => admin.handleBatchReview("reject"), [admin]);
  const handlePagePrev = useCallback(() => admin.handlePageChange(admin.page - 1), [admin]);
  const handlePageNext = useCallback(() => admin.handlePageChange(admin.page + 1), [admin]);

  return (
    <div style={{ padding: "0 16px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: F.lg, fontWeight: 800, color: C.text }}>관리자 대시보드</div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={toggleHelp} style={{
            background: helpOpen ? C.purple : C.purpleLight, color: helpOpen ? C.white : C.purple,
            border: `1px solid ${C.purple}`, borderRadius: 6,
            padding: "6px 14px", fontSize: F.xs, fontWeight: 700, cursor: "pointer"
          }}>도움말</button>
          {onSwitchToExpert && (
            <button onClick={onSwitchToExpert} style={{
              background: C.indigoLight, color: C.indigo, border: `1px solid ${C.indigo}`, borderRadius: 6,
              padding: "6px 14px", fontSize: F.xs, fontWeight: 700, cursor: "pointer"
            }}>전문가 보기</button>
          )}
          <button onClick={handleLogoutClick} style={{
            background: C.redLight, color: C.red, border: `1px solid #FECACA`, borderRadius: 6,
            padding: "6px 14px", fontSize: F.xs, fontWeight: 700, cursor: "pointer"
          }}>로그아웃</button>
        </div>
      </div>

      <AdminHelpGuide open={helpOpen} onClose={() => setHelpOpen(false)} />

      {/* Weight Editor Section */}
      <WeightEditor profile={profile} setProfile={setProfile} customWeights={customWeights} saveCustomWeights={saveCustomWeights} scored={scored} showToast={showToast} />

      {/* Stats Section */}
      {admin.stats && <StatsSection stats={admin.stats} />}
      {admin.statsLoading && <SkeletonList count={4} columns={2} />}

      {/* Expert Applications Section */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: F.lg, fontWeight: 800, color: C.text, marginBottom: 4 }}>전문가 신청 관리</div>
        <div style={{ fontSize: F.xs, color: C.muted }}>전체 {admin.totalUsers}건</div>
      </div>

      {/* 검색 */}
      <div style={{ position: "relative", marginBottom: 12 }}>
        <input
          type="text" placeholder="이름, 이메일, 소속 검색..." value={admin.searchQuery}
          onChange={e => admin.setSearchQuery(e.target.value)}
          style={{
            width: "100%", padding: "8px 32px 8px 12px", fontSize: F.base, borderRadius: 8,
            border: `1px solid ${C.border}`, background: C.white, color: C.text,
            outline: "none", boxSizing: "border-box",
          }}
        />
        {admin.searchQuery && (
          <button type="button" onClick={() => admin.setSearchQuery("")}
            style={{
              position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
              background: "none", border: "none", cursor: "pointer", color: C.muted, fontSize: F.base, padding: 0,
            }}
          >✕</button>
        )}
      </div>

      {/* Status Tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        {STATUS_TABS.map(t => {
          const active = admin.selectedStatus === t.key;
          return (
            <button key={t.key} onClick={() => admin.setSelectedStatus(t.key)} style={{
              flex: 1, padding: "8px 4px", fontSize: F.sm, fontWeight: active ? 700 : 500,
              background: active ? t.bg : C.white, color: active ? t.color : C.muted,
              border: active ? `1.5px solid ${t.color}` : `1px solid ${C.border}`,
              borderRadius: 6, cursor: "pointer", transition: "all .15s"
            }}>{t.label}</button>
          );
        })}
      </div>

      {admin.adminLoading && <SkeletonList count={3} columns={1} />}

      {!admin.adminLoading && admin.users.length === 0 && (
        <div style={{ background: C.card, borderRadius: 12, padding: "40px 20px", border: `1px solid ${C.border}`, textAlign: "center" }}>
          <div style={{ fontSize: F.base, fontWeight: 700, color: C.text, marginBottom: 4 }}>
            {admin.searchQuery ? "검색 결과가 없습니다" : admin.selectedStatus === "pending" ? "대기중인 신청이 없습니다" : admin.selectedStatus === "suspended" ? "정지된 사용자가 없습니다" : "해당 상태의 사용자가 없습니다"}
          </div>
        </div>
      )}

      {/* 일괄 처리 바 — pending 탭일 때만 */}
      {admin.selectedStatus === "pending" && admin.users.length > 0 && !admin.adminLoading && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", fontSize: F.sm, fontWeight: 600, color: C.sub }}>
            <input type="checkbox"
              checked={admin.users.length > 0 && admin.users.every(u => admin.selectedEmails.has(u.email))}
              onChange={() => admin.selectAllEmails(admin.users.map(u => u.email))}
              style={{ width: 16, height: 16, cursor: "pointer" }}
            />전체 선택
          </label>
          {admin.selectedEmails.size > 0 && (
            <>
              <span style={{ fontSize: F.xs, color: C.muted }}>{admin.selectedEmails.size}건 선택</span>
              <button
                disabled={admin.batchLoading}
                onClick={handleBatchApprove}
                style={{
                  padding: "6px 14px", fontSize: F.sm, fontWeight: 700, borderRadius: 6,
                  background: C.green, color: C.white, border: "none",
                  cursor: admin.batchLoading ? "default" : "pointer",
                  opacity: admin.batchLoading ? 0.6 : 1, minHeight: 32,
                }}>일괄 승인</button>
              <button
                disabled={admin.batchLoading}
                onClick={handleBatchReject}
                style={{
                  padding: "6px 14px", fontSize: F.sm, fontWeight: 700, borderRadius: 6,
                  background: C.white, color: C.red, border: `1.5px solid ${C.red}`,
                  cursor: admin.batchLoading ? "default" : "pointer",
                  opacity: admin.batchLoading ? 0.6 : 1, minHeight: 32,
                }}>일괄 거부</button>
            </>
          )}
        </div>
      )}

      {/* User Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 12 }}>
        {admin.users.map(user => (
          <UserCard key={user.email} user={user} admin={admin} />
        ))}
      </div>

      {/* 페이지네이션 */}
      {admin.totalUsers > admin.PAGE_SIZE && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 16 }}>
          <button type="button" disabled={admin.page === 0} onClick={handlePagePrev}
            style={{
              padding: "6px 14px", fontSize: F.sm, fontWeight: 600, borderRadius: 6,
              border: `1px solid ${C.border}`, background: admin.page === 0 ? C.slate100 : C.white,
              color: admin.page === 0 ? C.muted : C.text, cursor: admin.page === 0 ? "default" : "pointer",
            }}>이전</button>
          <span style={{ fontSize: F.sm, color: C.muted }}>
            {admin.page * admin.PAGE_SIZE + 1}~{Math.min((admin.page + 1) * admin.PAGE_SIZE, admin.totalUsers)}건 / 전체 {admin.totalUsers}건
          </span>
          <button type="button" disabled={(admin.page + 1) * admin.PAGE_SIZE >= admin.totalUsers}
            onClick={handlePageNext}
            style={{
              padding: "6px 14px", fontSize: F.sm, fontWeight: 600, borderRadius: 6,
              border: `1px solid ${C.border}`,
              background: (admin.page + 1) * admin.PAGE_SIZE >= admin.totalUsers ? C.slate100 : C.white,
              color: (admin.page + 1) * admin.PAGE_SIZE >= admin.totalUsers ? C.muted : C.text,
              cursor: (admin.page + 1) * admin.PAGE_SIZE >= admin.totalUsers ? "default" : "pointer",
            }}>다음</button>
        </div>
      )}
    </div>
  );
});
