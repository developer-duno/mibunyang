-- naver_complexes에 수영장 유무 컬럼 추가
ALTER TABLE naver_complexes ADD COLUMN IF NOT EXISTS has_pool BOOLEAN;

-- apartments_flat VIEW 재생성 (has_pool 포함은 이미 apartments 테이블에 있으므로 불필요)
