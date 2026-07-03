// GET /api/admin/subscribers — 분양 알림 구독자 통계 + 최근 발송 로그 (관리자 전용, 세션 467 PR2)
// subscribers/notification_logs 는 RLS 로 anon 차단 → service_role(getMibuyangSupabase) 경유.
// PII: phone 은 마스킹(+8210****5678)해서만 응답 — 원문은 절대 내보내지 않는다.

import { getMibuyangSupabase } from "../_lib/supabase.js";
import { withHandler } from "../_lib/handler.js";

const LOGS_LIMIT = 50;

export function maskPhoneE164(e164: string | null | undefined): string {
  if (!e164 || e164.length < 8) return "****";
  return `${e164.slice(0, 5)}****${e164.slice(-4)}`;
}

export default withHandler({
  method: "GET",
  admin: true,
  rateLimit: "admin",
  handler: async (_req: any, res: any) => {
    try {
      const sb = getMibuyangSupabase();

      const [totalQ, activeQ, aptQ, regionQ] = await Promise.all([
        sb.from("subscribers").select("*", { count: "exact", head: true }),
        sb.from("subscribers").select("*", { count: "exact", head: true }).is("opt_out_at", null),
        sb
          .from("subscribers")
          .select("*", { count: "exact", head: true })
          .is("opt_out_at", null)
          .not("apartment_id", "is", null),
        sb
          .from("subscribers")
          .select("*", { count: "exact", head: true })
          .is("opt_out_at", null)
          .is("apartment_id", null)
          .not("region", "is", null),
      ]);
      const statErr = totalQ.error || activeQ.error || aptQ.error || regionQ.error;
      if (statErr) {
        console.error("[/api/admin/subscribers] stats error:", statErr.message);
        return res.status(500).json({ ok: false, error: "구독자 통계 조회 실패" });
      }
      const total = totalQ.count ?? 0;
      const active = activeQ.count ?? 0;
      const apartment = aptQ.count ?? 0;
      const region = regionQ.count ?? 0;
      const stats = {
        total,
        active,
        optedOut: total - active,
        byScope: { apartment, region, nationwide: Math.max(0, active - apartment - region) },
      };

      // 최근 발송 로그 — notification_logs 마이그 미적용(42P01)이어도 통계는 응답 (부분 성공)
      const logsQ = await sb
        .from("notification_logs")
        .select("id, subscriber_id, apartment_id, house_manage_no, event_date, channel, status, fail_reason, created_at")
        .order("created_at", { ascending: false })
        .limit(LOGS_LIMIT);
      if (logsQ.error) {
        console.error("[/api/admin/subscribers] logs error:", logsQ.error.message);
        return res.status(200).json({ ok: true, stats, logs: [], logsError: "발송 로그 조회 실패 (notification_logs 마이그레이션 적용 여부 확인)" });
      }
      const logs = logsQ.data ?? [];

      const aptIds = [...new Set(logs.map((l: any) => l.apartment_id).filter(Boolean))];
      const subIds = [...new Set(logs.map((l: any) => l.subscriber_id).filter((v: any) => v != null))];
      const [aptRows, subRows] = await Promise.all([
        aptIds.length > 0
          ? sb.from("apartments").select("id, name").in("id", aptIds)
          : Promise.resolve({ data: [], error: null } as any),
        subIds.length > 0
          ? sb.from("subscribers").select("id, phone").in("id", subIds)
          : Promise.resolve({ data: [], error: null } as any),
      ]);
      const nameById = new Map<string, string>((aptRows.data ?? []).map((a: any) => [a.id, a.name]));
      const phoneById = new Map<number, string>((subRows.data ?? []).map((s: any) => [s.id, s.phone]));

      const items = logs.map((l: any) => ({
        id: l.id,
        apartmentId: l.apartment_id,
        apartmentName: nameById.get(l.apartment_id) ?? l.apartment_id,
        houseManageNo: l.house_manage_no,
        eventDate: l.event_date,
        channel: l.channel,
        status: l.status,
        failReason: l.fail_reason,
        createdAt: l.created_at,
        phoneMasked: maskPhoneE164(phoneById.get(l.subscriber_id)),
      }));

      return res.status(200).json({ ok: true, stats, logs: items });
    } catch (e) {
      console.error("[/api/admin/subscribers] handler error:", e instanceof Error ? e.message : e);
      return res.status(500).json({ ok: false, error: "서버 오류" });
    }
  },
});
