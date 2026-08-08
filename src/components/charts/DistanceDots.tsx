import { memo } from "react";
import { C, F } from "@/theme";
import { ChartFrame } from "./ChartFrame";
import { isSentinel } from "@/constants/sentinels";
import { DISTANCE_AXES } from "@/constants/distanceAxes";
import type { Apt } from "@/types/scoring";

/**
 * 주변 시설까지 거리를 한눈에 — 점 하나가 시설 하나다. **왼쪽일수록 가깝다**.
 *
 * ## 왜 축을 나누나 (실측 근거, 2026-08-03 1,581행)
 *
 * 거리의 최댓값이 필드마다 자릿수가 다르다:
 *   카페 499m · 편의점 491m · 약국 498m / 병원 989m · 마트 999m · 공원 998m ·
 *   은행 998m · 문화 997m · 어린이집 983m / 경찰 2,971m · 지하철 9,484m /
 *   **응급의료 69,072m**
 * 하나의 축에 다 올리면 69km 짜리 하나 때문에 나머지 전부가 왼쪽 끝에 뭉쳐 **아무것도
 * 구분이 안 된다**. 그래서 자릿수가 비슷한 것끼리 묶어 축을 3개로 나눈다.
 *
 * ## 일부러 뺀 것
 *
 * - `ktxDist`·`icDist` — 단위가 **km**(0.2~8.3)라 m 축에 그대로 올리면 "IC 가 8m" 처럼
 *   읽힌다. 축 자체가 안 맞는 것이지 값이 없어서가 아니다 — 세션 499 의 수집 정정으로
 *   채움률은 KTX 71.8% · IC 79.2% 까지 올라왔다(그 전 수치 0%·3.9% 를 근거로 적어둔
 *   옛 주석은 지금은 거짓이라 고쳤다). **그림에 넣을지 말지는 이번 범위 밖**이고,
 *   넣으려면 km 전용 축을 따로 만들어야 한다. 지금은 "교통 상세" 표가 그린다.
 * - `noxiousDist` — **멀수록 좋은** 유일한 필드다. "왼쪽일수록 가깝다=좋다" 규칙과
 *   방향이 반대라 같은 그림에 섞으면 정반대로 읽힌다. 카드·치안환경 섹션이 이미 다룬다.
 */

// 축 정의(`DISTANCE_AXES`)는 `@/constants/distanceAxes` 에 있다 — 서랍(`lib/tabExtraFields`)이
// "이 그림이 이미 보여준 필드"를 세야 하는데, lib 이 components 를 import 하면 방향이 뒤집힌다.

const ROW_H = 22;
// 세션 505 에 62 → 84. 라벨이 "병원"에서 "병원 12곳"으로 길어졌다 — 62 로 두면 개수가 잘린다.
const LABEL_W = 84;
const VALUE_W = 62;

/** m 를 사람이 읽는 말로 — 1km 넘으면 km */
export function fmtDist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1).replace(/\.0$/, "")}km` : `${Math.round(m)}m`;
}

/** 쓸 수 있는 거리인가 — null·NaN·센티널 제외 */
function usable(field: string, raw: unknown): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  if (isSentinel(field, n)) return null;
  return n;
}

/**
 * 쓸 수 있는 개수인가 — null·0·NaN 은 안 적는다.
 *
 * 0 을 "0곳"으로 적지 않는 이유: 수집이 안 된 것과 정말 한 곳도 없는 것을 이 값만으로는
 * 가를 수 없다. 그런데 바로 옆에 거리 값이 있으면 "0곳인데 200m"라는 모순된 줄이 된다.
 * 그래서 확실할 때만 병기하고, 아니면 옛 라벨 그대로 둔다.
 */
function usableCount(raw: unknown): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

export const DistanceDots = memo(function DistanceDots({ apt }: { apt: Apt }) {
  const raw = apt as unknown as Record<string, unknown>;

  // 세션 505: 라벨에 개수를 함께 적는다("병원 3곳"). 개수 표는 이 그림 아래에서 없앴고,
  // 개수와 거리를 두 곳에서 따로 읽던 것을 여기 한 줄로 합쳤다.
  const axes = DISTANCE_AXES.map((ax) => ({
    ...ax,
    rows: ax.items.map((it) => {
      const cnt = it.countField ? usableCount(raw[it.countField]) : null;
      return {
        ...it,
        v: usable(it.field, raw[it.field]),
        label: cnt != null ? `${it.label} ${cnt}곳` : it.label,
      };
    }),
  }));
  const total = axes.reduce((s, a) => s + a.rows.length, 0);
  const filled = axes.reduce((s, a) => s + a.rows.filter((r) => r.v != null).length, 0);

  const height = axes.reduce((s, a) => s + 20 + a.rows.length * ROW_H + 10, 0);

  const near = axes
    .flatMap((a) => a.rows)
    .filter((r) => r.v != null)
    .sort((a, b) => (a.v as number) - (b.v as number))
    .slice(0, 3)
    .map((r) => `${r.label} ${fmtDist(r.v as number)}`)
    .join(", ");

  return (
    <ChartFrame
      title="주변 시설까지 거리"
      hint={
        "점이 왼쪽에 있을수록 가까워요. 거리 자릿수가 크게 달라서(카페는 500m 안, 응급의료는 " +
        "멀면 69km) 비슷한 것끼리 묶어 세 줄로 나눴어요. 자료가 없는 시설은 '미수집'으로 둡니다. " +
        "혐오시설은 멀수록 좋은 것이라 이 그림에 넣지 않았어요."
      }
      ariaLabel={
        filled === 0
          ? "주변 시설 거리 자료가 아직 없습니다."
          : `주변 시설 ${total}곳 중 ${filled}곳의 거리를 모았습니다. 가장 가까운 곳은 ${near} 입니다.`
      }
      empty={filled === 0}
      emptyReason="주변 시설 거리를 아직 모으지 못했어요"
      height={height}
    >
      {axes.map((ax) => (
        <div key={ax.title} style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", height: 20, alignItems: "center" }}>
            <span style={{ fontSize: F.sm, color: C.muted }}>{ax.title}</span>
            <span style={{ fontSize: F.xs, color: C.muted }}>0 ~ {ax.capLabel}</span>
          </div>
          {ax.rows.map((r) => {
            const has = r.v != null;
            const over = has && (r.v as number) > ax.cap;
            const pct = has ? Math.min(100, ((r.v as number) / ax.cap) * 100) : 0;
            return (
              <div key={r.field} style={{ display: "flex", alignItems: "center", gap: 6, height: ROW_H }}>
                <span style={{ width: LABEL_W, flexShrink: 0, fontSize: F.sm, color: C.muted }}>{r.label}</span>
                <div
                  style={{
                    flex: 1,
                    minWidth: 60,
                    height: 8,
                    background: C.track,
                    borderRadius: 99,
                    position: "relative",
                  }}
                >
                  {has && (
                    <div
                      style={{
                        position: "absolute",
                        left: `${pct}%`,
                        top: -2,
                        width: 12,
                        height: 12,
                        marginLeft: -6,
                        borderRadius: "50%",
                        // 축 밖으로 나간 값은 테두리만 — "이 축에 안 들어온다"를 형태로 알린다
                        background: over ? C.white : C.blue,
                        border: `2px solid ${over ? C.amber : C.blue}`,
                      }}
                    />
                  )}
                </div>
                <span
                  style={{
                    width: VALUE_W,
                    flexShrink: 0,
                    textAlign: "right",
                    whiteSpace: "nowrap",
                    fontSize: F.sm,
                    fontWeight: has ? 700 : 400,
                    color: has ? (over ? C.amber : C.text) : C.muted,
                  }}
                >
                  {has ? fmtDist(r.v as number) : "미수집"}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </ChartFrame>
  );
});
