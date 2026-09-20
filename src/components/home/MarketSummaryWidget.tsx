import { memo, useMemo, useState } from "react";
import { C, F } from "@/theme";
import { WidgetCard } from "./WidgetCard";
import type { ScoredApt } from "@/types/hooks";

/** 가격대 칸 클릭 = 그 예산으로 목록 보기. 억 단위(BudgetPanel 과 같은 단위). */
export type BudgetNav = { minEok: number | null; maxEok: number | null };

type MarketSummaryWidgetProps = {
  scored: ScoredApt[];
  dataFreshnessText: string | null;
  /** 가격대 클릭 — 예산 필터를 걸고 목록으로. 미전달 시 정적(테스트 호환) */
  onBudgetNav?: (_label: string, _nav: BudgetNav) => void;
  /** 지역 막대 클릭 — 그 지역으로 필터를 걸고 목록으로. 미전달 시 막대는 정적 */
  onRegionNav?: (_region: string) => void;
};

/**
 * 가격대 구간 — 경계는 **BudgetPanel 의 프리셋(3/5/7/10억)과 같다.**
 * 현황판에서 넘어간 손님이 목록의 예산 프리셋 버튼과 같은 경계를 보게 하려는 것이다.
 * 경계를 따로 정하면 "현황판은 8억인데 목록 버튼은 7억"처럼 두 화면이 다른 말을 한다.
 *
 * ⚠️ 중위값을 내지 않는다. 전국 중위 하나는 p10~p90 이 2.9배(1,461~4,288만원/평) 퍼진 것을
 * 숨기고, 그 숫자가 자기 얘기인 손님이 거의 없다. 손님의 물음은 "전국이 대체로 얼마냐"가
 * 아니라 **"내 예산에 뭐가 몇 개 있냐"** 라서, 구간별 개수가 그 물음에 바로 답한다.
 * 덤으로 총액은 기준이 하나뿐이라(손님이 실제로 내는 돈) 면적 기준 혼재 문제도 없다.
 *
 * 실측(2026-09-20 라이브 1,829곳): 184 / 819 / 477 / 236 / 113 — 한 구간이 비지 않는다.
 */
const BUDGET_BANDS: Array<{ label: string; minEok: number | null; maxEok: number | null }> = [
  { label: "3억 미만", minEok: null, maxEok: 3 },
  { label: "3~5억", minEok: 3, maxEok: 5 },
  { label: "5~7억", minEok: 5, maxEok: 7 },
  { label: "7~10억", minEok: 7, maxEok: 10 },
  { label: "10억 이상", minEok: 10, maxEok: null },
];

/** 만원 단위 가격 → 억 */
const EOK = 10000;

/**
 * 표본이 이보다 적은 지역은 중위값이 한두 단지에 휘둘린다.
 * 값을 감추지는 않되(그 지역 손님에게는 자기 지역이 보여야 한다) 몇 곳 기준인지 함께 적는다.
 * 실측 근거(2026-09-20 라이브 1,895곳): 제주 10곳 55.5% · 세종 10곳 0.5% —
 * 2위 부산(9.7%)의 5.7배인 제주가 오류가 아니라 실제값이라, 감추면 거짓이 되고
 * 표식 없이 두면 "제주가 전국 최악"으로 읽힌다.
 */
const SMALL_SAMPLE_N = 20;

/**
 * 처음에 보여줄 지역 수. 17개를 다 펼치면 현황판이 휴대폰 화면의 73%(1,171px)를 먹어
 * 홈의 다른 위젯(추천·지도·최근 본)이 한참 아래로 밀린다(세션552 화면 실측).
 * 미분양률이 높은 5곳이 이 위젯의 요지라 그것만 먼저 보이고, 나머지는 눌러서 편다.
 */
const REGION_PREVIEW_N = 5;

function median(sorted: number[]): number | null {
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
}

/** 유효한 숫자만 오름차순으로 (null·비유한 제외) */
function numsAsc(values: Array<number | null | undefined>): number[] {
  return values.filter((v): v is number => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
}

export type BudgetBucket = { label: string; count: number; minEok: number | null; maxEok: number | null };

/**
 * 가격대별 단지 수. 가격 없는 단지는 어느 구간에도 넣지 않는다(억지로 채우지 않는다).
 * 새 수집 0: 이미 로드된 scored 를 클라이언트에서 집계한다(원장 Q5 "집계만").
 */
export function buildBudgetBuckets(scored: ScoredApt[]): BudgetBucket[] {
  return BUDGET_BANDS.map((b) => {
    const lo = b.minEok == null ? -Infinity : b.minEok * EOK;
    const hi = b.maxEok == null ? Infinity : b.maxEok * EOK;
    const count = scored.filter((s) => {
      const p = s.apt.price;
      // 가격이 없거나 0 이하면 제외 — "3억 미만"에 쓸어 담지 않는다
      if (typeof p !== "number" || !Number.isFinite(p) || p <= 0) return false;
      return p >= lo && p < hi;
    }).length;
    return { label: b.label, count, minEok: b.minEok, maxEok: b.maxEok };
  });
}

export type RegionBar = {
  region: string;
  /** 그 지역 단지 수(전체) */
  count: number;
  /** 미분양률 값이 있는 단지 수 = 중위값의 실제 표본 */
  sampleN: number;
  medUnsoldRate: number | null;
  /** 표본이 적어 중위값이 흔들릴 수 있는 지역 */
  smallSample: boolean;
};

/**
 * 지역별 미분양률 중위 — 높은 순. 값이 없는 지역은 뒤로 민다.
 * 여기서는 중위를 쓴다 — 지역 안에서는 "그 지역이 대체로 어떤가"가 곧 손님의 물음이고,
 * 17개 지역을 나란히 놓는 것 자체가 전국 하나로 줄이지 않는다는 뜻이다.
 */
export function buildRegionBars(scored: ScoredApt[]): RegionBar[] {
  const byRegion = new Map<string, ScoredApt[]>();
  for (const s of scored) {
    const r = s.apt.region;
    if (!r) continue;
    const bucket = byRegion.get(r);
    if (bucket) bucket.push(s);
    else byRegion.set(r, [s]);
  }
  const bars: RegionBar[] = [];
  for (const [region, items] of byRegion) {
    const rates = numsAsc(items.map((s) => s.apt.unsoldRate));
    bars.push({
      region,
      count: items.length,
      sampleN: rates.length,
      medUnsoldRate: median(rates),
      smallSample: rates.length > 0 && rates.length < SMALL_SAMPLE_N,
    });
  }
  return bars.sort((a, b) => {
    // 순서 = ①값 있는 것 먼저 ②표본 충분한 것 먼저 ③미분양률 높은 순 ④단지 많은 순.
    // ②가 핵심 — 표본 10곳짜리 제주(55.5%)가 맨 위에서 가장 긴 막대를 차지하면,
    // 회색·표식을 붙여도 눈에는 "제주가 전국 최악"으로 읽힌다(세션552 화면 실측).
    // 값을 감추지 않으면서 순위만 내려 그 인상을 없앤다.
    if (a.medUnsoldRate == null && b.medUnsoldRate == null) return b.count - a.count;
    if (a.medUnsoldRate == null) return 1;
    if (b.medUnsoldRate == null) return -1;
    if (a.smallSample !== b.smallSample) return a.smallSample ? 1 : -1;
    if (b.medUnsoldRate !== a.medUnsoldRate) return b.medUnsoldRate - a.medUnsoldRate;
    return b.count - a.count;
  });
}

/**
 * 시장 현황판 (PR-5) — 가격대별 단지 수 + 지역별 미분양률 막대.
 * 점수 파생 금지(비로그인 공개 정책). 이미 로드된 scored 를 클라이언트 집계, 새 fetch 0.
 */
export const MarketSummaryWidget = memo(function MarketSummaryWidget({
  scored,
  dataFreshnessText,
  onBudgetNav,
  onRegionNav,
}: MarketSummaryWidgetProps) {
  const buckets = useMemo(() => buildBudgetBuckets(scored), [scored]);
  const bars = useMemo(() => buildRegionBars(scored), [scored]);

  const [regionsOpen, setRegionsOpen] = useState(false);
  const shownBars = regionsOpen ? bars : bars.slice(0, REGION_PREVIEW_N);

  const maxBucket = useMemo(() => buckets.reduce((m, b) => (b.count > m ? b.count : m), 0), [buckets]);
  const maxRate = useMemo(
    () => bars.reduce((m, b) => (b.medUnsoldRate != null && b.medUnsoldRate > m ? b.medUnsoldRate : m), 0),
    [bars]
  );

  const bucketInner = (b: BudgetBucket) => (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6 }}>
        <span style={{ fontSize: F.sm, fontWeight: 700, color: C.text }}>{b.label}</span>
        <span style={{ fontSize: F.sm, fontWeight: 800, color: C.text }}>{b.count.toLocaleString()}곳</span>
      </div>
      <div style={{ background: C.slate100, borderRadius: 4, height: 6, overflow: "hidden", marginTop: 3 }}>
        <div
          style={{
            width: `${maxBucket > 0 ? (b.count / maxBucket) * 100 : 0}%`,
            height: "100%",
            background: C.indigo,
            borderRadius: 4,
          }}
        />
      </div>
    </>
  );

  const barRow = (b: RegionBar) => {
    const pct = b.medUnsoldRate != null && maxRate > 0 ? (b.medUnsoldRate / maxRate) * 100 : 0;
    // 표본이 적은 지역은 값을 감추지 않고 "N곳 기준"을 함께 적는다
    const valueText = b.medUnsoldRate != null ? `${b.medUnsoldRate.toFixed(1)}%` : "—";
    const noteText = b.smallSample ? ` · ${b.sampleN}곳 기준` : "";
    return (
      <>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6 }}>
          <span style={{ fontSize: F.sm, fontWeight: 700, color: C.text }}>{b.region}</span>
          <span style={{ fontSize: F.xs, color: b.smallSample ? C.muted : C.text, fontWeight: 700 }}>
            {valueText}
            {noteText && <span style={{ fontWeight: 400 }}>{noteText}</span>}
          </span>
        </div>
        <div style={{ background: C.slate100, borderRadius: 4, height: 6, overflow: "hidden", marginTop: 3 }}>
          <div
            style={{
              width: `${pct}%`,
              height: "100%",
              background: b.smallSample ? C.muted : C.blue,
              borderRadius: 4,
            }}
          />
        </div>
      </>
    );
  };

  return (
    <WidgetCard title="📊 시장 현황판">
      <div>
        <div style={{ fontSize: F.xs, color: C.muted, marginBottom: 6 }}>가격대별 단지 수 (분양가 기준)</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {buckets.map((b) =>
            onBudgetNav ? (
              <button
                key={b.label}
                onClick={() => onBudgetNav(b.label, { minEok: b.minEok, maxEok: b.maxEok })}
                aria-label={`${b.label} ${b.count}곳 — 이 가격대 목록 보기`}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  background: "transparent",
                  border: "none",
                  padding: "4px 2px",
                  cursor: "pointer",
                  minHeight: 40,
                }}
              >
                {bucketInner(b)}
              </button>
            ) : (
              <div key={b.label} style={{ padding: "4px 2px" }}>
                {bucketInner(b)}
              </div>
            )
          )}
        </div>
      </div>

      {bars.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <div style={{ fontSize: F.xs, color: C.muted, marginBottom: 6 }}>지역별 미분양률 (중위, 높은 순)</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {shownBars.map((b) =>
              onRegionNav ? (
                <button
                  key={b.region}
                  onClick={() => onRegionNav(b.region)}
                  aria-label={`${b.region} 미분양률 중위 ${b.medUnsoldRate != null ? `${b.medUnsoldRate.toFixed(1)}%` : "정보 없음"}${b.smallSample ? ` (${b.sampleN}곳 기준)` : ""} — ${b.region} 목록 보기`}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    background: "transparent",
                    border: "none",
                    padding: "4px 2px",
                    cursor: "pointer",
                    minHeight: 40,
                  }}
                >
                  {barRow(b)}
                </button>
              ) : (
                <div key={b.region} style={{ padding: "4px 2px" }}>
                  {barRow(b)}
                </div>
              )
            )}
          </div>
          {bars.length > REGION_PREVIEW_N && (
            <button
              onClick={() => setRegionsOpen((v) => !v)}
              aria-expanded={regionsOpen}
              style={{
                marginTop: 8,
                background: "transparent",
                border: "none",
                color: C.blue,
                fontSize: F.sm,
                fontWeight: 700,
                cursor: "pointer",
                padding: "6px 2px",
                minHeight: 36,
              }}
            >
              {regionsOpen ? "접기 ▲" : "지역 " + (bars.length - REGION_PREVIEW_N) + "개 더 보기 ▾"}
            </button>
          )}
        </div>
      )}

      <div style={{ fontSize: F.xs, color: C.muted, marginTop: 2 }}>
        전국 {scored.length.toLocaleString()}개 단지 · {dataFreshnessText ?? "갱신일 정보 없음"}
      </div>
    </WidgetCard>
  );
});
