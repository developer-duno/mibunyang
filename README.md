# 미분양 아파트 비교 엔진 v3.0

전국 미분양·분양 예정 아파트를 **6 카테고리 41+ 지표로 AHP 점수화**하고 **5가지 사용자 프로필 가중치 (실거주·투자·신혼·교육·은퇴)** 를 적용해 개인 맞춤 추천을 제공하는 **다기준 의사결정 엔진**. React 19 SPA + Vercel Serverless + Supabase PostgreSQL.

핵심 차별점:

- 같은 단지여도 프로필마다 다른 점수 → "실거주 1위" 와 "투자 1위" 가 다름
- 시세 출처 3단 폴백 (실거래 1순위 → KOSIS 광역 평균 2순위 → 분양가 3순위) + 폴백 사용 시 `dataReliability −15` 페널티 + UI 정직 표시
- 3 사용자층 분리 (소비자 / 전문가 PC 1200px / 운영자) + 비로그인 점수 블라인드 ("??") 정책

## 기술 스택

| 레이어 | 기술 |
|---|---|
| 프론트 | React 19 + Vite 8 (Rolldown) + TypeScript |
| 상태 | React Hooks (useMemo 13개 체인 + useDeferredValue) |
| API | Vercel Serverless 25개 배포 함수 (api/ 루트) |
| DB | Supabase PostgreSQL 15 테이블 + 2 VIEW |
| 인증 | SHA-256+salt, HMAC-SHA256 JWT, 카카오 OAuth |
| 캐싱 | Upstash Redis (서버리스) |
| 수집 | GitHub Actions 40개 워크플로우 (수집·가공 35 + CI/E2E/배포/모니터 5) + Windows 스케줄러 |
| 테스트 | Vitest + Playwright E2E 14 spec (visual.spec.ts 시각 baseline 포함) |
| 모니터링 | Vercel Analytics + Speed Insights |

> ⚠️ 위 개수(API 함수·워크플로·spec)는 세션마다 늘어 낡는다. 단정 전 실측:
> `find api -name '*.ts' -not -path 'api/_lib/*' -not -name '*.test.ts' | wc -l` ·
> `ls .github/workflows/*.yml | wc -l` · `ls e2e/*.spec.ts | wc -l` (세션 485 drift 정정)

## 시작하기

### 5분 셋업 (신규 머신)

```bash
# 1. 저장소 복제
git clone https://github.com/developer-duno/mibunyang.git
cd mibunyang

# 2. 의존성 설치
npm install

# 3. 환경변수 설정 (필수)
cp .env.example .env.local
# .env.local 에디터로 열어 SUPABASE_*, KAKAO_*, MOLIT_KEY 채움
# 키 발급처: .claude/API_REGISTRY.md

# 4. 개발 서버 시작
npm run dev   # http://localhost:5173
```

### 자주 쓰는 명령어

```bash
npm run dev               # localhost:5173 개발 서버
npm run build             # 정적 빌드 (⚠️ 아래 경고 참고)
npm run preview           # 빌드 결과 로컬 미리보기
npm run test              # vitest 단위 테스트
npm run test:e2e          # Playwright E2E
npm run lint              # eslint src/
npm run typecheck         # tsc --noEmit (src/)
npm run typecheck:scripts # tsc --noEmit (scripts/)
npm run collect           # scripts/collect-data.mjs 직접 실행
npm run migrate:dry       # Supabase 마이그 dry-run
```

> **⚠️ 로컬 `npm run build` 주의**: prebuild 훅 ([scripts/prebuild.mjs](scripts/prebuild.mjs)) 가 `process.env.VERCEL` 미설정 시 `collect-data.mjs` 를 실행합니다. 첫 로컬 빌드는 외부 API 호출로 **5~30분 소요 + apartments.json 덮어쓰기 발생**. Vercel 환경 (`VERCEL=1`) 에서는 split 만 실행. 로컬 빌드 검증만 원하면 `npx vite build` 직접 호출 권장.

### 환경변수 안내

- 예시: [.env.example](.env.example) (필수/선택 구분 + 발급처 주석)
- 변수별 용도 카탈로그: [.claude/ENV_VARS.md](.claude/ENV_VARS.md)
- 외부 API 키 발급처 상세: [.claude/API_REGISTRY.md](.claude/API_REGISTRY.md)

**최소 셋업**: SUPABASE_* + KAKAO_* + MOLIT_KEY 만 채워도 앱 실행 가능. 나머지는 미등록 시 해당 기능만 폴백 (예: NEIS_KEY 미등록 → 학교 정보 거리 기반만).

## 구조

```text
src/
├── App.tsx                977줄 메인 (조립 ~450 + JSX ~520)
├── components/            84 tsx (React.memo 76)
├── hooks/                 useDataPipeline 등 31 파일
├── scoring/               6 카테고리 가중치 엔진
├── constants/             타입·상수
└── theme/                 디자인 토큰

api/                       Vercel 함수 25개 배포 (withHandler HOF)
scripts/collectors/        수집기 56 + _shared/_molit-api 헬퍼 + .test.mjs (총 113 mjs)
.github/workflows/         40 워크플로우 (수집·가공 35 + CI/E2E/배포/모니터 5)
supabase/                  87 마이그레이션 누적 + 현재 15 테이블 + 2 VIEW
```

## 데이터 흐름

GitHub Actions 가 일/주/월 스케줄로 외부 API (data.go.kr / 청약홈 / 카카오 / 네이버 등) 수집 → Supabase 15 테이블 적재. KOSIS 계열 10종은 kosis.kr 해외 IP 차단(세션 288~289)으로 집서버 로컬 러너 (`scripts/kosis-local-runner.mjs`, 매일 05:30 KST) 가 수집. 프론트는 `/api/supabase/apartments` (운영) 또는 `/data/apartments-list.json` (정적 폴백) 로딩.

상세는 [ARCHITECTURE.md](ARCHITECTURE.md) 참고.

## 공유 인프라

본 저장소는 [naver-estate-web](https://github.com/developer-duno/naver-estate-web) 과 다음 자원 공유:

- Supabase DB (rwdtljipvmqpazrimyns)
- data.go.kr API 키 (MOLIT_KEY, 일 10,000회)
- 집 서버 IP (Cloudflare Tunnel)
- Vercel Team (developer-dunos-projects)

마이그레이션·쿼터 분배 등 상세는 [CLAUDE.md](CLAUDE.md) 참고.

## AI 협업 컨텍스트

본 저장소는 Claude Code 기반 개발. 진행 상황·작업 규칙·세션 일지는 [.claude/](.claude/) 디렉토리에 누적:

- [.claude/SESSION_LOG.md](.claude/SESSION_LOG.md) — 누적 세션 일지 (1~354 아카이브, 296+ 는 글로벌 메모리가 진실의 원천)
- [.claude/BACKLOG.md](.claude/BACKLOG.md) — 우선순위 백로그
- [.claude/WORK_RULES.md](.claude/WORK_RULES.md) — Plan → Guard → Work → Review 규칙
- [.claude/rules/](.claude/rules/) — 사고 박제 카탈로그 (TypeScript / Secret naming / KOSIS 차원 등)

## 라이선스

(미정 — private repository)
