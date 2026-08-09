/**
 * "이 지역 통계" 7종 — 이 단지 값이 아니라 **동네 통계**다 (세션 507 PR-2).
 *
 * ## 왜 따로 모으나
 *
 * 이 7개는 시세 탭 "시장/투자 지표" 표에 단지 값들과 뒤섞여 있었다. 손님이 보기엔
 * 옆줄의 분양가·층수와 똑같은 모양이라 **이 단지 값으로 읽힌다.** 실제로는 인구·의료·거래량
 * 처럼 시·도 또는 시·군·구 전체를 잰 숫자다 — 같은 단지 100채가 전부 같은 값을 갖는다.
 * 성격이 다른 값을 같은 표에 놓은 것 자체가 거짓 표시라, 분양 탭 "이 지역 통계" 서랍으로
 * 통째로 옮기고 각 줄 라벨에 어느 동네를 잰 값인지 접두로 박았다.
 *
 * ## 어느 단위를 잰 값인가 (운영 VIEW 실측 2026-08-09)
 *
 * - **시·도**(`latest_regions`): 인구증감률·순이동·주택보급률
 * - **시·군·구**(`latest_regions_gu` · trade-stats `guTrades`): 합계출산율·의사수·병상수·최근 6개월 거래
 *
 * ⚠️ 이 목록은 **export 필수**다. `lib/tabExtraFields` 가 "이미 보여준 자리"로 세고,
 * `tabExtraFields.test.ts` 의 전량 도달 검사가 같은 것을 가리키는지 잠근다. 여기서 빼면
 * 그 필드가 서랍으로 되돌아가거나(중복 노출) 어디에도 안 나오게 된다(실종).
 */

/** 시·도 단위 3종 — 라벨 접두는 `{region}` */
export const REGION_STATS_SIDO_FIELDS = ["popGrowth", "netMigration", "housingSupplyLevel"] as const;

/** 시·군·구 단위 4종 — 라벨 접두는 `{gu}` (gu 없으면 `{region}` 폴백) */
export const REGION_STATS_GU_FIELDS = ["fertilityRate", "doctorsPer1k", "hospitalBedsPer1k", "recentTrades6m"] as const;

/**
 * 7종 전량 (시·도 3 + 시·군·구 4).
 *
 * ⚠️ 위 두 배열을 펼쳐 만들지 않고 **손으로 적는다.** 펼쳐 쓰면 한쪽 배열을 비우는 순간
 * 이 목록도 같이 비어 도달 검사가 통째로 사라진다(세션 505 `gone` 목록이 같은 이유로
 * 손 목록이다). 두 곳이 어긋나면 `RegionStats.test.jsx` 가 빨개진다.
 */
export const REGION_STATS_FIELDS = [
  "popGrowth",
  "netMigration",
  "housingSupplyLevel",
  "fertilityRate",
  "doctorsPer1k",
  "hospitalBedsPer1k",
  "recentTrades6m",
] as const;

/** 서랍 한 줄 = 필드 + 라벨(접두 뺀 몸통) + 어느 동네 단위인지 */
export type RegionStatRow = { field: string; label: string; scope: "sido" | "gu" };

/**
 * 화면에 그릴 7줄.
 *
 * 라벨을 `FIELD_META` 에서 안 가져오는 이유 — 거기 라벨은 관리자 전수 표 기준이라
 * `recentTrades6m` 이 "구 최근6개월 거래"처럼 단위를 이미 품고 있다. 여기서는 접두
 * (`{gu} `)가 단위를 말하므로 몸통만 남겨야 "수원시 구 최근6개월 거래" 같은 겹말이 안 난다.
 * **값 포맷(`fmt`)은 `FIELD_META` 를 그대로 재사용한다** — 숫자 표기까지 손으로 적지 않는다.
 */
export const REGION_STATS_ROWS: readonly RegionStatRow[] = [
  { field: "popGrowth", label: "인구증감률", scope: "sido" },
  { field: "netMigration", label: "순이동", scope: "sido" },
  { field: "housingSupplyLevel", label: "주택보급률", scope: "sido" },
  { field: "fertilityRate", label: "합계출산율", scope: "gu" },
  { field: "doctorsPer1k", label: "의사수", scope: "gu" },
  { field: "hospitalBedsPer1k", label: "병상수", scope: "gu" },
  { field: "recentTrades6m", label: "최근 6개월 거래", scope: "gu" },
];
