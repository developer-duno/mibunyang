// /api/upcoming — 분양 임박 단지 (분양계획 + 청약중 + 분양중) 목록 + 캘린더 매핑
// spec: docs/superpowers/specs/2026-05-02-upcoming-presale-page-design.md § 3-1

import { getSupabase } from "./_lib/supabase.js";
import { withHandler } from "./_lib/handler.js";
import { excludeLeaseUnits } from "../src/constants/leaseTypes.mjs";

const STAGE_MAP = {
  plan: "분양계획",
  apply: "청약중",
  sale: "분양중",
} as const;
const ALL_STAGES = Object.values(STAGE_MAP);
// 날짜 형식: 하이픈(YYYY-MM-DD, 네이버 실데이터) + 점(YYYY.MM.DD, 하위호환) 둘 다 허용.
// 세션 469: 실데이터는 100% 하이픈인데 점만 허용해 schedule 이벤트가 전량 탈락하던 버그 수정.
const DATE_RE = /^\d{4}[.-]\d{2}[.-]\d{2}$/;
// 월-only(YYYY-MM / YYYY.MM): 일자 미상 — 특정 일자로 강제하지 않고 "월 예정" 표식으로 전달.
const MONTH_RE = /^\d{4}[.-]\d{2}$/;

export default withHandler({
  method: "GET",
  cors: {},
  rateLimit: "proxy",
  handler: handleGet,
});

async function handleGet(req: any, res: any) {
  try {
    const sb = getSupabase();

    // apartments_flat VIEW 에서 presaleStage IN (분양계획/청약중/분양중) 필터
    const { data, error } = await sb
      .from("apartments_flat")
      .select(
        `id, name, region, gu, presaleStage, presaleMinPrice, presalePp,
               presaleRecruitDate, presaleSchedule, presaleImageUrl, naverPresaleNo,
               naverPresaleSeq, presaleHousingType, presaleType, presaleInquiry,
               catsCache`
      )
      .in("presaleStage", ALL_STAGES);

    if (error) {
      console.error("[/api/upcoming] supabase error:", error.message);
      return res.status(500).json({ ok: false, error: "데이터 조회 실패" });
    }

    // 임대형 제외 — 곧분양 탭·홈 위젯도 "분양" 화면이다(사장님 결정 2026-08-07).
    // 정적 JSON 과 달리 이 엔드포인트는 apartments_flat 을 라이브로 읽으므로 여기서 따로 거른다.
    // 실측(2026-08-07): 3단계(분양계획/청약중/분양중) 648건 중 430건(66%)이 임대형이었다.
    const rows = excludeLeaseUnits((data || []) as any[]);

    // 세션 469: "곧 분양(분양계획)"인데 청약홈 공식 접수시작일이 이미 지난 단지는 실제로는 과거 공고다.
    // 네이버 presaleStage 가 stale 이면(수집기 정지 등) 과거 공고가 계속 "분양계획"으로 남으므로,
    // 청약홈 공식 접수일(presale_schedule_official)로 교차 검증해 과거로 확정된 단지는 곧분양에서 제외한다.
    // VIEW·수집기 무변경(표시 계층 파생 규칙) — 데이터 소스가 하나 죽어도 "곧 분양"의 정직성 유지.
    const stalePlanIds = await findStalePlanIds(sb, rows);

    const stages: { plan: any[]; apply: any[]; sale: any[] } = { plan: [], apply: [], sale: [] };
    for (const apt of rows) {
      if (apt.presaleStage === "분양계획") {
        if (stalePlanIds.has(apt.id)) continue; // 접수일 지난 과거 공고 — 곧분양에서 제외
        stages.plan.push(apt);
      } else if (apt.presaleStage === "청약중") stages.apply.push(apt);
      else if (apt.presaleStage === "분양중") stages.sale.push(apt);
    }

    const calendar: Record<string, Array<{ id: any; event: string; monthOnly?: boolean }>> = {};
    for (const apt of rows) {
      const dates = extractDates(apt);
      for (const { date, event, monthOnly } of dates) {
        if (!calendar[date]) calendar[date] = [];
        calendar[date].push({ id: apt.id, event, ...(monthOnly ? { monthOnly: true } : {}) });
      }
    }

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json({
      ok: true,
      stages,
      calendar,
      totals: { plan: stages.plan.length, apply: stages.apply.length, sale: stages.sale.length },
      fetchedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[/api/upcoming] handler error:", e instanceof Error ? e.message : e);
    return res.status(500).json({ ok: false, error: "서버 오류" });
  }
}

/**
 * 오늘(KST) 자정 기준 ISO date(YYYY-MM-DD). 접수일 과거/미래 판정용 (세션 469).
 * Vercel 서버리스는 UTC 런타임이라 로컬 getter 를 쓰면 KST 손님보다 9시간 이르게 날이 넘어간다.
 * 접수일 판정은 손님(한국) 캘린더 기준이어야 하므로 Asia/Seoul 로 고정 (timezone-consistency 룰).
 */
export function todayIso(now: Date = new Date()): string {
  // en-CA locale = YYYY-MM-DD 포맷. timeZone 지정으로 UTC 런타임에서도 KST 날짜 반환.
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

/**
 * 분양계획 단지의 자체 모집일(presaleRecruitDate)이 오늘보다 과거인지 (세션 470).
 * - YYYY-MM-DD (일자 확정): 그 날짜가 오늘보다 과거면 true.
 * - YYYY-MM (월-only, 일자 미상): 그 "월"이 이번 달보다 과거면 true. 이번 달·미래 월은 false
 *   (미래 곧분양 27건을 살려둠 — 진짜 임박 단지 보호).
 * - "미정"/자유텍스트/null (파싱 불가): false (fail-open — 날짜를 모르니 과거로 단정 못 함, 사장님 결정).
 * 청약홈 공식 스케줄이 없는 네이버-only 과거 공고(fail-open 사각)를 자동으로 잡는다.
 */
export function recruitDateIsPast(recruitDate: unknown, today: string): boolean {
  if (!recruitDate || typeof recruitDate !== "string") return false;
  const s = recruitDate.trim().replace(/\./g, "-");
  const full = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (full) return s < today; // 일자 확정 → 날짜 직접 비교 (YYYY-MM-DD 사전식 = 시간순)
  const month = s.match(/^(\d{4})-(\d{2})$/);
  if (month) return `${month[1]}-${month[2]}` < today.slice(0, 7); // 월-only → 월(YYYY-MM) 비교
  return false; // 파싱 불가(미정 등) → 제외 안 함
}

/**
 * "곧 분양(분양계획)"인데 실제로는 과거 공고인 단지 ID 집합 (세션 469~470).
 * 네이버 presaleStage 가 stale(수집기 정지 등)이면 과거 공고가 계속 "분양계획"으로 남는다. 두 신호로 교차 제외:
 *  (A) 청약홈 공식 접수시작일(presale_schedule_official 1순위/특별공급 최신 차수)이 오늘보다 과거 (세션 469).
 *  (B) 단지 자체 모집일(presaleRecruitDate)의 월/일자가 오늘보다 과거 (세션 470 — 공식 스케줄이 없는
 *      네이버-only 공고의 fail-open 사각 보완). 매 요청 todayIso() 재계산이라 시간이 지나면 자동 제외.
 * 둘 다 판정 불가(공식 없음 + 날짜 미상 "미정")면 제외 안 함(네이버 stage 신뢰, 과반제거 위험 0).
 * @param sb Supabase client
 * @param rows apartments_flat 결과 (presaleStage + presaleRecruitDate 포함)
 * @returns 곧분양에서 빼야 할 apartment_id Set
 */
export async function findStalePlanIds(sb: any, rows: any[], today: string = todayIso()): Promise<Set<any>> {
  const stale = new Set<any>();
  const planRows = rows.filter((r) => r?.presaleStage === "분양계획");
  if (planRows.length === 0) return stale;

  // (B) 자체 모집일 과거 판정 — 조회 없이 즉시 (공식 스케줄 부재 사각 보완)
  for (const r of planRows) {
    if (recruitDateIsPast(r.presaleRecruitDate, today)) stale.add(r.id);
  }

  // (A) 청약홈 공식 접수시작일 교차 검증
  const planIds = planRows.map((r) => r.id);
  const { data, error } = await sb
    .from("presale_schedule_official")
    .select("apartment_id, general_rank1_bgnde, special_receipt_bgnde, recruit_date")
    .in("apartment_id", planIds);
  if (error || !data) return stale; // 조회 실패 시 (A) 미적용(fail-open) — (B) 결과는 유지

  // 단지별 최신(recruit_date desc) 접수시작일만 판정 — 여러 차수가 있으면 가장 최근 공고 기준
  const latestByApt = new Map<any, { bgn: string | null; recruit: string | null }>();
  for (const row of data as any[]) {
    const bgn = row.general_rank1_bgnde || row.special_receipt_bgnde || null;
    const prev = latestByApt.get(row.apartment_id);
    if (!prev || (row.recruit_date && (!prev.recruit || row.recruit_date > prev.recruit))) {
      latestByApt.set(row.apartment_id, { bgn, recruit: row.recruit_date ?? null });
    }
  }
  for (const [aptId, { bgn }] of latestByApt) {
    if (bgn && bgn < today) stale.add(aptId); // 접수시작일이 오늘보다 과거 = 이미 지난 공고
  }
  return stale;
}

/**
 * 단지에서 캘린더용 날짜 추출 (spec § 3-1-A·B + § 6-1 4색 점 정책)
 * - 분양계획 단지의 recruit_date → presale_announce (녹)
 * - 청약중/분양중 단지의 recruit_date → apply_start (노)
 * - schedule.scheduleName 키워드 휴리스틱 → presale_announce/apply_start/apply_end/winner_announce
 */
export function extractDates(apt: any): Array<{ date: string; event: string; monthOnly?: boolean }> {
  const dates: Array<{ date: string; event: string; monthOnly?: boolean }> = [];
  const isPlanStage = apt?.presaleStage === "분양계획";

  // 1) presaleRecruitDate (TEXT) — 분양계획 vs 그 외 단계로 이벤트 키 분리
  if (apt?.presaleRecruitDate) {
    const parsed = parseRecruitDate(apt.presaleRecruitDate);
    if (parsed) {
      dates.push({
        date: parsed.date,
        event: isPlanStage ? "presale_announce" : "apply_start",
        ...(parsed.monthOnly ? { monthOnly: true } : {}),
      });
    }
  }

  // 2) presaleSchedule (JSONB 3형태)
  const schedule = apt?.presaleSchedule;
  if (schedule && typeof schedule === "object" && !Array.isArray(schedule)) {
    const parsed = parseRecruitDate(schedule.dateInfo);
    if (parsed) {
      const event = inferEventFromName(schedule.scheduleName, isPlanStage);
      dates.push({ date: parsed.date, event, ...(parsed.monthOnly ? { monthOnly: true } : {}) });
    }
  }

  return dates;
}

/**
 * 날짜 문자열 파싱 — 하이픈/점 형식 통일 + 월-only 감지 (세션 469).
 * - YYYY-MM-DD / YYYY.MM.DD → { date: "YYYY-MM-DD" }
 * - YYYY-MM / YYYY.MM (일자 미상) → { date: "YYYY-MM-01", monthOnly: true } (1일 강제 아님을 플래그로 명시)
 * - 그 외("미정","하반기" 등) → null
 * new Date() 의 UTC 파싱 + 로컬 getter 시간대 함정을 피하려고 문자열만 다룬다 (timezone-consistency 룰).
 */
function parseRecruitDate(v: unknown): { date: string; monthOnly?: boolean } | null {
  if (!v || typeof v !== "string") return null;
  const s = v.trim();
  if (DATE_RE.test(s)) return { date: s.replace(/\./g, "-") };
  if (MONTH_RE.test(s)) return { date: `${s.replace(/\./g, "-")}-01`, monthOnly: true };
  return null;
}

export function inferEventFromName(name: unknown, isPlanStage = false): string {
  if (!name || typeof name !== "string") {
    return isPlanStage ? "presale_announce" : "etc";
  }
  if (name.includes("당첨")) return "winner_announce";
  if (name.includes("종료") || name.includes("마감")) return "apply_end";
  if (name.includes("모집") || name.includes("분양공고") || name.includes("분양예정")) {
    return "presale_announce";
  }
  if (name.includes("청약")) return "apply_start";
  return isPlanStage ? "presale_announce" : "etc";
}
