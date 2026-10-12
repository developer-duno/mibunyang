# 공고 → 단지 사람 판정 장치 — 설계·실행계획 (BACKLOG A-19 세션629 결정 "5묶음")

- 작성: 세션630 (2026-10-12 02:0x~, Fable) · 고침: v2 (03:0x — 맹점 검사관 Opus 🔴1·🟠8·🟡8·🟢4 반영, `.omc/artifacts/session630/review-blind-design.md`) · **v3 (03:2x — 같은 검사관 차등 재검토 🔴0·🟠3·🟡3 반영: 회차 낱말 제거 + 어긋남 행 지우기 · 같은 묶음 행 옮기기 취소(상세 API 가 묶음 단위로 읽음) · 게이트 모름 40건 보호 · 차단기 때 동작은 §10 결정)** · 상태: **설계 v3 승인(2026-10-12 03:0x 사장님 — §10 ①~⑤ 전부, ⑤ = "기존 쌍만 다시 받고 나머지 멈춤") → PR-A 구현**
- 결정 원본: `.claude/BACKLOG.md` A-19 「세션629 사장님 결정 10/11 22:3x」(`grep -n "세션629 사장님 결정" .claude/BACKLOG.md`) · 메모 `session_2026-10-11_session629_backlog_stale_marks.md` 📌 · 세션625 조사 5(디센트)
- 조사 재료(전부 읽기 전용 · DB 쓰기 0 · 청약홈 Detail API 3콜 · 네이버 분양 API 16콜, 2026-10-12 01:5x~02:5x): `.omc/artifacts/session630/`
  - `five-groups-db.log`(5묶음 11행의 지금 DB) · `multi-attach.log/json`(공고번호당 행 수 분포 · 다른 묶음 50건 명단) · `details-cache.json`(청약홈 APT 공고 2,900건 원문) · `sim-ties.json`(지금 규칙 흉내 — 동점) · `plan-sim.json`(**v1 규칙 흉내** — 넣기·지우기·못 가름 명단, v2 규칙과 다름 → 구현 미리보기로 다시 잰다) · `external-check.log`(사람 판정 후보 14건 외부 대조) · `notice-decisions-draft.json`(판정 파일 초안) · `probe-*.mjs`(탐침 원본)
- 사장님 결정(2026-10-12 02:3x, AskUserQuestion 3건):
  1. 디센트 = **세대수 + 0027 이름 둘 다** 바로잡는다(0003→326 · 0004·0027→450 · 0005→388 · 0027 이름 `H2BL(2단지)` → `H3BL(2단지)`)
  2. 쌓인 틀린 행 = **전부 한 번에**(미리보기 → 승인 → 차단기 순서)
  3. 자동으로 못 가른 공고 = **Claude 가 외부 사이트(네이버 분양·청약홈 원문)로 대조해 판정 파일에 근거와 함께 적고, 사장님은 PR 승인만**
  4. (사장님 제안 02:2x) 사람 판정 전에 **다른 회사가 이미 짝지어 둔 것(네이버)을 먼저 쓴다** → §2-1 의 "네이버 지문"

## 0. 한 줄

청약홈 분양 공고(2,900건)를 우리 단지에 붙이는 규칙이 "괄호를 지운 이름이 가장 비슷한 행"뿐이라, 쌍둥이 단지(1BL/2BL·1단지/2단지)에서 **동점이면 목록에서 먼저 나오는 행이 가져가고**(`collect-applyhome-detail.mjs:143`), 승자가 바뀌어도 옛 행을 안 지워(`:587` upsert) 틀린 행이 쌓였다(다른 묶음에 같이 붙은 공고 50건 · 행 약 110). 고치는 순서 = **사람 판정 파일 → 블록·차수가 어긋나는 후보 제외 → 같은 묶음이면 카드가 보여 주는 행 → 블록 글자 + 네이버 지문으로 가르기 → 못 가르면 안 붙임 → 쌓인 틀린 행은 "다른 묶음이 이겼다"는 양성 증거가 있을 때만 승인 뒤 지움(차단기) → 재발 감시**. 디센트 4행의 세대수(지금)·이름(10/22 뒤)은 따로 바로잡는다.

## 1. 조사에서 굳은 사실 (설계의 전제)

| 사실 | 근거 |
|---|---|
| 짝짓기 = `normName`(괄호·공백 제거) 유사도 ≥0.85 중 **최대 1곳**(`sim > bestSim` 라 동점이면 먼저 나온 행 = id 작은 행) + 시도 게이트(`addrToRegion` ↔ `apartments.region` 접두) — 게이트에 걸리면 **다음 후보로 안 넘어가고 공고를 버린다** | `collect-applyhome-detail.mjs:90-151,460-466` |
| **`addrToRegion` 은 첫 낱말이 시도가 아니면 접미사만 뗀 글자를 돌려준다**("광주시"→"광주"(광역시로 오판) · "김포"→"김포" · "경산북도"→"경산북") — 공고 2,900건 중 첫 낱말이 시도 정식명·약칭 아님 **40건**(광주연구개발특구 5 · 김포 3 · 수원시 2 · 화성 2 · 광주시 1 · 서울시·부산시·인천시 각 1 …). 이 함수는 `backfill-presale-area-notices.mjs:123,141`(+시험 `:211`)이 그 동작에 기대므로 **고치지 않고** 게이트 쪽에서만 바꾼다(§2-1 ⑤) | `:120-121` · `_shared.mjs REGION_MAP :231` · 첫 낱말 집계(03:0x, `details-cache.json`) · 검사관 🔴 |
| 적재 = `presale_schedule_official`(열쇠 `apartment_id,house_manage_no`, upsert 만 · 삭제 0) · `applyhome_unit_supply`(열쇠 `+model_no`, `source='apt'`) · `prices applyhome_rep`(평형에서 뽑은 대표 분양가, 빈칸만 채움) — 셋 다 같은 `hmnToApt` 지도를 탄다 | `:518-607` · 마이그 `20260807000000_applyhome_stage1_remndr.sql:20` |
| 공고번호를 **그대로** 쓰는 길은 무관: 경쟁률 `applyhome_events`(`ah-${no}`) · 무순위 평형(`source='remndr'`) · 평형 UNIQUE 는 단지 id 가 들어 있어 `apt`/`remndr` 충돌 없음(검사관 🟢) | `collect-applyhome.mjs:196,309` · `collect-applyhome-remndr.mjs:211` |
| 표 2,014행 / 공고 1,411개 · 한 공고가 2행+ 에 붙은 것 **397개**(같은 묶음(`complex_key`) 안 347 · **묶음이 다른 행 섞임 50**) · 공고 0건인 ah 행 478 | `multi-attach.log`(02:0x) |
| `fetched_at` 은 **처음 넣은 시각**(행 빌더에 칸 없음 · DEFAULT NOW) — "이번 회차에 다시 확인됨" 신호로 못 쓴다(검사관 🟢 확인) | `:183-210` · 마이그 `20260531100000:27` |
| 지금 규칙 흉내(공고 2,900 ↔ 단지 3,281): 짝 없음 1,456 · 1곳 1,033 · **동점 411**(같은 묶음 387 · **다른 묶음 24**) · 게이트가 버림 23(동점 7 중 4 는 위 오판) | `sim-ties.json stats` |
| 다른 묶음 동점 24 중 **블록·차수 글자**(`_kakao-poi.mjs phaseConsistent·blockConflict`, 씨앗 수집기가 이미 씀 `collect-applyhome-seed.mjs:306`)로 가름 12 · **네이버 지문**으로 가름 8(글자로 못 가른 것 2 포함, ap 번호 주인 한정 전 수치) · 둘 다 못 가름 10 | `probe3.log` · `probe-fingerprint.mjs` 출력(02:2x) |
| 네이버 분양 API(`/api/complex/detail`)에는 청약홈 공고번호 칸이 **없다**(칸 목록 실측 — `bunyang_url` 빈 값 · `new_notif_info_url` 은 PDF) — 대신 `recruit_date`·`total_house_cnt`·`detail_addr` 가 공고 원문과 같다 → 우리가 저장한 `presale_recruit_date`(1,778행 — **전체 날짜 1,700 · `YYYY-MM` 66 · 그 밖 12**)·`presale_general_supply`(1,778행)가 그 지문. **ap 번호 주인 행**(`id === ap-${naver_presale_no}`) 1,697 · 네이버 링크 달린 ah 행 177(우리 이름 매칭 결과라 지문 자격 없음 — 검사관 🟡, 세션578 오염 이력) | `probe-naver-api*.mjs` · `probe-date-format.mjs`(03:0x) |
| 화면 카드는 VIEW 가 **끝 괄호를 뗀 이름 + region/gu/dong** 으로 묶어 `(오)` 아닌 행 중 **id 큰 행**을 보여 준다(`complex_key` 묶음과 다른 묶기) · 상세 일정 API 는 그 카드 id 로만 읽는다 → 같은 묶음 동점을 id 작은 행에 붙이면 **카드에 일정이 안 뜰 수 있다**(검사관 🟠) | `20261007000000_view_add_trade_scope.sql:49-57` · `api/supabase/presale-detail.ts:43-47` |
| 알림 발송기의 중복 열쇠는 `단지 id + 공고번호`(`notify-subscribers.mjs:111,177`) → 같은 공고가 같은 묶음 N행에 붙으면 접수 알림이 N통(**지금도 그런 구조** — 이 설계 범위 밖, §9) | 검사관 🟠 |
| 디센트: 우리 행 4개(0003·0004·0027·0005) ↔ 실제 단지 3(1·2·3단지). 원공고 727=H2BL(1단지) 326세대 147-19 · 728=H3BL(2단지) 450세대 147-15 · 729=H4BL(3단지) 388세대 147-21. 0027 이름 `H2BL(2단지)` 는 무순위 공고의 오기(주소 147-15 = 2단지) · 세대수는 전부 `molit` 출처(391/388 — 어느 블록 값도 아님) · 묶음 열쇠는 0027·0004 가 이미 같은 `#2단지+H3BL` · `PHASE_RE` 가 `H2BL(1단지)` 를 {2,1}, `H2BL(2단지)` 를 {2} 로 읽어 두 행이 "ok" 동점(검사관 🟢 확인) · **`_trade-links.mjs` 는 `units` 를 안 쓴다**(세대수 정정은 10/22 연결과 무관) · 이름 정정은 0027 차수 집합을 {2}→{3,2} 로 바꿔 3단지 거래 후보를 받게 함(검사관 🟠) | `five-groups-db.log` · `details-cache.json` · 세션625 조사 5 · `_kakao-poi.mjs:137` |
| 소비처: `presale-detail.ts:43-47` · `api/upcoming.ts:172`(곧분양 제외) · VIEW `lastUnsoldEventAt`=`MAX(recruit_date)`(03:00 굽기) · `notify-subscribers.mjs:286` · `assign-completion.mjs:283-290,372`(`multi_notice_unverified` — **정리가 공고 수를 줄이면 다음 03:00 되돌리기 판정이 바뀐다**, 그 회차 차단기 10행 · 검사관 🟠) | 각 줄 |
| 지우기가 화면에 닿는 시각: `presale-detail`·`upcoming` 은 운영 DB 직접 → 즉시 · VIEW 칸은 다음 03:00 굽기(null 이면 "—" → purge 창 무관) | `purge-to-recollect-timing` §4 대조 |
| v1 규칙 흉내: 지우기 80행(다른 묶음 54·승자 없음 26 — 승자 없음에는 **게이트 오판(광주 탄벌 2단지)·이름 바뀜(청계리버뷰자이→성동자이리버뷰)** 처럼 지울 근거가 없는 것이 섞임 → v2 에서 분리) · 새 짝 14(새 공고가 아니라 **새 단지 행**이 생겨 옮겨 가는 것 포함) · 못 가름 10 | `plan-sim.json`(02:3x) · 검사관 🔴·🟡 |

## 2. 설계 ① — 짝짓기 규칙 v2 (`collect-applyhome-detail.mjs`, 순수 함수 · DB 접근 0)

### 2-1. `matchDetailToApt(row, apts, ctx)` — 쓰는 순서

입력: `row`(Detail 원문) · `apts`(`id,name,region,complex_key,naver_presale_no,presale_recruit_date,presale_general_supply,units,unit_source` — `loadMatchCandidates` 칸 추가 · **빈 `complex_key` 는 미리 `withComputedComplexKeys(apts, exceptions)`(`_trade-links.mjs:632`, 예외 파일 `docs/audits/same-complex-exceptions.json`)로 채워 넘긴다** — 월 08:00 네이버·11:30 씨앗이 넣은 새 행은 열쇠가 다음 날 03:00 에야 생기므로 12:30 회차에서 자기 id 묶음이 되어 같은 단지를 "다른 단지"로 본다(검사관 🟠)) · `ctx = { decisions }`(§3). 출력 `{ aptIds: string[], how, sim } | null`.

1. **판정 파일**(§3) — 그 공고번호에 `active` 가 있으면 그 행들(여럿 가능) · `how="manual"` · **시도 게이트 면제**. `skip` 이면 `null`(`how="skip"`).
2. 후보 = `normName` 유사도 ≥0.85(지금과 같음) → 동점(최대 유사도) 집합 = `tops` 를 **먼저** 정한다 → **그 뒤** `tops` 에서 뺀다(먼저 빼면 유사도 낮은 엉뚱한 후보가 이긴다 — 검사관 🟡·재검토 ①): **ⓐ `(오)` 행**(APT 공고는 오피스텔 행에 안 붙인다 — 가야역 꼴 · VIEW 와 같은 판정 `name LIKE '%(오)%'`) **ⓑ 블록·차수가 어긋나는 행**(`phaseConsistent === "conflict" || blockConflict` — 후보가 1곳뿐이어도 적용 · 검사관 🟠 "1BL 행만 있을 때 3BL 공고가 붙는 결함") — 단 **양쪽 이름을 `stripRoundWords`(`naver-presale.mjs:747,765` 꼴)로 회차 낱말("임의공급3차"·"무순위 2차")을 떼고 비교**한다(재검토 ①: 송도 하늘채 아이비원 `2022000488` 의 `(임의공급3차)`·`(4차)` 행이 거짓 어긋남) **ⓒ `rejected` 쌍**. 다 빠져 비면 `null`(`how="conflict_all"|"rejected_all"`) · ⓑ 로 빠진 행은 **지우기의 양성 증거**(§4-1 `delete:conflict`)로 넘긴다 · 미리보기에 "ⓑ 로 빠진 행 수"를 따로 센다.
3. `tops` 의 묶음(`complex_key`)이 **1개** → **지금처럼 첫 행(id 작은 행)** · `how="single"|"same_bundle"`. 같은 묶음 안 다른 행에 이미 붙은 옛 행은 **지우지 않는다**(준공월 되돌리기가 행마다 읽는 전제 유지). 카드가 보여 주는 행에 일정이 없을 수 있는 문제(검사관 🟠)는 **행을 옮기지 않고 상세 API 가 묶음 단위로 읽게**(§2-3) 푼다 — v2 의 "id 큰 행" 안은 같은 묶음 동점 387건 중 **360건의 승자가 바뀌어** 넣기·평형이 수백 행 늘고, 계획된 "한 단지 = 한 장" 대표 행(`_same-complex.mjs:263-270 pickRepresentativeId` — 청약홈 행 먼저·id 작은 순)과 순서가 반대라 그 단계에서 다시 어긋난다(재검토 ②).
4. 묶음이 **2개+** = 다른 단지끼리 동점:
   - `B` = `tops` 중 `phaseConsistent === "ok"` 이고 `blockConflict` 가 아닌 행(회차 낱말 뗀 이름 기준 — 2ⓑ 에서 "conflict" 는 이미 빠졌으므로 `one-sided` 행은 B 에 안 든다 · 구현 `matchDetailToAptDetailed`)
   - `F` = `tops` 중 **ap 번호 주인 행**(`id === ap-${naver_presale_no}`)이고 네이버 지문 일치(`presale_recruit_date`(전체 날짜 꼴만) `=== RCRIT_PBLANC_DE` ∧ `presale_general_supply === TOT_SUPLY_HSHLDCO`) — **양성 증거로만**(불일치로 후보를 버리지 않는다 — 네이버 날짜가 다른 회차일 수 있다: e편한세상 대장 2021 vs 2025)
   - `F` 의 묶음이 1개이고 (`B` 가 비었거나 그 묶음이 `B` 안에 있으면) → 그 묶음의 카드 행 · `how="tie_fingerprint"|"tie_both"`
   - `F` 가 비고 `B` 의 묶음이 1개 → `how="tie_block"`
   - 그 밖(둘 다 없음 · `B` 2묶음+ · `F` 2묶음+ · `F`↔`B` 다른 묶음) → **`null`** · `how="tie_unresolved"` + 후보 명단을 미리보기에.
5. 자동 결과에만 시도 게이트 — **`gateRegionOf(addr)`**(새 작은 함수): 첫 낱말이 `REGION_MAP` 의 정식명·약칭이면 그 약칭, 통합 시도면 `resolveRegionName`, **그 밖(40건 — "광주시"·"김포"·"서울시"·"경산북도"…)은 null = 게이트 건너뜀**(검사관 🔴 — `addrToRegion` 자체는 그대로 둔다). 걸리면 `how="gate"` 로 미리보기에. **게이트 모름(null) 공고는 보호 조건을 하나 더**(재검토 ③ — "장항지구 A-5블록 신혼희망타운"·"부산모라 행복주택"처럼 흔한 이름이 다른 지역 행에 붙을 수 있다): 유사도 ≥0.95 이거나 후보 행의 `gu` 첫 낱말이 주소 앞 두 낱말 안에 있을 때만 붙이고, 아니면 `how="gate_unknown"` 으로 미리보기 명단에(안 붙임·유지).

`hmnToApt` 는 `Map<hmn, string[]>` 로(manual 여럿). 평형·대표 분양가는 그 행들마다(같은 공고가 두 행이면 평형 행도 두 벌 — 지금 `remndr`·`apt` 와 같은 꼴).

### 2-3. 상세 일정 API 를 묶음 단위로(`api/supabase/presale-detail.ts` — 재검토 ② 처방 (가))

카드 id 하나로 `.eq("apartment_id", id)` 하던 조회를 **그 행의 `complex_key` 가 같은 행 전부**(`apartments` 에서 열쇠 1회 조회 → `.in("apartment_id", ids)`)로 바꾸고, 일정은 지금처럼 `recruit_date` 최신 1행 · 평형은 공고번호별로 합친다(같은 공고가 두 행에 있으면 한 벌만). 열쇠가 비면 지금처럼 자기 id 만. 효과 = 어느 행에 붙었든 카드에 일정이 뜬다 · 손대는 범위가 가장 작다(행 이동 0). 시험 = `api/upcoming.test.ts` 꼴로 가짜 supabase 2건(열쇠 있음/없음).

왜 이 순서인가: 판정 파일이 맨 앞인 건 기존 두 파일과 같은 약속 · 블록·차수 제외를 모든 경우에 두면 괄호 삭제 결함이 1곳 매칭에서도 막힌다 · 같은 묶음 동점(381)은 카드 행으로만 바꿔 바뀜을 좁힌다 · 글자와 지문은 서로 다른 거짓말을 잡는다(글자 = 청약홈 오기(디센트 0027)에 속고, 지문 = 네이버 짝이 없는 ah 행(장흥역·래미안)에 침묵) · 둘이 어긋나면 사람.

### 2-2. 디센트가 이 규칙에서 어떻게 되나

- **이름 정정 전(이번 주 PR-A)**: 727(H2BL 1단지) ↔ 0027(`H2BL(2단지)`)·0003(`H2BL(1단지)`) 는 둘 다 "ok"(§1 PHASE_RE) → 다른 묶음 동점 · 지문 없음(ah) → `tie_unresolved` → **판정 파일 `727 → 0003 active`** 로 해결. 728(H3BL 2단지) 은 0027(`H2BL…`) 이 유사도 1 이 아니고 블록 H2↔H3 로 2ⓑ 에서 빠져 **0004 하나뿐인 1곳 매칭**(재검토 🟡 정정 — 0027 엔 판정 줄 불필요). 729 → 0005(1곳).
- **이름 정정 뒤(10/22 뒤 PR-B2)**: 0027 이 `H3BL(2단지)` 가 되면 727 은 유사도에서 이미 0003 하나로 좁혀진다(`blockConflict` 가 가르는 게 아니라 이름이 달라져서 — 검사관 🟡 정정). 727 판정 줄은 그대로 둬도 무해(active = 그 행). 화면은 0027 이 0004 카드에 접힌다(VIEW 묶기 — §5).

## 3. 설계 ② — 사람 판정 파일 `docs/audits/applyhome-notice-decisions.json`

```json
{ "note": "…", "updatedAt": "2026-10-xx", "decisions": [
  { "house_manage_no": "2021000727", "apartment_id": "ah-2026910003", "status": "active",
    "names": "용인 경남아너스빌 디센트 H2BL(1단지) 326세대 남곡리 147-19 ↔ 우리 0003 H2BL(1단지)",
    "why": "0027 과 괄호 지운 이름 동점 — 청약홈 원문 주소 147-19 = 1단지", "verified_by": "청약홈 Detail 원문(HSSPLY_ADRES) + 세션625 조사 5",
    "approved": "YYYY-MM-DD 사장님(PR #N)" } ] }
```

- `status` 3종: `active`(공고 → 그 행, 게이트 면제, 여러 줄 가능) · `rejected`(그 공고를 그 행엔 절대 안 붙임 — `tops` 에서 뺌 · **같은 묶음 추가 행에 이미 붙어 있으면 정리가 그 행도 지운다**(검사관 🟡)) · `skip`(`apartment_id: null` — 우리 목록에 그 단지가 없음 · 미리보기 "사람 판정 필요"에서 뺌 · **지금 붙어 있는 행은 정리 대상**).
- `parseNoticeDecisions(raw)` 거부 **7종**: 공고번호 10자리 숫자 아님 · `status` 허용 목록 밖 · `skip` 아닌데 `apartment_id` 빈칸 · `skip` 인데 `apartment_id` 있음 · 같은 (공고번호, 행) 두 번 · `names`·`why`·`verified_by`·`approved` 빈칸·공백·글자 아님 · `decisions` 가 배열 아님 → **throw**(#739 와 같은 엄격함). 수집기 시작 때 읽고 깨지면 API 호출 전 exit 1(`NTC_ERROR`).
- 근거 칸(`verified_by`)은 외부 출처(결정 3). **초안 = `.omc/artifacts/session630/notice-decisions-draft.json`**(외부 대조 `external-check.log` 02:5x · 네이버 12콜). v2 규칙(§2-1 ⓐⓑ⑤)으로 자동 해결되는 것은 줄을 두지 않고 **구현 미리보기에서 확인**(안 풀리면 그때 추가):

| 공고 | 판정 | 근거 |
|---|---|---|
| 2021000727 디센트 H2BL(1단지) | **active → `ah-2026910003`** | 원문 주소 147-19 · 이름 정정 전엔 0027 과 동점 |
| 2021000772 포항펜타시티(A1BL) 퍼스티지 I | **active → `ap-6025315`** | 공고 874 = 행 units 874(naver_presale) · 네이버 날짜 null 이라 지문 미완 · Ⅰ/Ⅱ 로마 숫자는 `PHASE_RE` 가 안 읽어 동점 |
| 2023000532 청계리버뷰자이 | **active → `ap-6027298` 성동자이리버뷰** | 이름 바뀜(유사도 0.55 · 전 행 중 ≥0.85 없음 → 원인 (가) 확정) · 네이버 detail 공고일 2023-12-01·공급 797·용답동 108-1 = 원문 셋 다 일치 |
| 2024000594 래미안 센트리폴(3BL) | **skip** | 우리 행 1BL·2BL 뿐 |
| 2023000359 검단신도시 롯데캐슬 넥스티엘(2023, 372) | **skip** | 우리 행 Ⅱ(450)·Ⅲ(192) 2024 공고뿐 |
| 2021000617·368·106 시티오씨엘 4·1·3단지 | **skip ×3** | 우리 행 6·7·8단지뿐(`ah-2025910275` "8단지" units 428 = 4단지 값 → BACKLOG) |
| 2021000349 익산 푸르지오 더 퍼스트 | **skip** | 교산(하남)·논산은 다른 단지(유사도 우연) |
| 2020001404 판교밸리자이 3단지 | **skip** | 우리 행 1·2단지뿐 |
| 2025000290 가야역 롯데캐슬 스카이엘 | (자동 기대) → `ah-2025910162` | `(오)` 제외(2ⓐ) 뒤 1곳 · 공고 725 = units 725 |
| 2026000243 호반써밋 첨단3지구(A8BL) | (자동 기대) → `ah-2026910190` | 첫 낱말 "광주연구개발특구" → 게이트 null(⑤) · 글자 A8 ↔ A7 로 가름 |
| 2022000772 광주 탄벌 서희스타힐스 2단지 | (자동 기대) → `ap-6025775` | "광주시" → 게이트 null(⑤) · 2단지 ↔ 1단지 차수로 가름 |
| 2021000728 디센트 H3BL(2단지) | (자동 기대) → `ah-2026910004` | 1곳 매칭(0004) — 0027 은 블록 H2↔H3 로 2ⓑ 에서 빠짐(구현 미리보기 `single` 확인) |

## 4. 설계 ③ — 쌓인 틀린 행 정리(같은 수집기 안, 매 회차)

### 4-1. 순수 함수 `planNoticeReconcile(dbRows, desired, keyOf, apiHmns, decisions)`

- 입력: 지금 `presale_schedule_official`(`id,apartment_id,house_manage_no`) · 이번 회차 `desired`(`Map<hmn, {aptIds, bundles, how}>` — `null` 결과도 `how` 와 함께 담는다) · `keyOf(id)`(채운 열쇠) · 이번 회차 API 공고번호 집합 · 판정 파일.
- 행마다 — **지우기는 양성 증거가 있을 때만**(검사관 🔴):
  - 공고가 이번 API 에 없음 → 손 안 댐(`not_in_api`)
  - desired 에 그 행 있음 → 유지 · 그 행의 묶음이 desired 묶음 중 하나 → 유지(`same_bundle_extra`)
  - **다른 묶음이 이김**(`how` ∈ single·same_bundle·tie_*·manual 이고 묶음이 다름) → `delete:other_bundle`
  - 판정 `skip`·그 행 `rejected` → `delete:decision`
  - **그 행이 2ⓑ(블록·차수 어긋남)로 후보에서 빠진 행** → `delete:conflict`(어긋남 자체가 양성 증거 — 힐스테이트 초월역 1BL 공고 `2021000881` 가 2BL 행 2곳에, 파주 운정 A2BL 공고 `2022000751` 이 A39BL 행 3곳에 붙어 있는 꼴 · 재검토 ①)
  - 동점을 못 가름(`tie_unresolved`) → `delete:unresolved`(어느 행도 근거 없음 — 래미안 3BL 꼴. 판정 파일에 `skip` 을 적으면 `decision` 으로 옮겨 감)
  - **게이트 탈락·짝 없음(`gate`·`noMatch`·`rejected_all`) → 유지 + 미리보기 `kept_no_evidence` 명단**(지울 근거가 없다 — 이름이 바뀐 단지·주소 오판이 여기 섞인다)
- 지우기 따라감: `applyhome_unit_supply` 중 `source='apt'` 이고 (행, 공고) 가 지워지는 쌍 · `prices` 중 `house_type='applyhome_rep'` 이고 영향 단지 — 같은 회차 뒤 단계가 바른 평형으로 다시 채운다(순서 §4-3). `remndr` 평형·`applyhome_events` 는 건드리지 않는다.
- **지우는 순서 = 평형 → 분양가 → 일정**(PR-A 검사관 보완 F2 — 일정을 먼저 지우고 평형에서 실패하면 다음 회차 계획에 그 쌍이 안 잡혀 `source=apt` 평형 고아가 영구히 남는다). 단계 실패는 `collector_runs` failure `NTC_WRITE <units|prices|schedule>` 를 남기고 끝낸다(upsert 로 안 넘어감 · `deleteNoticeRows` 시험은 기록용 가짜 sb 로 거르기 조건까지 단언).
- **조용히 넘기던 것은 실행 기록 표식**(F4 · status 그대로 · `REGION_UNRESOLVED` 꼴): `error_message` 에 `NTC_SKIP <이유>` · `NTC_UNRESOLVED n` · `NTC_NO_EVIDENCE n` · `NTC_MANUAL_MISSING <공고>행>`(판정 파일 행이 apartments 에 없음 — 그 행은 넣지 않음)를 ` · ` 로 잇는다.
- **정리를 건너뛰는 조건**(검사관 🟠 "일부만 반영"): 매칭 반복이 중단 신호(`rpt.interrupted()`)로 끊김 · 후보 행 수 ≠ `apartments` `count` · 표 행 수 ≠ `count` → 정리 없이 upsert 만(로그 `[정리] 건너뜀: <이유>`).
- 출력: `{ deletes: [{id, apartment_id, house_manage_no, why, names}], unitDeletes, priceDeletes(apt ids), adds: [{apartment_id, house_manage_no, how}], keep: {same_bundle_extra, not_in_api, kept_no_evidence:[…]}, unresolved: [{hmn, name, candidates}] }`.

### 4-2. 차단기·인자·기록(기존 패턴 — `assign-completion` · `_trade-links evaluateLinkBreaker`)

- `NOTICE_BREAKER_MAX_ROWS = 30` · `NOTICE_BREAKER_RATIO = 0.1`(분모 = 표 행 수) — **지우기만** 센다. 매주 정기 실행에서 넘으면(또는 `--apply-from` 불일치면) **"기존 쌍만" 모드**(§10 결정 ⑤ · 재검토 ④): 지금 DB 에 이미 있는 (행, 공고) 쌍만 다시 upsert 해 날짜·칸을 새로 받고(알림 소스 유지), **새 넣기·지우기·분양가 채움은 전부 보류** + `collector_runs` `status=failure`·`error_message` 머리말 `NTC_BREAKER`/`NTC_PLAN_MISMATCH`(감시 ⑬·워크플로 빨강 — 사람이 `--apply-from` 으로 푼다). v2 의 "upsert 는 하고 분양가만 건너뜀"은 새 규칙의 넣기가 승인 없이 들어가 옛 틀린 행과 함께 남아 감시 ⑳ 수가 오히려 늘고, `data-changing-run-approval` §2("차단기가 걸리면 아무것도 쓰지 않음")와도 어긋나 버렸다. 첫 정리는 80행 안팎 > 30 이라 **반드시 `--apply-from`**.
- `--dry-run --out=<새 파일>`(wx) = 계획 저장(`deletes` 이름·`why` 포함 · `adds` · `priceDeletes` · `kept_no_evidence` · `gate_unknown` · `block_rejected` 수 · `unresolved` 후보 명단 · 통계 · **F8 `gate`(공고·주소·걸린 행)·`conflict_all`(공고·빠진 행 이름·이유) 명단 · `manual_missing`** · **F3 `pricePlanAfterDelete`** = 지운다고 가정한 분양가 계획(DB 평형 − 지울 `source=apt` 쌍, 영향 단지의 `applyhome_rep` 는 없는 셈 → `counts`·`refill`(다시 채움)·`fresh`(새로 채움)·`lost`(지워지는데 다시 못 채우고 다른 가격도 없는 단지)·`rows`) + 로그 `[정리 미리보기] 분양가 다시 채움 N · 새로 채움 M · 비는 곳 K`) · `--apply-from=<계획>` = **지우는 (행, 공고) 집합과 넣는 (행, 공고) 집합이 둘 다 계획과 같을 때만** 지우고 넣는다(검사관 🟡) · 다르면 위 "기존 쌍만" 모드 · `--dry-run` 은 지금처럼 DB 쓰기 0.
- 지우기는 `id` 로 `.in(ids)` 500개씩 · 돌아온 행 수로 셈 · 로그 `[정리] 지움 N(평형 M·분양가 K) · 넣기 A · 근거 없어 유지 U · 사람 판정 필요 R`.
- 머리말: `NTC_ERROR`(판정 파일 깨짐) · `NTC_BREAKER` · `NTC_PLAN_MISMATCH` · `NTC_WRITE`(지우기 단계 실패) · `NTC_SKIP`(정리 건너뜀 — failure 아님, 실행 기록 표식(F4) · 이때도 넣기는 **기존 쌍만**).

### 4-3. `main` 순서(바뀌는 곳만)

1. 판정 파일 읽기(깨지면 API 호출 전 exit 1) → 2. Detail·Mdl 수집(그대로) → 2.5 후보 로드 + `count` 대조 + 빈 열쇠 채우기 → 3. 매칭 v2(§2) → **3.5 정리 계획**(§4-1, 지금 표 `selectAll(… "id")` + `count` 대조) → dry-run 이면 `--out` 저장 후 끝 → **5-0. 지우기**(차단기·apply-from·건너뜀 판정) → 5. 일정 upsert → 평형 upsert → **그 뒤** `planPrices`(`loadAptIdsWithPrice`·`mergeUnitRows` 가 지운 뒤 DB 를 읽음 — `mergeUnitRows` 는 "DB 누적 + 이번 회차" 라 지운 평형이 빠지고 이번 회차 바른 평형이 남는다) → prices upsert(그대로 · 차단기·불일치면 건너뜀).

## 5. 설계 ④ — 디센트 4행(결정 1 · 둘로 나눔 — 검사관 🟠)

- **PR-B1(세대수 — 승인 뒤 바로)**: `.omc/artifacts/session630/fix-descent-rows.mjs`(dry-run 기본 · `--apply` · `--undo`): 사본 `descent-before.json`(4행 `id,name,units,unsold,unsold_rate,unit_source,complex_key`) → 조건부 UPDATE(`.eq("units", prev)`): `ah-2026910003` 326 · `ah-2026910004` 450 · `ah-2025930027` 450 · `ah-2026910005` 388 · 넷 다 `unit_source='applyhome'` · `unsold_rate` = `round(unsold/units*1000)/10`(8/326=2.5 · 8/450=1.8 · 8/388=2.1) → 재조회 4/4. `_trade-links.mjs` 는 `units` 를 안 쓰므로 10/22 와 무관 · `molit-units` 는 `units<=1 OR unsold_rate>=100` 만 다시 쓴다(`:54`) · 열쇠 영향 0(검사관 4ⓐ).
- **PR-B2(이름 — 10/22(목) 01:00 거래 연결 회차 뒤)**: 0027 `name` → `용인 경남아너스빌 디센트 H3BL(2단지)`. 이유 = 차수 집합이 {2}→{3,2} 가 되어 3단지 거래 후보(3616)를 받고 형제 보류 줄이 늘 수 있는데 10/22 기대값 여유가 2줄뿐(검사관 🟠). 반영 전 `assign-trade-links` 미리보기 재측정 + `assign-complex-keys` 미리보기 "바뀜 0" + 이름 설명 갱신(`same-complex-exceptions.json:19` · `trade-link-decisions.json:96` 의 0027 서술). 화면: 0027 은 VIEW 묶기로 **0004 카드에 접힌다**(끝 괄호 뗀 이름이 같아짐) → live-verify 는 0004·0003 카드(0027 카드는 없음 — 검사관 🟡).
- 전이표(`data-changing-run-approval` §1) + 검사관 2인(적대 Opus + 맹점 Opus — 운영 DB 일회성) → 사장님 승인 → 반영. 되돌리기 = `--undo`.

## 6. 설계 ⑤ — 감시 ⑳ `checkNoticeCrossBundle`(`monitor-collectors.mjs` — ⑯~⑲ 는 이미 쓰임, 검사관 🟠)

주 1회 `presale_schedule_official` 전체 + `apartments(id, complex_key)` 를 읽어 **한 공고가 2묶음+ 에 붙은 수**를 센다 — 판정 파일 `active` 쌍은 뺀다. 0 이 아니면 경보(머리말 `NTC_CROSS`, 명단 앞 5건). 정리 반영 뒤 첫 회차가 기준선 0. 시험 1건 + 변이 1(`active` 제외 삭제 → red).

## 7. 시험·변이(필수 — `guards-must-be-mutation-tested`)

- `collect-applyhome-detail.test.mjs` 에 추가: `parseNoticeDecisions` 거부 7종 · `gateRegionOf`(정식명·약칭·통합·"광주시"→null·"김포"→null) · `matchDetailToApt` v3 — manual 이김·게이트 면제 · `(오)` 제외 · 블록·차수 제외(1곳뿐일 때도 · **회차 낱말 `(임의공급3차)` 는 어긋남 아님**) · 제외는 tops 뒤에, 비면 null · 같은 묶음 동점 → 첫 행(지금과 같음) · 글자로 가름 · 지문으로 가름(주인 행만 · `YYYY-MM` 날짜는 불일치) · 글자+지문 같이(`tie_both`) · 지문 2묶음 → null · 글자↔지문 어긋남 → null · 자동 결과 게이트 탈락 · 게이트 모름 + 유사도 <0.95 + gu 불일치 → `gate_unknown` · 빈 열쇠 채우기 · `planNoticeReconcile` — 같은 묶음 유지 · 다른 묶음 지움 · `skip`/`rejected` 지움 · **어긋남 행 지움(`conflict`)** · `tie_unresolved` 지움 · 게이트·짝 없음 유지 + 명단 · `not_in_api` 손 안 댐 · 평형 `source='apt'` 만 · 분양가 영향 단지 · 중단·행 수 불일치 → 정리 건너뜀 · 차단기 경계(30/31 · 10%) · **차단기·불일치면 기존 쌍만 upsert(새 쌍·지우기·분양가 0)** · `main` 가짜 deps — 지우기 → upsert → 분양가 순서 · dry-run 은 쓰기 0 · 판정 파일 깨짐은 API 호출 전 종료 · `presale-detail` 묶음 읽기(열쇠 있음/없음).
- 변이 최소 11(한 줄씩 넣고 표적 시험 red 확인 뒤 복원): ① 판정 파일 우선 삭제 ② 게이트 면제 삭제 ③ 제외를 tops 앞에서 하기 ④ `B` 묶음 1개 조건을 `>=1` 로 ⑤ 지문의 주인 행 조건 삭제 ⑥ **반대 방향**: 같은 묶음 추가 행도 지움 ⑦ 게이트 탈락 행을 지움 ⑧ 차단기 `>` → `>=` ⑨ 지우기를 upsert **뒤**로 옮김 ⑩ 중단 때 정리 건너뜀 삭제 ⑪ 차단기 때 새 쌍도 upsert ⑫ `stripRoundWords` 전처리 삭제 ⑬ 감시 `active` 제외 삭제.
- 표적 시험 + `typecheck:scripts` + 감사 13 + 구현자 마지막 전체 1회.

## 8. 실행계획(PR 단위 · 순서)

| 단계 | 담당 | 산출 · 검증 |
|---|---|---|
| ① 설계 v1 맹점 검사 ✅ → v2 | `blind-ntc-design`(Opus) | `review-blind-design.md`(🔴1·🟠8·🟡8·🟢4 전부 반영 — 🟠 알림 중복·🟡 지문 전용 구조는 범위 밖 §9) · v2 차등 재검토(같은 검사관) |
| ② 사장님 승인 | 사장님 | §10 |
| ③ PR-A 구현(워크트리 `s630/notice-decisions`) — 매칭 v3 · `gateRegionOf` · 판정 파일 + 파서 · 정리 + 차단기 + `--out/--apply-from` + 기존 쌍만 모드 · `presale-detail` 묶음 읽기(§2-3) · 감시 ⑳ · 시험·변이 · 문서(`scripts/CLAUDE.md` 색인 · `.github/workflows/CLAUDE.md`(주간 회차 실패 동작) · `supabase/CLAUDE.md` 표 설명 · `api/CLAUDE.md`(묶음 읽기) · BACKLOG A-19 · `docs/audits` note · `.claude/rules/collectors/` 안티 패턴 1줄) | `opus-coder`(지시서 = worker-brief 5절 · 전제 실측: 표 칸 `select("*").limit(2)` · 외부 호출 = 청약홈 dry-run 1회 18콜(Detail 3쪽 + Mdl 15쪽 — 구현 미리보기 실측)) | CI 초록 |
| ④ 판정 파일 확정 | 메인(결정 3) | 초안 10줄(active 3 · skip 7)을 PR 에 · 미리보기에서 "자동 기대" 4건이 정말 풀렸는지 확인, 안 풀리면 줄 추가 |
| ⑤ PR-A 검사관 2인 | 적대 Opus(수집기·DB 삭제·변이 재현) + 맹점 Opus(계획 대비 · 명단) | `review-adv-ntc.md` · `review-blind-ntc.md` · 🔴🟠 0 → 합침(**월요일 오전엔 합치지 않는다** — 12:30 회차가 차단기에 걸린다) |
| ⑥ 운영 미리보기 → 전이표 → 반영 | 메인 · 사장님 | 합친 코드로 본 폴더 `--env-file .env.local --dry-run --out=.omc/artifacts/session630/ntc-plan-1.json` → 전이표 = 지우기(묶음별 접기 · 이유별 `other_bundle`/`conflict`/`decision`/`unresolved` · **결정 2 의 50건 밖 행은 따로 표시** — 새 단지 행으로 옮겨 가는 꼴·판정 파일 꼴·어긋남 꼴) · 넣기(이유별) · 분양가 다시 채움 단지 · 근거 없어 유지 명단 · 게이트 모름 명단 · 2ⓑ 로 빠진 행 수 · 사람 판정 필요 명단 · **정리 뒤 상태의 `assign-completion` 미리보기**(그 회차 차단기 10행 — 넘으면 그쪽도 `--apply-from` 또는 `keep` 줄) → 검사관 2인이 명단도 봄 → 승인 → 사본(`ntc-before.json` = 지워질 일정·평형·분양가 행 전체) → **`--apply-from`**(시각 = **합친 주 화~일 낮, 03:00~03:10 굽기·월 12:30 회차 피함**, 다음 월요일 12:30 전) → 재조회 "지우기 0" · 감시 ⑳ 0 · **미리보기와 `--apply-from` 반영은 같은 날 낮 1~2시간 안**(새 공고·새 행(03:00 열쇠·네이버 러너)이 끼면 넣기 명단이 바뀌어 `NTC_PLAN_MISMATCH`) · **반영 직후·03:00 전 `assign-completion` 미리보기 → `assign-trade-links` 미리보기 재측정**(10/22 기대값 여유 2줄 — 넘치면 completion-decisions `keep` 줄) · 전이표엔 `--out` 의 `pricePlanAfterDelete`(다시 채움·비는 곳)·`gate`·`conflict_all` 명단을 같이 싣는다 |
| ⑦ PR-B1 디센트 세대수 → PR-B2 이름(10/22 뒤) | 메인 | §5 |
| ⑧ 확인 3시점 | 메인 | 반영 직후(`presale-detail` 카드가 보여 줄 **공고번호 끝자리** — 래미안 2BL = 730 · 시흥 1블럭 = 288 · 디센트 0003 = 727 · 성동자이리버뷰 = 532 · 세션631 검사관 정정: 이 넷은 세대수가 아니라 공고번호이고, 반영으로 바뀌는 것은 시흥 1블럭(289→288)·디센트(없음→727)·래미안 1BL(→729) — 상세 API 는 CDN 캐시 최대 3시간이라 직후 확인은 DB 로) · 다음 03:00 굽기(VIEW `lastUnsoldEventAt` · `assign-completion` 바뀜 수 = 전이표 값) · 다음 월요일 12:30 정기 회차(지우기 0·`NTC_*` 0·사람 판정 필요 0) · **`NTC_WRITE`(지우기 도중 실패)로 멈춘 회차가 있었으면 다음 날 미리보기로 "지우기 0" 재확인**(그 회차는 일정·평형 upsert 도 건너뛰어 다음 회차가 다시 지우고 넣는다 — 적대 재검사 🟡2) |

### 8-1. 실행 기록(세션631 10/12)

- 19:5x PR-A #743 합침(`0a60941a`) → 19:58 미리보기(지움 110·넣기 15·사람 판정 필요 0 · 50건 밖 38행) → 검사관 2인(적대 `review-adv-apply.md` 🔴0🟠1🟡4 · 맹점 `review-blind-apply.md` 🔴0🟠2🟡8) → 정리 뒤 준공월 흉내 미리보기(순수 함수 `planCompletionUpdates` 에 "지금 일정 − 110 + 15" 를 넣음 · 바뀜 3) → 전이표 페이지 → 사장님 승인 4건 → 20:37 사본 `ntc-before.json` → 20:38 `--apply-from`(계획 일치 · 93초) → 재조회 지우기 0 · 감시 ⑳ 51→0 · 카드 5곳 · 분양가 7곳 · 준공월 실측 바뀜 3 = 흉내.
- 검사관 둘(반영 전 적대 7건 + PR #747 적대 1건)이 찾은 "일정 0 이 되는 공고 중 맞는 단지가 우리 표에 있는 8건"(괄호 뗀 이름 동점 + 블록 어긋남 → `conflict_all` 꼴, 래미안 3BL 은 skip 근거가 틀렸던 것) → PR #747(`fbe3548c`) 판정 파일 active 8줄 → 21:43 정기 실행 꼴 1회(넣기 8·지우기 0) → 일정 1,940행 · 판정 23줄(active 12·skip 11). **교훈**: 판정 파일을 고치면 `collect-applyhome-detail.test.mjs` 와 `monitor-notice-cross-bundle.test.mjs`(`loadNoticeActivePairs` 기대 명단) **둘 다** 바꿔야 한다 — 후자를 놓쳐 CI 가 한 번 빨갔다.
- 반영 시각: 설계 ⑥의 "화~일 낮" 대신 **월요일 밤(12:30 회차 뒤 · 03:00 전)** 에 했다 — 맹점 검사관이 20:30~02:50 사이 네 표를 쓰는 예약 작업 0 을 확인(네이버 러너는 월·목 08:00 · 로컬 러너는 04:30·05:30) · 평일 낮은 새 공고 때문에 `NTC_PLAN_MISMATCH` 위험이 더 컸다.

## 9. 되돌리기 · 범위 밖

- 되돌리기: `ntc-before.json` 의 행을 그대로 insert(일정·평형 `id` 포함 · 분양가는 **같은 날 다시 채운 행을 먼저 지우고**(열쇠 `단지·종류·기록일` 충돌 — 검사관 🟡) 옛 행 insert) · **판정 파일 줄이 없으면 다음 월요일 회차가 다시 지운다** → 되돌릴 땐 판정 파일에 `active` 를 같이 넣거나 PR 되돌리기 · 디센트는 `--undo`.
- 범위 밖(BACKLOG 로): 알림 발송기 중복 열쇠(`notification_logs UNIQUE` 에 단지 id — 같은 묶음 N행이면 N통, 지금도 그 구조 · 지금은 `SMS_ADAPTER_READY=false` 라 실제 발송 0) · VIEW 묶기(id 큰 행)와 계획된 대표 행 D11(`pickRepresentativeId`, 청약홈 먼저·id 작은 순)의 순서가 반대인 것 · 공고 0건인 ah 행 478 · 목록에 행이 없는 단지(래미안 3BL·시티오씨엘 1·3·4단지)를 씨앗이 넣을지 · **지문 전용 짝짓기**(이름 못 찾음 1,456 중 지문이 딱 한 묶음 46 — 오탐 섞임(힐스테이트 신용 더리버→리슈빌 강일 등 5건은 게이트가 잡음) → 지번까지 셋 일치로 좁혀 다음 PR 후보) · `PHASE_RE` 가 `H2BL` 의 2 를 차수로 읽는 것 · VIEW 묶기(끝 괄호 뗀 이름)와 `complex_key` 묶기가 다른 것(래미안 1BL/2BL 이 한 카드) · `ah-2025910275` 시티오씨엘 "8단지" units 428(molit 이 4단지 값) · 네이버 `detail_addr` 저장 · `fetched_at` 갱신 · 곧분양 판정 `api/upcoming.ts:171` 은 카드 id 로만 읽음(원래 구멍 — 공고가 묶음 다른 행에 붙어 있으면 지난 공고 제외가 안 됨 · 이 PR 로 나빠지지 않음) · `ah-2026910093` 파크릭스 A51-2BL 세대수 310 = A51-1BL 공고 값(실제 414 · 별도 데이터 문제).

## 10. 사장님 승인 칸 — ✅ 2026-10-12 03:0x 전부 승인(AskUserQuestion 2건: "승인 — 구현 시작" · "기존 짝만 다시 받고 나머지 멈춤")

- [x] ① §2 규칙 순서(판정 파일 → 동점 집합 뒤 `(오)`·블록 어긋남(회차 낱말 뗀 뒤)·rejected 제외 → 같은 묶음은 지금처럼 첫 행 + 상세 API 가 묶음 단위로 읽음 → 글자+지문(주인 행) → 못 가르면 비움 → 게이트는 시도 첫 낱말일 때만, 모르면 유사도 0.95·gu 보호)
- [x] ② §4 정리(양성 증거 — 다른 묶음·어긋남·판정·못 가름 — 있을 때만 지움 · 게이트·짝 없음은 유지+명단 · 매주 자동 · 차단기 30/10% · 첫 정리는 승인 명단으로 · 결정 2 밖 행 따로 표시)
- [x] ③ §3 판정 파일 10줄(active 3 · skip 7) + "자동 기대" 4건은 미리보기로 확인 — 구현 미리보기에서 4건 전부 기대대로 · PR-A 보완으로 16줄(+ 남양주왕숙 A-24 active · `(오)` 행만 후보인 skip 5)
- [x] ④ §5 디센트 — 세대수는 바로, 이름은 10/22 거래 연결 회차 뒤
- [x] ⑤ **차단기·승인 명단 불일치 때 수집기 동작** = "기존 쌍만 다시 받고 새 넣기·지우기·분양가는 멈춤"(추천 — 재검토 ④: 규칙 `data-changing-run-approval` §2 의 "아무것도 쓰지 않음"에 가장 가깝고, 알림 소스(접수일)는 계속 새로 받는다) / 대안 = 완전히 아무것도 안 씀(그 주 새 공고 일정·접수 알림도 못 받음)
