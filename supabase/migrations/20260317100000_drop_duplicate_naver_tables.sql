-- 중복 테이블 삭제: complexes/articles로 통합 완료
-- naver_price_history: 0건, complex_price_history로 대체됨
-- naver_articles: articles(82K)와 중복
-- naver_complexes: complexes(47K)와 중복

DROP TABLE IF EXISTS naver_price_history CASCADE;
DROP TABLE IF EXISTS naver_articles CASCADE;
DROP TABLE IF EXISTS naver_complexes CASCADE;
