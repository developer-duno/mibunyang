import { useMemo, useState } from "react";
import { usePresaleDetail, type PresaleScheduleOfficial } from "@/hooks/usePresaleDetail";
import { closestChipIndex, noticeUnitChips, type UnitChip } from "@/lib/fundingPlan";
import type { Apt } from "@/types/scoring";

/**
 * 금융 탭 「평수 단추」 선택 — 막대(`LoanStack`)·잔금 카드(`FundingPlanner`)·한 달 상환(`MonthlyPaymentBlock`)이
 * 같은 평수 값 하나로 계산하게 하는 상태(세션675 결정 나 「막대도 손님이 누른 평수로」).
 *
 * 옛날엔 카드만 평수 값을 쓰고 막대·한 달 상환은 대표 분양가를 써서 한 화면에 대출 금액이 두 개 나왔다.
 * 셋의 공통 부모(`LoanAnalysis`)가 이 훅을 한 번 부르고 값을 내려 준다 — 평형표 조회도 여기 한 번뿐이다.
 */
export type UnitChoice = {
  /** 대표 분양가가 있나 — 없으면 평형표도 부르지 않는다 */
  hasPrice: boolean;
  /** 대표 분양가(만원) */
  aptPrice: number;
  chips: UnitChip[];
  /** 고른 단추 번호 — 단추가 없으면 -1 */
  chipIdx: number;
  select: (_i: number) => void;
  /** 계산에 쓸 분양가 = 고른 평수 값(단추가 없으면 대표 분양가) */
  price: number;
  /** 고른 평수 이름 — 단추가 없으면 null("대표 분양가 기준") */
  unitLabel: string | null;
  schedule: PresaleScheduleOfficial | null;
  firstRecruitDate: string | null;
  /** 평형표를 불러오는 중 — 이때는 금액을 그리지 않는다(대표 분양가로 먼저 그렸다 바꾸지 않게 · 세션675 검사 F7) */
  pending: boolean;
};

export function useUnitChoice(apt: Apt): UnitChoice {
  const aptPrice = Number(apt.price ?? 0);
  const hasPrice = Number.isFinite(aptPrice) && aptPrice > 0;
  // 분양가가 없으면 금융 탭이 계산하지 않으니 평형표도 부르지 않는다
  const { schedule, units, firstRecruitDate, loading } = usePresaleDetail(hasPrice ? String(apt.id) : null);
  const [sel, setSel] = useState<number | null>(null);

  const chips = useMemo(() => noticeUnitChips(units), [units]);
  // 첫 값 = 대표 분양가와 가장 가까운 평수(옛 카드 규칙 그대로)
  const chipIdx = sel != null && sel < chips.length ? sel : closestChipIndex(chips, aptPrice);
  const price = chipIdx >= 0 ? chips[chipIdx].price : aptPrice;
  const unitLabel = chipIdx >= 0 ? chips[chipIdx].label : null;

  return {
    hasPrice,
    aptPrice,
    chips,
    chipIdx,
    select: setSel,
    price,
    unitLabel,
    schedule,
    firstRecruitDate,
    pending: hasPrice && loading,
  };
}
