import type { TradeScopeAreaRow } from "@/types/scoring";

/** 평형대 한 묶음의 거래 요약 — 건수 합 · 최저 · 최고(만원). 가운데 값은 원자료가 없어 내지 않는다. */
export interface AreaGroupStat {
  n: number;
  min: number;
  max: number;
}

/** 평형별 실거래 표의 한 줄 (세션662 👤 B안 「평형대로 묶기」 · 결정 6~8). */
export interface AreaGroupRow {
  /** 줄 이름 = 그 줄 가장 작은 면적의 정수 부분(84.98·84.99·85.00 → 84) */
  key: number;
  /** 묶인 실제 면적(소수 둘째 반올림 · 오름차순 · 매매·전세 합집합) */
  areas: number[];
  /** 그 줄의 매매(또는 분양권) 면적만 — 위 상자(매매 같은 면적)와 견줄 때 쓴다 */
  saleAreas: number[];
  /** 매매(또는 분양권) — 전세만 있는 평형이면 null */
  sale: AreaGroupStat | null;
  /** 전세 — 없으면 null */
  jeonse: AreaGroupStat | null;
  /** 위 상자의 비교 기준 면적(둘째 반올림)과 1㎡ 이내 면적을 가진 줄(여럿이면 가장 가까운 면적의 줄) */
  isBase: boolean;
}

/** 묶는 폭 — 직전 면적과 이만큼(㎡) 이내면 같은 줄(사슬). 👤 결정 6 */
export const AREA_CHAIN_GAP_M2 = 1;

/** 면적 둘째 자리 반올림 — 위 상자(`PricePositionBox` scopeHeadText)·수집기(`_trade-scope.mjs` round2)와 같은 꼴 */
const round2 = (v: number): number => Math.round(v * 100) / 100;
/** 두 면적 차이가 1㎡ 이내인가 — 1/100㎡ 정수로 비교(84.98→85.98 의 부동소수 1.0000000000000142 를 막는다) */
const within = (a: number, b: number): boolean =>
  Math.abs(Math.round(a * 100) - Math.round(b * 100)) <= AREA_CHAIN_GAP_M2 * 100;

const validRows = (rows: unknown): TradeScopeAreaRow[] =>
  Array.isArray(rows)
    ? (rows as TradeScopeAreaRow[]).filter(
        (r) =>
          r != null &&
          Number(r.area) > 0 &&
          Number(r.n) > 0 &&
          r.min != null &&
          r.max != null &&
          Number.isFinite(Number(r.min)) &&
          Number.isFinite(Number(r.max))
      )
    : [];

function statOf(rows: TradeScopeAreaRow[]): AreaGroupStat | null {
  if (rows.length === 0) return null;
  return {
    n: rows.reduce((s, r) => s + Number(r.n), 0),
    min: Math.min(...rows.map((r) => Number(r.min))),
    max: Math.max(...rows.map((r) => Number(r.max))),
  };
}

/**
 * 같은 단지 면적별 매매(또는 분양권)·전세 표(`complexTable`·`complexJeonseTable`)를 평형대로 묶는다.
 * 매매·전세 면적(둘째 반올림)을 합쳐 오름차순으로 보고, 직전 면적과 1㎡ 이내면 같은 줄(사슬)이다.
 * 전세만 있는 평형도 줄이 된다(매매 null). `baseArea` 가 없거나(0·null) 1㎡ 이내 면적이 없으면 어느 줄도 `isBase` 가 아니다.
 */
export function groupAreaRows(sale: unknown, jeonse: unknown, baseArea: unknown): AreaGroupRow[] {
  const s = validRows(sale).map((r) => ({ ...r, area: round2(Number(r.area)) }));
  const j = validRows(jeonse).map((r) => ({ ...r, area: round2(Number(r.area)) }));
  const all = [...new Set([...s, ...j].map((r) => r.area))].sort((a, b) => a - b);
  if (all.length === 0) return [];

  const chains: number[][] = [];
  for (const a of all) {
    const last = chains[chains.length - 1];
    if (last && within(last[last.length - 1], a)) last.push(a);
    else chains.push([a]);
  }

  // ★ 기준 면적 = apt.area 둘째 자리 반올림(1/100㎡ 정수) — 반올림은 이 한 곳에서만 한다(👤 결정 8 · 재검사관 Y5:
  //   예전엔 반올림이 세 겹이라 하나를 빼도 결과가 같았다). 표 면적은 위에서 이미 round2 라 ×100 이 정확한 정수다.
  const baseC = Number(baseArea) > 0 ? Math.round(Number(baseArea) * 100) : null;
  let baseIdx = -1;
  let baseDist = Infinity;
  if (baseC != null) {
    chains.forEach((c, i) => {
      for (const a of c) {
        const d = Math.abs(Math.round(a * 100) - baseC);
        if (d <= AREA_CHAIN_GAP_M2 * 100 && d < baseDist) {
          baseDist = d;
          baseIdx = i;
        }
      }
    });
  }

  return chains.map((c, i) => {
    const inChain = (r: { area: number }) => c.includes(r.area);
    const sr = s.filter(inChain);
    const jr = j.filter(inChain);
    return {
      key: Math.floor(c[0]),
      areas: c,
      saleAreas: [...new Set(sr.map((r) => r.area))].sort((a, b) => a - b),
      sale: statOf(sr),
      jeonse: statOf(jr),
      isBase: i === baseIdx,
    };
  });
}
