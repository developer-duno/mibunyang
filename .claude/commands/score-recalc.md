---
description: 점수 재계산 + PROFILES 가중치 합계 sanity
allowed-tools: Bash, Read, Grep
---

스코어링 재계산과 가중치 무결성을 함께 확인해.

## 실행 절차

1. **가중치 합 검증**: `src/scoring/` 하위 PROFILES 정의를 Read/Grep으로 추출해 각 프로필의 카테고리 가중치 합이 100(또는 1.0)인지 검증. 실패 프로필 명시.

2. **스코어 재계산**: 프로젝트 compute-scores 스크립트 실행 (npm scripts 또는 해당 mjs 직접). 세션86 기준치 **1,424건** 성공 기대.

3. **결과 대조**: 재계산된 행 수 vs 기대치. 차이 발생 시 원인 테이블/컬럼 추적.

4. **null 클램핑 확인**: 점수 0~100 범위 이탈 여부, NaN/Infinity 혼입 여부 grep.

## 합격 기준

- PROFILES 5종 + 카테고리 합 전부 통과
- 1,424건 ± 변동 사유 설명 가능
- 0~100 이탈 0건
