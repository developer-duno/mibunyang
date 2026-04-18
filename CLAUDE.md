# 미분양 아파트 비교 엔진 v3.0

> React 19 SPA + Supabase PostgreSQL + Vercel Serverless. 6개 카테고리 41+ 지표 AHP 스코어링.

## 현재 진행 상황


> 세션별 상세는 [.claude/SESSION_LOG.md](.claude/SESSION_LOG.md) 완전 보존. 이 섹션은 스캔용 색인.

### 최근 3세션 (상세)

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

### 세션93~115 색인 (상세는 SESSION_LOG)

| 세션 | 날짜 | 핵심 변경 | 커밋 |
|------|------|----------|------|
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

### 다음 세션 우선순위 (세션119+)

1. ~~가평·양평·옹진 dev 왜곡 정직성 보정~~ **완료 (세션114)**
2. ~~Vercel 12함수 감축~~ **불필요 (세션114, 21개로 Ready)**
3. ~~전문가 대시보드 sidoNotice 끝단 UI 실측~~ **완료 (세션115 Playwright 5/5)**
4. ~~시군구별 소득 수집~~ **C 공식 확정 (세션117)** — 재오픈 트리거 4개 발동 전 유지
5. ~~`fix_sejong_coord.mjs` 처분~~ **완료 (세션116)**
6. **`population.mjs` MOIS 인구 API 안정성 모니터링** — 장애 시에만 대응
7. **세션118 수동 dispatch(`collect-schools.yml` run 24609959606) 완료 후 NEIS 보강 실측** — `schools.nearby_schools`에 `neis_code`/`student_count` 키 추가 여부 확인
8. **새 에픽 후보**: (a) apartments_flat dedup 정책 `presale_stage='일반' 우선`, (b) `households` regions 수집기 신설, (c) `trade-stats.mjs`에 regions.jeonse_rate 파생 저장, (d) population.mjs 3-14/3-20 부분 NULL 재현

### DB 품질 (세션110/114/118 측정)

- **trade_stats 2,001건**: nearbyMedian 잔여 NULL 10건 (99.5% 커버)
  - pir 1,960건, 중앙값 16.85년, 평균 18.34년 (세션110 INH_1C96_04 2024p 반영)
- **apartments 2,001건**: cats_cache 1,994건 (99.7%), 평균 price 서브스코어 52.8점, PIR 서브스코어 평균 83.5점(90~100점 44.3%)
  - cats_cache NULL 7건 = VIEW dedup으로 제외된 "(오) 없는" 쪽 일반분양 (세션118 실측)
  - dataReliability 평균 88.38점 (세션97 강화 후), 80점↑ 1,317건(92.5%)
- **regions 454건**:
  - avg_income 시도 17/17 (세션110 INH_1C96_04 2024p, 205~269만원/월), 시군구 392건 NULL(trade-stats 시도값 fallback)
  - net_migration 454→0 NULL (세션103 KOSIS 전환)
  - population 시군구 420/454 (92.5%), 시도 3-14/3-20 스냅샷 부분 NULL
  - households / jeonse_rate / supply_ratio **0/454** (수집기 부재·미저장·체인 차단, 세션118 확정)
- **air_quality**: apartments 1,950/2,001 (97.5% 커버) — AIRKOREA 정상 수집
- **schools NEIS 보강**: 0% (세션89~세션118 이전 연속 cancelled). 세션118에서 cron/그룹 재배치로 복구 중 (run 24609959606 완료 대기)

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

### 🟡 곧 (이번 달 · 6건)
- 의존성 메이저 업그레이드: `eslint 10`, `@vercel/kv 3`, `@vercel/analytics 2`
- `@supabase/supabase-js` 2.98→2.103 마이너
- `onClick={() => ...}` inline 클로저 **131건** → useCallback (ExpertDashboard 등 상위)
- `admin/review.js:72` 이메일 `.includes("@")` → RFC 5322 정규식
- `App.jsx` 442줄 → `useAppState()` 훅 분리 (250줄 목표)
- `api/supabase/apartments.js` sanitize() 54필드 → 그룹별 분리

### 🟢 여유 (분기 내 · 8건)
- inline `style={{...}}` **787건** → CSS 상수·className 전환 (대규모)
- `LoanRatesSection:49` 금리 탭 Skeleton 보강
- `AdminDashboard` 로딩 UI (`adminLoading` 상태 렌더링)
- 저장 액션(가중치·프리셋) 토스트 피드백 추가
- `AdminDashboard` 412줄 → 매출탭/승인탭 분리
- `src/scoring/engine.js`·`scorePrice.js` JSDoc 추가
- `api/supabase/prices.js` ↔ `unsold-history.js` 중복 11줄 → 공통 헬퍼
- `collect-building-hub.mjs:243,252` TODO 2건 (HpPermitService 구독 결정)

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
