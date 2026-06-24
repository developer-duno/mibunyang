# 환경변수

> 발급처별 상세 + 공식 명세 URL = [API_REGISTRY.md](API_REGISTRY.md). 본 표는 변수명 + 용도 + 필수 여부 빠른 검색용.

## DB / 인증

| 변수 | 용도 | 필수 | 비고 |
|------|------|------|------|
| `SUPABASE_URL` | DB 연결 | O | Vercel + .env.local |
| `SUPABASE_ANON_KEY` | 읽기 전용 | O | API 레이어 |
| `SUPABASE_SERVICE_KEY` | 쓰기 | O | GitHub Secrets / 로컬만 |
| `KAKAO_REST_API_KEY` | 카카오 OAuth (서버) | O | VITE_KAKAO_JS_KEY와 분리 |
| `VITE_KAKAO_REST_API_KEY` | 카카오 OAuth authorize client_id (프론트) | O | `useKakaoAuth.ts:12`. **production만 설정** — preview/git 배포엔 없어 "카카오 로그인을 사용할 수 없습니다"(정상, 버그 아님) |
| `VITE_KAKAO_JS_KEY` | 카카오 (프론트) | O | 공개 키 |
| `KAKAO_REDIRECT_URI` | OAuth 콜백 URL | O | `https://www.미분양아파트.com/oauth/kakao/callback`. **정식 도메인 = `미분양아파트.com`**(xn--hg3bi2ac4o1ig57cnoa.com)만 카카오 콘솔 등록 → **카카오 로그인은 이 도메인에서만**. `mibunyang-peach.vercel.app`(vercel 기본 alias)는 미등록=KOE006(비로그인 검증만). 세션 416 박제 |
| `VITE_KAKAO_PHONE_SCOPE` | 카카오 전화번호 scope 토글 (프론트) | - | `true` 일 때만 authorize scope 에 `phone_number` 추가. **카카오 비즈앱 심사+동의항목 활성화 후에만 켤 것** — 심사 전 켜면 카카오 에러. 기본 미설정=OFF=기존 동작. 가이드: `docs/kakao-phone-consent-setup.md`. 세션 427 |
| `VITE_USE_SUPABASE` | DB 모드 전환 | - | `true` → Supabase, 아니면 로컬 JSON |

## data.go.kr (공공데이터포털) — 발급처 1

| 변수 | 쓰는 수집기 | 필수 | 비고 |
|------|------|------|------|
| `MOLIT_KEY` | molit-units / molit-building-info / collect-maintenance / collect-trades / collect-building-hub / collect-applyhome / collect-emergency / housing-permits | O | 일일 10,000건 공유 |
| `AIRKOREA_KEY` | collect-air-quality | - | 별도 쿼터, MOLIT_KEY와 분리 |
| `MOIS_POP_KEY` | population | O (population 활성 시) | 행정안전부 인구·세대현황 |
| `MOIS_SEX_AGE_KEY` | population-sex-age | O (population-sex-age 활성 시) | 행정안전부 성별·연령별 인구 |
| `TAGO_KEY` | transport-tago | O (transport 활성 시) | 국토교통부 TAGO 버스정류장 |

## KOSIS — 발급처 2 (회원당 인증키 1개)

| 변수 | 쓰는 수집기 | 필수 | 비고 |
|------|------|------|------|
| `KOSIS_KEY` | collect-housing-supply-ratio / collect-market-stats / collect-unsold-kosis | O (KOSIS 활성 시) | 모든 통계표 공용 |
| `KOSIS_MIGRATION_KEY` | migration / collect-avg-income | O (migration 활성 시) | 별도 발급 키 (세션 232) |

## info.childcare.go.kr — 발급처 3 (data.go.kr 아님)

| 변수 | 쓰는 수집기 | 필수 | 비고 |
|------|------|------|------|
| `CHILDCARE_API_KEY` | childcare-info | O | cpmsapi021 시군구 집계 |
| `CHILDCARE_BASIC_API_KEY` | childcare-detail | O | cpmsapi030 어린이집 70 필드 상세 |
| `CHILDCARE_JEJU_KEY` | childcare-info-jeju | O | cpmsapi017 제주시·서귀포시 (cpmsapi021 미보유 보완) |

## Kakao Developers — 발급처 4

| 변수 | 쓰는 수집기 | 필수 | 비고 |
|------|------|------|------|
| `KAKAO_KEY` | collect-childcare / collect-police / environment / geocode-missing / infra-kakao / noxious / reverse-geocode / schools-neis / transport-tago | O (인프라 수집 활성 시) | 카카오 로컬 API REST 키 |
| `KAKAO_REST_KEY` | noise-estimate | - | KAKAO_KEY 와 같은 값 가능 (이름만 분리) |

## 기타 단일 발급처

| 변수 | 쓰는 수집기 | 필수 | 비고 |
|------|------|------|------|
| `FINLIFE_API_KEY` | finlife (금감원 금리) | - | 미등록 시 빈 배열 |
| `NEIS_KEY` | schools-neis | - | 나이스 교육정보 개방포털 |
| `SCHOOLINFO_KEY` | schools-neis | - | 학교알리미 학생수 |
| `DART_KEY` | dart-builders | O (DART 활성 시) | OpenDART 시공사 신용 |

## MCP 서버 운영 메모 (세션 439 감사 기록)

- **프로젝트 `.mcp.json`** = `supabase-readonly`(HTTP, read_only) 1개만. MCP 최소주의 — "신기해서 붙인 도구" 0.
- **`settings.local.json` `disabledMcpjsonServers`** = `["vercel", "supabase", "supabase-readonly"]` 로 셋 다 **개인 로컬에서 비활성**. 이유:
  - **CLI 우선 원칙** (`.claude/rules/mcp-vs-cli.md`, 글로벌) — Supabase/Vercel 조회·배포는 로컬 CLI(`npx supabase`·`npx vercel`·`gh`)가 MCP 보다 정확. `.env`/앱에 인증 context 이미 잡힘.
  - 세션 38 사고 답습: Supabase MCP 가 organization 첫 프로젝트만 반환해 30분 헛다리 → 사장님 "mcp 보다 cli 가 낫지 않아?" 지적.
- **DB 조회는 코드로**: `getSupabase()` (`scripts/collectors/_shared.mjs`) + service key 로 직접 쿼리하는 패턴이 표준. read_only MCP 는 필요 시 local 에서 다시 켤 수 있게 `.mcp.json` 에 정의만 보존.
- **마이그레이션 적용**: Dashboard SQL Editor 수동 실행이 표준 (`.claude/rules/workflows/workflow-name-hallucination.md`). CLI `supabase db push` 는 `settings.json` deny.
