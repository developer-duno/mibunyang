// /api/upcoming — 분양 임박 단지 (분양계획 + 청약중 + 분양중) 목록 + 캘린더 매핑
// spec: docs/superpowers/specs/2026-05-02-upcoming-presale-page-design.md § 3-1

import { getSupabase } from "./_lib/supabase.js";
import { withHandler } from "./_lib/handler.js";

const STAGE_MAP = {
  plan: "분양계획",
  apply: "청약중",
  sale: "분양중",
};
const ALL_STAGES = Object.values(STAGE_MAP);
const DATE_RE = /^\d{4}\.\d{2}\.\d{2}$/;

export default withHandler({
  method: "GET",
  cors: {},
  rateLimit: "proxy",
  handler: handleGet,
});

async function handleGet(req, res) {
  try {
    const sb = getSupabase();

    // apartments_flat VIEW 에서 presaleStage IN (분양계획/청약중/분양중) 필터
    const { data, error } = await sb
      .from("apartments_flat")
      .select(`id, name, region, gu, presaleStage, presaleMinPrice, presalePp,
               presaleRecruitDate, presaleSchedule, presaleImageUrl, naverPresaleNo,
               naverPresaleSeq, presaleHousingType, presaleType, presaleInquiry,
               catsCache`)
      .in("presaleStage", ALL_STAGES);

    if (error) {
      console.error("[/api/upcoming] supabase error:", error.message);
      return res.status(500).json({ ok: false, error: "데이터 조회 실패" });
    }

    const rows = data || [];

    // stages 분류 (3개 그룹)
    const stages = { plan: [], apply: [], sale: [] };
    for (const apt of rows) {
      if (apt.presaleStage === "분양계획") stages.plan.push(apt);
      else if (apt.presaleStage === "청약중") stages.apply.push(apt);
      else if (apt.presaleStage === "분양중") stages.sale.push(apt);
    }

    // calendar 매핑 (spec § 3-1-A 정책)
    const calendar = {};
    for (const apt of rows) {
      const dates = extractDates(apt);
      for (const { date, event } of dates) {
        if (!calendar[date]) calendar[date] = [];
        calendar[date].push({ id: apt.id, event });
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
    console.error("[/api/upcoming] handler error:", e.message);
    return res.status(500).json({ ok: false, error: "서버 오류" });
  }
}

/**
 * 단지에서 캘린더용 날짜 추출 (spec § 3-1-A·B + § 6-1 4색 점 정책)
 * - 분양계획 단지의 recruit_date → presale_announce (녹)
 * - 청약중/분양중 단지의 recruit_date → apply_start (노)
 * - schedule.scheduleName 키워드 휴리스틱 → presale_announce/apply_start/apply_end/winner_announce
 *
 * @returns {Array<{date: string, event: string}>} ISO 날짜(YYYY-MM-DD) + 이벤트 키
 */
export function extractDates(apt) {
  const dates = [];
  const isPlanStage = apt?.presaleStage === "분양계획";

  // 1) presaleRecruitDate (TEXT) — 분양계획 vs 그 외 단계로 이벤트 키 분리
  if (apt?.presaleRecruitDate) {
    const iso = parseRecruitDate(apt.presaleRecruitDate);
    if (iso) {
      dates.push({
        date: iso,
        event: isPlanStage ? "presale_announce" : "apply_start",
      });
    }
  }

  // 2) presaleSchedule (JSONB 3형태)
  const schedule = apt?.presaleSchedule;
  if (schedule && typeof schedule === "object" && !Array.isArray(schedule)) {
    if (schedule.dateInfo && DATE_RE.test(schedule.dateInfo)) {
      const iso = schedule.dateInfo.replace(/\./g, "-");
      const event = inferEventFromName(schedule.scheduleName, isPlanStage);
      dates.push({ date: iso, event });
    }
  }

  return dates;
}

function parseRecruitDate(v) {
  if (!v || typeof v !== "string") return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  // ISO YYYY-MM-DD
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function inferEventFromName(name, isPlanStage = false) {
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
