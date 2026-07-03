// 분양예정 카드 리스트 — 시각 요소 7개 (이미지 + 단계배지 + 단지명 + 한 줄 정보 + 점수 + 알림 + 상세)
// spec § 4-3 + § 6-2 (D-day) + § 6-6 (4색 배지)

import { memo, useMemo } from "react";
import type { CSSProperties } from "react";
import { C, F } from "@/theme";
import { fmtPrice, fmtRecruitDate } from "@/lib/format";
import { Tooltip, extractTerm } from "./Tooltip";
import { buildGoogleCalendarUrl } from "@/lib/googleCalendar";
import { groupUpcoming, isMonthOnly } from "@/lib/upcomingGroups";
import type { UpcomingCardListProps, UpcomingCardProps } from "@/types/components/UpcomingCardList.types";

interface StageStyle {
  bg: string;
  color: string;
  label: string;
}

const STAGE_STYLES: Record<string, StageStyle> = {
  분양계획: { bg: C.greenLight, color: C.green, label: "분양 예정" },
  청약중: { bg: C.amberLight, color: C.amber, label: "청약중" },
  분양중: { bg: C.blueLight, color: C.blue, label: "분양중" },
};

const PLACEHOLDER_IMG =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 60 60'><rect width='60' height='60' fill='%23E8EAF0'/><text x='50%25' y='50%25' text-anchor='middle' dy='.3em' fill='%236B7280' font-size='10'>🏢</text></svg>";

const chipStyle: CSSProperties = {
  fontSize: F.xs,
  padding: "2px 6px",
  background: C.bg,
  color: C.muted,
  borderRadius: 4,
  border: `1px solid ${C.border}`,
};

// 테스트 하위호환용 re-export — 신규 소비처는 @/lib/dday 에서 직접 import (lazy 청크 보호)
import { computeDday } from "@/lib/dday";
export { computeDday };

const groupHeaderStyle: CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 1,
  background: C.bg,
  fontSize: F.sm,
  fontWeight: 800,
  color: C.text,
  padding: "8px 4px 6px",
  borderBottom: `1px solid ${C.border}`,
  marginTop: 4,
};

export const UpcomingCardList = memo(function UpcomingCardList({
  items,
  onSubscribe,
  onOpenDetail,
  isMobile,
}: UpcomingCardListProps) {
  // 시간축 그룹 (세션 469): "🔥 청약 임박" → "📆 N월 예정" → "📋 일정 미정".
  // 큰 월 그리드 대신 임박 순 아젠다 (벤치마킹 확정안). 카드 자체는 UpcomingCard 재활용.
  const groups = useMemo(() => groupUpcoming(items ?? []), [items]);

  if (!items || items.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: "center", color: C.muted, fontSize: F.base }}>
        현재 분양 임박 단지가 없습니다.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {groups.map((group) => (
        <div key={group.key}>
          <div style={groupHeaderStyle}>
            {group.label} <span style={{ color: C.muted, fontWeight: 600 }}>{group.items.length}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
            {group.items.map((apt) => (
              <UpcomingCard
                key={apt.id}
                apt={apt}
                onSubscribe={onSubscribe}
                onOpenDetail={onOpenDetail}
                isMobile={isMobile}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
});

const UpcomingCard = memo(function UpcomingCard({ apt, onSubscribe, onOpenDetail, isMobile }: UpcomingCardProps) {
  const stage = STAGE_STYLES[String(apt.presaleStage ?? "")] || STAGE_STYLES["분양중"];
  // 월-only(YYYY-MM) 는 D-day 를 계산하면 1일로 강제되어 거짓 정밀도 — "N월 예정" 칩으로 대체(세션 469).
  const monthOnly = isMonthOnly(apt.presaleRecruitDate);
  const dday = useMemo(
    () => (monthOnly ? null : computeDday(apt.presaleRecruitDate)),
    [monthOnly, apt.presaleRecruitDate]
  );
  const monthChip = useMemo(() => {
    if (!monthOnly) return null;
    const m = String(apt.presaleRecruitDate)
      .replace(/\./g, "-")
      .match(/^\d{4}-(\d{2})/);
    return m ? `${Number(m[1])}월 예정` : null;
  }, [monthOnly, apt.presaleRecruitDate]);
  const score = apt.catsCache?.total;
  const calendarUrl = useMemo(() => buildGoogleCalendarUrl(apt), [apt]);

  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        padding: 10,
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        cursor: "pointer",
      }}
      tabIndex={0}
      role="button"
      aria-label={`${apt.name} 분양 정보 보기`}
      onClick={() => onOpenDetail?.(apt.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenDetail?.(apt.id);
        }
      }}
    >
      {/* 부모 div 의 aria-label 이 단지명을 안내하므로 의도적으로 빈 alt (장식 이미지) */}
      <img
        src={apt.presaleImageUrl || PLACEHOLDER_IMG}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        style={{ width: 60, height: 60, borderRadius: 6, objectFit: "cover", flexShrink: 0, background: C.bg }}
      />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
          {dday && (
            <span
              style={{
                fontSize: F.md,
                fontWeight: 900,
                color: dday.color,
                letterSpacing: "-0.02em",
                lineHeight: 1.1,
                marginRight: 2,
              }}
              aria-label={`디데이 ${dday.label}`}
            >
              {dday.label}
            </span>
          )}
          {monthChip && (
            <span
              style={{
                fontSize: F.xs,
                fontWeight: 800,
                color: C.indigo,
                background: C.indigoLight,
                padding: "2px 6px",
                borderRadius: 4,
                marginRight: 2,
              }}
              aria-label={`분양 일정 ${monthChip}`}
            >
              {monthChip}
            </span>
          )}
          <span
            style={{
              fontSize: F.xs,
              fontWeight: 700,
              padding: "2px 6px",
              borderRadius: 4,
              background: stage.bg,
              color: stage.color,
            }}
            aria-label={`분양단계 ${stage.label}`}
          >
            {stage.label}
          </span>
          <span
            style={{
              fontSize: F.base,
              fontWeight: 700,
              color: C.text,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {apt.name}
          </span>
        </div>
        {/* 주소·모집일·분양가·유형칩을 한 줄에 가로로 흘림 (세션 470 — 손실 없이 가로폭 활용해 세로 축소).
            좁으면 flexWrap 으로 자연 줄바꿈. 월-only 는 상단 "N월 예정" 칩이 안내하므로 거짓 일자 생략. */}
        <div
          style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontSize: F.xs, lineHeight: 1.5 }}
        >
          <span style={{ color: C.muted }}>
            {apt.region} {apt.gu || ""}
          </span>
          {apt.presaleRecruitDate && !monthOnly && (
            <span style={{ color: C.indigo, fontWeight: 700 }}>{fmtRecruitDate(apt.presaleRecruitDate)} 모집</span>
          )}
          {apt.presaleMinPrice ? (
            <span style={{ color: C.text, fontWeight: 700 }}>{fmtPrice(apt.presaleMinPrice)}</span>
          ) : (
            <span style={{ color: C.muted }}>분양가 미공개</span>
          )}
          {apt.presaleHousingType && (
            <Tooltip term={extractTerm(apt.presaleHousingType) ?? undefined}>
              <span style={chipStyle}>{apt.presaleHousingType}</span>
            </Tooltip>
          )}
          {apt.presaleType && apt.presaleType !== apt.presaleHousingType && (
            <Tooltip term={extractTerm(apt.presaleType) ?? undefined}>
              <span style={chipStyle}>{apt.presaleType}</span>
            </Tooltip>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
          {score != null && <span style={{ fontSize: F.xs, color: C.green }}>★ 점수 {score.toFixed(1)}</span>}
          {isMobile && calendarUrl && (
            <a
              href={calendarUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              aria-label="구글 캘린더에 청약 일정 추가"
              style={{
                fontSize: F.xs,
                color: C.blue,
                textDecoration: "underline",
                minHeight: 24,
              }}
            >
              📅 캘린더 추가
            </a>
          )}
        </div>
      </div>

      {!isMobile && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSubscribe?.(apt.id);
            }}
            style={{
              fontSize: F.xs,
              fontWeight: 700,
              padding: "6px 10px",
              background: C.red,
              color: "white",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
              minHeight: 44,
              minWidth: 44,
            }}
            aria-label="알림 신청"
          >
            🔔 알림
          </button>
          {calendarUrl && (
            <a
              href={calendarUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              aria-label="구글 캘린더에 청약 일정 추가"
              style={{
                fontSize: F.xs,
                padding: "6px 10px",
                background: C.card,
                color: C.text,
                border: `1px solid ${C.border}`,
                borderRadius: 4,
                minHeight: 44,
                minWidth: 44,
                textDecoration: "none",
                textAlign: "center",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              📅 캘린더
            </a>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenDetail?.(apt.id);
            }}
            style={{
              fontSize: F.xs,
              padding: "6px 10px",
              background: C.card,
              color: C.text,
              border: `1px solid ${C.border}`,
              borderRadius: 4,
              cursor: "pointer",
              minHeight: 44,
              minWidth: 44,
            }}
            aria-label="단지 상세"
          >
            상세
          </button>
        </div>
      )}
    </div>
  );
});
