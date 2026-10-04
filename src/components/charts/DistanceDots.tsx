import { memo } from "react";
import { C, F } from "@/theme";
import { ChartFrame } from "./ChartFrame";
import { isSentinel, SENTINEL_RADIUS_KM, type SentinelField } from "@/constants/sentinels";
import { DISTANCE_AXES, distanceItemKey, type DistanceItem } from "@/constants/distanceAxes";
import { schoolsOf, nearestSchoolDistance } from "@/lib/nearbySchools";
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
 * 구분이 안 된다**. 그래서 자릿수가 비슷한 것끼리 묶어 축을 나눈다.
 *
 * ## 세션591 — 5줄로 (입지 탭 "접힘 없이 한눈에")
 *
 * - 초·중·고 가장 가까운 학교 → "걸어서 갈 만한 거리"(0~1km) 줄 — 학군 카드의 3줄을 옮겼다.
 * - `icDist`·`ktxDist` → **따로 한 줄 "고속도로·KTX"(0~20km)**(사장님 결정 L1). 단위가 km 라
 *   ×1000 해 m 축에 올린다 — 옛 주석이 "넣으려면 km 전용 축을 따로 만들어야 한다"던 그 축이다.
 *   99 는 "모름"이 아니라 **수집기가 20km 를 찾아봤는데 없던 것**이라 점 대신 "20km 안에 없음"
 *   (결정 L2). 지하철 9999 도 같은 원칙으로 "10km 안에 없음". 반경은 `SENTINEL_RADIUS_KM`.
 * - 옛 "안 보여드린 자료 4개" 서랍 → 새 줄 "개발 사업지까지"(0~5km). 이름이 없는 줄은 안 그린다.
 * - 좌표 공유 단지(`coordShared`)는 점을 하나도 안 그린다 — 전부 이 단지 좌표로 잰 값이라 이 단지
 *   것이 아니다. 학군·교통 카드와 같은 "위치 확인 중" 사실 한 줄(경고문 아님, 세션568-3).
 *
 * ## 일부러 뺀 것
 *
 * - `noxiousDist` — **멀수록 좋은** 유일한 필드다. "왼쪽일수록 가깝다=좋다" 규칙과
 *   방향이 반대라 같은 그림에 섞으면 정반대로 읽힌다. 치안·환경 칩이 이름과 함께 다룬다.
 */

// 축 정의(`DISTANCE_AXES`)는 `@/constants/distanceAxes` 에 있다 — 서랍(`lib/tabExtraFields`)이
// "이 그림이 이미 보여준 필드"를 세야 하는데, lib 이 components 를 import 하면 방향이 뒤집힌다.

const ROW_H = 22;
/** 개발 사업지의 이름 줄 높이 */
const NAME_H = 16;
// 세션 505 에 62 → 84. 라벨이 "병원"에서 "병원 12곳"으로 길어졌다 — 62 로 두면 개수가 잘린다.
const LABEL_W = 84;
const VALUE_W = 62;

/** m 를 사람이 읽는 말로 — 1km 넘으면 km */
export function fmtDist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1).replace(/\.0$/, "")}km` : `${Math.round(m)}m`;
}

/** 쓸 수 있는 거리인가 — null·NaN·센티널 제외 (단위 변환 전 원래 값으로 본다) */
function usable(field: string, raw: unknown): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  if (isSentinel(field, n)) return null;
  return n;
}

/**
 * 센티널이면 "N km 안에 없음" — 수집기가 그 반경을 찾아봤는데 없던 것.
 *
 * ⚠️ 교통 자료 행 자체가 없는 단지(세션591 보완 F8 — 정적 JSON 1곳 = ah-2026910248)는 VIEW 가 지하철만
 * 9999 로 채우고 IC·KTX 는 null 로 둔다. 찾아본 적이 없으니 "10km 안에 없음"은 거짓이다 — 같은 수집기가
 * 함께 쓰는 IC·KTX 가 둘 다 null 이면 지하철 9999 도 "미수집"으로 본다(null 반환 → 화면은 "미수집").
 */
function outOfRange(field: string, value: unknown, row: Record<string, unknown>): string | null {
  if (value == null || !isSentinel(field, value)) return null;
  if (field === "subwayDist" && row.icDist == null && row.ktxDist == null) return null;
  return `${SENTINEL_RADIUS_KM[field as SentinelField]}km 안에 없음`;
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

/** "고양덕은 도시개발사업 0.3km" → 이름 "고양덕은 도시개발사업" · 300m. 끝에 km 가 없으면 이름만 */
const KM_TAIL_RE = /^(.*?)\s*(\d+(?:\.\d+)?)\s*km\s*$/i;
export function parseKmText(raw: unknown): { name: string | null; m: number | null } {
  if (typeof raw !== "string" || !raw.trim()) return { name: null, m: null };
  const t = raw.trim();
  const mm = KM_TAIL_RE.exec(t);
  if (!mm) return { name: t, m: null };
  const km = Number(mm[2]);
  return { name: mm[1].trim() || null, m: Number.isFinite(km) ? km * 1000 : null };
}

type Row = {
  key: string;
  label: string;
  /** 개발 사업지의 이름(라벨 아래 작은 글씨) */
  name: string | null;
  /** 거리(m) */
  v: number | null;
  /** 센티널 — 점 대신 적는 글자 */
  out: string | null;
  /** 그릴 줄인가(`onlyWhenPresent` 축에서 이름·거리가 다 없으면 false) */
  present: boolean;
};

function readRow(it: DistanceItem, raw: Record<string, unknown>): Row {
  const base = { key: distanceItemKey(it), label: it.label, name: null, out: null };
  if (it.schoolType) {
    const v = nearestSchoolDistance(schoolsOf(raw[it.field]), it.schoolType);
    return { ...base, v, present: v != null };
  }
  if (it.kmInText) {
    const p = parseKmText(raw[it.field]);
    return { ...base, name: p.name, v: p.m, present: p.name != null || p.m != null };
  }
  const n = usable(it.field, raw[it.field]);
  const v = n == null ? null : it.unit === "km" ? n * 1000 : n;
  const out = outOfRange(it.field, raw[it.field], raw);
  const name =
    it.nameField && typeof raw[it.nameField] === "string" && (raw[it.nameField] as string).trim()
      ? (raw[it.nameField] as string).trim()
      : null;
  const cnt = it.countField ? usableCount(raw[it.countField]) : null;
  return {
    ...base,
    // 세션 505: 라벨에 개수를 함께 적는다("병원 3곳").
    label: cnt != null ? `${it.label} ${cnt}곳` : it.label,
    name,
    v,
    out,
    present: name != null || v != null || out != null,
  };
}

export const DistanceDots = memo(function DistanceDots({ apt }: { apt: Apt }) {
  const raw = apt as unknown as Record<string, unknown>;
  const coordUnknown = raw.coordShared === true;

  const axes = DISTANCE_AXES.map((ax) => {
    const rows = ax.items.map((it) => readRow(it, raw));
    // 학교 줄도 없으면 안 그린다 — 목록에 고등학교가 없다는 건 "못 모았다"가 아니라 "주변 목록에
    // 없다"라서 "미수집"이라 적으면 거짓이다(옛 학군 카드도 그 줄을 안 그렸다).
    const keep = rows.filter((r, i) => r.present || !(ax.onlyWhenPresent || ax.items[i].schoolType));
    return { ...ax, rows: keep };
  }).filter((ax) => ax.rows.length > 0);
  const total = axes.reduce((s, a) => s + a.rows.length, 0);
  const filled = axes.reduce((s, a) => s + a.rows.filter((r) => r.v != null || r.out != null).length, 0);

  const height = axes.reduce((s, a) => s + 20 + a.rows.reduce((h, r) => h + ROW_H + (r.name ? NAME_H : 0), 0) + 10, 0);

  const near = axes
    .flatMap((a) => a.rows)
    .filter((r) => r.v != null)
    .sort((a, b) => (a.v as number) - (b.v as number))
    .slice(0, 3)
    .map((r) => `${r.label} ${fmtDist(r.v as number)}`)
    .join(", ");

  // 반경 숫자는 손으로 적지 않는다 — 수집기 반경과 대조되는 SENTINEL_RADIUS_KM 에서 만든다(세션591 보완 F5).
  const R = SENTINEL_RADIUS_KM;
  const hint =
    `점이 왼쪽에 있을수록 가까워요. 거리 자릿수가 크게 달라서(카페는 500m 안, KTX역은 ${R.ktxDist}km 안) 비슷한 ` +
    `것끼리 묶어 줄을 나눴어요. 고속도로 IC는 ${R.icDist}km, KTX역은 ${R.ktxDist}km, 지하철역은 ${R.subwayDist}km ` +
    "반경을 찾아봤고, 그 안에 없으면 '안에 없음'으로 적어요. 자료가 없는 시설은 '미수집'으로 둡니다. " +
    "혐오시설은 멀수록 좋은 것이라 이 그림에 넣지 않았어요.";

  // 좌표 공유 단지 — 거리는 전부 이 단지 좌표로 잰 값이라 점을 하나도 안 그린다(세션568-3 · 세션591 L7).
  if (coordUnknown) {
    return (
      <ChartFrame
        title="주변 시설까지 거리"
        hint={hint}
        ariaLabel="주변 시설까지 거리는 위치 확인 중입니다."
        height={40}
      >
        <div style={{ fontSize: F.sm, color: C.muted }} data-state="coord-unknown">
          위치 확인 중
        </div>
      </ChartFrame>
    );
  }

  return (
    <ChartFrame
      title="주변 시설까지 거리"
      hint={hint}
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
              <div key={r.key} data-row={r.key}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, height: ROW_H }}>
                  <span style={{ width: LABEL_W, flexShrink: 0, fontSize: F.sm, color: C.muted }}>{r.label}</span>
                  {r.out != null && !has ? (
                    // 센티널 — 점이 아니라 사실 한 줄("20km 안에 없음")
                    <span
                      data-state="out-of-range"
                      style={{ flex: 1, minWidth: 60, fontSize: F.sm, color: C.muted, whiteSpace: "nowrap" }}
                    >
                      {r.out}
                    </span>
                  ) : (
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
                  )}
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
                    {has ? fmtDist(r.v as number) : r.out != null ? "" : "미수집"}
                  </span>
                </div>
                {r.name && (
                  <div
                    title={r.name}
                    style={{
                      height: NAME_H,
                      marginLeft: LABEL_W + 6,
                      fontSize: F.xs,
                      color: C.sub,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {r.name}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </ChartFrame>
  );
});
