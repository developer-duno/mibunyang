# PR-F2 — 인천 2026 개편(중구·동구→제물포구·영종구, 서구→서해구·검단구) 반영 + 시군구 표기·법정동코드 재정합 도구 (세션546, 2026-09-11) — **v2 (독립 검토 반영)**

> 한 줄: 전남광주(세션545)와 같은 사고가 인천에서 **3개월째** 나고 있다. 실거래가·건축HUB 는 소급해 옛 코드에 0건을 주고, 우리 코드표엔 새 구가 없다.
> 게다가 동구 코드는 개편과 무관하게 **처음부터 틀린 값**(28120, 실제 28140)이라 인천 동구 거래는 한 번도 수집된 적이 없다.
> 전남과 다른 점 = 새 구가 옛 구를 **쪼갠** 것이라 이름·코드 1:1 표가 없다 → **좌표로 다시 판정**한다.
> 그리고 **옛 이름을 표에서 지우면 안 된다** — `getLawdCd` 의 전 지역 폴백이 인천 중구에 서울 중구 코드를 준다(검토자 실증). "은퇴 키"로 막는다.

## 검토 이력
- v1 → v2 (2026-09-11 02:10, 독립 검토자 opus, REJECT): §0 실측 전부 재현. **C1** 옛 항목 삭제 → `getLawdCd` L557-559 전 지역 폴백이 `인천/중구→11140(서울)`·`동구→26170(부산)`·`서구→26140(부산)` 을 조용히 반환(실행 증거) → 은퇴 키로 재설계. **C2** 화성 필터가 130행을 잡음 → 화성 한정. **C3** `=== undefined` 단언 불가능 + `collect-data.test.mjs` 3건 깨짐 → `toBeNull` 갱신(삭제 금지). M1~M7·minor 7·누락 6 반영. twin 키(dong+apt_name)는 검토자 실측 **1.0000**(565/565·107/107)으로 스펙이 옳음.
- 사전 실측 추가(v2, 02:20): 학교알리미 새 코드 수용 = DB 증거(새 이름 47곳 전부 07-01 이후 `schools` 갱신, 검단 초·중 실명), 건축HUB = raw 대조(§0-1), 구독자 인천 0명, trade-stats 거래 0건 → `recent_trades_6m = length || null`(L483).

## 0. 실측 근거 (2026-09-11, 스크래치패드 `probe-546-molit-incheon`·`probe-546-kakao`·`probe-546-incheon-db`·`probe-546-cols`·`probe-546-f2-pre`·`probe-546-hub3`; 검토자가 앞 4개를 재실행해 전부 일치)

### 0-1. 외부 API 원문 — 소비처별 옛/새 코드 (룰 §1 "표 바꾸기 전 소비처마다 raw 1회")

| 소비처 | 옛 코드 | 새 코드 | 판정 |
|---|---|---|---|
| 행안부 인구 lv=2 202607 | (중구·동구·서구 행 없음) | 제물포구 `2812500000` 99,299 · 영종구 `2815500000` 138,091 · 서해구 `2827500000` 392,173 · 검단구 `2829000000` 273,735. 202507 은 중구 `2811000000` · 동구 **`2814000000`** · 서구 `2826000000` | 새 코드만(07~) |
| 실거래가 `RTMSDataSvcAptTrade` LAWD_CD | 28110·28120·28140·28260 = **0건 (202605·202608 둘 다)** | 28125=48/59 · 28155=87/112 · 28275=223/355 · 28290=230/328 (202608/202605). 대조군 미추홀구 28177=218/266 | **새 코드만, 소급** |
| 건축HUB `BldEngyHubService` (같은 건물 e편한세상 검단 어반센트로 lot 223-1) | `28260/11400` 202512 = 1건(useQty 13,763) · 202605 = **0** | `28290/10400` 202605 = 1건(**useQty 371,952**) · 202512 = 0 | **새 코드만(2026 중 전환)**. ⚠️ useQty 27배 — 전남 "50배" 와 같은 현상, 단위 미확인(§5) |
| 학교알리미 (`schools-neis.mjs:560-561` bjd 앞5 1순위) | — | 새 이름 47곳(bjd 28125/28155/28275/28290) `schools` 행 **47/47 이  07-01 이후 갱신**, `nearby_schools` 에 검단·영종 학교 실명 | **새 코드 수용**(DB 증거; 로컬에 키 없어 raw 불가) |
| 어린이집 arcode(`childcare-info.mjs:185-194 listAllSgg()` = GU_LAWD_MAP 순회) | 호출 안 함(키 노출 사고) | — | 표를 따라간다 → §6 다음 04:30 로그로 |
| 카카오 `coord2regioncode` | — | 새 구 이름 + **새 법정동코드**. 영종(운남동) `2811014600 → 2815510200`(뒤5도 바뀜) · 제물포(송림동) `2814010700 → 2812510700` · 검단(당하동) `2826011400 → 2829010400`. H(행정동) `region_2depth_name` 은 인천에선 한 단어("검단구"), **경기 화성은 두 단어("화성시 동탄구")** | |

### 0-2. DB 현재값

- `apartments` 인천 **264**곳 `gu|bjd앞5`: 옛 이름 **45** = 서구|28260:28 · 중구|28110:10 · 중구|28155:1 · 중구|null:1 · 동구|28140:5 / 새 이름 **47** = 검단구|28290:19 · 서해구|28275:11 · 서해구|null:1 · 영종구|28155:10 · 제물포구|28125:6 / 변경 없는 7구·군 **172**(계양구|null:1 포함). lat null 0. (`28120` 행은 0 — 동구는 전부 28140.)
- `trades` 인천 2026: 서구·중구는 **202605 까지만**(06·07·08 = 0) · 동구 **전 기간 0행** · 새 4구 **0**. 백필 창 `202509~202608` 안의 옛 행 = **13,758**(sale 6,388 · jeonse 6,876 · presale 494; 그중 5,877 이 202509~202512). 202508 이하 옛 행 없음. jeonse 는 `apt_name` null(수집기 `buildRow` 가 안 넣음, `collect-trades.mjs:103`) — 새 수집도 null 이라 키 일치. 컬럼 = `id,region,gu,dong,deal_month,area,price,floor,build_year,trade_type,deposit,recorded_at,apt_name,cancel_date,dealing_type`.
- `regions` 인천: 새 구 4행이 07-01 에 **이미 존재**(crime_grade·net_migration·regional_unsold 는 새 이름으로 채워짐). `fertility_rate`·`doctors_per_1k`·`hospital_beds_per_1k` 는 옛 이름 @26-06 까지, `housing_price` 는 전 구 @26-01. 옛 3행은 남긴다(이력; VIEW 는 `apartments.gu` 로 조인하므로 고아 행 무해).
- `trade_stats`(옛 서구 표본 3곳): `nearby_median 51000 · recent_trades_6m 1890 · updated 09-10 04:27`. gu 를 바꾸면 그 단지는 `statsKey(인천:검단구)` 그룹 = 거래 0건 → **`recent_trades_6m = null`·`nearby_median null`**(L483) = 점수 입력값이 빈다 → 백필과 재계산을 같은 자리에서(§4).
- `subscribers` 인천 **0명** → 이관 없음.
- 경기 화성 표기 3종: `화성시` 61 · `화성시 동탄구` 3 · `화성특례시` 2(ah-2026910146 동탄 그웬 160 — 카카오 H "화성시 동탄구 동탄9동" · ah-2026910065 화성 봉담자이 라젠느 — bjd **null**, 카카오 B `4159325024` 효행구 봉담읍). 별칭표 정책(`sigungu-aliases.json` 화성시 `_why`) = 전부 "화성시"로 접는다(`화성시 동탄구` 3곳은 `regions` 에 동탄구 행 지표가 있어 정밀도가 시 단위로 내려가지만 **화면 67곳 통일**이 확정 정책).
- **경기 일반구 표기 미정규화 127행**(권선구14·오정구14·처인구13·덕양구12·소사구7·… `normalizeGu` 결과 ≠ 현재 gu): 지표 JOIN 이 끊겨 있다(`지표 전=false 후=true`). **이 PR 의 자동 대상이 아니다** — §2-D 옵트인 모드로 설계만 하고 실행은 별도 승인(§4-6).
- 개별(P2 흡수): bjd 타시도 3곳 — ah-2026910076 `4413310800`→`1227012000`(남구 지석동) · ah-2026910086 `4480025600`→`1213013300`(여수 신기동) · ah-2026910134 `4825012400`→`1213013100`(여수 소호동). bjd null — ah-2026910189 → `1230013900`(북구 월출동) · ah-2026910183 → `1215032028`(순천 서면; ah-2026930022 와 좌표 동일 = 중복 후보, **처리 결정은 사장님 몫이라 bjd 만 채운다**). **ah-2026910190 제외**(A7 과 좌표 동일 = 자리표시 → 별도).

### 0-3. 코드 (검토자 재대조 완료)

- `scripts/collectors/_shared.mjs` L282-285 `GU_LAWD_MAP["인천"]` 옛 10항목, 동구 "28120"(틀림). L260 `REGION_LAWD_PREFIX["인천"]="28"`(무변경). **L557-559 `getLawdCd` 전 지역 순회 폴백** `for (const rMap of Object.values(GU_LAWD_MAP)) if (hasOwnProperty(rMap, gu)) return rMap[gu];` — 인천 표에 없는 gu 는 서울·부산의 동명 구 코드를 받는다(`getLawdCd("인천","강남구")="11680"`). 이 폴백 자체는 잠재 결함 — **이 PR 범위 밖**, BACKLOG 한 줄.
- `normalizeGu(region, gu)` L512-524: 별칭표(`src/data/sigungu-aliases.json`) 우선 → 경기 화성 폴백(`HWASEONG_BARE_GU` L461). 별칭 키는 `${17지역약칭}|${form}` — **카카오 원문 시도명("경기도")으로는 절대 안 맞는다**(`normalizeGu("경기도","화성시 동탄구")` = 무변경 실증).
- `apartments.gu` 를 쓰는 경로 중 normalizeGu 를 안 거치는 두 곳: `reverse-geocode.mjs` **L135** `let gu = admin.region_2depth_name || null;`(그 시점 `region` 은 카카오 원문; 정규화 L145 `normalizeRegion(region, gu)` → 검증 L151 `VALID_REGIONS`) · `naver-presale.mjs` L632 `buildNewApartment(row, complexData, regionFallback)` L639 `gu: gu ?? null`(호출부 L1000 `item._region`).
- `apartments.gu` 를 키로 쓰는 다른 자리: `src/hooks/useDataPipeline.ts:277,388`(구 필터·URL) · `useRegionAverages.ts:42`(지역 평균 버킷) · `api/supabase/apartments.ts:24` · `api/subscribers.ts:63` · `trade-stats.mjs:34 statsKey` — gu 가 새 이름으로 바뀌면 옛 gu 를 담은 저장 URL 이 0건(정상 결과), 지역 평균 버킷 재편(정상).
- VIEW `20260809000000_view_add_housing_price.sql` L67-77·L286 `rg.region = a.region AND rg.gu = a.gu`; 4지표 null 은 화면에 **"미수집"**(`fieldMeta.ts:132·279·284·290`), 점수 사용 0, `dataReliability` 미포함.
- `collect-trades.mjs`: `--only` 파서 L208-216(콜론만 요구 → `인천:제물포구` 받는다), 비교 대상은 apartments 에서 뽑은 `region:normalizeGu(gu)` 쌍(L237-240) → **gu 반영이 먼저여야 적중**. `--months=12`(09-11 실행) = `202509~202608`. 호출 = 4 pair × 3 타입 × 12 = **144회**. presale 은 `skipUnregistered`(L107).
- 골격 = `scripts/remap-jeonnam-gwangju-codes.mjs`(dry-run 기본·`--apply`·`--out`·`verifyResiduals` L220·`chunkIds` L201·`computeTwinRatio` L172·`TWIN_RATIO_MIN=0.99` L38). 좌표→행정구역 export 헬퍼 없음(`reverse-geocode.mjs` L31 비공개).
- 기존 테스트 `scripts/collect-data.test.mjs:436-437 / 453-454 / 470-471`(블록 `// ── 중복 키 해소 검증 (중첩 구조 전환 후) ──`) 이 `getLawdCd("인천","중구")→"28110"` 등을 고정 — **이 PR 이 갱신한다(삭제 금지)**.
- 개편 체크리스트(`admin-district-code-reform.md` §2) 11항목 중 **no-op 확인**: 1 `REGION_LAWD_PREFIX`(28 그대로) · 3 `_molit-api.mjs SIDO_CODE`(`28`) · 4·5 `population*.mjs SIDO_CODES`(`2800000000`) · 6 `REGION_CORTAR`(`2800000000`) · 7 `REGION_MAP`(시도 무변경) · 8 `migration.mjs C1_TO_REGION`(`NEW_SGG_TO_GU` 는 전남광주 전용) · 11 주소 첫 토큰 파서 4곳(`구$` 토큰 방식이라 "검단구" 통과). 다루는 것 = 2 `GU_LAWD_MAP` · 9 `bjd_code` · 10 `regions.childcare`(표 추종). 인천 신설 4구 인구 유실(−903,298)은 **PR-F1**(`spec-f1-population-aggregation.md`) 소관.

## 1. 결함과 처방

| # | 결함 | 처방 |
|---|---|---|
| E1 | `GU_LAWD_MAP["인천"]` 에 새 구 없음 + 동구 코드 오류 + 옛 gu 가 폴백으로 **타지역 코드**를 받음 | 새 4구 추가 · 동구 28140 정정 · 옛 3항목은 **삭제하지 않고 은퇴 키**로: `RETIRED_GU = { "인천": new Set(["중구","동구","서구"]) }` export, `getLawdCd` 가 `regionMap` hasOwnProperty 검사 **직후·전 지역 폴백 진입 전**에 `RETIRED_GU[region]?.has(gu)` 면 **null** 반환. 소비처(`collect-trades:284`·`schools-neis:562`·`collect-data:732`)는 null 을 이미 "코드 없음" 으로 다루는지 코더가 확인해 필요하면 skip 로그 추가 |
| E2 | `apartments.gu` 옛 이름 45곳 + bjd 옛 코드 → 지표 JOIN 실패·실거래/건축HUB/어린이집 0건 | **좌표 기반 재정합 도구** `scripts/remap-incheon-2026.mjs`(§2) |
| E3 | 화성 표기 3종(`화성특례시` 2 = GU_LAWD_MAP 에 없는 이름) | 별칭표에 `화성특례시` 추가 + 도구가 **화성 한정** 필터로 5곳 통일(§2-D) |
| E4 | reverse-geocode·naver-presale 이 gu 원문을 그대로 저장 → 표기 혼재 재발 통로 | 두 경로에 `normalizeGu` — **위치를 못 박는다**(§2-F) + 배선 가드 |
| E5 | 인천 거래 공백(서구·중구 06~08, 동구 전 기간, 새 구 전 기간) + gu 변경 직후 trade_stats null | gu 반영 **직후 같은 자리에서** `collect-trades --months=12 --only=인천:<새구>` 4 pair → 옛 gu 행 쌍둥이 삭제(§2-E) → trade-stats 재계산 |
| E6 | bjd 타시도 3곳 + null 2곳(P2) | 같은 도구 `--ids` 모드(§2-C) |

## 2. 도구 설계 — `scripts/remap-incheon-2026.mjs` (+ `.test.mjs`)

골격은 `remap-jeonnam-gwangju-codes.mjs`: **dry-run 기본**, `--apply`, `--out=<절대경로>`(계획 JSON, `before` 값 포함), 되읽기 검증, 잔여 시 exit 1. 모드는 배타적으로 하나씩: (기본) 인천 재정합 · `--hwaseong` · `--ids=` · `--trades-cleanup` · `--normalize-gu`(옵트인, §2-D-2).

### 2-A. 공유 헬퍼 신설 — `scripts/collectors/_kakao-region.mjs` (export)
```js
export async function fetchRegionDocs(lat, lng, kakaoKey, { retries = 3, sleepMs = 100 } = {})
  // coord2regioncode.json → documents[]. HTTP 실패·429 는 retries 만큼 재시도 후 throw(호출자가 skip 집계). 빈 documents 는 [] 반환.
export function pickRegionDocs(documents)   // { legal: B 문서|null, admin: H 문서|null }
```
기존 `reverse-geocode.mjs`·`fix-placeholder-addresses.mjs` 의 중복 구현은 **건드리지 않는다**(통합은 BACKLOG).

### 2-B. 대상 선정 `planIncheonTargets(apts)` (순수함수)
`apartments` `region='인천'` 전량(selectAll, `"id"` 커서) 중 `gu ∈ {중구,동구,서구}` **또는** `bjd_code` null **또는** `bjd_code` 앞5 ∈ {28110, 28140, 28260}. lat/lng null → `skipped.noCoord`. **기대 = 47곳 안팎**(옛 45 + null 2).

### 2-C. 판정 `buildIncheonUpdate(apt, { legal, admin })` (순수함수, 카카오 응답을 인자로)
- `legal` 없음 → skip `noLegal`.
- **지역 게이트**: `legal.region_1depth_name.startsWith("인천")` 이고 `legal.code.startsWith("28")`. 아니면 skip `outOfRegion`.
- `gu = normalizeGu("인천", admin?.region_2depth_name ?? legal.region_2depth_name)`; `GU_LAWD_MAP["인천"]` 키(은퇴 키 제외)에 없으면 skip `unknownGu`.
- `dong = admin?.region_3depth_name ?? legal.region_3depth_name`(행정동 표기 — `reverse-geocode.mjs` 와 같은 관례. 대상 중 `ap-*` 옛 이름 행의 dong 이 법정동→행정동으로 바뀐다, §6 에 기재).
- `bjd_code = legal.code`. gu·dong·bjd 전부 같으면 `unchanged`.
- **`--ids=<id,…>` 모드**(§0-2 개별 5곳 + ah-2026910065): 지역 게이트 = `resolveRegionName(legal.region_1depth_name, admin?.region_2depth_name ?? legal.region_2depth_name)` 가 `apt.region` 과 같아야 통과(전남광주는 gu 로 갈린다: 지석동→남구→광주, 신기동→여수시→전남; 인천/경기는 `REGION_MAP` 폴백). 갱신 = `bjd_code·dong` + **`gu = normalizeGu(apt.region, admin.region_2depth_name)` 이 현재 gu 와 다르면 gu 도**(ah-2026910065 `화성특례시`→`화성시` 가 이 경로로 함께 고쳐진다).

### 2-D. 경기 화성 표기 `--hwaseong` (`planHwaseongGu(apts)`, 카카오 불필요)
필터 = `region==='경기' && (gu==='화성특례시' || gu.startsWith('화성시 ') || HWASEONG_BARE_GU.has(gu))` → `gu = normalizeGu("경기", gu)`. **기대 5곳**(`화성특례시` 2 + `화성시 동탄구` 3). 이를 위해 `sigungu-aliases.json` 화성시 `forms` 에 `"화성특례시"` 추가.

### 2-D-2. (옵트인·실행은 별도 승인) `--normalize-gu`
전 지역 `normalizeGu(region, gu) !== gu` 인 행(실측 208, 경기 130) → 목록만 dry-run 으로 낸다. `--apply` 는 `--normalize-gu --i-reviewed-the-list` 동반 시에만. 이 PR 에서는 **코드만 넣고 실행하지 않는다**(§4-6).

### 2-E. trades 쌍둥이 정리 `--trades-cleanup` (백필 **뒤** 별도 실행)
- 옛 행: `region='인천' AND gu IN ('중구','동구','서구') AND deal_month BETWEEN '202509' AND '202608'`(**절대 월**; 기대 13,758). 새 행: `gu IN (제물포구,영종구,서해구,검단구)` 같은 창.
- 쌍둥이 키 = `dong|deal_month|area|price|floor|trade_type|apt_name`(null 은 `""` 로). 검토자 실측 202605: 서구 565/565 · 중구 107/107 = **1.0000**.
- `computeTwinRatio` 답습: 비율 ≥ 0.99 → 옛 행 id 청크 150 삭제, 미만 → fail-close(비쌍둥이 표본 20건 출력). **presale 이 `skipUnregistered` 로 안 받아지면** 494행이 비쌍둥이 → 0.964 → fail-close 가 정상 동작(그때는 sale·jeonse 만 대상으로 재실행하는 `--types=` 옵션을 둔다).
- 되돌리기: 삭제분은 twin=1.0 이 **삭제 시점에 확인된 경우에만** 새 행과 동일 — fail-close 가 이를 보장한다(§7).

### 2-F. 코드표·경로 변경
1. `_shared.mjs`: `GU_LAWD_MAP["인천"]` 에 `제물포구 "28125"·영종구 "28155"·서해구 "28275"·검단구 "28290"` 추가, `동구 "28120"→"28140"`(은퇴하더라도 값은 바로잡는다). `RETIRED_GU` export + `getLawdCd` null 분기(E1). 주석에 개편일·§0-1 출처.
2. `reverse-geocode.mjs`: **L151 `VALID_REGIONS` 통과 직후, `const updates = {` 앞**에 `gu = normalizeGu(region, gu) || null;` **재대입** 한 줄. L135 는 건드리지 않는다(그 시점 region 은 카카오 원문이라 무효, 그리고 L145 `normalizeRegion(region, gu)` 가 gu 를 인자로 받으므로 그 앞에서 바꾸면 지역 판정이 달라진다).
3. `naver-presale.mjs` `buildNewApartment(row, complexData, regionFallback)`: `const finalRegion = region ?? regionFallback;` → `region: finalRegion, gu: normalizeGu(finalRegion, gu) ?? null`(실제 변수명은 L632-652 에서 확인).
4. `sigungu-aliases.json` 화성시 `forms` 에 `"화성특례시"`.

## 3. 테스트

- `_shared.test.mjs`(또는 GU_LAWD_MAP 앵커 자리): 인천 키 집합 **리터럴** = `{중구, 동구, 서구, 미추홀구, 연수구, 남동구, 부평구, 계양구, 강화군, 옹진군, 제물포구, 영종구, 서해구, 검단구}`(은퇴 3 포함 14), 값 리터럴 4개(28125/28155/28275/28290) + 동구 `"28140"`, `getLawdCd("인천","중구") === null`·`("인천","동구") === null`·`("인천","서구") === null`(폴백이 서울·부산 코드를 주지 않는다), `getLawdCd("인천","검단구") === "28290"`, `getLawdCd("서울","중구") === "11140"`(은퇴는 인천에만).
- `scripts/collect-data.test.mjs:436-437 / 453-454 / 470-471` → `toBeNull()` 로 **갱신**(삭제 금지, 블록 제목 유지) + 같은 블록에 새 4구 단언.
- `normalizeGu("경기","화성특례시") === "화성시"`, `normalizeGu("인천","서해구") === "서해구"`.
- `remap-incheon-2026.test.mjs`: `planIncheonTargets` 4분기 · `buildIncheonUpdate` 게이트 5종(B 없음 / "경기도" / code 앞2≠28 / gu 표에 없음·은퇴 / unchanged) + 정상 1(영종 픽스처 = §0-1 카카오 응답) · `--ids` 게이트(전남광주 남구→광주 통과, 서울 좌표→skip, 화성특례시→화성시 gu 갱신) · `planHwaseongGu` 5→화성시 **그리고 권선구는 대상 아님** · twin 키 조립(null→"") · 창 경계(202509 포함·202508 제외) · 되읽기 count null 실패 · `--apply` 없이 쓰기 함수 미호출(배선 grep 줄머리 고정) · `--normalize-gu` 는 `--i-reviewed-the-list` 없이 apply 불가.
- 배선 가드: `reverse-geocode.mjs` 에 `^\s*gu = normalizeGu\(region, gu\)` 가 `VALID_REGIONS` 검사 **뒤**에 있다(두 문자열의 index 비교) · `naver-presale.mjs` `buildNewApartment` 안 `normalizeGu(finalRegion`.
- **뮤테이션(코더 직접, cp 원복, `git checkout` 금지) — "→" 는 red 가 나야 하는 테스트**:
  | # | 뮤테이션 | red 기대 |
  |---|---|---|
  | ① | 지역 게이트 제거 | buildIncheonUpdate 게이트 |
  | ② | 동구 28120 복원 | 앵커 |
  | ③ | 별칭 `화성특례시` 제거 | normalizeGu |
  | ④ | twin 임계 0.99 → **0.97(경쟁 후보값)** | twin 테스트(0.98 픽스처가 통과해 버리면 red) |
  | ⑤ | reverse-geocode normalizeGu 재대입 제거 / L135 로 옮김 | 배선 가드(두 형태 모두) |
  | ⑥ | `getLawdCd` 은퇴 분기 제거(폴백 복원) | `=== null` 3건 + collect-data 3건 |
  | ⑦ | 화성 필터를 `normalizeGu!==gu` 전체로 확대 | "권선구 대상 아님" |
  | ⑧ | 창 하한 202509 → 202601 | 창 경계 |

## 4. 실행 순서 (오케스트레이터) — 한 자리에서 이어서
1. 코더: 워크트리 `F:\mibunyang\.claude\worktrees\s546-f2`(브랜치 `fix/s546-incheon-2026-reform`). tsc 0 · vitest scripts/ 통과 · 감사 10종 0(단, 감사 10종 중 **어느 것도 이 변경을 검사하지 않는다** — 통과는 회귀 없음의 근거일 뿐).
2. 리뷰 → 커밋·PR(사장님 승인) → 머지.
3. **타이밍**: 코드표 머지 ~ `--apply` 사이 옛 gu 행이 남아도 E1(은퇴 키 → null)로 타지역 오염은 없다. 그래도 그 사이 발화하는 수집기 = 없음(`collect-trade-stats` = `0 16 7,21 * *` → 다음 **09-22 01:00 KST** · `daily-deploy` 03:00 · 네이버 파이프라인 월/목 08:00 · 어린이집 04:30 · 러너 05:30). 아래 4~7 을 **한 자리에서** 끝낸다.
4. 오케스트레이터 dry-run(`--out`): 인천 47곳 안팎(skip 사유별 개수·`outOfRegion` 0) · `--hwaseong` 5 · `--ids` 6. 승인 → `--apply` → 되읽기 0.
5. 백필 `collect-trades.mjs --months=12 --only=인천:제물포구,인천:영종구,인천:서해구,인천:검단구`(파서가 복수 pair 를 받는지 확인, 아니면 4회) — 로컬, 파일 리다이렉트, exit 0, **144회 호출**(`api_quota_log` 로 여유 확인).
6. `--trades-cleanup` dry-run → 쌍둥이 비율 ≥0.99 확인 → 승인 → 삭제 → 되읽기(옛 gu 창 안 행 0).
7. `collect-trade-stats.yml` dispatch(또는 로컬) → 인천 새 구 4개 `recent_trades_6m` 비null 확인.
8. 다음날 04:30 어린이집·05:30 러너 로그에서 인천 새 구 >0 확인.
9. `--normalize-gu`(경기 일반구 127행 등)는 **별도 승인** 후 같은 도구로.

## 5. 범위 밖 (문서에만)
- 새 구 4행의 `fertility_rate`·`doctors_per_1k`·`hospital_beds_per_1k`·`housing_price` — 원천(KOSIS·MOLIT CSV)이 새 이름을 줄 때 채워진다. 옛 중구 값을 제물포·영종에 복사하지 않는다(1:2 분할 = 거짓). 정직한 null("미수집").
- `getLawdCd` 전 지역 폴백 자체(다른 시도 동명 구 오염 잠재) → BACKLOG.
- 건축HUB 새 코드 응답 `useQty` 27~50배 → **10-15 회차 전 단위 확인 필수**(BACKLOG 🔴 승격).
- ah-2026910190(자리표시)·ah-2026910183(중복) 처리 결정 · `regions` 옛 인천 3행(남김) · 카카오 헬퍼 중복 3곳 통합 · `regions` `수원권선구`/`수원시 권선구` 이중 표기.

## 6. 검증 (실측)
- `apartments` 인천 gu 분포에 중구·동구·서구 0 · bjd 앞5 옛 코드 0 · null 0. dong 이 행정동 표기로 바뀐 행 수(예상 ≤47) 기록.
- `apartments_flat` 인천 옛 45곳 4지표 → null = 화면 "미수집"(확인됨, 정직). `화성시 동탄구` 3곳은 지표가 동탄구 행 → 화성시 행으로 바뀜.
- trades 인천 새 구 4개 × 202509~202608 >0, 옛 구 창 안 행 0. trade_stats 인천 새 구 `recent_trades_6m` 비null.
- 학교 47곳 유지(이미 새 코드) · 옛 45곳 `schools` 다음 회차 갱신.

## 7. 되돌리기
코드 revert. `apartments` 는 `--out` 덤프의 `before` 로 복원. trades 삭제분은 twin=1.0 확인 뒤에만 지워지므로 새 행이 같은 내용 — fail-close 가 그 전제를 보장한다.
