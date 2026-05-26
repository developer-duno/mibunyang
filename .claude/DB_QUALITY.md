# DB 품질 스냅샷

> 측정일별 누적. `/db-quality` 슬래시 커맨드 결과 append.
> CLAUDE.md 본문에 측정값 두지 말 것 — 전부 이 파일

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

### regions (454행 = 시도 62 + 시군구 392)
- avg_income **62/454 (13.7%)** — 시도 단위만
- population **420/454 (92.5%)** — 시군구 부분 NULL
- net_migration / pop_growth **454/454 (100%)** — 세션103 KOSIS 전환 후 전량 채워짐
- households / jeonse_rate / supply_ratio **0/454 유지** — reader 부재로 우선순위 낮음

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
