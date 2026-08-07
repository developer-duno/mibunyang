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

- ✅ **랜딩 정적 JSON 슬림 + 상세 해시 버킷 — PR1·PR2 전부 완료, 라이브 검증 종결** (PR1 세션 468 / PR2 [#324](https://github.com/developer-duno/mibunyang/pull/324) 세션 495 / 잔여 관찰 실측 세션 496)
  - **완료(세션 468, PR1)**: 공유 빌더 `scripts/static-outputs.mjs`(slimCats·buildListData·buildDetailBuckets — collect-data/split 중복 제거) + list 슬림(catsCache subs 축소 + 상세필드 4개 제거) + 상세 해시 버킷 16개 `apartments-detail-16-{i}.json`(`src/utils/bucketHash.mjs` FNV-1a) + `staticDataApi.fetchApartmentDetail`(버킷 lazy·dedup·content-type 가드·FIFO 8) + DetailModal mergedApt/mergedRes 배선 + 4 collector split spawn 경로 버그 수정. **실측: list raw 15.2→5.92MB / br 1.37MB→361KB, 상세 fetch br 424KB→≤69KB.** 설계 원문 `docs/superpowers/specs/2026-07-03-landing-json-slim-bucket-design.md`
  - **완료(세션 495, PR2 #324 `fc8fd50`)**: `apartments-prices.json` 생성 중단(buildPricesData·writeOutputs·split) + `fetchApartmentPrices`/PriceArrays export·관련 테스트(staticDataApi.test.js prices describe·detail-modal-supabase-guard prices route) 정리 (−239줄). PR1 이 구 번들 세션 안전을 위해 유예했던 "1~2주 후 삭제" 조건 충족 후 실행.
  - **잔여 관찰 3건 전부 확인 (2026-08-07 세션 496 실측)**: ① daily-deploy `2026-08-07T00:07:59Z success` (#324 머지 08-06T23:24 직후 첫 run — 직전 08-06T18:28 failure 는 머지 이전 + GitHub Actions 대장애 건) ② production 버킷 라이브 = `apartments-detail-16-0.json` 954KB·`-15.json` 979KB 둘 다 `200 application/json` ③ 버킷·prices **git 미추적 확인** (`git ls-files public/data` = 6개, `detail-16`·`prices` 매칭 0). ⚠️ **prices 삭제 검증은 상태코드가 아니라 Content-Type 으로** — `/data/apartments-prices.json` 은 SPA rewrite 폴백 때문에 `200` 이지만 타입이 `text/html`(파일 부재), 대조군 `apartments-list.json` 은 `application/json` 6.9MB. 200 만 보고 "아직 있다" 로 오판하기 쉬운 자리(세션 495 박제 답습).
- ✅ **청약홈 매칭 회수 — 후보 쿼리 presale_stage 제약 제거 검증 완결** (세션 353~360 처방 → 세션 465 라이브 실증, 2026-07-03)
  - **세션 465 실측 종결**: `collector_runs` id=236 `applyhome-detail` 2026-06-13 03:49 UTC **success ok=934 fail=0** (43.4s, cron `30 2 13 * *` 자연 발화) — 세션 360 예측 "~916 rows" 대비 934 (+18 = 이후 신규 공고 자연 증가). `presale_schedule_official` 라이브 = **984 rows / 859 distinct apartments** (예측 916 rows / 810 distinct 초과 달성). 세션 360 처방(후보 쿼리 전체 apartments 확대)의 2.4배 회복(393→934 rows) 실증 확정. 이후 매월 13일 cron 이 자연 회귀 가드.
  - (이하 원문 보존 — 세션 360 진단·처방 기록)
  - **세션 359 진단 정정**: "정규화(LCS 한계)가 병목"은 세션 360 적대 검증(6-probe 워크플로 + 라이브 재측정 2회)으로 **데이터 반증**. 정규화 회수 효과 ~0건 (미매칭 384 중 정규화로 잡을 수 있는 건 ≤8건, 긴 단지명은 음차 1글자 차이여도 이미 sim 0.92 통과). 미매칭 384 중 **235(61%)는 임대/공공주택** = 청약홈 *분양* API 구조적 부재.
  - **진짜 진앙 (라이브 재측정 2회 확정)**: `collect-applyhome-detail.mjs:225` 매칭 후보를 `presale_stage NOT NULL`(728)로 제한 → 청약홈 공고 있는데 분양 단계 미태깅된 단지가 통째로 빠짐. 제약 제거 시 매칭 **393→916 rows / 344→810 distinct (+466 단지, 2.4배)**, 신규 483 중 482가 명백 분양(sim 1.0 정답, 임대 1건뿐).
  - **세션 360 PR 처리**: 후보 쿼리 전체 apartments 확대 + region 파싱 버그(`경기도 광주시`→광주광역시 오파싱) 동반 수정. 적재는 별도 테이블만(apartments base 불변, 미분양 보호). 회귀 가드 = vitest 3180 + typecheck 0 + region 버그 fixture 2건.
  - **잔여 검증 (P2) 경위**: 세션 360 dry-run AFTER 는 청약홈 odcloud `totalCount:0` 외부 일시장애로 이월 → 세션 370 라이브 실측 = odcloud 회복(getAPTLttotPblancDetail HTTP 200 totalCount 2777 / Mdl 14157) → 세션 465 가 6/13 cron 결과로 최종 종결 (본 항목).
  - 답습: 세션 355 LCS 폴백 + 세션 353 청약홈 매칭 개선 + **세션 360 = "정규화 진단이 적대 검증으로 반증, 진짜 진앙은 후보 쿼리 제약"** (이름 변형보다 후보 누락이 지배적 진앙). 메가단지 블록코드(D1-2BL) LCS 변별 약점은 별 항목.

- ✅ **6/5 collect-market-stats schedule run 검증 — 가설 확정 종결** (세션 282 등록 → 세션 463 실측, 2026-07-03)
  - 진입: lookback 24개월 적용(커밋 `b312d62`) 후 첫 schedule run = 6/5. 검증 자리 = run log 의 `분양가격지수: N건 응답, 17개 시도 매핑` + `[분양가격지수] DT_41401N_006 (M) 202406~202606 lookback=24개월` 출력 + conclusion=success.
  - **세션 463 실측 (gh run 직독)**: run 27041459499 (2026-06-05T21:38Z) conclusion=**success**. 로그 = `[분양가격지수] DT_41401N_006 (M) 202406~202606 lookback=24개월` + `분양가격지수: 1785건 응답, 17개 시도 매핑` + `96건 갱신` — 기대 출력 전부 정확 일치.
  - 직전 run 대조: 5/5(25402403763) failure + 4/5(24010032799) failure → b312d62 이후 첫 발화인 6/5 success = 처방이 사고를 해소했다는 실증. 이후 매월 5일 schedule 이 자연 회귀 가드.
  - 판정: 가설 확정 = 사고 단일 해결. fail 시 트리거로 걸어둔 "TLS handshake 별도 plan" 불필요 확정.
  - 참조: `~/.claude/plans/pwd-f-mibunyang-git-unified-starlight.md` v6 § 6/5 검증

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

---

## 세션 ~271 이하 완료 색인 (세션 439 감사 — BACKLOG 비대 정리로 이동)

- ✅ 미션 1 공개 API 보안 — rateLimit proxy + dompurify (세션119)
- ✅ KOSIS Phase 2-A tblId DT_1YL202001E → DT_MLTM_2082 fix (세션222, 커밋 `4c0ffc9`)
- ✅ Naver Post-Processing 90분 한계 해결 — D-2 split (세션229, 커밋 `c045594`)
- ❌ MOLIT_KEY 401 — 환각 정정, 운영 영향 0 (로컬 .env 만 영향)
- ❌ collect-market-stats KOSIS — 환각 정정, KOSIS 측 갱신 지연만 잔존
- ❌ api_quota 5일 침묵 — False Alarm 확정 (cron 무발화 정상 패턴)
- ❌ collect-applyhome recordApiQuota — 환각 정정, 커밋 `816664b` 이미 적용
- ✅ 5% 경고 임계값 경험치 측정 — 보수적 적절 (세션169)
- ✅ @vercel/kv 3 제거 + @upstash/redis 단독 (세션130, 커밋 `4a90768`)
- ✅ @vercel/analytics 2 메이저 업그레이드 (세션119, 커밋 `22434c2`)
- ✅ Node 환경 핀 engines + .nvmrc (세션125, 커밋 `6520ec9`)
- ✅ @supabase/supabase-js 2.98→2.103 (세션119, 커밋 `73b3295`)
- ✅ admin/review.js 이메일 RFC 5322 정규식 → isValidEmail() (세션119)
- ✅ App.jsx 442→354줄 4훅 분리 (세션120)
- ✅ api/supabase/apartments.js sanitize() 7헬퍼 분리 (세션119)
- ✅ React.memo comparator 일괄 점검 — AptCard 6필드 + 4파일 안전 확인 (세션159~170, 커밋 `d74b295`)
- ✅ E2E Playwright webkit 미설치 인프라 이슈 (세션162, PR #4 `927193e`)
- ✅ LoanRatesSection 금리 탭 Skeleton (세션122)
- ✅ AdminDashboard 로딩 UI (세션122)
- ✅ 저장 액션 토스트 피드백 4지점 (세션121)
- ✅ AdminDashboard 412줄 3분할 (세션138)
- ✅ InfoPage.jsx 267→60줄 4분할 (세션140)
- ✅ src/scoring/ JSDoc 7파일 12식별자 (세션122~124)
- ✅ prices.js ↔ unsold-history.js → createTimeseriesHandler 팩토리 (세션121)
- ✅ collect-building-hub.mjs HpPermitService 미구독 확정 (세션139)
- ✅ W6-D 어린이집 cpmsapi021 → regions.childcare JSONB (세션252)
- ✅ cpmsapi021 50건 한도 해소 — 개발계정 키 제약 확인 + 운영키 교체 후 재수집 (세션275, 커밋 `ea77f25`; count>50 0→368, 강남구 50→163)
- ✅ W6-D2 cpmsapi030 70필드 단지 매칭 — schools.nearby_childcare (세션252~258)
- ✅ KOSIS #4 (新)주택보급률 시도 → regions.housing_supply_level (세션259, 커밋 `8f7db36`)
- ❌ KOSIS #3 준공후 미분양 — 종결 (시군구 단위 unmatched 확정, 세션249)
- ✅ recordCollectorRun 미호출 8개 수집기 보강 (2026-05-17, 커밋 `10965d4`+`7ba94f3`)
- ✅ recordApiQuota dry-run 가드 + sbOverride 인자 (테스트 불가 해소) (세션268, 커밋 `787e036`+`a99c528`)
- ✅ KOSIS #1 매매가격지수 시군구 → market_stats_history.sale_price_index (세션269, 커밋 `2ccf094`~`694c533`; 117시군구×4분기 468행 적재)
- ✅ KOSIS #2 전세가격지수 시군구 → market_stats_history.jeonse_price_index (세션270; DT_30404_B013 동향조사, 154시군구×23개월 3565행 적재)
- ✅ KOSIS #5 합계출산율 시군구 → regions.fertility_rate (세션266, 커밋 `6524eea`; DT_1B81A17)
- ✅ KOSIS #11·#12 의료 의사/병상수 시군구 → regions.doctors_per_1k/hospital_beds_per_1k (세션267, 커밋 `9d625d5`; DT_1YL20981/DT_1YL20971 묶음 collect-medical-access.mjs)
- ✅ KOSIS Phase 3 시도 경제·교육 4지표 → regions 4컬럼 (세션271, 커밋 `6eba41b`; #6 GRDP INH_1C96_02 / #9 사교육비 DT_1PE105 / #10 사교육참여율 DT_1PE107 / #13 실업률 DT_1DA7104S 묶음 collect-regional-economy.mjs)

## 세션 462 감사 — BACKLOG 비대 정리로 이동 (2026-07-02)

> 세션 462: BACKLOG.md 134KB → 완료(✅) 항목 71건 이동(색인 오래된 세션<400 한 줄 + 카테고리 섹션 상세 블록). 활성 항목·최근 색인·폐기(❌) 결정은 BACKLOG 잔류.

- ✅ energy_grade 오염 정정 — kaptdEcnt(승강기대수) 에너지등급 오인 + 죽은 코드 제거 — 세션 358 (데이터 품질 점검 중 발견. `molit-building-info.mjs` 가 국토부 공동주택 상세 API 의 `kaptdEcnt`/`kaptdEcntp`[= 승강기 대수]를 에너지효율등급 1~7로 오인 → 우연히 1~7대 단지 358건 오저장 + 화면 "N등급" 거짓 표시. raw API 실측[값 0/5/8/21=등급 불가] + 적대검증 워크플로[7필드 전수 raw 검증 → 오인 3건/정상 4건]로 확정. 정정: 수집기 energy_grade + 건폐율/용적률[`kaptdBcRat`/`kaptdVlRat`=API 응답에 없는 죽은 코드, 실제는 네이버 `sync-naver-complex` 가 채움] 추출 제거 + DB 358건 NULL[`cleanup-energy-grade.mjs`] + `data-audit.mjs` PERMANENT_NULL 에 energyGrade 추가[worst-fields 오탐 제거]. 3관점 적대 리뷰 = 회귀 0/blocker 0/high 2 confirmed[PERMANENT_NULL·cleanup 커밋]. vitest molit 22/22 + data-audit 17/17 + scoring 164/164 + tsc 0. building 78.6%→77.1%[오염 제거 정직 하락]. 상세 = DB_QUALITY.md 2026-06-01 절. **잔여**: 승강기 대수 신규 수집은 활용처 불분명[스코어링·화면·DB 컬럼 0]이라 비권장.)
- ✅ `sync-naver-complex` articles/price 1000건 cap + 4회 fetch 통합 — 세션 356 (`.range(0,99999)` cap 4곳[area/trade_type/**complex_price_history**/floor] → `fetchAllPages` 전건 페이지네이션. 461,751행 중 0.2%만 읽던 데이터 정확성 사고. 추가로 같은 articles 전건을 4번 fetch 하던 비효율 → 8컬럼 1회 통합 fetch[allArticles, matchCache 직후] 로 4 Phase 공유. timeout 30→60. dry-run 실증 before 1000→after 461,466건/시세 25,941단지. vitest 46/46 + tsc 0 + 메모리 적대검증 34배 헤드룸. 박제값 정정 = 세션 355 "Phase4 cap/시세 누락" 오류. 상세 = 🔴 즉시 절)
- ✅ vitest 4 `environmentMatchGlobs` → `projects` 마이그레이션 — 세션 348 (vitest 4.1.6 dist 에 `environmentMatchGlobs` 0건 실측 = 완전 제거 → 지금까지 api/scripts 테스트가 **node 아닌 jsdom 에서 돌고 있었음**(브라우저 API 미사용이라 무사고). `// @ts-expect-error` 제거 + `test.projects` inline 2개(jsdom=src / node=api+scripts) + 공통 옵션 루트 유지 + 각 `extends: true`. 회귀 0 실측 = 전후 **672 파일 / 3146 케이스 / 100% / src 1563·api 387·scripts 1196 완전 동일** + typecheck 0 + `vitest list --project` 분기 확인. 워크플로 2관점 조사(공식 문서 + 함정) + 직접 실측 교차 검증. 상세 = [BACKLOG_ARCHIVE.md](BACKLOG_ARCHIVE.md))
- ✅ 5/29 자연 cron cancelled 모니터링 종결 + 진앙 정정 — 세션 347 (부팅 점검 실측: incremental 자연 cron 5/26·27·28 cancelled → **5/29 success(74분, all step success, 순수 자연 cron)** = 세션 338 PR #51 효과 확인. **진앙 정정** = 5/28 cancelled 는 BACKLOG 가 적은 "transport 105초 외부 cancel / 인프라 부하 가설"이 아니라, raw `gh api jobs` 실측 결과 **세션 342 검증용 manual dispatch(19:25~21:57, 2h31m)가 같은 concurrency 그룹(`naver-postprocess-incremental`, `cancel-in-progress:false`) 점유 → 자연 schedule run 44분 큐 대기 후 manual 종료 2초 뒤 cancel**. 답습 = 검증용 수동 실행은 자연 cron 시각(20:30 UTC)과 겹치지 않게. 부팅 1차 진단 "좀비 run" 은 `currentDate` 메타값 단정 환각(`date -u` 실측 의무). 상세 = [BACKLOG_ARCHIVE.md](BACKLOG_ARCHIVE.md))
- ✅ audit-env-keys collector→yml 역방향 매칭 재구성 — 세션 346 (P2 였던 "step 단위 보강" 진입 시 자가 점검 1 발동 결과 **더 근본적 사각지대 9건 실측 발견**: `findWorkflowForCollector` 1:1 매칭이 yml명≠collector명(transport-tago↔collect-transport 등) collector 9개를 **검증조차 안 하고 clean 오집계** = 세션 328 사고 진짜 근본 원인. `extractStepCollectorEnv()` 신규로 모든 yml step 의 collector 호출 역방향 수집 + multi-collector/1:N/env 상속 처리 + validate `${{ secrets.X }}` B형 정규식 통일. errorCount 0 유지(9개 전부 실측 누락 0) + 세션328/이름불일치 재현 시뮬 EXIT 1 검출 확인 + vitest 10/10. 상세 = [BACKLOG_ARCHIVE.md](BACKLOG_ARCHIVE.md))
- ✅ graceful shutdown 15 collector 일괄 보강 — 세션 329 PR-A + 330 PR-B + 337 PR-C 누적 머지로 완전 완료 (세션 341 실측 답습 결과 = `_graceful-coverage.test.mjs` 53/53 PASS 회귀 가드 박힘. BACKLOG L92 박제값 stale 환각 정정. 잔여 = `collect-maintenance` + `trade-stats-regions` 만 ALLOWLIST 박힘 별 진단 후보)
- ✅ monitor-collectors §5 schools stale_days 35→14 정정 (세션 339, NEIS 일일 발화 기준 + 세션 338 3주 사고 35일 한계 안에 묻혀 alert 0회 발화한 진앙 해소; `external-api-outage-policy.md` 동시 동기 + `collector-timeout-rootcause-analysis.md` 세션 338 절 신규)
- ✅ schools-neis 3주 cancelled root fix — 데이터 완결성 resume skip (`buildEnrichedIds` 헬퍼 export) + timeout 180→240 + 단위 테스트 6건 (세션 338, PR #51 머지 main `b76f6a9`; 5/22+5/26+5/27 3주 연속 cancelled 진앙 = NEIS 단지당 5.8초 12배 지연 + resume skip 패턴 부재. Plan v1+v2 환각 10건 검출 = 서브에이전트 3개 + DB 실측 교차 검증 패턴 답습 자산)
- ✅ Node 20/22 → 24 일괄 통일 — 47 workflow yml + `.nvmrc` (24.14.1) + `engines.node` (>=24.0.0) (세션 312 확인, 커밋 `3cc54d6` 2026-05-10 머지; GitHub Actions Node 20 deprecation 대응 완료, 메모만 stale 박힌 박제값을 본 PR 로 정정)
- ✅ trade-stats DSR batch fix — 직렬 for-loop 1960 row × 150ms = 4분 54초 → `createSemaphore(10)` + `Promise.all` 30초 + workflow timeout 15→30 (세션 309; 박힘 환각 7건 정정 — "9주+ 같은 원인" → 5/24 만 DSR + 5/17/5/10 옛 cron 큐 충돌 5/18 정정 완료; spec `docs/superpowers/specs/2026-05-25-trade-stats-dsr-batch-fix-design.md`)
- ✅ fill-missing-data Phase 3+4+5 폐기 + audit-fill-matrix CI 가드 (세션 308, PR #11 머지 main `7b6fc72`, 커밋 `58f5983`; dry-run run 26378950237 success 17분 40초; 5/31 cron 발화 6번째 누적 cancelled 차단, -108줄)
- ✅ regions 표기 충돌 root fix — population.mjs parseGu(ctpvNm, sggNm) + SIDO_CODES 3건 정정 (세종/강원/전북) + 1행 응답 객체 처리 (세션285, 커밋 `78a862d`; 자치구 채워진 0→35/41, 신규 시도 3개)
- ✅ MarketStatsCharts 평평한 0 차트 정정 — KOSIS 시도 단위 한계 → API 시도 폴백 + UI null 가드 + 헤더 "(시도 평균)" 표시 (세션280, 커밋 `29a6f01`/`7423fc9`; 동반 커밋 `0557e1a` DetailModal `priceByArea` 빈 배열 가드)
- ✅ apartments.json 13MB → list 1.66MB + prices 11.35MB lazy 분리 + Vercel Brotli 적용 (list 198KB / prices 858KB) (세션279, 커밋 `6714fa7`/`b57de6b`/`7eb2a2e`; spec `docs/superpowers/specs/2026-05-20-apartments-json-split-design.md`)
- ✅ Supabase Advisor security_definer_view·function_search_path_mutable 4건 — VIEW 2개 security_invoker=on + 함수 2개 search_path='' (세션276, 마이그 `20260519130000_fix_security_definer.sql`)
- ✅ 일요일 data-collection 큐 경합 해소 — calc 2개 calc-collection 그룹 분리 + fill-missing-data cron 21→02시·Phase5 timeout 360→120 + monitor 목록 3개 보강 (세션273, 커밋 `68c5051`)
- ✅ 테스트 미커버 hooks 5개 — useKeyboardShortcuts·useFinlifeRates·useKakaoCallbackEffect·useCollectorMonitoring·useAppNavigation 45 테스트 추가, 커버리지 23→28/28 (세션273, 커밋 `581ad1c`)
- ✅ lint react-hooks 경고 12건 해소 — ref useEffect 이동 + set-state-in-effect 룰 off (세션273, 커밋 `07fff78`)
- ✅ Kakao SDK `(window as any)` 9건 → kakaoMapHelpers getKakaoMaps 일원화 (세션273, 커밋 `c7c60b4`)
- ✅ collect-trade-stats.yml cron 일요일 21시 concurrency 충돌 fix (세션272, 커밋 `608ca5c`; `0 21 * * 0`→`0 16 * * 0`)
- ✅ SearchFilterBar `as any` 7건 제거 — PresetPanel 공유 타입 정합 (세션272, 커밋 `5b9fa44`)
- ✅ #4 컬럼별 NULL 비율 모니터 — data-audit 19 카테고리 (세션263, 커밋 `bfa3582`~`13c3ee2`; 세션264 키 drift 가드 `5a130af`/`bc5263f`)
- ✅ collect-migration.yml KOSIS_MIGRATION_KEY 3-way 동기화 fix (세션232, 커밋 `1bbf9b4`)
- ✅ package-lock.json @emnapi peer deps 누락 fix (세션180, 커밋 `cf2e5a5`)
- ✅ SESSION_LOG.md drift 282~286 + 288 6 세션 흡수 — 메모리 3 파일 + git commit message + BACKLOG 본문에서 추출 (세션289, 1 docs 커밋)
- ✅ transport-tago 2.1배 느림 root cause 분석 종결 — 코드/API 결함 0 + 세션 294 timeout 90→120 fix 가 정답 (세션 295, docs only; 진앙=커밋 `01d0dd4` PostgREST max_rows fix, 단지 1000→2001 의도된 자리)
- ✅ audit-env-keys matrix orchestrator 답습 보강 (세션 304+308, 커밋 `96fbdcc`+`58f5983`; MATRIX_ORCHESTRATORS 상수 + extractMatrixJobs() + js-yaml FAILSAFE_SCHEMA; vitest 4 test; fill-missing-data.yml Phase 3+4+5 폐기로 phase2-calc 3 job 만 잔존)
- ✅ dataUpdatedAt vs fetchedAt drift fix (세션 280/281/292, 커밋 `89831d7`+`a4c6d8d`; collect-data.mjs L1026 양쪽 키 동시 박제 + staticDataApi.ts L46-47 fallback 듀얼 방어; staticDataApi.test.js 회귀 가드 4건)
- ✅ ARCHITECTURE.md/CLAUDE.md/README.md 박제값 일괄 정정 (세션 313; apartments 1500→2001 / App.jsx→App.tsx 다중 / memo 36→45 / api 21→23 / workflows 35→47 / Vercel KV→Upstash Redis / collect-data 1065→1193줄 / src/lib/*Api 5건 stale 정정)
- ✅ 4 collector --json wrapper fix + split 자동 호출 (세션 314; environment/industry-match/transit-match/noxious 4 collector readFileSync wrapper 파싱 + writeFileSync `{...rawWrapper, data, count}` 보존 + spawnSync split-apartments-json 자동 호출. 진앙 = `apartments.json` nested `{ok, data, fetchedAt, dataUpdatedAt}` 구조를 flat array 로 단정한 4 collector 작성 시점 사고 → `.length` undefined + wrapper 손실 + split 0건 사고. 신규 테스트 2파일 7건 (environment.test.mjs 3 + split-apartments-json.test.mjs 4). 운영 cron 미사용 = 로컬 사고만 차단. 답습 자산 = `prebuild.mjs` L2/L11 spawnSync 패턴)
- ✅ KOSIS #14 범죄율 시도 collector 가설 환각 정정 (세션 315 docs only; regions.crime_grade 758행 중 701행 (92%) 이미 채워짐 = 시도 76 + 시군구 625. CSV 기반 `collect-crime-safety.mjs` 가 시도+시군구 모두 매칭. KOSIS DT_13501N_A120 신규 collector = 불필요. NULL 57행 진짜 잔여 = CSV 갱신 (연1회 수동) 또는 행정구역 개편 분구 18행 보강 별 자리. 자가 점검 1 + 서브에이전트 #3 보고로 박힘 정정)
- ✅ collector_runs 모니터링 사각지대 — 6 collector silent fail 종결 (세션 319 진단 + 세션 320 정정 + 세션 321 진앙 확정, PR #25 + #26 + #27; 진앙 = **workflow yml timeout 부족** 확정. 가설 K (race condition) 부정. 실증 = molit-building run 26451400957 정확히 30분 cancelled + maintenance run 26450043464 정확히 1h0m15s cancelled. raw log = 단지 처리 중간 끊김 → recordCollectorRun 도달 못함. 정정 5건: molit-building 30→90 / emergency 30→60 / kosis-unsold 15→30 / housing-permits 15→30 / maintenance 60→120. 다음 cron 자동 검증 6/1~6/15 박힘 의무)
- ✅ collector graceful shutdown 박힘 = timeout 근본 해결 (세션 321 PR #28 `4bfeaa9`; 사용자 제안 "시험 시간 다 되면 답안지 내고 나오기" 패턴. SIGTERM 받으면 loop 즉시 중단 + recordCollectorRun 호출 → collector_runs row 박힘 + status="partial". 8 파일 +58/-7. _shared.mjs createReporter 갱신 + setupGracefulShutdown export + types.ts Reporter interface + 6 collector main loop 1줄 박힘. vitest 140/140 pass. AWS Lambda/K8s/Heroku 표준. 데이터 자연 증가 대비 = timeout 늘리기 의무 0건)
- ✅ **통합 홈 production ON + 세션 413 실서비스 검증** — 세션 414 (코드 무변경, 검증+인프라). 사장님 "실서비스 검증 먼저" → Playwright 라이브(`mibunyang-peach.vercel.app`) **비로그인** 직접검증: 게이트 3경로[`?detail=ah-2020910001` URL직진입·곧분양→분양결과 카드클릭·지도탭클릭] 셋다 `role=dialog aria-label="로그인 안내"` 모달 실측 / analytics `/_vercel/insights/event` POST **200** + 페이로드 실측(`profile_change`). **통합 홈 OFF 발견**[라이브 list진입+home-grid부재+`vercel env ls production` VITE_FEATURE_HOME없음=OFF]. 사장님 "켜줘" → `printf true | vercel env add VITE_FEATURE_HOME production` + `vercel --prod --force --yes` 재배포(dpl_FMi1FVyVBz1mRNcq1wxwEkcju7cT READY·peach 자동alias). **ON 라이브 재검증**: home-grid 노출+nav "홈"탭(D4 5탭)+위젯3종[지도 D5잠금·곧분양·시장요약] + `home_widget_expand {widget:upcoming}` POST **200** 실측. **👤 사장님 잔여** = 지도 위치보존 3항목(로그인 필요)·`/api/consults 500` 확인·Vercel Analytics 대시보드 수신.

- ✅ **분양 탭 그래프·섹션 "보는 법" ? 도움말 + 확장 가능 HelpHint 패턴** — 세션 411 PR #112 (지역 시장 추이 그래프 5[평균분양가격·분양가격지수·신규공급·초기분양율·택지비율] + 섹션 2[청약경쟁·네이버분양정보] + 상단 안내 = ? 8개. 신규 `HelpHint.tsx`[`<HelpHint text label/>` 한 줄, Tooltip+IconHelp 재사용] + 카피 데이터구조 hint 필드[METRICS.hint·DataSection.hint] = 다른 탭은 hint만 채우면 자동 ?. Tooltip bare? prop + Escape stopPropagation 보강. **적대검증 개별 프로브 직독 교차로 카피 major 2 정정**[평균분양가 "평당"→"㎡당 천원" ~3.3배 왜곡·청약경쟁 "%"→"N:1 미달/미수집"] + 접근성 4[term 전달 동음해소·터치타깃]. vitest 3403[+8]·tsc 0·eslint 0)

- ✅ **다른 탭 ? 도움말 확장** — 세션 412 PR #113 `5e18aa7` (? 9개: 섹션 6[종합 단지기본·입지 생활인프라/교통/치안·시세 시장투자/네이버교차 = dataSections.ts hint 필드만 → DataSectionBlock:55 자동 렌더] + 차트 2[PriceChart·UnsoldChart 제목 옆 `<HelpHint text label/>`] + 적정가 괴리 1[DetailModal:248 행객체 hint?필드 + L256 조건부]). **카피 전부 직독 확정**[적정가괴리 "+면싸다" scorePrice:127·PIR "낮을수록좋음" scorePrice:150·순이동+=유입 fieldMeta:96·차트단위 만원/세대·지하철500m초록 dataSections:26]. 적대검증 9카피 major 0. **회귀=DataSectionBlock 테스트 대조군박제**[세션411 "교통상세 hint없음" 박제→교통상세 hint추가로 4테스트깨짐→무스코프 getByRole `{expanded:false}` + hint없는 섹션객체 직접주입 재설계]. vitest 3407[+4]·tsc 0·eslint 0·CI green.

- ✅ **상세 모달 IA 개편 — Progressive Disclosure D1~D3 전체 완결** (세션 406 사장님 지시 "너무 길고 루즈해" → 세션 407~410 4단계 종결)
  - spec = `docs/superpowers/specs/2026-06-13-detail-modal-progressive-disclosure.md` (C안 + D1~D3 추록 전부)
  - ✅ D1 (세션 407 PR #106 `321fd6e`) — 점프 앵커 → 콘텐츠 교체 탭. keepMounted·관리자 전 패널 마운트·CTA 공통 영역.
  - ✅ D2a (세션 408 PR #108) — DataSections 8섹션 해체·주제별 탭 재배분. 섹션별 접기 유지. 정보 소실 0.
  - ✅ D2b (세션 409 PR #109) — 종합 요약 대시보드(CategoryMiniCard 6, 레이더 대체) + 관리자 탭(sec-admin) 분리.
  - **✅ D3 (세션 410 PR #110 `ba9377c`)** = 탭 전환 페이드(panelStyle animation + FADE_KEYFRAMES + print CSS + reduced-motion) + ARIA tablist 정석 role=tab(패널 role=tabpanel·aria-controls isMounted 조건부·roving·화살표 automatic activation) + analytics(`detail_tab_view {tab,previous_tab}`). 적대검증 3+1라운드 = R3 loan-rates.spec 무스코프 tablist 누락·aria-controls dangling·화살표 스크롤 경합 + 구현물 관리자 로그아웃 빈화면 fallback. vitest 3391/tsc 0/eslint 0/build/e2e CI green.
  - **실서비스 수동검증 5항목 (jsdom 불가, 사장님)**: 페이드 실재 / reduced-motion 0 / 관리자 7패널 인쇄 잔류 0 / 화살표 연타 떨림 0 / axe-core ARIA 위반 0.
  - 후속 (D1 수용사항, 선택): 금융 훅 useRef→모듈 캐시 승격 / `loan-rates.spec` 커버리지 부활(로그인 mock+금융 칩 선행)

- ✅ **비로그인 게이트 일괄 차단** (세션 413 PR #114 `0b8a4d0`) — 사장님 결정 "닫자(일관)". 비로그인 손님이 게이트 없이 상세 직진입하던 3 구멍(`?detail=` URL 딥링크·지도 탭 MapView·분양결과/곧분양 UpcomingPage)을 전부 `App.tsx` `detail.handleOpenDetail`→`handleDetailGated` 통일. 이제 일반 목록과 동일하게 비로그인 시 LoginPromptModal 발화. "분양결과 ungated +645(45%)" 종결. 직독 교차로 잔존 우회 0 확인(setDetailAptId(null 닫기)·카카오 콜백 복원·UpcomingCardList L79/83/202 전부 수렴). 회귀=App.test ?detail= 게이트 갱신. vitest 3418·tsc 0·eslint 0·CI green

- ✅ **통합 홈 M3 — 지도 위치 보존 + analytics + 320px** (세션 413 PR #114 `0b8a4d0`) — 사장님 결정 "둘 다". setBounds 전국 리셋 억제(`didFitRef` 첫 마커 fit 1회, 이후 filtered 변경은 마커만)·center/level 연속성(App.tsx `mapViewportRef` lifted useRef + MapView `getViewport`/`onViewportChange` prop + idle 리스너, 탭 전환 간 보존)·home_* analytics(`home_widget_expand {widget}`·`home_detail_open`)·320px(`minmax(min(300px,100%),1fr)`). **적대검증 major 1 정정**: didFitRef 를 viewport 로 시드 안 함(false) — 부산 보다 경기 필터 바꾸고 재진입 시 빈 화면 방지(재마운트 항상 첫 fit, viewport 는 초기 center/level 만). 미니지도(MapEntryWidget)는 의도적 미연결(compact+idle 오염 회귀 방지). **미니지도 빈 상태 placeholder·320px 는 이미 구현됨**(세션 387/406, MapEntryWidget L68-73). 회귀=MapView.test 7+HomePage.test 4 신규. vitest 3418·tsc 0·eslint 0·CI green. **세션 414 실서비스 검증**: 게이트 3경로[?detail= URL·분양결과 카드·지도 탭 → 로그인 모달]·analytics[home_widget_expand 200 + 페이로드] = Playwright 라이브 실측 통과 / 지도 위치보존 3항목[팬줌후 필터변경 위치유지·탭전환후 center복원·필터크게바꾸고재진입 빈화면0]만 👤 사장님 수동검증 잔여(카카오 OAuth 로그인 필요, 자동화 불가)

- ✅ **KOSIS OpenAPI GitHub 러너 전면 불통 (6/9~) — 로컬 이전 + 6/12 첫 자연발화 success 실증으로 종결** (세션 393 진단 → 395 이전 → 403 실증)
  - **세션 403 최종 실증 (6/12 05:30 KST 자연 발화)**: `MibunyangKosisLocal` 정확 발화 + regional-economy collector_runs **success** + KOSIS API 4표 정상 응답(36/270/270/54건)·시도 17개 매칭. ok=0 은 **멱등 skip 정상**(collect-regional-economy.mjs L222-227 minDiff 임계 — 6/10 선행 적재 ok=17 과 값 동일). 스케줄러 LastTaskResult=0·NextRun 6/13. 세션 394 하드닝의 failure-행 검증은 실패 상황 자체가 발생하지 않아 미발동(정상)
  - **증거 (4연속 실측)**: fertility schedule 6/9 22:02Z fail + dispatch 6/10 12:53Z·12:56Z fail + **unsold-kosis dry-run 12:58Z fail** (2 collector, 다른 통계표, 저녁 시간대) — 전부 `KOSIS fetch failed` ~36초 (connection-level, fetchWithRetry 3회 소진). 같은 시각 **로컬(한국 IP) 동일 호출 3회 전부 성공** (768행 <1초).
  - **진단**: 시간대 장애창 아님 (세션 393 초기 가설 폐기). KOSIS 가 GitHub 러너(Azure 해외 데이터센터 IP) 대역 차단/불안정 추정 — KOSIS 포럼에 "IDC 대역 차단" 관행 언급, 공식 공지 부재 (2026-02-05 HTTP 폐지+분당 호출 제한 공지가 최근 강화 흐름). 마지막 러너 성공 = unsold 6/8 21:29Z → 차단 시작 6/8 밤~6/9 사이.
  - **과거 사고 재해석**: 4/1 unsold ECONNRESET + 5/5 market-stats TLS 단절 (새벽) = 동일 계열의 간헐 전조 가능.
  - **영향**: KOSIS 의존 cron 10개 (`grep -l KOSIS .github/workflows/*.yml`) 차례로 실패 예정 — 당장 regional-economy 11일·avg-income 12일·medical-access 13일·jeonse 17일. monitor checkFailedRuns 가 매번 텔레그램 알림 (6/9·6/10 발화 실증).
  - **6월 데이터 채움**: fertility 는 세션 393 로컬 실행으로 완결 (262건 갱신, collector_runs success). 타 KOSIS collector 도 cron 실패 시 로컬 실행으로 채움 가능 (한국 IP 정상).
  - **대응 옵션 (별 세션 결정)**: (a) 일시 차단이면 자연 회복 대기 + 실패 시 로컬 수동 채움 (b) 지속 시 KOSIS collector 들을 로컬 Windows 스케줄러로 이행 (네이버 수집 선례) (c) 러너에서 한국 경유 프록시 — 비권장.
  - ~~**회복 트리거**: 다음 KOSIS cron success 또는 `gh workflow run collect-unsold-kosis.yml -f dry_run=true` 재프로브 success.~~ → 세션 289 yml 삭제로 무효 (GH 복귀 계획 없음, 재프로브는 로컬 `node scripts/collectors/collect-unsold-kosis.mjs --dry-run`).
  - **→ 세션 289 종결 (옵션 b 실행)**: GH collect-*.yml 10개 삭제 + monitor 목록 10개 제거 + `EXTERNAL_API_COLLECTORS` 10종 등재 (collector_runs 신선도 "미발화" 분기 신설 + 연간 diff-only 수집기 ok=0·skip>0 outage 오탐 차단 + per-collector fetch 결함 fix) + 집서버 작업 `MibunyangKosisLocal` (매일 05:30 KST, `kosis-local-runner.mjs` 일자 디스패치). 수동 보충 = `node scripts/kosis-local-runner.mjs --date=YYYY-MM-DD`.
  - ~~부수 후보: fertility collector main try/finally 하드닝~~ → **세션 394 완료 (PR #97)**: 이번 주 실패 예정 4개 + fertility = **5개 collector try/catch/finally 하드닝** (fertility·regional-economy·medical-access·jeonse-price-index + avg-income 은 throw 시 `{ok:0,fail:0}` 가짜 빈 success 행 결함 동시 정정). 실패 시 `status=failure`+errorMessage 가 collector_runs 에 기록됨. **라이브 실증 = 6/12 새벽 KST regional-economy cron 실패 시 failure 행 1쿼리 확인**. 잔여 5개 (unsold·market-stats·sale-price-index·housing-supply-ratio 同 사각 + migration 同 avg-income quirk) = 다음 cron 7월이라 여유, 차단 지속 시 같은 패턴 후속.

- ✅ **childcare 수집기 3종 해외 IP fetch failed — 로컬 러너 이전 종결** (세션 398 코드 가드 + 세션 399 로컬 이전)
  - **사고**: `collect-childcare-detail` 이 GH 러너(해외 IP)에서 매일 04:00 발화 → `api.childcare.go.kr`(평문 HTTP) 세종 등 `fetch failed` 연쇄 → 정확히 60분 timeout cancelled. 텔레그램 "Childcare Detail 취소" 매일 발화(6/4·5·7·10·11) + Actions 60분 통째 낭비. raw 로그(run 27302018612): 세종 fetch failed ~36초 간격 연쇄, 60분(19:50→20:50) cancel. **로컬(한국 IP) 동일 stcode 직접 호출 = 200 OK 550ms 정상** = KOSIS 와 동일 해외 IP 차단 (외부 영구장애 아님).
  - **진앙 (코드)**: 실패 호출이 `processed` 카운터에 안 잡혀 DAILY_LIMIT 종료조건 영원히 미발동 + fetchWithRetry 가 fetch failed 를 30s×3 재시도 → 947 시군구 무한정 두드려 timeout.
  - **→ 코드 가드 완료 (세션 398, 커밋 `4e566c8`)**: `isNetworkError()` 헬퍼 + `attempted` 카운터(실패 포함 종료조건) + 시군구 circuit(연속 3 네트워크 실패→skip) + 전역 circuit(연속 5 시군구 전면차단→종료). 최악 전면차단 시 5×3×~36s≈9분 종료. 테스트 +5(15/15) + graceful 54/54 + tsc 0. **출혈(60분 낭비)만 멈춤 — 세종 데이터는 여전히 GH 에서 못 채움**.
  - **→ 로컬 이전 완료 (세션 399)**: `childcare-local-runner.mjs`(매일 3종 전부) + `.bat` + `register-childcare-task.ps1`(작업 `MibunyangChildcareLocal`, 매일 04:30 KST) + `childcare-local-runner.test.mjs`(5건). GH 정리 = `collect-childcare-detail.yml`·`collect-childcare-jeju.yml` 삭제 + `collect-childcare.yml` info step 제거(Kakao step 보존) + monitor-collectors.yml workflow_run 에서 Detail/Jeju name 제거 + `EXTERNAL_API_COLLECTORS` 3종 등재(stale_days 14). 이전 직후 즉시 운영 수집 1회 실증.
  - **조사 결론 (plan 단계 확정)**: info(cpmsapi021)/jeju(cpmsapi017)도 detail 과 **동일 endpoint `http://api.childcare.go.kr`** = 같은 해외 IP 차단. collect-childcare(Kakao `dapi.kakao.com`)·nearby-childcare(외부 API 없음, DB 가공)는 **해외 IP 안전 → GH 잔존**. KOSIS 러너와 **별도 러너**(KOSIS=월간 일자 디스패치 vs childcare=매일 전부, 스케줄 철학 다름 + 고장 격리). 사용자 결정 = info/jeju 도 "매월 말고 매일"(양 적어 부담 0). circuit breaker(세션 398)는 로컬 무해라 보존.
  - **세션 403 최종 실증 (6/12 04:30 KST 첫 자연 발화)**: 3종 전부 success — detail ok=4(쿼터 리셋 후 회복)·info 243·jeju 2, fail 0. 러너 로그 "3개 전부 성공"(깨진 한글 0) + LastTaskResult=0 + NextRun 6/13. 세션 400 CRLF fix 후 자연 발화 체인 완전 정상.

- ✅ **`sync-naver-complex` 30분 timeout 반복 cancelled 근본 정정** (세션 354 진단 → 세션 355 정정 + 종결)
  - **사고**: `fill-missing-data.yml` phase2-calc matrix step `sync-naver-complex` 가 매주 일요일 cron 에서 30분 timeout 도달 cancel 반복 (최근 10회 fill: cancelled 6 / failure 3 / success 1).
  - **세션 354 진앙 오진 정정 (세션 355 적대 검증)**: 세션 354 "직전 success 5/25 17분 vs 5/31 30분 = 데이터 증가 + 직렬 update 진앙"은 **부분 오진**. (1) 5/25 success 는 `--dry-run`(쓰기 0건)이었고 5/31 이 real 첫 실행 — 데이터 증가 아니라 dry-run vs real 차이. (2) 진짜 주 병목 = **`complex_links` 테이블 mibunyang DB 부재** (`PGRST205`). `matchApartments` 가 항상 이름 유사도 LCS 폴백 → complexes 63,535 × apartments 2,001 = 1억2716만 회 `stringSimilarity`(O(글자수²) DP) 를 Phase 1·4 에서 2번 반복 (dry-run 실측: Phase1 매칭 441초 + Phase4 매칭 398초 = 839초). 직렬 update 는 부차적(Phase3 ~251ms/건).
  - **정정 (세션 355, 방향 C)**: (1) **매칭 1회 계산 후 Map 재사용** (3패스→1패스, `complex_no → matched id[]` 캐시 + id 인덱스 룩업). (2) 직렬 update → `createSemaphore(10)` + BATCH=200 슬라이스 `Promise.all` (whole-array 금지 — matched pair 19,763 = trade-stats 10배라 critic 권고). timeout 30 유지(yml 무변경).
  - **실증 (dry-run)**: before 1048초(17.5분) → after 794초(13.2분). 매칭 통합 839→335초(−504초). real 추정 ~11분 << 30분.
  - **회귀 가드**: tsc -p tsconfig.scripts.json 0 + vitest 30/30 + graceful-coverage 54/54 + 적대 검증 워크플로 confirmed red 0.
  - 답습 자산: 세션 355 메모리 + plan `mibunyang-breezy-rainbow.md` + `collector-timeout-rootcause-analysis.md` §4-way (메모리 ≠ 진실의 원천 — 박제값 "데이터 증가"가 dry-run vs real 오진이었음 답습)

- ✅ **`sync-naver-complex` articles/price 1000건 cap + articles 4회 fetch 통합** (세션 355 발견 → 세션 356 정정 + 종결)
  - **사고 (박제값 정정)**: 세션 355 박제 "Phase 1/2/3/4 cap"은 **부분 오류**. 실측 = `.range(0,99999)` 단일 호출 cap = **4곳** (Phase1 area/direction L245 + Phase2 trade_type L388 + **Phase3-a complex_price_history L482** + Phase3-b floor L503). Phase4 maintenance(L640)는 이미 페이지네이션 정상(cap 아님). complex_price_history(시세)가 진짜 4번째 cap(세션 355 누락). PostgREST `max_rows=1000` 으로 articles 461,751행 중 **0.2%(1000건)**, price 338,141행 중 **0.3%** 만 읽어 전 단지 전용률·조망·일조·매물수·미분양율·시세·평균층수가 체계적 왜곡.
  - **정정 (세션 356, A+B 적대검증 워크플로)**: (A) `fetchAllPages` 헬퍼(전건 페이지네이션) 신설 + cap 4곳 정정. 추가로 같은 `articles eq(is_active,true)` 전건을 **4번 따로 fetch**(area/trade_type/floor/maintenance)하던 비효율을 발견 → **8컬럼 1회 통합 fetch**(`allArticles`, matchCache 직후)로 4 Phase 공유. (B) `fill-missing-data.yml` phase2-calc timeout 30→60 (articles 1.5배 성장 마진).
  - **실증 (dry-run v1 cap만 vs v2 통합)**: before 1000 → after **461,466건** (461배). 시세 **25,941개 단지**(이전 극소수). 통합 후 dry-run **28분 → 10분15초 (64%↓)**. 고정 5수치 동일 재현(시세 25,941 / Phase3 1,987 완전 일치, 나머지는 articles 실시간 변동 ±0.1%). peak RSS **248MB**(워크플로 적대검증 retained 91MB와 일치 — v1 "1.2GB"는 무관한 별 node 프로세스 오인 정정).
  - **회귀 가드**: fetchAllPages 6 테스트 + 통합 컬럼 가드 10 테스트(8컬럼 누락 차단) + vitest 46/46 + tsc 0. 메모리 적대검증 = V8 limit 4496MB / 8컬럼 460,986행 retained 91MB / 34배 헤드룸.
  - 답습 자산: 세션 356 메모리 + plan `mibunyang-tidy-hare.md` + 적대검증 워크플로 (메모리≠진실의원천 — 박제값 "Phase4 cap / 시세 누락" 정정)
  - **잔여 (별 자리)**: `complex_links` `.range(0,49999)` 미래 cap — 현재 테이블 부재(PGRST205) 0건, 채워지면 1000건 cap. heating fetch(L211, `.not(heating_type null)`)는 다른 필터라 통합 제외(heating_type 0건이라 무관).

- ✅ **NEIS_KEY / SCHOOLINFO_KEY 미설정 사고** (세션 327 발견 → 세션 328 종결, PR #31)
  - 진단 결과 = `collect-naver-listings-incremental.yml` Collect schools step env block 누락 (Secrets 등록 ✅, schools-neis.mjs 코드 ✅, 월간 collect-schools.yml ✅)
  - 정정 = incremental yml step env block 에 NEIS_KEY + SCHOOLINFO_KEY 2 줄 박힘 (`47a1a59`)
  - 자가 점검 1 = Explore Agent #1 정확 (Secrets ✅ + yml 누락 ❌) vs Agent #2 환각 (Secrets 미등록 ❌). 직접 `gh secret list` 답습 의무 정착
  - 검증 = 5/28 KST 05:30 자연 cron raw log "⚠️ ... 미설정" 0건 답습 의무
  - 답습 자산: `.claude/rules/workflows/secret-naming-audit.md` §"yml validate step 의무화" + 보조 BACKLOG 박힘 (audit-env-keys.mjs step 단위 검증 보강 P2)

- ✅ **scripts/CLAUDE.md 테스트 수 박제값 stale — 종결** (세션 344 발견 → 세션 345 정정)
  - 세션 344 박제 "stale 3건"은 과소. 실측 = **표 42행 나열 / 실제 55개 파일** (13개 누락) + 다수 수치 stale + `isCLI 34개 → 57개`
  - 세션 345 전수 정정: 표 → 55행 / **1017 케이스** (vitest 실측). isCLI 박제값 34 → 57. 측정 명령 박힘 (미래 stale 방지)
  - 답습 2중: (1) BACKLOG 박제값("3건") ≠ 실측 (2) **grep 카운트(931) ≠ vitest 실행 수(1017)** — grep 은 동적 생성 `it()` 못 셈 (`_graceful-coverage` ALLOWLIST 루프 grep 2 → vitest 53). 진실의 원천 = vitest `--reporter=json`

- ✅ **13:35~13:36 cancelled 5건 (7~8초) 진단 — 종결** (세션 327 발견 → 세션 344 종결)
  - 5/26 13:35:58 ~ 13:36:08 workflow_dispatch 5건 = Emergency / Police / KOSIS Unsold / Housing Permits / Building Info
  - raw 실측: 앞 4건 (Emergency/Police/KOSIS/Housing Permits) = jobs=0 + 7~8초 cancel, triggering_actor=developer-duno (사람), 모두 `data-collection` concurrency 그룹 + `cancel-in-progress: false`. 동시 dispatch 후 **수동 cancel** (concurrency supersede 아님 — pending 슬롯은 새 run 도착 시 직전 것 cancel)
  - 5번째 building-info 는 별개 사고로 분리 (아래 신규 P1)

- ✅ **building-info 매월 10일 cron 30분 반복 cancel 진단 — 종결** (세션 344 발견 → 세션 345 종결)
  - **진앙 = 옛날 `timeout-minutes: 30`** (이미 PR #26 커밋 `0a9cbd1`, 2026-05-26 14:58 UTC 에서 90 으로 정정 완료). 세션 344 박제 "외부 cancel / 진앙 미확정"은 **이 커밋을 누락한 오진**
  - 교차 검증 (세션 345, 멀티 에이전트 4-way + git 직접): cancelled run 3건 모두 `0a9cbd1` 이전 생성 → 옛날 30분 timeout 에 걸린 것. (4/10 16:47 UTC / 5/10 16:51 UTC / 5/26 13:36 UTC — 전부 커밋 14:58 UTC 이전)
  - collect step 런타임 일관 (1793~1800초 ≈ 30분 정각) = 작업량 변동이 아니라 **고정 timeout 경계**. `gh run list --status timed_out` 0건은 옛 버전이 SIGKILL grace 0 으로 cancelled 로 기록됐기 때문 (`graceful-shutdown-coverage.md` 답습)
  - 5/11·4/11 fallback success = 토요일 skip 경로 (실제 수집 0건). 10일이 일/금이라 fallback 미작동 → 그 달 수집이 사실상 누락됐던 것
  - **잔여 모니터링 (P2, 신규)**: 90분이 충분한지 미검증. 다음 정기 cron = **6/10** 이 첫 full schedule 검증. 2,000+ 단지를 90분 내 완수하는지 `collector_runs` (status=success + ok_count) 로 확인. 초과 시 timeout 추가 상향 또는 단지 chunk 분할 검토

- ✅ **monitor-collectors 알림 9건 누적 사고** (세션 326 발견 → 세션 327 종결, docs only)
  - 답습 결과 = monitor 정상 작동 (9개 사고 즉시 감지 결과). 알림 9건 = 사고 아닌 정상 감지
  - 진앙 4종 분리: (1) housing-permits success 0건 = MOLIT API 500 외부 사고 (세션 323 v3 답습) (2) Naver cancelled = transport-tago 자연 변동 ±10% × timeout 120m 부족 → 180m 정정 (3) maintenance + building-info cancelled = graceful break 0 = 18 collector 패턴 사고 (4) 13:35~13:36 5건 = 세션 344 종결 (4건 수동 cancel + building-info 30분 별 P1)
  - 본 세션 정정 4건: Naver yml timeout 180 + transport-tago/infra-kakao/schools-neis break 박힘 + _shared.test.mjs SIGTERM mock 4건 + 신규 rule `graceful-shutdown-coverage.md`
  - 답습 자산: 세션 327 plan v3 (자가 점검 1 v2/v3 발동 후 환각 9건 정정)

- ✅ **제주 어린이집 미수집 — cpmsapi017 collector 신설 (세션 325)**
  - 세션 275 발견 + 세션 276 진단 정정 + 세션 325 해결
  - 신규: `scripts/collectors/childcare-info-jeju.mjs` (cpmsapi017, data.go.kr 15101201)
  - 신규: `scripts/collectors/childcare-info-jeju.test.mjs` (vitest 9 test)
  - 신규: `.github/workflows/collect-childcare-jeju.yml` (월 1일 KST 06:00 cron)
  - 등재: `data-fill.mjs` regions phase 1 + `monitor-collectors.yml` workflows
  - 박제: `CHILDCARE_JEJU_KEY` 환경변수 (`.env.example` + `ENV_VARS.md`)
  - arcode 체계 환각 정정: BACKLOG L111 "50110/50130 (법정동 코드)" 박제값 = cpmsapi021
    체계. cpmsapi017 은 **49xxx 독립 체계** (제주시 49110 / 서귀포시 49130, raw 실측 박힘)
  - 운영 검증 (개발키): 제주시 50건/3,472정원 + 서귀포시 50건/3,688정원, 6 row UPDATE 박힘
  - 운영키 발급 후 (data.go.kr 승인심의 1~3일): GitHub Secret 박제 + workflow_dispatch
    재실행 → 전수 응답 (1000+ 행 추정) 갱신 의무

- ✅ **backfill-presale-prices.mjs today() 통일 완료** (세션 419 부산물 → 세션 421 해소) — `new Date().toISOString().slice(0,10)`(UTC) → `today()`(KST 고정, `_shared.mjs`) 통일. 로컬 변수 `today`→`recordedDate` 개명(헬퍼명 충돌 회피), import에 `today` 추가(L16/44/53/57). prices 형제 writer(naver-presale)와 recorded_at 시간축 일치. dry-run 실증 recorded_at=오늘 KST·tsc:scripts 0. **일회성 수동 도구(cron 0건)라 실해는 0, 일관성용**
- ✅ **expertToken 키·useExpertMode 명칭 정리** — 세션 426 (PR #129, main d0eed91). 세션 405 의도적 보류 해소. 위 완료 색인 참조.

- ✅ **비로그인 블라인드 정책 기존 구멍 2건 — 둘 다 해소** (세션 403 적대검증 부산물)
  - DetailModal ungated 진입(`?detail=` 딥링크 + UpcomingPage 상세) → **세션 413 해소**: 모든 상세 진입이 `handleDetailGated` 수렴(비로그인 시 LoginPromptModal). 세션 414 라이브 3경로 모달 검증.
  - AptCard 점수 계열 누설(Bar aria-valuenow·width% + "안전 N등급") → **세션 420 해소** (위 L276 항목, PR #123).
  - 출처: 통합 홈 IA spec 적대검증(8프로브×2라운드) blind-policy 프로브 — `docs/superpowers/specs/2026-06-11-unified-home-ia-design.md` §9

- ✅ **적정가 괴리(deviation) 부호 표기 역방향 불일치 2건 정정 완료** — 세션 411 (세션 409 D2b 적대검증 부산물 발굴 → 본 세션 해소)
  - 진실의 원천 = `scorePrice.ts:127` `dev = (fairPrice - price)/fairPrice*100` → **양수 = 분양가가 적정가보다 쌈(저렴)**. 정합 측 = DetailModal 핵심지표 L248(`>0 → 녹색=좋음`) + FAQSection.tsx L19 + catVerdict.ts:31-32 + subContext.ts:17.
  - **정정 2곳**: ① `AptCard.tsx:109` `< 0`→`> 0` + 표시 `주변대비 +{Math.round}% 저렴`(양수=저렴만 녹색 강조, L108 할인 배지 패턴 답습) ② `GuideSections.tsx:105` 카피 "+면 시세보다 저렴, -면 비쌈"으로 좌우 교체.
  - 회귀 가드 = AptCard.test.jsx 신규 4건(양수→배지/음수→미표시/null→미표시/"0.0" 데이터부재→미표시). vitest 3395(206파일, +4)·tsc 0·eslint 0. 적대검증 워크플로 5프로브 major 0(부호 방향 전원 정합).
  - 점수·정렬·엔진 무변경(표현 계층만, deviation 값 불변) — 프론트 번들 배포로 즉시 반영.

- ✅ **deviation 음수(비쌈) 카드 배지 + 비로그인 점수 계열 블라인드 정합 완료** — 세션 420 (세션 411 분리 → 한 묶음 해소, PR #123 `e9ef544`)
  - A: 음수 deviation 단지에 빨강 `주변대비 N% 비쌈` 배지(저렴 초록 배지 대칭). `AptCard.tsx:110` 인라인 span(`C.redLight/C.red`), `Math.abs(Math.round(...))`. 양수/null/"0.0"과 상호배타.
  - C: 비로그인 점수 계열 2곳 차단 — ① 카테고리 점수바 Bar(L95) → 비로그인 시 회색 `aria-hidden` placeholder div(종합 ScoreBadge `??` div 답습, Bar 컴포넌트 불변=타 5소비처 영향 0) ② "안전 N등급"(L107) → `안전 ?등급` 글자 치환. 적정가·입지·deviation 배지는 점수 아님 → 유지(사장님 결정).
  - 회귀 가드 = AptCard.test.jsx +4(음수→비쌈[기존 "음수 미표시" 대조군 함정 `/주변대비/`→`/저렴/` 정정]·양수 상호배타·비로그인 progressbar 부재·안전 ?등급). vitest 3481(210파일,+4)·tsc 0·eslint 0·vite build 0. 표현 계층만(점수·정렬·엔진 불변).
  - 설계: `docs/superpowers/specs/2026-06-15-deviation-badge-and-blind-policy-design.md`

- ✅ **루트 CLAUDE.md 박제값 stale 2건 정정 완료** (세션 403 적대검증 실측 → 같은 세션 마무리에서 즉시 정정): "11 spec"→13 / "index 172KB"→~185KB

- ✅ **housing-permits regions UPDATE 동종 버그 — id PK 최신행만 UPDATE 선제 수정** (세션 367 발견 → 세션 368 PR)
  - `housing-permits.mjs` `.eq("region").is("gu",null).order(recorded_at).limit(1)` = PostgREST PATCH 가 order/limit 무시 → 같은 시도 전체 스냅샷 UPDATE 버그였음. `pickLatestRegionId` (export, 인라인 독립 구현 — childcare PR #76 패턴 답습, trade-stats import 사이드이펙트 회피) 로 시도별 최신행 id 추려 `.eq("id", latestId)` 로 좁힘. 회귀 테스트 5건 + 실 DB 실증(서울 5스냅샷 중 id=36@2026-03-20 최신만 선택 확인).
  - 선제 수정 근거: 현재 supply_ratio 0건(MOLIT API 500 장기 사고)이라 미발동이나, **API 복구 시 과거 시계열 영구 오염 차단** + "최신 1건만" 의도를 코드에 정확히 표현(거짓 안전 `.order().limit(1)` 제거). 화면 영향은 `latest_regions` VIEW(최신행)라 전후 0.
- ✅ **regions.childcare 좌표 톱니 구조 — merge 보존으로 차단 (세션 367 발견 → 세션 370 PR)**
  - 진단: `childcare-detail` 매일 04:00 좌표(la/lo) ~23일 누적 보강 → `collect-nearby-childcare` 05:30 회수→schools 적재 → **`childcare-info` 가 발화할 때마다(월간 cron + 수동 dispatch, 5/19·5/26·6/01·6/02 실측) facilities 를 7필드(좌표 없음)로 덮어써 좌표 전멸** = 톱니 패턴. nearby ok_count 5/25=484→5/26=115→6/01=423→6/02=100 붕괴 실증.
  - 세션 367 PR(#76)은 "최신행 1개만" 덮도록 좁혔으나 최신행 좌표는 여전히 매번 전멸(최신행 좌표 0/246키 실측). **세션 370 = 옵션 (a) 채택**: `mergePreserveCoords(newAgg, prevChildcare)` 헬퍼 신규(childcare-info.mjs export, jeju import) — UPDATE 직전 기존 최신행 facility 의 좌표/70필드를 stcode 기준 보존, 7필드만 신규 갱신. count/total_capacity/fetched_at 는 신규 집계값. info + jeju 양쪽 동시 적용(자매 동종 버그). 단위 테스트 5건 + 실 DB merge 실증(경기 과천시 좌표 58개 전수 보존). 화면(NearbyChildcareSection)·scoring 경로 불변, JSONB 스키마 불변.
  - 효과: 최신행이 항상 좌표 보유 → nearby 매칭이 매번 100 붕괴 없이 590+ 유지 + detail ~23일 재축적이 리셋되지 않아 좌표 커버리지 단조 증가. 사후 검증 = 머지 후 다음 info 발화 시 최신행 좌표 보유율 0%→상승(다음 세션 cron 관측).

- ✅ **collect-avg-income.mjs recorded_at 매칭 키 fix 완료** (세션 284 진단·정정)
  - 세션 283 가설 "의심도 낮음" 박제 = 환각, 실제로는 사고 확정
  - L191-195 UPDATE 매칭 키 `(region, gu=null)` → recorded_at 누락 → 매월 덮어쓰기
  - 정정: aggregateIncomeRows entries 에 `recorded_at: ${period}-01-01` 추가 + UPDATE-or-INSERT (population.mjs L237-261 답습)
  - vitest 19→20 (recorded_at 회귀 가드 1건 신규)
  - 매년 KOSIS 공표 시 신규 행 INSERT, 기존 행 보존 효과

- ✅ **CHILDCARE_API_KEY 운영계정 키 응답 확인** (세션 284 진단, 세션 283 박제값 stale 정정)
  - 세션 283 박제 ("NOT NULL 50건만") = stale. 세션 284 실측 = **606/770 (78.7%)**, 서울 강남구 163 facilities 박제 (50 한도 초과 = 운영키 응답 명백)
  - 운영키 갱신 자리 이미 완료 자리 (시점 불명, 다음 세션 진단 자리)
  - 잔여 사고 자리는 아래 🟡 신규 항목 (이름 표기 충돌)으로 이관

- ✅ **regions 18 비법정 자치구 행 DELETE 완료** (세션 284)
  - 정리 대상: 용인 3 + 창원 5 + 포항 2 + 전주 2 + 천안 2 + 청주 4 (총 18 행, recorded_at=2026-01)
  - 화성시 4 (효행/만세/동탄/병점, recorded_at=2026-03) 보존 — sex_age JSONB + crime_grade=4 자치구 단위 데이터
  - 정리 후: regions 770→752, unique 시군구 302→284, childcare NULL 58→40
  - 사후 검증: 표준 화성시 단일 행 (id=1332, 2026-03-01) 에 sex_age+crime_grade=3 별도 박제 자리 확인됨

- ✅ **collect-childcare 5/1 schedule run failure 정정** (세션 283 commit, 6/1 검증 대기)
  - 사고 A: 만강아파트 1건 Supabase statement timeout → exit 1 (raw log `gh run view 25232444155`)
  - 사고 B: Step 1 fail 시 Step 2 (시군구 집계) skip
  - 정정 A: `collect-childcare.mjs` Supabase upsert retry 2회 + 1% 임계값 (1건 fail 도 전체 fail 차단)
  - 정정 B: `collect-childcare.yml` Step 2 `if: always()` 추가
  - 검증: 6/1 schedule run conclusion=success + Step 2 시군구 집계 실행 박제 (다음 세션)

- ✅ **regions.jeonse_rate 0% → 22.2% — 채움 collector 신규 (세션 324 PR #29 머지)**
  - 세션 323 환각 = "orphan 가능성" → 세션 324 실측 폐기 (naver-estate-web cross-repo 4 위치 활성 사용)
  - 정정 = `scripts/collectors/trade-stats-regions.mjs` 신규 (trade-stats.mjs 산식 시군구 단위 집계, 표본 ≥ 3 게이트)
  - 운영 검증 = workflow_dispatch run 26471102001 success → 168/758 (22.2%) 박힘
  - 잔여 590 시군구 = 표본 부족 (jeonse 거래 < 3) 농어촌 자리 자연 NULL

- ✅ **DetailModal L82~85 Supabase 가드 환각** (세션 280 동반 커밋 `0557e1a` 정정 완료, 세션 283 stale drift 발견)
  - `0557e1a fix(detail): 가격배열 fetch 가드 정정 (undefined/null/배열 skip)` (MarketStatsCharts 작업 동반)
  - 현 본문 L87 `null || Array.isArray` → skip + L90 `!== undefined` → skip + undefined 만 fetch 발동
  - BACKLOG 박제값이 1주+ stale 자리 (`feedback_memory_not_authoritative.md` 답습)

- ✅ **입주 빠른순 정렬 — 세션 424 완료 (PR #127, main 47517a9)** — 세션 423 보류 해소. 위 완료 색인 참조. **보류 시 우려했던 "과거 완공 상단 점령" 함정을 사장님 결정 "지금 들어갈 집 먼저"로 역이용**: 준공완료(=즉시입주 가능한 미분양)를 오히려 rank0 최상단에 둠. 적대검증 4에이전트가 1차설계(미래예정 먼저)의 라벨↔동작 충돌 반증 → 재설계. comparator `/^\d{6}$/` 정규식으로 "미정" 36건+null 일관 맨뒤 처리(보류 시 우려한 "미정 가드"). 표현계층만(점수·엔진 무변경).

- ✅ **fill-missing-data.yml 개명** (`backfill-new-apartments.yml`) + `monitor-collectors.yml` `workflow_run.workflows` 동기화 (세션 453, 동작 보존) — `name: Fill Missing Data → Backfill New Apartments` + workflow_run 매칭 동기화(파일명 아닌 name 으로 매칭) + audit-env-keys.mjs/audit-fill-matrix.mjs 경로 갱신. spec `2026-05-25-fill-missing-data-redesign.md` Phase 3 완결

- ✅ **코드 단순화 4건 + naver-listings 죽은코드 제거** (세션 456, PR #199, main `9f6e183`, 동작 100% 보존) — AI 49 에이전트 전수 코드 냄새 진단(SAFE 7/RISKY 22/FALSE 16) 후 안전 정리만. **A** naver-listings.mjs 로컬 중복 `sleep` 제거→`_shared` import 통일 / **B** kakao/infra.ts `keys`·`defaults` 별도배열→`[{key,fallback}]` 객체배열 짝 보장 / **C** SearchFilterBar undo/redo 버튼 인라인스타일 중복→`undoRedoBtnStyle` 헬퍼 / **D** AptCard 추천이유 3중삼항→if-else 평탄화 / **F** naver-listings 죽은코드 제거(`getComplexDetail`·`NAVER_COMPLEX_API`·미사용 `sb`·import). **검증** vitest 3777 변경전후 동일·typecheck0·lint0·build0·infra esbuild0·CI/e2e/Vercel green. **보류** E(useDataPipeline matcher 분리)=현재 명확+의도된 leave-one-out 성능패턴(과한 단순화 경계). 사고 1건=CI format:check 누락(회귀가드에 미포함→정정, [[format-check-in-guard]] 메모). 동작·점수·DB 무변경.

- ✅ **register-naver-task.ps1 과잉 권한 정리 — `Highest` → `Limited` 코드 적용** (세션 359 발견 → 세션 368 PR)
  - `scripts/register-naver-task.ps1` 이 네이버 로컬 수집 스케줄러를 관리자 상승 토큰(`-RunLevel Highest`)으로 등록하던 것을 `New-ScheduledTaskPrincipal -LogonType Interactive -RunLevel Limited` 로 변경. 6단계 수집(HTTP fetch + Supabase upsert + 산술)은 일반 권한으로 충분 = 최소 권한 원칙 충족.
  - 실증 근거: 같은 PC 의 `naver-units-night` + `LuxuryResale_*` 작업 9개가 이미 Interactive+Limited 로 정상 동작 중(`Get-ScheduledTask` 실측). 네이버 수집은 한국 IP 로컬 PC 가 켜져 있어야만 의미 → 무인 부팅 실행 요건 없음 = Interactive 트레이드오프 무해. 추가 실측: `MibunyangNaverCollect` 작업이 현재 미등록 상태라 코드 변경이 운영에 즉시 영향 0(다음 등록부터 적용).
  - **👤 재등록은 사용자가 관리자 PowerShell 에서 1회 실행**: `powershell -ExecutionPolicy Bypass -File scripts\register-naver-task.ps1`

- ✅ **apartments.json 약 13.0MB 단일 파일 — 목록용 경량 분리** (세션 279 완료)
  - 분리: `apartments.json` 13MB 원본 유지 + `apartments-list.json` 1.66MB + `apartments-prices.json` 11.35MB 신규
  - DetailModal 첫 클릭 시 prices 11.35MB lazy fetch + 모듈 Map 캐시 (`useHistoryData` 패턴 답습)
  - Vercel Brotli 압축 후 실측: list **198KB** (-88.4%) / prices **858KB** (-92.6%)
  - 첫 LCP 페이로드: 1MB → **198KB** (~-80%)
  - 커밋: 6714fa7 (분리 코드 11 파일) + b57de6b (Vercel split + spec) + 7eb2a2e (.vercelignore whitelist)
  - 사고 박제: plan v2 자가 점검 #9 "npx vite build 안전" 환각 → Vercel prebuild VERCEL skip 으로 list/prices 미생성 → SPA fallback 사고 → split-apartments-json.mjs 신규 → .vercelignore whitelist 누락 → 2 단계 누적 정정
  - 참조: `docs/superpowers/specs/2026-05-20-apartments-json-split-design.md`

- ✅ **transport-tago 단위 시간 2.1배 느림 root cause 분석** (세션 295 종결)
  - 진앙 자리 확정: 커밋 `01d0dd4` (2026-05-22 07:42) `limit(10000) → range 페이지네이션` 자리 — transport-tago L194 fetch 자리 1000 → 2001 단지 전체 답습
  - raw log 실측: 5/21 (1000 단지) 524 미수집 2281.7초 단지 당 **4.35초** / 5/22 (2001 단지) 1001 미수집 4476.5초 단지 당 **4.47초** — 단지 당 시간 3% 노이즈 (코드/API 결함 0)
  - 세션 294 timeout 90→120 fix = 정확한 정정 자리 (회귀 자리 없음, 의도된 단지 수 자리)
  - 답습 자산: `.claude/rules/collectors/collector-timeout-rootcause-analysis.md` 신규 (4-way 답습 의무 박제)
  - 진단 사고: v1 환각 "단지 폭증 (네이버 신규)" → `apartments.created_at` 실측 30일 신규 0 → v2 정정 (`git log -- <collector>` 답습 후 진앙 자리 확정)

- ✅ **`environmentMatchGlobs` → `projects` 마이그레이션 완료** (세션 348) — 상세 = [BACKLOG_ARCHIVE.md](BACKLOG_ARCHIVE.md) 색인 참조

- ✅ **네이버 마커 1424개 클러스터 성능 실측 — 측정 완료, 버벅임 없음 종결** (세션 436, 사장님 라이브 측정). production 데스크톱 크롬 전국 줌(최대 부하, 클러스터 원 20+개)에서 idle FPS **61(부드러움)** 일관. 팬/줌 순간만 일시 10~34 dip 후 즉시 61 회복(`MarkerClustering.js:413 _onIdle → _redraw` 전체 재계산 1프레임, 코드 진단 예측 지점). 정적 분석상 네이버 gridSize 120 > 카카오 60 = 오히려 더 공격적으로 묶음 → 튜닝 불필요 확정. 저사양 모바일은 dip이 더 깊을 수 있으나 사용자 보고 트리거 대기(현재 정상). **부산물: nelo 텔레메트리 CSP 차단 발견** — 네이버 SDK 가 `kr-col-ext.nelo.navercorp.com`(로그수집)으로 보내는 통신이 connect-src 미등재로 차단. 공식 확인 = NELO(로그분석 인프라)·DNS 차단리스트 등재 추적 도메인 = 지도 기능 무해. 사장님 결정 = **차단 유지**(손님 사용기록 네이버 유출 0, 콘솔 에러는 손님 미노출). 코드 변경 0.

- ✅ **필터 리디자인 PR2 (정렬 칩화+소제목색+2칸) — 세션 482 #260 완료 + ④컨트롤높이·2칸게이팅은 세션 483 #263·#264 완결. 원문:**
  - (원문) **필터 리디자인 PR2 — 정렬 칩화 + 상세 소제목 색 + 2칸 (세션 481 다음 최우선)** — 사장님 명시 "정렬은 아직 세로 17줄, 이걸 먼저". PR1(글래스 오버레이, #258 main 7485baf) 완료 후 3-PR 계획의 2단계. **① 정렬 칩화**: `SortPanel.tsx` `flexDirection:column gap:3`(17개 세로 나열) → `flexWrap gap:5` 칩. SORT_OPTIONS(17개, `sortOptions.ts`) 재사용, 각 버튼=색 dot+라벨, **선택된 것만 색**(나머지 회색). 세로 17줄→3~4줄 = 모바일 BottomNav(z100) 가림 해소(PR1 라이브서 확인된 현상). **② 상세 소제목 색**: `filterGroups.ts`(세션480)에 그룹 색 필드 추가(교통=blue·가족=pink·자금=indigo·안전=green), `DetailPanel.tsx` 소제목을 색 칩 라벨로 + 버튼 회색 통일(선택 시만 강조). **③ 상세 2칸 그리드**(PC 2/모바일 1, 세션480은 그룹화만·2칸 아님). **④ 컨트롤 높이 토큰** PC 32/모바일 36(filterStyles numInput·resetBtn + FilterButton + SortPanel 칩). 표현계층 전용(동작·데이터·점수·비로그인 무변경). 설계서 `docs/superpowers/specs/2026-07-05-filter-glass-redesign-design.md`. 목업 반복 합의 완료(사장님 65% 글래스·소제목색"가"안·칩·PC납작 전부 확정).
- ✅ **필터 리디자인 PR3 (카드 radius 통일) — 세션 482 #261 완료. 원문:**
  - (원문) **필터 리디자인 PR3 — 카드 버튼/배지 radius 통일 (세션 481 3단계)** — theme `R` 토큰(세션481 PR1 도입, chip7·btn8·panel10·badge6·card14)을 `AptCard.tsx` 에 적용. 현재 radius 제각각(infoTag 3·배지 4·6·버튼 8·카드 14/16) → R 토큰 치환으로 필터 칩과 통일. **radius 값만 치환**(동작·색·조건 무변경). PR2 이후. 사장님 "버튼을 홈페이지랑 통일" 요청 실현.

## 세션 478~479 완료 (세션 498 에 BACKLOG 즉시 섹션에서 이동)

- ✅ **monitor NULL 급증 오탐 정정 + 매일 아침 브리핑 — 세션 478 (PR #249, main d900d5a)** — 세션 477 "NULL 90% housing" 오탐(매일 발화)을 적대검증 6에이전트로 파보니 **3중 연쇄**(세션 477 "gu=null 한 줄 fix"=오답, doctors/hospital 시도 0/113=100%NULL 새 오탐 유발): ① 컬럼마다 데이터 단위 다름 → `REGION_KEY_COLUMNS` `{column,granularity:sido|sigungu|all}` 승격 + `fetchRegionColumnStats` 단위별 total캐시·filled 쌍계산 ② granularity fix 시 ⑥ VIEW회귀 새오탐 = `data-audit.mjs:434` housing_supply_level SELECT 누락(세션457 미동기) → L434 컬럼추가 ③ purge-consults 매일 ok=0 정상인데 ② 오탐 → `idempotentCollectorSet()` 제외. **Part B**: `monitor-briefing.mjs`+`monitor_daily_snapshot`(UTC PK)+`sendDailyBriefing`, daily(KST09:00) 이상무관 1통(24h건수·채움률▲▼·이상요약·미발화), UTC통일·CI가드. vitest1446·code-reviewer PASS. **마이그 적용 완료**(사장님 Dashboard, 첫 스냅샷 07-04 확인). 상세 = 메모리 `session_2026-07-04_session478_monitor_granularity_briefing.md`.
- ✅ **곧분양 모바일 UI 3건 — 세션 478 (PR #250·#251)** — ① 지역칩/버튼 가로 넘침(grid 아이템 min-width:auto → RegionChipBar overflow-x 가 트랙 밀어냄) → `UpcomingPage.tsx` grid 아이템 2곳 `minWidth:0` ② 지역칩 스크롤 힌트(그라데이션 + 얇은 스크롤바) ③ 캘린더 기본 펼침(showCalendar false→true, 세션469 뒤집음). 표현계층 전용, playwright+프로덕션빌드 실측. squash main 0380eef(#250)·2c98ef2(#251). 상세 = 메모리 `session_2026-07-04_session478_upcoming_mobile_ui.md`.
- ✅ **커스텀 프리셋 필터 유실 정정 — 세션 479 (PR #253, main ad8cb07)** — `saveCustomPreset` 의 `snap` 객체에 `crimeSafeOnly`/`childcareGoodOnly`/`parkingGoodOnly` 3필터 누락 → 손님이 켠 채 프리셋 저장 시 조용히 유실(snap 에 없는 키는 저장 루프 `cur != null` short-circuit 으로 미저장). subwayOnly(세션430)·dsr/비규제(세션461) 는 이미 있던 재발 패턴. snap 3줄 추가(deps 는 이미 포함) + 왕복 테스트 3건(snap 제거 시 정확히 그 3건 red 로 버그 재현). 상세 = 메모리 `session_2026-07-04_session479_*`.
- ✅ **지역칩 "★ 관심지역" 라벨 + 편집모드 안내 — 세션 479 (PR #254, main 787be49)** — 세션 478 사장님 질문(L176 후보) 구현. "★ 편집"→"★ 관심지역"(목적이 드러남) + 편집 모드 진입 시 "칩을 눌러 관심 지역을 등록/해제하세요" 안내 1줄(overflowX 스크롤 컨테이너 밖·non-button 이라 세션478 #250 넘침 + test 인덱스 assertion 둘 다 무영향). 표현계층 전용.
- ✅ **병원/공원 가까운순 정렬 + 도보권 필터 — 세션 479 (PR #255, main 5e88b72)** — 미노출 지표(병원 94.8%·공원 95.0% 채움) 정렬 2종(hospitalNear/parkNear, 거리 오름차순 null→Infinity, **9999 sentinel 없음**=maintenanceLow 패턴) + 도보권 필터 2종(hospitalNearOnly/parkNearOnly ≤500m). 세션 474/475 답습, 필터 1개=11파일 배선(crimeSafeOnly 발자국 1:1). scoring.ts Apt 타입만 추가(엔진 무관)·비로그인 무관(raw 필드)·SORT_OPTIONS 대조군 15→17. 6렌즈 적대검증(할루시네이션 1·맹점 4 발견 정정) 후 구현. code-reviewer PASS. 상세 = 메모리 `session_2026-07-04_session479_*`.
- ❌ **noxious 취소 / housing-permits ok=0 (세션 477 텔레그램, 오탐/기지 — 조치 불필요)** — noxious 취소 = collector_runs 행 없음(cancelled). housing-permits ok=0 = 기지의 MOLIT 외부 API 장기 중단(별도 BACKLOG 박제). childcare-detail·purge-consults ok=0 = 세션 478 에 브리핑 "갱신 없음(정상)"+② 제외로 처리 완료.
