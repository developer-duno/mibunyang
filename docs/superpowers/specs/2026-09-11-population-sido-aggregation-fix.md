# PR-F1 — `population.mjs` 시도행·시군구행 집계 정정 (세션546, 2026-09-11) — **v2 (독립 검토 반영)**

> 한 줄: 행안부 인구 API 는 시도 합계를 `lv=1` 로 **직접 준다**. 우리는 `lv=2` 시군구 행을 손으로 더하다가
> 세 번째로 틀렸다(hasGuLevel → 111 시군 유실 → 이번 화성 이중계상·인천 신설구 유실). 시도행은 API 값을 쓰고,
> 시군구행은 "같은 키로 접힌 원문 중 시 단위 원문 우선" 으로 하나만 저장하고, 전년이 없어도 인구·세대는 저장한다.
>
> ⏰ **마감 2026-09-30.** 이 수집기는 실행일 기준 **2개월 전** 한 달만 손본다(L190-194, 재지정 인자 없음). 10-01 부터는 어떤 실행도
> 07-01 행을 건드리지 못하고 경기 -16.3%(정답 +0.4) · 인천 -0.2%(정답 +0.7) 가 DB 에 영구히 남는다. 지금 화면(`apartments_flat`)에
> 경기 983 + 인천 264 = **1,247 단지**가 그 거짓 증감률을 받고 있다.

## 검토 이력
- v2 → v3 (2026-09-11, 독립 리뷰 2건): 구현이 스펙과 다른 자리 1건(`buildSidoRows` 인자 — **구현이 옳다**) 명문화 + `rawParents` bare 구 구멍(M1) + 분할 합 검증 정확 일치(L2) + 배선 가드가 개수만 세던 자리(L4) + 부수 정정 명시(L1). 상세는 §2 머리말.
- v1 → v2 (2026-09-11 01:45, 독립 검토자 opus): 증거 §0 전부 재현(자릿수 일치). 설계 오류 3건(C1 parseGu 반환 변경이 기존 toEqual 9곳을 깨뜨림 · C2 배선 가드 L86-87 은 유지 불가 · C3 되돌리기/마감 오류) + 큰 빈틈 5건(작년 lv=1 은 17행 · dry-run 이미 있음 · households 누락 · 동작불변 대조표 · 뮤테이션 목록) + 사소 5건. 전부 아래 반영.

## 0. 실측 근거 (2026-09-11, raw 호출 — 스크래치패드 `probe-546-mois.mjs`·`probe-546-1.mjs`; 검토자가 재실행해 전부 일치)

### 0-1. API 원문 (`stdgPpltnHhStus/selectStdgPpltnHhStus`, `regSeCd=1`)

| 호출 | 결과 |
|---|---|
| `stdgCd=4100000000 srchFrYm=202607 lv=2` | **55행**, `totNmprCnt` 합 **20,927,874** — 화성시 999,673(hh 433,881) **+** 화성시 만세구 234,363 · 효행구 160,788 · 병점구 175,045 · 동탄구 429,477(4구 합 = 999,673). 수원·성남·고양·용인·안산·안양·부천도 시 합계행 + 구 행 **둘 다**. 202603 부터 계속 55행 |
| `stdgCd=4100000000 srchFrYm=202507 lv=2` | 51행 (화성시 981,815 단일, 구 없음) |
| `stdgCd=2800000000 srchFrYm=202607 lv=2` | 11행 합 3,063,730 — 제물포구 99,299(`2812500000`) · 영종구 138,091(`2815500000`) · 서해구 392,173(`2827500000`) · 검단구 273,735(`2829000000`) + 기존 7 |
| `stdgCd=2800000000 srchFrYm=202507 lv=2` | 10행 합 3,041,215 — 중구 173,592 · 동구 57,125 · 서구 645,541 + 기존 7 |
| `stdgCd=1200000000 lv=2` (202607·202507) | **27행, sggNm 에 공백 있는 행 0** — 광주 5구 합 1,384,801 + 전남 22시군 1,772,976 = 3,157,777 |
| `stdgCd=3611000000 lv=2` (세종) | 두 해 모두 **1행** |
| **`lv=1`** | **stdgCd 를 완전히 무시**하고(존재하지 않는 `9900000000` 을 줘도 같다) 시도 합계행을 한 번에 준다. **202607 이후 = 16행**(전남광주통합특별시 3,157,777 하나), **202606 이전 = 17행**(광주광역시 1,398,538 · 전라남도 1,782,183 따로 — 이 둘은 시군구 canonical 합과 **정확히 같다**). 응답 키는 lv=2 와 동일(`ctpvNm, sggNm(빈값), totNmprCnt, hhCnt, stdgCd, statsYm …`). 202607 값: 서울 9,284,263 · 부산 3,230,982 · 대구 2,347,389 · **인천 3,063,730(hh 1,416,363)** · 대전 1,442,190 · 울산 1,086,756 · 세종 390,972 · **경기 13,768,157(hh 6,181,804)** · 강원 1,507,224 · 충북 1,601,156 · 충남 2,138,955 · 전북 1,717,841 · 경북 2,494,470 · 경남 3,193,742 · 제주 662,680 |
| `lv=1` 자료 없는 달(202612) | **HTTP 200 + `resultCode:"10"` + rows 0** — `res.ok` 만 보면 못 잡는다 |

### 0-2. DB 현재값 (`regions`)

| 행 | 07-01 population / households / pop_growth | 06-01 | 05-01 | 04-01 |
|---|---|---|---|---|
| 경기 시도행 | **14,767,830 / 6,615,685 / -16.3** | 13,761,783 / 6,174,416 / 0.4 | 6,165,121 / … / -0.6 | 6,167,603 / … / -0.5 |
| 인천 시도행 | **2,160,432 / 1,009,096 / -0.2** | 3,061,002 / 1,414,018 / 0.7 | 3,058,623 / 0.7 | 3,057,226 / 0.8 |
| 경기·화성시 시군구행 | **429,477 / -56.3** (= 동탄구 값) | 998,746 | 997,713 | 996,582 |
| 인천 제물포·영종·서해·검단 시군구행 | population·households·pop_growth **전부 null** (행은 있음 — 다른 수집기가 만듦) | (옛 중구·동구·서구 행) | | |

- 검산: 경기 14,767,830 = lv1 13,768,157 **+ 화성 999,673** / hh 6,615,685 = 6,181,804 **+ 화성 hh 433,881**. 인천 2,160,432 = 3,063,730 **− 신설 4구 903,298** / hh 1,009,096 = 1,416,363 **− 407,267**. **households 도 population 과 똑같이 깨져 있다.**
- 04·05월 경기 617만 = 세션501(#348, 08-08) 이전의 `hasGuLevel` 결함. 06월 1,376만 = #348 정정 후·별칭표 접기(#384, 08-11) **이전**에 수집(08-05)돼 "화성시 동탄구"가 공백을 가진 채 들어와 부모 제외가 작동(lv1 202606 = 13,761,783 = DB 06-01 값). 07월(09-05 수집) = 접기 후 → 이중계상.
- 인천 07-01 시도행 2,160,432 = 7행 합. 신설 4구는 전년 키가 없어 `if (!curPop || !prevPop) continue` 로 **행째 버려짐**. D3 만 고치고 D4 를 안 고치면 인천 시도행 prev 가 키 일치 합 2,164,957 이 되어 **+41.5%** 가 나온다(검토자 검산).

### 0-3. 동작 불변 대조표 — 07-01 시도행 17개 vs lv=1 (검토자 전수 대조)

| | population | households |
|---|---|---|
| **오차 0 (13곳)** | 서울·부산·대구·대전·울산·세종·강원·충북·충남·전북·경북·경남·제주 | 같은 13곳 |
| **바뀌어야 하는 곳** | 경기 +999,673(+7.26%) · 인천 −903,298(−29.48%) | 경기 +433,881 · 인천 −407,267 |
| lv=1 에 없음(통합) | 광주 1,384,801 · 전남 1,772,976 — **이미 정답**, pop_growth −1.0 / −0.5 도 정답 → 무변경 |

→ 새 코드로 07-01 을 다시 돌리면 **13곳 + 광주·전남은 값이 1도 바뀌면 안 되고**, 경기·인천만 위 값으로 바뀐다. 이것이 코더의 드라이런 합격선이다.

### 0-4. 코드 (탐색 에이전트 보고 → 내가 줄 단위 재확인 → 검토자 재대조)

- `scripts/collectors/population.mjs`
  - L46-86 `fetchPopulation(year, month)`: `SIDO_CODES` 16개 × `lv=2` — 올해·작년 2회 = 32 호출(L203-207). `fetch` 직접(`fetchWithRetry` 미사용).
  - L140-153 `parseGu(ctpvNm, sggNm)` → `{ region, gu: normalizeGu(region, sggNm) ?? sggNm }` — **접힌 뒤 이름만** 반환, 원문 보존 없음.
  - L173-182 `pickParentCities(rows)`: `r.gu.indexOf(" ")` 로 부모 시 판정 — `rows` 는 이미 접힌 이름이라 "화성시 동탄구"→"화성시"(공백 없음)는 부모로 안 잡히고, 5행이 같은 키 `경기:화성시` 로 `regionAgg` 에 **5번 누적**(L249-262).
  - L187 `--dry-run` **이미 있음**(출력 L289-304 = 시도별 전체 + 상/하위 10 시군구 — 화성시·인천 신설구는 순위에 안 걸려 **안 찍힌다**). L303 `return` 이 L350 `recordApiQuota` 앞.
  - L190-194 대상 연월 = 실행일 −2개월 고정, 재지정 인자 **없음**.
  - L226-247 증감률 루프: `if (!curPop || !prevPop) continue;` 가 `rows.push` **앞** → 전년 키 없으면 population·households 까지 저장 안 됨.
  - L249-275 시도행: `prevPop += prevMap.get(key) || 0` — **키 일치분만** 더함(D4).
  - L286·L293 요약 줄: 평균 계산이 `pop_growth` null 을 분모에 세고 `null%` 를 찍을 수 있다(null 행이 생기면).
  - L311-346 저장: UPDATE(pop_growth·population·households) → 0행이면 INSERT. `pop_growth` 컬럼 nullable(`20260313024159_init_mibunyang.sql:176` REAL).
- `scripts/collectors/population-sex-age.mjs` L143-177 `pickCanonicalRows(items, recordedAt)` = **정답 패턴**(같은 키에 여러 원문 → 접히지 않은 시 단위 원문 우선 → 접힌 것만이면 첫 것 + 경고). `parseGu` 가 `folded: gu !== sggNm` 반환(L111-125). 테스트 6건.
- `scripts/collectors/population.test.mjs`: `parseGu(...).toEqual({...})` **9곳**(L121·126·131·136·137·196·200·221·222 — `folded` 추가 시 전부 손봐야 함). `pickParentCities` 호출 **8곳**(L30·46·59·68·74·78·86·237). 배선 가드 L83-90 은 **3단언**(L86 `const parentCities = pickParentCities(rows)` · L87 `parentCities.has(...) continue` · L89 `hasGuLevel` 부재).
- VIEW(`20260809000000_view_add_housing_price.sql`): `latest_regions`(L51, `gu IS NULL`) 가 `popGrowth`(L194) 를 노출. **시군구행 `pop_growth` 는 VIEW 에 노출되지 않는다**(`latest_regions_gu` L67-77 에 없음) — 화성시 -56.3 은 화면에 닿은 적 없음. 시도행이 화면의 전부.
- `.claude/rules/collectors/parsegu-normalization.md` L20·L75 는 아직 `hasGuLevel` 서술 — stale(⑦ 문서 단계에서 정정).

## 1. 결함 4개 (D1~D4) 와 처방

| # | 결함 | 처방 |
|---|---|---|
| D1 | 부모 시 제외를 **접힌 이름**으로 판정 → 화성 5행 이중계상(경기 +999,673 / hh +433,881) | 시도행 인구·세대는 **`lv=1` API 값**을 쓴다(§2-C). 시군구 합산은 **교차검증 로그·fallback** 으로만 — 그때는 부모 판정을 **원문 `sggNm`** 으로 |
| D2 | 같은 키(`경기:화성시`)로 접힌 5행이 순차 UPDATE 로 서로 덮어씀 → 화성시 = 동탄구 값 | `pickCanonicalRows` 와 같은 규칙으로 **키당 1행**(시 단위 원문 우선) — 올해·작년 둘 다, population·households 함께 |
| D3 | 전년 키 없으면 `continue` → 신설구 population·households 까지 미저장 | 전년 없으면 **population·households 저장 + pop_growth null** |
| D4 | 시도행 prev 가 키 일치 합 → 신설·개편 첫해에 거짓 증감률 | 시도행 prev 도 **`lv=1` 작년 값**(작년은 광주·전남이 따로 오므로 그대로 쓴다) |

## 2. 설계

> **v3 (2026-09-11, 독립 리뷰 2건 반영 — 구현이 스펙과 다른 자리 정정)**
>
> 1. **`buildSidoRows` 시그니처는 `{ sidoCur, sidoPrev, rawCur, rawPrev, recordedAt }`** 다.
>    아래 §2-C 가 적은 `{ sidoCur, sidoPrev, canonCur, canonPrev }` 는 **틀렸고, 구현이 옳다.**
>    이유: canonical 행은 화성 5행을 1행(시 합계)으로 **접은** 결과인데, 거기에 원문 부모 집합
>    (`rawParents` — "경기:화성시" 를 담는다)을 적용하면 그 1행이 통째로 제외돼 화성 999,673 이
>    시도 합에서 **사라진다**. 원문 행에 적용해야 "화성시" 합계행만 빠지고 4구가 남아 총합이
>    정확히 같다(실측: 경기 20,927,874 → 13,768,157). 즉 부모 제외는 **접기 전 이름**과 짝이라야
>    성립한다. 배선 가드(§3 T5)가 `rawCur: curItems`·`rawPrev: prevItems` 를 좌변 고정으로 잠근다.
> 2. **`rawParents` 는 부모 후보를 `원문 sggNm 앞 토큰 ∪ 정규화된 gu 앞 토큰`(둘 다 공백이 있을
>    때만)으로 모으고, 제외 판정은 원문 `sggNm` 으로만** 한다. 원문만 보면 행안부가 시 이름 없이
>    주는 **bare 구**("장안구" — 별칭표 `forms` 에 실재)에서 부모가 하나도 안 잡혀 시 합계행이
>    살아남고 그 시가 두 번 셈된다(재현: 수원 1,190,000 → 2,380,000). 공백 없는 gu 까지 더하면
>    반대로 구 없는 시·군이 자기 부모가 되어 사라지므로(세션501 사고) 공백 조건이 필수다.
>    현재 응답은 공백 든 형태라 주경로는 무사했고, 새는 곳은 **fallback/split 경로**였다.
> 3. **분할 합 검증은 정확 일치**(`SPLIT_SUM_MAX_DIFF = 1`명). 통합 시도행과 분할 합은 같은
>    응답 안의 같은 사람들을 두 방식으로 센 것이라 실측 차이가 0 이다. 시도별 교차검증
>    (lv=1 vs 시군구 합)은 서로 다른 집계 단위라 `CROSS_CHECK_TOLERANCE` 0.5% 를 유지한다.
> 4. **부수 정정(스펙 밖)**: `resolveRegion` 의 `REGION_MAP` 정확 매칭을 `in` 이 아니라
>    `Object.prototype.hasOwnProperty.call` 로 한다. `"constructor"`·`"toString"` 같은 프로토타입
>    키가 들어오면 함수 객체가 지역 약칭 자리에 실린다(세션545 적대검증이 `getLawdCd` 에서 잡은
>    것과 같은 꼴). 이 PR 의 결함 4개와는 무관한 방어이므로 되돌리지 않고 여기 남긴다.

### 2-A. `parseGu` 가 원문을 보존한다
```js
// 반환: { region, gu, folded }   folded = (gu !== sggNm)   — population-sex-age.mjs L111-125 와 같은 꼴
```
⚠️ `population.test.mjs` 의 `parseGu(...).toEqual({...})` **9곳**(L121·126·131·136·137·196·200·221·222)에 `folded: false|true` 를 함께 넣는다(자매 파일 `population-sex-age.test.mjs:30·69` 형식 답습). `toEqual` 은 완전일치라 안 고치면 9건 red.

### 2-B. `pickCanonicalPopulationRows(items)` (export, 순수함수)
입력 = API item 배열(lv=2). 출력 = `{ rows: [{region, gu, population, households, folded}], collapsed, foldedOnly }`.
규칙은 `population-sex-age.mjs pickCanonicalRows` 와 **동일**(같은 키 → 접히지 않은 원문 우선 → 둘 다 접힘이면 먼저 온 것 + `foldedOnly` 경고). `population = parseInt(totNmprCnt||totPpltn)`, `households = parseHouseholds(hhCnt)`. `population <= 0` 은 버린다. `recorded_at` 은 저장 단계에서 붙인다(작년 rows 엔 필요 없다).
올해·작년 **양쪽**에 적용하고, `prevMap` 은 작년 canonical rows 로 만든다.

### 2-C. 시도행 = `lv=1`
- `fetchSidoTotals(year, month)`: **1회 호출**(`stdgCd: SIDO_CODES[0]`, `lv: "1"`, 나머지 파라미터 동일). **실패 판정 = `!res.ok` 또는 `rows.length === 0`**(자료 없는 달은 200 + `resultCode "10"` + 0행). 응답 **16행 또는 17행**을 그대로 받는다.
- `buildSidoRows({ sidoCur, sidoPrev, canonCur, canonPrev })` (export, 순수함수) — 각 `sidoCur` 행에 `resolveRegion(ctpvNm)`:
  > ⚠️ **v3 정정**: 실제 시그니처는 `{ sidoCur, sidoPrev, rawCur, rawPrev, recordedAt }` (§2 v3-1 참조).
  > canonical 행에 원문 부모 집합을 적용하면 화성 999,673 이 통째로 빠진다.
  - 이름이 갈리면(15 또는 17개): `population = totNmprCnt`, `households = parseHouseholds(hhCnt)`. prev 는 `sidoPrev` 의 같은 region 행 → `pop_growth = round1((cur − prev)/prev × 100)`; prev 없거나 0 이면 null.
  - **못 가르는 행(통합 이름, 0개 또는 1개)**: 해당 연도 canonical 시군구 rows 중 `region ∈ {광주, 전남}`(= `resolveRegionName` 이 gu 로 가른 결과)의 population·households 합으로 광주행·전남행을 만든다. prev 도 같은 규칙(작년 `sidoPrev` 에 광주·전남이 따로 있으면 **그 값을 쓰고**, 없으면 작년 canonical 합). 검증: 두 합 = 그 통합 행 값(3,157,777) 이어야 하며, 다르면 `logError` 후 저장은 한다(fail-open).
  - 부모 시 제외는 통합 시도에 필요 없다(0-1: 공백 sggNm 0행). `rawSggNm.includes(" ")` 행이 있으면 경고만.
- **fallback**(올해 또는 작년 lv=1 실패): 그 연도 시도 합을 canonical rows 로 만들되 부모 제외를 **원문 sggNm 공백** 기준(`rawParents(items)`: 공백 있는 sggNm 의 앞 토큰 집합에 든 sggNm 행 제외)으로 하고 `log("fallback", …)` 한 줄. fallback 경로도 테스트로 잠근다.
- **교차검증(항상)**: 시도별 `Σ canonical(원문 부모 제외)` vs lv=1 값 — 0.5% 초과 차이면 `logError("check", …)`. `collector_runs` 상태는 안 바꾼다.
- `apiCalls += 2`(dry-run 은 L303 에서 return 하므로 무관).
- 시도행 `pop_growth` 가 null 이 되는 경로는 "작년 lv=1 실패 + fallback 도 실패" 뿐 — 그때 VIEW 가 지난달 값을 이번 달인 양 보여주는 lag(세션391 역방향)가 열린다 → 그 경우 `logError` 로 시끄럽게.

### 2-D. 전년 없음 = 저장한다 (D3)
증감률 루프: `prevPop` 없으면 `pop_growth: null` 로 push. `curPop` 없음(0/NaN)만 skip. 요약 줄(L286·L293)은 `pop_growth != null` 인 행만 평균 분모에 넣고 `전년없음 K건` 을 따로 찍는다.

### 2-E. 저장 루프 변경 없음
UPDATE→INSERT 패턴 그대로. `pop_growth: null` UPDATE 허용(신설구 첫해 정답. 화성시 -56.3 → 정상값으로 덮임).

### 2-F. dry-run 출력 보강 + `--focus`
`--dry-run` 은 **이미 있다**(L187). 출력에 ① 시도행 17개 `region | population | households | pop_growth` 표 ② `--focus=경기:화성시,인천:제물포구,인천:영종구,인천:서해구,인천:검단구` 로 지정한 시군구행 ③ `전년없음 K건` 목록 ④ canonical 접힘 N(경고 M) ⑤ 교차검증 결과 를 추가한다.

### 2-G. (선택, 작음) `--target=YYYYMM`
대상 연월 재지정 인자. 없으면 지금처럼 −2개월. 마감(09-30) 뒤에도 07-01 을 고칠 수 있게 하는 안전망 — 구현이 5줄을 넘지 않으면 넣고, 테스트는 파서 1건.

## 3. 테스트 (`population.test.mjs` — 픽스처는 §0-1 실측 숫자 그대로)

번호는 아래 뮤테이션 표가 참조한다.
- **T1** `pickCanonicalPopulationRows`: 화성 5행(시 999,673/hh 433,881 + 4구) → `경기|화성시` 1행 population 999,673 **households 433,881**, `collapsed 4`, `foldedOnly []`. 순서 반대도 동일.
- **T2** 접힌 원문만 둘 → 먼저 온 것 + `foldedOnly` 에 키.
- **T3** 인천 픽스처: 작년 10행(중구·동구·서구) / 올해 11행(신설 4구) → 신설 4구 rows 가 **population·households 있음·pop_growth null**, 나머지 7행은 숫자. 요약 카운트 `전년없음 4`.
- **T4** `buildSidoRows`: (a) 인천 cur 3,063,730/hh 1,416,363, prev 3,041,215 → `pop_growth 0.7`, households 1,416,363 (b) 경기 cur 13,768,157 — canonical 55행 원문 부모 제외 합과 0.5% 이내(교차검증 통과, 경고 0) (c) **올해** 픽스처에 "전남광주통합특별시" 3,157,777 → 광주행·전남행, 합 3,157,777 (d) **작년** 픽스처는 17행(광주·전남 따로) → 그 값이 prev 로 그대로 쓰임 (e) sidoCur 가 `[]`(lv=1 실패) → fallback 이 원문 부모 제외로 경기 13,768,157 을 낸다(화성 999,673 이 한 번만).
- **T5** 배선 가드(소스 grep, 줄머리·좌변 고정, 주석 스트리퍼는 `_selectall-keycol-coverage.test.mjs` 의 `stripComments` 를 import): `main` 이 `fetchSidoTotals(` 를 두 번 부르고, `pickCanonicalPopulationRows(` 를 두 번 부르며, `buildSidoRows(` 를 부르고, `^\s*if \(!curPop \|\| !prevPop\) continue;` 가 없다.
- **T6** 기존 배선 가드 L83-90 **다시 쓴다**: L86·L87(`pickParentCities(rows)`·`parentCities.has(...) continue`) 은 시도행이 lv=1 로 옮겨지면 red 이므로 → `rawParents(` 가 fallback/교차검증 경로에서 호출된다는 단언으로 교체. L89(`hasGuLevel` 부재)는 유지.
- **T7** `pickParentCities` 호출 8곳(L30·46·59·68·74·78·86·237): 함수는 `rawParents(items)`(원문 sggNm 입력)로 바꾸고 픽스처를 원문으로. L237(전남광주 describe)도 포함.
- **T8** dry-run 요약: `pop_growth` null 행이 평균 분모에 안 들어감(순수함수로 뽑아 단언).
- **T9** (2-G 채택 시) `--target=202607` 파서.

**뮤테이션(코더가 직접, `cp` 사본 원복 — `git checkout` 금지) — "→" 뒤는 red 가 나야 하는 테스트 번호**:
| # | 뮤테이션 | red 기대 |
|---|---|---|
| ① | canonical 우선순위 뒤집기(접힌 것 우선) | T1 |
| ② | `pop_growth: null` push 를 옛 `continue` 로 복원 | T3, T5 |
| ③ | 시도행 prev 를 키 일치 합으로 복원 | T4(a) (인천 +41.5%) |
| ④ | `fetchSidoTotals` 호출 한쪽 제거 | **T5 만**(순수함수 테스트는 안 흔들린다 — 1건이면 정상) |
| ⑤ | fallback 부모 제외를 접힌 이름으로 | T4(e) |
| ⑥ | 시도행 households 를 시군구 합으로 복원 | T4(a) households |
| ⑦ | 통합 행 분할에서 전남을 광주로(둘 다 광주에 합산) | T4(c) |
| ⑧ | **경쟁 후보값**: 작년 광주·전남을 lv=1 이 아니라 canonical 합으로 강제(값이 같아 초록일 수 있다 — 초록이면 "이 자리는 무방비"로 보고서에 적는다) | T4(d) 또는 무방비 기록 |

## 4. 실행·검증 (코더 → 오케스트레이터)

1. 구현은 **워크트리 `F:\mibunyang\.claude\worktrees\s546-f1`**(브랜치 `fix/s546-population-aggregation`, node_modules 설치 완료). `F:\mibunyang` 작업 트리는 로컬 스케줄러의 운영 코드 — 건드리지 않는다. 원본 node_modules 에 링크·삭제 금지.
2. `npm run typecheck:scripts` 0 · `npx vitest run scripts/collectors/population.test.mjs scripts/collectors/population-sex-age.test.mjs` 통과 · 전체 `npx vitest run scripts/` 통과 · 감사 10종 0 (`for a in $(grep -oE 'scripts/audit-[a-z-]+\.mjs' .github/workflows/ci.yml | sort -u); do …; done`). `scripts/` 에 prettier --write 금지.
3. **드라이런 실측**(워크트리에서, 파일 리다이렉트, 파이프 금지): `node scripts/collectors/population.mjs --dry-run --focus=경기:화성시,인천:제물포구,인천:영종구,인천:서해구,인천:검단구 > <절대경로>.log 2>&1` → 합격선 = §0-3 표: 13곳 + 광주·전남 무변경(1도 안 바뀜), 경기 13,768,157/6,181,804, 인천 3,063,730/1,416,363, 화성시 999,673/433,881, 인천 신설 4구 population 있음·pop_growth null, 교차검증 경고 0줄, 전년없음 4건.
4. 실제 반영은 **오케스트레이터가** 머지 후 main 작업 트리에서 1회 실행(로컬 한국 IP — `collect-population.yml` GH cron 은 행안부 차단 복불복이라 로컬이 확실). **09-30 이전.** 반영 뒤 `regions` 07-01 시도행 17개 population·households 를 lv=1 값과 대조(0-3 표).

## 5. 범위 밖 (건드리지 않는다 — 어디서 다루는지)
- `population-sex-age.mjs`(정답 패턴, 시도행 없음) · VIEW · 다른 수집기 · `sigungu-aliases.json`.
- `apartments` 의 `화성시 동탄구` 3곳·`화성특례시` 2곳(`latest_regions_gu` 조인 실패) → **PR-F2**.
- 인천 개편(`apartments.gu`·`GU_LAWD_MAP`) → PR-F2. 행안부 GH 러너 차단 재시도 → PR-F3.
- `parsegu-normalization.md` stale(`hasGuLevel`) → 이 PR 의 문서 커밋에서 한 줄 정정(⑦).

## 6. 되돌리기
코드는 PR revert. **데이터는 되돌릴 수 없다**(대상 월이 실행일 −2개월 고정; §2-G 를 넣으면 `--target` 으로 재실행 가능). 옛 값이 거짓이었으므로 되돌릴 이유도 없다. VIEW 는 컬럼별 최신 non-null 이라 08-01 행이 생기면(10-05 회차) 화면은 자연 치유되지만 DB 07-01 이력은 남는다 — 그래서 마감이 09-30 이다.
