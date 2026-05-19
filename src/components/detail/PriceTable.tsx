import { memo } from "react";
import { C, F } from "@/theme";
import { fmtPrice } from "@/lib/format";
import { thStyle, tdStyle } from "./tableStyles";
import type { PriceTableProps, PriceAreaRow } from "@/types/detail";

export const PriceTable = memo(function PriceTable({ apt, isLoading, error }: PriceTableProps) {
  const allSell = (apt.priceByArea as PriceAreaRow[] | undefined) ?? [];
  // 가격배열 미로드 — apartments-prices.json lazy fetch 동안 placeholder 또는 에러 메시지
  if (allSell.length === 0) {
    if (isLoading) {
      return (
        <div style={{ background: C.bg, borderRadius: 10, padding: "10px 12px", marginBottom: 10, border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: F.base, fontWeight: 700, color: C.text, marginBottom: 8 }}>인근 매매 시세</div>
          {[0, 1, 2].map(i => (
            <div key={i} style={{ height: 14, background: C.slate100, borderRadius: 4, marginBottom: 6 }} aria-hidden="true" />
          ))}
          <div style={{ fontSize: F.xs, color: C.muted, marginTop: 4 }}>가격 정보를 불러오는 중…</div>
        </div>
      );
    }
    if (error) {
      return (
        <div style={{ background: C.bg, borderRadius: 10, padding: "10px 12px", marginBottom: 10, border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: F.base, fontWeight: 700, color: C.text, marginBottom: 4 }}>인근 매매 시세</div>
          <div style={{ fontSize: F.xs, color: C.red }}>가격 정보를 불러오지 못했습니다. 새로고침해 주세요.</div>
        </div>
      );
    }
    return null;
  }

  const allRent = (apt.rentByArea as PriceAreaRow[] | undefined) ?? [];
  const aptArea = Number(apt.area ?? 0);
  const totalCount = allSell.reduce((s, p) => s + (p.count ?? 0), 0);
  const narrow = allSell.filter(p => Math.abs(p.area - aptArea) <= 10);
  const sellRows = narrow.length >= 3 ? narrow : allSell.filter(p => Math.abs(p.area - aptArea) <= 20);
  const isFiltered = sellRows.length < allSell.length;
  const narrowRent = allRent.filter(r => Math.abs(r.area - aptArea) <= 10);
  const rentRows = narrowRent.length >= 3 ? narrowRent : allRent.filter(r => Math.abs(r.area - aptArea) <= 20);

  return (
    <div style={{ background: C.bg, borderRadius: 10, padding: "10px 12px", marginBottom: 10, border: `1px solid ${C.border}` }}>
      <div style={{ fontSize: F.base, fontWeight: 700, color: C.text, marginBottom: 2 }}>인근 매매 시세 (최근 6개월)</div>
      <div style={{ fontSize: F.xs, color: C.muted, marginBottom: 8 }}>총 {totalCount}건{isFiltered ? ` · ${aptArea}㎡ 기준 ±${narrow.length >= 3 ? 10 : 20}㎡ 필터` : " · 전체 면적"}</div>
      {sellRows.length > 1 && (() => {
        const globalMax = Math.max(...sellRows.map(p => p.max));
        return (
        <div style={{ marginBottom: 10 }}>
          {sellRows.map((p, i) => {
            const isSimilar = Math.abs(p.area - aptArea) <= 5;
            const minPct = globalMax > 0 ? (p.min / globalMax) * 100 : 0;
            const maxPct = globalMax > 0 ? (p.max / globalMax) * 100 : 0;
            const avgPct = globalMax > 0 ? (p.avg / globalMax) * 100 : 0;
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3, fontSize: F.xs }}>
                <span style={{ width: 42, textAlign: "right", fontWeight: isSimilar ? 700 : 400, color: isSimilar ? C.blue : C.muted, flexShrink: 0 }}>{p.area}㎡</span>
                <div style={{ flex: 1, height: 14, background: C.slate100, borderRadius: 4, position: "relative", overflow: "hidden" }}>
                  <div style={{ position: "absolute", left: `${minPct}%`, width: `${Math.max(maxPct - minPct, 1)}%`, height: "100%", background: isSimilar ? C.blue + "40" : (C as Record<string, string>).slate200, borderRadius: 4 }} />
                  <div style={{ position: "absolute", left: `${avgPct}%`, width: 3, height: "100%", background: isSimilar ? C.blue : C.muted, borderRadius: 2, transform: "translateX(-1px)" }} />
                </div>
                <span style={{ width: 60, textAlign: "right", fontWeight: isSimilar ? 700 : 400, color: isSimilar ? C.blue : C.text, flexShrink: 0 }}>{fmtPrice(p.avg)}</span>
              </div>
            );
          })}
        </div>
        );
      })()}
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>
          <th style={thStyle}>면적</th><th style={thStyle}>하한</th><th style={thStyle}>평균</th><th style={thStyle}>상한</th><th style={{ ...thStyle, textAlign: "right" }}>건수</th>
        </tr></thead>
        <tbody>{sellRows.map((p, i) => {
          const isSimilar = Math.abs(p.area - aptArea) <= 5;
          return (
          <tr key={i} data-testid="price-table-row" style={{ background: isSimilar ? C.indigoLight : "transparent" }}>
            <td style={{ ...tdStyle, fontWeight: 600 }}>{isSimilar ? "★ " : ""}{p.area}㎡</td>
            <td style={tdStyle}>{fmtPrice(p.min)}</td>
            <td style={{ ...tdStyle, fontWeight: 700, color: C.blue }}>{fmtPrice(p.avg)}</td>
            <td style={tdStyle}>{fmtPrice(p.max)}</td>
            <td style={{ ...tdStyle, textAlign: "right", color: C.muted }}>{p.count}건</td>
          </tr>
          );
        })}</tbody>
      </table>
      {rentRows.length > 0 && (<>
        <div style={{ fontSize: F.base, fontWeight: 700, color: C.text, margin: "12px 0 2px" }}>인근 전세 시세 / 전세가율</div>
        <div style={{ fontSize: F.xs, color: C.muted, marginBottom: 8 }}>{isFiltered ? `${aptArea}㎡ 기준 ±${narrowRent.length >= 3 ? 10 : 20}㎡ 필터` : "전체 면적"}</div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={thStyle}>면적</th><th style={thStyle}>하한</th><th style={thStyle}>평균</th><th style={thStyle}>상한</th><th style={{ ...thStyle, textAlign: "right" }}>전세가율</th>
          </tr></thead>
          <tbody>{rentRows.map((r, i) => {
            const j = ((apt.jeonseByArea as PriceAreaRow[] | undefined) ?? []).find(x => x.area === r.area);
            const isSimilar = Math.abs(r.area - aptArea) <= 5;
            return (
              <tr key={i} style={{ background: isSimilar ? C.greenLight : "transparent" }}>
                <td style={{ ...tdStyle, fontWeight: 600 }}>{isSimilar ? "★ " : ""}{r.area}㎡</td>
                <td style={tdStyle}>{fmtPrice(r.min)}</td>
                <td style={{ ...tdStyle, fontWeight: 700, color: C.green }}>{fmtPrice(r.avg)}</td>
                <td style={tdStyle}>{fmtPrice(r.max)}</td>
                <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: (j?.rate ?? 0) >= 70 ? C.green : C.amber }}>{j?.rate ? `${j.rate}%` : "-"}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </>)}
    </div>
  );
});
