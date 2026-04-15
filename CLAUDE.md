# 미분양 아파트 비교 엔진 v3.0

> React 19 SPA + Supabase PostgreSQL + Vercel Serverless. 6개 카테고리 41+ 지표 AHP 스코어링.

## 현재 진행 상황

**마지막 작업**: 2026-04-15 세션92 — `GU_LAWD_MAP` 지방 8개 region(강원/충북/충남/전북/전남/경북/경남/제주) 구/군 123개 법정동 5자리 매핑 추가. 9-GATE 🟢8/🟡1(쿼터)/🔴0 → dry-run 실측 3,474회(일 한도 34.7%)로 경고 해소. 단일 커밋 4파일(_shared.mjs +52, 테스트 2개, CLAUDE.md). 테스트 2,275→2,278 통과. null-safety-checker + collector-contract + scoring-validator PASS. 본 수집: `collect-trades` 349,924건 upsert(실패 0) → `trade-stats` nearby_median 실거래 933→**1,496건(+60%)** → `compute-scores` 1,424/1,424 성공. **KPI**: `nearbyMedian` NULL 491→**362건(34.5→25.4%)**, 전국 price 카테고리 평균 53.7→**56.65(+2.95pt)**, 제주 36.3→**63.7**·충북 31.6→**57.5**·전남·경남·경북·충남 +15~+28pt 대폭 해소. **잔여 3개 region**(강원/전북/세종)은 `apartments.gu` 원천 형식 문제 — 전북은 "전주시 덕진구" 복합 gu, 세종은 gu 40건 NULL, 강원은 원인 불명(매핑은 맞는데 trades 0). 세션93 우선 이월. 커밋 `0848aa2`.

**다음 세션 우선순위**:
1. 지방 3개 region 미해소 원인 조사 (강원 단일 region dry-run, 전북 복합 gu 처리, 세종 gu NULL 원천)
2. 서울 pir null 57% 원천 수집 이슈 점검
3. dataReliability 지표 개선 (유령 값 탐지 로직)
4. 행안부 API 복구 대기 (외부)
5. Vercel 12함수 제한 — 새 API 추가 시 action 파라미터로 통합

**DB 품질** (apartments_flat 1,424건, 세션92 측정): units 98.4% · lat/lng 99.9% · **price 100.0%** · unsoldRate 61.4% · subwayDist 79.0% · **nearbyMedian 74.6%**(491→362 NULL) · **price 카테고리 평균 56.65**(세션91 53.7→56.65, +2.95pt)

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

### 공유 규칙
- **테이블 소유권**: 공용 테이블 기존 컬럼 변경/삭제 금지 → `supabase/CLAUDE.md`
- **API 쿼터**: 일일 10,000회 분배 + 10일-토요일 충돌 방지 → `scripts/CLAUDE.md`
- **네이버 시간 분리**: mibunyang 08:00(월/목), naver-estate-web interval → `scripts/CLAUDE.md`
- **마이그레이션**: 공용 테이블 ALTER 전 상대 프로젝트 쿼리 검색 필수 → `supabase/CLAUDE.md`

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
