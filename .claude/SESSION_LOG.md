# 세션 89 — 2026-04-15

## 주요 작업

### 1. 세션88 이월 오류 정리
- "모바일 옵션 버튼 미작동"은 mibunyang이 아닌 타 프로젝트 건으로 확인 → CLAUDE.md 우선순위 1번에서 제거
- 커밋: `213da52 docs: 모바일 옵션 버튼 과제 제외 (타 프로젝트 건으로 확인)`

### 2. naver-units 만성 Rate Limit 대응 — post-naver-collect 2/4 단계 교체
- **문제**: 방금 실행한 naver-units 로그에서 7/54 진행 중 연속 20회 429 발생. fetch + Python curl_cffi 양 경로 모두 실패 → TLS 핑거프린팅이 아닌 **집 서버 IP 차단** 재확인 (세션83, 84, 87 반복)
- **해법**: 이미 존재하는 `molit-units.mjs`(국토부 공동주택 API)가 naver-units와 **동일한 타겟 쿼리**(`units<=1 OR unsold_rate>=100`)를 쓴다는 점 발견. 파이프라인 2/4 단계만 교체
- **변경 파일 3개**:
  - `scripts/post-naver-collect.sh`: 2/4 단계 `naver-units.mjs` → `molit-units.mjs`
  - `scripts/CLAUDE.md`: 파이프라인 표 + 쿼터 표 + 위험일 경고 갱신
  - `CLAUDE.md`: 다음 세션 우선순위에서 naver-units-night 제거, price/dataReliability 갭을 1번으로 승격
- **dry-run 결과**: 보정 대상 57건 중 16건 보정, 41건 실패, 9건 건너뛰기, API 53회 소비 — MOLIT API 정상 응답, IP 차단 이슈 없음
- **손대지 않은 것**:
  - `scripts/collectors/naver-units.mjs` 파일 자체 (향후 IP 해제/프록시 도입 시 복구 자산)
  - `.github/workflows/naver-units.yml` (별도 조사 필요)
  - `scripts/run-naver-local.bat`, `.sh`의 4/6 단계 (범위 초과, 다음 세션 별도 플랜)

### 3. 9 GATE + 5교차검증 (Review 의무 준수)
- **9 GATE(0~8)**: 🟢 7 / 🟡 2 / 🔴 0 → 실행 허가
  - 🟡 GATE1: `run-naver-local.*` 4/6 단계 미수정(의도적 범위 외)
  - 🟡 GATE8: 매월 10일이 월/목인 달 쿼터 근접 리스크
- **5교차검증 (병렬 Task)**:
  - 빌드: 메인 agent `npx vite build` 444~507ms 3회 PASS
  - 수집기 계약: **`collector-contract`** WARN (월/목-10일 쿼터 경고) → `scripts/CLAUDE.md` 위험일 표에 경고 추가로 해소
  - null 안전성: **`null-safety-checker`** PASS (scoring/engine.js:18, scoreRisk.js:17 등 전 소비처 가드 존재)
  - 스코어링: **`scoring-validator`** PASS (스코어링 코드 미수정, 불변식 자동 유지)
  - Hook/보안: 해당 없음(수집기 변경)

## 커밋 (2개 예정)
1. `213da52` docs: 모바일 옵션 버튼 과제 제외 (타 프로젝트 건으로 확인)
2. `fix(collectors): post-naver-collect 2/4 단계 naver-units → molit-units` (세션89 작업 커밋)

## 미해결 (다음 세션 이월)
- `run-naver-local.bat`/`.sh` 4/6 단계 naver-units → molit 전환 정책 결정
- `.github/workflows/naver-units.yml` 3월 18일부터 failure 원인 조사
- price 64% / dataReliability 57.4% 갭 보정 전략
- 행안부 API 복구 대기 (외부)

---

# 세션 88 — 2026-04-15

## 주요 작업 (Claude 설정 리뉴얼 전담 세션)

### 1. 에이전트/스킬/플러그인 전수조사 (3차 시도 끝에 정확화)
- 1차: `installed_plugins.json`의 `projectPath` 필드를 "소속"으로 오해 → "16개 전부 naver-estate-web 소속"이라 오진
- 2차: `~/.claude/plans/claude-config-renewal.md`(287줄) 존재를 놓침 → "사용자가 정리 안 해둠"이라 오진
- 3차: 파일 20개+ 실제 Read 후 진실 확정
  - **진실의 원천**: `~/.claude/settings.json`의 `enabledPlugins` (글로벌 8개) + 프로젝트 `.claude/settings.json`의 `enabledPlugins`
  - `installed_plugins.json`은 단순 설치 이력, `projectPath`는 자동 설치 시점 cwd 메타
  - 공식 마켓플레이스 플러그인은 Claude Code 첫 실행 시 자동 설치 (`officialMarketplaceAutoInstalled: true`)
  - 에이전트 이름 충돌은 Claude Code가 `플러그인명:에이전트명`으로 자동 네임스페이싱 처리

### 2. mibunyang 프로젝트 스코프 enabledPlugins 추가
- 파일: `f:/mibunyang/.claude/settings.json`
- 추가: `engineering@knowledge-work-plugins`, `data@knowledge-work-plugins`, `session-report@claude-plugins-official`
- 근거: mibunyang CLAUDE.md가 참조하는 `/engineering:debug`, `/data:sql-queries` 등이 글로벌 enable에 없어 실제 호출 불가 상태였음
- 패턴: sangse-agent가 이미 `feature-dev`/`frontend-design`을 프로젝트 스코프로 선언한 것과 동일
- 거버넌스: 글로벌 `~/.claude/settings.json`은 그대로 유지(8개), 프로젝트 로컬에만 3개 추가
- 백업: `f:/mibunyang/.claude/settings.json.bak-20260415-enablepluginadd`

### 3. scoring-validator.md 정확성 보강 (36줄 → 103줄)
- `src/scoring/CLAUDE.md` 실제 표와 대조해 오류 수정:
  - PROFILES 이름 추측("균형/가성비/투자/실거주/학군") → 실명 `live/invest/newlywed/edu/retire`
  - 가중치 합 "100 또는 1.0" 모호 표현 → 층위별 정확한 기준 (PROFILES=100, scoreProduct=100, 내부 서브=1.00)
  - PSR 특수 케이스 (psr < 0.7 → 100 초과 가능) 명시
  - 검증 절차 1번에 `src/scoring/CLAUDE.md` 먼저 Read 강제
- 백업: `f:/mibunyang/.claude/agents/scoring-validator.md.bak-20260415`

### 4. mibunyang CLAUDE.md Review 섹션 의무화
- 기존: "5교차검증 병렬 에이전트"라고만 나열 → 호출 방법 불명확
- 변경: 각 축에 구체적 Task 호출 명시
  - 스코어링: `Task(subagent_type="scoring-validator")` **필수**
  - null: `Task(subagent_type="null-safety-checker")` **필수**
  - 수집기 변경 시: `collector-contract` 추가
  - 빌드/Hook/보안: 메인 agent 직접 검사 (의도된 설계)
- 추가 규칙: 전용 에이전트가 있는 축을 메인 agent가 직접 검사하는 것 **금지**
- SESSION_LOG 교차검증 섹션에 어느 에이전트가 찍었는지 기록 의무 추가
- 백업: `f:/mibunyang/CLAUDE.md.bak-20260415`

### 5. 글로벌 CLAUDE.md 재발 방지 섹션 추가
- 파일: `~/.claude/CLAUDE.md`
- 새 섹션: `## 진단 전 파일 직접 확인 (설렁설렁 읽기 금지)`
- 내용:
  - 질문 종류별 필수 확인 파일 매트릭스 (플러그인/에이전트/스킬/MCP/설정 이력/메타)
  - 네임스페이스·진실의 원천 규칙 (installed_plugins.json은 이력, enabledPlugins가 진실)
  - 4단계 설렁설렁 방지 체크리스트
  - 이번 세션 3회 연속 오진 사건 기록 (재발 방지용)
- 추가로 "설명 방식 (쉬운 말 원칙)" 섹션도 이미 존재 → 확인만
- 백업: `~/.claude/CLAUDE.md.bak-20260415`

### 6. 메모리 업데이트
- `projects/f--mibunyang/memory/feedback_easy_explanation.md` 신규 — 쉬운 말은 사용자 대화용, 코드/파일명/명령은 원문 정확히 (2회 지적 후 정정)
- `MEMORY.md` 인덱스에 1줄 추가

### 7. hookify 플러그인 설치 (세션 중반)
- `claude plugin install hookify@claude-plugins-official`
- 현재 scope: local, enabled
- `conversation-analyzer` 에이전트 등록 확인
- 실제 hook 작성은 다음 세션 이월

## 커밋 (2개, 이번 세션)
1. `77a8e0e` docs: CLAUDE.md 스킬 섹션 확장 + 분류 정정 (세션 초반)
2. `121cb26` docs+chore: 로컬 에이전트 Task 호출 의무화 + scoring-validator 정확성 보강 + engineering/data/session-report 활성화

(`f314dd1` "Claude Code 로컬 설정 리뉴얼"은 세션87 이월분)

## 교차검증 결과
- 이번 세션은 코드(src/) 변경 없음 — 5교차검증 해당 없음
- 변경 파일: CLAUDE.md, .claude/settings.json, .claude/agents/scoring-validator.md (문서·설정만)
- JSON 유효성 검증: `python -c "import json; json.load(...)"` PASS
- 마크다운 grep 검증: 핵심 키워드 모두 기대 위치에 존재

## 이번 세션에서 학습한 것 (자기 반성)
- "파일을 실제로 Read하지 않고 메타데이터만으로 추측"하는 실수를 3회 연속 반복
- 설렁설렁 읽기 방지를 위한 **체크리스트를 글로벌 CLAUDE.md에 박음** — 규칙 의존 말고 체크리스트 실행 의존
- "진실의 원천 파일"과 "이력/메타 파일"을 구분하는 습관 체화 필요

## 다음 세션 권장 순서
1. 🔴 **모바일 옵션 버튼 재개** (세션87부터 이월, 최우선)
   - 사용자에게 재현 정보 확인: (a)어느 버튼 (b)증상 (c)환경 (d)언제부터
2. 새 `enabledPlugins` 검증: `claude plugin list`로 engineering/data/session-report가 mibunyang에서 enabled로 뜨는지 확인
3. 5교차검증 실제 호출 테스트: 다음 커밋 때 `Task(subagent_type="scoring-validator")`가 진짜 불리는지 관찰 + SESSION_LOG에 기록 확인
4. naver-collect 완료 후 post-naver-collect.sh 실행
5. naver-units-night 02:00 로그 확인
6. price 64% / dataReliability 57.4% 갭 보정 전략
7. 행안부 API 복구 대기

---

# 세션 87 — 2026-04-13

## 주요 작업

### 1. 모바일 옵션 버튼 미작동 — 조사 착수 (미완)
- 1순위 이월 과제. 플랜 모드에서 SearchFilterBar/FilterButton/FilterDropdown/App.jsx/HeaderSection 읽기 완료
- Explore 에이전트 1차 가설(mousedown 리스너 미지원)은 **기각** — mousedown은 드롭다운 외부 탭 닫기용이며, 버튼이 열리지 않는 현상과 직접 관련 없음
- 직접 검증 결과: FilterButton은 isDesktop 분기 없이 순수 React `<button onClick>` 사용. 코드상 모바일 전용 버그 지점이 특정되지 않음
- 가능 후보 (미검증): BottomNav/토스트 z-index 겹침, 부모 wrapper pointer-events, 안드로이드 특정 브라우저 이벤트 경합, 사용자가 말하는 "옵션"이 다른 UI 요소일 가능성
- 재현 조건 질의 시도 → 사용자가 중단 요청 → 조사 중단
- **다음 세션 행동**: 사용자에게 재현 단계/환경/"옵션 버튼"의 정확한 지칭 확인 후 재개

### 2. 세션 마무리
- 작업 트리 clean, 코드 변경 없음
- SESSION_LOG 업데이트 + CLAUDE.md 진행 상황 갱신

## 미해결 (다음 세션 이월)
- 🔴 **모바일 옵션 버튼 미작동** — 사용자 재현 정보 필요 (증상/환경/버튼 위치)
- naver-collect.py 완료 후 post-naver-collect.sh 실행
- naver-units-night 02:00 첫 실행 결과 확인 (scripts/naver-units-night.log)
- 행안부 API 복구 대기
- price 64% / dataReliability 57.4% 갭 보정 전략

## 커밋 (0개)
- 코드 변경 없음 — 문서 커밋만 예정

---

# 세션 86 — 2026-04-13

## 주요 작업

### 1. 데이터 파이프라인 건강 체크
- naver-collect.py 진행 확인: 5250/29699 (17.7%), 429 발생 4건만 — 의도된 속도(308건/시간) 정상 동작
- naver-units-night schtasks 누락 확인 → 재등록 (daily 02:00, State=Ready)
- 행안부 API curl 직접 테스트: transMovStats(500) + stdgPpltnHhStus(502) 모두 다운 → 행안부 측 인프라 장애 확정 (우리 키/코드 문제 아님)

### 2. 세션85 "0% 보고" 정정
- 실제 DB 측정: unsoldRate **61.4%** (875/1424), subwayDist **79.0%** (1125/1424)
- subwayDist 9999인 21%는 거제/군산/석림/순천/안성/제천/평택 등 — **반경 10km 내 실제 지하철 없음**(정상)
- 데이터 수집 자체는 100% 완료된 상태, 보정 작업 불필요

### 3. CLAUDE.md "현재 진행 상황" 보정
- 잘못된 0% 수치 → 정확한 품질 지표 7개 (units 98.4%, lat 99.9%, price 64.0%, unsold 61.4%, subway 79.0%, dataReliability 57.4%)
- 다음 세션 우선순위 갱신

### 4. 9 GATE 사전 검증
- 🟢6 / 🟡3 / 🔴0 → 실행 허가
- GATE 5(보안): .env.local은 .gitignore `.env.*`로 추적 안됨 → 안전

## 미해결 (다음 세션 이월)
- **모바일 옵션 버튼 미작동** — 사용자 신고. SearchFilterBar 모바일 인터랙션 디버깅 필요. 이번 세션에서 조사 미착수.
- **price 64% / dataReliability 57.4%** — 가장 큰 데이터 갭, 보정 전략 필요

## 커밋 (1개)
1. `fab417d` docs: 세션86 — DB 품질 지표 정정 + naver-units 심야 스케줄 재등록

## 검증
- 빌드: vite build 435ms ✅
- 커밋: 1건, push 완료
- 행안부 API 502/500 지속 — 외부 의존성, 대기

---

# 세션 85 — 2026-04-13

## 주요 작업

### 1. MOIS_POP_KEY 상태 확인
- data.go.kr 3개 API 모두 키 유효 (2028-03-10~25까지)
- 행안부(1741000) API: HTTP 502 Bad Gateway — 서버 장애 (키 만료 아님)
- 30분 자동 체크 설정 (ScheduleWakeup)

### 2. naver-units 429 테스트 + 심야 스케줄
- `--dry-run --limit=3`: 3건 모두 429 (fetch + curl_cffi 전부 실패)
- Windows Task Scheduler 심야(02:00 KST) 자동 실행 등록
- 작업명: `naver-units-night`

### 3. naver-collect.py 전체 재실행
- 29,699건 단지 대상 전체 수집 시작 (백그라운드)
- 150/29,699건 진행 확인 (4,105 매물 수집)
- Python stdout 버퍼링 이슈: `PYTHONUNBUFFERED=1` + tee로 해결

### 4. 프로젝트 건강 체크
- 테스트: 146파일 2,270개 전부 통과 (50.36초)
- 린트: 0 에러, 85 경고 (warn 수준)
- 빌드: vite build 성공 (423~926ms)

### 5. DB 데이터 품질 점검
- units: 100%, lat/lng: 99.9%, builder: 99.8%, schoolScore: 94.9%
- price/pp/area: 64.0% (가격 미공개 단지)
- unsold_rate: 0% (naver-units 보정 필요)
- subway_dist: 0% (인프라 수집 미완)
- dataReliability: avg 82.5, median 92, ≥70: 709/1,000건
- 이상값: units<=0: 0건

### 6. CLAUDE.md 정정
- "MOIS_POP_KEY 만료 확정" → "행안부 API 서버 장애 (키 유효)"
- 세션85 진행 상황 + 다음 작업 업데이트

## 커밋
- (세션 진행 중 — naver-collect.py 완료 후 최종 커밋 예정)

## 교차검증 결과
- 빌드: 423ms 성공
- 테스트: 2,270개 통과
- 린트: 0 에러
- 스코어링: 세션84에서 1,424건 완료 (변경 없음)

## 9 GATE 검증
- 파이프라인 플랜: 🟢8, 🟡1, 🔴0 → 실행 허가
- 개선 작업 플랜: 🟢9, 🟡0, 🔴0 → 실행 허가

## 다음 세션 권장
1. naver-collect.py 완료 확인 → post-naver-collect.sh 실행
2. naver-units 심야(02:00) 결과 확인 → unsold_rate 보정
3. 행안부 API 복구 확인 → migration.mjs --dry-run
4. subway_dist 수집 파이프라인 점검

---

# 세션 84 — 2026-04-11

## 주요 작업

### 1. 환경 사전 검증 (단계 0)
- 환경변수 4개(SUPABASE_URL, SUPABASE_SERVICE_KEY, MOIS_POP_KEY, KOSIS_KEY): 전부 OK
- alias-loader.mjs: Node 24에서 `--loader` 정상 동작 (deprecated 경고만)
- Supabase 연결: apartments 2,001건 확인

### 2. naver-units 실행 테스트 (단계 1)
- `--limit=5` 실행: 5건 모두 Rate limit (적응형 인터벌 5→7.5→10→12.5→15초 정상 동작)
- 한국 IP 확인 (182.228.191.24)
- 보정 대상: 441→54건으로 감소 (molit/applyhome 등에서 보정됨)
- 결론: 코드 레벨 Rate Limit 정상이나, 네이버가 IP/JWT 기반 차단 강화

### 3. compute-scores 실행 (단계 2) — 성공
- dry-run: 1,424건 전부 스코어링, 스킵 0건, 6개 카테고리 정상 (3.2초)
- 실제 실행: 1,424/1,424건 DB UPDATE 완료 (실패 0건, 9.1초)
- alias-loader 세션83 수정 완벽 검증

### 4. transMovStats API 키 확인 (단계 3)
- curl 테스트: 2024-06, 2025-01, 2025-12, 2026-01 전부 HTTP 500
- 응답: "Unexpected errors" → MOIS_POP_KEY 만료 확정
- KOSIS API: HTTP 200 정상 (3/23 실패는 일시적)
- 대응: data.go.kr 포털에서 키 갱신 필요 (다음 세션)

### 5. post-naver-collect.sh 안정성 수정 (단계 4)
- naver-units 단계를 `if-else` 명시적 분기로 변경 (비치명적 처리)
- `set -e`에 의존하지 않음 (Windows Git Bash 호환성)
- 구문 검증 통과 (`bash -n`)

### 6. 전체 파이프라인 실행 (단계 5) — 진행 중
- sync-naver-complex: Phase 1 갱신14, Phase 2 매물44, Phase 3 시세1986건
- Phase 4 관리비/방향 집계: 장시간 실행 중 (63K complexes articles 처리)
- 빌드: 380ms 성공

### 7. Vercel 배포 복구 (긴급)
- 원인: auth/refresh.js 추가(세션81)로 Serverless Functions 13개 → Hobby 12개 초과
- 11시간 동안 배포 실패 상태 (모든 커밋 Error)
- 해결: auth/refresh→auth/verify?action=refresh 통합 (12개 유지)
- .vercelignore: requirements.txt/scripts/*.py 제외 추가 (Python 빌드 방지)
- 배포 성공 확인 (Ready, 17s)

### 8. naver-units Python curl_cffi fallback
- fetch 3회 429 시 Python naver-fetch-proxy.py subprocess로 재시도
- Windows python3→python 자동 감지
- 테스트 결과: **curl_cffi도 동일 429** → TLS 핑거프린팅이 아닌 IP 기반 차단
- 코드 자체는 정상 동작 (심야 재시도 필요)

## 커밋 (5개)
1. `ee20815` fix: post-naver-collect.sh — naver-units 실패 시 파이프라인 계속 진행
2. `472542b` docs: 세션84 — 파이프라인 실행 테스트 + CLAUDE.md 업데이트
3. `d5678e8` fix: Vercel 배포 에러 수정 — requirements.txt/Python 파일 제외
4. `3129213` fix: Vercel Hobby 12함수 제한 복구 — refresh→verify 통합
5. `cdc44d8` feat: naver-units Python curl_cffi fallback 추가

## 교차검증 결과
- 빌드: 503ms 성공
- Vercel 배포: Ready 확인
- 스코어링: compute-scores 1,424건 전부 성공
- console.log: 0건
- 보안: PASS

## 9 GATE 검증 (2회 실행)
- 파이프라인 계획: 🟢6, 🟡3, 🔴0 → 실행 허가
- 후속개선 계획: 🟢7, 🟡2, 🔴0 → 실행 허가

## 다음 세션 권장
1. data.go.kr MOIS_POP_KEY 갱신 (브라우저 → 마이페이지 → 연장 신청)
2. naver-units 심야 실행 (02:00~05:00 KST, IP Rate Limit 해제 대기)
3. Vercel 12함수 — 새 API 추가 시 action 파라미터 통합 필수

---

# 세션 83 — 2026-04-11

## 주요 작업

### 1. compute-scores.mjs ESM 로더 이슈 해결
- alias-loader.mjs: 상대 경로 확장자 자동 해석 추가 (`./foo` → `./foo.js`)
- engine.js의 7개 extensionless import 해결 (scorePrice, scoreLocation 등)
- 검증: `calcCats` import 성공 + vite build 408ms 통과

### 2. naver-units.mjs 적응형 Rate Limit
- 기본 인터벌 3→5초, 백오프 [5,10,20]→[8,15,30]초
- 429 연속 시 적응형 인터벌 증가 (최대 15초), 성공 시 감쇠
- 구문 검증 통과 (실제 실행은 로컬 한국IP에서 확인 필요)

### 3. migration.mjs 데이터 가용성 테스트
- dry-run 실행 → HTTP 500 (2026년 1월)
- 2024년 6월 데이터로도 HTTP 500 → API 서버 자체 장애 또는 MOIS_POP_KEY 만료
- 대응: data.go.kr에서 transMovStats API 구독 상태/키 갱신 필요

## 커밋 (1개)
1. `df98ca5` fix: ESM 로더 상대경로 해석 + naver-units 적응형 Rate Limit

## 교차검증 결과
- 빌드: 408ms 성공
- 스코어링: 5개 프로필 합계 100 확인
- null 안전성: PASS
- Hook 규칙: PASS (Node 스크립트, React 훅 없음)
- 보안: PASS

## 9 GATE 검증 (계획 단계)
- 🟢7, 🟡2, 🔴0 → 실행 허가

## 다음 세션 권장
1. naver-units 로컬 실제 실행 (월/목 08:00)
2. compute-scores 실제 실행 (Supabase 데이터 대상)
3. data.go.kr transMovStats API 키 갱신/구독 확인
4. post-naver-collect.sh 전체 파이프라인 재실행

---

# 세션 82 — 2026-04-11

## 주요 작업

### 1. 네이버 후처리 (post-naver-collect.sh)
- rm naver.pid (stale 정리) → post-naver-collect.sh 실행
- 1/4 sync-naver-complex: 성공 (Phase1 갱신3, Phase2 45건, Phase3 1986건, Phase4 9734건)
- 2/4 naver-units: 실패 (50건 전부 rate limit → 검색 결과 없음)
- 3/4 collect-unsold-kosis: 성공 (492건 KOSIS 응답, regions 352건, apartments 235건 갱신)
- 4/4 compute-scores: 실패 (scorePrice 모듈 미발견 — ESM 로더 기존 이슈)

### 2. 폰트 가독성 Phase 3-7 완료 (feat/font-size 브랜치 → main 머지)
- Phase 3: CompareSheet (17건 fontSize → F 상수)
- Phase 4: 필터 6파일 (7건)
- Phase 5: 섹션 8파일 (71건)
- Phase 6: 전문가 9파일 (46건)
- Phase 7: 관리자 3파일 (78건) + 기타 11파일 (88건)
- 합계: 38파일, ~307건 fontSize 하드코딩 → F 상수 전환
- Phase 0-2 포함 전체 컴포넌트 폰트 통일 완료

### 3. 관리자 일괄 승인/거부 기능
- api/admin/review.js: emails[] 배열 지원 (최대 50건, 직렬 처리, 하위호환)
- useAdminMode.js: selectedEmails/batchLoading + handleBatchReview + 탭 전환 시 초기화
- AdminDashboard.jsx: pending 카드 체크박스 + 전체선택 + 일괄 승인/거부 버튼
- 테스트 6+3=9케이스 추가 (배치 정상/부분실패/빈배열/초과/UI)

## 커밋 (4개)
1. `2255123` feat: 폰트 가독성 개선 Phase 3-7 — 38개 컴포넌트 F 상수 전환 (feat/font-size)
2. `69011cb` feat: 관리자 일괄 승인/거부 — review API 배열 지원 + 체크박스 UI (main)
3. `d62387f` Merge branch 'feat/font-size' (main)

## 교차검증 결과
- 빌드: 413-488ms 성공
- 스코어링: 5개 프로필 합계 100 확인
- null 안전성: PASS
- Hook 규칙: PASS
- 보안: PASS
- 테스트: 43개 전부 통과

## 9 GATE 검증 (계획 단계)
- 🟢2, 🟡7, 🔴0 → 실행 허가
- 보완 7건 반영 후 구현 (탭 전환 초기화, 배치 응답 형식, 전체선택 범위 등)

## 다음 세션 권장
1. compute-scores.mjs ESM 로더 이슈 해결 (scorePrice 모듈 경로)
2. naver-units.mjs rate limit 해결 (또는 molit-units로 대체)
3. migration.mjs (행안부 API 2026년 데이터 제공 시)

---

# 세션 81 — 2026-04-10

## 주요 작업

### 1. Supabase 1000행 제한 근본 해결
- _shared.mjs: selectAll() 공유 페이지네이션 헬퍼 추가
- 9개 수집기 적용: collect-building-hub, collect-applyhome, molit-building-info, collect-maintenance, molit-units, dart-builders, naver-listings, calc-exclusive-ratio (+prices 쿼리)
- molit-units.test.mjs: mock에 .range() 추가

### 2. 자동 로그인 (B안 — localStorage + refresh token)
- api/_lib/auth.js: createRefreshToken + verifyRefreshToken 추가 (30일 TTL)
- api/auth/refresh.js: 신규 엔드포인트 (rotation — 사용 시 이전 토큰 블랙리스트)
- api/auth/login.js + kakao.js: refreshToken 함께 발급
- useExpertMode.js: sessionStorage → localStorage + verify 실패 시 자동 갱신
- useKakaoAuth.js + App.jsx: localStorage 전환
- api/auth/logout.js: refresh token도 블랙리스트
- Vercel Hobby 12함수 제한 유지 (정확히 12개)

### 3. 폰트 가독성 개선 Phase 0-2 (feat/font-size 브랜치)
- theme/index.js: F 상수 추가 (micro=10, xs=11, sm=12, base=14, md=15, lg=16, xl=18, xxl=20)
- AptCard: 본문 12→14px, 라벨 10-11→12px, 버튼 12→14px
- Primitives: 차트 축 8-9→10px, 툴팁 10→11px
- CatPanel: 카테고리 라벨 13→15px, 값 12→14px
- DetailModal: 제목 16→16/18px, 본문 12→14px, 버튼 13→14/15px
- tableStyles + filterStyles: F 상수 전환

### 4. 기타
- .claudeignore 생성 (package-lock.json, .github/, playwright.config.js, vercel.json)
- QMD 설치 시도 → Windows node-llama-cpp 빌드 실패 → 삭제
- naver-collect.py 재실행 (19,200/29,727 = 64.6% 진행 중)
- building-hub 재실행 (2,000건 전체 대상 — selectAll 적용, 전부 스킵)

## 커밋 (3개)
1. `b198098` fix: Supabase 1000행 제한 근본 해결 — selectAll 공유 헬퍼 + 9개 수집기 적용
2. `8e2b5b7` feat: 자동 로그인 — localStorage + refresh token rotation (30일)
3. `aea73a5` feat: 폰트 가독성 개선 Phase 0-2 (feat/font-size 브랜치)

## 교차검증 결과
- 빌드: 354-400ms 성공
- 테스트: 146파일 2,261개 전부 통과
- null 안전성: PASS
- 보안: PASS

## 다음 세션 권장
1. 네이버 수집 완료 확인 → post-naver-collect.sh 실행
2. 폰트 Phase 3-7 이어서 (feat/font-size 브랜치)
3. migration.mjs (행안부 API 2026년 데이터 제공 시)
4. 관리자 일괄 처리 (승인/거부)

---

# 세션 80 — 2026-04-10

## 주요 작업

### 1. 네이버 전체 재수집 (Priority 1)
- naver-collect.py: nohup + python -u (unbuffered) 백그라운드 실행
- python3 → python 경로 이슈 해결 (Windows Store 리다이렉터)
- 29,727 complex 대상 전체 수집 진행 중

### 2. 개선 백로그 (Priority 2)
- useDataPipeline.test.js: 신규 29개 테스트 (renderHook + vi.mock, 정렬/필터/페이지네이션/폴백)
- WeightEditor.jsx: memo() 래핑 + AdminDashboard named→default import 전환
- api/_lib/apartmentValidation.js: parseApartmentIds + ID_PATTERN 공유 모듈 추출
- api/_lib/apartmentValidation.test.js: 13개 테스트 (정상/에러/injection/경계값)
- prices.js, unsold-history.js: 검증 중복 제거 → apartmentValidation import

### 3. building-hub 재실행 (Priority 3)
- data.go.kr API 상태 확인 (정상 응답)
- collect-building-hub.mjs nohup 실행 (대상 1000건)

### 4. CLAUDE.md 리뉴얼
- 212줄 → 155줄 (27% 감소): 중복 제거, 주제별 그룹화, 환경변수 테이블
- 하네스 엔지니어링 규칙 추가 (Plan→Guard→Work→Review)

## 커밋 (1개)
1. `f9e2ad0` feat: useDataPipeline 테스트 + WeightEditor memo + validation 추출

## 교차검증 결과
- 빌드: 393ms 성공
- 테스트: 4파일 55개 전부 통과
- 스코어링: 5개 프로필 합계 100 확인
- null 안전성: PASS
- Hook 규칙: PASS
- 보안: PASS

## 게이트 검증 (9 GATE)
- 🟢 8 / 🟡 1 / 🔴 0 → 실행 허가

## 다음 세션 권장
1. 네이버 수집 완료 확인 후 sync-naver-complex.mjs 재실행
2. migration.mjs (행안부 API 2026년 데이터 제공 시)
3. 관리자 일괄 처리 (승인/거부)

---

# 세션 79 — 2026-04-09

## 주요 작업

### 1. 비로그인 전환율 Analytics (Priority 3)
- LoginPromptModal: trigger prop + trackEvent 4개 (shown/kakao_click/expert_click/dismissed)
- App.jsx: loginTrigger 상태 (detail/map 트리거 구분)
- 테스트 6건 신규

### 2. 관리자 검색/페이지네이션 (Priority 2)
- api/admin/users: q/limit/offset 쿼리 + total 응답 + 서버 sanitize
- useAdminMode: searchQuery/page/totalUsers + 300ms 디바운스
- AdminDashboard: 검색 입력 + 페이지네이션 UI + 빈 검색결과 메시지
- 테스트 8건 추가

### 3. Vercel 배포 복구 (긴급)
- 원인: admin/stats.js 추가로 13개 함수 → Hobby 12개 제한 초과 (세션78부터 8건 연속 ERROR)
- 해결: admin/stats → admin/users?action=stats 통합, .vercelignore 추가
- 결과: READY 상태 복구 확인 (Vercel API)

### 4. 네이버 재수집 + 1000행 제한 해소
- naver-collect.py: SB.select 페이지네이션 (PostgREST 1000행 → 2001건 전체)
- sync-naver-complex.mjs: apartments/articles 4곳 페이지네이션 + Phase4 matchApartments 매칭 수정
- 수집 결과: complexes 29,727건, articles ~11,458건 (1,250/29,727 complex 처리 후 프로세스 종료)
- sync 결과: Phase1 453건, Phase2 38건, Phase3 1,986건, Phase4 9,435건

### 5. 개선 리포트 (하네스 5관점)
- 14건 발견: 🔴2(모두 해결) / 🟡7 / 🟢5
- 주요: npm audit 0건, TODO 0건, 순환의존성 없음

## 커밋 (4개)
1. `66f54cc` feat: 관리자 검색/페이지네이션 + 비로그인 전환율 Analytics
2. `365a33c` fix: Vercel Hobby 12함수 제한 복구 + naver-collect 페이지네이션
3. `9de9241` fix: sync-naver-complex 페이지네이션 + Phase4 매칭 수정
4. `4ec97a0` docs: CLAUDE.md 세션79 최종 업데이트

## 발견한 이슈
- Supabase PostgREST 기본 1000행 제한이 naver-collect.py + sync-naver-complex 양쪽에 영향
- Vercel Hobby 12 Serverless Functions 한계 — 향후 API 추가 시 통합 필수
- naver-collect.py articles 수집이 29,727 complex 중 1,250에서 중단 (프로세스 종료)

## 다음 세션 권장
1. naver-collect.py 전체 재실행 (--limit 없이, nohup으로 12시간+ 실행)
2. building-hub 재실행 (data.go.kr API 정상화 후)
3. 🟡 개선 백로그: useDataPipeline 테스트, WeightEditor memo(), API 검증 중복 제거
