import { memo } from "react";
import { C, F } from "@/theme";
import { FIELD_META } from "@/constants/fieldMeta";
import { computeCompleteness } from "@/lib/completeness";
import type { ExpertDataCompletenessProps } from "@/types/expert";

export const ExpertDataCompleteness = memo(function ExpertDataCompleteness({ apt }: ExpertDataCompletenessProps) {
  // 채움률 계산은 공유 헬퍼로 위임(세션 380) — 소비자 도넛(DataSections)과 같은 로직, drift 0.
  // 전문가 화면은 전체 비-hidden 필드 모집단.
  const allFields = Object.keys(FIELD_META).filter(k => !FIELD_META[k].hidden);
  const { pct, filled, estimated, defaults, missing, na, total, evalTotal, estimatedFields, defaultFields, missingFields, naFields } = computeCompleteness(allFields, apt);
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
