# 미분양 아파트 비교 엔진 v3.0

> React 18 SPA + Supabase PostgreSQL + Vercel Serverless. 6개 카테고리 34+ 지표 AHP 스코어링.
> 상세 아키텍처는 ARCHITECTURE.md 참조.

## 기술 스택

- React 18 + Vite + `@/` 경로 별칭 — 프론트엔드
- Supabase (PostgreSQL) — 데이터베이스 (9개 테이블 + apartments_flat VIEW)
- Vercel Serverless Functions (`api/`) — API 레이어
- Vercel KV (Upstash Redis) — 인증 세션
- GitHub Actions — 데이터 수집 (일/주/월 스케줄)
  - `collect-naver-listings.yml` — 네이버 매물 수집 (매일)
  - `collect-population.yml` — 행안부 인구 증감률 수집 (매월 5일)
  - `collect-housing-permits.yml` — 국토부 주택 인허가 공급비율 수집 (매월 10일)
  - `collect-migration.yml` — 행안부 전입/전출 순이동 수집 (매월 15일)
  - `naver-units.yml` — 네이버 세대수 수집

## 의존성 방향 (단방향, 순환 참조 없음)

```
constants → scoring → theme → components → hooks → App
```

## 서브디렉토리 규칙 파일

스코어링/컴포넌트/API 관련 상세 규칙은 해당 디렉토리의 CLAUDE.md에 분리:
- `src/scoring/CLAUDE.md` — 가중치 합계, 클램핑, null 처리, 키워드 그룹
- `src/components/CLAUDE.md` — memo, 접근성, 크로스브라우저, 전문가 페이지
- `api/CLAUDE.md` — null 함정, 한글, Supabase 연동, 인증

---

## Critical Rules (공통)

### 1. 가중치 합계 = 100%

모든 프로필(5개)과 엔진 내부 가중치 합계 불변. 상세 테이블은 `src/scoring/CLAUDE.md` 참조.

### 2. Hook 호출 순서

App.jsx 내부:
```
useState (3개) + useTransition (1개) → useCallback → 커스텀 훅 12개 → useMemo (8개) → useEffect (4개) → useRef → useEffect → useCallback/useRef
```
각 커스텀 훅 내부: useState → useRef → useCallback → useEffect 순서 보장.
React Rules of Hooks: 조건문 안에서 호출 금지, 순서 변경 금지.

### 3. useMemo 의존성 배열 (App.jsx)

| useMemo | 의존성 | 절대 누락 금지 |
|---------|--------|--------------|
| guOptions | [filterRegion, apartments] | apartments는 API 데이터 |
| catsCache | [apartments] | apartments 의존 필수 |
| scored | [catsCache, profile] | catsCache는 apartments 간접 의존 |
| filtered | [scored, filterRegion, filterGu, sortKey, budgetMin, budgetMax, searchText] | 7개 전부 필수 |
| visible | [filtered, visibleCount] | 페이지네이션용 |
| compItems | [compIds, scored] | 2개 전부 필수 |
| pw | [profile] | PROFILES[profile].w 참조 안정화 |
| regionOptions | [apartments] | apartments 의존 필수 |

### 4. showComp는 파생 상태

```js
const showComp = showCompOpen && compIds.length >= 2;
```
별도 useState가 아닌 **파생 값**. useEffect로 동기화하지 말 것.

### 5. GitHub Secrets

| 시크릿 | 용도 |
|--------|------|
| `SUPABASE_URL` | Supabase 프로젝트 URL |
| `SUPABASE_SERVICE_KEY` | Supabase service_role 키 (쓰기용) |
| `MOIS_POP_KEY` | 행안부 주민등록 인구/전입전출 API 키 (data.go.kr) |
| `MOLIT_KEY` | 국토부 주택 인허가 API 키 (data.go.kr) |

### 6. UNSOLD[] → Supabase 전환

`src/constants/unsold.js`의 UNSOLD 배열은 빈 배열 (레거시).
실제 데이터: `VITE_USE_SUPABASE=true` → Supabase API, 아니면 `/data/apartments.json`.
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

## 교차 관심사 해결 패턴

| 훅 | 패턴 | 설명 |
|----|------|------|
| useExpertMode.handleExpertLogin() | `true`/`false` 반환 | App에서 `if (success) setTab("expert")` |
| useExpertMode.handleExpertLogout(onLogout) | 콜백 파라미터 | App에서 `() => { setTab("list"); setShowCompOpen(false); }` 전달 |
| useFilterSort({ onFilterChange }) | 콜백 옵션 | App에서 `() => setDetailAptId(null)` 전달 |
