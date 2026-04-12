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
