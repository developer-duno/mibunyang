import { getMibuyangSupabase } from "./_lib/supabase.js";
import { checkRateLimit } from "./_lib/rateLimit.js";
import { requireAdminGate } from "./_lib/adminAuth.js";
import { parsePagination } from "./_lib/validators.js";
import { withHandler } from "./_lib/handler.js";
import { verifyToken } from "./_lib/auth.js";
import { isBlacklisted } from "./_lib/tokenBlacklist.js";
import { kv } from "./_lib/redis.js";
import { isUserAccessDenied } from "./_lib/userAccess.js";
import { sendTelegram, formatFeedbackAlert } from "./_lib/telegram.js";
import { isFeedbackKind, FEEDBACK_MESSAGE_MAX } from "../src/constants/feedbackKinds.js";

/**
 * 손님 "의견 보내기" (세션574)
 *
 * POST   /api/feedback        — 카카오 로그인 손님만. Authorization: Bearer <authToken>.
 *                                저장(site_feedback, service key) 뒤 사장님 텔레그램으로 즉시 알림.
 * GET    /api/feedback        — 관리자 목록(offset/limit ≤50, count)
 * PATCH  /api/feedback        — 관리자 처리 표시 { id, status: "new" | "done" }
 * DELETE /api/feedback?id=N   — 관리자 삭제
 *
 * 표는 RLS 켬·정책 0·anon 권한 0 이라 이 API(service key)로만 쓰고 읽는다
 * (supabase/migrations/20260925000000_site_feedback.sql).
 */

const TEXT_FIELD_MAX = 200; // page·apartmentName
const USER_AGENT_MAX = 300;
const APARTMENT_ID_RE = /^(ah|ap)-\d+$/;
const FEEDBACK_STATUSES = ["new", "done"];

type UserRecord = { email?: string; name?: string; status?: string };

export default withHandler({
  method: ["GET", "POST", "PATCH", "DELETE"],
  cors: {},
  handler: { POST: handlePost, GET: handleGet, PATCH: handlePatch, DELETE: handleDelete },
});

function tooMany(res: any, retryAfter: number) {
  res.setHeader("Retry-After", String(retryAfter));
  return res.status(429).json({ ok: false, error: `요청이 너무 많습니다. ${retryAfter}초 후 다시 시도해주세요.` });
}

/** 선택 문자열 칸 — 없으면 null, 문자열이 아니거나 너무 길면 undefined(= 400). */
function optionalText(v: unknown, max: number): string | null | undefined {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (t.length > max) return undefined;
  return t || null;
}

async function handlePost(req: any, res: any) {
  const rl = await checkRateLimit(req, "feedback");
  if (rl.limited) return tooMany(res, rl.retryAfter);

  // ── 1. 로그인 손님 확인 (api/auth/kakao-consent.ts 와 같은 순서: 서명 → 블랙리스트 → KV 사용자) ──
  const auth = req.headers?.authorization;
  if (typeof auth !== "string" || !auth.startsWith("Bearer ")) {
    return res.status(401).json({ ok: false, error: "로그인이 필요합니다" });
  }
  const token = auth.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ ok: false, error: "유효하지 않은 토큰입니다" });
  }
  // refresh 토큰(30일)은 access 대용으로 쓰지 못하게 한다 — verify.ts handleRefresh 전용.
  if (payload.type === "refresh" || typeof payload.email !== "string" || !payload.email.trim()) {
    return res.status(401).json({ ok: false, error: "유효하지 않은 토큰입니다" });
  }
  if (await isBlacklisted(token)) {
    return res.status(401).json({ ok: false, error: "로그아웃된 토큰입니다" });
  }
  const email = payload.email.toLowerCase().trim();
  const user = (await kv.get(`user:${email}`)) as UserRecord | null;
  if (!user) {
    return res.status(401).json({ ok: false, error: "사용자를 찾을 수 없습니다" });
  }
  if (isUserAccessDenied(user)) {
    return res.status(403).json({ ok: false, error: "접근 권한이 없습니다" });
  }

  // ── 2. 본문 검증 ──
  const { kind, message, consent, page, apartmentId, apartmentName } = req.body || {};
  if (!isFeedbackKind(kind)) {
    return res.status(400).json({ ok: false, error: "의견 종류를 골라주세요" });
  }
  const text = typeof message === "string" ? message.trim() : "";
  if (text.length < 1 || text.length > FEEDBACK_MESSAGE_MAX) {
    return res.status(400).json({ ok: false, error: `내용은 1~${FEEDBACK_MESSAGE_MAX}자로 적어주세요` });
  }
  // 개인정보 수집·이용 동의 (PIPA §15) — consults.ts 와 같이 true 만 통과.
  if (consent !== true) {
    return res.status(400).json({ ok: false, error: "개인정보 수집·이용 동의가 필요합니다" });
  }
  const pageText = optionalText(page, TEXT_FIELD_MAX);
  const aptName = optionalText(apartmentName, TEXT_FIELD_MAX);
  if (pageText === undefined || aptName === undefined) {
    return res.status(400).json({ ok: false, error: "화면 정보가 올바르지 않습니다" });
  }
  let aptId: string | null = null;
  if (apartmentId !== undefined && apartmentId !== null && apartmentId !== "") {
    if (typeof apartmentId !== "string" || !APARTMENT_ID_RE.test(apartmentId)) {
      return res.status(400).json({ ok: false, error: "단지 정보가 올바르지 않습니다" });
    }
    aptId = apartmentId;
  }
  const uaRaw = req.headers?.["user-agent"];
  const userAgent = typeof uaRaw === "string" && uaRaw ? uaRaw.slice(0, USER_AGENT_MAX) : null;
  const userName = typeof user.name === "string" && user.name ? user.name : typeof payload.name === "string" ? payload.name : null;
  const now = new Date().toISOString();

  // ── 3. 저장 (service key — 공개 anon 열쇠로는 이 표를 못 본다) ──
  let id: number;
  try {
    const sb = getMibuyangSupabase();
    const { data, error } = await sb
      .from("site_feedback")
      .insert({
        user_email: email,
        user_name: userName,
        kind,
        message: text,
        page: pageText,
        apartment_id: aptId,
        apartment_name: aptName,
        user_agent: userAgent,
        consent_at: now,
      })
      .select("id")
      .single();
    if (error) throw error;
    id = (data as { id: number }).id;
  } catch (err) {
    console.error("feedback insert error:", err instanceof Error ? err.message : (err as any)?.message ?? err);
    return res.status(500).json({ ok: false, error: "의견 저장에 실패했습니다" });
  }

  // ── 4. 텔레그램 알림 — 실패해도 저장은 끝났으므로 201. 서버리스는 응답 뒤 실행이 멈출 수 있어 await 한다. ──
  try {
    const r = await sendTelegram(
      formatFeedbackAlert({
        kind,
        message: text,
        userName,
        userEmail: email,
        page: pageText,
        apartmentName: aptName,
        apartmentId: aptId,
        createdAt: now,
      })
    );
    if (!r.sent) console.warn("feedback telegram skipped:", r.reason);
  } catch (err) {
    console.warn("feedback telegram error:", err instanceof Error ? err.message : err);
  }

  return res.status(201).json({ ok: true, id });
}

/**
 * 관리자 게이트 공통 — 레이트 리밋(admin) → requireAdminGate(consults.ts 와 같은 단계별 401/403).
 * 통과하면 true. 막히면 응답을 이미 보냈고 false 를 돌려준다.
 */
async function adminGate(req: any, res: any): Promise<boolean> {
  const rl = await checkRateLimit(req, "admin");
  if (rl.limited) {
    tooMany(res, rl.retryAfter);
    return false;
  }
  const gate = await requireAdminGate(req);
  if (!gate.ok) {
    res.status(gate.status).json({ ok: false, error: gate.error });
    return false;
  }
  return true;
}

async function handleGet(req: any, res: any) {
  if (!(await adminGate(req, res))) return;

  const { limit, offset } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 50 });
  try {
    const sb = getMibuyangSupabase();
    const { data, error, count } = await sb
      .from("site_feedback")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false }) // tiebreaker — 같은 시각 페이징 순서 안정화
      .range(offset, offset + limit - 1);
    if (error) throw error;
    const mapped = (data || []).map((r: any) => ({
      id: r.id,
      userEmail: r.user_email,
      userName: r.user_name,
      kind: r.kind,
      message: r.message,
      page: r.page,
      apartmentId: r.apartment_id,
      apartmentName: r.apartment_name,
      userAgent: r.user_agent,
      status: r.status,
      createdAt: r.created_at,
      handledAt: r.handled_at,
    }));
    return res.status(200).json({ ok: true, data: mapped, count: count ?? 0 });
  } catch (err) {
    console.error("feedback list error:", err instanceof Error ? err.message : err);
    return res.status(500).json({ ok: false, error: "의견 목록 조회에 실패했습니다" });
  }
}

function parseId(raw: unknown): number | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const s = String(v ?? "");
  if (!/^\d+$/.test(s)) return null;
  const id = parseInt(s, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function handlePatch(req: any, res: any) {
  if (!(await adminGate(req, res))) return;

  const { id: rawId, status } = req.body || {};
  const id = parseId(rawId);
  if (id == null || typeof status !== "string" || !FEEDBACK_STATUSES.includes(status)) {
    return res.status(400).json({ ok: false, error: "유효한 의견 ID와 상태(new/done)가 필요합니다" });
  }
  try {
    const sb = getMibuyangSupabase();
    const { data, error } = await sb
      .from("site_feedback")
      .update({ status, handled_at: status === "done" ? new Date().toISOString() : null })
      .eq("id", id)
      .select("id");
    if (error) throw error;
    if (!data || data.length === 0) {
      return res.status(404).json({ ok: false, error: "의견을 찾을 수 없습니다" });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("feedback update error:", err instanceof Error ? err.message : err);
    return res.status(500).json({ ok: false, error: "처리 상태 변경에 실패했습니다" });
  }
}

async function handleDelete(req: any, res: any) {
  if (!(await adminGate(req, res))) return;

  const id = parseId(req.query?.id ?? (req.body || {}).id);
  if (id == null) {
    return res.status(400).json({ ok: false, error: "유효한 의견 ID가 필요합니다" });
  }
  try {
    const sb = getMibuyangSupabase();
    const { error } = await sb.from("site_feedback").delete().eq("id", id);
    if (error) throw error;
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("feedback delete error:", err instanceof Error ? err.message : err);
    return res.status(500).json({ ok: false, error: "의견 삭제에 실패했습니다" });
  }
}
