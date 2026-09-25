import { useState, useCallback, useEffect, useRef } from "react";
import type { FeedbackContext } from "./useFeedback";

/**
 * 업체 문의(시행사·분양업체) 상태·전송 (세션 577 A-12).
 *
 * 문의 모달(FeedbackForm)의 "🏢 업체 문의" 탭이 쓴다. 로그인 없이 보낼 수 있다.
 * 저장 = POST /api/consults (consultType "업체문의") — consults 표에 회사명 칸이 없어 회사·이메일·단지는
 * message 첫 줄들에 적는다(buildBizInquiryMessage). 서버가 저장 뒤 사장님 텔레그램으로 알린다.
 *
 * 상세 모달에서 열리면(문맥에 단지가 있으면) 관련 단지 칸을 그 단지명으로 채우고 interestedApts 에 id 를 싣는다.
 * 손님이 단지 칸을 고쳐 쓰면 그 id 는 더는 싣지 않는다(이름과 id 가 어긋나지 않게).
 */

/** 칸별 최대 글자 수 — message 조합 최대 길이 457 < 서버 자르기 500 (buildBizInquiryMessage 시험이 지킨다) */
export const BIZ_LIMITS = { company: 50, contact: 50, email: 80, apartment: 60, content: 250 } as const;
export const BIZ_CONTENT_MIN = 10;
/** api/consults.ts PHONE_REGEX 와 같은 규칙 — 공백을 뺀 뒤 검사 */
export const BIZ_PHONE_REGEX = /^[\d-]{8,20}$/;

export const BIZ_CONSENT_TEXT =
  "연락을 위해 회사명·담당자·연락처·이메일·문의 내용을 저장하는 데 동의합니다 (1년 뒤 자동 삭제)";
export const BIZ_SENT_TOAST = "문의를 보냈어요. 곧 연락드릴게요";
export const BIZ_TOO_MANY_TOAST = "요청이 많아요. 잠시 뒤 다시 보내 주세요";
export const BIZ_FAIL_TOAST = "문의를 보내지 못했어요. 잠시 뒤 다시 시도해 주세요";

/** consults.message 에 담는 글 — 첫 세 줄이 회사·이메일·단지, 빈 줄 뒤 본문. 빈 칸은 "-" */
export function buildBizInquiryMessage({
  company,
  email,
  apartment,
  content,
}: {
  company: string;
  email: string;
  apartment: string;
  content: string;
}): string {
  return `회사: ${company.trim()}\n이메일: ${email.trim() || "-"}\n단지: ${apartment.trim() || "-"}\n\n${content.trim()}`;
}

type UseBizInquiryArgs = {
  showToast: (_msg: string) => void;
  /** 문의 모달이 열려 있나 — 열릴 때 문맥의 단지로 단지 칸을 채운다 */
  open: boolean;
  context: FeedbackContext;
  /** 전송 성공 뒤 모달 닫기 */
  onSent: () => void;
};

export function useBizInquiry({ showToast, open, context, onSent }: UseBizInquiryArgs) {
  const [company, setCompany] = useState("");
  const [contact, setContact] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [apartment, setApartmentState] = useState("");
  const [content, setContent] = useState("");
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  /** 문맥에서 자동으로 채운 단지 — 칸 글자가 이 이름 그대로일 때만 id 를 싣는다 */
  const autoApt = useRef<{ id: string | null; name: string } | null>(null);
  /** 효과 안에서 지금 단지 칸 글자를 읽는다(칸을 deps 에 넣으면 타이핑마다 효과가 돈다) — 쓰는 곳에서 함께 갱신 */
  const apartmentRef = useRef("");
  const setApartment = useCallback((v: string) => {
    apartmentRef.current = v;
    setApartmentState(v);
  }, []);

  // 열릴 때: 문맥에 단지가 있으면 단지 칸이 비었거나 전에 자동으로 채운 값일 때만 새 단지로 바꾼다.
  // 문맥에 단지가 없으면 전에 자동으로 채운 값만 비운다(손님이 직접 쓴 글은 건드리지 않는다).
  useEffect(() => {
    if (!open) return;
    const cur = apartmentRef.current;
    const wasAuto = autoApt.current != null && cur === autoApt.current.name;
    const name = (context.apartmentName || "").slice(0, BIZ_LIMITS.apartment);
    if (name) {
      if (cur === "" || wasAuto) {
        autoApt.current = { id: context.apartmentId ?? null, name };
        setApartment(name);
      }
    } else if (wasAuto) {
      autoApt.current = null;
      setApartment("");
    }
  }, [open, context.apartmentId, context.apartmentName, setApartment]);

  const c = company.trim();
  const n = contact.trim();
  const ph = phone.replace(/\s/g, "");
  const len = content.trim().length;
  const canSubmit =
    !submitting &&
    consent &&
    c.length >= 1 &&
    c.length <= BIZ_LIMITS.company &&
    n.length >= 1 &&
    n.length <= BIZ_LIMITS.contact &&
    BIZ_PHONE_REGEX.test(ph) &&
    email.trim().length <= BIZ_LIMITS.email &&
    apartment.trim().length <= BIZ_LIMITS.apartment &&
    len >= BIZ_CONTENT_MIN &&
    len <= BIZ_LIMITS.content;

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    const auto = autoApt.current;
    const interestedApts = auto?.id && apartment.trim() === auto.name ? [auto.id] : [];
    setSubmitting(true);
    try {
      const r = await fetch("/api/consults", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: contact.trim(),
          phone: phone.trim(),
          consultType: "업체문의",
          interestedApts,
          consent: true,
          message: buildBizInquiryMessage({ company, email, apartment, content }),
        }),
      });
      if (r.status === 201) {
        setCompany("");
        setContact("");
        setPhone("");
        setEmail("");
        setApartment("");
        setContent("");
        setConsent(false);
        autoApt.current = null;
        onSent();
        showToast(BIZ_SENT_TOAST);
        return;
      }
      if (r.status === 429) {
        showToast(BIZ_TOO_MANY_TOAST);
        return;
      }
      const j = (await r.json().catch(() => null)) as { error?: string } | null;
      showToast(j?.error || BIZ_FAIL_TOAST);
    } catch {
      showToast("서버에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요");
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, company, contact, phone, email, apartment, content, onSent, showToast, setApartment]);

  return {
    company,
    setCompany,
    contact,
    setContact,
    phone,
    setPhone,
    email,
    setEmail,
    apartment,
    setApartment,
    content,
    setContent,
    consent,
    setConsent,
    submitting,
    canSubmit,
    submit,
  };
}

export type BizInquiryState = ReturnType<typeof useBizInquiry>;
