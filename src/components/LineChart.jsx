import { memo, useState, useCallback, useEffect } from "react";
import { C, F } from "@/theme";

const TOOLTIP_DISMISS_MS = 3000;
const HIT_AREA_RADIUS = 16;

// 시계열 라인 차트 — PriceChart(분양가 추이)·UnsoldChart(미분양 추이) 공통 엔진
// 터치 dot 탭 시 툴팁 노출 + 3초 후 auto-dismiss + 빈 영역 탭 시 즉시 dismiss
export const LineChart = memo(function LineChart({ data: _data = [], color = C.blue, height = 160, secondaryData, secondaryColor = C.muted, yLabel = "", xLabel = "" }) {
  const data = _data.filter(d => d && d.y != null);
  const [activeDot, setActiveDot] = useState(null);

  const handleDotTap = useCallback((e) => {
    const idx = Number(e.currentTarget.getAttribute("data-index"));
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
  const allY = [...data.map(d => d.y), ...(secondaryData || []).map(d => d.y).filter(v => v != null)];
  const minY = Math.min(...allY), maxY = Math.max(...allY);
  const rangeY = maxY - minY || 1;
  const toX = (i, len) => pad.l + (i / (len - 1)) * iw;
  const toY = (v) => pad.t + ih - ((v - minY) / rangeY) * ih;
  const makePath = (pts) => pts.map((d, i) => `${i === 0 ? "M" : "L"}${toX(i, pts.length).toFixed(1)},${toY(d.y).toFixed(1)}`).join(" ");
  const gridLines = 4;
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={yLabel || "추이 차트"} style={{ display: "block" }}>
      <title>{yLabel || "추이 차트"}</title>
      {/* 빈 영역 터치 시 dismiss */}
      <rect x="0" y="0" width={w} height={h} fill="transparent" onClick={handleDismiss} />
      {Array.from({ length: gridLines + 1 }, (_, i) => { const y = pad.t + (ih / gridLines) * i; const val = maxY - (rangeY / gridLines) * i; return (
        <g key={i}><line x1={pad.l} y1={y} x2={w - pad.r} y2={y} stroke="#E5E7EB" strokeWidth=".5" /><text x={pad.l - 4} y={y} textAnchor="end" dy="0.35em" fill={C.muted} fontSize={F.micro}>{Math.round(val).toLocaleString()}</text></g>
      ); })}
      {secondaryData && secondaryData.length >= 2 && <path d={makePath(secondaryData)} fill="none" stroke={secondaryColor} strokeWidth="1.5" strokeDasharray="4 3" opacity=".6" />}
      <path d={makePath(data)} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {data.map((d, i) => <circle key={i} cx={toX(i, data.length)} cy={toY(d.y)} r="3" fill={color}><title>{d.label || `${d.x}: ${d.y}`}</title></circle>)}
      {/* 투명 hit area — 터치 타겟 확장 */}
      {data.map((_, i) => <circle key={`h${i}`} cx={toX(i, data.length)} cy={toY(data[i].y)} r={HIT_AREA_RADIUS} fill="transparent" data-index={i} onClick={handleDotTap} style={{ cursor: "pointer" }} />)}
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
      {data.length <= 12 && data.map((d, i) => <text key={`l${i}`} x={toX(i, data.length)} y={h - 6} textAnchor="middle" dy="0.35em" fill={C.muted} fontSize={F.micro}>{d.x}</text>)}
      {xLabel && <text x={w / 2} y={h - 1} textAnchor="middle" fill={C.muted} fontSize={F.micro}>{xLabel}</text>}
    </svg>
  );
});
