// /api/subscribers - 분양 시작 알림 신청 (POST) + 철회 (DELETE)
// spec: docs/superpowers/specs/2026-05-02-upcoming-presale-page-design.md
// RLS: anon-only INSERT, service_role-only SELECT/UPDATE

import crypto from "crypto";
import { getMibuyangSupabase } from "./_lib/supabase.js";
import { withHandler } from "./_lib/handler.js";

const PHONE_RE = /^01[0-9]-?\d{3,4}-?\d{4}$/;
const REGION_RE = /^[\uac00-\ud7a3]{2,15}$/;
const APT_ID_RE = /^[a-z]+-\d+$/i;
const SUBSCRIBER_CONFLICT_TARGET = "phone,region_key,gu_key,apartment_key";

export default withHandler({
  method: ["POST", "DELETE"],
  cors: {},
  rateLimit: "subscribers",
  handler: { POST: handlePost, DELETE: handleDelete },
});

async function handlePost(req, res) {
  const { phone, region, gu, apartment_id, consent } = req.body || {};
  const regionValue = normalizeOptionalString(region);
  const guValue = normalizeOptionalString(gu);
  const apartmentIdValue = normalizeOptionalString(apartment_id);

  if (consent !== true) {
    return res.status(400).json({ ok: false, error: "개인정보 동의가 필요합니다" });
  }
  if (!phone || typeof phone !== "string" || !PHONE_RE.test(phone.trim())) {
    return res.status(400).json({ ok: false, error: "올바른 휴대폰 번호를 입력해주세요" });
  }
  if (regionValue && (typeof regionValue !== "string" || !REGION_RE.test(regionValue))) {
    return res.status(400).json({ ok: false, error: "올바른 지역을 선택해주세요" });
  }
  if (guValue && (typeof guValue !== "string" || !REGION_RE.test(guValue))) {
    return res.status(400).json({ ok: false, error: "올바른 시군구를 선택해주세요" });
  }
  if (apartmentIdValue && (typeof apartmentIdValue !== "string" || !APT_ID_RE.test(apartmentIdValue))) {
    return res.status(400).json({ ok: false, error: "올바른 단지 ID가 아닙니다" });
  }

  const e164 = normalizeToE164(phone);
  if (!e164) {
    return res.status(400).json({ ok: false, error: "휴대폰 번호 정규화 실패" });
  }

  try {
    const sb = getMibuyangSupabase();
    const { error } = await sb
      .from("subscribers")
      .upsert(
        {
          phone: e164,
          region: regionValue,
          gu: guValue,
          apartment_id: apartmentIdValue,
          consent_at: new Date().toISOString(),
          consent_source: "upcoming-page",
          opt_out_at: null,
        },
        { onConflict: SUBSCRIBER_CONFLICT_TARGET }
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

export function normalizeToE164(phone) {
  if (!phone || typeof phone !== "string") return null;
  const digits = phone.replace(/\D/g, "");
  if (!/^010\d{7,8}$/.test(digits) && !/^01[16-9]\d{6,8}$/.test(digits)) return null;
  return `+82${digits.slice(1)}`;
}

function normalizeOptionalString(value) {
  if (value == null) return null;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed || null;
}
