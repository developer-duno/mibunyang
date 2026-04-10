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
