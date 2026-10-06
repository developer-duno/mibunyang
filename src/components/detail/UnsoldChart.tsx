import { memo } from "react";
import { C, F } from "@/theme";
import { LineChart } from "@/components/primitives";
import { useUnsoldHistory } from "@/hooks/useUnsoldHistory";
import { HelpHint } from "@/components/HelpHint";
import type { UnsoldChartProps } from "@/types/detail";

const UNSOLD_CHART_HINT =
  "이 단지의 안 팔린 세대(미분양)가 달마다 어떻게 변했는지예요. 빨강은 전체 미분양, 점선(┄)은 다 지어진 뒤에도 안 팔린 '준공후 미분양'이라 더 주의해서 봐야 해요. 매월 자동 수집.";
const UNSOLD_SENTENCE_HINT =
  "이 단지의 안 팔린 세대(미분양)가 달마다 어떻게 변했는지예요. 모인 자료가 3개월치 이하라 그래프 대신 숫자로 적었어요. 매월 자동 수집.";

/**
 * 이력 점이 이 개수 이하면 차트 대신 한 줄 문장으로 적는다(세션589).
 * 점 2~3개로 선을 그으면 세로축을 꽉 채워 11→12 한 칸 변화가 급등처럼 보이고(204px 를 차지),
 * 실제로 이력이 있는 단지의 절반이 점 2개였다(2026-10-02 라이브 1,437곳 중 697곳).
 */
export const UNSOLD_SENTENCE_MAX_POINTS = 3;

interface UnsoldRow {
  base_month?: string;
  unsold_count?: number | null;
  post_completion_unsold?: number | null;
}

/** "202608" → "2026-08". 그 꼴이 아니면 받은 글자 그대로(Date 로 해석하지 않는다). */
function monthText(m: string | undefined): string {
  const x = /^(\d{4})(\d{2})$/.exec(m ?? "");
  return x ? `${x[1]}-${x[2]}` : (m ?? "");
}

/** 점 몇 개를 한 문장으로 — "미분양 318세대(2026-08) → 280세대(2026-09)". 그릴 값이 없으면 null. */
export function unsoldSentence(rows: readonly UnsoldRow[]): string | null {
  // 값이 빈 달은 0 으로 적지 않고 뺀다 — 안 잰 달을 "0세대"라 쓰면 거짓이다.
  const pts = rows.filter((r) => r.unsold_count != null);
  if (pts.length === 0) return null;
  const parts = pts.map((r) => `${(r.unsold_count as number).toLocaleString()}세대(${monthText(r.base_month)})`);
  const flat = pts.length >= 2 && pts.every((r) => r.unsold_count === pts[0].unsold_count);
  return `미분양 ${parts.join(" → ")}${flat ? " · 변동 없음" : ""}`;
}

/** 미분양 추이 — DetailModal 시세 탭. 점 4개부터 차트, 3개 이하는 한 줄 문장. */
export const UnsoldChart = memo(function UnsoldChart({ apartmentId, siblingIds, unsold }: UnsoldChartProps) {
  // 현재 미분양 값이 없으면 아래에서 아무것도 안 그리므로 이력도 부르지 않는다 —
  // 훅은 id 가 비면 요청을 보내지 않는다(훅 호출 자체는 순서 규칙상 조건문 안에 못 넣는다).
  const { data, loading, error, retry } = useUnsoldHistory(unsold == null ? null : apartmentId, siblingIds);

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

  const rows = (data as UnsoldRow[]).slice(-24);

  if (rows.length <= UNSOLD_SENTENCE_MAX_POINTS) {
    const sentence = unsoldSentence(rows);
    if (!sentence) return null;
    return (
      <div style={{ marginBottom: 14 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            fontSize: F.sm,
            fontWeight: 700,
            color: C.text,
            marginBottom: 6,
          }}
        >
          미분양 추이
          <HelpHint text={UNSOLD_SENTENCE_HINT} label="미분양 추이" />
        </div>
        <div data-testid="unsold-sentence" style={{ fontSize: F.base, color: C.text, lineHeight: 1.5 }}>
          {sentence}
        </div>
      </div>
    );
  }

  const chartData = rows.map((row: UnsoldRow) => ({
    x: (row.base_month || "").slice(4),
    y: row.unsold_count ?? 0,
    label: `${row.base_month}: 미분양 ${(row.unsold_count ?? 0).toLocaleString()}세대`,
  }));

  const secondaryData = rows
    .filter((row: UnsoldRow) => row.post_completion_unsold != null)
    .map((row: UnsoldRow) => ({
      x: (row.base_month || "").slice(4),
      y: row.post_completion_unsold ?? 0,
    }));

  return (
    <div style={{ marginBottom: 14 }}>
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
      {chartData.length < 6 && (
        <div style={{ fontSize: F.micro, color: C.muted, marginTop: 4, textAlign: "center" }}>
          데이터 {chartData.length}개 · 매월 자동 수집 누적 중
        </div>
      )}
    </div>
  );
});
