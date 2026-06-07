import { memo, useMemo } from "react";
import { C, F } from "@/theme";
import { LineChart } from "@/components/primitives";
import { useMarketStatsHistory } from "@/hooks/useMarketStatsHistory";
import type { MarketStatsChartsProps } from "@/types/detail";

interface MarketMetric { key: string; label: string; unit: string; color: string }
interface MarketRow { base_month?: string; [key: string]: unknown }

// 5지표 메타 정보 — KOSIS 시계열 컬럼 ↔ 한국어 라벨/단위/색
const METRICS: MarketMetric[] = [
  { key: "avg_price_sqm",     label: "평균분양가격",   unit: "천원/㎡",    color: C.green },
  { key: "price_index",       label: "분양가격지수",   unit: "(100=기준)", color: C.blue },
  { key: "new_supply",        label: "신규공급 세대수", unit: "세대",      color: C.purple },
  { key: "initial_sale_rate", label: "초기분양율",     unit: "%",         color: C.amber },
  { key: "land_cost_ratio",   label: "택지비율",       unit: "%",         color: C.cyan },
];

// "202503" → "03" (월 2자리 표기)
const monthLabel = (yyyymm: unknown) => {
  if (typeof yyyymm !== "string" || yyyymm.length !== 6) return "";
  return yyyymm.slice(4);
};

/**
 * MarketStatsCharts — region+gu 시장통계 5지표 시계열
 *
 * Props:
 *   region: string — DB 짧은 이름 ("서울"·"경기")
 *   gu: string — DB 표기 ("강남구") 또는 "" (시도 단위)
 *
 * - 5/5 cron 전 데이터 0건 = amberLight 안내 박스 노출
 * - 정상 시 LineChart 5개를 반응형 grid 배치 (auto-fit minmax 280px — 모바일 1열·PC 이상 2열)
 * - region 미설정 / loading / error 시 null (조용한 숨김)
 */
export const MarketStatsCharts = memo(function MarketStatsCharts({ region, gu }: MarketStatsChartsProps) {
  const { data, loading, error, retry, fallback } = useMarketStatsHistory(region ?? "", gu ?? "") as { data: MarketRow[] | null; loading: boolean; error: unknown; retry: () => void; fallback: boolean };

  // 모든 차트가 같은 x축 라벨 사용
  const xLabels = useMemo(
    () => Array.isArray(data) ? data.map((d: MarketRow) => monthLabel(d?.base_month)) : [],
    [data]
  );

  // 각 metric 별로 유효 값이 2개 이상 있어야 차트 렌더 가능. 1개 이상 metric 이 그릴 수
  // 있어야 진짜 데이터 있음. data.length>=2 인데 5필드 모두 null 인 경우 + 1행만 값 있는
  // corner case (chartData.length<2 → 미렌더) 모두 안내 박스로 분기.
  // null/undefined 명시적 제외 — Number(null)=0 강제 변환 + isFinite(0)=true 통과 사고 방지.
  const hasRenderableMetric = useMemo(() => {
    if (!Array.isArray(data)) return false;
    return METRICS.some(m => {
      const cnt = data.reduce((c: number, d: MarketRow) => {
        const raw = d?.[m.key];
        if (raw == null) return c;
        return c + (Number.isFinite(Number(raw)) ? 1 : 0);
      }, 0);
      return cnt >= 2;
    });
  }, [data]);

  const guideBox = (
    <div
      role="status"
      style={{
        marginTop: 16,
        padding: "12px 14px",
        background: C.amberLight,
        border: `1px solid ${C.amberBorder}`,
        borderRadius: 8,
        fontSize: F.xs,
        color: C.amber,
        lineHeight: 1.5,
      }}
    >
      📊 지역 시장 추이 — 매월 5일 KOSIS 통계 자동 수집·누적 중
    </div>
  );

  if (!region) return null;
  if (loading) return (
    <div style={{ height: 120, display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, fontSize: F.sm, marginTop: 16 }}>
      시장 통계를 불러오는 중...
    </div>
  );
  if (error) return (
    <div style={{ height: 96, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 16 }}>
      <span style={{ color: C.muted, fontSize: F.sm }}>시장 통계를 불러올 수 없습니다</span>
      <button onClick={retry} style={{ fontSize: F.xs, padding: "4px 10px", borderRadius: 4, border: `1px solid ${C.border}`, background: C.slate100, color: C.slate600, cursor: "pointer" }}>다시시도</button>
    </div>
  );

  // 데이터 0건 (5/5 cron 전) + 행 있지만 모든 metric 미렌더 corner case 모두 안내 박스
  if (!Array.isArray(data) || data.length < 2) return guideBox;
  if (!hasRenderableMetric) return guideBox;

  // 폴백 응답 (API 가 gu="" 시도 자동 폴백) 시 헤더에 "시도 평균" 명시
  const headerSuffix = fallback ? " 시도 평균" : (gu ? ` ${gu}` : "");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
      <div style={{ fontSize: F.md, fontWeight: 700, color: C.text }}>
        지역 시장 추이 ({region}{headerSuffix})
      </div>
      {/* 반응형 grid — auto-fit minmax 280px: 모바일 1열, PC 이상 2열 자동. 홀수 마지막 차트는 왼쪽 정렬 */}
      <div data-testid="market-charts-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
        {METRICS.map(m => {
          type ChartPoint = { x: string; y: number; label: string };
          const chartData: ChartPoint[] = data
            .map((d: MarketRow, i: number) => {
              // null/undefined 명시적 제외 — Number(null)=0 + isFinite(0)=true 강제 변환 사고 방지
              const raw = d?.[m.key];
              if (raw == null) return null;
              const v = Number(raw);
              if (!Number.isFinite(v)) return null;
              return { x: xLabels[i] || "", y: v, label: `${xLabels[i] || ""}: ${v.toLocaleString()} ${m.unit}` };
            })
            .filter((x): x is ChartPoint => x !== null);
          if (chartData.length < 2) return null;
          return (
            <div key={m.key}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: F.xs, color: C.muted, marginBottom: 4 }}>
                <span style={{ fontWeight: 600 }}>{m.label}</span>
                <span>{m.unit}</span>
              </div>
              <LineChart data={chartData} color={m.color} height={120} yLabel={m.label} />
            </div>
          );
        })}
      </div>
    </div>
  );
});
