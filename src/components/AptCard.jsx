import { memo } from "react";
import { C, catCol, gr, SHORT_LABEL } from "@/theme";
import { ScoreBadge, Bar } from "./primitives";

export const AptCard = memo(function AptCard({ apt, res, rank, onDetail, isComp, onComp, isFav, onFav, profileWeights }) {
  const g = gr(res.total);
  const benefitWon = res.cats.benefit.totalWon;
  const regionTag = `${apt.region} ${apt.gu}`;

  return (
    <div style={{
      background: C.card, border: `1.5px solid ${isComp ? C.blue : isFav ? C.red : C.border}`, borderRadius: 14, overflow: "hidden", marginBottom: 12,
      boxShadow: "0 1px 4px rgba(0,0,0,0.04)", transition: "all .25s ease"
    }}>
      <div style={{ height: 4, background: `linear-gradient(90deg,${apt.heroColor},${apt.heroColor}88)` }} />
      <div style={{ padding: "14px 16px", cursor: "pointer" }} onClick={() => onDetail(apt.id)} tabIndex={0} role="button" onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onDetail(apt.id); } }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: C.white, background: g.c, padding: "3px 8px", borderRadius: 4, flexShrink: 0 }}>{rank}위</span>
              <span title={apt.name} style={{ fontSize: 15, fontWeight: 800, color: C.text, letterSpacing: -.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{apt.name}</span>
            </div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {[regionTag, `${apt.area}㎡`, `${(apt.price / 10000).toFixed(1)}억`, apt.builder].map((t, i) => (
                <span key={i} style={{ fontSize: 11, color: i === 0 ? C.blue : C.sub, background: i === 0 ? C.blueLight : C.bg, padding: "3px 8px", borderRadius: 4, fontWeight: i === 0 ? 700 : 400 }}>{t}</span>
              ))}
            </div>
          </div>
          <ScoreBadge score={res.total} size={56} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "8px 12px", marginTop: 12 }}>
          {Object.entries(res.cats).sort((a, b) => (profileWeights[b[0]] || 0) - (profileWeights[a[0]] || 0)).slice(0, 3).map(([k, c]) => (
            <div key={k}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                <span style={{ fontSize: 11, color: C.muted }}>{SHORT_LABEL[c.label] || c.label}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: catCol[k] }}>{c.total}</span>
              </div>
              <Bar value={c.total} color={catCol[k]} h={5} />
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
          {res.cats.price.subs[0].info !== "데이터 부재" && (
            <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 3, background: C.bg, color: C.sub }}>적정가 {res.cats.price.subs[0].info}</span>
          )}
          <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 3, background: C.bg, color: C.sub }}>{res.cats.location.subs[0].info}</span>
          <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 3, background: C.bg, color: C.sub }}>안전 {gr(res.cats.risk.total).l}등급</span>
        </div>

        {benefitWon > 0 && (
          <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6, background: C.amberLight, border: `1px solid ${C.amberBorder}`, borderRadius: 8, padding: "8px 12px" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: C.amber }}>총 혜택 약 {benefitWon.toLocaleString()}만원 ({res.cats.benefit.rate}%)</span>
          </div>
        )}

        {(apt.completion || (apt.unsoldRate ?? 0) >= 30 || (apt.noxious || []).length > 0 || (apt.builderCreditGrade && !["AAA","AA+","AA","AA-","A+","A","A-"].includes(apt.builderCreditGrade))) && (
          <div style={{ marginTop: 6, display: "flex", gap: 4, flexWrap: "wrap" }}>
            {apt.completion && (
              <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 4, background: C.blueLight, color: C.blue, fontWeight: 600 }}>입주 {apt.completion}</span>
            )}
            {(apt.unsoldRate ?? 0) >= 30 && (
              <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 4, background: C.redLight, color: C.red, fontWeight: 600 }}>미분양 {apt.unsoldRate}%</span>
            )}
            {apt.builderCreditGrade && !["AAA","AA+","AA","AA-","A+","A","A-"].includes(apt.builderCreditGrade) && (
              <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 4, background: C.redLight, color: C.red, fontWeight: 600 }}>시공사 {apt.builderCreditGrade}</span>
            )}
            {(apt.noxious || []).length > 0 && (
              <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 4, background: C.redLight, color: C.red, fontWeight: 600 }}>혐오시설 {apt.noxious.length}건</span>
            )}
          </div>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, padding: "0 16px 12px" }}>
        <button onClick={() => onDetail(apt.id)} style={{
          background: C.slate100, color: C.slate600, border: "1.5px solid transparent", borderRadius: 6,
          padding: "8px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", flex: 1, minHeight: 36, transition: "all .15s"
        }}>상세보기</button>
        <button onClick={e => { e.stopPropagation(); onFav(apt.id); }} style={{
          background: isFav ? C.redLight : C.slate100, color: isFav ? C.red : C.muted,
          border: isFav ? `1.5px solid ${C.red}` : "1.5px solid transparent", borderRadius: 6,
          padding: "8px 12px", fontSize: 12, fontWeight: isFav ? 700 : 600, cursor: "pointer", flex: 1, minHeight: 36, transition: "all .15s"
        }}>{isFav ? "관심 등록" : "관심매물"}</button>
        <button onClick={e => { e.stopPropagation(); onComp(apt.id); }} style={{
          background: isComp ? C.indigo : "transparent", color: isComp ? C.white : C.indigo,
          border: `1.5px solid ${C.indigo}`, borderRadius: 6, padding: "8px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", flex: 1, minHeight: 36, transition: "all .15s"
        }}>{isComp ? "비교 중" : "비교"}</button>
      </div>
    </div>
  );
});
