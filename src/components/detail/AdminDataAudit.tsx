import { memo, useMemo, useState } from "react";
import { C, F } from "@/theme";
import { FIELD_META, FIELD_SECTIONS } from "@/constants/fieldMeta";
import { PROFILES, getTopCats } from "@/constants/profiles";
import { computeCompleteness } from "@/lib/completeness";
import { EmphasisBadge } from "@/components/primitives";
import type { Apt, Profile } from "@/types/scoring";

// 관리자 데이터 검수 (세션 408 D2a — 구 DataSections adminMode 부분 추출, 점수 탭 전용).
// 141필드 전수 표(FIELD_SECTIONS 9섹션) + 관리자 기준 완성도 + ★중점 강조. DATA_SECTIONS 무관.
// 펼침 게이트: 부모(점수 탭)가 adminLoggedIn 게이트 → 즉시 노출. fullFields 토글로 141표 접힘/펼침.

// 구 ExpertDashboard L18·L26-27 이식 그대로.
const ADMIN_SEC_COLOR: Record<string, string> = { "가격": C.green, "안전": C.red, "입지": C.blue, "상품성": C.purple, "혜택": C.amber, "미래": C.cyan, "교차검증": "#6366F1" };
const ADMIN_FIELD_EXCLUDE: Record<string, readonly string[]> = {
  "가격": ["nearbyMedian", "jeonseRate", "pir", "psr", "dataReliability"],
  "입지": ["hospital", "conv", "cafe", "culture", "bank", "pharmacy"],
  "안전": ["unsoldRate", "recentTrades6m", "supplyRatio", "popGrowth"],
};
const ADMIN_CAT_TO_SECTION: Record<string, string> = { price: "가격", risk: "안전", location: "입지", product: "상품성", benefit: "혜택", future: "미래" };

// 구 ExpertFieldTable 렌더 로직 이식 — 기본값 ⚠·미수집 이탤릭·EmphasisBadge 동일
function AdminFieldSection({ apt, fields, title, color, exclude, emphasized }: {
  apt: Apt; fields: readonly string[]; title: string; color: string; exclude?: readonly string[]; emphasized: boolean;
}) {
  return (
    <div style={{ background: C.card, borderRadius: 8, border: `1px solid ${C.border}`, padding: 12, marginTop: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: F.base, fontWeight: 800, color, marginBottom: 8, borderBottom: `2px solid ${color}`, paddingBottom: 6 }}>
        <span>{title}</span>
        {emphasized && <EmphasisBadge color={color} />}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
        {fields.map(fk => {
          const meta = (FIELD_META as Record<string, { label: string; hidden?: boolean; fmt?: (_v: unknown, _apt: unknown) => unknown; isDefault?: (_v: unknown) => boolean }>)[fk];
          if (!meta || meta.hidden) return null;
          if (exclude?.includes(fk)) return null;
          const raw = apt[fk] ?? null;
          const val = meta.fmt ? meta.fmt(raw, apt) : (raw ?? "미수집");
          const isDef = meta.isDefault && meta.isDefault(raw);
          const isMissing = raw == null && (val === "—" || val === "미수집");
          return (
            <div key={fk} style={{ display: "flex", justifyContent: "space-between", padding: "6px 8px", borderBottom: `1px solid ${C.border}`, fontSize: F.sm }}>
              <span style={{ color: C.muted, flexShrink: 0 }}>{meta.label}</span>
              <span title={isDef ? "이 값은 기본값/추정값입니다" : undefined} style={{ fontWeight: 600, color: isMissing ? C.muted : isDef ? C.amber : C.text, textAlign: "right", marginLeft: 8, fontStyle: isMissing ? "italic" : "normal" }}>{String(val)}{isDef ? " ⚠" : ""}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// 구 ExpertDataCompleteness 전체 이식 — 141필드(비-hidden 전수) 기준 진행바 + 5분류 + 필드명 목록 4종(검수 핵심)
function AdminCompleteness({ apt }: { apt: Apt }) {
  const allFields = Object.keys(FIELD_META).filter(k => !FIELD_META[k].hidden);
  const { pct, filled, estimated, defaults, missing, na, total, evalTotal, estimatedFields, defaultFields, missingFields, naFields } = computeCompleteness(allFields, apt);
  return (
    <div data-testid="admin-completeness" style={{ background: C.card, borderRadius: 8, border: `1px solid ${C.border}`, padding: 12, marginTop: 8 }}>
      <div style={{ fontSize: F.base, fontWeight: 800, color: C.cyan, marginBottom: 8, borderBottom: `2px solid ${C.cyan}`, paddingBottom: 6 }}>데이터 완성도 — 관리자 기준 {total}필드</div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`관리자 기준 데이터 완성도 ${pct}%`} style={{ flex: 1, height: 10, background: C.bg, borderRadius: 5, overflow: "hidden" }}>
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
}

export const AdminDataAudit = memo(function AdminDataAudit({ apt, profile }: { apt: Apt; profile?: Profile }) {
  // 141필드 전수 표 토글 (구 DataSections fullFields, 세션 405 ExpertDashboard 이식) — 기본 접힘.
  const [fullFields, setFullFields] = useState(false);

  // 프로필 상위 2 카테고리 → 강조할 141필드 섹션 key Set (구 ExpertDashboard L99-102 이식, 세션 382)
  const emphasizedSectionKeys = useMemo(() => {
    if (!profile || !PROFILES[profile]) return new Set<string>();
    const top = getTopCats(PROFILES[profile].w) as string[];
    return new Set(top.map((c) => ADMIN_CAT_TO_SECTION[c]).filter(Boolean));
  }, [profile]);

  return (
    <div style={{ marginTop: 8 }}>
      <button type="button" onClick={() => setFullFields(v => !v)} aria-pressed={fullFields} style={{
        background: fullFields ? C.indigo : C.indigoLight, color: fullFields ? C.white : C.indigo,
        border: `1px solid ${C.indigo}`, borderRadius: 6, padding: "6px 12px",
        fontSize: F.xs, fontWeight: 700, cursor: "pointer", minHeight: 36,
      }}>{fullFields ? "요약 보기" : "전체 141필드 보기"}</button>
      <AdminCompleteness apt={apt} />
      {fullFields && (
        <div data-testid="admin-full-fields">
          {FIELD_SECTIONS.map(sec => (
            <AdminFieldSection key={sec.key} apt={apt} fields={sec.fields} title={sec.label}
              color={ADMIN_SEC_COLOR[sec.key] || C.indigo} exclude={ADMIN_FIELD_EXCLUDE[sec.key]}
              emphasized={emphasizedSectionKeys.has(sec.key)} />
          ))}
        </div>
      )}
    </div>
  );
});
