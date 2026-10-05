import { memo, useMemo } from "react";
import { C, F } from "@/theme";
import { Sparkline } from "@/components/charts/Sparkline";
import { HelpHint } from "@/components/HelpHint";
import { useMarketStatsHistory } from "@/hooks/useMarketStatsHistory";
import type { MarketStatsChartsProps } from "@/types/detail";

interface MarketMetric {
  key: string;
  label: string;
  unit: string;
  color: string;
  hint: string;
  /**
   * 자료 주기 — 없으면 월간. 분기 표(KOSIS DT_41401N_008 초기분양률, `collect-market-stats.mjs:64` prdSe "Q")는
   * `base_month` 뒤 자리가 달이 아니라 **분기 번호**다(운영 DB 실측 2026-10-04: 초기분양률 행의 뒤 두 자리는 01~04 뿐 —
   * 202602 = 2026년 2분기). 이 칸이 없으면 "2026.02 기준"(2월)이라 거짓을 적는다.
   */
  period?: "M" | "Q";
}
interface MarketRow {
  base_month?: string;
  [key: string]: unknown;
}

// "지역 시장 추이" 상단 안내 — KOSIS 광역 시도 평균 출처 (세션 411 도움말)
const SECTION_HINT =
  "이 지역(시·도) 전체의 분양 시장 흐름이에요. 이 단지 하나가 아니라 주변 평균 추세를 보여줘요. (출처: KOSIS 통계 — 초기분양율은 분기마다, 나머지는 매달 갱신)";

// 4지표 메타 정보(세션592 — 분양가격지수 뺌) — KOSIS 시계열 컬럼 ↔ 한국어 라벨/단위/색/도움말.
// hint = "보는 법" 쉬운 말 (세션 411 — 단위·scoring 방향 적대검증 정정).
const METRICS: MarketMetric[] = [
  {
    key: "avg_price_sqm",
    label: "평균분양가격",
    unit: "천원/㎡",
    color: C.green,
    hint: "주변에서 새로 분양한 아파트의 1㎡당 평균 분양가(단위: 천원)예요. 위로 오르면 분양가가 비싸지는 흐름이에요.",
  },
  // 세션592 사장님 결정: "분양가격지수"(price_index) 그림은 뺐다 — 원천(KOSIS)이 2025-10 에서 멈춰 최신 값이
  //   1년 가까이 낡았다. 같은 흐름은 바로 위 평균분양가격(㎡당) 그림이 말한다.
  {
    key: "new_supply",
    label: "신규공급 세대수",
    unit: "세대",
    color: C.purple,
    hint: "이 지역에 새로 공급된 아파트 세대 수예요. 많이 늘면 공급이 풍부, 줄면 귀해지는 신호예요.",
  },
  {
    key: "initial_sale_rate",
    label: "초기분양율",
    unit: "%",
    color: C.amber,
    hint: "분양 시작 후 초기에 얼마나 팔렸는지(%)예요. 높을수록 인기 많고 안전, 낮으면 미분양 위험 신호예요. 이 값은 분기(3개월)마다 나와요.",
    period: "Q",
  },
  {
    key: "land_cost_ratio",
    label: "택지비율",
    unit: "%",
    color: C.cyan,
    hint: "분양가 중 땅값이 차지하는 비율(%)이에요. 높을수록 거품이 적고 안정적이라고 봐요.",
  },
];

/**
 * `base_month` → 기준 시점 글자 (E16 — 연도까지). 모양을 모르면 "" — 틀린 달·분기를 말하지 않고 생략한다.
 * - 월간: "202608" → "2026.08" (달 01~12 만)
 * - 분기: "202602" → "2026년 2분기" (뒤 두 자리 01~04 만) · "20262" → 같은 뜻(수집기가 가정하는 KOSIS 5자리 꼴)
 */
export const baseMonthLabel = (raw: unknown, period: "M" | "Q" = "M"): string => {
  if (typeof raw !== "string") return "";
  if (period === "Q") {
    const m = /^(\d{4})(?:0([1-4])|([1-4]))$/.exec(raw);
    return m ? `${m[1]}년 ${m[2] ?? m[3]}분기` : "";
  }
  const m = /^(\d{4})(0[1-9]|1[0-2])$/.exec(raw);
  return m ? `${m[1]}.${m[2]}` : "";
};

/**
 * MarketStatsCharts — region+gu 시장통계 4지표 시계열(세션592: 분양가격지수 뺌)
 *
 * Props:
 *   region: string — DB 짧은 이름 ("서울"·"경기")
 *   gu: string — DB 표기 ("강남구") 또는 "" (시도 단위)
 *
 * - 그릴 자료 없음(행 2건 미만·그릴 지표 0) = null (세션594 — 옛 안내 상자 삭제)
 * - 정상 시 작은 칸 4개(이름 · 최신 값 · 작은 추이 선 · 기준 연·월)를 grid 배치 (세션591 P4 —
 *   옛 큰 `LineChart` 5개를 분양 탭 지역 통계 묶음 안에 접힘 없이 넣으려고 줄였다)
 * - region 미설정 / loading / error 시 null (조용한 숨김)
 */
export const MarketStatsCharts = memo(function MarketStatsCharts({ region, gu }: MarketStatsChartsProps) {
  const { data, loading, error, retry, fallback } = useMarketStatsHistory(region ?? "", gu ?? "") as {
    data: MarketRow[] | null;
    loading: boolean;
    error: unknown;
    retry: () => void;
    fallback: boolean;
  };

  // 각 metric 별로 유효 값이 2개 이상 있어야 차트 렌더 가능. 1개 이상 metric 이 그릴 수
  // 있어야 진짜 데이터 있음. data.length>=2 인데 4필드 모두 null 인 경우 + 1행만 값 있는
  // corner case (chartData.length<2 → 미렌더) 모두 렌더 없음으로 분기.
  // null/undefined 명시적 제외 — Number(null)=0 강제 변환 + isFinite(0)=true 통과 사고 방지.
  const hasRenderableMetric = useMemo(() => {
    if (!Array.isArray(data)) return false;
    return METRICS.some((m) => {
      const cnt = data.reduce((c: number, d: MarketRow) => {
        const raw = d?.[m.key];
        if (raw == null) return c;
        return c + (Number.isFinite(Number(raw)) ? 1 : 0);
      }, 0);
      return cnt >= 2;
    });
  }, [data]);

  if (!region) return null;
  if (loading)
    return (
      <div
        style={{
          height: 120,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: C.muted,
          fontSize: F.sm,
          marginTop: 16,
        }}
      >
        시장 통계를 불러오는 중...
      </div>
    );
  if (error)
    return (
      <div
        style={{
          height: 96,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          marginTop: 16,
        }}
      >
        <span style={{ color: C.muted, fontSize: F.sm }}>시장 통계를 불러올 수 없습니다</span>
        <button
          onClick={retry}
          style={{
            fontSize: F.xs,
            padding: "4px 10px",
            borderRadius: 4,
            border: `1px solid ${C.border}`,
            background: C.slate100,
            color: C.slate600,
            cursor: "pointer",
          }}
        >
          다시시도
        </button>
      </div>
    );

  // 그릴 자료가 없으면(행 2건 미만 · 행은 있어도 그릴 지표 0) 아무것도 안 그린다 — 세션594: 옛 안내 상자는
  //   우리 수집 상태를 손님에게 말하는 글이었다(our-defect-is-not-customer-warning).
  if (!Array.isArray(data) || data.length < 2) return null;
  if (!hasRenderableMetric) return null;

  // 폴백 응답 (API 가 gu="" 시도 자동 폴백) 시 헤더에 "시도 평균" 명시
  const headerSuffix = fallback ? " 시도 평균" : gu ? ` ${gu}` : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", fontSize: F.xs, fontWeight: 700, color: C.sub }}>
        지역 시장 추이 ({region}
        {headerSuffix})
        <HelpHint text={SECTION_HINT} label="지역 시장 추이" />
      </div>
      {/* 작은 칸 4개 — 세션592 에 분양가격지수를 빼 5 → 4 (세션591 P4 — 옛 큰 선 그래프 5개[칸마다 120px]를 작은 추이 선으로 줄였다).
          auto-fit minmax 120px: 휴대폰 390 폭에서 2열, PC(분양 탭 폭 ~690)에서 4칸이 한 줄을 채운다
          (auto-fill 이면 5칸 자리를 잡아 오른쪽에 빈 칸 하나 폭이 남는다 — 세션592 캡처). */}
      <div
        data-testid="market-charts-grid"
        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}
      >
        {METRICS.map((m) => {
          type Point = { month: string | undefined; v: number };
          const pts: Point[] = data
            .map((d: MarketRow) => {
              // null/undefined 명시적 제외 — Number(null)=0 + isFinite(0)=true 강제 변환 사고 방지
              const raw = d?.[m.key];
              if (raw == null) return null;
              const v = Number(raw);
              if (!Number.isFinite(v)) return null;
              return { month: d?.base_month, v };
            })
            .filter((x): x is Point => x !== null);
          if (pts.length < 2) return null;
          const last = pts[pts.length - 1];
          const asOf = baseMonthLabel(last.month, m.period ?? "M");
          const latest = last.v.toLocaleString("ko-KR");
          return (
            <div key={m.key} data-metric={m.key} style={{ background: C.card, borderRadius: 8, padding: "6px 8px" }}>
              <div style={{ display: "flex", alignItems: "center", fontSize: F.xs, color: C.muted, fontWeight: 600 }}>
                {m.label}
                <HelpHint text={m.hint} label={m.label} />
              </div>
              {/* 최신 값 — F.base(세션591 보완 F7). 단위·기준 표기는 보조 글자라 작게 둔다. */}
              <div style={{ fontSize: F.base, fontWeight: 700, color: C.text, whiteSpace: "nowrap" }}>
                {latest}
                <span style={{ fontSize: F.micro, fontWeight: 500, color: C.muted, marginLeft: 3 }}>{m.unit}</span>
              </div>
              <Sparkline
                values={pts.map((p) => p.v)}
                color={m.color}
                ariaLabel={`${m.label} 추이, 최근 ${latest} ${m.unit}${asOf ? ` (${asOf} 기준)` : ""}`}
              />
              {/* E16 — 옛 x축은 월(두 자리)만 적어 연도가 섞여 읽혔다. 최신 값의 기준 시점을 연·월로 적는다. */}
              {asOf && <div style={{ fontSize: F.micro, color: C.muted }}>{asOf} 기준</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
});
