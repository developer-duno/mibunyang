import { memo, type ReactNode } from "react";
import { C, F } from "@/theme";

/**
 * 범위 막대 줄 — "최저~최고 사이 어디가 평균인가"를 한 줄로.
 *
 * 세션589 에 시세 탭 인근 매매 막대(`detail/PriceTable`)를 떼어내 공용으로 만들었다. 표 두 개(5열)가
 * 하던 일을 이 줄 하나가 한다: 띠 = 최저~최고, 굵은 선 = 평균, **띠 양 끝의 작은 글자 = 최저·최고 값**.
 *
 * 한 줄에 띠를 여러 개 쌓을 수 있다(매매 위·전세 아래). 같은 묶음의 줄은 전부 **같은 `scaleMax`** 를
 * 받아야 한다 — 그래야 줄끼리, 띠끼리 길이를 눈으로 견줄 수 있다.
 *
 * ## 좁은 화면
 *
 * 이 부품은 화면 폭을 모른다(상세 안 부품 공통). 대신 줄이 `flex-wrap` 이라, 폭이 모자라면
 * 오른쪽 글자(`children`)가 **띠 아래 줄로 내려간다**. 넓으면 한 줄.
 * 오른쪽 글자 칸의 폭을 고정한 이유 — 줄마다 글자 길이가 달라도 띠의 시작·끝이 같은 자리에 와야
 * 같은 눈금으로 읽힌다.
 */

export type RangeBand = {
  /** 스크린리더용 이름이 아니라 React key (예: "sell") */
  key: string;
  min: number;
  max: number;
  /** 평균 — 없으면 굵은 선을 안 그린다(세션593: 은행 금리는 은행 평균이 없다. 최저~최고 중간값을 평균으로 그리지 않는다) */
  avg?: number;
  /** 띠 왼쪽 끝 글자 — 최저 값 */
  minText: string;
  /** 띠 오른쪽 끝 글자 — 최고 값 */
  maxText: string;
  /** 평균 선 색 */
  color: string;
  /** 최저~최고 띠 색 */
  bandColor: string;
};

/** 띠 양 끝 글자 칸 폭 — "10억 8,410만" 이 micro 글자로 한 줄에 들어가는 폭 */
const END_W = 64;
/** 오른쪽 글자 칸 폭 — "12억 3,893만 · 전세가율 49.9% · 27건" 이 한 줄에 들어가는 폭 */
const INFO_W = 224;

const endText = {
  width: END_W,
  flexShrink: 0,
  fontSize: F.micro,
  color: C.muted,
  whiteSpace: "nowrap",
} as const;

/**
 * 값 → 눈금 위 위치(0~100%). 눈금은 `scaleMin`(기본 0) 에서 `scaleMax` 까지.
 * 금리(3~7%)처럼 0 에서 먼 값은 `scaleMin` 을 주지 않으면 띠가 오른쪽에 몰린다(세션593).
 */
export function rangePct(value: number, scaleMax: number, scaleMin = 0): number {
  const span = scaleMax - scaleMin;
  return span > 0 ? ((value - scaleMin) / span) * 100 : 0;
}

export const RangeBarRow = memo(function RangeBarRow({
  label,
  emphasized = false,
  bands,
  scaleMax,
  scaleMin = 0,
  labelWidth = 54,
  ariaLabel,
  testId,
  children,
}: {
  /** 줄 이름 (예: "84㎡") */
  label: string;
  /** 강조 줄(이 단지와 비슷한 면적 등) — 이름을 굵게, 바탕을 옅게 */
  emphasized?: boolean;
  bands: readonly RangeBand[];
  /** 눈금의 끝 값 — 같은 묶음의 모든 줄이 같은 값을 받는다 */
  scaleMax: number;
  /** 눈금의 시작 값(기본 0) — 같은 묶음의 모든 줄이 같은 값을 받는다 */
  scaleMin?: number;
  /** 줄 이름 칸 폭 px(기본 54) — 은행 이름처럼 긴 이름을 쓸 때 */
  labelWidth?: number;
  /** 이 줄을 한 문장으로 — 띠는 눈으로만 읽히므로 스크린리더는 이것을 읽는다. "점수" 글자 금지 */
  ariaLabel: string;
  testId?: string;
  /** 오른쪽 글자(평균 값·칩·건수) — 좁으면 띠 아래 줄로 내려간다 */
  children?: ReactNode;
}) {
  return (
    <div
      role="listitem"
      aria-label={ariaLabel}
      data-testid={testId}
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "2px 8px",
        padding: "4px 6px",
        borderRadius: 6,
        background: emphasized ? C.indigoLight : "transparent",
      }}
    >
      <span
        style={{
          width: labelWidth,
          flexShrink: 0,
          textAlign: "right",
          fontSize: F.sm,
          fontWeight: emphasized ? 700 : 400,
          color: emphasized ? C.blue : C.muted,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      <div style={{ flex: "1 1 240px", minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }} aria-hidden>
        {bands.map((b) => {
          const minPct = rangePct(b.min, scaleMax, scaleMin);
          const maxPct = rangePct(b.max, scaleMax, scaleMin);
          return (
            <div key={b.key} data-band={b.key} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ ...endText, textAlign: "right" }}>{b.minText}</span>
              <div
                style={{
                  flex: 1,
                  minWidth: 40,
                  height: 10,
                  background: C.slate100,
                  borderRadius: 4,
                  position: "relative",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: `${minPct}%`,
                    width: `${Math.max(maxPct - minPct, 1)}%`,
                    height: "100%",
                    background: b.bandColor,
                    borderRadius: 4,
                  }}
                />
                {b.avg != null && (
                  <div
                    style={{
                      position: "absolute",
                      left: `${rangePct(b.avg, scaleMax, scaleMin)}%`,
                      width: 3,
                      height: "100%",
                      background: b.color,
                      borderRadius: 2,
                      transform: "translateX(-1px)",
                    }}
                  />
                )}
              </div>
              <span style={{ ...endText, textAlign: "left" }}>{b.maxText}</span>
            </div>
          );
        })}
      </div>
      {children != null && (
        <div
          style={{
            flex: `0 0 ${INFO_W}px`,
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 6,
            whiteSpace: "nowrap",
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
});
