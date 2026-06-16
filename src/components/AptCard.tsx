import { memo, useMemo } from "react";
import { C, F, catCol, gr, SHORT_LABEL } from "@/theme";
import { ScoreBadge, Bar } from "./primitives";
import { fmtPrice, fmtCompletion, fmtCompetitionRate } from "@/lib/format";
import { SAFE_CREDIT_GRADES } from "@/constants/scoringTiers";
import type { AptCardProps } from "@/types/components/AptCard.types";

const UNSOLD_ALERT_THRESHOLD = 30;
/* 청약 경쟁률 배지 노출 단계 — 청약 진행/예정만 (미분양 제외, 모순 표시 차단) */
const PRESALE_ACTIVE_STAGES = new Set(["분양중", "청약중", "분양계획"]);
/* ── 모듈 레벨 상수 (렌더마다 재생성 방지) ── */
const NOW_YM = `${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, "0")}`;

function completionBadge(completion: string | null | undefined, moveInDone: boolean, completionPast: boolean) {
  if (moveInDone) return { bg: C.greenLight, color: C.green, text: `입주완료 ${fmtCompletion(completion)}` };
  if (completionPast) return { bg: C.amberLight, color: C.amber, text: `미입주 (준공 ${fmtCompletion(completion)})` };
  return { bg: C.blueLight, color: C.blue, text: `입주예정 ${fmtCompletion(completion)}` };
}

/* ── 정적 스타일 ── */
const S = {
  wrapper: { borderRadius: 14, overflow: "hidden", marginBottom: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.04)", transition: "all .25s ease" },
  body: { padding: "14px 16px", cursor: "pointer" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start" },
  nameWrap: { flex: 1, minWidth: 0 },
  nameRow: { display: "flex", alignItems: "center", gap: 6, marginBottom: 5 },
  nameText: { fontSize: F.lg, fontWeight: 800, letterSpacing: -.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  tagRow: { display: "flex", gap: 4, flexWrap: "wrap" as const },
  grid: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "8px 12px", marginTop: 12 },
  catHeader: { display: "flex", justifyContent: "space-between", marginBottom: 2 },
  catLabel: { fontSize: F.sm, color: C.muted },
  infoRow: { display: "flex", gap: 4, flexWrap: "wrap" as const, marginTop: 6 },
  infoTag: { fontSize: F.sm, padding: "3px 7px", borderRadius: 3, background: C.bg, color: C.sub },
  alertRow: { marginTop: 6, display: "flex", gap: 4, flexWrap: "wrap" as const },
  btnRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 },
  btnBase: { borderRadius: 6, padding: "8px 10px", fontSize: F.base, cursor: "pointer", flex: 1, minHeight: 36, transition: "all .15s" },
  alertTag: { fontSize: F.sm, padding: "3px 8px", borderRadius: 4, fontWeight: 600 },
};

export const AptCard = memo(function AptCard({ apt, res, rank, onDetail, isComp, onComp, isFav, onFav, profileWeights, isDesktop, isLoggedIn = true }: AptCardProps) {
  const g = gr(res.total);
  const benefitWon = res.cats.benefit?.totalWon ?? 0;
    const noxCount = ((apt.noxious as string[] | undefined) || []).length;
    const completionPast = apt.completion ? apt.completion < NOW_YM : false;
    const moveInDone = completionPast && (apt.unsoldRate ?? 0) === 0;
  const regionTag = [apt.region, apt.gu, apt.dong].filter(Boolean).join(" ");

  // 상태 의존 스타일만 useMemo로 계산
  const dynStyles = useMemo(() => ({
    wrapper: { ...S.wrapper, background: C.card, border: `1.5px solid ${isComp ? C.blue : isFav ? C.red : C.border}`, ...(moveInDone ? { opacity: 0.55 } : {}), ...(isDesktop ? { boxShadow: C.shadowMd, borderRadius: 16 } : {}) },
    body: { ...S.body, ...(isDesktop ? { padding: "16px 20px" } : {}) },
    nameText: { ...S.nameText, ...(isDesktop ? { fontSize: F.xl } : {}) },
    bar: { height: 4, background: `linear-gradient(90deg,${g.c},${g.c}88)` },
    rank: { fontSize: F.sm, fontWeight: 800, color: C.white, background: g.c, padding: "3px 8px", borderRadius: 4, flexShrink: 0 },
    detailBtn: { ...S.btnBase, background: C.slate100, color: C.slate600, border: "1.5px solid transparent", fontWeight: 600 },
    favBtn: { ...S.btnBase, background: isFav ? C.redLight : C.slate100, color: isFav ? C.red : C.muted, border: isFav ? `1.5px solid ${C.red}` : "1.5px solid transparent", fontWeight: isFav ? 700 : 600 },
    compBtn: { ...S.btnBase, background: isComp ? C.indigo : "transparent", color: isComp ? C.white : C.indigo, border: `1.5px solid ${C.indigo}`, fontWeight: 700 },
  }), [isComp, isFav, g.c, moveInDone, isDesktop]);

  // 상위 3개 카테고리 정렬 메모이제이션 (매 렌더 재정렬 방지)
  const topCats = useMemo(() =>
    Object.entries(res.cats)
      .sort((a, b) => ((profileWeights as unknown as Record<string, number>)[b[0]] || 0) - ((profileWeights as unknown as Record<string, number>)[a[0]] || 0))
      .slice(0, 3),
    [res.cats, profileWeights]
  );

  return (
    <div style={dynStyles.wrapper}>
      <div style={dynStyles.bar} />
      <div style={dynStyles.body || S.body} onClick={() => onDetail(apt.id as string)} tabIndex={0} role="button" onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onDetail(apt.id as string); } }}>
        <div style={S.header}>
          <div style={S.nameWrap}>
            <div style={S.nameRow}>
              {rank > 0 && <span style={dynStyles.rank}>{rank}위</span>}
              <span title={String(apt.name ?? "")} style={{ ...dynStyles.nameText, color: C.text }}>{String(apt.name ?? "")}</span>
            </div>
            <div style={S.tagRow}>
              {[regionTag, `${apt.area ?? ""}㎡`, fmtPrice(apt.price), apt.builder ?? ""].filter(Boolean).map((t, i) => (
                <span key={i} style={{ fontSize: F.sm, color: i === 0 ? C.blue : C.sub, background: i === 0 ? C.blueLight : C.bg, padding: "3px 8px", borderRadius: 4, fontWeight: i === 0 ? 700 : 400 }}>{t}</span>
              ))}
            </div>
          </div>
          {isLoggedIn
            ? <ScoreBadge score={res.total} size={56} />
            : <div style={{ width: 56, height: 56, borderRadius: "50%", background: C.slate100, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 800, color: C.muted, filter: "blur(2px)" }}>??</div>
          }
        </div>

        <div style={isDesktop ? { ...S.grid, gap: "10px 14px" } : S.grid}>
          {(topCats as Array<[string, { label: string; total: number }]>).map(([k, c]) => (
            <div key={k}>
              <div style={S.catHeader}>
                <span style={S.catLabel}>{(SHORT_LABEL as Record<string, string>)[c.label] || c.label}</span>
                <span style={{ fontSize: F.base, fontWeight: 700, color: (catCol as Record<string, string>)[k], ...(isLoggedIn ? {} : { filter: "blur(4px)" }) }}>{isLoggedIn ? c.total : "??"}</span>
              </div>
              {isLoggedIn
                ? <Bar value={c.total} color={(catCol as Record<string, string>)[k]} h={5} />
                : <div aria-hidden="true" style={{ height: 5, background: "#ECEEF4", borderRadius: 99 }} />}
            </div>
          ))}
        </div>

        <div style={S.infoRow}>
          {res.cats.price.subs[0]?.info && res.cats.price.subs[0].info !== "데이터 부재" ? (
            <span style={S.infoTag}>적정가 {res.cats.price.subs[0].info}</span>
          ) : res.cats.price.subs[0]?.detail ? (
            <span style={S.infoTag}>{res.cats.price.subs[0].detail}</span>
          ) : null}
          {res.cats.location.subs[0]?.info && <span style={S.infoTag}>{res.cats.location.subs[0].info}</span>}
          <span style={S.infoTag}>안전 {isLoggedIn ? gr(res.cats.risk?.total ?? 0).l : "?"}등급</span>
          {(apt.discountPct ?? 0) > 0 && <span style={{ ...S.infoTag, background: C.greenLight, color: C.green, fontWeight: 700 }}>할인 {apt.discountPct}%</span>}
          {res.cats.price?.deviation != null && Number(res.cats.price.deviation) > 0 && <span style={{ ...S.infoTag, background: C.greenLight, color: C.green, fontWeight: 700 }}>주변대비 +{Math.round(Number(res.cats.price.deviation))}% 저렴</span>}
          {res.cats.price?.deviation != null && Number(res.cats.price.deviation) < 0 && <span style={{ ...S.infoTag, background: C.redLight, color: C.red, fontWeight: 700 }}>주변대비 {Math.abs(Math.round(Number(res.cats.price.deviation)))}% 비쌈</span>}
          {PRESALE_ACTIVE_STAGES.has(apt.presaleStage as string) && Number(apt.competitionRate ?? 0) > 0 && <span style={{ ...S.infoTag, background: C.indigoLight, color: C.indigo, fontWeight: 700 }}>청약 {fmtCompetitionRate(Number(apt.competitionRate))}</span>}
        </div>

        {benefitWon > 0 ? (
          <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6, background: C.amberLight, border: `1px solid ${C.amberBorder}`, borderRadius: 8, padding: "8px 12px" }}>
            <span style={{ fontSize: F.base, fontWeight: 700, color: C.amber }}>총 혜택 약 {benefitWon.toLocaleString()}만원 ({res.cats.benefit?.rate ?? 0}%)</span>
          </div>
        ) : res.cats.benefit?.noData && (
          <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6, background: C.slate100, borderRadius: 8, padding: "6px 12px" }}>
            <span style={{ fontSize: F.sm, color: C.muted }}>혜택 데이터 미수집</span>
          </div>
        )}

        {(apt.completion || (apt.unsoldRate ?? 0) >= UNSOLD_ALERT_THRESHOLD || noxCount > 0 || apt.presaleStage || (apt.builderCreditGrade && !SAFE_CREDIT_GRADES.includes(apt.builderCreditGrade as string)) || (apt.crimeSafetyGrade != null && (apt.crimeSafetyGrade >= 4 || apt.crimeSafetyGrade <= 2)) || (Number(apt.unsoldEventCount ?? 0) > 0 && (apt.id as string)?.startsWith("ah-"))) && (
          <div style={S.alertRow}>
            {apt.presaleStage ? (() => {
              const sm: Record<string, { bg: string; color: string }> = { "분양중": { bg: C.greenLight, color: C.green }, "분양예정": { bg: C.blueLight, color: C.blue } };
              const s = sm[apt.presaleStage as string] ?? { bg: C.purpleLight, color: C.purple };
              return <span style={{ ...S.alertTag, background: s.bg, color: s.color }}>{String(apt.presaleStage)}</span>;
            })() : null}
            {apt.completion ? (() => {
              const b = completionBadge(apt.completion as string, moveInDone, completionPast);
              return <span style={{ ...S.alertTag, background: b.bg, color: b.color }}>{b.text}</span>;
            })() : null}
            {(apt.unsoldRate ?? 0) >= UNSOLD_ALERT_THRESHOLD && (
              <span style={{ ...S.alertTag, background: C.redLight, color: C.red }}>미분양 {String(apt.unsoldRate)}%</span>
            )}
            {Boolean(apt.builderCreditGrade) && !SAFE_CREDIT_GRADES.includes(apt.builderCreditGrade as string) && (
              <span style={{ ...S.alertTag, background: C.redLight, color: C.red }}>시공사 {String(apt.builderCreditGrade)}</span>
            )}
            {noxCount > 0 && (
              <span style={{ ...S.alertTag, background: C.redLight, color: C.red }}>혐오시설 {noxCount}건</span>
            )}
            {apt.crimeSafetyGrade != null && apt.crimeSafetyGrade >= 4 && (
              <span style={{ ...S.alertTag, background: apt.crimeSafetyGrade >= 5 ? C.redLight : C.amberLight, color: apt.crimeSafetyGrade >= 5 ? C.red : C.amber }}>{apt.crimeSafetyGrade >= 5 ? "치안위험" : "치안주의"}</span>
            )}
            {/* 치안 우수(1·2등급) — 안전한 단지의 강점 노출 (세션 423, 위험 배지와 상호배타: 3등급은 둘 다 미표시) */}
            {apt.crimeSafetyGrade != null && apt.crimeSafetyGrade <= 2 && (
              <span style={{ ...S.alertTag, background: C.greenLight, color: C.green }}>치안우수</span>
            )}
            {/* 무순위 공고 발생 단지 — ah- 단지만 (다른 prefix는 0의 의미가 "정보 없음") */}
            {Number(apt.unsoldEventCount ?? 0) > 0 && (apt.id as string)?.startsWith("ah-") && (
              <span style={{ ...S.alertTag, background: C.redLight, color: C.red }}>추가 모집</span>
            )}
          </div>
        )}
      </div>

      <div style={isDesktop ? { ...S.btnRow, padding: "0 20px 14px" } : { ...S.btnRow, padding: "0 16px 12px" }}>
        <button onClick={() => onDetail(apt.id as string)} style={dynStyles.detailBtn}>상세보기</button>
        <button onClick={e => { e.stopPropagation(); onFav(apt.id as string); }} style={dynStyles.favBtn}>{isFav ? "관심 해제" : "관심매물"}</button>
        <button onClick={e => { e.stopPropagation(); onComp(apt.id as string); }} style={dynStyles.compBtn}>{isComp ? "비교 중" : "비교"}</button>
      </div>
    </div>
  );
}, (prev, next) => {
  if (prev.apt.id !== next.apt.id || prev.rank !== next.rank) return false;
  if (prev.res.total !== next.res.total) return false;
  if (prev.isComp !== next.isComp || prev.isFav !== next.isFav) return false;
  if (prev.isDesktop !== next.isDesktop) return false;
  if (prev.isLoggedIn !== next.isLoggedIn) return false;
  // alertRow 6배지 신호 — 누락 시 데이터 갱신돼도 카드 안 다시 그림
  // (BACKLOG 🟢: AptCard memo comparator 6필드 — 세션168)
  const pa = prev.apt, na = next.apt;
  if (pa.completion !== na.completion) return false;
  if (pa.unsoldRate !== na.unsoldRate) return false;
  if (pa.presaleStage !== na.presaleStage) return false;
  if (pa.competitionRate !== na.competitionRate) return false;
  if (pa.crimeSafetyGrade !== na.crimeSafetyGrade) return false;
  if (pa.builderCreditGrade !== na.builderCreditGrade) return false;
  if (pa.unsoldEventCount !== na.unsoldEventCount) return false;
  const pk = prev.profileWeights, nk = next.profileWeights;
  if (pk !== nk && (!pk || !nk || pk.price !== nk.price || pk.location !== nk.location || pk.product !== nk.product || pk.risk !== nk.risk || pk.benefit !== nk.benefit || pk.future !== nk.future)) return false;
  return true;
});
