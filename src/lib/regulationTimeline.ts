import {
  isMetroRegion,
  METRO_LOAN_CAP,
  METRO_LOAN_CAP_SINCE,
  NORMAL_LTV,
  REGULATED_LTV_CAPS,
  REGULATED_LTV_RATE,
  type Zone,
} from "@/constants/regulations";
import {
  dayAfter,
  GRANDFATHER_RULES,
  grandfatherRule,
  isNonHousing,
  isPreSubscription,
  kstYearMonth,
  METRO_CAP_CUTOFF,
  moveInStarted,
  normalizeIsoDate,
  normalizeYearMonth,
  shortSido,
  STRESS_RATE_LOCAL,
  STRESS_RATE_LOCAL_UNTIL,
} from "@/constants/loanRules";
import { todayKst } from "@/lib/format";

/**
 * 금융 탭 「지역 대출 규칙」 상자의 단지 규제 시간표(A-26 B · 세션705 👤 결정 「안 1」).
 * 이 단지에 일어났거나 일어날 일(첫 입주자모집공고·입주)과 정부 규칙이 바뀐 날을 날짜순으로 늘어놓고 맨 위 결론 한 줄을 만든다.
 * 날짜는 손으로 적지 않는다 — 전부 기존 상수(경과규정 표·수도권 한도 시행일·지방 스트레스 유예 끝)와 오늘(KST)에서 읽는다.
 * 금액·점수 계산은 하지 않는다 — 큰 숫자는 지금 규정이고 종전은 「될 수 있어요」로만(세션659 결정 18).
 */

export type TimelineEventKind =
  "notice" | "notice-missing" | "metro-cap" | "designation" | "today" | "stress-until" | "move-in";
export type TimelineEvent = {
  date: string | null;
  kind: TimelineEventKind;
  title: string;
  note?: string;
  mine: boolean;
  future: boolean;
};
export type TimelineVerdictKind =
  "grandfather-may" | "current-only" | "notice-missing" | "local-stress" | "local-stress-ended" | "metro-free";
export type RegulationTimeline = {
  verdict: { kind: TimelineVerdictKind; text: string };
  events: TimelineEvent[];
  /** 수도권 6억 한도 시행 전(`METRO_CAP_CUTOFF` 까지) 공고 · 제외 아님 → 결론·「수도권 6억 시행」 사건에 「6억 한도 없이」 문장이 나왔나(바닥 출처 줄이 읽는다) */
  metroCapWaived: boolean;
};

/** 'YYYY-MM-DD' → 'M/D' */
function slashDay(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${m}/${d}`;
}

/** 'YYYY-MM-DD' → 'M월 D일' */
function monthDay(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${m}월 ${d}일`;
}

export function buildRegulationTimeline(input: {
  zone: Zone;
  region?: string | null;
  gu?: string | null;
  /** 첫 입주자모집공고(earliestIsoDate 를 거친 값) */
  firstDate?: string | null;
  /** 최근 입주자모집공고(latestIsoDate 를 거친 값) */
  latestDate?: string | null;
  /** 입주월 후보 — [apt.presaleMoveIn, schedule?.move_in_ym] */
  moveIns: readonly unknown[];
  housingType?: string | null;
  name?: string | null;
  /** 시험 고정용 · 기본 new Date() */
  now?: Date;
}): RegulationTimeline {
  const now = input.now ?? new Date();
  const today = todayKst(now);
  const thisMonth = kstYearMonth(now);
  const regulated = input.zone !== "normal";
  const metro = isMetroRegion(shortSido(input.region));
  const rule = grandfatherRule(input.zone, input.region, input.gu);
  const first = normalizeIsoDate(input.firstDate);
  const latest = normalizeIsoDate(input.latestDate);
  const ltv = Math.round(REGULATED_LTV_RATE * 100);
  const cap = METRO_LOAN_CAP / 10000;

  // 종전 대상 제외 — 잔금 카드(FundingPlanner 종전 줄 숨김)와 같은 둘
  const excludedReason = isNonHousing(input.housingType, input.name)
    ? "비주택 담보"
    : isPreSubscription(input.name)
      ? "사전청약 단지"
      : null;
  // 입주가 시작된 단지는 빼지 않는다 — 입주 뒤 계약 세대 해당 여부는 원문에 없음(2025~2026 원문은 사업장 단위 ·
  // 2020-07-02 해명은 세대 단위) → 종전 판정은 보이고 금융사 확인 꼬리 · 질의서 질의 9 ⑥ 회신 대기(세션709 👤 결정 ⑪ · 잔금 카드와 같은 문구)
  const moveInTail = moveInStarted(input.moveIns, thisMonth)
    ? " · 입주가 시작된 뒤 계약하는 세대도 해당되는지는 금융위 자료에 없어 금융사 확인이 꼭 필요해요"
    : "";
  const beforeCutoff = rule != null && first != null && first <= rule.cutoff;
  // 수도권 6억 한도 시행 전 공고 — 종전 규정이면 6억 한도도 없다(금융위 2026-10-15 보도자료 경과규정 · 세션706).
  // 규제지역인데 규칙이 없으면(서울 구 모름) 종전 여부를 못 가리니 말하지 않는다.
  const metroCapWaived =
    metro && first != null && first <= METRO_CAP_CUTOFF && excludedReason == null && (!regulated || rule != null);
  // 잔금 카드 종전 줄과 같은 꼴(해까지 · 세션706 보완 R4)
  const capFreeTail = `${METRO_CAP_CUTOFF}까지 공고라 ${cap}억 한도 없이`;
  // 수도권 시가별 한도 — 「15억 초과 4억·25억 초과 2억」(상수에서 싼 구간부터 · 세션706 보완 R3)
  const tierText = [...REGULATED_LTV_CAPS]
    .reverse()
    .map((c) => `${c.overPrice / 10000}억 초과 ${c.cap / 10000}억`)
    .join("·");

  // ── 결론 ──
  let verdict: RegulationTimeline["verdict"];
  if (regulated) {
    if (excludedReason != null) {
      // 제외 대상은 공고일과 상관없이 답이 정해진다 — 공고일이 없어도 먼저(세션705 메인 판정 2)
      verdict = { kind: "current-only", text: `${excludedReason}라 지금 규정(LTV ${ltv}%)이 그대로예요` };
    } else if (first == null || rule == null) {
      // rule 이 없으면(서울인데 구를 모름 — 11-08 실측 0곳) 기준일을 못 가려 공고문 확인으로 둔다
      verdict = {
        kind: "notice-missing",
        text: "첫 공고일을 아직 못 모아 종전 규정 해당 여부는 공고문으로 확인하세요",
      };
    } else if (beforeCutoff) {
      verdict = {
        kind: "grandfather-may",
        text:
          `첫 공고가 지정보다 앞서요 → 집단대출은 종전 ${Math.round(rule.rate * 100)}% 가 될 수 있어요(금융사 심사)` +
          (metroCapWaived ? ` · ${capFreeTail}` : "") +
          moveInTail,
      };
    } else {
      // 첫 공고일이 오늘보다 뒤(아직 공고 전)면 과거형을 쓰지 않는다(세션705 보완 7-5)
      verdict =
        first > today
          ? { kind: "current-only", text: `지정 뒤 공고라 지금 규정(LTV ${ltv}%)이 적용돼요` }
          : { kind: "current-only", text: `지정 뒤에 공고한 단지라 지금 규정(LTV ${ltv}%)이 그대로예요` };
    }
  } else if (metro) {
    verdict = {
      kind: "metro-free",
      text: metroCapWaived
        ? `비규제라 LTV ${Math.round(NORMAL_LTV * 100)}% 예요 · ${capFreeTail} 종전 규정이 될 수 있어요(금융사 심사)${moveInTail}`
        : `비규제라 LTV ${Math.round(NORMAL_LTV * 100)}% 예요 · 수도권은 집값에 따라 최대 ${cap}억(${tierText})`,
    };
  } else if (today <= STRESS_RATE_LOCAL_UNTIL) {
    verdict = {
      kind: "local-stress",
      text: `${monthDay(STRESS_RATE_LOCAL_UNTIL)}까지는 지방 스트레스 가산이 낮아요 · 그 뒤는 미정`,
    };
  } else {
    verdict = {
      kind: "local-stress-ended",
      text: `지방 스트레스 가산 유예(${monthDay(STRESS_RATE_LOCAL_UNTIL)})가 끝났어요 · 새 가산은 금융사에서 확인하세요`,
    };
  }

  // ── 사건 ──
  const events: TimelineEvent[] = [];
  const dated = (date: string, e: Omit<TimelineEvent, "date" | "future">): TimelineEvent => ({
    ...e,
    date,
    future: date > today,
  });

  if (first != null) {
    let note: string | undefined;
    if (regulated && rule != null) {
      note = beforeCutoff ? "규제지역이 되기 전에 공고했어요" : "지정 뒤라 종전 규정 대상이 아니에요";
    }
    if (latest != null && latest !== first) {
      note = note ? `${note} (최근 공고 ${latest})` : `(최근 공고 ${latest})`;
    }
    events.push(dated(first, { kind: "notice", title: "이 단지 첫 입주자모집공고", note, mine: true }));
  }
  if (metro) {
    events.push(
      dated(METRO_LOAN_CAP_SINCE, {
        kind: "metro-cap",
        title: `수도권 주택구입 대출 최대 ${cap}억 시행`,
        note: metroCapWaived
          ? `이 단지는 그 전에 공고 → ${cap}억 한도 없이 종전 규정이 될 수 있어요(금융사 심사)` +
            // 6/27 보도자료 각주 「잔금대출로 전환시에는 6억원 한도 적용」 — 2026-10-15 보도자료와 엇갈린다(세션709 C2)
            ` · 다만 ${slashDay(METRO_CAP_CUTOFF)} 첫 발표 자료는 잔금 전환 때 ${cap}억 한도라고 적어 금융위 자료끼리 말이 달라요(금융사 확인)`
          : // 6·27 당시엔 집값과 상관없이 6억이었지만 10·15(시행 10-16)부터 시가별 — 결론 줄과 같은 tierText(세션706 재검사 🟠)
            `최대 ${cap}억 (서울·경기·인천) · ${dayAfter(GRANDFATHER_RULES.default.cutoff)}부터 ${tierText}`,
        mine: false,
      })
    );
  }
  if (regulated && rule != null) {
    events.push(
      dated(dayAfter(rule.cutoff), {
        kind: "designation",
        // 꼬리(그림 원문) — 4구(LTV 강화)는 없음 · 기본(10·15) 은 서울 전역·경기 12곳 · 그 밖(2026 추가 지정)은 경기 3곳(보완 7-4)
        title: rule.isLtvTightening
          ? `${rule.eventLabel} 효력`
          : rule.cutoff === GRANDFATHER_RULES.default.cutoff
            ? `${rule.eventLabel} 효력 (서울 전역·경기 12곳)`
            : `${rule.eventLabel} 효력 (화성 동탄·용인 기흥·구리)`,
        note: rule.isLtvTightening
          ? `이날부터 LTV ${ltv}% · 전날까지 공고한 사업장은 종전 ${Math.round(rule.rate * 100)}% 가 될 수 있어요`
          : `이날부터 LTV ${ltv}% · 전날까지 공고한 사업장은 종전 규정이 될 수 있어요`,
        mine: false,
      })
    );
  }
  if (regulated && first == null) {
    // 날짜 없음 — 정렬에서 「오늘」 바로 앞에 놓인다(아래 정렬 키)
    events.push({
      date: null,
      kind: "notice-missing",
      title: "이 단지 첫 입주자모집공고 · 아직 못 모았어요",
      mine: true,
      future: false,
    });
  }
  events.push({ date: today, kind: "today", title: "오늘", mine: false, future: false });
  if (!regulated && !metro) {
    events.push(
      dated(STRESS_RATE_LOCAL_UNTIL, {
        kind: "stress-until",
        title: `지방 주담대 스트레스 가산 ${STRESS_RATE_LOCAL}%p 유예 끝`,
        note: "그 뒤 가산은 6월·12월에 다시 정해져요 · 오르면 소득 기준(DSR) 한도가 줄어요",
        mine: false,
      })
    );
  }
  let moveIn: string | null = null;
  for (const v of input.moveIns) {
    const ym = normalizeYearMonth(v);
    if (ym != null && (moveIn == null || ym < moveIn)) moveIn = ym;
  }
  if (moveIn != null) {
    // 이번 달 입주 사건은 「입주 예정」 · 정렬도 「오늘」 뒤(보완 7-1) — 결론 꼬리의 moveInStarted 는 세션711 부터 이번 달 포함(👤 결정 ② = 꼬리만 · 제목을 그대로 둔 것은 메인 판단 — 바꿀지는 BACKLOG A-26)
    const future = moveIn >= thisMonth;
    events.push({
      date: moveIn,
      kind: "move-in",
      title: future ? "이 단지 입주 예정" : "이 단지 입주 시작",
      note: regulated ? "잔금대출은 분양가가 아니라 입주 때 시세·감정가 기준이에요" : undefined,
      mine: true,
      future,
    });
  }

  // 날짜 오름차순(안정 정렬 — 같은 날은 넣은 순서) · 날짜 null 은 오늘 날짜로 보고 「오늘」 앞에 넣었으니 그 바로 앞에 선다.
  // 이번 달 입주('YYYY-MM' 이라 글자로는 오늘 'YYYY-MM-DD' 보다 앞)도 오늘 날짜로 보고 「오늘」 뒤에 넣었으니 그 바로 뒤에 선다.
  const sortKey = (e: TimelineEvent): string =>
    e.date == null || (e.kind === "move-in" && e.date === thisMonth) ? today : e.date;
  events.sort((a, b) => {
    const ka = sortKey(a);
    const kb = sortKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return { verdict, events, metroCapWaived };
}
