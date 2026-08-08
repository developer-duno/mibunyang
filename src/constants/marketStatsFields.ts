/**
 * 지역 시장 추이 차트(`components/detail/MarketStatsCharts`)가 그리는 5지표를
 * `FIELD_META` 키(camelCase)로 옮겨 적은 것.
 *
 * ⚠️ 차트의 `METRICS` 는 KOSIS 시계열 테이블 컬럼(snake_case)을 쓰고, 서랍
 * (`lib/tabExtraFields`)은 `FIELD_META` 키(camelCase)를 쓴다 — 같은 지표인데 이름 표기가
 * 달라 자동으로 이어지지 않는다. 그래서 여기 한 번 적고, **차트의 METRICS 와 순서·개수가
 * 같은지는 `lib/tabExtraFields.test.ts` 가 차트 소스를 직접 읽어 잠근다**
 * (차트에 지표를 더하고 이 목록을 잊으면 그 지표가 서랍에도 또 나온다).
 */
export const MARKET_STATS_FIELD_KEYS: readonly string[] = [
  "avgPriceSqm",
  "priceIndex",
  "newSupply",
  "initialSaleRate",
  "landCostRatio",
];
