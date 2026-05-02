// 분양예정 캘린더 — react-day-picker v9 wrapper
// spec § 4-2 + § 6-1 (4색 점) + § 6-2 (D-day)

import { memo, useMemo } from "react";
import { DayPicker } from "react-day-picker";
import { ko } from "date-fns/locale";
import "react-day-picker/style.css";
import { C, F } from "@/theme";

const EVENT_COLORS = {
  apply_start: { bg: C.greenLight, color: C.green, label: "청약 시작" },
  apply_end: { bg: C.amberLight, color: C.amber, label: "청약 마감" },
  winner_announce: { bg: C.blueLight, color: C.blue, label: "당첨 발표" },
  etc: { bg: C.slate100, color: C.slate600, label: "기타" },
};

export const UpcomingCalendar = memo(function UpcomingCalendar({ calendar, selectedDate, onDayClick }) {
  // calendar = { "2026-05-08": [{ id, event }], ... }
  const modifiers = useMemo(() => {
    const m = { applyStart: [], applyEnd: [], winnerAnnounce: [] };
    if (!calendar || typeof calendar !== "object") return m;
    for (const [iso, events] of Object.entries(calendar)) {
      const d = new Date(iso);
      if (isNaN(d.getTime())) continue;
      const eventTypes = new Set(events.map(e => e.event));
      if (eventTypes.has("apply_start")) m.applyStart.push(d);
      if (eventTypes.has("apply_end")) m.applyEnd.push(d);
      if (eventTypes.has("winner_announce")) m.winnerAnnounce.push(d);
    }
    return m;
  }, [calendar]);

  const modifiersStyles = useMemo(() => ({
    applyStart: { background: EVENT_COLORS.apply_start.bg, color: EVENT_COLORS.apply_start.color, fontWeight: 700 },
    applyEnd: { background: EVENT_COLORS.apply_end.bg, color: EVENT_COLORS.apply_end.color, fontWeight: 700 },
    winnerAnnounce: { background: EVENT_COLORS.winner_announce.bg, color: EVENT_COLORS.winner_announce.color, fontWeight: 700 },
  }), []);

  const selected = selectedDate ? new Date(selectedDate) : undefined;

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
      <div style={{ fontSize: F.md, fontWeight: 700, marginBottom: 8, color: C.text }}>
        📅 청약 캘린더
      </div>
      <DayPicker
        mode="single"
        locale={ko}
        numberOfMonths={1}
        selected={selected}
        onDayClick={onDayClick}
        modifiers={modifiers}
        modifiersStyles={modifiersStyles}
      />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8, fontSize: F.xs, color: C.muted }}>
        <Legend color={EVENT_COLORS.apply_start} />
        <Legend color={EVENT_COLORS.apply_end} />
        <Legend color={EVENT_COLORS.winner_announce} />
      </div>
    </div>
  );
});

function Legend({ color }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: color.color, display: "inline-block" }} aria-hidden="true" />
      {color.label}
    </span>
  );
}
