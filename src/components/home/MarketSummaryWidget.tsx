import { memo, useMemo } from "react";
import { C, F } from "@/theme";
import { WidgetCard } from "./WidgetCard";
import type { ScoredApt } from "@/types/hooks";

type MarketSummaryWidgetProps = { scored: ScoredApt[]; dataFreshnessText: string | null };

function median(sorted: number[]): number | null {
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
}

/** 시장 요약 — 원시값 4종만 (점수 파생 금지: 비로그인 공개 정책). 이미 로드된 scored 클라이언트 집계, 새 fetch 0 */
export const MarketSummaryWidget = memo(function MarketSummaryWidget({ scored, dataFreshnessText }: MarketSummaryWidgetProps) {
  const stats = useMemo(() => {
    const prices = scored.map(s => s.apt.price).filter((p): p is number => typeof p === "number" && p > 0).sort((a, b) => a - b);
    const rates = scored.map(s => s.apt.unsoldRate).filter((r): r is number => typeof r === "number").sort((a, b) => a - b);
    return { count: scored.length, medPrice: median(prices), medRate: median(rates) };
  }, [scored]);

  const cells: Array<{ label: string; value: string }> = [
    { label: "전국 단지", value: stats.count > 0 ? `${stats.count.toLocaleString()}개` : "—" },
    { label: "분양가 중위", value: stats.medPrice != null ? `${(stats.medPrice / 10000).toFixed(1)}억` : "—" },
    { label: "미분양률 중위", value: stats.medRate != null ? `${stats.medRate.toFixed(1)}%` : "—" },
    { label: "데이터 기준", value: dataFreshnessText ?? "—" },
  ];

  return (
    <WidgetCard title="📊 시장 요약">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {cells.map(c => (
          <div key={c.label} style={{ background: C.slate100, borderRadius: 8, padding: "10px 12px" }}>
            <div style={{ fontSize: F.xs, color: C.muted, marginBottom: 2 }}>{c.label}</div>
            <div style={{ fontSize: F.md, fontWeight: 800, color: C.text }}>{c.value}</div>
          </div>
        ))}
      </div>
    </WidgetCard>
  );
});
