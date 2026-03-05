import { memo } from "react";
import { C, gr } from "@/theme";
import { BRAND_TIER } from "@/constants/brands";
import { CITY_TIER, REGIONS } from "@/constants/regions";
import { ScoreBadge, Radar } from "@/components/primitives";

export const ExpertAptHeader = memo(function ExpertAptHeader({ apt, res, profile }) {
  const g2 = gr(res.total);
  const b = BRAND_TIER[apt.builder];
  const tier = REGIONS[apt.region]?.tier || "C";
  const cityLabel = CITY_TIER[tier]?.label || tier;
  return (
    <div style={{ background: C.card, borderRadius: 8, border: `1px solid ${C.border}`, padding: 20, marginBottom: 12 }}>
      <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: C.text, marginBottom: 4 }}>{apt.name}</div>
          <div style={{ fontSize: 13, color: C.sub, marginBottom: 8 }}>{apt.region} {apt.gu} {apt.dong} · 도시등급 {cityLabel}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            {[`${apt.area}㎡`, `${(apt.price / 10000).toFixed(1)}억`, `${apt.builder}${b ? ` (${b.tier})` : ""}`, apt.completion].map(tag => (
              <span key={tag} style={{ padding: "4px 10px", background: C.bg, borderRadius: 4, fontSize: 11, color: C.sub, fontWeight: 600 }}>{tag}</span>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexShrink: 0 }}>
          <ScoreBadge score={res.total} size={80} />
          <div style={{ flexShrink: 0 }}><Radar data={Object.keys(res.cats).map(k => ({ l: res.cats[k].label.replace("입지·생활권","입지").replace("가격 매력도","가격").replace("혜택·할인","혜택").replace("미래가치","미래").replace("안전도","안전"), v: res.cats[k].total }))} size={140} /></div>
        </div>
      </div>
    </div>
  );
});
