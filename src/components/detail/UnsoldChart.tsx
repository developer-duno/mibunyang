import { memo } from "react";
import { C, F } from "@/theme";
import { LineChart } from "@/components/primitives";
import { useUnsoldHistory } from "@/hooks/useUnsoldHistory";
import { HelpHint } from "@/components/HelpHint";
import type { UnsoldChartProps } from "@/types/detail";

const UNSOLD_CHART_HINT =
  "이 단지의 안 팔린 세대(미분양)가 달마다 어떻게 변했는지예요. 빨강은 전체 미분양, 점선(┄)은 다 지어진 뒤에도 안 팔린 '준공후 미분양'이라 더 주의해서 봐야 해요. 매월 자동 수집.";

/** 미분양 추이 차트 — DetailModal 내 표시 */
export const UnsoldChart = memo(function UnsoldChart({ apartmentId, siblingIds, unsold }: UnsoldChartProps) {
  const { data, loading, error, retry } = useUnsoldHistory(apartmentId, siblingIds);

  if (!apartmentId) return null;
  // 현재 미분양 값이 없는(hold·출처 없이 비움) 단지의 옛 이력은 "지금도 미분양이 줄고 있다"로 읽힌다 — 세션577 검사관 C 1-2.
  // unsold_source 는 화면에 안 오므로 현재 값 null 로 판정한다. 0 은 "자료 있음"이라 그린다.
  if (unsold == null) return null;
  if (loading)
    return (
      <div
        style={{
          height: 160,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: C.muted,
          fontSize: F.sm,
        }}
      >
        불러오는 중...
      </div>
    );
  if (error)
    return (
      <div
        style={{
          height: 80,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
        }}
      >
        <span style={{ color: C.muted, fontSize: F.sm }}>차트를 불러올 수 없습니다</span>
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
          재시도
        </button>
      </div>
    );
  if (data.length < 2) return null;

  interface UnsoldRow {
    base_month?: string;
    unsold_count?: number | null;
    post_completion_unsold?: number | null;
  }
  // 월 형식(YYYYMM, 달 01~12)이 아닌 행은 그 점을 그리지 않는다(두 계열 모두) — MarketStatsCharts baseMonthLabel 과 같은 검사.
  //   (세션594 — 옛 `.slice(4)` 는 분기 꼴 "20262" 가 섞이면 x 가 "2" 인 가짜 점을 그렸다.)
  const parseMonth = (raw: string | undefined): { yy: string; mm: string } | null => {
    const m = /^(\d{4})(0[1-9]|1[0-2])$/.exec(raw ?? "");
    return m ? { yy: m[1].slice(2), mm: m[2] } : null;
  };
  const rows = (data as UnsoldRow[]).slice(-24).filter((row) => parseMonth(row.base_month) != null);
  // x 글자(세션594 사장님 결정): **첫 점과 1월 점만** "26.01"(연도 두 자리.월), 나머지는 "02"처럼 월만 —
  //   해가 바뀌는 자리가 보이고, 12점이 다 그려져도(LineChart 는 12점 이하일 때 x 글자를 전부 그린다) 안 겹친다.
  //   전부 "YY.MM" 이면 12점에서 휴대폰·PC 모두 이웃 글자와 겹쳤다(세션594 캡처).
  const xOf = new Map(
    rows.map((row, i) => {
      const { yy, mm } = parseMonth(row.base_month) as { yy: string; mm: string };
      return [row, i === 0 || mm === "01" ? `${yy}.${mm}` : mm] as const;
    })
  );
  const chartData = rows.map((row: UnsoldRow) => ({
    x: xOf.get(row) as string,
    y: row.unsold_count ?? 0,
    label: `${row.base_month}: 미분양 ${(row.unsold_count ?? 0).toLocaleString()}세대`,
  }));

  const secondaryData = rows
    .filter((row: UnsoldRow) => row.post_completion_unsold != null)
    .map((row: UnsoldRow) => ({
      x: xOf.get(row) as string,
      y: row.post_completion_unsold ?? 0,
    }));

  if (chartData.length < 2) return null;

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ display: "flex", alignItems: "center", fontSize: F.sm, fontWeight: 700, color: C.text }}>
          미분양 추이
          <HelpHint text={UNSOLD_CHART_HINT} label="미분양 추이" />
        </span>
        <span style={{ fontSize: F.micro, color: C.red }}>● 미분양</span>
        {secondaryData.length >= 2 && <span style={{ fontSize: F.micro, color: C.muted }}>┄ 준공후</span>}
      </div>
      <LineChart
        data={chartData}
        color={C.red}
        height={160}
        yLabel="미분양 추이"
        secondaryData={secondaryData.length >= 2 ? secondaryData : undefined}
        secondaryColor={C.amber}
      />
    </div>
  );
});
