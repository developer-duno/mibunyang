import { memo, useState, useCallback, useEffect, type MouseEvent as ReactMouseEvent } from "react";
import { C, F } from "@/theme";

/** Y축 눈금 스케일 — niceTicks 반환 타입. */
export type NiceScale = { ticks: number[]; min: number; max: number };

/** 원시 간격을 1·2·5·10 의 10^n 배수 중 가까운 "nice" 값으로 올림. */
function niceStep(raw: number): number {
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return nice * mag;
}

/**
 * Y축 눈금 계산. 항상 min<max + ticks.length>=2 보장 (rangeY=0 방어).
 * - 모든 값 동일: 값을 중앙에 두고 위아래 여백 (작은 정수는 ±1 정수 눈금)
 * - 작은 정수 범위(<=10): 정수 1단위 눈금 (소수 눈금 제거)
 * - 일반: 1·2·5·10 nice step 으로 4~5 눈금
 */
export function niceTicks(minY: number, maxY: number): NiceScale {
  // 1) 모든 값 동일
  if (maxY === minY) {
    const v = minY;
    if (Number.isInteger(v) && Math.abs(v) <= 10) {
      const min = Math.max(0, v - 1), max = v + 1;
      const ticks: number[] = [];
      for (let t = min; t <= max; t++) ticks.push(t);
      return { ticks, min, max };
    }
    const pad = Math.max(1, Math.abs(v) * 0.001);
    const mag = Math.pow(10, Math.floor(Math.log10(pad)));
    const step = Math.ceil(pad / mag) * mag;
    return { ticks: [v - step, v, v + step], min: v - step, max: v + step };
  }
  // 2) 작은 정수 범위
  if (Number.isInteger(minY) && Number.isInteger(maxY) && maxY - minY <= 10) {
    const min = Math.floor(minY), max = Math.ceil(maxY);
    const ticks: number[] = [];
    for (let t = min; t <= max; t++) ticks.push(t);
    return { ticks, min, max };
  }
  // 3) 일반 — nice step
  const step = niceStep((maxY - minY) / 4);
  const min = Math.floor(minY / step) * step;
  const max = Math.ceil(maxY / step) * step;
  const ticks: number[] = [];
  for (let t = min; t <= max + 1e-9; t += step) ticks.push(Math.round(t * 1e6) / 1e6);
  return { ticks, min, max };
}

const TOOLTIP_DISMISS_MS = 3000;
const HIT_AREA_RADIUS = 16;

type LineChartPoint = { x: string | number; y: number | null; label?: string };
type LineChartProps = {
  data?: LineChartPoint[];
  color?: string;
  height?: number;
  secondaryData?: LineChartPoint[];
  secondaryColor?: string;
  yLabel?: string;
  xLabel?: string;
};

// 시계열 라인 차트 — PriceChart(분양가 추이)·UnsoldChart(미분양 추이) 공통 엔진
// 터치 dot 탭 시 툴팁 노출 + 3초 후 auto-dismiss + 빈 영역 탭 시 즉시 dismiss
export const LineChart = memo(function LineChart({ data: _data = [], color = C.blue, height = 160, secondaryData, secondaryColor = C.muted, yLabel = "", xLabel = "" }: LineChartProps) {
  const data = _data.filter((d): d is LineChartPoint & { y: number } => d != null && d.y != null);
  const [activeDot, setActiveDot] = useState<number | null>(null);

  const handleDotTap = useCallback((e: ReactMouseEvent<SVGCircleElement>) => {
    const idx = Number((e.currentTarget as SVGCircleElement).getAttribute("data-index"));
    setActiveDot(prev => prev === idx ? null : idx);
  }, []);
  const handleDismiss = useCallback(() => setActiveDot(null), []);

  useEffect(() => {
    if (activeDot == null) return;
    const t = setTimeout(() => setActiveDot(null), TOOLTIP_DISMISS_MS);
    return () => clearTimeout(t);
  }, [activeDot]);

  if (data.length < 2) return <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, fontSize: F.base }}>데이터가 부족합니다</div>;
  const pad = { t: 16, r: 12, b: 28, l: 44 };
  const w = 300, h = height;
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const allY = [...data.map(d => d.y), ...(secondaryData || []).map(d => d.y).filter(v => v != null)] as number[];
  const dataMinY = Math.min(...allY), dataMaxY = Math.max(...allY);
  const { ticks, min: scaleMin, max: scaleMax } = niceTicks(dataMinY, dataMaxY);
  const rangeY = scaleMax - scaleMin;  // niceTicks 불변식 → 항상 > 0
  const toX = (i: number, len: number) => pad.l + (i / (len - 1)) * iw;
  const toY = (v: number) => pad.t + ih - ((v - scaleMin) / rangeY) * ih;
  const makePath = (pts: Array<{ y: number | null }>) => pts.map((d, i) => `${i === 0 ? "M" : "L"}${toX(i, pts.length).toFixed(1)},${toY(d.y as number).toFixed(1)}`).join(" ");
  const fewPoints = data.length <= 3;
  const dotR = fewPoints ? "4.5" : "3";
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={yLabel || "추이 차트"} style={{ display: "block" }}>
      <title>{yLabel || "추이 차트"}</title>
      {/* 빈 영역 터치 시 dismiss */}
      <rect x="0" y="0" width={w} height={h} fill="transparent" onClick={handleDismiss} />
      {ticks.map((val, i) => { const y = toY(val); return (
        <g key={i}><line x1={pad.l} y1={y} x2={w - pad.r} y2={y} stroke="#E5E7EB" strokeWidth=".5" /><text x={pad.l - 4} y={y} textAnchor="end" dy="0.35em" fill={C.muted} fontSize={F.micro}>{val.toLocaleString()}</text></g>
      ); })}
      {secondaryData && secondaryData.length >= 2 && <path d={makePath(secondaryData)} fill="none" stroke={secondaryColor} strokeWidth="1.5" strokeDasharray="4 3" opacity=".6" />}
      <path d={makePath(data)} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {data.map((d, i) => <circle key={i} cx={toX(i, data.length)} cy={toY(d.y as number)} r={dotR} fill={color}><title>{d.label || `${d.x}: ${d.y}`}</title></circle>)}
      {fewPoints && data.map((d, i) => {
        const cx = toX(i, data.length);
        const cy = toY(d.y as number);
        const above = cy > pad.t + 16;
        return (
          <text key={`pl${i}`} data-pointlabel="" x={cx} y={above ? cy - 8 : cy + 16} textAnchor="middle" fill={C.text} fontSize={F.micro} fontWeight="600">
            {(d.y as number).toLocaleString()}
          </text>
        );
      })}
      {/* 투명 hit area — 터치 타겟 확장 */}
      {data.map((_d, i) => <circle key={`h${i}`} cx={toX(i, data.length)} cy={toY(data[i].y as number)} r={HIT_AREA_RADIUS} fill="transparent" data-index={i} onClick={handleDotTap} style={{ cursor: "pointer" }} />)}
      {activeDot != null && activeDot < data.length && (() => {
        const d = data[activeDot];
        const cx = toX(activeDot, data.length);
        const cy = toY(d.y);
        const label = d.label || `${d.x}: ${(d.y ?? 0).toLocaleString()}`;
        const tw = Math.min(label.length * 6 + 16, w - pad.l - pad.r);
        const tx = Math.max(pad.l, Math.min(cx - tw / 2, w - pad.r - tw));
        const ty = Math.max(pad.t, cy - 24);
        return (
          <g>
            <circle cx={cx} cy={cy} r="5" fill={color} stroke={C.white} strokeWidth="2" />
            <rect x={tx} y={ty - 12} width={tw} height={18} rx={4} fill={C.text} opacity=".85" />
            <text x={tx + tw / 2} y={ty} textAnchor="middle" dy="0.35em" fill={C.white} fontSize={F.xs} fontWeight="600">{label}</text>
          </g>
        );
      })()}
      {data.length <= 12 && data.map((d: LineChartPoint, i: number) => <text key={`l${i}`} x={toX(i, data.length)} y={h - 6} textAnchor="middle" dy="0.35em" fill={C.muted} fontSize={F.micro}>{d.x}</text>)}
      {xLabel && <text x={w / 2} y={h - 1} textAnchor="middle" fill={C.muted} fontSize={F.micro}>{xLabel}</text>}
    </svg>
  );
});
