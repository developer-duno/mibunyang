/** 만원 단위 → 억/만 혼합 표시 (예: 24675 → "2억 4675만") */
export const fmtPrice = (v: number | null | undefined): string => {
  if (v == null || v <= 0) return "-";
  const eok = Math.floor(v / 10000);
  const man = v % 10000;
  if (eok > 0 && man > 0) return `${eok}억 ${man.toLocaleString()}만`;
  if (eok > 0) return `${eok}억`;
  return `${man.toLocaleString()}만`;
};

/**
 * 분양가와 실거래 중앙값의 **산술 차이** 판정 단일 출처 (세션651 — 판정어 "저렴/비쌈/적정가 수준" 대신).
 * 부호는 점수의 `deviation` 그대로다: (중앙값 − 분양가) ÷ 중앙값 × 100 이라 **+면 분양가가 낮음**.
 * "같음" = 표시 자릿수(소수 첫째)로 반올림해 0.0 일 때 — 자리마다 문턱을 따로 두면 같은 단지를
 * 한 화면은 "같음", 다른 화면은 "0.3% 낮음"이라 부른다(세션651 검사관 지적: 0.05% vs 0.5%).
 */
export const priceGapParts = (dev: number): { same: boolean; pct: string; lower: boolean } => {
  const pct = Math.abs(dev).toFixed(1);
  return { same: pct === "0.0", pct, lower: dev > 0 };
};

/**
 * 그 차이를 적는 말 — 시세 탭 표·점수 탭 판정·서브 detail·종합 탭 핵심지표가 이 하나를 쓴다.
 * 카테고리 한 줄(`catVerdict`)은 어순만 다르고 `priceGapParts` 를 같이 쓴다.
 */
export const fmtPriceGap = (dev: number): string => {
  const g = priceGapParts(dev);
  if (g.same) return "분양가가 같음";
  return `분양가가 ${g.pct}% ${g.lower ? "낮음" : "높음"}`;
};

/**
 * 미분양률 표시 — 100% 초과는 데이터 신뢰 불가(전체 세대수에 청약홈 잔여공급분이
 * 들어가 분모가 작아진 경우)라 "100%+" 로 캡한다. 미분양은 본질적으로 전체 세대수를
 * 넘을 수 없으므로 2900% 같은 값은 표시 오류. collector(molit-units)가 진짜 세대수로
 * 보정하나 이름 매칭 실패분은 캡으로 방어 (세션 444).
 */
export const fmtUnsoldRate = (v: number | null | undefined): string => {
  if (v == null) return "-";
  if (v > 100) return "100%+";
  return `${v}%`;
};

/** 이름 마스킹 (예: "홍길동" → "홍**", null → "") */
export const maskName = (name: string | null | undefined): string => {
  if (!name || typeof name !== "string") return "";
  const chars = Array.from(name);
  if (chars.length <= 1) return chars[0] || "";
  return chars[0] + "*".repeat(chars.length - 1);
};

/** 전화번호 마스킹 (예: "010-1234-5678" → "010-****-5678") */
export const maskPhone = (phone: string | null | undefined): string => {
  if (!phone || typeof phone !== "string") return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8) return phone;
  return digits.slice(0, 3) + "-****-" + digits.slice(-4);
};

/**
 * YYYYMM → "YYYY년 MM월" (예: "202501" → "2025년 01월").
 * 형식이 아니면 **원문 그대로** — 우리가 못 읽는 값을 읽은 척 꾸미지 않는다.
 *
 * 옛 코드는 `length < 6` 만 보고 앞 6자를 잘라 붙여서, 규약을 어긴 값이 손님 화면에
 * `"2030 미"` → `"2030년  미월"`, `"[1회]20"` → `"[1회]년 20월"` 처럼 깨진 문구로
 * 나갔다 (세션530). 수집 단계(`naver-presale.mjs parsePresaleCompletion`)가 1차로 막지만,
 * 이미 저장된 값과 다른 출처를 위해 표시 계층에도 방어선을 둔다.
 */
export const fmtCompletion = (v: string | null | undefined): string => {
  if (!v) return "-";
  const s = String(v);
  if (!/^\d{6}$/.test(s)) return s;
  return `${s.slice(0, 4)}년 ${s.slice(4, 6)}월`;
};

/**
 * 입주 시기 **표시값** — `completion`(YYYYMM)이 정본이고, 규약을 어겼거나 비었으면
 * 네이버 원문(`presaleMoveIn`)을 대신 보여준다.
 *
 * 왜 필요한가 (세션530): 옛 수집기가 `"2029 미정"` 을 6자에서 잘라 `"2029 미"` 로 저장한
 * 값이 44건 남아 있다. 원문에도 월이 없어 복구가 안 되는데, 잘린 값을 그대로 보이면
 * `"입주예정 2029 미"` 라 어색하다. 원문은 `"2029 미정"` 이라 사람이 읽을 수 있다.
 *
 * ⚠️ 그럼 DB 의 잘린 값을 비우면 되지 않나 — **안 된다.** `classifyMoveIn`(classify.ts:31)이
 *    `completion` 이 비면 입주 상태를 못 매기고, 그 결과가 `useDataPipeline` 의 "입주 시기"
 *    필터로 흘러가 그 44곳이 "입주예정" 목록에서 통째로 사라진다. 표시만 대체하는 이유다.
 */
export const fmtMoveIn = (completion: string | null | undefined, presaleMoveIn?: string | null): string => {
  if (completion && /^\d{6}$/.test(String(completion))) return fmtCompletion(completion);
  const raw = typeof presaleMoveIn === "string" ? presaleMoveIn.trim() : "";
  if (raw) return raw;
  const stored = typeof completion === "string" ? completion.trim() : "";
  return stored || "-";
};

/** 분양가 범위: min~max (만원 → 억/만) */
export const fmtPriceRange = (min: number | null | undefined, max: number | null | undefined): string => {
  if (min == null && max == null) return "—";
  if (min != null && max != null && min === max) return fmtPrice(min);
  const lo = min != null ? fmtPrice(min) : "?";
  const hi = max != null ? fmtPrice(max) : "?";
  return `${lo} ~ ${hi}`;
};

/**
 * 만원 → 카드 칩용 짧은 금액(세션661 실거래 범위): 1억 이상은 소수 첫째 억("5.8억" · 끝 .0 은 "6억"),
 * 1억 미만은 "8,000만". 칩 한 줄에 범위 두 값을 넣어야 해서 `fmtPrice`("5억 8,000만")보다 짧게 쓴다.
 */
export const fmtPriceEok1 = (v: number | null | undefined): string => {
  if (v == null || !(v > 0)) return "-";
  if (v < 10000) return `${Math.round(v).toLocaleString()}만`;
  return `${Math.round(v / 1000) / 10}억`;
};

/** 칩용 범위 — 표시 글자가 같으면 하나만(57,600·58,400 → "5.8억"), 아니면 "5.8억~6.4억"(물결 앞뒤 공백 없음). */
export const fmtPriceRangeEok1 = (min: number | null | undefined, max: number | null | undefined): string => {
  const lo = fmtPriceEok1(min);
  const hi = fmtPriceEok1(max);
  return lo === hi ? lo : `${lo}~${hi}`;
};

interface ScheduleItem {
  scheduleName?: string;
  dateInfo?: string;
  schdl_info?: string;
}
const isScheduleItem = (x: unknown): x is ScheduleItem => typeof x === "object" && x !== null;

/** presaleSchedule JSONB → 문자열 (배열/객체/문자열 모두 처리) */
export const fmtPresaleSchedule = (schedule: unknown): string => {
  if (!schedule) return "—";
  if (typeof schedule === "string") return schedule;
  if (Array.isArray(schedule)) {
    const items = (schedule as unknown[])
      .filter((s): s is ScheduleItem => isScheduleItem(s) && Boolean(s.scheduleName || s.dateInfo))
      .map((s) => `${s.scheduleName ?? ""} ${s.dateInfo ?? ""}`.trim());
    return items.length > 0 ? items.join(", ") : "—";
  }
  if (isScheduleItem(schedule)) {
    if (schedule.scheduleName || schedule.dateInfo) {
      return `${schedule.scheduleName ?? ""} ${schedule.dateInfo ?? ""}`.trim();
    }
    if (schedule.schdl_info) {
      return typeof schedule.schdl_info === "string" ? schedule.schdl_info : "일정 있음";
    }
  }
  return "—";
};

/** 오늘 날짜(KST) "YYYY-MM-DD" — 시험은 now 를 밖에서 넣는다 */
export const todayKst = (now: Date = new Date()): string =>
  new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

/**
 * 날짜 글자가 오늘(KST)보다 지났나 — "YYYY-MM-DD"(또는 "YYYY.MM.DD")는 그날이 오늘보다 앞일 때, "YYYY-MM"·"YYYYMM"은 그 달이
 * 이번 달보다 앞일 때. 그 밖 글자("2026 하반기"·"미정")는 판정하지 않는다(false). 세션675 👤 「지난 일정 정리」.
 */
export const isPastDateKst = (d: unknown, now: Date = new Date()): boolean => {
  if (typeof d !== "string") return false;
  const today = todayKst(now);
  const day = /^(\d{4})[-.](\d{2})[-.](\d{2})$/.exec(d.trim());
  if (day) return `${day[1]}-${day[2]}-${day[3]}` < today;
  const month = /^(\d{4})-?(\d{2})$/.exec(d.trim());
  if (month) return `${month[1]}-${month[2]}` < today.slice(0, 7);
  return false;
};

/**
 * 네이버 분양 일정(`presaleSchedule`, 객체 한 건)이 끝났나 — 끝 날짜(`schdl_info.end_date`)가 있으면 그것으로, 없으면 `dateInfo`.
 * 배열·문자열 꼴은 판정하지 않는다(운영 자료는 전부 객체 한 건 — 세션675 실측).
 */
export const presaleScheduleEnded = (schedule: unknown, now: Date = new Date()): boolean => {
  if (!isScheduleItem(schedule) || Array.isArray(schedule)) return false;
  const info = (schedule as { schdl_info?: unknown }).schdl_info;
  const end = isScheduleItem(info) ? (info as { end_date?: unknown }).end_date : null;
  return isPastDateKst(typeof end === "string" && end ? end : schedule.dateInfo, now);
};

/** 분양시기 포맷: "2026-03-01" → "2026.03.01" */
export const fmtRecruitDate = (v: unknown): string => {
  if (!v) return "—";
  if (!(typeof v === "string" || v instanceof Date)) return "—";
  const d = new Date(v as string | Date);
  if (isNaN(d.getTime())) return typeof v === "string" ? v : "—";
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
};

/** 청약 경쟁률 포맷: 1000:1↑ 정수+콤마(437,995:1), 미만 소수1자리(5.2:1), 음수 미달%(미달 30%), null 미수집 */
export const fmtCompetitionRate = (v: number | null | undefined): string => {
  if (v == null) return "미수집";
  if (v < 0) return `미달 ${(Math.abs(v) * 100).toFixed(0)}%`;
  const rate = v >= 1000 ? Math.round(v).toLocaleString("ko-KR") : v.toFixed(1);
  return `${rate}:1`;
};

/**
 * 주소 **표시용** 시도 접두 축약 — 저장값은 건드리지 않는다.
 *
 * ## 왜 필요한가 (세션556 실측)
 *
 * 행정구역 개편은 소비처마다 전환 시점이 달라서 옛/새 표기가 **한동안 공존한다**
 * (`.claude/rules/collectors/admin-district-code-reform.md` §1 — 실거래가·행안부·네이버는
 * 새 코드만, 학교알리미는 둘 다, KOSIS 는 두 달 뒤에도 옛 코드). 그래서 수집 단계에서
 * 한쪽으로 통일하지 않고 **출처가 준 표기를 그대로 저장한다**(사장님 결정, 2026-09-21).
 *
 * 그 결과 `apartments.address` 에 다섯 표기가 섞여 있다(실측):
 * `광주 …` 52 · `전남 …` 33 · `전라남도 …` 13 · `전남광주통합특별시 …` 3 · `광주광역시 …` 1.
 *
 * 화면(`DetailModal`)은 바로 윗줄에 `region gu dong`(= "광주 광산구 월계동")을 보여주므로,
 * 아랫줄 주소만 "전남광주통합특별시 광산구 월계동 870-1" 이면 같은 곳이 달라 보인다.
 * **저장은 그대로, 보여줄 때만 줄인다.**
 *
 * ## 이 함수가 하지 않는 것 (중요)
 *
 * ⚠️ **주소 문자열로 지역을 판정하지 않는다.** 이건 분류가 아니라 **글자 줄이기**다.
 * `_shared.mjs` 의 `resolveRegionName` 주석(`REGION_MAP` 은 같은 파일에 정의)이 경고하듯
 * 통합 시도명은 한 약칭으로 접을 수 없다
 * ("전남광주통합특별시" 를 "전남" 으로 접으면 광주 5구가 전남으로 오라벨된다). 지역 분류는
 * 이미 `apartments.region` 이 따로 갖고 있으므로(광주 57 / 전남 48 로 정상), 여기서는
 * **주소의 첫 토큰만** 치환하고 그 뒤(시군구·동·지번)는 손대지 않는다.
 *
 * 표에 없는 표기는 **원문 그대로 통과**시킨다 — `fmtCompletion` 과 같은 원칙으로,
 * 우리가 못 읽는 값을 읽은 척 꾸미지 않는다.
 */
const ADDR_SIDO_SHORT: Record<string, string> = {
  전남광주통합특별시: "광주",
  광주광역시: "광주",
  전라남도: "전남",
};

export const fmtAddress = (v: string | null | undefined): string => {
  if (!v || typeof v !== "string") return "";
  const s = v.trim();
  if (!s) return "";
  const sp = s.indexOf(" ");
  if (sp <= 0) return s;
  const head = s.slice(0, sp);
  const shortHead = ADDR_SIDO_SHORT[head];
  return shortHead ? `${shortHead}${s.slice(sp)}` : s;
};
