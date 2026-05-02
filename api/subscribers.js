// /api/subscribers — 분양 시작 알림 신청 (POST) + 철회 (DELETE)
// spec: docs/superpowers/specs/2026-05-02-upcoming-presale-page-design.md § 3-2·3-3
// RLS: anon-only INSERT, service_role-only SELECT/UPDATE (휴대폰 정보 보호)

import crypto from "crypto";
import { getMibuyangSupabase } from "./_lib/supabase.js";
import { withHandler } from "./_lib/handler.js";

const PHONE_RE = /^01[0-9]-?\d{3,4}-?\d{4}$/;
const REGION_RE = /^[가-힣]{2,15}$/;
const APT_ID_RE = /^[a-z]+-\d+$/i;

export default withHandler({
  method: ["POST", "DELETE"],
  cors: {},
  rateLimit: "subscribers",
  handler: { POST: handlePost, DELETE: handleDelete },
});

// POST — 알림 신청 (anon 가능)
async function handlePost(req, res) {
  const { phone, region, gu, apartment_id, consent } = req.body || {};

  if (consent !== true) {
    return res.status(400).json({ ok: false, error: "개인정보 동의가 필요합니다" });
  }
  if (!phone || typeof phone !== "string" || !PHONE_RE.test(phone.trim())) {
    return res.status(400).json({ ok: false, error: "올바른 휴대폰 번호를 입력해주세요" });
  }
  if (region && (typeof region !== "string" || !REGION_RE.test(region))) {
    return res.status(400).json({ ok: false, error: "올바른 지역을 선택해주세요" });
  }
  if (gu && (typeof gu !== "string" || !REGION_RE.test(gu))) {
    return res.status(400).json({ ok: false, error: "올바른 시군구를 선택해주세요" });
  }
  if (apartment_id && (typeof apartment_id !== "string" || !APT_ID_RE.test(apartment_id))) {
    return res.status(400).json({ ok: false, error: "올바른 단지 ID 가 아닙니다" });
  }

  const e164 = normalizeToE164(phone);
  if (!e164) {
    return res.status(400).json({ ok: false, error: "휴대폰 번호 정규화 실패" });
  }

  try {
    const sb = getMibuyangSupabase();

    // UNIQUE 제약 (phone, region, gu, apartment_id) → upsert
    const { error } = await sb
      .from("subscribers")
      .upsert(
        {
          phone: e164,
          region: region || null,
          gu: gu || null,
          apartment_id: apartment_id || null,
          consent_at: new Date().toISOString(),
          consent_source: "upcoming-page",
          opt_out_at: null, // 재가입 시 철회 해제
        },
        { onConflict: "phone,region,gu,apartment_id" }
      );

    if (error) {
      console.error("[/api/subscribers POST] supabase error:", error.message);
      return res.status(500).json({ ok: false, error: "구독 신청 실패" });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[/api/subscribers POST] handler error:", e.message);
    return res.status(500).json({ ok: false, error: "서버 오류" });
  }
}

// DELETE — 알림 철회 (HMAC 토큰 검증)
async function handleDelete(req, res) {
  const { phone, token } = req.body || {};

  if (!phone || typeof phone !== "string") {
    return res.status(400).json({ ok: false, error: "휴대폰 번호가 필요합니다" });
  }
  if (!token || typeof token !== "string") {
    return res.status(400).json({ ok: false, error: "인증 토큰이 필요합니다" });
  }

  const e164 = normalizeToE164(phone);
  if (!e164) {
    return res.status(400).json({ ok: false, error: "휴대폰 번호 정규화 실패" });
  }

  // HMAC 검증
  const secret = process.env.SUBSCRIBERS_OPT_OUT_SECRET;
  if (!secret) {
    console.error("[/api/subscribers DELETE] SUBSCRIBERS_OPT_OUT_SECRET 환경변수 미설정");
    return res.status(500).json({ ok: false, error: "서버 설정 오류" });
  }
  const expected = Buffer.from(crypto.createHmac("sha256", secret).update(e164).digest("hex"), "hex");
  const provided = Buffer.from(token, "hex");
  if (provided.length !== expected.length) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  if (!crypto.timingSafeEqual(provided, expected)) {
    return res.status(401).json({ ok: false, error: "인증 실패" });
  }

  try {
    const sb = getMibuyangSupabase();
    const { error } = await sb
      .from("subscribers")
      .update({ opt_out_at: new Date().toISOString() })
      .eq("phone", e164);

    if (error) {
      console.error("[/api/subscribers DELETE] supabase error:", error.message);
      return res.status(500).json({ ok: false, error: "철회 처리 실패" });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[/api/subscribers DELETE] handler error:", e.message);
    return res.status(500).json({ ok: false, error: "서버 오류" });
  }
}

/**
 * 한국 휴대폰 번호 → E.164 ("+821012345678")
 * 입력: "010-1234-5678", "01012345678", "010 1234 5678"
 * @returns {string|null} E.164 또는 실패 시 null
 */
export function normalizeToE164(phone) {
  if (!phone || typeof phone !== "string") return null;
  const digits = phone.replace(/\D/g, "");
  if (!/^010\d{7,8}$/.test(digits) && !/^01[16-9]\d{6,8}$/.test(digits)) return null;
  return `+82${digits.slice(1)}`;
}
