import {
  calcLTV,
  isMetroRegion,
  METRO_LOAN_CAP,
  NORMAL_LTV,
  REGULATED_LTV_CAPS,
  REGULATED_LTV_RATE,
  type Zone,
} from "./regulations";
import { geoSidoToDbName } from "./regionGeoMapping";

/**
 * 잔금 계획 계산기(금융 탭 `FundingPlanner`)가 쓰는 대출 규칙 숫자 — 세션659.
 * `regulations.ts`(LTV·지역 명단)와 같은 꼴: 이름 붙은 상수 + 근거 문서 주석. 수치가 바뀌면 여기 한 곳만.
 */

/** 화면에 적는 기준일 — 금융 탭의 "2026년 10월 기준" 글자는 전부 이 값에서 조립한다(한 곳만 바꾸면 된다). */
export const LOAN_RULES_BASIS = "2026년 10월";

/**
 * 은행권 DSR 한도 40% — 연소득 대비 모든 대출의 연 원리금 상환액 비율.
 * 2금융권(저축은행·여신전문·보험)은 50%(`DSR_LIMIT_NONBANK`) — 계산기는 은행 기준으로만 계산하고 2금융권은 안내 문장으로만 말한다.
 */
export const DSR_LIMIT_BANK = 0.4;

/**
 * 2금융권(저축은행·여신전문·보험) DSR 한도 50% — 정부 정책뉴스 2021-10-26 「가계부채 관리 강화 방안」
 * "제2금융권 기준을 60%에서 50%로 강화" (https://www.korea.kr/news/policyNewsView.do?newsId=148894803).
 * 계산에는 안 쓰고 잔금 카드의 금융사 종류별 안내 줄에만 쓴다(세션675 결정 가).
 */
export const DSR_LIMIT_NONBANK = 0.5;

/** 원리금균등 상환 기간(년) — 금융 탭 "한 달에 갚을 돈"(`BankLoanBlocks.tsx` LOAN_YEARS)과 같은 30년 */
export const LOAN_TERM_YEARS = 30;

/**
 * 스트레스 DSR 3단계 가산 금리(%p) — 수도권(서울·경기·인천)·규제지역 주담대. 2025-10-16 부터 3.0% 이상
 * (금융위 10·15 대책). 변동금리 기준 값이다(고정·주기형은 가산이 줄어든다 — 계산기는 큰 쪽으로 잡아 한도가 작게 나온다).
 */
export const STRESS_RATE_METRO = 3.0;

/**
 * 지방(수도권·규제지역 밖) 주담대 스트레스 가산(%p) — 2단계 비율 유지, 2026-12-31 까지.
 * 원문: 금융위원회공고 제2026-362호 「3단계 스트레스 DSR 제도」 행정지도 변경 예고(2026-06-18)
 *   "수도권·규제지역 外 주담대의 경우 2단계 비율을 적용(~'26.12.31일 까지)"
 *   https://better.fsc.go.kr/fsc_new/status/adminMap/PrvntcDetail.do?muNo=144&postNo=5349&stNo=11
 * 0.75 = 스트레스금리 1.5% × 2단계 50% (공고에 숫자가 직접 나오지 않는다 — 은행연합회 2026-06-30 인용 보도
 *   "실제로 적용되는 지방 주담대의 스트레스 금리는 1.5%의 절반인 0.75%포인트 수준" https://view.asiae.co.kr/article/2026063015591295914).
 */
export const STRESS_RATE_LOCAL = 0.75;
/** `STRESS_RATE_LOCAL` 이 유효한 마지막 날 — 스트레스 금리는 6월·12월에 다시 정해진다(그 뒤는 미정) */
export const STRESS_RATE_LOCAL_UNTIL = "2026-12-31";

/** 계약금·중도금·잔금 기본 비율(%) — 공고마다 다르다. 손님이 "더 자세히"에서 고칠 수 있다. */
export const DEFAULT_PAYMENT_SPLIT = { contract: 10, interim: 60, balance: 30 } as const;

/** 경과규정 한 지역의 규칙 */
export type GrandfatherRule = {
  /** 지정·강화 효력일 전일 — 이 날까지 입주자모집공고를 한 사업장이 대상 */
  readonly cutoff: string;
  /** 종전 무주택 LTV 비율 */
  readonly rate: number;
  /** 화면 문장의 사건 이름 */
  readonly eventLabel: string;
  /** 10·15 의 15억 초과 4억·25억 초과 2억 금액 뚜껑도 그대로 씌우나(보수적으로 — 4구) */
  readonly keepRegulatedCaps: boolean;
};

/**
 * 규제지역 경과규정 표 — 집단(중도금·잔금)대출은 "효력일 전일까지 입주자모집공고된 사업장"에 종전 규정을 적용할 수 있다.
 * - 기본(10·15 지정 서울 21구 + 경기 12곳) = 2025-10-15 · 종전 70%(비규제) — 금융위 10·15 FAQ 2-1·7-1
 *   ("집단대출의 경우 규제지역 효력 발생일 전일(10.15일)까지 입주자모집공고 … 된 사업장에 대해서는 종전규정 적용")
 * - 2026-07-01 추가 지정 3곳 = 2026-06-30 · 종전 70% — 금융위 2026-06-30 보도 별첨 FAQ
 *   ("효력 발생일 전일(6.30일)까지 입주자모집공고 … 종전규정 적용") https://fsc.go.kr/no010101/87222
 * - 서울 4구(강남·서초·송파·용산) = 2025-09-07 · 종전 50% — 10·15 전부터 규제지역이고 9·7 대책으로 50%→40%
 *   (금융위 2025-09-07 FAQ 5-1 "집단대출의 경우 시행일 전일(9.7일)까지 입주자모집 공고 … 된 사업장에 대해서는 종전 규정 적용"
 *   https://www.fsc.go.kr/edu/news/85343). 15억·25억 금액 뚜껑은 그대로 씌운다(보수적 — 세션659 결정 19).
 * 경기 키는 `src/data/regulation-zones.json` 표기 그대로(시험이 그 목록에 있는지 지킨다).
 */
export const GRANDFATHER_RULES: {
  readonly default: GrandfatherRule;
  readonly byZone: Readonly<Record<string, GrandfatherRule>>;
} = (() => {
  const designated = (cutoff: string): GrandfatherRule => ({
    cutoff,
    rate: NORMAL_LTV,
    eventLabel: "규제지역 지정",
    keepRegulatedCaps: false,
  });
  const gangnam4: GrandfatherRule = {
    cutoff: "2025-09-07",
    rate: 0.5,
    eventLabel: "규제지역 LTV 강화",
    keepRegulatedCaps: true,
  };
  return {
    default: designated("2025-10-15"),
    byZone: {
      "서울 강남구": gangnam4,
      "서울 서초구": gangnam4,
      "서울 송파구": gangnam4,
      "서울 용산구": gangnam4,
      "경기 화성시 동탄구": designated("2026-06-30"),
      "경기 용인시 기흥구": designated("2026-06-30"),
      "경기 구리시": designated("2026-06-30"),
    },
  };
})();

/** 'YYYY-MM-DD' 이고 월 1~12·일 1~31 이면 그대로, 아니면 null. `new Date(문자열)` 은 쓰지 않는다(세션537 함정). */
export function normalizeIsoDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const mm = Number(m[2]);
  const dd = Number(m[3]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** 알려진 공고일 중 가장 이른 날(형식이 맞는 것만). 하나도 없으면 null. */
export function earliestIsoDate(...dates: unknown[]): string | null {
  let best: string | null = null;
  for (const d of dates) {
    const v = normalizeIsoDate(d);
    if (v && (best == null || v < best)) best = v;
  }
  return best;
}

/** 알려진 공고일 중 가장 늦은 날(형식이 맞는 것만). 하나도 없으면 null. */
export function latestIsoDate(...dates: unknown[]): string | null {
  let best: string | null = null;
  for (const d of dates) {
    const v = normalizeIsoDate(d);
    if (v && (best == null || v > best)) best = v;
  }
  return best;
}

/** 'YYYY-MM-DD' 의 다음 날 — 경과규정 기준일(전일) → 효력일 */
export function dayAfter(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return t.toISOString().slice(0, 10);
}

/** 시도 첫 토막을 짧은 이름으로 — "서울특별시"·"경기도" 같은 긴 표기는 `geoSidoToDbName`(regionGeoMapping)으로 바꾼다 */
export function shortSido(region?: string | null): string {
  const r = (region ?? "").split(",")[0].trim().normalize("NFC");
  return geoSidoToDbName(r) ?? r;
}

/**
 * 그 단지의 경과규정 규칙. 규제지역이 아니거나 서울인데 구를 모르면 null(4구인지 못 가린다).
 * 화성은 DB 가 gu "화성시" 하나로 저장해(동탄구를 이름으로 못 고른다) 규제지역 판정(zone)과 함께 본다 —
 * 화성시 안의 규제지역은 동탄구뿐이다(regulation-zones.json `_bjdPrefixZones`).
 */
export function grandfatherRule(zone: Zone, region?: string | null, gu?: string | null): GrandfatherRule | null {
  if (zone !== "overheated") return null;
  const r = shortSido(region);
  const g = (gu ?? "").trim().normalize("NFC");
  const by = GRANDFATHER_RULES.byZone;
  if (r === "서울") {
    if (!g) return null;
    return by[`서울 ${g}`] ?? GRANDFATHER_RULES.default;
  }
  if (r === "경기") {
    if (g.startsWith("화성시")) return by["경기 화성시 동탄구"];
    if (g === "용인시 기흥구" || g === "기흥구") return by["경기 용인시 기흥구"];
    if (g === "구리시") return by["경기 구리시"];
  }
  return GRANDFATHER_RULES.default;
}

export type GrandfatheredLtv = {
  rate: number;
  /** 종전 규정이면 최대(만원) */
  amount: number;
  cutoff: string;
  /** 효력일 = 기준일 다음 날 */
  effectiveDate: string;
  eventLabel: string;
  /** 첫 모집공고일 */
  firstDate: string;
  /** 최근 모집공고일(첫 공고와 같을 수 있다) */
  latestDate: string;
};

export type PresaleLtv = {
  /** 지금 규정 — 화면의 큰 숫자는 늘 이것(결정 18). `calcLTV` 그대로라 위 막대와 같다. */
  current: { amount: number; rate: number };
  /** 첫 모집공고가 그 지역 기준일 이전이면 종전 규정 값(될 수 있다는 사실 안내용), 아니면 null */
  grandfathered: GrandfatheredLtv | null;
};

/**
 * 분양 단지의 잔금 때 지역 한도(LTV) — 지금 규정 + 경과규정(종전) 값(세션659 결정 16·18·19 · 새 계산기 전용).
 * 첫 공고일은 "묶음 = 한 사업장"일 때 그 사업장의 첫 공고다. 큰 숫자는 지금 규정이라 이 날짜가 숫자를 부풀리지 않는다.
 */
export function ltvForPresale({
  price,
  zone,
  region,
  gu,
  firstDate,
  latestDate,
}: {
  price: number;
  zone: Zone;
  region?: string | null;
  gu?: string | null;
  firstDate?: string | null;
  latestDate?: string | null;
}): PresaleLtv {
  const current = {
    amount: calcLTV(price, zone, region),
    rate: zone === "normal" ? NORMAL_LTV : REGULATED_LTV_RATE,
  };
  const rule = grandfatherRule(zone, region, gu);
  const first = normalizeIsoDate(firstDate);
  if (!rule || !first || first > rule.cutoff) return { current, grandfathered: null };
  let amount = Math.round(price * rule.rate);
  if (rule.keepRegulatedCaps) {
    const capped = REGULATED_LTV_CAPS.find((c) => price > c.overPrice);
    if (capped) amount = Math.min(amount, capped.cap);
  }
  if (isMetroRegion(shortSido(region))) amount = Math.min(amount, METRO_LOAN_CAP);
  return {
    current,
    grandfathered: {
      rate: rule.rate,
      amount,
      cutoff: rule.cutoff,
      effectiveDate: dayAfter(rule.cutoff),
      eventLabel: rule.eventLabel,
      firstDate: first,
      latestDate: latestIsoDate(first, latestDate) ?? first,
    },
  };
}

/** 주택이 아닌 유형인가 — 오피스텔·생활숙박·상가·업무·지식산업은 비주택 담보라 주택 경과규정 대상이 아니다(10·15 FAQ 2-3) */
export function isNonHousing(housingType?: string | null, name?: string | null): boolean {
  if (/오피스텔|생활숙박|상가|업무|지식산업/.test(String(housingType ?? ""))) return true;
  return /\(오\)|오피스텔|생활숙박|지식산업/.test(String(name ?? ""));
}

/**
 * 사전청약 단지인가 — 이름에 "사전청약"이 들어 있으면 참(2026-10-25 실측 5곳 전부 이 꼴).
 * 사전청약의 첫 공고는 「주택공급에 관한 규칙」 제24조의4 사전당첨자모집공고라 입주자모집공고가 아니다.
 * 금융위 10·15 FAQ 의 경과규정은 "입주자모집공고" 기준이므로 그 날짜로 종전 규정 줄을 띄우지 않는다(세션660 사장님 결정).
 */
export function isPreSubscription(name?: string | null): boolean {
  return String(name ?? "")
    .normalize("NFC")
    .includes("사전청약");
}

/** 입주 시작월 'YYYY-MM'·'YYYYMM' → 'YYYY-MM'. 형식 이상("미정" 등)은 null = 모름. */
export function normalizeYearMonth(v: unknown): string | null {
  const m = /^(\d{4})-?(\d{2})$/.exec(String(v ?? "").trim());
  if (!m) return null;
  const mm = Number(m[2]);
  return mm >= 1 && mm <= 12 ? `${m[1]}-${m[2]}` : null;
}

/** KST 기준 이번 달 'YYYY-MM' — 시각은 밖에서 넣을 수 있게(시험 고정) */
export function kstYearMonth(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 7);
}

/**
 * 입주가 이미 시작됐나 — 입주월 중 하나라도 이번 달(KST)보다 앞이면 참. 형식을 모르는 값은 무시(모름 = 숨기지 않음).
 * 입주 뒤 사는 손님은 개인 주담대라 집단대출 경과규정 대상이 아니다.
 */
export function moveInStarted(moveIns: readonly unknown[], thisMonth: string): boolean {
  return moveIns.some((v) => {
    const ym = normalizeYearMonth(v);
    return ym != null && ym < thisMonth;
  });
}

/** 스트레스 가산(%p) — 수도권 또는 규제지역이면 3.0, 아니면 0.75 */
export function stressAddFor(zone: Zone, region?: string | null): number {
  return zone !== "normal" || isMetroRegion(region) ? STRESS_RATE_METRO : STRESS_RATE_LOCAL;
}
