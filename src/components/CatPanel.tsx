import { memo, useState } from "react";
import { C, F, catCol, gr } from "@/theme";
import { Bar, EmphasisBadge } from "./primitives";
import { HelpHint } from "./HelpHint";
import { SUB_CONTEXT, PRODUCT_MAX } from "@/constants/subContext";
import { catHelp } from "@/constants/catHelp";
import type { Res } from "@/types/scoring";

type SubScoreItem = { name: string; score: number; info?: string };

type CatPanelProps = {
  cat: Res;
  k: string;
  emphasized?: boolean;
  /** 초기 펼침 여부 (세션 409 D2b) — 종합 탭 미니카드 클릭 시 해당 카테고리 자동 펼침용.
      미전달 시 false(기존 동작). 부모가 key 를 바꿔 리마운트할 때마다 이 값으로 재초기화. */
  defaultExpanded?: boolean;
};

function getDots(score: number, catKey: string, subName: string): number {
  if (catKey === "benefit") return -1;
  return Math.round(normalizeScore(score, catKey, subName) / 20);
}

function renderDots(n: number) {
  if (n < 0) return null;
  const filled = Math.max(0, Math.min(n, 5));
  return (
    <span style={{ fontSize: F.xs, letterSpacing: 1, color: C.muted }} aria-label={`${filled}/5점`}>
      {"●".repeat(filled)}
      {"○".repeat(5 - filled)}
    </span>
  );
}

function normalizeScore(score: number, catKey: string, subName: string): number {
  if (catKey === "product") return Math.round((score / ((PRODUCT_MAX as Record<string, number>)[subName] || 10)) * 100);
  return score;
}

function scoreColor(score: number, catKey: string, subName: string): string {
  if (catKey === "benefit") return C.amber;
  const n = normalizeScore(score, catKey, subName);
  return n >= 70 ? C.green : n >= 40 ? C.amber : C.red;
}

// 서브지표 강/약 부호 기호 (세션 434 점수 근거 투명화 C) — 색맹 접근성: 색만 의존하지 않고 기호 병행.
// non-product 는 interpret 임계가 raw 70/40 이고 normalizeScore 도 raw 그대로라 부호·문구 톤 정확 일치.
// product 는 제외(null) — PRODUCT_MAX 키가 영문인데 subName 은 한글이라 normalizeScore 가 max=10 폴백,
//   interpret 의 raw-max 임계(예: 브랜드 15, 내진 5)와 어긋나 부호↔문구 모순 발생(세션 434 적대검증 실측).
// benefit 은 점수축이 달라(할인 환산) 강/약 단정 안 함 → 중립 ■.
function scoreSign(score: number, catKey: string): { mark: string; label: string } | null {
  if (catKey === "product") return null;
  if (catKey === "benefit") return { mark: "■", label: "정보" };
  if (score >= 70) return { mark: "▲", label: "강점" };
  if (score >= 40) return { mark: "■", label: "보통" };
  return { mark: "▼", label: "약점" };
}

// 미수집 서브지표는 판정문구(interpret)를 숨긴다 — 값이 없는데 점수 기본값으로 "쾌적한 밀도"·
// "주변 깨끗" 같은 칭찬/평가가 붙던 사고(세션 488 감사) 방지.
//
// ⚠️ 이 목록은 **엔진이 실제로 내는 문구**와 맞아야 한다. 손으로 적어 두면 어긋난다 —
//    실제로 `"데이터 부재"`(scorePrice 가 내는 문구)가 빠져 있어서, **890곳(54.1%)** 에서
//    값 없는 지표에 판정이 그대로 붙고 있었다(2026-08-10 운영 n=1,646 실측:
//    PSR 890건 · 전세가율 77 · 적정가 괴리도 72 · PIR 72 = 서브지표 1,111건).
//
// ⚠️ **`"없음"` 은 여기 넣으면 안 된다.** 실측해 보면 두 곳에서 쓰이는데 **둘 다 미수집이 아니다**:
//    future 의 도시·산업·교통개발 3,925건(점수 0 — 측정했고 계획이 없다 = 진짜 약점)과
//    location 의 혐오시설 478건(점수 100 — 없어서 좋다). 숨기면 좋은 소식까지 사라진다.
function isNoDataInfo(info?: string): boolean {
  if (!info) return true;
  return (
    info === "-" ||
    info.startsWith("정보 없음") ||
    info.startsWith("데이터 부재") ||
    info.includes("미수집") ||
    info.includes("미확인")
  );
}

// export: 세션508 PR-3b B4 — 입지 탭 한 줄 요약(DetailModal)이 이 함수를 재사용한다.
// 원래 모듈 비공개였다 — 재사용 전 export 여부를 먼저 확인해야 한다(v1 이 이 확인을 건너뛰고
// TS2305 로 막힌 자리, 플랜 §"v1 에서 틀렸던 것" #8).
export function getHighlights(subs: SubScoreItem[], catKey: string): SubScoreItem[] {
  if (catKey === "benefit") {
    return subs.filter((s) => s.info !== "-").slice(0, 3);
  }
  return [...subs]
    .sort((a, b) => {
      const na = normalizeScore(a.score, catKey, a.name);
      const nb = normalizeScore(b.score, catKey, b.name);
      return Math.abs(nb - 50) - Math.abs(na - 50);
    })
    .slice(0, 3);
}

export const CatPanel = memo(function CatPanel({ cat, k, emphasized, defaultExpanded }: CatPanelProps) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? false);
  const col = (catCol as Record<string, string>)[k];
  const grade = gr(cat.total);
  const ctx =
    (
      SUB_CONTEXT as unknown as Record<
        string,
        Record<string, { interpret?: ((_sc: number) => string) | null; benchmark?: string | null }>
      >
    )[k] || {};
  // 슬림 catsCache(목록 JSON)는 price/location 외 subs=[] — 버킷 도착 전 과도기 방어 (세션 468).
  const subs = (cat.subs ?? []) as SubScoreItem[];
  const highlights = getHighlights(subs, k);

  return (
    <div
      style={{
        marginBottom: 12,
        background: C.bg,
        borderRadius: 10,
        padding: "10px 12px",
        border: emphasized ? `2px solid ${col}` : `1px solid ${C.border}`,
      }}
    >
      <div
        onClick={() => setExpanded((v) => !v)}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: F.md, fontWeight: 700, color: C.text }}>{cat.label}</span>
          <HelpHint text={catHelp(k)} label={cat.label} />
          <span
            style={{
              fontSize: F.sm,
              fontWeight: 700,
              color: grade.c,
              background: grade.bg,
              padding: "2px 8px",
              borderRadius: 4,
            }}
          >
            {grade.l}
          </span>
          {emphasized && <EmphasisBadge color={col} background={C.bg} />}
          {/* "세부 N개" (세션508 PR-3c C5) — 문법은 ExtraFieldsAccordion.tsx:96 답습.
              ⚠️ subs.length > 0 일 때만 표기한다: 목록에서 상세를 열 때 catsCache 가
              슬림(price/location 외 subs=[])이라 그 과도기에 "세부 0개"를 보여주면 거짓말이
              된다(cat.subs 는 위에서 이미 `?? []` 로 좁혔다). */}
          {subs.length > 0 && <span style={{ fontSize: F.xs, color: C.muted }}>세부 {subs.length}개</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: F.lg, fontWeight: 800, color: col }}>{cat.total}</span>
          <span
            style={{
              fontSize: F.sm,
              color: C.muted,
              transition: "transform .2s",
              transform: expanded ? "rotate(180deg)" : "rotate(0)",
              display: "inline-block",
            }}
          >
            ▼
          </span>
        </div>
      </div>

      <Bar value={cat.total} color={col} h={5} />

      {highlights.length > 0 && (
        <div style={{ marginTop: 6 }}>
          {highlights.map((s) => {
            const sc = ctx[s.name];
            const interp = isNoDataInfo(s.info) ? null : sc?.interpret?.(s.score);
            return (
              <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 0" }}>
                <span style={{ fontSize: F.xs, color: C.muted, flexShrink: 0 }}>·</span>
                <span style={{ fontSize: F.base, fontWeight: 600, color: C.text }}>{s.name}:</span>
                <span style={{ fontSize: F.base, fontWeight: 700, color: col }}>{s.info}</span>
                {interp &&
                  (() => {
                    const sign = scoreSign(s.score, k);
                    return (
                      <span style={{ fontSize: F.sm, color: scoreColor(s.score, k, s.name) }}>
                        {sign && (
                          <span aria-label={sign.label} style={{ marginRight: 2 }}>
                            {sign.mark}
                          </span>
                        )}
                        → {interp}
                      </span>
                    );
                  })()}
              </div>
            );
          })}
        </div>
      )}

      {expanded && (
        <div style={{ marginTop: 8, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
          {subs.map((s: SubScoreItem, i: number) => {
            const sc = ctx[s.name];
            const dots = getDots(s.score, k, s.name);
            const interp = isNoDataInfo(s.info) ? null : sc?.interpret?.(s.score);
            const sc2 = scoreColor(s.score, k, s.name);
            return (
              <div
                key={s.name}
                style={{ padding: "6px 0", borderBottom: i < subs.length - 1 ? `1px solid ${C.border}` : "none" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: F.base, fontWeight: 600, color: C.text }}>{s.name}</span>
                  <span style={{ fontSize: F.base, fontWeight: 700, color: col }}>{s.info}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 2 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {renderDots(dots)}
                    {interp &&
                      (() => {
                        const sign = scoreSign(s.score, k);
                        return (
                          <span style={{ fontSize: F.sm, color: sc2 }}>
                            {sign && (
                              <span aria-label={sign.label} style={{ marginRight: 2 }}>
                                {sign.mark}
                              </span>
                            )}
                            {interp}
                          </span>
                        );
                      })()}
                  </div>
                  {sc?.benchmark && <span style={{ fontSize: F.xs, color: C.muted }}>기준: {sc.benchmark}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
