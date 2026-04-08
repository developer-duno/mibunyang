import { memo, useRef, useState, useCallback } from "react";
import { C, catCol, gr } from "@/theme";
import { getZone, calcLTV, ZONE_TYPE } from "@/constants/regulations";
import { fmtPrice } from "@/lib/format";
import { PROFILES } from "@/constants/profiles";

const btnStyle = {
  background: C.slate100, color: C.slate600, border: "1.5px solid transparent",
  borderRadius: 6, padding: "6px 10px", fontSize: 11, fontWeight: 600,
  cursor: "pointer", minHeight: 36, transition: "all .15s",
};

export const CompareSheet = memo(function CompareSheet({ items, onShare, onClose, profile, isDesktop, isLoggedIn = true }) {
  const tableRef = useRef(null);
  const exportingRef = useRef(false);
  const [exporting, setExporting] = useState(false);

  const handleExport = useCallback(async (type) => {
    if (!tableRef.current || exportingRef.current) return;
    exportingRef.current = true;
    setExporting(true);
    try {
      const { exportAsImage, exportAsPdf } = await import("@/lib/exportPdf");
      if (type === "pdf") await exportAsPdf(tableRef.current, "compare.pdf");
      else await exportAsImage(tableRef.current, "compare.png");
    } catch { /* 내보내기 실패 무시 */ }
    exportingRef.current = false;
    setExporting(false);
  }, []);

  if (items.length < 2) return null;
  const cats = Object.keys(items[0].res.cats);
  const zoneData = items.map(it => {
    const z = getZone(it.apt.region, it.apt.gu);
    const ltv = calcLTV(it.apt.price, z);
    return { zone: z, ltv, needCash: it.apt.price - ltv };
  });
  // 프로필 기준 추천 요약
  const profileInfo = PROFILES[profile] || PROFILES.live;
  const best = items.reduce((a, b) => a.res.total >= b.res.total ? a : b, items[0]);
  const bestCats = Object.entries(best.res.cats).sort((a, b) => b[1].total - a[1].total);
  const topCat = bestCats[0];
  const topCatLabel = topCat ? topCat[1].label.split("·")[0] : "";

  const expBtnStyle = { ...btnStyle, cursor: exporting ? "wait" : "pointer", opacity: exporting ? 0.5 : 1 };
  return (
    <div style={{ background: C.card, border: `1.5px solid ${C.blueBorder}`, borderRadius: 16, padding: isDesktop ? 20 : 14, marginBottom: 12, boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 6, flexWrap: "wrap" }}>
        <div style={{ fontSize: isDesktop ? 17 : 15, fontWeight: 800, color: C.blue }}>비교 분석</div>
        <div style={{ display: "flex", gap: 4 }}>
          {isLoggedIn && <button onClick={() => handleExport("png")} disabled={exporting} aria-label="이미지 내보내기" style={expBtnStyle}>{exporting ? "..." : "PNG"}</button>}
          {isLoggedIn && <button onClick={() => handleExport("pdf")} disabled={exporting} aria-label="PDF 내보내기" style={expBtnStyle}>{exporting ? "..." : "PDF"}</button>}
          {onShare && isLoggedIn && <button onClick={onShare} aria-label="비교 결과 공유하기" style={btnStyle}>공유</button>}
          {onClose && <button onClick={onClose} aria-label="비교 닫기" style={btnStyle}>닫기</button>}
        </div>
      </div>
      {isLoggedIn && (
        <div style={{ background: C.blueLight, borderRadius: 8, padding: "8px 10px", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: C.blue }}>💡 {profileInfo.name} 기준 추천</span>
          <span style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>{best.apt.name.split(" ").pop()}</span>
          <span style={{ fontSize: 11, color: C.muted }}>({best.res.total}점 · {topCatLabel} {topCat[1].total}점)</span>
        </div>
      )}
      <div ref={tableRef} style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: isDesktop ? 13 : 12, minWidth: isDesktop ? 480 : 320 }}>
          <thead style={isDesktop ? { position: "sticky", top: 0, background: C.card, zIndex: 1 } : undefined}>
            <tr style={{ borderBottom: `2px solid ${C.border}` }}>
              <th style={{ textAlign: "left", padding: isDesktop ? "10px 10px" : "8px 6px", color: C.muted, fontWeight: 600, fontSize: isDesktop ? 13 : 12 }}>항목</th>
              {items.map(it => <th key={it.apt.id} style={{ textAlign: "center", padding: isDesktop ? "10px 10px" : "8px 6px", color: C.text, fontWeight: 700, fontSize: isDesktop ? 13 : 12 }}>{it.apt.name.split(" ").pop()}<br/><span style={{ fontSize: 11, color: C.muted, fontWeight: 500 }}>{it.apt.region}</span></th>)}
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              <td style={{ padding: isDesktop ? "12px 10px" : "10px 6px", fontWeight: 700, color: C.text }}>종합</td>
              {items.map(it => { const g2 = gr(it.res.total); const isMax = it.res.total === Math.max(...items.map(x => x.res.total)); return (
                <td key={it.apt.id} style={{ textAlign: "center", padding: isDesktop ? "12px 10px" : "10px 6px" }}>
                  <span style={{ fontSize: isDesktop ? 26 : 22, fontWeight: 800, color: isLoggedIn ? g2.c : C.muted }}>{isLoggedIn ? it.res.total : "??"}</span>
                  {isLoggedIn && isMax && <span style={{ fontSize: 11, fontWeight: 700, color: C.blue, display: "block", background: C.blueLight, borderRadius: 4, padding: "1px 6px", marginTop: 2 }}>최고</span>}
                  <div style={{ background: "#ECEEF4", borderRadius: 99, height: isDesktop ? 6 : 5, width: "100%", overflow: "hidden", marginTop: 4 }}><div style={{ width: isLoggedIn ? `${Math.max(0, Math.min(it.res.total ?? 0, 100))}%` : "0%", height: "100%", borderRadius: 99, background: isLoggedIn ? `linear-gradient(90deg,${g2.c}90,${g2.c})` : C.slate100, transition: "width .5s ease" }} /></div>
                </td>
              ); })}
            </tr>
            {cats.map((k, idx) => { const scores = items.map(it => it.res.cats[k].total); const mx = Math.max(...scores); return (
              <tr key={k} style={{ borderBottom: `1px solid ${C.border}`, background: idx % 2 === 1 ? "#FAFBFD" : "transparent" }}>
                <td style={{ padding: isDesktop ? "10px 10px" : "8px 6px", color: C.sub, fontSize: 11 }}>{items[0].res.cats[k].label.split("·")[0]}</td>
                {scores.map((s, i) => { const col = catCol[k] || C.blue; return (
                  <td key={items[i].apt.id} style={{ textAlign: "center", padding: isDesktop ? "10px 10px" : "8px 6px" }}>
                    <span style={{ fontWeight: 700, color: isLoggedIn ? (s === mx ? col : C.muted) : C.muted }}>{isLoggedIn ? s : "??"}</span>
                    <div style={{ background: "#ECEEF4", borderRadius: 99, height: isDesktop ? 5 : 4, width: "100%", overflow: "hidden", marginTop: 3 }}><div style={{ width: isLoggedIn ? `${Math.max(0, Math.min(s ?? 0, 100))}%` : "0%", height: "100%", borderRadius: 99, background: isLoggedIn ? `linear-gradient(90deg,${col}90,${col})` : C.slate100, transition: "width .5s ease" }} /></div>
                  </td>
                ); })}
              </tr>
            ); })}
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              <td style={{ padding: "8px 6px", color: C.sub, fontSize: 11 }}>분양가</td>
              {items.map(it => <td key={it.apt.id} style={{ textAlign: "center", padding: "8px 6px", fontWeight: 600, color: C.text }}>{fmtPrice(it.apt.price)}</td>)}
            </tr>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              <td style={{ padding: "8px 6px", color: C.sub, fontSize: 11 }}>총혜택</td>
              {items.map(it => <td key={it.apt.id} style={{ textAlign: "center", padding: "8px 6px", fontWeight: 600, color: C.amber }}>{(it.res.cats.benefit?.totalWon ?? 0).toLocaleString()}만</td>)}
            </tr>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              <td style={{ padding: "8px 6px", color: C.sub, fontSize: 11 }}>규제현황</td>
              {zoneData.map((d, i) => (
                <td key={items[i].apt.id} style={{ textAlign: "center", padding: "8px 6px", fontWeight: 600, color: d.zone === "normal" ? C.green : C.red }}>{ZONE_TYPE[d.zone]}</td>
              ))}
            </tr>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              <td style={{ padding: "8px 6px", color: C.sub, fontSize: 11 }}>LTV한도</td>
              {zoneData.map((d, i) => (
                <td key={items[i].apt.id} style={{ textAlign: "center", padding: "8px 6px", fontWeight: 600, color: C.blue }}>{fmtPrice(d.ltv)}</td>
              ))}
            </tr>
            <tr>
              <td style={{ padding: "8px 6px", color: C.sub, fontSize: 11 }}>필요자본</td>
              {zoneData.map((d, i) => (
                <td key={items[i].apt.id} style={{ textAlign: "center", padding: "8px 6px", fontWeight: 700, color: C.red }}>{fmtPrice(d.needCash)}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      {!isLoggedIn && (
        <div style={{ background: C.blueLight, borderRadius: 10, padding: "14px 16px", marginTop: 10, textAlign: "center" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.blue, marginBottom: 4 }}>
            점수 분석을 보려면 로그인하세요
          </div>
          <div style={{ fontSize: 11, color: C.muted }}>
            카카오 로그인으로 3초 만에 시작
          </div>
        </div>
      )}
    </div>
  );
});
