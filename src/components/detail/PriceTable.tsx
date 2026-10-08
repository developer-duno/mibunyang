import { memo } from "react";
import { C, F } from "@/theme";
import { fmtPrice } from "@/lib/format";
import { hasKnownArea } from "@/lib/area";
import { RangeBarRow, type RangeBand } from "@/components/charts/RangeBarRow";
import type { PriceTableProps, PriceAreaRow } from "@/types/detail";

/**
 * 인근 매매·전세 시세 — 면적마다 한 묶음(세션589 "접힘 없이 한눈에").
 *
 * 옛 모양은 매매 막대 + 매매 표(5열) + 전세 표(5열)로 같은 면적이 세 번 나왔다. 이제 면적 한 줄에
 * 띠 두 개(위 = 매매, 아래 = 전세)를 쌓고, 표가 적던 최저·최고는 **띠 양 끝의 작은 글자**로,
 * 평균 매매가·전세가율·건수는 오른쪽 글자로 옮겼다(사장님 결정 V12).
 * 매매·전세 띠는 **같은 눈금**을 쓴다 — 전세가 매매의 몇 할쯤인지 띠 길이로 보이게.
 */

const BOX = {
  background: C.bg,
  borderRadius: 10,
  padding: "10px 12px",
  marginBottom: 10,
  border: `1px solid ${C.border}`,
} as const;

/** 전세가율이 이 값 이상이면 초록, 아래면 주황 (옛 전세 표의 색 규칙 그대로) */
const JEONSE_RATE_OK = 70;

export const PriceTable = memo(function PriceTable({ apt, isLoading, error }: PriceTableProps) {
  const allSell = (apt.priceByArea as PriceAreaRow[] | undefined) ?? [];
  // 가격배열 미로드 — 상세 버킷 lazy fetch 동안 placeholder 또는 에러 메시지
  if (allSell.length === 0) {
    if (isLoading) {
      return (
        <div style={BOX}>
          <div style={{ fontSize: F.base, fontWeight: 700, color: C.text, marginBottom: 8 }}>
            시·군·구 전체 매매 시세
          </div>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{ height: 14, background: C.slate100, borderRadius: 4, marginBottom: 6 }}
              aria-hidden="true"
            />
          ))}
          <div style={{ fontSize: F.xs, color: C.muted, marginTop: 4 }}>가격 정보를 불러오는 중…</div>
        </div>
      );
    }
    if (error) {
      return (
        <div style={BOX}>
          <div style={{ fontSize: F.base, fontWeight: 700, color: C.text, marginBottom: 4 }}>
            시·군·구 전체 매매 시세
          </div>
          <div style={{ fontSize: F.xs, color: C.red }}>가격 정보를 불러오지 못했습니다. 새로고침해 주세요.</div>
        </div>
      );
    }
    return null;
  }

  const allRent = (apt.rentByArea as PriceAreaRow[] | undefined) ?? [];
  const jeonseByArea = (apt.jeonseByArea as PriceAreaRow[] | undefined) ?? [];
  // 면적을 모르면 거르지 않는다 — 없는 면적을 0㎡ 로 두면 "0㎡ 기준 ±20㎡" 로 행이 전부 사라진다(세션576 D2).
  const areaKnown = hasKnownArea(apt.area);
  const aptArea = areaKnown ? Number(apt.area) : 0;
  const totalCount = allSell.reduce((s, p) => s + (p.count ?? 0), 0);
  const narrow = allSell.filter((p) => Math.abs(p.area - aptArea) <= 10);
  const sellRows = !areaKnown
    ? allSell
    : narrow.length >= 3
      ? narrow
      : allSell.filter((p) => Math.abs(p.area - aptArea) <= 20);
  const isFiltered = sellRows.length < allSell.length;
  const narrowRent = allRent.filter((r) => Math.abs(r.area - aptArea) <= 10);
  const rentRows = !areaKnown
    ? allRent
    : narrowRent.length >= 3
      ? narrowRent
      : allRent.filter((r) => Math.abs(r.area - aptArea) <= 20);
  // 전세 쪽 문구는 전세 자신이 걸렸는지로 정한다 — 매매의 isFiltered 를 빌리면
  // 매매만 걸리고 전세는 전부일 때 "±20㎡ 필터" 라고 거짓말한다(세션576 E4).
  const isRentFiltered = rentRows.length < allRent.length;
  const hasRent = rentRows.length > 0;

  const sellFilter = isFiltered ? `${aptArea}㎡ 기준 ±${narrow.length >= 3 ? 10 : 20}㎡ 필터` : "전체 면적";
  const rentFilter = isRentFiltered ? `${aptArea}㎡ 기준 ±${narrowRent.length >= 3 ? 10 : 20}㎡ 필터` : "전체 면적";
  // 매매·전세가 같은 범위면 한 번만, 다르면 각각 사실대로.
  const filterText = !hasRent || sellFilter === rentFilter ? sellFilter : `매매 ${sellFilter} · 전세 ${rentFilter}`;

  // 면적마다 한 묶음 — 매매·전세의 면적이 다르면 합집합(오름차순).
  const areas = [...new Set([...sellRows.map((p) => p.area), ...rentRows.map((r) => r.area)])].sort((a, b) => a - b);
  // 눈금 끝은 묶음 전체가 같이 쓴다(매매·전세가 같은 축).
  const scaleMax = Math.max(0, ...sellRows.map((p) => p.max), ...rentRows.map((r) => r.max));

  return (
    <div style={BOX}>
      <div style={{ fontSize: F.base, fontWeight: 700, color: C.text, marginBottom: 2 }}>
        {hasRent ? "시·군·구 전체 매매·전세 시세 (매매 최근 12개월)" : "시·군·구 전체 매매 시세 (최근 12개월)"}
      </div>
      <div style={{ fontSize: F.xs, color: C.muted, marginBottom: 6 }}>
        {hasRent ? `${filterText} · 매매 총 ${totalCount}건` : `총 ${totalCount}건 · ${filterText}`}
      </div>
      <div role="list">
        {areas.map((area) => {
          const sell = sellRows.find((p) => p.area === area);
          const rent = rentRows.find((r) => r.area === area);
          const rate = jeonseByArea.find((x) => x.area === area)?.rate;
          // 면적을 모르면 "비슷한 면적" 도 없다(0㎡ 와 견주지 않는다).
          const isSimilar = areaKnown && Math.abs(area - aptArea) <= 5;
          const bands: RangeBand[] = [];
          if (sell)
            bands.push({
              key: "sell",
              min: sell.min,
              max: sell.max,
              avg: sell.avg,
              minText: fmtPrice(sell.min),
              maxText: fmtPrice(sell.max),
              color: C.blue,
              bandColor: C.blueBorder,
            });
          if (rent)
            bands.push({
              key: "rent",
              min: rent.min,
              max: rent.max,
              avg: rent.avg,
              minText: fmtPrice(rent.min),
              maxText: fmtPrice(rent.max),
              color: C.green,
              bandColor: C.greenBorder,
            });
          const aria =
            `${area}㎡.` +
            (sell
              ? ` 매매 최저 ${fmtPrice(sell.min)}, 평균 ${fmtPrice(sell.avg)}, 최고 ${fmtPrice(sell.max)}` +
                `${sell.count != null ? `, ${sell.count}건` : ""}.`
              : "") +
            (rent ? ` 전세 최저 ${fmtPrice(rent.min)}, 평균 ${fmtPrice(rent.avg)}, 최고 ${fmtPrice(rent.max)}.` : "") +
            (rent && rate ? ` 전세가율 ${rate}%.` : "") +
            (isSimilar ? " 이 단지와 비슷한 면적." : "");
          return (
            <RangeBarRow
              key={area}
              label={`${isSimilar ? "★ " : ""}${area}㎡`}
              emphasized={isSimilar}
              bands={bands}
              scaleMax={scaleMax}
              ariaLabel={aria}
              testId="price-table-row"
            >
              {sell ? (
                <span style={{ fontSize: F.base, fontWeight: 700, color: C.blue }}>{fmtPrice(sell.avg)}</span>
              ) : (
                rent && (
                  <span style={{ fontSize: F.base, fontWeight: 700, color: C.green }}>
                    전세 평균 {fmtPrice(rent.avg)}
                  </span>
                )
              )}
              {rent && rate ? (
                <span
                  style={{
                    fontSize: F.xs,
                    fontWeight: 700,
                    padding: "2px 6px",
                    borderRadius: 4,
                    color: rate >= JEONSE_RATE_OK ? C.green : C.amber,
                    background: rate >= JEONSE_RATE_OK ? C.greenLight : C.amberLight,
                  }}
                >
                  전세가율 {rate}%
                </span>
              ) : null}
              {sell?.count != null && <span style={{ fontSize: F.xs, color: C.muted }}>{sell.count}건</span>}
            </RangeBarRow>
          );
        })}
      </div>
      {areas.length > 0 && (
        <div style={{ fontSize: F.micro, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>
          파란 띠 = 매매 최저~최고{hasRent ? " · 초록 띠 = 전세 최저~최고" : ""} · 굵은 선 = 평균
          {areaKnown && areas.some((a) => Math.abs(a - aptArea) <= 5) ? " · ★ = 이 단지와 비슷한 면적" : ""}
        </div>
      )}
    </div>
  );
});
