# 지자체 단지별 미분양 명단을 새 출처로 — 설계서 v2.1 (세션686 · 2026-11-01)

> 상태: **v2.1 — 검사관 2인(할루 Sonnet 🔴1·🟠3 · 맹점 Opus 🔴3·🟠12·🟡9) 반영 + 맹점 재검사(🔴 전부 해소 · 새 🟠3 = 세대 게이트 정의·재공급 0 차단·batch 열쇠, 반영) → 구현 착수 가능(👤 Q1~Q10 뒤)**. 검사 보고 = `.omc/artifacts/session686/review-design-halu.md`·`review-design-blind.md`·`review-design-blind-v2.md`. v1 → v2 바뀐 자리는 `[v2]` 표시. 사장님 결정(2026-11-01 22:2x AskUserQuestion) 원문 = ① 「들인다 — 셋 다」(대구 xlsx·충남 xlsx·경기 표를 새 출처로, 설계서 → 검사관 2인 → 구현) ② 「발급한다」(경기데이터드림 OpenAPI 인증키, 사장님 계정) ③ 「지금 보류한다」(두류 두 행 → 별도 전이표 `docs/audits/2026-11-01-duryu-hold-transition.md`) ④ 표시 모양 「A안 칩 + 상세 칸」. 사장님 23:2x 추가 결정: 공공데이터포털 **제공신청**(국토부에 전국 단지별 현황 공개 요청, 초안 `.omc/artifacts/session686/data-offer-request-draft.md`)도 병행.
> 조사 원문 = `.omc/artifacts/session685/research-unsold-sources.md`(작업반) · 세션685 메모(메인 직접 확인) · 이 세션 실측 `.omc/artifacts/session686/probe-coverage.log`·`probe-duryu.log` · 검사관 보고 `.omc/artifacts/session686/review-design-halu.md`·`review-design-blind.md`.

## 0. 한 줄

지자체가 달마다 올리는 **단지별 미분양 명단**(대구·충남 = 게시판 xlsx, 경기 = OpenAPI)을 원문 그대로 받아 우리 단지와 맞추고, 카드의 미분양 값을 **세 상태**(숫자 · 명단 등재-수 비공개 · 모름)로 사실대로 보여 준다. 명단이 있는 지역에서는 명단이 KOSIS 시군구 비례배분보다 앞선다. 명단이 "없다"고 0 을 쓰는 규칙은 명단 행을 전부 해소한 시군구에서만, 사장님이 첫 전이표를 본 뒤 켠다.

## 1. 왜 (조사에서 드러난 사실 — 전부 실측, 추정은 표시)

| 사실 | 출처·시점 | 뜻 |
|---|---|---|
| 카드 미분양 값은 묶음 재료 행 중 VIEW 순위(청약홈 유효 0 → 값 있음 1 → hold 2 → NULL 3)와 동점 정렬이 정한다 — 두류는 두 행이 같은 순위(값 있음)여서 **id 내림차순 동점 규칙**(77줄)으로 「조합원 취소분 1세대 재공급이 다 찼다」 행의 0 이 이김 | VIEW `bundle_unsold`(`20261031000000_view_card_builder.sql:63~77`) · 세션685 흉내 33장 일치 | 재공급 완판 ≠ 단지 완판 |
| 대구시 2026-09말 명단에 두류 등재(미분양 칸 "건설사 요청으로 비공개") — 등재·비공개 칸은 메인 직접 확인, 총분양 52 는 작업반 보고 | 메인(`F:/tmp/s685-research/daegu/daegu_2026-09.xlsx`) + 작업반 | 0 틀림 · KOSIS 165(>52) 도 틀림 |
| 충남 2·6월 명단에 천안 호반써밋 없음(천안 다른 단지는 비공개라도 이름 실림) · **명단엔 미분양 0 인 단지도 남아 있다**(공주 월송 B-2BL 0 · 아산 수청2 RH-3 0) | 메인 직접 확인 + 작업반 | 0 쪽 근거(관행 추정) · [v2] "비공개 등재 = 미분양 있음"은 출처가 말한 것보다 앞서 나간 말 — 비공개 뒤의 값이 0 일 수도 있다 |
| 경기 표: **행 = 면적대 1줄**(탑동 한신공영 = 0·4·0 세 행 · 화성 9행 = 3단지) · 비공개 단지도 **미분양 숫자는 공개**(주소·날짜 가림 · 시공사도 "00건설") · 단지명 칸 없음 · 3개 시 107행 전부 민간(공공 0) | 작업반(브라우저 표) · 메인 미재확인 | [v2] 단지 값 = 그 단지 면적대 행 **전부**의 합 · 비공개 행은 묶을 열쇠가 없어 단지로 못 모음 |
| 인천 9월: 39단지 한 줄로 전부 비공개 · 파일 .xls | 작업반 | 범위 밖(§13) |
| 우리 단지 수(2026-11-01 DB · **행 수 기준**): 대구 104행/80묶음(kosis>0 86행) · 인천 277/182(kosis>0 192행·kosis 0 61행) · 충남 114/92(kosis>0 92행) · 경기 1075/749(kosis>0 693행·kosis 0 166행) | `probe-coverage.log` | 명단 지역의 카드 대부분이 **KOSIS 추정값**이다 |
| 대구 우리 카드 66 중 명단 이름과 맞은 것 28(**대충 맞춤 1차 — 추정**, 매칭 실패가 섞여 있고 66 과 묶음 80 의 차이도 미설명) | 세션685 메인 | 명단에 없는 단지에 KOSIS 가 미분양을 붙이는 문제가 **있을 수 있다**(정확한 수는 첫 회차 매칭 뒤) |
| 경기 OpenAPI: `CopertnhousngUnsol` · 인자 KEY/Type/pIndex/pSize(최대 1,000)/SIGUN_NM·SIGUN_CD · 요청 제한 없음 · 키 없으면 sample 5행 · 발급 = 로그인 → 개방>OpenAPI>인증키발급 → 자동 발급 | data.gg.go.kr 사용방법(WebFetch 11/01) · 출력 칸 이름은 명세서 다운로드 뒤 | 자동 수집 가능 |
| 대구 게시판: 목록 HTML → nttId → FileDown(atchFileId·fileSn) · xlsx/hwp 순서가 달마다 바뀜 · data.go.kr 15052622 같은 자료(이용허락 제한 없음) | 작업반 + 메인(파일 4개) | 파일 이름으로 고른다 · [v2] 15052622 파일데이터 경로도 PR-2 에서 같이 본다 |
| 충남 행정자료실: 월간이었으나 7~9월분 미게시(10/31 기준 최신 6월) | 작업반 | [v2] 6월말 + 4개월 = 10/30 → 첫 회차(11/08)엔 이미 낡음 — 만료 규칙(Q2)이 충남 몫을 정한다 |
| 지자체 xlsx 를 zip 직접 파싱하면 sharedStrings 순번이 어긋나 보임 | 세션685 함정 ③ | 라이브러리로 읽는다 |

## 2. 목표 상태 (손님 화면)

| 상태 | 뜻 | 카드 칩(A안) | 상세 「미분양 세대」 | 기본 목록·정렬 [v2] | 점수 |
|---|---|---|---|---|---|
| **숫자** | 명단(경기)·청약홈·KOSIS 가 준 수 | 기존(미분양 30%↑ 등) | `N세대` + 꼬리 「(경기도 명단 2026-10)」 | 기존 | 기존 |
| **명단 등재 · 수 비공개** (새) | 지자체 명단에 올라 있으나 수는 비공개(대구·충남) | 「미분양 수 비공개 · 대구시 9월 명단」(주황) — 문구는 Q7 | 「비공개 (대구시 2026년 9월말 명단)」 | **미분양 있음으로 센다**(「미분양만 보기」 필터·시장 요약·사전 렌더 정렬 — Q8) | Q3(모름 40 vs 범위) |
| **모름** | 자료 없음(hold·null) | 날짜만 | 「—」 | 숨김(지금 그대로) | 모름(40) |
| **0** | 재공급 완판·명단 미등재(§5-③ 켠 뒤) | 입주완료(준공 뒤) | 「0」 + 꼬리 「(대구시 2026-09 명단 미등재)」 | 숨김 | 기존 |

## 3. 데이터 모델

### 3-1. 새 표 `unsold_gov_list` (미분양 소유 · 2u 읽기 없음 · service_role GRANT 명시 — 2026-10-30 Supabase 기본 권한 변경 · `ownership.json` 등록)
[v2] **원문 행 = 명단의 한 줄 그대로**(경기는 면적대 1줄 = 1행). 칸을 고르지 않고 `raw JSONB` 에 머리줄 글자 → 값 전부를 넣고, 매칭·판정에 쓰는 칸만 뽑아 둔다(원문 칸 보존 규칙).

| 칸 | 뜻 |
|---|---|
| id BIGSERIAL PK · source TEXT(`daegu`·`chungnam`·`gyeonggi`) · as_of DATE(기준월 말일 — **파일 본문·제목에서 읽는다**, 게시 순서로 정하지 않음) · batch_id TEXT · row_no INT · batch_rows INT | UNIQUE(source, as_of, **batch_id**, row_no) — 같은 달 재게시는 새 batch 를 먼저 넣고 행 수 = batch_rows 로 완성을 확인한 뒤 옛 batch 를 지운다(`trade_deals` 꼴 · 열쇠에 batch_id 가 없으면 새 묶음을 옛 것 옆에 못 넣는다 — v2 재검사 지적 3) · 읽는 쪽은 그 달의 가장 새 완성 batch 만 |
| raw JSONB | 머리줄 글자 → 셀 값 전부(분양청약일자·전월 미분양·계약마감일·지구명·택지종류·준공여부… 버리는 칸 없음) |
| sgg TEXT · emd TEXT · raw_name TEXT · address TEXT · builder TEXT · developer TEXT | 매칭용 발췌(비공개 행은 NULL — 경기는 시공사도 "00건설") |
| is_public BOOLEAN · is_rental BOOLEAN · area_band TEXT · total_units INT · unsold_units INT NULL · hidden BOOLEAN | 민간/공공 · 임대/분양 · 면적대(경기 행 단위) · 총분양 · 미분양(비공개 NULL) · 비공개 표기 |
| apartment_id TEXT NULL · match_method TEXT · match_score NUMERIC · match_state TEXT | 우리 묶음 연결(§4) · 방법 · 점수 · `strong`/`weak`/`none`/`decided`/`rejected` |
| file_url TEXT · fetched_at TIMESTAMPTZ | 원문 주소 · 받은 시각 |

### 3-2. `apartments` 칸
| 칸 | 변경 |
|---|---|
| `unsold_source` CHECK | `'govlist'` 추가 — [v2] 칸 CHECK 변경은 2u 가 읽는 표의 칸 변경이라 `ownership.json` 갱신 → `notify-sister.yml` 통보 + 2u 모델이 `unsold_source` 를 읽는지 PR-1 에서 확인. **2u 는 원표 `apartments.unsold`·`unsold_history` 도 직접 읽는다**(ownership readers) — govlist 가 KOSIS 값을 NULL 로 바꾸는 "값만 바뀌는" 변화는 자동 통지가 없으므로 첫 회차 반영 뒤 2u 메모리에 쪽지(바뀐 행 수·비공개 등재 뜻·시계열 점 규칙) |
| `unsold_as_of` | govlist 값의 기준월(as_of) |
| `unsold_listed_as_of DATE` (새) | 명단 등재 확인 기준월(공개·비공개 모두). 비공개 등재 행 = `unsold NULL · unsold_rate NULL · unsold_source 'govlist' · unsold_as_of = as_of · unsold_listed_as_of = as_of` |
| `apartments_unsold_hold_null_check` | 그대로(hold 만) |
| [v2] 되돌림 | govlist 수집기는 회차마다 **바꾸기 전 사본**(`id · 바뀌는 4칸 · unsold_listed_as_of`)과 **역계획**(`backfill-unsold-source.mjs --plan=` 꼴, expect = 새 값 → set = 옛 값)을 `.omc/artifacts/govlist/<as_of>/` 에 남긴다 |

→ 👤 재확인 2026-11-02 01:37: 안 A — 원 공고 출처 applyhome 0건(11행 전부 무순위·재공급)이라 unsold_notice_kind 빼고 unsold_listed_total 칸으로 50% 판정 (PR-1: `apartments.unsold_listed_total INT NULL` = 명단 총분양 Σ, govlist 행에만 · 값이 있으면 > 0 · 마이그 `20261102000000_unsold_gov_list.sql` · 사본·역계획 칸에도 이 칸을 넣는다)

### 3-3. VIEW `apartments_flat`(`bundle_unsold`) [v2]
- 순위: **0** 「단지별 실측」 = applyhome 유효(6개월) · govlist 유효(숫자·비공개 모두) → **1** 그 밖 값 있음(kosis) → **2** hold → **3** NULL. 순위 0 안에서는 **기준일이 새 쪽**(`unsold_as_of` 내림차순 — 명단 기준월 vs 공고일)이 이긴다 → 두류처럼 옛 재공급 공고 0 보다 새 명단 비공개가 이김(Q1 확장 · 사장님 결정 ① 「명단에 있음을 사실대로」). 같은 날이면 숫자 > 비공개. **단 명단은 한 달 늦게 나오므로**(v2 재검사 지적 2) 청약홈 값이 명단 비공개를 이기려면 그 공고가 **원 공고(`source=apt`)이거나 공급 세대가 명단 총분양의 50% 이상**이어야 한다 — 재공급·취소분(remndr) 공고의 0 은 명단 비공개를 못 이긴다(두류형 거짓 0 차단 · 시험 1건 고정 · VIEW 가 `applyhome_unit_supply`/`presale_schedule_official` 의 공고 종류·공급 합을 읽어야 하므로 재료 칸을 `apartments.unsold_as_of` 옆 `unsold_notice_kind TEXT`(apt/remndr) 로 seed 가 함께 적는다 — PR-1).
  → 👤 재확인 2026-11-02 01:37: 안 A — 원 공고 출처 applyhome 0건(11행 전부 무순위·재공급)이라 unsold_notice_kind 빼고 unsold_listed_total 칸으로 50% 판정 (VIEW `20261102000002_view_unsold_govlist.sql`: 같은 묶음에 유효한 govlist 비공개 행이 있으면 청약홈 행은 **기준일이 같거나 새롭고** 공급(`competition_supply`, 없으면 `unsold`) × 2 ≥ 그 행 `unsold_listed_total` 일 때만 이김 · 총분양 NULL 이면 못 이김 · 같은 날도 이 규칙 — 보수 쪽)
  → 👤 원문 대조 2026-11-02 03:0x: 50% 규칙은 숫자 명단 행에도(Q1·01:37 원문이 '명단' 전체) — PR-1 적대 검사관 🟠1
- 새 칸(맨 끝): `unsoldSource`(이긴 행의 출처) · `unsoldListedHidden`(BOOLEAN — 이긴 행이 govlist 비공개이고 유효) · `unsoldListedAsOf`(이긴 행의 `unsold_listed_as_of`). 만료 판정은 VIEW(`GOVLIST_EXPIRY` SQL 상수)와 KOSIS 수집기(`shouldSkipKosisFill`) 두 곳에 같은 값이 불가피하다 → **두 값을 맞대는 시험 1건**(VIEW SQL 에서 숫자를 grep 해 `_shared.mjs` 상수와 같음)으로 묶는다 · 화면 JS 는 VIEW 값만 읽는다.
- 2u 는 칸 이름으로 읽어 영향 0 · 새 칸은 맨 끝 · `WITH (security_invoker = on)` 명시 · 되돌림 `_rollbacks/` · VIEW 칸 추가가 그날 밤 공개 JSON 에 실린다(`supabase/CLAUDE.md:253`) → 화면 PR 과 같은 날.

## 4. 매칭 (명단 행 → 우리 묶음) [v2]

| 출처 | 1차 열쇠 | 게이트 | 뒷받침 | 등급 |
|---|---|---|---|---|
| 대구·충남 | 소재지 괄호 단지명 ↔ `apartments.name`(`normalizeComplexName`·`stripRoundWords`·`phaseConsistent`·`blockConflict` — `_same-complex.mjs`·`_kakao-poi.mjs`) | 시도 + 구군 토큰 정확 일치 · 읍면동 있으면 `dong`/주소 토큰 포함 | **총분양 ↔ 청약홈 공급 세대 합** ±10% — 정의(v2 재검사 지적 1 · 두류 운영 DB 실측: 공고 2025000017 = 52(59A 19·59B 1·78 32) · 2025000282 = 27 · 2025000535 = 1 → 셋을 더하면 80, 두 행을 더하면 160, 일반공급만이면 23 이라 전부 게이트에서 떨어진다): **묶음 안 공고를 공고 번호로 중복 제거한 뒤, 명단 분양승인일에 가장 가까운(없으면 가장 이른) 공고 하나**의 `applyhome_unit_supply` **일반+특별 합**(없으면 그 공고의 `competition_supply`) — 묶음 세대수(`pickBundleUnits`)는 재건축·조합분 때문에 안 맞는다(두류 433) → 어긋나면 **weak**(none 아님) · 시공사 `resolveBuilder`(`_shared.mjs:1026`) 일치 | strong(이름 ≥0.9 + 세대 일치) / weak / none |
| 경기(이름·주소 공개 행) | 시공소재지위치 ↔ `address`·`road_address`·지번 | 시군 일치 | **그 단지의 면적대 행 전부**가 같은 묶음에 맞을 때만 합산(일부만 맞으면 쓰지 않음·weak) · 면적대별 총분양 ↔ `applyhome_unit_supply` | 같음 |
| 경기(비공개 행) | 없음(주소·시공사 가림) | — | 저장만(`match_state none`) · **단지 반영 0** · 보고에 시군별 비공개 행·미분양 합만 | — |

- weak·충돌·블록 이름(RH-3·B-2BL)은 사람 판정 파일 `docs/audits/govlist-match-decisions.json`(active·rejected — `applyhome-notice-decisions.json` 꼴)에 적힌 것만 반영. 한 명단 행이 두 묶음에 붙으면 둘 다 안 붙임(명단).
- 양성 대조군(픽스처): 두류 센트레빌 더파크(대구 9월 → 등재·비공개 · 세대 게이트는 청약홈 공급 합으로 통과해야 함) · 호반써밋 포레센트(충남 6월 → 미등재) · 경기 오산 탑동 110-1 한신공영(세 행 0·4·0 → 합 4) · 광주 양벌동 롯데(청약 202612 → 분양 전이라 미등재→0 금지). 반대 방향: 이름 비슷한 다른 구 단지가 **안** 붙는다.

## 5. 값 반영 규칙 (수집기 `collect-unsold-govlist.mjs`) [v2]

① **등재 + 숫자 공개**(경기 — 면적대 행 전부가 맞은 단지만): `unsold = Σ행` · `unsold_rate = Σ행 / 분모`(분모 = Q9: 명단 총분양 Σ(공공기관 기준) vs 묶음 세대수) · `unsold_source 'govlist'` · `unsold_as_of = as_of` · `unsold_listed_as_of = as_of`. hold 행은 건드리지 않음. applyhome 유효 값과 겹치면 VIEW 순위 0 의 **기준일 새 쪽**이 이김(§3-3).
② **등재 + 비공개**(대구·충남): `unsold NULL · rate NULL · source 'govlist' · as_of · listed_as_of`. 만료 = Q2(4개월 / 6개월 / 만료 없음+경보) — 지나면 KOSIS 가 다시 정한다(`shouldSkipKosisFill` 규칙 추가: govlist 는 만료 전 존중). 충남은 최신 6월이라 4개월이면 첫 회차에 이미 만료(Q2 에 적시).
③ **명단 커버 지역인데 미등재 → 0** — 기본 **꺼짐**(`--absent-zero`) · **대상 = 대구·충남만**(경기는 비공개 행을 단지로 못 모아 "없다"를 말할 수 없다). 켜면 조건 **전부**: (a) 그 시도·그 달 명단 정상 수집(행 수 > 0 · 전월 대비 −50% 이내) (b) 민간 분양(`presale_type` 임대·공공 아님) (c) 분양 공고가 명단 기준월 **이전**(`presale_schedule_official`·`competition_*`) (d) **그 시군구의 명단 행이 전부 `strong`·`decided`·`rejected` 로 해소**됐을 때만 — weak·none 이 하나라도 남은 시군구는 미등재 판정을 하지 않는다(매칭 실패 ≠ 명단에 없음) (e) 그 행이 hold·applyhome 유효·govlist 가 아님. 시험 회차(dry-run)는 꺼짐·켬 **두 전이표를 같이** 세어 Q5 를 여쭐 재료로.
④ KOSIS 와의 관계: 로컬 러너 `kosis-local-runner.mjs` `DAY_TABLE` **8일 항목에 govlist 추가**(8일엔 crime-safety 와 같은 날 순차 · 러너 05:30 · 시각 칸 없음) → 9일 KOSIS. KOSIS 는 govlist 유효 행을 존중하고 묶음 분모에는 남긴다 · **KOSIS 시계열(`unsold_history`)은 govlist 유효 행에 점을 만들지 않는다**(`collect-unsold-kosis.mjs:995~1003` 루프에 조건 추가 — 같은 열쇠 (단지·달) 라 9일 KOSIS 가 8일 점을 덮는 경합 차단) · govlist 수집기는 숫자 행(경기)에만 `unsold_history` 점을 쓰고 비공개는 쓰지 않는다 · [v2] **등재 단지의 KOSIS 추정은 명단 총분양 Σ 를 상한으로**(두류 165 > 52 같은 거짓을 규칙으로 막음 — PR-4).
⑤ 실행 위치 = 로컬 러너(한국 IP · 해외 IP 차단 여부 미확인). 러너가 죽으면 감시 ⑤ stale 38일이 잡는다(네이버 러너와 같은 결).
⑥ 안전장치(`data-changing-run-approval` 순서): 조회 → 계획 → `--dry-run --impact-out` 항상 → 차단기(바뀔 단지 > 50곳 또는 명단 행 수 전월 −50%) → **바꾸기 전 사본·역계획 저장** → 쓰기. 첫 회차는 `--apply-from=<승인 impact>`(경기만으로 50곳을 넘을 수 있어 사실상 확정). `collector_runs` PHASE `unsold-govlist` · 표식 `GOVLIST_SKIP <source> <이유>`(파일 못 받음 · 머리줄 바뀜 · 행 0 · **as_of 가 전보다 새롭지 않음**).
⑦ 파서: xlsx 는 `exceljs`(MIT · 새 의존은 `package.json` 명시 + `audit-declared-deps`) · 칸 뜻은 머리줄 글자로 · 대구 첨부는 파일 이름 `.xlsx` 로 · as_of 는 파일 본문·제목에서 · 경기 API `pSize=1000` + `pIndex` 끝까지(`list_total_count` 와 받은 행 수 대조). `.xls`(인천)는 범위 밖.

## 6. 화면 (A안 — 사장님 결정 ④ · show-screen-changes-first: 구현 PR 합치기 전 playwright 전/후 캡처 390px+데스크톱) [v2]

| 자리 | 규칙 | 파일 |
|---|---|---|
| 카드 칩 `unsoldListedHidden` | VIEW `unsoldListedHidden` 이면 「미분양 수 비공개 · 대구시 9월 명단」(문구 Q7) · tone amber · layer `bad` · 순위 = CHIP_ORDER 원칙(심각도 계급 → 희소성 — `cardChips.ts:58~95`)대로 **감점 0 이면 사실 칩 계급** · 상한 2칸 안 자리는 Q4 | `src/constants/cardChips.ts` · `cardChips.test.ts` |
| 상태 칩 | unsold null 이라 `moveInUnknown`(날짜만) 그대로 | — |
| 「미분양만 보기」 필터 · 시장 요약 모집단 · 사전 렌더 정렬 | `Number(unsold ?? 0) > 0 \|\| unsoldListedHidden` 으로 — 등재 카드가 기본 목록에서 사라지지 않게(Q8) | `useDataPipeline.ts:285·380` · `MarketSummaryWidget.tsx:76` · `postbuild-prerender.mjs:476~485` |
| 상세 「미분양 세대」 | fmt 가 apt 를 받아 `unsoldListedHidden` → 「비공개 (대구시 2026년 9월말 명단)」 · `unsold == 0 && unsoldSource govlist` → 「0 (… 명단 미등재)」 · 그 밖 기존 | `fieldMeta.ts:72~77` |
| 사전 렌더 글자 · 점수 detail | 「미분양 —」·「미분양 자료 없음 (중립)」 세 자리를 같은 문구표 `UNSOLD_STATE_LABEL`(상태 3 × 자리)로 — 칩과 모순 금지 | `aptStaticBody.mjs:93·965` · `scoreRisk.ts:239` |
| 점수 | Q3(모름 40 유지 vs 명단 총분양/묶음 세대수 상한 범위 점수 — 두류 52/433 = ≤12% → 10~25) | `scoreRisk.ts` |
| 관리자 점수 분해표 · e2e | 상태 3 노출 1행 · e2e 칩 1건 · 점수 detail 문구가 점수 캐시·`sanitize` 앞단을 지나 살아 있는지 `calcCats` 경유 시험 1건(guards-must-be-mutation-tested §세션508) | PR-3 |
| 추이 그래프(경기 숫자 단지) | 옛 KOSIS 추정 점과 새 명단 점이 한 줄에 섞임 — 점마다 출처가 없으므로(`unsold_history` 에 source 칸 없음) 🟡 후속: 명단 첫 달 이전 점은 그대로 두고 범례 한 줄 | 후속 |

문구는 사실만("명단 등재·수 비공개·어느 기관 어느 달") — 우리 결함을 손님 경고로 떠넘기는 문구 금지.

## 7. 감시 [v2]

| 번호 | 내용 |
|---|---|
| ⑤ 외부 API stale | `EXTERNAL_API_COLLECTORS` 에 `unsold-govlist` · 월간 → `stale_days 38` |
| ⑫(h) (새) | govlist 행 중 만료 지난 행 명단(KOSIS 가 덮었어야 함) · 비공개 등재가 Q2 기간 넘게 갱신 안 됨 — dedup 지문 = 명단 id 정렬 해시 |
| ㉔ (새 — ㉓은 세션668 검색 제외 안전선이 씀) | 명단 행 수 전월 대비 −50% / `GOVLIST_SKIP` 최근 실행 1행 — dedup 지문 = 표식 이름+값 해시 |
| 매칭 | 한 명단 행 ↔ 두 묶음 명단 · weak 미판정 누적 수(시군구별) — §5-③(d) 의 "해소" 잣대 그대로 |

## 8. 단계 (PR 분할) [v2]

| PR | 내용 | 검사관 | 운영 반영 |
|---|---|---|---|
| **PR-1 DB** | 마이그: `unsold_gov_list` 표(+GRANT·`ownership.json`) · `unsold_source` CHECK govlist · `unsold_listed_as_of` · VIEW 재정의(순위 0 기준일 정렬 · 새 칸 3 · `security_invoker`·되돌림) · 2u 모델 `unsold_source` 읽기 여부 확인 | migration-safety + 적대 Opus | Dashboard/OAuth 길 · 권한 지문 재승인 · 2u 통지 |
| **PR-2 수집기(dry-run 전용)** | 어댑터 3 + 파서 + 매칭 + 계획·impact·사본·역계획 · `--apply` 는 차단기·`--apply-from` 만 · 픽스처(§4 대조군 + 반대 방향) · 러너 등재 아직 안 함 | 적대 Opus(수집기) + 맹점 Opus | 없음 → **첫 전이표(꺼짐·켬 둘 다)** 👤 |
| **PR-3 화면** | §6 전부(칩·필터·사전 렌더·상세·점수 문구표) · jsdom 부품 · playwright 전/후 캡처 | ui-adversary(Sonnet) | 굽기 뒤 라이브 확인 |
| **PR-4 규칙** | `shouldSkipKosisFill` govlist 존중 · 시계열 건너뜀 · KOSIS 상한 = 명단 총분양 · 러너 8일 · 감시 ⑤⑫(h)㉔ · `--absent-zero` · **hold → govlist 직행 op**(`release_hold_to_govlist`) · 기준 명단 21 → 19 | 적대 Opus + 맹점 Opus | 첫 회차 `--apply-from` |
| **PR-5 경기** | 경기 OpenAPI 어댑터(15057206 `CopertnhousngUnsol`) · 인증키(§12) 발급 뒤 · 매칭·전이표는 같은 틀 — 👤 2026-11-04 D1 「PR-5 로 따로, 키 발급 뒤」(세션691 맹점 🟠1: PR-2 에 경기 0줄·계획표에 자리 없음) | 적대 Opus + 맹점 Opus | 첫 회차 `--apply-from` |
| **운영 1회** | 두류 2행 `release_hold_to_govlist`(첫 회차 안에서 — KOSIS 9일 회차보다 먼저) · 되돌림 파일 | — | 전이표 |

PR-1·PR-2 병렬(워크트리 분리) · PR-3 은 PR-1 적용 뒤 · PR-4 는 PR-2 첫 전이표 승인 뒤. 비용 추정: PR 4 + 운영 + 검사 ≈ **세션 3~4개**.

## 9. 👤 결정 후보 (설계 뒤 · 구현 전에 여쭘) [v2]

| # | 질문 | 추천 |
|---|---|---|
| Q1 | 명단(숫자·비공개) vs 청약홈 유효 값 — 기준일 새 쪽이 이기게(§3-3) | 예(두류 같은 거짓 0 차단) |
| Q2 | govlist 만료 | 4개월 / **6개월(추천)** / 만료 없음+경보 — 충남 6월분은 4개월이면 첫 회차에 낡음 |
| Q3 | 비공개 등재의 점수 | **모름 40 유지(추천)** — 이유: 범위 점수의 상한(명단 총분양/묶음 세대수)은 우리 근사치라 공공기관 준거 원칙에 어긋나고, "수를 모른다"를 중립으로 두는 것이 정직하다. 단점: KOSIS 가 0 보다 큰 값을 주던 등재 카드는 40 으로 바뀌며 점수가 **오른다**(등재됐더니 점수 상승 역설 — 첫 전이표에 그 카드 수·점수 변화를 적어 보여 드린다) |
| Q4 | 칩 상한 2칸 안 순위 | CHIP_ORDER 계급 규칙 따름(감점 0 = 사실 칩 계급) |
| Q5 | §5-③ 미등재→0 켜기 | 첫 전이표(꺼짐·켬) 뒤 |
| Q6 | 대전·세종 추가 조사(11/06 한도 리셋 뒤) + 제공신청 결과 대기 | 한다 |
| Q7 | 칩·상세 문구 | 「미분양 수 비공개 · 대구시 9월 명단」 / 「비공개 (대구시 2026년 9월말 명단)」 |
| Q8 | 「미분양만 보기」·시장 요약에서 등재 카드 | 미분양 있음으로 센다(추천) — 단점: 비공개 뒤의 값이 0 일 수도 있어(충남 명단에 0 단지 잔존) "미분양 단지 N곳" 이 약간 과장될 수 있음 · 대안 = 세지 않되 기본 목록엔 남김(필터만 통과) |
| Q9 | 미분양률 분모(숫자 행) | 명단 총분양 Σ(공공기관 기준) |
| Q10 | 등재 단지의 KOSIS 추정 상한 = 명단 총분양 Σ(§5-④) — 손님 숫자가 바뀜 | 켠다(두류 165 > 52 거짓 차단) — 첫 전이표에 바뀌는 카드 수 |

**👤 2026-11-04 세션691 2단 결정(맹점 검사관 🟠 5건 → 전부 추천안)**: D1 경기 = PR-5 로 따로(키 발급 뒤) · D2 충남 6월분 = 첫 반영(PR-4)에서 뺀다 — 6개월 규칙으로 12/30 만료 → 1/9 KOSIS 전까지 「모름」 → 다시 KOSIS, 6주 만에 값이 오락가락(7월분 이후 게시 뒤 넣기) · D3 수 비공개 등재 단지 = 「미입주」 필터에도 넣는다(`src/lib/classify.ts:39` — Q8 과 같은 셈법 · PR-4 · 전이표에 그 수 열 추가) · D4 「0 (명단 미등재)」 달 표시 = Q5 를 켤 때만 **별도 칸**으로(`unsold_listed_as_of` 를 채우면 VIEW `20261102000002…sql:96` 이 「실린 행」으로 봐 청약홈 값을 막는다 — 그 칸은 쓰지 않는다). D5(출처 표시 — 지금 칩·상세 문구로 충분 vs 상세에 원문 링크) 미결.

## 10. 위험·함정 [v2]

게시 지연(충남) · 첨부 순서(대구) · 머리줄 변경 · as_of 역행 · 1,000행 페이징 · 해외 IP 미확인 · 공공분양 미등재(경기) · 분양 전 단지 · 쌍둥이 블록·차수·같은 시행사 다른 단지(면적대 전부 일치 요건) · 명단 "0" 단지 잔존 · 같은 달 재게시 → batch 교체 · VIEW 칸 추가 즉시 공개 · 등재 카드 점수 역설(Q3) · 첫 회차 상한(대구 비공개 등재 ≤61·실측 약 28 / 충남 만료 규칙에 따라 0~92 / 경기 ≤749 / 미등재→0 켜면 대구 ≤52·충남 ≤92 추가).

## 11. 검증 계획 [v2]

- 단위: 파서(픽스처 xlsx 3개) · 매칭(§4 대조군 4 + 반대 방향 + 면적대 일부만 맞으면 쓰지 않음) · 규칙 ①②③(조건 하나씩 빼면 안 쓴다 · (d) 의 weak 1건 잔존 → 미등재 판정 0) · 만료 경계 · VIEW 순위(두류: 비공개 행이 kosis·옛 applyhome 0 을 이김 · hold 는 값 있는 행보다 뒤(지금 VIEW 67~72 와 같음) · 두 행 다 hold → NULL) · 필터(`unsoldListedHidden` 카드가 기본 목록에 남는다).
- 뮤테이션 각 2종 이상 · `--apply-from` 불일치 → 쓰기 0 · 사본·역계획 파일 생성.
- 양성 대조군 먼저. 첫 회차 dry-run 전이표(꺼짐·켬) → 👤.

## 12. 경기 OpenAPI 인증키 — 사장님 손

1. https://data.gg.go.kr 로그인(회원가입 필요 여부는 페이지에 없음) → 「개방 › OpenAPI › 인증키발급」 → 활용용도·활용 URL(`https://www.xn--hg3bi2ac4o1ig57cnoa.com`)·내용 → 「인증키 발급 요청」(자동 발급).
2. 키는 채팅에 붙이지 않고 러너 PC `.env.local` 에 `GG_OPENAPI_KEY=`(가려지는 입력 `Read-Host -AsSecureString`). Actions 는 쓰지 않으므로 GitHub Secret 불필요.
3. 확인: `node scripts/collectors/collect-unsold-govlist.mjs --source=gyeonggi --dry-run` 이 sample 5행이 아니라 전체 행 수를 찍으면 성공.

## 13. 범위 밖

인천(.xls · 전부 비공개) · 대전·세종(Q6 · 제공신청 결과) · 국토부 통계누리·R-ONE·HUG·LH 재판정 · KOSIS 비례배분 자체 폐지 · 2u 화면.

