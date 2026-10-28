import { memo, useMemo, type MouseEvent } from "react";
import { C, F } from "@/theme";
import { REGION_HUB_RULES } from "@/lib/regionPath";
import { buildNearbyBlock, type NearbyApt, type NearbyIndex } from "@/utils/nearbyComplexes.mjs";

/**
 * 상세 창 맨 아래 "경로 줄 + 같은 구 가까운 단지 칩" (세션671 PR-S3 · 결정 40~43).
 *
 * 계산은 `src/utils/nearbyComplexes.mjs` 한 곳 — 정적 단지 장(`scripts/postbuild-prerender.mjs`)과 같은 단지·같은
 * 순서·같은 글자를 보여 준다(결정 27). 후보는 손님 필터·점수와 무관한 전체 목록(App 이 넘기는 색인).
 * - 경로 줄·전체 보기 = 보통 링크(새 페이지 — 허브는 처음 들어온 주소로 정해지는 구조라 앱이 가로채지 않는다)
 * - 단지 칩 = `/apt/{id}` 링크 + 그냥 클릭이면 화면 안에서 그 단지 상세(onOpenApt). 수정 키·가운데 클릭은 브라우저 기본.
 */

// 허브 규칙 = regionPath.ts 의 REGION_HUB_RULES(짝 시험이 같은 객체를 정적 규칙과 맞댄다)
const HUB_RULES = REGION_HUB_RULES;

interface NearbyBlockProps {
  apt: NearbyApt;
  index: NearbyIndex;
  isDesktop?: boolean;
  /** 칩 그냥 클릭 — 화면 안에서 그 단지 상세 열기. 없으면 링크 그대로 이동 */
  onOpenApt?: (_id: string) => void;
}

export const NearbyBlock = memo(function NearbyBlock({ apt, index, isDesktop = false, onOpenApt }: NearbyBlockProps) {
  const block = useMemo(() => buildNearbyBlock(apt, index, HUB_RULES), [apt, index]);

  const onChipClick = (e: MouseEvent<HTMLAnchorElement>, id: string) => {
    if (!onOpenApt) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    onOpenApt(id);
  };

  return (
    <section
      data-testid="detail-nearby"
      aria-label="위치와 가까운 단지"
      style={{ display: "grid", gap: 10, margin: "20px 0 8px", paddingTop: 16, borderTop: `1px solid ${C.border}` }}
    >
      <nav
        aria-label="경로"
        style={{ fontSize: F.sm, color: C.muted, display: "flex", flexWrap: "wrap", gap: "2px 4px" }}
      >
        {block.crumbs.map((c, i) => (
          <span key={i} style={{ display: "inline-flex", gap: 4 }}>
            {i > 0 && <span aria-hidden="true">›</span>}
            {c.href ? (
              <a href={c.href} style={{ color: C.blue, textDecoration: "none", fontWeight: 500 }}>
                {c.name}
              </a>
            ) : (
              <span style={{ color: i === block.crumbs.length - 1 ? C.text : C.muted, fontWeight: 500 }}>{c.name}</span>
            )}
          </span>
        ))}
      </nav>
      {block.chips.length > 0 && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
            <h2 style={{ fontSize: F.md, fontWeight: 700, color: C.text, margin: 0 }}>{block.heading}</h2>
            <span style={{ fontSize: F.xs, color: C.muted }}>직선거리</span>
          </div>
          <div
            data-testid="detail-nearby-chips"
            style={{
              display: "grid",
              gridTemplateColumns: isDesktop ? "repeat(3, minmax(0, 1fr))" : "repeat(2, minmax(0, 1fr))",
              gap: 8,
            }}
          >
            {block.chips.map((c) => (
              <a
                key={c.id}
                href={c.href}
                data-testid="detail-nearby-chip"
                onClick={(e) => onChipClick(e, c.id)}
                style={{
                  display: "grid",
                  gap: 2,
                  padding: "9px 10px",
                  border: `1px solid ${C.border}`,
                  borderRadius: 10,
                  background: C.card,
                  color: C.text,
                  textDecoration: "none",
                  minWidth: 0,
                  minHeight: 44,
                }}
              >
                <span
                  style={{
                    fontSize: F.sm,
                    fontWeight: 700,
                    lineHeight: 1.35,
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {c.name}
                </span>
                <span style={{ fontSize: F.xs, color: C.muted, fontVariantNumeric: "tabular-nums" }}>
                  {c.distText ? `${c.distText} · ` : ""}
                  <span style={c.hasUnsold ? { color: C.text, fontWeight: 700 } : undefined}>{c.unsoldText}</span>
                </span>
              </a>
            ))}
          </div>
          {block.all && (
            <a
              href={block.all.href}
              data-testid="detail-nearby-all"
              style={{
                display: "block",
                textAlign: "center",
                padding: 10,
                borderRadius: 10,
                background: C.blueLight,
                color: C.blue,
                fontWeight: 700,
                fontSize: F.base,
                textDecoration: "none",
                minHeight: 44,
                boxSizing: "border-box",
              }}
            >
              {block.all.label}
            </a>
          )}
        </>
      )}
    </section>
  );
});
