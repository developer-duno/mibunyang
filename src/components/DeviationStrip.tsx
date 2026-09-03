import { memo, useMemo } from "react";
import { C, F } from "@/theme";
import { HelpHint } from "./HelpHint";
import { DeviationRow, ROW_HEIGHT } from "./DeviationRow";
import { computeDeviation } from "@/lib/deviation";
import type { DeviationFieldSpec } from "@/constants/deviationFields";
import type { RegionalStats } from "@/scoring/regionalStats";
import type { Apt } from "@/types/scoring";

const ROW_GAP = 5;
const HEADER_HEIGHT = 16;
const HEADER_MARGIN = 4;

/** 블록 전체 높이 — 줄 수만으로 결정된다(결측이어도 행이 사라지지 않으므로 항상 같다) */
export function stripHeight(rowCount: number): number {
  return HEADER_HEIGHT + HEADER_MARGIN + rowCount * ROW_HEIGHT + Math.max(0, rowCount - 1) * ROW_GAP;
}

// 세션539 A-6 후속: 헤더(:82 근방)와 `lib/deviation.ts` 의 스크린리더 문장은 "분양 단지"로
// 고쳤는데 **같은 위젯의 도움말만 "아파트"로 남아 있었다** — 한 위젯이 두 말을 하는 자리다.
// 대조군(`regionalStats.ts:90`)은 `region` 하나로만 묶어 오피스텔·재건축이 섞여 있으므로
// "아파트"는 그 모집단을 잘못 부르는 이름이다. 나중에 버킷을 유형별로 가르기로 결정하면
// 이 세 자리를 **함께** 고쳐야 한다(모집단 서술을 하드코딩한 자리가 여기까지 셋).
const HELP_TEXT =
  "막대가 오른쪽으로 길수록 이 단지가 유리해요. " +
  "가운데 세로선은 같은 지역 분양 단지들의 한가운데 값입니다. " +
  "그 지역 단지를 값 순서대로 줄 세웠을 때 정확히 가운데 있는 곳이 기준이에요. " +
  "평균과 달리, 아주 비싼 곳 몇 개 때문에 기준이 흔들리지 않습니다.";

const S = {
  wrap: { marginTop: 10 },
  header: {
    display: "flex",
    alignItems: "center",
    height: HEADER_HEIGHT,
    marginBottom: HEADER_MARGIN,
    fontSize: F.sm,
    color: C.muted,
  },
  rows: { display: "flex", flexDirection: "column" as const, gap: ROW_GAP },
  badge: {
    marginLeft: 4,
    fontSize: F.sm,
    color: C.muted,
    background: C.bg,
    borderRadius: 4,
    padding: "0 4px",
  },
};

/**
 * "이 단지 vs 같은 지역 한가운데 값" 편차 막대 블록.
 *
 * 카드와 팝업이 **같은 컴포넌트**를 쓴다 — 트랙 폭만 다르다.
 * 카드에서 배운 읽는 법이 팝업에서 그대로 통해야 하기 때문이다.
 *
 * ⚠️ 화면에 "중위값"·"백분위" 같은 전문어를 쓰지 않는다. 정확한 정의는 헤더 옆 `?` 안에 있다.
 * ⚠️ 결측이어도 행을 지우지 않는다 — 단지마다 줄 수가 달라지면 무한스크롤에서 스크롤 위치가 튄다.
 */
export const DeviationStrip = memo(function DeviationStrip({
  apt,
  fields,
  regionStats,
  compact = true,
}: {
  apt: Apt;
  fields: readonly DeviationFieldSpec[];
  regionStats: RegionalStats | null | undefined;
  /** 카드용(true)은 헤더 글씨가 작고, 팝업용(false)은 위 여백이 넓다 */
  compact?: boolean;
}) {
  const raw = apt as unknown as Record<string, unknown>;
  const region = (raw.region as string) || "";
  const regionLabel = region || "전국";

  const rows = useMemo(
    () => fields.map((spec) => ({ spec, dev: computeDeviation(spec, raw[spec.field], region, regionStats) })),
    [fields, raw, region, regionStats]
  );

  // 한 줄이라도 전국 기준으로 그렸으면 블록 헤더에 한 번만 알린다(줄마다 배지를 달면 시끄럽다).
  const usedNational = rows.some((r) => r.dev.nationalFallback && r.dev.state === "ok");

  return (
    <div style={compact ? S.wrap : { ...S.wrap, marginTop: 14 }}>
      <div style={S.header}>
        {/* 세션539 A-6: "아파트"라고 단정했었다 — 대조군(regionalStats.ts:90)은 `region` 하나로만
            묶어 오피스텔·재건축이 섞여 있다(presaleHousingType 은 안 본다). 버킷을 유형별로
            가르는 결정(D-2, 별도 PR)이 나면 이 문구도 또 바뀌므로, 지금은 모집단을 단정하지
            않는 중립어로만 고친다 — "분양 단지"는 규모·유형에 상관없이 항상 참이다. */}
        <span>{regionLabel} 분양 단지 한가운데 값과 비교</span>
        {usedNational && <span style={S.badge}>일부 전국 기준</span>}
        <HelpHint text={HELP_TEXT} label="지역 비교" />
      </div>
      <div style={S.rows}>
        {rows.map(({ spec, dev }) => (
          <DeviationRow
            key={spec.field}
            spec={spec}
            dev={dev}
            value={raw[spec.field]}
            regionLabel={regionLabel}
            compact={compact}
          />
        ))}
      </div>
    </div>
  );
});
