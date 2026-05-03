import { memo } from "react";
import { C, F } from "@/theme";
import { LineChart } from "@/components/primitives";
import { useUnsoldHistory } from "@/hooks/useUnsoldHistory";
import type { UnsoldChartProps } from "@/types/detail";

/** 미분양 추이 차트 — DetailModal 내 표시 */
export const UnsoldChart = memo(function UnsoldChart({ apartmentId, siblingIds }: UnsoldChartProps) {
  const { data, loading, error, retry } = useUnsoldHistory(apartmentId, siblingIds);

  if (!apartmentId) return null;
  if (loading) return <div style={{ height: 160, display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, fontSize: F.sm }}>불러오는 중...</div>;
  if (error) return (
    <div style={{ height: 80, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6 }}>
      <span style={{ color: C.muted, fontSize: F.sm }}>차트를 불러올 수 없습니다</span>
      <button onClick={retry} style={{ fontSize: F.xs, padding: "4px 10px", borderRadius: 4, border: `1px solid ${C.border}`, background: C.slate100, color: C.slate600, cursor: "pointer" }}>재시도</button>
    </div>
  );
  if (data.length < 2) return null;

  interface UnsoldRow { base_month?: string; unsold_count?: number | null; post_completion_unsold?: number | null }
  const rows = data as UnsoldRow[];
  const chartData = rows.slice(-24).map((row: UnsoldRow) => ({
    x: (row.base_month || "").slice(4),
    y: row.unsold_count ?? 0,
    label: `${row.base_month}: 미분양 ${(row.unsold_count ?? 0).toLocaleString()}세대`,
  }));

  const secondaryData = rows.slice(-24)
    .filter((row: UnsoldRow) => row.post_completion_unsold != null)
    .map((row: UnsoldRow) => ({
      x: (row.base_month || "").slice(4),
      y: row.post_completion_unsold ?? 0,
    }));

  if (chartData.length < 2) return null;

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: F.sm, fontWeight: 700, color: C.text }}>미분양 추이</span>
        <span style={{ fontSize: F.micro, color: C.red }}>● 미분양</span>
        {secondaryData.length >= 2 && <span style={{ fontSize: F.micro, color: C.muted }}>┄ 준공후</span>}
      </div>
      <LineChart data={chartData} color={C.red} height={160} yLabel="미분양 추이" secondaryData={secondaryData.length >= 2 ? secondaryData : undefined} secondaryColor={C.amber} />
    </div>
  );
});
