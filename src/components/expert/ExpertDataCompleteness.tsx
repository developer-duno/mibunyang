import { memo } from "react";
import { C, F } from "@/theme";
import { FIELD_META } from "@/constants/fieldMeta";
import type { ExpertDataCompletenessProps } from "@/types/expert";

export const ExpertDataCompleteness = memo(function ExpertDataCompleteness({ apt }: ExpertDataCompletenessProps) {
  const FM = FIELD_META as Record<string, { label: string; hidden?: boolean; isNotApplicable?: (_v: unknown, _apt: unknown) => boolean; isEstimated?: (_v: unknown, _apt: unknown) => boolean; isDefault?: (_v: unknown) => boolean; fmt?: (_v: unknown, _apt: unknown) => unknown }>;
  const allFields = Object.keys(FM).filter(k => !FM[k].hidden);
  let filled = 0, estimated = 0, defaults = 0, missing = 0, na = 0;
  const estimatedFields: string[] = [];
  const defaultFields: string[] = [];
  const missingFields: string[] = [];
  const naFields: string[] = [];
  allFields.forEach(k => {
    const meta = FM[k];
    const v = apt[k];
    // 적용 대상 아님 판정이 최우선 — 분양 중이 아닌 단지는 presale/competition 필드가 애초 평가 대상 아님
    if (meta.isNotApplicable && meta.isNotApplicable(v, apt)) { na++; naFields.push(meta.label); return; }
    if (v === undefined || v === null || v === "") { missing++; missingFields.push(meta.label); }
    else if (meta.isEstimated && meta.isEstimated(v, apt)) { estimated++; estimatedFields.push(meta.label); }
    else if (meta.isDefault && meta.isDefault(v)) { defaults++; defaultFields.push(`${meta.label} (${meta.fmt ? meta.fmt(v, apt) : v})`); }
    else { filled++; }
  });
  const total = allFields.length;
  const evalTotal = total - na;
  const pct = evalTotal > 0 ? Math.round(((filled + estimated * 0.5) / evalTotal) * 100) : 0;
  return (
    <div style={{ background: C.card, borderRadius: 8, border: `1px solid ${C.border}`, padding: 16, marginBottom: 12 }}>
      <div style={{ fontSize: F.base, fontWeight: 800, color: C.cyan, marginBottom: 10, borderBottom: `2px solid ${C.cyan}`, paddingBottom: 6 }}>데이터 완성도</div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
        <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`데이터 완성도 ${pct}%`} style={{ flex: 1, height: 10, background: C.bg, borderRadius: 5, overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: pct >= 80 ? C.green : pct >= 50 ? C.amber : C.red, borderRadius: 5, transition: "width .3s" }} />
        </div>
        <span style={{ fontSize: F.base, fontWeight: 800, color: pct >= 80 ? C.green : pct >= 50 ? C.amber : C.red }}>{pct}%</span>
      </div>
      <div style={{ fontSize: F.xs, color: C.sub, marginBottom: 4 }}>실제 데이터: <b>{filled}</b>개 | 지역추정: <b style={{ color: C.blue }}>{estimated}</b>개 | 기본값: <b style={{ color: C.amber }}>{defaults}</b>개 | 미등록: <b style={{ color: C.red }}>{missing}</b>개 | 해당없음: <b style={{ color: C.muted }}>{na}</b>개 / 평가 {evalTotal} / 총 {total}개</div>
      {estimatedFields.length > 0 && (
        <div style={{ fontSize: F.micro, color: C.blue, marginTop: 4 }}>지역추정 필드: {estimatedFields.join(", ")}</div>
      )}
      {defaultFields.length > 0 && (
        <div style={{ fontSize: F.micro, color: C.amber, marginTop: 4 }}>기본값 필드: {defaultFields.join(", ")}</div>
      )}
      {missingFields.length > 0 && (
        <div style={{ fontSize: F.micro, color: C.red, marginTop: 4 }}>미등록 필드: {missingFields.join(", ")}</div>
      )}
      {naFields.length > 0 && (
        <div style={{ fontSize: F.micro, color: C.muted, marginTop: 4 }}>적용 대상 아님 필드: {naFields.join(", ")}</div>
      )}
    </div>
  );
});
