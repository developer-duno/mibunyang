-- 역방향: regions 시도 경제·교육 4컬럼 제거
-- regions 는 mibunyang 전용 테이블 (supabase/CLAUDE.md L90) — cross-repo 영향 없음

ALTER TABLE regions
  DROP COLUMN IF EXISTS grdp_per_capita,
  DROP COLUMN IF EXISTS education_cost,
  DROP COLUMN IF EXISTS education_participation,
  DROP COLUMN IF EXISTS unemployment_rate;
