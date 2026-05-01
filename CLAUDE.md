# 미분양 아파트 비교 엔진 v3.0

> React 19 SPA + Supabase PostgreSQL + Vercel Serverless. 6개 카테고리 41+ 지표 AHP 스코어링.

## ⚠️ 사용자에게 말할 때는 무조건 쉬운 말로

글로벌 `~/.claude/CLAUDE.md`의 "쉬운 말 원칙"을 이 프로젝트에서도 그대로 따른다.
**대화창에 쓰는 모든 자연어는 초등학생도 알아들을 수 있게 풀어 쓴다.**

이 프로젝트에서 자주 등장하는 어려운 단어 → 쉬운 말 짝:

| 어려운 말 | 풀어 쓴 표현 |
|---|---|
| role / 역할 | "회원 종류 (일반 사용자 / 전문가 / 관리자)" |
| 탭 라우팅 / setTab | "어느 화면으로 보낼지 정하기" |
| JWT / 토큰 | "로그인 출입증" |
| OAuth / 콜백 | "카카오에 로그인 맡기고 결과 받아오기" |
| KV / 캐시 | "잠깐 저장해두는 메모장" |
| 리팩토링 | "기능은 그대로 두고 코드만 정리" |
| inline style 호이스팅 | "여기저기 흩어진 디자인 값을 한곳에 모으기" |
| RLS / 정책 | "DB에서 누구한테 보여줄지 정한 규칙" |
| 9 GATE | "위험 9가지 미리 체크" |
| 5교차검증 | "다섯 가지 관점으로 다시 보기" |
| 수집기 / collector | "공공·외부 사이트에서 자료 가져오는 스크립트" |
| 멱등성 | "여러 번 돌려도 결과 같음" |
| 마이그레이션 | "DB 구조 바꾸는 작업" |
| dedup | "중복 제거" |

규칙 적용 범위는 글로벌과 동일:
- ✅ 적용: 사용자에게 보내는 한국어 문장, 옵션 비교, 결론, AskUserQuestion 질문
- ❌ 미적용: 코드, 주석, 커밋 메시지, 변수명, bash 명령, 플랜 파일의 기술 섹션

**사건 기록 (2026-04-30 세션153):** 베타테스터 "카카오 로그인 후 전문가 화면" 보고를 조사한 뒤 결과를 보고할 때 "JWT 발급", "kakao:{id} 역참조", "ADMIN_EMAIL 오버라이드", "탭 라우팅" 같은 표현을 그대로 사용. 사용자 "쉽게 이야기해줘" 재지적. 글로벌 규칙은 있지만 이 프로젝트 단어들은 따로 풀려 있지 않아 같은 실수 반복 위험 → 프로젝트 CLAUDE.md 맨 위에 박제.

## 현재 진행 상황

> **세션별 상세** [.claude/SESSION_LOG.md](.claude/SESSION_LOG.md) — 세션 1~156 누적, append-only
> **다음 세션 시작점** [.claude/NEXT_SESSION.md](.claude/NEXT_SESSION.md) — 우선순위·사용자 과제·외부 이벤트·비-작업
> **DB 품질 스냅샷** [.claude/DB_QUALITY.md](.claude/DB_QUALITY.md) — 정기 측정 누적

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

## 개선 백로그

> [.claude/BACKLOG.md](.claude/BACKLOG.md) 참조. 🔴 미션은 /blueprint 로 바로 실행. 🟡/🟢 는 /improve 에서 3회 이상 반복 지적되면 🔴 승격.

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

## CLAUDE.md 유지 규칙 (비대화 방지)

CLAUDE.md는 매 세션 시스템 프롬프트로 자동 로드된다. **한 번 추가한 줄이 1,000번 컨텍스트로 읽힌다**고 간주하고 보수적으로 작성.

### 절대 추가 금지
- ❌ 세션별 상세 작업 내역 → `.claude/SESSION_LOG.md`
- ❌ 특정 커밋 해시 (예외: 영구 규칙 박제 근거 1~2건만)
- ❌ "사건 기록" 길게 풀어 쓴 내러티브 → 한 줄 + SESSION_LOG 링크
- ❌ DB 품질 측정값·테스트 수·번들 KB → `.claude/DB_QUALITY.md` / SESSION_LOG
- ❌ 다음 세션 우선순위 → `.claude/NEXT_SESSION.md`
- ❌ 백로그 미션 진행 상태 → `.claude/BACKLOG.md`

### 추가 가능 조건
다음 둘 다 만족할 때만 본문 추가:
1. **영구성**: 6개월 뒤에도 유효한 규칙·구조·전역 결정
2. **재발 방지 가치**: 같은 실수를 또 할 가능성이 충분히 높음

### 줄 수 가드
- **상한 350줄** — 초과 시 다음 세션 시작 시 자동 분리 작업 우선
- 새 섹션 추가 전 기존 섹션 통합 가능한지 먼저 검토
- "현재 진행 상황" 섹션은 **3줄 이하** (링크만)

### 분리 트리거
- CLAUDE.md 350줄 초과 → 즉시 분리 플랜
- 단일 섹션 50줄 초과 → 외부 파일 분리 검토
- "최근 N세션" 류 섹션 → 절대 본문에 두지 않음

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
