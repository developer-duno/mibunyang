import { memo, useEffect } from "react";
import { C, F } from "@/theme";
import { METRO_LOAN_CAP_SINCE, zoneOf } from "@/constants/regulations";
import {
  earliestIsoDate,
  GRANDFATHER_RULES,
  grandfatherRule,
  latestIsoDate,
  LOAN_RULES_BASIS,
} from "@/constants/loanRules";
import { buildRegulationTimeline, type TimelineEvent, type TimelineVerdictKind } from "@/lib/regulationTimeline";
import { trackEvent } from "@/lib/analytics";
import type { UnitChoice } from "@/hooks/useUnitChoice";
import type { Apt } from "@/types/scoring";

/**
 * 금융 탭 「지역 대출 규칙」 상자 안의 단지 규제 시간표(A-26 B · 세션705 👤 결정 「안 1」).
 * 맨 위 결론 칩 + 세로 시간표(파란 점 = 이 단지 날짜 · 회색 점 = 정부 규칙이 바뀐 날 · 속 빈 점 = 아직 안 온 날) + 바닥 근거 줄.
 * 계산은 `buildRegulationTimeline`(순수 함수) 한 곳 — 여기는 공고일·입주월을 잔금 카드(FundingPlanner)와 같은 식으로 모아 넘기고 그리기만 한다.
 */

/** 시간표 노출 계측은 단지마다 한 페이지 세션에 한 번(같은 단지 모달을 다시 열어도 1회) */
const viewedAptIds = new Set<unknown>();
/** 시험 격리용 */
export function _resetRegulationTimelineTracking(): void {
  viewedAptIds.clear();
}

const VERDICT_COLOR: Record<TimelineVerdictKind, { bg: string; fg: string }> = {
  "grandfather-may": { bg: C.amberLight, fg: C.amberText },
  "current-only": { bg: C.redLight, fg: C.red },
  "notice-missing": { bg: C.redLight, fg: C.red },
  "local-stress": { bg: C.greenLight, fg: C.green },
  "local-stress-ended": { bg: C.amberLight, fg: C.amberText }, // 유예가 끝난 뒤 초록은 어색(보완 7-6)
  "metro-free": { bg: C.greenLight, fg: C.green },
};

function Dot({ e }: { e: TimelineEvent }) {
  const isToday = e.kind === "today";
  const size = isToday ? 9 : 7;
  const color = isToday ? C.text : e.mine ? C.blue : C.muted;
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        boxSizing: "border-box",
        background: e.future ? C.white : color,
        border: e.future ? `1.5px solid ${color}` : "none",
        flexShrink: 0,
      }}
    />
  );
}

export const RegulationTimeline = memo(function RegulationTimeline({
  apt,
  unit,
  now,
}: {
  apt: Apt;
  unit: UnitChoice;
  now?: Date;
}) {
  const zone = zoneOf({
    isRegulated: apt.isRegulated as boolean | null | undefined,
    region: apt.region,
    gu: apt.gu,
  });
  // 잔금 카드(FundingPlanner)와 같은 식 — 첫·최근 공고일 · 입주월 후보
  const firstDate = earliestIsoDate(apt.presaleRecruitDate, unit.firstRecruitDate);
  const latestDate = latestIsoDate(apt.presaleRecruitDate, unit.schedule?.recruit_date, unit.firstRecruitDate);
  const { verdict, events, metroCapWaived } = buildRegulationTimeline({
    zone,
    region: apt.region as string | null | undefined,
    gu: apt.gu as string | null | undefined,
    firstDate,
    latestDate,
    moveIns: [apt.presaleMoveIn, unit.schedule?.move_in_ym],
    housingType: apt.presaleHousingType as string | null | undefined,
    name: apt.name as string | null | undefined,
    now,
  });

  useEffect(() => {
    // 평형표를 불러오는 동안은 첫 공고일이 비어 결론이 notice-missing 쪽으로 쏠린다 → 끝난 뒤 1회(보완 7-2)
    if (unit.pending) return;
    if (viewedAptIds.has(apt.id)) return;
    viewedAptIds.add(apt.id);
    trackEvent("regulation_timeline_view", { aptId: apt.id, zone, verdict: verdict.kind });
    // 마운트 1회 — 공고일이 늦게 채워져 결론이 바뀌어도 다시 재지 않는다(「봤다」만 센다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apt.id, unit.pending]);

  // 출처는 그 단지의 경과규정 규칙별로(보완 7-3) — 4구 = 9·7 · 기본 = 10·15 · 2026 추가 지정 = 그 기준일 FAQ(날짜는 rule.cutoff 에서)
  const rule = grandfatherRule(zone, apt.region as string | null | undefined, apt.gu as string | null | undefined);
  const regSource =
    rule == null || rule.cutoff === GRANDFATHER_RULES.default.cutoff
      ? "금융위 10·15 대책 FAQ"
      : rule.isLtvTightening
        ? "금융위 9·7 대책 FAQ"
        : `금융위 ${rule.cutoff} 추가 지정 FAQ`;
  const basis =
    (zone !== "normal"
      ? `${LOAN_RULES_BASIS} 기준 · ${regSource}` +
        (verdict.kind === "grandfather-may" ? " · 지정일 뒤 전매로 산 분양권은 종전 규정 제외" : "")
      : verdict.kind === "metro-free"
        ? `${LOAN_RULES_BASIS} 기준 · 금융위 가계부채 관리 강화 방안(${METRO_LOAN_CAP_SINCE} 시행)`
        : `${LOAN_RULES_BASIS} 기준 · 금융위원회공고 제2026-362호(3단계 스트레스 DSR)`) +
    // 「6억 한도 없이」 문장(결론·수도권 6억 사건)이 나온 단지만 — 그 경과규정의 출처(세션706)
    (metroCapWaived ? " · 경과규정 = 금융위 2026-10-15 가계부채 점검회의 보도자료" : "");
  const vc = VERDICT_COLOR[verdict.kind];

  return (
    <div style={{ marginBottom: 4 }}>
      <div
        data-testid="reg-verdict"
        data-kind={verdict.kind}
        style={{
          fontSize: F.xs,
          fontWeight: 700,
          background: vc.bg,
          color: vc.fg,
          borderRadius: 6,
          padding: "6px 8px",
          marginBottom: 8,
          lineHeight: 1.5,
        }}
      >
        {verdict.text}
      </div>
      <ol data-testid="reg-timeline" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {events.map((e, i) => {
          const isToday = e.kind === "today";
          const last = i === events.length - 1;
          return (
            <li
              key={`${e.kind}-${i}`}
              data-kind={e.kind}
              data-mine={e.mine ? "true" : "false"}
              data-future={e.future ? "true" : "false"}
              style={{ display: "flex", gap: 8 }}
            >
              {/* 점 + 다음 점까지 세로선 */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 9, paddingTop: 4 }}>
                <Dot e={e} />
                {!last && <span aria-hidden="true" style={{ flex: 1, width: 1, background: C.border, marginTop: 2 }} />}
              </div>
              <div style={{ paddingBottom: last ? 0 : 8, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: F.micro,
                    fontVariantNumeric: "tabular-nums",
                    color: e.mine ? C.blue : C.muted,
                    fontWeight: e.mine ? 700 : 400,
                  }}
                >
                  {e.date ?? "—"}
                </div>
                <div
                  style={{
                    fontSize: F.xs,
                    fontWeight: isToday ? 400 : 700,
                    color: isToday ? C.muted : C.text,
                    lineHeight: 1.4,
                  }}
                >
                  {e.title}
                </div>
                {e.note && <div style={{ fontSize: F.micro, color: C.muted, lineHeight: 1.5 }}>{e.note}</div>}
              </div>
            </li>
          );
        })}
      </ol>
      <div data-testid="reg-basis" style={{ fontSize: F.micro, color: C.muted, marginTop: 6 }}>
        {basis}
      </div>
    </div>
  );
});
