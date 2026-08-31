import { BRAND_TIER, LAYOUT_SCORE, resolveBuilder } from "@/constants/brands";
import {
  tierMin,
  tierMax,
  UNIT_TIERS,
  UNIT_UNKNOWN_SCORE,
  UNIT_SMALL_SCORE,
  PARKING_TIERS,
  PARKING_LOW_SCORE,
  FAR_TIERS,
  FAR_HIGH_SCORE,
  ENERGY_SCORES,
  ENERGY_DEFAULT,
  GREEN_BLDG_SCORES,
  EXCL_RATIO_TIERS,
  EXCL_LOW_SCORE,
  FLOOR_TIERS,
  FLOOR_LOW_SCORE,
  PRODUCT_MAX,
  HOUSING_TYPE_CAP_DEFAULT,
  HOUSING_TYPE_CAP_NON_APT,
} from "@/constants/scoringTiers";
import type { Apt, Res } from "@/types/scoring";

const IS_DEV =
  typeof import.meta !== "undefined" && !!(import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV;

/**
 * 상품성 점수 (0~100). 9개 항목 합산 후 PRODUCT_MAX 합으로 정규화.
 *
 * PRODUCT_MAX 합계 = 100 (CLAUDE.md L44, 9개 max 합):
 *   brand · units · parking · far · energy · excl · layout · quake · struct
 * 정규화: `Math.max(0, Math.min(rawTotal / maxPossible × 100, 100))`.
 *
 * 핵심 보정:
 *   - 주택유형별 브랜드 상한: presaleHousingType이 "오피스텔"/"도시형" 포함 시
 *     HOUSING_TYPE_CAP_NON_APT(15), 그 외 HOUSING_TYPE_CAP_DEFAULT(20).
 *   - presaleParking 폴백: `_noParking && presaleParking != null`이면
 *     `presaleParking / max(presaleGeneralSupply ?? units, 1)`로 effectivePR 산출.
 *   - hasPool 보너스: unitSc + 3, 상한 15.
 *   - units ≤ 1: UNIT_UNKNOWN_SCORE(중립 8점) — 0/1 동시 처리.
 *
 * null 처리: `apt.units ?? 0`, `apt.childcare ?? 0` 등 `??` 사용.
 *
 * @example
 * // PRODUCT_MAX 9항목 합 = 100
 * Object.values(PRODUCT_MAX).reduce((a, b) => a + b, 0) === 100  // true
 */
export function scoreProduct(apt: Apt): Res {
  // 세션513: `resolveBuilder` 경유. 옛 코드는 `apt.builder` 를 BRAND_TIER 에 직조회해서,
  //   "수집기가 저장 전에 이미 정규화해 뒀다"는 가정에 기대고 있었다 — 그 가정이 깨지면
  //   ("주식회사 대우건설" 같은 표기) 조용히 미등재 5점으로 떨어진다. 여기서 한 번 더 정규화한다.
  const builder = resolveBuilder(apt.builder as string | null | undefined);
  const brand = (BRAND_TIER as Record<string, { score: number; tier: string }>)[builder];
  if (!brand && IS_DEV) console.warn(`[scoring] Unknown builder: "${builder}"`);
  const b = brand || { score: 5, tier: "기타" };
  // 주택유형별 브랜드 상한: 오피스텔/도시형 → 15, 아파트/null → 20
  const housingType = apt.presaleHousingType as string | undefined;
  const housingCap =
    housingType != null && (housingType.includes("오피스텔") || housingType.includes("도시형"))
      ? HOUSING_TYPE_CAP_NON_APT
      : HOUSING_TYPE_CAP_DEFAULT;
  const brandSc = Math.min(b.score, housingCap);
  const units = (apt.units ?? 0) as number;
  let unitSc: number = units <= 1 ? UNIT_UNKNOWN_SCORE : tierMin(units, UNIT_TIERS, UNIT_SMALL_SCORE);
  if (apt.hasPool) unitSc = Math.min(unitSc + 3, 15);
  // presaleParking 폴백: parkingRatio 기본값(0.5)이고 presaleParking 있으면 대체
  const parkingRatio = (apt.parkingRatio ?? 0.5) as number;
  // 세션513 분모 교정: 옛 분모 `presaleGeneralSupply ?? units` 는 **일반분양 세대수**를 우선 썼는데,
  //   그건 총세대의 부분집합일 수 있다(특별공급·조합원분 제외). 주차대수는 단지 전체 기준이므로
  //   작은 분모와 짝지으면 비율이 부풀려진다. 둘 중 **큰 쪽**을 쓴다.
  //   실측(정적 JSON 1,646곳, 폴백 후보 = parkingRatio 미수집 + presaleParking 보유 **78곳**):
  //   만점권(1.5↑) 35곳 → **16곳**, 3대/세대 초과 12곳 → **1곳**, 최댓값 309.00 → **4.65**.
  const parkDenom = Math.max(units, (apt.presaleGeneralSupply ?? 0) as number, 1);
  const fallbackPR = apt._noParking && apt.presaleParking != null ? (apt.presaleParking as number) / parkDenom : null;
  // 유효 범위는 **양쪽**을 본다. 옛 코드는 상한(≤3)만 봐서 `presaleParking === 0` 을 그대로 통과시켰고,
  //   화면에 `추정 0.00대/세대` 가 28곳 찍혔다 — 주차 0면인 아파트는 존재하지 않으니 그건 측정값이
  //   아니라 **원천 미기재**다(28곳 전부 사전청약·공공분양, 총세대는 223~1,292로 멀쩡하다).
  //   상한 3 은 "물리적으로 있을 수 없는 값"이라서가 아니다 — 직접 수집된 `parkingRatio` 에는
  //   3 초과가 4곳 실재한다(오피스텔 6.21 · 아파트 3.67 · 주상복합 3.28 · 아파트 3.10).
  //   폴백 **산식에서** 3 을 넘으면 총세대 기록이 오염된 자리로 본다는 뜻이다: 남은 1곳도
  //   주차 1,074면인데 총세대가 5로 적혀 있다(일반분양 231). 그런 자리는 폴백을 포기하고
  //   parkingRatio 기본값으로 되돌린다. 직접 수집값에는 이 클램프가 걸리지 않는다.
  const usableFallbackPR = fallbackPR != null && fallbackPR > 0 && fallbackPR <= 3 ? fallbackPR : null;
  const effectivePR = usableFallbackPR ?? parkingRatio;
  const parkSc: number = tierMin(effectivePR, PARKING_TIERS, PARKING_LOW_SCORE);
  const floorAreaRatio = (apt._noFar ? 300 : apt.floorAreaRatio) as number;
  const farSc: number = tierMax(floorAreaRatio, FAR_TIERS, FAR_HIGH_SCORE);
  const energyGrade = apt.energyGrade as string | number | undefined;
  const greenBldg = apt.greenBldg as string | undefined;
  const energySc: number =
    ((ENERGY_SCORES as Record<string, number>)[String(energyGrade)] ?? ENERGY_DEFAULT) +
    ((GREEN_BLDG_SCORES as Record<string, number>)[String(greenBldg)] || 0);
  const exclusiveRatio = (apt._noExcl ? 60 : apt.exclusiveRatio) as number;
  const exclSc: number = tierMin(exclusiveRatio, EXCL_RATIO_TIERS, EXCL_LOW_SCORE);
  const layout = apt.layout as string | undefined;
  const layoutSc = (LAYOUT_SCORE as Record<string, number>)[String(layout)] || 3;
  // 세션508: 내진설계는 이진(있음/없음) 필드 — `=== false`(확인된 미적용)일 때만 0점. null(모름)·true
  //   무페널티. 채워진 800/2,043건 중 98.9%(791/800)가 보유 — 우리 모수(신축 분양 아파트)는
  //   내진설계 의무 대상(2017.12 확대)이라 미수집을 "미적용"으로 단정하면 안 된다.
  const quakeDesign = apt.quakeDesign as boolean | null | undefined;
  const quakeSc = quakeDesign === false ? 0 : 5;
  // `?? 10` 은 null 만 잡아 0 을 그대로 채점했다(0층으로 tierMin). 위 floorAreaRatio 가
  // `_noFar ? 300 : ...` 인 것과 같은 꼴로 맞춘다(세션537) — "모른다"면서 0 을 채점하는 모순 제거.
  //
  // ⚠️ **이 줄은 회귀 가드가 없다**(세션537 뮤테이션 실증: `?? 10` 으로 되돌려도 green).
  // FLOOR_TIERS 가 35/25/15 라 0·10 이 둘 다 FLOOR_LOW_SCORE(2) — 지금은 점수가 같고,
  // 문구는 `_noFloor` 가 이미 잡는다. 경계가 15 아래로 내려오면 그때 갈리므로, 그때
  // 여기에도 가드를 붙여야 한다.
  const maxFloor = (apt._noFloor ? 10 : apt.maxFloor) as number;
  const structSc: number = tierMin(maxFloor, FLOOR_TIERS, FLOOR_LOW_SCORE);
  const rawTotal = brandSc + unitSc + parkSc + farSc + energySc + exclSc + layoutSc + quakeSc + structSc;
  const maxPossible = (Object.values(PRODUCT_MAX) as number[]).reduce((a, b) => a + b, 0);
  const total = Math.round(Math.max(0, Math.min((rawTotal / maxPossible) * 100, 100)));
  return {
    total,
    subs: [
      {
        name: "브랜드",
        score: brandSc,
        info: b.tier || "기타",
        // ⚠️ 배점표(`brands.ts` BRAND_TIER)와 한 칸 밀려 있었다 — 실제는 1군Super 20 · 1군 15 ·
        //    2군 10 · 3군 5 이고, 표 미등재도 5다. 옛 legend 를 읽으면 자기 점수와 어긋난다(202곳).
        detail: `${b.tier || "기타"} (1군Super 20점, 1군 15점, 2군 10점, 3군·미등재 5점)`,
      },
      {
        name: "세대수",
        score: unitSc,
        info: units <= 1 ? "정보 없음 (중립)" : `${units.toLocaleString()}세대`,
        detail:
          units <= 1 ? "미확인 (중립 8점)" : `${units.toLocaleString()}세대 (대단지 1500↑, 중대형 700↑, 중형 400↑)`,
      },
      {
        name: "주차",
        score: parkSc,
        // 세션513: 폴백을 **실제로 쓴** 단지는 "정보 없음"이 아니다 — 그 값으로 채점하고 있으니
        //   화면에 "정보 없음"이라 쓰면 점수와 어긋난다(35곳이 만점권인데 정보 없음이라 표시됐다).
        //   폴백을 포기했거나(오염 클램프) 원천이 없으면 기존 "미수집" 문구를 유지한다.
        info:
          usableFallbackPR != null
            ? `추정 ${usableFallbackPR.toFixed(2)}대/세대`
            : apt._noParking
              ? "정보 없음"
              : `${parkingRatio}대/세대`,
        detail:
          usableFallbackPR != null
            ? `추정 ${usableFallbackPR.toFixed(2)}대/세대 (청약 공급자료 기반 추정 · 우수 1.5↑, 양호 1.3↑, 보통 1.1↑)`
            : apt._noParking
              ? "미수집 (기준: 1.5↑우수, 1.3↑양호, 1.1↑보통)"
              : `${parkingRatio}대/세대 (우수 1.5↑, 양호 1.3↑, 보통 1.1↑)`,
      },
      {
        name: "용적률",
        score: farSc,
        info: apt._noFar ? "정보 없음" : `${floorAreaRatio}%`,
        detail: apt._noFar
          ? "미수집 (기준: 200%↓쾌적, 250%↓보통)"
          : `${floorAreaRatio}% (쾌적 200%↓, 보통 250%↓, 밀집 250%↑)`,
      },
      {
        name: "에너지",
        score: energySc,
        info: energyGrade != null ? `${energyGrade}등급` : "정보 없음",
        detail:
          energyGrade != null
            ? `${energyGrade}등급 (1등급 7점, 2등급 5점, 기본 3점)`
            : "미수집 (기준: 1등급 최고 7점, 2등급 5점)",
      },
      {
        name: "전용률",
        score: exclSc,
        info: apt._noExcl ? "정보 없음" : `${exclusiveRatio}%`,
        detail: apt._noExcl
          ? "미수집 (기준: 80%↑우수, 77%↑양호, 74%↑보통)"
          : `${exclusiveRatio}% (우수 80%↑, 양호 77%↑, 보통 74%↑)`,
      },
      {
        name: "평면",
        score: layoutSc,
        info: layout || "정보 없음",
        // ⚠️ "혼합형"은 배점표에도 데이터에도 없는 값이고, 순서도 틀렸다 — 베이 수가 판상/타워보다
        //    먼저다(4베이타워 8 > 3베이판상 7). `LAYOUT_SCORE` 5키를 그대로 옮긴다.
        detail: `${layout || "미수집"} ` + `(4베이판상 10 > 4베이타워 8 > 3베이판상 7 > 3베이타워 5 > 2베이이하 3)`,
      },
      {
        name: "내진",
        score: quakeSc,
        info: quakeDesign === false ? "미적용" : quakeDesign === true ? "적용" : "정보 없음(적용 추정)",
        detail:
          quakeDesign === false
            ? "미적용 확인 (0점)"
            : quakeDesign === true
              ? "적용 확인 (5점)"
              : "미수집 — 신축 분양 아파트는 전량 내진설계 의무 대상이라 적용으로 추정 (5점)",
      },
      {
        name: "구조",
        score: structSc,
        info: apt._noFloor ? "정보 없음" : `최고 ${maxFloor}층`,
        detail: apt._noFloor
          ? "미수집 (기준: 35층↑고층, 25층↑중고층, 15층↑중층)"
          : `최고 ${maxFloor}층 (고층 35↑, 중고층 25↑, 중층 15↑)`,
      },
    ],
  };
}
