# 수집기 전수조사 (조사 K 완결본) — 2026-08-08 (세션 503)

> 세션 488 감사의 **조사 K** 는 계정 주간 한도로 중단돼 `raw/wdo0iwsme.json` 이 **0바이트**로 남았다.
> 그래서 감사 README §11-4 에 *"수집기 정비 계획은 아직 없다"* 고 적혀 있었다. 이 문서가 그 자리를 메운다.
>
> **방법**: 워크플로 yml 의 cron·실행 스크립트 + 로컬러너 `DAY_TABLE` + 각 수집기의 `recordCollectorRun`
> 기록명(PHASE) + `collector_runs` 라이브 + 대상 컬럼 채움률을 **기계적으로 조인**했다. 서브에이전트 보고가
> 아니라 전부 직접 실측이다.

## 요약

| | 값 |
|---|---|
| 수집기 파일 (`scripts/collectors/*.mjs`, 테스트 제외) | **57** |
| 그중 헬퍼·도구 (수집기 아님) | 4 (`_shared`·`_molit-api`·`data-audit`·`data-fill`) |
| `collector_runs` 에 기록이 있는 종 | **42** |
| **cron 으로 도는데 기록을 아예 안 남기는 것** | **8** ← 감시 불가 |
| 실행 배선이 아예 없는 것 | 12 (일부는 로컬 .bat 경유라 정상) |

---

## 🔴 지금 고장 (사람이 손봐야 함)

### 1. 실거래가 `collect-trades.mjs` — **2개월 공백**

| 항목 | 실측 |
|---|---|
| `trades` 최신 거래월 | **202605** |
| 최신 적재일 | **2026-06-06** |
| 202606 / 202607 | **0건 / 0건** |
| 총 행 | 800,746 |

- cron `0 20 6 * *` (매월 6일). **7/06 cancelled · 8/06 "success인데 0건"**
- 8/06 회차(run 31128535791)는 21:57~00:28 **2시간 31분** 돌며 **첫 호출부터 전부 `fetch failed`**.
  마지막 로그: `[budget] 150분 예산 초과 — 여기까지 수집분(0건)을 저장하고 종료` → `수집된 데이터 없음`
- **워크플로는 success**, `collector_runs` 에 **행조차 안 남음** → monitor 사각
- **API 는 지금 정상**: `apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev` 직접 호출 **HTTP 200 · 141ms ·
  resultCode 000 · 실데이터** (2026-08-08 실측) → 영구 폐기 아님, 그날 연결 문제
- **손님 화면 영향**: 상세 시세 탭 *"인근 매매 시세 (최근 6개월)"* 은 `monthsAgo(6)` 로 조회 자체는
  정확하지만 **그 6개월 중 최근 2개월이 0건** → 표의 건수·평균이 실제로는 **4개월치**
- 다음 자연 발화 **9/06**

### 2. 혐오시설 `noxious.mjs` — 2회 연속 취소, 기록 0행

- cron `0 18 3 * *`. **8/03 cancelled · 7/03 cancelled**
- `PHASE="noxious"` 인데 `collector_runs` 에 `noxious` 행 **0개** (한 번도 기록 못 남김)
- `apartments.noxious_dist` 채움 **1,934/2,635 = 73.4%** — 기존 데이터는 살아 있고 신규만 안 채워짐

### 3. 시공사 신용 `dart-builders.mjs` — 취소+실패, 기록 0행

- cron `0 3 15 1,4,7,10 *` (분기). **8/04 cancelled · 7/15 failure**
- `recordCollectorRun` **미호출** → 기록 자체가 설계상 없음

### 4. 주택가격 `collect-housing-price.mjs` — 7/16 실패 후 방치

- cron `0 22 16 * *`. **7/16 failure**, 마지막 성공 6/17 (52일 전). 다음 발화 8/16

---

## 🟡 구조적 사각 — cron 으로 도는데 `collector_runs` 기록을 안 남기는 8개

**돌았는지·실패했는지 아무도 모른다.** monitor 는 `collector_runs` 를 보므로 이들은 영구 사각이다.

| 수집기 | cron | 최근 실행 |
|---|---|---|
| `environment.mjs` | 매월 1일 | 8/01 success |
| `noise-estimate.mjs` | 매월 1일 | 8/01 success |
| `industry-match.mjs` | 매월 7일 | 8/07 success |
| `dart-builders.mjs` | 분기 15일 | **8/04 cancelled** |
| `calc-floors.mjs` | 매주 일 | (backfill 묶음) |
| `regulation-seed.mjs` | 매주 일 | (backfill 묶음) |
| `geocode-missing.mjs` | 매주 일 + 매일 | — |
| `reverse-geocode.mjs` | 매주 일 + 매일 | — |

`calc-layout.mjs` 는 `PHASE="calc-layout"` 을 갖고도 기록 0행 (8/02 success · 7/26 failure).

---

## ✅ 정상 (거짓 경보 아님 — 오해하기 쉬운 것들)

| 신호 | 왜 정상인가 |
|---|---|
| KOSIS 계열 20~30일 미실행 | **로컬러너 월 1회** (`DAY_TABLE` 2·6·7·9·10·11·12·13·14·17·18일). 날짜와 일치 |
| `regions.supply_ratio` 전체의 1.0% | **시도 단위 지표** — 17개 시도 전부 채움. 구 단위 행엔 원래 안 들어감 |
| `notify-subscribers`·`purge-consults` ok=0 | 구독자 0 · 상담 0 이라 보낼·지울 게 없음 |
| `building-hub` 53일 ok=0 | **분기 cron**(1·4·7·10월 15일). 주기 안 |
| `childcare-info*`·`naver-presale` "배선없음" | 로컬 `.bat` 스케줄러 경유 (`childcare-local-runner` · `run-naver-local`) |
| `applyhome-remndr` 기록 0행 | PR #330 신설분. **첫 발화 8/10(월) 예정** |

---

## 수리 순서 제안

1. **실거래가** — ① 지금 수동 1회 실행으로 6·7월 메우기(API 정상 확인됨) ② 0건이면 success 로
   끝내지 않도록 + `collector_runs` 에 반드시 남도록 고치기
2. **기록 없는 8개** — `recordCollectorRun` 배선. 이게 없으면 앞으로도 같은 사고를 못 본다
3. **noxious · dart-builders** — 취소 원인 규명(concurrency 축출 의심 — 세션 500 패턴)
4. **housing-price** — 8/16 자연 발화 관찰 후 판단

> ⚠️ 이 문서의 수치는 **2026-08-08 시점 실측**이다. 다시 쓸 때는 믿지 말고 다시 재라 — 이 저장소가
> 반복해 데인 지점이다([[tool-output-illusion-guard]]).
