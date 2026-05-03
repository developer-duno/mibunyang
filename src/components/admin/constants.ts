import { C } from "@/theme";
import type { UserStatusFilter } from "@/types/admin";

export interface StatusTab {
  key: UserStatusFilter;
  label: string;
  color: string;
  bg: string;
}

export const STATUS_TABS: StatusTab[] = [
  { key: "pending", label: "대기중", color: "#92400E", bg: "#FFFBEB" },
  { key: "approved", label: "승인됨", color: C.green, bg: C.greenLight },
  { key: "rejected", label: "거부됨", color: C.red, bg: C.redLight },
  { key: "suspended", label: "정지됨", color: "#DC2626", bg: "#FEE2E2" },
  { key: "all", label: "전체", color: C.text, bg: C.slate100 },
];

export const SPECIALTY_BADGE: Record<string, { color: string; bg: string }> = {
  "부동산 중개": { color: "#1D4ED8", bg: "#DBEAFE" },
  "분양 컨설팅": { color: "#7C3AED", bg: "#EDE9FE" },
  "감정평가": { color: "#059669", bg: "#D1FAE5" },
  "건축/설계": { color: "#EA580C", bg: "#FFF7ED" },
  "기타": { color: C.muted, bg: C.slate100 },
};

export const STATUS_LABELS: Record<string, string> = {
  approved: "승인됨",
  rejected: "거부됨",
  suspended: "정지됨",
  pending: "대기중",
};
