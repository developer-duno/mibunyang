# 미분양 아파트 비교 엔진 v3.0

> React 19 SPA + Supabase PostgreSQL + Vercel Serverless. 6개 카테고리 41+ 지표 AHP 스코어링.

## 현재 진행 상황

**마지막 작업**: 2026-04-11 세션82 — 폰트 Phase 3-7 완료 + 관리자 일괄처리 + 네이버 후처리

- 폰트 가독성 Phase 3-7: 38파일 ~307건 fontSize → F 상수 전환 (전체 완료, feat/font-size 머지)
- 관리자 일괄 승인/거부: review.js 배열 지원 + useAdminMode batch + AdminDashboard 체크박스 UI
- 네이버 후처리: sync 성공, KOSIS 성공, naver-units 실패(rate limit), compute-scores 실패(ESM 로더)

**다음에 해야 할 것** (우선순위):

1. compute-scores.mjs ESM 로더 이슈 해결 (scorePrice 모듈 경로)
2. naver-units.mjs rate limit 해결 (또는 molit-units 대체)
3. migration.mjs 재실행 (행안부 API 2026년 데이터 제공 시) → net_migration

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
| **API** | Vercel Serverless (14개 엔드포인트) | withHandler HOF (CORS/Method/RateLimit/Admin 통합) |
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

### 공유 규칙 (상세는 하위 CLAUDE.md)

- **테이블 소유권**: 공용 테이블 기존 컬럼 변경/삭제 금지 → `supabase/CLAUDE.md`
- **API 쿼터**: 일일 10,000회 분배 + 10일-토요일 충돌 방지 → `scripts/CLAUDE.md`
- **네이버 시간 분리**: mibunyang 08:00(월/목), naver-estate-web interval → `scripts/CLAUDE.md`
- **마이그레이션**: 공용 테이블 ALTER 전 상대 프로젝트 쿼리 검색 필수 → `supabase/CLAUDE.md`

---

## 서브디렉토리 규칙 파일

| 디렉토리 | 핵심 내용 |
|---------|----------|
| `src/scoring/CLAUDE.md` | 가중치 합계 100, 클램핑, null 처리, 스코어링 파이프라인 |
| `src/components/CLAUDE.md` | memo 36개, 접근성(ARIA/터치타겟/대비), 크로스브라우저, 컴포넌트 구조 |
| `src/hooks/CLAUDE.md` | Hook 호출 순서, useMemo 의존성 13개, 파생 상태, 교차 관심사 패턴 |
| `api/CLAUDE.md` | JS null 함정, 한글 인코딩, Supabase 연동, 인증, withHandler 패턴 |
| `scripts/CLAUDE.md` | units 보정, 네이버 로컬 6단계, 후처리, API 쿼터, Rate Limit 정리 |
| `.github/workflows/CLAUDE.md` | 35개 워크플로우 목록, GitHub Secrets, 스케줄 |
| `supabase/CLAUDE.md` | 15개 테이블 스키마, 2 VIEW, presale 19컬럼, RLS 정책 |

---

## 작업 완료 후 필수 프로세스

### 5가지 교차검증 (병렬 에이전트)

커밋 전 반드시 5개 에이전트를 **동시에** 실행:

| # | 검증 | 주요 체크 |
|---|------|----------|
| 1 | **빌드** | `npx vite build` 성공, import 누락, 번들 크기 |
| 2 | **스코어링** | PROFILES 5개 가중치 합계 = 100, 클램핑 0~100 |
| 3 | **null 안전성** | `?.`, `?? 0`, `\|\| []` 패턴, toLocaleString/toFixed 가드 |
| 4 | **Hook 규칙** | 호출 순서, 의존성 배열, 조건부 호출 없음 |
| 5 | **보안** | XSS, 인젝션, env 키 노출, innerHTML |

검증 통과 후 `git commit` + `git push` 자동 수행.

### 코드 품질 규칙

- **리뷰**: 연동 무결성 + 프론트↔백엔드 타입 일관성 + 보안. 추측 금지 → 도구 실행 결과만 인정
- **테스트**: 새 기능 = 정상 1개 + 에러 1개 필수. 한국어 주석 + 팩토리 함수
- **플랜**: 영향 범위 → 실행 순서 → 위험 → 롤백 → 테스트. 5파일+ 시 단계 분리
- **안티패턴**: 1회용 유틸 금지 / 과도한 추상화 금지 / console.log 커밋 금지

---

# Claude가 자동 사용하는 스킬 (사용자 입력 불필요)

> 아래 스킬은 **Claude가 적절한 시점에 자동으로 실행**합니다. 사용자가 직접 명령어를 입력할 필요 없습니다.

| 스킬 | Claude가 자동 실행하는 시점 | 효과 |
|------|--------------------------|------|
| **simplify** | 코드 작성 완료 후, 커밋 전 | 변경 코드의 재사용성/품질/효율 자동 리뷰 + 수정 |
| **commit** | 모든 검증 통과 후 | git 변경사항 자동 커밋 + 푸시 |
| **loop** | 장시간 수집기 실행 시 | 주기적으로 로그 확인 (예: 5분마다 진행 상태 체크) |
| **schedule** | 정기 자동화 설정 요청 시 | cron 기반 원격 에이전트 생성/관리 |
| **claude-api** | anthropic SDK import 감지 시 | Claude API/SDK 코드 작성 지원 |
| **update-config** | 설정 변경 필요 시 | Claude Code settings.json 자동 설정 |

### 하네스 워크플로우에서의 자동 실행 흐름

```
사용자: "XXX 기능 만들어줘"
  ↓
Claude: 계획 수립 (Plan 모드 자동 진입)
  ↓ 게이트 검증 (Guard)
Claude: 코드 작성 (Work)
  ↓
Claude: simplify 자동 실행 (품질 리뷰)
  ↓
Claude: 교차검증 5단계 실행
  ↓
Claude: commit + push 자동 실행 (Review)
```

---

# 하네스 엔지니어링 규칙 (Plan → Guard → Work → Review)

## Plan: Sonnet 최적화 분할 (모든 계획에 최우선 적용)

> 사용자가 새 기능/리팩토링을 요청하면 Claude가 자동으로 Plan 모드 진입.

### 크기 기준

| 항목 | 허용 | 초과 시 |
|------|------|--------|
| 단계당 수정+신규 파일 | **3개 이하** | 단계 분리 |
| 단일 파일 변경 | **80줄 이내** (고위험 50줄) | 하위 컴포넌트 분리 |
| 단일 컴포넌트 | **150줄 미만** | 분리 계획 수립 |
| 동시 관심사 | **1가지** | 단계 분리 |

### 분할 순서 (의존 관계)

```
1. DB 스키마 (마이그레이션) ─ 독립
2. 타입 정의 ─ 독립
3. API 함수 ─ 독립
4. 공통 훅/유틸 ─ 각각 독립
5. 하위 컴포넌트 ─ 1개씩 독립
6. 메인 컴포넌트 ─ 독립
7. 페이지 라우트 + 통합 ─ 마지막
```

### 절대 금지
- 한 단계에 "타입 + API + 컴포넌트" 동시 생성
- 한 단계에 파일 4개 이상 수정
- DB 변경과 API 변경을 같은 단계에서 수행

### /plan 실행 시 필수 포함
1. 수정 파일 목록 + 각 파일의 참조처 (grep 결과 기반)
2. 실행 순서 + 의존 관계 명시
3. 영향 범위 + 깨질 수 있는 기존 기능
4. 롤백 방법 + 커밋 분리 전략
5. 테스트 계획
6. 모든 단계에 예상 줄 수 표시

---

## Guard: 가드레일 (위반 시 실행 금지)

- **5개+ 파일 수정** → 반드시 단계 분리
- **DB 변경** → 롤백 마이그레이션 필수 명시
- **API 변경** → 해당 API 사용하는 프론트 페이지 나열
- **새 기능** → 에러 처리 + 빈 데이터 + 로딩 상태 + 입력 검증 필수
- **추측 금지** → "영향 없음" 판정은 grep 결과 기반만 인정

---

## Work: 코드 작성 규칙 (모든 코드 작성 시 자동 적용)

> 코드 작성 완료 시 Claude가 자동으로 simplify 품질 리뷰 실행.

### 실행 규칙
- 계획에 없는 파일 수정 금지
- 계획에 없는 리팩토링 금지 (하고 싶으면 "범위 초과" 표시 후 승인 대기)
- 한 단계 끝날 때마다 `npx vite build` 실행
- 에러 시 자동 수정 3회 루프, 3회 실패 시 멈추고 보고

### 코드 작성 필수 포함 (빠뜨리면 안 됨)
- **에러 처리**: API 호출 → try-catch + 사용자 에러 UI
- **로딩 상태**: 데이터 fetch → isLoading 상태 + 스피너/스켈레톤
- **빈 데이터**: 목록 0건 → "데이터가 없습니다" UI
- **입력 검증**: 폼 → 빈 값, 형식, 길이 검증
- **반응형**: 모바일(375px) 기본 대응
- **중복 방지**: 제출 버튼 → disabled={isSubmitting}

### 수정 추적
- 새 파일/수정 파일마다 변경 내용 한 줄 요약
- 기존 프로젝트 네이밍/패턴/구조 따를 것
- 새 코드에 한국어 주석으로 목적 설명

---

## Review: 세션 마무리 규칙

> Claude가 자동으로 simplify → 교차검증 5단계 → commit 순서 실행.

### 작업 종료 시 Claude가 자동 수행
1. simplify 실행 — 변경 코드 품질 리뷰
2. `git status` — 미커밋 변경 확인
3. `npx vite build` — 빌드 검증
4. console.log 잔재 제거
5. commit + push — 자동 커밋
6. CLAUDE.md "현재 진행 상황" 업데이트

### SESSION_LOG 관리
- **위치**: `.claude/SESSION_LOG.md`
- 매 세션 종료 시 업데이트
- 이전 세션 로그는 날짜별 누적 (삭제 금지)
- `.gitignore`에 추가하지 말 것 (다른 기기에서도 이어하려면)

### 다음 세션 이어하기
- CLAUDE.md 상단의 "현재 진행 상황" 자동 참고
- 장시간 수집 실행 시 Claude가 loop 스킬로 자동 모니터링
