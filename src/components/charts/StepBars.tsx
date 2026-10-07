import { memo } from "react";
import { C, F } from "@/theme";

/**
 * 계단 막대 — 구간이 몇 개뿐인 값을 **막대 높이**로 나란히 세운다.
 *
 * 세션589 에 시세 탭 층별 매매가(`detail/DataSectionBlock` PriceByFloorBlock) 안에 박혀 있던
 * 그림을 떼어냈다. 표로 세 줄 늘어놓으면 안 읽히던 "층이 오를수록 값이 오른다"가 높이로 한눈에 든다.
 *
 * 막대 높이는 가장 큰 값 대비 비율이다(최소 8% — 값이 작아도 막대가 사라지지 않게).
 * 스크린리더 문장은 이 부품이 아니라 감싸는 `ChartFrame` 의 `ariaLabel` 이 맡는다(막대는 aria-hidden).
 */

export type StepBarItem = {
  /** 구간 이름 (예: "1-5층") — 막대 아래 굵은 글자 */
  label: string;
  /** 막대 높이를 정하는 값 */
  value: number;
  /** 막대 위에 적는 값 글자 (예: "5억 2,000만") */
  valueText: string;
  /** 구간 이름 아래 작은 글자 (예: "12건") */
  sub?: string;
};

export const StepBars = memo(function StepBars({
  items,
  height = 84,
}: {
  items: readonly StepBarItem[];
  /** 막대 영역 높이(px) — 값 글자 포함 */
  height?: number;
}) {
  const max = Math.max(...items.map((r) => r.value));
  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height }} aria-hidden>
        {items.map((r) => {
          const pct = max > 0 ? Math.max(8, (r.value / max) * 100) : 8;
          return (
            <div
              key={r.label}
              style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", height: "100%" }}
            >
              <span style={{ fontSize: F.micro, fontWeight: 700, color: C.text, marginBottom: 4 }}>{r.valueText}</span>
              <div style={{ flex: 1, display: "flex", alignItems: "flex-end", width: "70%" }}>
                <div style={{ width: "100%", height: `${pct}%`, background: C.blue, borderRadius: "4px 4px 0 0" }} />
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
        {items.map((r) => (
          <div key={r.label} style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontSize: F.xs, fontWeight: 700, color: C.sub }}>{r.label}</div>
            {r.sub != null && <div style={{ fontSize: F.micro, color: C.muted }}>{r.sub}</div>}
          </div>
        ))}
      </div>
    </>
  );
});
