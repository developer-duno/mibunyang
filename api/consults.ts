import { getMibuyangSupabase } from "./_lib/supabase.js";
import { checkRateLimit } from "./_lib/rateLimit.js";
import { requireAdminGate } from "./_lib/adminAuth.js";
import { parsePagination } from "./_lib/validators.js";
import { withHandler } from "./_lib/handler.js";
import { sendTelegram, formatConsultAlert } from "./_lib/telegram.js";

// 세션 577(A-12): "업체문의" = 문의 모달의 🏢 업체 문의 탭(시행사·분양업체, 로그인 불필요). 회사·이메일·단지는
// message 안에 적혀 온다(consults 표 컬럼 추가 없음). 저장 뒤 사장님 텔레그램 알림 — 다른 유형은 알림 없음.
const VALID_CONSULT_TYPES = ["방문상담", "전화상담", "온라인상담", "업체문의"];
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

  const savedName = name.trim();
  const savedPhone = phone.trim();
  const savedApts = interestedApts.map(String).slice(0, 20);
  const savedMessage = typeof message === "string" ? message.trim().slice(0, 500) : null;
  try {
    // 세션566: 공개 열쇠(anon) 대신 service key 로 저장한다 — anon INSERT 정책을 지웠다.
    // 이 DB 의 anon key 는 자매 사이트(2u.pe.kr) 번들에 공개돼 있어, 정책이 있으면 누구나
    // 이 API 의 검증·레이트리밋을 건너뛰고 표에 직접 넣을 수 있었다(보안 고문 경고 0024).
    const sb = getMibuyangSupabase();
    const { error } = await sb.from("consults").insert({
      name: savedName,
      phone: savedPhone,
      interested_apts: savedApts,
      budget_min: parsedMin,
      budget_max: parsedMax,
      consult_type: consultType || "방문상담",
      message: savedMessage,
      consent_at: new Date().toISOString(),
    });
    if (error) throw error;
  } catch (err) {
    console.error("consult insert error:", err instanceof Error ? err.message : err);
    return res.status(500).json({ ok: false, error: "상담 신청 저장에 실패했습니다" });
  }

  // 업체 문의만 텔레그램 알림 (feedback.ts 패턴) — 실패해도 저장은 끝났으므로 201.
  // 서버리스는 응답 뒤 실행이 멈출 수 있어 await 한다.
  if (consultType === "업체문의") {
    try {
      const r = await sendTelegram(
        formatConsultAlert({ name: savedName, phone: savedPhone, message: savedMessage ?? "", interestedApts: savedApts })
      );
      if (!r.sent) console.warn("consult telegram skipped:", r.reason);
    } catch (err) {
      console.warn("consult telegram error:", err instanceof Error ? err.message : err);
    }
  }

  return res.status(201).json({ ok: true });
}

async function handleGet(req: any, res: any) {
  // 세션 465: 관리자 PII 열람도 rate limit — 자매 admin 엔드포인트(users/review/collector-status)의
  // rateLimit:"admin"(30회/5분)과 정합. withHandler 는 method 별 rateLimit 미지원이라 POST 수동 패턴 답습.
  const rateLimitResult = await checkRateLimit(req, "admin");
  if (rateLimitResult.limited) {
    res.setHeader("Retry-After", String(rateLimitResult.retryAfter));
    return res
      .status(429)
      .json({ ok: false, error: `요청이 너무 많습니다. ${rateLimitResult.retryAfter}초 후 다시 시도해주세요.` });
  }

  // 세션 405: 상담 열람 = 관리자 단독 (expert role 폐지 — 잔존 expert 토큰도 차단).
  // 단계별 응답(401 인증/토큰/로그아웃 + 403 Forbidden)은 requireAdminGate 가 그대로 보존.
  const gate = await requireAdminGate(req);
  if (!gate.ok) {
    return res.status(gate.status).json({ ok: false, error: gate.error });
  }

  // 페이지네이션 — limit/offset 쿼리 파라미터 (admin/users.ts 와 공용 헬퍼)
  const { limit, offset } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 100 });

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
  // 세션 465: 파기(DELETE)도 열람(GET)과 동일 rate limit (미들웨어 순서 RateLimit→Admin 유지)
  const rateLimitResult = await checkRateLimit(req, "admin");
  if (rateLimitResult.limited) {
    res.setHeader("Retry-After", String(rateLimitResult.retryAfter));
    return res
      .status(429)
      .json({ ok: false, error: `요청이 너무 많습니다. ${rateLimitResult.retryAfter}초 후 다시 시도해주세요.` });
  }

  const gate = await requireAdminGate(req);
  if (!gate.ok) {
    return res.status(gate.status).json({ ok: false, error: gate.error });
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
