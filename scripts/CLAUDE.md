# 데이터 수집 스크립트 규칙

> `scripts/` 수정 시 반드시 이 규칙을 따를 것.

## on-demand 8개 색인 (세션568 — 이전 13개 절을 전부 이관)

아래 8개는 `paths` frontmatter 가 붙어 **그 파일을 수정·조회할 때만** 로드된다.
⚠️ 파일을 안 읽고 `node -e` 로 DB 만 만지는 세션에서는 안 불려온다 — 해당하면 직접 Read.

| on-demand 규칙 | 언제 필요한가 | 파일 |
|---|---|---|
| units 보정 파이프라인 | molit-units·naver-presale·seeding 수정 | `.claude/rules/scripts/units-correction.md` |
| MOLIT 수집기 모듈 | `_molit-api`·`_match-gates`·molit-*·maintenance·building-hub 수정 — K-apt 1.5초 간격·결과 코드·짝 짓기 게이트(세션589) | `.claude/rules/scripts/molit-collectors.md` |
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
- 세션588: `collectors/assign-complex-keys.mjs` — 묶음 열쇠 칸(`apartments.complex_key`)을 채운다. 미리보기가 기본. 매일 자동은 `--apply`(이미 있던 열쇠가 30행 또는 10% 넘게 바뀌거나 빈칸 채움이 기존 열쇠 수보다 많으면 안 씀 — 첫 채우기·칸이 비워진 날은 승인 파일로만, 세션589), 사람이 승인한 반영은 `--apply-from=<계획 파일>`(다시 계산한 계획이 그 파일과 id·이전 값·새 값까지 같을 때만). 받은 행 수 ≠ 표의 행 수거나 한 묶음에 임대·분양/시도가 섞이면 계산·쓰기를 안 한다. 열쇠 규칙(`_same-complex.mjs`)이나 그 재료(`leaseTypes.mjs`·`stripRoundWords`)를 고칠 땐 `_same-complex.test.mjs` 의 시제품 대조(표본 121행)와 운영 미리보기의 "바뀜" 명단을 먼저 본다. **세션589**: `--out` 은 미리보기에서만·새 이름으로만(있는 파일이면 던짐 — 줄마다 이름·시도·구가 실린다). 예외 명단(`docs/audits/same-complex-exceptions.json`)을 고치는 순서 = 명단 수정 → 미리보기(`--out`) → "바뀜" 명단 승인 → `--apply-from`. 시험은 표본 안의 얼린 사본(`_same-complex.fixture.json` 의 `exceptions`)을 보므로 운영 명단을 고쳐도 시험은 안 깨진다(운영 파일은 모양 검사만). `main()`(→ `assign-complex-keys.test.mjs`)·`fetchComplexKeyHealth`(→ `monitor-complex-key.test.mjs`)를 고치면 본문 지문 가드가 빨강이 된다 — 고친 뜻을 다시 확인하고 지문을 갱신한다(주입형 main + 가짜 DB 시험으로 바꿀 때까지의 다리).
- 세션588: ⑭ = `checkComplexKeyGaps` + `checkComplexKeyRunStale`(kind `stale`, collector `assign-complex-keys` — 만든 지 36시간 넘은 행의 묶음 열쇠 칸이 비었거나, 채우기의 마지막 성공이 36시간을 넘으면 알린다. 채우기 단계는 daily-deploy 에서 실패해도 굽기를 막지 않으므로 "안 돌았다"를 이 점검이 잡는다. 실패 기록은 ⑬ — 단 일부 행만 실패한 날(실패 10% 미만)은 ⑬ 이 조용하다. 하루뿐이면 다음 날 실행이 남은 행을 스스로 메우고, 성공이 이틀 가까이(36시간) 없으면 ⑭ 가 알린다. 시간 한도에 걸려 기록 없이 죽은 날도 같다).
- 세션589: `collectors/collect-trades.mjs` 는 같은 응답으로 **두 표**를 쓴다 — `trades`(쓰기 경로 불변, 2u 가 읽음)와 `trade_deals`(원문 한 건 = 한 행, `_trade-deals.mjs` 의 `buildDealRow`·`saveDealsForKey` — (코드·월·종류) 열쇠별 batch 교체 — 행마다 `batch_rows` 를 넣어 **행 수 = batch_rows 인 batch 만 완성**, 읽는 쪽·다음 회차는 가장 새 완성 batch 만 본다 · 지우기는 회차 시작보다 먼저 든 batch 만 · 새 행이 완성본의 절반 미만이면 보류 · 0건 열쇠는 안 지움 · 표 없으면 첫 열쇠에서 멈춤 · 한 회차에 같은 (코드·종류)는 한 번만, 분양권 "입"(입주권)은 새 표에서만 빼고 skip 으로 셈). 화성시는 `_shared.mjs` `GU_LAWD_CODES` 로 4코드(41591·41593·41595·41597)를 돈다(`GU_LAWD_MAP` 값 41591 은 다른 소비처 때문에 불변) — **추가 3코드 응답은 `trade_deals` 에만** 넣고 `trades` 행은 지금처럼 `getLawdCd` 한 코드(41591) 응답에서만 만든다(사장님 결정 C2 (가) — `trades` 는 이 PR 전과 행 단위로 같다, `fetchTradeRows` 의 `dealsOnly`). ⑯ = `checkTradeDealsHealth`(kind `trade-deals-dup`·`trade-deals-hwaseong`·`trade-deals-ratio`·`trade-deals-norun` — 중복 batch 또는 완성 batch 없는 열쇠 명단(완성 여부) · 화성 코드별 0행 · trades 대비 0.9~1.3 · 보류 상한을 넘은 "기록 없이 끝난 회차" 의심, 표가 비거나 없으면 침묵, 수집 회차 진행 중이면 (b)(c) 보류).
- **회차 도중에 쓰는 표와 회차 끝에 쓰는 표를 맞대는 감시는 진행 중인 회차를 뺀다**(세션589 검사관 C4 — `trade_deals` 는 열쇠마다, `trades` 는 끝에 한 번 써서, 수집 도중 09:00 감시가 "∞" 헛경보를 냈을 것). 판정 = 그 표의 최신 기록 시각이 `collector_runs` 마지막 `finished_at` + 시계 여유 2분보다 늦으면 진행 중 — 단 **보류에는 상한**(수집기 예산 150분 + 30분)을 둔다. 넘으면 판정하고 "기록 없이 끝난 회차" 1건을 낸다(보류가 상한 없이 이어지면 회차가 기록 없이 죽은 달 내내 감시가 꺼진다 — 세션589 검사관 B 지적 3, `tradeDealsRunState`).

## 일회성·비교 도구 (세션576)

- `compare-unsold-impact.mjs <before.json> <after.json> [--out=<경로>]` — `collect-unsold-kosis.mjs --dry-run --impact-out=`로 뜬 계획 스냅샷 두 개(코드 변경 전/후)를 id 로 맞대 actionCounts 전후·action 전이 집계(`from→to: n`)·전이 행 명단·action 은 같고 추정값만 바뀐 행·breaker 전후를 보여준다. KOSIS 배분 로직을 고친 뒤 "이 변경이 실제로 몇 곳을 어떻게 바꾸는지" 사람이 승인할 전이표를 만들 때 쓴다.
- `cleanup-unsold-by-ids.mjs --ids-file=<id목록.json> [--apply --from=<사본.json>] [--why=<문구>]` — id 명단으로 지정한 단지의 미분양 4칸(unsold·unsold_rate·unsold_source·unsold_as_of)을 NULL 로 비운다. `cleanup-listing-based-unsold.mjs`(판정 조건으로 자동 탐지)와 달리 이미 사람이 확정한 id 명단을 그대로 비울 때 쓴다. `unsold_source='hold'`(사람 보류) 행은 건드리지 않고 skip. dry-run 이 기본이며 타임스탬프가 박힌 사본(`<ids-file>.before.<ts>.json`)과 역계획(`…restore.<ts>.json`)을 저장한다. `--apply` 는 반드시 `--from=<그 사본>` 을 받아 지금 DB 값과 사본이 같은 행만 반영(다르면 "현재값 달라짐"으로 skip). ids 1,000 초과는 즉시 거부.
- `cleanup-presale-links.mjs --out=<계획.json> [--ids-file=<id목록.json>] [--keep-lease-type] [--trust-ids]` / `--apply --from=<계획.json.before.<ts>.json> [--why=<문구>]` (세션578) — 다른 시군구 단지에 잘못 붙은 네이버 분양 링크를 끊는다. 판정 = 번호 주인 행 `ap-<번호>` 가 있고 주인≠자기이며 시도가 다르거나 `sameDistrict`(수집기 게이트와 **같은 함수**)가 거짓. ap-* 는 자기 번호로 복원, 그 외는 번호 null, 둘 다 분양 17칸 null + `prices` presale_min 중 (price,pp)가 지금 분양 칸과 같은 행만 삭제. `--keep-lease-type`(세션578) 은 지금 유형이 임대 계열(`isLeasePresale`)인 대상만 `presale_type` 을 현재값 그대로 남긴다(비우면 손님 목록에 분양으로 새로 나타나는 위험 회피, 나머지 16칸은 기존대로 정리). `--trust-ids`(세션578 15:2x, `--ids-file` 필수)는 주인 행이 DB 에 없어 기본 판정이 건너뛰는 명단도, 도구 밖(네이버 읽기 전용 대조)에서 이미 끝낸 외부 판정을 신뢰해 정리한다(`evidence: "trust-ids"`). dry-run 기본(before 사본·역계획·전이표), `--apply` 는 사본 19칸과 지금 DB 가 같은 행만 반영, 돌아온 행으로 셈·반영 뒤 재조회 검증, 대상 1,000 초과 거부. unsold·세대수·좌표 등 enrich 칸은 판별 근거가 없어 건드리지 않는다(머리 주석 "한계").
- `cleanup-unsold-history-by-ids.mjs --ids-file=<id목록.json> [--apply --from=<사본.json>] [--why=<문구>]` (세션578) — 명단 단지의 `unsold_history` 행을 지운다(미분양 값을 비우거나 hold 로 보낸 뒤 `UnsoldChart` 가 옛 추이를 그리지 않게). dry-run 이 `<ids-file>.history.before.<ts>.json`(행 전체 — 되돌리기는 INSERT)을 남기고, `--apply` 는 사본과 id·apartment_id·base_month·unsold_count 가 같은 행만 사본 id 로 삭제, 돌아온 행으로 셈, 반영 뒤 남은 이력 0 이 아니면 exit 1. ids 1,000 초과 거부.
