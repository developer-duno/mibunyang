import { getSupabase } from "./_lib/supabase.js";
import { checkRateLimit } from "./_lib/rateLimit.js";
import { verifyToken } from "./_lib/auth.js";
import { handleCors } from "./_lib/cors.js";

const VALID_CONSULT_TYPES = ["방문상담", "전화상담", "온라인상담"];
const PHONE_REGEX = /^[\d\-]{8,20}$/;

export default async function handler(req, res) {
  if (handleCors(req, res, { methods: "GET, POST, OPTIONS" })) return;

  if (req.method === "POST") return handlePost(req, res);
  if (req.method === "GET") return handleGet(req, res);
  return res.status(405).json({ ok: false, error: "Method not allowed" });
}

// POST — 소비자 상담 신청 (인증 불필요, Rate Limit 적용)
async function handlePost(req, res) {
  const { limited, retryAfter } = await checkRateLimit(req, "consult");
  if (limited) {
    res.setHeader("Retry-After", String(retryAfter));
    return res.status(429).json({ ok: false, error: `요청이 너무 많습니다. ${retryAfter}초 후 다시 시도해주세요.` });
  }

  const { name, phone, interestedApts, budgetMin, budgetMax, consultType, message } = req.body || {};

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
    });
    if (error) throw error;
    return res.status(201).json({ ok: true });
  } catch (err) {
    console.error("consult insert error:", err);
    return res.status(500).json({ ok: false, error: "상담 신청 저장에 실패했습니다" });
  }
}

// GET — 전문가 상담 목록 조회 (JWT 인증 필수)
async function handleGet(req, res) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    return res.status(401).json({ ok: false, error: "인증이 필요합니다" });
  }
  const payload = verifyToken(auth.slice(7));
  if (!payload) {
    return res.status(401).json({ ok: false, error: "유효하지 않은 토큰입니다" });
  }

  try {
    const sb = getSupabase();
    const { data, error, count } = await sb
      .from("consults")
      .select("*", { count: "exact" })
      .order("submitted_at", { ascending: false })
      .limit(100);
    if (error) throw error;

    // snake_case → camelCase 변환
    const mapped = (data || []).map(r => ({
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

    return res.status(200).json({ ok: true, data: mapped, count });
  } catch (err) {
    console.error("consult list error:", err);
    return res.status(500).json({ ok: false, error: "상담 목록 조회에 실패했습니다" });
  }
}
