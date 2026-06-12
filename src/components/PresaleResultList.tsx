import { memo, useState } from "react";
import { C, F } from "@/theme";
import { fmtPrice, fmtCompetitionRate } from "@/lib/format";
import type { ScoredApt } from "@/types/hooks";

type PresaleResultListProps = {
  items: ScoredApt[];
  onOpenDetail?: (_id: string) => void;
};

const PAGE = 30;

// 경쟁률 <1 은 공유 fmt(toFixed(1))가 "0.0:1" 로 뭉개므로 로컬 2자리 (호갱노노 "0.01 : 1" 답습).
// 공유 fmtCompetitionRate 는 무변경 — 기존 소비처(DataSections) 회귀 0.
function fmtRate(v: number): string {
  if (v >= 0 && v < 1) return `${v.toFixed(2)}:1`;
  return fmtCompetitionRate(v);
}

/**
 * 분양결과 리스트 — 청약홈 잔여세대 경쟁률 기준 (호갱노노 분양결과 탭 답습).
 * ⚠️ "1순위 경쟁률" 표기 금지 — 데이터 출처 = 잔여세대(무순위) 경쟁률 가중평균
 * (collect-applyhome.mjs, 적대검증 wf_20aec4dc 거짓 표시 적발).
 */
export const PresaleResultList = memo(function PresaleResultList({ items, onOpenDetail }: PresaleResultListProps) {
  const [visibleCount, setVisibleCount] = useState(PAGE);

  if (items.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: "center", color: C.muted, fontSize: F.base }}>
        해당 지역 분양 결과가 없습니다.
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: F.micro, color: C.muted, marginBottom: 6 }}>청약홈 잔여세대 경쟁률 기준 · 경쟁률 높은 순</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {items.slice(0, visibleCount).map(({ apt }) => {
          const rate = Number(apt.competitionRate);
          const isShort = rate >= 0 && rate < 1; // 미달 = 신청 < 공급 (음수면 fmt 가 자체 "미달 N%" 출력)
          const supply = apt.competitionSupply;
          const applicants = apt.competitionApplicants;
          return (
            <div
              key={apt.id}
              role="button"
              tabIndex={0}
              aria-label={`${apt.name} 분양 결과 보기`}
              onClick={() => onOpenDetail?.(apt.id ?? "")}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpenDetail?.(apt.id ?? "");
                }
              }}
              style={{ padding: "10px 12px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, cursor: "pointer", minHeight: 44 }}
            >
              <div style={{ fontSize: F.base, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {apt.name}
              </div>
              <div style={{ fontSize: F.xs, color: C.muted, marginTop: 2 }}>
                {apt.region} {apt.gu || ""} · 전용 {apt.area != null ? Number(apt.area).toFixed(1) : "-"}㎡ · 분양가 {fmtPrice(apt.price)}
              </div>
              <div style={{ fontSize: F.sm, fontWeight: 700, color: C.indigo, marginTop: 4 }}>
                {isShort ? <span style={{ color: C.red }}>미달 | </span> : null}
                청약 경쟁률 {fmtRate(rate)}
                {supply != null && applicants != null && (
                  <span style={{ fontSize: F.xs, fontWeight: 400, color: C.muted }}> · 공급 {Number(supply).toLocaleString()}세대 · 신청 {Number(applicants).toLocaleString()}명</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {visibleCount < items.length && (
        <div style={{ textAlign: "center", padding: "12px 0" }}>
          <button
            type="button"
            onClick={() => setVisibleCount(v => v + PAGE)}
            style={{ padding: "10px 32px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.card, color: C.text, fontSize: F.base, fontWeight: 600, cursor: "pointer", minHeight: 44 }}
          >
            더 보기 ({items.length - visibleCount}개 남음)
          </button>
        </div>
      )}
    </div>
  );
});
