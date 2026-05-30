# 백로그 아카이브 — 완료/종결 항목

> [BACKLOG.md](BACKLOG.md) 에서 분리한 완료(✅)·환각정정 종결(❌) 항목.
> **목적**: BACKLOG.md 는 "할 일"만 남겨 한눈에 보이게 하고, 완료 사실은 여기 보존.
> **중복 플랜 방지**: 다음 세션이 "이거 했나?" 확인 시 BACKLOG.md 상단 `## ✅ 완료된 일`
> 색인에서 1차로 찾고, 상세는 이 파일에서 확인. 색인에 있으면 = 이미 완료, plan 금지.
> 새 완료 항목 발생 시 BACKLOG.md 에서 이 파일로 이동 + 색인 한 줄 동시 추가.

> **drift 현황 (세션 332 실측 정정)**: 본 파일 색인 (✅+❌) = **36건**, 상세 절(`^- (✅|❌) \*\*` 패턴) = **20건**. 16건이 색인에만 박혀 있고 상세 누락. 색인 한 줄로도 중복 plan 방지 기능 작동 — 그러나 사고 박제·답습 자산으로 활용하려면 16건 점진 보강 의무. 다음 세션에서 BACKLOG ✅ 색인 한 줄 추가 시 본 파일에 상세 회고 동시 박제 룰 강제 (BACKLOG.md L13 답습).
> **세션 277 박힘 "42 vs 12 = 30" stale** (세션 313 이후 ✅ 8건 추가로 본 파일 += 4건 답습). 세션 332 직접 grep 실측이 진실의 원천.

---

## 🔴 즉시 — 완료

- ✅ **audit-env-keys collector→yml 역방향 매칭 재구성** (세션 346, P2 "step 단위 보강" 진입 → 자가 점검 1 발동 → 더 근본적 사각지대 발견)
  - 진입 동기: BACKLOG L96-99 "audit-env-keys.mjs step 단위 검증 보강 (P2)" — 세션 328 사고(incremental.yml schools step 의 NEIS_KEY/SCHOOLINFO_KEY 누락을 audit 가 못 잡음) 후속.
  - **자가 점검 1 발견 (plan v1 맹점 1건 + 할루시네이션 3건 정정)**:
    - v1 가정 "현재 audit baseline 31/37 clean = 통과 상태" = **오집계**. `findWorkflowForCollector`(L152) 가 `collect-<base>.yml`/`<base>.yml` 1:1 매칭만 → yml명≠collector명 시 null → `if(ymlFile)` false → issue 미생성 → **❌ 없이 clean 집계**. 즉 "검증 통과"가 아니라 "검증 자체를 안 함".
    - **미검증 9 collector 실측 (MISS)**: transport-tago(↔collect-transport) / schools-neis(↔collect-schools) / infra-kakao(↔collect-infra) / molit-building-info(↔collect-building-info) / noise-estimate / population-sex-age / childcare-info / childcare-info-jeju + naver-presale(workflow 호출 0건 = 로컬 전용 = 검증 불필요).
    - 9 MISS 전부 codeKeys ⊆ yml step env (실측 누락 0) → 보강 후 errorCount 0 유지가 정상. 가치 = "미래 누락 방지" + 세션 328 같은 사고 진짜 차단.
  - **본질 = 1:1 매칭 부재** (v1 "multi-collector 누락"보다 정확). 이름 불일치 + multi-collector yml 둘 다 포함.
  - fix (`scripts/audit-env-keys.mjs` +152/-22, test +202/-1):
    - `extractStepCollectorEnv(file)` 신규 export — 모든 yml 의 각 job(matrix job skip)·step.run 에서 `node scripts/collectors/X.mjs` 역방향 추출 → `Map<mjs, Array<{yml, step, envBlock, validateRefs}>>`. env 상속 step > job > workflow. 한 step 2 collector(building-info/childcare) = 1:N 각각 push.
    - main() 재구성: stepMap 1차 (등장하는 모든 yml-step 각 row 검증) → 미등장 시 기존 1:1 fallback → 그래도 없으면 `ℹ️ 로컬 전용` 분류. ❌ 메시지에 `(in <yml>, step="<name>")` 표기.
    - validate 정규식 `validatePattern()` 상수 통일 (3곳) — A형 `-z "$X"` + **B형 `-z "${{ secrets.X }}"`** (collect-air-quality/police/schools 가 B형 → 이전 거짓 양성 ⚠️ 제거).
  - 검증:
    - audit summary **29/37 clean, 0 errors** (이전 31/37 = 미검증 9 포함된 거짓. 이제 검증 후 진짜 ⚠️ 노출로 clean 감소가 정상)
    - 세션 328 재현 시뮬 (incremental schools NEIS_KEY 제거) → **EXIT 1** 검출 (이전 audit 은 미검증이라 EXIT 0 이었음) + git diff 0
    - 이름 불일치 시뮬 (collect-transport TAGO_KEY 제거) → **EXIT 1** 검출 + git diff 0
    - vitest 10/10 (기존 4 + 신규 6: 세션328 재현 / 이름불일치 / 1:N / job.env fallback / B형 validate / matrix skip) + typecheck:scripts EXIT 0
    - 잔여 진짜 ⚠️ (errorCount 무관, 별 자리): transport-tago TAGO_KEY / building-hub MOLIT_KEY / dart-builders DART_KEY / noise-estimate·geocode·reverse KAKAO_KEY = env 주입은 하나 Validate secrets step 빈 값 체크 누락. 사고 아님(개선 여지).
  - 답습 자산: **자가 점검 1 = "audit 이 31 clean 이라 통과" 단정 직전 실제 검증 범위 grep 의무**. "clean 카운트 ≠ 검증 카운트" (미매칭은 미검증인데 clean 집계). 서브에이전트(Explore 3 + Plan 1) + 직접 실측 교차로 9 MISS 확정.

- ✅ **graceful shutdown 15 collector 일괄 보강** (세션 329 PR-A + 330 PR-B + 337 PR-C 누적 머지)
  - 진앙: 세션 327 박제 시점 "graceful shutdown 신호 등록만 (break 0) 15 collector 잔여" 박힘. 세션 329~337 누적 머지로 정정 완료. BACKLOG L88-92 본문 정정 0건 박힌 stale 환각 잔존.
  - 세션 341 자가 점검 1 발동 = 진실의 원천 답습 결과 `_graceful-coverage.test.mjs` 53/53 PASS. 15 collector 모두 main loop break 박힘 완전 정정 박힘.
  - 실측 결과 (BACKLOG L92 박제값 vs 실측):
    - calc-school-walk break=2 ✅ / collect-housing-price break=1 ✅ / collect-market-stats break=2 ✅ / collect-trades break=1 ✅
    - naver-presale break=1 ✅ (L685 `reporter.interrupted()` 변수명 박힘 다름 — `rpt` 만 grep 미스 박힘 사고 답습)
    - population break=1 ✅ / population-sex-age break=1 ✅
    - childcare-info break=2 ✅ / childcare-detail break=1 ✅ / childcare-info-jeju (세션 329 PR-A 박힘) ✅
    - collect-nearby-childcare break=2 ✅ / collect-air-quality break=1 ✅ / collect-applyhome break=1 ✅
    - collect-building-hub break=1 ✅ / collect-crime-safety break=1 ✅
  - 잔여 (ALLOWLIST 박힘 별 진단 후보, 본 항목 범위 외):
    - `collect-maintenance.mjs` (rpt=1 break=0, K-apt 관리비 별 진단)
    - `trade-stats-regions.mjs` (setupGracefulShutdown import 호출 0회 회귀, 별 진단)
  - 답습 자산: `_graceful-coverage.test.mjs` 53/53 PASS = 진실의 원천 박힘 / `graceful-shutdown-coverage.md` §"정확 패턴 3중 의무"
  - 세션 341 메모 자산: **BACKLOG 박제값 신뢰 금지 + 회귀 가드 답습 우선 의무**. 머지 후 BACKLOG 본문 정정 0건 박힌 stale 답습 패턴 차단

- ✅ **ARCHITECTURE.md/CLAUDE.md/README.md 박제값 일괄 정정** (세션 313, 본 PR)
  - 사고: 세션 312 PR #14 가 메모(MEMORY.md, session_*) stale 박제값 (1557→2001, 35→47) 정정했으나 공식 문서 (ARCHITECTURE.md, CLAUDE.md, README.md, src/components/CLAUDE.md) + BACKLOG.md 완료 항목 이관 누락. 세션 313 진입 시 답습 결과 stale 박제값 18건 발견
  - 원인 진단 (자가 점검 1 적용): plan v1 박제값 환각 7건 발견 (memo "64 파일 / 71 호출" → 실제 src/components/CLAUDE.md L5 "45개, 2026-04-19 실측" 명시 / Vercel KV stale 표현 → Upstash Redis 단독 / 카테고리 박제값 환각 등). 진실의 원천 = src/components/CLAUDE.md L5/L9-15 명시값
  - fix (5 파일):
    - `ARCHITECTURE.md` 7건: L45-46 src/lib/*Api stale 5건 통합 정정 (실제 src/services/staticDataApi.ts 단독) / L47/L139/L248/L275 App.jsx→App.tsx / L58 collect-data.mjs 1065→1193줄 / L98 마이그 14→15개 / L550 apartments 1500→2001
    - `CLAUDE.md` 6건: L21 App.tsx (~430줄) / L23 memo 45 + 카테고리 9+9+10+7+9+5+1 / L24 api 23 / L25 Upstash Redis 단독 / L28 GitHub Actions 47 / L53 memo 45
    - `README.md` 3건: L14 Upstash Redis / L43 App.tsx 430줄 / L44 memo 45
    - `src/components/CLAUDE.md` 1건: L50 App.jsx (~442줄) → App.tsx (430줄, 2026-05-26 실측)
    - `.claude/BACKLOG.md`: ✅ 색인 3건 추가 + 본문 3건 삭제 (#1 audit-env-keys / #2 dataUpdatedAt drift / #3 ARCHITECTURE.md L95/L126)
  - 검증: 박제값 grep 후 0 hit + DB count 2001 + workflows 47 + App.tsx 430 + api 23 + memo 45 (src/components/CLAUDE.md L5 진실의 원천 일치)
  - 답습:
    - 세션 312 PR #14 양식 답습 (메모 정정 패턴)
    - 자가 점검 1 룰 답습 — plan v1 환각 7건 발견 → v2 재설계 (진실의 원천 grep 의무 박힘)
    - 룰 패턴 후보: **공식 문서 박제값 정정 시 진실의 원천 (src/components/CLAUDE.md L5 같은 명시값) 우선 grep 의무**

- ✅ **audit-env-keys matrix orchestrator 답습 보강** (세션 304+308, 커밋 `96fbdcc`+`58f5983`)
  - 사고: 세션 232 KOSIS_MIGRATION_KEY 3-way 사고 답습 자산 audit-env-keys.mjs 가 1대1 매칭만 답습 → `fill-missing-data.yml` 의 phase4-independent matrix 답습 0 → 세션 294 KOSIS_MIGRATION_KEY env block 누락 재발
  - 원인: matrix orchestrator (sub-step 매트릭스) 답습 자리 미박제. audit `30/36 clean ✅` 통과 + 실 발화 시 exit 1
  - fix:
    - 세션 304 (`96fbdcc`): audit-env-keys.mjs 에 `MATRIX_ORCHESTRATORS` 상수 + `extractMatrixJobs()` 함수 추가. js-yaml@4.1.1 FAILSAFE_SCHEMA 답습 (정규식 fragile 회피, `\Z` JS 미지원 사고 답습)
    - 세션 308 (`58f5983`, PR #11): fill-missing-data.yml Phase 3+4+5 일괄 폐기 (-108줄) + audit-fill-matrix.mjs CI 가드 신규 (collect-*.yml cron 박힘 + fill matrix script 교집합 차단)
  - 검증: vitest 4 test pass (audit-env-keys.test.mjs + audit-fill-matrix.test.mjs). KOSIS_MIGRATION_KEY 제거 시뮬 → exit 1 정상. 5/31 cron 발화 시점에 phase2-calc 3 job 만 잔존
  - 답습: `.claude/rules/workflows/secret-naming-audit.md` §"matrix orchestrator 답습" + `.claude/rules/workflows/timeout-rootcause-policy.md` §"세션 307 안티 패턴 11 일꾼 정정"

- ✅ **dataUpdatedAt vs fetchedAt 필드 drift fix** (세션 280/281/292, 커밋 `89831d7`+`a4c6d8d`)
  - 사고: 세션 279 발견. JSON 출력 (`collect-data.mjs` L1089) = `fetchedAt` ↔ 타입 + hook 기대 (`staticDataApi.ts` L16 / `useApartmentData.ts` L21) = `dataUpdatedAt` 필드명 drift → 런타임 `updAt = undefined` → `setDataUpdatedAt(null)` → UI dataFreshnessText 표시 안 됨 (AptListSection 헤더 "N개 단지 · X 업데이트" 자리 빈 박힘)
  - 원인: JSON 직렬화 시점 (collect-data.mjs Phase 7) 의 키 명명과 hook 의 기대 키 명명 일치 0. PR #14 메모 정정과 별개 진앙
  - fix (듀얼 방어):
    - collect-data.mjs L1026-1029 (`89831d7`): 출력 시 `dataUpdatedAt: fetchedAt` 양쪽 키 동시 박제 (근본 원인 제거)
    - staticDataApi.ts L46-47 (`a4c6d8d`): fallback `json.dataUpdatedAt ?? json.fetchedAt ?? null` (하위 호환성 보장, CDN 캐시·과거 JSON 호환)
  - 검증: staticDataApi.test.js L124-143 4건 회귀 가드 (fetchedAt→dataUpdatedAt 매핑) + useDataPipeline.test.js L77-84 (dataFreshnessText 포맷). 최신 JSON (2026-05-24) 양쪽 키 박힘 확인
  - 답습: 정정 패턴 = 근본 원인 + fallback 듀얼 방어 (단방향 정정 시 CDN 캐시 사고 위험)

- ✅ **collect-migration.yml KOSIS_MIGRATION_KEY 3-way 동기화 fix** (세션 232 발견 → 세션 232 확장 turn fix 박힘, 세션 244 BACKLOG 강등)
  - 사고: 매월 15일 KST 07:00 schedule failure. run id 24481813793 (2026-04-15 UTC 22:32:48). 마지막 success run 23120598953 (2026-03-15)
  - 원인 (실측 3중): migration.mjs `KOSIS_MIGRATION_KEY` 만 + yml `MOIS_POP_KEY` 만 주입 + data-fill envKeys 도 동일 불일치
  - fix 커밋: `1bbf9b4` "fix(etl): collect-migration KOSIS_MIGRATION_KEY 3-way 동기화 + audit 자동화 도입" (7 파일 +780/-6)
    - `.github/workflows/collect-migration.yml` L38 `KOSIS_MIGRATION_KEY: ${{ secrets.KOSIS_MIGRATION_KEY }}` 주입 + L40 validate secrets step
    - `scripts/collectors/data-fill.mjs` L43 envKeys = `[MOIS_POP_KEY, MOIS_SEX_AGE_KEY, KOSIS_MIGRATION_KEY, MOLIT_KEY, KOSIS_KEY]` 5개 박제
    - GitHub Secret `KOSIS_MIGRATION_KEY` 2026-05-12 등록 (gh secret list 직접 확인)
    - audit script (`scripts/audit-env-keys.mjs`) 도입 + `ci.yml` L34-35 단계 추가 (재발 차단 자동화)
    - data-fill.test.mjs L41-45 회귀 가드 KOSIS_MIGRATION_KEY 포함 검증
  - 검증: workflow_dispatch run **25746958595 (2026-05-12 16:11 UTC) success**
  - 답습: `.claude/rules/workflows/secret-naming-audit.md` (3-way 동기화 의무 룰 박힘)
  - drift 박제: 세션 232 확장 turn fix 박힌 후 SESSION_LOG 만 갱신 → BACKLOG 갱신 누락 1개월 (세션 244 강등 사고 답습)

- ✅ **package-lock.json @emnapi peer deps 누락 fix** (세션 180 — 커밋 `cf2e5a5`)
  - 증상: 35 ETL 워크플로 `npm ci` EUSAGE 거부 (`Missing: @emnapi/core@1.10.0 / @emnapi/runtime@1.10.0 / @emnapi/wasi-threads@1.2.1 from lock file`)
  - 원인: `@napi-rs/wasm-runtime` (rolldown 의존) peerDependencies 가 lock 에 별도 노드 미박제
  - 진단 정정: ci.yml 은 `--legacy-peer-deps` 사용 → 통과 / ETL 35개 단순 `npm ci` → 거부
  - 영향 (실측): 최근 100 run 중 ETL 실패 10건 (3.2일, 일평균 ~3건)
  - fix: lock +37 줄 (3 패키지 peer/optional/dev 노드 추가). node_modules 미수정
  - 검증: `npm ci` EUSAGE → EPERM 으로 변경 (Windows 로컬 잠금 한정, CI Linux runner 영향 0)
  - 관련 메모: `reference_ci_npm_ci_lock_sync.md` (세션 161 동일 패턴 답습)

- ✅ 미션 1 — 공개 API 보안: `api/supabase/{apartments,prices,unsold-history}.js` rateLimit "proxy" + dompurify moderate 해소 (세션119)

- ✅ **KOSIS Phase 2-A tblId DT_1YL202001E → DT_MLTM_2082 fix** (세션 222 — 커밋 `4c0ffc9`, CI success 3m42s)
  - 증상: 2026-05-08 정기 수집에서 `phases.kosis.reason="해당 통계표가 존재하지 않습니다."` (HTTP 200 + err=21)
  - 진단: KOSIS 가 통계청(orgId=101) → MOLIT(orgId=116) 으로 통계표 이전. itmId 동일
  - fix: scripts/collect-data.mjs L256 (orgId+tblId) + L247-249 주석 갱신, 4+/2- diff
  - 검증: 17 시도 / 208 시군구 / 492 rows 정상 매핑, 파싱 로직 변경 0
  - 출처: `.claude/COLLECTOR_AUDIT_2026-05-11.md` §1 (v2)

- ✅ **Naver Post-Processing 90분 한계 사고 해결** (세션 229 D-2 split + 세션 246 강등)
  - v1 박제 (세션 225): "90분 timeout 도 부족, escalate trigger 1회차" (5/10 run `25638230275` cancelled @ 90:19)
  - 세션 224 fix (60→90): cancelled 한계만 이동, 실제 실행시간 90분 초과 = 18분 마진 부족
  - 해결: 세션 229 커밋 `c045594` "feat(workflow): naver-postprocess D-2 split + core timeout 120→90"
    - `.github/workflows/collect-naver-listings.yml` D-2 split: 4 step (transport/infra/schools/etc) → `collect-naver-listings-incremental.yml` 신규 분리
    - core timeout 120→90 (sync 단독 55:39 + setup 24s = 56:03, 90m 마진 33:57)
  - 실증 검증 (세션 246 gh CLI 직접):
    - run 25695357731 (5/11 schedule, success 119:47 — 120m 시절 한계 통과)
    - run 25760195567 (5/12 schedule, success 48m — D-2 split 적용 후 90m 마진 42분 안정화)
    - run 25736019303 (5/12 dispatch, success 49m)
    - **3 run 연속 success**, cancelled 5/10 이후 0건 → escalate trigger 자동 해소
  - 답습: BACKLOG drift 패턴 답습 v3 (세션 232 KOSIS_MIGRATION_KEY 1개월 방치 → 세션 244 강등 → 세션 246 Naver Post 1주 지각). fix 박힌 후 BACKLOG 갱신 누락 사고 누적 3회

---

## 🔴 즉시 — 환각 정정으로 종결 (❌, 작업 불필요 확정)

- ❌ **MOLIT_KEY 401** — 운영 영향 0
  - v1 박제: "MOLIT_KEY 401 → 4 수집기 일제 사망"
  - v2 재실증: 로컬 `.env` 키만 401 (36자). **GitHub Secret 의 MOLIT_KEY 는 정상** (2026-05-06 74회 호출 success 확인)
  - 결론: 로컬 개발자 디버그 환경에서만 영향. 운영(GitHub Actions/Vercel) 영향 0
  - 잔여 액션: 로컬 디버그 필요 시 `.env` 의 MOLIT_KEY 재발급 (우선순위 🟢, 운영 무관)

- ❌ **collect-market-stats KOSIS** — 가설 기각 + 후속 액션도 환각
  - v1 박제: "통계표 ID 폐지 가설"
  - v2 실증: DT_41401N_006 정상 응답, errMsg = "데이터가 존재하지 않습니다." (err=30) → **KOSIS 측 갱신 지연**
  - v3 실증 (세션 231 2026-05-12): v2 의 "후속 액션 1줄 fix" 도 환각:
    - L63 `{ col: "initial_sale_rate", tblId: "DT_41401N_008", prdSe: "Q", ... }` — prdSe='Q' 이미 박힘
    - L156-157 `quarterRe = /^\d{5}$/` (예 "20261") + L186-188 `startQ/endQ` 변환 + L203-204 분기 처리 **이미 구현**
  - 결론: prdSe='Q' 형식 변환 fix 는 이미 완료. KOSIS 측 갱신 지연만 남은 외부 의존 (자동 해소 대기)

- ❌ **api_quota 5일 침묵** — False Alarm 확정
  - v1 박제: "5일간 호출 0건, 일평균 100~200건 정상"
  - v2 실증: **90일 baseline = 24일 burst + 65일 침묵, 4월 21~25 5일 침묵 이미 발생, 평균 893/일**
  - 결론: cron 스케줄이 매월 day-7~9 + day-11~14 무발화. 정상 패턴
  - 출처: `.claude/COLLECTOR_AUDIT_2026-05-11.md` §5

- ❌ **collect-applyhome `recordApiQuota`** — 환각 확정 (세션 231 실증)
  - v2 박제: "본문에 `recordApiQuota(...)` 호출 0건"
  - v3 실증 (세션 231 2026-05-12): L16 import + L232 `await recordApiQuota(PHASE, "MOLIT_KEY", apiCalls)` 호출 존재. 커밋 `816664b` ("fix(collect-applyhome): recordApiQuota 누락 fix + try/finally + apiCalls 모듈 scope") 이미 적용
  - 결론: 본 항목 v2 박제 시점 이미 fix 완료. 작업 불필요. 세션 224 audit hypothesis 사고 답습 패턴 (가설을 단정 근거로 사용)

---

## 🟡 곧 — 완료

- ✅ **vitest 4 `environmentMatchGlobs` → `projects` 마이그레이션** (세션 348, 2026-05-30)
  - 진입: BACKLOG "TS M0 후속" 🟡 (세션 172 발견) — `vitest.config.ts` 가 `environmentMatchGlobs`(api/scripts → node 환경 분기)를 `// @ts-expect-error` 1줄로 보존 중. 트리거 = "M1 진입 직전 또는 vitest 5 검토". 세션 348 부팅 점검에서 작업 가능 P0 0건 → 유일한 소규모 안전 작업으로 사용자 선택.
  - **핵심 실측 발견 (조사 + 직접 grep 교차 검증)**:
    - `grep -rl environmentMatchGlobs node_modules/vitest/dist/` = **0건** → vitest 4.1.6 에서 옵션 **완전 제거** (deprecated 가 아니라 제거). 즉 이 옵션은 무효였고 **api/scripts 테스트가 의도(node)와 달리 jsdom 에서 돌고 있었음**. baseline 로그의 `Not implemented: navigation to another Document`(jsdom 전용 메시지)가 그 증거.
    - `grep -rlE 'window|document|render\(|@testing-library/react' api/ scripts/ --include='*.test.*'` = **0건** → api/scripts 가 브라우저 API 미사용 → jsdom 에서 돌아도 사고 0 (그래서 세션 172~347 동안 무사고로 묻힘). jsdom→node 전환이 기능 회귀를 일으키지 않음 확정.
    - `@/` import 쓰는 src 테스트 = **32 파일** → `extends: true` 누락 시 32개 즉사.
  - **fix (`vitest.config.ts` +24/-11)**:
    - 루트 `test` 에서 `environment: 'jsdom'` / `include` 3글롭 / `environmentMatchGlobs` + `// @ts-expect-error` 제거.
    - 공통 옵션(`globals`/`setupFiles`/`coverage`/루트 `plugins: [react()]`/`resolve.alias`) 루트 1곳 유지.
    - `test.projects` inline 2개 + 각 `extends: true`: `jsdom`(environment jsdom, include src) / `node`(environment node, include api+scripts).
  - **함정 (조사 답습)**: `extends: true` = globals + `@` alias(32 파일) + setupFiles **3중 상속의 단일 열쇠** (누락 시 동시 회귀). coverage 는 project-level 미지원 → 루트 필수. 루트 `include` 제거 안 하면 파일 2회 실행. setup.js 는 `typeof window` 가드라 node project 에서 jest-dom import 건너뛰어 안전.
  - **검증 (회귀 0 실측)**: `vitest run --reporter=json` 전후 동일 = **672 파일 / 3146 케이스 / 100% 통과 / 실패 0** (src 1563 · api 387 · scripts 1196 디렉토리별 완전 일치). typecheck exit 0(`@ts-expect-error` 제거 후 unused directive 에러 0). `vitest list --project jsdom` = src 만 / `--project node` = api+scripts 만 (jsdom 에 잡힌 "api/" 4건은 테스트 *이름* 문자열 `> /api/...` = false positive, 자가 점검 1 로 확인).
  - **답습 자산**: (1) "deprecated 보존" 박제값 ≠ 실측 — dist grep 으로 "완전 제거" 확정해야 정확. (2) 환경 분기가 죽어있어도 테스트가 그 환경 기능을 안 쓰면 무사고로 수년 묻힘 → grep 으로 실제 사용 여부 실측 의무. (3) projects 마이그레이션 = `extends: true` 단일 열쇠 + coverage 루트 + include 중복 제거 3대 함정. (4) 워크플로 2관점 조사(공식 문서 + 함정) + 직접 grep 교차 검증 패턴.

- ✅ **5/29 자연 cron cancelled 모니터링 종결 + 진앙 정정** (세션 347, 2026-05-30)
  - 진입: 세션 343 이 BACKLOG 🟡 곧에 박은 "5/29 자연 cron 단발 cancelled 모니터링" 항목 (트리거 = "다음 자연 cron 답습 → 재발 시 별 진단 PR")
  - **종결 근거**: `collect-naver-listings-incremental.yml` 자연 cron(schedule) 흐름 = 5/24·25 success → 5/26·27·28 cancelled → **5/29 21:11 run 26662435607 success (job 21:11:45~22:26:07 = 74분, all step success)**. 그날 manual dispatch 0건 = 순수 자연 cron. timeout 240분의 1/3만 사용. 세션 338 PR #51(schools-neis resume skip + timeout 180→240) 효과가 자연 cron 에서 확인됨.
  - **진앙 정정 (BACKLOG 본문 부정확)**: 세션 343 은 5/28 cancelled(run 26602629001)를 "transport-tago step 105초 외부 cancel / 진앙 미확정 / GitHub 인프라 부하 가설"로 적었으나, raw `gh api .../jobs` 실측 결과 진짜 진앙 = **세션 342 검증용 manual dispatch 가 같은 concurrency 그룹 점유**. 3 run 타임라인 실측:
    - run 26597102782 (5/28 19:25, workflow_dispatch): job 19:25:37 ~ **21:57:14** (2h31m) → success
    - run 26602629001 (5/28 21:13, schedule): created 21:13 → **job 21:57:16** (44분 큐 대기) ~ 21:59:25 → **cancelled** (transport step `start=null` = 시작도 못함)
    - run 26662435607 (5/29 21:11, schedule): job 21:11:45 ~ 22:26:07 (74분) → **success** (그날 manual 0건)
  - 메커니즘: incremental `concurrency: group: naver-postprocess-incremental`, `cancel-in-progress: false` → 19:25 manual run 이 그룹 점유 중 → 21:13 자연 schedule run 큐 대기 → manual 종료(21:57:14) 2초 후 schedule job 시작 → 2분 만에 cancel(GitHub 큐 정리 동작). 외부 인프라 부하·NEIS 지연 탓 아님.
  - 5/26·27 cancelled = 세션 338 이 이미 해결한 NEIS 만성 지연 사고 (PR #51 resume skip). 5/29 success 로 해결 확인.
  - **답습 자산 1**: `cancel-in-progress: false` 그룹에 검증용 manual dispatch 를 자연 cron 발화 시각(20:30 UTC)과 겹치게 돌리면, 그날 자연 cron 이 큐 대기 후 cancel 될 수 있음. → 검증용 수동 실행은 자연 cron 으로 대체하거나 시각 분리. (concurrency 구조 자체 수정 = 별 PR 후보, 이번엔 답습만)
  - **답습 자산 2 (부팅 환각)**: 세션 347 부팅 1차 진단이 Post-Processing run 을 "24시간 멈춘 좀비", incremental 을 "cron 미발화"로 단정 → `currentDate: 2026-05-31` 메타값만 믿고 시간 계산한 환각(실제 시스템 UTC = 5/30 20:23, run 은 54분째 정상 진행). 사용자 스크린샷 인터럽트로 `gh run cancel` 사고 차단. **날짜·시각 메타값 단정 금지, `date -u` 실측 의무**. + 실행 중 run cancel 은 사용자 확인 의무([[feedback_no_kill_without_confirm]]).

- ✅ **5% 경고 임계값 경험치 측정** (세션 169, 2026-05-03)
  - 측정 신호 1 (GitHub Actions): `gh run list --workflow=collect-applyhome.yml --limit=20` → schedule run 4회 모두 success, 5% 컷 발동 0건 (실패 1건은 Cloudflare 502 인프라 장애, 5% 무관)
  - 측정 신호 2 (DB 누적): `applyhome-zero-supply-ratio.mjs` → 1,263건 중 2건 (0.16%, 5% 의 1/30)
  - 결론: 임계값 5% 적절 (보수적). 거짓 양성 1주간 0건. 재측정 트리거 = 분기 1회 (2026-08-03) 또는 cron failure 발생 시 즉시
  - 박제: `MEMORY.md` `reference_applyhome_threshold.md`

- ✅ `@vercel/kv 3` — 패키지 자체 제거, `@upstash/redis@1.37.0` 단독 사용 (세션130, 커밋 `4a90768`)
- ✅ `@vercel/analytics 2` — 메이저 업그레이드 (세션119, 커밋 `22434c2`)
- ✅ Node 환경 핀 (engines + .nvmrc) — 세션125 커밋 `6520ec9`
- ✅ `@supabase/supabase-js` 2.98→2.103 마이너 — 세션119, 커밋 `73b3295`
- ✅ `admin/review.js:72` 이메일 RFC 5322 정규식 — 세션119, 공용 `isValidEmail()` 추출
- ✅ `App.jsx` 442→354줄 4훅 분리 — 세션120
- ✅ `api/supabase/apartments.js` sanitize() 7헬퍼 분리 — 세션119, 스냅샷 테스트 포함

---

## 🟢 여유 — 완료

- ✅ **React.memo comparator 일괄 점검** (세션 159~170 청산)
  - 본 작업 (AptCard 6필드 + 회귀 테스트 6건) — 세션 168 커밋 `d74b295`
  - 후속 점검 4파일 (CompareSheet / DetailModal / MapView / SelectedAptCard) — 세션 170 결론: **점검 대상 0건, 안전**
    - 4파일 모두 `memo()` 두 번째 인자(custom comparator) 없음 → React 기본 `Object.is` shallow 비교가 객체 참조 변경을 자동 감지
    - AptCard 회귀의 본질은 "comparator 가 있는데 필드 누락" 이므로 comparator 자체가 없는 4파일에서 재현 불가
  - 마감 사유: comparator 신설은 회귀 표면 신설 — 도입 ROI 0. comparator 가 정당화되는 조합은 (대량 리스트) + (nested object prop) 둘 다일 때만, 4파일에 둘 다 없음

- ✅ **E2E Playwright webkit 미설치 인프라 이슈** — 세션 162 청산
  - PR #4 (`927193e`) 에서 e2e.yml `--with-deps chromium webkit` + playwright.config.ts chromium project `grepInvert: /@mobile/` 추가
  - admin chromium 8건 fail 도 같은 PR 의 회귀 사고 fix (sessionStorage→localStorage 통일) 로 해결

- ✅ `LoanRatesSection:49` 금리 탭 Skeleton 보강 — 세션122
- ✅ `AdminDashboard` 로딩 UI — 세션122
- ✅ 저장 액션 토스트 피드백 4지점 — 세션121
- ✅ `AdminDashboard` 412줄 → 3분할 (StatsSection + UserCard + UserList) — 세션138
- ✅ `InfoPage.jsx` 267→60줄 4분할 (sections/info/) — 세션140
- ✅ `src/scoring/` JSDoc 시리즈 7파일 12식별자 — 세션122~124
- ✅ `prices.js` ↔ `unsold-history.js` 중복 → `createTimeseriesHandler` 팩토리 — 세션121
- ✅ `collect-building-hub.mjs` HpPermitService TODO 결정 — 세션139, 미구독 확정 + 코드 -61줄

---

## ⏸️ 의도적 보류 — ROI 미달로 진행 안 함 (해소 아님, 트리거 시 재오픈)

> `✅ 완료`(문제가 없어짐) 와 구분. 아래는 **문제는 남아 있으나 ROI 판단으로 진행
> 안 하기로 결정**한 항목. "할 일"이 아니라 "안 하기로 한 일". 세션264 BACKLOG
> "할 일" 절에서 분리.

- ⏸️ **`onClick={() => ...}` inline 클로저 → useCallback — 부분 처리 후 보류** (세션121 커밋 `1ed7db3`; 세션264 분리)
  - 처리분: ExpertDashboard + AdminDashboard 의 memo 자식 효과 확실한 6건 useCallback 안정화
  - **수치 주의**: `/improve` report 원본은 "131건"(src/components/\*\*), BACKLOG 항목 본문은 "75건" — 두 수치 출처 불일치, 어느 모집단인지 미확정. 세션264 실측 `grep "onClick={() =>"` = 72건 / `onClick=` 전체 = 143건
  - 보류 사유: 루프 내부·trivial 핸들러는 memo 자식 효과 없어 useCallback ROI 미달 — 의식적 배제
  - 재오픈 트리거: memo 자식 + nested prop 조합 신규 발생 시

- ⏸️ **inline `style={{...}}` 호이스팅 — 부분 처리 후 보류** (세션149~152; 세션264 분리)
  - 처리분: 5파일 호이스팅 (85→29, -66%). AptCard 모듈 상수 `S={...}` + `useMemo(dynStyles)` 적용
  - **수치 주의**: 세션149~152 시작 기준값 "787건". 세션264 실측 `src/components/` = 831건 / `src/` 전체 = 865건 — **787→831 은 잔여 감소 아님, 그 사이 컴포넌트 추가로 순증가**. "잔여 N건" 표현 쓰지 말 것
  - 보류 사유: 남은 대부분이 정적 trivial style — 호이스팅 ROI 미달
  - 재오픈 트리거: useDeferredValue 도입으로 dynStyles 패턴 변경 시

- ✅ **W6-D 어린이집 옵션 ε cpmsapi021 → regions.childcare JSONB 신규** (세션 252)
  - 자원: info.childcare.go.kr 보육정보공개 API cpmsapi021 (data.go.kr 15101155 한국사회보장정보원_전국 어린이집 정보 조회)
  - endpoint: `http://api.childcare.go.kr/mediate/rest/cpmsapi021/cpmsapi021/request`
  - 응답 7필드 XML (stcode/crname/crtel/crfax/craddr/crhome/crcapat) 시군구 집계, 256회/실행
  - 환각 정정 7건 (24필드→7 / JSON→XML / arcode 페이징 부재 / 256 시군구 / endpoint URL / 환경변수명 자가 결정 / crtelno→crtel)
  - 9 파일 (신규 5 + 수정 4). 검증: typecheck 0 / vitest 2731/2731 / audit 24/30 clean / dry-run HTTP 200 + 50 items
  - ⚠️ **후속 미완료**: cpmsapi021 응답 50 limit 사고 → BACKLOG.md 🔴 항목으로 잔존 (이 항목 완료 ≠ 50 limit 해결)

- ✅ **W6-D2 옵션 δ — cpmsapi030 70 필드 단지 매칭 (에픽 종료, 세션 252~258)**
  - 세션 258 마무리 (코드 변경 0건): `collect-nearby-childcare.mjs` 운영 1회 실행 → `schools.nearby_childcare` **32 단지 적재** (성공 32 / 실패 0, 2.1초)
  - 실 구현 = `schools.nearby_childcare` JSONB (마이그 `20260516090916_add_schools_nearby_childcare.sql`)
  - 데이터 흐름 실측: schools → apartments_flat VIEW → /api/supabase/apartments API 응답까지 강북구 9 단지 어린이집 5건 + 70필드 정상 전달. vitest 96 파일 1340/1340 pass
  - 좌표 제약: 전국 어린이집 23,122곳 중 좌표 보유 = 강북구 50곳뿐 (0.2%) → `collect-childcare-detail.yml` cron 매일 ~1000건 약 23일 누적 → `collect-nearby-childcare.yml` cron 매일 점진 확대
  - 자원: cpmsapi030 (어린이집별 기본정보 조회). 환경변수 `CHILDCARE_BASIC_API_KEY`
  - plan: `1-atomic-lightning.md` (세션 258) / `1-lucky-brook.md` (세션 257) / `claude-distributed-steele.md` (세션 253)

---

## 📦 KOSIS 추가 데이터 보강 — 완료분

- ✅ **#4 (新)주택보급률 (시도)** (세션 259, 2026-05-16)
  - 통계표 `DT_MLTM_2100` (orgId=116). 세션 237 에 collector·test·워크플로·data-fill 작성됐으나 마이그레이션 Dashboard 적용 누락으로 미동작 방치
  - 세션 259 가 마이그 `20260513044532_add_housing_supply_level.sql` Dashboard 적용 → `collect-housing-supply-ratio.mjs` 운영 1회 → `regions.housing_supply_level` 17 시도 76행 적재 (서울 93.9% ~ 경북 114.4%)
  - 코드 변경 0건 = docs only 커밋 `8f7db36`
  - 컬럼명은 `housing_supply_ratio` 아닌 `housing_supply_level` (supply_ratio = housing-permits 인허가 증가율과 의미 분리, 세션 237 박제)
  - 후속(별도 후보, 미진입): `apartments_flat` VIEW 노출 + `database.types.ts` 재생성 + scoring 통합
  - 진단 교훈: "collector·test·CI 전부 green ≠ 운영 동작" — 마이그 Dashboard 적용 누락 시 PG 42703. `project_session259_kosis_supply_ratio.md` 메모

- ❌ **#3 준공후 미분양 (시군구)** — 종결 (작업 불필요 확정, 세션 249, 2026-05-13)
  - v1 박제: "DT_MLTM_2086 시군구별 준공후 미분양 → regions.unsold_after_completion JSON 신규, 큰 작업 2~3 세션"
  - 세션 249 0단계 raw API 실측 (`objL1=ALL objL2=ALL prdSe=A`, 58 rows): C1_NM 이 `시도별미분양현황`/`부문별미분양현황`/`규모별미분양현황` 3 group 으로 **분리**. 시도 × 부문 교차 cell 부재 — `(준공후)` 는 부문별 그룹의 전국 단일값(C1 단일 코드)뿐
  - 결론: mibunyang 단지·시군구 단위와 본질 unmatched. 시군구별 준공후 미분양은 KOSIS 에 존재하지 않음
  - 답습: `.claude/rules/collectors/kosis-dimension-mismatch-guard.md` (통계표 차원 = 분리 group vs 교차 cell 판정, raw API sample 박제 의무)
  - 메모: `session_2026-05-13_session249_kosis_post_completion_demotion.md`

> KOSIS 20 후보 중 #3·#4 외 나머지 18건은 미진입 → [BACKLOG.md](BACKLOG.md) 📦 섹션 유지.

---

## 🟢 인프라·코드품질 (세션 272, 2026-05-19)

- ✅ **collect-trade-stats.yml cron 일요일 21시 concurrency 충돌** — fix (세션 272, 커밋 `608ca5c`)
  - 증상: collect-trade-stats schedule run 최근 6회 중 5 cancelled + 1 failure (한 번도 성공 못 함).
  - 원인 (raw 실측): `fill-missing-data.yml` 과 동일 cron `0 21 * * 0` + 같은 `data-collection` concurrency 그룹 → 큐 경합. cancelled run 의 `jobs` 빈 배열 = job 시작조차 못 하고 대기 중 취소.
  - fix: cron `0 21 * * 0` → `0 16 * * 0` (KST 일요일 새벽 01:00). 일요일 21~23시 fill/calc 무더기 시간대 완전 회피. 1줄 변경.
  - 박제 정정: NEXT_SESSION 제안 `30 22` 는 calc-layout 지연 발화(실측 23:44~23:53) 고려 시 여전히 겹침 → 빈 슬롯 `0 16` 선택.

- ✅ **SearchFilterBar `as any` 7건 제거 — PresetPanel 타입 정합** (세션 272, 커밋 `5b9fa44`)
  - 증상: `SearchFilterBar.tsx:148~154` 의 `as any` 7건 (+`SearchFilterBarProps` L44 `(_p: any)` 1건).
  - 원인: `PresetPanel` 이 자체 로컬 타입 `Preset`/`HistoryItem` 정의 → 호출부 `SearchFilterBar` 의 공유 타입 `FilterPreset`/`FilterHistoryEntry` 와 불일치 → `as any` 회피.
  - fix: PresetPanel 을 `@/types/hooks` 공유 타입으로 통일. `onApplyPreset` 인자는 실제 런타임값(`p.values` = `Record<string,string|boolean>`)에 맞춤.
  - 검증: typecheck 0 errors, vitest 2936 통과, build 성공. 시뮬레이션(백업→정정→측정→복원)으로 사전 검증.
  - 답습: Explore 에이전트가 `onApplyPreset: (FilterPreset)=>void` 오제안 → 본체 실측(`onApplyPreset(p.values)`)으로 정정. `SearchFilterBar.test.jsx` 가 "추천" 드롭다운 미오픈 → PresetPanel 동작 테스트 0건, 타입 회귀 가드는 tsc 만.

---

## 완료 답습 — 중복 플랜이 생기는 이유 (사고 카탈로그)

이 프로젝트에서 반복된 "이미 완료된 걸 모르고 다시 plan" 사고:

| 사고 | 원인 | 차단법 |
|---|---|---|
| 세션 231 collect-applyhome recordApiQuota "호출 0건" 환각 | 커밋 816664b fix 됐으나 BACKLOG 미갱신, audit 가설을 단정 근거로 사용 | 작업 진입 직전 본문 grep 1회 의무 |
| 세션 246 Naver Post 1주 지각 | 세션 229 c045594 해결 후 SESSION_LOG 만 갱신, BACKLOG drift | fix 박은 세션이 BACKLOG 동시 갱신 |
| 세션 244 KOSIS_MIGRATION_KEY 1개월 방치 | 세션 232 fix 후 BACKLOG 갱신 누락 | 동일 |

**규칙**: 완료 항목은 이 파일로 이동 + BACKLOG.md 상단 `## ✅ 완료된 일` 색인에 한 줄
추가. 다음 세션이 plan 작성 전 BACKLOG.md 색인 grep → 색인에 있으면 plan 금지, 상세는
이 파일 확인. fix 를 박은 세션이 그 자리에서 동시 갱신 (drift 0).

---

## 📜 NEXT_SESSION 산출 회고 (세션 274 이후 이동, 2026-05-20)

> NEXT_SESSION.md L60~85 에서 이동 (사용자 "아카이브로 분리" 요청 답습, 세션 277).
> SESSION_LOG.md 정식 박제까지 임시 보존. SESSION_LOG 세션 265~276 12 세션 미반영
> 상태이며, 박제 완료되면 본 절은 제거 가능.

### 세션 274 산출 (커밋 2ed66f7·c6863dc)

#### mibunyang 소유 3개 테이블 RLS 활성화

세션 273 이 "RLS Disabled 19개" 박제. 세션 274 가 `supabase db advisors --type security`
live 조회로 정정 — 실제 `rls_disabled_in_public` 16개. 그중 mibunyang 소유 3개만 해결:

- 신규 마이그 `supabase/migrations/20260519111101_enable_rls_mibunyang_owned.sql`
  + 롤백 `supabase/migrations/_rollbacks/20260519111101_rollback_enable_rls_mibunyang_owned.sql`
  (세션 277 직접 ls 실측 — Agent D 의 "디렉토리 부재" 보고는 환각, 정확 위치 = `supabase/migrations/_rollbacks/`)
- `api_quota_log`: RLS on + Public read + Service write
- `air_quality_stations`: RLS on + Service write only
- `collector_runs`: 기존 RLS on·정책0(20260517020124 부분 적용) → 정책 2개 보강
- `supabase/CLAUDE.md` "마이그레이션 적용" 절 — supabase CLI 단발 적용 방법 추가

검증: live 적용(`supabase db query --file`) + `BEGIN..ROLLBACK` 시뮬레이션 + anon JWT
회귀(api_quota_log 100행·collector_runs 31행 읽힘 = Public read 작동, air_quality_stations
0행 = 차단 의도대로) + collector dry-run + vitest 9/9. advisor 16→14.

#### 검증 중 발견 (cross-repo 실측 정정)

- 공유 3개(complexes/articles/complex_price_history)는 **naver-estate-web 소유**
  (`f:\cursor\naver-estate-web` 의 `V007`/`V001` 마이그). mibunyang 이 정책 만들면
  충돌 — 특히 `articles` 는 naver 가 `is_active=true` 숨김 의도. → 범위 5→3 축소.
- `.claude/BACKLOG.md` RLS 절·apartments.json 수치·어린이집 절 정정 (로컬, 커밋 안 함).

plan: `C:\Users\user\.claude\plans\claude-velvety-map.md`

---

## 세션 285 (2026-05-21) — regions 표기 충돌 root fix (커밋 `78a862d`)

세션 284 진단 다음 세션 작업 자리 완결. CI success (Population/Monitor/CI 3 워크플로 success).

**세 사고 통합 정정**:

1. parseGu() 자치구 정보 손실 — `[ctpvNm, sggNm].join(" ").split(/\s+/)[1]` (시도+시 단위로 잘림) → `parseGu(ctpvNm, sggNm)` 시그니처 (sggNm 그대로 박힘, population-sex-age.mjs v2 답습). 시도 단위 집계 `hasGuLevel` 플래그로 중복 차단.
2. SIDO_CODES 환각 3건 (2026-03-21 `09e25fef` ~ 2026-05-21 `78a862d`, 61일 누락):
   - 세종 `3600000000` → `3611000000`
   - 강원 `4200000000` → `5100000000`
   - 전북 `4500000000` → `5200000000`
3. 1행 응답 객체 처리 — `items.item` 객체/배열 양형 대응 (Array.isArray 가드 + 단일 객체일 때 `[items]` 변환).

**실측 효과**:

- regions 752 → 790 (+38 행)
- 자치구 (region, gu 공백) 행 pop_growth 채워진: 0 → 35 / 41
- 신규 시도 단위: 세종 391072 / 강원 1506843 / 전북 622915 (이전 NULL)

**잔여 사고** (다음 후속 박제 자리):

- 중복 행 (같은 region+gu 페어에 NULL 행 + 값 행 공존) — upsert 키 불일치 또는 잔재 행
- 화성시 4 자치구 행 (sex_age/crime_grade 보존용) 잔존
- 자매 SIDO_CODES drift 2건 (population-sex-age.mjs L26-31 + naver-presale.mjs L47 세종) — **세션 286 동시 fix** (별도 커밋 2건)

plan: 세션 284 진단 다음 세션 작업 자리
