---
name: cross-validate
description: 커밋 직전 mibunyang 도메인 5교차검증 + simplify 를 자동 실행. simplify 이후 5개 축(빌드·스코어링·null안전성·Hook규칙·보안)을 병렬 서브에이전트로 점검한다. Claude 가 스스로 판단해 발동 — 사용자 타이핑 불필요. 트리거 = 코드 변경 후 커밋/PR 직전, "커밋", "검증하고 커밋", "교차검증", "Review 단계". 사용 안 함 = 단순 문서/주석 1줄 변경, 조회만 한 경우.
when_to_use: |
  Claude 가 자동 판단해 발동:
  - 코드 변경(src/·api/·scripts/) 후 커밋·PR 직전 (Review 단계)
  - "커밋", "교차검증", "검증하고 커밋", "Review" 등 마무리 의도
  - PROFILES·네이버 수집·fieldMeta 등 mibunyang 도메인 코드 변경 후
  사용 안 함:
  - 단순 문서/주석 1줄 변경
  - 조회·grep 만 한 경우 (변경 0)
  - 단일 유틸 1개 수정 시 "빌드 + null 안전성" 선별 호출 허용
allowed-tools: Task, Bash, Read, Grep, Edit
---

CLAUDE.md / [WORK_RULES.md](../../WORK_RULES.md) "Review 단계" 규칙을 자동화한다. simplify 이후 5개 축을 **병렬** 서브에이전트로 점검.

## 실행 절차

### 1. simplify 선행
`simplify` 스킬을 먼저 호출해 변경 코드 재사용성·품질·효율 리뷰. 수정이 필요하면 먼저 반영하고 단계 2로.

### 2. 5교차검증 병렬 기동
Task 도구로 아래 5개를 **동일 메시지**에서 동시 기동:

1. **빌드**: `Bash(npx vite build)` 실행 + import 누락 + 번들 크기(index/vendor) 점검. 일반 agent.
2. **스코어링**: `scoring-validator` 서브에이전트 — PROFILES 가중치 합·클램핑. 메인이 직접 grep 금지.
3. **null 안전성**: `null-safety-checker` 서브에이전트 — `?.`/`?? 0`/`|| []`/toLocaleString 가드.
4. **Hook 규칙**: 일반 agent — React Hook 호출 순서, useMemo 의존성 배열, 조건부 호출 없음, 변경된 훅만 대상.
5. **보안**: 일반 agent — XSS(innerHTML), env 키 노출, 인젝션, 신규 API 엔드포인트의 withHandler 누락.

수집기(`scripts/collectors/*.mjs`) 변경 시 추가로 `collector-contract` 서브에이전트 호출.

각 agent 결과는 "PASS/FAIL + 핵심 발견 3줄"로 요약 받아.

### 3. console.log 잔재 스윕
변경 파일에서 `console.log` grep → 발견 시 제거.

### 4. 종합 보고
5개 축 전부 PASS여야 다음 단계(`/commit` 또는 커밋) 진행 가능. 하나라도 FAIL이면 수정 후 재실행. 어느 에이전트가 찍었는지 세션 메모리에 기록 (예: "스코어링: PASS (scoring-validator)").

## 주의

- 글로벌 `code-review` / `pr-review-toolkit` 플러그인과 기능 겹치는 부분이 있지만, 본 스킬은 **mibunyang 도메인 축**(PROFILES·네이버 수집·fieldMeta)에 특화 — 중복 호출 아님.
- 5개 전부 돌리면 시간과 토큰 듦. 변경 범위가 단일 유틸 1개 수정이면 "빌드 + null 안전성"만 선별 호출 허용.
- **금지**: 전용 에이전트가 존재하는 축(스코어링·null 안전성·수집기 계약)을 메인이 직접 검사하는 것 금지.
