import { memo, useState, useCallback, useEffect } from "react";
import { C, gr } from "@/theme";

export const Bar = memo(function Bar({ value: _v, color = C.blue, h = 5 }) {
  const value = _v ?? 0;
  return (
    <div role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100} style={{ background: "#ECEEF4", borderRadius: 99, height: h, width: "100%", overflow: "hidden" }}>
      <div style={{ width: `${Math.max(0, Math.min(value, 100))}%`, height: "100%", borderRadius: 99, background: `linear-gradient(90deg,${color}90,${color})`, transition: "width .5s ease" }} />
    </div>
  );
});

export const ScoreBadge = memo(function ScoreBadge({ score: _sc, size = 54 }) {
  const score = _sc ?? 0;
  const g = gr(score), r = size / 2 - 3.5, circ = 2 * Math.PI * r, off = circ * (1 - score / 100);
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }} role="img" aria-label={`점수: ${score}점 (${g.l}등급)`}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#ECEEF4" strokeWidth="4.5" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={g.c} strokeWidth="4.5" strokeDasharray={circ} strokeDashoffset={off} strokeLinecap="round" style={{ transition: "stroke-dashoffset .6s ease" }} />
      </svg>
      <div style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: size > 50 ? 22 : 16, fontWeight: 800, color: g.c, lineHeight: 1 }}>{score}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: g.c, marginTop: 1 }}>{g.l}</span>
      </div>
    </div>
  );
});

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
    const t = setTimeout(() => setActiveDot(null), 3000);
    return () => clearTimeout(t);
  }, [activeDot]);

  if (data.length < 2) return <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, fontSize: 12 }}>데이터가 부족합니다</div>;
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
        <g key={i}><line x1={pad.l} y1={y} x2={w - pad.r} y2={y} stroke="#E5E7EB" strokeWidth=".5" /><text x={pad.l - 4} y={y} textAnchor="end" dy="0.35em" fill={C.muted} fontSize="9">{Math.round(val).toLocaleString()}</text></g>
      ); })}
      {secondaryData && secondaryData.length >= 2 && <path d={makePath(secondaryData)} fill="none" stroke={secondaryColor} strokeWidth="1.5" strokeDasharray="4 3" opacity=".6" />}
      <path d={makePath(data)} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {data.map((d, i) => <circle key={i} cx={toX(i, data.length)} cy={toY(d.y)} r="3" fill={color}><title>{d.label || `${d.x}: ${d.y}`}</title></circle>)}
      {/* 투명 hit area — 터치 타겟 확장 */}
      {data.map((_, i) => <circle key={`h${i}`} cx={toX(i, data.length)} cy={toY(data[i].y)} r="16" fill="transparent" data-index={i} onClick={handleDotTap} onTouchStart={handleDotTap} style={{ cursor: "pointer" }} />)}
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
            <text x={tx + tw / 2} y={ty} textAnchor="middle" dy="0.35em" fill={C.white} fontSize="10" fontWeight="600">{label}</text>
          </g>
        );
      })()}
      {data.length <= 12 && data.map((d, i) => <text key={`l${i}`} x={toX(i, data.length)} y={h - 6} textAnchor="middle" dy="0.35em" fill={C.muted} fontSize="8">{d.x}</text>)}
      {xLabel && <text x={w / 2} y={h - 1} textAnchor="middle" fill={C.muted} fontSize="8">{xLabel}</text>}
    </svg>
  );
});

export const Radar = memo(function Radar({ data: _data, size = 130 }) {
  const data = _data || [];
  const n = data.length;
  if (n === 0) return null;
  const cx = size / 2, cy = size / 2, r = size * .36, step = 2 * Math.PI / n;
  const poly = ratio => data.map((_, i) => { const a = -Math.PI / 2 + i * step; return `${cx + Math.cos(a) * r * ratio},${cy + Math.sin(a) * r * ratio}`; }).join(" ");
  const dp = data.map((d, i) => { const a = -Math.PI / 2 + i * step; return `${cx + Math.cos(a) * r * d.v / 100},${cy + Math.sin(a) * r * d.v / 100}`; }).join(" ");
  return (
    <svg width={size} height={size} role="img" aria-label="카테고리별 점수 레이더 차트">
      <title>카테고리별 점수 레이더 차트</title>
      {[.25, .5, .75, 1].map(r2 => <polygon key={r2} points={poly(r2)} fill="none" stroke="#E5E7EB" strokeWidth=".7" />)}
      <polygon points={dp} fill="rgba(37,99,235,0.1)" stroke={C.blue} strokeWidth="1.5" />
      {data.map((d, i) => { const a = -Math.PI / 2 + i * step; return <circle key={i} cx={cx + Math.cos(a) * r * d.v / 100} cy={cy + Math.sin(a) * r * d.v / 100} r="3" fill={C.blue} />; })}
      {data.map((d, i) => { const a = -Math.PI / 2 + i * step; return <text key={`t${i}`} x={cx + Math.cos(a) * (r + 16)} y={cy + Math.sin(a) * (r + 16)} textAnchor="middle" dy="0.35em" fill={C.sub} fontSize="12" fontWeight="600">{d.l}</text>; })}
    </svg>
  );
});
