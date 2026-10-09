# 공유 DB 소유권 기계 목록 + CI 가드 + 자동 통보 — 설계서 v2

> 세션617 · 2026-10-09 · 상태: **v2(맹점 Opus 검토 🔴2·🟠4·🟡 반영)** — v1.1 은 git 에 없음(이 파일이 첫 커밋). 근거 = `.omc/artifacts/session616/ownership-survey/{inventory.json,diff-vs-0922.md,docs-to-renew.md}` · `cross-repo-notice-examples.md` · 맹점 검토 `.omc/artifacts/session617/review-design-blind.md`.
> 사장님 결정(10-09 05:5x·07:5x) = §7.

## 0. 왜 만드나 (한 줄)

같은 Supabase DB 를 두 레포(미분양 · 2u)가 쓰는데, "어느 표·어느 칸을 누가 쓰나"가 **사람이 쓴 문서 13곳**에 흩어져 있고 그중 16곳이 이미 틀렸다. 문서는 조용히 낡고, 상대 칸에 쓰는 실수는 합쳐진 뒤에야 들킨다(09-22 지도가 `naver-collect.py` 를 못 세어 "칸 분리" 라고 적은 것이 그 예 — 실제로는 같은 칸 10개를 양쪽이 쓴다).
→ **기계가 읽는 목록 하나**를 두고 ① CI 가 그 목록으로 "상대 칸에 쓰는 코드"를 합치기 전에 막고 ② 합친 뒤 공유 표를 건드린 변경을 상대 레포에 자동으로 알리고 ③ 세션을 열 때 안 읽은 알림을 보여 준다. 문서는 전부 이 목록을 가리키기만 한다.
⚠ 두 레포 모두 main 에 **필수 상태 검사가 없다**(2u `Branch not protected` · 미분양 `ci.yml:17-22` 사유) — "합치기 전에 막는다"는 **관행**(CI 빨강이면 안 합친다)이지 GitHub 가 강제하지 않는다.

## 1. 기계 목록(레지스트리)

### 1-1. 정본 = 미분양 레포 `supabase/ownership.json` 하나 (결정 §7-1)

- 두 레포 모두 **공개(PUBLIC)** 라 2u CI·훅은 토큰 없이 `https://raw.githubusercontent.com/developer-duno/mibunyang/main/supabase/ownership.json` 을 읽는다 → 사본 없음. ⚠ raw 주소는 **약 5분 캐시** — 목록 PR 을 합친 직후 2u CI 는 옛 목록을 볼 수 있다(재실행으로 해결, 설계 안에 명시).
- **순서 규칙**: 목록을 바꾸는 PR(미분양 레포)이 **먼저** 합쳐져야 그 목록에 기대는 2u 코드 PR 이 초록. 2u 가 자기 표·파일을 등록하려면 미분양 레포에 PR — 2u 창은 **미분양 레포의 워크트리**에서만 작업(multi-repo §2 "한 레포 한 세션 쓰기" — 미분양 창이 같은 파일을 편집 중이면 기다린다).
- 기각: 2u 정본(공유 표 대다수·마이그가 미분양 쪽) · 양쪽 사본(어긋남 알림이 또 필요) · 제3 레포(창이 는다).

### 1-2. 형식 — **순수 JSON**(주석 없음 · 설명은 `note` 칸 · `JSON.parse`/`json.loads` 둘 다 통과)

```json
{
  "version": 1,
  "updated": "2026-10-09",
  "repos": { "mibunyang": "developer-duno/mibunyang", "2u": "developer-duno/naver-estate-web" },
  "tables": {
    "apartments": { "owner": "mibunyang", "readers": ["2u"] },
    "payments":   { "owner": "2u" },
    "consults":   { "owner": "mibunyang" },
    "infra": {
      "owner": "shared", "readers": ["2u"], "row_create": ["mibunyang", "2u"], "fk_cascade_from": "apartments",
      "columns": {
        "key": ["apartment_id"],
        "mibunyang": ["subway_dist", "...", "air_station_name", "air_station_dist", "police", "police_dist", "childcare", "childcare_dist", "emergency", "emergency_dist", "emergency_name", "emergency_type"],
        "2u": ["crime_grade", "...", "childcare_updated_at", "emergency_updated_at"],
        "orphan": ["air_pm10", "air_pm25", "air_o3", "air_grade", "air_updated_at", "air_attempted_at", "nearby_facilities"],
        "clock": ["updated_at"]
      },
      "note": "updated_at 은 DB 트리거가 모든 UPDATE 에 now() — 어느 쪽도 자기 수집 시각으로 믿지 말 것(C3). nearby_facilities 는 쓰는 곳 0 이나 VIEW apartments_flat 이 읽음."
    },
    "complexes": {
      "owner": "shared", "readers": ["mibunyang", "2u"],
      "columns": {
        "2u": ["cortar_no", "...", "articles_crawled_at", "last_viewed_at", "sgis_emd_cd", "sgis_mapped_at"],
        "mibunyang": ["corridor_type"],
        "contested": ["complex_name", "latitude", "longitude", "total_household_count", "use_approve_ymd", "real_estate_type_code", "construction_company", "heat_method_type", "heat_fuel_type", "last_crawled_at"],
        "orphan": ["heat_fuel", "heat_method", "earthquake_design", "entrance_type", "has_pool"]
      },
      "note": "contested = C1 양쪽이 같은 칸을 씀(등재만, 해소는 별도 트랙 §5)"
    },
    "articles": { "owner": "shared", "readers": ["mibunyang", "2u"], "columns": { "contested": ["..."] }, "row_lifecycle": { "mibunyang": "is_active=false", "2u": "delete" }, "note": "C2" },
    "complex_price_history": { "owner": "shared", "sources": { "2u-public": "base_month 6자리 · area_no=''", "naver": "base_month 8자리" }, "note": "C5" },
    "air_quality_stations": { "owner": "orphan" },
    "notification_logs": { "owner": "mibunyang", "absent": true, "note": "notify-subscribers.mjs:413 이 쓰려 하나 DB 에 없음" }
  },
  "views": { "apartments_flat": { "owner": "mibunyang", "readers": ["mibunyang", "2u"], "reads_from": ["apartments", "infra", "..."] }, "api_quota_daily": { "owner": "mibunyang" } },
  "writers": {
    "mibunyang": {
      "scripts/collectors/naver-collect.py": { "complexes": ["complex_no", "complex_name", "real_estate_type_code", "latitude", "longitude", "total_household_count", "use_approve_ymd", "construction_company", "last_crawled_at", "heat_method_type", "heat_fuel_type", "corridor_type"], "articles": ["..."], "complex_price_history": ["..."] },
      "scripts/collectors/infra-kakao.mjs": { "infra": ["..."] }
    },
    "2u": {
      "backend/services/upsert.py": { "complexes": ["..."], "articles": ["..."] },
      "backend/crawler/env_crime.py": { "infra": ["crime_score", "crime_grade", "crime_updated_at"] }
    }
  },
  "delete_allowed": { "mibunyang": { "scripts/fix-placeholder-addresses.mjs": ["transport", "schools"] }, "2u": { "backend/services/upsert.py": ["articles"] } },
  "known_conflicts": { "C1": "complexes contested 10칸", "C2": "articles 12칸 + 행 수명", "C3": "infra.updated_at 공유 시계", "C5": "complex_price_history 두 출처" }
}
```

- `columns.key` = 열쇠 칸(complexes `complex_no` · articles `article_no` · infra `apartment_id` · complex_price_history 복합키) — 등록된 writer 누구나 쓰는 중립 칸, ② 칸 기준선 판정에서 제외(구현 중 추가).
- **`writers` = 파일 → 표 → 지금 쓰는 칸(기준선)**. 이것이 "기존은 허용, 새로 늘면 빨강"의 실체다(맹점 🔴B: 파일만 등록하면 등록된 파일 안에서 칸이 늘어도 못 잡는다).
- 칸 목록은 inventory.json 에서 기계로 뽑되 **양성 대조군**으로 손 확인: `naver-collect.py:469-478,489`(`ub("complexes")`) · `:329,331`(`ub("articles")`·`SB.update`) · `:357` · 2u `upsert.py:40`(`pg_insert(model)`) · `env_crime.py:117`(`infra.crime_score =`) · `collect-air-quality.mjs:371,508`.
- `readers` 는 "칸 삭제·이름 변경 금지" 판정(§2-3)에 쓴다. VIEW 가 읽는 칸(`apartments_flat` ← `infra.nearby_facilities`)도 readers 로 센다.
- 검증(정적) = `scripts/audit-shared-db-ownership.mjs --schema`: JSON 형식 · 표마다 `owner` 값 · `writers` 의 파일이 실재(`test -e`) · `columns` 겹침 0. **DB 실측** = 월요일 감시(`monitor-collectors.mjs` 새 항목 ⑲): `information_schema.columns` 의 공유 표 칸 집합 vs 정본 `columns` 합집합 → 정본에 없는 칸(대시보드 손 DDL 포함) 경보 한 줄 · 정본에 있는데 DB 에 없는 표·칸도 경보(맹점 🟠F).

## 2. CI 가드 — 1차 판정은 **파일 등록제 + 칸 기준선**, 쓰기 꼴 대조는 보조

### 2-0. 왜 꼴 대조가 1차가 못 되나(맹점 🔴A 실측)

미분양 핵심 쓰기는 `ub("complexes", cpxs, …)`(`naver-collect.py:489`)·`SB.update("articles", …)`(`:331`) 처럼 **파일마다 다른 헬퍼**를 쓰고, 표 이름이 변수인 쓰기(`sb.from(table).delete()`)가 6파일 13건, 2u 는 `pg_insert(model).values(**values)`(`upsert.py:40`, 2파일)·`db.query(M).filter().update({…})`(`enricher.py:54`)·인스턴스 대입 `infra.crime_score = …`(`env_crime.py:117`) 이다. 꼴을 다 열거하면 새 헬퍼 하나에 뚫리고, 대입 꼴을 정규식으로 잡으면 2u 에서 45파일 345건이 걸려 쓸 수 없다.

### 2-1. 미분양 `scripts/audit-shared-db-ownership.mjs`(ci.yml audit 13번째)

| 단계 | 판정 | 결과 |
|---|---|---|
| ① 등록 대상 찾기 | 파일 안에 **공유(`shared`)·2u 소유 표 이름 리터럴**(`"complexes"`·`'infra'`·`DERIVED_TABLES = [... "infra"]` 처럼 글자로 든 것) **과** 쓰기 호출 흔적(`.upsert(`·`.insert(`·`.update(`·`.delete(`·`upsertBatch(`·`ub(`·`SB.update(`·`SB.upsert(`·`.rpc(`)이 **같은 파일**에 있으면 그 **(파일, 표)** 가 등록 대상(호출과 괄호 사이 공백·줄바꿈도 흔적) | `writers.mibunyang[파일][표]` 에 없음 → 🔴 미등록(파일이 다른 표로 등록돼 있어도 — fix1 🟠A) · 읽기만이면 머리 주석 allow |
| ② 칸 기준선 | 등록된 파일 안의 글자 키(JS `"col":`·`col:`·py `"col":`)가 그 표의 `columns.2u` 에 있고 `writers[파일][표]` 기준선에 없음 → 🔴 / 기준선에 있는 `contested` 칸은 통과 | 새로 늘면 빨강(🔴B 처방) |
| ③ 행 삭제 | 등록 여부와 무관하게 **삭제가 닿는 표** 단위: 같은 문장 `from("<shared>")….delete(` → 그 표 / `from(<변수>)….delete(` → 파일 안 배열 리터럴·`= "<shared>"` 대입으로 닿는 shared 표. 닿는 표가 `delete_allowed[파일]` 밖이면 🔴(구현 중 정교화 — 파일 단위면 고친 뒤 fix-sosa 도 계속 빨강이라) | C4 `fix-sosa-coordinates.mjs`(`:73 DERIVED_TABLES` 에 `"infra"` + `:167 .delete(`) 가 여기서 빨강 → 이번에 고침(§5) → 고친 뒤는 통과(등록 불필요) |
| ④ 마이그 | `supabase/migrations/**` 새 파일에서 `DROP COLUMN( IF EXISTS)?`·`RENAME COLUMN`·`DROP TABLE`·`ALTER TABLE … RENAME` 의 표에 `readers` 가 있으면 🔴 · `ADD COLUMN` 을 남의(2u) 표에 → 🟡(통보 대상, 규칙 위반 아님 C7) · `DROP VIEW`/`CREATE OR REPLACE VIEW` 로 2u 가 읽는 VIEW 를 다시 만들면 🟡 통보 | |
| ⑤ 정본 자체 | §1-2 검증(형식·파일 실재·겹침) | 🔴 |

- 변수 표 이름(`from(table)` 13건)·RPC(4건, 권한 지문용)는 ①의 "리터럴이 파일 어딘가에 있나"로 등록 대상이 되므로 따로 꼴을 풀지 않는다. 리터럴조차 없는 파일(표 이름을 인자로 받는 범용 도구 `_shared.mjs:142 upsertBatch`·`data-audit.mjs`)은 **호출하는 쪽** 파일에서 리터럴이 잡힌다 — 헬퍼 정의 파일은 `helpers` 예외 목록(정본 `guard.helpers`)에 적는다.
- **끄는 법**: 읽기만 하는 파일이 ① 에 걸리면 파일 머리 주석 `// ownership-guard: allow <표> <사유>` 한 줄(가드가 읽어 **① 만** 🟡 로 내리고 보고에 남김 — 그 표에 쓰기 사슬 `from("표")….update|upsert|insert|delete(`·`ub("표"`·`upsertBatch("표"`·`SB.update|upsert("표"` 가 있으면 ① 도 🔴, ②③ 은 allow 와 무관하게 🔴 · fix2) — `ALLOWLIST` 상수 대신 **파일 안**에 두어 리뷰에서 보이게. 전체 끄기는 없음(CI 단계를 지우는 PR 이 곧 끄기).
- 가드 자체 시험 `audit-shared-db-ownership.test.mjs`(`meta/guards-must-be-mutation-tested`): 양성 대조군 = **지금 코드베이스에서 실제 꼴 그대로**(`ub("complexes"` · `SB.update("articles"` · `DERIVED_TABLES` 를 돌며 `from(table).delete()` · `upsertBatch("applyhome_cancel_respl"`) 를 임시 파일로 복사해 ①③ 이 잡는지 → 변이 5: (a) 미등록 파일이 `"complexes"` + `.upsert(` → 🔴 (b) 등록 파일에 2u 칸 `"cortar_no":` 추가 → 🔴 (c) `"infra"` + `.delete(` → 🔴 (d) 마이그 `ALTER TABLE apartments DROP COLUMN IF EXISTS lat` → 🔴 (e) **반대 방향**: 미분양 전용 표(`consults`)에 `.delete(` → 통과해야 함(가드가 넓게 번지지 않는지).

### 2-2. 2u `backend/scripts/audit_shared_db_ownership.py`(2u 창 구현 · 2u 규칙)

- 정본 raw URL 을 받아 **`version == 1` 확인**(다르면 "정본 형식이 바뀜 — 가드를 맞추기 전까지 2u 레포 `backend/.ownership-guard-off` 파일로 끔" 메시지와 함께 빨강 · 받기 실패도 빨강 — 조용히 통과 금지).
- ① 등록 대상 = 파일 안에 미분양 소유·`shared` 표의 **모델 클래스 이름**(`db/models.py:32,87` `Complex`·`Article` + `mb_models.py` 18개 — `__tablename__` 으로 표를 푼다, **두 파일 모두**) 또는 표 이름 리터럴(raw SQL) **과** 쓰기 흔적(`db.add(`·`session.add(`·`pg_insert(`·`.update({`·`.delete()`·`text("INSERT|UPDATE|DELETE`) → `writers.2u` 에 없으면 빨강 ② 칸 기준선 = 등록 파일의 글자 키(`"col":`·`col=`·`.col =`)가 `columns.mibunyang` 에 있고 기준선에 없음 → 빨강 ③ 삭제 = `shared` 표 모델 + `.delete(` → `delete_allowed` 밖이면 빨강 ④ 마이그 `backend/db/migrations/V0NN__*.sql` 에서 미분양이 읽는(`readers` 에 mibunyang) 표·칸 `DROP|RENAME` → 빨강.
- CI 자리: backend job 은 `changes` 경로 필터(`ci.yml:296-298`)로 건너뛰는 PR 이 있고, **미분양이 정본을 바꿔도 2u CI 는 돌지 않는다** → **별도 job**(`ownership-guard`, 필터 없이 항상, `python backend/scripts/audit_shared_db_ownership.py` 1분 내) + **`schedule` 주 1회**(월요일 — 정본만 바뀐 뒤 2u 코드가 어긋났는지 잡는다). 미분양 창이 정본 읽기 파이썬 함수 초안·통보 yml·세션 시작 훅 줄을 써서 2u 에 넘긴다(2u 몫 = 등록제 판정 + 시험 + 문서 4, 반나절 크기).
- 시험 = pytest 변이 4(미등록 파일 `pg_insert(Complex)` · 등록 파일에 `lat=` 추가 · `db.query(Infra).delete()` · 반대 방향 2u 전용 표 삭제는 통과).

### 2-3. 읽기 계약(칸 삭제·이름 변경 금지)은 ④ 마이그 판정이 담당 — 양쪽 가드 모두. 대시보드에서 손으로 친 DDL 은 §1-2 월요일 감시 ⑲ 가 잡는다.

## 3. 합친 뒤 자동 통보

### 3-1. 방식 = **자기 레포에 라벨 이슈, 상대가 읽고 닫는다**(결정 §7-2)

- 워크플로 `notify-sister.yml`: `on: push: branches: [main]` + **`permissions: issues: write, contents: read`**(두 레포 기본 권한이 `read` — 실측) · 라벨 `cross-repo-notice` 는 **먼저 만든다**(`gh label create cross-repo-notice -R <레포> --color 0E8A16`, 지금 두 레포 모두 0건 — 워크플로는 없으면 만들고 진행).
- 이슈 1건/푸시: 제목 `[→2u] <커밋 제목>`, 본문 = 통보 사유(어느 표·칸·파일)·커밋·PR 링크·"읽고 조치했으면 이 이슈를 닫아 주세요".
- 상대 레포 세션 시작 훅이 `gh issue list -R developer-duno/mibunyang --label cross-repo-notice --state open` 으로 읽는다(로컬 gh 두 레포 다 developer-duno · 계정 전환 불필요). **닫음 = 읽음**. 쌓임 방지(맹점 🟠E): 같은 워크플로가 **열린 지 14일 지난 통보 이슈를 `stale-unread` 라벨을 붙여 닫고** 닫힘 댓글에 "읽지 않은 채 닫힘"을 남긴다(세션 시작 표시는 그 라벨 개수도 함께).
- 기각: 상대 레포 직접 이슈(PAT 등록·회전) · 메모리 쪽지(PC 하나에 묶임·CI 불가) · 텔레그램(안 읽은 목록이 안 남음 — 보조 가능).
- ⚠ **자동 통보는 사후 기록이다**: 마이그는 대개 PR 을 합치기 **전에** 대시보드에서 먼저 적용되므로(`data-changing-run-approval` 절차), 합친 뒤 오는 이슈는 DB 변경보다 늦다. 마이그 통보 본문에는 **"DB 반영 시각: (적용한 사람이 채움)"** 칸을 둔다.
- ⚠ **범위 밖**: 로컬 러너(Windows 스케줄러·`kosis-local-runner`)는 작업 트리의 **미커밋 코드**를 그대로 돌린다 — 가드와 통보는 합친 코드만 지킨다. 로컬 손수정은 `multi-repo` §6·`admin-district-code-reform` §6(워크트리에서 편집) 관행이 막는다. 공유 표 DDL 을 적용하기 **전**의 상대 통보는 지금처럼 사람 쪽지(또는 PR 라벨 `notify-2u` 로 미리 이슈)를 유지한다 — 자동 장치는 "빠뜨린 통보"를 잡는 그물이지 사전 알림을 대신하지 않는다.

### 3-2. 통보 대상(노이즈 기준 — 지난 2개월 마이그 23건·등록 파일 커밋 ~26건 = 주 6건은 너무 잦다 🟠E)

| 바뀐 것 | 통보 | 비고 |
|---|---|---|
| `supabase/migrations/**` 새 파일 중 **2u 가 읽거나 공유하는 표**(`readers` 에 2u 또는 `owner: shared`)를 건드린 것 | ✅ | 미분양 전용 표(`trade_deals` 등) 마이그는 ✗ |
| `writers.mibunyang` 에 등록된 파일의 변경 | ✅ 단 diff 가 **주석·공백 줄만**이면 ✗ — `git diff -w` 는 주석을 못 거르므로 diff 의 추가·삭제 줄을 전부 꺼내 `//`·`#`·`/*`·`*` 로 시작하거나 빈 줄이면 제외, 하나라도 남으면 통보 | 손 쪽지 3건 |
| `supabase/ownership.json` 변경 | ✅ 항상 | 2u 가드가 읽는 정본 |
| 굽기 커밋 `data: daily refresh (auto)` · Dependabot | ✗(커밋 작성자·제목 접두로 제외) | 노이즈 |
| 공유 외부 키 상수(`MOLIT_KEY` 간격·`SGIS_*`·K-apt 간격) | 2단계 — 정본 `shared_env` 파일 목록이 생기면 같은 규칙 | 손 쪽지 2건 |
| 화면·문서·사장님 지시 전달 | ✗ 사람 쪽지 · PR 라벨 `notify-2u` 를 달면 같은 이슈 꼴로 수동 통보 | |

### 3-3. 세션 시작 표시

- 미분양 `.claude/settings.json` SessionStart 에 **`matcher: "startup"` · `timeout: 10`** 한 줄(resume·compact 때 재호출 방지 🟡G): `📬 2u 통보 N건(안 읽음 · 14일 넘어 닫힘 M건): 최근 3건 제목` · gh 실패면 `📬 확인 못 함(gh 오류)` 로 정직하게. 2u 는 2u 창이 같은 꼴로.

## 4. 문서 리뉴얼(13개 — 가리키기만)

- 미분양 8(추적 파일만): `CLAUDE.md:44,79`(표 수 55+2) · `supabase/CLAUDE.md` **:5(표 수)·:116-145 「테이블 소유권」 표·:163-165(17개 표 서술)·:234(공용 표 목록)** → "정본 = `supabase/ownership.json` · 읽는 법 · 바꾸는 법(PR → 통보 이슈 자동)" 한 절로 교체 · `docs/audits/2026-09-22-…` 머리에 "대체됨 → ownership.json" 한 줄(`artifacts/s557/OWNERSHIP.md` 는 **git 미추적** — PR 대상 아님, 로컬에서 그대로 둠) · `.claude/agents/migration-safety.md`(trades 제외·infra 추가·`nearby_apartment_ids` 삭제 → 목록을 읽게) · `ARCHITECTURE.md:610` 칸 삭제 · `BACKLOG.md:1145` 문구 · 옛 설계서 2개 주석.
- 2u 4(2u 창): `docs/DATA_SOURCES.md` · `.claude/rules/infra.md:196-201` · `rules-detail/infra.md:95,97` · `.claude/agents/migration-safety-reviewer.md:28`.
- 원칙: 문서에 표·칸 이름을 **다시 적지 않는다**. 적어야 하면 "`ownership.json` 의 `tables.infra.columns` 참조".

## 5. 충돌 C1~C7 처리

| # | 이번 범위 | 처리 |
|---|---|---|
| C4 infra 행 통째 삭제 | ✅ | `fix-sosa-coordinates.mjs:73,167` → `fix-placeholder-addresses.mjs:1656-1661` 방식(`infra` 는 `columns.mibunyang` 카카오 칸만 null UPDATE · transport/schools 만 delete). 가드 ③ 이 빨강 내므로 같이. 실행 경로 0(`.github`·`scripts/*.bat`·`package.json` grep) |
| C7 남의 표에 칸 추가 | ✅ | 가드 ④ 🟡 + 통보 |
| C1 complexes 10칸 | 등재만(`contested` + 기준선) | 별도 트랙: 원천이 다르다(마커 bbox vs 2u 검색) → "2u 가 주인, 미분양은 없을 때만 채움" 을 2u 와 합의 뒤 · C6 `last_crawled_at` 도 그때 |
| C2 articles 12칸 + 행 수명 | 등재만 | 별도 트랙(2u 물리 삭제 vs 미분양 `is_active=false` · 2u 화면 영향부터 2u 확인) |
| C3 infra.updated_at | 등재만(`clock`) | 별도 트랙: 인과 실측 뒤 `infra.kakao_updated_at` 칸 + `infra-kakao.mjs:59-72` — 마이그·전이표 |
| C5 complex_price_history | 등재만(`sources`) | 별도 트랙: `trade-stats.mjs:378`·`sync-naver-complex.mjs:676` 값 영향 실측 |

## 6. 작업 나누기 · 순서

1. (미분양 창 · 워크트리 · opus-coder) ① `supabase/ownership.json`(inventory → 변환 스크립트 `scripts/build-ownership.mjs` 1회 + 양성 대조군 손 확인) ② `audit-shared-db-ownership.mjs` + `.test.mjs`(변이 5) ③ `ci.yml` 단계 ④ C4 수정 ⑤ `notify-sister.yml` + 라벨 생성 ⑥ SessionStart 훅 ⑦ 감시 ⑲ ⑧ 문서 9개 → 검사관(적대 Opus[가드·워크플로·감시]·맹점 Opus[계획 대비]·할루 Sonnet) → PR.
2. (2u 창 · 쪽지) §2-2 가드 + 별도 job + 통보 워크플로(미분양 것을 그대로 옮김) + SessionStart + 문서 4개.
3. 둘 다 합친 뒤 통보 1건을 **일부러** 만들어(정본 `updated` 날짜 PR) 양쪽 세션 시작 표시까지 실증(`workflow-name-hallucination`: success ≠ 동작) · raw 5분 캐시 때문에 2u CI 재실행 1회 예상.

## 7. 결정(사장님 2026-10-09 07:5x · AskUserQuestion)

1. 정본 위치 = **미분양 레포 1개**(`supabase/ownership.json`), 사본 없음
2. 통보 방식 = **자기 레포 라벨 이슈**, 상대가 닫아 읽음 표시
3. 통보 범위 = §3-2(조사로 확정 · 맹점 🟠E 반영해 좁힘)
4. 상가 = **제외**(상가 `docs/상세계획.md:94` "공유 DB 와 분리")
5. C1·C2 = **등재만**, 해소는 별도 트랙
6. C4 = **이번에 고침**

## 8. 판 이력

- v1 07:4x 초안 → v1.1 07:5x 결정 반영 → **v2 08:1x 맹점 검토 반영**: 🔴A 가드 1차 판정을 꼴 대조→파일 등록제(§2-0·2-1·2-2) · 🔴B `writers` 를 칸 기준선으로(§1-2) · 🟠C 순수 JSON·version·끄는 스위치·raw 캐시·순서 규칙(§1) · 🟠D `permissions`·라벨 선생성·주석 제외 구현(§3-1·3-2) · 🟠E 통보 좁힘·14일 자동 닫기(§3) · 🟠F 마이그 판정 양쪽·`IF EXISTS`/`RENAME`/VIEW·orphan 정정(`nearby_facilities` 추가·`corridor_type` 은 미분양 칸)·월요일 감시 ⑲(§1-2·2-1 ④) · 🟡G startup matcher·필수 검사 없음 명시·2u 별도 job. (G 뒷부분 = 검사관 보고 나머지 수신 뒤 반영)
