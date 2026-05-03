// 용어 풀이 툴팁 — 분양예정 페이지 카드용 (spec § 5-3)
// hover/focus/tap 3가지 트리거 + ARIA aria-describedby
// 모바일에서는 tap=toggle, 데스크톱은 hover/focus

import { memo, useState, useId, useRef, useEffect, type ReactNode } from "react";
import { C, F } from "@/theme";

/**
 * 청약 표준 용어 풀이 사전 (spec § 5-3 + § 6-3)
 * 키워드 → 한 줄 설명. UpcomingCard 의 주택유형/공급유형 칩에 적용.
 */
export const TERM_GLOSSARY: Record<string, string> = {
  민영: "민간 건설사가 공급하는 주택. 가점제·추첨제 혼합.",
  공공: "공공기관이 공급하는 주택. 소득·자산 기준 적용.",
  국민: "국가·지자체·LH 등이 공급하는 주택. 무주택 우선.",
  "1순위": "청약통장 가입 1년+, 무주택 또는 1주택자.",
  "2순위": "1순위 미해당자. 가점·추첨 후순위.",
  특별공급: "신혼·다자녀·생애최초 등 우선 공급 물량.",
  도시형: "도시형 생활주택. 85㎡ 이하, 청약통장 불필요한 경우 多.",
  오피스텔: "주거용 오피스텔. 주택 수 산정 별도.",
  주상복합: "1층 이상 상업시설 + 상층 주거가 결합된 단지.",
  아파트: "공동주택의 대표 형태. 5층 이상.",
};

/**
 * 자유 형식 텍스트에서 용어 사전 키 추출
 * 예) "민영주택" → "민영", "도시형 생활주택" → "도시형"
 */
export function extractTerm(label: unknown): string | null {
  if (!label || typeof label !== "string") return null;
  for (const key of Object.keys(TERM_GLOSSARY)) {
    if (label.includes(key)) return key;
  }
  return null;
}

type TooltipProps = {
  term?: string;
  definition?: string;
  children: ReactNode;
};

export const Tooltip = memo(function Tooltip({ term, definition, children }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const containerRef = useRef<HTMLSpanElement>(null);

  const text = definition || (term ? TERM_GLOSSARY[term] : null);

  // 외부 클릭 시 닫기 (모바일 tap-toggle 보강)
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [open]);

  if (!text) return children;

  return (
    <span ref={containerRef} style={{ position: "relative", display: "inline-block" }}>
      <span
        tabIndex={0}
        role="button"
        aria-describedby={open ? id : undefined}
        aria-label={`${term ?? "용어"} 풀이 보기`}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(v => !v);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        style={{
          borderBottom: `1px dashed ${C.muted}`,
          cursor: "help",
          display: "inline-block",
        }}
      >
        {children}
      </span>
      {open && (
        <span
          id={id}
          role="tooltip"
          style={{
            position: "absolute",
            bottom: "calc(100% + 4px)",
            left: 0,
            background: C.text,
            color: "white",
            padding: "6px 10px",
            borderRadius: 6,
            fontSize: F.xs,
            fontWeight: 500,
            lineHeight: 1.4,
            maxWidth: 240,
            width: "max-content",
            whiteSpace: "normal",
            zIndex: 100,
            boxShadow: C.shadowSm ?? "0 2px 8px rgba(0,0,0,0.15)",
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
});
