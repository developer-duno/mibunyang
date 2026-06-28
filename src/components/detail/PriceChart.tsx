import { memo } from "react";
import { C, F } from "@/theme";
import { LineChart } from "@/components/primitives";
import { usePriceHistory } from "@/hooks/usePriceHistory";
import { HelpHint } from "@/components/HelpHint";
import type { PriceChartProps } from "@/types/detail";

const PRICE_CHART_HINT =
  "이 단지(같은 분양 묶음)의 분양가가 시간에 따라 어떻게 바뀌었는지예요. 단위는 만원이고, 매주 자동으로 모아 쌓고 있어요.";

/** 분양가 추이 차트 — DetailModal 내 표시 */
export const PriceChart = memo(function PriceChart({ apartmentId, siblingIds }: PriceChartProps) {
  const { data, loading, error, retry } = usePriceHistory(apartmentId, siblingIds);

  if (!apartmentId) return null;
  if (loading)
    return (
      <div
        style={{
          height: 160,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: C.muted,
          fontSize: F.sm,
        }}
      >
        불러오는 중...
      </div>
    );
  if (error)
    return (
      <div
        style={{
          height: 80,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
        }}
      >
        <span style={{ color: C.muted, fontSize: F.sm }}>차트를 불러올 수 없습니다</span>
        <button
          onClick={retry}
          style={{
            fontSize: F.xs,
            padding: "4px 10px",
            borderRadius: 4,
            border: `1px solid ${C.border}`,
            background: C.slate100,
            color: C.slate600,
            cursor: "pointer",
          }}
        >
          재시도
        </button>
      </div>
    );
  if (data.length < 2) return null;

  // 타입별 최신 가격만 추출하여 시계열 구성
  interface PriceRow {
    recorded_at: string;
    price?: number | null;
  }
  const byDate: Record<string, PriceRow> = {};
  for (const row of data as PriceRow[]) {
    const key = row.recorded_at;
    if (!byDate[key] || (row.price ?? 0) > (byDate[key].price ?? 0)) byDate[key] = row;
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
      <div
        style={{
          display: "flex",
          alignItems: "center",
          fontSize: F.sm,
          fontWeight: 700,
          color: C.text,
          marginBottom: 6,
        }}
      >
        분양가 추이
        <HelpHint text={PRICE_CHART_HINT} label="분양가 추이" />
      </div>
      <LineChart data={chartData} color={C.green} height={160} yLabel="분양가 추이" />
      {chartData.length < 6 && (
        <div style={{ fontSize: F.micro, color: C.muted, marginTop: 4, textAlign: "center" }}>
          데이터 {chartData.length}개 · 매주 자동 수집 누적 중
        </div>
      )}
    </div>
  );
});
