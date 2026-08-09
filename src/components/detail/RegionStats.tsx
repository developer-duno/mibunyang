import { memo, useState } from "react";
import { C, F } from "@/theme";
import { FIELD_META } from "@/constants/fieldMeta";
import { REGION_STATS_ROWS } from "@/constants/regionStatsFields";
import { HelpHint } from "@/components/HelpHint";
import { MarketStatsCharts } from "./MarketStatsCharts";
import type { Apt } from "@/types/scoring";

/**
 * RegionStats — "이 지역 통계" 서랍 (세션 507 PR-2)
 *
 * ## 왜 서랍인가
 *
 * 인구·의료·거래량 7종은 시세 탭 "시장/투자 지표" 표에서 이 단지 값들과 같은 모양으로
 * 늘어서 있었다. 손님에겐 분양가·층수와 구별이 안 돼 **이 단지 값으로 읽힌다.** 실제로는
 * 같은 동네 모든 단지가 공유하는 통계다. 그래서 ① 분양 탭의 지역 시장 추이 그래프 옆으로
 * 모으고 ② 닫힌 제목줄이 "이 단지 값이 아니다"를 먼저 말하고 ③ 각 줄 라벨에 어느 동네를
 * 잰 값인지 접두로 박았다.
 *
 * ## 채움 도넛을 안 그리는 이유
 *
 * 팝업의 도넛은 "**이 단지** 자료가 얼마나 모였나"를 뜻하는 기호다. 지역값에 같은 도넛을
 * 그리면 한 기호가 두 뜻을 갖게 돼, 이 서랍이 하려는 구분(단지값 ≠ 지역값)을 스스로 흐린다.
 * 제목줄·▼·? 도움말 무늬는 `DataSectionBlock` 과 똑같이 맞춰 형태 일관만 지킨다.
 */

const SECTION_HINT =
  "인구·순이동·주택보급률과 위 그래프는 시·도 단위, 출산율·의사수·병상수·거래량은 시·군·구 단위로 잰 통계예요. 이 단지 하나를 잰 값이 아니라 같은 동네 단지가 모두 공유하는 숫자라, 단지끼리 비교할 때가 아니라 '이 동네가 어떤 동네인가'를 볼 때 쓰세요. 인구증감률·순이동이 플러스면 사람이 늘어나는 동네라는 신호예요.";

const RS_S: Record<string, import("react").CSSProperties> = {
  // DataSectionBlock 의 DSB_S.container 와 같은 박스 (같은 탭 형제와 시각 일관)
  container: {
    background: C.bg,
    borderRadius: 10,
    padding: "10px 12px",
    marginBottom: 10,
    border: `1px solid ${C.border}`,
  },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, cursor: "pointer" },
  title: { fontSize: F.sm, fontWeight: 700, color: C.sub, display: "flex", alignItems: "center", flexWrap: "wrap" },
  // 제목 옆 한 줄 — "이 단지 값이 아니다"를 닫힌 상태에서 먼저 말한다
  subtitle: { fontSize: F.xs, fontWeight: 400, color: C.muted, marginLeft: 6 },
  body: { marginTop: 8 },
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px", marginTop: 12 },
  gridCell: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0", gap: 8 },
  gridLabel: { fontSize: F.xs, color: C.muted },
  gridValue: { fontSize: F.xs, fontWeight: 600, color: C.text },
};

export const RegionStats = memo(function RegionStats({ apt }: { apt: Apt }) {
  const [open, setOpen] = useState(false);
  const region = (apt.region as string | null) ?? "";
  const gu = (apt.gu as string | null) ?? "";

  // Q-B 결정(사장님, 2026-08-09): 7필드 중 4개가 시·군·구 단위라 "{region} 전체 통계"는
  // 그 4줄에 거짓이 된다. 구·시도를 병기하고, 구를 모르는 단지만 시도로 축약한다.
  const scopeText = gu ? `이 단지 값이 아니라 ${gu}·${region} 통계예요` : `이 단지 값이 아니라 ${region} 전체 통계예요`;

  // 시·군·구를 모르는 단지는 그 4줄도 시·도 이름으로 읽는다 (라벨이 빈 접두로 시작하지 않게)
  const prefixOf = (scope: "sido" | "gu") => (scope === "sido" ? region : gu || region);

  return (
    <div style={RS_S.container}>
      <div
        onClick={() => setOpen((v) => !v)}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
        style={RS_S.head}
      >
        <span style={RS_S.title}>
          🗂 이 지역 통계
          <span style={RS_S.subtitle}>{scopeText}</span>
          <HelpHint text={SECTION_HINT} label="이 지역 통계" />
        </span>
        <span
          style={{
            fontSize: F.sm,
            color: C.muted,
            transition: "transform .2s",
            transform: open ? "rotate(180deg)" : "rotate(0)",
            display: "inline-block",
          }}
        >
          ▼
        </span>
      </div>
      {open && (
        <div style={RS_S.body}>
          {/* 그래프는 손대지 않고 그대로 재사용 — 이 서랍은 "자리 옮김"이지 새 시각화가 아니다 */}
          <MarketStatsCharts region={apt.region} gu={apt.gu} />
          <div style={RS_S.grid}>
            {REGION_STATS_ROWS.map((r) => {
              const meta = (
                FIELD_META as Record<string, { fmt?: (_v: unknown, _apt: unknown) => unknown } | undefined>
              )[r.field];
              const val = apt[r.field];
              return (
                <div key={r.field} style={RS_S.gridCell}>
                  <span style={RS_S.gridLabel}>
                    {prefixOf(r.scope)} {r.label}
                  </span>
                  <span style={RS_S.gridValue}>{String(meta?.fmt ? meta.fmt(val, apt) : (val ?? "—"))}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
});
