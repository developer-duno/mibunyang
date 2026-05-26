# DB 품질 스냅샷

> 측정일별 누적. `/db-quality` 슬래시 커맨드 결과 append.
> CLAUDE.md 본문에 측정값 두지 말 것 — 전부 이 파일

---

## 2026-05-26 전수 재측정 (세션 318 — data-audit.mjs --json 1회 실행)

`node scripts/collectors/data-audit.mjs --json` 실행 결과 (2026-05-26T09:18:49Z).

### 헤더
- **apartments 2,001건** (변동 0, 30일+ 신규 0)
- **평균 dataReliability 92** (4/20 박힘 80 → +12 개선, 0~100 척도)

### 19 카테고리별 충족률 (`filled / total`, %)

| 카테고리 | 충족률 | 비고 |
|---|---|---|
| `core` | 21,983 / 26,013 (84.5%) | 핵심 메타. `district` 72/2001 (3.6%) 만 낮음 |
| `price` | 5,401 / 6,003 (90%) | area / price / pp 3 컬럼 |
| `building` | 18,349 / 24,012 (76.4%) | 12 컬럼. energyGrade 358 (17.9%), exclusiveRatio 871 (43.5%) 잔여 NULL |
| `maintenance` | 1,572 / 10,005 (15.7%) | 세션 319 workflow_dispatch 1회 (run 26450043464, cancelled 1h0m15s) 부분 박힘 = 9→217 (10.8%) maint_heat 추가. 5/17 매칭 정정 효과 확인 (이전 1% → 15.7%, +14.7pt). 잔여 = timeout 60→120 정정 후 다음 cron 6/15 자동 누적 |
| `risk` | 3,961 / 4,002 (99%) | isRegulated 100% / dsr40pass 1960/2001 (97.9%) |
| `benefits` | 0 / 10,005 (0%) | **5 컬럼 100% NULL — 의도된 미수집** (시행사 자료 운영자 수기 입력) |
| `infra` | 29,997 / 34,017 (88.2%) | 17 컬럼 카카오 |
| `transport` | 8,681 / 14,007 (62%) | 7 컬럼. tago 일부 NULL |
| `schools` | 5,980 / 6,003 (99.6%) | 3 컬럼 NEIS |
| `builders` | 342 / 6,003 (5.7%) | **DART 매칭률 낮음** — 시공사명 매칭 한계 |
| `regions` | 4,231 / 16,008 (26.4%) | 9 컬럼 (세션 322 households 30% / 세션 323 economy 4 컬럼 grdp_per_capita+education_cost+education_participation+unemployment_rate 0→79/758 박힘 + housing-supply-ratio re-confirm 79/758). avg_income / supply_ratio / jeonse_rate / avg_price 잔여 NULL. 매월 cron 누적 시 households 90%+ 도달 예상 |
| `trade_stats` | 23,101 / 26,013 (88.8%) | 13 컬럼 trade-stats |
| `naver` | 11,511 / 20,010 (57.5%) | 10 컬럼 로컬 전용 수집 |
| `environment` | 8,498 / 10,005 (84.9%) | 5 컬럼 |
| `future` | 2,453 / 8,004 (30.6%) | 4 컬럼. cityDev 186 (9.3%) / industryDev 225 (11.2%) 만 낮음 |
| `energy` | 1,741 / 6,003 (29%) | 3 컬럼 building-hub |
| `competition` | 3,787 / 6,003 (63.1%) | 3 컬럼 청약홈 |
| `air` | 2,001 / 2,001 (100%) | AIRKOREA 정상 |
| `safety` | 7,901 / 10,005 (79%) | 5 컬럼. emergencyName/Type 1000/2001 (50%) |

### 17 시도별 평균 충족률

| 시도 | apartments | 평균 충족률 |
|---|---|---|
| 경기 | 690 | 66.1% |
| 서울 | 431 | 65.9% |
| 인천 | 184 | 67.6% |
| 부산 | 115 | 64.8% |
| 대구 | 78 | 69.8% |
| 대전 | 76 | 68.9% |
| 충북 | 56 | 59.9% |
| 광주 | 55 | 68.2% |
| 충남 | 48 | 65.0% |
| 전남 | 44 | 60.3% |
| 세종 | 41 | 59.3% |
| 울산 | 41 | 62.9% |
| 경남 | 37 | 64.8% |
| 경북 | 35 | 60.2% |
| 강원 | 34 | 57.0% |
| 전북 | 22 | 59.8% |
| 제주 | 14 | 53.0% |

→ 제주 53% / 강원 57% 가 최저. 대구 69.8% 최고. 상위 - 하위 차 16.8pt.

### 주요 NULL 잔여 (다음 collector 작업 우선순위)

🔴 **충족률 < 10%** (보강 필요):

- `maintenance.*` 5 컬럼 (1%) — collect-maintenance 동작 검증 의무
- `benefits.*` 5 컬럼 (0%) — 의도된 미수집 (운영자 수동)
- `builders.*` 1 컬럼 (5.7%) — DART 매칭 알고리즘 개선
- `future.cityDev` (9.3%) — manual 수집, 박힘값 의존

🟡 **충족률 10~30%** (다음 우선순위):

- `regions.*` 12개 컬럼 종합 25% — 시군구 단위 KOSIS 미수집 영역
- `energy.*` (29%) — building-hub 부분 응답
- `future.industryDev` (11.2%)

🟢 **충족률 > 90%** (양호):

- core 84.5% / price 90% / risk 99% / schools 99.6% / air 100% / trade_stats 88.8% / infra 88.2%

### 4/20 → 5/26 변화 (Δ)

| 지표 | 4/20 | 5/26 | Δ |
|---|---|---|---|
| apartments | 2,001 | 2,001 | 0 |
| avg dataReliability | 80 (≥80 94%) | 92 | +12 |
| regions 행 | 454 | 790 | +336 (세션 285 효과) |
| price 충족률 | 64% | 90% | +26pt |
| schools 충족률 | 100% | 99.6% | -0.4pt (소폭 NULL 발생) |
| maintenance 충족률 | 1% (5/26 첫 측정) | 15.7% (5/26 후속) | +14.7pt (세션 319 workflow_dispatch 1회 부분 박힘, cancelled 60분 timeout) |
| regions.households | 0/758 (0%) | 229/758 (30%) | +30pt (세션 322 `2f1ab7e` population.mjs hhCnt 누락 fix, run 26466366919 success 6m51s. 매월 cron 누적 시 미래 90%+ 자연 도달 자연 예상) |

### 4 핵심 + 19 카테고리 + 17 시도 + 51 필드 = 전수 완료

> 다음 전수 재측정 = 7일 후 또는 collector 대규모 변경 후. 답습 자산 = `/db-quality` 슬래시 커맨드 결과.

---

## 2026-05-21 부분 재측정 (세션 286 — 옵션 A md 정리 통합)

세션 284 (regions 행 정리) + 세션 285 (`78a862d` population.mjs 세 사고 정정) 누적 효과 4 핵심 지표 + 부분 표본 실측.

### regions (790 행, 이전 박제 454 → +336 누적)
- 자치구 행 (`gu` like '% %') 41 / pop_growth 채워진 35 (세션 285 효과)
- 신규 시도 단위: 세종 391072 / 강원 1506843 / 전북 622915 (이전 NULL)
- 잔여 NULL: 화성시 4 자치구 + 중복 행 (다음 세션 후속 자리)

### apartments / apartments_flat (변동 0)
- apartments **2,001건**
- apartments_flat VIEW **1,424건** (dedup 577건 제외)

### schools
- schools **1,994건** (이전 박제 1,971 → +23 차이, 신규 수집 자리)
- school_score (표본 1000) **1000/1000 (100%)**

### regions.childcare
- 채워진 **606 / 790 (76.7%)** (이전 박제 606/770 → 분모 갱신, regions 790 전환 반영)

### 부분 표본 (1000 행) — 다음 전수 재측정 자리
- apartments.air_quality (표본 1000): **998/1000 (99.8%)**
- apartments.cats_cache NULL (표본 1000): **1/1000 (0.1%)**

> 4 핵심 + 2 부분 표본 재측정. 전수 재측정 = `/db-quality` 슬래시 또는 별도 세션 의무. trade_stats / regions.population 비율 / schools.nearby_schools / timeseries 행 수 미박제.

---

## 2026-04-20 전수 재측정 (세션133, 세션135 페이지네이션 보정)

### apartments / apartments_flat
- apartments **2,001건** → apartments_flat VIEW **1,424건** (dedup 577건 제외)
- apartments.cats_cache NULL **7건 (0.3%)**, apartments_flat.catsCache NULL **0건**
- price = 0 **0건** (세션99 오염 버그 해소 유지), price NULL **38건 (2.7%)**
- dataReliability ≥80 **1,338건 (94.0%)** — 세션97 이후 소폭 개선 (1,317→1,338)
- **apartments_flat "(오)" 23→17건** — 세션134 migration 반영 완료. 일반분양 본체 6건이 VIEW 승자로 교체

### trade_stats (2,001건)
- pir 98.0% / psr 64.1% / jeonse_rate 97.5% / nearby_median 99.2%

### regions (758행 = 시도 + 시군구 누적, 세션 324 실측)
- avg_income **62/758 (8.2%)** — 시도 단위만
- population **420/758 (55.4%)** — 시군구 부분 NULL
- net_migration / pop_growth **758/758 (100%)** — 세션103 KOSIS 전환 후 전량 채워짐
- households **229/758 (30.2%)** — 세션 322 fix
- **jeonse_rate 168/758 (22.2%)** — 세션 324 trade-stats-regions.mjs 신규 collector 박힘 (PR #29, naver-estate-web cross-repo 4 위치 활성 사용)
- supply_ratio **0/758** — MOLIT housing-permits API 500 자연 회복 대기 (세션 323 진단)
- 세션 323 신규 4 컬럼 (grdp_per_capita / education_cost / education_participation / unemployment_rate / housing_supply_level) **79/758 (10.4%)** — 시도 단위만

### apartments.air_quality
- **1,950/2,001 (97.5%)** — AIRKOREA 정상 수집

### schools (1,971건, apt 대비 98.5%)
- school_score **1,971/1,971 (100%)**
- nearby_schools 요소 **21,608개** (페이지네이션 실측):
  - neisCode **0%** — 세션132 커밋 `8b16d62` 는 **5/3 KST 07:00 cron 후 첫 반영**
  - students **0%** — 학교알리미 API 세션89 이후 지속 실패
  - classes **1.4%**

### 시계열 테이블
- prices **3,633행** (apt당 평균 1.8행)
- trades **608,713행**
- unsold_history **1,099행** — 세션134 복구 완료. 508 apartments × 2개월 (202601/202602). KOSIS 1~2개월 지연 반영 정상. 매월 1일 자동 누적

### 잔여 nearbyMedian NULL 10건 (세션114 실측, 전부 구조적 + avgSqm 폴백 경로)
- 인천 동구 2 (두산위브 더센트럴, 리아츠 더 인천 4차) — 섬 인접 공백
- 인천 옹진군 2 (백령1/연평 국민임대) — 섬, area=NULL → 폴백 무효
- 경기 가평군 3 (자라섬 수자인, 청평수자인더퍼스트, 썬밸리오드카운티)
- 경기 양평군 2 (우방아이유쉘 에코리버3차, 효성해링턴 플레이스)
- 경기 연천군 1 (수레울1단지 국민임대) — area=NULL

### 의도적 NULL (자동 수집 대상 아님)
- **혜택 10컬럼** (discountPct/loanFree/cashback/balcony 등) **100% NULL** — 시행사 자료 운영자 수기 입력 (`data-fill.mjs:46 SKIP_CATEGORIES` 에 `benefits` 포함)
