import { memo } from "react";
import type { Dispatch, SetStateAction } from "react";
import { C, F } from "@/theme";
import { IconClose } from "./icons";
import type { CompareItem } from "@/types/components";
import type { ConsultForm as ConsultFormState } from "@/hooks/useConsult";

type ConsultFormProps = {
  scored: CompareItem[];
  favoriteIds: string[];
  setFavoriteIds: (_idsOrFn: string[] | ((_prev: string[]) => string[])) => void;
  form: ConsultFormState;
  setForm: Dispatch<SetStateAction<ConsultFormState>>;
  onSubmit: () => void;
  submitted: boolean;
  showToast: (_msg: string) => void;
};

export const ConsultForm = memo(function ConsultForm({
  scored,
  favoriteIds,
  setFavoriteIds,
  form,
  setForm,
  onSubmit,
  submitted,
  showToast,
}: ConsultFormProps) {
  if (submitted) {
    return (
      <div style={{ padding: "0 16px" }}>
        <div
          style={{
            background: C.card,
            borderRadius: 12,
            padding: "40px 20px",
            border: `1px solid ${C.border}`,
            textAlign: "center",
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: "50%",
              background: C.greenLight,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 16px",
              fontSize: F.base,
              fontWeight: 800,
              color: C.green,
            }}
          >
            완료
          </div>
          <div style={{ fontSize: F.lg, fontWeight: 800, color: C.text, marginBottom: 8 }}>
            상담 신청이 완료되었습니다
          </div>
          <div style={{ fontSize: F.sm, color: C.sub, lineHeight: 1.8, marginBottom: 20 }}>
            신청자: {form.name}
            <br />
            연락처: {form.phone}
            <br />
            관심 단지: {favoriteIds.length}건<br />
            상담 유형: {form.consultType}
          </div>
          <div style={{ fontSize: F.sm, color: C.muted, marginBottom: 20 }}>
            전문 컨설턴트가 24시간 내 연락드립니다.
          </div>
        </div>
      </div>
    );
  }

  const updateField = (key: string, val: unknown) => setForm({ ...form, [key]: val });

  const handleSubmit = () => {
    if (!String(form.name ?? "").trim()) {
      showToast("이름을 입력해주세요");
      return;
    }
    if (!String(form.phone ?? "").trim()) {
      showToast("연락처를 입력해주세요");
      return;
    }
    if (favoriteIds.length === 0) {
      showToast("목록에서 관심매물을 1개 이상 추가해주세요");
      return;
    }
    if (form.consent !== true) {
      showToast("개인정보 수집·이용 동의가 필요합니다");
      return;
    }
    onSubmit();
  };

  const budgetDisplay = (v: unknown) => {
    const n = parseInt(String(v ?? ""), 10);
    if (!n || isNaN(n)) return "";
    return n >= 10000 ? `${(n / 10000).toFixed(1)}억` : `${n.toLocaleString("ko-KR")}만`;
  };

  const favItems = favoriteIds
    .map((id) => scored.find((x) => x.apt.id === id))
    .filter((item): item is CompareItem => Boolean(item));

  const inputStyle = {
    width: "100%",
    padding: "10px 12px",
    fontSize: F.base,
    border: `1px solid ${C.border}`,
    borderRadius: 6,
    background: C.white,
    color: C.text,
    boxSizing: "border-box" as const,
    minHeight: 42,
  };
  const labelStyle = { fontSize: F.sm, fontWeight: 700, color: C.text, marginBottom: 6, display: "block" };
  const sectionStyle = { marginBottom: 16 };

  return (
    <div style={{ padding: "0 16px" }}>
      <div
        style={{
          background: C.card,
          borderRadius: 12,
          padding: 16,
          border: `1px solid ${C.border}`,
          boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        }}
      >
        <div style={{ fontSize: F.md, fontWeight: 800, color: C.text, marginBottom: 4 }}>전문가 상담 신청</div>
        <div style={{ fontSize: F.sm, color: C.muted, marginBottom: 16 }}>
          분석 결과를 바탕으로 전문 컨설턴트와 상담하세요
        </div>

        <div style={sectionStyle}>
          <label htmlFor="consult-name" style={labelStyle}>
            이름 *
          </label>
          <input
            id="consult-name"
            type="text"
            placeholder="홍길동"
            value={form.name}
            onChange={(e) => updateField("name", e.target.value)}
            style={inputStyle}
          />
        </div>
        <div style={sectionStyle}>
          <label htmlFor="consult-phone" style={labelStyle}>
            연락처 *
          </label>
          <input
            id="consult-phone"
            type="tel"
            inputMode="tel"
            pattern="[0-9\-]+"
            placeholder="010-0000-0000"
            value={form.phone}
            onChange={(e) => updateField("phone", e.target.value)}
            style={inputStyle}
          />
        </div>

        <div style={sectionStyle}>
          <div style={labelStyle}>관심 단지 * ({favoriteIds.length}개)</div>
          {favItems.length === 0 ? (
            <div
              style={{ padding: "16px 12px", border: `1px dashed ${C.border}`, borderRadius: 6, textAlign: "center" }}
            >
              <div style={{ fontSize: F.sm, color: C.muted, lineHeight: 1.6 }}>
                목록에서 관심매물 버튼을 눌러
                <br />
                관심 단지를 추가해주세요
              </div>
            </div>
          ) : (
            <div style={{ border: `1px solid ${C.border}`, borderRadius: 6, background: C.bg, overflow: "hidden" }}>
              {favItems.map((item) => (
                <div
                  key={item.apt.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 12px",
                    borderBottom: `1px solid ${C.border}`,
                    background: C.indigoLight,
                  }}
                >
                  <span style={{ flex: 1, fontSize: F.sm, fontWeight: 700, color: C.text }}>{item.apt.name}</span>
                  <span style={{ fontSize: F.xs, color: C.muted }}>
                    {item.apt.region} · {item.res.total}점
                  </span>
                  <button
                    onClick={() => setFavoriteIds(favoriteIds.filter((x) => x !== item.apt.id))}
                    aria-label="관심단지 제거"
                    style={{
                      background: "none",
                      border: "none",
                      color: C.muted,
                      cursor: "pointer",
                      padding: "2px 4px",
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    <IconClose size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={sectionStyle}>
          <div style={labelStyle}>예산 범위 (만원)</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ flex: 1 }}>
              <input
                type="number"
                placeholder="최소"
                aria-label="최소 예산 (만원)"
                value={form.budgetMin}
                onChange={(e) => updateField("budgetMin", e.target.value)}
                style={{ ...inputStyle, textAlign: "center" }}
              />
              {form.budgetMin && (
                <div style={{ fontSize: F.micro, color: C.muted, textAlign: "center", marginTop: 2 }}>
                  {budgetDisplay(form.budgetMin)}
                </div>
              )}
            </div>
            <span style={{ color: C.muted, fontSize: F.sm }}>~</span>
            <div style={{ flex: 1 }}>
              <input
                type="number"
                placeholder="최대"
                aria-label="최대 예산 (만원)"
                value={form.budgetMax}
                onChange={(e) => updateField("budgetMax", e.target.value)}
                style={{ ...inputStyle, textAlign: "center" }}
              />
              {form.budgetMax && (
                <div style={{ fontSize: F.micro, color: C.muted, textAlign: "center", marginTop: 2 }}>
                  {budgetDisplay(form.budgetMax)}
                </div>
              )}
            </div>
          </div>
          {form.budgetMin && form.budgetMax && parseInt(form.budgetMin, 10) > parseInt(form.budgetMax, 10) && (
            <div style={{ fontSize: F.xs, color: C.red, marginTop: 4 }}>최소 예산이 최대보다 큽니다</div>
          )}
        </div>

        <div style={sectionStyle}>
          <div style={labelStyle}>상담 유형</div>
          <div role="group" aria-label="상담 유형 선택" style={{ display: "flex", gap: 6 }}>
            {["방문상담", "전화상담", "온라인상담"].map((t) => (
              <button
                key={t}
                onClick={() => updateField("consultType", t)}
                aria-pressed={form.consultType === t}
                style={{
                  flex: 1,
                  padding: "8px 4px",
                  fontSize: F.sm,
                  fontWeight: form.consultType === t ? 700 : 500,
                  minHeight: 38,
                  background: form.consultType === t ? C.indigoLight : C.slate100,
                  color: form.consultType === t ? C.indigo : C.slate600,
                  border: form.consultType === t ? `1.5px solid ${C.indigo}` : "1.5px solid transparent",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div style={sectionStyle}>
          <label htmlFor="consult-msg" style={labelStyle}>
            추가 메시지
          </label>
          <textarea
            id="consult-msg"
            placeholder="궁금한 점이나 요청 사항을 적어주세요"
            value={form.message}
            onChange={(e) => updateField("message", e.target.value)}
            rows={3}
            style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
          />
        </div>

        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 6,
            fontSize: F.xs,
            color: C.sub,
            margin: "4px 0 16px",
            cursor: "pointer",
            lineHeight: 1.5,
          }}
        >
          <input
            type="checkbox"
            checked={form.consent === true}
            onChange={(e) => updateField("consent", e.target.checked)}
            aria-required="true"
            style={{ marginTop: 2, minWidth: 16, minHeight: 16 }}
          />
          <span>
            <span style={{ color: C.red }} aria-hidden="true">
              *
            </span>{" "}
            상담 연결을 위해 이름·연락처 등 개인정보 수집·이용에 동의합니다.{" "}
            <a
              href="/privacy.html"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: C.indigo, textDecoration: "underline" }}
            >
              개인정보 처리방침
            </a>
            에 따라 보관·관리됩니다.
          </span>
        </label>

        <button
          onClick={handleSubmit}
          disabled={submitted}
          style={{
            width: "100%",
            padding: "14px",
            fontSize: F.base,
            fontWeight: 800,
            color: C.white,
            background: submitted ? C.muted : C.indigo,
            border: "none",
            borderRadius: 6,
            cursor: submitted ? "default" : "pointer",
            minHeight: 48,
          }}
        >
          상담 신청하기
        </button>
      </div>
    </div>
  );
});
