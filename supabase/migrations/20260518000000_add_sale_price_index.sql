-- market_stats_history 에 매매 실거래가격지수 컬럼 추가
-- mibunyang 전용 테이블 (supabase/CLAUDE.md 소유권 표 확인, naver-estate-web grep 0건)
-- 출처: KOSIS DT_KAB_11672_S5 "아파트 매매 실거래가격지수_시군구_분기별"
--       (한국부동산원, orgId=408, 기준 2017.4Q=100)
-- 주의: 기존 price_index 는 분양가지수(HUG DT_41401N_006, collect-market-stats)
--       — 출처·의미 다름, 혼동 금지
ALTER TABLE market_stats_history
  ADD COLUMN IF NOT EXISTS sale_price_index REAL;
