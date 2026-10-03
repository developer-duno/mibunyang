# 시세 비교 범위 좁히기 — 가) 수집기·새 표 구현 계획서

> 설계서 = `docs/superpowers/specs/2026-10-03-trade-scope-narrowing.md` §4-1·§6·§8(가)·§9(가). 이 계획서는 **PR 가(`s589/trade-scope-a`)** 만 다룬다 — 묶기·통계(나)·점수(다)·화면(라)은 다음 계획서.
> 작업 위치 = 워크트리 `F:/mibunyang/.claude/worktrees/s589-trade-scope`(base `origin/main` ad9e02e7). 본 폴더 `F:/mibunyang` 은 예약 실행이 도는 운영 코드 — 편집·실행 금지.

## Global Constraints

- **`trades` 쓰기 경로는 글자 하나도 바꾸지 않는다** — 열쇠(`CONFLICT_COLS`)·중복 제거·`tradeRowGu`·`upsertBatch` 호출 그대로. 2u 가 읽는 표다. 검증 = 기존 `collect-trades.test.mjs` 전부 초록 + `git diff` 로 그 구간 변경 0 확인.
- 새 표 **`trade_deals`** 는 미분양 소유. 마이그 파일만 만든다 — **적용은 메인**(psql 리허설 ROLLBACK → 적용 → 권한 지문 재승인). 작업반은 운영 DB 에 DDL·쓰기 0.
- 외부 API 호출 = 시험·탐침 포함 **0**. 파싱 시험 재료는 조사 2차가 받아 둔 **실제 응답 사본**(`F:/mibunyang/.omc/artifacts/session589/scope/research2/raw/` — 289개 JSON, 각 파일은 응답 item 들의 칸 배열) → 작업반이 그중 **매매 1·전월세 1·분양권 1(입주권 "입" 행이 든 것)·화성 새 코드 1** 을 골라 `scripts/collectors/__fixtures__/trade-deals/*.json` 으로 옮긴다(크기 각 50행 이내로 잘라서 — 금액·이름은 공개 자료이니 그대로).
- `process.exit()` 금지(새 코드) — 기존 `main()` 의 `process.exit(1)` 은 건드리지 않는다. heredoc·여러 줄 Bash 금지, 스크립트는 Write 로. `git stash`·`git checkout --` 금지. node_modules 설치·링크 금지(시험은 `node ../../../node_modules/vitest/vitest.mjs run <파일>`).
- 수집기 실제 실행(`node scripts/collectors/collect-trades.mjs …`) 금지 — dry-run 도 외부 호출을 한다. 동작 확인은 시험·픽스처로만.
- 커밋·푸시는 메인이 한다(작업반은 `commit-msg-N.txt` + `SendMessage`).

## Review Focus

- 교체 방식(§4-1)이 **중간에 죽어도** 중복·구멍을 만들지 않는가 — 시험 "죽은 회차 흔적 + 새 회차" 로 증명.
- 0건 응답에 **지우지 않는가**(옛 코드·장애가 0건으로 온다).
- 화성 4코드가 **`trades` 쪽 행의 `gu` 를 바꾸지 않는가**("화성시" 그대로) · `--only=경기:화성시` 가 4코드를 도는가 · 다른 지역은 1코드.
- 입주권("입") 제외가 **`trade_deals` 의 분양권에만** 걸리는가(매매·전세엔 `ownershipGbn` 이 없다 · **`trades` 행은 지금처럼 "입" 도 그대로 들어간다** — 2u 가 읽는 표의 내용을 바꾸지 않는다).
- `trades` 와 `trade_deals` 에 들어가는 행 수 관계: 매매·전세는 `trade_deals` ≥ `trades`(접힘이 없으니) · 분양권은 `trade_deals` = 접힘 복원분 − "입" 행 — 시험에서 같은 입력으로 두 집합을 만들어 비교.
- 감시 ⑯ 가 **비율로** 보지 않고 **명단(코드·월)** 으로 보는가(`next-session-grep-mandate.md` §4 — 개수만 맞으면 내용이 뒤바뀌어도 통과).

## 이미 확인한 것 (메인, 2026-10-02~03 — 작업반은 다시 재지 않는다. 다르면 멈추고 보고)

| 무엇 | 결과 | 근거 |
|---|---|---|
| 원문 칸 | 매매 상세(`RTMSDataSvcAptTradeDev`): `aptSeq`·`umdCd`·`jibun`·`dealDay`·`aptDong`·`dealingGbn`·`cdealDay` 있음 · 전월세(`RTMSDataSvcAptRent`): `aptSeq`·`jibun`·`umdNm`·`contractType`·`deposit`·`monthlyRent` 있음, `umdCd` **없음** · 분양권(`RTMSDataSvcSilvTrade`): `jibun`·`umdNm`·`ownershipGbn` 있음, `aptSeq` **없음** | `.omc/artifacts/session589/scope/07-raw-tags.log` · `research2/raw/` |
| `ownershipGbn` | 값은 "입"(195행 · 14%) 또는 빈칸 — 빈칸 = 분양권으로 **추정**(공식 문서 미확인) | `research2/report-research2.md` A5④ |
| 화성 | 옛 41590 매매 202608 = 0건 · 새 코드 12개월 매매 41591 1,385 · 41593 1,897 · 41595 3,511 · 41597 10,736 | A5⑤ |
| 한도 | 창구별 하루 10,000콜(응답 헤더) · 1콜 = 한 구·한 달·한 종류 · 표본 최대 totalCount 2,798(numOfRows 9999 로 한 번에) | A7 |
| 수집 대상 | 구 207쌍 → 화성 3코드 추가로 약 210 | A7 |
| 2u | `trades` **읽기만**(`mb_models.py:163-182` · `/api/mb/trades` · 신선도 max(recorded_at)) · 새 표 영향 0 | A2 |
| `collect-trades.test.mjs` | 지금 시험이 `getLawdCd("경기","화성시") → "41591"` 을 고정한다(`:45`) — **이 시험은 그대로 통과해야 한다**(코드표 값 불변) | 파일 |

## File Structure

| 파일 | 하는 일 | 이 계획에서 |
|---|---|---|
| `supabase/migrations/20261003000000_trade_deals.sql` | 새 표 `trade_deals` + 색인 4 + RLS(공개 읽기 **없음**, Service write 만) + COMMENT | 새로 |
| `supabase/migrations/_rollbacks/20261003000001_rollback_trade_deals.sql` | DROP | 새로 |
| `scripts/collectors/_shared.mjs` | `GU_LAWD_CODES(region, gu)` → `string[]`(화성시 = 4코드 · 그 밖 = `[getLawdCd()]`) + 상수 `HWASEONG_LAWD_CODES` | 고침(추가만 — `GU_LAWD_MAP` 값 불변) |
| `scripts/collectors/_trade-deals.mjs` | 순수 함수: 원문 item → `trade_deals` 행(`buildDealRow`) · 입주권 판정(`isOwnershipRight`) · 교체 계획(`planReplace`: 기존 batch 목록 → 지울 것/남길 것) · 월 열쇠 | 새로 |
| `scripts/collectors/_trade-deals.test.mjs` + `__fixtures__/trade-deals/*.json` | 위 시험(실제 응답 사본) | 새로 |
| `scripts/collectors/collect-trades.mjs` | `fetchTradeRows` 가 `trades` 행과 **함께** `trade_deals` 행을 만든다 · `main()` 이 (코드·월·종류) 열쇠별 교체 저장 · 화성 4코드 순회 · 입주권 skip 셈 · 요약 로그에 `trade_deals N행` | 고침 |
| `scripts/collectors/collect-trades.test.mjs` | 화성 4코드 순회 · 두 표 행 수 관계 · 기존 시험 불변 | 고침(추가만) |
| `scripts/monitor-collectors.mjs` · `scripts/monitor-trade-deals.test.mjs` · `scripts/notify-telegram.mjs`(⑦~⑮ → ⑦~⑯) · `scripts/monitor-check-failed.test.mjs` | 감시 ⑯ `checkTradeDealsHealth` | 고침·새로 |
| `.claude/rules/scripts/api-quota-and-ratelimit.md` | "MOLIT_KEY 10,000 공유" → 창구별 하루 10,000(실측 헤더) 한 줄 정정 | 고침 |
| `supabase/CLAUDE.md` · `scripts/CLAUDE.md` · `.claude/BACKLOG.md` | 새 표·감시 ⑯·36개월 정리 후보 한 줄씩 | 고침 |

## Task 1: 마이그 파일 (적용은 메인)

`trade_deals` 칸 = 설계서 §4-1 표 그대로(형·null 허용). 머리 주석에 왜(구 전체 비교 → 같은 단지 · `trades` 고유 색인이 거래를 접음 · `trades` 는 2u 가 읽어 그대로 둠) 를 `air_station_annual` 마이그 관례로 적는다.
- 색인: `idx_trade_deals_aptseq(apt_seq, trade_type, deal_month)` · `idx_trade_deals_jibun(sgg_cd, umd_nm, jibun)` · `idx_trade_deals_key(sgg_cd, deal_month, trade_type, batch_id)` · `idx_trade_deals_dong(region, gu, umd_nm, deal_month)`.
- `ALTER TABLE … ENABLE ROW LEVEL SECURITY; CREATE POLICY "Service write" … FOR ALL USING (auth.role() = 'service_role');` — **"Public read" 정책은 만들지 않는다**(거래 원문은 손님에게 직접 안 나간다 · 2u V031 이 `trades` 의 anon SELECT 도 회수했다).
- **권한은 최근 새 표 관례대로 명시 회수**(`20260925000000_site_feedback.sql:37-54`): 표 `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role` → `GRANT SELECT, INSERT, UPDATE, DELETE … TO service_role` · id 시퀀스도 같은 꼴(`pg_get_serial_sequence` 로 이름을 얻어 회수 → `GRANT USAGE, SELECT … TO service_role`). Supabase 는 public 새 표에 anon·authenticated 권한을 기본으로 주므로 RLS 만으로 두지 않는다(메인 추가 08:2x).
- 롤백 파일 = DROP POLICY·INDEX·TABLE.
- 검증: `psql` 은 메인이 — 작업반은 파일만. 문법은 메인이 리허설에서 본다.

## Task 2: `_trade-deals.mjs` 순수 함수 + 시험

```
buildDealRow(item, { type, region, gu, sggCd, month, getTag }) → row | null
  - null 조건: 금액·면적 0 · 전세인데 월세 > 0 · 분양권인데 ownershipGbn === "입"(→ 호출자가 skip 셈)
  - 칸: 설계서 §4-1(apt_seq 는 매매·전세만, umd_cd 는 매매만, contract_type 은 전세만)
  - area 는 trades 와 같은 반올림(소수 둘째) · price 는 쉼표 제거 정수
isOwnershipRight(item) → boolean   // ownershipGbn 공백 제거 === "입"
dealKey(sggCd, month, type) → `${sggCd}|${month}|${type}`
planReplace(existingBatches: Array<{batch_id, recorded_at}>, newBatchId) → { deleteBatchIds: string[] }
  - 기존 batch 가 둘 이상이면 가장 새 recorded_at 하나만 남기고 나머지 + (저장 뒤) 그 하나도 지운다 — 반환은 "새 것 제외 전부"
```
시험(실제 사본 픽스처): 매매 사본 → `apt_seq`·`umd_cd`·`jibun`·`deal_day`·`apt_dong` 채움 / 전세 사본 → `apt_seq`·`contract_type` 채움·`umd_cd` null·월세 있는 행 null / 분양권 사본 → "입" 행 null·그 수가 사본의 "입" 개수와 같음·`apt_seq` null / 화성 사본 → `sgg_cd` 가 넘긴 코드 · `gu` 가 "화성시" / `planReplace` 3경우(기존 0 · 1 · 2개).

## Task 3: `_shared.mjs` 다중 코드표

```js
/** 수집기 전용 — 한 gu 가 여러 LAWD_CD 를 가질 때(2026 화성 4구). GU_LAWD_MAP 값은 다른 소비처 때문에 그대로. */
export const HWASEONG_LAWD_CODES = ["41591", "41593", "41595", "41597"]; // 만세·효행·병점·동탄 — 조사 2차 A5⑤ 실측(옛 41590 = 0건)
export function GU_LAWD_CODES(region, gu) { … 경기·화성시 → 위 4개 · 그 밖 → [getLawdCd(region, gu)] (null 이면 []) }
```
시험: 화성시 → 4개·순서 고정 · 강남구 → ["11680"] · 미지 → `getLawdCd` 와 같은 폴백 · **`getLawdCd("경기","화성시")` 는 여전히 "41591"**.

## Task 4: `collect-trades.mjs` 배선

1. `fetchTradeRows(lawdCd, months, type, rg, seen, prevFallbackUsed)` — 반환에 `deals: DealRow[]`·`skippedOwnership: number` 추가. 같은 item 루프에서 `buildDealRow` 로 만든다(**`trades` 행 만들기·`seen` 열쇠·`validate` 는 그대로**). 폴백 창구(`RTMSDataSvcAptTrade`, `aptSeq` 없음)로 받은 매매는 `apt_seq` null 로 넣는다(사실대로).
2. `main()` 의 지역 루프: `getLawdCd(rg.region, rg.gu)` 한 번 → `GU_LAWD_CODES(rg.region, rg.gu)` 를 돌며 `fetchTradeRows` 를 코드마다 부른다. `trades` 행은 지금처럼 전부 모아 한 번에 upsert(불변). `trade_deals` 는 **(코드·월·종류) 열쇠마다**: ① 기존 `batch_id` 목록 조회(`select batch_id, max(recorded_at)` 그룹 — 1,000행 넘는 조회가 아니다, 열쇠당 행 수는 ≤ 2,800) ② 새 행 insert(배치 500, `upsertBatch` 가 아니라 **insert** — `_shared` 에 insert 도우미가 없으면 `sb.from().insert()` 를 배치로 직접, 재시도 3회) ③ `delete().match({sgg_cd, deal_month, trade_type}).neq("batch_id", newId)`. **그 열쇠의 새 행이 0건이면 ②③ 를 건너뛴다**(0건 응답은 지우지 않음 — 로그 한 줄).
3. 회차 `batch_id` 하나 = `crypto.randomUUID()`. 요약 로그: `trade_deals: 열쇠 N개 · 넣음 M행 · 지움 K행 · 입주권 제외 J행 · 0건 열쇠 Z개`. `rpt` 의 skip 에 J 를 더한다(실패 아님). `trade_deals` 쓰기 실패 열쇠가 하나라도 있으면 `rpt.fail` 에 세고 회차는 실패로 끝난다(`trades` 는 이미 저장됨 — 그 사실도 로그).
4. `--only` 필터·`--months`·`--dry-run`(dry-run 은 두 표 다 안 쓴다 — 로그만) 그대로. `recordApiQuota` 호출 수 = 실제 콜 수(코드 수만큼 늘어난다).
5. 시험(`collect-trades.test.mjs` 추가): `fetchTradeRows` 를 `fetchXml` 가짜로 돌려 — 같은 응답에서 `rows`(trades) 와 `deals` 의 관계(매매·전세 `deals.length ≥ rows.length` · 같은 입력에서 `trades` 열쇠로 접히는 두 item 이 `deals` 에는 두 행) · 분양권 "입" 이 `skippedOwnership` 으로 세고 `deals` 에는 없지만 **`rows`(trades) 에는 지금처럼 들어 있음**(`trades` 내용 불변 — 2u 가 읽는다. 입주권 제외는 새 표에서만, 설계 D4) · 화성 4코드 순회 수 = 4 × 월 수.

## Task 5: 감시 ⑯ `checkTradeDealsHealth`

`monitor-collectors.mjs` 에 ⑮ 다음 자리. 재료 한 번 조회(그룹 쿼리 또는 `selectAll` 로 최근 2개월 `sgg_cd, deal_month, trade_type, batch_id` 만) → 판정 셋:
- (a) 같은 (sgg_cd·월·종류) 에 `batch_id` 둘 이상 → `kind: "trade-deals-dup"` 명단(열쇠 글자 그대로).
- (b) 화성 4코드 각각 최근 달 매매 행 0 → `kind: "trade-deals-hwaseong"`(어느 코드인지).
- (c) 최근 달(어제 기준 전월) `trade_deals` 행 수 ÷ 같은 달 `trades` 행 수 가 0.9~1.3 밖 → `kind: "trade-deals-ratio"`(두 수 모두 적는다). 재수집 전엔 (c) 가 울릴 수 있다 → **`trade_deals` 가 비어 있으면(0행) 세 판정 모두 "아직 없음" 으로 침묵**(마이그 적용~재수집 사이).
`notify-telegram.mjs` "⑦~⑮" → "⑦~⑯". 시험 `monitor-trade-deals.test.mjs`(a·b·c 각 양성·음성 + 빈 표 침묵) + `monitor-check-failed.test.mjs` 의 묶음 수 반영. 변이: 임계 0.9/1.3 바꾸기 · 명단 대신 개수 · 빈 표 침묵 제거.

## Task 6: 문서 + 최종 게이트

- `.github/workflows/monitor-db-size.yml`: 행 수를 세는 표 목록에 `'trade_deals'` 한 줄 추가(설계서 §4-1 보존 — 표가 커지는 것을 매월 본다).
- `api-quota-and-ratelimit.md`: 한도 문장 정정(근거 "조사 2차 A7 응답 헤더 실측 2026-10-02"). `supabase/CLAUDE.md`: 표 목록에 `trade_deals`(소유 미분양 · 공개 읽기 없음 · 교체 방식 · 2u 영향 0). `scripts/CLAUDE.md`: 수집기 절에 두 표 쓰기·화성 4코드 한 줄. `BACKLOG.md`: 36개월 정리 후보 · 분양권 `ownershipGbn` 빈칸 뜻 공식 확인.
- 게이트(숫자로 보고): `npm run typecheck:scripts` 0 · 표적 시험(`collect-trades.test.mjs`·`_trade-deals.test.mjs`·`_shared` 관련·monitor 2파일) 전부 초록 · 정적 가드 3종(`_graceful-coverage`·`_selectall-keycol-coverage`·`_unbounded-query-coverage`) · 전체 vitest 1회(메인 신호 뒤 — 밤 배치 창·다른 작업반과 겹치지 않게) · 변이 표(최소: "입" 조건 제거 · 0건 삭제 건너뛰기 제거 · 화성 코드 하나 삭제 · `planReplace` 전부 지우기 · 비율 임계 · `trades` 경로에 손댔는지 `git diff` 구간 0).

## 운영 반영 (메인 — 전이표 승인 뒤, `data-changing-run-approval.md`)

1. 마이그 psql 리허설(`BEGIN → 적용 → \d trade_deals → ROLLBACK`) → 적용 → `perm-baseline.mjs` 미리보기 → 재승인.
2. 합침 → 운영 폴더 ff pull(예약 창 밖 — 매일 05:30~06:30 · 월·목 08:00~15:00 피함) → `node --check`.
3. **12개월 재수집 1회** `node scripts/collectors/collect-trades.mjs --months=12`(파이프 금지 — 파일로 받기 · 창구별 2,520콜 · 2u 는 다른 창구 · 소요 = 9/06 6개월 회차 API 1,206초 실측 기준 API 약 40분 + 저장, 러너 주석의 옛 실측 74~120분(6개월)이면 2~4시간까지 — 예약 창 밖 낮에 시작). 전이표에 적을 변화: `trade_deals` 0 → 약 1M 행(새 표) · `trades` 행 수 **증가만**(강남 전세 옛 달 등 공백 메움 · 화성 3구 신규 약 +4만 — upsert 라 기존 행은 같은 값으로 덧씌워지고 줄어드는 행 0) · 재수집 로그의 `입주권 제외 J행` 은 `trade_deals` 에서만 빠진 수.
4. 대조(§8 가): 표본 8구 월별 행 수 vs 원문 totalCount(조사 2차 `raw/` 와 맞대기) · `apt_seq` 채움률 · 화성 4코드 > 0 · 중복 batch 0 · `trades` 쓰기 경로 diff 0.
5. 2u 통지(새 표 소개 · `trades` 계속 씀 · 창구별 한도 · 입주권 제외로 분양권 행이 준다).
