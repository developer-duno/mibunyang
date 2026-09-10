# PR-E — 전남광주통합특별시 코드 전환(46·29 → 12) · 지역 이름 분할 · 오라벨 정정 (세션545 P1)

> 배경: 2026-07-01 전남광주통합특별시 출범으로 행안부 법정동코드 시도 접두가 **`12`** 로 바뀌었다(광주 `29`·전남 `46` 폐지).
> 세션545 raw 실측(2026-09-10, 전부 양성·음성 대조군 포함)으로 **외부 API 6종이 새 코드만 받아들이는데 우리 정적 코드표가 옛 코드**라
> 전남·광주 수집이 6~7월부터 끊겨 있음을 확정했다. 근거·수치는 `~/.claude/projects/F--mibunyang/memory/session_2026-09-10_session545_jeonnam_gwangju_code_switch.md`.
> **사장님 결정(2026-09-10)**: ① 사이트 지역은 17개 유지 — 통합시를 **구·시·군 이름으로 광주/전남에 갈라 붙인다** ② 이 PR 을 PR-D 보다 먼저.

## 0. 무엇이 끊겼나 (실측 요약 — 코드를 고치는 이유)

| 층 | 우리 코드표 | 옛 코드 | 새 코드 | 현 피해 |
|---|---|---|---|---|
| 실거래가 `RTMSDataSvcAptTrade` LAWD_CD | `GU_LAWD_MAP` | 46150·29110 = **0건(3월 자료까지 소급)** | 12150 = 217건(8월) | `trades` 전남 202606~ **0건**, 광주 5구 0건 |
| 건축HUB `BldEngyHubService` sigunguCd | `apartments.bjd_code` 앞 5자리 | 202604~ 0건 | 202604·05 정상(같은 건물) | 10-15 회차부터 0건 |
| 시도 아파트 목록 `getSidoAptList4` sidoCode | `_molit-api.mjs SIDO_CODE` | "46"·"29" = 0 | **"12" = 1,758건** | maintenance·molit-units·molit-building-info 전남·광주 skip |
| 행안부 인구 `stdgPpltnHhStus` stdgCd | `population*.mjs SIDO_CODES` | 202607~ `NODATA_ERROR` | 1200000000 = 27 시군구, ctpvNm **"전남광주통합특별시"** | `regions` 전남·광주 07-01 행 0 |
| 네이버 분양 `preSaleScheduleList` bubdong_code | `naver-presale.mjs REGION_CORTAR` | 0 | **1200000000 = 46건** | 7월 이후 전남·광주 분양 0건 |
| 어린이집 `cpmsapi021` arcode | `GU_LAWD_MAP` 순회 | 46150 = INFO-200 | 12150 = 156곳 | childcare 전남·광주 0 |
| 학교알리미 sggCode | `bjd_code` 앞 5자리 | 정상(08-23) | 정상(09-10) | 무사(둘 다 수용) |
| KOSIS HUG(market-stats)·KOSIS 순이동(migration) | REGION_MAP 라벨 / C1 코드 | 아직 "광주"·"전남" 분리 | — | 무사 — 단 §1-8 방어 |

⚠️ **`reverse-geocode --force` 금지는 유지**하되 이유가 바뀐다: "12 코드가 손상" 이 아니라 **좌표 있는 전 단지의 region/gu/dong/address/road_address/bjd/lot 를 카카오 값으로 덮어써** 209곳 정정의 `address`(정답 출처 표기)와 `district` 결정을 지운다. PR-D 스펙 H1 문구는 §4 로 고친다.

## 1. 변경 (파일별) — 코드

### 1-1. `scripts/collectors/_shared.mjs` — 코드표 + 분할 헬퍼
- `REGION_LAWD_PREFIX`: `"광주": "12"`, `"전남": "12"` (주석: 2026-07-01 통합. 두 지역이 같은 접두를 쓰므로 **접두→지역 역변환은 모호** — `migration.mjs C1_TO_REGION` 참조).
- `GU_LAWD_MAP["광주"]`: 동구 12210 · 서구 12240 · 남구 12270 · 북구 12300 · 광산구 12330.
- `GU_LAWD_MAP["전남"]`: 목포시 12110 · 여수시 12130 · 순천시 12150 · 나주시 12170 · 광양시 12190 · 담양군 12710 · 곡성군 12720 · 구례군 12730 · 고흥군 12740 · 보성군 12750 · 화순군 12760 · 장흥군 12770 · 강진군 12780 · 해남군 12790 · 영암군 12800 · 무안군 12810 · 함평군 12820 · 영광군 12830 · 장성군 12840 · 완도군 12850 · 진도군 12860 · 신안군 12870.
  주석에 "카카오 coord2regioncode + 실거래가 API 202608/202604 교차검증 2026-09-10" 박제.
- **신규 export** `JEONNAM_GWANGJU_SGG_OLD_TO_NEW`: 옛 5자리 → 새 5자리 27항목(위 표의 역순: `"29110":"12210", … "46910":"12870"`). 데이터 재매핑 스크립트와 정합 테스트가 쓴다.
- **신규 export** `GWANGJU_GU_NAMES = new Set(["동구","서구","남구","북구","광산구"])`.
- **신규 export** `resolveRegionName(sidoFull, gu = null)`:
  1. `REGION_MAP[sidoFull]` 있으면 그것.
  2. `/^전남광주통합/.test(sidoFull)` 이면 — `gu` 의 **첫 공백 토큰**이 `GWANGJU_GU_NAMES` 에 있으면 `"광주"`, 그 밖의 비어있지 않은 gu 면 `"전남"`, gu 가 비면 `null`(시도 단위는 못 가른다 — 호출자가 처리).
  3. 그 외 `null`.
  ⚠️ `REGION_MAP` 에 `"전남광주통합특별시"` 를 **넣지 않는다**(단일값 표라 어느 한쪽으로 오라벨된다). 주석으로 이유를 남긴다.

### 1-2. `scripts/collectors/_molit-api.mjs` — `SIDO_CODE` 광주 "12" · 전남 "12" (키 17개 유지 — `_molit-api.test.mjs:53` 이 17 을 단언). 소비처(maintenance:217·molit-building-info:190·molit-units)는 광주·전남 두 region 그룹이 같은 1,758건 목록을 각각 받게 되지만 이름+gu(`address` 필드) 매칭이라 정합 영향 0. 목록 API 중복 호출은 수집기당 약 4회(500행 페이지) — 캐시 등 추가 코드 **없이 둔다**(단순화 우선). 주석 1줄로 "광주·전남 = 같은 시도코드 12" 만 남긴다.

### 1-3. `scripts/collectors/population.mjs` · `population-sex-age.mjs`
- `SIDO_CODES`: `"2900000000"`,`"4600000000"` 제거 → `"1200000000"` 추가(17→**16**). 주석 "17 시도 × 2" 류 문구를 실제 길이로.
- `resolveRegion(fullName)`: 부분 매칭 앞에 **가드** `if (/통합특별시/.test(fullName)) return null;` — 없으면 `"전남광주통합특별시".includes("광주")` 가 27 시군구 전부를 광주로 붙인다(실측 함정).
- `parseGu(ctpvNm, sggNm)`: `const region = resolveRegionName(ctpvNm, sggNm) ?? resolveRegion(ctpvNm);` 로 분할 헬퍼를 먼저. 나머지 동일.
- 시도 집계(pickParentCities·rows 합산)는 region 키로 돌므로 광주(5구 합)·전남(22 시군 합) 시도행이 자연히 갈린다 — **테스트로 고정**(§2).

### 1-4. `scripts/collectors/reverse-geocode.mjs` — `normalizeRegion(name, gu = null)`: `map[name] ?? resolveRegionName(name, gu) ?? name`. 호출부 L142 `region = normalizeRegion(region, gu);`. (map 은 그대로 두거나 `REGION_MAP` 으로 교체 — 교체 시 기존 테스트 4건 유지 확인.)

### 1-5. `scripts/collectors/naver-presale.mjs`
- `REGION_CORTAR`: 광주·전남 → `"1200000000"`.
- Phase 1(L816~): `regions` 를 돌며 `fetchPresaleList(region)` 하던 것을 **cortarNo 로 dedupe** — 같은 코드는 한 번만 부르고, `_region` 은 `resolveRegionName` 로 못 가르는 자리의 폴백이므로 통합 코드에는 `null` 을 넣는다(`buildNewApartment` 의 `region ?? regionFallback` 이 그대로 동작; 주소가 있으면 아래 파서가 가른다).
- `parsePresaleAddress(address)` 지역 판정 **재작성**: `region = resolveRegionName(parts[0], parts[1]) ?? (strip → VALID_REGIONS)`. 현재의 `address.includes(full)` 순회를 **제거** — `REGION_MAP` 키에 약칭이 있어 `"경기도 광주시 양벌동".includes("광주")` 가 참이 되는 게 경기 광주시 5곳 오라벨의 원인. gu/dong 추출은 그대로.

### 1-6. `scripts/collectors/collect-applyhome-seed.mjs parseAddress` · `scripts/collect-data.mjs parseAddress`: `REGION_MAP[regionFull] ?? …` 앞에 `resolveRegionName(regionFull, parts[1]) ??` 한 조각. (seed 는 09-14 월요일 실모드 첫 회차 — 청약홈이 시도명을 새 이름으로 바꾸는 순간 AREA_CODE 폴백 없이도 맞게 붙는다.)

### 1-7. `scripts/collectors/migration.mjs C1_TO_REGION`: 역변환 뒤에 **명시 항목** `map["29"]="광주"; map["46"]="전남";`(KOSIS 순이동은 09-06 에도 옛 코드로 정상 275건 — 방어) + `map["12"]` 는 **삭제**(모호). `mapC1` 5자리 분기: `prefix === "12"` 면 `JEONNAM_GWANGJU_SGG_OLD_TO_NEW` 의 값 집합에서 새 코드 → gu 이름을 `GU_LAWD_MAP` 역참조로 얻어 `resolveRegionName("전남광주통합특별시", gu)` 로 가른다(2자리 `"12"` 단독은 `null` — 시도 단위 통합값은 못 가른다, 로그 1줄).

### 1-8. 손대지 않는 것 (범위 밖 — BACKLOG 등재)
`schools-neis.mjs:560`(bjd 재매핑으로 자연 해소) · KOSIS 라벨 소비 7곳(아직 분리 라벨) · `housing-permits.mjs`(08-10 17건 정상) · `src/constants/regionGeoMapping.ts`(통계청 코드 체계, 별개) · `childcare-info-jeju.mjs`(독립 코드).

## 2. 변경 — 데이터 재매핑 스크립트 (신규 `scripts/remap-jeonnam-gwangju-codes.mjs`, dry-run 기본 · `--apply`)

순수 함수 export(테스트 대상) + main. 전부 **읽고→계획→dry-run 표 출력→`--apply` 시에만 쓰기**. `selectAll(…, sb, "id")` 커서 필수(가드가 잡는다).

| # | 대상 | 조건 | 쓰기 | 예상 |
|---|---|---|---|---|
| a | `apartments.bjd_code` | region ∈ {전남,광주,전남광주통합특별시} ∧ 앞5 ∈ OLD_TO_NEW | `new5 + old.slice(5)` | 93곳(46:38·29:55). 앞5가 표에 없는 3곳(ah-2026910076·086·134 = 충남·경남 코드)은 **건드리지 않고 "수동 refit 대상" 으로 출력** |
| b | `apartments.region` | region === "전남광주통합특별시" | `resolveRegionName(region, gu)` (광양시·여수시·무안군 → 전남) | 6곳. null 이면 skip+출력 |
| c | `apartments.region` | region==="광주" ∧ gu==="광주시" ∧ address 가 "경기도" 로 시작 | `"경기"` | 5곳(ap-6025476·6025775·6027999·6028000·6028323) |
| d | `trades` | region==="광주" ∧ gu==="광주시" | **DELETE** — 고유키 `(region,gu,deal_month,area,price,floor,trade_type)` 에 region 이 들어 있어 경기로 relabel 하면 기존 경기 행과 충돌. 같은 LAWD 41610 을 같은 회차에 긁은 중복이다 | 4,242행. **fail-close**: 삭제 전 각 행의 `(경기,광주시,deal_month,area,price,floor,trade_type)` 쌍둥이 존재율을 세어 **99% 미만이면 중단**하고 표만 출력 |
| e | `apartments.gu` | id ∈ {ah-2026910189, ah-2026910190} (gu "첨단3지구…", 카카오 = 북구 월출동) | region "광주"·gu "북구" | 2곳 — id 명시(추측 금지) |

(`regions.childcare.facilities[]` 는 실측상 `arcode` 를 담지 않는다 — 키 = crname·stcode·craddr·crtel·crfax·crhome·crcapat. `childcare-detail.mjs:288` 은 `GU_LAWD_MAP` 역참조로 arcode 를 만들므로 코드표 갱신만으로 새 코드가 간다. stcode 는 옛 접두(46150000042)여도 새 arcode 와 함께 정상 응답 — 2026-09-10 실측.)

- 중복 `ah-2026910183`(순천금호어울림더파크2차 09-07 seed, ah-2026930022 와 좌표 동일) 은 **보고만** — 삭제는 별도 승인.
- 출력 = 항목별 곳수·id 목록·전/후 값. `--apply` 는 항목별 결과 수 재조회로 검증(쓴 뒤 다시 읽어 기대 수와 일치).
- ⚠️ `/tmp` 금지 · 파이프 금지 · 결과 파일은 `--out=<절대경로>`.

## 3. 검증 (코더 의무 → 오케스트레이터 재검)
- vitest 갱신: `_shared.test.mjs:384`·`collect-data.test.mjs:476` "광주 북구 → 29170" → **12300**. 신규: OLD_TO_NEW 27건 ↔ `GU_LAWD_MAP` 값 정합(양방향) · `resolveRegionName` 6케이스(직접 매핑/광주 구/전남 시/전남 군/gu null→null/미지→null) · population `parseGu("전남광주통합특별시","순천시")→전남`, `("전남광주통합특별시","동구")→광주`, `resolveRegion("전남광주통합특별시")→null` · population-sex-age 동일 2건 · reverse-geocode `normalizeRegion("전남광주통합특별시","순천시")→전남`, gu 없으면 원문 · naver-presale `parsePresaleAddress("경기도 광주시 양벌동")→경기`(회귀), `("전남광주통합특별시 순천시 서면 선평리")→전남`, `("전남광주통합특별시 북구 월출동")→광주` · seed `parseAddress("전남광주통합특별시 순천시 서면")→{전남,순천시,서면}` · `SIDO_CODE` 광주·전남 "12" + 17키 · `REGION_CORTAR` 광주·전남 동일 + Phase1 dedupe 헬퍼 · migration `mapC1("46150","순천시")→전남`, `mapC1("12210","동구")→광주`, `mapC1("12",…)→null` · 재매핑 순수 함수(a·b·c·d 판정, 쌍둥이 비율 fail-close).
- **뮤테이션(코더 ≥3 · 오케스트레이터 ≥3, `cp` 사본 원복 · `cmp` · `git checkout` 금지 · 리뷰어 스폰 전)**: ① 인구 `resolveRegion` 가드 제거 → 27건 광주 오라벨 red ② `parsePresaleAddress` 의 `address.includes` 순회 복원 → 경기 광주시 red ③ `C1_TO_REGION` 의 29/46 방어 삭제 → red ④ OLD_TO_NEW 한 항목 오타 → 정합 red ⑤ 쌍둥이 비율 임계 제거 → red.
- `npm run typecheck:scripts` 0 · `npx vitest run scripts/` (naver-presale tryPythonJwt 2건 5초 flake 는 단독 재실행) · CI 감사 10종.
- 라이브(읽기 전용, 코더 아님 오케스트레이터): 재매핑 dry-run 표 = a 93 · b 6 · c 5 · d 4,242(쌍둥이 ≥99%) · e 2. `collect-trades.mjs --dry-run --only=전남:순천시` 가 12150 으로 202608 > 0.
- ⚠️ `scripts/` 에 `prettier --write` 금지 · `node <수집기> | tail` 금지.

## 4. 문서 (같은 PR)
- `docs/superpowers/specs/2026-09-10-selectall-guard-hardening-and-force-geocode.md` §0 H1·§1-4: "12 코드 손상" → "전량 덮어쓰기(address/district 결정 소실)" 로 근거 교체. `--only-null-bjd` 안은 유지.
- `.claude/BACKLOG.md` L650~654 🔴 H1 항목 문구 교체 + 신규: (i) KOSIS 7 소비처 라벨 전환 감시(`통합특별시` 라벨 등장 시 시도행 양쪽 배분 필요) (ii) 건축HUB 새 코드 응답 useQty 50배(5,583→282,842) 집계단위 확인 후 10-15 회차 (iii) 중복 ah-2026910183 처리 (iv) 버스정류장 파일 타임아웃 간헐(20s→검토) (v) monitor: "region×deal_month 거래 0건 인데 API >0" 가드.
- 신규 룰 `.claude/rules/collectors/admin-district-code-reform.md`: 행정구역 개편(강원 42→51 · 전북 45→52 · 전남광주 46/29→12, 세 번째) 시 **동시 갱신 체크리스트** = `REGION_LAWD_PREFIX`·`GU_LAWD_MAP`·`SIDO_CODE`·`SIDO_CODES`×2·`REGION_CORTAR`·`REGION_MAP`/분할 헬퍼·`C1_TO_REGION`·`apartments.bjd_code` 재매핑·`regions.childcare` arcode + "각 외부 API 는 전환 시점이 다르다 — 표를 바꾸기 전 소비처 API 마다 raw 1회(옛/새 대조)" + 이번 실측표.

## 5. 후속 (머지 뒤, 별도 승인)
1. 거래 백필(로컬): `node scripts/collectors/collect-trades.mjs --months=4 --only=<region>:<gu>` × 전남 7 시군(여수·순천·나주·광양·무안·장성·해남) + 광주 5구 → `collect-trade-stats.yml` dispatch. 2. `collect-population.yml` dispatch(07월 행). 3. `fix-placeholder-addresses.mjs --refit-fields --ids-file` 로 ah-2026910076·086·134 bjd 재정합. 4. 네이버 분양·관리비·어린이집은 다음 정기 회차가 자동 흡수(첫 회차 로그 확인).

## 6. 금지
`--force` 실행 금지 · `REGION_MAP` 에 통합 이름 추가 금지 · `VALID_REGIONS` 변경 금지 · 17개 지역 UI 변경 금지 · 중복 행 삭제 금지(보고만) · `git checkout` 원복 금지.

## 7. 2라운드 반영 — 독립 리뷰어 8건(전부 코드로 확인) + FIX 9 (2026-09-10)

위 §1·§2 의 1라운드 설계 중 **다음이 바뀌었다**(본문은 이력 보존을 위해 그대로 두고 여기서 덮어쓴다):

| # | 자리 | 1라운드 | 2라운드(현행) |
|---|---|---|---|
| 1 | `collect-applyhome-detail.mjs addrToRegion` | 스펙 범위 밖(내가 grep 에서 놓친 **네 번째 주소 파서** — `head.startsWith("전남")` 로 광주 5구까지 전남) | `resolveRegionName(head, parts[1])` 을 긴 키 우선 순회 **앞**에 |
| 2 | `_shared.mjs resolveRegionName` | 광주 5구 아니면 **전남** | 광주 5구 → 광주 / `GU_LAWD_MAP["전남"]` 키 22개 → 전남 / **그 외 null**(지구·블록 토큰은 조용히 붙이지 않는다 → seed 는 AREA_CODE 폴백, 인구·이동은 행 버림, remap 은 skipped) |
| 3 | `naver-presale.mjs main()` | 공유 코드 `_region` null + 주소 불가 → `region:null` INSERT → `apartments.region NOT NULL` 로 **500건 묶음 통째 실패** | `newApt.region == null` 이면 `insertRows` 에 안 넣고 `regionUnresolved` 카운트·로그·요약 |
| 4 | `buildCortarQueries` | 요청 목록 안에서만 공유 판정(`--region=광주` 면 전남 단지까지 광주 폴백) | **표 전체**(`useCount`)로 공유 판정 + `--region` 필터는 주소로 가른 지역과 대조해 `regionFiltered` skip |
| 5 | remap §2(d) | 비율 ≥99% 통과 시 `.eq(region).eq(gu)` **전부 삭제** | 쌍둥이(`twinIds`)만 id 150 청크 삭제 · 쌍둥이 없는 행(`nonTwinIds`)은 `region:"경기"` relabel(고유키 충돌 없음) · 되읽기 잔여 0 |
| 6 | `_shared.test.mjs` | 집합 동치만(두 코드를 맞바꿔도 green) | 실측 앵커 리터럴 6쌍(`46150→12150`·`29170→12300`·`46230→12190`·`46820→12790`·`46910→12870`·`29110→12210`) |
| 7 | `migration.mjs mapC1` | 자유문 `name` 우선 | 코드 역참조 `derivedGu` 우선, 이름 비면 derivedGu 반환 |
| 8 | remap 되읽기 | (e) 미검증 · `leftD ?? 0` | (e) 광주/북구 검증 · null count = 실패 |
| **9** | `naver-presale.mjs` Phase 0.5 | `.range(0, 9999)` 단발 → PostgREST max-rows **1,000행 컷**(2026-09-10 로그 "기존 아파트 1000건 로드", 실제 3,044) → 2,000여 곳이 매칭 후보 밖 → ah-* 옆에 ap-* 중복 생성 통로 | `selectAll(…, sb, "id")` 전량 + 배선 가드 2건. 오케스트레이터 직접 수정(2줄) |

### 2차 리뷰가 낸 새 결함 2건 + 그 과정에서 드러난 **내 스펙 오류 1건** (전부 반영)

| # | 자리 | 무엇 |
|---|---|---|
| NEW-1 | `collect-applyhome-detail.mjs addrToRegion` | 헬퍼가 못 가른 통합 주소가 **옛 순회로 떨어져 `head.startsWith("전남")` 우연으로 "전남"** 이 됐다. 그 값이 굳으면 `matchDetailToApt` region 게이트가 광주 단지를 거부한다 → 통합 head 는 **null 반환**(게이트 건너뛰고 이름 유사도 0.85 만 적용). 테스트 기대값도 `toBe("전남")` → `toBeNull()` 로 뒤집음 |
| NEW-2 | `naver-presale.mjs` `--region` 필터 | 주소를 못 읽은 항목(null)까지 걸러 **기존 단지 갱신이 통째로 사라졌다**(그 모드 한정) → `resolvedRegion != null &&` 추가. 신규 INSERT 는 별도 region null 가드가 담당 |
| **★내 오류** | 스펙 §2(e) `GU_FIX_IDS` | 초안이 `ah-2026910189`·`ah-2026910190` **두 개**를 박았다 — 189 만 확인하고 190 을 "같은 지구니 같겠지" 로 넘긴 것. 실측: 190(A8블록) 주소는 **"장성군 진원면"(전남)** 이고 DB region 도 이미 "전남" 이라 광주/북구로 덮으면 **맞는 값을 틀린 값으로 바꾼다**. 게다가 두 곳 좌표가 **소수 13자리까지 동일**(35.2411705241485, 126.864718064904) = 자리표시 의심. → (e) 는 **189 한 곳만**, 190 은 BACKLOG(placeholder-coordinates 계열) |

⚠️ 이 오류가 지나간 관문: 코더 구현 · 내 diff 직독 · 내 뮤테이션 4종 · CI 감사 · 1차 리뷰 — **전부 통과했다.**
"id 를 못 박아 추측을 없앴다" 는 형식은 지켰지만 **그 id 를 고를 때의 실측이 하나뿐**이었기 때문이다
([[probe-must-be-self-verified]] §5 "첫 건만 보고 단정하지 않는다" 의 재발). 하드코딩 목록은 **항목 수만큼 실측**한다.

검증(2라운드): tsc 0 · vitest 97파일 **3,058**(코더 3,055 + FIX 9 가드 2; `kakao-radius` 5초 flake 는 단독 재실행 green) · dry-run a93·b6·c5·d 4,242(쌍둥이 4,242·비쌍둥이 0)·e2 · 뮤테이션 코더 6 red + 오케스트레이터 3 red(E "아니면 전남" 복원 6 · F 이름우선 복원 2 · G 커서 키 훼손 1) · 리뷰어 2차 확인.

⚠️ 작업 중 실측 — **F:\mibunyang 작업 트리는 로컬 스케줄러의 운영 코드다.** 목요일 08:00 파이프라인이 10:13 에 naver-presale 을 띄웠고(로그의 "[목록] 광주 조회… / 전남 조회…" 분리 출력 = 편집 전 파일) 오염은 없었지만, 순서가 조금만 어긋났으면 미커밋 1라운드 코드가 운영에서 돌 뻔했다. 다음 다중 파일 수집기 편집은 **git worktree** 에서.
