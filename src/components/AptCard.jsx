import { memo, useMemo } from "react";
import { C, catCol, gr, SHORT_LABEL } from "@/theme";
import { ScoreBadge, Bar } from "./primitives";
import { fmtPrice, fmtCompletion } from "@/lib/format";
import { SAFE_CREDIT_GRADES } from "@/constants/scoringTiers";

/* ── 정적 스타일 (모듈 레벨 — 렌더마다 재생성 방지) ── */
const S = {
  wrapper: { borderRadius: 14, overflow: "hidden", marginBottom: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.04)", transition: "all .25s ease" },
  body: { padding: "14px 16px", cursor: "pointer" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start" },
  nameWrap: { flex: 1, minWidth: 0 },
  nameRow: { display: "flex", alignItems: "center", gap: 6, marginBottom: 5 },
  nameText: { fontSize: 15, fontWeight: 800, letterSpacing: -.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  tagRow: { display: "flex", gap: 4, flexWrap: "wrap" },
  grid: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "8px 12px", marginTop: 12 },
  catHeader: { display: "flex", justifyContent: "space-between", marginBottom: 2 },
  catLabel: { fontSize: 11, color: C.muted },
  infoRow: { display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 },
  infoTag: { fontSize: 10, padding: "2px 6px", borderRadius: 3, background: C.bg, color: C.sub },
  alertRow: { marginTop: 6, display: "flex", gap: 4, flexWrap: "wrap" },
  btnRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, padding: "0 16px 12px" },
  btnBase: { borderRadius: 6, padding: "8px 12px", fontSize: 12, cursor: "pointer", flex: 1, minHeight: 36, transition: "all .15s" },
  alertTag: { fontSize: 10, padding: "2px 7px", borderRadius: 4, fontWeight: 600 },
};

export const AptCard = memo(function AptCard({ apt, res, rank, onDetail, isComp, onComp, isFav, onFav, profileWeights, onExpertView }) {
  const g = gr(res.total);
  const benefitWon = res.cats.benefit?.totalWon ?? 0;
    const noxCount = (apt.noxious || []).length;
    const completionPast = apt.completion
      ? apt.completion < `${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, "0")}`
      : false;
  const regionTag = [apt.region, apt.gu, apt.dong].filter(Boolean).join(" ");

  // 상태 의존 스타일만 useMemo로 계산
  const dynStyles = useMemo(() => ({
    wrapper: { ...S.wrapper, background: C.card, border: `1.5px solid ${isComp ? C.blue : isFav ? C.red : C.border}` },
    bar: { height: 4, background: `linear-gradient(90deg,${g.c},${g.c}88)` },
    rank: { fontSize: 11, fontWeight: 800, color: C.white, background: g.c, padding: "3px 8px", borderRadius: 4, flexShrink: 0 },
    detailBtn: { ...S.btnBase, background: C.slate100, color: C.slate600, border: "1.5px solid transparent", fontWeight: 600 },
    favBtn: { ...S.btnBase, background: isFav ? C.redLight : C.slate100, color: isFav ? C.red : C.muted, border: isFav ? `1.5px solid ${C.red}` : "1.5px solid transparent", fontWeight: isFav ? 700 : 600 },
    compBtn: { ...S.btnBase, background: isComp ? C.indigo : "transparent", color: isComp ? C.white : C.indigo, border: `1.5px solid ${C.indigo}`, fontWeight: 700 },
  }), [isComp, isFav, g.c]);

  return (
    <div style={dynStyles.wrapper}>
      <div style={dynStyles.bar} />
      <div style={S.body} onClick={() => onDetail(apt.id)} tabIndex={0} role="button" onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onDetail(apt.id); } }}>
        <div style={S.header}>
          <div style={S.nameWrap}>
            <div style={S.nameRow}>
              <span style={dynStyles.rank}>{rank}위</span>
              <span title={apt.name} style={{ ...S.nameText, color: C.text }}>{apt.name}</span>
            </div>
            <div style={S.tagRow}>
              {[regionTag, `${apt.area ?? ""}㎡`, fmtPrice(apt.price), apt.builder ?? ""].filter(Boolean).map((t, i) => (
                <span key={i} style={{ fontSize: 11, color: i === 0 ? C.blue : C.sub, background: i === 0 ? C.blueLight : C.bg, padding: "3px 8px", borderRadius: 4, fontWeight: i === 0 ? 700 : 400 }}>{t}</span>
              ))}
            </div>
          </div>
          <ScoreBadge score={res.total} size={56} />
        </div>

        <div style={S.grid}>
          {Object.entries(res.cats).sort((a, b) => (profileWeights[b[0]] || 0) - (profileWeights[a[0]] || 0)).slice(0, 3).map(([k, c]) => (
            <div key={k}>
              <div style={S.catHeader}>
                <span style={S.catLabel}>{SHORT_LABEL[c.label] || c.label}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: catCol[k] }}>{c.total}</span>
              </div>
              <Bar value={c.total} color={catCol[k]} h={5} />
            </div>
          ))}
        </div>

        <div style={S.infoRow}>
          {res.cats.price.subs[0]?.info && res.cats.price.subs[0].info !== "데이터 부재" && (
            <span style={S.infoTag}>적정가 {res.cats.price.subs[0].info}</span>
          )}
          {res.cats.location.subs[0]?.info && <span style={S.infoTag}>{res.cats.location.subs[0].info}</span>}
          <span style={S.infoTag}>안전 {gr(res.cats.risk?.total ?? 0).l}등급</span>
        </div>

        {benefitWon > 0 ? (
          <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6, background: C.amberLight, border: `1px solid ${C.amberBorder}`, borderRadius: 8, padding: "8px 12px" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: C.amber }}>총 혜택 약 {benefitWon.toLocaleString()}만원 ({res.cats.benefit?.rate ?? 0}%)</span>
          </div>
        ) : res.cats.benefit?.noData && (
          <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6, background: C.slate100, borderRadius: 8, padding: "6px 12px" }}>
            <span style={{ fontSize: 11, color: C.muted }}>혜택 데이터 미수집</span>
          </div>
        )}

        {(apt.completion || (apt.unsoldRate ?? 0) >= 30 || noxCount > 0 || (apt.builderCreditGrade && !SAFE_CREDIT_GRADES.includes(apt.builderCreditGrade))) && (
          <div style={S.alertRow}>
            {apt.completion && (
              <span style={{ ...S.alertTag,
                background: completionPast ? C.amberLight : C.blueLight,
                color: completionPast ? C.amber : C.blue
              }}>
                {completionPast ? `미입주 (준공 ${fmtCompletion(apt.completion)})` : `입주예정 ${fmtCompletion(apt.completion)}`}
              </span>
            )}
            {(apt.unsoldRate ?? 0) >= 30 && (
              <span style={{ ...S.alertTag, background: C.redLight, color: C.red }}>미분양 {apt.unsoldRate}%</span>
            )}
            {apt.builderCreditGrade && !SAFE_CREDIT_GRADES.includes(apt.builderCreditGrade) && (
              <span style={{ ...S.alertTag, background: C.redLight, color: C.red }}>시공사 {apt.builderCreditGrade}</span>
            )}
            {noxCount > 0 && (
              <span style={{ ...S.alertTag, background: C.redLight, color: C.red }}>혐오시설 {noxCount}건</span>
            )}
          </div>
        )}
      </div>

      <div style={S.btnRow}>
        <button onClick={() => onDetail(apt.id)} style={dynStyles.detailBtn}>상세보기</button>
        <button onClick={e => { e.stopPropagation(); onFav(apt.id); }} style={dynStyles.favBtn}>{isFav ? "관심 해제" : "관심매물"}</button>
        <button onClick={e => { e.stopPropagation(); onComp(apt.id); }} style={dynStyles.compBtn}>{isComp ? "비교 중" : "비교"}</button>
        {onExpertView && (
          <button onClick={e => { e.stopPropagation(); onExpertView(apt.id); }} style={{ ...S.btnBase, background: C.indigo, color: C.white, border: "1.5px solid transparent", fontWeight: 700 }}>전문가보기</button>
        )}
      </div>
    </div>
  );
});
