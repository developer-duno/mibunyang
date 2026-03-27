# 미분양 아파트 비교 엔진 v3.0

> React 18 SPA + Supabase PostgreSQL + Vercel Serverless. 6개 카테고리 37+ 지표 AHP 스코어링.
> 상세 아키텍처는 ARCHITECTURE.md 참조.

## 기술 스택

- React 18 + Vite + `@/` 경로 별칭 — 프론트엔드
- `@/lib/classify.js` — 입주 상태/시공사 등급 분류 (MOVEIN_STATUS, TIER_LABELS)
- `@/lib/filterEngine.js` — 공통 base 필터 엔진 (applyBaseFilters)
- `@/lib/dedup.js` — 아파트 중복 제거 + siblingIds 생성 (dedupApartments)
- `@/lib/exportPdf.js` — 비교 결과 PNG/PDF 내보내기 (html2canvas + jsPDF dynamic import)
- `@/theme/index.js` — 디자인 토큰 (C 팔레트 + shadowSm/shadowMd + catCol + gr 등급함수)
- `@/hooks/useResponsive.js` — 반응형 훅 (isPC 768px+ / isDesktop 1024px+ / 150ms 디바운스)
- Supabase (PostgreSQL) — 데이터베이스 (14개 테이블 + apartments_flat VIEW)
- Vercel Serverless Functions (`api/`) — API 레이어
- Vercel KV (Upstash Redis) — 인증 세션
- GitHub Actions — 데이터 수집 (27개 워크플로우)
- Windows 작업 스케줄러 — 네이버 수집 자동화 (로컬 PC)

## 반응형 레이아웃

| 브레이크포인트 | 플래그 | 컨테이너 | 카드 그리드 | 네비게이션 |
|--------------|-------|---------|-----------|----------|
| <768px | 모바일 | 520px | 1컬럼 | 하단 BottomNav |
| 768~1023px | isPC | 960px | 2컬럼 | 하단 BottomNav |
| 1024px+ | isDesktop | 1200px | 3컬럼 | 상단 고정 바 (HeaderSection) |

- `useResponsive()` → `{ isPC, isDesktop }` (150ms resize 디바운스)
- 모바일 100% 유지, 데스크톱은 `isDesktop` 조건 분기로 격리
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
- `scripts/CLAUDE.md` — units 보정 파이프라인, 네이버 로컬 자동화, 후처리 파이프라인
- `.github/workflows/CLAUDE.md` — 워크플로우 목록, GitHub Secrets
- `supabase/CLAUDE.md` — 테이블 스키마 (14개 + VIEW)

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


# 플랜 모드 규칙 (모든 /plan에 자동 적용)

## 계획 작성 시 반드시 포함할 섹션:
1. **영향 범위** — 수정 파일 목록 + 해당 파일을 import하는 파일 목록
2. **실행 순서** — 의존 관계 기반 단계 구분
3. **위험 요소** — 사이드이펙트, 보안, 데이터 유실 가능성
4. **롤백 방법** — 문제 시 되돌리는 방법
5. **테스트 계획** — 완료 후 뭘 확인해야 하는지
6. 계획에 "영향받는 파일" 섹션을 반드시 포함할 것
7. 계획 제시 후 바로 실행하지 말 것

## 자동 검증 규칙:
- 5개 이상 파일 수정 시 → 단계를 나눠서 제시
- DB 변경 포함 시 → 마이그레이션 롤백 방법 명시
- API 변경 포함 시 → 영향받는 프론트 페이지 나열
- 새 기능 추가 시 → 에러 처리·빈 데이터·로딩 상태 포함 확인