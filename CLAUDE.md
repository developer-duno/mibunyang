# 미분양 아파트 비교 엔진 v3.0

> React 19 SPA + Supabase PostgreSQL + Vercel Serverless. 6개 카테고리 41+ 지표 AHP 스코어링.
> 상세 아키텍처는 ARCHITECTURE.md 참조.

## 현재 진행 상황

**마지막 작업**: 2026-04-08 세션75 — React 19 활용 + UX 개선 + 데이터 확장 + E2E 강화 + 기술 부채

- React 19: useDeferredValue(필터), useTransition(정렬), AptCard memo 커스텀 비교
- UX: Suspense fallback 스켈레톤, 빈 상태 필터 요약/완화 제안, 데스크톱 키보드 단축키(1~5/Ctrl+Z)
- 데이터: 대기질 PM2.5/PM10 표시, 치안 4-5등급 경고 배지
- E2E: 즐겨찾기/공유/금리비교/모바일 4개 추가 (7→11 spec)
- 기술 부채: chosung.js 제거, AdminDashboard→WeightEditor 분리 (451→223줄)

**다음에 해야 할 것** (우선순위):

1. (백로그 비어 있음 — 새 작업 대기)

**주의사항**:

- admin 토큰 TTL 24h→1h 전환됨. 프론트 verify 폴링 15분 주기로 최대 15분 후 감지
- admin API에 rateLimit 30회/5분 적용됨. useAdminMode.js에 429 처리 추가됨
- 빈 상태 스켈레톤 pulse 애니메이션은 document.createElement("style")로 keyframes 주입 (filterStyles.js BADGE_ANIM 패턴)
- 토큰 블랙리스트: KV `bl:{hash}` 키, fail-open (Redis 장애 시 토큰 만료가 2차 방어선)
- 로그아웃 시 서버 측 토큰 무효화 + 프론트 sessionStorage 삭제 (best-effort)
- review.js force-logout → status="suspended" + `users:suspended` Set 관리 → verify 폴링에서 자동 감지
- AdminDashboard: STATUS_TABS 5개 (pending/approved/rejected/suspended/all), approved→강제로그아웃, suspended→재승인
- 리프레시 토큰: 검토 완료 → 현상 유지 권고 (docs/refresh-token-review.md). 사용자 100명+ 또는 모바일앱 시 재검토
- finlife API: FINLIFE_API_KEY 환경변수 필요, 미등록 시 빈 배열 반환
- NEIS API: NEIS_KEY 환경변수 필요 (open.neis.go.kr), 미등록 시 NEIS 보강 스킵 (거리 기반만)
- 학교알리미 API: SCHOOLINFO_KEY 환경변수 필요 (schoolinfo.go.kr), 미등록 시 학생수 보강 스킵
- 에어코리아 API: AIRKOREA_KEY 환경변수 필요 (data.go.kr), 미등록 시 대기질 수집 스킵 (별도 쿼터, MOLIT_KEY와 분리)
- vite vendor 청크: react+react-dom 분리됨 (190KB), 메인 번들 160KB
- filterOptionCounts: 단일 패스 leave-one-out (5N→1N 최적화)
- AptListSection: IntersectionObserver 자동 무한 스크롤 + "더 보기" 버튼 폴백

## 기술 스택

- React 19 + Vite 8 (Rolldown) + `@/` 경로 별칭 — 프론트엔드 (Pretendard Variable 폰트 CDN)
- `@/components/icons.jsx` — 인라인 SVG 아이콘 9개 (IconClose, IconSearch, IconHelp, IconLocation, IconHeart, IconHeartFilled, IconCompare, IconShare, IconChevronDown, memo 래핑)
- `@/lib/classify.js` — 입주 상태/시공사 등급 분류 (MOVEIN_STATUS, TIER_LABELS)
- `@/lib/filterEngine.js` — 공통 base 필터 엔진 (applyBaseFilters, 검색 제거됨)
- `@/lib/dedup.js` — 아파트 중복 제거 + siblingIds 생성 (dedupApartments)
- `@/lib/analytics.js` — Vercel Analytics trackEvent 래퍼 (벤더 격리, try-catch)
- `@/lib/format.js` — 가격/날짜 포맷 (fmtPrice, fmtCompletion, fmtPriceRange, fmtPresaleSchedule, fmtRecruitDate)
- `@/lib/exportPdf.js` — 비교 결과 PNG/PDF 내보내기 (html2canvas + jsPDF dynamic import)
- `@/theme/index.js` — 디자인 토큰 (C 팔레트 + shadowSm/shadowMd + catCol + gr 등급함수)
- `@/components/filters/` — 필터 드롭다운 패널 7개 (FilterButton, FilterDropdown, RegionPanel, BudgetPanel, AreaPanel, SortPanel, DetailPanel) + filterStyles.js 공유 스타일 + 7개 테스트(61케이스)
- `@/hooks/useResponsive.js` — 반응형 훅 (isPC 768px+ / isDesktop 1024px+ / 150ms 디바운스)
- `@/hooks/useDataPipeline.js` — 데이터 파이프라인 훅 (useMemo 13개: apartments→scored→filtered→visible + visibleCount + SORTERS)
- `@/hooks/useAppNavigation.js` — 탭 전환/인증 네비게이션 훅 (useCallback 7개 + useRef 2개 + useEffect 2개)
- `@/hooks/useFinlifeRates.js` — finlife 금리 페칭 공통 팩토리 훅 (useLoanRates/useRentLoanRates 공유)
- `@/hooks/useLoanRates.js` — finlife 주택담보대출 금리 훅 (useFinlifeRates 래퍼, Map 권역별 캐싱)
- `@/hooks/useRentLoanRates.js` — finlife 전세자금대출 금리 훅 (useFinlifeRates 래퍼, 단일 캐싱)
- `@/constants/loanGroups.js` — 금융권역 코드-라벨 매핑 (LOAN_GROUPS, DEFAULT_GROUP)
- `@/components/detail/LoanRatesSection.jsx` — 금리비교 + 금융권역 탭 (은행/저축은행/보험/기타)
- Playwright E2E — 7스펙 (smoke/list/modal/compare/expert/skeleton-empty/admin), `npm run test:e2e`
- Supabase (PostgreSQL) — 데이터베이스 (15개 테이블 + 2 VIEW + presale 19컬럼)
- Vercel Serverless Functions (`api/`) — API 레이어
- `api/_lib/handler.js` — withHandler HOF (CORS/Method/RateLimit/Admin 통합, 14개 API 엔드포인트에서 사용)
- `api/_lib/rateLimit.js` — IP 기반 Rate Limit (Vercel KV, LIMITS: login:5/signup:5/verify:20/consult:10/admin:30/logout:10/proxy:30, WINDOW 5분, fail-close)
- `api/_lib/finlife.js` — finlife API 공통 모듈 (VALID_GROUPS, fetchFinlifeProducts — loans.js/rent-loans.js 공유)
- `api/_lib/tokenBlacklist.js` — JWT 토큰 블랙리스트 (SHA-256 해시, KV `bl:{hash}`, TTL=잔여만료, fail-open)
- `api/auth/logout.js` — 로그아웃 엔드포인트 (POST, 토큰 블랙리스트 등록, 멱등성)
- `api/finlife/loans.js` — 금융감독원 finlife 주택담보대출 금리 프록시 (GET, s-maxage=3600, FINLIFE_API_KEY 필요)
- `api/finlife/rent-loans.js` — 금융감독원 finlife 전세자금대출 금리 프록시 (GET, s-maxage=3600, FINLIFE_API_KEY 필요)
- Vercel Analytics + Speed Insights — 페이지뷰/Web Vitals/커스텀 이벤트 (쿠키 없음)
- Vercel KV (Upstash Redis) — 인증 세션
- GitHub Actions — 데이터 수집 (35개 워크플로우, monitor-db-size 포함)
- Windows 작업 스케줄러 — 네이버 수집 자동화 (로컬 PC, 한국 IP 필수)
- `scripts/collectors/naver-presale.mjs` — 네이버 분양정보 수집 (POST API, 19필드, 4단계 tier 매칭)
- `scripts/collectors/collect-trades.mjs` — 국토부 실거래가 수집 (매매/전세/분양권 3종)
- `scripts/collectors/_shared.mjs` — 수집기 공유 모듈 (19개 export)
- `scripts/collectors/_molit-api.mjs` — 국토부 공동주택 API 공유 (SIDO_CODE 17개, 재시도+유사도 매칭)
- `scripts/collectors/molit-building-info.mjs` — 건물 상세 (parking_ratio/max_floor/energy_grade 등)
- `scripts/collectors/molit-units.mjs` — 세대수 보정 (units≤1 대상)
- `scripts/collectors/collect-maintenance.mjs` — 관리비 (5항목 합산)
- `scripts/collectors/collect-childcare.mjs` — 어린이집/유치원 (Kakao 키워드 1km)
- `scripts/collectors/collect-emergency.mjs` — 응급의료기관 (haversine 10km)
- `scripts/collectors/collect-air-quality.mjs` — 에어코리아 대기질 (최근접 측정소 매칭)
- `scripts/collectors/collect-crime-safety.mjs` — 행안부 범죄등급 (로컬 CSV)
- `scripts/collectors/collect-police.mjs` — 경찰관서 밀도 (Kakao 3km, count+dist)

## 공유 인프라 (mibunyang ↔ naver-estate-web)

| 자원 | 상세 | 주의사항 |
|------|------|---------|
| Supabase DB | mibunyang: `rwdtljipvmqpazrimyns` / naver-estate-web: `gcfckzqrcujktloilwpz` | 공용 테이블은 mibunyang DB에 존재 |
| data.go.kr API Key | MOLIT_KEY (`8daf3599...`) | 일일 한도 10,000건 공유, 양쪽 IP 다름 |
| 집 서버 IP | 192.168.219.101 (외부: Cloudflare Tunnel) | 네이버 크롤링 rate limit 공유 |
| Vercel Team | `developer-dunos-projects` | 프로젝트는 별도 — 환경변수/배포 독립 유지 |

### 공유 인프라 규칙 (상세는 하위 CLAUDE.md 참조)

- **테이블 소유권**: 공용 테이블(complexes/articles/complex_price_history/trades) 기존 컬럼 타입 변경/삭제 금지 → `supabase/CLAUDE.md`
- **API 쿼터**: data.go.kr 일일 10,000회 분배 + 10일-토요일 충돌 방지 → `scripts/CLAUDE.md`
- **네이버 시간 분리**: mibunyang 08:00(월/목), naver-estate-web interval 기반 → `scripts/CLAUDE.md`
- **마이그레이션**: 공용 테이블 ALTER 전 상대 프로젝트 쿼리 검색 필수 → `supabase/CLAUDE.md`

## 반응형 레이아웃

| 브레이크포인트 | 플래그 | 컨테이너 | 카드 그리드 | 네비게이션 |
|--------------|-------|---------|-----------|----------|
| <768px | 모바일 | 520px | 1컬럼 | 하단 BottomNav |
| 768~1023px | isPC | 960px | 2컬럼 (gap 16px) | 하단 BottomNav |
| 1024px+ | isDesktop | 1200px | 3컬럼 (gap 20px) | 상단 고정 바 60px (HeaderSection) |

- `useResponsive()` → `{ isPC, isDesktop }` (150ms resize 디바운스)
- isDesktop prop 전달: App → HeaderSection, BottomNav, SearchFilterBar, AptListSection→AptCard, DetailModal, CompareSheet, MapView
- 모바일 100% 유지, 데스크톱은 `isDesktop` 조건 분기로 격리
- DetailModal: 데스크톱 760px, Radar 180px, IconClose, ARIA dialog
- CompareSheet: 데스크톱 확대 패딩/폰트, sticky thead
- MapView: 데스크톱 높이 calc(100dvh - 120px)
- 롤백: useResponsive에서 `isDesktop: false` 고정 시 즉시 복원

## 의존성 방향 (단방향, 순환 참조 없음)

```
constants → scoring → theme → components → hooks → App
```

## 서브디렉토리 규칙 파일

각 도메인별 상세 규칙은 해당 디렉토리의 CLAUDE.md에 분리:
- `src/scoring/CLAUDE.md` — 가중치 합계, 클램핑, null 처리, 키워드 그룹, 스코어링 파이프라인
- `src/components/CLAUDE.md` — memo, 접근성, 크로스브라우저, 전문가 페이지, 컴포넌트 구조
- `src/hooks/CLAUDE.md` — Hook 호출 순서, useMemo 의존성, 파생 상태, 교차 관심사 패턴
- `api/CLAUDE.md` — null 함정, 한글, Supabase 연동, 인증
- `scripts/CLAUDE.md` — units 보정 파이프라인, 네이버 로컬 자동화 (6단계), 후처리 파이프라인
- `.github/workflows/CLAUDE.md` — 워크플로우 목록, GitHub Secrets
- `supabase/CLAUDE.md` — 테이블 스키마 (15개 + 2 VIEW + presale 19컬럼)

## 데이터 소스

`VITE_USE_SUPABASE=true` → Supabase API, 아니면 `/data/apartments.json`.
참조: `src/services/staticDataApi.js`, `src/hooks/useApartmentData.js`.

---

## 작업 완료 후 필수 프로세스

### 5가지 교차검증 (병렬 에이전트)

작업 완료 후, **커밋 전** 반드시 5개 에이전트를 **동시에** 실행하여 교차검증:

| # | 에이전트 | 검증 항목 | 주요 체크 |
|---|---------|----------|----------|
| 1 | **빌드 검증** | `npx vite build` 성공 여부 | 빌드 에러, import 누락, 번들 크기 |
| 2 | **스코어링 무결성** | 가중치 합계 = 100, 클램핑 0~100 | PROFILES 5개, engine.js 내부 가중치, Math.min/max |
| 3 | **null 안전성** | null/undefined 가드 누락 탐지 | `?.`, `?? 0`, `|| []` 패턴, toLocaleString·toFixed 등 |
| 4 | **Hook 규칙** | React Rules of Hooks 준수 | 호출 순서, 의존성 배열, 조건부 호출 없음 |
| 5 | **보안 점검** | XSS, CSP, 인젝션, 민감정보 노출 | CSP 헤더, env 키 노출, innerHTML, dangerouslySetInnerHTML |

검증 결과에서 문제 발견 시 수정 후 재검증. 모두 통과하면 커밋+푸시.

### 커밋+푸시

모든 교차검증 통과 후 반드시 `git commit` + `git push` 수행. 별도 요청 없이도 자동 실행.

---

# 코드 리뷰 + 테스트 + 플랜 규칙

## 코드 리뷰 필수 항목
- 연동 무결성 + SOLID + 프론트↔백엔드 타입 일관성 + 보안(XSS/Injection)
- 수정 시 코드로 직접 반영, 추측 판정 금지 → 도구 실행 결과 기반만 인정

## 테스트 규칙
- 새 기능: 정상 1개 + 에러 1개 필수. 파일명: `[대상].test.js` / `[대상].spec.ts`
- 한국어 주석 + 팩토리 함수. 실행: `npm run test` / `npm run test:e2e`

## 플랜 모드 필수 섹션
영향 범위 → 실행 순서 → 위험 요소 → 롤백 → 테스트 계획. 5파일+ 시 단계 분리. DB 변경 시 롤백 SQL 명시.

## 수정 완료 자기 검증
1. 빌드 검증 (`npx vite build`) 2. 참조처 grep 3. console.log/TODO/민감정보 잔재 확인

## AI 안티패턴 방지
1회용 유틸 금지 / 과도한 추상화 금지 / console.log 커밋 금지
