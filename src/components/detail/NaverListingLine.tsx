import { memo } from "react";
import { C, F } from "@/theme";
import type { Apt } from "@/types/scoring";

/**
 * NaverListingLine — 네이버 매물 현황 **사실 한 줄** (세션589, 사장님 결정 V10).
 *
 * ## 무엇을 대체했나
 *
 * 옛 `SourceComparison`("같은 값을 두 곳에서 재봤어요" 3열 표, 세션 507)을 없앤 자리다.
 * 그 표의 '주변 시세' 줄은 **구 전체 12개월 매매 중위(면적 무관)** 와 네이버 주변 중위를 나란히 놓았는데,
 * 면적이 섞인 값은 손님 판단에 도움이 안 되고 두 수는 재는 대상도 달라 "같은 값"이 아니었다.
 * '전세가율' 줄은 바로 위 면적별 막대(`PriceTable`)가 면적마다 이미 말한다.
 * 그래서 비교는 걷어내고, 따로 판단을 요구하지 않는 **사실**만 남겼다 — 매물 개수와 주변 단지 건축연도.
 *
 * 값이 있는 조각만 적고, 하나도 없으면 상자를 안 그린다(수집 시점만 있는 상자는 말할 게 없다).
 */

/** 매물 수 3종 — `field: "…"` 꼴은 `lib/tabExtraFields.test.ts` 가 소스 대조에 쓴다 */
const COUNT_PARTS: ReadonlyArray<{ field: string; label: string }> = [
  { field: "naverSellCount", label: "매매" },
  { field: "naverJeonseCount", label: "전세" },
  { field: "naverWolseCount", label: "월세" },
];

const S = {
  // DataSectionBlock 의 DSB_S.container 와 같은 박스 (같은 탭 형제와 시각 일관)
  container: {
    background: C.bg,
    borderRadius: 10,
    padding: "10px 12px",
    marginBottom: 10,
    border: `1px solid ${C.border}`,
    fontSize: F.sm,
    color: C.sub,
    lineHeight: 1.6,
  },
  head: { fontWeight: 700, color: C.text },
  date: { color: C.muted },
} as const;

/** 수집 시점 → "8/1". 읽을 수 없는 값이면 null. */
function fetchedText(raw: unknown): string | null {
  if (raw == null) return null;
  const d = new Date(String(raw));
  return Number.isNaN(d.getTime()) ? null : `${d.getMonth() + 1}/${d.getDate()}`;
}

export const NaverListingLine = memo(function NaverListingLine({ apt }: { apt: Apt }) {
  const counts = COUNT_PARTS.map((c) => ({ ...c, value: apt[c.field] })).filter((c) => c.value != null);
  const buildYear = apt.naverBuildYear;

  const facts: string[] = [];
  if (counts.length > 0) facts.push(counts.map((c) => `${c.label} ${String(c.value)}건`).join(" · "));
  if (buildYear != null) facts.push(`주변 단지 평균 건축연도 ${String(buildYear)}년`);
  if (facts.length === 0) return null;

  const fetched = fetchedText(apt.naverFetchedAt);

  return (
    <div style={S.container} data-testid="naver-listing-line">
      <span style={S.head}>네이버 매물 현황</span> {facts.join(" · ")}
      {fetched && <span style={S.date}> (수집 {fetched})</span>}
    </div>
  );
});
