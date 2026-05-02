// 분양예정 카드 리스트 — 시각 요소 7개 (이미지 + 단계배지 + 단지명 + 한 줄 정보 + 점수 + 알림 + 상세)
// spec § 4-3 + § 6-2 (D-day) + § 6-6 (4색 배지)

import { memo, useMemo } from "react";
import { C, F } from "@/theme";
import { fmtPrice, fmtRecruitDate } from "@/lib/format";
import { Tooltip, extractTerm } from "./Tooltip";
import { buildGoogleCalendarUrl } from "@/lib/googleCalendar";

const STAGE_STYLES = {
  분양계획: { bg: C.greenLight, color: C.green, label: "분양 예정" },
  청약중: { bg: C.amberLight, color: C.amber, label: "청약중" },
  분양중: { bg: C.blueLight, color: C.blue, label: "분양중" },
};

const PLACEHOLDER_IMG = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 60 60'><rect width='60' height='60' fill='%23E8EAF0'/><text x='50%25' y='50%25' text-anchor='middle' dy='.3em' fill='%236B7280' font-size='10'>🏢</text></svg>";

const chipStyle = {
  fontSize: F.xs,
  padding: "2px 6px",
  background: C.bg,
  color: C.muted,
  borderRadius: 4,
  border: `1px solid ${C.border}`,
};

/**
 * D-day 계산 — spec § 6-2
 * @returns {{label: string, color: string} | null}
 */
export function computeDday(recruitDate, today = new Date()) {
  if (!recruitDate || typeof recruitDate !== "string") return null;
  const d = new Date(recruitDate);
  if (isNaN(d.getTime())) return null;
  const diffMs = d.setHours(0, 0, 0, 0) - new Date(today).setHours(0, 0, 0, 0);
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (days < -7) return null; // 1주 이상 지난 단지는 D-day 표시 X
  if (days < 0) return { label: `D+${Math.abs(days)}`, color: C.muted };
  if (days === 0) return { label: "오늘 청약", color: C.red };
  if (days <= 3) return { label: `D-${days}`, color: C.amber };
  if (days <= 7) return { label: `D-${days}`, color: C.text };
  return { label: `D-${days}`, color: C.muted };
}

export const UpcomingCardList = memo(function UpcomingCardList({ items, onSubscribe, onOpenDetail, isMobile }) {
  if (!items || items.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: "center", color: C.muted, fontSize: F.base }}>
        현재 분양 임박 단지가 없습니다.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {items.map(apt => (
        <UpcomingCard
          key={apt.id}
          apt={apt}
          onSubscribe={onSubscribe}
          onOpenDetail={onOpenDetail}
          isMobile={isMobile}
        />
      ))}
    </div>
  );
});

const UpcomingCard = memo(function UpcomingCard({ apt, onSubscribe, onOpenDetail, isMobile }) {
  const stage = STAGE_STYLES[apt.presaleStage] || STAGE_STYLES["분양중"];
  const dday = useMemo(() => computeDday(apt.presaleRecruitDate), [apt.presaleRecruitDate]);
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
          <span
            style={{ fontSize: F.xs, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: stage.bg, color: stage.color }}
            aria-label={`분양단계 ${stage.label}`}
          >
            {stage.label}
          </span>
          <span style={{ fontSize: F.base, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {apt.name}
          </span>
        </div>
        <div style={{ fontSize: F.xs, color: C.muted, lineHeight: 1.5 }}>
          {apt.presaleRecruitDate ? `${fmtRecruitDate(apt.presaleRecruitDate)} · ` : ""}
          {apt.region} {apt.gu || ""} ·{" "}
          {apt.presaleMinPrice ? fmtPrice(apt.presaleMinPrice) : "분양가 미공개"}
        </div>
        {(apt.presaleHousingType || apt.presaleType) && (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
            {apt.presaleHousingType && (
              <Tooltip term={extractTerm(apt.presaleHousingType)}>
                <span style={chipStyle}>{apt.presaleHousingType}</span>
              </Tooltip>
            )}
            {apt.presaleType && apt.presaleType !== apt.presaleHousingType && (
              <Tooltip term={extractTerm(apt.presaleType)}>
                <span style={chipStyle}>{apt.presaleType}</span>
              </Tooltip>
            )}
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
          {score != null && (
            <span style={{ fontSize: F.xs, color: C.green }}>
              ★ 점수 {score.toFixed(1)}
            </span>
          )}
          {isMobile && calendarUrl && (
            <a
              href={calendarUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              aria-label="구글 캘린더에 청약 일정 추가"
              style={{
                fontSize: F.xs, color: C.blue, textDecoration: "underline",
                minHeight: 24,
              }}
            >📅 캘린더 추가</a>
          )}
        </div>
      </div>

      {!isMobile && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onSubscribe?.(apt.id); }}
            style={{
              fontSize: F.xs, fontWeight: 700, padding: "6px 10px",
              background: C.red, color: "white", border: "none", borderRadius: 4,
              cursor: "pointer", minHeight: 44, minWidth: 44,
            }}
            aria-label="알림 신청"
          >🔔 알림</button>
          {calendarUrl && (
            <a
              href={calendarUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              aria-label="구글 캘린더에 청약 일정 추가"
              style={{
                fontSize: F.xs, padding: "6px 10px",
                background: C.card, color: C.text,
                border: `1px solid ${C.border}`, borderRadius: 4,
                minHeight: 44, minWidth: 44,
                textDecoration: "none", textAlign: "center",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >📅 캘린더</a>
          )}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpenDetail?.(apt.id); }}
            style={{
              fontSize: F.xs, padding: "6px 10px",
              background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 4,
              cursor: "pointer", minHeight: 44, minWidth: 44,
            }}
            aria-label="단지 상세"
          >상세</button>
        </div>
      )}
    </div>
  );
});
