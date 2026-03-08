import { memo, useState, useEffect } from "react";
import { C, catCol, catBg, SHORT_LABEL } from "@/theme";
import { getZone, calcLTV, ZONE_TYPE, LTV_RATES } from "@/constants/regulations";
import { ScoreBadge, Radar, Bar } from "./primitives";
import { CatPanel } from "./CatPanel";
import { fmtPrice } from "@/lib/format";
import { FIELD_META } from "@/constants/fieldMeta";
const thStyle = { fontSize: 11, fontWeight: 700, color: "#64748B", padding: "6px 8px", textAlign: "left", borderBottom: "1px solid #E2E8F0" };
const tdStyle = { fontSize: 12, padding: "6px 8px", borderBottom: "1px solid #F1F5F9" };

const DATA_SECTIONS = [
  { title: "단지 기본정보", fields: ["dong", "units", "unsold", "unsoldRate", "pp", "completion", "builder", "dataReliability"] },
  { title: "생활인프라 (반경 1km)", fields: ["hospital", "mart", "conv", "cafe", "culture", "bank", "pharmacy", "park"] },
  { title: "교통 상세", fields: ["subwayDist", "busRoutes", "icDist", "ktxDist"] },
  { title: "시장/투자 지표", fields: ["recentTrades6m", "nearbyMedian", "pir", "psr", "popGrowth"] },
];

function dataValueColor(field, value) {
  if (value == null) return C.muted;
  if (field === "unsoldRate") return value > 15 ? C.red : value <= 5 ? C.green : C.text;
  if (field === "subwayDist") return value <= 500 ? C.green : value <= 1000 ? C.blue : C.text;
  if (field === "popGrowth") return value > 0 ? C.green : value < 0 ? C.red : C.text;
  if (field === "dataReliability") return value >= 80 ? C.green : value >= 50 ? C.amber : C.red;
  if (["hospital", "mart", "conv", "cafe", "culture", "bank", "pharmacy", "park"].includes(field)) return value === 0 ? C.muted : C.text;
  return C.text;
}

export const DetailModal = memo(function DetailModal({ item, onClose, isComp, onComp, isFav, onFav, onShare, isPC }) {
  const [showLegal, setShowLegal] = useState(false);
  const [showData, setShowData] = useState(false);
  useEffect(() => {
    if (!item) return;
    document.body.style.overflow = "hidden";
    const handleEsc = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handleEsc);
    return () => { document.body.style.overflow = ""; document.removeEventListener("keydown", handleEsc); };
  }, [!!item, onClose]);

  if (!item) return null;
  const { apt, res } = item;
  const zone = getZone(apt.region, apt.gu);
  const zoneName = ZONE_TYPE[zone];
  const radarData = Object.entries(res.cats).map(([k, c]) => ({ l: SHORT_LABEL[c.label] || c.label, v: c.total }));

  return (
    <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, left: 0, zIndex: 300, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: isPC ? "center" : "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div style={{ background: C.card, borderRadius: isPC ? 20 : "20px 20px 0 0", width: "100%", maxWidth: isPC ? 640 : 520, maxHeight: isPC ? "85dvh" : "90dvh", overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: isPC ? "0 8px 40px rgba(0,0,0,0.2)" : "0 -8px 30px rgba(0,0,0,0.15)" }} onClick={e => e.stopPropagation()}>
        <div style={{ flexShrink: 0, padding: "12px 16px 0", borderBottom: `1px solid ${C.border}`, background: C.card }}>
          <div onClick={onClose} style={{ width: 40, height: 4, background: C.border, borderRadius: 2, margin: "0 auto 12px", cursor: "pointer" }} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>{apt.name}</div>
              <div style={{ fontSize: 12, color: C.muted }}>{apt.region} {apt.gu} · {apt.area}㎡ · {(apt.price / 10000).toFixed(1)}억</div>
            </div>
            <button onClick={onClose} aria-label="닫기" style={{ background: C.slate100, border: "none", borderRadius: "50%", width: 44, height: 44, fontSize: 18, cursor: "pointer", color: C.muted, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: `0 16px calc(20px + env(safe-area-inset-bottom, 0px)) 16px` }}>

        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <ScoreBadge score={res.total} size={80} />
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "0 0 12px" }}>
          <div style={{ flexShrink: 0 }}><Radar data={radarData} size={150} /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 6 }}>핵심 지표</div>
            {[
              { l: "지역", v: `${apt.region} ${apt.gu}`, c: C.blue },
              { l: "분양가", v: `${apt.price.toLocaleString()}만` },
              { l: "적정가 괴리", v: `${Number(res.cats.price.deviation) > 0 ? "+" : ""}${res.cats.price.deviation}%`, c: Number(res.cats.price.deviation) > 0 ? C.green : C.red },
              { l: "전세가율", v: apt.jeonseRate != null ? `${apt.jeonseRate}%` : "-" },
              { l: "미분양률", v: `${apt.unsoldRate}%`, c: apt.unsoldRate > 15 ? C.red : C.green },
              { l: "규제현황", v: zoneName, c: zone === "normal" ? C.green : C.red },
              { l: "LTV한도", v: fmtPrice(calcLTV(apt.price, zone)), c: C.blue },
              { l: "입주", v: apt.completion },
            ].map((r, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                <span style={{ fontSize: 12, color: C.muted }}>{r.l}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: r.c || C.text }}>{r.v}</span>
              </div>
            ))}
          </div>
        </div>

        {apt.benefits && apt.benefits.length > 0 && (
          <div style={{ background: C.amberLight, borderRadius: 10, padding: "8px 10px", marginBottom: 10, border: `1px solid ${C.amberBorder}` }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.amber, marginBottom: 4 }}>혜택 상세</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {apt.benefits.map((b, i) => (
                <span key={i} style={{ fontSize: 11, color: C.amber, background: C.white, padding: "4px 10px", borderRadius: 4, border: `1px solid ${C.amberBorder}` }}>{b}</span>
              ))}
            </div>
          </div>
        )}

        {(apt.priceByArea ?? []).length > 0 && (
          <div style={{ background: C.bg, borderRadius: 10, padding: "10px 12px", marginBottom: 10, border: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 8 }}>매매 시세 (최근 6개월)</div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                <th style={thStyle}>면적</th><th style={thStyle}>하한</th><th style={thStyle}>평균</th><th style={thStyle}>상한</th><th style={{ ...thStyle, textAlign: "right" }}>건수</th>
              </tr></thead>
              <tbody>{(apt.priceByArea ?? []).map((p, i) => (
                <tr key={i}>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{p.area}㎡</td>
                  <td style={tdStyle}>{fmtPrice(p.min)}</td>
                  <td style={{ ...tdStyle, fontWeight: 700, color: C.blue }}>{fmtPrice(p.avg)}</td>
                  <td style={tdStyle}>{fmtPrice(p.max)}</td>
                  <td style={{ ...tdStyle, textAlign: "right", color: C.muted }}>{p.count}건</td>
                </tr>
              ))}</tbody>
            </table>
            {(apt.rentByArea ?? []).length > 0 && (<>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text, margin: "12px 0 8px" }}>전세 시세 / 전세가율</div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>
                  <th style={thStyle}>면적</th><th style={thStyle}>하한</th><th style={thStyle}>평균</th><th style={thStyle}>상한</th><th style={{ ...thStyle, textAlign: "right" }}>전세가율</th>
                </tr></thead>
                <tbody>{(apt.rentByArea ?? []).map((r, i) => {
                  const j = (apt.jeonseByArea ?? []).find(x => x.area === r.area);
                  return (
                    <tr key={i}>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{r.area}㎡</td>
                      <td style={tdStyle}>{fmtPrice(r.min)}</td>
                      <td style={{ ...tdStyle, fontWeight: 700, color: C.green }}>{fmtPrice(r.avg)}</td>
                      <td style={tdStyle}>{fmtPrice(r.max)}</td>
                      <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: j?.rate >= 70 ? C.green : C.amber }}>{j?.rate ? `${j.rate}%` : "-"}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </>)}
          </div>
        )}

        {(apt.nearbySchools ?? []).length > 0 && (() => {
          const schools = apt.nearbySchools;
          const hasFounded = schools.some(s => s.founded);
          const hasClasses = schools.some(s => s.classes);
          return (
            <div style={{ background: C.bg, borderRadius: 10, padding: "10px 12px", marginBottom: 10, border: `1px solid ${C.border}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>학군 정보</span>
                {apt.schoolGrade && <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 4, background: apt.schoolGrade === "최우수" ? C.greenLight : apt.schoolGrade === "우수" ? C.blueLight : C.slate100, color: apt.schoolGrade === "최우수" ? C.green : apt.schoolGrade === "우수" ? C.blue : C.muted }}>{apt.schoolGrade}</span>}
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>
                  <th style={thStyle}>학교명</th><th style={thStyle}>구분</th><th style={{ ...thStyle, textAlign: "right" }}>도보거리</th>{hasFounded && <th style={thStyle}>설립</th>}{hasClasses && <th style={{ ...thStyle, textAlign: "right" }}>학급수</th>}
                </tr></thead>
                <tbody>{schools.map((s, i) => (
                  <tr key={i}>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{s.name}</td>
                    <td style={tdStyle}>{s.type}</td>
                    <td style={{ ...tdStyle, textAlign: "right", color: s.distance <= 500 ? C.green : s.distance <= 1000 ? C.blue : C.muted }}>{s.distance >= 1000 ? `${(s.distance / 1000).toFixed(1)}km` : `${s.distance}m`}</td>
                    {hasFounded && <td style={tdStyle}>{s.founded || "-"}</td>}
                    {hasClasses && <td style={{ ...tdStyle, textAlign: "right" }}>{s.classes ? `${s.classes}학급` : "-"}</td>}
                  </tr>
                ))}</tbody>
              </table>
            </div>
          );
        })()}

        {(() => {
          const rates = LTV_RATES[zone];
          const zoneColor = zone === "speculative" ? C.red : zone === "overheated" ? C.amber : C.green;
          const ltvBase = calcLTV(apt.price, zone);
          const needCash = apt.price - ltvBase;
          const hasDetail = (apt.priceByArea ?? []).length > 0;
          const rows = hasDetail ? (apt.priceByArea ?? []).map(p => {
            const rent = (apt.rentByArea ?? []).find(r => r.area === p.area);
            const gap = rent ? p.min - rent.avg : null;
            const ltv = calcLTV(p.min, zone);
            return { area: p.area, min: p.min, rentAvg: rent?.avg, gap, ltv };
          }) : [];
          return (
            <div style={{ background: C.bg, borderRadius: 10, padding: "10px 12px", marginBottom: 10, border: `1px solid ${C.border}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>매매/대출 분석</span>
                <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 4, background: zone === "normal" ? C.greenLight : zone === "overheated" ? C.amberLight : C.redLight, color: zoneColor }}>{zoneName}</span>
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>LTV: 9억 이하 {Math.round(rates.under9 * 100)}% / 초과분 {Math.round(rates.over9 * 100)}% (무주택자 기준)</div>
              <div style={{ display: "flex", gap: 8, marginBottom: hasDetail ? 10 : 0 }}>
                <div style={{ flex: 1, background: C.card, borderRadius: 8, padding: "8px 10px", textAlign: "center", border: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: 10, color: C.muted, marginBottom: 2 }}>분양가</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: C.text }}>{fmtPrice(apt.price)}</div>
                </div>
                <div style={{ flex: 1, background: C.card, borderRadius: 8, padding: "8px 10px", textAlign: "center", border: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: 10, color: C.muted, marginBottom: 2 }}>LTV 대출한도</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: C.blue }}>{fmtPrice(ltvBase)}</div>
                </div>
                <div style={{ flex: 1, background: C.card, borderRadius: 8, padding: "8px 10px", textAlign: "center", border: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: 10, color: C.muted, marginBottom: 2 }}>필요 자기자본</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: C.red }}>{fmtPrice(needCash)}</div>
                </div>
              </div>
              {hasDetail && (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr>
                    <th style={thStyle}>면적</th><th style={thStyle}>최저매매</th><th style={thStyle}>전세평균</th><th style={thStyle}>갭투자액</th><th style={{ ...thStyle, textAlign: "right" }}>LTV한도</th>
                  </tr></thead>
                  <tbody>{rows.map((r, i) => (
                    <tr key={i}>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{r.area}㎡</td>
                      <td style={tdStyle}>{fmtPrice(r.min)}</td>
                      <td style={tdStyle}>{r.rentAvg ? fmtPrice(r.rentAvg) : "-"}</td>
                      <td style={{ ...tdStyle, color: r.gap != null ? (r.gap > 0 ? C.red : C.green) : C.muted }}>{r.gap != null ? (r.gap === 0 ? "0만" : (r.gap > 0 ? "+" : "-") + fmtPrice(Math.abs(r.gap))) : "-"}</td>
                      <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: C.blue }}>{fmtPrice(r.ltv)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
            </div>
          );
        })()}

        <div style={{ background: C.bg, borderRadius: 10, padding: "10px 12px", marginBottom: 10, border: `1px solid ${C.border}` }}>
          <div
            onClick={() => setShowLegal(v => !v)}
            role="button"
            tabIndex={0}
            aria-expanded={showLegal}
            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setShowLegal(v => !v); } }}
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
          >
            <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>관련 법률/규정 안내</span>
            <span style={{ fontSize: 12, color: C.muted, transition: "transform .2s", transform: showLegal ? "rotate(180deg)" : "rotate(0)", display: "inline-block" }}>▼</span>
          </div>
          {showLegal && (
            <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.6, marginTop: 8 }}>
              <div style={{ marginBottom: 6 }}><strong style={{ color: C.text }}>LTV (담보인정비율)</strong> — 투기과열지구 40%/20%, 조정대상지역 50%/30%, 비규제지역 70%/60% (9억 초과분 차등 적용)</div>
              <div style={{ marginBottom: 6 }}><strong style={{ color: C.text }}>DSR (총부채원리금상환비율)</strong> — 전 금융권 40% 적용. 연소득 대비 모든 대출의 원리금 상환액 비율 제한</div>
              <div style={{ marginBottom: 6 }}><strong style={{ color: C.text }}>디딤돌대출</strong> — 무주택 서민 대상, 연소득 6천만원 이하, 최대 2.5억(생애최초 3억), 금리 2.15~3.00%</div>
              <div style={{ marginBottom: 6 }}><strong style={{ color: C.text }}>보금자리론</strong> — 무주택자·1주택자, 연소득 7천만원 이하, 최대 3.6억, 고정금리</div>
              <div style={{ color: C.red, fontSize: 11, fontWeight: 600, marginTop: 8 }}>본 정보는 참고용이며 실제 대출 조건은 금융기관에 확인하세요. 규제지역 지정·해제는 수시 변경될 수 있습니다.</div>
            </div>
          )}
        </div>

        <div style={{ background: C.bg, borderRadius: 10, padding: "10px 12px", marginBottom: 10, border: `1px solid ${C.border}` }}>
          <div
            onClick={() => setShowData(v => !v)}
            role="button"
            tabIndex={0}
            aria-expanded={showData}
            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setShowData(v => !v); } }}
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
          >
            <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>공공데이터 상세</span>
            <span style={{ fontSize: 12, color: C.muted, transition: "transform .2s", transform: showData ? "rotate(180deg)" : "rotate(0)", display: "inline-block" }}>▼</span>
          </div>
          {showData && (
            <div style={{ marginTop: 8 }}>
              {DATA_SECTIONS.map((section, si) => {
                const hasAny = section.fields.some(f => apt[f] != null);
                return (
                  <div key={si} style={{ marginTop: si > 0 ? 12 : 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.sub, marginBottom: 4, paddingBottom: 4, borderBottom: `1px solid ${C.border}` }}>{section.title}</div>
                    {hasAny ? section.fields.map(f => {
                      const meta = FIELD_META[f];
                      if (!meta) return null;
                      const val = apt[f];
                      if (f === "dataReliability" && val != null) {
                        return (
                          <div key={f} style={{ padding: "4px 0" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                              <span style={{ fontSize: 12, color: C.muted }}>{meta.label}</span>
                              <span style={{ fontSize: 12, fontWeight: 700, color: dataValueColor(f, val) }}>{meta.fmt(val)}</span>
                            </div>
                            <Bar value={val} color={dataValueColor(f, val)} h={4} />
                          </div>
                        );
                      }
                      return (
                        <div key={f} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0" }}>
                          <span style={{ fontSize: 12, color: C.muted }}>{meta.label}</span>
                          <span style={{ fontSize: 12, fontWeight: 600, color: dataValueColor(f, val) }}>{meta.fmt(val)}</span>
                        </div>
                      );
                    }) : (
                      <div style={{ fontSize: 11, color: C.muted, padding: "6px 0" }}>데이터 수집 중...</div>
                    )}
                  </div>
                );
              })}
              <div style={{ fontSize: 10, color: C.muted, marginTop: 10, lineHeight: 1.5 }}>
                출처: 청약홈(국토교통부) · 카카오 로컬 API · KOSIS(통계청) · 국토부 실거래가 · NEIS(교육부)
              </div>
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <button onClick={() => onFav(apt.id)} style={{
            flex: 1, background: isFav ? C.redLight : C.slate100, color: isFav ? C.red : C.muted,
            border: isFav ? `1.5px solid ${C.red}` : "1.5px solid transparent", borderRadius: 8, padding: "10px 0", fontSize: 13, fontWeight: 700, cursor: "pointer", minHeight: 44, transition: "all .15s"
          }}>{isFav ? "관심 등록됨" : "관심매물 추가"}</button>
          <button onClick={() => onComp(apt.id)} style={{
            flex: 1, background: isComp ? C.indigo : "transparent", color: isComp ? C.white : C.indigo,
            border: `1.5px solid ${C.indigo}`, borderRadius: 8, padding: "10px 0", fontSize: 13, fontWeight: 700, cursor: "pointer", minHeight: 44, transition: "all .15s"
          }}>{isComp ? "비교 중" : "비교 추가"}</button>
          {onShare && <button onClick={() => onShare(apt.id)} aria-label="이 단지 공유하기" style={{
            flex: 1, background: C.slate100, color: C.slate600,
            border: "1.5px solid transparent", borderRadius: 8, padding: "10px 0", fontSize: 13, fontWeight: 700, cursor: "pointer", minHeight: 44, transition: "all .15s"
          }}>공유</button>}
        </div>

        {Object.entries(res.cats).map(([k, c]) => <CatPanel key={k} cat={c} k={k} />)}

        <div style={{ background: C.bg, borderRadius: 10, padding: "8px 10px", marginTop: 6 }}>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>가중치 산출 내역</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
            {Object.entries(res.cats).map(([k, c]) => (
              <span key={k} style={{ fontSize: 11, color: catCol[k], background: catBg[k], padding: "3px 8px", borderRadius: 4, fontWeight: 600 }}>
                {SHORT_LABEL[c.label] || c.label} {c.total}×{res.weights[k]}%={Math.round(c.total * res.weights[k] / 100)}
              </span>
            ))}
          </div>
        </div>
        </div>
      </div>
    </div>
  );
});
