import { memo, useMemo } from "react";
import { C, F } from "@/theme";
import { computeDday } from "@/lib/dday";
import { SkeletonBox } from "@/components/primitives";
import { WidgetCard } from "./WidgetCard";
import type { UpcomingApiResponse, UpcomingApt } from "@/types/upcoming";

type UpcomingWidgetProps = {
  data: UpcomingApiResponse | null;
  error: boolean;
  onRetry: () => void;
  onExpand: () => void;
};

function localTodayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 곧분양 위젯 — 이번 주 일정 N건 + 임박 3건. 행 클릭 = /upcoming 펼치기 (상세 직진입 없음) */
export const UpcomingWidget = memo(function UpcomingWidget({ data, error, onRetry, onExpand }: UpcomingWidgetProps) {
  const todayIso = localTodayIso();

  const thisWeekCount = useMemo(() => {
    if (!data?.calendar) return 0;
    const start = new Date(todayIso);
    const end = new Date(start); end.setDate(end.getDate() + 7);
    return Object.entries(data.calendar).reduce((sum, [date, evts]) => {
      const d = new Date(date);
      return d >= start && d < end ? sum + evts.length : sum;
    }, 0);
  }, [data, todayIso]);

  // presaleRecruitDate 는 YYYY-MM-DD/YYYY-MM/자유텍스트 혼재(네이버 raw) — Date 파싱으로만 비교
  // (YYYY-MM = 그 달 1일 해석: 기존 computeDday 와 동일 의미. 자유텍스트 = Invalid Date 제외)
  const imminent = useMemo<UpcomingApt[]>(() => {
    if (!data?.stages) return [];
    const startMs = new Date(todayIso).getTime();
    return [...data.stages.plan, ...data.stages.apply, ...data.stages.sale]
      .map(apt => ({ apt, t: apt.presaleRecruitDate ? new Date(apt.presaleRecruitDate).getTime() : NaN }))
      .filter(x => !isNaN(x.t) && x.t >= startMs)
      .sort((a, b) => a.t - b.t)
      .slice(0, 3)
      .map(x => x.apt);
  }, [data, todayIso]);

  return (
    <WidgetCard title="📅 곧 분양" onExpand={onExpand} expandLabel="전체 일정">
      {error ? (
        <div style={{ textAlign: "center", padding: "12px 0" }}>
          <div style={{ fontSize: F.sm, color: C.muted, marginBottom: 8 }}>곧 분양 정보를 불러오지 못했어요</div>
          <button onClick={onRetry} style={{ padding: "8px 20px", fontSize: F.sm, fontWeight: 700, background: C.blueLight, color: C.blue, border: "none", borderRadius: 6, cursor: "pointer", minHeight: 36 }}>재시도</button>
        </div>
      ) : !data ? (
        <SkeletonBox height={72} />
      ) : thisWeekCount === 0 && imminent.length === 0 ? (
        // 완전 빈상태 — "0건" + "없습니다" 2줄 겹침 제거, 단일 안내 한 줄
        <div style={{ textAlign: "center", padding: "16px 0" }}>
          <div style={{ fontSize: 24, marginBottom: 6 }} aria-hidden="true">🗓️</div>
          <div style={{ fontSize: F.sm, color: C.muted }}>예정된 청약 일정이 없습니다</div>
        </div>
      ) : (
        <>
          <div style={{ fontSize: F.sm, color: C.sub }}>이번 주 일정 {thisWeekCount}건</div>
          {imminent.length === 0 ? (
            <div style={{ fontSize: F.xs, color: C.muted, padding: "8px 0" }}>임박한 청약은 없어요</div>
          ) : (
            imminent.map(apt => {
              const dday = computeDday(apt.presaleRecruitDate);
              return (
                <button key={apt.id} onClick={onExpand} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", background: "transparent", border: "none", borderTop: `1px solid ${C.border}`, padding: "8px 2px", cursor: "pointer", textAlign: "left", minHeight: 40 }}>
                  {dday && <span style={{ fontSize: F.sm, fontWeight: 900, color: dday.color, flexShrink: 0 }}>{dday.label}</span>}
                  <span style={{ fontSize: F.sm, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{apt.name}</span>
                  <span style={{ fontSize: F.xs, color: C.muted, marginLeft: "auto", flexShrink: 0 }}>{apt.region ?? ""} · {String(apt.presaleStage ?? "")}</span>
                </button>
              );
            })
          )}
        </>
      )}
    </WidgetCard>
  );
});
