import { memo, useMemo } from "react";
import { C, F } from "@/theme";
import { LineChart } from "@/components/primitives";
import { HelpHint } from "@/components/HelpHint";
import { useMarketStatsHistory } from "@/hooks/useMarketStatsHistory";
import type { MarketStatsChartsProps } from "@/types/detail";

interface MarketMetric { key: string; label: string; unit: string; color: string; hint: string }
interface MarketRow { base_month?: string; [key: string]: unknown }

// "지역 시장 추이" 상단 안내 — KOSIS 광역 시도 평균 출처 (세션 411 도움말)
const SECTION_HINT = "이 지역(시·도) 전체의 분양 시장 흐름이에요. 이 단지 하나가 아니라 주변 평균 추세를 보여줘요. (출처: KOSIS 통계, 매달 갱신)";

// 5지표 메타 정보 — KOSIS 시계열 컬럼 ↔ 한국어 라벨/단위/색/도움말.
// hint = "보는 법" 쉬운 말 (세션 411 — 단위·scoring 방향 적대검증 정정).
const METRICS: MarketMetric[] = [
  { key: "avg_price_sqm",     label: "평균분양가격",   unit: "천원/㎡",    color: C.green,  hint: "주변에서 새로 분양한 아파트의 1㎡당 평균 분양가(단위: 천원)예요. 위로 오르면 분양가가 비싸지는 흐름이에요." },
  { key: "price_index",       label: "분양가격지수",   unit: "(100=기준)", color: C.blue,   hint: "2014년을 100으로 놓고 분양가가 얼마나 올랐는지 보는 숫자예요. 100보다 높으면 그때보다 비싸진 거예요." },
  { key: "new_supply",        label: "신규공급 세대수", unit: "세대",      color: C.purple, hint: "이 지역에 새로 공급된 아파트 세대 수예요. 많이 늘면 공급이 풍부, 줄면 귀해지는 신호예요." },
  { key: "initial_sale_rate", label: "초기분양율",     unit: "%",         color: C.amber,  hint: "분양 시작 후 초기에 얼마나 팔렸는지(%)예요. 높을수록 인기 많고 안전, 낮으면 미분양 위험 신호예요." },
  { key: "land_cost_ratio",   label: "택지비율",       unit: "%",         color: C.cyan,   hint: "분양가 중 땅값이 차지하는 비율(%)이에요. 높을수록 거품이 적고 안정적이라고 봐요." },
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
      <div style={{ display: "flex", alignItems: "center", fontSize: F.md, fontWeight: 700, color: C.text }}>
        지역 시장 추이 ({region}{headerSuffix})
        <HelpHint text={SECTION_HINT} label="지역 시장 추이" />
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
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: F.xs, color: C.muted, marginBottom: 4 }}>
                <span style={{ display: "flex", alignItems: "center", fontWeight: 600 }}>{m.label}<HelpHint text={m.hint} label={m.label} /></span>
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
