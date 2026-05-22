# 미분양 아파트 비교 엔진 v3.0

전국 미분양 아파트 1,557건을 6 카테고리 41+ 지표로 점수화·비교하는 React 19 SPA.

## 기술 스택

| 레이어 | 기술 |
|---|---|
| 프론트 | React 19 + Vite 8 (Rolldown) + TypeScript |
| 상태 | React Hooks (useMemo 13개 체인 + useDeferredValue) |
| API | Vercel Serverless 23개 배포 함수 (api/ 루트) |
| DB | Supabase PostgreSQL 15 테이블 + 2 VIEW |
| 인증 | SHA-256+salt, HMAC-SHA256 JWT, 카카오 OAuth |
| 캐싱 | Vercel KV (Upstash Redis) |
| 수집 | GitHub Actions 47개 워크플로우 (수집 44 + CI/E2E/Monitor 3) + Windows 스케줄러 |
| 테스트 | Vitest + Playwright E2E 13 spec |
| 모니터링 | Vercel Analytics + Speed Insights |

## 시작하기

```bash
npm install
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

환경변수는 [.env.example](.env.example) 참고. Supabase / Kakao OAuth / data.go.kr 등 키 필요.

## 구조

```text
src/
├── App.tsx                512줄 메인
├── components/            36개 memo 컴포넌트
├── hooks/                 useDataPipeline 등 13훅
├── scoring/               6 카테고리 가중치 엔진
├── constants/             타입·상수
└── theme/                 디자인 토큰

api/                       Vercel 함수 23개 배포 (withHandler HOF)
scripts/collectors/        50 수집기 + _shared/_molit-api 헬퍼 + .test.mjs (총 103 mjs)
.github/workflows/         47 워크플로우 (수집 44 + CI/E2E/Monitor 3)
supabase/                  71 마이그레이션 누적 + 현재 15 테이블 + 2 VIEW
```

## 데이터 흐름

GitHub Actions 가 일/주/월 스케줄로 외부 API (data.go.kr / 청약홈 / KOSIS / 카카오 / 네이버 등) 수집 → Supabase 15 테이블 적재. 프론트는 `/api/supabase/apartments` (운영) 또는 `/data/apartments-list.json` (정적 폴백) 로딩.

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

- [.claude/SESSION_LOG.md](.claude/SESSION_LOG.md) — 누적 세션 일지 (288+)
- [.claude/BACKLOG.md](.claude/BACKLOG.md) — 우선순위 백로그
- [.claude/WORK_RULES.md](.claude/WORK_RULES.md) — Plan → Guard → Work → Review 규칙
- [.claude/rules/](.claude/rules/) — 사고 박제 카탈로그 (TypeScript / Secret naming / KOSIS 차원 등)

## 라이선스

(미정 — private repository)
