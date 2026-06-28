import { useCallback } from "react";
import { C, F } from "@/theme";
import { SkeletonList } from "@/components/primitives";
import { UserCard } from "./UserCard";
import type { UserListProps } from "@/types/admin";

export function UserList({ admin }: UserListProps) {
  const handleBatchApprove = useCallback(() => admin.handleBatchReview("approve"), [admin]);
  const handleBatchReject = useCallback(() => admin.handleBatchReview("reject"), [admin]);
  const handlePagePrev = useCallback(() => admin.handlePageChange(admin.page - 1), [admin]);
  const handlePageNext = useCallback(() => admin.handlePageChange(admin.page + 1), [admin]);

  return (
    <>
      {admin.adminLoading && <SkeletonList count={3} columns={1} />}

      {!admin.adminLoading && admin.users.length === 0 && (
        <div
          style={{
            background: C.card,
            borderRadius: 12,
            padding: "40px 20px",
            border: `1px solid ${C.border}`,
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: F.base, fontWeight: 700, color: C.text, marginBottom: 4 }}>
            {admin.searchQuery
              ? "검색 결과가 없습니다"
              : admin.selectedStatus === "pending"
                ? "대기중인 신청이 없습니다"
                : admin.selectedStatus === "suspended"
                  ? "정지된 사용자가 없습니다"
                  : "해당 상태의 사용자가 없습니다"}
          </div>
        </div>
      )}

      {/* 일괄 처리 바 — pending 탭일 때만 */}
      {admin.selectedStatus === "pending" && admin.users.length > 0 && !admin.adminLoading && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              cursor: "pointer",
              fontSize: F.sm,
              fontWeight: 600,
              color: C.sub,
            }}
          >
            <input
              type="checkbox"
              checked={admin.users.length > 0 && admin.users.every((u) => admin.selectedEmails.has(u.email))}
              onChange={() => admin.selectAllEmails(admin.users.map((u) => u.email))}
              style={{ width: 16, height: 16, cursor: "pointer" }}
            />
            전체 선택
          </label>
          {admin.selectedEmails.size > 0 && (
            <>
              <span style={{ fontSize: F.xs, color: C.muted }}>{admin.selectedEmails.size}건 선택</span>
              <button
                disabled={admin.batchLoading}
                onClick={handleBatchApprove}
                style={{
                  padding: "6px 14px",
                  fontSize: F.sm,
                  fontWeight: 700,
                  borderRadius: 6,
                  background: C.green,
                  color: C.white,
                  border: "none",
                  cursor: admin.batchLoading ? "default" : "pointer",
                  opacity: admin.batchLoading ? 0.6 : 1,
                  minHeight: 32,
                }}
              >
                일괄 승인
              </button>
              <button
                disabled={admin.batchLoading}
                onClick={handleBatchReject}
                style={{
                  padding: "6px 14px",
                  fontSize: F.sm,
                  fontWeight: 700,
                  borderRadius: 6,
                  background: C.white,
                  color: C.red,
                  border: `1.5px solid ${C.red}`,
                  cursor: admin.batchLoading ? "default" : "pointer",
                  opacity: admin.batchLoading ? 0.6 : 1,
                  minHeight: 32,
                }}
              >
                일괄 거부
              </button>
            </>
          )}
        </div>
      )}

      {/* User Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 12 }}>
        {admin.users.map((user) => (
          <UserCard key={user.email} user={user} admin={admin} />
        ))}
      </div>

      {/* 페이지네이션 */}
      {admin.totalUsers > admin.PAGE_SIZE && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 16 }}>
          <button
            type="button"
            disabled={admin.page === 0}
            onClick={handlePagePrev}
            style={{
              padding: "6px 14px",
              fontSize: F.sm,
              fontWeight: 600,
              borderRadius: 6,
              border: `1px solid ${C.border}`,
              background: admin.page === 0 ? C.slate100 : C.white,
              color: admin.page === 0 ? C.muted : C.text,
              cursor: admin.page === 0 ? "default" : "pointer",
            }}
          >
            이전
          </button>
          <span style={{ fontSize: F.sm, color: C.muted }}>
            {admin.page * admin.PAGE_SIZE + 1}~{Math.min((admin.page + 1) * admin.PAGE_SIZE, admin.totalUsers)}건 / 전체{" "}
            {admin.totalUsers}건
          </span>
          <button
            type="button"
            disabled={(admin.page + 1) * admin.PAGE_SIZE >= admin.totalUsers}
            onClick={handlePageNext}
            style={{
              padding: "6px 14px",
              fontSize: F.sm,
              fontWeight: 600,
              borderRadius: 6,
              border: `1px solid ${C.border}`,
              background: (admin.page + 1) * admin.PAGE_SIZE >= admin.totalUsers ? C.slate100 : C.white,
              color: (admin.page + 1) * admin.PAGE_SIZE >= admin.totalUsers ? C.muted : C.text,
              cursor: (admin.page + 1) * admin.PAGE_SIZE >= admin.totalUsers ? "default" : "pointer",
            }}
          >
            다음
          </button>
        </div>
      )}
    </>
  );
}
