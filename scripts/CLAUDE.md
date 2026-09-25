# 데이터 수집 스크립트 규칙

> `scripts/` 수정 시 반드시 이 규칙을 따를 것.

## on-demand 8개 색인 (세션568 — 이전 13개 절을 전부 이관)

아래 8개는 `paths` frontmatter 가 붙어 **그 파일을 수정·조회할 때만** 로드된다.
⚠️ 파일을 안 읽고 `node -e` 로 DB 만 만지는 세션에서는 안 불려온다 — 해당하면 직접 Read.

| on-demand 규칙 | 언제 필요한가 | 파일 |
|---|---|---|
| units 보정 파이프라인 | molit-units·naver-presale·seeding 수정 | `.claude/rules/scripts/units-correction.md` |
| MOLIT 수집기 모듈 | `_molit-api`·molit-*·maintenance·building-hub 수정 | `.claude/rules/scripts/molit-collectors.md` |
| 로컬 자동화(KOSIS/MOLIT·childcare·네이버) | 로컬 러너·스케줄러 등록·시간 분리 확인 | `.claude/rules/scripts/local-runners.md` |
| data.go.kr 쿼터 + API Rate Limit | 새 API 호출 추가·쿼터 계산 | `.claude/rules/scripts/api-quota-and-ratelimit.md` |
| 교통 수집(transport-tago) | transport-tago.mjs 수정 | `.claude/rules/scripts/transport-collector.md` |
| 좌표 지오코딩 폴백 | geocode-missing·reverse-geocode·fix-placeholder-addresses 수정 | `.claude/rules/scripts/geocoding-fallback.md` |
| 외부 패키지 package.json 선언 | scripts/ 에 새 mjs 파일·새 import 추가 | `.claude/rules/scripts/declared-deps.md` |
| 테스트 현황(수집기) | collectors 테스트 파일 작업 시 참고 | `.claude/rules/scripts/test-status.md` |

모든 절을 on-demand 로 옮겼다(scripts/ 전 섹션이 특정 파일 작업 시에만 필요한 성격이라 —
[[doc-diet]] 판별 질문 ①②에 전부 "아니오": 파일을 안 읽고는 못 어기고, 그 파일을 고치기
직전에 필요). 이 파일 자체는 색인 전용으로 200줄 아래를 유지한다.

## 권한 지문 도구 · 감시 번호 (세션569)

- `_perm-fingerprint.mjs` — 권한 지문 비교·경보 판정·주의 항목(A1~A9) 추출. 순수 함수(DB 호출 없음), 감시 ⑩ 이 쓴다.
- `perm-baseline.mjs` — 권한 기준선 미리보기·`--make-expect`·`--accept --expect-file`(사장님 승인 뒤). 로컬 전용 — `GITHUB_ACTIONS` 면 실행 거부.
- `monitor-collectors.mjs` 감시 ⑪ = `checkRegionUnresolved`(kind `region-unresolved`, KOSIS 시도 이름 못 맞춤 마커) · ⑫ = `checkApplyhomeUnsold`(청약홈 미분양 값 만료 — #606 합침(25b1d09f)).
- 미분양 출처 `hold`(사람 보류, 세션570) — 수집기가 덮지 않는 "자료 없음 확정" 행. 걸기·풀기 = `backfill-unsold-source.mjs` 계획 파일(`buildHoldPlanRow`: mark_hold·release_hold_to_null·release_hold_to_applyhome), 감시 = ⑫(d) 기준 명단 `HOLD_BASELINE_IDS`·(e) 보류 6개월 재검토, 규칙 정본 = `collect-unsold-kosis.mjs` 규칙 0(skip_hold, 분모 유지). (d) 열쇠 = DB hold 명단 지문 + 기준 명단 지문(`hold:<DB>+<기준>`) · DB 가 기준과 같아진 날 `hold:` 열쇠(`HOLD_ALERT_KEY_PREFIX`)를 `monitor_alert_state` 에서 지운다(같은 사고 재발 시 다시 울림, 세션572).
- 세션570: ⑬ = `checkLocalFailures`(kind `local-failure`, 최근 50시간 `collector_runs.status=failure` 중 실패 비율 10% 이상(성공 0 포함) 또는 실패 수 없이 오류 메시지만 남은 실행(예외로 죽은 수집기) — 로컬 러너 실패가 ①②⑤ 어디에도 안 보이던 구멍, daily 에서도 dedup) · `record-pipeline-run.mjs` = `run-naver-local.bat` 이 처음(`start`)·끝(`done`)·치명 실패(`failed`)에 불러 `naver-pipeline` 1행을 남기고, ⑤ 가 그 신선도를 stale 4일로 본다(목요일 회차가 끊기면 토요일 09:00 경보).
- 세션571: 감시 ⑤ 항목에 선택 필드 `since`(등재일 YYYY-MM-DD, KST 자정 기준) — 행이 0개여도 등재 뒤 `stale_days` 가 지나면 "등재 뒤 행 0" stale 경보(`naver-pipeline` since 2026-09-25 → 9/29 아침부터; since 없는 항목은 종전대로 skip) · 아침 브리핑에 `WARN_STEPS:` 완주 한 줄(`monitor-briefing.mjs` `extractWarnRuns`) · hold 기준 명단 `HOLD_BASELINE_IDS` = **13**(세션570 11 + 화면 대표 2행 910303·910363, op `mark_hold_from_zero`/되돌림 `release_hold_to_zero`) · `naver-presale.mjs` 단지 상세 실패마다 `[실패] no=… seq=… 이름` + 루프 뒤 `[실패 명단] N건`(`describeComplexFailure`, 최대 20건).

## 일회성·비교 도구 (세션576)

- `compare-unsold-impact.mjs <before.json> <after.json> [--out=<경로>]` — `collect-unsold-kosis.mjs --dry-run --impact-out=`로 뜬 계획 스냅샷 두 개(코드 변경 전/후)를 id 로 맞대 actionCounts 전후·action 전이 집계(`from→to: n`)·전이 행 명단·action 은 같고 추정값만 바뀐 행·breaker 전후를 보여준다. KOSIS 배분 로직을 고친 뒤 "이 변경이 실제로 몇 곳을 어떻게 바꾸는지" 사람이 승인할 전이표를 만들 때 쓴다.
- `cleanup-unsold-by-ids.mjs --ids-file=<id목록.json> [--apply --from=<사본.json>] [--why=<문구>]` — id 명단으로 지정한 단지의 미분양 4칸(unsold·unsold_rate·unsold_source·unsold_as_of)을 NULL 로 비운다. `cleanup-listing-based-unsold.mjs`(판정 조건으로 자동 탐지)와 달리 이미 사람이 확정한 id 명단을 그대로 비울 때 쓴다. `unsold_source='hold'`(사람 보류) 행은 건드리지 않고 skip. dry-run 이 기본이며 타임스탬프가 박힌 사본(`<ids-file>.before.<ts>.json`)과 역계획(`…restore.<ts>.json`)을 저장한다. `--apply` 는 반드시 `--from=<그 사본>` 을 받아 지금 DB 값과 사본이 같은 행만 반영(다르면 "현재값 달라짐"으로 skip). ids 1,000 초과는 즉시 거부.
