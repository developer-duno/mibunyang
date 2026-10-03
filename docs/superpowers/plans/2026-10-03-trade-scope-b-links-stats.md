# 시세 비교 범위 좁히기 — 나) 단지↔거래 묶기 · 통계 새 칸 구현 계획서

> 설계서 = `docs/superpowers/specs/2026-10-03-trade-scope-narrowing.md` §4-2·§4-3·§5-1·§5-2·§8(나)·§9(나). 이 계획서는 **PR 나(`s590/trade-scope-b`)** 만 다룬다 — 점수(다)·화면(라)은 다음 계획서.
> 작업 위치 = 워크트리 `F:/mibunyang/.claude/worktrees/s590-trade-scope-b`(base `origin/main` 43789c58). 본 폴더 `F:/mibunyang` 은 예약 실행이 도는 운영 코드라 편집·실행 금지.
> 손님 화면·점수는 이 PR 에서 **안 바뀐다** — 새 값은 `trade_stats` 새 칸과 연결 표에만 쌓이고, 아무도 읽지 않는다(다 에서 읽기 시작).
> 용어: **가짜 지번** = 좌표를 역지오코딩해 얻은 지번을 이름이 다른 우리 단지 2종 이상이 함께 쓰는 경우(룰 `placeholder-coordinates-truth-sources.md` 의 placeholder 서명).

## 설계서와 다른 점 (메인 기술 선택 · 2026-10-03 세션590 — 근거는 아래 "이미 확인한 것")

| # | 설계서 | 이 계획 | 왜 |
|---|---|---|---|
| B1 | §9 나) 에 "VIEW 새 칸" | **VIEW 는 건드리지 않는다 → 다) 로 옮김** | 매일 굽기가 `apartments_flat` 을 `select("*")` 로 통째로 읽어 공개 JSON 에 쓴다(`scripts/collect-data.mjs:1104-1105`·`:1067-1068`). 나) 에서 칸을 붙이면 화면이 쓰지도 않는 값(면적별 표 jsonb 등)이 그날 밤 공개 자료에 실린다. 다) 는 점수가 그 칸을 읽기 시작하는 PR 이라 거기서 붙인다. 나) 검증은 `trade_stats` 를 직접 읽는다 |
| B2 | §4-2 "매일 배치 `--apply`" | **`collect-trade-stats.yml` 안에서 `trade-stats` 바로 앞 단계**(매월 8·22일 01:00 KST) | 연결 표를 읽는 쪽이 `trade-stats` 하나뿐이고 그것이 월 2회 돈다(`collect-trade-stats.yml:9` cron `0 16 7,21 * *`). 매일 돌리면 굽기(`daily-deploy.yml`) 시간 한도만 먹는다. 거래 원문(`trade_deals`)도 매월 6일에만 바뀐다 |
| B3 | §5-1 4 "한 후보가 우리 단지 둘 이상에 붙으면 hold" | **"서로 다른 `complex_key` 묶음 둘 이상"** 일 때만 hold | 우리 표는 한 실제 단지를 여러 행(네이버 ap-*·청약홈 ah-*·회차)으로 갖고 그 행들은 같은 `complex_key` 다(가) 열쇠 깔기, 3,256행 → 묶음 2,360). 행 단위로 세면 정상 짝이 전부 hold 가 된다. 임대 행(`isLeaseUnit`)은 충돌 셈에서 뺀다(같은 단지 분양·임대가 거래를 공유하는 것은 정상 — 예 ap-6027481·ap-6028455) |
| B4 | (없음) | **사람 판정 파일** `docs/audits/trade-link-decisions.json` | hold 를 사람이 판정하면 그 결과가 다음 실행에도 남아야 한다 — `same-complex-exceptions.json` 과 같은 방식(레포 파일 · 메인이 PR 로 고침) |
| B5 | §9 나) "trade-stats 1회" | **손으로 쓰지 않는다** — 새 칸 확인은 `--dry-run --out` 으로, 실제 쓰기는 **정기 회차(10/08 01:00, 늦으면 10/22)** | 손으로 돌리면 옛 칸(구 값)이 정기보다 먼저 바뀐다 — 10/03 재수집으로 `trades` 가 메워져 옛 칸 값이 움직이는 것은 정기 회차의 몫이다(시작 블록 §7) |

## Global Constraints

- **옛 칸 계산은 글자 하나도 바꾸지 않는다** — `trade-stats.mjs` 의 `nearby_median`·`jeonse_rate`·`pir`·`psr`·`price_by_area`·`rent_by_area`·`jeonse_by_area`·`price_by_floor`·`recent_trades_6m`·`cancel_ratio_6m`·`avg_floor`·`floor_range`·`nearby_build_year`·`dsr40pass` 경로(`:286-566`·`:599-601`·`:683-694`). 2u 가 `trade_stats` 를 읽는다(`supabase/CLAUDE.md:134` — 칸 삭제·이름 변경 금지, 추가는 무해). 허용되는 변경은 ① 조회 추가(`:225` Promise.all 에 새 조회 · `:226` apartments select 에 칸 추가) ② 결과 행에 새 칸 펼치기 ③ "모든 값 null 이면 건너뜀"(`:569-578`)에 "새 칸도 전부 비었으면" 조건 덧붙이기 ④ 요약 로그·`--out` 추가. 검증 = `git diff` 로 위 구간 변경이 ①~④ 뿐인지 + 옛 칸 시험 초록.
- 새 계산은 **순수 함수 모듈** `scripts/collectors/_trade-scope.mjs` 에 둔다(DB 접근 0) — `trade-stats.mjs` 는 재료를 읽어 넘기고 결과를 펼치기만.
- 마이그 파일만 만든다 — **적용은 메인**(psql 리허설 ROLLBACK → 적용 → 권한 지문 재승인). 작업반은 운영 DB 에 DDL·쓰기 0.
- 운영 DB **읽기**는 허용하되 범위를 정한다: ① 시험 픽스처를 뜨는 조회(대조군 단지 ≤ 20행 + 그 단지들의 `trade_deals` 를 `sgg_cd`·`umd_nm` 으로 좁힌 조회) ② 마지막에 `assign-trade-links.mjs` **미리보기 1회**(연결 표가 아직 없으면 "지금 연결 0" 으로 보고 진행 — 아래 Task 3). 그 밖의 전량 조회·반복 실행 금지(공유 DB · 2u 와 같은 인스턴스). 접속값은 `node --env-file=F:/mibunyang/.env.local` 로만, 값 출력 금지.
- 외부 API 호출 **0**. `trade-stats.mjs` 실행 금지(`--dry-run` 포함 — 전량 조회를 두 번 한다. 메인이 운영 반영 때 1회).
- `process.exit()` 금지(새 코드 — Windows 에서 fetch 뒤 exit 는 127, 세션579). heredoc·여러 줄 Bash 금지, 스크립트는 Write 로. `git stash`·`git checkout --` 금지. node_modules 설치·링크 금지(시험은 `node ../../../node_modules/vitest/vitest.mjs run <파일>`).
- 커밋·푸시는 메인이 한다(작업반은 `commit-msg-N.txt` + `SendMessage`).

## Review Focus

- 묶기가 **남의 단지 거래를 붙이지 않는가** — 대조군 음성 2(옆 필지·차수)가 붙지 않고, 보류 2(같은 지번 1·2·3단지·지번 여럿)가 active 로 새지 않는가. "우리 이름에만 차수" 를 버리는가(`namesCompatible` 은 **둘 다 차수가 있고 다를 때만** 막는다 — `_match-gates.mjs:219-254`. 한쪽만 있는 경우는 따로 막아야 한다).
- 가짜 지번(같은 지번을 이름 다른 우리 단지 2종 이상이 공유 · `coord_shared`)에서 지번 경로를 **안 쓰는가**.
- 연결 표 쓰기가 **차단기·승인 계획 대조** 를 열쇠 깔기(`assign-complex-keys.mjs`)와 같은 수준으로 갖는가 — 미리보기 기본 · 허용 목록 인자 · `--apply-from` 은 줄 단위 집합 대조 · 쓸 때 이전 상태 확인.
- 통계가 **열쇠마다 가장 새 완성 batch 만** 읽는가(설계서 §4-1 — 반쪽 batch 를 읽으면 건수가 틀어진다).
- 범위 판정(§5-2)의 문턱·면적·또래·해제·갱신 규칙이 상수로 한 곳에 있고 시험이 경계값을 잡는가(10㎡ 미만 vs 이하 · 10년 이하 · 3건).
- **옛 칸 diff 0** — 새 칸이 옛 칸 계산을 건드리지 않는가.
- 전세가율 100% 초과가 **0** 인가(같은 단지·같은 평수 비교면 0 이어야 한다 — 시제품 실측).

## 이미 확인한 것 (메인, 2026-10-03 — 작업반은 다시 재지 않는다. 다르면 멈추고 보고)

| 무엇 | 결과 | 근거 |
|---|---|---|
| 굽기 | `daily-deploy.yml` → `collect-data.mjs --from-supabase-only` 가 `apartments_flat` 을 **anon 키로 `select("*")`** → `public/data/apartments.json`(전량)·목록·상세 버킷 | `scripts/collect-data.mjs:1100-1105`·`:1050-1076` |
| VIEW | 최신 정의 = `supabase/migrations/20260922000004_view_add_coord_shared.sql`(`:42` CREATE OR REPLACE · `:222-235` `ts.*` · `:312` LEFT JOIN trade_stats). 이 PR 은 손대지 않음(B1) | 파일 |
| `trade_stats` | PK `apartment_id` REFERENCES apartments ON DELETE CASCADE · "Public read" + "Service write" 정책 · updated 트리거 · 2u 읽음 | `20260313024159_init_mibunyang.sql:187-195`·`:320`·`:332`·`:378-379` · `supabase/CLAUDE.md:134` |
| `trade-stats` 실행 | GitHub Actions `collect-trade-stats.yml` cron `0 16 7,21 * *`(8·22일 01:00 KST) · timeout 30분 · 최근 4회 소요 6~8분 · 서비스 키 | `collect-trade-stats.yml:9`·`:25` · `gh run list` |
| `trade-stats` 지금 조회 | `:225-265` 병렬 8개(apartments 는 `id,name,region,gu,naver_jeonse_rate`) · `fetchAll` 고유 키 커서(`:88`) · 결과 upsert `:657-679`(배치 500, onConflict apartment_id) | 파일 |
| `trade_deals` | 칸 = `20261003000000_trade_deals.sql:30-59`(`apt_seq`·`sgg_cd`·`umd_cd`·`umd_nm`·`jibun`·`jibun_main`·`jibun_sub`(TEXT, 앞 0 뗌, 부번 없으면 '0', 숫자 지번 아니면 NULL)·`apt_name`·`build_year`·`area`·`price`·`contract_type`·`cancel_date`·`batch_id`·`batch_rows`·`recorded_at`) · 운영 1,055,629행(10/03) · 읽기 쪽 "완성 batch" 고르는 **공용 함수는 아직 없다**(감시 ⑯ 안에 지역 함수 `monitor-collectors.mjs:1549` 만) | 파일 · 세션589 |
| `apartments` 묶기 재료 | `bjd_code` TEXT(10자리) · `lot_main`·`lot_sub` **INTEGER**(거래 쪽은 TEXT — 문자열로 맞춰 비교) · `completion` TEXT("202605") · `coord_shared` · `complex_key` · `presale_type` · `dong`(`reverse-geocode.mjs:201` `admin.region_3depth_name` — 법정동인지 행정동인지 **작업반이 확인**) | `init:21` · `20260922000004:16-18` |
| 라이브 재료 분포 | 1,918곳 중 법정동코드 10자리 1,890 · 지번 본번 정상 1,098(빈칸 815) · 입주 후 985곳 지번 84% · 입주 전 896곳 29% · 가짜 지번 15곳(단지 36) | `.omc/artifacts/session589/scope/research2/report-research2.md` A4 |
| 이름 도구 | `cleanMatchName`(`_match-gates.mjs:151`) · `namesCompatible`(`:219` — 차수 둘 다 있고 다름·로마·블록 충돌만 거부) · `isMovedIn(completion, now)`(`:111`) · `stringSimilarity`(`_shared.mjs:926`) | 파일 |
| 틀(재사용) | 열쇠 깔기 `assign-complex-keys.mjs`: `parseArgs` 허용 목록(`:143`) · `planKeyUpdates`(`:74`) · `evaluateChangeBreaker`(`:99`, 30행 또는 10% 또는 채움 > 기존) · `comparePlanToApproved`(`:127`) · `failRun`(`:190`) · `main`(`:196-309`) · `--out` 은 `wx` | 파일 |
| 대조군 10쌍 | 양성 4(화성시청역 서희스타힐스 4차 숲속마을 · 반정 아이파크 캐슬 5단지 · 화성비봉 B2블록 호반써밋(이름 기준은 놓침) · 동탄 A106블록 어울림파밀리에(이름 바뀜 "동탄아테라파밀리에", 전세만)) + 힐스테이트 광교중앙역 퍼스트(전세 1건) / 음성 2(신동탄포레자이 960 ↔ e편한세상반월나노시티역 · 금강펜테리움 6차 재공급 ↔ 7차 센트럴파크) / 보류·애매 3(운암자이포레나퍼스티체 1단지 — 분양권 1·2·3단지 지번 252 · 디에이치 퍼스티어 아이파크 — 분양권 660-1, 매매 660-4 · 화성 비봉 B-4BL 우미린 ↔ 우미린더퍼스트 유사도 0.32) | research2 표 |
| 시제품 수치(검산용) | 문턱 3 · 라이브 1,918: T1 641(입주 후 315 · 입주 전 326) · 같은 단지 전세가율 237곳 · N10 T2 429+295 | `.omc/artifacts/session589/scope/proto/report-proto-v11.md` |

## File Structure

| 파일 | 하는 일 | 이 계획에서 |
|---|---|---|
| `supabase/migrations/20261004000000_trade_links_and_scope_stats.sql` | 새 표 `apartment_trade_links` + `trade_stats` 새 칸 12개 + 색인 + RLS(공개 읽기 **없음**) + 권한 명시 회수 + COMMENT | 새로 |
| `supabase/migrations/_rollbacks/20261004000001_rollback_trade_links_and_scope_stats.sql` | DROP 표 · DROP COLUMN 12 | 새로 |
| `scripts/collectors/_trade-deals.mjs` | `keepNewestCompleteBatches(rows)`(순수) + `fetchTradeDealsWindow(sb, { fromMonth, cols })`(완성 batch 만 · 고유 키 커서) 추가 | 고침(추가만) |
| `scripts/collectors/_trade-links.mjs` | 순수 함수: 열쇠 사전 · 지번 경로 · 이름 경로 · 가짜 지번 판정 · 형제/차수 hold · 사람 판정 덮어쓰기 · 연결 계획(diff) · 차단기 | 새로 |
| `scripts/collectors/assign-trade-links.mjs` | CLI — 미리보기 기본 · `--out` · `--apply` · `--apply-from` (열쇠 깔기 틀) | 새로 |
| `scripts/collectors/_trade-scope.mjs` | 순수 함수: 단지 하나의 범위 판정(T1/T2/T3) · 적정가 · 같은 단지 전세가율 · 면적별 표 · 동네 사실 | 새로 |
| `scripts/collectors/trade-stats.mjs` | 조회 3개 추가(`trade_deals` 12개월 · 연결 표 active · apartments 칸) → `_trade-scope` 호출 → 새 칸 펼치기 · 요약 · `--out` | 고침(허용 ①~④만) |
| `docs/audits/trade-link-decisions.json` | 사람 판정 `{ "decisions": [] }`(빈 배열로 시작) | 새로 |
| 시험 `_trade-links.test.mjs` · `_trade-scope.test.mjs` · `assign-trade-links.test.mjs` · `_trade-deals.test.mjs`(추가) · `__fixtures__/trade-links/*.json` | 아래 Task 별 | 새로·추가 |
| `.github/workflows/collect-trade-stats.yml` | `trade-stats` 앞에 `Assign trade links` 단계(continue-on-error · timeout 10분 · `--apply`) · `dry_run` 입력이면 링크도 미리보기 | 고침 |
| `scripts/monitor-collectors.mjs` · `scripts/monitor-trade-links.test.mjs` · `scripts/notify-telegram.mjs`(⑦~⑯ → ⑦~⑰) · `scripts/monitor-check-failed.test.mjs` | 감시 ⑰ `checkTradeLinksHealth` | 고침·새로 |
| `supabase/CLAUDE.md` · `scripts/CLAUDE.md` · `.claude/BACKLOG.md` | 표·배치·감시 한 줄씩 · B1 을 다) 몫으로 | 고침 |

## Task 1: 마이그 파일 (적용은 메인)

`apartment_trade_links` (설계서 §4-2 + 아래):

| 칸 | 형 | 비고 |
|---|---|---|
| `id` | BIGSERIAL PK | 고유 키 커서용(`selectAll(…, "id")`) |
| `apartment_id` | TEXT NOT NULL REFERENCES apartments(id) **ON DELETE CASCADE** | `trade_stats` 와 같은 관례 |
| `link_kind` | TEXT NOT NULL CHECK IN ('apt_seq','presale') | |
| `link_key` | TEXT NOT NULL | `apt_seq` 값 또는 `sgg_cd\|umd_nm\|jibun\|정리이름` |
| `method` | TEXT NOT NULL CHECK IN ('jibun+name','name','manual') | |
| `similarity` | NUMERIC(4,3) | |
| `build_year_gap` | SMALLINT | |
| `trade_apt_name` · `trade_jibun` | TEXT | 눈 검수용 |
| `status` | TEXT NOT NULL CHECK IN ('active','hold','rejected') | |
| `hold_reason` | TEXT | `sibling`(다른 묶음과 공유) / `phase`(차수 다른 후보 둘) / NULL |
| `created_at` · `updated_at` | TIMESTAMPTZ DEFAULT NOW() | |
| `verified_at` · `verified_by` | TIMESTAMPTZ · TEXT | 사람 판정(판정 파일에서) |

- 유니크 `(apartment_id, link_kind, link_key)`. 색인 `(link_kind, link_key)`(형제 충돌 감시) · `(status)`.
- RLS 켬 + `"Service write" FOR ALL USING (auth.role() = 'service_role')` — **공개 읽기 없음**. 권한은 `trade_deals` 마이그(`20261003000000_trade_deals.sql`)와 같은 꼴로 표·시퀀스 `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role` → `GRANT SELECT, INSERT, UPDATE, DELETE … TO service_role` · 시퀀스 `GRANT USAGE, SELECT`(그 파일의 사후 확인 DO 블록도 같이).
- `trade_stats` 새 칸(설계서 §4-3 그대로 — `ADD COLUMN IF NOT EXISTS`): `cmp_scope TEXT CHECK IN ('complex','dong_peer','none')` · `cmp_fair_price INTEGER` · `cmp_n SMALLINT` · `cmp_months SMALLINT` · `cmp_area_mode TEXT CHECK IN ('same_area','per_m2')` · `cmp_src TEXT CHECK IN ('sale','presale')` · `complex_jeonse_rate NUMERIC(5,1)` · `complex_jeonse_n SMALLINT` · `complex_sale_n SMALLINT` · `complex_table JSONB` · `complex_jeonse_table JSONB` · `dong_fact JSONB`. 칸마다 COMMENT(뜻·범위·문턱). 옛 칸은 손대지 않는다.
- 머리 주석: 왜(구 전체 비교 → 같은 단지 · 이 칸은 다) 전까지 아무도 안 읽음 · VIEW 는 다) 에서 — B1) · 선행 = `20261003000000_trade_deals.sql`(없으면 RAISE).
- 롤백 = DROP TABLE apartment_trade_links · ALTER TABLE trade_stats DROP COLUMN 12개.

## Task 2: `_trade-deals.mjs` 읽기 도우미 + 시험

```
keepNewestCompleteBatches(rows) → rows
  - 열쇠 = (sgg_cd, deal_month, trade_type). 열쇠마다 batch_id 별 행 수를 세어 "완성"(행 수 === batch_rows) 인 것 중
    recorded_at 이 가장 늦은 batch 하나만 남긴다. 완성 batch 가 없는 열쇠는 통째로 뺀다(반환에 { droppedKeys } 정보 — 호출자가 로그).
fetchTradeDealsWindow(sb, { fromMonth, cols }) → { rows, droppedKeys, total }
  - deal_month >= fromMonth · 고유 키 커서(id 오름차순, 1,000행) · 고른 칸 + batch_id·batch_rows·recorded_at·sgg_cd·deal_month·trade_type 는 늘 포함
  - 받은 뒤 keepNewestCompleteBatches. 조회 실패는 던진다(조용한 [] 금지 — 호출자가 기록).
```
시험: 완성 하나 · 완성 둘(새 것만) · 미완성만(열쇠 빠짐) · 완성+미완성(완성만) · 열쇠 셋 섞임. 변이: 완성 조건 `===` → `>=` · 최신 → 최초.

## Task 3: `_trade-links.mjs` + `assign-trade-links.mjs` + 시험

### 3-1. 순수 함수 (`_trade-links.mjs`)

```
buildKeyDictionary(deals) → { aptSeq: Map<apt_seq, Entry>, presale: Map<presaleKey, Entry>, umdName: Map<sgg+umd_cd, umd_nm> }
  Entry = { key, sgg_cd, umd_cd|null, umd_nm, jibuns: Set("본번-부번"), name(최빈 apt_name), build_year(최빈), n }
  - apt_seq 는 매매·전세 행(같은 apt_seq 의 umd_cd 는 매매 행에서) · presale 는 분양권 행, 열쇠 = `${sgg_cd}|${umd_nm}|${jibun}|${cleanMatchName(apt_name)}`
  - umdName = 매매 행의 (sgg_cd+umd_cd → umd_nm) — 우리 bjd_code 10자리로 법정동 이름을 얻는 길(apartments.dong 이 행정동이어도 된다).
    그 동에 매매가 하나도 없으면(새 택지 — 분양권·전세만 있는 동) umdName 에 없다 → `apartments.dong` 이 **법정동일 때만** 그 값을 쓴다(작업반이 `reverse-geocode.mjs:201` 로 확인한 결과를 보고에 적는다. 행정동이면 그 단지는 지번·이름 경로 모두 "동 이름 모름"으로 버리고 사유를 dropped 에)
isPlaceholderJibun(apt, allApts) → boolean
  - apt.coord_shared === true 이거나, 같은 (bjd_code, lot_main, lot_sub) 를 cleanMatchName 이 다른 우리 단지가 함께 쓰면 true
matchApartment(apt, dict, { now }) → Candidate[]   // 한 단지의 후보(판정 근거 포함)
  - 지번 경로(가짜 지번이면 건너뜀): 후보 = bjd_code[0:5]===sgg_cd 그리고 (umd_cd 가 있으면 bjd_code[5:10]===umd_cd, 없으면 umdName 으로 얻은 이름 === umd_nm)
    그리고 jibuns 에 `${lot_main}-${lot_sub ?? 0}` (우리 부번이 0/null 이면 본번만 같아도) → 이름 검사 = namesCompatible + phaseOnlyOneSide 아님
    + stringSimilarity(cleanMatchName(우리), cleanMatchName(거래)) ≥ JIBUN_NAME_MIN(0.6) + 연도 차 ≤ YEAR_GAP_MAX(2, 둘 다 있을 때) → method "jibun+name"
  - 이름 경로(지번 없음·가짜 지번·지번 경로 0건): 같은 법정동 후보 중 namesCompatible + phaseOnlyOneSide 아님 + (유사도 ≥ NAME_ONLY_MIN(0.85) 또는 공백 뗀 부분문자열) + 연도 차 ≤ 2 → "name"
  - 입주 전 단지는 apt_seq·presale 둘 다 본다(분양권이 판정 재료 — R2). 연도 = 우리 completion 연도 ↔ Entry.build_year
phaseOnlyOneSide(ours, theirs) → boolean   // 우리 이름에만 차수(N차·N단지·블록)가 있고 거래 이름엔 없음 → 버림(시제품 틀린 짝 대부분)
planLinks(apts, dict, decisions, { now }) → { desired: Link[], dropped: Array<{ apartment_id, key, why }> }
  - 형제(B3): 한 열쇠가 서로 다른 complex_key 묶음 둘 이상(임대 행 제외)에 붙으면 그 열쇠의 모든 짝 = hold(hold_reason "sibling"). complex_key 가 빈 행(그날 들어와 아직 열쇠가 안 깔린 행)은 자기 id 를 묶음으로 본다
  - 차수: 한 단지에 차수가 서로 다른 후보 둘 이상 → 그 단지의 그 후보들 = hold("phase"). 차수 충돌 없는 여러 열쇠(대단지 여러 지번)는 전부 active
  - 사람 판정(decisions): 같은 (apartment_id, link_kind, link_key) 가 있으면 그 결정이 이긴다(active → method "manual" · rejected → status rejected 로 남겨 다시 제안 안 함). 판정 파일에만 있고 계산엔 없는 줄도 넣는다(manual)
diffLinks(current, desired) → { add, remove, change, unchanged }   // change = status·method·similarity 바뀜
evaluateLinkBreaker({ add, remove, change, existing }) → { tripped, reason }
  - (remove + change) > 30 또는 (remove + change)/existing > 10% · 또는 add > existing(첫 채우기) → 막음 — 수치는 열쇠 깔기와 같게 시작, 첫 실행 뒤 실측으로 다시 정한다(`data-changing-run-approval.md` §2)
parseLinkDecisions(json) → Decision[]   // 형식 틀리면 던진다
```
상수는 머리에 한 곳(`JIBUN_NAME_MIN`·`NAME_ONLY_MIN`·`YEAR_GAP_MAX`·차단기 두 수).

### 3-2. CLI (`assign-trade-links.mjs`) — `assign-complex-keys.mjs` 틀 그대로

- 인자 허용 목록: (없음 = 미리보기) · `--out=<절대경로>`(미리보기에서만 · `wx`) · `--apply` · `--apply-from=<계획 파일>`. `--dry-run` 포함 그 밖은 던진다.
- 순서: 판정 파일 읽기 → (`--apply-from` 이면 계획 파일 읽기) → apartments 전량(`id,name,region,gu,dong,bjd_code,lot_main,lot_sub,completion,coord_shared,complex_key,presale_type` — `isLeaseUnit` 재료는 `presale_type`·`name`(`src/constants/leaseTypes.mjs:82`) · 받은 수 = count exact 확인) → `fetchTradeDealsWindow`(12개월) → 지금 연결 표(없으면 — `isMissingTable` — 미리보기만 "지금 연결 0" 으로 진행, 쓰기 실행은 실패 `LINK_NO_TABLE`) → 계획 → 미리보기 출력/`--out` → 차단기·승인 대조 → 쓰기.
- 쓰기: add = insert · remove = delete by id(이전 상태 확인 `.eq("status", prev)`) · change = update by id(같은 확인) · 동시 5 · 배치 사이 100ms · 돌아온 행 수로 성공을 센다 · `createReporter` + 중단 신호 break · `recordCollectorRun("assign-trade-links", …)` · 머리말 `LINK_*`(`LINK_COUNT_MISMATCH`·`LINK_NO_TABLE`·`LINK_BREAKER`·`LINK_PLAN_MISMATCH`·`LINK_WRITE`·`LINK_ERROR`). 오류 경로에서 `process.exit` 금지(`process.exitCode`).
- `--out` 파일 = `{ takenAt, apartments, deals, dictionary: {aptSeq, presale}, counts: {active, hold, rejected, add, remove, change}, byMethod, holds: [...], dropped: [...상위 500], plan: {add, remove, change} }` — 줄마다 단지 이름·시도·구·거래 이름·지번·유사도·연도 차(검사관·사장님이 DB 없이 읽는다).
- 미리보기 로그: 입주 후·입주 전·모름 별 연결된 단지 수 · method 별 · hold 사유별 · 대조군 10쌍 결과 줄(이름으로 찾아 찍는다).

### 3-3. 시험

- 픽스처 `__fixtures__/trade-links/`: 대조군 10쌍의 **우리 단지 행**(운영 DB 에서 읽기 — 칸은 위 select 와 같게) + **그 단지들의 법정동 `trade_deals` 행**(`sgg_cd`·`umd_nm` 으로 좁혀 읽기, 완성 batch 만, 12개월 — 크면 그 동의 다른 단지 행은 단지마다 5행까지 잘라도 된다. 지번·이름·apt_seq 는 그대로). 공개 자료라 그대로 둔다. 픽스처를 뜬 스크립트는 `.omc/artifacts/session590/worker-b/` 에 남긴다(레포 밖).
- `_trade-links.test.mjs`: 대조군 — 양성 4(+광교중앙역 퍼스트) active · 음성 2 없음(dropped 사유 확인) · 운암 1단지 = 분양권 252 의 "1단지" 후보만(2·3단지는 차수로 버림 또는 hold — 어느 쪽이든 active 로 2·3단지가 붙으면 빨강) · 디에이치 = 660-1 분양권·660-4 매매 둘 다 active(차수 충돌 없는 여러 열쇠) 또는 근거 있는 hold · 우미린 0.32 는 이름 경로 미달(지번 경로면 0.6 미달로 버림). 그 밖: 가짜 지번(같은 지번·이름 다른 우리 단지 2) → 지번 경로 안 씀 · 형제(다른 complex_key 둘) → hold · 같은 complex_key 두 행 → 둘 다 active · 임대 행 + 분양 행(다른 묶음) → 충돌 아님 · `phaseOnlyOneSide` · 판정 파일 active/rejected 덮어쓰기 · `diffLinks` 네 갈래 · 차단기 경계(30/31행 · 10%/10.1% · 첫 채우기).
- `assign-trade-links.test.mjs`: `parseArgs`(열쇠 깔기 시험 꼴) · `--out` 이 있으면 던짐 · 표 없음 + 쓰기 → `LINK_NO_TABLE`.
- 변이(최소): 가짜 지번 판정 제거 · `phaseOnlyOneSide` 제거 · 형제 판정을 행 단위로 · 0.6/0.85 바꾸기 · 차단기 한도 · 판정 파일 무시 · 승인 대조를 개수로.

## Task 4: `_trade-scope.mjs` + `trade-stats.mjs` 배선 + 시험

### 4-1. 순수 함수

```
상수: SAME_AREA_TOL_M2 = 10 (미만) · PER_M2_TOL_M2 = 20 (이하) · PEER_YEARS = 10 (이하) · MIN_DEALS = 3 · CMP_MONTHS = 12
computeScopeStats(apt, ctx) → 새 칸 12개(설계서 §4-3)
  apt = { id, area, completion, bjd_code }   (area = trade-stats 의 대표 면적 latestPriceMap)
  ctx = { links: Link[](이 단지 active), dealsByAptSeq, dealsByPresaleKey, saleByUmd: Map<sgg+umd_cd, deal[]>, now }
  - 거래 거름(공통): cancel_date 비어 있음(null 또는 "") · 기간 12개월(재료가 이미 12개월) · price>0 · area>0
  - 입주 여부 = isMovedIn(completion, now): true → 매매(cmp_src sale) · false → 분양권(presale) · null(모름) → 둘 다 찾아 있는 쪽(둘 다면 매매)
  - T1: 이 단지 active 열쇠의 해당 종류 거래 중 |area − apt.area| < 10 이 3건 이상 → 중앙값(same_area).
        아니면 |area − apt.area| ≤ 20 거래 3건 이상의 ㎡당 중앙값 × apt.area(per_m2, 정수 반올림). 아니면 T2.
        apt.area 없음 → 적정가 없음(T1·T2 둘 다 건너뜀 → none). 단 면적별 표·전세 표는 채운다
  - T2: saleByUmd[bjd_code 10자리] 의 매매 중 같은 평수(<10) · 또래(|build_year − 우리 연도| ≤ 10, 둘 다 있을 때만 또래로 셈) 3건 이상 → 중앙값(dong_peer, same_area). 계수 없음
  - T3: none · cmp_fair_price null · cmp_n 0
  - complex_jeonse_rate: T1 열쇠(apt_seq)의 같은 평수 전세(contract_type !== "갱신") ≥3 그리고 같은 평수 매매 ≥3 → 전세 중앙 ÷ 매매 중앙 ×100(소수 첫째). 아니면 null. complex_jeonse_n·complex_sale_n 은 그 건수(null 이어도 건수는 적는다)
  - complex_table: T1 열쇠 거래(cmp_src 종류)를 면적(소수 둘째 반올림)별 [{area, n, min, median, max, last_month}] 면적 오름차순 · complex_jeonse_table 같은 꼴(갱신 제외) · 열쇠 없으면 []
  - dong_fact: saleByUmd 의 같은 평수 매매(나이 제한 없음) ≥1 이면 {n, min, median, max, build_year_min, build_year_max, age_gap_years, peer_n, peer_median}
        age_gap_years = 우리 연도 − 그 거래들 build_year 중앙값(**양수 = 그 집들이 더 오래됨**) · 우리 연도 모르면 null · peer_* = 또래만. 없으면 null
  - 우리 단지 거래를 동네 표본에서 빼지 않는다(사실대로 — T2 에 들어가는 것은 같은 평수 3건 미만일 때뿐)
  - median 은 trade-stats 의 median(짝수면 두 가운데 평균 반올림)과 같은 정의 — 그 함수를 옮겨 쓰지 말고 import(`trade-stats.mjs` 는 CLI 라 import 시 main 이 안 도는지 확인. 돈다면 `_trade-scope.mjs` 에 같은 정의를 두고 시험으로 둘이 같은 값을 내는지 고정)
```

### 4-2. `trade-stats.mjs` 배선 (허용 ①~④만)

- ① `:225` Promise.all 에 `fetchTradeDealsWindow(sbMibunyang, { fromMonth: cutoff12mYM, cols: "trade_type,sgg_cd,umd_cd,umd_nm,jibun,apt_seq,apt_name,area,price,build_year,contract_type,cancel_date" })` 와 연결 표 active 전량(`selectAll(…, "id")`, 칸 `apartment_id,link_kind,link_key`) 추가. 둘 중 하나라도 실패하면 **새 칸만 건너뛰고**(옛 칸은 지금처럼) `logError` + 요약에 `SCOPE_SKIPPED <이유>` — 이 회차 기록(`recordCollectorRun`)의 `errorMessage` 에 `WARN_STEPS: scope_skipped` 를 남긴다(아침 브리핑이 읽는 마커 — `assign-complex-keys.mjs:65` 참고). apartments select 에 `completion,bjd_code` 추가.
- ② 아파트 루프 안 `results.push` 직전에 `computeScopeStats` → 결과 행에 펼친다. 연결 표가 비었거나 조회가 건너뛰어졌으면 새 칸을 **넣지 않는다**(지난 값을 null 로 덮지 않게 — upsert 는 넣은 칸만 바꾼다).
- ③ `:569-578` 건너뜀 조건에 "새 칸도 전부 비었으면(cmp_scope 가 없거나 'none' 이고 dong_fact·complex_table 비어 있음)" 을 AND 로 덧붙인다.
- ④ 요약 로그: 범위별 수(T1 sale/presale · T2 · T3) · per_m2 수 · 같은 단지 전세가율 수와 **100% 초과 수(0 이 아니면 logError)** · dong_fact 수. `--out=<절대경로>`(dry-run 에서만, `wx`) = 단지별 `{id, name, region, gu, completion, area, ...새 칸}` 전량 — 메인 검수 재료.
- 시간: `trade_deals` 12개월 ≈ 105만 행 추가 조회. 워크플로 timeout 30분(지금 6~8분). 작업반은 실행하지 않으므로 **메인이 운영 반영 때 dry-run 소요를 재고** 20분을 넘으면 timeout 을 45 로 올리는 한 줄을 같은 PR 에 둔다(작업반은 지금 올리지 않는다).

### 4-3. 시험 `_trade-scope.test.mjs`

경계: 같은 평수 9.99 포함·10.00 제외 · per_m2 20.00 포함 · 또래 10년 포함·11 제외 · 3건 포함·2건 제외 · 해제 거래 제외(null·"" 둘 다 확인) · 갱신 전세 제외·신규/빈칸 포함 · 입주 전 → 분양권 · 모름 → 매매 우선 · 면적 미상 → none + 표는 채움 · 전세가율 분모·분자 둘 다 3 필요 · age_gap 부호(우리 2024 · 그 집들 2002 → +22) · 짝수 개 중앙값. 시제품 표본 한 단지(T1 매매 하나 · T2 하나 · T3 하나)를 픽스처로 뽑아 값 고정. 변이: `<` → `<=`(10㎡) · 또래 제한 제거 · 갱신 포함 · 부호 뒤집기 · cmp_src 바꿔 끼우기.
`trade-stats` 쪽: 옛 칸 diff 0 은 `git diff` 구간 대조로 보고한다(결과 행 조립을 함수로 빼는 리팩터는 하지 않는다 — 옛 경로를 건드리게 된다).

## Task 5: 워크플로 단계 + 감시 ⑰

- `collect-trade-stats.yml`: `trade-stats` 단계 **앞**에 `Assign trade links (apartment_trade_links)` — `continue-on-error: true` · `timeout-minutes: 10` · env `SUPABASE_URL`·`SUPABASE_SERVICE_KEY` · `dry_run` 입력이 true 면 인자 없이(미리보기), 아니면 `--apply`. 주석: 왜 여기(B2) · 실패해도 통계는 지난 연결로 계속 · 감시 ⑰.
- 감시 ⑰ `checkTradeLinksHealth` (`monitor-collectors.mjs` ⑯ 바로 뒤): (a) `collector_runs` 의 `assign-trade-links` 최근 성공이 **20일** 넘게 없음(월 2회 + 여유) → `trade-links-stale` (b) 같은 (link_kind, link_key) 가 **서로 다른 complex_key 둘 이상**의 단지에 `active` → `trade-links-sibling` **명단**(열쇠·단지 id 그대로 — 개수 아님) (c) 연결 표가 비어 있으면(마이그 직후~첫 반영) 침묵. 재료는 연결 표 active 전량 + apartments `id,complex_key` (둘 다 고유 키 커서).
- `notify-telegram.mjs` "⑦~⑯" → "⑦~⑰". 시험 `monitor-trade-links.test.mjs`(a·b 양성·음성 + 빈 표 침묵) · `monitor-check-failed.test.mjs` 묶음 수. 변이: 20일 바꾸기 · 명단 대신 개수 · 빈 표 침묵 제거 · complex_key 무시(행 단위).

## Task 6: 문서 + 최종 게이트

- `supabase/CLAUDE.md`: 표 목록에 `apartment_trade_links`(미분양 전용 · 공개 읽기 없음 · 월 2회 배치 · 사람 판정 파일) · `trade_stats` 줄에 "새 칸 12개(범위·건수 — 다) 전까지 미사용, VIEW 미노출)". 마이그 안전 절에 "VIEW 에 칸을 붙이면 매일 굽기가 공개 JSON 에 싣는다(B1)" 한 줄.
- `scripts/CLAUDE.md`: 수집기 절에 `assign-trade-links` · `_trade-scope` 한 줄씩.
- `BACKLOG.md` 시세 범위 좁히기 트랙 행: 나) 진행 · **다) 에 VIEW 새 칸 + API 화이트리스트(`api/supabase/apartments.ts`) 포함** · 차단기 한도 첫 실행 뒤 재측정 · 읍·면 134곳(§10-1) 미리보기 뒤 판정.
- 게이트(숫자로 보고): `npm run typecheck:scripts` 0 · 표적 시험(위 새 시험 전부 + `trade-stats` 관련 기존 시험 + `_trade-deals.test.mjs` + monitor 2) 초록 · 정적 가드(`_graceful-coverage`·`_selectall-keycol-coverage`·`_unbounded-query-coverage`) · CI 감사 중 이번 변경이 닿는 것(`audit-env-keys`·`audit-orphan-collectors`·`audit-collector-*`·`audit-cron-concurrency`·`audit-declared-deps` — `ci.yml` 에서 실제 이름을 grep 해 돌린다) · **전체 vitest 1회**(메인 신호 뒤) · 변이 표 · `git diff` 로 `trade-stats.mjs` 옛 칸 구간 0.
- 마지막에 `assign-trade-links.mjs --out=F:/mibunyang/.omc/artifacts/session590/worker-b/links-preview-1.json` 미리보기 1회(읽기 전용) → 보고에 counts·byMethod·hold 사유별·대조군 10줄.

## 운영 반영 (메인 — 각 단계 전이표·사장님 승인, `data-changing-run-approval.md`)

1. 마이그 psql 리허설(`BEGIN → 적용 → \d apartment_trade_links · \d trade_stats → ROLLBACK`) → 적용 → `perm-baseline.mjs` 미리보기 → 재승인(새 표 1 · `trade_stats` 칸 추가는 지문 변화 0 예상 — 다르면 멈춤). **운영 SQL 접속 경로는 이때 다시 여쭌다.**
2. 합침 → 운영 폴더 ff pull(예약 창 밖) → `node --check`.
3. 묶기 미리보기 `--out`(계획 파일) → 명단 검사(적대 Opus + 맹점 Opus — 일회성 명단 반영 규칙 §5) → **hold 명단 판정은 Fable**(사장님) → 판정을 `trade-link-decisions.json` 에 PR → 미리보기 다시 → `--apply-from=<승인 계획 파일>`(첫 채우기는 차단기 대신 계획 대조).
4. `trade-stats.mjs --dry-run --out=<파일>`(읽기 전용) → 검수: 범위별 수(시제품 T1 641 근처인지 — 다르면 이유) · 100% 초과 전세가율 0 · `dong_fact.age_gap_years` 10곳 눈 검수 · 범위별 건수를 원문 재집계(같은 단지 3곳 손으로)와 대조 · 소요 시간(20분 넘으면 timeout 45 PR).
5. 실제 쓰기 = **정기 회차 10/08 01:00**(3이 그 전에 끝나면) — 아니면 10/22. 끝난 뒤 새 칸 채움 수 = 4의 dry-run 수와 같은지 · 옛 칸이 정기 재계산 외로 바뀌지 않았는지(옛 칸은 10/03 재수집분만큼 움직이는 것이 정상 — 시작 블록 §7).
6. 2u 통지: `trade_stats` 에 칸 12개 추가(이름·뜻 — 2u ORM 은 칸을 명시하므로 영향 0, 쓰려면 다) 이후 의미 확정 뒤) · 연결 표는 미분양 전용.
