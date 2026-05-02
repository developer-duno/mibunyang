## 변경 요약

<!-- 1~3줄로 무엇을 왜 -->

## 체크리스트

### 일반
- [ ] `npm run lint` 통과
- [ ] `npm run typecheck` 통과 (TS 부트스트랩 M0 이후)
- [ ] `npm run test` 통과
- [ ] CLAUDE.md / 서브 CLAUDE.md / BACKLOG 갱신 필요 시 반영

### TypeScript 마이그레이션 PR (해당 시)
- [ ] 확장자 변경(.js→.ts)과 논리 변경이 분리된 커밋입니까?
- [ ] 미션 A (메인 UI 재설계) 와 같은 파일을 동시에 수정합니까? → 분리 PR 권장
- [ ] strict:true 통과 (any 사용 시 사유 명시)

### 운영 영향 (해당 시)
- [ ] 운영 admin 5명 데이터 영향 0
- [ ] 카카오 알림톡 발송 영향 0
- [ ] DB 마이그레이션 포함 시 supabase/CLAUDE.md 절차 준수

## 검증 결과

<!-- typecheck/lint/test 출력, 또는 e2e smoke 결과 -->

## 롤백 시나리오

<!-- 본 PR 머지 후 사고 발생 시 어떻게 되돌릴지 -->
