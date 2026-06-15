# mibunyang 온보딩 — 1페이지 진입점

> 신규 세션 / 신규 협업자 / AI 에이전트 진입 시 1차 답습 문서. **5분 안에 프로젝트 윤곽 파악 가능.**
> 상세는 각 link 답습. 본 문서 stale 시 = 원본 파일 우선.

## 이 프로젝트는 무엇인가

**미분양 아파트 비교 엔진 v3.0** — 다기준 의사결정 엔진. 미분양·분양 예정 아파트를 6 카테고리 41+ 지표로 AHP 점수화하고 5가지 사용자 프로필 가중치 (실거주·투자·신혼·교육·은퇴) 적용. 같은 단지여도 프로필마다 다른 점수.

- **프론트**: React 19 SPA (Vite 8 Rolldown)
- **백엔드**: Vercel Serverless (23 함수) + Supabase PostgreSQL (15 테이블 + 2 VIEW)
- **수집**: GitHub Actions (38 워크플로, KOSIS·childcare 로컬 이전으로 감소) + Windows 스케줄러 (네이버 한국 IP)
- **인증**: SHA-256+salt, HMAC-SHA256 JWT + 카카오 OAuth + 관리자 role (전문가 role 세션 405 폐지)
- **테스트**: Vitest 3400+ + Playwright E2E 13 spec (+ 시각 baseline `PW_VISUAL=1`)

## 5분 진입 단계

### 1. 환경 답습 (1분)

```bash
pwd && ls                              # f:/mibunyang 확인
git status                             # clean 확인
git log --oneline -10                  # 최근 작업 답습
```

### 2. 핵심 문서 답습 순서 (2분)

| 우선순위 | 파일 | 답습 목적 |
|---|---|---|
| 1 | [CLAUDE.md](CLAUDE.md) | 아키텍처 + 즉시 알아야 할 것 |
| 2 | 글로벌 메모리 `~/.claude/projects/f--mibunyang/memory/MEMORY.md` | 최근 세션 진행 (세션 296+ 진실의 원천). 과거 1~354 = [.claude/SESSION_LOG_ARCHIVE_2026H1.md](.claude/SESSION_LOG_ARCHIVE_2026H1.md) |
| 3 | [.claude/BACKLOG.md](.claude/BACKLOG.md) | 활성 P0~P3 우선순위 |
| 4 | [.claude/NEXT_SESSION.md](.claude/NEXT_SESSION.md) | 다음 작업 (로컬, git 미추적) |
| 5 | [docs/superpowers/INDEX.md](docs/superpowers/INDEX.md) | spec/plan 35 파일 색인 |

### 3. 작업 규칙 답습 (2분)

| 영역 | 답습 |
|---|---|
| 작업 규칙 | [.claude/WORK_RULES.md](.claude/WORK_RULES.md) (Plan→Guard→Work→Review) |
| 메타 규칙 | [.claude/META_RULES.md](.claude/META_RULES.md) (CLAUDE.md 편집 전) |
| 쉬운 말 원칙 | [.claude/EASY_WORDS.md](.claude/EASY_WORDS.md) |
| 환경 변수 | [.claude/ENV_VARS.md](.claude/ENV_VARS.md) |
| 자주 쓰는 스킬 | [.claude/SKILLS.md](.claude/SKILLS.md) |

## 디렉토리 가이드

```
mibunyang/
├── src/                # React 프론트 (TS화 98%)
│   ├── components/    # 컴포넌트 (memo 54개 + icons.tsx)
│   ├── scoring/       # 점수 엔진 (6 카테고리 41+ 지표)
│   ├── hooks/         # useDataPipeline + 13 useMemo 체인
│   └── theme/         # Pretendard + tokens
├── api/                # Vercel Serverless 23 함수
├── scripts/            # 수집기 47 + audit + 기타
│   └── collectors/    # 외부 API 수집
├── supabase/           # 마이그 + RLS 정책
├── .github/workflows/  # 38 워크플로
├── e2e/                # Playwright 13 spec (+ visual.spec.ts 시각 baseline)
├── docs/superpowers/   # spec/plan 35 파일 ([INDEX.md](docs/superpowers/INDEX.md))
└── .claude/            # 프로젝트 메모리 + 룰
    ├── rules/
    │   ├── collectors/    # 수집기 룰 (parseGu·KOSIS·graceful·timeout)
    │   ├── workflows/     # 워크플로 룰 (secret/timeout/outage)
    │   └── meta/          # 메타 룰 (NEXT_SESSION grep·TS 패턴)
    └── SESSION_LOG.md     # 스텁 (세션 1~354 = SESSION_LOG_ARCHIVE_2026H1.md, 296+ = 글로벌 메모리)
```

각 디렉토리의 `CLAUDE.md` 파일 답습 의무 (서브디렉토리 작업 시 자동 로드).

## 공유 인프라 (mibunyang ↔ naver-estate-web)

| 자원 | 상세 |
|---|---|
| Supabase DB | mibunyang `rwdtljipvmqpazrimyns` / naver-estate-web `gcfckzqrcujktloilwpz` |
| data.go.kr API Key | MOLIT_KEY 일일 10,000건 공유 |
| 집 서버 IP | 192.168.219.101 (네이버 수집) |
| Vercel Team | `developer-dunos-projects` |

**공유 테이블 컬럼 변경 전 cross-repo grep 의무** (`memory/feedback_cross_repo_schema_audit.md` 답습).

## 답습 자산 (사고 박힘)

- **collectors/** — 수집기 timeout·graceful·KOSIS·parseGu·외부 API outage (5 룰)
- **workflows/** — secret 3-way 동기화·timeout root cause·외부 API 장기 중단·workflow 이름 환각 (4 룰)
- **meta/** — NEXT_SESSION grep 의무·TypeScript 패턴 카탈로그 (2 룰)

## 첫 진입 액션

1. ✅ 본 ONBOARDING.md 답습 완료
2. ⬜ [CLAUDE.md](CLAUDE.md) 본문 답습
3. ⬜ 글로벌 메모리 `~/.claude/projects/f--mibunyang/memory/MEMORY.md` 최근 세션 답습
4. ⬜ [.claude/BACKLOG.md](.claude/BACKLOG.md) 활성 우선순위 답습
5. ⬜ [docs/superpowers/INDEX.md](docs/superpowers/INDEX.md) ✅/❓ 분류 답습
6. ⬜ 사용자 요청 확정 → [.claude/WORK_RULES.md](.claude/WORK_RULES.md) 답습 후 plan 진입

## 외부 link

- 라이브 프론트: <https://mibunyang.vercel.app>
- 운영자 대시보드: 카카오 OAuth 로그인 (전문가/관리자 role)
- 데이터 카탈로그: [.claude/API_REGISTRY.md](.claude/API_REGISTRY.md) (28 외부 API)

## 진실의 원천 명시

본 문서 stale 시 = 각 link 원본 파일 우선. 갱신 트리거:
- 아키텍처 변경 (예: React 19→20)
- 디렉토리 구조 변경 (예: src/ 신규 서브폴더)
- 인프라 변경 (예: Vercel → Cloudflare)
- 6개월 주기 정기 답습 (다음: 2026-11)
