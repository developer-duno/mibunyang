# 세션 94 — 2026-04-15 (화성시 50건 nearbyMedian NULL 해소)

**목표**: 세션93 잔여 65건 중 화성시 52건 해소.

**원인 (DB 실측, 원 가설 전복)**:
- 사전 가설: "apartments.gu 에 비법정 구 이름 박혀 있음" (세션93 종료 시 작성)
- 실측: `region='경기' AND address ILIKE '%화성%'` apartments 64건의 gu 분포 = `{"화성시 동탄구":29, "화성시 만세구":12, "화성시 효행구":12, "화성시 병점구":8, "동탄구":3}` — **"화성시 " 접두사 붙은 복합 문자열**. 원천 주소 자체가 `"경기 화성시 동탄구 신동 778"` 같은 형태로 청약홈(ah- prefix)에서 들어옴.
- `trades` 테이블 화성시 0건 (`region='경기' AND gu LIKE '화성%'` → 0). 세션92-d 의 LAWD 41591 교정에도 불구하고.
- **근본 원인 체인**: [collect-trades.mjs:163-165](scripts/collectors/collect-trades.mjs#L163-L165) 의 `regionGuPairs = apartments DISTINCT (region, gu)` 가 수집 대상을 만드는데, 화성시 gu가 복합 문자열이라 `getLawdCd("경기","화성시 동탄구")` 매핑 실패 → MOLIT API 호출 미수행 → trades 화성시 0건 → trade-stats `statsKey` 매칭 실패 → nearby_median NULL. 41591 교정은 gu="화성시"일 때만 효과 있었음.

**해법**: 3단계 분리 (단계 B 재오염 방지 가드는 세션95 이관).

## 단계 A: `scripts/fix_hwaseong_gu.mjs` 신규 (DB 정규화)

- `loadEnv/getSupabase/log/logError` from `_shared.mjs` 재사용
- `.or("gu.like.화성시 %,gu.in.(동탄구,만세구,효행구,병점구)")` 조건
- "동탄구" 단독은 address에 "화성시" 포함 시만 UPDATE, 외엔 SKIP + WARN (실측에선 3건 모두 포함 → 전원 UPDATE)
- JSON 백업 자동: `scripts/_backups/hwaseong_gu_{ISO-TS}.json` (id/region/gu_before/address)
- 롤백 모드: `--rollback=PATH`
- 멱등: 2회 실행 시 이미 "화성시" 인 행은 조건 불일치로 빠짐 (LIKE '화성시 %' 공백 필수 + IN 리스트 불일치)
- `--commit` 없으면 dry-run

**결과**:
- dry-run: 후보 64건, UPDATE 64, SKIP 0
- commit: 64/64 UPDATE 완료, AFTER 분포 `{"화성시": 64}` 단일 버킷
- 백업: `scripts/_backups/hwaseong_gu_2026-04-15T12-17-48.json`
- 쿼터 0

## 단계 C1: `collect-trades.mjs --only=region:gu` 플래그 +15줄

```js
export function parseOnlyFilter(argv) {
  const arg = argv.find(a => a.startsWith("--only="));
  if (!arg) return null;
  const val = arg.split("=")[1] || "";
  if (!val.includes(":")) throw new Error(`--only 형식 오류: '${val}' — 'region:gu' 형식 필요`);
  return val;
}
```
- `regionGuPairs` 생성 직후 `filter(rg => ${region}:${gu} === onlyFilter)`
- 적중 0건이면 `exit(0) + error log`
- 테스트 3개 추가 (적중/무플래그/형식오류) — 32→35 passed
- 기존 호출자 영향 없음 (선택적)

## 단계 C2: 화성시 타겟 재수집 + trade-stats 재계산

```bash
node scripts/collectors/collect-trades.mjs --only=경기:화성시 --months=6
# → 189→1개 지역, API 18콜, 매매 706+전세 1523+분양권 6=2,235건 upsert
node scripts/collectors/trade-stats.mjs
# → 2001/2001 upsert, nearby_median 1,986건 (실거래 1986, 매물 0, 시세이력 0)
```

**KPI 결정적**:
| 지표 | 세션93 종료 | 세션94 종료 | Δ |
|---|---|---|---|
| nearby_median NULL | 65 | **15** | **-50 (-76.9%)** |
| 커버리지 | 95.4% | **99.3%** | **+3.9pt** |
| 화성시 NULL | 52 | **0** | **-52** |
| 쿼터 소비 | - | 19 콜 | 한도의 0.2% |

**잔존 15건 (전부 구조적)**:
- 인천 동구 5, 옹진군 2 — 섬 지역 실거래 공백
- 경기 가평군 3, 양평군 4, 연천군 1 — 군 단위 거래 희소

**9 GATE (전수 🟢)**:
- GATE 0: 3커밋 각 1~2파일 / 단일 관심사 🟢
- GATE 1: 영향 범위 grep 실측 — guOptions 는 DB distinct 동적 생성, nearby_median 프론트 직접 참조 0건 🟢
- GATE 2: A→C1→C2 의존 순서 정합 🟢
- GATE 3: 빠진 항목 해소(JSON 백업/멱등/`--only` 검증) 🟢
- GATE 4: 한 커밋 한 관심사 🟢
- GATE 5: 민감정보 재사용 패턴 안전, LIKE 범위 64건 정확 🟢
- GATE 6: apartments.gu TEXT, apartments_flat 비-materialized VIEW 자동 반영, scoreRisk 는 isRegulated 우선이라 gu 변경 영향 0 🟢
- GATE 7: 3커밋 각 `git revert` 가능 + rollback 스크립트 🟢
- GATE 8: dataReliability +15 positive 회귀만 예상 🟢

**Review 단계 검증 (Explore 3병렬)**:
- 영향 범위 실측: scoring-validator 범주 — 전수 0건 (scorePrice 에 nearbyMedian 영향 없음)
- null-safety-checker 범주 — nearby_median NULL→값 전환 positive
- collector-contract — 배치 500 / onConflict / Promise.all / NonRetryable 계약 유지

**커밋**:
- 1) `5c6175a` fix(apartments): 화성시 gu 복합 오염 64건 정규화
- 2) `8b8df86` feat(collectors): collect-trades --only=region:gu 타겟 필터
- 3) (this) docs: 세션94 기록 + CLAUDE.md 진행 상황 갱신

**파일 변경 집계**:
- 신규 2: `scripts/fix_hwaseong_gu.mjs` (~155줄), `scripts/_backups/hwaseong_gu_2026-04-15T12-17-48.json` (백업)
- 수정 2: `scripts/collectors/collect-trades.mjs` (+15), `scripts/collectors/collect-trades.test.mjs` (+13)
- 문서 2: `CLAUDE.md`, `.claude/SESSION_LOG.md`
- DB: apartments 64건 UPDATE, trades 2,235건 upsert, trade_stats 2,001건 upsert, apartments.dsr40pass 1,944건 update
- 프론트/API: 변경 0

**세션95로 이관 (단계 B)**:
`_shared.mjs` 에 `normalizeGu(region, gu)` 헬퍼 + apartments 쓰기 경로 전수조사 후 훅 적용. 후보 경로: `naver-presale.mjs`, `sync-naver-complex.mjs`, `collect-applyhome*`, `reverse-geocode.mjs`, `geocode-missing.mjs`. 세션95 시작 시 재오염 여부 DB 재측정으로 우선순위 확정.

**학습**:
- 화성시 동탄구는 **실제 행정 개편 준비 중**이라 주소 문자열에 들어가는 것 자체는 자연스러움. gu 컬럼의 의미를 "MOLIT 시군구 단위"로 통일하는 게 정답.
- 세션93 학습("저비용 고효과 패턴") 재확인: 단계 A+C1 은 쿼터 0, 단계 C2 는 18콜만으로 50건 해소. Plan 의 사전조사 단계에서 원인 체인을 DB 실측으로 전복시킨 게 핵심이었음. 원 가설(가드 추가 없이 단순 UPDATE)로 진행했다면 재수집 없이 끝나서 50건 해소 못 했을 것.
- Explore 에이전트 병렬 결과가 **서로 모순**될 때(세션94 사전조사: "apartments.gu 가 수집기에서 오염" vs "trades 0건이 진짜 원인") 직접 DB 실측이 유일한 진실의 원천.

---

# 세션 93 — 2026-04-15 (세종 33건 nearbyMedian NULL 해소)

**목표**: 세션92 잔여 98건 중 세종 33건 해소.

**원인 (DB 실측)**:
- `apartments` 세종 41건: gu=NULL 40 + gu="행정중심복합도시" 1 (세션43 린스트라우스 보강)
- `trades` 세종 28,676건: gu=NULL 21,507 + gu="행정중심복합도시" 7,169
- `complexes` 세종: sido="세종특별자치시", sigungu=NULL
- **비세종 region 의 gu=NULL 행 0건** (화이트리스트 안전성 실측)
- `trade-stats.mjs` L159 `if (!t.gu) continue;` 와 L207 `if (!apt.gu) continue;` 가 세종을 양쪽에서 스킵. 린스트라우스 1건도 complexes sigungu=NULL 탓에 naverByGu/historyByGu 키 불일치로 매칭 실패.

**해법**: `statsKey(region, gu)` 헬퍼 export — 세종 화이트리스트로 gu 무시(`"세종:"` 단일 버킷), 비세종은 기존 `region:gu` 리터럴과 bit 동일. 7곳 치환:
- tradesByGu (L159~164)
- complexGuMap 생성 (L166~173, sido="세종특별자치시"→region="세종", gu=null 정규화)
- naverByGu (L176~182)
- historyByGu (L186~192)
- cancelByGu (L196~202)
- apartments loop 가드 (L209~212)
- guComplexes 비교 (L418~421, `statsKey(gi.region, gi.gu) === key`)

**변경 규모**: `scripts/collectors/trade-stats.mjs` 단일 파일 ~25줄. `trade-stats.test.mjs` 에 `statsKey` describe 블록 5 assert 추가. DB 스키마·API·프론트 변경 0. 쿼터 소비 0.

**9 GATE**: 0~8 전수 🟢.
- GATE 1 영향 범위 실측: workflow CLI 2곳(import 0), test import median/monthsAgo/groupByArea 만, statsKey 이름 충돌 0, 비세종 gu=NULL 0건 실측
- GATE 5 보안: Explore 서브에이전트 PASS, 민감정보/injection/쿼터/스키마 전부 🟢

**5교차검증 병렬** (3전 PASS):
- scoring-validator: PASS — 가중치/클램핑/null 처리 불변, PROFILES 합계 100 유지, null→실수치 전환은 정상 입력 경로
- null-safety-checker: PASS — 7개 호출처 `if (!key) continue;` 가드 전부 확인, guComplexes `gi && statsKey(...)===key` 가드 안전
- collector-contract: PASS — BATCH=500, onConflict="apartment_id", Promise.all, 개별 재시도, 에러 로깅 전부 불변

**테스트**: 2,296 → **2,301 green** (+5 정확). vitest 기반(TypeScript 프로젝트 아님, tsc 대신 npm run test).

**dry-run 검증**:
- `nearby_median: 1922건` (실거래 1922, 매물 0, 시세이력 0)
- 세션92 `nearby_median: 1900` → +22 (dry-run; compute-scores 미반영 상태)
- 본 실행 후 KPI 재측정 결정적: apartments_flat 1,424 기준 **nearbyMedian NULL 98 → 65** (-33), 세종 33/34 전량 해소
- 잔존: 경기 61 + 인천 4 = 65 (세종 사라짐)
- 커버리지 93.1 → 95.4% (+2.3pt)

**범위 외 (세션94 이후)**:
- 화성시 비법정구 52건 (apartments.gu DB migration, Plan 필수)
- 서울 pir null 57%
- dataReliability 유령값 탐지

**커밋**: (pending)

---

# 세션 92-c/d — 2026-04-15 (통합시 복합 gu 연쇄 발견 및 해결)

## 주요 작업 — 세션92-b 후 잔여 NULL 원인 파고들기

**커밋**:
- `23f5beb fix(collectors): 통합시 5개 복합 gu + 단독 구 매칭 (세션92-c)`
- `d8ce1d7 fix(collectors): 경기 통합시 + 화성시 코드 확장 (세션92-d)`

### 1. 원인 연쇄 발견

세션92-b 커밋 후 KPI 측정에서 잔여 NULL 58건 분포:
- 충북 20 / 충남 19 / 경북 9 / 경남 10

apartments.gu 실측: 충북 "청주시 흥덕구"·"상당구" 단독 혼재, 충남 "천안시 서북구"·"동남구" 단독 혼재, 경북 "포항시 북구" / 경남 "창원시 의창구"·"성산구"·"마산회원구" 등.

**MOLIT 직접 probe (202603)**:
- 충북 청주 4구: 43111/43112/43113/43114 각 221~443건 ✅
- 충남 천안 2구: 44131/44133 372/542건 ✅
- 경북 포항 2구: 47111/47113 180/301건 ✅
- 경남 창원 5구: 48121/48123/48125/48127/48129 148~410건 ✅
- 기존 단일 키 "청주시 43110"·"천안시 44130"·"포항시 47110"·"창원시 48120": 전부 `totalCount=0` (MOLIT 미지원)
- 경북 울릉군 47940: 0건 (섬 지역 실 공백, 매핑은 정상)

### 2. 92-c 구현

1. `scripts/collectors/_shared.mjs` GU_LAWD_MAP 의 충북/충남/경북/경남 4개 region 블록에서 청주/천안/포항/창원 통합시 단일 키를 하위 구 복합 키 13개로 교체
2. `getLawdCd` 함수에 "단독 구 → 복합 키 매칭" 분기 추가:
   ```js
   if (regionMap && gu.endsWith("구")) {
     for (const [name, code] of Object.entries(regionMap)) {
       if (name.endsWith(" " + gu)) return code;
     }
   }
   ```
   이는 apartments.gu 가 "상당구" 단독일 때 "청주시 상당구" 복합 키와 매칭시키는 보정
3. `_shared.test.mjs` +8 케이스 (복합 gu 4 + 단독 구 3 + 광주 북구 회귀 1)

### 3. 92-c 교차검증

- `collector-contract` PASS (C1~C5 전부 불변, 쿼터 +234 추정, 37%)
- `null-safety-checker` PASS (High/Medium/Low 0)
- 빌드: 382ms
- 테스트: 2,282 → 2,290 passed (+8)

### 4. 92-c 본 수집 결과

- `collect-trades`: 527,149건 upsert → 433,541건 (92-c 는 434,052 수집 중복제거 후 433,541)
- trades 전국 444,104 → **496,552 (+52,448)**
- `trade-stats`: nearby_median 실거래 1,553 → **1,630건 (+77)**
- nearbyMedian NULL 309 → **251 (21.7% → 17.6%)**
- 지방 8개 region 전부 **0건 NULL** (세종 제외)

### 5. 92-c 후 재측정에서 경기 대형 발견

92-c 실행 후 NULL 251건의 region:gu 분포를 조사했더니:
- 세종 33 + 경기 화성시 동탄구 28 + 경기 용인시 처인구 19 + 경기 부천시 오정구 14 + 경기 부천시 소사구 13 + 경기 수원시 권선구 13 + ...

경기 통합시 하위 구에서 **180건 NULL**. MOLIT 직접 probe:
- 수원 4구 41111/41113/41115/41117 각 209~548건 ✅
- 성남 3구 41131/41133/41135 108~189건 ✅
- 안양 2구 41171/41173 280/438건 ✅
- 안산 2구 41271/41273 191/287건 ✅
- 고양 3구 41281/41285/41287 229~468건 ✅
- 용인 3구 41461/41463/41465 258~732건 ✅
- 부천 3구 41192/41194/41196 58~381건 ✅
- 기존 단일 키 41110/41130/41170/41190/41270/41280/41460: **전부 totalCount=0**
- 화성시 41590 (기존): totalCount=0 / **41591**: 154건 ✅

즉 경기도 주요 통합시 7개 전부 시 단일 코드는 MOLIT 미지원, 하위 구만 유효였음. 세션92 초기부터 경기도가 대규모로 실패하고 있었는데 지방에 가려져 있었음.

### 6. 92-d 구현

1. `GU_LAWD_MAP["경기"]`: 수원/성남/안양/부천/안산/고양/용인 7개 통합시의 하위 구 복합 키 18개 추가 (기존 시 단일 키는 parseAddress 레거시 호환용으로 유지 — shortGu 매칭으로 여전히 41110 등 기존 값 반환하여 기존 collect-data.test.mjs assertion 불변)
2. 화성시 41590 → 41591 교정 (법정 단일시 코드는 5번째 자리 1)
3. `_shared.test.mjs` / `collect-trades.test.mjs` 화성시 assertion 41590→41591 갱신 + 경기 복합 gu 7 케이스 추가

### 7. 92-d 본 수집 결과

- `collect-trades`: **527,149건 upsert** (92-c 대비 +93,608)
- trades 전국 496,552 → **597,329 (+100,777)**
- `trade-stats`: nearby_median 1,630 → **1,882건 (+252)**
- nearbyMedian NULL 251 → **98 (17.6% → 6.9%)**

### 8. 최종 KPI (세션91 → 92-a/b/c/d)

**nearbyMedian NULL 추이**:
| 세션 | NULL | % |
|---|---|---|
| 91 | 491 | 34.5% |
| 92-a | 362 | 25.4% |
| 92-b | 309 | 21.7% |
| 92-c | 251 | 17.6% |
| **92-d** | **98** | **6.9%** |

세션91 대비 누적 **-27.6pt, 391건 해소**.

**trades 전국**: 349,201 → **597,329 (+248,128)**

**region 별 price 카테고리 평균** (92-d 최종):
- 전국 평균 53.7 → **56.81 (+3.11pt)**
- 경기 57.0 → **59.2** (+2.2pt, 통합시 180건 실데이터 반영)
- 강원 52.7 / 전북 34.6 / 전남 36.8 / 충남 34.5 — 미분양 상위 region 의 정직한 저점수
- 제주 64.4 / 서울 69.8 / 세종 67.6 — 고점 유지

### 9. 잔여 98건 (세션93 이월)

| 원인 | 건수 | 조치 필요 |
|---|---|---|
| 화성시 비법정구 (동탄구/만세구/효행구/병점구) | 52 | apartments 원천 정규화 — 화성시는 법정 구 없음, apartments.gu 에 잘못 들어간 행정구명 |
| 세종 (구 단위 없음) | 33 | trade-stats.mjs 의 단지별 nearby_median 매칭 로직이 region+gu 기반인데 세종 gu NULL 로 매칭 실패 |
| 인천 동구/옹진군 (섬 지역) | 4 | MOLIT 실 공백, 구조적 |
| 경기 양평/가평/연천 시군 | 6 | 실거래 부족 가능성 |
| 기타 | 3 | — |

**근본 해결 불가**: 경기 화성시 & 인천 섬 지역 ≈ 56건 (구조적 공백, apartments 정규화 또는 수용)
**가능**: 세종 trade-stats 매칭 로직 개선 33건 + 잔여 9건 ≈ 42건 가능

### 10. 다음 세션 우선순위

1. **세종 33건** — trade-stats.mjs region+gu 매칭 로직 점검 (세종은 region 만으로 매칭되도록)
2. **apartments.gu 정규화 마이그레이션** — 화성시 "동탄구" 등 52건 원천 수정
3. 서울 pir null 57% 원천 수집 이슈
4. dataReliability 지표 유령값 탐지 개선
5. 행안부 API 복구 대기 / Vercel 12함수

---

# 세션 92-b — 2026-04-15 (강원/전북/세종 특별자치 LAWD_CD 개편)

## 주요 작업 — 세션92-a 잔여 3개 region 미해소 원인 조사 + 수정

**커밋**: `ef3bf8f fix(collectors): 강원/전북 LAWD_CD 개편 + 세종 단일 코드 처리 (세션92-b)`

### 1. 원인 조사 (MOLIT API 직접 probe)

세션92-a 커밋 후 KPI 측정에서 강원/전북/세종 3개 region 이 `trades` 0건인 원인이 GU_LAWD_MAP 매핑 부재가 아님을 발견. MOLIT AptTradeDev 엔드포인트를 6개월 × 5 region 직접 호출:

- 강원 춘천시 42110 / 원주 42130 / 강릉 42150: 6개월 전부 `totalCount=0` (resultCode 000 정상 응답)
- 전북 전주 덕진 45113 / 익산 45140: 동일 전부 0
- 대조군 전남 목포 46110: 월평균 230건 정상

대체 코드 probe:
- 강원 51110(춘천 신코드) → 202603 344건 ✅
- 강원 51130(원주) → 523건, 51150(강릉) → 193건
- 전북 52111(전주 완산 신코드) → 477건, 52113(덕진) → 472건, 52140(익산) → 286건
- 세종 36110 → 420건 (36000 은 0건)

**결론**:
- **강원특별자치도** 2023-06-11 출범 → LAWD_CD 42xxx → **51xxx** 개편
- **전북특별자치도** 2024-01-18 출범 → LAWD_CD 45xxx → **52xxx** 개편 (+ 전주시는 완산/덕진 **구 단위** 만 유효)
- **세종특별자치시**: 구·군 없이 단일 36110 만 유효. 내 `getLawdCd` 의 `!gu → prefix+"000"` 폴백이 세종에서 `36000` 을 반환하는데 이는 MOLIT 미지원 코드.

### 2. 구현 (3파일, 36+/14-)

1. `scripts/collectors/_shared.mjs` — GU_LAWD_MAP 강원 18개 42→51xxx 전부 교체, 전북 15개(전주시 완산/덕진 분리) 45→52xxx 교체, `getLawdCd` region=="세종" early return → "36110" 추가
2. `scripts/collectors/collect-trades.mjs:162-164` — regionGuPairs 필터 "세종 예외" 추가 (`gu || region === "세종"`) + null/undefined/"" 정규화
3. `scripts/collectors/_shared.test.mjs` — 기존 "강원 춘천시 → 42110" 를 "51110" 으로 갱신 + 전북 완산/덕진, 세종 null/임의 gu 4케이스 추가

### 3. 9-GATE 간이 검증 (Opus)

- GATE 0 크기: 3 파일 🟢
- GATE 1 영향: `getLawdCd` 참조 5곳 — collect-trades/collect-data 의도, schools-neis sggCode 폴백이 개편 후 정식 코드로 일치하여 긍정 부수효과 유지
- GATE 5 보안: 상수 교체 + 1줄 필터 예외, 보안 무관
- GATE 7 롤백: 단일 revert. trades 테이블 강원/전북/세종 새 데이터는 revert 후에도 유효(기존 0건이었으므로 되돌릴 이전 상태 없음)
- GATE 8 쿼터: 증분 +324 호출 예상 (3개 region 18 pairs × 3 type × 6개월). 실제 실행 시 호출 수 3,474 로 불변(pairs 수 193 그대로) — 기존 pairs 가 이미 "전북 전주시 덕진구" 등을 포함하고 있었고 응답만 빈→실데이터로 바뀐 것
- 최종 🟢8/0/0 → 실행 허가

### 4. dry-run 생략 이유

MOLIT 직접 probe 로 개편 후 모든 코드를 확정했고(18+15 code × 응답 확인), 쿼터 증분이 매우 제한적이어서 본 수집 진입. pairs 수는 Set 중복제거로 이전과 동일(193)이므로 호출 총량 변화 없음을 사전 시뮬레이션으로 확인.

### 5. 본 수집 결과

1. `collect-trades.mjs` (3474 호출) — 매매 195,930 / 전세 182,843 / 분양권 12,573 / 총 **391,346건 수집**, 중복제거 후 390,882 건 upsert (세션92-a 349,924 → **+40,958건**). 실패 0.
2. `trade-stats.mjs` — nearby_median 실거래 1,496 → **1,553건 (+57)**. 1,953/1,953 trade_stats upsert.
3. `compute-scores.mjs` — 1,424/1,424 catsCache 성공 (10.5초)

### 6. KPI (세션91 → 92-a → 92-b)

**`trades` 테이블 전국**: 349,201 → 403,146 → **444,104**

**지방 3개 region trades**:
| region | 91 | 92-a | 92-b |
|---|---|---|---|
| 강원 | 0 | 0 | **12,963** ✨ |
| 전북 | 0 | 0 | **13,657** ✨ |
| 세종 | 0 | 0 | **14,338** ✨ |

**`nearbyMedian` NULL**: 491 (34.5%) → 362 (25.4%) → **309 (21.7%)** (세션91 대비 누적 **-12.8pt**)

**지방 region NULL 해소**:
| region | 91 | 92-a | 92-b |
|---|---|---|---|
| 강원 | 33/33 | 33/33 | **0/33** ✨ |
| 전북 | 19/19 | 19/19 | **0/19** ✨ |
| 세종 | 34/34 | 34/34 | 33/34 (구 없어 partial) |

**전국 price 카테고리 평균**: 53.70 → 56.65 → **56.40** (92-b 소폭 -0.25pt)

**region 별 price 변화 (92-a → 92-b)**:
- 강원 56.7 → 53.0 (-3.7): 유령 중립 → 실데이터 정직
- 전북 47.0 → **33.9** (-13.1): 미분양률 13.3% 상위 region 특성이 실 시세 대비 분양가 불리로 정확히 포착됨 (scoring-validator 판정: 세션91 정신의 연장선, 회귀 아님)
- 세종 67.1 → 67.6 (+0.5): presalePp 폴백 경로 유지
- 충북 57.5 → 60.0 (+2.5) / 제주 63.7 → 61.1 / 충남 40.2 유지

### 7. 교차검증

- `scoring-validator` (PASS): 세션91 단위 교정·세션92-a sanity 모두 불변, 전북 -13.1pt 는 dev 계산 실데이터 반영 결과 (fairPrice < price → 음수 dev → DEV_SCORE_TIERS 낮은 단계), 가중치 0.30 × (~-40 devSc) 수치 일치
- 빌드: `vite build` 385ms 성공
- 테스트: 2,278 → **2,282 passed (+4)**

### 8. 다음 세션 우선순위

1. **충북/충남/경북/경남 부분 잔여 NULL** (총 58건) — gu 형식 불일치(예: 충북 "상당구" 단독, 충남 "동남구" 단독) 조사
2. 서울 pir null 57% 원천 수집 이슈
3. dataReliability 지표 개선 (유령값 탐지)
4. 행안부 API 복구 대기 (외부)
5. Vercel 12함수 제한

---

# 세션 92 — 2026-04-15

## 주요 작업 — trade_stats 지방 수집 확대 (GU_LAWD_MAP 지방 8개 region 매핑)

**커밋**: `0848aa2 feat(collectors): GU_LAWD_MAP 지방 8개 region 확장 (세션92)`

### 1. 근본 원인 (세션91에서 확인, 세션92에서 해결)

`scripts/collectors/_shared.mjs:189-231` `GU_LAWD_MAP` 에 강원/충북/충남/전북/전남/경북/경남/제주 구/군 매핑이 정의되지 않아서 `collect-trades.mjs:182` `getLawdCd` 가 null → "법정동코드 없음" 로그와 함께 지방 region 전부 스킵. `trades` 349,201행 중 지방 8개 region 0건 → `trade-stats.mjs:223` 1단계 불가 → `nearbyMedian` 지방 100% NULL.

### 2. 구현 (단일 커밋, 4파일 73+/8-)

1. `scripts/collectors/_shared.mjs` +52 — GU_LAWD_MAP 에 강원 18, 충북 11, 충남 15, 전북 14, 전남 22, 경북 23, 경남 18, 제주 2 = **총 123 구/군** 5자리 시군구 코드 추가 (행안부 공식)
2. `scripts/collectors/_shared.test.mjs` +14/-4 — length 9→17 갱신 + "강원 춘천시 42110" 교정 + 경남 거제/제주 서귀포 케이스 3개 + 경북 미래군 prefix 폴백 케이스
3. `scripts/collect-data.test.mjs` +4/-2 — 동일 9→17 갱신
4. `scripts/CLAUDE.md` +3 — 쿼터 분배 표에 "세션92 지방 확장 시 +500~1,500" 주석 및 "매월 6일 최대 ~5,000" 위험 메모

### 3. 9-GATE 플랜 검증 (Opus)

플랜 파일: `C:\Users\user\.claude\plans\quizzical-gathering-hearth.md`

- GATE 0 (Sonnet 크기): 초기 🔴 (테스트 2개 하드코딩 "length 9" 발견) → 단계 1에 테스트 갱신 동기 포함 → 🟢
- GATE 1 (영향 범위): `getLawdCd` 참조 5곳 실측, `schools-neis.mjs:339` sggCode 폴백이 "42000" → "42110" 으로 **긍정 부수효과** 발견
- GATE 5 (보안): `collect-trades.mjs:21/79/142` env 경로만, 하드코딩 시크릿 없음
- GATE 8 (쿼터): collector-contract C4 🟡 경고 → dry-run 후 🟢 해소
- 최종: 9 GATE 중 🟢8 🟡1 🔴0 → 실행 허가

### 4. 교차검증

- 플랜 단계: `collector-contract` 서브에이전트 (계약 준수, C4 쿼터 경고 1건)
- 변경 후: `null-safety-checker` (PASS, High/Medium/Low 0건) + `collector-contract` (PASS, C4 경고 해소)
- 단계 5 후: `scoring-validator` (PASS, 세션91 단위 교정·null 가드 회귀 없음, 평균 56.65 정상 범위)
- simplify 리뷰 3병렬 (재사용/품질/효율): 세션 번호 주석 5곳 제거 권고 반영
- 빌드: `npx vite build` 448ms / 375ms 성공
- 테스트: 2,275 → **2,278 passed (+3)**

### 5. dry-run 실측 (커밋 전)

`node --loader ./scripts/alias-loader.mjs scripts/collectors/collect-trades.mjs --dry-run --months=6`

- 지역 수 193개 (확장 반영)
- API 3,474회 (일 한도 10,000의 34.7%, 9,000 한도 대비 38.6%)
- 총 350,270건 수집 (매매 174,064 + 전세 165,180 + 분양권 11,026)
- "법정동코드 없음" 로그 0건 (8개 region 매핑 완전 커버)
- "AptTradeDev" 정식 엔드포인트, 기존 API 폴백 없음

→ 단계 3 스케줄 분산 **불필요** (GATE 8 경고 해소)

### 6. 본 수집 (단계 5)

1. `collect-trades.mjs` — 349,924건 upsert 성공, 실패 0, MOLIT_KEY 3,474회 쿼터 기록
2. `trade-stats.mjs` — 1,951/1,951건 trade_stats upsert, dsr40pass 1,904 업데이트, **nearby_median 실거래 1,496건 (세션91 기준 933 → +563, +60%)**
3. `compute-scores.mjs` — 1,424/1,424 catsCache UPDATE 성공 (9.7초)

### 7. KPI 측정 결과

**`trades` 테이블**: 349,201 → **403,146건** (+53,945)

**`nearbyMedian` NULL**: 491건(34.5%) → **362건(25.4%)** — 9.1pt 개선

**지방 region nearbyMedian 해소**:

| region | 세션91 NULL | 세션92 NULL | 비고 |
|---|---|---|---|
| 제주 | 14/14 (100%) | **0/14 (0%)** | ✨ 완전 해소 |
| 전남 | 33/33 (100%) | **0/33 (0%)** | ✨ 완전 해소 |
| 경남 | 34/34 (100%) | 10/34 (29%) | 24건 해소 |
| 경북 | 25/30 (83%) | 9/30 (30%) | 16건 해소 |
| 충남 | 41/41 (100%) | 19/41 (46%) | 22건 해소 |
| 충북 | 40/40 (100%) | 20/40 (50%) | 20건 해소 |
| 강원 | 33/33 (100%) | 33/33 (100%) | **미해소 (잔여 과제)** |
| 전북 | 19/19 (100%) | 19/19 (100%) | **미해소 (잔여 과제)** |
| 세종 | 34/34 (100%) | 34/34 (100%) | **미해소 (잔여 과제)** |

**전국 price 카테고리 평균 (전수 1,424건)**: 53.7 → **56.65 (+2.95pt)**

region 별 price 평균 급상승:
- 충북 ~31.6 → **57.5** (+25.9pt)
- 제주 ~36.3 → **63.7** (+27.4pt)
- 경북 → 48.8 / 전남 → 36.8 / 경남 → 44.1 / 충남 → 40.2 (지방 매핑 반영)
- 강원 56.7 / 전북 47.0 / 세종 67.1 (trades 0건, 세션91 50점 중립 폴백 유지)

### 8. 잔여 과제 (3개 region 미해소 원인)

실측(`apartments` 테이블 gu 분포) 결과:

1. **세종 trades 0건**: `apartments.gu` 40/41건 **NULL**. `collect-trades.mjs:164` `.filter(rg => rg.region && rg.gu)` 에서 루프 제외. GU_LAWD_MAP 매핑과 무관 — **apartments 원천 gu 정규화 필요**
2. **전북 trades 0건**: `apartments.gu` 가 `"전주시 덕진구"`, `"전주시 완산구"` 복합 형식. GU_LAWD_MAP 에 `"전주시"` 만 있어서 정확 매칭 실패 → 전역 폴백 → prefix "45000" → MOLIT API 가 빈 응답. **GU_LAWD_MAP 에 하위 구 매핑 추가 또는 gu 정규화 필요**
3. **강원 trades 0건**: `apartments.gu` 가 `"원주시"` 등 단순 시 이름이고 GU_LAWD_MAP 매칭도 정상일텐데 trades 0건. **원인 불명, 단일 region 재실행 또는 MOLIT API 응답 재확인 필요**

이 3건은 세션93 우선 과제로 이월.

### 9. 다음 세션 시작점

우선순위 1 (지방 3개 region 미해소 원인 조사):
- 강원 단일 region dry-run 재실행해서 API 호출 vs 응답 확인
- 전북·충남 복합 gu("전주시 덕진구" 등) 처리 전략 — (a) GU_LAWD_MAP 에 하위 구 5자리 추가, (b) apartments.gu 정규화 마이그레이션, (c) collect-trades 에서 복합 gu 분리 로직
- 세종 gu NULL 40건 원천 수집 이슈

우선순위 2~5: 세션91 에서 이월된 항목 (서울 pir null 57%, dataReliability 유령값 탐지, 행안부, Vercel 12함수)

---

# 세션 91 — 2026-04-15

## 주요 작업 — scorePrice 단위 버그 + sanitize 유령 폴백 제거

**커밋**: `475f291 fix(scoring): scorePrice 단위 버그 + sanitize 유령 폴백 제거 (세션91)`

### 1. Phase 1 실측 — "nearbyMedian 34.5% NULL" 문제 재정의

세션91 우선순위 1 "nearbyMedian 커버리지 보강"으로 시작했으나 실측 중 훨씬 심각한 버그 3개 발견:

**nearbyMedian NULL 지역 편향 (1424건 전수)**:
- 서울/부산/대구/광주/대전/울산 6개 광역시 NULL 0건
- 충남/충북/경남/세종/전남/강원/전북/제주 8개 지방 region 100% NULL (238건)
- 경북 83%, 경기 43% 부분
- 총 491건 NULL, 그중 진짜 공백(naverNearbyMedian 폴백 불가) 325건

**근본 원인 (trades 테이블 편향)**: 349,201행 중 지방 8개 region 0건. `scripts/collectors/trade-stats.mjs` 1단계(매매 3건+)가 시작부터 불가능.

**제품 관점의 의미**: 미분양률 상위 region(제주 32.2%, 경남 18.9%, 경북 15.0%, 전북 13.3%, 충북 9.2%)이 정확히 NULL region과 일치. 즉 "미분양 비교엔진"의 핵심 타겟이 price 데이터 공백.

### 2. 더 심각한 버그 4개 발견 — 단위/유령 폴백

실측 중 경남 "거제 유로스카이" 샘플의 `catsCache.price.subs[0].info` 가 "-34,027.0%" 쓰레기 값인 것 발견. 단순 공백이 아니라 스코어링이 수학적으로 고장난 상태.

**버그 1 — scorePrice.js:40 avgPriceSqm 단위 오류**:
- avgPriceSqm 단위 = 천원/㎡ (`src/constants/fieldMeta.js:72` 명시, KOSIS HUG)
- 이전 수식: `× area / 10000 × 3.3` → 1/3030 축소
- 경남 샘플: fairPrice=132만원 → dev=-32,401% → clamp로 0점
- 수정: `× area / 10` (올바른 단위 변환, 천원/㎡ × ㎡ / 10 = 만원)

**버그 2 — scorePrice.js:43 presalePp 단위 오류**:
- presalePp 단위 = 만원/평 (`fieldMeta.js:148`)
- 이전 수식: 총가로 그대로 씀 → 1/25 스케일
- 수정: `× (area / 3.3058)` 평수 환산

**버그 3 — scorePrice.js:40/43 areaAdj 누락**:
- 37행 nearbyMedian 경로는 areaAdj 곱하는데 폴백 경로는 안 곱함 → 일관성 깨짐
- 수정: 모든 경로에 areaAdj 적용

**버그 4 — engine.js:17,26 sanitize 유령 폴백**:
- `pir: num(apt.pir, rm?.pir ?? 10), psr: num(apt.psr, rm?.psr ?? 1.5)`
- `jeonseRate: num(apt.jeonseRate, 40), nearbyMedian: num(apt.nearbyMedian, 0)`
- 실제 NULL인 필드를 유령(최악값 또는 region 중위값)으로 덮어써 UI에 "전세가율 40%, PSR 150%" 거짓 정보 표시
- 수정: 전부 null 통과 + scorePrice.js 52-67/72-93 에 `== null` 가드 + `PRICE_NO_DATA_DEFAULTS` + "데이터 부재" info

### 3. 9-GATE 플랜 검증

플랜 파일: `C:\Users\user\.claude\plans\wobbly-prancing-wren.md`

- GATE 0 (Sonnet 크기): 🟢 (3파일/≈50 LOC)
- GATE 1 (영향 범위): 🟢 — grep 실측으로 scoreRisk/Location/Product/Benefit/Future 모두 pir/psr/jeonseRate/nearbyMedian 미사용 확인. 플랜의 scoreRisk.js 방어 단계 불필요로 삭제.
- GATE 2 (실행 순서): 🟢 — 단계 1+2+3 원자적 단일 커밋 필요(상호 의존)
- GATE 3~8: 🟢 전부 PASS
- 최종: 9 GATE 중 🟢9 🟡0 🔴0 → 실행 허가

### 4. 구현 (3단계, 단일 커밋)

1. `src/scoring/scorePrice.js` (+28/-12): 40/43행 단위 교정 + areaAdj 일관성 + 52-67행 데이터 부재 분기 null 가드 + 72-93행 정상 경로 null 가드 + "데이터 부재" info
2. `src/scoring/engine.js` (+2/-2): 17/26행 sanitize 유령 폴백 전부 null 통과
3. `src/scoring/engine.test.js` (+45/-12): 584-594행 버그를 스펙으로 박은 기존 테스트 교체 + 경남 회귀 케이스 + null 3종 케이스 추가

### 5. 교차검증 (5교차 필수 + 전용 서브에이전트)

- 스코어링: PASS (scoring-validator) — 가중합 1.00, 클램핑 무결, null 분기 일관, 수식 단위 교정 검증
- null 안전성: PASS (null-safety-checker) — High 0 / Medium 0 / Low 0건 (크래시), NaN 전파 경로 없음
- 빌드: `npx vite build` 성공 (382ms)
- 테스트: 전체 2,270 → 2,275 passed (+5), engine.test.js 128 → 133
- Hook 규칙: 메인 직접 검사 — 신규 훅 없음, 기존 동작 불변
- 보안: 메인 직접 검사 — scoring은 순수 함수, 시크릿/XSS/DB 스키마 무관

### 6. compute-scores 재계산 결과

`node --loader ./scripts/alias-loader.mjs scripts/compute-scores.mjs` → 1424/1424 성공 / 9.2초

**경남 거제 유로스카이 Before → After**:
- 적정가 괴리도: `score=0 info=-34,027.0%` → `score=0 info=-12.3%` (쓰레기 값 제거)
- 전세가율: `score=40 info=40%` (유령) → `score=50 info=데이터 부재` (정직)
- PSR: `score=0 info=150%` (유령) → `score=50 info=데이터 부재` (정직)

**전국 price 카테고리 평균 44.3 → 53.7 (+9.4pt)**:

| region | Before | After | Δ |
|---|---|---|---|
| 세종 | 29.2 | 67.1 | +37.9 |
| 충북 | 29.0 | 58.8 | +29.8 |
| 강원 | 27.9 | 52.5 | +24.6 |
| 제주 | 28.9 | 53.4 | +24.5 |
| 경남 | 28.6 | 52.4 | +23.8 |
| 충남 | 28.3 | 49.2 | +20.9 |
| 경북 | 30.6 | 49.0 | +18.4 |
| 전남 | 30.3 | 45.8 | +15.5 |
| 전북 | 30.4 | 45.1 | +14.7 |
| 경기 | 40.8 | 53.8 | +13.0 |
| 서울 | 66.1 | 64.3 | -1.8 |

**서울 -1.8pt 하락 분석 (롤백 기준 점검)**:
- 서울 266건 중 pir null 153건 (57%), psr null 153건 (57%)
- 이전 유령 폴백 `num(apt.pir, rm?.pir ?? 10)` 에서 `rm.pir` = 서울 중위값 1.3배 → pir≤3 분기 → pirSc=100 (허위 고점수)
- 새 코드 null → `PRICE_NO_DATA_DEFAULTS.pir = 50`
- 153건 × -7.5pt 가중 기여 = 평균 -4.3pt (pir만으로)
- 결론: 서울 하락은 "region 중위값을 null 단지에 유령 적용한 허위 고점수"가 정직한 중립으로 정정된 것. 버그 수정, 롤백 대상 아님.

### 7. 세션 교훈

- "커버리지 gap" 우선순위에서 "코드 버그" 재발견: 원래는 nearbyMedian 수집 확대(A)를 할 예정이었는데 Phase 1 실측 중 경남 샘플의 "-34027%" 쓰레기 값을 보고 방향 전환. 수집 쿼터 0 + 코드 50줄로 지방 미분양 전체 복구.
- sanitize 유령 폴백은 dataReliability 메트릭에 안 잡힘: 세션90에서 dataReliability 57.4→83.9로 자축했지만 그건 price 채움률 반영뿐이었고 pir/psr/jeonseRate의 유령 폴백은 "필드 있음"으로 잡혀서 신뢰도 높게 나왔음. 실제 UI 품질과 dataReliability 지표의 괴리.
- 9-GATE 정석 재확인: GATE 1(영향 범위 실측)에서 scoreRisk.js 방어 단계를 grep으로 삭제. 플랜을 "짐작"으로 보수적으로 짜지 않고 실측으로 좁히는 것이 절약 + 집중도 향상.
- "다른 각도로 한번 더"의 가치: 첫 실측에서 "nearbyMedian 34.5% 공백"으로 끝날 뻔한 조사를 사용자가 "다른 각도" 요청해서 catsCache 내부로 한 단계 더 들어가 경남 샘플의 "-34027%" 발견 → 진짜 버그 4개. 사용자의 재프롬프트가 결정적.

### 8. 미해결 / 다음 세션 이월

- trade_stats 수집기 지방 확대: 현 상태에서 nearbyMedian 자체 공백은 그대로. API 폴백으로 325건 중 일부는 naverNearbyMedian 으로 구제. 근본적 수집 확대는 쿼터 영향/스케줄 조정 필요 → 별도 세션.
- 서울 pir null 57% 원천 수집 이슈 점검: 서울 pir null 비율이 57%인 이유 확인 필요 (수집 누락 vs 원천 부재).
- 세션90 +26.5pt 초과 개선 원인: 이번 세션 Phase 1에서 "평균 산술의 당연한 결과"로 종결.

---

# 세션 90 — 2026-04-15

## 주요 작업 — price 커버리지 64% → 100% 복구

**커밋**: `b638dde feat(data): price 커버리지 64%→100% 복구 — prices 테이블 presale 백필`

### 1. 원인 분석 (Supabase 실측)
- price NULL 513건 **전부가 presaleMinPrice NOT NULL** — "데이터 없음"이 아니라 "저장 위치 분리" 문제였음
- naver-presale.mjs가 apartments.presale_min_price에만 기록하고 시계열 prices 테이블에는 안 써서 apartments_flat VIEW의 latest_prices CTE(prices 참조)가 못 잡음
- presaleStage 분포: 분양중 295 / 미분양 121 / 청약중 60 / 분양계획 37 (전부 현재 분양 대상, 옛 단지 아님)

### 2. 9-GATE 플랜 검증 (3번 반복)
- 초안 A (VIEW COALESCE): Gate1 🔴×3 — api/supabase/apartments.js:244의 _fallbackNearbyMedian 패턴과 filterEngine 의미 변경 회귀 → 폐기
- C v1 (prices 백필): Gate1 🔴×2 — latest_prices CTE tie-breaker 없음, api/supabase/prices.js 필터 부재 → 폐기
- **C v2**: 9/9 🟢 — CTE tie-breaker + API house_type 필터로 두 🔴 사전 차단

### 3. 구현 (5단계)
1. supabase/migrations/20260415044846_view_latest_prices_tiebreak.sql — latest_prices CTE ORDER BY에 `(CASE WHEN house_type LIKE 'presale_%' THEN 1 ELSE 0 END)` 추가, 공식가 우선
2. api/supabase/prices.js — `.not('house_type','like','presale_%')` 2곳 추가
3. scripts/collectors/naver-presale.mjs — toPresalePriceRow 신규 + priceRows 누적 + apartments upsert 직후 prices 병행 upsert (비치명적)
4. scripts/backfill-presale-prices.mjs — 신규, 기존 728건 일괄 백필
5. 대시보드 수동 적용 (supabase 원격 추적 기록 없어서 db push 위험) → 백필 → compute-scores 재계산 → 테스트

### 4. 검증 결과
- price 채움률: 64.0% → **100.0%** (+36.0pt)
- dataReliability 평균: 57.4 → **83.9** (+26.5pt, 예상 +7.6pt 초과 달성)
- prices 테이블 presale_min 행: 728건
- compute-scores: 1,424/1,424 성공
- 전체 테스트: 2,270/2,270 통과 (api/supabase/prices.test.js mock에 `.not` 추가)
- vite build 성공

### 5. 5교차검증 (병렬 Task)
- 빌드: 메인 agent PASS
- 스코어링: **scoring-validator** PASS — fairPrice≤0 분기가 dev 계산보다 선행, 클램핑·가중식 합 무결
- null 안전성: **null-safety-checker** PASS — parsePresalePrice + toPresalePriceRow 이중 가드, backfill error/length 가드 정상
- 수집기 계약: **collector-contract** PASS — onConflict 복합키 일치, FK 순서 안전, try/catch 비치명적 처리
- 보안: 메인 agent PASS — 민감정보·XSS·인젝션 벡터 없음

### 6. 범위 밖 (다음 세션 후보)
- nearbyMedian 65.5% → 77.6% 보강 (API 레이어 _fallbackNearbyMedian 폴백 이미 존재)
- trade_stats.pir/psr/jeonseRate 커버리지
- Vercel 12함수 제한 (대기)
- 행안부 API 복구 대기 (외부)

---

# 세션 89 — 2026-04-15

## 주요 작업

### 1. 세션88 이월 오류 정리
- "모바일 옵션 버튼 미작동"은 mibunyang이 아닌 타 프로젝트 건으로 확인 → CLAUDE.md 우선순위 1번에서 제거
- 커밋: `213da52 docs: 모바일 옵션 버튼 과제 제외 (타 프로젝트 건으로 확인)`

### 2. naver-units 만성 Rate Limit 대응 — post-naver-collect 2/4 단계 교체
- **문제**: 방금 실행한 naver-units 로그에서 7/54 진행 중 연속 20회 429 발생. fetch + Python curl_cffi 양 경로 모두 실패 → TLS 핑거프린팅이 아닌 **집 서버 IP 차단** 재확인 (세션83, 84, 87 반복)
- **해법**: 이미 존재하는 `molit-units.mjs`(국토부 공동주택 API)가 naver-units와 **동일한 타겟 쿼리**(`units<=1 OR unsold_rate>=100`)를 쓴다는 점 발견. 파이프라인 2/4 단계만 교체
- **변경 파일 3개**:
  - `scripts/post-naver-collect.sh`: 2/4 단계 `naver-units.mjs` → `molit-units.mjs`
  - `scripts/CLAUDE.md`: 파이프라인 표 + 쿼터 표 + 위험일 경고 갱신
  - `CLAUDE.md`: 다음 세션 우선순위에서 naver-units-night 제거, price/dataReliability 갭을 1번으로 승격
- **dry-run 결과**: 보정 대상 57건 중 16건 보정, 41건 실패, 9건 건너뛰기, API 53회 소비 — MOLIT API 정상 응답, IP 차단 이슈 없음
- **손대지 않은 것**:
  - `scripts/collectors/naver-units.mjs` 파일 자체 (향후 IP 해제/프록시 도입 시 복구 자산)
  - `.github/workflows/naver-units.yml` (별도 조사 필요)
  - `scripts/run-naver-local.bat`, `.sh`의 4/6 단계 (범위 초과, 다음 세션 별도 플랜)

### 3. 9 GATE + 5교차검증 (Review 의무 준수)
- **9 GATE(0~8)**: 🟢 7 / 🟡 2 / 🔴 0 → 실행 허가
  - 🟡 GATE1: `run-naver-local.*` 4/6 단계 미수정(의도적 범위 외)
  - 🟡 GATE8: 매월 10일이 월/목인 달 쿼터 근접 리스크
- **5교차검증 (병렬 Task)**:
  - 빌드: 메인 agent `npx vite build` 444~507ms 3회 PASS
  - 수집기 계약: **`collector-contract`** WARN (월/목-10일 쿼터 경고) → `scripts/CLAUDE.md` 위험일 표에 경고 추가로 해소
  - null 안전성: **`null-safety-checker`** PASS (scoring/engine.js:18, scoreRisk.js:17 등 전 소비처 가드 존재)
  - 스코어링: **`scoring-validator`** PASS (스코어링 코드 미수정, 불변식 자동 유지)
  - Hook/보안: 해당 없음(수집기 변경)

## 커밋 (2개 예정)
1. `213da52` docs: 모바일 옵션 버튼 과제 제외 (타 프로젝트 건으로 확인)
2. `fix(collectors): post-naver-collect 2/4 단계 naver-units → molit-units` (세션89 작업 커밋)

### 4. run-naver-local 배치 파일 4/6 단계도 molit-units 전환
- **배경**: 로컬 월/목 08:00 배치에서 4/6 naver-units가 IP 차단으로 실패하면 `.bat`는 `exit /b 1`, `.sh`는 `set -e`로 5/6, 6/6까지 중단됨 — post-naver-collect보다 더 심각한 상태였음
- **변경 2파일**:
  - `scripts/run-naver-local.bat` 39~45행: `naver-units.mjs` → `molit-units.mjs`, 실패 시 WARNING 처리(exit 제거), errorlevel 명시적 리셋(`verify >nul`) 추가. 같은 패턴의 3/6 naver-presale 블록에도 리셋 추가(기존 잠재 오탐 버그 일괄 해소)
  - `scripts/run-naver-local.sh` 36~37행: `naver-units.mjs` → `molit-units.mjs`, `|| echo WARNING` 추가(set -e 환경에서 비치명적 처리)
- **재검증**: `collector-contract` WARN 지적(.bat errorlevel 상속 위험) → `verify >nul` 리셋으로 해소. 쿼터는 월/목 하루 2회 molit-units 실행 시 ~106회로 한도 대비 미미
- **빌드**: `npx vite build` 604ms PASS

### 5. `.github/workflows/naver-units.yml` failure 조사 → 이미 해결된 문제
- **조사 결과**: 3월 18일 이후 실행 0건. 커밋 `346446a`("fix: Naver Units 스케줄 비활성화 — 한국 IP 필요")가 이미 근본 해결. 현재 yml은 `workflow_dispatch:` 수동 전용
- **실패 원인**: 네이버 API가 GitHub Actions 미국 IP의 JWT 발급을 차단 (yml 2~4행 주석에 이미 명시)
- **문서 불일치 해소**: `.github/workflows/CLAUDE.md`가 "매일 (3개)" 카테고리에 `naver-units.yml`을 포함 → "매일 (2개)" + 신규 "비활성(수동 전용, 1개)" 섹션으로 분리. 세션89에서 molit-units로 대체된 맥락도 주석 추가
- **추가 작업 불필요**: 코드·yml 수정 없음, 문서만 갱신

## 미해결 (다음 세션 이월)
- price 64% / dataReliability 57.4% 갭 보정 전략
- 행안부 API 복구 대기 (외부)

---

# 세션 88 — 2026-04-15

## 주요 작업 (Claude 설정 리뉴얼 전담 세션)

### 1. 에이전트/스킬/플러그인 전수조사 (3차 시도 끝에 정확화)
- 1차: `installed_plugins.json`의 `projectPath` 필드를 "소속"으로 오해 → "16개 전부 naver-estate-web 소속"이라 오진
- 2차: `~/.claude/plans/claude-config-renewal.md`(287줄) 존재를 놓침 → "사용자가 정리 안 해둠"이라 오진
- 3차: 파일 20개+ 실제 Read 후 진실 확정
  - **진실의 원천**: `~/.claude/settings.json`의 `enabledPlugins` (글로벌 8개) + 프로젝트 `.claude/settings.json`의 `enabledPlugins`
  - `installed_plugins.json`은 단순 설치 이력, `projectPath`는 자동 설치 시점 cwd 메타
  - 공식 마켓플레이스 플러그인은 Claude Code 첫 실행 시 자동 설치 (`officialMarketplaceAutoInstalled: true`)
  - 에이전트 이름 충돌은 Claude Code가 `플러그인명:에이전트명`으로 자동 네임스페이싱 처리

### 2. mibunyang 프로젝트 스코프 enabledPlugins 추가
- 파일: `f:/mibunyang/.claude/settings.json`
- 추가: `engineering@knowledge-work-plugins`, `data@knowledge-work-plugins`, `session-report@claude-plugins-official`
- 근거: mibunyang CLAUDE.md가 참조하는 `/engineering:debug`, `/data:sql-queries` 등이 글로벌 enable에 없어 실제 호출 불가 상태였음
- 패턴: sangse-agent가 이미 `feature-dev`/`frontend-design`을 프로젝트 스코프로 선언한 것과 동일
- 거버넌스: 글로벌 `~/.claude/settings.json`은 그대로 유지(8개), 프로젝트 로컬에만 3개 추가
- 백업: `f:/mibunyang/.claude/settings.json.bak-20260415-enablepluginadd`

### 3. scoring-validator.md 정확성 보강 (36줄 → 103줄)
- `src/scoring/CLAUDE.md` 실제 표와 대조해 오류 수정:
  - PROFILES 이름 추측("균형/가성비/투자/실거주/학군") → 실명 `live/invest/newlywed/edu/retire`
  - 가중치 합 "100 또는 1.0" 모호 표현 → 층위별 정확한 기준 (PROFILES=100, scoreProduct=100, 내부 서브=1.00)
  - PSR 특수 케이스 (psr < 0.7 → 100 초과 가능) 명시
  - 검증 절차 1번에 `src/scoring/CLAUDE.md` 먼저 Read 강제
- 백업: `f:/mibunyang/.claude/agents/scoring-validator.md.bak-20260415`

### 4. mibunyang CLAUDE.md Review 섹션 의무화
- 기존: "5교차검증 병렬 에이전트"라고만 나열 → 호출 방법 불명확
- 변경: 각 축에 구체적 Task 호출 명시
  - 스코어링: `Task(subagent_type="scoring-validator")` **필수**
  - null: `Task(subagent_type="null-safety-checker")` **필수**
  - 수집기 변경 시: `collector-contract` 추가
  - 빌드/Hook/보안: 메인 agent 직접 검사 (의도된 설계)
- 추가 규칙: 전용 에이전트가 있는 축을 메인 agent가 직접 검사하는 것 **금지**
- SESSION_LOG 교차검증 섹션에 어느 에이전트가 찍었는지 기록 의무 추가
- 백업: `f:/mibunyang/CLAUDE.md.bak-20260415`

### 5. 글로벌 CLAUDE.md 재발 방지 섹션 추가
- 파일: `~/.claude/CLAUDE.md`
- 새 섹션: `## 진단 전 파일 직접 확인 (설렁설렁 읽기 금지)`
- 내용:
  - 질문 종류별 필수 확인 파일 매트릭스 (플러그인/에이전트/스킬/MCP/설정 이력/메타)
  - 네임스페이스·진실의 원천 규칙 (installed_plugins.json은 이력, enabledPlugins가 진실)
  - 4단계 설렁설렁 방지 체크리스트
  - 이번 세션 3회 연속 오진 사건 기록 (재발 방지용)
- 추가로 "설명 방식 (쉬운 말 원칙)" 섹션도 이미 존재 → 확인만
- 백업: `~/.claude/CLAUDE.md.bak-20260415`

### 6. 메모리 업데이트
- `projects/f--mibunyang/memory/feedback_easy_explanation.md` 신규 — 쉬운 말은 사용자 대화용, 코드/파일명/명령은 원문 정확히 (2회 지적 후 정정)
- `MEMORY.md` 인덱스에 1줄 추가

### 7. hookify 플러그인 설치 (세션 중반)
- `claude plugin install hookify@claude-plugins-official`
- 현재 scope: local, enabled
- `conversation-analyzer` 에이전트 등록 확인
- 실제 hook 작성은 다음 세션 이월

## 커밋 (2개, 이번 세션)
1. `77a8e0e` docs: CLAUDE.md 스킬 섹션 확장 + 분류 정정 (세션 초반)
2. `121cb26` docs+chore: 로컬 에이전트 Task 호출 의무화 + scoring-validator 정확성 보강 + engineering/data/session-report 활성화

(`f314dd1` "Claude Code 로컬 설정 리뉴얼"은 세션87 이월분)

## 교차검증 결과
- 이번 세션은 코드(src/) 변경 없음 — 5교차검증 해당 없음
- 변경 파일: CLAUDE.md, .claude/settings.json, .claude/agents/scoring-validator.md (문서·설정만)
- JSON 유효성 검증: `python -c "import json; json.load(...)"` PASS
- 마크다운 grep 검증: 핵심 키워드 모두 기대 위치에 존재

## 이번 세션에서 학습한 것 (자기 반성)
- "파일을 실제로 Read하지 않고 메타데이터만으로 추측"하는 실수를 3회 연속 반복
- 설렁설렁 읽기 방지를 위한 **체크리스트를 글로벌 CLAUDE.md에 박음** — 규칙 의존 말고 체크리스트 실행 의존
- "진실의 원천 파일"과 "이력/메타 파일"을 구분하는 습관 체화 필요

## 다음 세션 권장 순서
1. 🔴 **모바일 옵션 버튼 재개** (세션87부터 이월, 최우선)
   - 사용자에게 재현 정보 확인: (a)어느 버튼 (b)증상 (c)환경 (d)언제부터
2. 새 `enabledPlugins` 검증: `claude plugin list`로 engineering/data/session-report가 mibunyang에서 enabled로 뜨는지 확인
3. 5교차검증 실제 호출 테스트: 다음 커밋 때 `Task(subagent_type="scoring-validator")`가 진짜 불리는지 관찰 + SESSION_LOG에 기록 확인
4. naver-collect 완료 후 post-naver-collect.sh 실행
5. naver-units-night 02:00 로그 확인
6. price 64% / dataReliability 57.4% 갭 보정 전략
7. 행안부 API 복구 대기

---

# 세션 87 — 2026-04-13

## 주요 작업

### 1. 모바일 옵션 버튼 미작동 — 조사 착수 (미완)
- 1순위 이월 과제. 플랜 모드에서 SearchFilterBar/FilterButton/FilterDropdown/App.jsx/HeaderSection 읽기 완료
- Explore 에이전트 1차 가설(mousedown 리스너 미지원)은 **기각** — mousedown은 드롭다운 외부 탭 닫기용이며, 버튼이 열리지 않는 현상과 직접 관련 없음
- 직접 검증 결과: FilterButton은 isDesktop 분기 없이 순수 React `<button onClick>` 사용. 코드상 모바일 전용 버그 지점이 특정되지 않음
- 가능 후보 (미검증): BottomNav/토스트 z-index 겹침, 부모 wrapper pointer-events, 안드로이드 특정 브라우저 이벤트 경합, 사용자가 말하는 "옵션"이 다른 UI 요소일 가능성
- 재현 조건 질의 시도 → 사용자가 중단 요청 → 조사 중단
- **다음 세션 행동**: 사용자에게 재현 단계/환경/"옵션 버튼"의 정확한 지칭 확인 후 재개

### 2. 세션 마무리
- 작업 트리 clean, 코드 변경 없음
- SESSION_LOG 업데이트 + CLAUDE.md 진행 상황 갱신

## 미해결 (다음 세션 이월)
- 🔴 **모바일 옵션 버튼 미작동** — 사용자 재현 정보 필요 (증상/환경/버튼 위치)
- naver-collect.py 완료 후 post-naver-collect.sh 실행
- naver-units-night 02:00 첫 실행 결과 확인 (scripts/naver-units-night.log)
- 행안부 API 복구 대기
- price 64% / dataReliability 57.4% 갭 보정 전략

## 커밋 (0개)
- 코드 변경 없음 — 문서 커밋만 예정

---

# 세션 86 — 2026-04-13

## 주요 작업

### 1. 데이터 파이프라인 건강 체크
- naver-collect.py 진행 확인: 5250/29699 (17.7%), 429 발생 4건만 — 의도된 속도(308건/시간) 정상 동작
- naver-units-night schtasks 누락 확인 → 재등록 (daily 02:00, State=Ready)
- 행안부 API curl 직접 테스트: transMovStats(500) + stdgPpltnHhStus(502) 모두 다운 → 행안부 측 인프라 장애 확정 (우리 키/코드 문제 아님)

### 2. 세션85 "0% 보고" 정정
- 실제 DB 측정: unsoldRate **61.4%** (875/1424), subwayDist **79.0%** (1125/1424)
- subwayDist 9999인 21%는 거제/군산/석림/순천/안성/제천/평택 등 — **반경 10km 내 실제 지하철 없음**(정상)
- 데이터 수집 자체는 100% 완료된 상태, 보정 작업 불필요

### 3. CLAUDE.md "현재 진행 상황" 보정
- 잘못된 0% 수치 → 정확한 품질 지표 7개 (units 98.4%, lat 99.9%, price 64.0%, unsold 61.4%, subway 79.0%, dataReliability 57.4%)
- 다음 세션 우선순위 갱신

### 4. 9 GATE 사전 검증
- 🟢6 / 🟡3 / 🔴0 → 실행 허가
- GATE 5(보안): .env.local은 .gitignore `.env.*`로 추적 안됨 → 안전

## 미해결 (다음 세션 이월)
- **모바일 옵션 버튼 미작동** — 사용자 신고. SearchFilterBar 모바일 인터랙션 디버깅 필요. 이번 세션에서 조사 미착수.
- **price 64% / dataReliability 57.4%** — 가장 큰 데이터 갭, 보정 전략 필요

## 커밋 (1개)
1. `fab417d` docs: 세션86 — DB 품질 지표 정정 + naver-units 심야 스케줄 재등록

## 검증
- 빌드: vite build 435ms ✅
- 커밋: 1건, push 완료
- 행안부 API 502/500 지속 — 외부 의존성, 대기

---

# 세션 85 — 2026-04-13

## 주요 작업

### 1. MOIS_POP_KEY 상태 확인
- data.go.kr 3개 API 모두 키 유효 (2028-03-10~25까지)
- 행안부(1741000) API: HTTP 502 Bad Gateway — 서버 장애 (키 만료 아님)
- 30분 자동 체크 설정 (ScheduleWakeup)

### 2. naver-units 429 테스트 + 심야 스케줄
- `--dry-run --limit=3`: 3건 모두 429 (fetch + curl_cffi 전부 실패)
- Windows Task Scheduler 심야(02:00 KST) 자동 실행 등록
- 작업명: `naver-units-night`

### 3. naver-collect.py 전체 재실행
- 29,699건 단지 대상 전체 수집 시작 (백그라운드)
- 150/29,699건 진행 확인 (4,105 매물 수집)
- Python stdout 버퍼링 이슈: `PYTHONUNBUFFERED=1` + tee로 해결

### 4. 프로젝트 건강 체크
- 테스트: 146파일 2,270개 전부 통과 (50.36초)
- 린트: 0 에러, 85 경고 (warn 수준)
- 빌드: vite build 성공 (423~926ms)

### 5. DB 데이터 품질 점검
- units: 100%, lat/lng: 99.9%, builder: 99.8%, schoolScore: 94.9%
- price/pp/area: 64.0% (가격 미공개 단지)
- unsold_rate: 0% (naver-units 보정 필요)
- subway_dist: 0% (인프라 수집 미완)
- dataReliability: avg 82.5, median 92, ≥70: 709/1,000건
- 이상값: units<=0: 0건

### 6. CLAUDE.md 정정
- "MOIS_POP_KEY 만료 확정" → "행안부 API 서버 장애 (키 유효)"
- 세션85 진행 상황 + 다음 작업 업데이트

## 커밋
- (세션 진행 중 — naver-collect.py 완료 후 최종 커밋 예정)

## 교차검증 결과
- 빌드: 423ms 성공
- 테스트: 2,270개 통과
- 린트: 0 에러
- 스코어링: 세션84에서 1,424건 완료 (변경 없음)

## 9 GATE 검증
- 파이프라인 플랜: 🟢8, 🟡1, 🔴0 → 실행 허가
- 개선 작업 플랜: 🟢9, 🟡0, 🔴0 → 실행 허가

## 다음 세션 권장
1. naver-collect.py 완료 확인 → post-naver-collect.sh 실행
2. naver-units 심야(02:00) 결과 확인 → unsold_rate 보정
3. 행안부 API 복구 확인 → migration.mjs --dry-run
4. subway_dist 수집 파이프라인 점검

---

# 세션 84 — 2026-04-11

## 주요 작업

### 1. 환경 사전 검증 (단계 0)
- 환경변수 4개(SUPABASE_URL, SUPABASE_SERVICE_KEY, MOIS_POP_KEY, KOSIS_KEY): 전부 OK
- alias-loader.mjs: Node 24에서 `--loader` 정상 동작 (deprecated 경고만)
- Supabase 연결: apartments 2,001건 확인

### 2. naver-units 실행 테스트 (단계 1)
- `--limit=5` 실행: 5건 모두 Rate limit (적응형 인터벌 5→7.5→10→12.5→15초 정상 동작)
- 한국 IP 확인 (182.228.191.24)
- 보정 대상: 441→54건으로 감소 (molit/applyhome 등에서 보정됨)
- 결론: 코드 레벨 Rate Limit 정상이나, 네이버가 IP/JWT 기반 차단 강화

### 3. compute-scores 실행 (단계 2) — 성공
- dry-run: 1,424건 전부 스코어링, 스킵 0건, 6개 카테고리 정상 (3.2초)
- 실제 실행: 1,424/1,424건 DB UPDATE 완료 (실패 0건, 9.1초)
- alias-loader 세션83 수정 완벽 검증

### 4. transMovStats API 키 확인 (단계 3)
- curl 테스트: 2024-06, 2025-01, 2025-12, 2026-01 전부 HTTP 500
- 응답: "Unexpected errors" → MOIS_POP_KEY 만료 확정
- KOSIS API: HTTP 200 정상 (3/23 실패는 일시적)
- 대응: data.go.kr 포털에서 키 갱신 필요 (다음 세션)

### 5. post-naver-collect.sh 안정성 수정 (단계 4)
- naver-units 단계를 `if-else` 명시적 분기로 변경 (비치명적 처리)
- `set -e`에 의존하지 않음 (Windows Git Bash 호환성)
- 구문 검증 통과 (`bash -n`)

### 6. 전체 파이프라인 실행 (단계 5) — 진행 중
- sync-naver-complex: Phase 1 갱신14, Phase 2 매물44, Phase 3 시세1986건
- Phase 4 관리비/방향 집계: 장시간 실행 중 (63K complexes articles 처리)
- 빌드: 380ms 성공

### 7. Vercel 배포 복구 (긴급)
- 원인: auth/refresh.js 추가(세션81)로 Serverless Functions 13개 → Hobby 12개 초과
- 11시간 동안 배포 실패 상태 (모든 커밋 Error)
- 해결: auth/refresh→auth/verify?action=refresh 통합 (12개 유지)
- .vercelignore: requirements.txt/scripts/*.py 제외 추가 (Python 빌드 방지)
- 배포 성공 확인 (Ready, 17s)

### 8. naver-units Python curl_cffi fallback
- fetch 3회 429 시 Python naver-fetch-proxy.py subprocess로 재시도
- Windows python3→python 자동 감지
- 테스트 결과: **curl_cffi도 동일 429** → TLS 핑거프린팅이 아닌 IP 기반 차단
- 코드 자체는 정상 동작 (심야 재시도 필요)

## 커밋 (5개)
1. `ee20815` fix: post-naver-collect.sh — naver-units 실패 시 파이프라인 계속 진행
2. `472542b` docs: 세션84 — 파이프라인 실행 테스트 + CLAUDE.md 업데이트
3. `d5678e8` fix: Vercel 배포 에러 수정 — requirements.txt/Python 파일 제외
4. `3129213` fix: Vercel Hobby 12함수 제한 복구 — refresh→verify 통합
5. `cdc44d8` feat: naver-units Python curl_cffi fallback 추가

## 교차검증 결과
- 빌드: 503ms 성공
- Vercel 배포: Ready 확인
- 스코어링: compute-scores 1,424건 전부 성공
- console.log: 0건
- 보안: PASS

## 9 GATE 검증 (2회 실행)
- 파이프라인 계획: 🟢6, 🟡3, 🔴0 → 실행 허가
- 후속개선 계획: 🟢7, 🟡2, 🔴0 → 실행 허가

## 다음 세션 권장
1. data.go.kr MOIS_POP_KEY 갱신 (브라우저 → 마이페이지 → 연장 신청)
2. naver-units 심야 실행 (02:00~05:00 KST, IP Rate Limit 해제 대기)
3. Vercel 12함수 — 새 API 추가 시 action 파라미터 통합 필수

---

# 세션 83 — 2026-04-11

## 주요 작업

### 1. compute-scores.mjs ESM 로더 이슈 해결
- alias-loader.mjs: 상대 경로 확장자 자동 해석 추가 (`./foo` → `./foo.js`)
- engine.js의 7개 extensionless import 해결 (scorePrice, scoreLocation 등)
- 검증: `calcCats` import 성공 + vite build 408ms 통과

### 2. naver-units.mjs 적응형 Rate Limit
- 기본 인터벌 3→5초, 백오프 [5,10,20]→[8,15,30]초
- 429 연속 시 적응형 인터벌 증가 (최대 15초), 성공 시 감쇠
- 구문 검증 통과 (실제 실행은 로컬 한국IP에서 확인 필요)

### 3. migration.mjs 데이터 가용성 테스트
- dry-run 실행 → HTTP 500 (2026년 1월)
- 2024년 6월 데이터로도 HTTP 500 → API 서버 자체 장애 또는 MOIS_POP_KEY 만료
- 대응: data.go.kr에서 transMovStats API 구독 상태/키 갱신 필요

## 커밋 (1개)
1. `df98ca5` fix: ESM 로더 상대경로 해석 + naver-units 적응형 Rate Limit

## 교차검증 결과
- 빌드: 408ms 성공
- 스코어링: 5개 프로필 합계 100 확인
- null 안전성: PASS
- Hook 규칙: PASS (Node 스크립트, React 훅 없음)
- 보안: PASS

## 9 GATE 검증 (계획 단계)
- 🟢7, 🟡2, 🔴0 → 실행 허가

## 다음 세션 권장
1. naver-units 로컬 실제 실행 (월/목 08:00)
2. compute-scores 실제 실행 (Supabase 데이터 대상)
3. data.go.kr transMovStats API 키 갱신/구독 확인
4. post-naver-collect.sh 전체 파이프라인 재실행

---

# 세션 82 — 2026-04-11

## 주요 작업

### 1. 네이버 후처리 (post-naver-collect.sh)
- rm naver.pid (stale 정리) → post-naver-collect.sh 실행
- 1/4 sync-naver-complex: 성공 (Phase1 갱신3, Phase2 45건, Phase3 1986건, Phase4 9734건)
- 2/4 naver-units: 실패 (50건 전부 rate limit → 검색 결과 없음)
- 3/4 collect-unsold-kosis: 성공 (492건 KOSIS 응답, regions 352건, apartments 235건 갱신)
- 4/4 compute-scores: 실패 (scorePrice 모듈 미발견 — ESM 로더 기존 이슈)

### 2. 폰트 가독성 Phase 3-7 완료 (feat/font-size 브랜치 → main 머지)
- Phase 3: CompareSheet (17건 fontSize → F 상수)
- Phase 4: 필터 6파일 (7건)
- Phase 5: 섹션 8파일 (71건)
- Phase 6: 전문가 9파일 (46건)
- Phase 7: 관리자 3파일 (78건) + 기타 11파일 (88건)
- 합계: 38파일, ~307건 fontSize 하드코딩 → F 상수 전환
- Phase 0-2 포함 전체 컴포넌트 폰트 통일 완료

### 3. 관리자 일괄 승인/거부 기능
- api/admin/review.js: emails[] 배열 지원 (최대 50건, 직렬 처리, 하위호환)
- useAdminMode.js: selectedEmails/batchLoading + handleBatchReview + 탭 전환 시 초기화
- AdminDashboard.jsx: pending 카드 체크박스 + 전체선택 + 일괄 승인/거부 버튼
- 테스트 6+3=9케이스 추가 (배치 정상/부분실패/빈배열/초과/UI)

## 커밋 (4개)
1. `2255123` feat: 폰트 가독성 개선 Phase 3-7 — 38개 컴포넌트 F 상수 전환 (feat/font-size)
2. `69011cb` feat: 관리자 일괄 승인/거부 — review API 배열 지원 + 체크박스 UI (main)
3. `d62387f` Merge branch 'feat/font-size' (main)

## 교차검증 결과
- 빌드: 413-488ms 성공
- 스코어링: 5개 프로필 합계 100 확인
- null 안전성: PASS
- Hook 규칙: PASS
- 보안: PASS
- 테스트: 43개 전부 통과

## 9 GATE 검증 (계획 단계)
- 🟢2, 🟡7, 🔴0 → 실행 허가
- 보완 7건 반영 후 구현 (탭 전환 초기화, 배치 응답 형식, 전체선택 범위 등)

## 다음 세션 권장
1. compute-scores.mjs ESM 로더 이슈 해결 (scorePrice 모듈 경로)
2. naver-units.mjs rate limit 해결 (또는 molit-units로 대체)
3. migration.mjs (행안부 API 2026년 데이터 제공 시)

---

# 세션 81 — 2026-04-10

## 주요 작업

### 1. Supabase 1000행 제한 근본 해결
- _shared.mjs: selectAll() 공유 페이지네이션 헬퍼 추가
- 9개 수집기 적용: collect-building-hub, collect-applyhome, molit-building-info, collect-maintenance, molit-units, dart-builders, naver-listings, calc-exclusive-ratio (+prices 쿼리)
- molit-units.test.mjs: mock에 .range() 추가

### 2. 자동 로그인 (B안 — localStorage + refresh token)
- api/_lib/auth.js: createRefreshToken + verifyRefreshToken 추가 (30일 TTL)
- api/auth/refresh.js: 신규 엔드포인트 (rotation — 사용 시 이전 토큰 블랙리스트)
- api/auth/login.js + kakao.js: refreshToken 함께 발급
- useExpertMode.js: sessionStorage → localStorage + verify 실패 시 자동 갱신
- useKakaoAuth.js + App.jsx: localStorage 전환
- api/auth/logout.js: refresh token도 블랙리스트
- Vercel Hobby 12함수 제한 유지 (정확히 12개)

### 3. 폰트 가독성 개선 Phase 0-2 (feat/font-size 브랜치)
- theme/index.js: F 상수 추가 (micro=10, xs=11, sm=12, base=14, md=15, lg=16, xl=18, xxl=20)
- AptCard: 본문 12→14px, 라벨 10-11→12px, 버튼 12→14px
- Primitives: 차트 축 8-9→10px, 툴팁 10→11px
- CatPanel: 카테고리 라벨 13→15px, 값 12→14px
- DetailModal: 제목 16→16/18px, 본문 12→14px, 버튼 13→14/15px
- tableStyles + filterStyles: F 상수 전환

### 4. 기타
- .claudeignore 생성 (package-lock.json, .github/, playwright.config.js, vercel.json)
- QMD 설치 시도 → Windows node-llama-cpp 빌드 실패 → 삭제
- naver-collect.py 재실행 (19,200/29,727 = 64.6% 진행 중)
- building-hub 재실행 (2,000건 전체 대상 — selectAll 적용, 전부 스킵)

## 커밋 (3개)
1. `b198098` fix: Supabase 1000행 제한 근본 해결 — selectAll 공유 헬퍼 + 9개 수집기 적용
2. `8e2b5b7` feat: 자동 로그인 — localStorage + refresh token rotation (30일)
3. `aea73a5` feat: 폰트 가독성 개선 Phase 0-2 (feat/font-size 브랜치)

## 교차검증 결과
- 빌드: 354-400ms 성공
- 테스트: 146파일 2,261개 전부 통과
- null 안전성: PASS
- 보안: PASS

## 다음 세션 권장
1. 네이버 수집 완료 확인 → post-naver-collect.sh 실행
2. 폰트 Phase 3-7 이어서 (feat/font-size 브랜치)
3. migration.mjs (행안부 API 2026년 데이터 제공 시)
4. 관리자 일괄 처리 (승인/거부)

---

# 세션 80 — 2026-04-10

## 주요 작업

### 1. 네이버 전체 재수집 (Priority 1)
- naver-collect.py: nohup + python -u (unbuffered) 백그라운드 실행
- python3 → python 경로 이슈 해결 (Windows Store 리다이렉터)
- 29,727 complex 대상 전체 수집 진행 중

### 2. 개선 백로그 (Priority 2)
- useDataPipeline.test.js: 신규 29개 테스트 (renderHook + vi.mock, 정렬/필터/페이지네이션/폴백)
- WeightEditor.jsx: memo() 래핑 + AdminDashboard named→default import 전환
- api/_lib/apartmentValidation.js: parseApartmentIds + ID_PATTERN 공유 모듈 추출
- api/_lib/apartmentValidation.test.js: 13개 테스트 (정상/에러/injection/경계값)
- prices.js, unsold-history.js: 검증 중복 제거 → apartmentValidation import

### 3. building-hub 재실행 (Priority 3)
- data.go.kr API 상태 확인 (정상 응답)
- collect-building-hub.mjs nohup 실행 (대상 1000건)

### 4. CLAUDE.md 리뉴얼
- 212줄 → 155줄 (27% 감소): 중복 제거, 주제별 그룹화, 환경변수 테이블
- 하네스 엔지니어링 규칙 추가 (Plan→Guard→Work→Review)

## 커밋 (1개)
1. `f9e2ad0` feat: useDataPipeline 테스트 + WeightEditor memo + validation 추출

## 교차검증 결과
- 빌드: 393ms 성공
- 테스트: 4파일 55개 전부 통과
- 스코어링: 5개 프로필 합계 100 확인
- null 안전성: PASS
- Hook 규칙: PASS
- 보안: PASS

## 게이트 검증 (9 GATE)
- 🟢 8 / 🟡 1 / 🔴 0 → 실행 허가

## 다음 세션 권장
1. 네이버 수집 완료 확인 후 sync-naver-complex.mjs 재실행
2. migration.mjs (행안부 API 2026년 데이터 제공 시)
3. 관리자 일괄 처리 (승인/거부)

---

# 세션 79 — 2026-04-09

## 주요 작업

### 1. 비로그인 전환율 Analytics (Priority 3)
- LoginPromptModal: trigger prop + trackEvent 4개 (shown/kakao_click/expert_click/dismissed)
- App.jsx: loginTrigger 상태 (detail/map 트리거 구분)
- 테스트 6건 신규

### 2. 관리자 검색/페이지네이션 (Priority 2)
- api/admin/users: q/limit/offset 쿼리 + total 응답 + 서버 sanitize
- useAdminMode: searchQuery/page/totalUsers + 300ms 디바운스
- AdminDashboard: 검색 입력 + 페이지네이션 UI + 빈 검색결과 메시지
- 테스트 8건 추가

### 3. Vercel 배포 복구 (긴급)
- 원인: admin/stats.js 추가로 13개 함수 → Hobby 12개 제한 초과 (세션78부터 8건 연속 ERROR)
- 해결: admin/stats → admin/users?action=stats 통합, .vercelignore 추가
- 결과: READY 상태 복구 확인 (Vercel API)

### 4. 네이버 재수집 + 1000행 제한 해소
- naver-collect.py: SB.select 페이지네이션 (PostgREST 1000행 → 2001건 전체)
- sync-naver-complex.mjs: apartments/articles 4곳 페이지네이션 + Phase4 matchApartments 매칭 수정
- 수집 결과: complexes 29,727건, articles ~11,458건 (1,250/29,727 complex 처리 후 프로세스 종료)
- sync 결과: Phase1 453건, Phase2 38건, Phase3 1,986건, Phase4 9,435건

### 5. 개선 리포트 (하네스 5관점)
- 14건 발견: 🔴2(모두 해결) / 🟡7 / 🟢5
- 주요: npm audit 0건, TODO 0건, 순환의존성 없음

## 커밋 (4개)
1. `66f54cc` feat: 관리자 검색/페이지네이션 + 비로그인 전환율 Analytics
2. `365a33c` fix: Vercel Hobby 12함수 제한 복구 + naver-collect 페이지네이션
3. `9de9241` fix: sync-naver-complex 페이지네이션 + Phase4 매칭 수정
4. `4ec97a0` docs: CLAUDE.md 세션79 최종 업데이트

## 발견한 이슈
- Supabase PostgREST 기본 1000행 제한이 naver-collect.py + sync-naver-complex 양쪽에 영향
- Vercel Hobby 12 Serverless Functions 한계 — 향후 API 추가 시 통합 필수
- naver-collect.py articles 수집이 29,727 complex 중 1,250에서 중단 (프로세스 종료)

## 다음 세션 권장
1. naver-collect.py 전체 재실행 (--limit 없이, nohup으로 12시간+ 실행)
2. building-hub 재실행 (data.go.kr API 정상화 후)
3. 🟡 개선 백로그: useDataPipeline 테스트, WeightEditor memo(), API 검증 중복 제거
