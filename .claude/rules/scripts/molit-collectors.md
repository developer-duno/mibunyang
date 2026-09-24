---
paths:
  - "scripts/collectors/_molit-api.mjs"
  - "scripts/collectors/molit-*.mjs"
  - "scripts/collectors/collect-maintenance.mjs"
  - "scripts/collectors/collect-building-hub.mjs"
---

> scripts/CLAUDE.md 에서 분리(세션568 문서 다이어트). 원본 그대로, 로딩 방식만 변경.

## MOLIT 수집기 모듈

> ⚠️ **실행 경로 = GitHub Actions 가 아니라 집서버 로컬 러너다**(세션 515). apis.data.go.kr 의 국토부
> (1613000) 서비스가 해외 IP 를 복불복 차단해 `collect-{trades,molit-units,building-info,maintenance,building-hub}.yml`
> 5개를 삭제하고 `scripts/kosis-local-runner.mjs` 매핑표로 옮겼다 — 아래 "KOSIS + MOLIT 수집 — 로컬 자동화" 절 참조.

| 파일 | 역할 | isCLI |
|------|------|-------|
| `_molit-api.mjs` | 공유 모듈 (API 호출, 매칭, 페이지네이션, NonRetryableError) | - |
| `molit-building-info.mjs` | 건물 상세 (주차/층수/난방/복도) | O |
| `molit-units.mjs` | 세대수 보정 (units, unsold_rate) | O |
| `collect-maintenance.mjs` | 관리비 수집 (5항목 합산) | O |

- **isCLI 패턴**: `process.argv[1] && import.meta.url.endsWith(...)` — 53개 파일 (테스트 시 main() 방지, 2026-06-29 실측 `grep -l "const isCLI" scripts/**/*.mjs | grep -v test | wc -l`)
- **NonRetryableError**: 4xx/XML 에러 즉시 throw, 429/500/503만 재시도
- **`molitApiCall` opts override (세션 451)**: 기본 timeout/retry = 공유 상수 `MOLIT_TIMEOUT_MS=30000` × `MOLIT_MAX_RETRIES=3`. 호출처가 선택적 6번째 인자 `{ timeoutMs?, maxRetries? }` 로 좁힐 수 있음(기본=상수 → molit-units·molit-building-info 무변경). **collect-maintenance 의 `fetchTotalHouseholds` 는 `{ timeoutMs: 8000, maxRetries: 1 }`** — households 호출 30s×3(≈93초) hang 이 단지당 최악 ~135초의 진앙이라 cost endpoint(8s/무재시도) 톤에 맞춰 좁힘. 전역 상수는 3 collector 공유라 **변경 금지**(cross-collector 회귀), maintenance-local opts 로만.

### 공유 모듈 (_shared.mjs)

- REGION_MAP: 약칭17 + 정식명20 = 37개
- REGION_LAWD_PREFIX + GU_LAWD_MAP + getLawdCd(): 법정동코드 매핑
- fetchWithRetry: Retry-After 헤더 + 지수 백오프 (429/500/503)
- upsertBatch: 배치 100ms + 429 재시도 (attempt+1)^2초
- recordApiQuota: api_quota_log 기록
- **today(): KST 고정 YYYY-MM-DD** (세션 419) — `Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Seoul"})`. ⚠️ GitHub Actions=UTC 러너라 `new Date().toISOString().slice(0,10)` 직접 쓰면 KST 02:00~08:00 발화 시 recorded_at 하루 밀림. **시계열 recorded_at·collected_at 저장은 today() 의무**(직접 toISOString 금지). TZ env 안 씀(코드 고정이 본질 — TZ env는 cron 발화 안 바꿈+월경계 시프트 잠복위험). datetime(시각포함, presale_fetched_at 등)은 timestamptz 컬럼이라 toISOString 유지 OK

### ⚠️ upsert 충돌 키에 NULL 이 들어가면 중복 방지가 통째로 꺼진다 (세션550)

`upsertBatch(table, rows, "a,b,c")` 는 그 컬럼들의 **유니크 색인**에 기대어 "있으면 갱신, 없으면 삽입"을 한다.
그런데 Postgres 는 유니크 색인에서 **NULL 을 서로 다른 값으로 본다**(공식 문서: "null values in a unique column
are not considered equal"). 충돌 키 컬럼 중 하나라도 NULL 인 행은 **영원히 충돌하지 않아 회차마다 새 행으로 또 들어간다.**
에러도 경고도 없고 `collector_runs` 는 success 다.

- 실사고: `trades` 의 세종 행은 `gu = null` 로 저장됐다(세종은 구·군이 없다). 색인 `idx_trades_unique
  (region, gu, deal_month, area, price, floor, trade_type)` 가 한 번도 안 걸려 **수집 8회차 동안 68,352행 = 실제 거래
  11,812건**까지 불었고, 손님 화면의 "세종 6개월 거래 10,916건"(참값 2,124)이 5배로 부풀어 등급이 "활발"로 나갔다.
- 처방: **충돌 키에 들어가는 컬럼은 저장 시점에 NULL 이 아니게 한다.** 세종 거래는 `tradeRowGu()` 가 `"세종시"` 로 채운다
  (`collect-trades.mjs`). 읽는 쪽(`trade-stats*.mjs` 의 `statsKey`)은 세종을 gu 와 무관하게 한 버킷으로 접으므로 영향이 없다.
- 새 수집기·새 유니크 색인을 만들 때 확인: `select count(*) from <표> where <충돌키 컬럼> is null` 이 0 인가.
  0 이 아니면 그 행들은 중복 방지 밖에 있다. (DB 쪽 처방 = PG15+ `NULLS NOT DISTINCT` 색인 — 공용 표라 Dashboard 수동.)
- 판별법: 같은 표를 **고유 거래 키로 묶어 벌수 분포**를 본다. 벌수가 "그 달을 덮은 수집 회차 수"와 같으면 이 결함이다.
- 청소 도구 = `scripts/dedupe-trades-buckets.mjs`(기본 dry-run → 계획 파일 검토 → `--apply-from=<계획> --apply`, 쌍둥이만 삭제·fail-close 99%).
  ⚠️ `trades` 의 `세종|세종시` 버킷은 `apartments` 에 짝이 없는 게 정상이다(세종 단지의 `apartments.gu` 는 null).

### Exit Code 정책

- createReporter 사용: `rpt.summary().fail > 0` → exit(1)
- 수동 카운터: `failed > 0` → exit(1)
- ⚠️ 개수는 **박제하지 않는다**(세션마다 변한다). 세션 496 실측 시점에 이 두 줄의 옛 박제값 "9개/5개"가
  실제 20개/7개로 어긋나 있었고, 두 분류 어디에도 안 드는 collector 가 27개 더 있었다(환경변수 누락 등
  다른 조건으로만 exit). 단정이 필요하면 그때 세되, 세는 규칙부터 정하고 센다 — `failed > 0` 이
  `rpt.fail(failed)` 에 넘기는 용도인 파일(`collect-applyhome.mjs`)도 있어 단순 grep 은 오탐한다.
- recordApiQuota 완료 후 exit 호출 (쿼터 기록 보장)
- ⚠️ **`try` 안 `process.exit()` 은 대기 중인 `finally` 를 실행하지 않는다**(Node 실측). `finally` 로 쿼터를
  기록하는 collector 가 이 구조면 **실패 종료 때마다 기록이 통째로 유실**되는데, 성공 경로는 멀쩡히 기록되므로
  로그만 봐서는 안 드러난다. 정답 2형 —
  ① try/catch/finally 문 **전체가 끝난 뒤** exit (`collect-market-stats.mjs`): `try` 안에 조기 `return` 이 없을 때만 안전.
  ② `shouldExit1` 플래그 + `finally` 안 recordApiQuota **await 직후** exit (`collect-applyhome.mjs`): 조기
  `return`(dry-run 등)이 있으면 이쪽만 안전 — ①을 쓰면 그 줄에 도달 못 해 **exit 0(성공) 회귀**.
  전수 회귀 가드 = `scripts/collectors/_exit-quota-coverage.test.mjs` (세션 496). 세션 395 가 9개 파일을 고치고
  applyhome 2개를 놓친 채 1년 가까이 잠복한 사고라 파일별 수동 점검 대신 기계로 훑는다.
- ✅ **가드가 사전 차단에 성공한 첫 사례 (세션 496b, PR #330)**: 신규 `collect-applyhome-remndr.mjs` 가
  try 안 `process.exit` 4곳을 가진 채 올라왔고, main 병합 순간 이 가드가 **머지 전에** red 를 냈다.
  이 파일은 dry-run 조기 `return` 이 있어 **②만 정답**이었다 — 즉 "정답이 2형"이 아니라 "파일마다 정답이
  하나로 갈린다". 새 collector 를 쓸 때 ①/②를 고르는 기준은 **`try` 안에 조기 `return` 이 있는가** 하나다.


---

## BldEngyHubService 한계

`collect-building-hub.mjs`의 에너지 수집(전기/가스)은 **공공/상업 건물만 대상**.
주거용 아파트는 BldEngyHubService에 데이터 없음 (KEPCO/가스공사 관할).

현재 K-apt 관리비 데이터(`collect-maintenance.mjs`)가 에너지 비용 비교의 최선.

### heat_fuel / quake_design 수집 정책 (세션139 확정)

- **네이버 경로 단일화**: `sync-naver-complex.mjs` L219-221 (`complexes.heat_fuel_type → apartments.heat_fuel`) + `naver-collect.py` L117/119 (quakeDesign Phase 3 실사) 로 이미 DB 채워짐.
- **HpPermitService 미구독 결정**: 공공데이터포털 `getHpMgmCoopTpOulnInfo`·`getHpBasisOulnInfo` 별도 구독은 **보류**. 네이버 수집이 막히는 장애가 반복되기 전에는 구독 불필요.
- **재오픈 트리거**: (1) 네이버 IP 차단 장기화 (세션89 수준 실패가 3개월+ 지속), (2) `heat_fuel`/`quake_design` NULL 비율이 30%+ 로 악화, (3) 구독비보다 큰 사업 요구.
- **과거 코드**: 세션139 이전 `collect-building-hub.mjs` 에 `fetchHeatFuel`/`fetchQuakeDesign` 함수 + 주석처리된 호출부 존재. 재오픈 시 `git log` 에서 해당 커밋 이전 상태 복구 가능.
