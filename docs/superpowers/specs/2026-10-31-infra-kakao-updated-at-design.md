> 사본 — 원본 `.omc/artifacts/session681/kakao-updated-at-design.md`(깃 밖) · 커밋 시점 2026-10-31 16:1x KST(기준 e862c0fc · 가지 s681/kakao-clock) · 내용은 원본 그대로.

# 설계서 — `infra.kakao_updated_at` 카카오 전용 날짜 칸 (세션681 · 2026-10-31 · Fable)

> 상태: **v2 — 검사관 2인 반영 끝(할루 Sonnet 🟡 3 · 맹점 Opus 🔴0 🟠5 🟡8 🟢5 · 보고 = `.omc/handoffs/session681/review-design-*.md`) → 👤 「이대로 구현」 → 구현 PR #846 `91f3501b`(10/31 · 적대 Opus 🔴0🟠0🟡3 + 할루 Sonnet) · 운영 DB 칸 적용 10/31 17:4x · 2u 통보 #847.** (세션682 2단 마무리 맹점 Opus 🔴1 🟠2 🟡8 → §4-0·§4-5·§5 정정 — 보고 `.omc/handoffs/session682/review-wrap-blind.md`)
> 조사 재료 = `.omc/artifacts/session679/transition-b2.md`(B2 ①~③ · 운영 DB 실측 10/31) · 상한 코드 = `m1-cap-saved.patch`(세션679 · 시험 11개).
> 숫자는 전부 10/31 실측값 — 구현 직전 다시 잰다. v1→v2 바뀐 자리는 「(v2)」 표시.

## 0. 사장님 결정(2026-10-31 15:2x · 이 세션)
| # | 물음 | 결정 |
|---|---|---|
| D1 | 새 칸이 비어 있어 첫 회차에 3,440곳이 몰리는 것을 어떻게 나누나 | **한 회차 상한 800곳**(세션679 코드 재사용) |
| D2 | 새 날짜를 손님 화면(상세 입지 탭)에 「입지 자료 기준일」로 보이나 | **이번엔 안 보임**(칸·수집기·감시만 · 화면 변경 0) |
| (679) | 입지 12곳 재수집 전이표 → 전제 틀림 · 「전용 날짜 칸 설계부터」 | 이 설계서가 그 답 |

## 1. 문제 (한 줄 + 근거)
**입지 표 `infra` 의 시계 `updated_at` 은 공유 시계라, 카카오 수집기의 「30일 지나면 다시 잼」 판정이 사실상 꺼져 있다.**
- 트리거 `trg_infra_updated BEFORE UPDATE ON infra`(`supabase/migrations/20260313024159_init_mibunyang.sql:366-367`)가 **모든 UPDATE** 에 `updated_at = now()`. 열 지정이 없다(schools 는 세션568 `20260924000300_schools_updated_trigger_nearby_only.sql:30` 에 `OF nearby_schools` 로 바꿨지만 infra 는 2u 와 공유라 안 건드렸다). INSERT 는 칸 기본값 `DEFAULT NOW()`(init `:137`).
- 같은 표를 UPDATE 해 시계를 올리는 우리 쪽 수집기: `collect-police.mjs:86`(매월 1일 KST 01:00 · `collect-police.yml:5`) · `collect-childcare.mjs:108` · `collect-emergency.mjs:125`(셋은 `updated_at` 을 직접도 씀) · **(v2) `collect-air-quality.mjs:371·508`(매일 약 100행, 트리거로 올라감)**. 2u 환경 수집기(어린이집·응급실 배치)도 같은 행을 UPDATE.
- 판정 함수 `buildFreshIds`(`scripts/collectors/infra-kakao.mjs:59-72`)는 `updated_at`(`:66`)이 30일 안이고 `REQUIRED_KEYS`(`:50` — 8종 개수 + `subway_dist`)가 전부 non-null(`:68`)이면 건너뛴다 → 남이 찍은 시각으로 「최신」 판정.
- 운영 실측(10/31 · `b2-count.log`): infra 3,440행 중 **3,255행이 `2026-10-18T13:59:24Z` 같은 초**(남의 일괄 UPDATE · 앞뒤 1.5시간 `collector_runs` 0행 — 세션679 메인 실측, 재료 파일엔 없음 · 2u 세션473 crime 비움 10/18 과 날짜 같음, 미확인). 10/01~03 police 회차 ok 3,255.
- 결과: 신도시(부산 에코델타·세종 스마트시티 등 19곳 · `b2-probe-infra.json`)에 시설이 생겨도 「0·없음」이 굳는다. 반대로 3,255행이 **같은 날 30일을 넘겨** 11/20(금) 05:30 회차에 약 29,000콜 몰림(남이 또 찍으면 뒤로 밀림).
- **(v2) 2u 손님 화면도 이 공유 시계를 「인프라 신선도」로 보여 준다** — `D:/naver-estate-web/frontend/src/components/mb/MbEnvironmentSection.tsx:58` `<FreshnessTag iso={infra.updated_at}/>` · `backend/routers/mb_serializers.py:220-221`(주석 「인프라 데이터 갱신시각 (신선도 표시)」). 지금도 틀린 값(남이 찍은 시각)이다 → 2u 통보 이슈에 적는다(§3-4).
- 정본 `supabase/ownership.json` `known_conflicts.C3`(`:1606`) 에 이미 「해소 = infra.kakao_updated_at 칸(별도 트랙)」. 2u 는 같은 문제를 **같은 방법**으로 풀었다(2u `V053__infra_childcare_updated_at.sql`·`V054__infra_emergency_updated_at.sql` — 요지: 「공용 updated_at 은 mibunyang 도 갱신하므로 순환 키로 못 쓴다」 · (v2) 원문 그대로의 인용이 아니라 요지).

## 2. 목표 / 비목표
- **목표**: 카카오 수집기가 **자기 시계**로 30일 재확인을 하게 한다. 첫 회차 몰림은 상한으로 흩뿌린다(D1). 되돌리기 한 수(칸 DROP + 코드 되돌림).
- **비목표**: `updated_at` 트리거·의미 변경(2u 공유) · 다른 수집기(police·childcare·emergency·air-quality)의 시계 분리(그쪽은 「전 행 매월/매일 N행」이 설계라 재확인 판정이 없다 — 검사관 12b 동의 · 후속 BACKLOG 한 줄) · 우리 화면 노출(D2) · 19곳의 「진짜 0」 판정(첫 사이클 뒤 결과로 본다) · 2u 화면의 신선도 표시를 새 칸으로 바꾸는 것(2u 몫 — 통보로만).

## 3. 설계

### 3-1. DB — 칸 하나
```sql
-- supabase/migrations/20261101000000_infra_kakao_updated_at.sql
SET lock_timeout = '5s';
ALTER TABLE infra ADD COLUMN IF NOT EXISTS kakao_updated_at TIMESTAMPTZ;   -- 기본값 없음 · NULL = 카카오로 잰 적 없음
COMMENT ON COLUMN infra.kakao_updated_at IS
  'infra-kakao.mjs(미분양) 가 카카오 8종+지하철을 잰 시각 — 30일 재확인 시계. 공유 시계 updated_at(트리거) 과 별개. NULL = 잰 적 없음. 세션681';
NOTIFY pgrst, 'reload schema';
-- 확인(기대 1행 · timestamp with time zone · YES):
--   SELECT column_name, data_type, is_nullable FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='infra' AND column_name='kakao_updated_at';
-- ROLLBACK: _rollbacks/20261101000001_rollback_infra_kakao_updated_at.sql  = ALTER TABLE infra DROP COLUMN IF EXISTS kakao_updated_at; NOTIFY pgrst, 'reload schema';
```
- 타입 = `TIMESTAMPTZ`(infra.updated_at 과 같다 — init `:137` · 우리 선례 `apartments.sgis_mapped_at` `20261008000000`). 2u 의 `childcare_updated_at` 은 `TIMESTAMP`(V053 `:32`)인데 우리 칸은 우리 코드만 읽으므로 우리 관례.
- 트리거 없음. 수집기가 **성공한 upsert 행에만** 자기 손으로 쓴다(2u 선례와 같음).
- NULL 허용·기본값 없음 → 기존 3,440행 전부 NULL = 「잰 적 없음」. 표를 다시 쓰지 않는다. 가짜 날짜로 채우지 않는다(D1 ③안 기각).

### 3-2. 수집기 `scripts/collectors/infra-kakao.mjs`
| 자리 | 지금 | 바꿈 |
|---|---|---|
| `:147` infra 읽기 select 목록 | `apartment_id, updated_at, subway_dist, 8종` | `+ kakao_updated_at`. `updated_at` 은 **남긴다**(로그에 「남의 시계」 최신 분포를 한 줄 찍어 공유 시계 덧쓰기 빈도를 관찰 · 판정·정렬엔 안 씀 — §6 Q1 추천대로) |
| `:59-72` `buildFreshIds` | `r.updated_at` 으로 30일 판정 | **`r.kakao_updated_at`** 으로 판정. NULL·파싱 불가 → 재수집(지금 동작 유지). 완결 조건(`REQUIRED_KEYS`)은 그대로 |
| `:171` upsert 행 | `{ apartment_id, updated_at: now }` | `+ kakao_updated_at: now`(같은 ISO 문자열). `updated_at` 직접 쓰기는 남긴다 — (v2) 효과는 없다(INSERT 는 DEFAULT NOW, UPDATE 는 트리거) · ownership 기준선 유지용 |
| 상한(D1) | 없음(PR-E 에서 뺌) | `m1-cap-saved.patch` 그대로: `DEFAULT_MAX_APTS = 800` · `--max-apts=N` · `selectInfraTargets(withCoords, infraRows, {maxApts, force})` · `INFRA_DEFERRED=N` 표식(`collector_runs.error_message`, status 그대로). **패치의 정렬 키 `tsOf`(`updated_at`, 패치 `:72`)를 `kakao_updated_at` 으로** + (v2) 머리 주석 「updated_at 오래된 순」(패치 `:31-32`)·시험 이름 「updated_at 이 같으면 id 순」도 같이 |
| (v2) `--force` | 패치 = `--force` 면 상한 없음(31,000콜) | **`--force` 는 `--max-apts` 와 함께 줄 때만**(없으면 던진다 — 운영자가 `--force` 만 쳐서 전량이 나가는 길 닫음 · 2줄 + 시험 1개). `collect-infra.yml` 은 `--force` 를 안 넘긴다(`:53-57`) |
| (v2) `--dry-run` | 카카오를 실제로 부른다 | 그대로(미리보기도 비용 = 회차당 최대 800×9 = 7,200콜 · 시계를 안 쓰므로 같은 800곳 반복) — 머리 주석에 호출 수를 적는다. 대상 **명단만** 보려면 §4-5 의 읽기 전용 흉내 |
| (v2) 빈 응답 | `searchKakao`(`:108-114`) `data.documents \|\| []` → 0건 덮어씀 | `data.meta` 또는 `documents` 배열이 **없으면 오류로 던진다**(모양이 깨진 응답 = 한도·장애 의심 → 그 단지 `errored`, 옛 값 유지 · 호출 0 추가 · 3줄 + 시험 1개). 「8종 전부 0 이면 시계 안 씀」은 기각 — 진짜 0 인 19곳을 매 회차 다시 잰다 |
| 고르는 순서 | — | ① infra 행 없음·REQUIRED_KEYS 빈칸(한 번도 못 채움) ② `kakao_updated_at` 오래된 순(NULL = -∞ = 맨 앞) ③ id |
| 로그 | 「전체 N 중 M 최신 건너뜀 · 대상 K」 | `+ 이번 상한 800 · 다음 회차로 넘김 D건` |
| (v2) 실패 기록 | `main().catch`(`:225`)가 로그 + exit 1 만 — `collector_runs` 행 없음 | catch 에서 `recordCollectorRun(PHASE, {fail:1, errorMessage})` 를 남긴다 → 감시 ⑬ 이 다음 날 잡는다(select 실패·칸 없음 같은 「시작도 못 한 회차」가 조용히 반복되지 않게) |

- **첫 사이클 흉내(D1 상한 800 · (v2) 검사관 9b 반영)**: 지금 3,440곳 전부 NULL → 19곳도 완결(subway_dist 있음·개수 0 — `b2-probe-infra.json` 19행 전부 숫자)이라 rank 1 → 전부 rank 1 → id 순 800씩 → **화·금 5회차(약 2.5주)** 에 전부 `kakao_updated_at` 이 박힌다. 19곳은 id 순 어디쯤 — 첫 회차 보장 없음(D1 단점 알림 끝). **그 뒤**: 800곳 묶음 5개가 30일 뒤 **묶음째 같은 회차에** 다시 오고 새 단지(rank 0)가 더해져 800 을 조금 넘는다 → 「5회차 약 800 + DEFERRED 수십 → 약 3회차 거의 0」 꼴이 30일마다 반복. 평평하게 펴기(30일 기준에 단지별 흔들림)는 선택 — 손님 영향 0, 첫 사이클 뒤 결정(§6 Q5).
- 호출 수: 단지당 9콜(키워드 8 `:173-178` + SW8 카테고리 1 `:180-181`) → 상한 회차 7,200콜 · 약 9~10분(동시 5 · 단지당 0.7초). 같은 job(`collect-naver-listings-incremental.yml:10` 화·금 05:30 · `:34` 240분 · transport → infra → schools). (v2) 240분 위험은 원래 transport 예산 180분(`transport-tago.mjs:581`) + schools 101~140분 조합의 것이고 infra 는 schools 앞이라 피해자가 아니다 — 별건. 카카오 하루 한도 키워드 10만·카테고리 10만(공식 quota 문서 · 세션679 확인) 안.
- 새 infra 행이 생기는 길 전부(검사관 2 확인): police·emergency·childcare upsert(`collect-police.mjs:84`·`collect-emergency.mjs:119`·`collect-childcare.mjs:112`) · `transport-tago.mjs:644` · 2u `Infra(apartment_id)` · 옛 `seed-from-json.mjs:163` — 개수 DEFAULT 0 + `subway_dist` null 이라 rank 0 으로 **맨 먼저** 고른다. `fix-sosa-derived-restore.mjs:155` 는 값만 복사하고 시계는 안 옮김(NULL → 다시 잼, 무해). 영영 빠지는 길 없음.

### 3-3. 정리 도구 — 시계도 같이 비운다
- `scripts/fix-placeholder-addresses.mjs:353` `INFRA_KAKAO_COLUMNS` 에 `kakao_updated_at` 추가 → 좌표 정정 뒤 카카오 칸을 비울 때 시계도 NULL. `fix-sosa-coordinates.mjs:63` 은 이 상수를 import 하므로 따라온다.
- **(v2) 깨지는 시험**: `fix-placeholder-addresses.test.mjs:830` `toHaveLength(INFRA_KAKAO_KINDS.length * 2 + 1)` → `* 2 + 2` 로 바꾸고 주석에 「+ subway_dist + kakao_updated_at(시계)」. `:808-834` 의 「남의 칸 안 건드림」 시험은 그대로 통과.
- 세션556 실사고(개수 칸만 비워 거리 칸이 남음)와 같은 결 — 칸을 더할 때 상수 한 곳만.

### 3-4. 정본 `supabase/ownership.json` · 2u 통보
- `tables.infra.columns.mibunyang` 에 `kakao_updated_at`(17 → 18칸) · `tables.infra.note` 「카카오 17칸」 → 18칸 + 「C3 해소 2026-11 — 카카오 시계 = kakao_updated_at」 · `known_conflicts.C3` 를 「해소(마이그 20261101000000)」로 · `writers.mibunyang["scripts/collectors/infra-kakao.mjs"].infra`(`:863-884`) 와 `fix-sosa-coordinates.mjs` 목록에 추가.
- (v2) 생성기 `scripts/build-ownership.mjs` 는 **1회 도구**(머리 주석 「다시 돌리면 그 뒤 고친 것이 덮인다」) — 정본은 JSON 손수정이 맞다. 일관성 위해 `:168` `kakaoCols`·`:145` 「17칸」·`:219` C3 문구도 같이 고친다(🟢).
- (v2) `monitor-ownership.test.mjs:24` 가 `kakao_updated_at` 을 「정본에 없는 칸」 **예시**로 쓴다 — 고정 객체(`:10`)라 실제 정본을 안 읽어 깨지진 않지만, 예시 이름을 다른 가짜 칸(`ghost_col`)으로 바꾼다(🟢).
- CI `audit-shared-db-ownership` ④(`:22-23`): 공유 표 `ADD COLUMN` 은 🟡(통보 대상) · ② 는 2u·다툼 칸만 보므로 새 우리 칸은 중립 · ⑤ 칸 겹침 0 → 통과 예상. 합치면 `notify-sister.yml` 이 **이 레포**에 `cross-repo-notice` 이슈를 연다(`notify-sister.mjs:8` · 세션678 #841 선례).
- **(v2) 2u 통보 문안**(이슈 댓글): ① infra 에 칸 1개 `kakao_updated_at`(미분양 소유 · TIMESTAMPTZ NULL) 추가 — 2u ORM(`mb_models.Infra`)은 적은 칸만 읽어 영향 0, 2u 가 쓰거나 읽을 일 없음 ② **2u 상세 「주변 환경 › 인프라」 신선도 표시(`MbEnvironmentSection.tsx:58` · `mb_serializers.py:220`)가 공유 시계 `infra.updated_at` 을 보여 주는데, 그 값은 police·childcare·air-quality·2u 배치가 찍은 시각이라 지금도 「인프라 갱신시각」이 아니다** — 카카오 입지 8종 기준일로 바꾸려면 새 칸을 ORM 에 1줄 매핑해 쓰면 됨(2u 결정) ③ 2u 소유권 감사 ②(`audit_shared_db_ownership.py:21-22`)는 새 칸이 우리 칸이라 2u 가 쓰면 막는다(의도대로) ④ 2u 마이그 최신 V074(infra 무관)라 일정 충돌 없음.

### 3-5. 감시(`scripts/monitor-collectors.mjs`)
- ⑤ `EXTERNAL_API_COLLECTORS` 에 `{ collector: "infra", stale_days: 14, owner: "카카오 로컬 8종+지하철 (Actions 화·금 05:30)" }` 1줄(지금 infra 항목 없음 — `infra` 글자는 `:2`·`:147`·`:219`·`:253`·`:2977` 가중치·라벨·공개 읽기 명단뿐). **(v2) ⑤-a(「최근 3회 success 인데 ok 0 이고 skip 0」, `:976-978`)는 infra 에선 안 울린다** — 건너뛴 최신 행을 `rpt.skip`(`infra-kakao.mjs:160`)으로 세어 skip 이 늘 0 보다 크다. 유효한 건 **⑤-b(14일 미발화)** 만. 그래서 ⑬(실패 행 — §3-2 catch 보강이 전제)·①·⑤-b 셋이 「멈춤」을 잡는다.
- 새 점검(번호 = 구현 때 마지막 번호 +1) `checkKakaoClockStale`: 좌표 있는 단지 중 `kakao_updated_at` 이 **45일** 넘었거나 NULL 인 행 수 — **첫 사이클(2.5주)+30일 뒤부터** 임계 적용(그 전엔 NULL 정상). 임계는 첫 사이클 뒤 실측으로(규칙 data-changing-run-approval §2). 구현 때 ⑥·⑫ 류 count 점검 꼴 복사. 이번 PR 에는 **로그만**(NULL 수·45일 초과 수), 경보는 다음 PR.
- (v2) `INFRA_DEFERRED=N` 은 기록만 · 기존 파서와 충돌 0(⑪ `REGION_UNRESOLVED`·⑬ `:1625` failure 만 봄 · `_shared.mjs:623` 별개 표식). 기대값 = 첫 5회차 2,640→…→0 · 30일 뒤 묶음 회차 「수십」 · 나머지 0. 경보로 올릴 땐 「0 아님」이 아니라 「2회 연속 증가」 꼴(첫 사이클 뒤 결정).
- (v2) **⑲ 소유권 정본 대조(`checkOwnershipColumns` · KST 월요일만 `:4508`)** 가 「DB 칸 vs 정본 칸」을 맞댄다 → DB 에 칸을 먼저 넣고 정본 PR 을 합치기 전에 월요일 09:00 KST 가 끼면 「infra: 정본에 없는 칸 1 · kakao_updated_at」 경보 1건. §4 순서에서 **같은 날 끝낸다**(또는 경보 1회 예상이라 적는다).

### 3-6. 권한 지문·공유 표 영향
- `permission_fingerprint()`(`20260924000400:112-130`) `column_grants` 는 **칸 ACL(`attacl`) 이 있는 칸만** → 새 칸(ACL 없음)은 지문을 바꾸지 않을 것으로 본다. **적용 직후 `node scripts/perm-baseline.mjs`(미리보기)로 실측** — 바뀌면 `--accept --note="PR #NNN infra.kakao_updated_at"`.
- 10-30 Supabase 변경(새 **표**에 service_role 기본 권한 없음)은 기존 표 칸 추가와 무관 — 적용 뒤 supabase-js(service_role)로 `select("kakao_updated_at").limit(1)` 1회.
- VIEW `apartments_flat`(최신 `20261031000000_view_card_builder.sql`)은 `i.updated_at` 을 노출하지 않고 칸 목록이 펼쳐져 저장 → 영향 0(D2 와 일치). 굽기 `collect-data.mjs`·`data-audit.mjs` 는 infra `updated_at` 을 읽지 않는다(grep 0).
- 2u: `mb_models.py:254-317` `Infra` 칸 매핑 · `env_common.py:22` `db.query(Infra)` → 모르는 칸은 SELECT 에 안 들어가 **DB 영향 0**. 백엔드 원시 `SELECT * … infra` 0건. (v2) **단 2u 화면이 `infra.updated_at` 을 신선도로 쓴다**(§1 · 통보 ②) — 우리 변경으로 그 값이 더 틀리거나 맞아지지는 않는다(우리 upsert 는 전과 같이 `updated_at` 도 찍는다).

## 4. 적용 순서 (2u V053 교훈 「코드보다 DB 먼저」 · (v2) 마감 = **11/19(수)까지 합치기**)
0. (v2) **마감 근거**: 지금 main 은 상한이 없어 11/20(금) 05:30 회차에 옛 몰림(약 29,000콜 · `transition-b2.md:40,59`)이 한 번 날 수 있다. 한도 안이라 깨지진 않지만 피하려면 11/19 까지. 못 하면 1회 몰림 감수(그날 로그 「갱신 N · 오류 M」과 다음 날 「8종 전부 빈 행 수」(지금 19)로 빈 응답 덮어쓰기 유무 확인). **(세션682) 10/31 합쳐져 마감 안 — 몰림 해당 없음.** 단 §5 되돌림을 통째 revert 로 하면 상한도 사라져 몰림이 되살아난다.
1. **PR 준비**(워크트리 `s681/kakao-clock`): 마이그 + 되돌리기 파일 · 수집기(§3-2 전부 — 패치 적용 뒤 정렬 키·주석·`--force` 조건·빈 응답 가드·catch 기록) · `INFRA_KAKAO_COLUMNS` + 시험 `*2+2` · ownership.json + build-ownership 글자 · monitor ⑤ 1줄 + 시계 로그 · `monitor-ownership.test` 예시 이름 · 문서(§4-6). CI 초록(ownership audit 🟡 1건 예상).
   - **(v2) 시험 설계**: 정렬 키 되돌림 변이를 잡으려면 시험 재료의 두 시계를 **반대로** 둔다 — `updated_at = 1일 전(남의 시계) · kakao_updated_at = 40일 전` → 새 코드는 「대상」, 되돌린 코드는 「최신 건너뜀」. 읽기 select 목록에 `kakao_updated_at` 이 있는지 **소스 대조 시험** 1개(빼먹으면 매 회차 800곳을 영구히 다시 잼). 빈 응답(`meta`·`documents` 없음) 던지기 시험 1개. `--force` 단독 던지기 시험 1개.
2. **검사관**: 설계서 2인(끝) → 구현 뒤 적대 Opus(DB·수집기 — `general-purpose` + `model:"opus"`, 변이 = 위 셋 + 정렬 키 되돌림) + 할루 Sonnet.
3. **DB 적용(코드 합치기 전 · 같은 날)**: 사장님 자리에서 방법 B(크롬 SQL 편집기 · 세션677) 또는 방법 C(Supabase MCP · 세션653 · OAuth 1회). `BEGIN; … ROLLBACK;` 리허설 → 본 적용 → 확인 쿼리 1행 → `NOTIFY pgrst` → supabase-js select 1회 → `perm-baseline.mjs` 미리보기. 시각 = KST 03:00~06:30(굽기·증분)과 월·목 08~14시(네이버 러너)를 피한다 · **월요일 09:00 KST(감시 ⑲) 전에 4번까지 끝낸다**. 운영 데이터 값 변경 0(칸만) → 전이표 불필요.
4. **코드 합치기(같은 날)** → 본 폴더 `git pull --ff-only` + `grep -c kakao_updated_at scripts/collectors/infra-kakao.mjs` ≥ 3.
   - (v2) 순서가 뒤집히면(코드 먼저·DB 늦음): select 가 없는 칸으로 실패 → `selectAll` 이 던지고(`_shared.mjs:1107`) → 지금 코드는 **기록 없이 exit 1**, 단계는 `continue-on-error` 라 job 초록 → ①⑬ 침묵, ⑤-b 가 14일 뒤에야 잡음. §3-2 catch 보강이 들어가면 다음 날 ⑬ 이 잡는다. 어느 쪽이든 「고칠 때까지 매 회차 실패」 — 되돌릴 땐 **코드 먼저**(§5).
5. **첫 회차 확인**(첫 회차 = **11/03(화) 05:30** · 이어 11/06(금)·11/10(화)·11/13(금)·**11/17(화) 5회차** — 세션682 정정: cron 은 UTC 월·목 20:30 = KST 화·금 05:30, 요일은 `date -d` 로 잰다): (v2) **전날(11/02 월 오후 — 네이버 러너·청약홈 seed 뒤) 메인이 읽기 전용 흉내로 첫 800 id 명단을 파일로 뜬다**(도구 `.omc/artifacts/session681/first-run-ids-probe.mjs` — 수집기와 같은 조회 + `selectInfraTargets` · 카카오 호출 0 · `--out=.omc/artifacts/session681/first-run-ids.json` — 규칙 next-session-grep-mandate §4 「개수 + 명단」 · 리허설 10/31 18:5x: 좌표 있는 단지 3,440/3,440 · 0순위 0 · 대상 800 전부 `ah-`(id 글자 순) · 넘김 2,640). 회차 뒤: run 로그 「대상 800 · 다음 회차로 넘김 N」 · `collector_runs` infra success ok≈800−k(오류 k곳은 다음 회차 맨 앞) · `error_message` `INFRA_DEFERRED=N` · DB `count(kakao_updated_at not null)` = 800−k **이고 그 id 집합 = 명단**(어긋날 수 있는 원천 = 명단 뒤 생긴 새 단지·좌표 채워진 단지(0순위 끼어듦)·지워진 단지 — 다름 → 원인 표 대조 → 👤 보고, 보고 전 고치지 않음). **기대값의 분모 = 좌표 있는 단지(`a.lat && a.lng`) − 최신**, infra 행 수가 아니다(좌표 없는 행은 영영 NULL — 10/31 은 둘 다 3,440 이라 차이 0). 5회차 뒤 좌표 있는 단지 전부 · DEFERRED 0. 그 뒤 **19곳 재조회**(`b2-probe-infra.mjs` 재실행) — 여전히 0 이면 「진짜 0」 확정, 바뀐 곳은 명단으로 보고. 같은 run 의 jobs API 단계 시간(transport·infra·schools)이 240분 안인지도 본다(10/29 = 2.5·1·61분 · infra 가 약 10분으로 는다).
6. **문서**: BACKLOG A-27 🟠 → ✅ · (v2) 공유 시계를 카카오 시각처럼 적은 세 곳 고침 — `.claude/BACKLOG.md:476-477`(「infra.updated_at 20:30 은 우리 infra-kakao 가 찍은 것」) · `supabase/CLAUDE.md:79` 트리거 절(「같은 함정일 수 있다(실측 필요)」 → 실측 결과 + 새 시계) · `docs/superpowers/specs/2026-10-09-shared-db-ownership-registry-design.md:148` C3 행 · ownership note · 메모리 · 2u 이슈 댓글(§3-4 문안) · 설계서 사본을 `docs/superpowers/specs/2026-10-31-infra-kakao-updated-at-design.md` 로 커밋.

## 5. 되돌리기
- 순서 = **코드 먼저 되돌리고(PR revert) → DB**(`_rollbacks/20261101000001` `DROP COLUMN IF EXISTS kakao_updated_at`). (v2) 반대로 DB 를 먼저 지우면 새 코드의 select 가 없는 칸으로 실패해 **고칠 때까지 매 회차 실패**(기록은 §3-2 catch 보강 뒤에만 남음) — 「회차 1번 실패로 끝남」이 아니다(v1 문장 정정). `continue-on-error` 라 job 은 계속. **(세션682) 되돌리는 PR 은 #846 통째 revert 가 아니라 판정·정렬 시계 줄(`infra-kakao.mjs` `tsOf`·`buildFreshIds` 입력)만 되돌린다 — 통째면 상한 800 도 사라져 11/20 옛 몰림이 되살아난다. 순서 = 코드 PR 합침 → 본 폴더 pull(정리 도구 `fix-placeholder`·`fix-sosa` 가 로컬 실행) → 정본 `ownership.json` 되돌림과 같은 날 월요일 09:00(감시 ⑲) 전에 DB DROP. 역순을 강제하는 장치는 없다 — 문서와 되돌리기 파일 머리 주석뿐.**
- 상한만 끄기: `--force` 단독은 막혀 있으므로(§3-2) 상수 `DEFAULT_MAX_APTS` 를 올리는 PR.

## 6. 열린 물음
- Q1(기술 · 결정): 읽기 select 에 `updated_at` 을 남긴다(로그 관찰용 · 판정·정렬엔 안 씀).
- Q2(검사관 동의): 19곳을 앞세우지 않는다(2.5주 안에 돈다 · 진짜 0 인 곳을 매번 앞세우는 역효과).
- Q3(해소): 2u frontend 는 DB 를 직접 안 읽지만 **API 로 `infra.updated_at` 을 받아 신선도 표시**(§1) → 통보 ②.
- Q4(사장님 · 나중): police·childcare·emergency·air-quality 도 각자 시계를 둘지 — 범위 밖, BACKLOG 한 줄.
- Q5(선택 · 첫 사이클 뒤): 800 묶음 5회차 반복을 평평하게 펼지(30일 기준에 단지별 흔들림) — 손님 영향 0, 알림만.
- **사장님께**: 2u 통보에 ②(2u 화면 신선도 표시가 지금도 틀림 · 새 칸으로 바꾸려면 ORM 1줄)를 넣는다 — 2u 쪽 결정은 2u 세션에서.

## 7. 검사 결과 반영표 (v1 → v2)
| 출처 | 등급 | 지적 | 반영 |
|---|---|---|---|
| 할루 9 | 틀림 | `fix-placeholder-addresses.test.mjs:830` 길이 고정 시험 누락 | §3-3 `*2+2` |
| 할루 10 | 🟢 | `build-ownership.mjs` 생성기 | §3-4 1회 도구 확인 · 글자만 같이 |
| 할루 11 | 🟡 | 「grep 0」 표현 | §3-5 「항목 0」 + 다른 줄 성격 |
| 할루 확인불가② | 🟢 | `monitor-ownership.test.mjs:24` 예시 | §3-4 고정 객체 확인 · 이름 바꿈 |
| 맹점 1 | 🟠 | 2u 화면이 `infra.updated_at` 신선도 표시 | §1·§3-4 통보 ②·§3-6 |
| 맹점 1b | 🟡 | 우리 문서 3곳 | §4-6 |
| 맹점 4 | 🟡 | `--force` 단독 31,000콜 · dry-run 비용 | §3-2 |
| 맹점 5 | 🟠 | 시험 재료 두 시계 반대 · select 소스 대조 | §4-1 |
| 맹점 6 | 🟡 | 빈 응답 덮어쓰기 | §3-2 모양 검사 |
| 맹점 7 | 🟠 | 코드 먼저면 기록 없이 매 회차 실패 · §5 문장 틀림 | §3-2 catch 기록 · §4-4 · §5 |
| 맹점 7b | 🟡 | 11/20 몰림 마감 없음 | §4-0 |
| 맹점 9 | 🟠 | ⑤-a 근거 틀림 | §3-5 ⑤-b 만 |
| 맹점 9b | 🟠 | 평시 흉내 틀림 | §3-2 흉내 · §3-5 기대값 |
| 맹점 10 | 🟡 | 「17칸」 글자 | §3-4 |
| 맹점 11 | 🟠 | 명단 없음 · 시험 이름 · 되돌리기 본문 · 통보 문안 | §4-5 · §3-3 · §3-1 · §3-4 |
| 맹점 12a | 🟡 | INSERT 트리거 근거 틀림 | §3-2 |
| 맹점 12b | 🟢 | air-quality 빠짐 | §1 |
| 맹점 12c | 🟡 | 패치 주석 | §3-2 |
| 메인 | 🟠 | 감시 ⑲ 월요일 대조 | §3-5 · §4-3 |
