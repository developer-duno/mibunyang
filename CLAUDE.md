# 미분양 아파트 비교 엔진 v3.0

> React 18 SPA + Supabase PostgreSQL + Vercel Serverless. 6개 카테고리 34+ 지표 AHP 스코어링.
> 상세 아키텍처는 ARCHITECTURE.md 참조.

## 기술 스택

- React 18 + Vite + `@/` 경로 별칭 — 프론트엔드
- Supabase (PostgreSQL) — 데이터베이스 (9개 테이블 + apartments_flat VIEW)
- Vercel Serverless Functions (`api/`) — API 레이어
- Vercel KV (Upstash Redis) — 인증 세션
- GitHub Actions — 데이터 수집 (일/주/월 스케줄)

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
useState (2개: profile, tab) → 커스텀 훅 9개 → useMemo (6개) → useEffect (2개)
```
각 커스텀 훅 내부: useState → useRef → useCallback → useEffect 순서 보장.
React Rules of Hooks: 조건문 안에서 호출 금지, 순서 변경 금지.

### 3. useMemo 의존성 배열 (App.jsx)

| useMemo | 의존성 | 절대 누락 금지 |
|---------|--------|--------------|
| guOptions | [filterRegion, apartments] | apartments는 API 데이터 |
| scored | [apartments, profile] | apartments 의존 필수 |
| filtered | [scored, filterRegion, filterGu, sortKey] | 4개 전부 필수 |
| compItems | [compIds, scored] | 2개 전부 필수 |
| pw | [profile] | PROFILES[profile].w 참조 안정화 |
| regionOptions | [apartments] | apartments 의존 필수 |

### 4. showComp는 파생 상태

```js
const showComp = showCompOpen && compIds.length >= 2;
```
별도 useState가 아닌 **파생 값**. useEffect로 동기화하지 말 것.

### 5. UNSOLD[] → Supabase 전환

`src/constants/unsold.js`의 UNSOLD 배열은 빈 배열 (레거시).
실제 데이터: `VITE_USE_SUPABASE=true` → Supabase API, 아니면 `/data/apartments.json`.
참조: `src/services/staticDataApi.js`, `src/hooks/useApartmentData.js`.

---

## 교차 관심사 해결 패턴

| 훅 | 패턴 | 설명 |
|----|------|------|
| useExpertMode.handleExpertLogin() | `true`/`false` 반환 | App에서 `if (success) setTab("expert")` |
| useExpertMode.handleExpertLogout(onLogout) | 콜백 파라미터 | App에서 `() => { setTab("list"); setShowCompOpen(false); }` 전달 |
| useFilterSort({ onFilterChange }) | 콜백 옵션 | App에서 `() => setDetailAptId(null)` 전달 |
