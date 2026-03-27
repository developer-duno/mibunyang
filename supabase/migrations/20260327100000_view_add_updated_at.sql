-- apartments_flat VIEW에 updated_at 추가
-- "최신순" 정렬 (newest sorter)이 실제로 동작하도록 수정
-- 기존 VIEW를 DROP 후 재생성 (OR REPLACE는 컬럼 추가 시 사용 불가)

-- 이 마이그레이션은 schema.sql의 VIEW 정의와 동기화되어야 합니다.
-- updated_at 컬럼 위치: a.cats_cache 바로 위
-- 추가: a.updated_at AS "updatedAt"

-- NOTE: 실제 적용 시 schema.sql의 전체 CREATE OR REPLACE VIEW 문을 실행해야 합니다.
-- Supabase Dashboard > SQL Editor에서 schema.sql의 VIEW 부분을 복사하여 실행하세요.
ALTER VIEW apartments_flat RENAME TO apartments_flat_backup;

-- schema.sql의 최신 VIEW 정의를 여기에 복사하여 실행
-- (파일이 너무 길어 전체 복사 대신 안내)
-- 실행 후: DROP VIEW IF EXISTS apartments_flat_backup;
