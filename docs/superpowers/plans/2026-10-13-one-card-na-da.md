# 한 단지 = 한 장 — 나) 미분양 묶음 배분 + 다) 화면 전환 구현 계획서

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> 이 레포의 실행 방식: 메인 세션은 조율만 하고, 구현은 작업반(`opus-coder`)이 **전용 워크트리**에서, 검사는 검사관이 따로 한다(전역 `model-selection.md` 사다리). 작업반은 `git commit`·`git push` 를 부르지 않는다 — 단계가 끝나면 커밋 메시지 파일을 쓰고 `git add` 까지만, 커밋은 메인이 한다. **PR 은 둘**: PR-나(Task 1~4)를 먼저 만들어 CI·검사를 끝내고, 그 가지의 코드로 전이표·검사·승인(운영 단계 A-1~A-3)을 한 뒤 PR-다(Task 5~12)를 연다 — **합치기는 둘 다 B-3 에서 같은 날**(PR-나를 먼저 합쳐 두면 매월 9일 KOSIS 정기 회차가 승인 없이 새 묶음 배분을 쓸 수 있다 — 로컬 러너 `kosis-local-runner.mjs:201` `day: 9`). **나)의 운영 쓰기(A-4)는 다)의 VIEW 적용과 같은 창에서 바로 앞에**(운영 단계 B-4 ⓪ — 나)만 먼저 반영하면 지금 VIEW 가 카드로 내는 작은 회차 행에 "미분양 61 / 세대수 3" 꼴이 보인다, 맹점 검사관 R2). B-4 창이 11/09 05:30 뒤로 밀리면 그 회차는 옛 코드(행 단위)로 돌고 B-4 때 나)가 덮어쓴다 — 문제 없음. 계획서는 한 편(사장님 결정 2026-10-13 ④).

**Goal:** (나) KOSIS 미분양 배분을 행 단위에서 **같은 단지 묶음 단위**로 바꿔 구성원 행 전부가 같은 값을 갖게 하고, (다) VIEW `apartments_flat` 이 묶음을 **한 장**으로 내게 바꿔(대표 행 = 가장 오래된 청약홈 공고, 재료 행 = 번호 주인 네이버 행) 경산 하양 614세대 같은 본 단지가 3세대짜리 회차 카드 뒤에 숨지 않게 한다. 옛 카드 id 로 저장된 관심 단지·링크는 읽을 때 대표로 이어진다.

**Architecture:** 묶음 판정은 이미 있는 순수 함수 하나(`_same-complex.mjs` — 열쇠 칸 `apartments.complex_key` 가 그 사본)에만 기댄다. (나) 는 `collect-unsold-kosis.mjs` 의 계획 함수 `planUnsoldUpdates` 안에서 행을 묶음으로 접어(`_unsold-bundle.mjs` 순수 함수) 분모·추정치를 묶음 단위로 내고 **받는 행 전부에 같은 값**을 쓴다. (다) 는 VIEW 가 `COALESCE(complex_key, id)` 로 묶어 대표/재료/세대수/미분양을 SQL 로 고르고(JS 함수와 같은 픽스처로 시험), 화면·API·굽기 스크립트는 VIEW 가 새로 내는 다섯 칸(`complexKey`·`memberIds`·`materialId`·`noticeName`·`aliasIds`)을 **통과**시킬 뿐 다시 묶지 않는다.

**Tech Stack:** Node 24 ESM(`.mjs` + `// @ts-check` JSDoc) · Supabase(PostgREST · Postgres VIEW) · Vitest · React 19 + TypeScript(`src/`) · Vercel Serverless(`api/`) · GitHub Actions(`daily-deploy.yml`) · Postgres 마이그레이션(Dashboard SQL Editor 수동 적용).

**Spec:** `docs/superpowers/specs/2026-10-01-one-complex-one-card.md` (v5) — §3 D6~D11 · §4-7 (1)~(10) · §5-4 나)·다) · §6-8~10(이 계획서로 닫힘). 앞 단계 계획서 = `docs/superpowers/plans/2026-10-02-one-card-a-complex-key.md`(가) — 라이브). 시험 명단 = `docs/audits/one-card-small-rep-roster-2026-10-13.json`(31묶음, 전환 뒤 30곳은 `d11_rep` 가 카드).

## 사장님 결정 (2026-10-13 세션635) — 설계서 §6-8~10 닫힘

| 번호 | 질문 | 결정 | 이 계획서에서 |
|---|---|---|---|
| §6-8 | 재료 행(네이버) 칸이 비고 청약홈 행에만 값이 있을 때 | **빈칸 그대로** (청약홈 행의 건물 칸은 국토부 이름 맞추기 값이라 이웃 단지 값일 수 있음 — §4-6) | VIEW 는 재료 행 칸을 그대로 낸다. 칸 단위 폴백 없음(Task 6) |
| §6-9 | 보류(`hold`)가 섞인 묶음의 카드 값 | **보류는 그 행만** — 보류 아닌 형제에 값이 있으면 카드는 그 값, 전부 보류면 카드도 자료 없음. 나머지 KOSIS 행은 그대로(2u 가 행을 직접 읽음 — 비우거나 복사하지 않음). 반영 전 6묶음 표를 한 번 더 보여드린다 | KOSIS 접기: hold 행은 받지 않음·분모엔 포함(Task 1) · VIEW 묶음 미분양 순위 = 유효 청약홈 실측 → 값 있는 행 → hold(Task 6) |
| §6-10 | 카드 제목의 회차·안내 문구 | **회차·안내문만 뗀다**(N차·무순위·임의공급·사후·계약취소주택·취소후 재공급·조합원 취소분·안내문). 남긴다 = 블록(A4BL)·1단지/2단지·주상복합·장기전세·나눔형·공공분양·(오). 상세 화면엔 원래 공고 이름(`noticeName`)도 보여 준다 | `_card-title.mjs` + VIEW `name` 에 같은 규칙(Task 5·6·8) |
| 순서 | 나)·다) 계획서·PR | **계획서 하나, PR 은 나) → 다) 순.** 나) 운영 반영은 전이표 승인 뒤 손 실행 1회(정기 회차는 매월 9일, 다음 11/09 — 기다리지 않음) | 운영 단계 A-1~A-3(전이표·검사·승인) → PR-다 → B-4 창에서 A-4(나) 쓰기) 직후 VIEW 적용(맹점 R2 반영 — 사장님께 승인 때 이 순서를 같이 여쭘) |

## 재측정 (2026-10-13 11:0x KST, 운영 DB 읽기 전용 — `.omc/artifacts/session635/probe-nada.{mjs,log,json}`, 받은 행 3,282 = count)

| 항목 | 10/02 설계서 | 10/13 실측 | 뜻 |
|---|---|---|---|
| 묶음 수(카드 수가 된다) | 2,360 | **2,375** (2행+ 묶음 436 · 최대 구성원 19 · 20 초과 0) | 시계열 API 20개 상한 안 |
| 대표 ≠ 재료 묶음 | 384 | **388** | 재료 행 규칙이 실제로 쓰이는 수 |
| 재료 = 네이버 행 묶음 중 칸이 비는 묶음 | 142 | **146** (수영장 94 · 내진 88 · 복도 66 · 도로명 46 · 난방 27 · 소음 16) | §6-8 결정의 영향 범위 |
| hold 섞인 묶음 | 5 | **6** (문수로 · 남악오룡 · 영통 · 수원 아이파크 10단지 · 엘리프 C3 · 화성 남양) | §6-9 명단 |
| applyhome 섞인 묶음 | 6 | **7** (천왕역 · 엘리프 D3 · 르네오션 · 청주 씨엘리체 · 강릉 우미린 · 제일풍경채 첨단3 · 탕정) | VIEW 순위 1위 |
| 대표 이름에 회차·안내 문구 | 72 + 82 | 묶음 54(+안내 2) · 혼자 52(+안내 1) | §6-10 영향 ≈ 110장 |
| D7 세대수 ≠ 대표 행 세대수 묶음 | — | **202** | 카드 세대수가 바뀌는 수 |
| KOSIS 값이 2행+ 인 묶음 | 379 | **389** (행 1,196) | 나) 가 같은 값으로 맞추는 범위 |
| 전환일에 `compute-scores` 가 비울 점수 | — | 491 / 2,662 = **18.4%** (안전판 40% 아래) · D11 대표인데 지금 점수 없는 행 204 | 전환 뒤 첫 굽기에서 채워짐 |
| 카드 수 변화(cats_cache 행 기준) | 2,639 → 2,360 | 2,662 → 2,375 = **−10.8%** | 굽기 장치 max(150, 12%) — 임대 제외 목록 기준은 리허설에서 다시 센다(운영 단계 B-1) |

## Global Constraints

- **규칙은 한 곳**: 같은 단지 판정·대표/재료/세대수 고르기는 `scripts/collectors/_same-complex.mjs` 에만 있다(`assignComplexKeys`·`pickRepresentativeId`·`pickMaterialId`·`pickBundleUnits`·`isPresaleOwner`). 새 코드는 이 함수를 부르고, SQL(VIEW)은 같은 규칙의 사본 — **같은 픽스처로 시험**(Task 6 리허설 대조).
- **대표 행** = `(오)` 뒤로 → 청약홈 행 먼저 → id 오름차순(D11). **재료 행** = `(오)` 뒤로 → 번호 주인 네이버 행(`id = 'ap-' || naver_presale_no`) 중 `presale_min_price` 낮은 것 → id 작은 것 → 없으면 청약홈 id 내림차순 → 나머지 id 내림차순(§4-7 (3)). **세대수(D7)** = `naver_presale`(번호 주인 행일 때만 맨 앞) > `naver` > `molit` > `applyhome` > 출처 빈 값, `(오)` 행과 1 이하 제외, 같은 순위면 큰 값. **가격(D10)** = 재료 행의 가격 행(지금 `latest_prices` 규칙) → 없으면 묶음 안 다른 행을 **id 내림차순**으로 훑어 가격 행이 있는 첫 행.
- **묶음 미분양(사장님 결정 §6-9 반영)** = `(오)`·임대 아닌 구성원 중 ① 유효한 청약홈 실측(`unsold_source='applyhome'` 이고 `unsold_as_of` + 6개월 ≥ 오늘(KST)) 공고일 최근 것 → ② 값이 있는 행(`unsold IS NOT NULL`, hold 아님) 중 재료 행 먼저 → id 내림차순 → ③ 전부 hold 면 hold(unsold NULL). 미분양률(구성원 2+) = `묶음 미분양 ÷ D7 세대수 × 100`(100 초과는 NULL — 지금 규칙), 혼자인 행은 저장값 그대로.
- **KOSIS 쓰기 규칙(나)**: hold 행 → 안 씀(`skip_hold`, DB WHERE 로도 막음 — 지금 그대로) · 유효 applyhome 행 → 안 씀(`skip_preserved`) · 임대 → `skip_lease` · 옛 완판 실측(`unsold===0 && unsold_source==null`) → `skip_preserved` · **그 밖의 구성원 전부에 묶음 추정치와 묶음 미분양률을 같은 값으로**. `(오)` 행은 자기만의 묶음(`#off:<id>`)으로 따로 배분한다(아파트 미분양 값을 오피스텔 행에 쓰지 않는다 — §4-2 "값 재료로 쓰지 않는다"의 쓰기 쪽 짝). 분모 = 같은 KOSIS 시군구 열쇠 안 **묶음 세대수(D7)의 합**(비임대, hold 묶음 포함 — 지금 규칙 0 의 "분모엔 남긴다" 유지).
- **출력 무변경 원칙(§4-7 (9)) + 예외 하나**: 구성원이 하나뿐인 묶음의 VIEW 출력은 지금 VIEW 와 칸 하나 다르지 않아야 한다 — 새로 붙는 칸 5개와 **`name`(회차·안내문 떼기 — 사장님 결정 §6-10)** 만 예외. 리허설(운영 단계 B-1)에서 "다른 칸 = name 뿐이고, 그 name 은 `stripNoticeWords(옛 name)` 과 같다"를 id 단위로 확인한다.
- **VIEW 칸 순서**: `CREATE OR REPLACE VIEW` 는 기존 칸 순서·이름을 못 바꾼다(42P16) — 새 칸 5개는 SELECT **맨 끝**, `WITH (security_invoker = on)` 을 CREATE 에 직접 명시. 되돌리기 = `supabase/migrations/_rollbacks/`(본 폴더 금지, 세션566).
- **화면·API 는 다시 묶지 않는다**: `src/lib/dedup.ts` 는 `memberIds` 가 있으면 통과, 없으면(옛 정적 JSON) 지금 규칙 — PR-다 코드는 **VIEW 적용 전에 합쳐도 화면이 그대로**여야 한다(운영 단계 B 의 순서가 이걸 전제한다).
- **DB 쓰기**: 나) = `apartments.unsold`·`unsold_rate`·`unsold_source`·`unsold_as_of`·`updated_at` + `unsold_history`(지금과 같은 칸) + `regions.regional_unsold`(지금 그대로). 다) = VIEW 정의만(표 쓰기 0) + `cats_cache`(점수 굽기, 지금 그대로). 그 밖의 칸을 쓰는 코드를 넣지 않는다.
- **운영 폴더 금지**: `F:\mibunyang` 본 폴더는 예약 실행이 도는 운영 코드다. 편집·시험은 워크트리에서만. Bash 는 호출마다 `cd <워크트리> && …`. `git stash` · `git checkout -- <파일>` 금지(되돌리기는 `cp` 사본).
- **수집기·쓰기 스크립트를 파이프 뒤에 두지 않는다**(`| tail` 금지) — 출력은 `> 파일 2>&1` 로 받고 나서 읽는다. 쓰기 스크립트는 **작업반이 실제로 돌리지 않는다**(dry-run 포함 — 운영 DB 조회는 메인이 운영 단계에서).
- **시각 창**: 운영 DB 를 바꾸는 일(나) 손 실행 · VIEW 적용 · 점수 굽기)은 KST 03:00~06:30 과 월·목 08~14시를 피한다. 전체 시험(`npm run test`)·빌드는 01:30~06:30 에 돌리지 않는다. 파생표 정리는 이 계획에 없다(`purge-to-recollect-timing` 해당 없음).
- **시간대**: VIEW 의 "오늘"은 `(now() AT TIME ZONE 'Asia/Seoul')::date`(Supabase 세션 TZ 는 UTC), JS 쪽은 지금처럼 `now` 주입(`isApplyhomeExpired(asOf, now)`).
- 사장님께 보이는 글·작업반 보고는 처음부터 끝까지 한국어(코드 이름·경로·로그 인용만 원문).

## Review Focus

설계서가 말하지 않았지만 이 코드가 실제로 만나게 될 입력 — 각 줄의 시험은 그 Task 에 적었다(괄호 안).

1. **열쇠 칸이 빈 새 행**(오늘 생겨 아직 `assign-complex-keys` 가 안 돈 행) — 혼자인 묶음으로 처리돼야 하고, KOSIS 가 그 행을 건너뛰거나 남의 묶음에 섞으면 안 된다(Task 1 "complex_key 가 null 인 행은 자기 id 묶음").
2. **묶음 안에 세대수 재료가 하나도 없는 경우**(`(오)` 행뿐이거나 전부 1 이하) — 분모에 0 을 더하거나 NaN 률을 쓰지 말고 `skip_invalid`(Task 1 "세대수 재료가 없으면 units=null" · Task 2 규칙 1 이 `b.units` 로 `skip_invalid`).
3. **대표 행이 사라진 옛 id 로 들어온 손님**(관심 단지 저장소·딥링크 `/apt/ah-2022910142`·알림 신청) — 지우거나 404 가 아니라 대표 카드로 이어져야 한다(Task 7 `buildIdAlias` · Task 8 딥링크·정리 effect 시험 · Task 10 알림 매칭 시험).
4. **옛 정적 JSON(`memberIds` 없음) 위에서 도는 새 화면 코드** — VIEW 적용 전 하루, 또는 롤백한 날. 지금과 똑같이 동작해야 한다(Task 7 "memberIds 가 없는 옛 목록은 지금 규칙 그대로" · Task 8 재공고 수 = `siblingIds` 의 `ah-` 수라 옛 목록에서도 그대로 센다).
5. **한 달에 여러 행이 오는 미분양 시계열**(전환 전 달의 반쪽 값·같은 달 여러 구성원) — 차트가 톱니가 되지 않게 한 달 한 값, 재료 행 값 먼저(Task 9 `mergeMonthly` 시험 "같은 달 세 행 → 첫 id 값, 첫 id 가 없는 달은 최댓값").

## File Structure

| 파일 | 하는 일 | 이 계획에서 |
|---|---|---|
| `scripts/collectors/_unsold-bundle.mjs` | 미분양 배분용 묶음 접기(순수 함수): 행 → 묶음(세대수 D7·받는 행·건너뛰는 행) | 새로(Task 1) |
| `scripts/collectors/_unsold-bundle.test.mjs` | 위의 시험(하양 꼴·hold 섞임·applyhome 섞임·`(오)`·열쇠 빈 행) | 새로(Task 1) |
| `scripts/collectors/collect-unsold-kosis.mjs` | `planUnsoldUpdates`·`unsold_history` 가 묶음 단위로 분모·추정치를 냄 | 고침(Task 2) |
| `scripts/collectors/collect-unsold-kosis.test.mjs` | 묶음 분모·같은 값 쓰기·`(오)` 분리 시험 추가 | 고침(Task 2) |
| `scripts/collectors/naver-presale.mjs` | 번호 주인 행의 네이버 총세대수 따라가기(§4-7 (4) ④) | 고침(Task 3) |
| `scripts/collectors/naver-presale.test.mjs` | 위 시험 | 고침(Task 3) |
| `scripts/collectors/_card-title.mjs` | 카드 제목에서 회차·안내문 떼기(JS) + SQL 정규식 문자열 한 벌 | 새로(Task 5) |
| `scripts/collectors/_card-title.test.mjs` · `docs/audits/card-title-paren-fixture.json` | 운영 DB 괄호 문구 전수(10/13) 를 떼기/남기기로 분류한 픽스처 + 시험 | 새로(Task 5) |
| `supabase/migrations/20261013000000_view_one_card_bundle.sql` | VIEW 를 묶음 조합으로 교체 + 새 칸 5개 | 새로(Task 6) |
| `supabase/migrations/_rollbacks/20261013000001_rollback_view_one_card_bundle.sql` | 20261007 판으로 되돌림 | 새로(Task 6) |
| `supabase/migrations/_rehearsal/20261013_one_card_rehearsal_view.sql` · `_drop.sql` | 같은 본문의 `apartments_flat_rehearsal` 을 만들고(운영 VIEW 무변경·무잠금) node 가 전수 대조한 뒤 지운다 | 새로(Task 6) |
| `src/lib/dedup.ts` · `src/lib/dedup.test.js` | `memberIds` 통과 + `buildIdAlias` | 고침(Task 7) |
| `src/hooks/useApartmentData.ts` · `useUrlSync.ts` · `src/components/DetailModal.tsx` · `src/components/detail/UnsoldChart.tsx` · `PriceChart.tsx` · `src/types/*.ts` | 옛 id → 대표 넘김 · 재공고 N회 = 청약홈 공고 수 · 시계열 id 순서(재료 먼저) · 원래 공고 이름 표시 | 고침(Task 8) |
| `api/supabase/apartments.ts` · `api/_lib/timeseriesHandler.ts` · `api/supabase/unsold-history.ts` + 시험 | 새 칸 통과 · 미분양 시계열 한 달 한 값 | 고침(Task 9) |
| `scripts/collect-data.mjs` · `scripts/static-outputs.mjs` · `scripts/compute-scores.mjs` · `scripts/collectors/calc-layout.mjs` · `scripts/backfill-presale-area-notices.mjs` · `scripts/notify-subscribers.mjs` + 시험 | 전환일 장수 승인 인자 · `noticeName` 상세 버킷 · 점수 정리 사전 집계 로그 · layout·면적을 재료 행에 쓰기 · 알림은 같은 묶음이면 | 고침(Task 10) |
| ~~`scripts/monitor-collectors.mjs` 감시 ㉒~~ | (삭제 — 맹점 O11: VIEW 구조상 늘 0 이라 지키는 것이 없다. §4-3 ①은 ⑭·매일 열쇠 배치가, ②는 라)로) | 없음(Task 11 은 비어 있음) |
| `supabase/CLAUDE.md` · `api/CLAUDE.md` · `src/hooks/CLAUDE.md` · `src/components/CLAUDE.md` · `scripts/CLAUDE.md` · `.claude/BACKLOG.md` · 설계서 §5 | 한 줄씩 | 고침(Task 12) |

---

## Part 나) — PR-나: 미분양 묶음 배분 + 네이버 세대수 따라가기

### Task 1: 묶음 접기 순수 함수 `_unsold-bundle.mjs`

**Files:**
- Create: `scripts/collectors/_unsold-bundle.mjs`
- Create: `scripts/collectors/_unsold-bundle.test.mjs`

**Interfaces:**
- Consumes: `pickBundleUnits(members)` · `isPresaleOwner(m)`(`./_same-complex.mjs`) · `isLeaseUnit(row)`(`../../src/constants/leaseTypes.mjs`) · `applyhomeStatus(apt, now)`(`./collect-unsold-kosis.mjs` 에서 **옮겨 오지 않고** 호출부가 넘긴다 — 순환 import 방지: 이 모듈은 `isRespected(apt)` 콜백을 받는다).
- Produces(Task 2 가 쓴다):
  - `bundleKeyOf(row: { id: string, name?: string | null, complex_key?: string | null }): string` — `(오)` 행이면 `${complex_key ?? id}#off:${id}`, 아니면 `complex_key ?? id`.
  - `foldForUnsold(rows: readonly UnsoldRow[], opts: { isRespected: (row: UnsoldRow) => boolean }): UnsoldBundle[]` — `UnsoldRow = { id, name, region, gu, units, unit_source, unsold, unsold_rate, unsold_source, unsold_as_of, presale_type, naver_presale_no, complex_key }`, `UnsoldBundle = { key, members: UnsoldRow[], region: string | null, gu: string | null, units: number | null, unitSource: string | null, unitsFromId: string | null, lease: boolean, receivers: string[], holds: string[], respected: string[] }`. `receivers` = hold 아님 · `isRespected` 거짓 · 임대 아님인 구성원 id(쓰기 대상). `units` 는 `pickBundleUnits(members)` — 단 `(오)` 뿐인 묶음(`#off:`)은 `pickBundleUnits` 가 `(오)` 행을 재료에서 빼므로 이름의 `(오)` 를 지운 사본으로 부른다(아니면 null — 할루 검사관 지적 1). `region`·`gu` 는 `receivers` 첫 행, 없으면 구성원 첫 행.
  - `summarizeFold(bundles): { bundles: number, multi: number, receivers: number, holdsInMulti: number, respectedInMulti: number }` — 로그용.

- [ ] **Step 1: 실패하는 시험을 먼저 쓴다**

`scripts/collectors/_unsold-bundle.test.mjs`:

```js
// @ts-check
import { describe, it, expect } from "vitest";
import { bundleKeyOf, foldForUnsold, summarizeFold } from "./_unsold-bundle.mjs";

/** @param {Partial<import("./_unsold-bundle.mjs").UnsoldRow> & { id: string }} o */
const row = (o) => ({ name: o.id, region: "경북", gu: "경산시", units: null, unit_source: null, unsold: null, unsold_rate: null,
  unsold_source: null, unsold_as_of: null, presale_type: null, naver_presale_no: null, complex_key: null, ...o });
const notRespected = { isRespected: () => false };

describe("bundleKeyOf", () => {
  it("열쇠가 있으면 열쇠, 없으면 자기 id", () => {
    expect(bundleKeyOf(row({ id: "ah-1", complex_key: "K" }))).toBe("K");
    expect(bundleKeyOf(row({ id: "ah-1" }))).toBe("ah-1");
  });
  it("(오) 행은 같은 열쇠여도 자기만의 묶음", () => {
    expect(bundleKeyOf(row({ id: "ah-9", name: "송도 그란테르(오)", complex_key: "K" }))).toBe("K#off:ah-9");
  });
});

describe("foldForUnsold — 하양 꼴(614세대 본 단지 + 3세대 회차)", () => {
  const rows = [
    row({ id: "ah-2024910001", complex_key: "하양", units: 614, unit_source: "molit", unsold: 40, unsold_source: "kosis" }),
    row({ id: "ah-2026910002", complex_key: "하양", units: 3, unit_source: "applyhome", unsold: 1, unsold_source: "kosis" }),
    row({ id: "ap-6020001", complex_key: "하양", units: 614, unit_source: "naver_presale", naver_presale_no: "6020001", unsold: 40, unsold_source: "kosis" }),
  ];
  const [b] = foldForUnsold(rows, notRespected);
  it("묶음 하나 · 세대수는 번호 주인 네이버 값 · 받는 행은 셋 다", () => {
    expect(foldForUnsold(rows, notRespected)).toHaveLength(1);
    expect(b.units).toBe(614);
    expect(b.unitsFromId).toBe("ap-6020001");
    expect(b.receivers.sort()).toEqual(["ah-2024910001", "ah-2026910002", "ap-6020001"]);
  });
});

describe("foldForUnsold — 섞인 묶음", () => {
  it("hold 행은 받지 않고 holds 에, 나머지는 받는다(보류는 그 행만 — 사장님 결정 §6-9)", () => {
    const rows = [
      row({ id: "ah-2025910250", complex_key: "엘리프C3", units: 127, unsold_source: "hold" }),
      row({ id: "ap-6026712", complex_key: "엘리프C3", units: 452, unit_source: "naver_presale", naver_presale_no: "6026712", unsold: 0, unsold_source: "kosis" }),
    ];
    const [b] = foldForUnsold(rows, notRespected);
    expect(b.holds).toEqual(["ah-2025910250"]);
    expect(b.receivers).toEqual(["ap-6026712"]);
    expect(b.units).toBe(452);
  });
  it("존중 행(유효 applyhome·옛 완판)은 respected 에, 받지 않는다", () => {
    const rows = [
      row({ id: "ah-2026910109", complex_key: "르네오션", units: 63, unit_source: "applyhome", unsold: 63, unsold_source: "applyhome", unsold_as_of: "2026-05-12" }),
      row({ id: "ap-6028359", complex_key: "르네오션", units: 263, unit_source: "naver_presale", naver_presale_no: "6028359", unsold: 40, unsold_source: "kosis" }),
    ];
    const [b] = foldForUnsold(rows, { isRespected: (r) => r.unsold_source === "applyhome" });
    expect(b.respected).toEqual(["ah-2026910109"]);
    expect(b.receivers).toEqual(["ap-6028359"]);
  });
  it("전부 hold 면 받는 행 0 · units 는 그래도 D7 로 센다(분모용)", () => {
    const rows = [
      row({ id: "ah-2022910170", complex_key: "남악", units: 178, unsold_source: "hold" }),
      row({ id: "ah-2022910363", complex_key: "남악", units: 27, unsold_source: "hold" }),
    ];
    const [b] = foldForUnsold(rows, notRespected);
    expect(b.receivers).toEqual([]);
    expect(b.units).toBe(178);
  });
  it("임대 묶음은 lease=true · 받는 행 0", () => {
    const rows = [row({ id: "ah-1", complex_key: "임대", units: 300, presale_type: "국민임대" })];
    const [b] = foldForUnsold(rows, notRespected);
    expect(b.lease).toBe(true);
    expect(b.receivers).toEqual([]);
  });
  it("세대수 재료가 없으면(1 이하뿐) units=null", () => {
    const [b] = foldForUnsold([row({ id: "ah-1", units: 1 })], notRespected);
    expect(b.units).toBeNull();
  });
  it("complex_key 가 null 인 행은 자기 id 묶음(남과 섞이지 않음)", () => {
    const bs = foldForUnsold([row({ id: "ah-1", units: 100 }), row({ id: "ah-2", units: 100 })], notRespected);
    expect(bs.map((b) => b.key).sort()).toEqual(["ah-1", "ah-2"]);
  });
  it("(오) 행은 같은 열쇠여도 따로 묶이고 아파트 묶음 세대수에 안 들어간다", () => {
    const rows = [
      row({ id: "ah-1", complex_key: "K", units: 500, unit_source: "molit" }),
      row({ id: "ah-2", name: "같은단지(오)", complex_key: "K", units: 900, unit_source: "molit" }),
    ];
    const bs = foldForUnsold(rows, notRespected);
    expect(bs).toHaveLength(2);
    expect(bs.find((b) => b.key === "K")?.units).toBe(500);
    expect(bs.find((b) => b.key === "K#off:ah-2")?.units).toBe(900);
  });
  it("summarizeFold 는 묶음·2행+·받는 행 수를 센다", () => {
    const rows = [
      row({ id: "ah-1", complex_key: "K", units: 500 }), row({ id: "ah-2", complex_key: "K", units: 3, unsold_source: "hold" }),
      row({ id: "ah-3", units: 10 }),
    ];
    expect(summarizeFold(foldForUnsold(rows, notRespected))).toEqual({ bundles: 2, multi: 1, receivers: 2, holdsInMulti: 1, respectedInMulti: 0 });
  });
});
```

- [ ] **Step 2: 빨강 확인**

Run: `cd <워크트리> && node ../../../node_modules/vitest/vitest.mjs run scripts/collectors/_unsold-bundle.test.mjs > <스크래치>/t1-red.log 2>&1; echo "exit=$?"`
Expected: `exit=1`, 로그에 `_unsold-bundle.mjs` 를 찾지 못한다는 오류.

- [ ] **Step 3: 모듈을 쓴다**

`scripts/collectors/_unsold-bundle.mjs`:

```js
// @ts-check
/**
 * 미분양 배분용 묶음 접기 — "한 단지 = 한 장" 나) 단계(설계서 §4-7 (5), 세션635).
 *
 * 왜: KOSIS 는 시군구 미분양 합계를 단지 세대수 비례로 나눈다. 같은 단지가 여러 행(청약홈 회차·네이버)이면
 * 행마다 따로 받아 한 단지가 두세 번 세어지고(세션588 흉내 29,486 → 17,227), 2u 는 원본 행을 그대로 읽는다.
 * 그래서 **묶음 단위로 한 번 계산해 받는 행 전부에 같은 값**을 쓴다.
 *
 * 규칙(사장님 결정 2026-10-13 §6-9): 사람 보류(hold)·존중 행(유효 청약홈 실측·옛 완판)은 **그 행만** 안 받는다 —
 * 형제 행은 묶음 값을 받는다. 보류 행도 분모(묶음 세대수)에는 든다(규칙 0 "분모엔 남긴다").
 * `(오)` 행은 같은 열쇠여도 자기만의 묶음이다 — 아파트 값을 오피스텔 행에 쓰지 않는다(§4-2).
 *
 * 순수 함수만. DB·시각을 보지 않는다(존중 판정은 호출부가 `isRespected` 로 넘긴다 — 순환 import 방지).
 */
import { pickBundleUnits } from "./_same-complex.mjs";
import { isLeaseUnit } from "../../src/constants/leaseTypes.mjs";

/**
 * @typedef {{ id: string; name: string | null; region: string | null; gu: string | null; units: number | null;
 *   unit_source: string | null; unsold: number | null; unsold_rate: number | null; unsold_source: string | null;
 *   unsold_as_of: string | null; presale_type: string | null; naver_presale_no: string | null; complex_key: string | null }} UnsoldRow
 * @typedef {{ key: string; members: UnsoldRow[]; region: string | null; gu: string | null; units: number | null;
 *   unitSource: string | null; unitsFromId: string | null; lease: boolean; receivers: string[]; holds: string[]; respected: string[] }} UnsoldBundle
 */

/** @param {{ id: string; name?: string | null; complex_key?: string | null }} row */
export function bundleKeyOf(row) {
  const base = row.complex_key ?? row.id;
  return String(row.name ?? "").includes("(오)") ? `${base}#off:${row.id}` : base;
}

/**
 * @param {readonly UnsoldRow[]} rows
 * @param {{ isRespected: (row: UnsoldRow) => boolean }} opts
 * @returns {UnsoldBundle[]}
 */
export function foldForUnsold(rows, { isRespected }) {
  /** @type {Map<string, UnsoldRow[]>} */
  const byKey = new Map();
  for (const r of rows) {
    const k = bundleKeyOf(r);
    const arr = byKey.get(k);
    if (arr) arr.push(r); else byKey.set(k, [r]);
  }
  /** @type {UnsoldBundle[]} */
  const out = [];
  for (const [key, members] of byKey) {
    const lease = members.some((m) => isLeaseUnit(m));
    // (오) 뿐인 묶음(`#off:`): pickBundleUnits 는 (오) 행을 재료에서 빼므로(_same-complex.mjs:305) 그대로 부르면 null 이 된다 —
    // 오피스텔 자기 묶음에서는 자기 세대수가 재료다 → 이름의 (오) 표시를 지운 사본으로 같은 순위 규칙을 적용한다.
    const picked = key.includes("#off:")
      ? pickBundleUnits(members.map((m) => ({ ...m, name: String(m.name ?? "").replace("(오)", "") })))
      : pickBundleUnits(members);
    /** @type {string[]} */ const holds = [];
    /** @type {string[]} */ const respected = [];
    /** @type {string[]} */ const receivers = [];
    for (const m of members) {
      if (m.unsold_source === "hold") { holds.push(m.id); continue; }
      if (lease) continue;
      if (isRespected(m)) { respected.push(m.id); continue; }
      receivers.push(m.id);
    }
    const first = members.find((m) => receivers.includes(m.id)) ?? members[0];
    out.push({
      key, members, region: first.region ?? null, gu: first.gu ?? null,
      units: picked?.units ?? null, unitSource: picked?.source ?? null, unitsFromId: picked?.fromId ?? null,
      lease, receivers, holds, respected,
    });
  }
  return out;
}

/** @param {readonly UnsoldBundle[]} bundles */
export function summarizeFold(bundles) {
  let multi = 0, receivers = 0, holdsInMulti = 0, respectedInMulti = 0;
  for (const b of bundles) {
    receivers += b.receivers.length;
    if (b.members.length >= 2) { multi++; holdsInMulti += b.holds.length; respectedInMulti += b.respected.length; }
  }
  return { bundles: bundles.length, multi, receivers, holdsInMulti, respectedInMulti };
}
```

- [ ] **Step 4: 초록 확인 + 타입**

Run: `cd <워크트리> && node ../../../node_modules/vitest/vitest.mjs run scripts/collectors/_unsold-bundle.test.mjs > <스크래치>/t1-green.log 2>&1; echo "exit=$?"` → Expected: `exit=0`, 실패 0.
Run: `cd <워크트리> && node ../../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.scripts.json > <스크래치>/t1-tsc.log 2>&1; echo "exit=$?"` → Expected: `exit=0`.
Run: `cd <워크트리> && node scripts/audit-declared-deps.mjs > <스크래치>/t1-deps.log 2>&1; echo "exit=$?"` → Expected: `exit=0`(새 import 는 레포 안 모듈뿐).

- [ ] **Step 5: 변이 4종(손으로 — 각각 고치고 시험 → 빨강 확인 → `cp` 사본으로 되돌림)**

| 변이 | 고치는 곳 | 기대 |
|---|---|---|
| M1 | `bundleKeyOf` 의 `includes("(오)")` 를 `includes("(오오)")` 로 | "(오) 행은 자기만의 묶음" 빨강 |
| M2 | `if (m.unsold_source === "hold") { holds.push(m.id); continue; }` 의 `continue` 삭제 | "hold 행은 받지 않고" 빨강 |
| M3 | `if (isRespected(m)) { … continue; }` 의 `continue` 삭제 | "존중 행" 빨강 |
| M4 | `const lease = members.some(…)` 를 `const lease = false` 로 | "임대 묶음" 빨강 |

되돌린 뒤 `cd <워크트리> && git diff --stat -- scripts/collectors/_unsold-bundle.mjs` 가 **처음 올려 둔 판과 같은지**(변이 흔적 0) 확인하고 Step 4 시험을 한 번 더.

- [ ] **Step 6: 올려 두기(커밋은 메인)**

`<스크래치>/commit-msg-1.txt`:

```
feat(collectors): _unsold-bundle — 미분양 배분용 묶음 접기 순수 함수 (한 단지 = 한 장 나)

- bundleKeyOf: complex_key ?? id, (오) 행은 자기만의 묶음
- foldForUnsold: 묶음 세대수 = pickBundleUnits(D7) · hold·존중 행은 그 행만 안 받음(사장님 결정 §6-9) · 임대 묶음은 받는 행 0
- 시험 11건 + 변이 4종 빨강
```

```bash
cd <워크트리> && git add -- scripts/collectors/_unsold-bundle.mjs scripts/collectors/_unsold-bundle.test.mjs
```

`SendMessage(to:"main")`: "Task 1 끝 — 시험 11 통과 · 변이 4 빨강 · tsc 0".

---

### Task 2: `collect-unsold-kosis.mjs` 를 묶음 단위로

**Files:**
- Modify: `scripts/collectors/collect-unsold-kosis.mjs` — `planUnsoldUpdates`(286~423) · apartments 조회 select(667) · `unsold_history` 분모·행 생성(829~881) · 로그 2줄
- Modify: `scripts/collectors/collect-unsold-kosis.test.mjs`

**Interfaces:**
- Consumes: Task 1 의 `foldForUnsold`·`summarizeFold` · 기존 `shouldSkipKosisFill`·`applyhomeStatus`·`calcProportionalUnsold`·`resolveKosisGuKey`·`UNRELIABLE_RATE_THRESHOLD`.
- Produces: `planUnsoldUpdates({ apartments, unsoldByRegionGu, now })` 의 **시그니처는 그대로**. `apartments` 행에 `complex_key`·`naver_presale_no`·`unit_source` 가 더 들어온다(없으면 `undefined` → 혼자 묶음 — 옛 시험 호환). 계획 행에 칸 3개가 **추가**된다: `bundleKey: string` · `bundleUnits: number | null` · `bundleSize: number`. 받는 행의 `newEstimate`·`newRate` 는 묶음 값(묶음 안 같은 값), `totalUnitsInGu` 는 묶음 세대수 합 분모.
- 로그 한 줄 추가: `[묶음] 묶음 N · 2행+ M · 받는 행 R · 2행+ 안 hold H · 존중 S` (`summarizeFold`).

- [ ] **Step 1: 실패하는 시험 추가**

`scripts/collectors/collect-unsold-kosis.test.mjs` 끝에(기존 `describe` 와 같은 import 를 쓴다 — 파일 머리의 `planUnsoldUpdates` import 확인):

```js
describe("planUnsoldUpdates — 묶음 단위 배분(세션635 나)", () => {
  const guMap = { 경북: { 경산시: 100 } }; // 경산시 미분양 100
  const base = { region: "경북", gu: "경산시", unsold: null, unsold_rate: null, naver_sell_count: null, presale_type: null, unsold_source: null, unsold_as_of: null, unit_source: null, naver_presale_no: null, complex_key: null };
  it("같은 묶음 세 행이 같은 추정치·같은 률을 받고, 분모는 묶음 세대수 한 번만", () => {
    const apartments = [
      { ...base, id: "ah-1", name: "하양", units: 614, unit_source: "molit", complex_key: "하양" },
      { ...base, id: "ah-2", name: "하양(2차)", units: 3, unit_source: "applyhome", complex_key: "하양" },
      { ...base, id: "ap-9", name: "하양", units: 614, unit_source: "naver_presale", naver_presale_no: "9", complex_key: "하양" },
      { ...base, id: "ah-3", name: "다른단지", units: 386 },
    ];
    const plan = planUnsoldUpdates({ apartments, unsoldByRegionGu: guMap });
    const byId = Object.fromEntries(plan.map((p) => [p.id, p]));
    // 분모 = 614(하양 묶음) + 386 = 1000 → 하양 묶음 61.4 → 61, 률 61/614 = 9.9
    expect(byId["ah-1"].totalUnitsInGu).toBe(1000);
    expect(byId["ah-1"].newEstimate).toBe(61);
    expect(byId["ah-2"].newEstimate).toBe(61);
    expect(byId["ap-9"].newEstimate).toBe(61);
    expect(byId["ah-2"].newRate).toBe(byId["ah-1"].newRate);
    expect(byId["ah-1"].bundleKey).toBe("하양");
    expect(byId["ah-1"].bundleUnits).toBe(614);
    expect(byId["ah-1"].bundleSize).toBe(3);
    expect(byId["ah-3"].newEstimate).toBe(39);
  });
  it("회차 행(units 3)은 혼자였으면 skip_invalid 가 아니지만, 묶음에선 묶음 세대수로 판정해 write 를 받는다", () => {
    const apartments = [
      { ...base, id: "ah-1", name: "하양", units: 614, complex_key: "하양" },
      { ...base, id: "ah-2", name: "하양(2차)", units: 1, complex_key: "하양" },
    ];
    const plan = planUnsoldUpdates({ apartments, unsoldByRegionGu: guMap });
    expect(plan.find((p) => p.id === "ah-2")?.action).toBe("write");
  });
  it("hold 행은 skip_hold 그대로, 형제는 받는다 · 분모에는 hold 묶음 세대수도 든다", () => {
    const apartments = [
      { ...base, id: "ah-1", name: "엘리프", units: 127, unsold_source: "hold", complex_key: "엘리프" },
      { ...base, id: "ap-2", name: "엘리프", units: 452, unit_source: "naver_presale", naver_presale_no: "2", unsold: 0, unsold_source: "kosis", complex_key: "엘리프" },
      { ...base, id: "ah-3", name: "남악", units: 178, unsold_source: "hold", complex_key: "남악" },
      { ...base, id: "ah-4", name: "남악", units: 27, unsold_source: "hold", complex_key: "남악" },
    ];
    const plan = planUnsoldUpdates({ apartments, unsoldByRegionGu: guMap });
    const byId = Object.fromEntries(plan.map((p) => [p.id, p]));
    expect(byId["ah-1"].action).toBe("skip_hold");
    expect(byId["ap-2"].action).toBe("write");
    expect(byId["ap-2"].totalUnitsInGu).toBe(452 + 178); // 남악 묶음 D7 = 178(큰 값)
    expect(byId["ah-3"].action).toBe("skip_hold");
  });
  it("유효 applyhome 행은 skip_preserved 그대로, 형제 네이버 행은 받는다", () => {
    const now = new Date("2026-10-13T03:00:00Z");
    const apartments = [
      { ...base, id: "ah-1", name: "르네오션", units: 63, unsold: 63, unsold_source: "applyhome", unsold_as_of: "2026-05-12", complex_key: "르네" },
      { ...base, id: "ap-2", name: "르네오션", units: 263, unit_source: "naver_presale", naver_presale_no: "2", unsold: 40, unsold_source: "kosis", complex_key: "르네" },
    ];
    const plan = planUnsoldUpdates({ apartments, unsoldByRegionGu: guMap, now });
    const byId = Object.fromEntries(plan.map((p) => [p.id, p]));
    expect(byId["ah-1"].action).toBe("skip_preserved");
    expect(byId["ap-2"].action).toBe("write");
    expect(byId["ap-2"].bundleUnits).toBe(263);
  });
  it("(오) 행은 같은 열쇠여도 따로 배분받는다", () => {
    const apartments = [
      { ...base, id: "ah-1", name: "그란테르", units: 500, complex_key: "G" },
      { ...base, id: "ah-2", name: "그란테르(오)", units: 500, complex_key: "G" },
    ];
    const plan = planUnsoldUpdates({ apartments, unsoldByRegionGu: guMap });
    const byId = Object.fromEntries(plan.map((p) => [p.id, p]));
    expect(byId["ah-2"].bundleKey).toBe("G#off:ah-2");
    expect(byId["ah-1"].totalUnitsInGu).toBe(1000);
  });
  it("complex_key 가 없는 옛 입력(기존 시험 꼴)은 행마다 혼자 묶음 — 결과가 전과 같다", () => {
    const apartments = [{ ...base, id: "ah-1", name: "A", units: 400 }, { ...base, id: "ah-2", name: "B", units: 600 }];
    const plan = planUnsoldUpdates({ apartments, unsoldByRegionGu: guMap });
    expect(plan.map((p) => p.newEstimate)).toEqual([40, 60]);
    expect(plan.every((p) => p.bundleSize === 1)).toBe(true);
  });
});
```

- [ ] **Step 2: 빨강 확인**

Run: `cd <워크트리> && node ../../../node_modules/vitest/vitest.mjs run scripts/collectors/collect-unsold-kosis.test.mjs > <스크래치>/t2-red.log 2>&1; echo "exit=$?"`
Expected: `exit=1` — 새 6건이 `bundleKey`/`totalUnitsInGu` 불일치로 실패, 기존 시험은 그대로 초록.

- [ ] **Step 3: `planUnsoldUpdates` 를 묶음 단위로 고친다**

파일 머리에 import 한 줄: `import { foldForUnsold, summarizeFold } from "./_unsold-bundle.mjs";`

`planUnsoldUpdates` 본문(286~423)을 아래로 바꾼다. 행 단위 규칙 0~4(hold·무효·임대·존중)의 **판정 순서와 action 이름은 그대로**이고, 바뀌는 것은 (a) 분모가 묶음 세대수 합 (b) 5a~5f 가 묶음마다 한 번 계산돼 받는 행 전부에 같은 값 (c) 무효 판정의 세대수가 행이 아니라 묶음 세대수. `planUnsoldUpdates` 머리말 주석(235~266)에는 "세션635: 분모·추정치는 묶음 단위(`_unsold-bundle.mjs`), 받는 행 전부 같은 값" 한 문단을 더한다.

```js
export function planUnsoldUpdates({ apartments, unsoldByRegionGu, now = new Date() }) {
  // 0단계(세션635) — 행을 같은 단지 묶음으로 접는다. 존중 판정(유효 applyhome·옛 완판)은 행 단위 그대로.
  const isRespected = (/** @type {any} */ apt) =>
    apt.unsold_source !== "hold" && !!apt.region && (!!apt.gu || apt.region === "세종") && shouldSkipKosisFill({ ...apt, units: 2 }, now);
  //   ↑ shouldSkipKosisFill 의 무효 분기(units<=1)를 피하려고 units 를 2 로 넘긴다 — 무효는 아래에서 묶음 세대수로 따로 판정한다.
  const bundles = foldForUnsold(/** @type {any} */ (apartments), { isRespected });
  /** @type {Map<string, import("./_unsold-bundle.mjs").UnsoldBundle>} apt.id → 묶음 */
  const bundleOfApt = new Map();
  for (const b of bundles) for (const m of b.members) bundleOfApt.set(m.id, b);

  // 1단계 — 묶음마다 kosisKey 를 계산하고 분모를 그 키 단위로 모은다(묶음 세대수 D7 을 한 번만 더한다).
  /** @type {Map<string, string | null>} 묶음 key → kosisKey */
  const keyByBundle = new Map();
  /** @type {Record<string, number>} */
  const unitsByKosisKey = {};
  for (const b of bundles) {
    if (!b.region || !b.units) { keyByBundle.set(b.key, null); continue; }
    const kosisKey = resolveKosisGuKey(b.region, b.gu, unsoldByRegionGu[b.region]);
    keyByBundle.set(b.key, kosisKey);
    if (!kosisKey || b.lease) continue;
    const denomKey = `${b.region}::${kosisKey}`;
    unitsByKosisKey[denomKey] = (unitsByKosisKey[denomKey] || 0) + b.units;
  }

  /** @type {ReturnType<typeof planUnsoldUpdates>} */
  const plan = [];

  for (const apt of apartments) {
    const b = /** @type {import("./_unsold-bundle.mjs").UnsoldBundle} */ (bundleOfApt.get(apt.id));
    const kosisKey = keyByBundle.get(b.key) ?? null;
    /** @type {ReturnType<typeof planUnsoldUpdates>[number]} */
    const base = {
      id: apt.id, name: apt.name, region: apt.region, gu: apt.gu,
      action: "skip_invalid",
      kosisKey: null, guUnsold: null, totalUnitsInGu: null,
      newEstimate: null, newRate: null,
      currentUnsold: apt.unsold, currentRate: apt.unsold_rate,
      currentSource: apt.unsold_source ?? null,
      applyhomeExpired: applyhomeStatus(apt, now) === "expired",
      bundleKey: b.key, bundleUnits: b.units, bundleSize: b.members.length,
    };

    // 규칙 0 — 사람 보류(그 행만). 분모(묶음 세대수)에는 이미 들어 있다.
    if (apt.unsold_source === "hold") { plan.push({ ...base, action: "skip_hold", kosisKey }); continue; }

    // 규칙 1 — 무효: 지역·구 없음, 또는 묶음 세대수 재료 없음(구성원 전부 1 이하·(오)뿐).
    const guOkForInvalid = !!apt.gu || apt.region === "세종";
    if (!apt.region || !guOkForInvalid || !b.units || b.units <= 1) { plan.push({ ...base, action: "skip_invalid" }); continue; }

    // 규칙 2 — 임대형(묶음은 임대 여부가 같다 — findMixedBundles 가 섞임을 막는다).
    if (isLeaseUnit(apt)) { plan.push({ ...base, action: "skip_lease" }); continue; }

    // 규칙 3·4 — 존중(유효 applyhome·공고일 없음·옛 완판). 참고 추정치는 묶음 값으로 적는다.
    if (b.respected.includes(apt.id)) {
      const ref = kosisKey ? estimateBundle(b, kosisKey) : null;
      const preservedAction = applyhomeStatus(apt, now) === "no_date" ? "skip_applyhome_no_date" : "skip_preserved";
      plan.push({ ...base, action: preservedAction, kosisKey, newEstimate: ref?.estimated ?? null, newRate: ref?.rate ?? null });
      continue;
    }

    // 규칙 5 — 받는 행. 묶음마다 한 번 계산한 값을 그대로.
    if (!kosisKey) { plan.push({ ...base, action: "skip_no_match" }); continue; }
    const guMap = unsoldByRegionGu[/** @type {string} */ (apt.region)];
    const guUnsold = /** @type {Record<string, number>} */ (guMap)[kosisKey];
    if (guUnsold == null) { plan.push({ ...base, action: "skip_no_match", kosisKey }); continue; }
    if (guUnsold <= 0) { plan.push({ ...base, action: "write_zero", kosisKey, guUnsold, newEstimate: 0, newRate: 0 }); continue; }

    const denomKey = `${apt.region}::${kosisKey}`;
    const totalUnitsInGu = unitsByKosisKey[denomKey] || b.units;
    const result = calcProportionalUnsold(guUnsold, b.units, totalUnitsInGu);
    if (!result) {
      const rawEstimate = totalUnitsInGu > 0 ? Math.round(guUnsold * (b.units / totalUnitsInGu)) : null;
      if (rawEstimate != null && rawEstimate <= 0) { plan.push({ ...base, action: "write_zero", kosisKey, guUnsold, totalUnitsInGu, newEstimate: 0, newRate: 0 }); continue; }
      plan.push({ ...base, action: "skip_no_estimate", kosisKey, guUnsold, totalUnitsInGu });
      continue;
    }
    const { estimated, unsoldRate } = result;
    if (unsoldRate >= UNRELIABLE_RATE_THRESHOLD) {
      plan.push({ ...base, action: "hold_ge50", kosisKey, guUnsold, totalUnitsInGu, newEstimate: estimated, newRate: unsoldRate });
      continue;
    }
    plan.push({ ...base, action: "write", kosisKey, guUnsold, totalUnitsInGu, newEstimate: estimated, newRate: unsoldRate });
  }
  return plan;

  /** 존중 행의 참고 추정치(묶음 값). @param {import("./_unsold-bundle.mjs").UnsoldBundle} b @param {string} kosisKey */
  function estimateBundle(b, kosisKey) {
    const guMap = b.region ? unsoldByRegionGu[b.region] : undefined;
    const guUnsold = guMap ? /** @type {Record<string, number>} */ (guMap)[kosisKey] : undefined;
    if (guUnsold == null || !b.units) return null;
    const total = unitsByKosisKey[`${b.region}::${kosisKey}`] || b.units;
    const r = calcProportionalUnsold(guUnsold, b.units, total);
    return r ? { estimated: r.estimated, rate: r.unsoldRate } : null;
  }
}
```

`planUnsoldUpdates` 의 JSDoc `@returns` 꼴에 `bundleKey: string; bundleUnits: number | null; bundleSize: number` 를 더한다(해당 typedef 를 grep 해 그 자리에).

- [ ] **Step 4: apartments 조회 select 와 로그**

667줄 `select("id, name, region, gu, units, unsold, unsold_rate, naver_sell_count, presale_type, unsold_source, unsold_as_of")` 에 `, complex_key, naver_presale_no, unit_source` 를 더하고, 662줄 `AptRow` typedef 에도 세 칸(`complex_key: string | null; naver_presale_no: string | null; unit_source: string | null`)을 더한다. 681줄 `apartments 계획:` 로그 **바로 뒤**에:

```js
    const fold = summarizeFold(foldForUnsold(/** @type {any} */ (apartmentsTyped), { isRespected: () => false }));
    log(PHASE, `[묶음] 묶음 ${fold.bundles} · 2행+ ${fold.multi} · 받는 행 ${fold.receivers} (존중 판정 전 수)`);
```

`impact-out`(734~739)의 JSON 에 `fold` 를 한 칸 더한다(`regionUpdateCount` 뒤 `fold,`).

- [ ] **Step 5: `unsold_history` 도 묶음 단위로(829~881)**

`unitsByGuForHistory` 를 묶음 세대수로 모으고, 행마다가 아니라 묶음마다 추정해 받는 행 전부에 같은 `unsold_count` 를 넣는다. 기존 블록을 아래로 바꾼다(hold 제외·임대 제외·50% 보류·`todayDate` 는 그대로):

```js
    const allMonthsMap = parseKosisRowsAllMonths(rows);
    // 세션635: 분모·추정치는 묶음 단위(planUnsoldUpdates 와 같은 접기). hold 행은 시계열 행을 만들지 않는다(A7).
    const historyBundles = foldForUnsold(/** @type {any} */ (apartmentsTyped), { isRespected: () => false });
    /** @type {Map<string, string | null>} 묶음 key → kosisKey(월별 맵 기준) */
    const historyKeyByBundle = new Map();
    /** @type {Record<string, number>} */
    const unitsByGuForHistory = {};
    for (const b of historyBundles) {
      if (!b.region || !b.units || b.units <= 1) { historyKeyByBundle.set(b.key, null); continue; }
      const monthMap = allMonthsMap[b.region];
      const kosisKey = monthMap ? resolveKosisGuKey(b.region, b.gu, /** @type {any} */ (monthMap)) : null;
      historyKeyByBundle.set(b.key, kosisKey);
      if (!kosisKey || b.lease) continue;
      const denomKey = `${b.region}::${kosisKey}`;
      unitsByGuForHistory[denomKey] = (unitsByGuForHistory[denomKey] || 0) + b.units;
    }

    /** @type {Array<{ apartment_id: string; base_month: string; unsold_count: number; post_completion_unsold: number | null; change: number | null; recorded_at: string }>} */
    const historyRows = [];
    let heldHistoryCount = 0;
    const todayDate = today();
    let holdHistoryExcluded = 0;
    for (const b of historyBundles) {
      if (!b.region || !b.units || b.units <= 1 || b.lease) continue;
      const monthMap = allMonthsMap[b.region];
      const kosisKey = historyKeyByBundle.get(b.key) ?? null;
      if (!monthMap || !kosisKey) continue;
      const periodMap = /** @type {any} */ (monthMap)[kosisKey];
      if (!periodMap) continue;
      const totalUnitsInGu = unitsByGuForHistory[`${b.region}::${kosisKey}`] || b.units;
      // 받는 행 = hold 가 아닌 구성원 전부(존중 행도 시계열은 KOSIS 계열 그대로 — 지금 설계).
      const targets = b.members.filter((m) => m.unsold_source !== "hold").map((m) => m.id);
      holdHistoryExcluded += b.holds.length;
      for (const [period, guUnsold] of Object.entries(periodMap)) {
        const result = calcProportionalUnsold(/** @type {number} */ (guUnsold), b.units, totalUnitsInGu);
        if (!result) continue;
        if (result.unsoldRate >= UNRELIABLE_RATE_THRESHOLD) { heldHistoryCount += targets.length; continue; }
        for (const apartment_id of targets) {
          historyRows.push({ apartment_id, base_month: period, unsold_count: result.estimated, post_completion_unsold: null, change: null, recorded_at: todayDate });
        }
      }
    }
    if (holdHistoryExcluded > 0) log(PHASE, `unsold_history hold 제외: ${holdHistoryExcluded}건`);
```

`excludeHoldFromHistory` 는 이 블록에서 더 안 부른다 — 그 함수를 쓰는 다른 자리가 없으면(`grep -n excludeHoldFromHistory`) 함수와 그 시험은 **그대로 둔다**(지우지 않는다 — 수술적 변경).

- [ ] **Step 5-2: 승인 계획 파일로만 쓰는 `--apply-from=<impact json>`(맹점 O8 · `data-changing-run-approval` §2 — 행마다 값이 다른 반영은 숫자 하나로 승인하지 않는다)**

`parseExpectZero`(또는 지금 인자 파서 — `grep -n "expect-zero" scripts/collectors/collect-unsold-kosis.mjs` 로 찾는다) 옆에 `--apply-from=<파일>` 을 더한다: DB 를 보기 **전에** 파일을 읽어 `plan` 배열인지 확인 → 이번 계획을 세운 뒤 `comparePlanToApproved(plan, approved)` — 둘 다 `action ∈ {write, write_zero}` 인 행만 뽑아 `id·currentUnsold·newEstimate·newRate·action` 네 값이 **전부 같을 때만** 쓰기로 간다(승인에만 있거나 이번에만 있는 id, 값이 다른 id 는 명단으로 로그). 다르면 **regions·apartments 어느 것도 쓰지 않고** `collector_runs` failure `KOSIS_PLAN_MISMATCH <n>건` + exit 1(0-쓰기 차단기와 같은 자리, `impact-out` 은 그래도 쓴다). `--apply-from` 과 `--expect-zero` 를 같이 주면 던진다(승인 수단은 하나). 순수 함수 `comparePlanToApproved(current, approved) → { same: boolean, onlyCurrent: string[], onlyApproved: string[], changed: Array<{ id, cur, app }> }` export + 시험 3건(같음 · 승인 뒤 값이 바뀐 행 1 · 승인에 없는 행 1) + 변이 1종(`same` 을 `true` 로 고정 → 빨강). `assign-complex-keys.mjs` 의 같은 이름 함수를 베끼되 비교 칸만 바꾼다.

- [ ] **Step 6: 초록 + 정적 가드 + 타입**

Run: `cd <워크트리> && node ../../../node_modules/vitest/vitest.mjs run scripts/collectors/collect-unsold-kosis.test.mjs scripts/collectors/_unsold-bundle.test.mjs scripts/collectors/_graceful-coverage.test.mjs scripts/_selectall-keycol-coverage.test.mjs scripts/_unbounded-query-coverage.test.mjs scripts/collectors/_same-complex.test.mjs > <스크래치>/t2-green.log 2>&1; echo "exit=$?"` → Expected: `exit=0`, `Test Files  6 passed (6)`.
Run: `cd <워크트리> && node ../../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.scripts.json > <스크래치>/t2-tsc.log 2>&1; echo "exit=$?"` → Expected: `exit=0`.
Run: `cd <워크트리> && node scripts/audit-collector-patterns.mjs > <스크래치>/t2-pat.log 2>&1; echo "exit=$?"` → Expected: `exit=0`.

- [ ] **Step 7: 변이 3종(손으로, Task 1 Step 5 와 같은 방식)**

| 변이 | 고치는 곳 | 기대 |
|---|---|---|
| K1 | 1단계 `unitsByKosisKey[denomKey] += b.units` 를 `+= b.members.reduce((s, m) => s + (m.units ?? 0), 0)`(행 합)으로 | "분모는 묶음 세대수 한 번만" 빨강(1000 ≠ 1617) |
| K2 | 규칙 1 의 `b.units` 를 `apt.units` 로 | "회차 행(units 1)… write" 빨강 |
| K3 | `foldForUnsold` 호출의 `isRespected` 를 `() => false` 로 | "유효 applyhome 행은 skip_preserved" 빨강 |

- [ ] **Step 8: 올려 두기**

`<스크래치>/commit-msg-2.txt`:

```
feat(collectors): KOSIS 미분양 배분을 같은 단지 묶음 단위로 (한 단지 = 한 장 나)

- planUnsoldUpdates: 분모 = 묶음 세대수(D7) 합 · 추정치는 묶음마다 한 번 → 받는 행 전부 같은 값
- hold·유효 applyhome·옛 완판은 그 행만 안 받음(사장님 결정 §6-9) · (오) 행은 따로 · 무효는 묶음 세대수로 판정
- unsold_history 도 같은 접기 · 계획 행에 bundleKey/bundleUnits/bundleSize · 로그 [묶음] 한 줄 · impact fold
- --apply-from=<승인한 impact json>: write/write_zero 행의 id·현재값·새값·action 이 전부 같을 때만 씀(KOSIS_PLAN_MISMATCH 면 아무것도 안 씀)
- 시험 9건 추가 + 변이 4종 빨강 · 기존 시험 그대로 초록
```

```bash
cd <워크트리> && git add -- scripts/collectors/collect-unsold-kosis.mjs scripts/collectors/collect-unsold-kosis.test.mjs
```

---

### Task 3: 네이버 총세대수 따라가기 (`naver-presale.mjs`, §4-7 (4) ④)

**Files:**
- Modify: `scripts/collectors/naver-presale.mjs:1020`(select) · `:1233~1235`(enrich 분기) · `AptForMatch` typedef(34)
- Modify: `scripts/collectors/naver-presale.test.mjs`

**Interfaces:**
- Consumes: `isPresaleOwner`(`./_same-complex.mjs`).
- Produces: 기존 행 갱신 경로에서 **번호 주인 행이고 `unit_source === "naver_presale"` 이고 네이버 값이 다르면** 후보로 센다. **쓰기는 `--follow-units` 인자가 있을 때만**(맹점 O9 — 켜는 첫 회차에 몇 행이 움직이는지 모른 채 러너가 승인 없이 쓰면 안 된다, `data-changing-run-approval` §5). 인자가 없으면 로그만: `[세대수 따라감 후보] N건: id 옛→새, …`(최대 20건) + `collector_runs.error_message` 에 `UNITS_FOLLOW_CANDIDATES n`(status 그대로 — 감시가 읽을 수 있게). 인자가 있으면 `update.units = enrich.units` + `update.unit_source = "naver_presale"` 하고 로그 `[세대수 따라감] N건`. **러너(`run-naver-local.bat`)에 인자를 넣는 것은 이 PR 밖** — 첫 월·목 회차의 후보 명단을 메인이 세어 사장님 승인 뒤 별도 한 줄 PR.
- 순수 함수 하나를 빼서 시험한다: `export function unitsFollowUpdate(apt, enrichUnits): { units: number, unit_source: "naver_presale" } | null` — `apt = { id, naver_presale_no, units, unit_source }`.

- [ ] **Step 1: 실패하는 시험**

`naver-presale.test.mjs` 끝에:

```js
import { unitsFollowUpdate } from "./naver-presale.mjs";
describe("unitsFollowUpdate — 번호 주인 행의 네이버 총세대수 따라가기(세션635)", () => {
  it("주인 행 + naver_presale 출처 + 값 다름 → 따라간다", () => {
    expect(unitsFollowUpdate({ id: "ap-1", naver_presale_no: "1", units: 486, unit_source: "naver_presale" }, 638)).toEqual({ units: 638, unit_source: "naver_presale" });
  });
  it("값이 같으면 null", () => {
    expect(unitsFollowUpdate({ id: "ap-1", naver_presale_no: "1", units: 638, unit_source: "naver_presale" }, 638)).toBeNull();
  });
  it("주인이 아닌 행(ah-·남의 번호)은 null — 사람이 옮겨 적은 값·국토부 값을 덮지 않는다", () => {
    expect(unitsFollowUpdate({ id: "ah-7", naver_presale_no: "1", units: 100, unit_source: "naver_presale" }, 638)).toBeNull();
    expect(unitsFollowUpdate({ id: "ap-1", naver_presale_no: "1", units: 100, unit_source: "molit" }, 638)).toBeNull();
  });
  it("네이버 값이 없거나 1 이하면 null", () => {
    expect(unitsFollowUpdate({ id: "ap-1", naver_presale_no: "1", units: 486, unit_source: "naver_presale" }, null)).toBeNull();
    expect(unitsFollowUpdate({ id: "ap-1", naver_presale_no: "1", units: 486, unit_source: "naver_presale" }, 1)).toBeNull();
  });
});
```

- [ ] **Step 2: 빨강** — Run: `cd <워크트리> && node ../../../node_modules/vitest/vitest.mjs run scripts/collectors/naver-presale.test.mjs > <스크래치>/t3-red.log 2>&1; echo "exit=$?"` → `exit=1`(export 없음).

- [ ] **Step 3: 구현**

`naver-presale.mjs` 머리 import 에 `import { isPresaleOwner } from "./_same-complex.mjs";` 를 더하고(이미 `_same-complex` 를 import 하면 그 줄에 추가), `AptForMatch` typedef(34)에 `unit_source: string | null` 을, 1020줄 select 에 `, unit_source` 를 더한다. 순수 함수(파일의 다른 export 함수들 옆에):

```js
/**
 * 번호 주인 네이버 행(`ap-<자기 번호>`)의 총세대수가 네이버 단지 표와 다르면 따라간다(설계서 §4-7 (4) ④, 세션635).
 * 처음 저장 뒤 "빈칸일 때만" 채우던 탓에 네이버가 고쳐도 안 따라가던 것. 주인이 아닌 행·다른 출처(molit 등)는 건드리지 않는다.
 * @param {{ id: string; naver_presale_no: string | null; units: number | null; unit_source: string | null }} apt
 * @param {number | null | undefined} enrichUnits
 * @returns {{ units: number; unit_source: "naver_presale" } | null}
 */
export function unitsFollowUpdate(apt, enrichUnits) {
  if (enrichUnits == null || enrichUnits <= 1) return null;
  if (!isPresaleOwner(apt) || apt.unit_source !== "naver_presale") return null;
  if (apt.units === enrichUnits) return null;
  return { units: enrichUnits, unit_source: "naver_presale" };
}
```

1233~1235 의 `if (!match.apartment.units && enrich.units) update.units = enrich.units;` 를:

```js
        if (!match.apartment.units && enrich.units) update.units = enrich.units;
        else {
          const follow = unitsFollowUpdate(match.apartment, enrich.units);
          if (follow) {
            unitsFollowed.push(`${match.apartment.id} ${match.apartment.units}→${follow.units}`);
            if (FOLLOW_UNITS) Object.assign(update, follow);   // 인자 없으면 후보만 센다(첫 회차 명단 → 승인 → 러너에 인자)
          }
        }
```

파일 머리 인자 파싱 옆에 `const FOLLOW_UNITS = process.argv.includes("--follow-units");`(이 파일의 다른 인자 파싱 꼴을 따른다 — `grep -n "process.argv" scripts/collectors/naver-presale.mjs`). 루프 **앞**(그 for 문 바로 위)에 `/** @type {string[]} */ const unitsFollowed = [];`, 루프 **뒤** 요약 로그 자리에 `if (unitsFollowed.length > 0) log(PHASE, `[세대수 따라감${FOLLOW_UNITS ? "" : " 후보"}] ${unitsFollowed.length}건: ${unitsFollowed.slice(0, 20).join(", ")}${unitsFollowed.length > 20 ? " …" : ""}`);`. `recordCollectorRun` 호출(마지막 `finally` — Grep)에 인자 없이 후보가 1건 이상이면 `errorMessage` 에 `UNITS_FOLLOW_CANDIDATES ${n}` 을 이어 붙인다(이 파일이 이미 쓰는 `joinRunMessage` 꼴이 있으면 그것으로 — `collect-unsold-kosis.mjs:904` 참고). 시험 1건 추가: 인자 없이 후보 1건이면 `update` 에 `units` 가 없고, `--follow-units` 면 있다(순수 함수 `applyUnitsFollow(update, apt, enrichUnits, followOn)` 로 빼서 시험하거나, 위 분기를 그 함수로 감싼다).

- [ ] **Step 4: 초록 + 타입 + 수집기 계약**

Run: `cd <워크트리> && node ../../../node_modules/vitest/vitest.mjs run scripts/collectors/naver-presale.test.mjs > <스크래치>/t3-green.log 2>&1; echo "exit=$?"` → `exit=0`.
Run: `cd <워크트리> && node ../../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.scripts.json > <스크래치>/t3-tsc.log 2>&1; echo "exit=$?"` → `exit=0`.
Run: `cd <워크트리> && node scripts/audit-collector-patterns.mjs > <스크래치>/t3-pat.log 2>&1; echo "exit=$?"` → `exit=0`.

- [ ] **Step 5: 변이 2종** — N1 `!isPresaleOwner(apt) ||` 삭제 → "주인이 아닌 행" 빨강 · N2 `apt.units === enrichUnits` 를 `false` 로 → "값이 같으면 null" 빨강. 되돌림 확인.

- [ ] **Step 6: 올려 두기**

`<스크래치>/commit-msg-3.txt`:

```
feat(collectors): 번호 주인 네이버 행의 총세대수가 바뀌면 따라간다 (한 단지 = 한 장 나)

- unitsFollowUpdate: ap-<자기 번호> + unit_source naver_presale + 값 다름 → units 갱신(그 밖은 그대로)
- 쓰기는 --follow-units 일 때만(없으면 후보 로그 + UNITS_FOLLOW_CANDIDATES 표식) · select 에 unit_source · 시험 5건 + 변이 2종
```

```bash
cd <워크트리> && git add -- scripts/collectors/naver-presale.mjs scripts/collectors/naver-presale.test.mjs
```

---

### Task 4: PR-나 문서 + 전체 시험

**Files:**
- Modify: `scripts/CLAUDE.md`(세션 줄 하나) · `.claude/rules/scripts/units-correction.md`(따라가기 한 줄) · `.claude/BACKLOG.md` A-14(나) 진행 줄) · 설계서 §5-4 나) 에 `(PR-나 …)`

- [ ] **Step 1: 문서 한 줄씩** — `scripts/CLAUDE.md` "권한 지문 도구 · 감시 번호" 절 끝에: `- 세션635: `collect-unsold-kosis.mjs` 는 **같은 단지 묶음 단위**로 분모·추정치를 낸다(`_unsold-bundle.mjs` `foldForUnsold` — 묶음 세대수 = `pickBundleUnits`(D7), hold·유효 applyhome·옛 완판은 그 행만 안 받고 형제는 묶음 값, `(오)` 행은 따로). 계획 행 `bundleKey/bundleUnits/bundleSize`, 로그 `[묶음]`. `naver-presale.mjs` 는 번호 주인 행의 총세대수가 네이버와 다르면 따라간다(`unitsFollowUpdate`).` — 다른 두 문서도 같은 뜻 한 줄.
- [ ] **Step 2: 전체 시험 1회(구현자 마지막 — 공용 수집기 변경)** — Run: `cd <워크트리> && npm run test > <스크래치>/t4-all.log 2>&1; echo "exit=$?"` → `exit=0`. 01:30~06:30 이면 돌리지 말고 메인에 보고.
- [ ] **Step 3: 올려 두기** — `<스크래치>/commit-msg-4.txt`: `docs: 한 단지 = 한 장 나) 묶음 배분·세대수 따라가기 문서 한 줄씩`. `git add -- scripts/CLAUDE.md .claude/rules/scripts/units-correction.md .claude/BACKLOG.md docs/superpowers/specs/2026-10-01-one-complex-one-card.md`.

### 운영 단계 A — PR-나 CI 초록·검사 뒤, **합치기 전**(메인이 한다 · `data-changing-run-approval`). 미리보기는 PR-나 워크트리 코드로 돌린다(env 는 본 폴더 `.env.local` 절대경로 — A-5).

A-1. **전이표 재료**(시각 창 밖, 네트워크 = KOSIS 1콜 × 2): main 이전 커밋(워크트리)과 PR-나 판으로 각각 `node scripts/collectors/collect-unsold-kosis.mjs --dry-run --impact-out=.omc/artifacts/session63x/unsold-before.json`(옛 판) · `…-after.json`(새 판) → `node scripts/compare-unsold-impact.mjs before after --out=…/unsold-transition.json`. 전이표 = 값→다른 값 / 값>0→0 / 빈칸→값 / 변화 없음 + 손님 화면에 닿는 수(기본 목록 증감·점수 등급 바뀌는 카드 수는 굽기 전이라 "다음 굽기 뒤 재측정") + 2행+ 묶음에서 구성원 값이 같아지는 수(기대 389묶음) + hold 6묶음 표(형제가 받는 값) + 0-쓰기 차단기 수치.
A-2. **검사관 2인**(적대 Opus + 맹점 Opus, `reviewer-brief.md`)이 전이표·hold 6묶음 명단을 반영 **전에** 본다.
A-3. **사장님 승인**(AskUserQuestion — 전이표 숫자 + hold 6묶음 표 + "다)와 같은 창에서 반영"). 승인한 것 = **계획 파일**(A-1 의 `unsold-after.json` — 행마다 값이 다른 반영이라 숫자 하나로는 부족, `data-changing-run-approval` §2) + 값>0→0 행 수.
A-4. **실행(운영 단계 B-4 의 창 안에서, VIEW 적용 직전)**: ⓪ 되돌림 사본 — 실행 직전 `apartments` 의 `id, unsold, unsold_rate, unsold_source, unsold_as_of, updated_at` 전 행과 `unsold_history` 의 최근 3개월 행을 파일로(`.omc/artifacts/session63x/unsold-before-apply.json` · `history-before-apply.json`, 읽기 전용 탐침 — impact 는 의도이지 DB 상태가 아니다, 규칙 §3) ① A-1 의 `--dry-run` 을 **같은 창에서 한 번 더** 떠서 승인 파일과 `id·currentUnsold·newEstimate·action` 이 전부 같은지 대조(사이에 월·목 러너의 세대수 따라가기가 분모를 바꿨을 수 있다 — 다르면 멈추고 전이표 다시) ② `node scripts/collectors/collect-unsold-kosis.mjs --apply-from=<승인 파일> --impact-out=…/unsold-applied.json > …/unsold-apply.log 2>&1`(Task 2 Step 5-2 의 인자 — 파이프 금지) ③ 전후 행 수·`collector_runs` 1행·`[묶음]` 로그·`KOSIS_PLAN_MISMATCH` 없음 확인 · `unsold-applied.json` 과 승인 파일을 `id·action·newEstimate` 로 맞대 차이 0(맹점 O8). 되돌림 = ⓪ 사본으로 `backfill-unsold-source.mjs --plan=`(expect = 새 값 → set = 옛 값) + history 는 사본 재적재(`upsertBatch("unsold_history", 사본, "apartment_id,base_month")` 한 줄짜리 일회성 스크립트 — A-1 때 미리 만들어 둔다).
A-5. (삭제 — "다음 날 확인"은 없다. 나)와 다)는 같은 창에서 이어진다.) 미리보기는 **본 폴더가 아니라 워크트리 코드**로 돌리되 env 는 본 폴더 것을 절대경로로 준다: `node --env-file=F:/mibunyang/.env.local <워크트리>/scripts/collectors/collect-unsold-kosis.mjs --dry-run --impact-out=…`(워크트리엔 `.env.local` 이 없다).

---

## Part 다) — PR-다: 화면 전환 (VIEW 조합 · 옛 id 넘김 · 시계열 한 달 한 값)

> PR-다 는 운영 단계 A(나) 반영)가 끝난 뒤 연다. 코드는 **VIEW 적용 전에 합쳐도 화면이 지금과 같게**(memberIds 없으면 옛 규칙) 쓴다 — VIEW 적용(운영 단계 B)이 스위치다.

### Task 5: 카드 제목 떼기 `_card-title.mjs` + 픽스처

**Files:**
- Create: `scripts/collectors/_card-title.mjs`
- Create: `scripts/collectors/_card-title.test.mjs`
- Create: `docs/audits/card-title-paren-fixture.json` — 10/13 운영 DB 대표 이름의 괄호 문구 전수(`probe-nada.json` 의 `parenCounts` 열쇠 — 메인이 워크트리에 미리 복사해 둔다: `<워크트리>/docs/audits/card-title-paren-input.json`) 를 `strip`/`keep` 으로 분류한 것.

**Interfaces:**
- Produces:
  - `NOTICE_WORD_RE: RegExp` — JS 쪽 괄호 판정(한 괄호의 **안쪽 글자**에 적용).
  - `NOTICE_PAREN_SQL: string` — Postgres `regexp_replace(name, NOTICE_PAREN_SQL, '', 'g')` 에 넣을 패턴 문자열(괄호 포함). JS `NOTICE_WORD_RE` 와 같은 뜻 — 시험이 둘을 **같은 픽스처**로 맞춘다(SQL 은 Postgres 가 없어 JS 로 패턴을 흉내 내지 않고, 운영 리허설 B-1 의 결과 파일과 맞댄다).
  - `stripNoticeWords(name: unknown): string` — 떼기 대상 괄호를 전부 지우고 앞뒤·이중 공백을 정리. 괄호가 없거나 뗄 것이 없으면 원문 그대로(공백도 안 건드린다 — 혼자인 행 무변경).
  - `isNoticeParen(inner: string): boolean` — 픽스처 시험·`DetailModal` 설명용.

떼기 규칙(사장님 결정 §6-10 — 낱말은 **이 목록이 정본**, 늘릴 땐 픽스처부터):
- 회차: `N차` · `N회차` · `N회` · `무순위[ N차]` · `임의공급[ N차]` · `사후[ N차]` · `추가[모집]` · `잔여[세대]` · `선착순` · `계약취소주택` · `취소후 재공급` · `조합원 취소분` · `불법행위 재공급` · `재공급`.
- 안내문: 괄호 안에 `청약` · `문의` · `재당첨` · `거주자` · `무주택` · `세대구성원` 중 하나라도 들어 있으면.
- 남기는 것(떼지 않는다): 블록(`A4BL`·`A-16`·`C-4BL`·`36BL`) · `N단지` · `주상복합` · `장기전세` · `나눔형` · `공공분양` · `국민`·`민영` · 지명(`의정부`) · `(오)` · 그 밖 전부.

- [ ] **Step 1: 픽스처를 만든다(메인이 둔 입력 파일에서)**

`<워크트리>/docs/audits/card-title-paren-input.json` 은 `{ "<괄호 안 글자>": <개수>, … }` 꼴이다. 작업반은 이걸 읽어 아래 규칙으로 `strip`/`keep` 을 **손으로** 적는다(자동 분류 금지 — 픽스처가 규칙의 정본이므로 사람이 한 번 본다). 결과 `docs/audits/card-title-paren-fixture.json`:

```json
{
  "measured_at": "2026-10-13",
  "source": "운영 DB apartments 대표 이름의 괄호 문구 전수(probe-nada.json parenCounts) — 사장님 결정 2026-10-13 §6-10",
  "strip": ["1차", "임의공급 1차", "무순위 1차", "계약취소주택", "조합원 취소분", "사후", "2차", "임의공급1차", "임의공급", "무순위1차", "사후1차", "임의공급 2차", "2회차", "취소후 재공급", "세종거주, 무주택세대구성원만 해당"],
  "keep": ["오", "주상복합", "장기전세", "나눔형", "2단지", "A4BL", "A7BL", "공공분양", "A1BL", "A2BL", "1단지", "A36BL", "의정부", "A6BL", "B-6BL", "국민", "민영주택"]
}
```

(위는 꼴 예시 — 실제 파일은 입력 파일의 **모든** 열쇠를 둘 중 하나에 넣는다. 둘 다에 없거나 둘 다에 있는 열쇠가 있으면 시험이 떨어진다.)

- [ ] **Step 2: 실패하는 시험**

`scripts/collectors/_card-title.test.mjs`:

```js
// @ts-check
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { stripNoticeWords, isNoticeParen, NOTICE_PAREN_SQL, NOTICE_WORD_RE } from "./_card-title.mjs";

const fx = JSON.parse(readFileSync(new URL("../../docs/audits/card-title-paren-fixture.json", import.meta.url), "utf8"));
const input = JSON.parse(readFileSync(new URL("../../docs/audits/card-title-paren-input.json", import.meta.url), "utf8"));

describe("픽스처 자체", () => {
  it("입력의 모든 괄호 문구가 strip/keep 정확히 한쪽에 있다", () => {
    const strip = new Set(fx.strip), keep = new Set(fx.keep);
    for (const k of Object.keys(input)) expect(strip.has(k) !== keep.has(k), k).toBe(true);
  });
});
describe("isNoticeParen — 픽스처 전수", () => {
  it("strip 은 전부 true", () => { for (const s of fx.strip) expect(isNoticeParen(s), s).toBe(true); });
  it("keep 은 전부 false", () => { for (const s of fx.keep) expect(isNoticeParen(s), s).toBe(false); });
});
describe("stripNoticeWords", () => {
  it("회차 괄호를 떼고 공백을 정리한다", () => {
    expect(stripNoticeWords("올림픽파크 포레온(무순위 2차)")).toBe("올림픽파크 포레온");
    expect(stripNoticeWords("천왕역 모아엘가 트레뷰 (9차)")).toBe("천왕역 모아엘가 트레뷰");
    expect(stripNoticeWords("이안 시그니처 역곡(임의공급 4차)")).toBe("이안 시그니처 역곡");
  });
  it("이중 괄호(회차 + 안내문)를 둘 다 뗀다", () => {
    expect(stripNoticeWords("천왕역 모아엘가 트레뷰(2차)(청약전 반드시 대표전화 문의, 재당첨제한 10년, 서울거주자/무주택세대구성원만 해당)")).toBe("천왕역 모아엘가 트레뷰");
  });
  it("블록·단지·유형·(오)는 남긴다", () => {
    expect(stripNoticeWords("고양덕은 DMC리버파크자이(A4BL)")).toBe("고양덕은 DMC리버파크자이(A4BL)");
    expect(stripNoticeWords("수원 아이파크 시티 10단지(2차)(재당첨제한 10년 / 수원시거주, 무주택세대구성원만 가능)")).toBe("수원 아이파크 시티 10단지");
    expect(stripNoticeWords("송도 그란테르(오)")).toBe("송도 그란테르(오)");
    expect(stripNoticeWords("영통 푸르지오 파인베르(A2BL)(불법행위 재공급)")).toBe("영통 푸르지오 파인베르(A2BL)");
  });
  it("뗄 것이 없으면 원문 그대로(공백 포함)", () => {
    expect(stripNoticeWords("문수로 푸르지오 어반피스")).toBe("문수로 푸르지오 어반피스");
    expect(stripNoticeWords("  앞뒤 공백  ")).toBe("  앞뒤 공백  ");
    expect(stripNoticeWords(null)).toBe("");
  });
  it("가운데 괄호를 떼도 좌우가 붙지 않는다", () => {
    expect(stripNoticeWords("A(1차) B")).toBe("A B");
  });
});
describe("SQL 패턴은 JS 패턴과 같은 낱말로 조립된다", () => {
  it("JS 정규식 소스의 낱말이 SQL 문자열에 전부 들어 있다", () => {
    for (const w of ["무순위", "임의공급", "사후", "계약취소주택", "취소후", "조합원", "불법행위", "재공급", "선착순", "청약", "문의", "재당첨", "거주자", "무주택", "세대구성원"]) {
      expect(NOTICE_WORD_RE.source.includes(w), w).toBe(true);
      expect(NOTICE_PAREN_SQL.includes(w), w).toBe(true);
    }
  });
  it("SQL 패턴을 JS 정규식으로 그대로 돌려도(ARE 와 JS 가 공유하는 문법만 썼다) 픽스처 전수가 같은 판정이다 — 괄호째 매치 여부 = isNoticeParen", () => {
    const re = new RegExp(NOTICE_PAREN_SQL, "u");
    for (const s of [...fx.strip, ...fx.keep]) expect(re.test(`(${s})`), s).toBe(fx.strip.includes(s));
  });
  it("빈 괄호·공백만 든 괄호는 SQL 패턴도 안 뗀다", () => {
    const re = new RegExp(NOTICE_PAREN_SQL, "u");
    expect(re.test("()")).toBe(false);
    expect(re.test("( )")).toBe(false);
  });
});
```

- [ ] **Step 3: 빨강** — Run: `cd <워크트리> && node ../../../node_modules/vitest/vitest.mjs run scripts/collectors/_card-title.test.mjs > <스크래치>/t5-red.log 2>&1; echo "exit=$?"` → `exit=1`.

- [ ] **Step 4: 모듈**

`scripts/collectors/_card-title.mjs`:

```js
// @ts-check
/**
 * 카드 제목에서 회차·안내 문구 괄호 떼기 — "한 단지 = 한 장" 다)(사장님 결정 2026-10-13 §6-10).
 *
 * 카드가 단지를 뜻하므로 "(무순위 2차)"·"(청약전 반드시 대표전화 문의…)" 는 제목에서 뗀다. 블록(A4BL)·N단지·
 * 주상복합·장기전세·나눔형·공공분양·(오) 는 단지를 가르는 글자라 남긴다. **낱말 목록의 정본은 픽스처**
 * `docs/audits/card-title-paren-fixture.json` 이고, VIEW(SQL) 는 `NOTICE_PAREN_SQL` 로 같은 규칙을 쓴다 —
 * 두 쪽을 함께 고치고, 운영 리허설에서 VIEW 의 name 과 이 함수 결과를 전 행 맞댄다.
 *
 * ⚠️ 이 모듈은 묶음 열쇠(`_same-complex.mjs`)와 무관하다 — 열쇠는 `stripRoundWords` 를 쓰고, 여기는 **표시용**이다.
 */

/** 괄호 안쪽 글자에 적용 — 회차 꼴(낱말 또는 숫자+차가 **하나는** 있어야 한다 — 빈 괄호·공백만은 아님) 또는 안내문 낱말. */
export const ROUND_WORDS = "무순위|임의공급|사후|추가(?:모집)?|잔여(?:세대)?|선착순";
export const NOTICE_WORDS = "계약취소주택|취소후\\s*재공급|조합원\\s*취소분|불법행위\\s*재공급|재공급|청약|문의|재당첨|거주자|무주택|세대구성원";
const ROUND_FORM = `(?:(?:${ROUND_WORDS})\\s*(?:\\d+\\s*(?:차|회차|회))?|\\d+\\s*(?:차|회차|회))`;
export const NOTICE_WORD_RE = new RegExp(`^\\s*${ROUND_FORM}\\s*$|${NOTICE_WORDS}`);

/** Postgres ARE — `name ~ 패턴` 과 `regexp_replace(name, 패턴, ' ', 'g')` 에 쓴다(괄호째). 위 JS 와 **같은 낱말 문자열**로 조립한다. */
export const NOTICE_PAREN_SQL = `\\((?:\\s*${ROUND_FORM}\\s*|[^()]*(?:${NOTICE_WORDS})[^()]*)\\)`;

/** @param {string} inner 괄호 안쪽 글자 */
export function isNoticeParen(inner) {
  const s = inner.trim();
  if (s === "") return false; // 빈 괄호는 건드리지 않는다
  return NOTICE_WORD_RE.test(s);
}

/** @param {unknown} name */
export function stripNoticeWords(name) {
  const src = String(name ?? "");
  if (!src.includes("(")) return src;
  let changed = false;
  const out = src.replace(/\s*\(([^()]*)\)/g, (whole, inner) => {
    if (!isNoticeParen(String(inner))) return whole;
    changed = true;
    return " ";
  });
  if (!changed) return src;
  return out.replace(/\s{2,}/g, " ").trim();
}
```

주의: `A(1차) B` → `A B`(괄호 자리에 공백 하나 → 겹공백 하나로 → 앞뒤 제거 — SQL 의 `regexp_replace(…, ' ', 'g')` → `\s{2,}` → `btrim` 세 단계와 같다). JS `NOTICE_WORD_RE` 의 첫 묶음은 "회차 꼴 전체 일치"(낱말이나 숫자+차 중 하나는 있어야 — 빈 괄호 `()`·공백만은 안 뗀다), 뒤 낱말들은 "포함"이다 — `(2단지)` 는 숫자+`단지` 라 회차 꼴이 아니고 낱말도 없어 keep. **같은 낱말 문자열(`ROUND_WORDS`·`NOTICE_WORDS`)로 JS·SQL 패턴을 조립**하므로 낱말을 더하면 둘이 함께 바뀐다.

- [ ] **Step 5: 초록 + 타입** — 위 시험 `exit=0` · `tsc -p tsconfig.scripts.json` `exit=0` · `node scripts/audit-declared-deps.mjs` `exit=0`.

- [ ] **Step 6: 변이 3종** — T1 `재당첨` 낱말을 JS 에서만 삭제 → "SQL 패턴 … 전부" 빨강 · T2 `if (s === "") return false` 삭제 → 시험에 `expect(isNoticeParen("")).toBe(false)` 를 더한 뒤 빨강 확인(시험 추가는 유지) · T3 `.trim()` 삭제 → "회차 괄호를 떼고 공백" 빨강.

- [ ] **Step 7: 올려 두기** — `<스크래치>/commit-msg-5.txt`: `feat(collectors): _card-title — 카드 제목 회차·안내문 괄호 떼기(JS + SQL 패턴 한 벌) + 운영 괄호 문구 전수 픽스처 (한 단지 = 한 장 다)`. `git add -- scripts/collectors/_card-title.mjs scripts/collectors/_card-title.test.mjs docs/audits/card-title-paren-fixture.json docs/audits/card-title-paren-input.json`.

---

### Task 6: VIEW `apartments_flat` 묶음 조합 마이그레이션 + 되돌리기 + 리허설

**Files:**
- Create: `supabase/migrations/20261013000000_view_one_card_bundle.sql`
- Create: `supabase/migrations/_rollbacks/20261013000001_rollback_view_one_card_bundle.sql` — **`CREATE OR REPLACE VIEW` 는 칸을 못 뺀다(42P16)** → 기존 되돌리기 `_rollbacks/20261007000001_rollback_view_add_trade_scope.sql` 과 같은 꼴: 머리 주석(권한을 먼저 적어 두는 SELECT 안내) · `BEGIN;` · `DROP VIEW IF EXISTS apartments_flat;` · `20261007000000_view_add_trade_scope.sql` 의 `CREATE OR REPLACE VIEW … ;` 본문 글자 그대로 · 권한 재부여 안내 줄(`GRANT SELECT ON apartments_flat TO <grantee>;` — 적어 둔 목록대로) · `COMMIT;` · `NOTIFY pgrst, 'reload schema';`. DROP 이 GRANT 를 같이 지우므로 되돌린 뒤 권한 지문(`scripts/perm-baseline.mjs`·감시 ⑩)이 같아야 한다.
- Create: `supabase/migrations/_rehearsal/20261013_one_card_rehearsal_view.sql` · `_rehearsal/20261013_one_card_rehearsal_drop.sql`(별도 이름 VIEW 로 리허설 — 운영 VIEW 를 잠그지 않는다)
- Test: `scripts/_view-one-card-sql.test.mjs`(정적 가드 — SQL 글자 검사)

**Interfaces:**
- Produces(VIEW 새 칸 **5개**, SELECT 맨 끝 순서 고정): `"complexKey" text` · `"memberIds" text[]`(id 오름차순 `COLLATE "C"`, `(오)` 행 제외, 비면 대표 id 하나 — 시계열·재공고·곧분양용) · `"materialId" text` · `"noticeName" text`(대표 행 원래 이름) · `"aliasIds" text[]`(구성원 전부, `(오)` 포함 — 옛 id 넘김표용). 기존 칸 의미 변경: `id`·`name`(떼기 적용)·`catsCache`·`scoresComputedAt` = 대표 행 / 물리 칸·파생표 JOIN·가격 = 재료 행 / `units` = D7 / `unsold`·`unsoldRate` = 묶음 미분양 / `competitionRate`·`competitionSupply`·`competitionApplicants`·`announcementUrl` = 값 있는 청약홈 구성원 중 id 큰 행 / `unsoldEventCount` = 구성원 합 / `lastUnsoldEventAt` = 구성원 최댓값. 혼자인 행은 전부 자기 값(출력 무변경, name 만 예외).

- [ ] **Step 1: 정적 가드 시험을 먼저(SQL 파일이 지켜야 할 글자)**

`scripts/_view-one-card-sql.test.mjs`:

```js
// @ts-check
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { NOTICE_PAREN_SQL } from "./collectors/_card-title.mjs";
// 이 PC 의 옛 마이그 파일은 CRLF(autocrlf) — 줄바꿈을 LF 로 맞춰 읽는다(재검사 후속 1: 안 맞추면 로컬만 빨강, CI 는 초록)
const readLf = (/** @type {string} */ p) => readFileSync(new URL(p, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const sql = readLf("../supabase/migrations/20261013000000_view_one_card_bundle.sql");
const prev = readLf("../supabase/migrations/20261007000000_view_add_trade_scope.sql");
const rollback = readLf("../supabase/migrations/_rollbacks/20261013000001_rollback_view_one_card_bundle.sql");
/** SELECT 의 출력 칸 이름을 순서대로 — `… AS "별칭"` 이면 별칭(따옴표 뗌), 별칭 없는 `a.col,` 꼴이면 점 뒤 이름. 주석 줄·CTE 안은 안 센다(마지막 SELECT 부터 FROM 까지만). */
function selectCols(/** @type {string} */ s) {
  const start = s.lastIndexOf("\nSELECT\n"), end = s.indexOf("\nFROM deduped a", start);
  const out = [];
  for (const raw of s.slice(start, end).split("\n")) {
    const line = raw.replace(/--.*$/, "").trim().replace(/,$/, "");
    if (!line || line === "SELECT") continue;
    const as = /\s+AS\s+"?(\w+)"?$/.exec(line);
    if (as) { out.push(as[1]); continue; }
    for (const bare of line.split(",").map((t) => t.trim()).filter(Boolean)) {
      const m = /^[a-z]+\.(\w+)$/.exec(bare);
      if (m) out.push(m[1]);
    }
  }
  return out;
}

describe("20261013 VIEW 마이그 — 글자 가드", () => {
  it("security_invoker 를 CREATE 에 직접 명시", () => { expect(sql).toMatch(/CREATE OR REPLACE VIEW apartments_flat WITH \(security_invoker = on\) AS/); });
  it("새 칸 5개가 SELECT 맨 끝에 이 순서로", () => {
    const cols = selectCols(sql);
    expect(cols.slice(-5)).toEqual(["complexKey", "memberIds", "materialId", "noticeName", "aliasIds"]);
  });
  it("20261007 판의 칸 이름·순서가 앞부분에 그대로(42P16 방지) — 별칭 없던 칸(id·units·unsold 등)이 새 판에서 별칭을 얻어도 출력 이름은 같다", () => {
    const before = selectCols(prev);
    const after = selectCols(sql);
    expect(before.length).toBeGreaterThan(100); // 추출기가 실제로 세고 있다(빈 배열끼리 같다는 거짓 초록 방지)
    expect(after.slice(0, before.length)).toEqual(before);
  });
  it("name 떼기 패턴은 _card-title.mjs 의 SQL 패턴과 글자 그대로 같다", () => { expect(sql.includes(NOTICE_PAREN_SQL)).toBe(true); });
  it("오늘은 KST 로 센다", () => { expect(sql).toMatch(/now\(\) AT TIME ZONE 'Asia\/Seoul'/); });
  it("되돌리기 파일은 DROP VIEW 뒤 20261007 판 VIEW 본문을 한 트랜잭션으로 다시 만든다(CREATE OR REPLACE 는 칸을 못 뺀다)", () => {
    expect(rollback).toMatch(/BEGIN;\s*DROP VIEW IF EXISTS apartments_flat;\s*CREATE OR REPLACE VIEW apartments_flat WITH \(security_invoker = on\) AS/);
    expect(rollback).toMatch(/COMMIT;/);
    expect(rollback).toMatch(/GRANT SELECT ON apartments_flat TO/);
    const body = (/** @type {string} */ s) => s.slice(s.indexOf("CREATE OR REPLACE VIEW"), s.indexOf("COMMIT;") > 0 ? s.indexOf("COMMIT;") : s.indexOf("NOTIFY pgrst")).replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();
    const prevBody = prev.slice(prev.indexOf("CREATE OR REPLACE VIEW"), prev.indexOf("NOTIFY pgrst")).replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();
    expect(body(rollback).startsWith(prevBody)).toBe(true); // 본문 뒤에 GRANT 줄만 더 붙는다
  });
  it("마지막은 NOTIFY pgrst", () => { expect(sql.trim().endsWith("NOTIFY pgrst, 'reload schema';")).toBe(true); });
});
```

`selectCols` 는 별칭 있는 칸·없는 칸을 모두 출력 이름으로 센다(맹점 O4 — 옛 판의 `a.units,` 가 새 판에서 `CASE … END AS units` 가 되어도 같은 이름). 여러 줄 CASE 식은 `END AS "x"` 가 있는 마지막 줄에서 잡히고 앞 줄은 `a.col` 꼴이 아니라 무시된다. 리허설(B-1)의 `information_schema.columns` 순서 대조가 최종 가드다.

**새 SQL 에서 20261007 판과 글자가 달라지는 SELECT 줄은 아래 열거한 것뿐**(맹점 O5 — 옛 줄 번호 기준, 그 밖의 SELECT 줄은 글자 그대로 복사):

| 옛 줄 | 옛 글자 | 새 글자 |
|---|---|---|
| 97 | `a.id,` | `a.rep_id AS id,` |
| 98 | `a.name,` | 제목 떼기 `CASE … END AS name,`(위) |
| 105 | `a.units,` | `CASE WHEN a.member_count >= 2 THEN a.b_units ELSE a.units END AS units,` |
| 106 | `a.unsold,` | `CASE WHEN a.member_count >= 2 THEN a.b_unsold ELSE a.unsold END AS unsold,` |
| 107~109 | `unsoldRate` CASE | 묶음이면 `b_unsold ÷ b_units`, 혼자면 옛 식(위) |
| 123 | `a.announcement_url AS "announcementUrl",` | `CASE WHEN a.member_count >= 2 THEN a.b_announcement_url ELSE a.announcement_url END AS "announcementUrl",` |
| 134 | `a.cats_cache AS "catsCache",` | `a.rep_cats_cache AS "catsCache",` |
| 135 | `a.scores_computed_at AS "scoresComputedAt",` | `a.rep_scores_computed_at AS "scoresComputedAt",` |
| 136~138 | 경쟁률 3칸 | `CASE WHEN a.member_count >= 2 THEN a.b_competition_* ELSE a.competition_* END AS …`(3줄) |
| 283 | `(CASE WHEN a.units > 1 THEN 10 ELSE 0 END)` | `(CASE WHEN (CASE WHEN a.member_count >= 2 THEN a.b_units ELSE a.units END) > 1 THEN 10 ELSE 0 END)` |
| 322 끝 | `ts.complex_jeonse_table AS "complexJeonseTable"` | 뒤에 `,` 와 새 칸 5줄 |
| 323~349 | FROM/JOIN | `FROM deduped a` · `LEFT JOIN latest_prices p ON p.bkey = a.bkey` · `ae`·`pso` 서브쿼리를 구성원 묶음 합·최댓값으로(위) · 나머지 JOIN 글자 그대로 |

CTE 는 47~60(`dedup_ranked`·`deduped`)이 위의 `members`~`deduped` 로, 61~68(`latest_prices`)이 위의 묶음판으로 바뀌고, `latest_regions`·`latest_regions_gu`(69~95)는 글자 그대로.

- [ ] **Step 2: 마이그레이션 SQL**

`supabase/migrations/20261013000000_view_one_card_bundle.sql` — 머리 주석(왜·무엇·되돌리기·리허설 경로) 뒤 본문. 20261007 판을 베이스로 **아래만 바꾼다**: ① `dedup_ranked/deduped` CTE 를 `members/bundle_rep/bundle_mat/bundle_units/bundle_unsold/bundle_ah/bundle_agg/deduped` 로 ② SELECT 의 `a.id`·`a.name`·`a.units`·`a.unsold`·`unsoldRate`·`catsCache`·`scoresComputedAt`·경쟁률 3칸·`announcementUrl`·`unsoldEventCount`·`lastUnsoldEventAt` 의 출처 ③ 맨 끝 새 칸 5개 ④ `ae`·`pso` 서브쿼리를 구성원 합·최댓값으로. 나머지 칸·JOIN 문장은 글자 그대로 둔다(`a` 가 재료 행이 되므로 JOIN 은 자동으로 재료 행을 따른다).

```sql
-- 20261013000000 — "한 단지 = 한 장" 다): apartments_flat 이 같은 단지 묶음(complex_key)을 한 장으로 낸다.
--   대표 행(id·name·점수) = (오) 뒤로 → 청약홈 먼저 → id 오름차순(D11)
--   재료 행(좌표·건물·파생표·가격) = (오) 뒤로 → 번호 주인 네이버 행(최저가 낮은 것 → id 작은 것) → 청약홈 id 내림차순 → 나머지 id 내림차순
--   세대수 = D7(naver_presale 주인 > naver > molit > applyhome > 빈 출처, (오)·1 이하 제외, 같은 순위면 큰 값)
--   미분양 = 유효 청약홈 실측(공고일+6개월, KST) → 값 있는 행(재료 먼저, id 내림차순) → 전부 hold 면 NULL(사장님 결정 2026-10-13 §6-9)
--   name = 회차·안내문 괄호 떼기(scripts/collectors/_card-title.mjs NOTICE_PAREN_SQL 과 글자 동일 — 사장님 결정 §6-10)
--   새 칸 5개(맨 끝): complexKey · memberIds(text[], (오) 제외, 비면 대표 id) · materialId · noticeName(대표 행 원래 이름) · aliasIds(text[], 구성원 전부 — 옛 id 넘김용)
--   혼자인 행은 전부 자기 값 — 출력 무변경(설계서 §4-7 (9)), name 만 예외.
--   되돌리기 = _rollbacks/20261013000001(DROP + 재생성 + GRANT) · 리허설 = _rehearsal/20261013_one_card_rehearsal_view.sql(별도 이름 VIEW) + node 전수 대조
--   ⚠️ CREATE OR REPLACE VIEW 는 기존 칸 순서·이름을 못 바꾼다(42P16) — 새 칸은 맨 끝에만.
CREATE OR REPLACE VIEW apartments_flat WITH (security_invoker = on) AS
WITH members AS (
  SELECT *,
    COALESCE(complex_key, id)                      AS bkey,
    (COALESCE(name, '') LIKE '%(오)%')              AS is_off,
    (id LIKE 'ah-%')                               AS is_ah,
    (naver_presale_no IS NOT NULL AND id = 'ap-' || naver_presale_no) AS is_owner
  FROM apartments
),
bundle_rep AS (                       -- 대표 행(D11)
  SELECT DISTINCT ON (bkey) bkey, id AS rep_id
  FROM members
  ORDER BY bkey, is_off ASC, is_ah DESC, id COLLATE "C" ASC     -- 모든 DISTINCT ON 의 id 정렬은 COLLATE "C"(🟡4) — 아래 CTE 도 같다
),
bundle_mat AS (                       -- 재료 행(§4-7 (3))
  SELECT DISTINCT ON (bkey) bkey, id AS mat_id
  FROM members
  ORDER BY bkey, is_off ASC,
           CASE WHEN is_owner THEN 0 WHEN is_ah THEN 1 ELSE 2 END ASC,
           CASE WHEN is_owner THEN presale_min_price END ASC NULLS LAST,
           CASE WHEN is_owner THEN id END ASC,
           id DESC
),
bundle_units AS (                     -- 세대수(D7)
  SELECT DISTINCT ON (bkey) bkey, units AS b_units
  FROM members
  WHERE units IS NOT NULL AND units > 1
  ORDER BY bkey, is_off ASC,            -- (오) 행은 뒤로(묶음이 (오) 뿐이면 그 값 — JS pickBundleUnits 는 (오)뿐이면 null 을 주지만 KOSIS 쪽은 (오) 를 자기 묶음으로 떼어 자기 값을 쓰므로(Task 1) 화면도 자기 값이 맞다. 리허설 대조(Task 6 Step 3)는 이 경우를 "(오)뿐인 2행+ 묶음"으로 따로 센다 — 맹점 O3)
           CASE WHEN unit_source = 'naver_presale' AND is_owner THEN 0
                WHEN unit_source IN ('naver_presale', 'naver') THEN 1
                WHEN unit_source = 'molit' THEN 2
                WHEN unit_source = 'applyhome' THEN 3
                ELSE 4 END ASC,
           units DESC, id ASC
),
bundle_unsold AS (                    -- 묶음 미분양(사장님 결정 §6-9)
  SELECT DISTINCT ON (m.bkey) m.bkey, m.unsold AS b_unsold, m.unsold_source AS b_unsold_source
  FROM members m JOIN bundle_mat bm ON bm.bkey = m.bkey
  ORDER BY m.bkey, m.is_off ASC,        -- (오) 행은 뒤로
           CASE WHEN m.unsold_source = 'applyhome'
                 AND m.unsold_as_of IS NOT NULL
                 AND m.unsold_as_of + INTERVAL '6 months' >= (now() AT TIME ZONE 'Asia/Seoul')::date THEN 0
                WHEN m.unsold_source = 'hold' THEN 2
                WHEN m.unsold IS NOT NULL THEN 1
                ELSE 3 END ASC,
           -- 순위 0(유효 청약홈 실측) 안에서만 공고일 최근 것 — 만료 청약홈 행의 공고일이 재료 행을 이기면 안 된다(맹점 O2)
           CASE WHEN m.unsold_source = 'applyhome' AND m.unsold_as_of IS NOT NULL
                 AND m.unsold_as_of + INTERVAL '6 months' >= (now() AT TIME ZONE 'Asia/Seoul')::date THEN m.unsold_as_of END DESC NULLS LAST,
           (m.id = bm.mat_id) DESC,
           m.id DESC
),
bundle_ah AS (                        -- 경쟁률·공고 링크 = 값 있는 청약홈 행 중 id 큰 것
  SELECT bkey,
    (array_agg(competition_rate       ORDER BY id DESC) FILTER (WHERE competition_rate       IS NOT NULL))[1] AS b_competition_rate,
    (array_agg(competition_supply     ORDER BY id DESC) FILTER (WHERE competition_supply     IS NOT NULL))[1] AS b_competition_supply,
    (array_agg(competition_applicants ORDER BY id DESC) FILTER (WHERE competition_applicants IS NOT NULL))[1] AS b_competition_applicants,
    (array_agg(announcement_url       ORDER BY id DESC) FILTER (WHERE announcement_url       IS NOT NULL))[1] AS b_announcement_url
  FROM members WHERE is_ah AND NOT is_off GROUP BY bkey
),
bundle_agg AS (
  SELECT bkey,
    count(*)                                                        AS member_count,
    array_agg(id ORDER BY id COLLATE "C") FILTER (WHERE NOT is_off) AS member_ids,  -- 시계열·재공고·곧분양 판정용: (오) 제외(아파트 카드에 오피스텔 공고·이력이 섞이지 않게 — 세션630 presale-detail 과 같은 뜻)
    array_agg(id ORDER BY id COLLATE "C")                           AS alias_ids    -- 옛 id 넘김용: 구성원 전부((오) 포함) — 옛 (오) 카드 id 의 관심매물·딥링크가 아파트 카드로 이어진다(재검사 🟠2)
  FROM members GROUP BY bkey
),
deduped AS (                          -- 한 묶음 = 한 행: a.* 는 재료 행, rep_* 는 대표 행
  SELECT mat.*,
    rep.id   AS rep_id,
    rep.name AS rep_name,
    rep.cats_cache AS rep_cats_cache,
    rep.scores_computed_at AS rep_scores_computed_at,
    bu.b_units, bun.b_unsold, bun.b_unsold_source,
    bah.b_competition_rate, bah.b_competition_supply, bah.b_competition_applicants, bah.b_announcement_url,
    bg.member_count, bg.member_ids
  FROM bundle_rep br
  JOIN members rep ON rep.id = br.rep_id
  JOIN bundle_mat bm ON bm.bkey = br.bkey
  JOIN members mat ON mat.id = bm.mat_id
  LEFT JOIN bundle_units  bu  ON bu.bkey  = br.bkey
  LEFT JOIN bundle_unsold bun ON bun.bkey = br.bkey
  LEFT JOIN bundle_ah     bah ON bah.bkey = br.bkey
  JOIN bundle_agg bg ON bg.bkey = br.bkey
),
latest_prices AS (                    -- 재료 행의 가격 행 → 없으면 묶음 안 id 내림차순 첫 가격 행(D10)
  SELECT DISTINCT ON (bkey) bkey, area, price, pp
  FROM (
    SELECT m.bkey, m.id, m.is_off, (m.id = bm.mat_id) AS is_mat, p.area, p.price, p.pp,
           ROW_NUMBER() OVER (PARTITION BY p.apartment_id
                              ORDER BY (CASE WHEN p.house_type LIKE 'presale_%' THEN 1 ELSE 0 END), p.recorded_at DESC) AS rn
    FROM prices p JOIN members m ON m.id = p.apartment_id JOIN bundle_mat bm ON bm.bkey = m.bkey
  ) x
  WHERE rn = 1
  ORDER BY bkey, is_mat DESC, is_off ASC, id COLLATE "C" DESC   -- 재료 행 → (오) 아닌 행 → id 큰 행(🟡3)
),
latest_regions AS ( … 20261007 판 그대로 … ),
latest_regions_gu AS ( … 20261007 판 그대로 … )
SELECT
  a.rep_id   AS id,
  -- 제목 떼기: 괄호를 공백 하나로 바꾼 뒤 겹공백을 하나로, 앞뒤 공백 제거 — JS stripNoticeWords 와 같은 세 단계(맹점 O1). 뗄 것이 없으면 원문 그대로.
  CASE WHEN a.rep_name ~ '<NOTICE_PAREN_SQL 글자 그대로>'
       THEN btrim(regexp_replace(regexp_replace(a.rep_name, '<NOTICE_PAREN_SQL 글자 그대로>', ' ', 'g'), '\s{2,}', ' ', 'g'))
       ELSE a.rep_name END AS name,   -- 작업반이 _card-title.mjs 의 NOTICE_PAREN_SQL 문자열을 두 자리에 똑같이 복사(시험이 글자 일치를 확인)
  a.dong, a.gu, a.region, a.lat, a.lng, a.builder,
  -- 혼자인 행은 자기 값 그대로(출력 무변경 §4-7 (9)) — 묶음 CTE 는 (오)·1 이하 행을 뒤로 미루거나 빼므로 혼자인 그 행이 NULL 을 받을 수 있다.
  CASE WHEN a.member_count >= 2 THEN a.b_units  ELSE a.units  END AS units,
  CASE WHEN a.member_count >= 2 THEN a.b_unsold ELSE a.unsold END AS unsold,
  CASE WHEN a.member_count >= 2
       THEN (CASE WHEN a.b_unsold IS NULL OR a.b_units IS NULL OR a.b_units <= 0 THEN NULL
                  WHEN ROUND(a.b_unsold::numeric / a.b_units * 100, 1) > 100 THEN NULL
                  ELSE ROUND(a.b_unsold::numeric / a.b_units * 100, 1) END)
       ELSE (CASE WHEN a.unsold_rate > 100 THEN NULL ELSE a.unsold_rate END)
  END AS "unsoldRate",
  a.completion, a.heating,
  … (20261007 판 112~135줄 글자 그대로 — 단 123(announcementUrl)·134·135 는 아래 "달라지는 줄" 표대로)
  a.rep_cats_cache AS "catsCache",
  a.rep_scores_computed_at AS "scoresComputedAt",
  CASE WHEN a.member_count >= 2 THEN a.b_competition_rate       ELSE a.competition_rate       END AS "competitionRate",
  CASE WHEN a.member_count >= 2 THEN a.b_competition_supply     ELSE a.competition_supply     END AS "competitionSupply",
  CASE WHEN a.member_count >= 2 THEN a.b_competition_applicants ELSE a.competition_applicants END AS "competitionApplicants",
  … (139~166 글자 그대로; 123 의 announcementUrl 은 `CASE WHEN a.member_count >= 2 THEN a.b_announcement_url ELSE a.announcement_url END AS "announcementUrl"`)
  p.area, p.price, p.pp,
  … (171~271 글자 그대로 — JOIN 별칭 i·sc·t·b·r·rg·ts 는 재료 행 a.id 로 붙는다)
  … dataReliability 식은 글자 그대로(단 마지막 항 `a.units > 1` → `(CASE WHEN a.member_count >= 2 THEN a.b_units ELSE a.units END) > 1` — 위 units 칸과 같은 값)
  COALESCE(ae.event_count, 0) AS "unsoldEventCount",
  pso.last_recruit_date AS "lastUnsoldEventAt",
  … (293~322 글자 그대로)
  ,
  a.bkey          AS "complexKey",
  COALESCE(a.member_ids, ARRAY[a.rep_id]) AS "memberIds",   -- (오) 뺀 구성원(비면 대표 id 하나)
  a.id            AS "materialId",
  a.rep_name      AS "noticeName",
  a.alias_ids     AS "aliasIds"     -- 구성원 전부((오) 포함) — 옛 id → 카드 넘김표 재료
FROM deduped a
LEFT JOIN latest_prices p ON p.bkey = a.bkey
LEFT JOIN infra i ON i.apartment_id = a.id
LEFT JOIN schools sc ON sc.apartment_id = a.id
LEFT JOIN transport t ON t.apartment_id = a.id
LEFT JOIN builders b ON b.name = a.builder
LEFT JOIN latest_regions r ON r.region = a.region
LEFT JOIN latest_regions_gu rg ON rg.region = a.region
  AND rg.gu = CASE WHEN a.region = '세종' THEN '세종시' ELSE a.gu END
LEFT JOIN trade_stats ts ON ts.apartment_id = a.id
LEFT JOIN (                            -- 무순위 공고 횟수·최근 공고일 = 구성원 합·최댓값
  SELECT m.bkey, COUNT(*) AS event_count, MAX(e.recorded_at) AS last_event_at
    FROM applyhome_events e JOIN members m ON m.id = e.apartment_id
   GROUP BY m.bkey
) ae ON ae.bkey = a.bkey
LEFT JOIN (
  SELECT m.bkey, MAX(s.recruit_date) AS last_recruit_date
    FROM presale_schedule_official s JOIN members m ON m.id = s.apartment_id
   WHERE s.recruit_date IS NOT NULL
   GROUP BY m.bkey
) pso ON pso.bkey = a.bkey;

NOTIFY pgrst, 'reload schema';
```

위의 `…` 자리는 작업반이 20261007 판에서 **그 줄 범위를 글자 그대로** 복사한다(새로 치지 않는다). `deduped` 의 `mat.*` 에는 `apartments` 의 모든 칸 + `bkey/is_off/is_ah/is_owner` 가 들어 있으므로 `a.<칸>` 참조는 전부 재료 행 값이다. `memberIds` 는 `(오)` 를 **뺀** 구성원(비면 대표 id 하나 — 시계열·재공고 수·곧분양 판정이 쓴다), `aliasIds` 는 구성원 **전부**(`(오)` 포함 — 옛 id → 카드 넘김표만 쓴다, 재검사 🟠2). 화면은 그래도 `memberIds ?? [id]`·`aliasIds ?? memberIds ?? [id]` 로 방어(Task 7). id 정렬은 전부 `COLLATE "C"`(JS 문자 비교와 같은 순서 — 🟡4), `(오)` 판정은 `COALESCE(name, '') LIKE '%(오)%'`. **혼자인 행**(`member_count = 1`)은 `units`·`unsold`·경쟁률·공고 링크를 자기 칸에서 그대로 내므로 묶음 CTE 가 그 행을 뒤로 미루거나 빼도 값이 안 바뀐다 — 리허설 `single_diff = 0` 이 이 약속의 확인이다.

- [ ] **Step 3: 리허설 — 별도 이름의 VIEW + node 전수 대조(운영 단계 B-1 에서 메인·사장님이 돌린다 — 작업반은 파일만)**

왜 트랜잭션 리허설이 아닌가(맹점 O6): Supabase SQL Editor 는 여러 문장 중 **마지막 결과만** 보여 주고, 트랜잭션 안의 `CREATE OR REPLACE VIEW` 는 리허설 내내 운영 VIEW 를 잠가 손님 API 가 멈춘다. 그래서 **운영 VIEW 는 건드리지 않고** 같은 본문의 `apartments_flat_rehearsal` 을 만들어 두고, node 가 서비스 열쇠로 옛/새 VIEW 를 전부 읽어 맞댄 뒤 지운다.

`supabase/migrations/_rehearsal/20261013_one_card_rehearsal_view.sql` — 마이그 본문에서 `CREATE OR REPLACE VIEW apartments_flat WITH` 한 곳만 `CREATE VIEW apartments_flat_rehearsal WITH` 로 바꾼 것(그 밖은 글자 그대로 — 정적 가드가 두 파일의 본문 동일을 확인). `WITH (security_invoker = on)` 그대로 · 그 뒤 **권한을 명시**(새 public 객체엔 anon·authenticated 권한이 기본으로 붙는다 — `supabase/CLAUDE.md`, 재검사 후속 4): `REVOKE ALL ON apartments_flat_rehearsal FROM PUBLIC, anon, authenticated; GRANT SELECT ON apartments_flat_rehearsal TO service_role;` · 끝에 `NOTIFY pgrst, 'reload schema';`. 정적 가드의 "본문 동일" 비교는 `WITH members AS` ~ 첫 `;` 까지만 본다(REVOKE/GRANT 는 비교 밖).
`supabase/migrations/_rehearsal/20261013_one_card_rehearsal_drop.sql` — `DROP VIEW IF EXISTS apartments_flat_rehearsal; NOTIFY pgrst, 'reload schema';`(대조가 끝난 날 바로 — 월요일 권한 지문 감시 ⑩ 전에).

정적 가드에 한 건 더(`scripts/_view-one-card-sql.test.mjs`): 리허설 VIEW 파일의 본문 = 마이그 본문에서 이름만 바꾼 것.

```js
  it("리허설 VIEW 파일은 마이그 본문에서 VIEW 이름만 다르다", () => {
    const reh = readLf("../supabase/migrations/_rehearsal/20261013_one_card_rehearsal_view.sql");
    const norm = (/** @type {string} */ s) => { const b = s.indexOf("WITH members AS"); return s.slice(b, s.indexOf(";", s.indexOf(") pso ON pso.bkey = a.bkey", b))).replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim(); };
    expect(reh).toMatch(/CREATE VIEW apartments_flat_rehearsal WITH \(security_invoker = on\) AS/);
    expect(norm(reh)).toBe(norm(sql));
  });
```

대조 스크립트(메인이 운영 단계 B-1 에서 `.omc/artifacts/session63x/rehearsal-compare.mjs` 로 두고 `node --env-file=F:/mibunyang/.env.local` 로 돌린다 — 읽기 전용, 깃 밖. 아래가 그 본문이다):

```js
// 읽기 전용 — 옛 VIEW(apartments_flat) vs 리허설 VIEW(apartments_flat_rehearsal) 전수 대조 + JS 규칙과 맞대기
import { getSupabase, selectAll } from "file:///F:/mibunyang/scripts/collectors/_shared.mjs";
import { pickRepresentativeId, pickMaterialId, pickBundleUnits } from "file:///F:/mibunyang/scripts/collectors/_same-complex.mjs";
import { stripNoticeWords } from "file:///F:/mibunyang/scripts/collectors/_card-title.mjs";
import { excludeLeaseUnits } from "file:///F:/mibunyang/src/constants/leaseTypes.mjs";
import { writeFileSync } from "node:fs";
const sb = getSupabase();
const [oldRows, newRows, apts] = await Promise.all([
  selectAll((s) => s.from("apartments_flat").select("*"), sb, "id"),
  selectAll((s) => s.from("apartments_flat_rehearsal").select("*"), sb, "id"),
  selectAll((s) => s.from("apartments").select("id,name,complex_key,naver_presale_no,presale_min_price,units,unit_source,presale_type"), sb, "id"),
]);
const { count } = await sb.from("apartments").select("id", { count: "exact", head: true });
if (count !== apts.length) throw new Error(`행 수 불일치 ${count} ≠ ${apts.length}`);
const bundles = new Map();
for (const a of apts) { const k = a.complex_key ?? a.id; (bundles.get(k) ?? bundles.set(k, []).get(k)).push(a); }
const oldById = new Map(oldRows.map((r) => [r.id, r])), newById = new Map(newRows.map((r) => [r.id, r]));
const out = { measured_at: new Date().toISOString(), old_rows: oldRows.length, new_rows: newRows.length,
  new_rows_nonlease: excludeLeaseUnits(newRows).length, old_rows_nonlease: excludeLeaseUnits(oldRows).length,
  single_diff: [], name_changed: [], rule_mismatch: [], missing_new: [], appeared: [], off_only_multi: [] };
const SKIP = new Set(["name", "complexKey", "memberIds", "materialId", "noticeName", "aliasIds"]);
const isOff = (/** @type {any} */ m) => String(m.name ?? "").includes("(오)");
for (const [k, ms] of bundles) {
  const repId = ms.length >= 2 ? pickRepresentativeId(ms) : ms[0].id;
  const n = newById.get(repId); if (!n) { out.missing_new.push(repId); continue; }
  const o = oldById.get(repId);
  // (0) 옛 VIEW 에 없던 대표 id = "새로 생기는 카드"(옛 VIEW 는 블록이 달라도 이름·동이 같으면 한 장이었다 — 재검사 🟠3). 따로 센다, 혼자 행 차이에 안 섞는다
  if (!o) { out.appeared.push({ id: repId, name: n.name, size: ms.length }); }
  // (1) 혼자인 행(묶음 구성원 1) — name·새 칸 5개 빼고 전 칸 동일(옛 VIEW 에 있는 것만)
  if (ms.length === 1 && o) {
    const diff = Object.keys(o).filter((c) => !SKIP.has(c) && JSON.stringify(o[c]) !== JSON.stringify(n[c]));
    if (diff.length) out.single_diff.push({ id: repId, cols: diff });
  }
  // (2) JS 규칙과 맞대기 — 대표·재료·세대수·memberIds·aliasIds·complexKey. (오)뿐인 2행+ 묶음은 JS pickBundleUnits 가 null 이라 따로 센다(맹점 O3)
  const matId = ms.length >= 2 ? pickMaterialId(ms) : ms[0].id;
  const offOnly = ms.length >= 2 && ms.every(isOff);
  if (offOnly) { out.off_only_multi.push({ id: repId, units: n.units, ids: ms.map((m) => m.id) }); continue; }
  const units = ms.length >= 2 ? (pickBundleUnits(ms)?.units ?? null) : ms[0].units;
  const members = ms.filter((m) => !isOff(m)).map((m) => m.id).sort();
  const got = { materialId: n.materialId, units: n.units, memberIds: [...(n.memberIds ?? [])].sort(), aliasIds: [...(n.aliasIds ?? [])].sort(), complexKey: n.complexKey };
  const exp = { materialId: matId, units, memberIds: members.length ? members : [repId], aliasIds: ms.map((m) => m.id).sort(), complexKey: k };
  if (JSON.stringify(got) !== JSON.stringify(exp)) out.rule_mismatch.push({ id: repId, got, exp });
  // (3) name = stripNoticeWords(대표 행 원래 이름)
  const rep = ms.find((m) => m.id === repId);
  if (n.name !== stripNoticeWords(rep.name)) out.rule_mismatch.push({ id: repId, name: n.name, exp: stripNoticeWords(rep.name) });
  if (n.name !== rep.name) out.name_changed.push({ id: repId, before: rep.name, after: n.name });
}
// (4) 새 VIEW 행 수 = 묶음 수 · 옛 VIEW 에만 있는 id(= 흡수된 카드) 수
out.bundles = bundles.size;
out.absorbed = oldRows.filter((r) => !newById.has(r.id)).length;
writeFileSync(new URL("./rehearsal-compare.json", import.meta.url), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ ...out, single_diff: out.single_diff.length, name_changed: out.name_changed.length, rule_mismatch: out.rule_mismatch.length, missing_new: out.missing_new.length, appeared: out.appeared.length, off_only_multi: out.off_only_multi.length }));
```

기대: `single_diff 0` · `rule_mismatch 0` · `missing_new 0` · `new_rows = bundles`(10/13 기준 2,375) · `absorbed` = 옛 카드 중 흡수된 수 · `appeared` = **새로 생기는 카드**(옛 VIEW 가 블록 다른 행을 한 장으로 접던 것이 풀림 — 명단을 전이표에) · `off_only_multi` = (오)뿐인 2행+ 묶음(수·세대수 눈으로) · `new_rows_nonlease` = 전환일 `--expect-count` 값 · `name_changed` 명단은 눈으로 10개 표본. 스크립트가 쓰는 `COLLATE "C"` 순서와 JS `.sort()` 는 ASCII 범위 id(`ah-`·`ap-` + 숫자)에서 같다. 점수 등급 전후표(맹점 O7)는 같은 재료로 `src/scoring/engine` 의 `computeRegionalMedians`+`calcCats` 를 옛/새 행에 각각 돌려 등급 분포와 바뀐 카드 수를 낸다(`rehearsal-scores.mjs` — `compute-scores.mjs` 145~195 와 같은 호출, 쓰기 0) — 적용 **전**에 승인 표에 넣는다.

- [ ] **Step 4: 가드 통과** — Run: `cd <워크트리> && node ../../../node_modules/vitest/vitest.mjs run scripts/_view-one-card-sql.test.mjs > <스크래치>/t6-green.log 2>&1; echo "exit=$?"` → `exit=0`. `ls supabase/migrations | grep -c "^20261013"` → `1`. `git diff --stat` 에 20261007 파일 변경 0.

- [ ] **Step 5: 올려 두기** — `<스크래치>/commit-msg-6.txt`: `feat(db): apartments_flat 묶음 조합 VIEW(대표 D11·재료 행·세대수 D7·묶음 미분양·name 떼기·새 칸 5) + 되돌리기 + 리허설 SQL (한 단지 = 한 장 다)` · `git add -- supabase/migrations/20261013000000_view_one_card_bundle.sql supabase/migrations/_rollbacks/20261013000001_rollback_view_one_card_bundle.sql supabase/migrations/_rehearsal/20261013_one_card_rehearsal_view.sql supabase/migrations/_rehearsal/20261013_one_card_rehearsal_drop.sql scripts/_view-one-card-sql.test.mjs`.

⚠️ 작업반은 이 SQL 을 **실행하지 않는다**. 적용·리허설은 운영 단계 B.

---

### Task 7: `src/lib/dedup.ts` 통과 + 옛 id → 대표 표

**Files:**
- Modify: `src/lib/dedup.ts` · `src/lib/dedup.test.js`
- Modify: `src/types/*.ts` 중 `Apt` 정의 파일(`grep -rn "siblingIds" src/types/` 로 찾는다 — `detail.ts`)에 `complexKey?: string | null; memberIds?: string[] | null; materialId?: string | null; noticeName?: string | null; siblingIds?: string[]` 보강(이미 있는 것은 그대로).

**Interfaces:**
- Produces:
  - `dedupApartments<T>(apartments)` — 행에 `memberIds` 배열이 **하나라도** 있으면(= 새 VIEW 로 구운 목록) 다시 묶지 않고 각 행에 `siblingIds = memberIds ?? [id]`(재료 `materialId` 를 맨 앞으로, 나머지 오름차순)를 붙여 돌려준다. 없으면 지금 규칙 그대로.
  - `buildIdAlias(apartments: ReadonlyArray<{ id: string; memberIds?: string[] | null; aliasIds?: string[] | null }>): Map<string, string>` — 구성원 id → 카드 id(자기 자신 포함). 재료는 `aliasIds`(전 구성원 — `(오)` 포함) 우선, 없으면 `memberIds`.
  - `resolveAptId(alias: Map<string, string>, id: string | null | undefined): string | null`.

- [ ] **Step 1: 실패하는 시험(`dedup.test.js` 끝에)**

```js
import { buildIdAlias, resolveAptId } from "./dedup";
describe("dedupApartments — memberIds 가 있으면 통과(세션635 다)", () => {
  it("다시 묶지 않고 siblingIds = materialId 먼저 + 나머지 오름차순", () => {
    const rows = [
      { id: "ah-1", name: "하양", region: "경북", gu: "경산시", memberIds: ["ah-1", "ah-2", "ap-9"], materialId: "ap-9" },
      { id: "ah-5", name: "하양", region: "경북", gu: "경산시", memberIds: ["ah-5"], materialId: "ah-5" },
    ];
    const out = dedupApartments(rows);
    expect(out.map((r) => r.id)).toEqual(["ah-1", "ah-5"]); // 같은 이름·지역이어도 묶지 않는다
    expect(out[0].siblingIds).toEqual(["ap-9", "ah-1", "ah-2"]);
  });
  it("memberIds 가 null 인 행(오피스텔뿐)은 자기 id", () => {
    expect(dedupApartments([{ id: "ah-7", name: "x(오)", memberIds: null }])[0].siblingIds).toEqual(["ah-7"]);
  });
  it("memberIds 가 없는 옛 목록은 지금 규칙 그대로", () => {
    const out = dedupApartments([{ id: "ah-1", name: "A(1차)" }, { id: "ah-2", name: "A(2차)" }]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("ah-2");
  });
});
describe("buildIdAlias / resolveAptId", () => {
  const alias = buildIdAlias([{ id: "ah-1", memberIds: ["ah-1", "ah-2", "ap-9"], aliasIds: ["ah-1", "ah-2", "ah-7", "ap-9"] }, { id: "ah-5", memberIds: null }]);
  it("(오) 행 id(aliasIds 에만 있음)도 카드로 이어진다", () => { expect(resolveAptId(alias, "ah-7")).toBe("ah-1"); });
  it("구성원 → 카드 id, 자기 자신도", () => {
    expect(resolveAptId(alias, "ah-2")).toBe("ah-1");
    expect(resolveAptId(alias, "ap-9")).toBe("ah-1");
    expect(resolveAptId(alias, "ah-1")).toBe("ah-1");
    expect(resolveAptId(alias, "ah-5")).toBe("ah-5");
  });
  it("모르는 id·빈 값은 null", () => {
    expect(resolveAptId(alias, "ah-999")).toBeNull();
    expect(resolveAptId(alias, null)).toBeNull();
  });
});
```

- [ ] **Step 2: 빨강** — Run: `cd <워크트리> && npx vitest run src/lib/dedup.test.js > <스크래치>/t7-red.log 2>&1; echo "exit=$?"` → `exit=1`.

- [ ] **Step 3: 구현**

`src/lib/dedup.ts`:

```ts
/**
 * 아파트 목록의 "한 단지 = 한 장".
 * - 새 VIEW(세션635 다)로 구운 목록은 행마다 `memberIds`(묶음 구성원)가 실려 온다 → **다시 묶지 않고** 통과.
 *   siblingIds = 재료 행(materialId) 먼저 + 나머지 오름차순(시계열 조회가 이 순서로 "한 달 한 값"을 고른다).
 * - 옛 목록(memberIds 없음)은 지금까지의 클라이언트 규칙(이름 끝 괄호 뗀 뒤 id 큰 행) 그대로 — VIEW 적용 전·롤백한 날의 안전판.
 */
export interface DedupCandidate {
  id: string;
  name?: string;
  region?: string;
  gu?: string;
  dong?: string;
  memberIds?: string[] | null;
  materialId?: string | null;
  aliasIds?: string[] | null;
}

export function dedupApartments<T extends DedupCandidate>(
  apartments: T[] | null | undefined
): Array<T & { siblingIds: string[] }> {
  if (!apartments?.length) return [];

  if (apartments.some((a) => Array.isArray(a.memberIds))) {
    return apartments.map((apt) => {
      const ids = Array.isArray(apt.memberIds) && apt.memberIds.length > 0 ? [...apt.memberIds].sort() : [apt.id];
      const mat = apt.materialId && ids.includes(apt.materialId) ? apt.materialId : null;
      const siblingIds = mat ? [mat, ...ids.filter((id) => id !== mat)] : ids;
      return { ...apt, siblingIds };
    });
  }

  const groups = new Map<string, { rep: T; ids: string[] }>();
  for (const apt of apartments) {
    const baseName = (apt.name || "").replace(/\([^)]*\)$/, "");
    const key = `${baseName}\0${apt.region || ""}\0${apt.gu || ""}\0${apt.dong || ""}`;
    const existing = groups.get(key);
    if (existing) {
      existing.ids.push(apt.id);
      if (apt.id > existing.rep.id) existing.rep = apt;
    } else {
      groups.set(key, { rep: apt, ids: [apt.id] });
    }
  }
  return [...groups.values()].map(({ rep, ids }) => ({
    ...rep,
    siblingIds: ids.sort(),
  }));
}

/** 구성원 id → 카드 id. 관심 단지·최근 본 단지·딥링크·알림 신청의 옛 id 를 읽을 때 대표로 바꾼다(저장소는 고쳐 쓰지 않는다). */
export function buildIdAlias(apartments: ReadonlyArray<{ id: string; memberIds?: string[] | null; aliasIds?: string[] | null }>): Map<string, string> {
  const alias = new Map<string, string>();
  for (const a of apartments) {
    alias.set(a.id, a.id);
    for (const m of a.aliasIds ?? a.memberIds ?? []) if (!alias.has(m)) alias.set(m, a.id);   // aliasIds = (오) 포함 전 구성원
  }
  return alias;
}

export function resolveAptId(alias: Map<string, string>, id: string | null | undefined): string | null {
  if (!id) return null;
  return alias.get(id) ?? null;
}
```

- [ ] **Step 4: 초록 + 타입** — `npx vitest run src/lib/dedup.test.js` `exit=0` · `npm run typecheck > <스크래치>/t7-tsc.log 2>&1; echo "exit=$?"` `exit=0` · `npm run lint > <스크래치>/t7-lint.log 2>&1; echo "exit=$?"` `exit=0`.
- [ ] **Step 5: 변이 2종** — D1 `apartments.some((a) => Array.isArray(a.memberIds))` 를 `false` 로 → "다시 묶지 않고" 빨강 · D2 `if (!alias.has(m))` 삭제 → 자기 자신이 구성원 목록에서 남의 카드로 덮이는 시험(`alias` 에 `{ id:"ah-2", memberIds:["ah-2"] }` 를 더해 `resolveAptId(alias,"ah-2")` 가 `"ah-2"`)을 추가해 빨강 확인(시험은 유지).
- [ ] **Step 6: 올려 두기** — `<스크래치>/commit-msg-7.txt`: `feat(lib): dedup — memberIds 가 있으면 다시 묶지 않고 통과(siblingIds = 재료 먼저) + buildIdAlias/resolveAptId (한 단지 = 한 장 다)` · `git add -- src/lib/dedup.ts src/lib/dedup.test.js src/types/`.

---

### Task 8: 화면 — 옛 id 넘김 · 재공고 N회 · 원래 공고 이름 · 시계열 id 순서

**Files:**
- Modify: `src/hooks/useApartmentData.ts`(alias 를 함께 돌려준다) · `src/hooks/useUrlSync.ts:155-172`(정리 effect — 지우기 **전에** alias 로 바꿈) + 딥링크 복원 effect(`/apt/{id}` 와 `?detail=` 둘 다 alias 로 바꾼 뒤 열고 주소를 대표로 `replaceState`) · `src/App.tsx`(useApartmentData 의 alias 를 useUrlSync 에 넘기는 배선 한 줄 — 훅 순서 불변) · `src/components/DetailModal.tsx:647-649`(재공고 N회 = `siblingIds` 중 `ah-` 수, 2 이상일 때만) + 제목 아래 `noticeName`(name 과 다를 때만 작은 글씨 "공고명: …") · `src/components/detail/UnsoldChart.tsx`·`PriceChart.tsx`(그대로 — siblingIds 순서는 Task 7 이 재료 먼저로 준다; 20개 상한은 `useHistoryData` 에서 `slice(0, 20)`)
- Test: `src/hooks/useUrlSync.test.js`(있으면 추가, 없으면 새로) · `src/components/DetailModal.unsold-prop.test.jsx`(재공고 문구) · `src/hooks/useHistoryData.test.js`(20개 상한)

**Interfaces:**
- Consumes: Task 7 의 `buildIdAlias`·`resolveAptId`.
- Produces: `useApartmentData()` 반환에 `idAlias: Map<string, string>` 추가(`useMemo(() => buildIdAlias(apartments), [apartments])`). `useUrlSync` 인자에 `idAlias` 추가. `DetailModal` 은 `apt.noticeName` 이 있고 `apt.name` 과 다르면 제목 아래 한 줄 `공고명: {noticeName}`(fontSize F.xs, color C.sub). `src/components/home/RecentlyViewedWidget.tsx:42`(목록에 없는 id 를 거르는 자리 — 🟡1)도 거르기 **전에** `resolveAptId(idAlias, id)` 로 바꾼다(위젯이 `apartments` 를 받는 곳에서 `buildIdAlias` 를 한 번 더 만들거나 prop 으로 받는다 — 작업반이 Read 로 정함, 중복 제거). **옛 주소 방식(설계서 (7) — 계획서에서 정한다)**: `/apt/{옛 id}` 는 정적 페이지가 없어 Vercel `rewrites` 로 SPA 가 받는다 → 딥링크 effect 가 대표로 열고 주소를 `replaceState` 로 대표 주소로 바꾼다. 정적 페이지·사이트맵·`canonical` 은 **대표 id 만**(굽기 목록이 이미 대표만이라 `postbuild-prerender.mjs` 변경 0). 301 넘김은 두지 않는다(정적 호스팅에 옛 id 표가 없다). **재공고 배지**: 청약홈 공고(`ah-`)만 세므로 VIEW 적용 전 옛 목록에서도 `ap-` 가 섞인 묶음은 수가 줄 수 있다 — 지금 그 수가 거짓(네이버 행을 공고로 셈)이었으므로 의도한 변화(🟡7).

- [ ] **Step 1: 실패하는 시험**

`src/hooks/useUrlSync.test.js`(새 파일이면 기존 훅 시험의 렌더 방식 — `@testing-library/react` `renderHook` — 을 `useLoginGate.test.js` 에서 베낀다):

```js
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useUrlSync } from "./useUrlSync";
import { buildIdAlias } from "@/lib/dedup";

const apartments = [{ id: "ah-1", name: "하양", memberIds: ["ah-1", "ah-2", "ap-9"] }, { id: "ah-5", name: "다른", memberIds: ["ah-5"] }];
const idAlias = buildIdAlias(apartments);
const base = () => ({
  tab: "home", setTab: vi.fn(), setProfile: vi.fn(), detailAptId: null, openDetail: vi.fn(), closeDetail: vi.fn(),
  setCompIds: vi.fn((f) => f), setShowCompOpen: vi.fn(), apartments, dataLoading: false, dataError: null,
  setFavoriteIds: vi.fn(), showToast: vi.fn(), idAlias,
});

describe("useUrlSync — 옛 id 넘김(세션635 다)", () => {
  it("관심매물의 구성원 id 는 지우지 않고 카드 id 로 바꾼다 — 정리 토스트는 모르는 id(ah-999) 1개만 센다", () => {
    const p = base();
    renderHook(() => useUrlSync(p));
    const updater = p.setFavoriteIds.mock.calls.at(-1)[0];
    expect(updater(["ah-2", "ah-5", "ah-999"])).toEqual(["ah-1", "ah-5"]);
    expect(p.showToast).toHaveBeenCalledWith(expect.stringContaining("1개가 정리"));
  });
  it("같은 카드로 모이는 중복은 하나만 남긴다", () => {
    const p = base();
    renderHook(() => useUrlSync(p));
    const updater = p.setFavoriteIds.mock.calls.at(-1)[0];
    expect(updater(["ah-1", "ah-2", "ap-9"])).toEqual(["ah-1"]);
  });
  it("딥링크 /apt/ah-2 는 목록이 들어온 뒤 한 번만 카드 ah-1 을 열고 주소를 /apt/ah-1 로 바꾼다", () => {
    window.history.replaceState(null, "", "/apt/ah-2");
    const p = { ...base(), apartments: [], dataLoading: true, idAlias: new Map() };
    const { rerender } = renderHook((props) => useUrlSync(props), { initialProps: p });
    expect(p.openDetail).not.toHaveBeenCalled();                       // 목록 전엔 옛 id 로 열지 않는다
    rerender({ ...p, apartments, dataLoading: false, idAlias });
    expect(p.openDetail).toHaveBeenCalledTimes(1);
    expect(p.openDetail).toHaveBeenCalledWith("ah-1");
    expect(window.location.pathname).toBe("/apt/ah-1");
    rerender({ ...p, apartments, dataLoading: false, idAlias });
    expect(p.openDetail).toHaveBeenCalledTimes(1);                      // 다시 렌더해도 한 번만
    window.history.replaceState(null, "", "/");
  });
});
```

`DetailModal.unsold-prop.test.jsx` 에 한 건: `siblingIds: ["ap-9", "ah-1", "ah-2"]` 인 apt 를 렌더하면 "재공고 2회" 가 보이고, `["ap-9", "ah-1"]` 이면 재공고 배지가 없다(네이버 행은 세지 않는다). `useHistoryData.test.js` 에 한 건: `siblingIds` 25개를 넘기면 요청 URL 의 `apartment_ids` 가 앞 20개만.

- [ ] **Step 2: 빨강** — `npx vitest run src/hooks/useUrlSync.test.js src/components/DetailModal.unsold-prop.test.jsx src/hooks/useHistoryData.test.js > <스크래치>/t8-red.log 2>&1; echo "exit=$?"` → `exit=1`.

- [ ] **Step 3: 구현**

`useApartmentData.ts`: `import { dedupApartments, buildIdAlias } from "@/lib/dedup";` · 반환 타입에 `idAlias: Map<string, string>` · `const idAlias = useMemo(() => buildIdAlias(apartments), [apartments]);` · 반환에 추가. (훅 안 순서: useState → useRef → useCallback → useMemo → useEffect — `src/hooks/CLAUDE.md`.)

`useUrlSync.ts` 정리 effect(155~172)를:

```ts
  // ── 독립 useEffect: 묶음 전환 뒤 옛 id 넘김 + 무효 ID 정리 ──
  //   세션635: 지우기 **전에** 구성원 id → 카드 id 로 바꾼다. 안 바꾸면 전환일에 손님 관심매물이 통째로 지워진다(설계서 §4-7 (10)).
  useEffect(() => {
    if (dataLoading || dataError || !apartments.length) return;
    const remap = (ids: string[]) => {
      const out: string[] = [];
      for (const id of ids) {
        const to = resolveAptId(idAlias, id);
        if (to && !out.includes(to)) out.push(to);
      }
      return out;
    };
    setFavoriteIds((ids) => {
      const next = remap(ids);
      if (next.length === ids.length && next.every((id, i) => id === ids[i])) return ids;
      const removed = ids.filter((id) => !resolveAptId(idAlias, id)).length;
      if (removed > 0) showToast(`데이터 변경으로 관심매물 ${removed}개가 정리되었습니다`);
      return next;
    });
    setCompIds((ids) => {
      const next = remap(ids);
      return next.length === ids.length && next.every((id, i) => id === ids[i]) ? ids : next;
    });
  }, [apartments, idAlias, dataLoading, dataError, setFavoriteIds, setCompIds, showToast]);
```

딥링크 복원 effect(`/apt/{id}` 1순위 + 옛 `?detail=`, `useUrlSync.ts:114~153` — 82~113 은 pushState·popstate effect, 작업반이 Read 로 확인). 지금은 mount 1회(`[]` deps + eslint-disable)라 `idAlias` 가 아직 비어 옛 id 로 먼저 열린다(맹점 O12). 아래 꼴로 바꾼다 — **목록이 들어온 뒤 한 번만** 복원하고, 기존 두 함정(`src/hooks/CLAUDE.md` "상세 URL 동기화의 두 함정")의 한 줄 `if (prevDetailRef.current === detailAptId) return;` 은 손대지 않는다:

```ts
  // ── URL 딥링크 복원 — 목록 로드 뒤 한 번만(세션635: 옛 구성원 id 는 대표로 넘겨 연다) ──
  const deepLinkDoneRef = useRef(false);
  useEffect(() => {
    if (deepLinkDoneRef.current) return;
    const fromPath = /^\/apt\/([^/?#]+)/.exec(window.location.pathname)?.[1];
    const fromQuery = new URLSearchParams(window.location.search).get("detail");
    const raw = fromPath ? decodeURIComponent(fromPath) : fromQuery;
    if (!raw) { deepLinkDoneRef.current = true; return; }          // 딥링크 아님 — 다시 볼 일 없음
    if (dataLoading || !apartments.length) return;                   // 목록이 아직 — 들어오면 다시 돈다
    deepLinkDoneRef.current = true;
    const to = resolveAptId(idAlias, raw) ?? raw;
    openDetail(to);
    if (to !== raw || fromQuery) window.history.replaceState(null, "", `/apt/${encodeURIComponent(to)}`);
  }, [apartments, dataLoading, idAlias, openDetail]);
```

기존 복원 effect 가 하던 그 밖의 일(옛 `?detail=` → `/apt/` 주소 교체 146~148, `MAX_COMPARE` 딥링크 방어 등)은 **그대로 남기고** "상세 열기" 부분만 위로 옮긴다 — 작업반이 Read 로 분리한다. 시험(위 Step 1 의 세 번째 건을 이렇게): 빈 목록(`apartments: [], dataLoading: true`)으로 먼저 렌더 → `openDetail` 호출 0 → `rerender` 로 목록·`idAlias` 를 넣으면 `openDetail("ah-1")` 1회 + 주소 `/apt/ah-1` → 한 번 더 `rerender` 해도 호출 수 그대로 1. 그리고 기존 `useUrlSync`/App 의 "두 함정" 시험 파일(`grep -rln "두 함정\|prevDetailRef" src/hooks/*.test.*`)을 같이 돌린다. `useUrlSync` 의 인자 타입에 `idAlias: Map<string, string>` 추가. `App.tsx` 에서 `const { apartments, loading, error, dataUpdatedAt, idAlias } = useApartmentData();` 꼴로 받아 `useUrlSync({ …, idAlias })`.

`DetailModal.tsx` 647~649:

```tsx
                {(() => {
                  const notices = (Array.isArray(apt.siblingIds) ? (apt.siblingIds as string[]) : []).filter((id) => id.startsWith("ah-"));
                  return notices.length > 1 ? (
                    <span …같은 배지 스타일…>재공고 {notices.length}회 · 시계열 통합 조회</span>
                  ) : null;
                })()}
```

제목 아래(제목 렌더 바로 다음 줄, 작업반이 `apt.name` 을 h2/제목으로 그리는 자리를 Read 로 찾는다): `{apt.noticeName && apt.noticeName !== apt.name ? <div style={{ fontSize: F.xs, color: C.sub, marginTop: 2 }}>공고명: {apt.noticeName as string}</div> : null}`.

`useHistoryData.ts` 32줄: `const idsKey = siblingIds?.length && siblingIds.length > 1 ? siblingIds.slice(0, 20).join(",") : "";`(API 상한 20 — `apartmentValidation.ts`).

- [ ] **Step 4: 초록 + 타입 + 린트 + 포맷** — 위 시험 3파일 `exit=0` · `npm run typecheck` · `npm run lint` · `npm run format:check` 전부 `exit=0`.
- [ ] **Step 5: 변이 2종** — U1 정리 effect 의 `remap` 을 `ids.filter((id) => idAlias.has(id))` 로 → "구성원 id 는 지우지 않고 카드 id 로" 빨강 · U2 DetailModal 의 `.filter((id) => id.startsWith("ah-"))` 삭제 → 재공고 시험 빨강.
- [ ] **Step 6: 올려 두기** — `<스크래치>/commit-msg-8.txt`: `feat(ui): 옛 카드 id 를 읽을 때 대표로 넘김(관심매물·비교·딥링크) · 재공고 N회 = 청약홈 공고 수 · 공고명 표시 · 시계열 id 20개 상한 (한 단지 = 한 장 다)` · `git add -- src/hooks/useApartmentData.ts src/hooks/useUrlSync.ts src/hooks/useUrlSync.test.js src/hooks/useHistoryData.ts src/hooks/useHistoryData.test.js src/App.tsx src/components/DetailModal.tsx src/components/DetailModal.unsold-prop.test.jsx`.

---

### Task 9: API — 새 칸 통과 + 미분양 시계열 "한 달 한 값"

**Files:**
- Modify: `api/supabase/apartments.ts:400-419`(`sanitize` 와 그 안의 작은 함수들 — 통과 칸 목록)
- Modify: `api/_lib/timeseriesHandler.ts`(`mergeMonthly` 옵션) · `api/supabase/unsold-history.ts`(옵션 켬)
- Test: `api/_lib/timeseriesHandler.test.ts`(있으면 추가 · 없으면 새로 — 같은 폴더의 다른 `*.test.ts` 꼴을 따른다) · `api/supabase/apartments.test.ts`(sanitize 통과 칸)

**Interfaces:**
- Produces:
  - `sanitize(row)` 가 `complexKey`·`memberIds`(배열 아니면 `null`)·`materialId`·`noticeName`·`aliasIds`(배열 아니면 `null`) 다섯 칸을 그대로 통과(`?? null`). 정보성 칸 — 점수 미사용.
  - `createTimeseriesHandler({ …, mergeMonthly?: { key: "base_month", value: "unsold_count" } })` — 있으면 응답 `data` 를 `key` 별 한 행으로 접는다: **요청한 id 순서에서 앞선 id 의 행**이 그 달에 있으면 그 행, 없으면 그 달 행 중 `value` 가 가장 큰 행. 접은 뒤 `key` 오름차순. 단일 id 요청은 접을 것이 없어 그대로. `count` 는 접은 뒤 수.
  - 순수 함수 `mergeMonthlyRows(rows, idOrder, { key, value })` 를 export(시험용).

- [ ] **Step 1: 실패하는 시험**

`api/_lib/timeseriesHandler.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mergeMonthlyRows } from "./timeseriesHandler.js";
const opt = { key: "base_month", value: "unsold_count" } as const;
describe("mergeMonthlyRows — 한 달 한 값(세션635 다)", () => {
  it("같은 달 세 행 → 요청 순서 첫 id(재료 행)의 값", () => {
    const rows = [
      { apartment_id: "ah-1", base_month: "202609", unsold_count: 5 },
      { apartment_id: "ap-9", base_month: "202609", unsold_count: 40 },
      { apartment_id: "ah-2", base_month: "202609", unsold_count: 1 },
    ];
    expect(mergeMonthlyRows(rows, ["ap-9", "ah-1", "ah-2"], opt)).toEqual([{ apartment_id: "ap-9", base_month: "202609", unsold_count: 40 }]);
  });
  it("첫 id 가 없는 달은 최댓값(전환 전 달의 반쪽 값 근사)", () => {
    const rows = [
      { apartment_id: "ah-1", base_month: "202606", unsold_count: 20 },
      { apartment_id: "ah-2", base_month: "202606", unsold_count: 3 },
      { apartment_id: "ap-9", base_month: "202609", unsold_count: 40 },
    ];
    expect(mergeMonthlyRows(rows, ["ap-9", "ah-1", "ah-2"], opt).map((r) => [r.base_month, r.unsold_count])).toEqual([["202606", 20], ["202609", 40]]);
  });
  it("id 하나면 그대로(순서만 보장)", () => {
    const rows = [{ apartment_id: "ah-1", base_month: "202609", unsold_count: 5 }, { apartment_id: "ah-1", base_month: "202608", unsold_count: 7 }];
    expect(mergeMonthlyRows(rows, ["ah-1"], opt).map((r) => r.base_month)).toEqual(["202608", "202609"]);
  });
  it("value 가 null 인 행만 있는 달은 그 행을 둔다(지우지 않는다)", () => {
    const rows = [{ apartment_id: "ah-2", base_month: "202607", unsold_count: null }];
    expect(mergeMonthlyRows(rows, ["ap-9", "ah-2"], opt)).toHaveLength(1);
  });
});
```

`api/supabase/apartments.test.ts`(없으면 새로, 기존 `api/**/*.test.ts` 의 import 꼴을 따른다): `sanitize({ id: "ah-1", complexKey: "K", memberIds: ["ah-1", "ap-9"], materialId: "ap-9", noticeName: "하양(2차)", aliasIds: ["ah-1", "ah-7", "ap-9"] })` 결과에 다섯 칸이 그대로 있고, `sanitize({ id: "ah-1" })` 은 `memberIds: null`·`aliasIds: null`·`complexKey: null`.

- [ ] **Step 2: 빨강** — `cd <워크트리> && npx vitest run api/_lib/timeseriesHandler.test.ts api/supabase/apartments.test.ts > <스크래치>/t9-red.log 2>&1; echo "exit=$?"` → `exit=1`.

- [ ] **Step 3: 구현**

`timeseriesHandler.ts`:

```ts
type MergeMonthly = { key: string; value: string };
type CreateTimeseriesConfig = { /* 기존 칸 … */ mergeMonthly?: MergeMonthly };

/** 같은 달(key) 여러 행 → 한 행: 요청 순서 **첫 id**(재료 행)의 행이 있으면 그 행, 없으면 value 최댓값(설계서 §4-7 (5) — 두 번째 순위 id 가 아니라 최댓값). key 오름차순. */
export function mergeMonthlyRows<T extends Record<string, unknown>>(rows: T[], idOrder: string[], { key, value }: MergeMonthly): T[] {
  const first = idOrder[0];
  const groups = new Map<string, T[]>();
  for (const r of rows) { const k = String(r[key] ?? ""); (groups.get(k) ?? groups.set(k, []).get(k)!).push(r); }
  const num = (r: T) => (typeof r[value] === "number" ? (r[value] as number) : -Infinity);
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, g]) => g.find((r) => String(r.apartment_id) === first) ?? g.reduce((best, r) => (num(r) > num(best) ? r : best), g[0]));
}
```

핸들러 안 `const { data, error } = await query;` 뒤: `const rowsOut = mergeMonthly && "ids" in parsed ? mergeMonthlyRows((data ?? []) as Record<string, unknown>[], parsed.ids, mergeMonthly) : (data || []);` 로 바꾸고 응답의 `data`·`count` 를 `rowsOut` 으로. `unsold-history.ts` 에 `mergeMonthly: { key: "base_month", value: "unsold_count" }`. `prices.ts` 는 그대로(분양가 시계열은 회차별 행이 뜻이 있다 — 바꾸지 않는다).

`apartments.ts` `sanitize`(400~419): 통과 칸을 만드는 자리에 `complexKey: row.complexKey ?? null, memberIds: Array.isArray(row.memberIds) ? row.memberIds : null, materialId: row.materialId ?? null, noticeName: row.noticeName ?? null, aliasIds: Array.isArray(row.aliasIds) ? row.aliasIds : null,` 다섯 줄.

- [ ] **Step 4: 초록 + 타입** — 위 시험 `exit=0` · `npm run typecheck:scripts`(api 는 루트 tsconfig — `npm run typecheck`) `exit=0`.
- [ ] **Step 5: 변이 2종** — H1 `g.find(... === first) ??` 삭제 → "요청 순서 첫 id" 빨강 · H2 `sanitize` 의 `memberIds` 줄 삭제 → apartments 시험 빨강.
- [ ] **Step 6: 올려 두기** — `<스크래치>/commit-msg-9.txt`: `feat(api): apartments 응답에 complexKey/memberIds/materialId/noticeName 통과 · unsold-history 는 한 달 한 값(재료 행 먼저, 없으면 최댓값) (한 단지 = 한 장 다)` · `git add -- api/supabase/apartments.ts api/supabase/apartments.test.ts api/_lib/timeseriesHandler.ts api/_lib/timeseriesHandler.test.ts api/supabase/unsold-history.ts`.

---

### Task 10: 스크립트 — 전환일 장수 승인 · 상세 버킷 · 점수 정리 사전 집계 · 재료 행에 쓰기 · 알림 묶음 매칭

**Files:**
- Modify: `api/upcoming.ts:159-190`(`findStalePlanIds` — 일정표 조회를 카드 id 가 아니라 **구성원 id 전부**로, 결과는 카드 id 로 되돌림)
- Modify: `scripts/collect-data.mjs:1126-1141`(`--expect-count=<N>` 1회용 인자) · `scripts/static-outputs.mjs:14`(`DETAIL_ONLY_FIELDS` 에 `noticeName` — `memberIds`·`aliasIds`·`materialId`·`complexKey` 는 목록에 남긴다: 넘김표·시계열 id 가 목록에서 만들어진다) · `scripts/compute-scores.mjs:315`(`clearStaleScores` 가 비우기 전에 `정리 예정 N / 전체 M = r%` 로그 — 안전판 자체는 그대로) · `scripts/collectors/calc-layout.mjs:117-119, 284-287`(VIEW 에서 `id, materialId, name, area` 를 읽고 **`materialId ?? id` 에 쓴다**) · `scripts/backfill-presale-area-notices.mjs:805`(VIEW select 에 `materialId`) · `:638-697`(`selectNoticeAreaTargets` — 카드마다 가격 행을 찾는 열쇠를 `a.materialId ?? a.id` 로; 쓰기 `:1028` 은 `prices` 행 id(`rowId`)라 그대로) · `scripts/notify-subscribers.mjs:136-160`(`matchPairs(subs, events, aptById, bundleOf)` — 단지 구독 = 같은 묶음이면)
- Test: `scripts/collect-data.test.mjs`(있으면) 또는 `scripts/_expect-count.test.mjs`(순수 함수) · `scripts/notify-subscribers.test.mjs` · `scripts/collectors/calc-layout.test.mjs`

**Interfaces:**
- Produces:
  - `collect-data.mjs`: `--expect-count=<N>` — 전일 대비 감소가 임계를 넘어도 **이번 장수가 정확히 N 이면** 통과(로그 `[승인 장수] N 일치 — 회귀 가드 통과`). N 과 다르면 종전대로 `exit 1`. 인자가 없을 때 동작 불변. 순수 함수 `evaluateCountGuard({ count, prevCount, expectCount }) → { fired: boolean, threshold: number, reason: string }` export.
  - `notify-subscribers.mjs`: `matchPairs(subs, events, aptById, bundleOf = (id) => id)` — `bundleOf(sub.apartment_id) === bundleOf(ev.aptId)` 면 매칭. 호출부는 apartments 조회 select 에 `complex_key` 를 더해 `bundleOf = (id) => keyById.get(id) ?? id` 를 넘긴다.
  - `calc-layout.mjs`·`backfill-presale-area-notices.mjs`: 쓰는 id = `row.materialId ?? row.id`(VIEW 적용 전엔 `materialId` 가 없어 지금과 같다).
  - `api/upcoming.ts` `findStalePlanIds(sb, rows, today)`: 조회 id = `rows` 의 `memberIds ?? [id]` 를 펼친 것(**200개씩 나눠** `.in` — 응답 1,000행 상한, 맹점 U4), 돌아온 `apartment_id` 는 `구성원 → 카드 id` 표로 바꿔 `latestByApt` 에 카드 id 로 모은다(세션630 `presale-detail.ts` 와 같은 뜻 — 일정은 묶음 안 아무 행에나 붙어 있다). **옛 공고 제외(맹점 U3)**: 일정 행의 `recruit_date` 가 카드 자체 모집일(`presaleRecruitDate`, 파일의 기존 파서 `recruitDateIsPast` 가 읽는 꼴)보다 **이전**이면 판정에서 뺀다(파싱이 안 되면 빼지 않는다) — 2021 공고가 섞인 묶음에서 새 회차 카드가 "지난 공고"로 숨지 않게. `memberIds` 가 없으면 지금과 같다. 순수 함수 `memberIdMap(rows) → { ids: string[], cardOf: Map<string,string> }` export. **배선(맹점 U1)**: `UPCOMING_SELECT`(27~30)에 `memberIds` 를 더한다 — 단 **VIEW 적용 전에는 그 칸이 없어 PostgREST 가 칸 없음 오류(42703)를 낸다** → `handleGet` 의 VIEW 조회는 먼저 `memberIds` 를 포함해 묻고, 오류 메시지에 `memberIds` 가 있으면 **빼고 한 번 더** 묻는다(맹점 U2 — "VIEW 적용 전에 합쳐도 화면 그대로"). 시험은 핸들러를 거친다: 가짜 sb 가 첫 조회에 칸 없음 오류를 주면 두 번째 조회 select 에 `memberIds` 가 없고 응답은 200.

- [ ] **Step 1: 실패하는 시험**

`scripts/_expect-count.test.mjs`(새로):

```js
// @ts-check
import { describe, it, expect } from "vitest";
import { evaluateCountGuard } from "./collect-data.mjs";
describe("evaluateCountGuard — 전환일 1회용 승인 장수(세션635)", () => {
  it("감소가 임계 안이면 미발동", () => { expect(evaluateCountGuard({ count: 1900, prevCount: 1933, expectCount: null }).fired).toBe(false); });
  it("감소가 임계를 넘으면 발동(임계 = max(150, 12%))", () => {
    const r = evaluateCountGuard({ count: 1600, prevCount: 1933, expectCount: null });
    expect(r.fired).toBe(true); expect(r.threshold).toBe(192);
  });
  it("승인 장수와 정확히 같으면 통과", () => { expect(evaluateCountGuard({ count: 1600, prevCount: 1933, expectCount: 1600 }).fired).toBe(false); });
  it("승인 장수와 다르면 발동", () => { expect(evaluateCountGuard({ count: 1601, prevCount: 1933, expectCount: 1600 }).fired).toBe(true); });
});
```

`collect-data.mjs` 는 `// @ts-check` 가 없고 CLI 진입점이다 — export 하나를 더해도 `isCLI` 가드(`import.meta.url` 비교)가 있는지 Read 로 확인한다. 없으면 `main()` 호출이 import 때 돈다 → 그 경우 순수 함수를 `scripts/_count-guard.mjs` 새 파일로 빼고 `collect-data.mjs` 가 import 한다(시험도 그 파일을 import).

`scripts/notify-subscribers.test.mjs` 에: `matchPairs([{ id: 1, phone: "01000000000", region: null, apartment_id: "ah-2" }], [{ aptId: "ah-1", houseNo: "H", receiptDate: "2026-10-20", url: null }], new Map([["ah-1", { name: "하양", region: "경북" }]]), (id) => ({ "ah-1": "K", "ah-2": "K" })[id] ?? id)` 가 1쌍 · `bundleOf` 기본값이면 0쌍.

`api/upcoming.test.ts`(이미 있고 `findStalePlanIds` 시험 13건 — 거기에 추가): 가짜 sb 가 `.in("apartment_id", ids)` 로 받은 `ids` 를 기록하게 해, `rows = [{ id: "ah-1", presaleStage: "분양계획", presaleRecruitDate: null, memberIds: ["ah-1", "ah-2"] }]` 이고 일정표가 `{ apartment_id: "ah-2", general_rank1_bgnde: "2026-01-01", recruit_date: "2025-12-01" }` 를 돌려주면 ① 조회 ids 에 `ah-2` 가 들어 있고 ② 결과 `stale` 에 **`ah-1`**(카드 id)이 있다 · `memberIds` 없는 행은 지금과 같다(조회 ids = `["ah-1"]`) · **반대 방향(U3)**: 카드 `presaleRecruitDate: "2026.11"` 이고 묶음의 일정 행이 `recruit_date: "2021-05-01"`(접수일 과거)뿐이면 `stale` 에 **없다** · 구성원 id 450개면 `.in` 호출이 3번(200·200·50) · **핸들러 경로(U1·U2)**: `handleGet` 을 가짜 req/res 로 불러 첫 VIEW 조회 select 에 `memberIds` 가 있고, 가짜 sb 가 `{ error: { message: 'column apartments_flat.memberIds does not exist' } }` 를 주면 두 번째 조회 select 에 `memberIds` 가 없으며 응답 200.

`scripts/collectors/calc-layout.test.mjs` 에: 대상 행 `{ id: "ah-1", materialId: "ap-9", name: "하양", area: 84 }` 로 쓰기 계획을 만들면 update 대상 id 가 `ap-9`, `materialId` 없으면 `ah-1`(순수 함수가 없으면 쓰기 계획을 만드는 작은 함수 `layoutTargetId(row)` 를 export 해 시험).

- [ ] **Step 2: 빨강** — 세 시험 파일 `exit=1`.

- [ ] **Step 3: 구현**

`collect-data.mjs` 1126~1141 의 임계 판정을 함수로:

```js
/**
 * 전일 대비 장수 회귀 가드(세션311 12%) + 전환일 1회용 승인 장수(세션635 — "한 단지 = 한 장" 다) 전환일에
 * 약 2,662 → 2,375 로 줄어 임계에 걸린다. 비율 완화가 아니라 **승인한 숫자와 정확히 같을 때만** 통과 — data-changing-run-approval §2).
 * @param {{ count: number; prevCount: number; expectCount: number | null }} a
 */
export function evaluateCountGuard({ count, prevCount, expectCount }) {
  const threshold = Math.max(150, Math.ceil(count * 0.12));
  const diff = count - prevCount;
  if (expectCount != null) {
    return count === expectCount
      ? { fired: false, threshold, reason: `[승인 장수] ${expectCount} 일치 — 회귀 가드 통과` }
      : { fired: true, threshold, reason: `[승인 장수] ${expectCount} 와 다름(실제 ${count}) — 회귀 가드 발동` };
  }
  if (diff <= -threshold) return { fired: true, threshold, reason: `count 전일 대비 ${diff} 감소 (이전 ${prevCount} → 신규 ${count}, 임계값 -${threshold}) — 회귀 가드 발동` };
  return { fired: false, threshold, reason: `전일 대비 count 변동: ${diff >= 0 ? "+" : ""}${diff} (${prevCount} → ${count}, 임계값 -${threshold})` };
}
```

호출부: `const expectArg = process.argv.find((a) => a.startsWith("--expect-count=")); const expectRaw = expectArg ? expectArg.split("=")[1] : (process.env.EXPECT_COUNT || null); const expectCount = expectRaw == null ? null : Number(expectRaw); if (expectRaw != null && !Number.isInteger(expectCount)) { logError("supabase-only", "--expect-count / EXPECT_COUNT 는 정수여야 합니다"); process.exit(1); }` 를 파일 읽기 앞에, 그리고 `const g = evaluateCountGuard({ count: apartments.length, prevCount, expectCount }); if (g.fired) { logError("supabase-only", g.reason); process.exit(1); } log(`  ${g.reason}`);`. `daily-deploy.yml` 의 `collect-data --from-supabase-only` 호출은 **바꾸지 않는다** — 전환일 1회는 메인이 `workflow_dispatch` 입력 또는 손 실행으로 `--expect-count` 를 준다(운영 단계 B-4; 워크플로에 `inputs.expect_count` 를 더하는 쪽이 안전 — `.github/workflows/daily-deploy.yml` 의 `workflow_dispatch:` 에 `inputs: expect_count: { description: "전환일 1회용 승인 장수", required: false }` 를 넣고, 셸에 바로 끼우지 않고(🟡6) collect-data 단계 `env:` 에 `EXPECT_COUNT: ${{ inputs.expect_count }}` 로 넘긴다. 스크립트는 `--expect-count=` 인자 **또는** `process.env.EXPECT_COUNT`(비어 있지 않을 때)를 읽고 정수가 아니면 `exit 1`. cron 실행에선 env 가 빈 문자열이라 지금과 같다).

`handleGet`(64~)의 VIEW 조회: 페이징 함수 `fetchAllUpcoming`(43~62)이 고르는 칸 문자열을 **인자**로 받게 하고(`fetchAllUpcoming(sb, select)`), `handleGet` 은 먼저 `UPCOMING_SELECT + ", memberIds"` 로 **고리 전체**를 돌리다가 오류 `message` 에 `memberIds` 가 들어 있으면 `UPCOMING_SELECT` 그대로 **처음부터 다시**(재검사 후속 5 — 페이지 중간에 바꾸지 않는다). 그 밖의 오류는 지금처럼. 응답 꼴 불변.

`scripts/collectors/data-audit.mjs:641-676`(맹점 O10): VIEW id 로 `infra`·`schools`·`transport`·`trade_stats`·`prices` 를 붙이는 자리의 열쇠를 **재료 행**으로 — `fetchViewIds` 가 `id` 만 읽던 것을 `id, materialId` 로 읽어 `materialOf: Map<id, materialId ?? id>` 를 만들고, 파생표 조회·조인 열쇠에 `materialOf.get(a.id)` 를 쓴다(`materialId` 칸이 없으면(VIEW 적용 전) 지금과 같다). 신뢰도 거울(609~620)은 VIEW 출력 칸을 읽으면 변경 0, 원본 표 칸에서 다시 계산하면 `units` 항을 VIEW 의 `units` 로 — 작업반이 Read 로 가른다. 시험 1건: `materialId` 가 다른 행의 파생표가 붙는다.

`static-outputs.mjs:14` 배열에 `"noticeName"` 추가. `compute-scores.mjs` `clearStaleScores` 안, 비우기 전 로그: `log(PHASE, `낡은 점수 정리 예정 ${staleIds.length} / 점수 있는 행 ${withScore} = ${ratio}% (안전판 ${STALE_CLEAR_MAX_RATIO * 100}%)`);` — 변수 이름은 그 함수 안의 실제 이름을 Read 로 맞춘다.

`calc-layout.mjs:117-119` select 에 `materialId` 를 더하고(`select("id, materialId, name, area")`), 284~287 쓰기 id 를 `layoutTargetId(apt)` 로:

```js
/** VIEW 행의 layout 을 어느 원본 행에 쓰나 — 재료 행(세션635 다 · 대표 ≠ 재료인 묶음 388 에서 대표 행에 쓰면 화면에 안 나온다). */
export function layoutTargetId(row) { return row.materialId ?? row.id; }
```

`backfill-presale-area-notices.mjs:805`(VIEW 조회 select 에 `materialId`) → `selectNoticeAreaTargets(visible, priceRows, hasSupply)`(638~697)에서 `visible` 의 카드마다 `byApt.get(String(a.id))` 로 가격 행을 찾는 자리를 `byApt.get(String(a.materialId ?? a.id))` 로(targets 의 `aptId` 도 그 값). 쓰기(1028)는 `prices` 행 id(`rowId`)라 그대로. 시험 1건: `visible=[{ id:"ah-1", materialId:"ap-9", … }]`·`priceRows=[{ apartment_id:"ap-9", house_type:"presale_min", … }]` 이면 대상이 잡힌다(없으면 0건).

`api/upcoming.ts` `findStalePlanIds` 의 (A) 블록:

```ts
  // (A) 청약홈 공식 접수시작일 교차 검증 — 세션635: 일정은 같은 묶음의 아무 행에나 붙어 있으므로 구성원 id 전부로 묻고 카드 id 로 되돌린다.
  //     200개씩 나눠 묻는다(응답 1,000행 상한 — 한 행에 공고가 여럿). 카드 자체 모집일보다 이전 공고는 뺀다(옛 회차가 새 회차를 가리지 않게).
  const { ids: planIds, cardOf } = memberIdMap(planRows);
  const recruitOf = new Map(planRows.map((r) => [r.id, r.presaleRecruitDate]));
  const data: any[] = [];
  for (let i = 0; i < planIds.length; i += 200) {
    const res = await sb
      .from("presale_schedule_official")
      .select("apartment_id, general_rank1_bgnde, special_receipt_bgnde, recruit_date")
      .in("apartment_id", planIds.slice(i, i + 200));
    if (res.error || !res.data) return stale; // 조회 실패 시 (A) 미적용(fail-open) — (B) 결과는 유지
    data.push(...res.data);
  }
  const latestByApt = new Map<any, { bgn: string | null; recruit: string | null }>();
  for (const row of data) {
    const cardId = cardOf.get(row.apartment_id) ?? row.apartment_id;
    if (noticeIsBeforeCard(row.recruit_date, recruitOf.get(cardId))) continue; // 옛 공고(카드 모집일보다 이전)는 판정에서 뺀다
    const bgn = row.general_rank1_bgnde || row.special_receipt_bgnde || null;
    const prev = latestByApt.get(cardId);
    if (!prev || (row.recruit_date && (!prev.recruit || row.recruit_date > prev.recruit))) {
      latestByApt.set(cardId, { bgn, recruit: row.recruit_date ?? null });
    }
  }
```

```ts
/** 일정 행의 공고일이 카드 자체 모집일(YYYY.MM 꼴 — recruitDateIsPast 가 읽는 꼴)보다 이전인가. 둘 중 하나라도 못 읽으면 false(빼지 않는다). */
export function noticeIsBeforeCard(recruitDate: unknown, cardRecruit: unknown): boolean {
  const n = /^(\d{4})-(\d{2})/.exec(String(recruitDate ?? ""));
  const c = /^(\d{4})[.\-/](\d{1,2})/.exec(String(cardRecruit ?? ""));
  if (!n || !c) return false;
  return `${n[1]}${n[2]}` < `${c[1]}${c[2].padStart(2, "0")}`;
}

/** 카드 행들의 구성원 id 전부 + 구성원 → 카드 id 표(memberIds 가 없으면 자기 id 만). */
export function memberIdMap(rows: Array<{ id: string; memberIds?: string[] | null }>): { ids: string[]; cardOf: Map<string, string> } {
  const cardOf = new Map<string, string>();
  for (const r of rows) {
    cardOf.set(r.id, r.id);
    for (const m of Array.isArray(r.memberIds) ? r.memberIds : []) if (!cardOf.has(m)) cardOf.set(m, r.id);
  }
  return { ids: [...cardOf.keys()], cardOf };
}
```

`notify-subscribers.mjs` `matchPairs` 시그니처에 `bundleOf = (/** @type {string} */ id) => id` 를 더하고 `matched = sub.apartment_id === ev.aptId` → `matched = bundleOf(sub.apartment_id) === bundleOf(ev.aptId)`. 호출부(apartments 로스터를 `aptById` 로 만드는 자리)에서 select 에 `complex_key` 를 더해 `const keyById = new Map(rows.map((r) => [r.id, r.complex_key ?? r.id]))` → `matchPairs(subs, events, aptById, (id) => keyById.get(id) ?? id)`.

- [ ] **Step 4: 초록 + 정적 가드 + 타입** — 세 시험 + `scripts/collectors/_graceful-coverage.test.mjs` + `scripts/_selectall-keycol-coverage.test.mjs` `exit=0` · `tsc -p tsconfig.scripts.json` `exit=0` · `node scripts/audit-env-keys.mjs`·`audit-orphan-collectors.mjs`·`audit-collector-patterns.mjs`·`audit-hooks-wiring.mjs` 각 `exit=0`(워크플로 inputs 를 더했으므로).
- [ ] **Step 5: 변이 2종** — G1 `count === expectCount` 를 `true` 로 → "승인 장수와 다르면 발동" 빨강 · G2 `bundleOf(sub.apartment_id) === bundleOf(ev.aptId)` 를 `sub.apartment_id === ev.aptId` 로 → 알림 시험 빨강.
- [ ] **Step 6: 올려 두기** — `<스크래치>/commit-msg-10.txt`: `feat(scripts): 전환일 1회용 --expect-count · noticeName 상세 버킷 · 점수 정리 사전 집계 로그 · layout/면적은 재료 행에 · 알림은 같은 묶음이면 (한 단지 = 한 장 다)` · `git add -- api/upcoming.ts api/upcoming.test.ts scripts/collect-data.mjs scripts/_expect-count.test.mjs scripts/static-outputs.mjs scripts/compute-scores.mjs scripts/collectors/calc-layout.mjs scripts/collectors/calc-layout.test.mjs scripts/backfill-presale-area-notices.mjs scripts/notify-subscribers.mjs scripts/notify-subscribers.test.mjs .github/workflows/daily-deploy.yml`(+ `_count-guard.mjs` 를 뺐으면 그 파일).

---

### Task 11: (삭제 — 맹점 O11) 감시 ㉒ "같은 열쇠인데 카드가 둘"은 VIEW 가 `COALESCE(complex_key, id)` 로 한 행씩 내므로 **구조상 늘 0** 이라 아무것도 지키지 않는다. 열쇠 칸의 낡음은 감시 ⑭(세션588)가, 묶음 규칙 ↔ 칸의 어긋남은 매일 `assign-complex-keys --apply`(바뀐 행만 고침 · 실패는 ⑬)가 이미 본다. 설계서 §4-3 ②(번호 주인이 다른 단지 새로 생김)는 라) 뒤처리(BACKLOG A-14)로. **이 Task 는 작업 없음** — 번호는 뒤 Task 참조를 깨지 않으려 남긴다.

<details><summary>삭제된 원문(참고)</summary>

### (옛) Task 11: 감시 ㉒ "같은 열쇠인데 카드가 둘" (설계서 §4-3)

**Files:**
- Modify: `scripts/monitor-collectors.mjs`(새 점검 `checkBundleSplit` — 매일 `runDailyGuardedChecks` ⑱·㉑ 뒤, fail-open · kind `bundle-split`) · `scripts/notify-telegram.mjs`(번호 범위 문구 "⑦~㉑" → "⑦~㉒" 한 곳 — `grep -n "㉑" scripts/notify-telegram.mjs`)
- Test: `scripts/monitor-bundle-split.test.mjs`(새로) · `scripts/monitor-check-failed.test.mjs`(매일 묶음에 ㉒ 반영)

**Interfaces:**
- Produces: `checkBundleSplit(sb)` — `apartments_flat` 에서 `complexKey` 별 행 수를 세어(`select("id, complexKey")` 를 `selectAll(..., "id")` 로 전수) 2 이상인 열쇠가 있으면 경보 1건(`kind: "bundle-split"`, 명단 최대 20). `complexKey` 칸이 없으면(VIEW 적용 전) `"점검 실행 실패"` 가 아니라 **건너뜀 0건**(칸 부재는 다) 적용 전 정상 — 로그 한 줄). 순수 함수 `findSplitBundles(rows) → Array<{ key, ids }>` export.

- [ ] **Step 1: 시험** — `findSplitBundles([{ id: "a", complexKey: "K" }, { id: "b", complexKey: "K" }, { id: "c", complexKey: "L" }])` → `[{ key: "K", ids: ["a", "b"] }]` · 빈 입력 → `[]` · `complexKey` 가 null 인 행은 세지 않는다. 가짜 sb 로 `checkBundleSplit` 이 `complexKey` 없는 응답(PGRST204 또는 칸 undefined)에 빈 배열을 돌려주는 시험 1건(이 레포 감시 시험의 가짜 DB 꼴 — `monitor-complex-key.test.mjs` 를 베낀다).
- [ ] **Step 2: 빨강** → **Step 3: 구현**(기존 ⑭ `checkComplexKeyGaps` 의 틀을 그대로 베껴 kind·메시지만) → **Step 4: 초록** `npx vitest run scripts/monitor-bundle-split.test.mjs scripts/monitor-check-failed.test.mjs scripts/monitor-complex-key.test.mjs` + `node scripts/audit-monitor-coverage.mjs` `exit=0` → **Step 5: 변이 1종**(`>= 2` 를 `>= 3` 으로 → 빨강) → **Step 6: 올려 두기** `<스크래치>/commit-msg-11.txt`: `feat(monitor): ㉒ 같은 묶음 열쇠인데 카드가 둘이면 알림 (한 단지 = 한 장 다)`.

> ⚠️ `monitor-collectors.mjs` 는 텔레그램 실발송 — 작업반은 **실행하지 않는다**(시험만).

</details>

---

### Task 12: PR-다 문서 + 전체 시험 + 빌드 + 옛 마이그 경로를 읽는 가드 갱신

**Files:**
- Modify: `supabase/CLAUDE.md`(apartments_flat VIEW 줄 + 묶음 열쇠 그룹 "VIEW 가 이 칸을 읽는 것은 다) 단계" → "세션635 다) 부터 VIEW 가 묶음을 한 장으로 낸다") · `api/CLAUDE.md`(apartments 새 칸 5 · unsold-history 한 달 한 값) · `src/hooks/CLAUDE.md`(useUrlSync 정리 effect = alias 먼저 · useApartmentData idAlias) · `src/components/CLAUDE.md`(재공고 N회 = 청약홈 공고 수 · 공고명 줄) · `scripts/CLAUDE.md`(`--expect-count` · 재료 행 쓰기 · `--follow-units`) · `.claude/BACKLOG.md`(A-14 다) 진행 줄 · 라) 뒤처리 = 좌표 정정 명단·주간 후보 알림·seed D4·`cleanup-listing-based-unsold.mjs:53` 의 "`unsold > units` = 오염" 판정에 묶음 행 제외 넣기(손 실행 도구 — 재검사 후속 3)·상담 옛 id) · 설계서 §5-4 다) 에 `(PR-다 …)`
- [ ] **Step 0: 20261007 VIEW 파일을 글자로 읽는 가드·스크립트를 최신 VIEW 파일로(맹점 O10)** — `grep -rln "20261007000000_view_add_trade_scope\|view_add_trade_scope" scripts api src supabase --include=*.mjs --include=*.ts --include=*.js --include=*.md` 로 찾은 **파일 경로를 읽는** 자리(검사관이 든 예: `api/supabase/apartments.test.ts` 551 부근 · `scripts/collectors/data-audit.test.mjs` 701 부근 · `scripts/build-ownership.mjs` 61 부근 — 줄은 Grep 으로 다시 잰다)를 `20261013000000_view_one_card_bundle.sql` 로 바꾼다. "마이그 20261007000000 미적용" 같은 **문구·오류 메시지**(`compute-scores.mjs:12,71,99` · `monitor-collectors.mjs:2286` 등)는 뜻이 그대로라 **바꾸지 않는다**. 바꾼 뒤 그 시험들이 초록인지(`npx vitest run <그 파일들>`).
- [ ] **Step 1: 문서 한 줄씩**(위 자리마다).
- [ ] **Step 2: 전체 시험 + 빌드 1회(구현자 마지막)** — `npm run test > <스크래치>/t12-all.log 2>&1; echo "exit=$?"` `exit=0` · `npm run typecheck && npm run typecheck:scripts && npm run typecheck:e2e` `exit=0` · `npm run lint && npm run format:check` `exit=0` · `npm run build > <스크래치>/t12-build.log 2>&1; echo "exit=$?"` `exit=0` 뒤 `git status --short -- public/data` 를 본다 — prebuild 가 JSON 을 다시 만들어 바뀌어 있을 수 있다. 작업반은 그 파일을 **올리지 않고**(`git add` 에 넣지 않음) 메인에 보고한다(되돌리기는 메인이 한다 — 작업반은 `git checkout -- <파일>` 금지).
- [ ] **Step 3: 올려 두기** — `<스크래치>/commit-msg-12.txt`: `docs: 한 단지 = 한 장 다) VIEW 조합·옛 id 넘김·시계열 문서 한 줄씩`.

### 운영 단계 B — PR-다 (메인이 한다 · 순서 고정)

B-1. **리허설(코드 합치기 전 · 운영 VIEW 무변경)**: ① 사장님 Dashboard SQL Editor(이 저장소엔 DB 접속 문자열이 없다 · supabase CLI 미연결 — 10/13 실측)에서 `_rehearsal/20261013_one_card_rehearsal_view.sql` Run(별도 이름 VIEW 생성 — 운영 VIEW·표 변경 0, 잠금 0) ② 메인이 `node --env-file=F:/mibunyang/.env.local .omc/artifacts/session63x/rehearsal-compare.mjs > …/rehearsal-compare.log 2>&1`(Task 6 Step 3 의 스크립트, 읽기 전용) → 기대 `single_diff 0` · `rule_mismatch 0` · `missing_new 0` · `new_rows = 묶음 수` · 옛 칸 이름·순서 = `information_schema.columns`(SQL Editor 에서 두 VIEW 의 칸 목록 질의 1회 — 새 칸 5줄만 뒤에) · `name_changed` 표본 10개 눈으로 · roster 31 의 `d11_rep` 30곳이 새 VIEW 의 행 ③ **점수 등급 전후표**(`rehearsal-scores.mjs` — 옛/새 VIEW 행에 같은 엔진으로 점수를 매겨 등급 분포·바뀐 카드 수·중위값 이동, 쓰기 0) + **성능**(🟡5): SQL Editor 에서 `EXPLAIN ANALYZE SELECT * FROM apartments_flat ORDER BY id LIMIT 1000;` 과 같은 것을 `apartments_flat_rehearsal` 에 — 실행 시간이 옛 VIEW 의 2배를 넘으면 CTE 를 손본 뒤 다시(작은 인스턴스 멈춤 이력 — `supabase/CLAUDE.md` 세션460) ④ 전환 전이표(승인 재료): 카드 수 old→new(임대 제외 = `--expect-count` 값) · 흡수되는 카드 `absorbed` 명단 · **새로 생기는 카드 `appeared` 수·명단**(재검사 🟠3) · 제목 바뀌는 카드 수·표본 · 세대수 바뀌는 카드 수(D7≠대표, 10/13 기준 202) · 가격 출처 바뀌는 카드 수 · 점수 등급 바뀌는 카드 수 · 감시 ④ 분모(`ah-` 카드 수) 전후 · **청약홈 실측이 섞인 7묶음의 카드 값**(🟡9 — 예: 탕정 1,626세대 카드에 미분양 3(청약홈 무순위 회차 값, KOSIS 는 113) · 강릉 106/772 · 천왕역 0/440 — 설계 결정(유효 실측 우선)대로지만 사장님이 결과를 보고 가신다) · **나) 뒤 "미분양 > 그 행 세대수"가 되는 행 수·명단**(맹점 R2 — 2u 목록에 보이는 값이라 B-8 통보에 같이) ⑤ 어긋남이 있으면 코드로 돌아가 고친 뒤 `_drop.sql` → 다시 ① ⑥ 다 끝나면 `_rehearsal/20261013_one_card_rehearsal_drop.sql` Run(월요일 권한 지문 감시 ⑩ 전에).
B-2. **검사관**(코드 적대 Opus — VIEW·DB 라 `general-purpose` + `model:"opus"` · 맹점 Opus · 할루 Sonnet) + `migration-safety` 에이전트(2u 는 VIEW 를 안 읽는다 — `ownership.json` `views.apartments_flat` 의 `reads_from`·note 확인 · `apartments` 쓰기 칸 변화 0) → 보완 → 재검사. 검사관에게 B-1 의 대조 결과 파일(시점 포함)을 근거로 준다.
B-3. **사장님 승인(전이표 B-1 ④ + 나) 전이표 A-1 을 한 자리에서)** → **PR-나·PR-다 합치기(같은 날, CI 초록)** → Vercel 배포 → 라이브 화면 **지금과 같음** 확인(VIEW 전 — Review Focus 4).
B-4. **적용 창(사장님 승인 · 시각 창 밖 — 권장 KST 낮 14:30 이후 평일 또는 주말, 월·목 08~14시·03:00~06:30 제외 · **B-3 합치기와 같은 날, 늦어도 다음 매월 9일 05:30 전** — 합친 뒤 9일이 먼저 오면 정기 회차가 승인 없이 묶음 배분을 쓴다(재검사 🟠1) · A-1 승인 파일은 **B-3 당일 다시 떠서** 승인한다 — 사이에 KOSIS 새 달·청약홈 수집기가 값을 바꾸면 A-4 ① 대조에서 멈춘다, 후속 2) — 나)와 다)를 한 창에서 잇는다(맹점 R2: 나)만 반영된 채 하루를 두면 지금 VIEW 가 카드로 내는 작은 회차 행 31곳이 "미분양 61 / 세대수 3" 꼴로 보이고, 이 레포의 정리 도구가 `unsold > units` 를 오염으로 본다)**: ⓪ 되돌림 사본(운영 단계 A-4 ⓪) → **A-4 나) 손 실행** → 전후 행 수·`[묶음]` 로그 확인 ① 사장님 SQL Editor 에서 `20261013000000_view_one_card_bundle.sql` Run(에러 0) ② 메인이 `node --env-file=.env.local -e` 로 VIEW 한 행 `select("id,name,memberIds,materialId").limit(1)` 조회 — PostgREST 캐시가 새 칸을 아는지(안 보이면 `NOTIFY pgrst, 'reload schema'` 재실행) ③ `node scripts/compute-scores.mjs`(운영 쓰기 — 승인 받은 뒤 · 로그에 `정리 예정 N … %` 가 40% 아래인지) ④ `daily-deploy.yml` `workflow_dispatch` 에 `expect_count=<B-1 장수>` 로 굽기 1회 → `gh run watch`(백그라운드 `timeout 3000`) → 라이브 `meta.json` 장수 = 승인 장수. ⓪~④ 사이에 03:00 자동 굽기가 끼지 않는 시각으로.
B-5. **라이브 눈 확인**(`live-verify` 스킬 · playwright chromium + webkit, 비로그인): roster 30곳 중 3곳(하양 614 · 심곡본동 37 · 신림스카이) + roster 밖 제목 예 2곳(올림픽파크 포레온 — 회차 문구 떼짐 · 천왕역 모아엘가 — 공고명 줄) + 동인천 베이프런트((오) 라 그대로여야 함) 카드·상세 · 옛 id 딥링크 `/apt/<구성원 id>` → 대표 카드 + 주소 바뀜 · 관심매물에 옛 id 를 넣어 두고 새로고침 → 남아 있고 토스트 없음 · 미분양 추이 차트 톱니·"전환 달 계단" 눈 확인(캡처 저장) · 공유 링크 · 사이트맵에 대표 id 만.
B-6. **전환 전후 표**(§8): 점수 등급이 바뀐 카드 수(전/후 `cats_cache` 등급표 — 전환 전 사본은 B-4 ③ 직전에 `apartments.id,cats_cache` 를 파일로) · 감시 ④ 분모(`ah-` 카드 수)·⑨ 전후 · `collector_runs` 의 `compute-scores`·`assign-complex-keys` 정상 · 다음 날 09:00 감시 ⑬ 실패 없음·⑭ 조용.
B-7. **되돌리기**(문제 시): 지금 권한 목록을 먼저 적어 둠(`information_schema.role_table_grants` — 되돌리기 파일 머리 주석의 SELECT) → `_rollbacks/20261013000001` Run(DROP + 재생성 + GRANT 재부여, 한 트랜잭션) → 권한 지문 같음 확인(`perm-baseline.mjs` 미리보기) → `compute-scores` 1회 → 굽기 1회(`--expect-count=<옛 장수>`). 화면 코드는 memberIds 가 사라지면 옛 규칙으로 스스로 돌아간다(Task 7).
B-8. 2u 통보(맹점 O13): `ownership.json` 변경은 없다(VIEW 정의만) — 그러나 **나)는 2u 가 행 단위로 읽는 `apartments.unsold/unsold_rate` 의 뜻을 바꾼다**(같은 단지 행 전부 묶음 값 · 작은 회차 행은 `unsold > units` 가 될 수 있음 · `unsold_rate` 는 묶음 률). A-4 뒤 2u 인계 쪽지(`~/.claude/projects/D--naver-estate-web/memory/handoff_from_mibunyang_<날짜>_unsold_bundle.md` + 2u MEMORY.md 한 줄)에 그 세 가지와 해당 행 수·명단 파일 경로를 적는다. PR-다 머지 뒤 `notify-sister` 가 열리면 "VIEW 는 2u 가 안 읽음 · 행 값 변화는 위 쪽지" 한 줄. 라) 뒤처리(좌표 정정 명단 D9 · 주간 후보 알림 · seed D4 켜기)는 BACKLOG A-14 로.

## 검증 계획 (설계서 §8 대응)

| 무엇 | 어떻게 | 어디서 |
|---|---|---|
| 묶음 세대수·대표·재료 규칙 = JS 함수 | `_same-complex.test.mjs`(기존) + VIEW 리허설 roster 대조 | Task 6 · B-1 |
| KOSIS 묶음 분모·같은 값 | `collect-unsold-kosis.test.mjs` 6건 + 변이 3 · 전이표(값 변화 분류·389묶음 같은 값) | Task 2 · A-1 |
| 혼자인 행 출력 무변경 | 리허설 `single_diff = 0` · `name` 만 예외(JS 대조) | B-1 |
| 옛 id 넘김 건수 = 구성원 − 묶음 | 리허설 (2) `new_rows` 와 `apartments` 행 수(3,282 − 2,375 = 907 기대, 10/13 기준) | B-1 |
| 전환 전후 점수 등급표 | `cats_cache` 사본 전/후 등급 분포 + 바뀐 카드 수 | B-6 |
| 카드 수 = 예측 | `--expect-count` 일치 + 라이브 meta | B-4 |
| 화면 3곳 눈으로 | live-verify(chromium·webkit) 캡처 | B-5 |
| 검사관 | PR-나 = 코드 적대 Opus(수집기·DB) + 맹점 Opus + 할루 Sonnet · PR-다 = 같은 3인 + migration-safety · 계획서(이 문서) = 맹점 Opus + 할루 Sonnet | 각 PR 전·합치기 전 |

## 하지 않는 것 (이 계획 밖)

- 상담 신청(`api/consults.ts`·관리자 화면)의 옛 관심 단지 id 를 이름으로 풀기(§4-7 (10) 마지막 줄 — 관리자 화면만의 표시 문제라 라) 뒤처리 BACKLOG 로) · 재료 행 칸 폴백(§6-8 — 빈칸 그대로) · `prices` 시계열 접기(회차별 행이 뜻이 있다) · 좌표 정정 명단(D9, 라) · 규칙이 못 묶는 후보 주간 알림(라) · seed D4 켜기(§5 5번) · 2u 열쇠 칸 읽기 인계(별개) · `unsold_history` 전환 전 달 재계산(차트 "전환 달 계단"은 B-5 에서 그림으로 보고 그때 정한다 — 설계 (5)).
