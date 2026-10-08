import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import { C, F } from "@/theme";
import { ChartFrame } from "./ChartFrame";
import { niceTicks } from "../LineChart";

/**
 * 면적별 실거래가 — 이 단지 주변에서 "몇 평이 얼마에 팔렸나".
 *
 * ## 왜 이 자료인가
 *
 * 154필드 중 **단지 하나만으로 분포가 성립하는 유일한 자산**이다.
 * 실측(2026-08-03): `priceByArea` 채움 **96.8%**, 단지당 중앙 **28포인트**.
 * 나머지 필드는 값이 하나뿐이라 "지역과 견주는" 편차 막대로만 보여줄 수 있었다.
 *
 * ## 어떻게 읽나
 *
 * 가로 = 면적(㎡), 세로 = 실거래가(만원). 점 하나가 면적 구간 하나이고,
 * 세로 막대는 그 구간의 **최저~최고 범위**다. 가로 점선은 **이 단지 분양가**라
 * 점이 선보다 아래면 "시·군·구 전체 실거래가 분양가보다 싸다"는 뜻이다.
 *
 * ⚠️ 포인트가 너무 적으면(5 미만) 그리지 않는다 — 점 두어 개로 "시세 분포"를 말하면
 * 없는 경향을 있는 것처럼 보이게 한다. 실측상 해당 단지는 **5건(0.3%)** 뿐이다.
 */

export type AreaPricePoint = { area: number; min: number; avg: number; max: number; count: number };

/**
 * 그림 높이(px) — **화면 폭과 무관하게 고정**이다(세션589 E17).
 * 옛 모양은 `viewBox 320×180` 을 `width:100%` 로 늘려, PC(본문 약 750px)에서 그림이 2.3배로 커지며
 * 글자까지 같이 커졌다(높이 428px · 축 글자 25px). 이제 SVG 를 **실제 픽셀 폭 그대로** 그린다 —
 * 폭이 넓어지면 점 사이만 벌어지고 글자·높이는 그대로다.
 */
export const SCATTER_H = 180;
/** 폭을 아직 못 쟀을 때(첫 그리기 · 시험 환경)의 폭 */
export const SCATTER_FALLBACK_W = 320;
/**
 * 여백. right — 맨 오른쪽 눈금 숫자("200")가 가운데 정렬이라 절반이 밖으로 나간다 → 그 절반(약 10px)보다 넓게.
 * bottom — 눈금 숫자 줄과 "면적(㎡)" 줄을 **따로** 둔다(한 줄에 두면 마지막 눈금과 겹친다, S13①).
 */
export const SCATTER_PAD = { top: 10, right: 18, bottom: 36, left: 46 };
const H = SCATTER_H;
const PAD = SCATTER_PAD;
/** 이보다 적으면 분포라고 부르지 않는다 */
export const MIN_POINTS = 5;

/** 알 수 없는 모양의 배열에서 쓸 수 있는 포인트만 추린다 */
export function parsePoints(raw: unknown): AreaPricePoint[] {
  if (!Array.isArray(raw)) return [];
  const out: AreaPricePoint[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const area = Number(o.area);
    const avg = Number(o.avg);
    if (!Number.isFinite(area) || !Number.isFinite(avg) || area <= 0 || avg <= 0) continue;
    const min = Number.isFinite(Number(o.min)) ? Number(o.min) : avg;
    const max = Number.isFinite(Number(o.max)) ? Number(o.max) : avg;
    out.push({ area, avg, min: Math.min(min, avg), max: Math.max(max, avg), count: Number(o.count) || 1 });
  }
  return out.sort((a, b) => a.area - b.area);
}

export const AreaPriceScatter = memo(function AreaPriceScatter({
  priceByArea,
  aptPrice,
  aptArea,
}: {
  priceByArea: unknown;
  /** 이 단지 분양가 (만원) — 가로 기준선 */
  aptPrice?: number | null;
  /** 이 단지 전용면적 (㎡) — 세로 기준선 */
  aptArea?: number | null;
}) {
  const pts = useMemo(() => parsePoints(priceByArea), [priceByArea]);
  const empty = pts.length < MIN_POINTS;

  // 그림을 담는 칸의 실제 폭(px). 빈 상태에서는 칸이 없으므로 `empty` 가 풀릴 때 다시 잰다
  // (가격 배열은 상세 버킷이 늦게 도착한다 — 처음엔 빈 상태였다가 그림으로 바뀐다).
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(SCATTER_FALLBACK_W);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const read = () => {
      const w = Math.round(el.clientWidth);
      // 0 = 아직 안 보이는 탭(display:none) — 보이게 되면 ResizeObserver 가 다시 부른다.
      if (w > 0) setWidth(w);
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [empty]);
  const W = width;

  // ⚠️ `W`(폭)가 좌표를 정한다 — 의존 배열에서 빠지면 폭이 바뀌어도 옛 좌표로 그린다.
  const geom = useMemo(() => {
    if (pts.length < MIN_POINTS) return null;
    const areas = pts.map((p) => p.area);
    const prices = pts.flatMap((p) => [p.min, p.max]);
    if (aptPrice != null && aptPrice > 0) prices.push(aptPrice);
    const xs = niceTicks(Math.min(...areas), Math.max(...areas));
    const ys = niceTicks(Math.min(...prices), Math.max(...prices));
    const iw = W - PAD.left - PAD.right;
    const ih = H - PAD.top - PAD.bottom;
    const sx = (v: number) => PAD.left + ((v - xs.min) / (xs.max - xs.min)) * iw;
    const sy = (v: number) => PAD.top + ih - ((v - ys.min) / (ys.max - ys.min)) * ih;
    return { xs, ys, sx, sy, ih };
  }, [pts, aptPrice, W]);

  const cheaper = useMemo(() => {
    if (!pts.length || aptPrice == null || aptPrice <= 0) return null;
    const below = pts.filter((p) => p.avg < aptPrice).length;
    return { below, total: pts.length };
  }, [pts, aptPrice]);

  const aria =
    pts.length < MIN_POINTS
      ? "시·군·구 전체 실거래 자료가 분포를 그릴 만큼 모이지 않았습니다."
      : `시·군·구 전체 실거래 ${pts.length}개 면적 구간. 면적 ${Math.min(...pts.map((p) => p.area))}부터 ` +
        `${Math.max(...pts.map((p) => p.area))} 제곱미터, 가격 ${Math.min(...pts.map((p) => p.min)).toLocaleString("ko-KR")}부터 ` +
        `${Math.max(...pts.map((p) => p.max)).toLocaleString("ko-KR")} 만원.` +
        (cheaper ? ` 이 단지 분양가보다 싸게 거래된 구간이 ${cheaper.total}개 중 ${cheaper.below}개입니다.` : "");

  return (
    <ChartFrame
      title="시·군·구 전체 면적별 실거래가"
      hint={
        "이 단지가 속한 시·군·구 전체의 최근 12개월 매매예요(위 판정 줄의 '같은 단지·같은 동' 범위보다 넓어요). " +
        "가로는 면적(㎡), 세로는 실제로 거래된 가격(만원)이에요. 점 하나가 면적 구간 하나이고, " +
        "세로 막대는 그 구간에서 가장 싸게~비싸게 팔린 범위예요. 가로 점선은 이 단지 분양가라, " +
        "점이 선보다 아래에 있으면 주변이 분양가보다 싸게 거래됐다는 뜻이에요."
      }
      ariaLabel={aria}
      empty={pts.length < MIN_POINTS}
      emptyReason={
        pts.length === 0
          ? "시·군·구 전체 실거래 자료를 아직 모으지 못했어요"
          : `시·군·구 전체 실거래가 ${pts.length}건뿐이라 분포를 그리지 않았어요 (${MIN_POINTS}건부터 그려요)`
      }
      height={H}
    >
      {/* 폭을 재는 칸 — SVG 는 이 칸의 실제 픽셀 폭으로 그린다(viewBox = 실제 크기 → 글자가 안 커진다) */}
      <div ref={wrapRef} style={{ width: "100%", overflow: "hidden" }}>
        {geom && (
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
            {/* 가로 격자 + Y 눈금 */}
            {geom.ys.ticks.map((t) => (
              <g key={`y${t}`}>
                <line
                  x1={PAD.left}
                  x2={W - PAD.right}
                  y1={geom.sy(t)}
                  y2={geom.sy(t)}
                  stroke={C.border}
                  strokeWidth={1}
                />
                <text x={PAD.left - 5} y={geom.sy(t)} dy="0.35em" textAnchor="end" fontSize={F.xs} fill={C.muted}>
                  {t >= 10000 ? `${Math.round(t / 10000)}억` : t.toLocaleString("ko-KR")}
                </text>
              </g>
            ))}
            {/* X 눈금 */}
            {geom.xs.ticks.map((t) => (
              <text
                key={`x${t}`}
                data-axis="x-tick"
                x={geom.sx(t)}
                y={H - PAD.bottom + 14}
                textAnchor="middle"
                fontSize={F.xs}
                fill={C.muted}
              >
                {Math.round(t)}
              </text>
            ))}
            <text data-axis="x-title" x={W - PAD.right} y={H - 6} textAnchor="end" fontSize={F.xs} fill={C.muted}>
              면적(㎡)
            </text>

            {/* 이 단지 면적 — 세로 기준선 */}
            {aptArea != null && aptArea > 0 && aptArea >= geom.xs.min && aptArea <= geom.xs.max && (
              <line
                x1={geom.sx(aptArea)}
                x2={geom.sx(aptArea)}
                y1={PAD.top}
                y2={PAD.top + geom.ih}
                stroke={C.gridStrong}
                strokeWidth={1}
                strokeDasharray="2 3"
              />
            )}

            {/* 면적 구간별 최저~최고 범위 + 평균 점 */}
            {pts.map((p) => (
              <g key={p.area}>
                <line
                  x1={geom.sx(p.area)}
                  x2={geom.sx(p.area)}
                  y1={geom.sy(p.max)}
                  y2={geom.sy(p.min)}
                  stroke={C.blueBorder}
                  strokeWidth={3}
                  strokeLinecap="round"
                />
                <circle cx={geom.sx(p.area)} cy={geom.sy(p.avg)} r={3} fill={C.blue} />
              </g>
            ))}

            {/* 이 단지 분양가 — 가로 기준선 (맨 위에 그려 점에 가리지 않게) */}
            {aptPrice != null && aptPrice > 0 && (
              <>
                <line
                  x1={PAD.left}
                  x2={W - PAD.right}
                  y1={geom.sy(aptPrice)}
                  y2={geom.sy(aptPrice)}
                  stroke={C.amber}
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                />
                <text x={W - PAD.right} y={geom.sy(aptPrice) - 4} textAnchor="end" fontSize={F.xs} fill={C.amber}>
                  이 단지 분양가
                </text>
              </>
            )}
          </svg>
        )}
      </div>
    </ChartFrame>
  );
});
