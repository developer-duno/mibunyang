/**
 * UserCard 컴포넌트 props 타입 (M3d).
 *
 * UserCard.jsx L4: function UserCard({ user, admin })
 * (memo 아님 — 단순 함수 컴포넌트)
 */
import type { AdminMode, AdminUser } from "@/types/admin";

export interface UserCardProps {
  user: AdminUser;
  admin: AdminMode;
}
