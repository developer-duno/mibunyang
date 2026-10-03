# 시세 비교 범위 좁히기 — 설계서 v1 (세션589 · 2026-10-03)

> **한 줄**: 상세 화면·점수의 시세 비교(적정가·전세가율·면적별 시세)를 **구 전체 → 같은 단지 → 같은 동 또래 집**으로 좁힌다. 그러려면 실거래 원문의 **단지 일련번호(`aptSeq`)·지번·법정동코드**를 저장해야 하는데 지금 수집기는 버린다. 그래서 ① 거래를 원문 그대로 담는 **새 표** ② 우리 단지 ↔ 거래를 묶는 **연결 표** ③ 범위·건수·기간을 값과 함께 저장하는 **통계** ④ **점수** ⑤ **화면** 순으로 바꾼다.
>
> 결정 출처: 사장님 R1~R5(2026-10-02 21:5x · 10-03 07:5x, `.omc/decisions.md`) · 조사 1·2차 · 시제품 v1·v1.1(`.omc/artifacts/session589/scope/` — 깃 밖). 상태: **v1 확정(설계)** — 구현은 §9 순서의 PR 네 개, 각 PR 에 검사관 3명.

## 1. 문제 (실측 2026-10-02 · 라이브 1,918곳 · `trades` 12개월 880,276행)

지금 시세 값은 전부 **구 전체**를 한 덩어리로 계산한다(`scripts/collectors/trade-stats.mjs` `tradesByGu` — `nearby_median`·`jeonse_rate`·`psr`·`price_by_area`·`rent_by_area`·`jeonse_by_area`·`price_by_floor`).

| 사실 | 수치 |
|---|---|
| 같은 평수(±10㎡) 매매가 최고÷최저(중앙) | 구 **8.19배** → 같은 동 3.71배 → 같은 단지 **1.20배** |
| 같은 단지 중앙값 ÷ 구 중앙값 | 1.34배(구 값은 신축을 낮게 잡는다) |
| PSR(분양가 ÷ 구 ㎡당 중위) "비쌈" | 1,736곳 중 1,404곳(81%) — 적정가로는 "저렴"인데 PSR 은 "비쌈" 361곳 |
| 전세가율 100% 초과(저장값) | 1,824곳 중 88곳(최대 266.9%) — 같은 단지 안에서 재면 **0곳** |
| 화면 제목 | "인근 … (최근 6개월)" — 실제는 구 전체·12개월 |
| 화성시 | 2026 개편으로 4구(41591·41593·41595·41597)인데 `_shared.mjs` 코드표는 `"화성시": "41591"` 하나 → 만세구 거래(7.9%)만 수집, 동탄·병점 쪽 동은 **0행**. 옛 41590 은 0건 |
| 고유 색인 `idx_trades_unique(region,gu,deal_month,area,price,floor,trade_type)` | 서로 다른 거래를 한 행으로 접는다 — 원문 대비 전세 11.3% · 매매 3.8% · 분양권 5.1% 손실(표본 8구). 대부분 같은 단지 안의 다른 거래 |
| 원문에 있는데 버리는 칸 | `aptSeq`(매매 상세·전월세) · `jibun` · `umdCd`(매매) · `dealDay` · `aptDong` · `contractType`(전월세) · `ownershipGbn`(분양권 — "입" = 입주권 14%) — `collect-trades.mjs:76-116` |

원인은 하나다 — **거래에 "어느 단지"가 없다.** 그래서 같은 단지를 셀 수 없고, 구 단위로 뭉개서 보여 줄 수밖에 없었다.

## 2. 결정

### 2-1. 사장님 결정 (원문은 `.omc/decisions.md`)

| # | 결정 |
|---|---|
| **R1** | 비교 순서 = ① 같은 단지 거래 → ② 같은 동·같은 평수 거래. 둘 다 부족하면 **안 보여 주고 점수 중립**. 구 값은 쓰지 않는다 |
| **R2** | 입주 전 단지는 **분양권 거래값**을 같은 단지 실거래로 쓴다 |
| **R3** | 전세가율 = 같은 단지 전세 ÷ 같은 단지 매매(같은 평수). 없으면 **안 보여 주고 점수 중립**(동 값으로 대신하지 않는다) |
| **R4** | 가격 점수의 '주변 대비(PSR)' 칸을 **없애고** 그 비중 0.25 를 '실거래 대비(괴리도)'로 합친다(괴리도 0.55) |
| **R5** | 같은 동 단계 = **보여 주기와 판정 분리**. 화면은 같은 동·같은 평수 거래를 나이 제한 없이 **사실대로**(건수·가격 범위·그 집들의 준공 연도 범위·"이 단지보다 N년 오래됨"). '저렴/비쌈' **판정과 점수 반영은 또래 집(준공 10년 이내 차이) 거래 3건 이상일 때만**. 또래끼리 비교할 땐 신축 가산(`AGE_PREMIUM`) 안 곱함. 또래 없으면 점수 중립 + 사실 한 줄만 |
| V9~V12 | 시세 탭 새 화면(워크트리 `s589-viz-price` 보존)은 **이 과제 뒤 한 번에** — PSR % 표기(V9)는 R4 로 소멸, 두 출처 상자 → 사실 한 줄(V10), 공시가격 손님 화면 제외(V11), 최저·최고는 막대 양 끝(V12) |

원칙(사장님, 2026-10-02): **"정확한 정보를 보다 쉽게, 사실대로 — 억지로 제공하지 않는다."**

### 2-2. 기술 선택 (메인 — 조사·시제품 근거)

| # | 선택 | 근거 |
|---|---|---|
| D1 | 거래는 **새 표 `trade_deals`** 에 원문 칸 그대로 저장한다. 기존 `trades` 는 **그대로 계속 쓴다**(2u 가 읽는다 — 목록 API·신선도) | `trades` 는 2u 공용 + 고유 색인이 거래를 접는다. 열쇠를 바꾸면 2u·일회성 도구 전부 영향. 새 표면 2u 영향 0 |
| D2 | 같은 단지 열쇠 = 국토부 **`aptSeq`**(매매·전월세). 분양권은 `aptSeq` 가 없으므로 **(시군구코드·법정동명·지번) + 이름** | 전월세 행 77.7% 가 매매와 같은 `aptSeq`, 그 행들은 단지명 99.9%·지번 100% 일치. `aptSeq` 하나에 이름·지번이 둘 이상인 경우 0 |
| D3 | 우리 단지 → `aptSeq` 연결 = **법정동코드 10자리 + 지번**으로 후보를 찾고 **이름·차수 검사(`_match-gates.mjs`)로 거른다**. 지번이 없으면 같은 법정동 안 이름으로. 한 단지에 열쇠가 여럿일 수 있어 **연결 표**에 목록으로 둔다 | 지번만 믿으면 35곳 중 2곳 오탐(옆 필지·차수) · 한 지번에 1·2·3단지가 함께 걸리는 경우 있음 |
| D4 | **입주권("입")은 저장하지 않는다** | 분양권 창구에 재개발 입주권 14% 가 섞여 있다 — 다른 시장 |
| D5 | 새 표는 **(시군구코드·월·종류) 단위로 지우고 다시 넣는다**(upsert 열쇠 없음) | 전세는 자연 열쇠가 없다. 같은 거래를 두 행으로 접지 않는다 |
| D6 | 화성은 **4코드 전부** 받되, **가) 에서는 `trade_deals` 에만** 넣는다 — `trades` 는 지금처럼 41591 응답만(사장님 결정 2026-10-03 09:2x: 화성 60곳의 '거래 침체'·주변 시세·점수가 두 번 바뀌지 않게, 다) 점수 전환 때 함께 바로잡는다 → 다) 에서 `trades` 화성 4코드 전환을 같은 전이표에). `trade_deals.gu` 는 `"화성시"`(우리 `apartments.gu` 표기와 같게), 실제 호출 코드는 `sgg_cd` 칸에 | 코드표 한 줄만 바꾸면 다른 소비처(어린이집 arcode 등)가 흔들린다 → 수집기 전용 다중 코드표 |
| D7 | 문턱 = **3건**. 값 옆에 **건수·기간·범위**를 늘 적는다 | 3·3 이면 전세가율 100% 초과 0 |
| D8 | 같은 단지 적정가 = 같은 평수(§5-2) 실거래 **중앙값**. 연식·브랜드·면적 계수를 **곱하지 않는다** | 자기 단지 값이다. (시제품은 평균 — 나) 미리보기에서 차이 확인) |
| D9 | 같은 평수가 3건 미만이면 같은 단지에서 **면적 차 20㎡ 이내** 거래 ≥3건의 ㎡당 중앙값 × 우리 면적. 그것도 없으면 **적정가 없음**. 면적 미상 단지는 **적정가 없음** | 소형↔대형 ㎡당 값이 달라 더 넓히면 어긋난다(시제품 표본) |
| D10 | 적정가가 없을 때 **괴리도만 중립**(전세가율·PIR 은 각자 판정). 폴백이 아니므로 신뢰도 −15 차감 없음 | 지금 엔진은 4개 다 중립(`scorePrice.ts:256`) — 시제품 사본 ④ |
| D11 | 전세가율의 전세는 **갱신 계약 제외**(`contractType` = "갱신"), 신규·빈칸은 포함 | 갱신은 상한 규제값이라 시세가 아니다 |
| D12 | 가격 점수 가중치 = 괴리도 **0.55** · 전세가율 0.20 · PIR 0.15 · 신뢰도 0.07 · 택지비 0.03(합 1.00) | R4 |
| D13 | 유동성(DB 칸 `trade_stats.recent_trades_6m` · 코드 `recentTrades6m` → 등급 `LIQUIDITY_TIERS`/`LIQUIDITY_LOW_SCORE`, `src/constants/scoringTiers.ts` · `src/scoring/scoreRisk.ts:84,107`)·해제율(`cancel_ratio_6m`)·`regions.jeonse_rate`(지역 전세가율) 는 **구 통계가 맞다 — 그대로**. 다만 `trades` 행 수가 늘면(재수집의 빈 달 메움 · 다) 의 화성 4코드 전환 — 화성 6개월 매매 620 → 약 8,160건) `LIQUIDITY_TIERS` 경계를 **재측정** | 유동성은 동네 지표다 |
| D14 | 12개월 **재수집 1회**(창구당 2,520콜 · 합 7,560콜 · API 약 40분 + 저장 — 러너 주석의 옛 6개월 실측 74~120분이면 2~4시간) 로 새 표를 채운다. 정기 수집(매월 6일 05:30, 6개월치)이 이어 받는다 | 한도는 **창구별** 하루 10,000콜(헤더 실측) — `.claude/rules/scripts/api-quota-and-ratelimit.md` 의 "MOLIT_KEY 10,000 공유" 표기는 정정 |

## 3. 구조

```
collect-trades.mjs ─┬─ trades (그대로 — 2u 가 읽음)
   (원문 칸 보존)   └─ trade_deals [새] (aptSeq·지번·법정동·거래일·계약구분 …, 화성 4코드)
                          │
assign-trade-links.mjs [새] ── apartment_trade_links [새] : apartments.id ↔ aptSeq(매매·전세) / 분양권 열쇠
                          │
trade-stats.mjs ──────── trade_stats 새 칸 : 범위(complex/dong_peer/none)·건수·기간·적정가·같은 단지 전세가율·면적별 표·동네 사실
                          │
VIEW apartments_flat 새 칸 → scorePrice (괴리도 0.55 · PSR 폐지 · 중립 규칙) → 화면(시세 탭 · 카드 칩 · 정렬)
```

값마다 **범위·건수·기간을 함께 저장하고 화면이 그대로 적는다**(이름≠내용 사고 방지 — `tool-output-illusion-guard`).

## 4. 데이터 모델

### 4-1. `trade_deals` (새 표 · 미분양 소유 · 원문 한 건 = 한 행)

| 칸 | 형 | 출처 | 비고 |
|---|---|---|---|
| `id` | bigserial PK | | |
| `trade_type` | text | sale / jeonse / presale | 기존 표기 그대로 |
| `region` · `gu` | text | 수집 대상 쌍 | `gu` 는 `apartments.gu` 표기(화성 = "화성시", 세종 = "세종시") |
| `sgg_cd` | char(5) | 호출 LAWD_CD | 화성 4코드가 여기서 갈린다 |
| `umd_cd` | char(5) | 매매 `umdCd` | 전월세·분양권은 원문에 없음 → null |
| `umd_nm` | text | `umdNm` | 법정동 이름(지금 `trades.dong`) |
| `jibun` | text | `jibun` | 블록 표기("A4BL") 그대로 |
| `jibun_main` · `jibun_sub` | text | 매매 `bonbun`·`bubun` | 지번 본번·부번(묶기 때 `apartments.lot_main/lot_sub` 와 바로 대조) — 전월세·분양권은 `jibun` 을 `-` 로 갈라 채운다 |
| `apt_seq` | text | 매매·전월세 `aptSeq` | 분양권 null |
| `apt_name` | text | `aptNm` | |
| `apt_dong` | text | 매매 `aptDong` | 동(棟) — 중복 판별 보조 |
| `deal_month` | char(6) | | "202608" |
| `deal_day` | smallint | `dealDay` | |
| `area` | numeric(7,2) | `excluUseAr` | |
| `floor` · `build_year` | smallint | | |
| `price` | integer | 매매 `dealAmount` / 전세 `deposit` / 분양권 `dealAmount` | 만원. 전세는 월세 0 만(지금 규칙 유지) |
| `contract_type` | text | 전월세 `contractType` | 신규/갱신/빈칸 |
| `dealing_type` · `cancel_date` | text | 매매·분양권 `dealingGbn`·`cdealDay` | 분양권도 원문에 있다(사본 해제 71/1,174 — 검사관 C1). 전세 없음 |
| `road_nm` · `road_bonbun` · `road_bubun` | text | 매매 `roadNm…` / 전월세 `roadnm…`(글자 크기 다름) | 지번이 빈 단지(815곳)의 두 번째 묶기 길(검사관 C) · 분양권 없음 |
| `batch_id` | uuid | 회차 | §4-1 교체 방식 |
| `batch_rows` | integer not null | 회차 | 그 열쇠에 이번 회차가 넣으려던 행 수 — 행 수가 이 값과 같은 batch 만 **완성**(검사관 A2) |
| `recorded_at` | timestamptz default now() | | |

- 저장 안 함: `ownershipGbn = "입"` 행(D4) · 월세 있는 전월세 · 금액·면적 0.
- **교체 방식**: 한 회차에서 (sgg_cd, deal_month, trade_type) 를 받으면 ① 그 열쇠의 기존 batch 중 **가장 새 완성 batch**(행 수 = `batch_rows`)만 남기고 미완성·옛 batch 는 치운다 ② 새 `batch_id`·`batch_rows` 로 전부 넣는다(조회·넣기·지우기 재시도 3회 · 넣기 실패면 이번 회차분을 지워 되돌림) ③ 그 열쇠에서 **이번 회차 시작보다 먼저 들어간** batch 를 지운다(동시에 도는 다른 회차의 행은 안 지운다 — 검사관 A1) — ③ 실패는 경고(다음 회차가 치움). 읽는 쪽(trade-stats)은 열쇠마다 **가장 새 완성 batch 만** 읽는다 — 어느 단계에서 죽어도(강제 종료 포함) 반쪽 batch 는 "완성"이 아니라서 읽히지 않는다. 0건 응답은 **지우지 않는다**(옛 코드·장애가 0건으로 온다 — `admin-district-code-reform.md` §4). 새 행 수가 기존 완성 batch 의 **절반 미만**이면 교체를 보류한다(급감 차단기 — 경고 `WARN_STEPS: trade_deals_held_N`). 한 회차에 같은 열쇠는 한 번만 저장한다(구 없는 시 이름 gu 16행이 같은 코드를 두 번 부른다). 표가 없으면(마이그 적용 전) 첫 열쇠에서 그 회차의 새 표 쓰기를 멈춘다.
- 색인: `(apt_seq, trade_type, deal_month)` · `(sgg_cd, umd_nm, jibun)` · `(deal_month, sgg_cd, trade_type, batch_id)`(감시가 달마다 읽는다 — 검사관 C5) · `(region, gu, umd_nm, deal_month)`.
- RLS 켬, 공개 읽기 정책 없음(서비스 역할만). 감시 ⑩ 권한 지문 **재승인**(`scripts/perm-baseline.mjs`).
- 보존: 받은 달은 지우지 않는다(정기 6개월치가 덧씌움). 36개월 넘는 달은 분기 정리 후보(BACKLOG) — 지금 `trades` 347MB(2u 기록) + 새 표 ≈ 12개월 1M 행 · 0.4~0.6GB 추정(검사관 C 어림 — 매 회차 지우고 다시 넣어 죽은 행이 생김). `monitor-db-size` 는 행 수만 세므로 **바이트는 운영 반영 때 재수집 전·후·첫 정기 회차 뒤 `pg_total_relation_size` 로 잰다**(검사관 C10).

### 4-2. `apartment_trade_links` (새 표 · 우리 단지 ↔ 거래 열쇠)

| 칸 | 비고 |
|---|---|
| `apartment_id` text FK → apartments | 한 단지에 여러 행 가능(대단지 여러 지번) |
| `link_kind` text | `apt_seq`(매매·전세) / `presale`(분양권) |
| `link_key` text | `apt_seq` 값 또는 `sgg_cd\|umd_nm\|jibun\|정리이름` |
| `method` text | `jibun+name` / `name` / `manual` |
| `similarity` numeric · `build_year_gap` smallint | 판정 근거 |
| `trade_apt_name` text · `trade_jibun` text | 눈 검수용 |
| `status` text | `active` / `hold`(동점·형제 충돌 — 사람 판정) / `rejected` |
| `created_at` · `verified_at` · `verified_by` | 사람 승인 기록 |

유니크 `(apartment_id, link_kind, link_key)`. 매일 배치 `assign-trade-links.mjs --apply`(dry-run 기본 · 미리보기 JSON · 차단기 "바뀜 30행 또는 10%")가 새 단지·새 거래에 맞춰 채운다 — `assign-complex-keys.mjs` 와 같은 틀(열쇠 깔기 가) 의 재사용).

### 4-3. `trade_stats` 새 칸 (옛 칸은 **두되 라) 뒤 정리 PR 에서 삭제** — 의미를 바꿔 끼우지 않는다)

| 칸 | 뜻 |
|---|---|
| `cmp_scope` text | `complex` / `dong_peer` / `none` — 적정가(판정)의 범위 |
| `cmp_fair_price` integer · `cmp_n` smallint · `cmp_months` smallint · `cmp_area_mode` text(`same_area` / `per_m2`) | 적정가·건수·기간(12)·면적 방식 |
| `complex_jeonse_rate` numeric · `complex_jeonse_n` smallint · `complex_sale_n` smallint | R3 전세가율과 분모·분자 건수 |
| `complex_table` jsonb | 같은 단지 면적별 행 `[{area, n, min, median, max, last_month}]`(매매 또는 분양권) · 전세 행 따로 `complex_jeonse_table` |
| `dong_fact` jsonb | 같은 동·같은 평수 **나이 제한 없음** 사실: `{n, min, median, max, build_year_min, build_year_max, age_gap_years, peer_n, peer_median}` |
| `cmp_src` text | 판정에 쓴 거래 종류 `sale` / `presale` |

`psr` 는 다) 에서 계산을 멈추고 null(칸은 정리 PR 에서 삭제). `nearby_median`·`jeonse_rate`(구) 도 같은 길. `regions.jeonse_rate`(지역, `trade-stats-regions.mjs`) 는 그대로.

## 5. 규칙

### 5-1. 묶기 (나 — `assign-trade-links.mjs`)

1. **열쇠 사전**: `trade_deals` 12개월에서 `apt_seq` 별 (sgg_cd, umd_cd/umd_nm, jibun, 최빈 apt_name, 최빈 build_year). 분양권은 (sgg_cd, umd_nm, jibun, 정리 이름) 별.
2. **지번 경로**: 우리 `bjd_code`(10자리) = `sgg_cd+umd_cd`(매매) 또는 (region·gu·umd_nm 일치) 그리고 `lot_main-lot_sub` = `jibun`(본번만이면 본번 일치) 인 후보 → **이름 검사**: `namesCompatible`(차수·로마 — `_match-gates.mjs`) 통과 + `stringSimilarity(cleanMatchName(우리), cleanMatchName(거래))` ≥ **0.6** + 완공연도 ↔ `build_year` 차 ≤ 2년(둘 다 있을 때). 통과 = `method: jibun+name`.
3. **이름 경로**(지번 없음·자리표시 지번·지번 경로 0건): 같은 법정동 안 후보 중 `namesCompatible` + 유사도 ≥ **0.85**(또는 공백 제거 부분문자열) + 완공연도 차 ≤ 2년 → `method: name`. 지번이 **자리표시**(같은 지번을 이름 다른 단지 2종 이상이 공유 — 15곳 36단지 · `coord_shared` 표시 단지)면 지번 경로를 **쓰지 않는다**.
4. **동점·형제**: 한 후보가 우리 단지 둘 이상에 붙거나(1·2단지 접힘) 우리 단지 하나에 차수가 다른 후보가 둘이면 **`hold`** — 붙이지 않고 미리보기에 보고(사람 판정). "우리 이름에만 차수가 있고 거래 이름엔 없으면" 버림(시제품 틀린 짝의 대부분).
5. **대조군**(시험 픽스처 = 조사 2차 표본 10쌍 `scope/research2/report-research2.md`): 양성 — 화성시청역 서희스타힐스 4차·반정 아이파크 캐슬 5단지·화성비봉 호반써밋(이름 기준은 놓침, 지번은 맞음)·동탄 A106 어울림파밀리에(이름 바뀐 단지) / 음성 — 신동탄포레자이 960(옆 필지)·금강펜테리움 6차↔7차(차수) / 보류 — 운암자이포레나 1·2·3단지(같은 지번 252)·디에이치 퍼스티어(지번 여럿).
6. 수집 공백 지역(화성 3구 등)은 재수집 뒤에 묶는다 — 묶기 배치는 **재수집 다음 날**부터.

### 5-2. 범위 판정 (나 — `trade-stats.mjs`)

- **같은 평수** = 전용면적 차 **10㎡ 미만**(상수 `SAME_AREA_TOL_M2`; 시제품은 ≤10 — 미리보기에서 건수 차이 확인). **또래** = `build_year` 와 우리 완공연도(입주 전은 예정연도) 차 **≤ 10년**(`PEER_YEARS`). 기간 = 최근 **12개월**(`deal_month`), 해제 거래(`cancel_date`) 제외.
- **입주 여부** = `_match-gates.mjs isMovedIn`(완공월 < 기준 달). 입주 후 → 매매, 입주 전 → 분양권(R2). 완공월 모름 → 둘 다 찾아 **있는 쪽**(둘 다 있으면 매매).
- **T1 같은 단지**: 연결 표 `active` 열쇠의 거래 중 같은 평수 ≥ 3 → 적정가 = 중앙값(`cmp_area_mode = same_area`). 아니면 D9 의 ㎡당 환산(`per_m2`). 아니면 T2 로.
- **T2 같은 동 또래**: 같은 법정동(우리 `bjd_code` 10자리 ↔ `sgg_cd+umd_cd`, 매매만) · 같은 평수 · 또래 · **매매** ≥ 3 → 적정가 = 중앙값, 계수 없음(R5). 읍·면 단위 주소만 있는 134곳은 법정 읍·면이 곧 `umd_nm` 이므로 같은 규칙(미리보기에서 건수 확인 — §10).
- **T3 없음**: `cmp_scope = none`, 적정가 null.
- **동네 사실**(`dong_fact`, 나이 제한 없음): 같은 법정동·같은 평수 매매 ≥ 1 이면 저장(n·최저·중앙·최고·건축년도 범위·우리 완공연도와의 차이·또래 건수). T1/T2/T3 어느 경우에도 저장 — 화면은 T1 이면 접어 두고, T2·T3 면 펼쳐 보인다.
- **전세가율**(R3·D11): T1 열쇠의 같은 평수 전세(갱신 제외) ≥ 3 **그리고** 같은 평수 매매 ≥ 3 → 전세 중앙 ÷ 매매 중앙(%). 아니면 null. 입주 전 단지는 매매가 없어 거의 null(사실이다 — 억지로 채우지 않는다).
- **면적별 표**(`complex_table`): T1 열쇠의 거래를 면적(소수 둘째 자리 반올림) 별로 묶어 n·최저·중앙·최고·마지막 달. 전세도 같은 모양. T1 이 아니면 빈 배열.

### 5-3. 점수 (다 — `scorePrice.ts`)

- 적정가 입력 = `cmp_fair_price`(범위 무관 — 어느 범위든 계수 없이 들어온 값). 괴리도 식·등급 구간은 그대로, **입력만 교체**. `cmp_scope = none` → 괴리도 중립(D10). 폴백(구 중위·시도 평균·분양 평당가) **삭제**.
- 전세가율 입력 = `complex_jeonse_rate`(null → 중립). `naver_jeonse_rate` 폴백 삭제.
- PSR 축 삭제 → 가중치 D12. `PSR_SCORE_TIERS` 등 상수·문구표(`scoringTiers.ts`·fieldMeta) 정리.
- `AGE_PREMIUM`·`PRESALE_PREMIUM_COEFF`·브랜드 계수는 **적정가 계산에서 빠진다**(같은 단지·또래 비교라). 다른 축에서 쓰는지 grep 하고, 안 쓰면 상수 삭제는 정리 PR.
- **전환 전후 등급 전이표**를 미리보기로 만들어 사장님 승인 뒤 반영(시제품 어림: 등급 바뀜 약 514곳 — 오름 342·내림 172). `recent_trades_6m` 경계 재측정은 재수집 뒤 분포로(D13).
- 점수 의미·문구 짝(`score-meaning-and-wording-are-a-pair.md`): "주변 시세 대비" 문구 전부 → "같은 단지 실거래 대비 / 같은 동 또래 실거래 대비".

### 5-4. 화면 (라 — 보존한 시세 탭 + 카드)

| 경우 | 제목·문구(안 — 라) 그림으로 확정) |
|---|---|
| T1 매매 | "이 단지 실거래 N건 (최근 12개월) 기준 — 적정가 X억, 분양가는 Y% 저렴/비쌈" |
| T1 분양권 | "이 단지 분양권 거래 N건 (최근 12개월) 기준 …" |
| T2 | "같은 동 비슷한 연식(±10년)·같은 평수 실거래 N건 기준 …" + 아래 동네 사실 줄 |
| 사실 줄(T2·T3) | "같은 동·같은 평수 실거래 N건 · 최저 A억 ~ 최고 B억 · 1996~2004년에 지은 집 (이 단지보다 약 22년 오래됨)" — **준공 연도는 가격과 같은 줄·같은 크기** |
| T3 (동네 거래도 없음) | "비교할 실거래가 아직 없어요" |
| 전세가율 | 값 있을 때만 "이 단지 전세 N건 ÷ 매매 M건" · 없으면 칸 자체를 안 그린다(R3) |
| 카드 칩 | '저렴/수준/비쌈' 칩은 T1·T2 만. 전세가율 칩은 `complex_jeonse_rate` 있을 때만(1,824 → 약 237장 — 빈자리 처리는 라) 그림에서 결정). '전세가율 높은순' 정렬은 값 있는 카드만 |

## 6. 수집기 변경 (가 — `collect-trades.mjs`)

1. 원문 칸 파싱 확장: `aptSeq`·`umdCd`·`jibun`·`dealDay`·`aptDong`·`contractType`·`ownershipGbn`(분양권 "입" → 건너뛰고 skip 으로 센다 — 실패 아님).
2. `trades` upsert 는 **그대로**(열쇠·중복 제거·`tradeRowGu` 전부 불변). 같은 회차 같은 응답으로 `trade_deals` 도 쓴다(§4-1 교체 방식). 둘 중 하나가 실패하면 회차는 실패로 끝낸다(`collector_runs` fail).
3. 화성 4코드: `_shared.mjs` 에 **수집기 전용** `GU_LAWD_CODES(region, gu)` → `string[]`(기본 `[getLawdCd()]`, 화성시 = 4개). `GU_LAWD_MAP["경기"]["화성시"] = "41591"` 은 다른 소비처 때문에 그대로 둔다. `--only=경기:화성시` 는 4코드를 돈다. 행의 `gu` 는 "화성시", `sgg_cd` 가 실제 코드. **`trades` 행은 `getLawdCd` 코드(41591) 응답에서만 만든다**(D6 — 추가 3코드는 `trade_deals` 전용, 다) 에서 전환). **표를 바꾸기 전 소비처 raw 1회** 규칙은 조사 2차 A5⑤(옛 41590 = 0건 · 새 4코드 건수)로 충족.
4. 호출 간격 200ms 유지. 한도는 창구별 하루 10,000(D14). `recordApiQuota` 그대로.
5. 12개월 재수집 1회 = `--months=12 --budget-min=0`(운영 반영 절차 §9-가 · 벽시계 예산 150분은 6개월 정기 회차 기준이라 재수집엔 끈다 — 예산에 닿으면 뒤쪽 지역은 **`trades` 까지** 빠진다, 검사관 C3). 이때 `trades` 도 12개월이 다시 upsert 된다(멱등 — 빠졌던 강남 전세 옛 달 같은 공백이 메워진다 → 행 수 증가는 **의도된 변화**로 전이표에 적는다). 재수집 소요는 첫 정기 회차(10/06) 예산 판단의 근거로 기록한다(새 표 쓰기가 예산 안쪽 반복에 더해졌다).
6. 감시: `monitor-collectors.mjs` 에 ⑯ **trade_deals 건전성** — 최근 회차 (sgg_cd·월·종류) 열쇠마다 `batch_id` 가 둘 이상 = 경보 · `trade_deals` 최근 달 행 수 vs `trades` 같은 달 행 수 비율 0.9~1.3 밖 = 경보 · 화성 4코드 각각 최근 달 > 0.

## 7. 하지 않는 것

구 단위 유동성·해제율 변경 · 점수 다른 축(입지·안전 등) · "한 단지 = 한 장" 나)·다)(VIEW 조합 — 순서만 맞춘다, §9) · 값 비우기(별도 트랙) · `trades` 표 구조·열쇠 변경 · 2u 쪽 코드 · 36개월 넘는 달 정리(BACKLOG).

## 8. 검증 · 수용 기준

| 단계 | 기준 |
|---|---|
| 가 수집기 | 시험 픽스처 = 조사 2차 **실제 응답 사본**(`scope/research2/raw/`)으로 파싱 → `aptSeq`·`jibun`·`umdCd`·`contractType` 채움, "입" 제외 수 일치 · 화성 `--only` 가 4코드를 돌고 `gu="화성시"`·`sgg_cd` 4종 · 교체 방식(죽은 회차 흔적 → 새 것만 남음) · `trades` 쓰기 경로 **diff 0**(기존 시험 전부 초록 + 변이) · 재수집 뒤 운영 대조: `trade_deals` 월별 행 수 vs 원문 totalCount 합(표본 8구 100%), `aptSeq` 채움률(매매·전세 ≥ 99%), 화성 4코드 각 > 0, 중복 batch 0 |
| 나 묶기·통계 | 대조군 10쌍 통과 · 미리보기 명단(개수 + id) 사장님 승인 · 범위별 건수 = 원문 재집계와 일치 · 100% 초과 전세가율 0 · `dong_fact.age_gap_years` 부호·값 눈 검수 10곳 |
| 다 점수 | 전환 전후 등급 전이 행렬(승인) · 재현 검증(지금 입력 → 지금 점수 1,918/1,918) · 가중치 합 1.00 가드 · `scoring-validator` 에이전트 |
| 라 화면 | 범위 문구 = `cmp_scope` 와 일치(시험) · PC·휴대폰 캡처 전·후 · 준공 연도 줄이 가격 줄과 같은 크기(픽셀) · 전세가율 칸 없는 카드 레이아웃 깨짐 0 |
| 공통 | 각 PR 검사관 3명(할루 Sonnet · 적대 Opus · 맹점 Opus — 수집기·DB·점수는 Opus) · 변이 표 · 본 폴더 미커밋 0 |

## 9. 순서 (PR 네 개 · 운영 반영 지점)

| PR | 내용 | 운영 반영(각각 전이표·승인) |
|---|---|---|
| **가** `s589/trade-scope-a` | 마이그 `trade_deals`(+롤백) · 수집기 §6 · `GU_LAWD_CODES` · 감시 ⑯ · 시험 · `api-quota-and-ratelimit.md` 창구별 한도 정정 | ① 마이그 psql(리허설 ROLLBACK → 적용) ② 권한 지문 재승인 ③ 합침·운영 폴더 반영(예약 창 밖 — **반드시 ① 뒤**: 표 없이 합치면 감시 ⑯ 은 침묵하지만 회차는 실패 1건) ④ **12개월 재수집 1회**(`--budget-min=0` · 시작 전 collect-trades 프로세스 0 확인 · **10/06 05:30 정기 회차 전에 끝낸다** — 같은 열쇠를 동시에 쓰지 않게) ⑤ 대조 §8(중복 batch 0 은 **12개월 전부**에서 — 7~12번째 달은 정기 회차가 다시 안 쓴다) ⑥ 2u 통지(새 표 소개 · `trades` 내용 그대로 · 창구별 한도) |
| **나** `s589/trade-scope-b` | 마이그 `apartment_trade_links` + `trade_stats` 새 칸 + VIEW 새 칸 · `assign-trade-links.mjs` · `trade-stats.mjs` §5-2 · 감시(연결 표 건전성) | 마이그 → 묶기 미리보기(명단 승인) → `--apply` → trade-stats 1회 → 새 칸 채움 대조. 화면·점수는 아직 옛 칸을 읽으므로 손님 노출 0 |
| **다** `s589/trade-scope-c` | `scorePrice.ts` §5-3 · 등급표 재측정 · 문구표 · PSR 폐지 | 전이표(등급 바뀜 명단) 승인 → 합침 → 다음 굽기(03:0x)에 반영 — **라) 와 같은 굽기에 나가도록 합침 시각을 맞춘다**(점수만 먼저 바뀌고 화면은 옛 문구인 창을 없앤다) |
| **라** `s589/trade-scope-d` | 보존 워크트리 `s589-viz-price`(시세 탭 새 화면, base dd8e1a4e → rebase) + §5-4 문구·칩·정렬 + 옛 칸 삭제 정리 | 캡처 전·후 사장님 확인 → 합침 |

"한 단지 = 한 장" 나)·다)(VIEW 조합) 와의 순서 = **이 과제 나) 가 먼저**(같은 VIEW·`trade_stats` 를 건드린다). 열쇠 깔기(가, 완결)와는 충돌 없음.

## 10. 열린 것 (사장님 결정 또는 미리보기 뒤)

1. 읍·면 단위 주소 134곳 — 같은 법정 읍·면을 "같은 동"으로 볼지(건수 미리보기 뒤).
2. 전세가율 칩 빈자리(1,824 → 약 237장) — 라) 그림에서.
3. 재수집 시기 — 가) 합침 날 바로(휴일 낮 권장 · 2u 창구 다름 · 05:30~06:30 예약 창 밖).
4. `trade_deals` 보존 기간(36개월 정리) — BACKLOG.
5. 병점·동탄 분양권 12개월 0건의 원인(창구가 옛 코드로 주는지) — 재수집 로그에서 확인, 0 이면 옛 코드 1콜 대조.

## 11. 근거 산출물(깃 밖 — `.omc/artifacts/session589/scope/`)

`report-scope.md`(1차) · `07-raw-tags.log`(원문 칸) · `research2/report-research2.md`(표 정의·2u 사용처·지번 표본 289콜·비용) · `proto/report-proto.md`·`report-proto-v11.md`(점수 전이) · `spec-draft.md`(v0).
