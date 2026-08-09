import { memo } from "react";
import { C, F } from "@/theme";
import { FIELD_META } from "@/constants/fieldMeta";
import { Bar } from "@/components/primitives";
import type { HighlightFieldProps } from "@/types/detail";

// 4필드 한정 도메인 설명 (pir/psr/unsoldRate/dataReliability)
// ⚠️ 세션 507: `popGrowth` 를 뺐다 — 그 필드가 강조줄에서 내려가 분양 탭 "이 지역 통계"
//    서랍으로 옮겨졌기 때문이다(단지 값이 아니라 시·도 통계라서). "양수면 유입 지역"이라는
//    설명 취지는 그 서랍의 ? 도움말이 이어받았다(`detail/RegionStats` SECTION_HINT).
const HIGHLIGHT_DESC: Record<string, string> = {
  pir: "연소득 대비 분양가 비율. 낮을수록 부담 적음",
  psr: "주변 시세 대비 분양가 비율. 1 미만이면 저평가",
  unsoldRate: "총 세대 중 미분양 비율. 낮을수록 인기",
  dataReliability: "핵심 데이터 수집 완성도",
};

// 점수 박스 1개 (강조 필드용)
// closure 의존 함수 dataValueColor를 props로 받아 색상 계산
export const HighlightField = memo(function HighlightField({ field, apt, dataValueColor }: HighlightFieldProps) {
  const meta = (FIELD_META as Record<string, { label: string; fmt?: (_v: unknown) => unknown }>)[field];
  if (!meta) return null;
  const val = apt[field];
  const desc = HIGHLIGHT_DESC[field];
  const color = dataValueColor(field, val);
  return (
    <div
      style={{
        flex: "1 1 calc(50% - 4px)",
        minWidth: 100,
        background: C.slate100,
        borderRadius: 8,
        padding: "8px 10px",
      }}
    >
      <div style={{ fontSize: F.micro, color: C.muted, marginBottom: 2 }}>{meta.label}</div>
      {desc && <div style={{ fontSize: F.micro, color: C.muted, marginBottom: 2 }}>{desc}</div>}
      <div style={{ fontSize: F.base, fontWeight: 800, color }}>{String(meta.fmt ? meta.fmt(val) : (val ?? ""))}</div>
      {field === "dataReliability" && val != null && <Bar value={Number(val)} color={color} h={4} />}
    </div>
  );
});
