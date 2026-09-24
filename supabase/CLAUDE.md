# Supabase 데이터베이스 규칙

> 스키마/마이그레이션 수정 시 반드시 이 규칙을 따를 것.

## 테이블 (25개+ · 2 VIEW — 세션 548 라이브 실측, 아래 표 19 + 운영 표 6)

> ⚠️ 개수를 단정하지 말 것 — 마이그레이션 grep 으로는 못 센다(CREATE/DROP·rename 혼재). 존재 확인은
> `sb.from('<이름>').select('*').limit(1)` 의 에러 코드로(`PGRST205` = 없음). `{count:'exact', head:true}` 는
> **없는 표에도 error=none** 을 돌려주므로 쓰지 않는다. `notification_logs` 는 생성·롤백 마이그레이션이 같은 날 있어 **운영 DB 에 없다**(세션 548 실측).

> schema.sql은 `apartments_flat` VIEW 포함. `api_quota_daily` VIEW는 migration `20260329100000_api_quota_log.sql`에만 존재(schema.sql snapshot 미동기, 운영에는 영향 없음).



| 테이블 | 설명 | 주요 수집기 |
|--------|------|-----------|
| apartments | 미분양 핵심 데이터 + 분양정보 19컬럼 | 청약홈, naver-presale |
| prices | 분양가 이력 (시계열) | 청약홈 |
| unsold_history | 미분양 추이 (시계열) | 청약홈 |
| trades | 실거래가 (매매/전세) | collect-trades |
| trade_stats | 거래 통계 캐시 | trade-stats |
| infra | 인프라 (병원/마트/어린이집/응급의료/경찰) | infra-kakao, childcare, emergency, police |
| schools | 학교 정보 | schools-neis |
| transport | 교통 정보 | transport-tago |
| builders | 건설사 재무 | dart-builders |
| regions | 지역 통계 (인구/이동/시장지표) | population, migration, market-stats |
| complexes | 네이버 단지 정보 | naver-collect.py |
| articles | 네이버 매물 정보 | naver-collect.py |
| complex_price_history | 네이버 시세 이력 | naver-collect.py |
| consults | 상담 신청 | api/consults.js |
| api_quota_log | API 쿼터 사용량 추적 | recordApiQuota() |
| presale_schedule_official | 청약홈 공식 분양일정 12종 + 규제 7종 | collect-applyhome-detail |
| applyhome_unit_supply | 청약홈 주택형별 공급 세대수 (`source` = apt/remndr/opt) | collect-applyhome-detail, collect-applyhome-remndr |
| applyhome_cancel_respl | 청약홈 취소후재공급 경쟁률 (유형별 6종 `by_type` JSONB) | collect-applyhome-remndr |
| **dev_plans** | 개발계획·개발축 원본 (세션511 신설). `source`(naver/vworld) × `kind`(road·rail·station·jigu / industrial_complex·lh_zone). `raw` JSONB 에 원본 보존(V-WORLD 는 폴리곤 포함) | naver-devplan |
| collector_runs | 수집기 실행 이력 (`collector`·`status`·`ok_count`/`fail_count`/`skip_count`·`finished_at`) — **모니터 전체가 이 표에 의존** | recordCollectorRun() |
| applyhome_events | 청약홈 경쟁률·접수 이벤트 (알림 발송기의 이벤트 소스) | collect-applyhome |
| subscribers | 분양 알림 구독자 | api/subscribers |
| market_stats_history | 시장 지표 시계열 | collect-market-stats |
| monitor_alert_state | 모니터 경보 dedup 상태 | monitor-collectors |
| monitor_daily_snapshot | 모니터 일일 스냅샷 (NULL 추세 비교용) | monitor-collectors |
| permission_baseline · permission_baseline_item | 권한 지문 기준선(승인 1회 = 1행 + 항목들) — **서비스 전용**: RLS 켬·정책 0·service_role 에 SELECT·INSERT 만 | `accept_permission_baseline()` (세션569) |
| **apartments_flat** (VIEW) | dedup CTE + 7개 JOIN 평탄화 + presale 19컬럼 | - |
| **api_quota_daily** (VIEW) | 일별 API 쿼터 합계 | - |

### apartments 추가 컬럼 그룹

| 그룹 | 컬럼 수 | 수집기 |
|------|---------|--------|
| 건축 특성 | 4 (corridor_type, heat_fuel, avg_maintenance_cost, primary_direction) | molit-building-info, naver-collect |
| 청약 경쟁률 | 3 (competition_rate, competition_supply, competition_applicants — 세션568 실측 정정, 옛 표기 supply/applicants 는 없는 칸) | collect-applyhome |
| 지번 | 3 (bjd_code, lot_main, lot_sub) | reverse-geocode |
| 에너지 | 3 (elec_usage_kwh, gas_usage_mj, energy_collected_at) | collect-building-hub (공공/상업만) |
| 분양정보 | 19 (presale_min_price ~ presale_fetched_at) | naver-presale |
| 대기질 | 1 (air_quality JSONB) | collect-air-quality |
| 치안 | 1 (crime_safety_grade SMALLINT 1~5) | collect-crime-safety |
| 미분양 출처 | 1 (unsold_source TEXT — NULL·`kosis`·`applyhome`·`hold`, CHECK + hold 면 unsold·unsold_rate NULL 제약) | collect-unsold-kosis(`kosis`) · collect-applyhome-seed(`applyhome`) · 사람(`hold` = 자료 없음 확정, backfill-unsold-source 계획 파일로만 걸고 푼다 — 수집기 둘 다 덮지 않음) — **세션568**(마이그 20260924000200) · hold **세션570**(마이그 20260924000600). 판정 규칙 정본 = `scripts/collectors/collect-unsold-kosis.mjs` `shouldSkipKosisFill`·`planUnsoldUpdates` 머리말 |
| 청약홈 값 만료 | 2 (unsold_as_of DATE — applyhome=값의 공고일 · hold=보류 결정일(감시 ⑫(e) 6개월 재검토) · competition_shortfall INTEGER ≥0 — 최신 경쟁률 회차 평형별 미달 합) | collect-applyhome-seed(`unsold_as_of`) · collect-applyhome(`competition_shortfall`, 0 이면 applyhome 값 0) · collect-unsold-kosis(공고일+6개월 지나면 KOSIS 로) — **세션569 C6**(마이그 20260924000500). VIEW 미노출 |

### 칸 추가 뒤 확인 (세션568)

psql 로 `ADD COLUMN` 을 적용했으면 supabase-js 로 그 칸을 **한 번 조회**해 PostgREST 스키마 캐시가 새 칸을 아는지 본다
(2026-09-24 `unsold_source` 는 적용 직후 조회·UPDATE 가 바로 됐다 — 캐시가 자동 갱신됐지만, 안 되면 `NOTIFY pgrst, 'reload schema'`).
그 다음에야 그 칸을 쓰는 스크립트(backfill·수집기)를 돌린다.

### 트리거 — `updated_at` 자동 갱신 (init 마이그 `update_updated_at()`)

- `apartments`·`infra`·`schools`·`transport`·`builders` 등에 `BEFORE UPDATE … EXECUTE FUNCTION update_updated_at()` 가 걸려 있다.
- ⚠️ **`schools` 는 세션568 부터 `BEFORE UPDATE OF nearby_schools`**(마이그 20260924000300, 2026-09-24 09:39 KST 운영 적용) — 학교 목록을 **쓸 때만** 30일 재수집 시계가 간다. 그 전엔 점수만 다시 매기는 `rescaleOnly`·어린이집 수집기(`nearby_childcare`)가 쓸 때도 시계가 초기화돼 9/23 하루에 2,654행이 몰렸다. 열 지정 트리거는 그 열이 UPDATE 의 **SET 목록에 있을 때** 발화한다(값이 실제로 바뀌었는지 무관 — PostgreSQL CREATE TRIGGER 문서, `INSERT … ON CONFLICT DO UPDATE` 도 같은 기준).
- ⚠️ 다른 표는 여전히 "어떤 칸을 고쳐도" 갱신이다. `infra-kakao` 는 `updated_at` 30일 + 완결성으로 건너뛴다(`scripts/collectors/infra-kakao.mjs` `buildFreshIds`) — 다른 수집기(대기질 등)가 `infra` 에 쓸 때 시계가 오르면 **같은 함정일 수 있다(실측 필요 — BACKLOG 세션568 후속)**. 공유 표의 `updated_at` 은 "누가 마지막에 건드렸나"일 뿐이다.

---

## 시계열 테이블 스키마

### prices (분양가 이력)
```
id SERIAL PK, apartment_id TEXT FK, area REAL, supply_area REAL,
price INTEGER (만원), pp INTEGER (평당가), house_type TEXT,
supply_count INTEGER, recorded_at DATE
UNIQUE(apartment_id, house_type, recorded_at)
인덱스: idx_prices_apartment, idx_prices_latest(apartment_id, recorded_at DESC)
```

### unsold_history (미분양 추이)
```
id SERIAL PK, apartment_id TEXT FK, base_month TEXT ("202603"),
unsold_count INTEGER, post_completion_unsold INTEGER, change INTEGER,
recorded_at DATE
UNIQUE(apartment_id, base_month)
인덱스: idx_unsold_apartment, idx_unsold_month
```

### apartments 분양정보 컬럼 (19개)
```
presale_min_price INTEGER, presale_max_price INTEGER, presale_pp INTEGER,
presale_type TEXT, presale_stage TEXT, presale_stage_code TEXT,
presale_image_url TEXT, naver_presale_no TEXT, naver_presale_seq TEXT,
presale_general_supply INTEGER, presale_buildings INTEGER,
presale_parking INTEGER, presale_inquiry TEXT, presale_features TEXT,
presale_move_in TEXT, presale_recruit_date TEXT, presale_schedule JSONB,
presale_housing_type TEXT, presale_fetched_at TIMESTAMPTZ
```

---

## 공유 DB 규칙

인스턴스 `rwdtljipvmqpazrimyns`는 **mibunyang + naver-estate-web 공유**.

### 테이블 소유권

> ⚠️ **이 표는 세션556 에 자매 레포를 직접 훑어 다시 썼다.** 그 전 판은 두 군데가 틀렸다 —
> `infra` 를 "쓰기는 mibunyang 만" 이라 했지만 **자매도 쓰고**, "mibunyang 전용" 목록의 표
> 대부분은 자매가 **읽고 있었다**. 실측 방법(자매 레포에서):
> `grep -rn "__tablename__" backend/db/mb_models.py` (자매가 아는 우리 표 17개) +
> 그 심볼을 import 하는 파일에서 `db.add(`·`commit()` 여부.

| 소유 | 테이블 | 쓰기 |
|------|--------|------|
| **공용** | complexes | 양쪽 upsert (컬럼 분리: mibunyang→nearby_apartment_ids, naver-estate-web→cortar/detail) |
| **공용** | articles | 양쪽 upsert |
| **공용** | complex_price_history | 양쪽 upsert |
| **공용 (컬럼 분리)** | **infra** | **양쪽 쓰기.** mibunyang = kakao 계열 17컬럼(8종×2 + `subway_dist`) + `updated_at` / 자매 = `air_*`·`crime_*`·`childcare_*`·`emergency_*` (`env_air.py`·`env_crime.py`·`env_childcare.py`·`env_emergency.py` 가 `db.add(infra)`) |
| **공용** | air_quality_stations | **자매만 쓴다**(`env_air.py`). mibunyang 은 안 건드린다 |
| **공용** | presale_schedule_official, applyhome_unit_supply, rental_schedule_official, rental_unit_supply, officetel_presale_schedule, officetel_unit_supply | **양쪽 쓰기** — 자매 `service_applyhome_officetel.py`·`service_applyhome_rental.py` 가 오피스텔·임대를 넣는다 |
| **mibunyang 쓰기 · 자매 읽기** | apartments, prices, unsold_history, schools, transport, builders, regions, trades, trade_stats | 쓰기는 mibunyang 만. **자매가 `mb_models.py` 로 읽으므로 컬럼 삭제·이름 변경 금지** |
| **mibunyang 전용** | consults, api_quota_log, collector_runs 등 | mibunyang만 |
| **naver-estate-web 전용** | user_profiles, audit_logs, crawler_checkpoints, complex_pyeong_details, crawl_jobs, payments, billing_keys 등 | naver-estate-web만 |

**읽기도 계약이다.** "자매가 안 쓰니 마음대로 바꿔도 된다" 가 성립하는 표는 마지막
`mibunyang 전용` 줄뿐이다. 그 위 표들은 **컬럼을 지우거나 이름을 바꾸면 자매가 깨진다** —
쓰기 주체가 우리뿐이어도 마찬가지다.

### 컬럼명 정규화

DB는 naver-estate-web 기준 컬럼명으로 정규화됨:

| 의도 | 실제 DB 컬럼 |
|------|-------------|
| 위도/경도 | `latitude` / `longitude` |
| 총세대수 | `total_household_count` |
| 부동산유형 | `real_estate_type_code` |
| 난방방식/연료 | `heat_method_type` / `heat_fuel_type` |

인덱스: `idx_complexes_location ON complexes(latitude, longitude)`

---

## 마이그레이션 체크리스트

⚠️ 대상은 위 소유권 표의 **`mibunyang 전용` 줄을 뺀 전부**다(세션556 정정). 옛 판은
`complexes/articles/complex_price_history/trades` 4개만 적었지만, 자매는 `apartments`·
`regions`·`infra`·`schools`·`transport` 등 **17개 표를 읽고 그중 여럿에 쓴다.**

해당 테이블 변경 시:

1. 상대 프로젝트의 SELECT 쿼리 / ORM 모델 검색
2. 양쪽 CLAUDE.md에 변경 내역 기록
3. **기존 컬럼 타입 변경/삭제 금지** (컬럼 추가만)
4. CREATE INDEX 시 upsert 성능 영향 고려
5. ALTER TABLE은 트래픽 저점(KST 02:00~03:00)에 실행

---

## 보안 표준 — VIEW·함수 신규 정의 시 (세션 276 박제)

Supabase Advisor `security_definer_view`(WARN)·`function_search_path_mutable`(ERROR)를
사전 차단하려면 신규 정의 시 아래를 의무 적용:

- **VIEW**: `CREATE VIEW name WITH (security_invoker = on) AS ...` — 미명시 시 기본값
  `off`(definer)라 anon 이 RLS 우회 조회. base 테이블 RLS 정책을 조회자 권한으로 평가.
- **함수**: `CREATE FUNCTION ... LANGUAGE plpgsql SET search_path = '' AS $$ ... $$;` —
  `''` 이 Supabase 권장값(`public, pg_temp` 아님). 본문이 public 테이블/함수를 무자격
  참조하면 깨지므로 스키마 한정자(`public.foo`) 명시. `NOW()` 등 pg_catalog 내장은 무관.
- 기존 VIEW 옵션 변경은 `ALTER VIEW name SET (security_invoker = on)` — `DROP VIEW` 는
  GRANT 권한을 동반 삭제하므로 옵션만 바꿀 땐 금지.
- 마이그 적용: `20260519130000_fix_security_definer.sql` 답습 (ALTER VIEW + CREATE OR
  REPLACE FUNCTION + `NOTIFY pgrst, 'reload schema';`). 트리거는 함수 OID 참조 →
  CREATE OR REPLACE FUNCTION 만으로 재바인딩 불필요.

---

## 마이그레이션 적용 (Dashboard 수동 또는 supabase CLI 단발 적용)

`apply-migration.yml` workflow 는 폐기됨 (세션 248).

### 방법 A — supabase CLI 단발 적용 (세션 274 답습, 로컬 작업 시 권장)

로컬에 `supabase` CLI 가 로그인 + 프로젝트 LINKED 돼 있으면 (`supabase projects list`
에 `rwdtljipvmqpazrimyns` ● LINKED):

```bash
# 적용 직전 상태 확인
supabase db query --linked --file /tmp/precheck.sql
# 신규 마이그만 단발 적용
supabase db query --linked --file supabase/migrations/<최신>.sql
```

> ⚠️ `supabase db push` 는 **금지**. push 는 마이그 히스토리상 미적용 마이그를 *전부*
> 재시도 → 과거의 깨진 마이그(예: 공유 테이블 부재로 실패한 `20260320170000`)까지
> 다시 돌려 실패. 신규 SQL 만 `db query --file` 로 직접 적용.
> 시뮬레이션이 필요하면 SQL 을 `BEGIN; ... ROLLBACK;` 으로 감싸 적용 후 검증 → DB 변경 0.
>
> ⚠️ **새 되돌리기(rollback) 파일은 `supabase/migrations/_rollbacks/` 에 둔다** (세션566). 본 폴더에 두면 번호가
> 가장 큰 파일이 되돌리기가 되어, 위·아래의 "`<최신>.sql` 적용" 절차가 **되돌리기를 적용**한다. 본 폴더에 남은 옛
> 되돌리기 12개는 최신 번호가 아니라 당장 위험은 없다(정리 후보).

### 방법 B — Dashboard SQL Editor 수동 실행

CLI 가 없거나 사용자가 직접 적용할 때:

1. Supabase Dashboard 접속 → 좌측 SQL Editor
2. `supabase/migrations/<최신>.sql` 본문 전체 복사 → 붙여넣기
3. 마지막 줄에 `NOTIFY pgrst, 'reload schema';` 추가 (마이그에 이미 있으면 생략)
4. Run 버튼 → 결과 확인 (에러 0건 + Success 응답)
5. 후속 collector 호출로 컬럼 채움 검증

### 공유 DB 컨텍스트

mibunyang ↔ naver-estate-web 공유 instance `rwdtljipvmqpazrimyns`. 어느 프로젝트
컨텍스트로 진입해도 동일 적용. 마이그 본문에 RLS/공용 테이블 영향 있으면 위 "공유 DB
규칙" 절 사전 확인 의무. 공용 테이블(complexes/articles/complex_price_history) 의
RLS·정책은 **naver-estate-web 소유** (`V007`/`V001` 마이그) — mibunyang 에서 정책
생성 금지.

⚠️ **2026-06-02 (naver V031): 공유 4테이블(articles/complexes/trades/
complex_price_history) anon·authenticated SELECT 가 차단됨.** 외부가 공개 anon key 로
매물 전량을 긁어 공유 Supabase micro 인스턴스 RAM 을 압박(PostgREST 부하 1위 실증)한 것 +
B2B 모델 유출 봉합. mibunyang 은 공유 테이블을 **service_role(`SUPABASE_SERVICE_KEY`)
단독**으로만 접근하므로 영향 0 (collector `_shared.mjs` 확인). 혹 mibunyang 브라우저/anon
경로로 이 4테이블을 읽으려 하면 42501 로 막힘 — service_role 경유로 전환할 것. 차단 원본 =
naver-estate-web `backend/db/migrations/V031__revoke_anon_shared_tables.sql`.

⚠️ **이 DB 의 anon key 는 공개돼 있다 (세션566, 2026-09-23 실측).** 자매 2u.pe.kr 로그인 화면 JS 에
실려 있다(2u 로그인이 이 DB 의 Supabase Auth 를 쓴다). 그래서 **anon·authenticated 대상 정책은 전부
인터넷에 열린 것**으로 본다 — 새 표에 anon 쓰기 정책을 두지 말고, 쓰기는 API(service key) 경유로.
같은 날 보안 고문 경고 3건을 닫았다: `consults`·`subscribers` anon INSERT `true` 정책 삭제(우리 API 는
두 표 모두 service key 로 넣는다) · `pg_trgm` → `extensions` 스키마(자매 검색 색인
`idx_apartments_name_trgm` 은 그대로 동작 — 자매는 ILIKE 만 쓴다). 마이그 = `20260923000000~03`.

- **RLS 는 행만 막는다 — 칸은 GRANT 로.** "자기 행 수정" 정책이 있는 표에 권한 칸(role·status·결제·email)이 있으면
  칸 권한을 거둔다(2u `user_profiles` 실사고 → 2u V062). 정적 가드 = `scripts/_rls-anon-write-policy.test.mjs` —
  항상 참 쓰기 정책(로그인만 하면 참인 조건 포함)을 막고, **로그인 사용자·익명 쓰기 정책은 칸 권한을 확인한 뒤
  `CLIENT_WRITE_ALLOWLIST` 에 적어야 통과**한다(지금 0건).
- **SQL 함수에 `SET search_path` 를 붙이면 인라인이 꺼진다** — 행마다 불리는 헬퍼는 느려진다(상가 실측: 층대 가격
  함수 약 2배 · 검색 키 함수는 측정 잡음 ±25% 안에서 느려짐 → 둘 다 되돌림).
  보안 고문 경고를 없애기 전에 그 함수가 쓰이는 쿼리의 **전후 속도**를 잰다(결과 동일 검사만으로는 못 잡는다).
- **운영 표 4개(`collector_runs`·`api_quota_log`·`monitor_alert_state`·`monitor_daily_snapshot`)는 공개 열쇠로 못 읽는다**
  (세션567, 2026-09-24 적용 — `20260924000000` · anon 탐침 42501). 이 표는 **서비스 열쇠로만** 읽는다 —
  관리자 "수집기 상태" API 도 `getMibuyangSupabase()` 로 옮겼다(#588). 새 운영 표를 만들면 `"Public read"` 를 두지 않는다.
- **Supabase 는 public 표 전부에 anon·authenticated 권한(GRANT)을 기본으로 준다 — 실제 차단은 RLS 정책.**
  그래서 "권한이 있나"만 보는 감사는 거의 모든 표를 잡는다(세션567 감시 ⑩ 첫 실측 R1 280건). 판정은
  **권한 + 그 쓰기를 여는 정책**의 조합으로. 거의 모든 표의 `"Service write" FOR ALL`(roles = {public}) 정책은
  qual 이 정확히 `(auth.role() = 'service_role'::text)` 라 서비스 전용이다 — 부분 일치(`LIKE '%service_role%'`)로
  빼면 `… OR true` 같은 위험한 정책도 빠진다.

### SQL 적용·시험 (세션567 — 단위 시험·검사관이 놓친 오류 3개를 이것만 잡았다)

- **합치기 전 되돌림 시험 1회**(새 함수·권한/RLS 마이그): `\set ON_ERROR_STOP on` · `SET lock_timeout='2s';` ·
  `SET statement_timeout='30s';` · `BEGIN;` · `\i <파일>` · `SELECT <새 함수>();` · `ROLLBACK;` 뒤
  `to_regprocedure('<함수>()') is not null` = false(흔적 0) 확인. ⚠️ DROP POLICY·REVOKE 는 가장 강한 잠금(ACCESS EXCLUSIVE)을
  걸어 **잠금을 기다리는 동안 손님 조회도 막힌다** — `lock_timeout` 을 빼지 않는다. 트랜잭션 밖 동작(CONCURRENTLY 등)은 이 시험으로 못 본다.
  **생성은 되는데 호출할 때만 터지는 오류**가 있다(`aclexplode` 에 빈 0차원 배열 → "ACL arrays must be one-dimensional").
- **적용**: 파일에 BEGIN/COMMIT 이 없으면 `psql -X -v ON_ERROR_STOP=1 --single-transaction -f <파일>` — 끝의
  자체검사(`DO $$ … RAISE EXCEPTION $$`)가 실패하면 **전부 취소**된다(세션567 에 세 번 이렇게 멈췄고 흔적 0).
- `search_path = ''` 함수에서 **스키마를 붙이면 안 되는 것** = COALESCE·NULLIF·GREATEST·LEAST·CASE(문법 요소 —
  `pg_catalog.coalesce(` 는 "function does not exist"). 일반 함수는 붙여도 되고 안 붙여도 된다(pg_catalog 는 항상 먼저 검색 — PostgreSQL 문서 ddl-schemas).
- 자체검사는 **실제 DB 의 정책 모양**으로 시험한다(회수 마이그 첫 판이 서비스 전용 정책까지 "공개 정책 잔존"으로 잡아 취소됐다).
- 접속: 이 저장소엔 DB 접속 문자열이 없다. psql 경로(자매 backend `.env`)는 **사장님 명시 지시 때만** — 아니면
  위 되돌림 시험 SQL 을 사장님께 드려 Dashboard SQL Editor 에서 돌린다(ROLLBACK 이 있어 무해).
- 점검 함수 `public.audit_db_permissions()`(감시 ⑩ 재료, service_role 만 실행) — 주 1회 월요일 감시가 서비스 열쇠로 부른다.
- 권한 지문(세션569, 마이그 `20260924000400` · 되돌리기 `_rollbacks/20260924000401`): `permission_fingerprint()` = 권한 정의 전체 지문 ·
  `permission_drift_snapshot()` = 최신 기준선 대비 차이 · `accept_permission_baseline(p_expected_hash, p_note)` = 미리보기 해시와 같을 때만
  기준선 저장(다르면 `hash mismatch`) · `audit_db_permissions()` 는 같은 마이그로 교체(뷰 `security_invoker` 해석 수정 · 칸 단위 조회 권한).
  네 함수 모두 service_role 만 실행. 의도한 권한 변경 뒤 기준선 갱신 = `node scripts/perm-baseline.mjs`(미리보기 → 사장님 승인 → accept).

⚠️ **컴퓨트 한계 — Micro 인스턴스 hang (세션 460, 2026-06-29).** 공유 인스턴스(`t4g.micro`,
RAM 1GB)가 mibunyang + naver-estate-web 양쪽 collector + Vercel 동시 부하에서 일시 hang →
Cloudflare **522** 응답(약 2.5h). 진단 순서: ① status.supabase.com (전체 장애 여부) ② GitHub
Actions 같은 DB 읽는 워크플로(daily-deploy 등) 동반 실패 여부 ③ 대시보드 STATUS/CPU/RAM —
**전부 0% + Unhealthy = 인스턴스 hang**(디스크 초과 아님, Pro 플랜이라 무료티어 한도도 아님).
즉시 대응 = 대시보드 **Restart**(👤). 근본 해소 = 컴퓨트 **Micro→Small**(RAM 2GB, Pro 크레딧
적용 후 순 +$5/월) — 비용 공유라 협의 필요, 새벽 수집(KST 03~05:30) 피해 낮에 업그레이드.
DB 행수·연결수 등 휘발성 수치는 본문에 두지 않음(대시보드 Reports 실측).

### 사고 답습 (세션 245 → 247)

세션 245 가 `apply-migration.yml` workflow_dispatch run 25797316590 "success" 결과만 보고 "DDL 적용 완료" 박제 → 세션 247 수집 시점에 PG 42703 `column does not exist` 발견. 워크플로 본문 grep 결과 **실제 SQL 실행 0건**. `.claude/rules/workflow-name-hallucination.md` 룰 참조.
