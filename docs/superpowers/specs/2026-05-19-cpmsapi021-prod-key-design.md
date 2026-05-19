# 설계 v2: cpmsapi021 운영키 교체 + regions.childcare 재수집

> 작성: 2026-05-19 (세션 275). brainstorming 산출 design 문서.
> v1 → v2: 서브에이전트 3종 병렬 검증으로 결함 5건 발견 후 재설계.

## Context — 왜 이 작업을 하는가

`regions.childcare` (전국 어린이집 시군구 집계) 의 `count`/`total_capacity`/`facilities[]` 가
**count==50 으로 잘린 행이 369개**, count>50 인 행은 0개다 (DB 실측).
서초·송파·마포 등 어린이집 수백 개 시군구가 전부 50으로 막혀 집계값이 부정확하다.

**진짜 원인 (사고 아님)**: 세션 252~274 BACKLOG 🔴 가 "cpmsapi021 API 의 hard limit 50건"
이라 박제했으나, SESSION_LOG 세션 255 L175 진단 + 세션 252 L351 ("개발계정 각 1") 로
**개발계정 키의 조회 50행 제한**임이 확인된다. cpmsapi021 명세서
(`OpenAPI서비스명세서_021_v1.0.doc`) 요청변수 = `key`+`arcode` 2개뿐, 페이징 없음,
"50건 제한" 명시 없음 — 50은 개발키의 문서화 안 된 제약.

자매 API cpmsapi030 은 세션 255 에서 사용자가 `CHILDCARE_BASIC_API_KEY` 를 운영키로
교체해 해결됐다 (운영키 raw 실측 — 강북구 실 데이터 확인). **cpmsapi021 의
`CHILDCARE_API_KEY` 는 빠뜨려 개발키 그대로**라 세션 252 이후 미해결.

**해결**: 사용자가 cpmsapi021 운영키 보유 (info.childcare.go.kr 콘솔, 일일 한도 1,000건
— 콘솔 스크린샷 확정). collector 코드 로직 거의 변경 0.

## ⚠️ v1 → v2 — 서브에이전트 검증 발견 결함 5건

| # | v1 결함 | v2 정정 |
|---|---|---|
| 1 | "606개 시군구" | **할루시네이션**. 606 = `regions` 테이블 `childcare IS NOT NULL` **행 수** (recorded_at 시계열 중복). 실제 = `listAllSgg()` **256개 시군구** / distinct 데이터 보유 244개 / API 호출 256회 |
| 2 | "dry-run 분기에서 `rows.slice(0,5)`" | **무효**. dry-run 분기는 for 루프(256 호출) **완료 후**. `rows.slice` 는 출력만 축소, 호출 안 줄임. → `sggList` 자체를 호출 루프 **전** dry-run 시 `.slice(0,5)` |
| 3 | "운영키 교체 → 50 풀림" | **검증 안 된 가정**. cpmsapi030 실측을 cpmsapi021 에 추론 적용 — `next-session-grep-mandate.md` 룰 위반. → **운영키 강남구 raw 호출 검증 단계 신설** |
| 4 | "결과코드 가드 추가" | `parseChildcareXml` 에 넣으면 "응답 0건=[]" 테스트 회귀. → 가드는 `fetchChildcare`(API 응답 수신부)에 배치, `parseChildcareXml` 은 순수 파서 유지 |
| 5 | regions 시계열 행 선택 | `buildRegionFacilityMap` 이 "최신 행" 아닌 "좌표 최다 행" 선택 — 기존 코드 맹점. **본 작업 범위 밖** (별도 사안으로 기록만) |

## facilities[] 처리 결정 — 유지 (제거 안 함)

`regions.childcare.facilities[]` 는 파이프라인 입력이다 (서브에이전트 코드 확인):

```
childcare-info.mjs (cpmsapi021)  → regions.childcare.facilities[] 7필드
  ↓
childcare-detail.mjs (cpmsapi030) → 같은 facilities[] 를 70필드로 in-place 확장
  ↓
collect-nearby-childcare.mjs      → facilities[] 에서 단지 1km 5건 Haversine 추출
  ↓
schools.nearby_childcare → apartments_flat VIEW → DetailModal 어린이집 패널
```

facilities[] 제거 시 W6-D2 에픽 (세션 254~257) 전체가 깨진다. → **유지**.

## 접근법 — A (운영키 교체 + 단순 재수집), 운영키 검증 게이트 선행

## 작업 구성요소 (v2 — 순서 중요)

| # | 무엇 | 누가 | 비고 |
|---|---|---|---|
| 1 | `.env.local` 의 `CHILDCARE_API_KEY` → 운영키 교체 | 👤 사용자 | 시크릿 |
| 2 | **운영키 검증 게이트** — 강남구(11680) raw 호출로 50 초과 응답 확인 | Claude | **통과해야만 #4~ 진행. 미통과 시 기획 재수립** |
| 3 | GitHub Secret `CHILDCARE_API_KEY` → 운영키 교체 | 👤 사용자 | #2 통과 후 |
| 4 | `childcare-info.mjs` 보강 — 결과코드 가드 + dry-run sggList 축소 | Claude | 아래 §보강 2건 |
| 5 | `childcare-info.test.mjs` 결과코드 throw 테스트 추가 | Claude | 현 13 tests |
| 6 | 운영 실행 → `regions.childcare` 재수집 (256 호출) | Claude | #2 통과 전제 |
| 7 | 재수집 결과 검증 — count>50 분포 재측정 | Claude | DB 쿼리 |
| 8 | `regions.childcare` JSONB row 크기 실측 | Claude | 결과만 기록 |
| 9 | BACKLOG 🔴 cpmsapi021 절 → ✅ ARCHIVE | Claude | drift 0 |

## §보강 2건 — childcare-info.mjs

### 보강 A — 결과코드 가드 (fetchChildcare 에 배치)

명세서 결과코드: ERROR-100 필수항목 누락 / ERROR-200 서버에러 / INFO-100 인증키 무효 /
INFO-200 검색결과 없음 / INFO-300 일 요청 초과 / INFO-400 키 만료.

현재 `fetchChildcare` → `parseChildcareXml` 은 `<item>` 없으면 빈 배열, main() 은
"0건 skip". INFO-300/400/100 응답을 빈 배열로 삼키면 시군구 통째 0건이 돼도 모름
(월간 cron 데드존 — `secret-naming-audit.md` 답습 위험).

→ `fetchChildcare` 안에서 응답 XML 의 결과코드 태그를 검사:
- `INFO-200` (검색결과 없음) → 빈 배열 정상 반환 (0건 skip 유지)
- `INFO-300`/`INFO-400`/`INFO-100`/`ERROR-*` → throw
- `parseChildcareXml` 은 순수 파서로 미변경 (테스트 회귀 0)

**결과코드 태그명은 운영키 raw 실측으로 확정** — #2 게이트에서 강남구 raw 응답 받을 때
정상 응답 + (가능하면) 에러 응답 구조를 같이 관찰. 명세서 추측 금지
(`feedback_api_official_docs_mandate.md`). 명세서에 결과코드 응답 XML 구조 예시 없음 —
raw 실측 필수.

### 보강 B — dry-run sggList 축소

`childcare-info.mjs` main() 에서 `listAllSgg()` 직후:
```js
const sggList = dryRun ? listAllSgg().slice(0, 5) : listAllSgg();
```
→ dry-run 5 호출 + 운영 256 호출 = 261 < 1,000. 같은 날 검증+운영 가능.
(호출 루프 진입 전 축소 — v1 의 rows.slice 위치 오류 정정)

## 핵심 파일

| 파일 | 변경 |
|---|---|
| `scripts/collectors/childcare-info.mjs` | fetchChildcare 결과코드 가드 + dry-run sggList 축소 |
| `scripts/collectors/childcare-info.test.mjs` | 결과코드 throw 테스트 추가 (현 13 tests) |
| `.claude/BACKLOG.md` | 🔴 cpmsapi021 절 → ✅ ARCHIVE (로컬, 커밋 안 함) |
| `.env.local` / GitHub Secret | 👤 사용자 키 교체 |

워크플로 `.github/workflows/collect-childcare.yml` 변경 없음 (`CHILDCARE_API_KEY` 이미
주입 + Validate secrets step 보유 — audit-env-keys 3-way 정합 확인됨). secret 값만 교체.

## 검증 (end-to-end)

1. 👤 키 교체 → Claude 강남구(11680) raw 호출 → 50 초과 응답 확인 (게이트 #2)
2. `node scripts/collectors/childcare-info.mjs --dry-run` → 5시군구 sample 정상
3. 운영 실행 → `regions.childcare` 분포 재측정: `count>50` 행이 0 → 다수로
4. `regions.childcare` JSONB row 크기 실측 (서초구 등)
5. `vitest` (childcare-info.test 13+α) / `npm run typecheck:scripts` /
   `node scripts/audit-env-keys.mjs` (3-way 정합)

## 범위 밖 (별도 작업)

- `buildRegionFacilityMap` 최신 행 선택 맹점 (결함 5) — 기존 코드 문제, 별도 수정
- `regions.childcare` JSONB 크기 대응 (facilities 슬림화) — 재수집 후 크기 실측으로 판단
- cpmsapi030 (`childcare-detail.mjs`) 은 이미 운영키 — 본 작업 범위 아님
- W6-D 옵션 ε 후속 (regions.childcare → scoring 통합) — BACKLOG 🟢 별 세션
