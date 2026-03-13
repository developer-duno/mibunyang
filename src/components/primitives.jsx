import { memo } from "react";
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
