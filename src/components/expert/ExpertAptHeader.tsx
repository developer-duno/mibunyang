import { memo } from "react";
import { C, F, SHORT_LABEL } from "@/theme";
import { BRAND_TIER } from "@/constants/brands";
import { fmtPrice, fmtCompletion } from "@/lib/format";
import { CITY_TIER, REGIONS } from "@/constants/regions";
import { ScoreBadge, Radar } from "@/components/primitives";
import type { ExpertAptHeaderProps } from "@/types/expert";

export const ExpertAptHeader = memo(function ExpertAptHeader({ apt, res }: ExpertAptHeaderProps) {
  const b = apt.builder ? (BRAND_TIER as Record<string, { tier: string; adj: number; label?: string; score?: number }>)[apt.builder] : undefined;
  const tier = (apt.region ? (REGIONS as Record<string, { tier: string; gus: string[] }>)[apt.region]?.tier : null) || "C";
  const cityLabel = (CITY_TIER as Record<string, { label: string }>)[tier]?.label || tier;
  return (
    <div style={{ background: C.card, borderRadius: 8, border: `1px solid ${C.border}`, padding: 20, marginBottom: 12 }}>
      <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <div style={{ fontSize: F.xxl, fontWeight: 800, color: C.text, marginBottom: 4 }}>{apt.name}</div>
          <div style={{ fontSize: F.base, color: C.sub, marginBottom: 8 }}>{apt.region} {apt.gu} {String(apt.dong ?? "")} · 도시등급 {cityLabel}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            {[
              `${apt.area ?? ""}㎡`,
              fmtPrice(apt.price),
              Number(apt.pp ?? 0) > 0 ? `평당 ${Number(apt.pp).toLocaleString("ko-KR")}만` : null,
              `${apt.builder ?? ""}${b ? ` (${b.tier})` : ""}`,
              apt.completion ? fmtCompletion(apt.completion) : null,
              (apt.units ?? 0) > 1 ? `${(apt.units ?? 0).toLocaleString()}세대${Number(apt.unsold ?? 0) > 0 ? ` (미분양 ${apt.unsold})` : ""}` : null,
              (apt.discountPct ?? 0) > 0 ? `할인 ${apt.discountPct}%` : null,
            ].filter(Boolean).map((tag, i) => (
              <span key={i} style={{ padding: "4px 10px", background: C.bg, borderRadius: 4, fontSize: F.xs, color: C.sub, fontWeight: 600 }}>{tag}</span>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexShrink: 0 }}>
          <ScoreBadge score={res.total} size={80} />
          <div style={{ flexShrink: 0 }}><Radar data={Object.keys(res.cats).map(k => {
            const cat = res.cats[k as keyof typeof res.cats];
            const label = cat.label ?? k;
            return { l: (SHORT_LABEL as Record<string, string>)[label] || label, v: cat.total };
          })} size={140} /></div>
        </div>
      </div>
    </div>
  );
});
