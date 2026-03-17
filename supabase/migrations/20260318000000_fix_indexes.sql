-- apartments_flat VIEW 최적화: regions 시도 단위 부분 인덱스
-- complexes/articles 인덱스는 이미 production DB에 정상 존재하므로 변경 불필요

CREATE INDEX IF NOT EXISTS idx_regions_sido_latest
  ON regions(region, recorded_at DESC) WHERE gu IS NULL;
