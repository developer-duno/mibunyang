-- 미분양 세대 = 총세대수 버그 데이터 정리
-- 청약홈 API의 REMNDR_HSHLDCO=0일 때 unsold를 units로 잘못 설정한 데이터 수정
UPDATE apartments
SET unsold = NULL, unsold_rate = NULL
WHERE unsold IS NOT NULL AND unsold >= units AND units > 1;
