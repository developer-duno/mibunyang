import { memo, useRef, useState, useCallback } from "react";
import { C, F, catCol, gr } from "@/theme";
import { getZone, calcLTV, ZONE_TYPE } from "@/constants/regulations";
import { fmtPrice } from "@/lib/format";
import { PROFILES } from "@/constants/profiles";
import { orderedCatEntries } from "@/constants/catOrder";
import type { CompareItem } from "@/types/components";

type CompareSheetProps = {
  items: CompareItem[];
  onShare?: () => void;
  onClose?: () => void;
  profile: string;
  isDesktop?: boolean;
  isLoggedIn?: boolean;
  showToast?: (_msg: string) => void;
};

/**
 * 혜택 행 라벨. 카드·상세는 단지별 `wonSource`(scoreBenefit 파생)를 그대로 쓰지만, 비교표는
 * 여러 단지가 **한 행을 공유**하므로 단지 하나의 라벨을 쓸 수 없다.
 *
 * ⚠️ 세션512 — 이 자리만 `"관리비 절감 등 혜택"` 으로 손에 적혀 있었다. 지금은 금액이 있는
 * 548곳 전부가 관리비 절감 단독이라 우연히 맞지만, 다른 혜택이 채워지는 순간 조용히 거짓이 된다.
 * 그래서 손으로 적지 않고 **실제 구성에서 파생**한다(scoreBenefit 의 wonSource 와 같은 꼴).
 *
 * ⚠️ 구성을 모를 때의 폴백은 카드(`wonSource || "혜택"`)와 달리 **"혜택 금액"** 이다 —
 * 이 표에는 혜택 **점수** 행이 이미 `"혜택"` 이라는 라벨로 있어서 같은 말이 두 줄이 된다.
 */
function benefitRowLabel(items: CompareItem[]): string {
  const sources = new Set(
    items
      .filter((it) => (it.res.cats.benefit?.totalWon ?? 0) > 0)
      .map((it) => it.res.cats.benefit?.wonSource ?? "")
      .filter(Boolean)
  );
  if (sources.size === 1) return [...sources][0];
  return sources.size > 1 ? "혜택 합계" : "혜택 금액";
}

const btnStyle = {
  background: C.slate100,
  color: C.slate600,
  border: "1.5px solid transparent",
  borderRadius: 6,
  padding: "6px 10px",
  fontSize: F.sm,
  fontWeight: 600,
  cursor: "pointer",
  minHeight: 36,
  transition: "all .15s",
};

export const CompareSheet = memo(function CompareSheet({
  items,
  onShare,
  onClose,
  profile,
  isDesktop,
  isLoggedIn = true,
  showToast,
}: CompareSheetProps) {
  const tableRef = useRef<HTMLDivElement>(null);
  const exportingRef = useRef(false);
  const [exporting, setExporting] = useState(false);

  const handleExport = useCallback(
    async (type: "png" | "pdf") => {
      if (!tableRef.current || exportingRef.current) return;
      exportingRef.current = true;
      setExporting(true);
      try {
        const { exportAsImage, exportAsPdf } = await import("@/lib/exportPdf");
        if (type === "pdf") await exportAsPdf(tableRef.current, "compare.pdf");
        else await exportAsImage(tableRef.current, "compare.png");
      } catch {
        const fileType = type === "pdf" ? "PDF" : "이미지";
        showToast?.(`${fileType} 내보내기 실패. 잠시 후 다시 시도해주세요`);
      }
      exportingRef.current = false;
      setExporting(false);
    },
    [showToast]
  );

  if (items.length < 2) return null;
  // 비교표 6행의 순서 — catsCache JSON 키 순서가 아니라 CAT_DISPLAY_ORDER 고정 (세션 487).
  const cats = orderedCatEntries(items[0].res.cats as unknown as Record<string, unknown>).map(([k]) => k);
  const zoneData = items.map((it: CompareItem) => {
    const z = getZone(it.apt.region as string, it.apt.gu as string);
    const ltv = calcLTV((it.apt.price ?? 0) as number, z);
    return { zone: z as keyof typeof ZONE_TYPE, ltv, needCash: ((it.apt.price ?? 0) as number) - ltv };
  });
  // 프로필 기준 추천 요약
  const profileInfo =
    (PROFILES as Record<string, { name: string; desc: string; w: Record<string, number> }>)[profile] || PROFILES.live;
  const best = items.reduce((a, b) => (a.res.total >= b.res.total ? a : b), items[0]);
  // 총점 내림차순. 동점이면 sort 안정성 + CAT_DISPLAY_ORDER 로 결과가 고정된다
  // (예전 Object.entries 는 동점 시 catsCache 키 순서에 따라 대표 카테고리 라벨이 바뀌었다).
  const bestCats = orderedCatEntries(best.res.cats as unknown as Record<string, { label: string; total: number }>).sort(
    (a, b) => b[1].total - a[1].total
  );
  const topCat = bestCats[0];
  const topCatLabel = topCat ? topCat[1].label.split("·")[0] : "";

  const expBtnStyle = { ...btnStyle, cursor: exporting ? "wait" : "pointer", opacity: exporting ? 0.5 : 1 };
  return (
    <div
      style={{
        background: C.card,
        border: `1.5px solid ${C.blueBorder}`,
        borderRadius: 16,
        padding: isDesktop ? 20 : 14,
        marginBottom: 12,
        boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 10,
          gap: 6,
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontSize: isDesktop ? F.xl : F.md, fontWeight: 800, color: C.blue }}>비교 분석</div>
        <div style={{ display: "flex", gap: 4 }}>
          {isLoggedIn && (
            <button
              onClick={() => handleExport("png")}
              disabled={exporting}
              aria-label="이미지 내보내기"
              style={expBtnStyle}
            >
              {exporting ? "..." : "PNG"}
            </button>
          )}
          {isLoggedIn && (
            <button
              onClick={() => handleExport("pdf")}
              disabled={exporting}
              aria-label="PDF 내보내기"
              style={expBtnStyle}
            >
              {exporting ? "..." : "PDF"}
            </button>
          )}
          {onShare && isLoggedIn && (
            <button onClick={onShare} aria-label="비교 결과 공유하기" style={btnStyle}>
              공유
            </button>
          )}
          {onClose && (
            <button onClick={onClose} aria-label="비교 닫기" style={btnStyle}>
              닫기
            </button>
          )}
        </div>
      </div>
      {isLoggedIn && (
        <div
          style={{
            background: C.blueLight,
            borderRadius: 8,
            padding: "8px 10px",
            marginBottom: 10,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span style={{ fontSize: F.sm, fontWeight: 700, color: C.blue }}>💡 {profileInfo.name} 기준 추천</span>
          <span style={{ fontSize: F.sm, color: C.text, fontWeight: 600 }}>
            {((best.apt.name as string) ?? "").split(" ").pop()}
          </span>
          <span style={{ fontSize: F.xs, color: C.muted }}>
            ({best.res.total}점 · {topCatLabel} {topCat[1].total}점)
          </span>
        </div>
      )}
      <div ref={tableRef} style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: isDesktop ? F.base : F.sm,
            minWidth: isDesktop ? 480 : 320,
          }}
        >
          <thead style={isDesktop ? { position: "sticky", top: 0, background: C.card, zIndex: 1 } : undefined}>
            <tr style={{ borderBottom: `2px solid ${C.border}` }}>
              <th
                style={{
                  textAlign: "left",
                  padding: isDesktop ? "10px 10px" : "8px 6px",
                  color: C.muted,
                  fontWeight: 600,
                  fontSize: isDesktop ? F.base : F.sm,
                }}
              >
                항목
              </th>
              {items.map((it: CompareItem) => (
                <th
                  key={it.apt.id}
                  style={{
                    textAlign: "center",
                    padding: isDesktop ? "10px 10px" : "8px 6px",
                    color: C.text,
                    fontWeight: 700,
                    fontSize: isDesktop ? F.base : F.sm,
                  }}
                >
                  {((it.apt.name as string) ?? "").split(" ").pop()}
                  <br />
                  <span style={{ fontSize: F.xs, color: C.muted, fontWeight: 500 }}>{it.apt.region}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              <td style={{ padding: isDesktop ? "12px 10px" : "10px 6px", fontWeight: 700, color: C.text }}>종합</td>
              {items.map((it: CompareItem) => {
                const g2 = gr(it.res.total);
                const isMax = it.res.total === Math.max(...items.map((x: CompareItem) => x.res.total));
                return (
                  <td key={it.apt.id} style={{ textAlign: "center", padding: isDesktop ? "12px 10px" : "10px 6px" }}>
                    <span
                      style={{ fontSize: isDesktop ? 26 : 22, fontWeight: 800, color: isLoggedIn ? g2.c : C.muted }}
                    >
                      {isLoggedIn ? it.res.total : "??"}
                    </span>
                    {isLoggedIn && isMax && (
                      <span
                        style={{
                          fontSize: F.xs,
                          fontWeight: 700,
                          color: C.blue,
                          display: "block",
                          background: C.blueLight,
                          borderRadius: 4,
                          padding: "1px 6px",
                          marginTop: 2,
                        }}
                      >
                        최고
                      </span>
                    )}
                    <div
                      style={{
                        background: "#ECEEF4",
                        borderRadius: 99,
                        height: isDesktop ? 6 : 5,
                        width: "100%",
                        overflow: "hidden",
                        marginTop: 4,
                      }}
                    >
                      <div
                        style={{
                          width: isLoggedIn ? `${Math.max(0, Math.min(it.res.total ?? 0, 100))}%` : "0%",
                          height: "100%",
                          borderRadius: 99,
                          background: isLoggedIn ? `linear-gradient(90deg,${g2.c}90,${g2.c})` : C.slate100,
                          transition: "width .5s ease",
                        }}
                      />
                    </div>
                  </td>
                );
              })}
            </tr>
            {cats.map((k, idx) => {
              const scores = items.map(
                (it: CompareItem) => (it.res.cats as unknown as Record<string, { total: number }>)[k].total
              );
              const mx = Math.max(...scores);
              return (
                <tr
                  key={k}
                  style={{
                    borderBottom: `1px solid ${C.border}`,
                    background: idx % 2 === 1 ? "#FAFBFD" : "transparent",
                  }}
                >
                  <td style={{ padding: isDesktop ? "10px 10px" : "8px 6px", color: C.sub, fontSize: F.xs }}>
                    {
                      (
                        ((items[0].res.cats as unknown as Record<string, { label: string }>)[k].label as string) ?? ""
                      ).split("·")[0]
                    }
                  </td>
                  {scores.map((s: number, i: number) => {
                    const col = (catCol as Record<string, string>)[k] || C.blue;
                    return (
                      <td
                        key={items[i].apt.id}
                        style={{ textAlign: "center", padding: isDesktop ? "10px 10px" : "8px 6px" }}
                      >
                        <span style={{ fontWeight: 700, color: isLoggedIn ? (s === mx ? col : C.muted) : C.muted }}>
                          {isLoggedIn ? s : "??"}
                        </span>
                        <div
                          style={{
                            background: "#ECEEF4",
                            borderRadius: 99,
                            height: isDesktop ? 5 : 4,
                            width: "100%",
                            overflow: "hidden",
                            marginTop: 3,
                          }}
                        >
                          <div
                            style={{
                              width: isLoggedIn ? `${Math.max(0, Math.min(s ?? 0, 100))}%` : "0%",
                              height: "100%",
                              borderRadius: 99,
                              background: isLoggedIn ? `linear-gradient(90deg,${col}90,${col})` : C.slate100,
                              transition: "width .5s ease",
                            }}
                          />
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              <td style={{ padding: "8px 6px", color: C.sub, fontSize: F.xs }}>분양가</td>
              {items.map((it: CompareItem) => (
                <td key={it.apt.id} style={{ textAlign: "center", padding: "8px 6px", fontWeight: 600, color: C.text }}>
                  {fmtPrice(it.apt.price)}
                </td>
              ))}
            </tr>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              <td style={{ padding: "8px 6px", color: C.sub, fontSize: F.xs }}>{benefitRowLabel(items)}</td>
              {items.map((it: CompareItem) => (
                <td
                  key={it.apt.id}
                  style={{ textAlign: "center", padding: "8px 6px", fontWeight: 600, color: C.amber }}
                >
                  {(it.res.cats.benefit?.totalWon ?? 0).toLocaleString()}만
                </td>
              ))}
            </tr>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              <td style={{ padding: "8px 6px", color: C.sub, fontSize: F.xs }}>규제현황</td>
              {zoneData.map((d: { zone: keyof typeof ZONE_TYPE; ltv: number; needCash: number }, i: number) => (
                <td
                  key={items[i].apt.id}
                  style={{
                    textAlign: "center",
                    padding: "8px 6px",
                    fontWeight: 600,
                    color: d.zone === "normal" ? C.green : C.red,
                  }}
                >
                  {ZONE_TYPE[d.zone]}
                </td>
              ))}
            </tr>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              <td style={{ padding: "8px 6px", color: C.sub, fontSize: F.xs }}>LTV한도</td>
              {zoneData.map((d: { zone: keyof typeof ZONE_TYPE; ltv: number; needCash: number }, i: number) => (
                <td
                  key={items[i].apt.id}
                  style={{ textAlign: "center", padding: "8px 6px", fontWeight: 600, color: C.blue }}
                >
                  {fmtPrice(d.ltv)}
                </td>
              ))}
            </tr>
            <tr>
              <td style={{ padding: "8px 6px", color: C.sub, fontSize: F.xs }}>필요자본</td>
              {zoneData.map((d: { zone: keyof typeof ZONE_TYPE; ltv: number; needCash: number }, i: number) => (
                <td
                  key={items[i].apt.id}
                  style={{ textAlign: "center", padding: "8px 6px", fontWeight: 700, color: C.red }}
                >
                  {fmtPrice(d.needCash)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      {!isLoggedIn && (
        <div
          style={{
            background: C.blueLight,
            borderRadius: 10,
            padding: "14px 16px",
            marginTop: 10,
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: F.base, fontWeight: 700, color: C.blue, marginBottom: 4 }}>
            점수 분석을 보려면 로그인하세요
          </div>
          <div style={{ fontSize: F.xs, color: C.muted }}>카카오 로그인으로 3초 만에 시작</div>
        </div>
      )}
    </div>
  );
});
