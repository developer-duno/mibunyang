# 미분양 아파트 비교 엔진 v3.0

> **다기준 의사결정 엔진** — 미분양·분양 예정 아파트를 6 카테고리 41+ 지표로 AHP 점수화하고 5가지 사용자 프로필 가중치 (실거주·투자·신혼·교육·은퇴) 를 적용해 개인 맞춤 추천 제공. 같은 단지여도 프로필마다 다른 점수. React 19 SPA + Vercel Serverless + Supabase PostgreSQL.

## 즉시 알아야 할 것 (항상 로드 가치)

- **사용자 대화 시 쉬운 말 원칙** — 자세히는 [.claude/EASY_WORDS.md](.claude/EASY_WORDS.md)
- **현재 진행 상황** — 세션 296+ 이력은 글로벌 메모리 `~/.claude/projects/f--mibunyang/memory/` (MEMORY.md 인덱스 + session_*.md) 가 진실의 원천. 과거 세션 1~354 = [.claude/SESSION_LOG_ARCHIVE_2026H1.md](.claude/SESSION_LOG_ARCHIVE_2026H1.md) · [.claude/SESSION_LOG.md](.claude/SESSION_LOG.md) (스텁) · [.claude/DB_QUALITY.md](.claude/DB_QUALITY.md) · [.claude/BACKLOG.md](.claude/BACKLOG.md) · `.claude/NEXT_SESSION.md` (개인 로컬, git 미추적)
- **새 작업 시작 시 작업 규칙** — [.claude/WORK_RULES.md](.claude/WORK_RULES.md) (Plan→Guard→Work→Review · **구현자·검사관 모델 사다리** 절 — 2026-09-26 글로벌 개정 반영)
- **CLAUDE.md 본문 편집 전 메타 규칙** — [.claude/META_RULES.md](.claude/META_RULES.md) (비대화 방지, 상한 150줄)
- **환경변수 / 로컬 자원 / 자주 쓰는 스킬** — [.claude/ENV_VARS.md](.claude/ENV_VARS.md) · [.claude/LOCAL_RESOURCES.md](.claude/LOCAL_RESOURCES.md) · [.claude/SKILLS.md](.claude/SKILLS.md)
- **외부 API 키 발급처 + 도구 카탈로그** — [.claude/API_REGISTRY.md](.claude/API_REGISTRY.md) · [.claude/CLAUDE_TOOLBOX.md](.claude/CLAUDE_TOOLBOX.md)
- **운영 데이터를 바꾸는 실행 · DB 권한 변경** — 반영 전 전이표 승인 [.claude/rules/collectors/data-changing-run-approval.md](.claude/rules/collectors/data-changing-run-approval.md) · 권한은 감시 ⑩ 이 승인된 기준선(지문)과 매주 비교하므로 의도한 변경 뒤엔 `scripts/perm-baseline.mjs` 로 기준선 재승인

## 명령 (검증 가드)

```bash
npm run dev               # localhost:5173
npm run build             # 빌드 (⚠️ prebuild 가 public/data JSON 재생성 → 커밋 금지, git checkout 원복)
npm run test              # vitest 단위 (src spec + scripts/**/*.test.{js,mjs} — vitest.config 의 node 프로젝트, 정적 가드 포함)
npm run test:e2e          # Playwright E2E (e2e spec)
npm run lint              # eslint src/
npm run typecheck         # tsc --noEmit (src)
npm run typecheck:scripts # tsc -p tsconfig.scripts.json (scripts/*.mjs)
npm run typecheck:e2e     # tsc -p e2e/tsconfig.e2e.json (e2e/*)
npm run format            # prettier --write src/
npm run format:check      # prettier --check src/ (CI 게이트, endOfLine auto 라 로컬 CRLF 도 통과)
```

> CI(`ci.yml`) = lint → format:check → typecheck×3 → audit×12(env-key·monitor·collector·fill-matrix·orphan-collectors·hooks-wiring·declared-deps·playwright-cache·cron-concurrency·node-esm-chain·rules-paths·customer-facing-excuses) → test → build. 머지 전 전부 green 필수. ⚠️ 개수는 늘어난다 — 단정 전 `grep -oE 'scripts/audit-[a-z-]+\.mjs' .github/workflows/ci.yml | sort -u | wc -l` 로 실측(`node-esm-chain` 은 `--loader` 를 거쳐 실행돼 `run: node scripts/audit-` 만 세면 빠진다).

## 아키텍처 개요

```
constants → scoring → theme → components → hooks → App    (단방향, 순환 참조 없음)
```

| 레이어 | 기술 | 핵심 모듈 |
|--------|------|----------|
| **프론트** | React 19 + Vite 8 (Rolldown) | App.tsx, `@/` 경로 별칭, Pretendard 폰트 |
| **상태/훅** | useMemo 체인 + useDeferredValue | useDataPipeline, useAppNavigation, useFilterSort |
| **컴포넌트** | React.memo 다수 + icons.tsx (SVG) | 소비자/홈/섹션/상세/필터/관리자 그룹 — 섹션 KakaoMapView 점 보기 지도 + MapView 패스스루(네이버 세션 449 전면 제거[카카오 단일화]·GPS 내 동네), 상세 ProfileWeightBar, 홈 RecentlyViewedWidget, 전문가 그룹 세션 405 폐지. 정확한 개수·구성은 `src/components/CLAUDE.md` 참조 |
| **API** | Vercel Serverless (25개 함수) | withHandler HOF (CORS/Method/RateLimit/Admin 통합). Redis 순단 fail-open 차등(login·subscribers만 fail-close, 세션 427) |
| **DB** | Supabase PostgreSQL | **20+ 테이블**(옛 "15개" 박제는 세션 498 실측으로 stale 확인) + 2 VIEW + presale 19컬럼 |
| **인증** | SHA-256+salt, HMAC-SHA256 JWT | 카카오 OAuth(손님) + 관리자(ADMIN_EMAIL) — 전문가 role 세션 405 폐지. 손님 마케팅 수신 동의·전화번호(선택, VITE_KAKAO_PHONE_SCOPE 토글) 수집 세션 427 |
| **캐싱** | Upstash Redis (서버리스) | 세션, 토큰 블랙리스트, Rate Limit |
| **수집** | GitHub Actions (KOSIS·childcare 로컬 이전) + Windows 스케줄러 | 네이버(로컬 한국IP) + 공공API(Actions) |
| **테스트** | Vitest + Playwright E2E | `npm run test` / `npm run test:e2e` |
| **모니터링** | Vercel Analytics + Speed Insights | 페이지뷰/Web Vitals/커스텀 이벤트 |

번들: vendor 190KB / index ~212KB (2026-07-03 실측) / html2canvas+jsPDF 200+400KB(dynamic import).

> ⚠️ 위 개수(API 함수·워크플로·spec·**테이블**)는 세션마다 늘어 낡는다. **단정 전 실측**: `find api -name '*.ts' -not -path 'api/_lib/*' -not -name '*.test.ts' | wc -l` · `ls .github/workflows/*.yml | wc -l` · `ls e2e/*.spec.ts | wc -l` (세션 485 drift 3건 정정). **테이블 수는 마이그레이션 grep 으로 못 센다**(CREATE/DROP 혼재·rename 이력) — Dashboard 또는 `sb.from('<이름>').select('*',{count:'exact',head:true})` 로 존재를 하나씩 확인해야 한다. 세션 498 실측 = 옛 "15개" 박제가 최소 20개로 stale.

## 공유 인프라 (mibunyang ↔ naver-estate-web)

| 자원 | 상세 | 주의사항 |
|------|------|---------|
| Supabase DB | 공유 인스턴스 `rwdtljipvmqpazrimyns`(대시보드 이름 "네이버에스테이트") — 미분양 데이터 + 2u backend `DATABASE_URL`·2u 로그인(Supabase Auth)이 모두 여기(2026-09-23 실측). `gcfckzqrcujktloilwpz` 는 프로젝트는 살아 있으나 2u 설정·번들에서 참조 0 | 공용 테이블은 이 DB · anon key 는 2u 번들에 공개 → `supabase/CLAUDE.md` |
| data.go.kr API Key | MOLIT_KEY | 일일 10,000건 공유 |
| 집 서버 IP | 192.168.219.101 (외부: Cloudflare Tunnel) | 네이버 rate limit 공유 |
| Vercel Team | `developer-dunos-projects` | 프로젝트별 환경변수/배포 독립 |

- **테이블 소유권**: 공용 테이블 기존 컬럼 변경/삭제 금지 → `supabase/CLAUDE.md`
- **API 쿼터**: 일일 10,000회 분배 + 10일-토요일 충돌 방지 → `.claude/rules/scripts/api-quota-and-ratelimit.md`
- **네이버 시간 분리**: mibunyang 08:00(월/목), naver-estate-web interval → `.claude/rules/scripts/local-runners.md`
- **마이그레이션**: 공용 테이블 ALTER 전 상대 프로젝트 쿼리 검색 필수 → `supabase/CLAUDE.md`

## 서브디렉토리 규칙 (해당 디렉토리 작업 시 자동 로드)

| 디렉토리 CLAUDE.md | 핵심 내용 |
|---|---|
| `src/scoring/` | 가중치 합계 100, 클램핑, null 처리, 스코어링 파이프라인 |
| `src/components/` | React.memo 컴포넌트군, 접근성, **반응형 레이아웃**, **데스크톱 키보드/테마** |
| `src/hooks/` | Hook 호출 순서, 의존성 13개, **React 성능 패턴** (useDeferredValue/useTransition) |
| `api/` | JS null 함정, 한글 인코딩, withHandler, **인증/세션 KV**, **비로그인 블라인드 정책** |
| `scripts/` | units 보정, 네이버 로컬 6단계, 후처리, API 쿼터 |
| `.github/workflows/` | 워크플로우 목록, GitHub Secrets, 스케줄 |
| `supabase/` | 테이블(20+) + 2 VIEW + presale 19컬럼, RLS 정책 |

## `.claude/rules/` — 상시 14개 + on-demand 18개 색인 (세션551·568·571)

32개 중 18개에 `paths` 를 붙여 **그 파일을 읽을 때만** 로드되게 했다(상시 로드분 −70KB,
세션568 에 `scripts/CLAUDE.md` 8개 절 분리로 +8).
⚠️ **파일을 안 읽고 `node -e` 로 DB 만 만지는 세션에서는 아래 16개가 안 불려온다** —
해당하는 일을 한다면 그 규칙 파일을 직접 Read 할 것.

| on-demand 규칙 | 언제 필요한가 | paths |
|---|---|---|
| `meta/typescript-patterns` | `// @ts-check` 활성화·JSDoc cast·tsc 에러 처방 | `scripts/**/*.mjs`, `**/*.test.*`, `tsconfig*` |
| `meta/guards-must-be-mutation-tested` | 새 테스트·감사 스크립트·CI 스텝을 **만들기 전** | `**/*.test.*`, `scripts/audit-*.mjs`, `ci.yml` |
| `meta/score-meaning-and-wording-are-a-pair` | 점수 축의 **의미**를 바꿀 때(문구표도 같이) | `src/scoring/**`, `src/constants/**`, `src/components/**` |
| `meta/composition-root-not-bloat` | "파일이 N줄이라 쪼개자" 판단 전 | `src/App.tsx`, `src/hooks/**` |
| `collectors/graceful-shutdown-coverage` | 수집기에 SIGTERM break 박을 때 | `scripts/collectors/**/*.mjs` |
| `collectors/parsegu-normalization` | 행안부 시군구·SIDO 코드 다룰 때 | `population*.mjs`, `_shared.mjs`, `migration.mjs` |
| `collectors/kosis-dimension-mismatch-guard` | KOSIS 통계표 차원 가정 전 raw sample | `*kosis*.mjs`, `medical-access`, `market-stats` |
| `collectors/external-file-duplicate-rows` | 외부 파일의 중복 등재·상한(cap) 설계 | `transport-*.mjs`, `infra-*.mjs` |
| `scripts/units-correction` | molit-units·naver-presale·seeding 수정 | `scripts/collectors/molit-units.mjs` 등 |
| `scripts/molit-collectors` | `_molit-api`·molit-*·maintenance·building-hub 수정 | `scripts/collectors/_molit-api.mjs` 등 |
| `scripts/local-runners` | 로컬 러너·스케줄러 등록·시간 분리 확인 | `scripts/kosis-local-runner.mjs` 등 |
| `scripts/api-quota-and-ratelimit` | 새 API 호출 추가·쿼터 계산 | `scripts/collectors/_molit-api.mjs` 등 |
| `scripts/transport-collector` | transport-tago.mjs 수정 | `scripts/collectors/transport-tago.mjs` |
| `scripts/geocoding-fallback` | geocode-missing·reverse-geocode·fix-placeholder-addresses 수정 | `scripts/collectors/geocode-missing.mjs` 등 |
| `scripts/declared-deps` | scripts/ 에 새 mjs 파일·새 import 추가 | `scripts/**/*.mjs` |
| `scripts/test-status` | collectors 테스트 파일 작업 시 참고 | `scripts/collectors/*.test.mjs` |
| `collectors/data-changing-run-approval` | 운영 데이터를 바꾸는 실행(backfill·fix·cleanup·수집기 --apply) 전 전이표 승인 | `scripts/collectors/**/*.mjs`, `scripts/backfill-*.mjs`, `scripts/fix-*.mjs`, `scripts/cleanup-*.mjs` |
| `scoring/scoring-engine` | 점수 엔진·등급표·브랜드·프로필 상수를 고칠 때 | `src/scoring/**`, `src/constants/scoringTiers.*`, `brands.ts`, `profiles.*` |

**상시 로드(paths 없음, 14개)** — 어기면 에러 없이 조용히 새거나, 파일을 안 읽는 작업에서도
필요한 부류라 그대로 둔다: `tool-output-illusion-guard` · `probe-must-be-self-verified` ·
`next-session-grep-mandate` · `unordered-pagination-loses-rows` · `pipe-kills-collector` ·
`purge-to-recollect-timing` · `admin-district-code-reform` · `placeholder-coordinates-truth-sources` ·
`collector-timeout-rootcause-analysis` · `regions-multicollector-recorded-at-lag` ·
`workflows/*`(4개: secret-naming-audit · workflow-name-hallucination · timeout-rootcause-policy · external-api-outage-policy)

> 되돌리기: 해당 파일 맨 앞 `---` `paths:` `---` 블록을 지우면 상시 로드로 복귀.
> `scripts/*` 8개의 상세 = `scripts/CLAUDE.md`(색인) 참조.

