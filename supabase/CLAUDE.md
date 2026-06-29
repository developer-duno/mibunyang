# Supabase 데이터베이스 규칙

> 스키마/마이그레이션 수정 시 반드시 이 규칙을 따를 것.

## 테이블 (15개 + 2 VIEW)

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
| **apartments_flat** (VIEW) | dedup CTE + 7개 JOIN 평탄화 + presale 19컬럼 | - |
| **api_quota_daily** (VIEW) | 일별 API 쿼터 합계 | - |

### apartments 추가 컬럼 그룹

| 그룹 | 컬럼 수 | 수집기 |
|------|---------|--------|
| 건축 특성 | 4 (corridor_type, heat_fuel, avg_maintenance_cost, primary_direction) | molit-building-info, naver-collect |
| 청약 경쟁률 | 3 (competition_rate, supply, applicants) | collect-applyhome |
| 지번 | 3 (bjd_code, lot_main, lot_sub) | reverse-geocode |
| 에너지 | 3 (elec_usage_kwh, gas_usage_mj, energy_collected_at) | collect-building-hub (공공/상업만) |
| 분양정보 | 19 (presale_min_price ~ presale_fetched_at) | naver-presale |
| 대기질 | 1 (air_quality JSONB) | collect-air-quality |
| 치안 | 1 (crime_safety_grade SMALLINT 1~5) | collect-crime-safety |

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

| 소유 | 테이블 | 쓰기 |
|------|--------|------|
| **공용** | complexes | 양쪽 upsert (컬럼 분리: mibunyang→nearby_apartment_ids, naver-estate-web→cortar/detail) |
| **공용** | articles | 양쪽 upsert |
| **공용** | complex_price_history | 양쪽 upsert |
| **공용** | trades | mibunyang만 |
| **mibunyang 전용** | apartments, prices, unsold_history, infra, schools, transport, builders, regions, trade_stats, consults, api_quota_log | mibunyang만 |
| **naver-estate-web 전용** | user_profiles, audit_logs, crawler_checkpoints, complex_pyeong_details 등 | naver-estate-web만 |

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

공용 테이블(complexes/articles/complex_price_history/trades) 변경 시:

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
