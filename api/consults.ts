import { getSupabase, getMibuyangSupabase } from "./_lib/supabase.js";
import { checkRateLimit } from "./_lib/rateLimit.js";
import { verifyToken } from "./_lib/auth.js";
import { isBlacklisted } from "./_lib/tokenBlacklist.js";
import { withHandler } from "./_lib/handler.js";

const VALID_CONSULT_TYPES = ["방문상담", "전화상담", "온라인상담"];
const PHONE_REGEX = /^[\d\-]{8,20}$/;

export default withHandler({
  method: ["GET", "POST", "DELETE"],
  cors: {},
  handler: { POST: handlePost, GET: handleGet, DELETE: handleDelete },
});

async function handlePost(req: any, res: any) {
  const rateLimitResult = await checkRateLimit(req, "consult");
  if (rateLimitResult.limited) {
    const retryAfter = rateLimitResult.retryAfter;
    res.setHeader("Retry-After", String(retryAfter));
    return res.status(429).json({ ok: false, error: `요청이 너무 많습니다. ${retryAfter}초 후 다시 시도해주세요.` });
  }

  const { name, phone, interestedApts, budgetMin, budgetMax, consultType, message, consent } = req.body || {};

  // 개인정보 수집·이용 동의 (PIPA §15) — subscribers.ts 패턴 답습. 동의 없으면 수집 거부.
  if (consent !== true) {
    return res.status(400).json({ ok: false, error: "개인정보 수집·이용 동의가 필요합니다" });
  }

  // 입력 검증
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ ok: false, error: "이름을 입력해주세요" });
  }
  if (name.trim().length > 50) {
    return res.status(400).json({ ok: false, error: "이름은 50자 이내로 입력해주세요" });
  }
  if (!phone || typeof phone !== "string" || !PHONE_REGEX.test(phone.replace(/\s/g, ""))) {
    return res.status(400).json({ ok: false, error: "올바른 연락처를 입력해주세요" });
  }
  if (consultType && !VALID_CONSULT_TYPES.includes(consultType)) {
    return res.status(400).json({ ok: false, error: "올바른 상담 유형을 선택해주세요" });
  }
  if (!Array.isArray(interestedApts)) {
    return res.status(400).json({ ok: false, error: "관심 단지 목록이 올바르지 않습니다" });
  }

  const parsedMin = budgetMin ? parseInt(budgetMin, 10) || null : null;
  const parsedMax = budgetMax ? parseInt(budgetMax, 10) || null : null;
  if (parsedMin != null && parsedMax != null && parsedMin > parsedMax) {
    return res.status(400).json({ ok: false, error: "예산 범위가 올바르지 않습니다" });
  }

  try {
    const sb = getSupabase();
    const { error } = await sb.from("consults").insert({
      name: name.trim(),
      phone: phone.trim(),
      interested_apts: interestedApts.map(String).slice(0, 20),
      budget_min: parsedMin,
      budget_max: parsedMax,
      consult_type: consultType || "방문상담",
      message: typeof message === "string" ? message.trim().slice(0, 500) : null,
      consent_at: new Date().toISOString(),
    });
    if (error) throw error;
    return res.status(201).json({ ok: true });
  } catch (err) {
    console.error("consult insert error:", err instanceof Error ? err.message : err);
    return res.status(500).json({ ok: false, error: "상담 신청 저장에 실패했습니다" });
  }
}

async function handleGet(req: any, res: any) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    return res.status(401).json({ ok: false, error: "인증이 필요합니다" });
  }
  const token = auth.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ ok: false, error: "유효하지 않은 토큰입니다" });
  }
  if (await isBlacklisted(token)) {
    return res.status(401).json({ ok: false, error: "로그아웃된 토큰입니다" });
  }

  // 세션 405: 상담 열람 = 관리자 단독 (expert role 폐지 — 잔존 expert 토큰도 차단)
  if (payload.role !== "admin") {
    return res.status(403).json({ ok: false, error: "Forbidden" });
  }

  // 페이지네이션 — limit/offset 쿼리 파라미터 (admin/users.ts 클램프 패턴 답습)
  const query = req.query ?? {};
  const limitRaw = Array.isArray(query.limit) ? query.limit[0] : query.limit;
  const offsetRaw = Array.isArray(query.offset) ? query.offset[0] : query.offset;
  const limit = Math.min(Math.max(parseInt(String(limitRaw ?? "")) || 50, 1), 100);
  const offset = Math.max(parseInt(String(offsetRaw ?? "")) || 0, 0);

  try {
    const sb = getMibuyangSupabase();
    const { data, error, count } = await sb
      .from("consults")
      .select("*", { count: "exact" })
      .order("submitted_at", { ascending: false })
      .order("id", { ascending: false }) // tiebreaker — submitted_at 동일값 페이징 순서 안정화
      .range(offset, offset + limit - 1);
    if (error) throw error;

    // snake_case → camelCase 변환
    const mapped = (data || []).map((r: any) => ({
      id: r.id,
      name: r.name,
      phone: r.phone,
      interestedApts: r.interested_apts || [],
      budgetMin: r.budget_min,
      budgetMax: r.budget_max,
      consultType: r.consult_type,
      message: r.message,
      status: r.status,
      submittedAt: r.submitted_at,
    }));

    return res.status(200).json({ ok: true, data: mapped, count: count ?? 0 });
  } catch (err) {
    console.error("consult list error:", err);
    return res.status(500).json({ ok: false, error: "상담 목록 조회에 실패했습니다" });
  }
}

// 상담 기록 삭제 = 관리자 단독 (개인정보 파기 — PIPA §21 보유기간 경과/요청 시 파기).
// handleGet 과 동일 게이트(Bearer + verifyToken + isBlacklisted + role==="admin").
async function handleDelete(req: any, res: any) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    return res.status(401).json({ ok: false, error: "인증이 필요합니다" });
  }
  const token = auth.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ ok: false, error: "유효하지 않은 토큰입니다" });
  }
  if (await isBlacklisted(token)) {
    return res.status(401).json({ ok: false, error: "로그아웃된 토큰입니다" });
  }
  if (payload.role !== "admin") {
    return res.status(403).json({ ok: false, error: "Forbidden" });
  }

  // id 검증 — SERIAL PK (양의 정수). query 또는 body 어디서든 받되 정수만 허용.
  const rawId = req.query?.id ?? (req.body || {}).id;
  const id = parseInt(String(Array.isArray(rawId) ? rawId[0] : rawId ?? ""), 10);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ ok: false, error: "유효한 상담 ID가 필요합니다" });
  }

  try {
    const sb = getMibuyangSupabase();
    const { error } = await sb.from("consults").delete().eq("id", id);
    if (error) throw error;
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("consult delete error:", err instanceof Error ? err.message : err);
    return res.status(500).json({ ok: false, error: "상담 기록 삭제에 실패했습니다" });
  }
}
