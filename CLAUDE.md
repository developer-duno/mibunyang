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
  - `naver-units.yml` — 네이버 세대수 2차 보정 (매일, Node.js)
  - `collect-population.yml` — 행안부 인구 증감률 수집 (매월 5일)
  - `collect-housing-permits.yml` — 국토부 주택 인허가 공급비율 수집 (매월 10일)
  - `collect-migration.yml` — 행안부 전입/전출 순이동 수집 (매월 15일)
  - `collect-molit-units.yml` — 국토부 공동주택 총세대수 보정 (매월 1일/15일)
  - `collect-building-info.yml` — 국토부 건축물 상세정보 수집 (매월 10일)
  - `collect-infra.yml` — Kakao Places 인프라 수집 (매월 1일)
  - `collect-transport.yml` — Kakao Places 교통 수집 (매월 1일)
  - `collect-schools.yml` — Kakao Places 학교 수집 (매월 1일)
  - `collect-trade-stats.yml` — 거래 통계 산출 (매주 일요일)
  - `calc-exclusive-ratio.yml` — 전용률 계산 (매주 일요일)
  - `collect-dart-builders.yml` — DART 시공사 재무 수집 (매월 1일)
  - `collect-noise.yml` — 소음 추정 수집 (매월 1일)
  - `calc-layout.yml` — 평면구조 추정 (매주 일요일)
  - `collect-unsold-kosis.yml` — KOSIS 시군구별 미분양 수집 (매월 1일)

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
useState (4개: profile, customWeights, visibleCount, tab) + useTransition (1개) → useCallback → 커스텀 훅 12개 → useMemo (8개) → useEffect (5개) → useRef → useEffect → useCallback/useRef
```
각 커스텀 훅 내부: useState → useRef → useCallback → useEffect 순서 보장.
React Rules of Hooks: 조건문 안에서 호출 금지, 순서 변경 금지.

### 3. useMemo 의존성 배열 (App.jsx)

| useMemo | 의존성 | 절대 누락 금지 |
|---------|--------|--------------|
| guOptions | [filterRegion, apartments] | apartments는 API 데이터 |
| catsCache | [apartments] | apartments 의존 필수 |
| scored | [catsCache, profile, customWeights] | catsCache는 apartments 간접 의존 |
| filtered | [scored, filterRegion, filterGu, sortKey, budgetMin, budgetMax, searchText] | 7개 전부 필수 |
| visible | [filtered, visibleCount] | 페이지네이션용 |
| compItems | [compIds, scored] | 2개 전부 필수 |
| pw | [profile, customWeights] | customWeights 우선, PROFILES[profile].w 폴백 |
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
| `MOLIT_KEY` | 국토부 주택 인허가 + 공동주택 기본정보 API 키 (data.go.kr) |
| `KAKAO_KEY` | Kakao REST API 키 (혐오시설/환경/소음 수집 + 역지오코딩) |
| `DART_KEY` | DART 전자공시 API 키 (시공사 재무 수집) |
| `KOSIS_KEY` | KOSIS 국가통계포털 API 키 (미분양 수집) |

### 6. units 보정 파이프라인

`apartments.unit_source` 필드로 세대수 출처 추적:
- `"applyhome"` — 청약홈 API (기본, 부정확할 수 있음)
- `"molit"` — 국토부 공동주택 기본정보 API (1차 보정, 매월)
- `"naver"` — 네이버 부동산 totalHouseholdCount (2차 보정, 매일)

보정 대상: `units <= 1` 또는 `unsold_rate >= 100%`인 단지.
보정 시 `unsold_rate`도 재계산: `ROUND(unsold / new_units * 100, 1)`.

### 7. 데이터 소스

실제 데이터: `VITE_USE_SUPABASE=true` → Supabase API, 아니면 `/data/apartments.json`.
참조: `src/services/staticDataApi.js`, `src/hooks/useApartmentData.js`.
(레거시 `unsold.js` 및 미사용 API 스텁 5종 삭제 완료)

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

# 코드 리뷰 기준 (모든 코드 수정 시 적용)

## 필수 체크 항목
- 페이지·컴포넌트 간 연동 무결성
- 클린 코드 & SOLID 원칙 준수
- 프론트↔백엔드 타입 일관성
- 보안: XSS, Injection, 인증 우회 없을 것
- 수정 시 말로 설명 말고 코드로 직접 반영할 것

# 테스트 규칙

## 새 기능 추가 시
- 기능 코드와 함께 테스트 코드도 반드시 작성
- 최소: 정상 케이스 1개 + 에러 케이스 1개

## 테스트 코드 작성 기준
- 파일명: [대상].test.ts 또는 [대상].spec.ts
- 한국어 주석으로 "이 테스트가 뭘 검증하는지" 설명
- 테스트 데이터는 하드코딩 말고 팩토리 함수 사용

## 테스트 실행
- 전체: npm run test
- 특정 파일: npm run test -- --grep "파일명"
- E2E: npm run test:e2e
