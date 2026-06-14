import { memo, useMemo } from "react";
import { C, F } from "@/theme";
import { WidgetCard } from "./WidgetCard";
import type { ScoredApt, SortKey } from "@/types/hooks";

/** nav 있는 칸 = 클릭 시 해당 탭(+정렬)으로. 없는 칸(데이터 기준)은 정적 라벨 */
type MarketNav = { target: string; sort?: SortKey };
type MarketSummaryWidgetProps = {
  scored: ScoredApt[];
  dataFreshnessText: string | null;
  /** 칸 클릭 동선 — App 의 setSortKey + handleNavClick 배선. 미전달 시 칸은 정적(테스트 호환) */
  onCellNav?: (_cell: string, _nav: MarketNav) => void;
};

function median(sorted: number[]): number | null {
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
}

/** 시장 요약 — 원시값 4종만 (점수 파생 금지: 비로그인 공개 정책). 이미 로드된 scored 클라이언트 집계, 새 fetch 0 */
export const MarketSummaryWidget = memo(function MarketSummaryWidget({ scored, dataFreshnessText, onCellNav }: MarketSummaryWidgetProps) {
  const stats = useMemo(() => {
    const prices = scored.map(s => s.apt.price).filter((p): p is number => typeof p === "number" && p > 0).sort((a, b) => a - b);
    const rates = scored.map(s => s.apt.unsoldRate).filter((r): r is number => typeof r === "number").sort((a, b) => a - b);
    return { count: scored.length, medPrice: median(prices), medRate: median(rates) };
  }, [scored]);

  // nav 있는 칸 = 클릭 가능(목록 이동, 일부는 정렬 동반). 데이터 기준 = 정적.
  const cells: Array<{ label: string; value: string; nav?: MarketNav }> = [
    { label: "전국 단지", value: stats.count > 0 ? `${stats.count.toLocaleString()}개` : "—", nav: { target: "list" } },
    { label: "분양가 중위", value: stats.medPrice != null ? `${(stats.medPrice / 10000).toFixed(1)}억` : "—", nav: { target: "list", sort: "price" } },
    { label: "미분양률 중위", value: stats.medRate != null ? `${stats.medRate.toFixed(1)}%` : "—", nav: { target: "list", sort: "unsoldRate" } },
    { label: "데이터 기준", value: dataFreshnessText ?? "—" },
  ];

  const cellInner = (c: { label: string; value: string }) => (
    <>
      <div style={{ fontSize: F.xs, color: C.muted, marginBottom: 2 }}>{c.label}</div>
      <div style={{ fontSize: F.md, fontWeight: 800, color: C.text }}>{c.value}</div>
    </>
  );

  return (
    <WidgetCard title="📊 시장 요약">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {cells.map(c => (
          c.nav && onCellNav ? (
            <button
              key={c.label}
              onClick={() => onCellNav(c.label, c.nav!)}
              aria-label={`${c.label} ${c.value} — 목록 보기`}
              style={{ textAlign: "left", background: C.slate100, borderRadius: 8, padding: "10px 12px", border: "none", cursor: "pointer", minHeight: 44 }}
            >
              {cellInner(c)}
            </button>
          ) : (
            <div key={c.label} style={{ background: C.slate100, borderRadius: 8, padding: "10px 12px" }}>
              {cellInner(c)}
            </div>
          )
        ))}
      </div>
    </WidgetCard>
  );
});
