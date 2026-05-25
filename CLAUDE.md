# 미분양 아파트 비교 엔진 v3.0

> React 19 SPA + Supabase PostgreSQL + Vercel Serverless. 6개 카테고리 41+ 지표 AHP 스코어링.

## 즉시 알아야 할 것 (항상 로드 가치)

- **사용자 대화 시 쉬운 말 원칙** — 자세히는 [.claude/EASY_WORDS.md](.claude/EASY_WORDS.md)
- **현재 진행 상황** — [.claude/SESSION_LOG.md](.claude/SESSION_LOG.md) (세션 1~156 누적) · [.claude/NEXT_SESSION.md](.claude/NEXT_SESSION.md) (다음 세션 시작점) · [.claude/DB_QUALITY.md](.claude/DB_QUALITY.md) · [.claude/BACKLOG.md](.claude/BACKLOG.md)
- **새 작업 시작 시 작업 규칙** — [.claude/WORK_RULES.md](.claude/WORK_RULES.md) (Plan→Guard→Work→Review)
- **CLAUDE.md 본문 편집 전 메타 규칙** — [.claude/META_RULES.md](.claude/META_RULES.md) (비대화 방지, 상한 150줄)
- **환경변수 / 로컬 자원 / 자주 쓰는 스킬** — [.claude/ENV_VARS.md](.claude/ENV_VARS.md) · [.claude/LOCAL_RESOURCES.md](.claude/LOCAL_RESOURCES.md) · [.claude/SKILLS.md](.claude/SKILLS.md)

## 아키텍처 개요

```
constants → scoring → theme → components → hooks → App    (단방향, 순환 참조 없음)
```

| 레이어 | 기술 | 핵심 모듈 |
|--------|------|----------|
| **프론트** | React 19 + Vite 8 (Rolldown) | App.tsx (~430줄), `@/` 경로 별칭, Pretendard 폰트 |
| **상태/훅** | useMemo 13개 체인 + useDeferredValue | useDataPipeline, useAppNavigation, useFilterSort |
| **컴포넌트** | memo() 45개 + icons.tsx (SVG 9개) | 소비자9 + 섹션9 + 상세10 + 필터7 + 전문가9 + 관리자5 + 아이콘1 |
| **API** | Vercel Serverless (23개 함수) | withHandler HOF (CORS/Method/RateLimit/Admin 통합) |
| **DB** | Supabase PostgreSQL | 15개 테이블 + 2 VIEW + presale 19컬럼 |
| **인증** | SHA-256+salt, HMAC-SHA256 JWT | 카카오 OAuth + 전문가/관리자 role 기반 |
| **캐싱** | Upstash Redis (서버리스) | 세션, 토큰 블랙리스트, Rate Limit |
| **수집** | GitHub Actions (47개) + Windows 스케줄러 | 네이버(로컬 한국IP) + 공공API(Actions) |
| **테스트** | Vitest + Playwright E2E (11 spec) | `npm run test` / `npm run test:e2e` |
| **모니터링** | Vercel Analytics + Speed Insights | 페이지뷰/Web Vitals/커스텀 이벤트 |

번들: vendor 190KB / index 172KB / html2canvas+jsPDF 200+400KB(dynamic import).

## 공유 인프라 (mibunyang ↔ naver-estate-web)

| 자원 | 상세 | 주의사항 |
|------|------|---------|
| Supabase DB | mibunyang `rwdtljipvmqpazrimyns` / naver-estate-web `gcfckzqrcujktloilwpz` | 공용 테이블은 mibunyang DB |
| data.go.kr API Key | MOLIT_KEY | 일일 10,000건 공유 |
| 집 서버 IP | 192.168.219.101 (외부: Cloudflare Tunnel) | 네이버 rate limit 공유 |
| Vercel Team | `developer-dunos-projects` | 프로젝트별 환경변수/배포 독립 |

- **테이블 소유권**: 공용 테이블 기존 컬럼 변경/삭제 금지 → `supabase/CLAUDE.md`
- **API 쿼터**: 일일 10,000회 분배 + 10일-토요일 충돌 방지 → `scripts/CLAUDE.md`
- **네이버 시간 분리**: mibunyang 08:00(월/목), naver-estate-web interval → `scripts/CLAUDE.md`
- **마이그레이션**: 공용 테이블 ALTER 전 상대 프로젝트 쿼리 검색 필수 → `supabase/CLAUDE.md`

## 서브디렉토리 규칙 (해당 디렉토리 작업 시 자동 로드)

| 디렉토리 CLAUDE.md | 핵심 내용 |
|---|---|
| `src/scoring/` | 가중치 합계 100, 클램핑, null 처리, 스코어링 파이프라인 |
| `src/components/` | memo 45개, 접근성, **반응형 레이아웃**, **데스크톱 키보드/테마** |
| `src/hooks/` | Hook 호출 순서, 의존성 13개, **React 성능 패턴** (useDeferredValue/useTransition) |
| `api/` | JS null 함정, 한글 인코딩, withHandler, **인증/세션 KV**, **비로그인 블라인드 정책** |
| `scripts/` | units 보정, 네이버 로컬 6단계, 후처리, API 쿼터 |
| `.github/workflows/` | 47개 워크플로우 목록, GitHub Secrets, 스케줄 |
| `supabase/` | 15개 테이블 + 2 VIEW + presale 19컬럼, RLS 정책 |
