import { memo, useState, useCallback } from "react";
import { C, F } from "@/theme";
import { AdminHelpGuide } from "./AdminHelpGuide";
import WeightEditor from "./WeightEditor";
import { SkeletonList } from "@/components/primitives";
import { STATUS_TABS } from "./constants";
import { StatsSection } from "./StatsSection";
import { CollectorMonitoring } from "./CollectorMonitoring";
import { UserList } from "./UserList";
import type { AdminDashboardProps } from "@/types/components/AdminDashboard.types";

export const AdminDashboard = memo(function AdminDashboard({ admin, onLogout, onSwitchToExpert, profile, setProfile, customWeights, saveCustomWeights, scored, showToast = () => {} }: AdminDashboardProps) {
  const [helpOpen, setHelpOpen] = useState(false);

  const toggleHelp = useCallback(() => setHelpOpen(v => !v), []);
  const handleLogoutClick = useCallback(() => admin.handleAdminLogout(onLogout), [admin, onLogout]);

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

      {/* Collector Monitoring Section */}
      <CollectorMonitoring showToast={showToast} />

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

      <UserList admin={admin} />
    </div>
  );
});
