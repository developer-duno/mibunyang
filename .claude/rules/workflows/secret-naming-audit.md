# Secret 이름 3-way 동기화 감사 — Code ↔ Workflow ↔ Orchestrator

## 한 줄

같은 환경변수 이름이 세 곳 — 코드 `process.env.X`(`scripts/collectors/<name>.mjs`) · 워크플로 env block `X: ${{ secrets.X }}` + validate step(`.github/workflows/<name>.yml`) · 오케스트레이터 `envKeys: ["X"]`(`scripts/collectors/data-fill.mjs`) — 에 맞아야 한다. 한 곳만 어긋나도 schedule 이 4xx 로 조용히 실패한다.

## 재발 방지 (3중)

1. **정적 감사 `scripts/audit-env-keys.mjs`** 가 collector 마다 3-way 일치를 검출(mismatch = exit 1 + 빠진 위치 표시). matrix orchestrator yml(`fill-missing-data.yml` 의 phase matrix 등)도 `MATRIX_ORCHESTRATORS` 로 script 항목별 env block vs collector 코드 키를 교차. **새 matrix orchestrator yml 을 추가하면 `MATRIX_ORCHESTRATORS` 배열에 경로 1줄**(사람 박제). yml 파싱은 `js-yaml` `FAILSAFE_SCHEMA`(정규식 금지).
2. **CI 단계** `node scripts/audit-env-keys.mjs` — fail 시 머지 차단.
3. **각 ETL workflow 첫 step = `Validate secrets`**(빈 값이면 즉시 exit). 누락 확인 `grep -L "Validate secrets" .github/workflows/collect-*.yml` → 일괄 보강.

## 절차 (다음 ETL 추가 시)

1. 코드 작성 `process.env.X` (`scripts/collectors/<name>.mjs`)
2. yml 작성 `X: ${{ secrets.X }}` (env block) + Validate secrets step
3. data-fill.mjs 에 collector 추가 시 `envKeys: ["X"]` 동시 박제
4. GitHub Secret X 등록 (`gh secret set X --body $VAL`)
5. `node scripts/audit-env-keys.mjs` 로컬 통과 확인 후 commit
6. push → CI audit step 통과 확정

## 안티 패턴 (사고 답습)

- ❌ "이 collector 는 X 키만 쓰면 되니까 yml validate 는 다른 키만" — orchestration 분리 시 사라짐
- ❌ "X 가 Y 와 호환되니 secrets.Y 재활용" — KOSIS_MIGRATION_KEY vs KOSIS_KEY 처럼 별도 발급된 별도 인증키일 가능성 (세션 102 박제). 호환 단정 금지, 실제 API 호출 1회 검증
- ❌ "schedule fail 1회 = 일회성 spike" — schedule 1회 fail 후 다음 발화까지 1주~1개월 공백 (월간 cron). 사람이 못 봄

보조: 월간 schedule 은 1회 fail 시 다음 발화까지 1개월이 알람 데드 존 — 매월 monitor 가 핵심 컬럼 NULL 비율(예 30%+)을 경보하는 안은 BACKLOG 🟢 후순위.

> 상세(표·예시 코드·실측 기록·답습 자산) → [.claude/rules-detail/workflows/secret-naming-audit.md](../../rules-detail/workflows/secret-naming-audit.md)
