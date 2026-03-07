import { memo } from "react";
import { C } from "@/theme";

export const AdminLogin = memo(function AdminLogin({ admin, onBack, onSuccess }) {
  return (
    <div style={{ padding: "0 16px" }}>
      <div style={{ background: C.card, borderRadius: 12, padding: "40px 20px", border: `1px solid ${C.border}`, textAlign: "center" }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: C.text, marginBottom: 4 }}>관리자 로그인</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 20 }}>전문가 신청 승인 관리</div>

        {admin.adminError && (
          <div style={{ fontSize: 12, color: C.red, background: C.redLight, borderRadius: 6, padding: "8px 12px", marginBottom: 16 }}>
            {admin.adminError}
          </div>
        )}

        <form onSubmit={async e => { e.preventDefault(); if (await admin.handleAdminLogin()) onSuccess(); }}>
          <div style={{ marginBottom: 16 }}>
            <label htmlFor="admin-pw" style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6, display: "block", textAlign: "left" }}>관리자 비밀번호</label>
            <input id="admin-pw" type="password" value={admin.adminSecret}
              onChange={e => admin.setAdminSecret(e.target.value)}
              placeholder="비밀번호 입력" style={{
                width: "100%", padding: "10px 12px", fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 6,
                background: C.white, color: C.text, boxSizing: "border-box", minHeight: 42
              }} />
          </div>
          <button type="submit" disabled={admin.adminLoading} style={{
            width: "100%", padding: "12px", fontSize: 14, fontWeight: 800, color: C.white,
            background: admin.adminLoading ? C.muted : C.indigo,
            border: "none", borderRadius: 6, cursor: admin.adminLoading ? "default" : "pointer",
            minHeight: 44, marginBottom: 12, transition: "background .15s"
          }}>{admin.adminLoading ? "처리 중..." : "로그인"}</button>
        </form>

        <button onClick={onBack} style={{
          background: "transparent", border: "none", color: C.muted, fontSize: 12, cursor: "pointer"
        }}>돌아가기</button>
      </div>
    </div>
  );
});
