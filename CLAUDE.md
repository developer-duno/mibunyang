# 미분양 아파트 비교 엔진 v3.0

> React 19 SPA + Supabase PostgreSQL + Vercel Serverless. 6개 카테고리 41+ 지표 AHP 스코어링.

## 현재 진행 상황


> 세션별 상세는 [.claude/SESSION_LOG.md](.claude/SESSION_LOG.md) 완전 보존. 이 섹션은 스캔용 색인.

### 최근 3세션 (상세)

**세션148 (2026-04-28)** — postcss <8.5.10 XSS 보안 패치 (npm audit fix) (1커밋 origin/main `4f3a1e9`)
- 실행 플랜 [session148-postcss-audit-fix.md](C:\Users\user\.claude\plans\session148-postcss-audit-fix.md). 9 GATE 🟢9/🟡0/🔴0
- **배경**: 세션147에서 8세션 연속 컴포넌트 분리 작업(140~147) 자연 종료. 남은 7개 150줄+ 컴포넌트 모두 비-작업 명시 또는 결과물 → 도메인 전환 시점에 `npm audit` 정기 점검
- **취약점**: postcss <8.5.10 XSS (GHSA-qx2v-qp2m-jg93) — CSS Stringify Output에 unescaped `</style>` 노출. `npm ls postcss` 결과 vite@8.0.5 → postcss@8.5.8 (transitive only, package.json 직접 의존 0)
- **9 GATE 검증**: GATE 1 영향범위 — postcss는 vite internal, src/ 0 참조 / GATE 5 보안 — 본 작업 자체가 보안 강화 / 세션119 dompurify moderate 1커밋 해소(`be54322`) 선례 동일
- **커밋 `4f3a1e9`** (1파일 +3/-3): `npm audit fix` 실행 결과 "changed 1 package, found 0 vulnerabilities". package-lock.json 3줄 갱신만 (postcss version + resolved + integrity). 실측 8.5.8 → **8.5.12** (8.5.10+ 요구 충족, 최신)
- **Public API 불변**: package.json 0수정 (transitive only), 모든 src/ / api/ / scripts/ 파일 0수정, 빌드 산출물 동일 (jspdf 399.63KB 등 불변)
- **검증**: 151 files / **2448 tests PASS** (세션147 베이스라인 정확히 유지), `vite build` 417ms, `npm audit` **0 vulnerabilities**
- **사용자 가치**: moderate 보안 취약점 해소. 빌드 도구 의존성이라 직접 노출 낮지만 supply chain 위생 차단
- **교훈 1건 추가 (세션147 10건 + 1)**: 11. 분리 흐름 자연 종료 후 도메인 전환 시점에 `npm audit` 정기 점검이 효과적 — 8세션 연속 작업하면서 의존성 위생 누락 가능성. 다음 정기 점검 트리거: 매 10세션 또는 분리 흐름 종료 시점

**세션147 (2026-04-28)** — WeightEditor.jsx 233→100줄 2자식 분리 (WeightTable + ScoreBreakdownPreview) (1커밋 origin/main `359fec3`)
- 실행 플랜 [session147-weighteditor-split.md](C:\Users\user\.claude\plans\session147-weighteditor-split.md). 9 GATE 🟢9/🟡0/🔴0 (사용자 요청 하네스)
- **배경**: 세션146 교훈 8번 직접 활용 — WeightEditor.test.jsx 14 케이스 작성 완료 후 회귀 검증 수단 확보된 상태에서 분리 안전 진행. 233줄은 모든 150줄+ 컴포넌트 중 가장 큰 단일 파일이었음
- **분리 결정**: 2자식 (WeightTable + ScoreBreakdownPreview) — 가중치 편집 행렬(83줄) + 점수 분해 미리보기(61줄) 자연 경계 명확. handler 5개·state 3개·topApts useMemo 부모 유지 (1회용 훅 안티패턴 회피)
- **9 GATE 검증**: 보안 grep 0 결과, 영향 범위 — AdminDashboard L4·L45 1곳 + WeightEditor.test 14 + AdminDashboard.test 4 가중치 케이스 모두 통합 렌더링이라 자식 분리 무관, 신규 파일명 충돌 0
- **커밋 `359fec3`** (3파일 +184/-149):
  - 신규 [WeightTable.jsx](src/components/admin/WeightTable.jsx) **97줄** (예상 ~85, 오차 +12): props 10개 (profile/customWeights/editingProfile/draft/sum + onChange/onStartEdit/onCancelEdit/onSave/onReset). CAT_LABELS/CAT_KEYS + catCol/catBg + PROFILES 자식 직접 import. isEditing/isCustom/isActive 분기 본문 그대로 이식
  - 신규 [ScoreBreakdownPreview.jsx](src/components/admin/ScoreBreakdownPreview.jsx) **71줄** (예상 ~65, 오차 +6): props 3개. previewItem 계산 자식 내부로 이동 (`topApts[previewAptIdx] || topApts[0]`) + `if (!previewItem) return null` early return
  - 수정 [WeightEditor.jsx](src/components/admin/WeightEditor.jsx) **233 → 100줄** (-133, -57%): import 2줄 추가, catCol/catBg/CAT_LABELS 제거(자식 이동), Weight table 인라인 83줄 → 자식 호출 12줄, Preview 인라인 61줄 → 1줄, previewItem 변수 1줄 제거
- **150 미만 확실 달성 ⭐** — 세션143 DataSections 152(2줄 초과)·세션145 MapView 158(8줄 초과) 미달성 패턴과 달리 명확히 미만. 편집/미리보기 도메인 자연 경계 명확
- **Public API 불변**: `export default memo(WeightEditor)` + props 6개 시그니처 0변경 → AdminDashboard.jsx L4·L45 0수정 / WeightEditor.test.jsx 14 케이스 0수정 14/14 PASS / AdminDashboard.test.jsx 25 케이스 0수정 25/25 PASS
- **5교차검증**: null-safety-checker 🟢 (High/Med 0, Low 3 정보성 — 분리 전 4중 가드 동등 이식 `customWeights[pKey] ?? p.w` / `draft[k] ?? 0` / `topApts[idx] || topApts[0]` / `!previewItem return null`) / 빌드 🟢 438ms 번들 변동 0 / Hook 메인 직접 (자식 2개 모두 useState/useEffect/useCallback/useMemo/useRef 0건, memo만) / 보안 메인 직접 (admin/ innerHTML/dangerouslySetInnerHTML/eval 0)
- **검증**: 151 files / **2448 tests PASS** (세션146 베이스라인 정확히 유지)
- **사용자 가치**: 가중치 편집 행렬·미리보기 차트 격리 → 향후 슬라이더 UI 변경/breakdown bar 차트 변경이 본체 영향 0. 사용자(관리자) 6 카테고리 가중치 직접 조정이 점수 재계산 핵심 기능
- **8세션 연속 품질 작업 완성**: 140(InfoPage 60) → 141(SearchFilterBar 184) → 142(ExpertLoginForm 121) → 143(DataSections 152) → 144(primitives 91) → 145(MapView 158) → 146(WeightEditor 테스트 14건) → **147(WeightEditor 100)**
- **교훈 1건 추가 (세션146 9건 + 1)**:
  - 10. 분리 전 테스트 작성 선행이 가장 효과적인 안전판 — 14 단위 테스트 0수정 PASS로 분리 무결성 즉시 확인. 세션146 교훈 8번이 1세션 만에 효과 검증된 사례

**세션146 (2026-04-28)** — WeightEditor.test.jsx 신규 14 케이스 (분리 전 테스트 선행 작업) (1커밋 origin/main `ecd00cb`)
- 실행 플랜 [session146-weighteditor-test-prep.md](C:\Users\user\.claude\plans\session146-weighteditor-test-prep.md). 9 GATE 🟢9/🟡0/🔴0
- **배경**: 세션145 교훈 8번 직접 적용 — "테스트 부재 컴포넌트는 분리 전 테스트 작성 선행". WeightEditor 233줄은 모든 150줄+ 컴포넌트 중 유일한 테스트 부재로 세션145 분리 후보에서 제외됨. 분리 대신 분리 선행 작업
- **결정**: 분리 후보 거의 소진 + 사용자 직접 가치(가중치 편집 회귀 위험) + 위험 ⭐(코드 0수정) → AdminDashboard.test.jsx 통합 케이스 4건(L52/58/236/243)이 가중치 영역 일부만 검증, 미리보기/입력검증/초기화 등 0건 → 단위 테스트가 분리 검증에 더 적합
- **커밋 `ecd00cb`** (1파일 +171/-0): [WeightEditor.test.jsx](src/components/admin/WeightEditor.test.jsx) **153줄 14 케이스 6 도메인**:
  1. 기본 렌더링 3건 (제목/5 프로필 탭/6 카테고리 헤더)
  2. 프로필 선택 1건 (setProfile 호출)
  3. 편집 모드 4건 (input 전환/합계 검증/100 초과 가드/취소 복원)
  4. 저장·초기화 2건 (saveCustomWeights + showToast 호출, isCustom 초기화)
  5. 미리보기 카드 3건 (섹션 표시/아파트 탭 전환/scored 빈 배열 숨김)
  6. 가중치 검산 1건 (PROFILES 5개 모두 합계 100)
- **실행 중 정정**: 최초 11/14 PASS (3 실패) — `getByText`가 프로필 이름·아파트 이름의 탭 버튼 + 테이블 row 중복 등장으로 multiple matches 에러. `getAllByText` + `length >= 2` 또는 `[0]` 첫 등장 클릭으로 수정 → 14/14 PASS
- **Public API 불변**: WeightEditor.jsx 0수정, AdminDashboard.test.jsx 기존 통합 케이스 4건 보존
- **검증**: 151 files / **2448 tests PASS** (세션145 2434 → +14), `vite build` 429ms 번들 영향 0 (테스트 dev-only)
- **사용자 가치**: 가중치 편집/저장/초기화/미리보기 4 도메인 회귀 검증 수단 확보. 사용자(관리자) 6 카테고리 가중치 직접 조정이 점수 재계산 영향 → 회귀 시 직접 가치 손상이라 안전판 필수
- **세션147 분리 토대**: 233줄 → WeightTable 84 + ScoreBreakdownPreview 62 자식 분리 시 단위 테스트로 회귀 검증 가능
- **7세션 연속 품질 향상**: 140~145 분리 6세션 + 146 테스트 작성 = 7세션 품질 작업 연속
- **교훈 1건 추가 (세션145 8건 + 1)**: 9. `getByText`는 중복 텍스트 즉시 실패하는 strict 매처 — 한 컴포넌트 내 같은 텍스트가 여러 위치 등장 시 `getAllByText` + index 또는 length 검증 필요

**세션138 (2026-04-22)** — AdminDashboard 417→96줄 3분할 (3커밋 origin/main `9c035f3..cdfe592`) — 상세는 SESSION_LOG 참조

**세션137 (2026-04-21~22)** — schools-neis `recordApiQuota` 1줄 보강 — CLAUDE.md 쿼터 로깅 원칙 복구 (1커밋 origin/main `c0f501f..5b2be14`)
- 실행 플랜 [cd-f-mibunyang-pwd-moonlit-kahn.md](C:\Users\user\.claude\plans\cd-f-mibunyang-pwd-moonlit-kahn.md). 9 GATE 🟢9/🟡0/🔴0 (서브에이전트 GATE 5-4 🔴 "api_quota_log UNIQUE 부재" 판정 → **재판정 🟢** — 기존 스키마 설계 의도, `api_quota_daily` VIEW `SUM()` 집계로 충분)
- **배경**: 세션136 2차 검증 독립 유효 성과 (scripts/CLAUDE.md "9개 수집기 쿼터 로깅" 원칙 위반 — schools-neis 만 누락, migration.mjs:163·molit-building-info.mjs:219·collect-unsold-kosis.mjs:286 전부 준수). 4/30 학교알리미 + 5/3 CI 외부 이벤트 대기라 지금 할 수 있는 유일한 내부 작업
- **커밋 `5b2be14`** (1파일 +4/-1):
  - [schools-neis.mjs](scripts/collectors/schools-neis.mjs) L11 import 에 `recordApiQuota` 추가 (`_shared.mjs:431` export 재사용)
  - L385-386 main() 말미 2줄: `if (!dryRun && NEIS_KEY) await recordApiQuota(PHASE, "NEIS_KEY", neisApiCalls);` / `if (!dryRun && SCHOOLINFO_KEY) await recordApiQuota(PHASE, "SCHOOLINFO_KEY", schoolInfoApiCalls);`
  - dryRun 가드 + 키 존재 가드 (migration.mjs 패턴과 동일)
- **5교차검증**: collector-contract 🟢 PASS (쿼터 로깅 원칙 위반 해소, 모범 패턴 3수집기와 일관) / null-safety-checker 🟢 (High/Med/Low 0, 카운터 L42/L161 모듈스코프 `let X=0` 초기화 확정) / 빌드 🟢 486ms 번들 불변 / 보안 🟢 (env **이름** 만 DB 기록, try/catch 메인 흐름 보호)
- **검증**: 150 files / **2434 tests PASS** (세션136 동일 유지), dry-run 실측 시 "DRY-RUN 모드" 로그 + `recordApiQuota` 호출 0건 (가드 작동 확인)
- **사용자 가치**: 2026-05-03 KST 07:00 `collect-schools.yml` 정기 실행 후 `api_quota_log` 테이블로 NEIS/SCHOOLINFO 호출량 일별 추적 가능. 4/30 학교알리미 서비스 재개 후 호출 정상화 여부 실측 모니터링 수단 확보

**세션136 (2026-04-21)** — schools.students 학교알리미 복구 Phase 0 진단 → **가설 E 서비스 점검 확정, 4/30 대기** (1커밋 origin/main `c0f501f`)
- 실행 플랜 [cd-f-mibunyang-pwd-pure-hamming.md](C:\Users\user\.claude\plans\cd-f-mibunyang-pwd-pure-hamming.md). 2차 재판정 🟢9/🟡0/🔴0 (1차 🟢7/🟡2 → 서브에이전트 재검증 3건 보강 후 전통과)
- **가설 판정**: A 엔드포인트/B 키 만료/C 매칭/D IP — 전부 **보류** (원본 응답 수령 자체 불가). **E 서비스 점검 ✅ 확정** — 학교알리미 공식 공지 "2025-08~2026-03 업로드 첨부파일 열람 일시 중단, 2026-04-30 1차 정시 공시와 함께 재게시" 사용자 스크린샷 실증
- **Phase 0 실행**: `scripts/_tmp_schoolinfo_probe.mjs` 40줄 (_tmp_* gitignored) → 강남구 초중고 3회 호출 시도. `SCHOOLINFO_KEY` 로컬 `.env.local` 미동기화로 중단. `gh secret list` 실측: SCHOOLINFO_KEY 2026-04-02 등록 확인(세션118 일치), 단 write-only 라 값 추출 불가. 사용자 스크린샷으로 원인 전환
- **2차 검증 주요 발견 3건**:
  - `normalizeSchoolName` 4지점 이중 역할 (schools-neis.mjs L53/70/182/218) → Phase 1-C 옵션 A 기각, **옵션 B(유사도 0.8→0.75 + DEBUG 로그)** 단계적 접근 채택
  - `classes` 1.4% 실적은 neisCode 과거 저장분 유산 — 실제 baseline 사실상 0%
  - **[schools-neis.mjs](scripts/collectors/schools-neis.mjs) `recordApiQuota` 호출 0건** — scripts/CLAUDE.md "쿼터 로깅 9개 수집기" 원칙 위반. 다른 수집기(molit-building-info.mjs:219, migration.mjs:163) 전부 기록 중. 독립 유효 성과로 세션137 이월
- **코드 수정 0파일**, docs 2파일 (SESSION_LOG + 이 CLAUDE.md)
- **교훈**: "API 0건/실패" 진단 시 Claude 혼자 코드·API 조사로는 "외부 서비스 점검" 가설 못 잡음 → 공식 사이트 접속해 공지 확인을 다음 세션부터 우선 절차로

**세션135 (2026-04-21)** — 세션132 CI 사후 확인 + "재활용 패턴" 전수 점검 (docs-only, 1커밋 예정)
- 실행 플랜 [cd-f-mibunyang-pwd-lazy-pumpkin.md](C:\Users\user\.claude\plans\cd-f-mibunyang-pwd-lazy-pumpkin.md). 9 GATE 🟢9/🟡0/🔴0 (1차 🟢7/🟡2 → 단계 1 실패처리 1줄 추가 후 전통과)
- **단계 1 결과**: `schools.nearby_schools[*].neisCode` = **0.0% (21,608 요소 중 0건)**. 🔴 원인 확정: `collect-schools.yml` cron `'0 22 2 * *'` = 매월 2일 UTC 22:00 → 세션132 커밋 `8b16d62` (2026-04-20 작성) 는 **2026-05-03 KST 07:00** 실행 시 첫 반영. 현재 0% 는 정상. **5/3 이후 재측정 필요**
- **부수 발견**: 세션133 DB 품질 표의 "schools 5,239 요소" 는 `supabase-js` 기본 limit 1000 탓 과소집계. 실제 **21,608** (4배). 페이지네이션 포함 1회성 스크립트(`_tmp_*`, `.gitignore` 보호, 실행 후 삭제) 로 실측
- **단계 2 매트릭스** (코드 읽기 전용, 수정 0파일):
  - ✅ [migration.mjs](scripts/collectors/migration.mjs) L127 `newEstPrdCnt: "1"` — 최신 1개월만 요청 → 재활용 낭비 없음
  - 🟡 [collect-market-stats.mjs](scripts/collectors/collect-market-stats.mjs) L102-107 6개월+8분기 요청 / L74-88 `extractLatestByRegion` 지역별 최신값만 추출, 나머지 버림 / regions 에 시계열 컬럼 부재 → **세션134 unsold_history 와 동일 패턴**, 복구 가치 🟡 (reader 없어 긴급도 낮음)
  - ✅ [population.mjs](scripts/collectors/population.mjs) L43-44 `srchFrYm=srchToYm` 단일 월 요청 + L238-250 `regions.recorded_at` 시계열 INSERT → 올바른 설계
- **결론 3개**: (1) 🟡 #1 CI 사후 확인은 5/3 까지 **대기** (🔴 아님), (2) collect-market-stats 시계열 복구 🟡 #5~6 추가, (3) migration/population 안전 확인
- **서브에이전트 병렬 검증**: GATE 0~8 중 GATE 1 (영향범위) / GATE 5 (보안) Explore 2개 동시 기동. 민감 정보 하드코딩 0건, `.gitignore:31` `_tmp_*` 패턴 보호 확인, `schools.nearby_schools` 테이블 구조 실증(`supabase/schema.sql:168-174`)
- **코드 수정 0파일**, docs 3파일 (이 CLAUDE.md + priorities + SESSION_LOG) 예정

**세션134 (2026-04-21)** — unsold_history 0행 복구 + 세션118 migration DB 반영 (1커밋 origin/main `95ebcfd..c5c3a55`)
- 실행 플랜 [cd-f-mibunyang-pwd-graceful-newt.md](C:\Users\user\.claude\plans\cd-f-mibunyang-pwd-graceful-newt.md). **2차 수렴 9 GATE 🟢9/🟡0/🔴0** (1차 🟡1 → PRD_DE 정규식 가드 반영 후 2차 전통과)
- **세션133 🥈 migration 반영**: Supabase Dashboard SQL Editor 에서 사용자가 `20260419000000_view_dedup_prefer_general.sql` 직접 실행. apartments_flat total_rows=1424 (불변) / `(오)` 접미 23→**17** (-6건, 세션118 예상 "6건 교체" 정확 일치). 기존 오피스텔 승자 자리에 일반분양 본체 6건 노출 시작
- **세션133 🥇 unsold_history 0행 원인 확정**: 조사 결과 "수집기가 아예 구현된 적 없음" (grep 0건). 테이블/읽기 엔드포인트(`api/supabase/unsold-history.js` 세션121 리팩토링)/프론트 UnsoldChart 모두 있는데 **우편함만 있고 우체부 없음** 상황
- **해결 방향 A**: 기존 `collect-unsold-kosis.mjs` 확장. KOSIS API 가 이미 3개월 범위 단일 호출로 받아오는데 `parseKosisRows` 가 최신 월만 추출하고 버려옴 → 재파싱으로 시계열 저장. **API 재호출 0, 쿼터 증가 0**
- **커밋 `c5c3a55`** (2파일 +114/-2):
  - [collect-unsold-kosis.mjs](scripts/collectors/collect-unsold-kosis.mjs) 신규 export `parseKosisRowsAllMonths(rows)` (PRD_DE `/^\d{6}$/` 정규식 가드 포함) + `main()` 말미 unsold_history upsert 블록 + `recordApiQuota(PHASE, "KOSIS_KEY", 1)` 추가 + import 2개
  - `upsertBatch("unsold_history", rows, "apartment_id,base_month", 500, sb)` UNIQUE 멱등
  - `post_completion_unsold`/`change` 는 KOSIS `DT_MLTM_2082` 미제공 → `null` 저장 (프론트 UnsoldChart null 안전)
  - [collect-unsold-kosis.test.mjs](scripts/collectors/collect-unsold-kosis.test.mjs) 신규 describe 5건 (3개월 분리 / PRD_DE 분기 포맷 skip / C1_NM 매핑 실패 / DT NaN / '계' `_total` 월별)
- **기존 `parseKosisRows` 병존** (교체 X) — regions/apartments UPDATE 경로 회귀 0
- **실제 DB 실행 결과** (로컬 `KOSIS_KEY` 보유로 CI 전 로컬 실측):
  - apartments 미분양 추정 갱신 119건
  - **unsold_history 0 → 1,099행** (distinct 508 apartments × 평균 2.16 월)
  - 월 범위 `["202601", "202602"]` — KOSIS 1~2개월 지연 반영 정상 (`202603`/`202604` 요청했으나 응답 없음)
  - `recordApiQuota kosis-unsold: KOSIS_KEY 1회 기록` 정상
- **5교차검증**: null-safety-checker 🟢 (High/Med 0, Low 1 — `row.C2_NM` undefined 시 `"undefined"` 키 품질 이슈만) / collector-contract 🟢 (C1 배치 500 + conflictCol "apartment_id,base_month" UNIQUE 일치, C2 순차, C3 에러, C4 쿼터 dry-run 가드, C5 dry-run 로그 전부 PASS) / 빌드 🟢 (868ms 번들 불변) / 보안 🟢 (KOSIS_KEY 재사용, injection 0)
- 검증: 150 files / **2429 → 2434 tests PASS** (+5), `vite build` 868ms
- **사용자 가치**: UnsoldChart.jsx 가 508개 아파트의 월별 미분양 추이 차트를 실제로 그릴 수 있게 됨. 매월 1일 자동 수집으로 시계열 자연 축적

**세션133 (2026-04-20~21)** — 우선순위 자기점검 + DB 품질 전수 재측정 + UX Playwright 실측 (docs-only, 1커밋 예정)
- **촉발**: 사용자 "프로젝트 목적에 부합한 일들 하고 있나" 점검 요청. 세션132 `neisCode` 작업을 포함해 최근 우선순위 판단에 사실 오류 누적 가능성
- **1단계 — migration 반영 안내**: 세션118 `20260419000000_view_dedup_prefer_general.sql` 이 작성만 되고 DB 반영 안 된 상태 확인. "(오)" 23건 노출 유지 (예상 반영 후 20건). Dashboard SQL Editor 수동 실행 사용자 과제
- **2단계 — DB 품질 전수 재측정** (`db-quality-audit.mjs` 1회성 실행 후 삭제):
  - ✅ 자연 개선: `cats_cache NULL` 7→0 (flat 기준), `price=0` 해소 유지, `dataReliability ≥80` 1,317→1,338 (92.5→94.0%), `net_migration/pop_growth` 100% (세션103 이후), `catsCache` flat 0 NULL
  - 🔴 **NEW 발견**: `unsold_history 0행` (시계열 전무), `schools.nearby_schools[*].students` 0/5,239, `classes` 143/5,239 (2.7%), `neisCode` 0% (세션132 커밋 후 CI 미실행)
  - 🔴 유지: `regions.households/jeonse_rate/supply_ratio 0/454` (reader 없어 우선순위 낮음)
  - 🟡 **의도적**: 혜택 10컬럼 100% NULL — 시행사 자료 운영자 수기 입력 대상 (`data-fill.mjs:46 SKIP_CATEGORIES` 에 `benefits` 포함). **자동 수집 대상 아님, 건드리지 말 것**
- **3단계 — Playwright UX 실측** (`~/.claude/tmp/mibunyang_ux_audit*.py` 4회 반복, 삭제 예정):
  - `1424개 단지` 표기 확인 → migration 미반영 확정 (원본 2001 대비 577개 dedup 제외)
  - 비로그인 카드: 점수 "??" 블러, "혜택 데이터 미수집" 전 카드 노출 (설계 의도)
  - 로그인 모방 시도 실패 — fake token 을 서버 `verify` 가 무효 판정. DetailModal 자동화는 실제 카카오 OAuth 필요
  - 콘솔 에러/경고 **0건** — 프런트 런타임 건전성 ✅
- **세션132 재평가**: `neisCode` 저장은 수집기 멱등성 확보 (진짜 가치 있음) 이나 사용자 체감 0. 우선순위 1등이었으면 안 됐음 정직하게 인정
- **세션134 우선순위 재정립**: `unsold_history 0행 조사` 🥇 / 세션118 migration 반영 🥈 / 세션132 CI 사후 확인 🥉 / `schools.students` 학교알리미 복구 4등
- 커밋 예정: CLAUDE.md DB 품질 섹션 + 다음 세션 우선순위 + 최근 3세션 블록 + SESSION_LOG 세션133 append

**세션131 (2026-04-20)** — test 주석 정리 10 라인 3분할 커밋 + eslint 재확인 + 통합 플랜 아카이브 (4커밋 origin/main `39ce0ca..18777ce`)
- 실행 플랜 [131-humble-snowglobe.md](C:\Users\user\.claude\plans\131-humble-snowglobe.md). 9 GATE 1차 🔴(6파일 일괄) → 실측 grep 재수행 10 라인 식별 → 3분할 재설계 → 2차 🟢9/🟡0/🔴0
- **커밋 `39ce0ca`** (3파일 +3/-3): api/_lib/ test 3종 주석 정리 — `rateLimit.test.js:7` / `tokenBlacklist.test.js:7` / `adminAuth.test.js:12` 에서 `세션127/128: @vercel/kv → ./redis.js` 히스토리 제거
- **커밋 `1b4893a`** (5파일 +5/-5): api/auth/ test 5종 주석 정리 — `logout/login/signup/kakao/verify.test.js` 에서 `세션128/129 Upstash 교체` 히스토리 제거. kakao.test.js:143 본문 회귀 방지 앵커는 보존
- **커밋 `35ba093`** (2파일 +2/-2): admin test 2종 **사실 오류 수정** — `review.test.js:22` / `users.test.js:22` 의 `@vercel/kv 모킹` 주석이 실제 L29/L27 `vi.mock('../_lib/redis.js')` 와 불일치 → `redis.js 모킹` 으로 정정
- **커밋 `18777ce`** docs: 이 세션 기록 + 통합 플랜 아카이브 반영
- **eslint 재확인**: `npm view eslint-plugin-react@latest peerDependencies` → peer `^3 || ... || ^9.7` 불변. 에픽 3-B 🔴 차단 유지. 재오픈 트리거: registry `^10.0.0` 등장
- **통합 플랜 아카이브**: `~/.claude/plans/pwd-linear-rossum.md` (git 외부) 상단 완료 배너 + 에픽 11개(1/2-A/2-B1/2-B2/3-A/3-B/4-A0+A1a/4-A1b-1/4-A1b-2/4-B/4-C) 각 말미 완료 커밋 해시 박제
- **비변경 대상 명시**: [kakao.test.js:143](api/auth/kakao.test.js#L143) 본문 회귀 방지 앵커 / [redis.js:3](api/_lib/redis.js#L3) 프로덕션 wrapper 설계 근거 / `src/scoring/**` 가중치 재설계 앵커 — 전부 보존
- 검증: 150 files / **2429 tests PASS** (세션130 동일 유지), 주석만 변경이므로 `vite build` smoke 생략
- 5교차검증: 전용 에이전트 호출 조건 미해당(스코어링/null/수집기 모두 비수정) → 메인 agent 직접 검증으로 처리

**세션130 (2026-04-20)** — 에픽 4-C: admin 체인 Upstash 교체 + stats dead route 제거 + **@vercel/kv 의존성 완전 제거** (4커밋 origin/main `ce9e3d2..4a90768`)
- 활성 통합 플랜 [pwd-linear-rossum.md](C:\Users\user\.claude\plans\pwd-linear-rossum.md) 에픽 4-C. 실행 플랜 [pwd-f-mibunyang-soft-parasol.md](C:\Users\user\.claude\plans\pwd-f-mibunyang-soft-parasol.md)
- **9 GATE 2회 수렴**: 1차 🟢5/🟡4 (GATE 0/1/3/4 — stats.js dead route 발견) → 재설계 (치환→삭제) → 2차 🟢9/🟡0/🔴0 통과
- **중대 발견 → 결정**: `api/admin/stats.js` 프론트 호출 0건 (grep 실증, `useAdminMode.js:151` 은 `/api/admin/users?action=stats` 만 사용 → users.js 의 handleStats L5-51 경로) + stats.js 주석 L4 "stats.js 통합 — Vercel Hobby 12함수 제한" 자체 실토 → **dead route 삭제** 결정 (세션129 refresh.js 선례 동일)
- **Explore 서브에이전트 오탐 기각**: 1번 에이전트 "숨은 호출자 1건" 보고 → 메인 Read 직접 검증 (`useAdminMode.js:146-159`) → `fetchStats` 함수명만 "stats" 키워드 매칭, 실제 URL 은 users.js 경로로 확정
- **커밋 `e5aab6f`** (2파일 +2/-2): review.js L1 교체 + review.test.js L29 mock 경로 교체 (19케이스 본문 0변경)
- **커밋 `264f209`** (2파일 +2/-2): users.js L1 교체 + users.test.js L27 mock 경로 교체. handleStats + main handler 동시. stats.test.js 교차 의존 파손은 단계 3 에서 자동 해소 (설계상 의도된 윈도우)
- **커밋 `bc7aafa`** (2파일 -186): stats.js 90줄 + stats.test.js 97줄 **삭제**. dead code 대량 감축
- **커밋 `4a90768`** (2파일 -15): package.json L29 `"@vercel/kv": "^2.0.0"` 제거 + package-lock.json 재생성. `node_modules/@vercel/kv` 실측 제거 (`npm install` removed 1 package)
- 검증: 150 files / **2429 tests PASS** (세션129 2431 → -2 stats.test.js 삭제분), `vite build` 431ms, 번들 불변, `npm audit` 0건
- **@vercel/kv prod import 3 → 0 ← 세션126~130 Upstash 마이그레이션 5세션 종결**
- null-safety-checker 3회 호출 🟢 PASS (High/Med 0): review.js 롤백 체인 + users.js handleStats/main 양경로 + 의존성 제거 단독 검증

**세션129 (2026-04-20)** — 에픽 4-B: auth 체인 Upstash 교체 + refresh.js dead route 제거 (4커밋 origin/main `143f9ea..efda699`)
- 활성 통합 플랜 [pwd-linear-rossum.md](C:\Users\user\.claude\plans\pwd-linear-rossum.md) 에픽 4-B. 실행 플랜 [pwd-fancy-pixel.md](C:\Users\user\.claude\plans\pwd-fancy-pixel.md)
- **9 GATE 0~8 전수 🟢9/🟡0/🔴0** 통과 후 실행. null-safety-checker 🟢 PASS (High/Med 0, Upstash `get/set/sadd/del` null 반환 `@vercel/kv` 동등 실증 `error-8y4qG0W2.d.ts:4636`)
- **중대 발견 → 결정**: `api/auth/refresh.js` 가 프론트 호출 0건 (grep 실증, `useExpertMode.js:133,150` 은 `/api/auth/verify` 만 사용) + verify.js `handleRefresh` 가 동일 로직 쌍둥이 → **dead route 삭제** 결정 (공격 표면 축소)
- **커밋 `708fa44`** (1파일 -48): refresh.js 삭제 — 세션128 박제 "refresh.test.js 부재" 근본 해소
- **커밋 `12d1578`** (2파일 +2/-5): verify.js L1 교체 + verify.test.js 두-mock 해제 (`vi.mock('@vercel/kv')` 제거, `../_lib/redis.js` 단독)
- **커밋 `3b7630e`** (4파일 +6/-6): login+signup pair — prod L1 교체 + test mock 경로 교체. `sadd/del` Upstash 호환 실측
- **커밋 `efda699`** (2파일 +171/-1): kakao.js L1 교체 + **kakao.test.js 신규 9케이스** (OAuth A/B/C 분기 + redirect_uri 화이트리스트 + `ex: 7776000` TTL 호환)
- 검증: 151 files / **2431 tests PASS** (세션128 2422 → +9 kakao), `vite build` 389ms, 번들 불변, `npm audit` 0건
- **`@vercel/kv` prod import 8 → 3** (admin/stats·users·review 만 잔존, 세션130 에픽 4-C 이월)

**세션127 (2026-04-20)** — 에픽 4-A1b-1: rateLimit 체인 Upstash 교체 (1커밋 origin/main `86eb15d..e479ade`)
- 활성 통합 플랜 [pwd-linear-rossum.md](C:\Users\user\.claude\plans\pwd-linear-rossum.md) 에픽 4 재설계 — 원안 "prod 2파일 동시" → 5 하위 에픽 pair-commit 전략으로 분할
- 9 GATE 1차 🔴2건(`vi.mock('@vercel/kv')` 10파일 회귀 리스크) → 2차 재검증 🟢9/🟡0/🔴0 (비대칭성 발견)
- **비대칭 실측**: `vi.mock('../_lib/rateLimit.js')` **10회** 함수레벨 스텁(철벽) vs `vi.mock('../_lib/tokenBlacklist')` **0회** → rateLimit 선별 교체, tokenBlacklist 세션128 이월
- **커밋 `e479ade`** (3파일 +8/-28): [redis.js](api/_lib/redis.js) 28→9줄 (`getInstance` getter 제거, `export const kv = Redis.fromEnv()` 직접 노출) + [rateLimit.js](api/_lib/rateLimit.js) L1 `@vercel/kv` → `./redis.js` + [rateLimit.test.js](api/_lib/rateLimit.test.js) L14 mock 경로 교체
- Vercel Upstash 실측: `upstash-kv-fuchsia-pocket ● Available` 연결됨, `KV_REST_API_URL/TOKEN` 레거시 env 는 `Redis.fromEnv()` 공식 fallback (`nodejs.mjs:266-282` 실측) → env 추가 불필요
- 5교차검증: null-safety-checker 🟢 (High/Med 0, Low 1 즉시 수정), 메인 보안 🟢 (fail-close `rateLimit.js:22-25` 불변)
- 검증: 150 files / **2422 tests PASS** (세션126 동일), `vite build` 510ms, 번들 불변, `npm audit` 0건
- `@vercel/kv` prod import 10 → 9 (rateLimit.js 제거)

**세션126 (2026-04-19~20)** — 에픽 4-A0+4-A1a: Upstash 설치 + Lazy Redis Wrapper (2커밋 origin/main `c7ea9a1..f02bea0`)
- 활성 통합 플랜 [pwd-linear-rossum.md](C:\Users\user\.claude\plans\pwd-linear-rossum.md) 에픽 4 착수. 9 GATE 4차 재검증 🟢8/🟡1/🔴0 (GATE 3 🟡 유지 — prod 교체는 환경변수 주입 후 세션127 이월)
- **커밋 `c7ea9a1`**: `npm install @upstash/redis@1.37.0 --save` — transitive 1.36.3 → direct 1.37.0 승격. semver 호환 `^1.31.3`, npm audit 0건
- **커밋 `f02bea0`**: [api/_lib/redis.js](api/_lib/redis.js) 신규 28줄 — `getRedisClient()` lazy factory + `kv` getter. 호출부 0 → 런타임 영향 0
- 실측 근거: `node_modules/@upstash/redis/nodejs.mjs` L266-283 — env 부재 시 `console.warn`만, throw 없음 → 빌드·배포 안전
- 5교차검증 (커밋 2): null-safety-checker 🟢 (High 0/Med 0/Low 2 정보성)
- 검증: 150 files / **2422 tests PASS** (세션125 동일 유지), `vite build` 470/441ms, 번들 불변, `npm audit` 0건

**세션125 (2026-04-19)** — 에픽 3-A 조사 + Node 환경 핀 (1커밋 origin/main `6520ec9`)
- 활성 통합 플랜 [pwd-linear-rossum.md](C:\Users\user\.claude\plans\pwd-linear-rossum.md) 의 에픽 3-A 진행. 사용자 옵션 B 선택. 9 GATE 9🟢/0🟡/0🔴
- **에픽 3-A 조사 결론**: eslint 10 본 적용(에픽 3-B) 🔴 차단 — `eslint-plugin-react@7.37.5` (최신) peer 가 `eslint: ^9.7` 까지만 지원, npm registry 에 호환 신버전 미배포. 재오픈 트리거: `npm view eslint-plugin-react@latest peerDependencies` 결과 `^10.0.0` 등장
- **본 작업 (2파일 +4/-0)** — [package.json](package.json) `engines.node: ">=20.19.0"` 추가, `.nvmrc` 신규 1줄. 값 근거: 로컬 v24.14.1 + Vercel Node 22 + GitHub Actions 37워크플로우 모두 충족 실측
- 검증: 150 files / **2422 tests PASS** (세션124 동일 유지), `vite build` 466ms, 번들 불변

**세션124 (2026-04-19)** — Scoring JSDoc 에픽 2-B2 안전·미래 — 시리즈 완료 (1커밋 origin/main `a2ea62e`)
- 활성 통합 플랜 [pwd-linear-rossum.md](C:\Users\user\.claude\plans\pwd-linear-rossum.md) 의 에픽 2-B2 진행. 9 GATE 9🟢/0🟡/0🔴 (세션123 동일 패턴 선례)
- **2파일 +72/-1** — [scoreRisk.js](src/scoring/scoreRisk.js) (11서브 가중치 합 1.0000 검산 박제 + safety=100-risk 방향성 + listingPen·finSc 공공분양·crimeSc 복합·서브 구간 표 위치), [scoreFuture.js](src/scoring/scoreFuture.js) (FUTURE_WEIGHT_MAP 8조합 합 항상 1.00 + popSc 7단계 + TRANSIT_HIGH 1.2배 + netMigration 보정 + 5키워드 상수/matchAny 헬퍼 JSDoc + `includes()` 부분 매칭 함정 박제)
- 5교차검증: scoring-validator 🟢 (FUTURE_WEIGHT_MAP 8조합 모두 합 1.00 검산, popSc 7단계 임계값 정확), null-safety-checker 🟢 (matchAny 상위 가드 6지점 검증, fw undefined 불가)
- **Scoring JSDoc 시리즈 완성**: 3세션 누적 8파일 12식별자 (에픽 2-A `7b4b0ad` + 2-B1 `d314f2f` + 2-B2 `a2ea62e`)
- 검증: 150 files / **2422 tests PASS** (세션123 동일 유지), `vite build` 591ms, 번들 불변, lint 84 warnings 유지

**세션123 (2026-04-19)** — Scoring JSDoc 에픽 2-B1 입지·상품·혜택 (1커밋 origin/main `d314f2f`)
- 활성 통합 플랜 [pwd-linear-rossum.md](C:\Users\user\.claude\plans\pwd-linear-rossum.md) 의 에픽 2-B1 진행. 9 GATE 9🟢/0🟡/0🔴 (세션122 에픽 2-A 동일 패턴 선례)
- **3파일 +81/-0** — [scoreLocation.js](src/scoring/scoreLocation.js) (5서브 합 1.00 + airSc 복합 + walkMin/혐오시설 거리 보정 + INFRA_CONFIG 10항목 합 1.00 박제), [scoreProduct.js](src/scoring/scoreProduct.js) (PRODUCT_MAX 9항목 합 100 + 주택유형별 brandSc 상한 + presaleParking 폴백 박제), [scoreBenefit.js](src/scoring/scoreBenefit.js) (loanVal 공식 + maintSave 이중 가드 + price=0/totalWon=0 0나누기 방지 박제)
- 5교차검증: scoring-validator 🟢 (JSDoc ↔ 구현 ↔ src/scoring/CLAUDE.md 3중 일치, PRODUCT_MAX 검산 20+15+15+10+10+10+10+5+5=100), null-safety-checker 🟢 (안전성 약속 정확, sanitize 의존 6건은 책임 범위 밖)
- 검증: 150 files / **2422 tests PASS** (세션122 동일 유지), `vite build` 484ms, 번들 불변, lint 84 warnings 유지

**세션122 (2026-04-19)** — Skeleton primitives + Scoring JSDoc 핵심 3파일 (2커밋 origin/main `88b7138..7b4b0ad`)
- 백로그 4에픽 통합 플랜(`pwd-linear-rossum.md`) 착수. 9 GATE 3차 재검증 🟢8/🟡1/🔴0 통과 후 실행
- **에픽 1** [primitives.jsx](src/components/primitives.jsx) +45줄 — SkeletonBox/SkeletonText/SkeletonList 3종. 기존 AptListSection `@keyframes skeleton-pulse` 1.5s 재사용. [detail/LoanRatesSection.jsx](src/components/detail/LoanRatesSection.jsx) L50 텍스트 → `<SkeletonText>`, [admin/AdminDashboard.jsx](src/components/admin/AdminDashboard.jsx) L162·L206 → `<SkeletonList>`
- **에픽 2-A** JSDoc 7함수 — [engine.js](src/scoring/engine.js) sanitize·calcCats·calcAll, [scorePrice.js](src/scoring/scorePrice.js) getAgeCoeff·getAreaAdj·scorePrice, [computeRegionalMedians.js](src/scoring/computeRegionalMedians.js). src/scoring/CLAUDE.md 규칙 박제 (가중치 1.00/100, 0~100 클램핑, `??` 전용, PIR 구간, fairPrice 3단 폴백 -15)
- 5교차검증: null-safety-checker 🟢 (에픽 1), scoring-validator 🟢 (에픽 2-A, JSDoc 내용 전부 CLAUDE.md + 실제 구현과 일치)
- 검증: 150 files / **2422 tests PASS** (세션121 2418 → +4 Skeleton), `vite build` 423/419ms, 번들 불변, lint 84 warnings (기존 수준)

**세션121 단계 C (2026-04-19)** — 저장 액션 토스트 피드백 (1커밋 origin/main `9e52be8`)
- 🟢 백로그 "저장 액션(가중치·프리셋) 토스트 피드백" 해소. 기존 useToast 패턴 4지점 적용
- [WeightEditor.jsx](src/components/admin/WeightEditor.jsx) +4 / [AdminDashboard.jsx](src/components/admin/AdminDashboard.jsx) +2 / [SearchFilterBar.jsx](src/components/sections/SearchFilterBar.jsx) +6 / [App.jsx](src/App.jsx) +2
- 토스트 4종: `"가중치가 저장되었습니다"` · `"프로필이 초기화되었습니다"` · `"프리셋이 저장되었습니다"` · `"프리셋이 삭제되었습니다"`
- 기본값 `showToast = () => {}` 폴백으로 기존 테스트 수정 없이 통과. prop drilling 2레벨
- 9 GATE 🟢9/🟡0/🔴0, null-safety Review PASS (Medium 1건 즉시 수정: 삭제 실패 시 토스트 안 뜨도록 조건 가드)
- 검증: 150 files / **2418 tests PASS** 유지, `vite build` 396ms, 번들 +0.13kB

**세션121 (2026-04-19)** — createTimeseriesHandler 팩토리 추출 (1커밋 origin/main `3cad834`)
- 🟢 백로그 "api/supabase/prices.js ↔ unsold-history.js 중복 11줄 → 공통 헬퍼" 해소
- **신규** [api/_lib/timeseriesHandler.js](api/_lib/timeseriesHandler.js) 58줄 — `createTimeseriesHandler({ table, select, orderBy, errorLabel, filter? })` 팩토리
- **수정** [api/supabase/prices.js](api/supabase/prices.js) 49→21줄 (-28), [api/supabase/unsold-history.js](api/supabase/unsold-history.js) 48→19줄 (-29) — 선언부만 남김. presale_% 필터는 `filter` 훅으로 이전
- 외부 동작 불변: 기존 테스트 13케이스(prices 7 + unsold-history 6) **수정 없이** 통과
- 9 GATE 1차 🟢9/🟡0/🔴0 (서브에이전트 2개 병렬: 영향범위 grep + 보안 실측)
- 검증: 150 files / **2418 tests PASS** (세션120 유지), `vite build` 397ms, null-safety PASS, 번들 불변
- rateLimit "proxy" 유지 (세션119 🔴 보안 수정 보존)

**세션120 (2026-04-19)** — App.jsx 훅 4분리 442→354줄 (3커밋 origin/main `7b52948..97bcb67`)
- 🟡 백로그 "App.jsx 442줄 → useAppState() 훅 분리" 해소. 보수 4훅 분리로 -88줄(-20%) 달성
- **신규 훅 4종**:
  - [useLoginGate.js](src/hooks/useLoginGate.js) 34줄 + test 5건 (커밋 `54818b9`) — showLoginPrompt/loginTrigger/pendingDetailId + 3핸들러
  - [useShareCallbacks.js](src/hooks/useShareCallbacks.js) 59줄 + test 6건 (커밋 `31b53d4`) — scoredMapRef 내부 관리 + 필터 10개 개별 prop
  - [useKakaoCallbackEffect.js](src/hooks/useKakaoCallbackEffect.js) 34줄 (커밋 `97bcb67`) — `[tab]` deps + eslint-disable 유지 명시
  - [useKeyboardShortcuts.js](src/hooks/useKeyboardShortcuts.js) 23줄 (커밋 `97bcb67`) — 1~5/Ctrl+Z/Escape 가드
- **Hook 호출 순서 조정**: useLoginGate를 useAppNavigation **앞**에 배치 (onLoginRequired 콜백이 setLoginTrigger 참조)
- [src/hooks/CLAUDE.md](src/hooks/CLAUDE.md) 호출 순서 섹션 갱신
- 9 GATE 1차 🟢6/🟡3 → 2차 보강 🟢9/🟡0/🔴0 통과 후 실행
- 검증: 150 files / **2418 tests PASS** (세션119 3차 후속 2407 → +11), `vite build` 486ms, 번들 불변

**세션119 3차 후속 (2026-04-19)** — sanitize 그룹 분리 + @vercel/analytics 2.0 (5커밋 origin/main)
- `/improve` 🟡 백로그 저리스크 2건 해소. 9 GATE 3차 🟢9/🟡0/🔴0
- **sanitize() 7그룹 분리** (커밋 `587826d`→`c5f704c`→`8ca6980`→`d704adf`): 193줄 단일 객체 → `sanitizeFallbackFlags`·`Basics`·`Benefits`·`Environment`·`Infra`·`Transport`·`Region`·`Transaction`·`NaverCross`·`Presale` 10헬퍼 + 4단독 인라인. 파일 303→363줄
- **스냅샷 테스트 선행**: 54필드 `toHaveProperty` 전수 검증 1건 추가(587826d)로 리팩토링 회귀 방어
- **@vercel/analytics 1.6.1→2.0.1** (커밋 `22434c2`): 메이저 업그레이드, `/react` subpath + `track()` 시그니처 유지로 **소스 수정 0파일**. peerDep react `^18||^19` 유지
- 검증: 148 files / **2407 tests PASS** (이전 2406 → +1), `vite build` 500ms, `npm audit` 0건, 번들 +0.54kB

**세션119 후속 (2026-04-19)** — 429 UX + 이메일 검증 공용화 + supabase-js 2.103 (5커밋 origin/main)
- `/improve` 🟡 3건 묶음 해소. 9 GATE 1차 🟢8/🟡1 → 단계 4 분할 후 🟢9/🟡0/🔴0
- **429 UX**: [src/hooks/useHistoryData.js](src/hooks/useHistoryData.js) · [src/services/staticDataApi.js](src/services/staticDataApi.js) 에 `res.status === 429` 분기 + 한국어 재시도 메시지 (커밋 `7b6d223`·`97b572e`)
- **이메일 검증 공용화**: [api/_lib/validators.js](api/_lib/validators.js) 신규 `isValidEmail()` — RFC 5322 정규식 + 254자 + 타입 가드. `auth/signup.js:13`·`login.js:12` 인라인 중복 제거 + `admin/review.js:72` 의 느슨한 `.includes("@")` 강화 (커밋 `1d4f3c3`·`295334c`). `bad@`·`@x.com`·TLD 1글자 차단
- **supabase-js**: 2.98→**2.103.3** 마이너 (커밋 `73b3295`). Node >=20 요구사항 충족(v24.14.1/Vercel Node 22)
- 검증: 148 files / **2406 tests PASS** (세션119 2385 → +21), `vite build` 512ms, `npm audit` 0건, 번들 +0.09kB

**세션119 (2026-04-19)** — 공개 API rateLimit + dompurify 취약 해소 (4커밋 origin/main)
- `/improve` 🔴 미션 1건 해소. 9 GATE 🟢8/🟡1/🔴0 통과 후 단계 1 6파일 → **1a/1b/1c 3분할** 재검증
- `api/supabase/{apartments,prices,unsold-history}.js`에 `rateLimit: "proxy"` (30/5분/IP) 각각 적용 — 커밋 `deef147`·`fb8ef69`·`a76b69f`
- 기존 `proxy: 30` LIMITS 키 재사용 (이미 8개 API에서 사용 중). 3개 테스트 파일에 `finlife/loans.test.js:8-10` 표준 mock 3줄 추가
- `npm audit fix` → dompurify 3.3.3 → **3.4.0** (GHSA-39q2-94rc-95cp, ADD_TAGS 우회 moderate). package.json 불변, lock만 갱신 — 커밋 `be54322`
- 검증: supabase 테스트 33/33 + 전체 2385/2385 PASS, `vite build` 406ms (번들 불변), `npm audit` 0건
- 🟡: 프론트 `staticDataApi.js:25`·`useHistoryData.js:25`가 429 전용 처리 없음 — 정상 사용자 30/5분 초과 가능성 낮음, 별도 에픽

**세션118 (2026-04-19)** — 수집기 부전 복구 (7커밋 origin/main)
- 9 GATE 초안 🔴3 → 재설계 후 🟢8/🟡1/🔴0
- [collect-naver-listings.yml](.github/workflows/collect-naver-listings.yml) concurrency 분리 (커밋 `082d0e2`) · [collect-unsold-kosis.mjs](scripts/collectors/collect-unsold-kosis.mjs) fetchWithRetry (커밋 `8328692`)
- 네이버 긴급 쿨다운 4종 (커밋 `74db0d0`): naver-listings MIN_INTERVAL 1→5s·PAGE_DELAY 1.5→3s·RETRY_DELAYS [10,20,40,60,120]s / naver-collect.py thr 1→5s / run-naver-local.bat `py -3`+`MIBUNYANG_PYTHON` env / GA timeout 30→60분
- 단계 3 재정의 (커밋 `3c969cb`): AIRKOREA/NEIS/SCHOOLINFO 3키 이미 등록됨(`gh secret list` 실측). 진짜 장애는 [collect-schools.yml](.github/workflows/collect-schools.yml) 매월 1일 UTC 20:00 3종 그룹 충돌. cron 1일→2일 + `school-collection` 그룹 분리
- 단계 4·5 스킵: 지방 17개 시도 trades 전부 존재 / compute-scores gap 7건은 `apartments_flat` VIEW dedup CTE `ORDER BY id DESC`가 "(오)" 오피스텔 우선 선택 (별도 에픽)
- 단계 6 B1 R² v1(+0.38)·v2(+0.29) 모두 게이트 0.7 실패 → 세션117 C 공식 확정 재확인
- regions NULL 4컬럼 실측: `population` 시군구 92.5% / 시도 부분 NULL, `households`·`jeonse_rate`·`supply_ratio` 0/454 (각각 수집기 부재·미저장·체인 차단)

**세션117 (2026-04-18)** — 시군구 소득 PoC `C (현상 유지)` 공식 확정 (docs-only)
- `.claude/plans/session117-sigungu-income-poc.md` (gitignored) 상태 전이
- 재오픈 트리거 4개: 왜곡 제보 / UX 잡음 / 경쟁사 도입 / 시도=시군구 지역 추가 왜곡

**세션116 (2026-04-18)** — 남은 과제 3개 정리 (전부 docs)
- `scripts/fix_sejong_coord.mjs` 처분 (DB 반영 확인 후 untracked 삭제)
- CLAUDE.md 행안부 문구 정정 (`migration.mjs` 세션103에서 KOSIS 전환 완료)
- 시군구 소득 PoC 설계 문서 작성 (A/B/C 비교, 추천안 C)

### 세션93~145 색인 (상세는 SESSION_LOG)

| 세션 | 날짜 | 핵심 변경 | 커밋 |
|------|------|----------|------|
| 145 | 04-28 | MapView 216→158줄 헬퍼 + SelectedAptCard 분리 (시계열 차트 격리) — 150 미달 8줄 인정 | `c1fbdaa` |
| 144 | 04-28 | primitives.jsx 154→91줄 LineChart 단독 분리 (시계열 차트 엔진 격리, re-export 11 소비자 0수정) | `79bdb1c` |
| 143 | 04-28 | DataSections 183→152줄 2자식 분리 (HighlightField + InfrastructureSection, detail/ 평면) — 150 미달 2줄 인정 | `276e15a` |
| 142 | 04-23 | ExpertLoginForm 191→121줄 SignupExtraFields 분리 — 150줄 미만 첫 달성 (sections/ 평면 배치) | `365dda4` |
| 141 | 04-23 | SearchFilterBar 257→184줄 PresetPanel 분리 (filters/ 폴더 6패널 구조 완성, 150 미달성 용인) | `de250f7` |
| 140 | 04-22~23 | InfoPage.jsx 267→60줄 4분할 (sections/info/ 서브폴더 신설, ScoringEngine·FAQSection·GuideSections) | `54ecea1`·`5408446` |
| 139 | 04-22 | building-hub HpPermitService 코드 제거(-61줄) + 정책 박제. 네이버 경로 단일화 + 미구독 확정 | `1434c2f`·`00280a9` |
| 132 | 04-20 | schools-neis neisCode/officeCode 저장 3줄 추가 (재조회 멱등성 보장). CI 반영은 5/3 이후 | `8b16d62` |
| 115 | 04-18 | sidoNotice 끝단 UI 실측 (Playwright 5/5 전문가 대시보드 DOM 노출) | `32f1885` |
| 114 | 04-18 | fairPriceFromSidoAvg 폴백 신뢰도 `-15` + 경고 접미. `PRICE_FALLBACK_RELIABILITY_PENALTY=15` 신규 | `ee85ce3`·`d1749b7`·`e6c48ec` |
| 112 | 04-17 | AptCard `classifyNoPrice` detail 일반 카드로 확장 | `d21ace9` |
| 111 | 04-17 | classifyNoPrice 8분기 → pir NULL 38건 100% 맞춤 안내 | - |
| 110 | 04-17 | collect-avg-income KOSIS DT_1C86→INH_1C96_04 (2022→2024p), PIR 평균 18.34년 | `03ca58b` |
| 109 | 04-17 | compute-scores 재실행 1,424건 반영 (세션108 PIR 구간) | `9bbab23` |
| 108 | 04-17 | scorePrice PIR 구간 재설계 ≤3/≤5/≤7 → ≤10/≤20/≤30. `PIR_SCORE_TIERS` 신규. 828건 쏠림 해소 | - |
| 107 | 04-17 | regions.avg_income 100% NULL 해소 + NATIONAL_MEDIAN_INCOME 5000→195 | `eb019ae` |
| 106 | 04-17 | price=0 오염 버그, pir NULL 50→38 | `fbf373b` |
| 105 | 04-16 | "가격 있는데 pir NULL" 7건 원인 확정 (naver-presale price=0 저장) | - |
| 104 | 04-16 | migration.mjs KOSIS fetchWithRetry + pir NULL 50건 분류 | - |
| 103 | 04-16 | migration.mjs 행안부→KOSIS DT_1B26001_A01 전면 전환. net_migration 454→0 | - |
| 99 | 04-16 | scorePrice price=0 devSc=97 오인 버그 수정 (종합점수 +6~7 왜곡 제거) | `0adc222` |
| 98 | 04-15 | transport-tago null/[]/[N] 3신호 분리 | `f91b0db` |
| 97 | 04-15 | apartments_flat.dataReliability VIEW 공식 강화 (bus_stop_names 판정), avg 88.38 | - |
| 96 | 04-15 | 서울 PIR NULL 57% 메모 검증 — 이미 해소 (9/266=3.4%) | - |
| 94 | 04-15 | 화성시 64건 gu 복합문자열 해소. nearbyMedian 65→15 | - |
| 93 | 04-15 | 세종 33건 nearbyMedian (statsKey 헬퍼 + 세종 화이트리스트) | `8ee1907` |

### 잔여 nearbyMedian NULL 10건 (세션114 실측, 전부 구조적 + avgSqm 폴백 경로)

- 인천 동구 2 (두산위브 더센트럴, 리아츠 더 인천 4차) — 섬 인접 공백
- 인천 옹진군 2 (백령1/연평 국민임대) — 섬, area=NULL → 폴백 무효
- 경기 가평군 3 (자라섬 수자인, 청평수자인더퍼스트, 썬밸리오드카운티)
- 경기 양평군 2 (우방아이유쉘 에코리버3차, 효성해링턴 플레이스)
- 경기 연천군 1 (수레울1단지 국민임대) — area=NULL

### 다음 세션 우선순위 (세션143+, 세션142 후속)

> 4/30 학교알리미 + 5/3 neisCode CI 외부 이벤트 대기 윈도우 (오늘 4/23 기준 일주일 남음). 내부 작업: 컴포넌트 150줄 미만 리팩토링 흐름 (세션140 InfoPage → 141 SearchFilterBar → 142 ExpertLoginForm) 이어가기.

1. 🟢 **남은 150줄+ 컴포넌트 분리 후보 7개** — 세션142 ExpertLoginForm 191→121 (150줄 미만 첫 달성) 흐름 계속:
   - SearchFilterBar 184 (세션141 이월, inline style 상수화 또는 추가 도메인 분리)
   - WeightEditor 233 (🔴 스코어링 상수 밀집)
   - MapView 216 (🟡 Kakao API)
   - DataSections 183 (🟢 detail/ 안전)
   - GuideSections 175 (분리 이득 미미, props 0)
   - AptCard 168 (🔴 memo 중심)
   - HeaderSection 161 (🟡)
   - DetailModal 154 (🟡)
2. 🥇 **2026-04-30 이후 학교알리미 재프로브** — `scripts/_tmp_schoolinfo_probe.mjs` 40줄 레시피 재작성(세션136 플랜 Phase 0 참조). 응답 정상이면 `collect-schools.yml` 5/3 정기 실행 대기, 응답 이상이면 Phase 1-A/B/C/D 분기. 사용자에게 SCHOOLINFO_KEY 로컬 `.env.local` 동기화 요청 선행 필요(`gh secret` write-only)
3. 🥈 **세션132 커밋 `8b16d62` 사후 확인 — 5/3 이후** — `collect-schools.yml` cron `'0 22 2 * *'` = 5/3 KST 07:00. 그 이후 `schools.nearby_schools[*].neisCode` 비율 쿼리(기대 >70%). 현재 0.0% (21,608 요소 중 0건)
4. 🟡 **unsold_history 시계열 축적 모니터링** — 매월 1일 KOSIS 수집 후 행수 증가 확인. 2~3개월 후 결측 패턴 분석 (현재 508×2개월, 향후 이상적으로 1,300×3개월 = 3,900행)
5. 🟡 **방향 B 검토** — 청약홈 API 가 단지별 월별 미분양 이력 제공하는지 조사. KOSIS 비례배분(세션134) 대비 정확도 개선 여지
6. 🟡 **collect-market-stats.mjs 시계열 복구 (세션135 신규 발견)** — 5지표 × (6개월+8분기) API 응답에서 최신값만 저장, 시계열 버림. 세션134 unsold_history 와 동일 패턴. 새 테이블 `market_stats_history` 신설 필요. **reader 부재라 긴급도 낮음**
7. 🟡 `population.mjs` MOIS 인구 API 안정성 모니터링 — 장애 시에만
8. 🟢 **이월 에픽 후보** (reader 부재라 낮은 우선순위): (a) `households` regions 수집기, (b) `trade-stats.mjs` 에 regions.jeonse_rate 파생 저장

**명시적 비-작업** (의도적 설계, 건드리지 말 것):
- **혜택 10컬럼 100% NULL** — 시행사 제공 자료 기반 운영자 수기 입력 (자동 수집 대상 아님)
- **시군구 소득** — 세션117 C 공식 확정, 재오픈 트리거 4개 발동 전 유지
- **ExpertLoginForm AuthStatusBanner/KakaoLoginButton 추가 분리** — 세션142 A안 채택 (작아서 분리 이득 미미)
- **sections/expert-login/ 서브폴더 신설** — 세션142 거부 (1파일은 평면 규칙)

### DB 품질 (세션133 전수 재측정 · 2026-04-20)

> 세션110/114/118 기록이 오래돼 세션133 에서 전수 재측정. 일부 지표는 자연 개선, 일부는 미해결 유지.

- **apartments 2,001건 → apartments_flat VIEW 1,424건** (dedup 577건 제외)
  - apartments.cats_cache NULL 7건 (0.3%), **apartments_flat.catsCache NULL 0건** — 세션118 "NULL 7건" 기록은 VIEW 기준 이미 해소
  - price = 0 **0건** (세션99 오염 버그 해소 유지), price NULL 38건 (2.7%)
  - dataReliability ≥80 **1,338건 (94.0%)** — 세션97 이후 소폭 개선 (1,317→1,338)
- **trade_stats 2,001건**: pir 98.0% / psr 64.1% / jeonse_rate 97.5% / nearby_median 99.2%
- **regions 454행 (시도 62 + 시군구 392)**:
  - avg_income **62/454 (13.7%)** — 시도 단위만. 세션110 "시도 17/17" 이 더 정확한 표현 (regions 테이블이 시도별 여러 recorded_at 스냅샷 포함)
  - population 420/454 (92.5%) — 시군구 부분 NULL
  - **net_migration / pop_growth 454/454 (100%)** — 세션103 KOSIS 전환 이후 전량 채워짐 (이전 기록 "454→0 NULL" 은 오표기)
  - **households / jeonse_rate / supply_ratio 0/454 유지** — reader 부재로 우선순위 낮음
- **apartments.air_quality 1,950/2,001 (97.5%)** — AIRKOREA 정상 수집
- **schools 1,971건 (apt 대비 98.5%)**:
  - school_score 1,971/1,971 (100%)
  - nearby_schools 요소 **21,608개** (세션135 페이지네이션 실측 · 세션133 "5,239" 는 supabase-js 기본 limit 1000 탓 과소): **neisCode 0% / students 0% / classes 1.4%** — 세션132 neisCode 저장 커밋 `8b16d62` 는 **다음 `collect-schools.yml` 정기 실행(5/3 KST 07:00) 후에야 반영**. students 는 학교알리미 API 수집이 세션89 이후 지속 실패
- **시계열 테이블**:
  - prices 3,633행 (apt당 평균 1.8행) · trades 608,713행
  - **unsold_history 1,099행** — 세션134 복구 완료. 508 apartments × 2개월 (202601/202602), KOSIS 1~2개월 지연 반영 정상. 매월 1일 자동 누적
- **혜택 10컬럼 (discountPct/loanFree/cashback/balcony 등) 100% NULL** — 🟡 의도적. 시행사 제공 자료 기반 운영자 수기 입력 대상. 자동 수집 대상 아님 (data-fill.mjs:46 `SKIP_CATEGORIES` 에 `benefits` 포함)
- **apartments_flat "(오)" 23→17건** — 세션134 migration 반영 완료 (`20260419000000_view_dedup_prefer_general.sql`, Supabase Dashboard 수동 실행). 일반분양 본체 6건이 VIEW 승자로 교체

---
---

## 아키텍처 개요

```
constants → scoring → theme → components → hooks → App    (단방향, 순환 참조 없음)
```

| 레이어 | 기술 | 핵심 모듈 |
|--------|------|----------|
| **프론트** | React 19 + Vite 8 (Rolldown) | App.jsx (~512줄), `@/` 경로 별칭, Pretendard 폰트 |
| **상태/훅** | useMemo 13개 체인 + useDeferredValue | useDataPipeline, useAppNavigation, useFilterSort |
| **컴포넌트** | memo() 36개 + icons.jsx (SVG 9개) | 소비자10 + 섹션8 + 상세7 + 필터8 + 전문가9 + 관리자3 |
| **API** | Vercel Serverless (21개 함수, `api/**/*.js` 테스트 제외) | withHandler HOF (CORS/Method/RateLimit/Admin 통합) |
| **DB** | Supabase PostgreSQL | 15개 테이블 + 2 VIEW + presale 19컬럼 |
| **인증** | SHA-256+salt, HMAC-SHA256 JWT | 카카오 OAuth + 전문가/관리자 role 기반 |
| **캐싱** | Vercel KV (Upstash Redis) | 세션, 토큰 블랙리스트, Rate Limit |
| **수집** | GitHub Actions (35개) + Windows 스케줄러 | 네이버(로컬 한국IP) + 공공API(Actions) |
| **테스트** | Vitest + Playwright E2E (11 spec) | `npm run test` / `npm run test:e2e` |
| **모니터링** | Vercel Analytics + Speed Insights | 페이지뷰/Web Vitals/커스텀 이벤트 (쿠키 없음) |

### 번들 구성

| 청크 | 크기 | 비고 |
|------|------|------|
| vendor (react+react-dom) | 190KB | 분리됨 |
| index (메인) | 172KB | |
| html2canvas + jsPDF | 200+400KB | dynamic import (초기 로딩 무관) |

---

## 환경변수

| 변수 | 용도 | 필수 | 비고 |
|------|------|------|------|
| `SUPABASE_URL` | DB 연결 | O | Vercel + .env.local |
| `SUPABASE_ANON_KEY` | 읽기 전용 | O | API 레이어 |
| `SUPABASE_SERVICE_KEY` | 쓰기 | O | GitHub Secrets / 로컬만 |
| `MOLIT_KEY` | data.go.kr 공공API | O | 일일 10,000건 공유 |
| `FINLIFE_API_KEY` | 금감원 금리 | - | 미등록 시 빈 배열 |
| `NEIS_KEY` | 교육청 학교 | - | 미등록 시 거리 기반만 |
| `SCHOOLINFO_KEY` | 학교알리미 학생수 | - | 미등록 시 스킵 |
| `AIRKOREA_KEY` | 에어코리아 대기질 | - | 별도 쿼터, MOLIT_KEY와 분리 |
| `KAKAO_REST_API_KEY` | 카카오 OAuth (서버) | O | VITE_KAKAO_JS_KEY와 분리 |
| `VITE_KAKAO_JS_KEY` | 카카오 (프론트) | O | 공개 키 |
| `KAKAO_REDIRECT_URI` | OAuth 콜백 URL | O | |
| `VITE_USE_SUPABASE` | DB 모드 전환 | - | `true` → Supabase, 아니면 로컬 JSON |

---

## 교차 관심사 (하위 CLAUDE.md에 없는 전역 규칙)

### 인증/세션
- admin 토큰 TTL 1h. 프론트 verify 폴링 15분 주기
- 토큰 블랙리스트: KV `bl:{hash}`, fail-open (만료가 2차 방어선)
- 로그아웃: 서버 토큰 무효화 + 프론트 sessionStorage 삭제
- 카카오 신규 사용자: role:"user", status:"approved" (승인 불필요)
- 카카오 KV: `user:{email}` + `kakao:{kakaoId}→email` 역참조 (TTL 90일)
- 카카오 탭 라우팅: role="user"→list, "expert"→expert, "admin"→admin

### 비로그인 블라인드
- AptCard: 점수 블러("??") + 상세/지도 LoginPromptModal
- CompareSheet: 점수 "??" 텍스트 치환 (CSS blur 아닌 DOM 미노출), export/공유 숨김
- LoginPromptModal Analytics: trigger prop (detail/map), 4개 이벤트

### React 성능 패턴
- useDeferredValue: 필터 5개 원시값 (filterRegion/filterGu/sortKey/moveInFilter/builderTier)
- useTransition: 정렬 변경 시 startSortTransition (useFilterSort.js)
- filterOptionCounts: 단일 패스 leave-one-out (5N→1N 최적화)
- AptListSection: IntersectionObserver 무한 스크롤 + "더 보기" 폴백
- App.jsx closeDetail 의존성: `[detail]` (React Compiler 호환)

### 데스크톱
- 키보드 단축키: 1~5 프로필, Ctrl+Z undo, Ctrl+Shift+Z redo, Escape 모달닫기
- 헤더 화이트 테마: C.borderStrong("#D1D5DB"), 모바일 borderBottom 1.5px

---

## 반응형 레이아웃

| 브레이크포인트 | 플래그 | 컨테이너 | 카드 그리드 | 네비게이션 |
|--------------|-------|---------|-----------|----------|
| <768px | 모바일 | 520px | 1컬럼 | 하단 BottomNav |
| 768~1023px | isPC | 960px | 2컬럼 (gap 16px) | 하단 BottomNav |
| 1024px+ | isDesktop | 1200px | 3컬럼 (gap 20px) | 상단 고정 바 60px |

- `useResponsive()` → `{ isPC, isDesktop }` (150ms 디바운스)
- isDesktop prop: App → HeaderSection, BottomNav, SearchFilterBar, AptListSection→AptCard, DetailModal, CompareSheet, MapView
- 롤백: useResponsive에서 `isDesktop: false` 고정 시 즉시 복원

---

## 공유 인프라 (mibunyang ↔ naver-estate-web)

| 자원 | 상세 | 주의사항 |
|------|------|---------|
| Supabase DB | mibunyang: `rwdtljipvmqpazrimyns` / naver-estate-web: `gcfckzqrcujktloilwpz` | 공용 테이블은 mibunyang DB |
| data.go.kr API Key | MOLIT_KEY | 일일 10,000건 공유 |
| 집 서버 IP | 192.168.219.101 (외부: Cloudflare Tunnel) | 네이버 rate limit 공유 |
| Vercel Team | `developer-dunos-projects` | 프로젝트별 환경변수/배포 독립 |

### 공유 규칙
- **테이블 소유권**: 공용 테이블 기존 컬럼 변경/삭제 금지 → `supabase/CLAUDE.md`
- **API 쿼터**: 일일 10,000회 분배 + 10일-토요일 충돌 방지 → `scripts/CLAUDE.md`
- **네이버 시간 분리**: mibunyang 08:00(월/목), naver-estate-web interval → `scripts/CLAUDE.md`
- **마이그레이션**: 공용 테이블 ALTER 전 상대 프로젝트 쿼리 검색 필수 → `supabase/CLAUDE.md`

---

## 개선 백로그 (2026-04-19 /improve 분석 결과)

> 상세 리포트: `~/.claude/plans/pwd-f-mibunyang-improve-report.md`
> 🔴 미션은 /blueprint 로 바로 실행. 🟡/🟢 는 3회 이상 /improve에서 반복 지적되면 🔴 승격.

### 🔴 즉시 (미션 1개 · 2단계)
- ~~**미션 1 — 공개 API 보안**: `api/supabase/{apartments,prices,unsold-history}.js`에 `rateLimit: "proxy"` 추가 + `npm audit fix`로 dompurify moderate 해소 (GHSA-39q2-94rc-95cp)~~ **완료 (세션119, 4커밋 `deef147..be54322`)**

### 🟡 곧 (이번 달 · 6건, 이 중 4건 완료)
- 의존성 메이저 업그레이드: `eslint 10` **🔴 차단** (세션125 에픽 3-A 조사: eslint-plugin-react 최신이 peer eslint ^9.7까지만 지원), ~~`@vercel/kv 3`~~ **완료 (세션130 에픽 4-C 커밋 `4a90768` — @vercel/kv 패키지 자체 제거, @upstash/redis@1.37.0 단독 사용)**, ~~`@vercel/analytics 2`~~ **완료 (세션119 3차 후속, 커밋 `22434c2`)**. Node 환경 핀(engines + .nvmrc)은 세션125 커밋 `6520ec9` 로 선행 완료
- ~~`@supabase/supabase-js` 2.98→2.103 마이너~~ **완료 (세션119 후속, 커밋 `73b3295`)**
- ~~`onClick={() => ...}` inline 클로저 75건(실측) → useCallback (ExpertDashboard 등 상위)~~ **부분 완료 (세션121 A, 커밋 `1ed7db3` — memo 자식 효과 확실한 6건 처리: ExpertDashboard.handleSelect + AdminDashboard 5건. 루프 28건·이미 적용 6건·trivial 다수는 의식적 배제)**
- ~~`admin/review.js:72` 이메일 `.includes("@")` → RFC 5322 정규식~~ **완료 (세션119 후속, 커밋 `1d4f3c3`·`295334c` — 공용 `isValidEmail()` 추출)**
- ~~`App.jsx` 442줄 → `useAppState()` 훅 분리 (250줄 목표)~~ **완료 (세션120, 3커밋 `54818b9..97bcb67`, 442→354줄 -88, 4훅 추출)**
- ~~`api/supabase/apartments.js` sanitize() 54필드 → 그룹별 분리~~ **완료 (세션119 3차 후속, 커밋 `587826d`→`d704adf` — 7헬퍼 + 스냅샷 테스트)**

### 🟢 여유 (분기 내 · 8건)
- inline `style={{...}}` **787건** → CSS 상수·className 전환 (대규모)
- ~~`LoanRatesSection:49` 금리 탭 Skeleton 보강~~ **완료 (세션122, 커밋 `88b7138` — `SkeletonText lines=4`)**
- ~~`AdminDashboard` 로딩 UI (`adminLoading` 상태 렌더링)~~ **완료 (세션122, 커밋 `88b7138` — `SkeletonList` statsLoading/adminLoading 2지점)**
- ~~저장 액션(가중치·프리셋) 토스트 피드백 추가~~ **완료 (세션121 C, 커밋 `9e52be8` — 4지점 useToast 적용: 가중치 저장/초기화, 프리셋 저장/삭제)**
- ~~`AdminDashboard` 412줄 → 매출탭/승인탭 분리~~ **완료 (세션138, 3커밋 `97d205a..cdfe592`, 417 → 96줄 -321/-77%)**. 실측 "매출탭" 부재 확인 → 실제 분리 축은 **StatsSection + UserCard + UserList 3분할**. admin 폴더 3 → 6컴포넌트. test 293줄 0수정
- ~~`InfoPage.jsx` 267줄 → sections/info/ 서브폴더 분리~~ **완료 (세션140, 2커밋 `54ecea1..5408446`, 267 → 60줄 -77%)**. sections/info/ 4파일 구조: GuideSections 175줄 / ScoringEngine 45줄 / FAQSection 33줄. InfoPage 60줄(시작하기 + 3 호출 + ExpertCTA). Public API·테스트 0수정
- ~~`src/scoring/engine.js`·`scorePrice.js` JSDoc 추가~~ **완료**: 세션122 에픽 2-A 커밋 `7b4b0ad` (engine·scorePrice·computeRegionalMedians 7함수) + 세션123 에픽 2-B1 커밋 `d314f2f` (scoreLocation·Product·Benefit 3함수) + 세션124 에픽 2-B2 커밋 `a2ea62e` (scoreRisk·scoreFuture 2함수 + matchAny + 5키워드 상수). **src/scoring/ 7파일 12식별자 JSDoc 시리즈 완성**.
- ~~`api/supabase/prices.js` ↔ `unsold-history.js` 중복 11줄 → 공통 헬퍼~~ **완료 (세션121, 커밋 `3cad834` — `createTimeseriesHandler` 팩토리 추출, 외부 동작 불변)**
- ~~`collect-building-hub.mjs:243,252` TODO 2건 (HpPermitService 구독 결정)~~ **완료 (세션139, 2커밋 `1434c2f..00280a9`)**. 네이버 경로로 `heat_fuel`·`quake_design` 수집 중 실측 확인 → HpPermitService 미구독 확정, fetchHeatFuel/fetchQuakeDesign 함수 2개 + 주석 블록 삭제(-61줄), scripts/CLAUDE.md 에 재오픈 트리거 3종 박제

---

## 서브디렉토리 규칙 파일

| 디렉토리 | 핵심 내용 |
|---------|----------|
| `src/scoring/CLAUDE.md` | 가중치 합계 100, 클램핑, null 처리, 스코어링 파이프라인 |
| `src/components/CLAUDE.md` | memo 36개, 접근성(ARIA/터치타겟/대비), 크로스브라우저 |
| `src/hooks/CLAUDE.md` | Hook 호출 순서, useMemo 의존성 13개, 파생 상태 |
| `api/CLAUDE.md` | JS null 함정, 한글 인코딩, Supabase 연동, withHandler 패턴 |
| `scripts/CLAUDE.md` | units 보정, 네이버 로컬 6단계, 후처리, API 쿼터 |
| `.github/workflows/CLAUDE.md` | 35개 워크플로우 목록, GitHub Secrets, 스케줄 |
| `supabase/CLAUDE.md` | 15개 테이블 스키마, 2 VIEW, presale 19컬럼, RLS 정책 |

---

## 작업 규칙 (Plan → Guard → Work → Review)

### Plan (새 기능/리팩토링 요청 시 자동 진입)
- 단계당 수정+신규 파일 **3개 이하**
- 단일 파일 **80줄 이내**(고위험 50줄), 단일 컴포넌트 **150줄 미만**
- **5파일+** 수정 시 반드시 단계 분리
- DB 변경과 API 변경은 **다른 단계**에서
- 한 단계에 "타입 + API + 컴포넌트" 동시 생성 금지
- 플랜 필수 포함: 파일 목록+참조처(grep 결과) / 실행 순서+의존 / 영향 범위 / 롤백 / 테스트 / 단계별 예상 줄 수

### 의존 분할 순서
DB 스키마 → 타입 → API → 훅/유틸 → 하위 컴포넌트 → 메인 컴포넌트 → 페이지 라우트

### Guard (위반 시 실행 금지)
- 5파일+ 수정 → 단계 분리
- DB 변경 → 롤백 마이그레이션 명시
- API 변경 → 사용하는 프론트 페이지 나열
- 새 기능 → **에러 처리 / 로딩 상태 / 빈 데이터 / 입력 검증 / 반응형(375px) / 중복 제출 방지** 필수
- "영향 없음" 판정은 **grep 결과 기반**만 인정

### Work
- 계획에 없는 파일 수정/리팩토링 금지 (하고 싶으면 "범위 초과" 표시 후 승인 대기)
- 단계 끝날 때마다 `npx vite build`
- 에러 자동 수정 **3회 실패** 시 중단+보고
- 새 코드에 한국어 주석으로 목적 설명, 기존 네이밍/패턴 따를 것

### Review (커밋 전 자동 수행)
1. **simplify** 스킬 — 변경 코드 재사용성/품질/효율 리뷰
2. **5교차검증 병렬 에이전트** — Task 도구로 **동일 메시지에서 동시 기동** (또는 `/cross-validate` 슬래시 커맨드 사용):
   - **빌드**: 메인 agent가 `npx vite build` 실행 + import 누락 + 번들 크기
   - **스코어링**: `Task(subagent_type="scoring-validator")` — 전용 서브에이전트 호출 **필수**. 메인이 직접 grep 금지
   - **null 안전성**: `Task(subagent_type="null-safety-checker")` — 전용 서브에이전트 호출 **필수**
   - **Hook 규칙**: 메인 agent가 직접 검사 (호출 순서·의존성·조건부 호출)
   - **보안**: 메인 agent가 직접 검사 (XSS·인젝션·env 노출·innerHTML·withHandler)
   - 수집기 관련 변경 시 추가로 `Task(subagent_type="collector-contract")` 호출
3. **SESSION_LOG.md 교차검증 섹션에 어느 에이전트가 찍었는지 기록** (예: "스코어링: PASS (scoring-validator)"). 에이전트 호출 이력이 없으면 "검증 미실행"으로 표기
4. console.log 잔재 제거
5. `git commit` + `git push` (자동)
6. CLAUDE.md "현재 진행 상황" 업데이트
7. `.claude/SESSION_LOG.md` 업데이트 (날짜별 누적, 삭제 금지, .gitignore 금지)

**금지**: 전용 에이전트가 존재하는 축(스코어링, null 안전성, 수집기 계약)을 메인 agent가 **직접 검사하는 것 금지**. 전용 에이전트가 있는데 우회하면 커버리지 누락·결과 비교 불가·SESSION_LOG 추적 불가.

### 안티패턴
1회용 유틸 금지 / 과도한 추상화 금지 / 추측 금지(도구 실행 결과만 인정) / 테스트는 새 기능당 정상 1 + 에러 1 최소

---

## 로컬 Claude 자원 (2026-04-14 리뉴얼)

### SESSION_LOG.md vs memory 역할 분리
- **`.claude/SESSION_LOG.md`** (커밋 추적): 과거 지향·불변. 날짜/커밋 SHA/결정 근거. 세션 종료 시 1회 append.
- **`~/.claude/projects/f--mibunyang/memory/`** (gitignored): 현재 지향·휘발. 진행 중 가설·다음 단계·TODO.
- **중복 금지**: 확정 사실은 SESSION_LOG로 이관 후 memory에서 삭제. 같은 사실 두 곳 작성 금지.
- CLAUDE.md "현재 진행 상황"은 한 줄 요약만 — 상세는 SESSION_LOG.

### 프로젝트 전용 슬래시 커맨드 (`.claude/commands/`)
- `/collect-naver` — 네이버 수집 + post-naver-collect 파이프라인
- `/score-recalc` — 점수 재계산 + PROFILES 가중치 합 sanity
- `/cross-validate` — simplify + 5교차검증 병렬 (Review 단계 자동화)
- `/db-quality` — apartments_flat 품질 지표 재측정

### 프로젝트 전용 서브에이전트 (`.claude/agents/`)
- `scoring-validator` — 가중치/클램핑/null 검증
- `null-safety-checker` — optional chaining·기본값·숫자 포맷 가드
- `collector-contract` — 수집기 배치/upsert/병렬/쿼터/에러 계약

### settings.json hooks (비차단 경고)
- `SessionStart`: cwd=mibunyang 확인 (D:\ 재발 방지)
- `PostToolUse(Edit|Write)`: 5파일+ 편집 감지 → `.build-dirty` 플래그
- `Stop`: build 상기 + 카운터/플래그 리셋

---

## 이 프로젝트에서 자주 쓰는 스킬

Claude는 스킬 리스트를 시스템 리마인더로 이미 받고 있음. 아래는 mibunyang에서 유독 자주 쓰는 것만 — 상황이 맞으면 추가 요청 없이 자동 호출:

- **`/engineering:debug`** — 재현 필요한 UI 버그, "X가 안 됨"
- **`/engineering:incident-response`** — 행안부 API 500/502 같은 외부 장애, 네이버 수집 실패 연쇄
- **`/data:sql-queries` · `/data:explore-data`** — Supabase 쿼리 작성, apartments_flat 품질 진단
- **`/data:analyze`** — price/unsoldRate 트렌드/세그먼트 조사
- **`webapp-testing`** — UI 변경 후 브라우저 검증 (Playwright, **필수**)
- **`frontend-design`** — 새 컴포넌트/섹션 작성 시 자동 발동. Pretendard · C.borderStrong · memo 36개 구조 일관성 유지
- **`/code-review:code-review`** — GitHub PR 리뷰 (로컬 5교차검증과는 별개)
- **`/engineering:tech-debt`** — price 64%/dataReliability 57.4% 같은 품질 갭 전략
- **`simplify` · `commit`** — 커밋 전 자동 (Review 단계에서 호출)
- **`session-report` + `/claude-md-management:revise-claude-md`** — 세션 마무리 시
