# /goal 자율 루프 템플릿 (mibunyang 맞춤)

> 출처: [Workflow] (2) Goal / Ultrawork 로 Issue 병렬 구현 (wildmental Notion, 2026-05-27) + 공식 `/goal` 문서 (code.claude.com/docs/en/goal, v2.1.139+). 우리 버전 2.1.150 = 작동.
>
> **자율 발동**: WORK_RULES §0-A "완료조건 명확 + 사용자 직접 검증 가능" 자리 = Claude 가 사용자 명령 입력 없이 아래 4항목 구조로 `/goal` 조건을 스스로 설계·설정. `goal-setting` 스킬과 연계.

## 언제 쓰나 (자율 판단)

- 완료조건이 측정 가능 ("vitest 80/80 pass", "회귀 0", "ISSUE-002~024 PR 생성")
- 사용자 개입 없이 여러 턴 자율 진행이 효율적
- 종료 조건을 명시할 수 있음 (카운터 / 턴 캡 / 더 할 일 없음)

**안 쓰는 자리**: 1회 단순 수정 / 의도 모호 (먼저 brainstorming) / ulw-safe·ralph 이미 발동 중 (경쟁 loop 금지).

## 핵심 원리 (Notion 답습)

1. **공격적 harness 통제** = 작업 범위 + 종료 조건 + 수반 동작을 명시해 (1) 예측 가능한 길이로 제어, (2) 원하는 결과물 확보.
2. **"임의 의사결정량" 조건화** = Agent 가 사용자 미지정 사항을 얼마나 유추하는지 카운팅해서 임계 초과 시 멈춤. → CORE(아키텍처·보안·외부의존) 3개 또는 MINOR(네이밍·디렉터리·UI·로그) 10개 누적 = STOP.
3. **평가자는 도구 미실행** (공식): `/goal` 평가자는 transcript 만 본다. 따라서 종료 증명을 **대화에 출력으로 남겨야** 함 (명령 결과를 붙여넣기).

## /goal 4항목 구조 (그대로 복붙 가능)

```
/goal

## 1) 작업 핵심 목표 및 범위
- <프로젝트/대상>의 <무슨 작업>을 자동화 루프로 진행한다.
- 시작 지점: <어디서부터>.
- 작업 대상: <순서/범위 — 예: ISSUE_LIST.md 순서, 선행 해소 + PR 없는 것 차례로>.
- 작업 자율성: 권한 승인·컨펌 위한 중단 없이, 종료 조건 도달 또는 전체 완료까지 진행.

## 2) 작업 세부 규칙
- TDD 사이클: Red(테스트 먼저) → Green(구현) → Refactor → Report → PR.
- 회귀 가드 (mibunyang 의무): 코드 변경 후 vitest / typecheck:scripts 1회 실행.
- 수집기 변경 시: 4-way 답습 (.claude/rules/collectors/collector-timeout-rootcause-analysis.md) + collector-contract 서브에이전트.
- 의사결정 로그:
  - 기존 문서(CLAUDE.md·BACKLOG.md·rules/)에서 미확정인 추가 의사결정을 docs/loop/DECISION_LOG.md 에 기록.
  - 각 항목을 CORE(아키텍처·보안·외부의존) 또는 MINOR(네이밍·디렉터리·UI·로그)로 분류.
  - grep 가능 카운터를 별도 줄에 `CORE: N` / `MINOR: M` 으로 유지.

## 3) 종료 조건 및 종료 방법
- 종료 조건 (하나라도 충족 시 즉시 멈춤):
  - CORE 카운터 3 도달 → `STOP REASON: CORE_BUDGET`
  - MINOR 카운터 10 도달 → `STOP REASON: MINOR_BUDGET`
  - 더 할 작업 없음 → `STOP REASON: NO_WORK_LEFT`
  - 평가-진행 라운드 누적 N회 도달 → `STOP REASON: TURN_CAP` (= `or stop after N turns`)
- 종료 방법 (대화에 증거 출력 의무 — 평가자가 transcript 만 보므로):
  1) docs/loop/DECISION_LOG.md 마지막 줄에 `STOP REASON: <코드>` 덧붙임.
  2) `npm test` + `npm run typecheck:scripts` 실행해 통과 출력을 대화에 남김.
  3) `cat docs/loop/DECISION_LOG.md` 로 `CORE: N`·`MINOR: M`·`STOP REASON:` 줄을 대화에 남김.
  4) `gh pr list` 로 연 PR 목록을 대화에 남김.

## 4) 기타 제약조건
- 어떤 PR도 main에 merge 안 함 (Vercel 자동배포 유발 금지).
- 공유 DB 테이블 기존 컬럼 변경/삭제 금지 (supabase/CLAUDE.md).
- 활성 작업 범위 밖 파일 수정 금지 (단 docs/loop/ 와 reports/ 는 예외).
- 데이터 오염 금지: `npm run build` 는 ETL 수집 실행하므로 빌드 검증은 `npx vite build` 만.
```

## mibunyang 변형 포인트 (Notion 원본과 다른 점)

| Notion (lecture-hub) | mibunyang |
|---|---|
| `pnpm typecheck && pnpm test && pnpm lint && pnpm build` | `npm test` + `npm run typecheck:scripts` (build 는 ETL 실행이라 제외, `npx vite build` 만) |
| stacked draft PR (feat/* 위) | 단일 작업 브랜치 + PR (mibunyang 관행) |
| TDD Red→Green | TDD + 회귀 가드 1회 + 수집기 4-way 답습 |
| — | 자가 점검 1+2 (맹점·할루시네이션 추출) 매 STOP 직전 의무 |

## ulw-loop / Sisyphus 와의 관계 (벤더 차이)

Notion 문서는 같은 4항목 goal 프롬프트를 **여러 벤더 에이전틱 플로우**에 적용:
- **Claude Code** → `/goal` (이 템플릿)
- **GPT-5.5 xhigh** → `/ulw-loop` (비-Claude, codex 계열)
- **OpenCode** → Sisyphus (Ultraworker)

즉 `/ulw-loop` 은 Claude Code 명령이 아니라 다른 벤더 명령. mibunyang(Claude Code)에서는 **`/goal`** 또는 OMC **`ralph`**(완료조건 무정지 loop)를 쓴다. goal 프롬프트 본문은 동일 재사용 가능.
