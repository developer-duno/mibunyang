# A-19 설계·실행계획 — 재공고 준공월 되돌리기 + 법정동코드 빈칸 채우기

- 작성: 세션624 (2026-10-11 02:4x, Fable) · 고침: v2 (03:0x — 맹점 검사관 Opus 🔴3·🟠3·🟡3 반영, `.omc/artifacts/session624/review-blind-plan-a19.md`) · 상태: **설계 v2 — 승인 대기(사장님 질문 2건 §8)**
- 결정 원본: BACKLOG A-19(`.claude/BACKLOG.md` 320~324줄) · 조사 보고 `.omc/artifacts/session624/probe-a19.md`(Opus 읽기 전용, 02:12~02:28) · 보조 탐침 `probe-bjd.log` · 규칙 흉내 `review-blind-plan-a19.md`(운영 DB, 03:0x)
- 사장님 결정(2026-10-11 02:4x, AskUserQuestion 4건):
  1. 준공월 정답 = **같은 묶음의 첫 공고 입주예정월 + 실거래 건축년도 대조**(연도가 있으면 같을 때만 · 다른 건물이 섞인 묶음은 건너뜀)
  2. 범위 = **청약홈 행 전체, 1개월+ 차이**(117곳 명단에 얽매이지 않음 · 전이표를 12개월+ / 1~11개월로 나눠 보여 드림)
  3. 재발 방지 = **이번 트랙에 같이**(매일 03:00 굽기 단계 추가, 묶음 열쇠 단계와 같은 틀)
  4. bjd 빈칸 = **기존 `reverse-geocode.mjs --only-null-bjd` 로 28곳 전부, 전이표 승인 뒤**

## 0. 한 줄

재공고(무순위·계약취소·N차) 행이 청약홈 "입주예정월"을 준공월로 받아 이미 지어진 단지가 1~3년 새것처럼 보인다. 정답은 같은 묶음의 **첫 공고 입주예정월**에 있고(117곳 중 101), 실거래 **건축년도**(108)로 대조한다. 규칙을 운영 DB 에 흉내 내면 **12개월+ 170행 · 1~11개월 314행**이 후보이고 대조 뒤 약 386행이 바뀐다(검사관 실측 — 117 은 "형제 있는 것만" 센 수였다). 수집기는 처음 넣을 때만 쓰므로 한 번 고치면 되돌아오지 않지만, 새 재공고마다 같은 결함이 다시 생기므로 매일 굽기 앞에 되돌리는 단계를 둔다. 따로, 법정동코드가 빈 28행은 정기 주소 채우기가 "주소 빈 행"만 보아 영영 안 걸리므로 한 번 좌표로 다시 쓴다.

## 1. 조사에서 굳은 사실 (설계의 전제)

| 사실 | 근거 |
|---|---|
| `completion` 을 쓰는 정기 경로 = seed(처음 넣을 때 `MVN_PREARNGE_YM`) · naver-presale(YYYYMM 꼴이 아닐 때만) — **고친 값을 다시 덮는 길 없음** | `collect-applyhome-seed.mjs:198·224·479` · `naver-presale.mjs:1243` |
| 공고 입주예정월 = `presale_schedule_official.move_in_ym`(열쇠 `apartment_id,house_manage_no` · 표 2,014행 중 재공고 번호(91·93 계열) 0행 = **값은 늘 원 공고의 예정월** · 상세 수집기가 공고를 매칭해 붙이므로 원 공고가 재공고 행에, 때로 **엉뚱한 행**에 붙음) | `collect-applyhome-detail.mjs:198·587` · 검사관 ①(c) |
| 실거래 건축년도 = `trade_deals.build_year`(연 단위 · `apt_seq` 로 연결 표 active 줄과 맞댐) — **표가 약 106만 행**, 가장 오래된 달 202510 → 월 창으로는 못 좁힌다 | `_trade-deals.mjs` · 검사관 🔴3 · 입주연도와 1년 어긋남이 흔함(12개월+ 145행 중 33) |
| K-apt 사용승인일 저장 안 됨 · 네이버 `use_approve_ymd` 연결 표 없음 → 출처 후보 제외 | `_match-gates.mjs:337` · complex_links 표 없음 |
| 같은 열쇠에 **다른 건물**: 청약홈 행이 든 묶음 중 지번 2종 이상 = **32묶음**(금빛 그랑메종 2·3차 · 세종자이 더 시티 · 평택 맘시티 2차 · 남양뉴타운 2·3차 · 초곡 2차 …) — 거래 열쇠가 1개뿐이어도 다른 건물일 수 있다 | 검사관 ①(a)·🟠1 |
| **아직 안 지은 새 단지**가 같은 묶음의 1차 공고를 받는다: 미래→과거로 바뀌는 행 9(시티오씨엘 8단지 202907→202403 · 춘천 레이크시티 2차 202809→202608 · 제일풍경채 검단Ⅳ · 더샵 송도마리나베이 3회차 · 힐스테이트 레이크 송도 4차는 자기 공고 202507 이 있는데 남의 202310 이 이김) — 새 건물은 거래가 없어 대조를 그냥 통과 | 검사관 🔴1 |
| 틀린 준공월이 미치는 곳: 입주 칩(`classify.ts:31-40`·`cardChips.ts:155-170·204-218`)·"최근 완공" 정렬(`useDataPipeline.ts:41-45`)·표시(`fieldMeta.ts:98`·`DetailModal.tsx:541`)·검색용 미리 그린 페이지(`postbuild-prerender.mjs:87`)·감시(`monitor-collectors.mjs:3404 isPastCompletion`) · 거래 후보 탈락(`_trade-links.mjs:454-485`) · **K-apt 짝 24개월 게이트**(`_match-gates.mjs:337`) · 또래 범위(`_trade-scope.mjs:172`). **점수에는 안 쓰임**(`getAgeCoeff`·`isPresale` 호출 0, `engine.ts:238-241` 재수출만 — 검사관 ④ 확인) | 표4 · 🟡3 |
| 1~11개월 차 표본 12행은 대부분 2020~22년 공고끼리 1~4개월 차 — 결함이라기보다 예정월끼리의 차이 | 검사관 ①(d)·🟡1 |
| 117곳 중 라이브 목록 69(48 은 목록 밖) · 거래 연결 차단기는 지운·바뀐 줄만 셈(`_trade-links.mjs:873`) → 준공월을 고쳐도 10/22 회차가 막힐 위험 낮음 | 표5 · 🟢 |
| bjd null = 28행(전부 ah-* · 좌표 있음 · 목록에 있음 · **lot_main 전부 null** · 거래 연결은 전부 이름/묶음 경로) · 21행은 쌍둥이 좌표와 150m 안 · 쌍둥이 없음 6 · 721m·4.9km 각 1 | ② 표1~2 · `bjd-links.log` |
| `reverse-geocode.mjs --only-null-bjd` 는 region·gu·dong·address·road_address·bjd_code·lot_main·lot_sub(+district) **8칸을 좌표로 다시 씀**(`:240-250`) · 대상 필터는 `.is("bjd_code", null)` 하나(`:156`) · 정기 실행(04:00·일요일)은 "주소 빈 행"만(`:155`) | ② 표3 · 🟠3 |
| gu 첫 낱말만 열쇠에 쓰므로 "수원시 → 수원시 권선구"는 열쇠 불변 — 단 VIEW 의 시군구 조인(`20261007000000_view_add_trade_scope.sql:332-333`)이 다른 행을 잡아 **출산율·의사 수·공시가격 표시가 바뀐다**(점수 무관) | ② 표4 · 🟡2 |
| 시도·bjd 앞 두 자리 어긋남 8행(전부 2026 seed · 좌표 의심) → **A-16**(이 설계 밖) | probe-bjd.log MM |

## 2. 설계 ① — `scripts/collectors/assign-completion.mjs` (새 수집기, 틀 = `assign-complex-keys.mjs`)

### 2-1. 규칙(순수 함수 `planCompletionUpdates(rows, schedules, links, yearsByAptSeq, decisions, nowYm)` — DB 접근 0)

입력: `rows` = apartments 전체(`id,name,units,completion,complex_key,lot_main,presale_type`) · `schedules` = presale_schedule_official(`apartment_id,house_manage_no,move_in_ym,tot_supply`) · `links` = apartment_trade_links active `apt_seq`(`apartment_id,link_key,method`) · `yearsByAptSeq` = Map<apt_seq, build_year | null>(§2-2 방식으로 미리 모음) · `decisions` = `docs/audits/completion-decisions.json`(§2-2) · `nowYm` = 이번 달.

묶음 = `complex_key ?? id`(열쇠가 빈 행은 혼자 — 🟠2). 행마다(`ah-*` 만):
1. **사람 판정** = decisions 에 `keep` 이면 건너뜀(`human_keep`) — 🔴2.
2. **후보** = ⓐ **자기 행에 붙은 공고**의 가장 이른 유효 `move_in_ym`(있으면 이것 — 🔴1 송도 4차 꼴) ⓑ 없으면 같은 묶음 모든 행의 공고 중 가장 이른 것(`bundle_notice`). 둘 다 없으면 `no_source`.
3. **방향** = 후보가 지금 `completion`(YYYYMM 꼴일 때만)보다 **이르고 1개월+**. 아니면 `not_earlier`.
4. **다른 건물 보호**(ⓑ 묶음 후보일 때만): 묶음 안 active apt_seq 열쇠(method ≠ `bundle`)가 **2개 이상 서로 다르면** `mixed_buildings` · 묶음의 `lot_main` 이 **2종 이상**이면 `mixed_lots`(🟠1 — 열쇠 1개여도 다른 건물일 수 있다) → 둘 다 건너뜀. 단 건축년도가 후보 연도와 **같으면** 통과(`mixed_but_year_ok`).
5. **미래 행 보호**(🔴1): 지금 값이 `nowYm` 이상(아직 안 지음)이면 **건축년도가 있고 후보 연도와 같을 때만** 바꾼다. 없으면 `future_unverified`.
   - **시효(구현 보완, 적대 검사관 🟠1)**: 그 달이 지나면 위 보호가 풀려 "과거 행·연도 없음"으로 반영되므로, 건축년도 근거가 없는 행은 지금 값이 `nowYm` 기준 최근 `RECENT_UNVERIFIED_MONTHS`(24)개월 안이면 건너뛴다(`recent_unverified`) — 연도 없이 바꾸는 것은 25개월+ 전 행만.
   - **다중 공고(구현 보완, 맹점 검사관)**: 자기 공고 후보인데 그 행에 붙은 공고의 유효 예정월이 서로 다른 값 2개 이상이면(상세 수집기가 남의 단지 공고를 붙이는 결함 — 시티오씨엘 8단지 행에 6건) 건축년도가 같을 때만 바꾼다(`multi_notice_unverified` / 통과 flag `multi_notice_year_ok`).
6. **건축년도 대조**: 그 행(없으면 묶음)의 apt_seq 로 모은 `build_year` 가 있으면 후보 연도와 같을 때만(`year_mismatch` 건너뜀 · 여럿이면 최빈값, 동률 `year_ambiguous`). 없으면 과거 행에 한해 반영(`no_year` 표시 — 전이표에 따로 셈, 약 79행).
7. 결과 줄 = `{ id, prev, next, source: "own_notice"|"bundle_notice", houseManageNo, buildYear|null, gapMonths, flags: [...] }` · 건너뛴 이유별 개수를 요약에.

왜: 결정 1·2 그대로 + 검사관 🔴1(미래 행·자기 공고 우선)·🟠1(지번 2종)·🟠2(빈 열쇠)·🔴2(사람 판정) 반영. 세대수 vs 공고 공급 수 대조는 **쓰지 않는다** — 잔여 공고 행의 `units` 가 잔여 세대(비봉 13세대)라 진짜 사례를 다 걸러낸다. 대신 미래 행은 건축년도 없이는 안 바꾸는 5번이 같은 사례(시티오씨엘 8단지·레이크시티 2차 — 전부 거래 0)를 막는다.

### 2-2. 입력·인자·차단기·기록

- **건축년도 읽기(🔴3)**: `trade_deals` 전체 창을 읽지 않는다. 활성 apt_seq 열쇠(약 195개)마다 `.from("trade_deals").select("apt_seq,build_year").eq("apt_seq", k).not("build_year","is",null).limit(5)` 를 동시 5개로(`UPDATE_CONCURRENCY` 재사용 · 완성 batch 여부는 build_year 에 무관하므로 보지 않는다) → Map. `.in(열쇠 묶음)` 은 1,000행 상한이라 쓰지 않는다. 예상 1분 안.
- **사람 판정 파일(🔴2)** `docs/audits/completion-decisions.json`: `{ note, updatedAt, decisions: [{ id, action: "keep", names, why, approved }] }` — `keep` 하나만. 수집기가 읽어 그 id 는 제안하지 않는다(매일 `--apply` 가 뺀 행을 다시 쓰거나 차단기에 걸리는 일을 막는다). 꼴·검증(`parseCompletionDecisions`: id 중복 거부 · action 허용 목록) · PR 로만 고침(사장님 승인).
- 인자 허용 목록 = `--apply` · `--apply-from=<계획>` · `--out=<새 파일>` 만(`--dry-run` 금지 이유 = `recordCollectorRun` 건너뜀). 미리보기 기본. `--out` 은 wx.
- 차단기(매일 `--apply`): 바뀌는 행 > `CHANGE_BREAKER_MAX_ROWS`(**10**, seed 주간 신규 ah-* 1~4행·최대 50 — 검사관 🟢) 또는 > 10%(분모 = 후보가 있는 ah-* 행). 첫 회차는 `--apply-from` 으로만.
- `--apply-from` = id·prev·next 집합 대조(`comparePlanToApproved` 재사용) · `.eq("completion", prev)` 조건부 UPDATE · 돌아온 행으로 셈.
- `collector_runs` PHASE = `assign-completion` · 머리말 `CMP_COUNT_MISMATCH`·`CMP_BREAKER`·`CMP_PLAN_MISMATCH`·`CMP_WRITE`·`CMP_ERROR`. `createReporter` + 루프 `rpt.interrupted()` break.
- **main 은 주입형**(`main(deps)` — #732 패턴 · 주입 이름 `selectAll` 그대로). 조회는 `selectAll(…, "id")` + apartments `count` 대조.

### 2-3. 워크플로

`daily-deploy.yml` 열쇠 단계에 `id: keys` 를 달고, 그 **바로 뒤**에 `Assign completion` 단계(`if: steps.keys.outcome == 'success'` — 🟠2 · continue-on-error · timeout-minutes 5 · 같은 env). 점수 계산 앞. 감사 13개 통과(구현자 실행).

### 2-4. 감시

⑭ 에 `assign-completion` 마지막 성공 36시간 stale 한 줄(`checkComplexKeyRunStale` 를 collector 인자로 받게 일반화 — 시험 1건). 실패는 ⑬.

### 2-5. 시험·변이(필수)

- `assign-completion.test.mjs`: 순수 함수(자기 공고 우선 · 묶음 후보 · 1개월 경계 · mixed_buildings · mixed_lots · mixed_but_year_ok · future_unverified(미래 행 + 연도 없음 → 건너뜀, 연도 일치 → 반영) · year_mismatch/ambiguous/no_year · human_keep · ap-* 제외 · YYYYMM 아님 제외 · 빈 열쇠 = 혼자) + `parseCompletionDecisions`(중복·action) + 주입형 main(미리보기 0쓰기 · `--apply-from` 일치/불일치 · 차단기 · 조건부 UPDATE 0행 = 실패 · SIGTERM partial · 건축년도 per-key 조회 흉내). 입력 형식은 **운영 형식 그대로**.
- 변이 최소 8: ① mixed_lots 삭제 ② mixed_buildings 삭제 ③ future_unverified 삭제(미래 행이 연도 없이 바뀜 → red) ④ 자기 공고 우선 삭제(송도 4차 꼴 → red) ⑤ "이르고" 뒤집기 ⑥ 1개월→12개월 ⑦ human_keep 삭제 ⑧ 차단기 삭제. 치환 스크립트 파일 + `node --check` + `cmp` 원복.
- 표적 시험 + `typecheck:scripts` + 감사 13 + 구현자 마지막 전체 1회.

### 2-6. 전이표·반영 순서(운영 — `data-changing-run-approval` §1~3·§5)

1. 구현 가지 코드로 본 폴더 `--env-file` 미리보기 `--out=.omc/artifacts/session624/cmp-plan1.json` → 전이표 = 바뀜 수(**12개월+ / 1~11개월** · source 별 · 건축년도 일치/없음) · 건너뜀 이유별 수 · **눈으로 볼 명단** = 묶음 지번 2종 이상 전부(32묶음, `mixed_but_year_ok` 로 통과한 행 포함 · 이름의 "N차"가 회차인지 건물 차수인지 표시) · 미래→과거 행(연도 일치로 통과한 것) · gap 36개월+(9행) · 연도 없이 바뀌는 행(약 79) · 라이브 목록에 있는 행 수와 입주 칩이 바뀌는 행(unsold 유무로 "미입주"/"입주완료" 갈림).
2. 검사관 2인(적대 Opus + 맹점 Opus — 운영 DB 일회성 명단 §5)이 명단을 본 뒤 사장님 승인 → 뺄 행은 `completion-decisions.json` 에 `keep` 으로 적어(PR) 다시 미리보기.
3. 사본 `cmp-before.json`(id, completion, updated_at) + 역계획.
4. `--apply-from` 반영(합친 당일 03:00 전 — 첫 회차는 차단기 10행에 걸려 자동으론 안 써진다) → 재조회 → 새 미리보기 "바뀜 0".
5. **반영 뒤 세 시점**: ① 즉시 — VIEW 는 행 값 그대로 ② 다음 03:00 굽기 — 목록 JSON·미리 그린 페이지의 준공·입주 칩 바뀜 → **live-verify**(카드 2~3곳) ③ 다음 수집 회차 — seed 는 있는 id 건너뜀·naver 는 YYYYMM 이면 안 덮음 → 되돌아오지 않음. 10/22 trade-stats 에서 K-apt 게이트·또래 범위가 새 값으로 돈다.

## 3. 설계 ② — bjd 빈칸 28행(코드 변경 0 — 단 §8 질문 2 에 따라 `--ids-file` 추가 가능)

1. 사본 `.omc/artifacts/session624/bjd-before.json`(28행 15칸, 02:39) ✅ · 미리보기 `bjd-dry.log`(카카오 56콜) ✅ · 전이표 `bjd-transition.md` ✅(눈으로 볼 것 14행).
2. 검사관 2인(적대 Opus `review-adv-bjd.md` · 맹점 Opus `review-blind-bjd.md`) → 뺄 행 확정 → 사장님 승인.
3. **빼는 행 처리(🟠3)**: 대상 필터가 `bjd_code IS NULL` 하나라 "빼기"는 ⓐ 그 행에 쌍둥이 bjd 를 먼저 넣어 대상에서 떨어뜨리기(쌍둥이 있는 행만 · 그것도 데이터 변경이라 전이표에 포함) ⓑ 쌍둥이 없는 6행은 이번 반영에서 **못 뺀다** → 검사관이 좌표를 믿을 만하다고 판정하면 그대로 포함, 아니면 `--ids-file=<id 명단>` 인자를 도구에 더한다(코드 변경 · §8 질문 2).
4. 반영: `--only-null-bjd`(dry-run 없이) → 재조회 bjd null 0 · `assign-complex-keys` 미리보기 "바뀜 0" · 전이표의 gu 변경 행(수원·전주·창원·청주·안산 등)은 VIEW 시군구 지표가 바뀜(🟡2 — 더 맞는 쪽) · 연결 미리보기 `assign-trade-links.mjs --out=…/links-after-bjd.json` 기대 = 지우기 0 · 고치기 약 23(이름→지번 경로 승격) · 새 줄 5(복대자이 2·오산·파크릭스 2) — bjd 가 생기면 A2 가 아니라 **첫 번째 umd_cd 경로**를 탄다(adv-bjd 🟡4 정정) · 10/22 차단기(30줄) 여유 7줄.
5. 되돌리기 = `bjd-before.json` 으로 조건부 UPDATE 스크립트(반영 전에 `.omc/artifacts/session624/bjd-undo.mjs` 로 **먼저 만들어** dry-run 으로 28행 매칭을 확인해 둔다 — "사본만 있으면 된다"는 착각 방지).
6. 시각: 파생표를 지우지 않으므로 purge 창 무관 · 04:00 정기 reverse-geocode 와 10분 이상 떨어뜨린다.

## 4. 순서·병렬·검사관

| 단계 | 담당 | 산출 |
|---|---|---|
| ②-1~2 ✅ · ②-검사관 2인(돌고 있음) | 메인 · adv-bjd/blind-bjd | review-*-bjd.md |
| 설계 v2 승인(§8) | 사장님 | — |
| ①-구현 | opus-coder(워크트리 `s624/assign-completion`) — 지시서 = worker-brief 5절 · 전제 실측(표 칸 `select("*").limit(2)`) | 수집기 · 판정 파일 · 시험 · 워크플로 · 감시 · 문서 |
| ①-검사관 2인 | 적대 Opus(수집기·DB 쓰기·변이 재현) + 맹점 Opus(계획 대비) | review-adv/blind-cmp.md |
| ①-전이표 → 검사관이 명단도 봄 → 승인 → 합침 → 반영 | 메인 · 사장님 | cmp-plan1.json · cmp-before.json |
| 문서 | BACKLOG A-19 · scripts/CLAUDE.md 색인 · `.github/workflows/CLAUDE.md` · 메모리 | PR 에 포함 |

## 5. 되돌리기

① 역계획(`cmp-before.json` prev 로 조건부 UPDATE) · 워크플로 단계는 PR 되돌리기 · ② `bjd-undo.mjs`.

## 6. 범위 밖(BACKLOG 로)

- 출처 0 인 행(no_source · 세종 한신더휴 리저브Ⅱ) · 네이버 행 `completion` 드리프트 236건(세션530) · 시도·bjd 접두 어긋남 8행 → A-16 · 디센트 0027 정리 → BACKLOG 312 · 카드 합치기 다) 대표 준공월 · 상세 수집기가 원 공고를 엉뚱한 행에 붙이는 결함(검사관 ①(c) — 이 설계의 전제가 되는 표의 오염, 따로 조사).

## 7. 자가 점검·검사관 기록(③ 플랜 검토)

- v1 맹점 검사(Opus, 03:0x): 🔴3(미래 행 · 사람 판정 파일 · 거래 표 106만 행) 🟠3(지번 2종 · 빈 열쇠/실패 날 · bjd 빼는 행) 🟡3(1~11개월 이득 작음 · gu 변경이 VIEW 지표를 바꿈 · 준공월 읽는 곳 2군데 누락) → 전부 v2 에 반영. 검사관 "사장님께 여쭐 것" 2건 = §8.
- 남은 할루 위험: 표 칸 이름·`method` 철자·`trade_deals.apt_seq` 는 구현자가 실측.

## 8. 사장님 결정(2026-10-11 03:0x — 설계 v2 승인)

1. **아직 안 지은 단지(9행)** = 건축년도 없으면 건너뜀(§2-1 5번 그대로).
2. **첫 반영 범위 = 12개월+ 먼저(170행), 1~11개월은 2차.** 구현 = 수집기 상수 `MIN_GAP_MONTHS = 12`(기본) + 인자 `--min-gap=<개월>`(허용 목록에 추가 · 미리보기·`--apply-from` 둘 다 같은 값으로 — 승인 파일 대조는 같은 필터 위에서만 성립) · 매일 `--apply` 는 기본값 12 로 돈다(1~11개월 314행이 매일 차단기에 걸리지 않게). 2차를 승인하는 날 기본값을 1 로 내리는 PR 을 따로(BACKLOG).
3. **bjd 28행 전부 반영**(검사관 2인 "뺄 행 0" · 구 바뀜 5행의 동네 지표 변화 포함 · 김해 신문은 A-16 에 좌표 확인 한 줄). 절차 = 되돌림 스크립트 `bjd-undo.mjs` 먼저(dry-run 28행 매칭) → 반영 직전 대상 28행 재확인 → 반영 → 사후 사본 `bjd-after.json` → dry 로그와 행마다 대조 → 확인 명령 3개.
4. **bjd 만 틀린 8행**(좌표 정상 · 접두 남의 시군구 — 안동→여주 등) = **이번 트랙 후속 묶음**: 28행 뒤 같은 도구로(bjd 를 조건부로 비움 → `--only-null-bjd --dry-run` 16콜 → 전이표 → 검사관 1인 → 승인 → 반영).

## 9. 후속(BACKLOG 등재)

- 청약홈 seed 가 bjd 를 안 넣어 매주 월 11:30 새 행이 bjd null 로 생김 → 정기 단계(04:00 collect-naver-listings 의 reverse-geocode)에 `--only-null-bjd` 1회 추가(검사관 adv-bjd 🟡3 · blind-bjd 🟡).
- 새 bjd 가 네이버 분양 2순위 매칭 열쇠(`naver-presale.mjs:799`, 유사도 0.5)가 된다 → 다음 월·목 러너 뒤 28행에 새 `naver_presale_no` 가 붙었는지 확인(blind-bjd 🟡).
- 상세 수집기가 원 공고를 엉뚱한 행에 붙이는 결함(검사관 ①(c)) · 1~11개월 2차 · `MIN_GAP_MONTHS` 1 로 내리기.
