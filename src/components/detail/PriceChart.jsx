import { memo } from "react";
import { C } from "@/theme";
import { LineChart } from "@/components/primitives";
import { usePriceHistory } from "@/hooks/usePriceHistory";

/** 분양가 추이 차트 — DetailModal 내 표시 */
export const PriceChart = memo(function PriceChart({ apartmentId }) {
  const { data, loading, error, retry } = usePriceHistory(apartmentId);

  if (!apartmentId) return null;
  if (loading) return <div style={{ height: 160, display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, fontSize: 12 }}>불러오는 중...</div>;
  if (error) return (
    <div style={{ height: 80, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6 }}>
      <span style={{ color: C.muted, fontSize: 12 }}>차트를 불러올 수 없습니다</span>
      <button onClick={retry} style={{ fontSize: 11, padding: "4px 10px", borderRadius: 4, border: `1px solid ${C.border}`, background: C.slate100, color: C.slate600, cursor: "pointer" }}>재시도</button>
    </div>
  );
  if (data.length < 2) return null;

  // 타입별 최신 가격만 추출하여 시계열 구성
  const byDate = {};
  for (const row of data) {
    const key = row.recorded_at;
    if (!byDate[key] || row.price > byDate[key].price) byDate[key] = row;
  }
  const chartData = Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-24)
    .map(([date, row]) => ({
      x: date.slice(5, 10).replace("-", "/"),
      y: row.price ?? 0,
      label: `${date}: ${(row.price ?? 0).toLocaleString()}만원`,
    }));

  if (chartData.length < 2) return null;

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6 }}>분양가 추이</div>
      <LineChart data={chartData} color={C.green} height={160} yLabel="분양가 추이" />
    </div>
  );
});
