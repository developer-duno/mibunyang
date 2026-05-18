-- market_stats_history 에 전세가격지수 컬럼 추가
-- mibunyang 전용 테이블 (supabase/CLAUDE.md 소유권 표 확인, naver-estate-web grep 0건)
-- 출처: KOSIS DT_30404_B013 "유형별 전세가격지수"
--       (한국부동산원, orgId=408, C1_NM='아파트' 행, ITM='전세가격', 월간)
-- 주의: price_index=분양가지수(HUG DT_41401N_006, collect-market-stats)
--       sale_price_index=매매 실거래가격지수(KOSIS DT_KAB_11672_S5)
--       jeonse_price_index 는 또 다른 별개 컬럼 — 출처·의미 다름, 혼동 금지
ALTER TABLE market_stats_history
  ADD COLUMN IF NOT EXISTS jeonse_price_index REAL;
