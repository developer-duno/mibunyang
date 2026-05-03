// 분양 시작 알림 신청 폼 — 휴대폰 + 관심지역 + 동의
// spec § 4-4 + § 6-3 (용어 풀이) + 접근성 (aria-required, aria-invalid)

import { memo, useState, useCallback, type FormEvent } from "react";
import { C, F } from "@/theme";
import { trackEvent } from "@/lib/analytics";
import type { SubscribeFormProps } from "@/types/components/SubscribeForm.types";

type SubscribeMessage = { type: "success" | "error"; text: string } | null;

const PHONE_RE = /^01[0-9]-?\d{3,4}-?\d{4}$/;
const REGIONS = ["서울특별시", "부산광역시", "대구광역시", "인천광역시", "광주광역시", "대전광역시", "울산광역시", "세종특별자치시", "경기도", "강원도", "충청북도", "충청남도", "전라북도", "전라남도", "경상북도", "경상남도", "제주특별자치도"];

export const SubscribeForm = memo(function SubscribeForm({ defaultRegion, defaultApt, onSuccess }: SubscribeFormProps) {
  const [phone, setPhone] = useState("");
  const [region, setRegion] = useState(defaultRegion || "");
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<SubscribeMessage>(null);

  const phoneInvalid = phone.length > 0 && !PHONE_RE.test(phone);

  const handleSubmit = useCallback(async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!consent) {
      setMessage({ type: "error", text: "개인정보 수집·이용 동의가 필요합니다" });
      return;
    }
    if (!PHONE_RE.test(phone.trim())) {
      setMessage({ type: "error", text: "올바른 휴대폰 번호를 입력해주세요 (예: 010-1234-5678)" });
      return;
    }

    setSubmitting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/subscribers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: phone.trim(),
          region: region || null,
          gu: null,
          apartment_id: defaultApt || null,
          consent: true,
        }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "신청 실패");

      setMessage({ type: "success", text: "알림 신청 완료! 분양 시작 시 카카오톡으로 안내드립니다." });
      setPhone("");
      setConsent(false);
      trackEvent("subscriber_signup", { region, hasApt: !!defaultApt });
      onSuccess?.();
    } catch (err) {
      setMessage({ type: "error", text: (err as Error)?.message || "신청 중 오류가 발생했습니다" });
    } finally {
      setSubmitting(false);
    }
  }, [phone, region, consent, defaultApt, onSuccess]);

  return (
    <form
      onSubmit={handleSubmit}
      style={{ background: C.redLight, border: `1px solid ${C.redBorder}`, borderRadius: 10, padding: 16 }}
    >
      <div style={{ fontSize: F.md, fontWeight: 700, color: C.red, marginBottom: 6 }}>
        🔔 분양 시작 알림 받기
      </div>
      <div style={{ fontSize: F.xs, color: C.muted, marginBottom: 12, lineHeight: 1.5 }}>
        관심 지역의 분양 시작 시 카카오 알림톡으로 알려드립니다. (수신 거부 언제든 가능)
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <label style={{ flex: 1, minWidth: 180 }}>
          <span style={{ display: "block", fontSize: F.xs, color: C.sub, marginBottom: 4 }}>
            휴대폰 <span style={{ color: C.red }} aria-hidden="true">*</span>
          </span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="010-1234-5678"
            aria-required="true"
            aria-invalid={phoneInvalid}
            disabled={submitting}
            style={{
              width: "100%", padding: "10px 12px", fontSize: F.base,
              border: `1px solid ${phoneInvalid ? C.red : C.border}`,
              borderRadius: 4, background: "white", minHeight: 44,
              boxSizing: "border-box",
            }}
          />
        </label>

        <label style={{ flex: 1, minWidth: 180 }}>
          <span style={{ display: "block", fontSize: F.xs, color: C.sub, marginBottom: 4 }}>관심 지역 (선택)</span>
          <select
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            disabled={submitting}
            style={{
              width: "100%", padding: "10px 12px", fontSize: F.base,
              border: `1px solid ${C.border}`, borderRadius: 4, background: "white",
              minHeight: 44, boxSizing: "border-box",
            }}
          >
            <option value="">전국</option>
            {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
      </div>

      <label style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: F.xs, color: C.sub, marginBottom: 12, cursor: "pointer", lineHeight: 1.5 }}>
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          disabled={submitting}
          aria-required="true"
          style={{ marginTop: 2, minWidth: 16, minHeight: 16 }}
        />
        <span>
          휴대폰 번호로 분양 시작 알림(카카오 알림톡)을 받는 데 동의합니다.
          개인정보보호 정책에 따라 보관·관리되며, 언제든지 알림을 거부할 수 있습니다.
        </span>
      </label>

      <button
        type="submit"
        disabled={submitting}
        style={{
          padding: "12px 24px", fontSize: F.base, fontWeight: 700,
          background: submitting ? C.muted : C.red, color: "white",
          border: "none", borderRadius: 4, cursor: submitting ? "wait" : "pointer",
          minHeight: 44, width: "100%",
        }}
      >{submitting ? "신청 중..." : "🔔 알림 받기"}</button>

      {message && (
        <div
          role="status"
          aria-live="polite"
          style={{
            marginTop: 10, padding: 10, fontSize: F.sm, borderRadius: 4,
            background: message.type === "success" ? C.greenLight : C.redLight,
            color: message.type === "success" ? C.green : C.red,
            border: `1px solid ${message.type === "success" ? C.greenBorder : C.redBorder}`,
          }}
        >
          {message.text}
        </div>
      )}
    </form>
  );
});
