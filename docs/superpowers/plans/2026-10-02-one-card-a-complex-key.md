# 한 단지 = 한 장 — 가) 열쇠 깔기 구현 계획서

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> 이 레포의 실행 방식: 메인 세션은 조율만 하고, 구현은 작업반(`opus-coder`)이 **전용 워크트리**에서, 검사는 검사관이 따로 한다(전역 `model-selection.md` 사다리). 작업반은 `git commit`·`git push` 를 부르지 않는다 — 단계가 끝나면 커밋 메시지 파일을 쓰고 `git add` 까지만, 커밋은 메인이 한다.

**Goal:** 같은 단지의 여러 행(청약홈 `ah-` · 네이버 분양 `ap-` · 회차 공고)에 같은 값이 들어가는 칸 `apartments.complex_key` 를 만들고, 매일 굽기 앞에서 자동으로 채워지게 한다. **이 단계에서 화면은 하나도 바뀌지 않는다** — 다음 단계(나: 미분양 묶음 배분 · 다: VIEW 조합)가 딛고 설 바닥을 깐다.

**Architecture:** 묶는 규칙은 순수 함수 하나(`assignComplexKeys(rows, exceptions)` — 전 행을 한 번에 받아 묶음 맥락까지 계산)에만 둔다. 칸은 VIEW(SQL)가 읽을 **사본**이고, 배치(`assign-complex-keys.mjs`)가 매일 전 행을 다시 계산해 **바뀐 행만** 고친다. JS 수집기는 칸을 읽지 않고 같은 함수를 직접 부른다(다음 단계).

**Tech Stack:** Node 24 ESM(`.mjs` + `// @ts-check` JSDoc) · Supabase(PostgREST) · Vitest · GitHub Actions(`daily-deploy.yml`) · Postgres 마이그레이션(psql 수동 적용).

**Spec:** `docs/superpowers/specs/2026-10-01-one-complex-one-card.md` (v5) — 특히 §3 D6~D11 · §4-1(열쇠 규칙 1~6 · 예외 명단) · §4-7 (2)(3)(4)(6)(9) · §5-4 가).

## Global Constraints

- **화면 변화 0**: 이 계획은 `api/**` · VIEW `apartments_flat` 를 건드리지 않는다. `src/**` 는 `src/constants/leaseTypes.mjs` 의 **주석 한 줄**만. 건드리는 운영 데이터는 새 칸 `apartments.complex_key` 하나뿐이다.
- **규칙은 한 곳**: 같은 단지 판정은 `scripts/collectors/_same-complex.mjs` 에만 둔다. 다른 파일에 이름 정규화·열쇠 계산을 다시 쓰지 않는다.
- **열쇠 꼴**(글자 그대로): `뼈대#블록 토큰#임대 낱말#L0|L1#시도#구 첫 낱말` — 동(dong)은 안 본다. 이름이 빈 행은 `#only:<id>`, 떼어 낸 행은 끝에 `#only:<id>`, 어느 블록 무리에도 못 붙은 행의 토큰 칸은 `보류:<id>`.
- **대표 행** = `(오)` 뒤로 → 청약홈 행 먼저 → id 오름차순(D11). **재료 행** = `(오)` 뒤로 → 번호 주인 네이버 행(`id = 'ap-' + naver_presale_no`) 중 `presale_min_price` 낮은 것 → id 작은 것 → 없으면 청약홈 id 내림차순 → 나머지 id 내림차순(§4-7 (3)). **세대수 순위** = `naver_presale`(번호 주인 행일 때만 — 주인이 아니면 `naver` 와 같은 순위) > `naver` > `molit` > `applyhome` > 출처 빈 값, `(오)` 행과 1 이하는 제외, 같은 순위면 큰 값(D7 · §4-7 (4)).
- **토큰 없는 행을 블록 무리에 붙이는 한계** = 300m (`ATTACH_MAX_M`).
- **DB 쓰기**: `complex_key` 칸만. 동시 요청 5개 · 묶음 사이 100ms(`compute-scores.mjs` 와 같은 값 — 공유 DB 에 한꺼번에 쏘지 않는다).
- **안전장치 순서**: 조회 → 행 수 대조(받은 행 = 표의 행 수) → 열쇠 계산 → 섞인 묶음 확인(임대·분양 / 시도) → 계획(순수 함수) → 미리보기 출력 → 승인 파일 대조 또는 차단기 → 쓰기.
  - 차단기(매일 자동 실행 `--apply`) = 이미 열쇠가 있던 행이 **30행 또는 10%** 넘게 바뀌거나, **빈칸을 채우는 행이 이미 열쇠가 있던 행보다 많으면**(첫 채우기·칸이 비워진 상태 — 세션589 검사관 A #4) 아무것도 안 쓴다. **개수만 맞추는 우회 인자는 없다**(`--expect-changed` 를 주면 던진다) — 한도를 넘는 반영은 아래 승인 파일로만.
  - 사람이 승인한 반영(첫 채우기·규칙을 바꾼 날) = `--apply-from=<승인한 계획 파일>` — 다시 계산한 계획이 그 파일과 **id·이전 값·새 값까지 전부 같을 때만** 쓴다. `--out` 과 같이 줄 수 없다(같은 경로면 승인 파일을 덮어쓴 뒤 그것과 맞대게 된다). 승인 파일은 DB 를 보기 전에 읽는다. `--out` 은 미리보기에서만 — `--apply` 와도 같이 못 주고, 경로에 파일이 이미 있으면 DB 를 보기 전에 던진다(승인했을 수 있는 파일을 덮지 않는다 — 계획 파일은 늘 새 이름으로, 세션589).
  - 쓸 때도 **이전 값이 그대로인 행만** 고친다(`.eq("complex_key", 이전 값)` · 빈칸이면 `.is("complex_key", null)`) — 조회 뒤 남이 바꾼 행은 0행이 돌아와 실패로 센다.
  - 쓰기 실행(`--apply`·`--apply-from`)이 실패하면 — 안전장치에 걸렸든, 예외로 죽었든, 쓰다가 일부 행이 실패했든(`KEY_WRITE`) — `collector_runs` 에 실패 기록 1행(머리말 `KEY_…`)을 남기고 종료 코드 1. 미리보기는 기록을 남기지 않는다. 예외 하나: 중단 신호(수동 취소 등)를 받으면 partial 기록 + 종료 코드 0 이고, 다음 실행이 남은 행을 이어서 채운다. 단계 시간 한도에 걸리면 기록 없이 죽을 수 있다(레포 규칙 `collector-timeout-rootcause-analysis.md`: 한도 도달 = 유예 0) — 그런 날과 일부 행만 실패한 날(10% 미만 — 감시 ⑬ 이 조용하다)은 감시 ⑭ 가 잡는다(세션589 정정).
  - 인자는 `--apply` · `--apply-from=<파일>` · `--out=<파일>` 셋만 받는다(허용 목록). 다른 인자는 던진다 — 특히 `--dry-run` 을 흘려보내면 `recordCollectorRun` 이 기록을 건너뛰어(`_shared.mjs`), 실제로 쓰고도 흔적이 안 남는다. 미리보기는 인자 없이.
- **미리보기가 기본**: `--apply`·`--apply-from` 없이는 아무것도 쓰지 않는다.
- **운영 폴더 금지**: `F:\mibunyang` 본 폴더는 예약 실행이 도는 운영 코드다. 편집·시험은 워크트리에서만. Bash 는 호출마다 `cd <워크트리> && …` 로 시작한다. `git stash` · `git checkout -- <파일>` 금지(되돌리기는 `cp` 사본).
- **수집기·쓰기 스크립트를 파이프 뒤에 두지 않는다**(`| tail` 금지) — 출력은 `> 파일 2>&1` 로 받고 나서 읽는다.
- **시각 창**: 운영 DB 를 바꾸는 일(마이그레이션·첫 채우기)은 KST 03:00~06:30 과 월·목 08~14시를 피한다. 전체 시험(`npm run test`)·빌드는 01:30~06:30 에 돌리지 않는다.
- 사장님께 보이는 글·작업반 보고는 처음부터 끝까지 한국어(코드 이름·경로·로그 인용만 원문).

## Review Focus

설계서가 말하지 않았지만 이 코드가 실제로 만나게 될 입력 — 각 줄의 시험은 이미 붙임 시험 파일에 있다(괄호 안).

1. **부분 조회** — 페이징이 새서 일부 행만 받은 날. 묶음 맥락이 통째로 틀어지므로 계산하지 않고 실패로 끝나야 한다(`assign-complex-keys.test.mjs` "행 수 대조 → 섞인 묶음 확인 → 승인 파일 대조·차단기 → DB 쓰기 순서다").
2. **새 블록 공고가 들어온 날** — 이미 있던 형제 행의 열쇠도 바뀐다. 그 행까지 고쳐야 하고, 이런 변화가 한도를 넘으면 멈춰야 한다(같은 파일 "새 블록 공고가 들어오면…" · "evaluateChangeBreaker").
3. **승인한 뒤 반영하기 전에 다른 행이 바뀐 경우** — 개수는 같은데 내용이 다른 반영을 막아야 한다(같은 파일 "comparePlanToApproved").
4. **좌표가 없거나 어느 무리와도 먼 토큰 없는 행** — 억지로 붙이지 않고 그 행만의 카드(`_same-complex.test.mjs` "어느 무리와도 300m 넘게…").
5. **이름이 빈 행** — 빈 뼈대끼리 한 장으로 묶이면 안 된다(같은 파일 "이름이 빈 행끼리는 묶지 않는다").
6. **예외 명단을 잘못 적은 경우** — 가리키는 행이 지워졌거나(던지지 않고 계속 돌되 기록에 남긴다), 임대와 분양·서로 다른 시도를 묶었거나(쓰지 않는다), 같은 id 가 묶음·떼어 냄 양쪽에 있거나(명단을 거부한다)(같은 파일 "예외 명단" · "findMixedBundles").
7. **칸이 아직 없을 때 감시가 먼저 도는 경우** — 조용히 "이상 없음"이 아니라 "⑭ 점검 실행 실패" 1건(`monitor-complex-key.test.mjs` "조회가 던지면…").

## 이미 검증한 것 (세션588, 2026-10-02 — 계획서를 쓰며 메인이 붙임 파일을 워크트리에 잠깐 놓고 돌린 결과)

붙임 폴더 = `docs/superpowers/plans/2026-10-02-one-card-a-complex-key.files/` (이하 `<붙임>`). 코드가 길어 계획서 본문에 싣지 않고 **파일로 붙였다** — 작업반은 새로 쓰지 않고 `git mv` 로 제자리에 옮긴 뒤 아래 검증을 **다시** 돌린다. 아래는 맹점 검사관(Opus) 지적 15건 · 보완분 재검사(Opus, 검사관 A2) 지적 8건 · 그 반영분 재검사(Opus, 검사관 A3) 지적 5건 · 마지막 좁은 재검사(Opus, 검사관 A4) 지적 5건을 반영한 **뒤의** 결과다(로그 이름 끝 `-r5`, 03:24~03:26. 감시 쪽은 A4 에서 안 바뀌어 `-r4` 그대로).

| 무엇 | 결과 | 근거(깃 밖 `.omc/artifacts/session588/`) |
|---|---|---|
| `_same-complex.mjs` 의 열쇠 = 시제품 v1(`proto-v1.mjs`)의 열쇠 | **3,256행 전부 글자 그대로 같음**(다른 것 0) · 묶음 2,364 | `verify-draft.log`(스냅숏 10/01 19:07) |
| 예외 명단(always 7쌍 · isolate 3행) 적용 뒤 | 묶음 **2,360**(= 2,364 − 7 + 3) · 구성원 합 3,256 · 임대 섞인 묶음 0 | 같은 로그 · 운영 DB 로 다시 잰 `probe-rep-change2.log`(10/02 02:08)도 2,360 |
| `_same-complex.test.mjs` + `assign-complex-keys.test.mjs` | 두 파일 129건 통과 | `vitest-r5-core.log`(03:24) |
| 변이 M1~M14(공용 모듈) | 14종 모두 빨강 · 되돌림 바이트 동일 | `mutate-same-complex-r5.log` |
| 변이 A1·A2·A4·A5·A7~A41 중 39종(채우기 배치 — 순수 함수 7 · 인자 4 · 실패 경로 8 · `main()` 배선 13 · 쓰기 7) | 39종 모두 빨강(A3·A6 은 개수 승인 인자를 없애면서 대상 코드가 사라져 뺌) | `mutate-assign-r5.log` |
| 감시 ⑭ 편집 + 감시 시험 2파일(`monitor-complex-key` · `monitor-check-failed`) | 32건 통과(02:50) · 변이 N1·N2·N4~N7 6종 빨강(03:10, N3 은 등가 변이라 뺌) · 편집 도구를 두 번째로 돌리면 던지고 아무 파일도 안 바뀜 | `vitest-r3-monitor.log` · `mutate-monitor-r4.log` · `patch-twice.log`. 감시 시험 4파일 67건은 앞 판(`vitest-r2-monitor.log`, 02:07)에서 확인 — 그 뒤 감시 코드는 안 바뀌었다(편집 도구의 쓰는 순서만 바뀜) |
| 정적 가드 3종(`_graceful-coverage` · `_selectall-keycol-coverage` · `_unbounded-query-coverage`) | 통과(검사관 반영 **전** 판으로 01:22 에 확인 — 반영 뒤엔 다시 안 돌림) | `vitest-plan-a.log` |
| `tsc --noEmit -p tsconfig.scripts.json`(모듈·배치·감시 편집을 전부 올린 상태) | 종료 코드 0(03:25) | `tsc-r5b.log`(종료 코드 줄 `tsc_exit=0` 을 로그에 같이 받았다. `tsc-r5.log` 의 오류 4줄은 감시 편집을 안 올린 채 감시 시험만 놓고 돌린 메인의 실수 — 편집을 올리고 다시 돌린 것이 r5b) |

## File Structure

| 파일 | 하는 일 | 이 계획에서 |
|---|---|---|
| `scripts/collectors/_same-complex.mjs` | 이름 정규화 · 열쇠 계산(묶음 맥락·예외) · 섞인 묶음 찾기 · 대표/재료 행 · 묶음 세대수 — 순수 함수만 | 새로(붙임에서 옮김) |
| `scripts/collectors/_same-complex.test.mjs` | 위의 시험(시제품 대조 표본 121행 + 작은 예 + 고르기 함수) | 새로(붙임에서 옮김) |
| `scripts/collectors/_same-complex.fixture.json` | 시험 표본 — 대조군이 속한 맥락의 전 행 121개와 시제품 열쇠 | 새로(붙임에서 옮김) |
| `docs/audits/same-complex-exceptions.json` | 사람이 승인한 예외 명단(묶음 7쌍 · 떼어 냄 3행) | 새로(붙임에서 옮김) |
| `src/constants/leaseTypes.mjs` · `scripts/collectors/_kakao-poi.mjs` | 경고 주석 한 줄씩(이 값을 바꾸면 묶음 열쇠가 바뀐다) | 고침(주석만) |
| `supabase/migrations/20261002000000_apartments_complex_key.sql` | 칸 추가 | 새로(붙임에서 옮김) |
| `supabase/migrations/_rollbacks/20261002000001_rollback_apartments_complex_key.sql` | 칸 삭제 | 새로(붙임에서 옮김) |
| `scripts/collectors/assign-complex-keys.mjs` | 칸을 채우는 배치(미리보기 기본 · 행 수 대조 · 섞인 묶음 확인 · 승인 파일 대조 · 차단기 · 바뀐 행만) | 새로(붙임에서 옮김) |
| `scripts/collectors/assign-complex-keys.test.mjs` | 위의 시험 | 새로(붙임에서 옮김) |
| `.github/workflows/daily-deploy.yml` | 점수 계산 앞에 "Assign complex keys" 단계 | 고침 |
| `scripts/monitor-collectors.mjs` | 감시 ⑭(열쇠 칸이 하루 넘게 빈 행 · 채우기의 마지막 성공이 하루 넘음) | 고침 |
| `scripts/notify-telegram.mjs` | "⑦~⑬" → "⑦~⑭" 한 곳 | 고침 |
| `scripts/monitor-check-failed.test.mjs` | 매일 점검 묶음에 ⑭ 추가 반영 | 고침 |
| `scripts/monitor-complex-key.test.mjs` | 감시 ⑭ 시험 | 새로(붙임에서 옮김) |
| `supabase/CLAUDE.md` · `scripts/CLAUDE.md` · `.claude/BACKLOG.md` | 칸·배치·감시 한 줄씩 | 고침 |
| `<붙임>/` 폴더 | 옮기고 남은 것(도구)은 마지막에 지운다 | 삭제 |

---

### Task 1: 공용 모듈 `_same-complex.mjs` 와 시험·표본·예외 명단

**Files:**
- Create(옮김): `scripts/collectors/_same-complex.mjs` ← `<붙임>/_same-complex.mjs`
- Create(옮김): `scripts/collectors/_same-complex.test.mjs` ← `<붙임>/_same-complex.test.mjs`
- Create(옮김): `scripts/collectors/_same-complex.fixture.json` ← `<붙임>/_same-complex.fixture.json`
- Create(옮김): `docs/audits/same-complex-exceptions.json` ← `<붙임>/same-complex-exceptions.json`
- Modify(주석 한 줄): `src/constants/leaseTypes.mjs` · `scripts/collectors/_kakao-poi.mjs`

**Interfaces:**
- Consumes: `haversineMeters(lat1, lng1, lat2, lng2): number`(`./_shared.mjs`) · `stripRoundWords(name: unknown): string`(`./_kakao-poi.mjs`) · `isLeaseUnit(row): boolean` · `LEASE_NAME_PATTERN: RegExp`(`../../src/constants/leaseTypes.mjs`). 넷 다 이미 있는 것 — 동작은 고치지 않는다.
- Produces(뒤 작업과 다음 단계가 쓰는 이름 — 바꾸지 않는다):
  - `ATTACH_MAX_M: number`(= 300)
  - `normalizeComplexName(name: unknown): { skel: string, bl: Set<string>, dan: Set<string>, lease: string, isOfficetel: boolean }`
  - `assignComplexKeys(rows: readonly KeyRow[], exceptions?: KeyExceptions): Map<string, string>` — `KeyRow = { id, name?, region?, gu?, lat?, lng?, presale_type? }`, `KeyExceptions = { always?: Array<[string, string]>, isolate?: string[] }`
  - `parseComplexExceptions(json: unknown): { always: Array<[string, string]>, isolate: string[] }` — 모양이 틀리거나 같은 id 가 양쪽에 있으면 throw
  - `missingExceptionIds(exceptions: KeyExceptions, ids: ReadonlySet<string>): string[]`
  - `findMixedBundles(rows: readonly KeyRow[], keys: ReadonlyMap<string, string>): Array<{ key: string, why: string, ids: string[] }>` — `why` 는 `"임대·분양 섞임"` · `"시도 섞임"` 또는 둘을 ` · ` 로 이은 것
  - `isPresaleOwner(m: MemberRow): boolean` · `pickRepresentativeId(members: readonly MemberRow[]): string` · `pickMaterialId(members: readonly MemberRow[]): string` · `pickBundleUnits(members: readonly MemberRow[]): { units: number, source: string | null, fromId: string } | null` — `MemberRow = { id, name?, naver_presale_no?, presale_min_price?, units?, unit_source? }`

- [ ] **Step 1: 시험·표본·예외 명단을 먼저 옮긴다(모듈은 아직 — 빨강을 먼저 본다)**

```bash
cd <워크트리> && git mv "docs/superpowers/plans/2026-10-02-one-card-a-complex-key.files/_same-complex.test.mjs" scripts/collectors/_same-complex.test.mjs
cd <워크트리> && git mv "docs/superpowers/plans/2026-10-02-one-card-a-complex-key.files/_same-complex.fixture.json" scripts/collectors/_same-complex.fixture.json
cd <워크트리> && git mv "docs/superpowers/plans/2026-10-02-one-card-a-complex-key.files/same-complex-exceptions.json" docs/audits/same-complex-exceptions.json
```

- [ ] **Step 2: 시험이 "모듈 없음"으로 실패하는지 본다**

Run: `cd <워크트리> && node ../../../node_modules/vitest/vitest.mjs run scripts/collectors/_same-complex.test.mjs > <스크래치>/t1-red.log 2>&1; echo "exit=$?"`
Expected: `exit=1`, 로그에 `_same-complex.mjs` 를 찾지 못한다는 오류(`Failed to resolve import` 또는 `Cannot find module`).

- [ ] **Step 3: 모듈을 옮긴다**

```bash
cd <워크트리> && git mv "docs/superpowers/plans/2026-10-02-one-card-a-complex-key.files/_same-complex.mjs" scripts/collectors/_same-complex.mjs
```

파일을 열어 머리말과 `assignComplexKeys` 를 처음부터 끝까지 읽는다(뒤 작업의 전제다). 핵심 네 군데:

```js
// (1) 묶음 맥락 — 블록 무리가 하나뿐이면 토큰을 열쇠에 넣지 않는다
if (clusters.size <= 1) { for (const r of ms) tokPart.set(r.id, ""); continue; }

// (2) 열쇠 꼴 — 이름이 빈 행은 서로 묶지 않는다
keys.set(r.id, i.skel === ""
  ? `#only:${r.id}`
  : `${i.skel}#${tokPart.get(r.id) ?? ""}#${i.lease}#L${i.isLease ? 1 : 0}#${r.region || ""}#${guFirst(r)}`);

// (3) 예외 — 규칙 열쇠 뒤에 적용
for (const [a, b] of exceptions.always ?? []) { /* a 의 묶음 전체를 b 의 열쇠로 */ }
for (const id of exceptions.isolate ?? []) { /* 그 행만 `${k}#only:${id}` */ }

// (4) 세대수 — naver_presale 표시가 맨 앞 순위인 것은 번호 주인 행뿐
const rank = (m) =>
  m.unit_source === "naver_presale" && !isPresaleOwner(m) ? UNIT_RANK.naver : (UNIT_RANK[m.unit_source ?? ""] ?? 4);
```

- [ ] **Step 4: 시험 통과 확인**

Run: `cd <워크트리> && node ../../../node_modules/vitest/vitest.mjs run scripts/collectors/_same-complex.test.mjs > <스크래치>/t1-green.log 2>&1; echo "exit=$?"`
Expected: `exit=0`, `Test Files  1 passed (1)`, 실패 0건.

- [ ] **Step 5: 변이 14종 — 규칙을 하나씩 고장 내면 시험이 잡는지**

Run: `cd <워크트리> && node "docs/superpowers/plans/2026-10-02-one-card-a-complex-key.files/tools/mutate-same-complex.mjs" "<워크트리 절대경로>" > <스크래치>/t1-mut.log 2>&1; echo "exit=$?"`
Expected: `exit=0`, `M1`~`M14` 열네 줄이 전부 `빨강(잡힘)`, `되돌림 바이트 동일: true`, 마지막 줄 `변이 14종 전부 빨강`. `⚠ 초록(못 잡음)` 이나 `❌`(찾는 글자 없음 · 문법 깨짐 · 시험이 끝까지 못 돎)가 하나라도 있으면 도구가 `exit=1` 로 끝난다 — 멈추고 메인에 보고.

> **변이 도구가 도중에 죽었을 때(세 도구 공통 — `tools/mutate-lib.mjs`)**: 도구는 시작할 때 대상 옆에 `<대상>.mutate-bak` 을 만들고 끝나면 그것으로 되돌린 뒤 지운다. 백업 파일이 남아 있으면 다음 실행이 시작을 거부한다 — `cp <대상>.mutate-bak <대상>` 으로 되돌리고 백업을 지운 뒤 다시 돌린다. 백업도 없는데 대상이 이상하면 올려 둔 판을 꺼내 비교한다: `git show :<루트 기준 경로> > <스크래치>/staged.txt`(줄바꿈이 달라 `cmp` 는 늘 다르다 — `git diff -- <경로>` 로 본다). **`git checkout -- <파일>` 은 쓰지 않는다**(커밋 안 한 구현까지 지운다).

- [ ] **Step 6: 열쇠가 기대는 두 파일에 경고 주석 한 줄씩**

`src/constants/leaseTypes.mjs` 에서 이 줄을 찾아:

```js
export const LEASE_NAME_PATTERN = /국민임대|행복주택|장기전세|재개발임대|청년안심주택/;
```

그 **바로 위**(JSDoc 블록 `*/` 와 이 줄 사이가 아니라, JSDoc 블록의 마지막 줄 ` * @type {RegExp}` 바로 위)에 한 줄을 넣는다:

```js
 * ⚠️ 같은 단지 묶음 열쇠(`scripts/collectors/_same-complex.mjs`)가 이 낱말과 `isLeaseUnit` 결과를 열쇠에 넣는다 — 낱말·유형 목록을 바꾸면 그 단지들의 카드 묶음이 바뀐다. 바꾼 날은 `assign-complex-keys.mjs` 미리보기의 "바뀜" 명단을 본다.
```

`scripts/collectors/_kakao-poi.mjs` 에서 `export function stripRoundWords(name) {` 를 찾아, 그 위 JSDoc 블록의 ` * @param {unknown} name` 줄 바로 위에 한 줄을 넣는다:

```js
 * ⚠️ 같은 단지 묶음 열쇠(`_same-complex.mjs`)도 이 함수로 회차 낱말을 뗀다 — 떼는 낱말을 바꾸면 카드 묶음이 바뀐다. 바꾼 날은 `assign-complex-keys.mjs` 미리보기의 "바뀜" 명단을 본다.
```

Run: `cd <워크트리> && git diff --stat -- src/constants/leaseTypes.mjs scripts/collectors/_kakao-poi.mjs`
Expected: 두 파일 각각 `1 insertion(+)`, 삭제 0.

- [ ] **Step 7: 타입 검사 + 두 파일을 쓰는 시험**

Run: `cd <워크트리> && node ../../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.scripts.json > <스크래치>/t1-tsc.log 2>&1; echo "exit=$?"` → Expected: `exit=0`, `grep -c "error TS" <스크래치>/t1-tsc.log` = 0.
Run: `cd <워크트리> && node ../../../node_modules/vitest/vitest.mjs run scripts/collectors/_same-complex.test.mjs scripts/collectors/_kakao-poi.test.mjs > <스크래치>/t1-related.log 2>&1; echo "exit=$?"` → Expected: `exit=0`.

- [ ] **Step 8: 올려 두기(커밋은 메인)**

`<스크래치>/commit-msg-1.txt` 를 Write 로 만든다:

```
feat(collectors): 같은 단지 열쇠 공용 모듈 _same-complex — 시제품 v1 과 3,256행 동일 (한 단지 = 한 장 가)

- normalizeComplexName · assignComplexKeys(묶음 맥락 · 예외 명단) · findMixedBundles · 대표/재료 행 · 묶음 세대수
- 시험(표본 121행의 열쇠가 시제품과 글자 그대로 같음) · 변이 14종 빨강
- 예외 명단 docs/audits/same-complex-exceptions.json (묶음 7쌍 · 떼어 냄 3행, D6·D8)
- leaseTypes.mjs · _kakao-poi.mjs 에 "바꾸면 묶음 열쇠가 바뀐다" 주석 한 줄씩
```

```bash
cd <워크트리> && git add -- scripts/collectors/_same-complex.mjs scripts/collectors/_same-complex.test.mjs scripts/collectors/_same-complex.fixture.json docs/audits/same-complex-exceptions.json src/constants/leaseTypes.mjs scripts/collectors/_kakao-poi.mjs
```

`SendMessage(to:"main")`: "Task 1 끝 — 시험 통과 · 변이 14 빨강 · tsc 0".

---

### Task 2: 칸 마이그레이션(파일만 — 적용은 메인)

**Files:**
- Create(옮김): `supabase/migrations/20261002000000_apartments_complex_key.sql` ← `<붙임>/20261002000000_apartments_complex_key.sql`
- Create(옮김): `supabase/migrations/_rollbacks/20261002000001_rollback_apartments_complex_key.sql` ← `<붙임>/20261002000001_rollback_apartments_complex_key.sql`

**Interfaces:**
- Produces: 칸 `apartments.complex_key TEXT NULL`(기본값 없음 · 색인 없음 — 3천 행 표라 필요 없다).

- [ ] **Step 1: 두 파일을 옮긴다**

```bash
cd <워크트리> && git mv "docs/superpowers/plans/2026-10-02-one-card-a-complex-key.files/20261002000000_apartments_complex_key.sql" supabase/migrations/20261002000000_apartments_complex_key.sql
cd <워크트리> && git mv "docs/superpowers/plans/2026-10-02-one-card-a-complex-key.files/20261002000001_rollback_apartments_complex_key.sql" supabase/migrations/_rollbacks/20261002000001_rollback_apartments_complex_key.sql
```

실행문은 이것이 전부다(나머지는 주석):

```sql
SET lock_timeout = '5s';
ALTER TABLE apartments ADD COLUMN IF NOT EXISTS complex_key TEXT;
COMMENT ON COLUMN apartments.complex_key IS '…';
RESET lock_timeout;
NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: 같은 번호의 마이그레이션이 없는지 · 실행문이 위와 같은지 확인**

Run: `cd <워크트리> && ls supabase/migrations | grep -c "^20261002"` → Expected: `1`
Run: `cd <워크트리> && grep -vE "^\s*(--|$)" supabase/migrations/20261002000000_apartments_complex_key.sql | grep -cE "^(SET|ALTER|COMMENT|RESET|NOTIFY|  ')"` → Expected: `6`(주석·빈 줄을 뺀 줄이 SET · ALTER · COMMENT · 설명 문자열 · RESET · NOTIFY 여섯 줄)

- [ ] **Step 3: 올려 두기**

`<스크래치>/commit-msg-2.txt`:

```
feat(db): apartments.complex_key 칸 추가 마이그레이션 + 되돌리기 (한 단지 = 한 장 가)

화면 변화 없음 — VIEW 가 이 칸을 읽는 것은 다) 단계. 적용은 메인이 psql 리허설 뒤.
```

```bash
cd <워크트리> && git add -- supabase/migrations/20261002000000_apartments_complex_key.sql supabase/migrations/_rollbacks/20261002000001_rollback_apartments_complex_key.sql
```

⚠️ 작업반은 이 SQL 을 **실행하지 않는다**. 운영 DB 적용은 아래 "운영 단계 2"에서 메인이 한다.

---

### Task 3: 채우기 배치 `assign-complex-keys.mjs`

**Files:**
- Create(옮김): `scripts/collectors/assign-complex-keys.mjs` ← `<붙임>/assign-complex-keys.mjs`
- Create(옮김): `scripts/collectors/assign-complex-keys.test.mjs` ← `<붙임>/assign-complex-keys.test.mjs`

**Interfaces:**
- Consumes: Task 1 의 `assignComplexKeys` · `parseComplexExceptions` · `missingExceptionIds` · `findMixedBundles` · `docs/audits/same-complex-exceptions.json` / `_shared.mjs` 의 `loadEnv` · `log(phase, msg)` · `logError(phase, msg)` · `getSupabase()` · `selectAll(queryFn, sb, keyCol)` · `recordCollectorRun(collector, result)` · `createReporter(phase)` · `sleep(ms)` / `scripts/monitor-briefing.mjs` 의 `WARN_STEPS_MARKER`(시험에서만).
- Produces:
  - `CHANGE_BREAKER_RATIO`(0.1) · `CHANGE_BREAKER_MAX_ROWS`(30) · `UPDATE_CONCURRENCY`(5) · `UPDATE_BATCH_DELAY_MS`(100) · `WARN_MARKER_MISSING_EXCEPTION_IDS`(`"WARN_STEPS: exception-ids-missing"`)
  - `planKeyUpdates(rows: ReadonlyArray<{ id: string, complex_key?: string | null }>, keys: ReadonlyMap<string, string>): { updates: Array<{ id, prev: string | null, next: string }>, filled, changed, unchanged, hadKey }`
  - `evaluateChangeBreaker({ changed, hadKey }): { tripped: boolean, ratio: number, reason: string | null }`
  - `comparePlanToApproved(current: ReadonlyArray<{ id, prev, next }>, approved: unknown): { same: boolean, onlyCurrent: string[], onlyApproved: string[] }` — 어긋난 줄은 `["id","이전","새"]` JSON 꼴(구분자를 이어 붙이지 않는다)
  - `parseArgs(argv: readonly string[]): { apply: boolean, applyFrom: string | null, out: string | null }` — `apply` = `--apply` 또는 `--apply-from`. `argv` 의 앞 두 칸(실행 파일·스크립트)은 건너뛰고, 나머지가 `--apply` · `--apply-from=<파일>` · `--out=<파일>` 이 아니면 던진다(`--dry-run` · `--expect-changed` 포함). 경로가 비었거나, 같은 경로 인자를 두 번 줬거나, `--apply-from` 과 `--out` 을 같이 줘도 던진다
  - CLI: 인자 없음 = 미리보기 · `--out=<절대경로>` = 미리보기 + 계획 파일 · `--apply-from=<계획 파일>` = 승인한 계획과 같을 때만 반영(`--out` 과 같이 못 준다) · `--apply` = 반영(매일 자동). `collector_runs.collector` 이름 = `"assign-complex-keys"`. 실패 기록의 `error_message` 머리말 = `KEY_COUNT_MISMATCH` · `KEY_MIXED` · `KEY_PLAN_MISMATCH` · `KEY_BREAKER` · `KEY_ERROR`(예외로 죽음) · `KEY_WRITE`(쓰다가 일부 행 실패).

- [ ] **Step 1: 시험을 먼저 옮기고 빨강을 본다**

```bash
cd <워크트리> && git mv "docs/superpowers/plans/2026-10-02-one-card-a-complex-key.files/assign-complex-keys.test.mjs" scripts/collectors/assign-complex-keys.test.mjs
```

Run: `cd <워크트리> && node ../../../node_modules/vitest/vitest.mjs run scripts/collectors/assign-complex-keys.test.mjs > <스크래치>/t3-red.log 2>&1; echo "exit=$?"`
Expected: `exit=1`(`assign-complex-keys.mjs` 를 찾지 못함).

- [ ] **Step 2: 스크립트를 옮긴다**

```bash
cd <워크트리> && git mv "docs/superpowers/plans/2026-10-02-one-card-a-complex-key.files/assign-complex-keys.mjs" scripts/collectors/assign-complex-keys.mjs
```

`main()` 을 처음부터 끝까지 읽고 순서가 Global Constraints 의 "안전장치 순서"와 같은지 눈으로 확인한다:

```js
const args = parseArgs(process.argv);          // 모르는 인자(--dry-run 등) · 같은 인자 두 번 · --apply-from + --out 동시는 여기서 던진다
const { apply, applyFrom } = args;
// … 예외 명단 읽기 · (--apply-from 이면) 승인한 계획 파일을 읽고 updates 배열인지 확인 — 전부 DB 를 보기 전 …
const rows = await selectAll((s) => s.from("apartments").select("id,name,region,gu,lat,lng,presale_type,complex_key"), sb, "id");
const { count, error: countError } = await sb.from("apartments").select("id", { count: "exact", head: true });
if (countError || count == null || count !== rows.length) { await failRun(apply, "KEY_COUNT_MISMATCH", why, rows.length); return; }
const keys = assignComplexKeys(rows, exceptions);
const mixed = findMixedBundles(rows, keys);
if (mixed.length > 0) { await failRun(apply, "KEY_MIXED", why, rows.length); return; }
const plan = planKeyUpdates(rows, keys);
// … 미리보기 출력 · --out 저장 …
const breaker = evaluateChangeBreaker(plan);
if (!apply) { /* 미리보기 종료 */ return; }
if (applyFrom != null) {
  const cmp = comparePlanToApproved(plan.updates, approvedUpdates);
  if (!cmp.same) { await failRun(apply, "KEY_PLAN_MISMATCH", why, rows.length); return; }
} else if (breaker.tripped) { await failRun(apply, "KEY_BREAKER", …, rows.length); return; }
// … 5개씩 · 100ms 간격으로 .update({ complex_key: u.next }).eq("id", u.id) + 이전 값 조건(.eq / .is null) + .select("id") …
```

`failRun(apply, marker, why, rowCount)` = 로그 + (쓰기 실행일 때만) `collector_runs` failure 1행 + `process.exitCode = 1`. 예외로 죽으면 `main().catch` 가 `KEY_ERROR` 로 같은 일을 한다(`--apply-from` 단독 실행 포함).

- [ ] **Step 3: 시험과 정적 가드 통과 확인**

Run: `cd <워크트리> && node ../../../node_modules/vitest/vitest.mjs run scripts/collectors/assign-complex-keys.test.mjs scripts/collectors/_same-complex.test.mjs scripts/collectors/_graceful-coverage.test.mjs scripts/_selectall-keycol-coverage.test.mjs scripts/_unbounded-query-coverage.test.mjs > <스크래치>/t3-green.log 2>&1; echo "exit=$?"`
Expected: `exit=0`, `Test Files  5 passed (5)`, 실패 0. (정적 가드 셋은 검사관 반영 뒤 판으로는 아직 안 돌렸다 — 여기서 빨강이면 그 가드의 메시지를 메인에 그대로 보고한다.)

- [ ] **Step 4: 변이 39종**

Run: `cd <워크트리> && node "docs/superpowers/plans/2026-10-02-one-card-a-complex-key.files/tools/mutate-assign.mjs" "<워크트리 절대경로>" > <스크래치>/t3-mut.log 2>&1; echo "exit=$?"`
Expected: `exit=0`, 서른아홉 줄 전부 `빨강(잡힘)`(`grep -c "빨강(잡힘)"` = 39), `되돌림 바이트 동일: true`, 마지막 줄 `변이 39종 전부 빨강`. 도구가 도중에 죽었으면 Task 1 Step 5 의 복구 안내대로.

실패 경로와 `main()` 배선의 가드는 **소스 글자를 읽는 정적 가드**다(주석 줄을 뺀 사본에서 줄을 글자 그대로 대조한다). 그래서 이 파일의 그 줄들을 다른 꼴로 고쳐 쓰면(예: `return failRun(…)`) 약속을 지켜도 가드가 빨강이 된다 — 그때는 가드의 줄을 같이 고치고 이 변이 도구를 다시 돌린다.

- [ ] **Step 5: 타입 검사**

Run: `cd <워크트리> && node ../../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.scripts.json > <스크래치>/t3-tsc.log 2>&1; echo "exit=$?"`
Expected: `exit=0`.

⚠️ **이 작업에서 스크립트를 실제로 돌리지 않는다**(미리보기 포함). 칸이 아직 없어 조회가 실패하고, 있더라도 운영 DB 조회는 메인이 "운영 단계 3"에서 한다.

- [ ] **Step 6: 올려 두기**

`<스크래치>/commit-msg-3.txt`:

```
feat(collectors): assign-complex-keys — 묶음 열쇠 칸을 매일 다시 계산해 바뀐 행만 고친다 (한 단지 = 한 장 가)

- 미리보기 기본 · 행 수 대조(부분 조회면 계산 안 함) · 임대·분양/시도 섞인 묶음이면 안 씀
- 차단기 30행 또는 10%(개수만 맞추는 우회 인자 없음 — 한도를 넘는 반영은 --apply-from 으로만)
- --apply-from: 승인한 계획 파일과 id·이전 값·새 값이 전부 같을 때만 반영(--out 과 같이 못 줌 · 파일은 DB 조회 전에 읽음)
- 쓸 때 이전 값이 그대로인 행만 고침 · 쓰기 실행의 실패는 예외 포함 전부 실패 기록 1행(KEY_…)
- 인자는 허용 목록(--apply · --apply-from · --out) — 그 밖은 던짐(--dry-run 을 흘리면 기록이 빠진다)
- 쓰는 칸은 complex_key 하나 · 동시 5 · 100ms 간격 · 시험 + 변이 39종 빨강
```

```bash
cd <워크트리> && git add -- scripts/collectors/assign-complex-keys.mjs scripts/collectors/assign-complex-keys.test.mjs
```

---

### Task 4: 매일 굽기에 "Assign complex keys" 단계

**Files:**
- Modify: `.github/workflows/daily-deploy.yml`("Compute apartment scores" 단계 바로 앞)

**Interfaces:**
- Consumes: Task 3 의 CLI(`--apply`). 환경 변수 `SUPABASE_URL` · `SUPABASE_SERVICE_KEY`(같은 파일의 점수 단계가 이미 쓰는 비밀값 — 새 비밀값 없음).
- Produces: 매일 KST 03:0x 에 `collector_runs` 에 `assign-complex-keys` 1행.

- [ ] **Step 1: 단계를 넣는다**

`.github/workflows/daily-deploy.yml` 에서 이 줄을 찾는다:

```yaml
      - name: Compute apartment scores (cats_cache)
```

그 **바로 위**에(같은 들여쓰기로, 빈 줄 하나를 사이에 두고) 넣는다:

```yaml
      # 묶음 열쇠 칸(apartments.complex_key)을 다시 계산한다 — "한 단지 = 한 장" 가) 단계(세션588).
      # 점수 계산보다 앞에 둔다: 다) 단계에서 VIEW 가 이 칸으로 카드를 묶으므로, 점수와 목록이 새 열쇠 위에서 만들어져야 한다.
      # 실패해도(continue-on-error) · 매달려도(timeout-minutes) 굽기는 어제 열쇠로 계속한다 —
      # 실패는 collector_runs(감시 ⑬)와 감시 ⑭(빈 칸·마지막 성공이 하루 넘음)가 알린다.
      - name: Assign complex keys (apartments.complex_key)
        continue-on-error: true
        timeout-minutes: 10
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
        run: node scripts/collectors/assign-complex-keys.mjs --apply

```

- [ ] **Step 2: 순서와 모양 확인**

Run: `cd <워크트리> && grep -n "name: Assign complex keys\|name: Compute apartment scores\|name: collect-data\|continue-on-error\|timeout-minutes" .github/workflows/daily-deploy.yml`
Expected: 여섯 줄, 줄 번호 오름차순으로 — 잡의 `timeout-minutes: 40` → `Assign complex keys` → `continue-on-error: true` → `timeout-minutes: 10` → `Compute apartment scores` → `collect-data`. `continue-on-error` 는 한 번만 나온다.

- [ ] **Step 3: 워크플로·수집기 감사**

Run(한 줄씩, 각각 `echo "exit=$?"`):
`cd <워크트리> && node scripts/audit-orphan-collectors.mjs`
`cd <워크트리> && node scripts/audit-env-keys.mjs`
`cd <워크트리> && node scripts/audit-cron-concurrency.mjs`
`cd <워크트리> && node scripts/audit-monitor-coverage.mjs`
`cd <워크트리> && node scripts/audit-collector-patterns.mjs`
Expected: 다섯 다 `exit=0`. (`audit-orphan-collectors` 는 이 단계가 없으면 `assign-complex-keys` 를 고아로 잡아 `exit=1` 이다 — 그게 Step 1 이 필요한 이유의 하나.)

- [ ] **Step 4: 올려 두기**

`<스크래치>/commit-msg-4.txt`:

```
ci(daily-deploy): 점수 계산 앞에 Assign complex keys 단계 (한 단지 = 한 장 가)

실패해도 · 10분 넘게 매달려도 굽기는 계속 — 실패는 감시 ⑬·⑭ 가 알린다.
```

```bash
cd <워크트리> && git add -- .github/workflows/daily-deploy.yml
```

---

### Task 5: 감시 ⑭ — 열쇠 칸이 하루 넘게 비었거나 채우기가 하루 넘게 안 돎

**Files:**
- Modify: `scripts/monitor-collectors.mjs`(① `fetchRecentFailureRuns` 바로 뒤에 새 상수 2개 · `checkComplexKeyGaps` · `checkComplexKeyRunStale` · `fetchComplexKeyHealth` ② `runDailyGuardedChecks` 의 머리말·주입 자료형·주입 줄 ③ ⑬ 블록 뒤에 ⑭ 블록)
- Modify: `scripts/notify-telegram.mjs`(`check-failed` 조치 문구의 `(⑦~⑬)` → `(⑦~⑭)` 한 곳)
- Modify: `scripts/monitor-check-failed.test.mjs`(`LABELS` · `okDeps` · "여섯 다 실패" 시험)
- Create(옮김): `scripts/monitor-complex-key.test.mjs` ← `<붙임>/monitor-complex-key.test.mjs`

**Interfaces:**
- Consumes: 같은 파일의 `Issue` 자료형 · `runFailOpenCheck(label, run)` · `getSupabase()`. 새 알림 종류를 만들지 않고 **기존 `kind: "stale"`**(수집기 미발화)을 쓴다 — `notify-telegram.mjs` 의 종류 표를 건드리지 않기 위해서다.
- Produces:
  - `COMPLEX_KEY_GAP_HOURS`(36) · `COMPLEX_KEY_GAP_FETCH_LIMIT`(200)
  - `checkComplexKeyGaps(rows: Array<{ id?, name?, created_at? }>, opts?: { now?: Date, gapHours?: number, fetchLimit?: number }): Issue[]` — 이슈 모양: `{ kind: "stale", collector: "assign-complex-keys", detail: "묶음 열쇠 칸이 빈 단지 N곳 — 만든 지 36시간 넘음", lines: [...3줄], at: <가장 오래된 created_at> }`
  - `checkComplexKeyRunStale(latestSuccess: { finished_at? } | null | undefined, opts?: { now?: Date, gapHours?: number }): Issue[]` — `detail` = `"묶음 열쇠 채우기의 마지막 성공이 N시간 전(기준 36시간)"` 또는 `"묶음 열쇠 채우기의 성공 기록이 없음"`
  - `runDailyGuardedChecks` 의 새 주입 값 `fetchKeyHealth?: () => Promise<{ gapRows: Array<Record<string, any>>, latestSuccess: Record<string, any> | null }>` · 점검 이름 `"⑭ 묶음 열쇠 칸 점검"`

- [ ] **Step 1: 시험을 먼저 옮기고 빨강을 본다**

```bash
cd <워크트리> && git mv "docs/superpowers/plans/2026-10-02-one-card-a-complex-key.files/monitor-complex-key.test.mjs" scripts/monitor-complex-key.test.mjs
```

Run: `cd <워크트리> && node ../../../node_modules/vitest/vitest.mjs run scripts/monitor-complex-key.test.mjs > <스크래치>/t5-red.log 2>&1; echo "exit=$?"`
Expected: `exit=1`(`checkComplexKeyGaps` 가 없어서 — `is not a function` 또는 import 오류).

- [ ] **Step 2: 편집 도구로 세 파일을 고친다**

Run: `cd <워크트리> && node "docs/superpowers/plans/2026-10-02-one-card-a-complex-key.files/tools/apply-monitor-patch.mjs" "<워크트리 절대경로>"; echo "exit=$?"`
Expected: `적용 완료 — 3개 파일`, `exit=0`. 도구는 세 파일의 바꿀 자리를 **전부 먼저 확인한 뒤 한꺼번에** 쓴다 — 찾는 글자가 정확히 1번이 아닌 자리가 하나라도 있으면 던지고 **어느 파일도 안 바뀐다**(두 번째로 돌려도 같다). 던지면 그 사이 대상 파일이 바뀐 것이니 도구 안의 "찾는 글자"를 지금 파일과 맞대 보고, 못 맞추면 멈추고 메인에 보고. 드문 경우로 **쓰는 도중**(파일 잠김 등) 실패하면 앞 파일만 바뀐 채 남을 수 있다 — 그때는 다시 돌리지 말고 Step 3 의 numstat 으로 세 파일을 확인한 뒤, 다르면 올려 둔 판(`git show :<경로>`)으로 그 파일을 되돌리고 처음부터 다시 한다.

들어가는 핵심(도구가 넣는 그대로):

```js
export const COMPLEX_KEY_GAP_HOURS = 36;
export const COMPLEX_KEY_GAP_FETCH_LIMIT = 200;

export function checkComplexKeyGaps(rows, opts = {}) {
  // 만든 지 gapHours 넘은 행만 → 오래된 순 → 1건이라도 있으면 kind "stale" 이슈 1건
}

export function checkComplexKeyRunStale(latestSuccess, opts = {}) {
  const t = latestSuccess?.finished_at ? new Date(latestSuccess.finished_at).getTime() : NaN;
  if (Number.isFinite(t) && now.getTime() - t <= gapHours * 3600000) return [];
  // 오래됐거나 기록이 없으면 kind "stale" 이슈 1건
}

// runDailyGuardedChecks 끝, ⑬ 블록 뒤
issues = issues.concat(await runFailOpenCheck("⑭ 묶음 열쇠 칸 점검", async () => {
  const { gapRows, latestSuccess } = await fetchKeyHealth();
  const gapIssues = checkComplexKeyGaps(gapRows).concat(checkComplexKeyRunStale(latestSuccess));
  console.log(`[monitor] ⑭ 묶음 열쇠 칸 점검: 빈 행 ${gapRows.length}건 · 마지막 성공 ${latestSuccess?.finished_at ?? "없음"} → 이상 ${gapIssues.length}건`);
  return gapIssues;
}));
```

- [ ] **Step 3: 고친 범위 확인**

Run: `cd <워크트리> && git diff --numstat -- scripts/monitor-collectors.mjs scripts/notify-telegram.mjs scripts/monitor-check-failed.test.mjs`
Expected(세션588 실측, 더한 줄·뺀 줄): `monitor-check-failed.test.mjs` 6·3 · `monitor-collectors.mjs` 111·1 · `notify-telegram.mjs` 1·1. 뺀 줄이 이보다 많으면 diff 를 읽는다.

- [ ] **Step 4: 시험 통과 확인**

Run: `cd <워크트리> && node ../../../node_modules/vitest/vitest.mjs run scripts/monitor-complex-key.test.mjs scripts/monitor-check-failed.test.mjs scripts/monitor-local-failures.test.mjs scripts/monitor-applyhome-unsold.test.mjs scripts/_unbounded-query-coverage.test.mjs > <스크래치>/t5-green.log 2>&1; echo "exit=$?"`
Expected: `exit=0`, `Test Files  5 passed (5)`.

- [ ] **Step 5: 변이 6종**

Run: `cd <워크트리> && node "docs/superpowers/plans/2026-10-02-one-card-a-complex-key.files/tools/mutate-monitor.mjs" "<워크트리 절대경로>" > <스크래치>/t5-mut.log 2>&1; echo "exit=$?"`
Expected: `exit=0`, `N1`·`N2`·`N4`·`N5`·`N6`·`N7` 여섯 줄 전부 `빨강(잡힘)`, `되돌림 바이트 동일: true`, 마지막 줄 `변이 6종 전부 빨강`.

- [ ] **Step 6: 타입 검사 + 바뀐 파일 이름이 들어간 다른 시험**

Run: `cd <워크트리> && node ../../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.scripts.json > <스크래치>/t5-tsc.log 2>&1; echo "exit=$?"` → Expected: `exit=0`
Run: `cd <워크트리> && grep -rlE "monitor-collectors|notify-telegram" scripts --include=*.test.mjs | sort > <스크래치>/t5-tests.txt; wc -l < <스크래치>/t5-tests.txt` → 나온 파일 목록 전부를 한 번에 돌린다:
`cd <워크트리> && node ../../../node_modules/vitest/vitest.mjs run $(cat <스크래치>/t5-tests.txt | tr '\n' ' ') > <스크래치>/t5-related.log 2>&1; echo "exit=$?"` → Expected: `exit=0`(코드 글자를 읽는 정적 가드가 다른 시험 파일에 있을 수 있다).

- [ ] **Step 7: 올려 두기**

`<스크래치>/commit-msg-5.txt`:

```
feat(monitor): ⑭ 묶음 열쇠 칸 점검 — 만든 지 36시간 넘은 빈 칸 · 채우기의 마지막 성공이 36시간 넘음 (한 단지 = 한 장 가)

채우기 단계는 실패해도 굽기를 막지 않으므로(continue-on-error) "안 돌았다"를 따로 본다. 새 행이 없는 날에도 잡히게 성공 시각을 같이 본다.
기존 kind "stale" 재사용 · 매일 점검 묶음 일곱 번째 · 시험 + 변이 6종 빨강
```

```bash
cd <워크트리> && git add -- scripts/monitor-collectors.mjs scripts/notify-telegram.mjs scripts/monitor-check-failed.test.mjs scripts/monitor-complex-key.test.mjs
```

---

### Task 6: 문서 · 붙임 폴더 정리 · 최종 게이트

**Files:**
- Modify: `supabase/CLAUDE.md` · `scripts/CLAUDE.md` · `.claude/BACKLOG.md`
- Delete: `docs/superpowers/plans/2026-10-02-one-card-a-complex-key.files/`(남은 `tools/` 포함 전부)

**Interfaces:**
- Consumes: Task 1~5 의 결과.
- Produces: 문서에서 칸·배치·감시를 찾을 수 있다. 붙임 폴더는 사라진다(코드의 사본이 두 곳에 남지 않게).

- [ ] **Step 1: `supabase/CLAUDE.md` — `### apartments 추가 컬럼 그룹` 표의 마지막 줄(`| 청약홈 값 만료 | …`) 바로 아래에 한 줄**

```markdown
| 묶음 열쇠 | 1 (complex_key TEXT — 같은 단지 묶음 열쇠, NULL = 아직 안 채운 새 행 · 읽는 쪽은 `COALESCE(complex_key, id)`. 세션588) | assign-complex-keys(매일 굽기 앞 단계가 전 행을 다시 계산해 바뀐 행만 고친다 · 규칙 = `_same-complex.mjs` · 예외 = `docs/audits/same-complex-exceptions.json`). VIEW 가 이 칸을 읽는 것은 "한 단지 = 한 장" 다) 단계 |
```

- [ ] **Step 2: `scripts/CLAUDE.md` — `## 권한 지문 도구 · 감시 번호 (세션569)` 절의 마지막 항목(`- 세션571: …`) 바로 아래에 두 줄**

```markdown
- 세션588: `collectors/assign-complex-keys.mjs` — 묶음 열쇠 칸(`apartments.complex_key`)을 채운다. 미리보기가 기본. 매일 자동은 `--apply`(이미 있던 열쇠가 30행 또는 10% 넘게 바뀌면 안 씀), 사람이 승인한 반영은 `--apply-from=<계획 파일>`(다시 계산한 계획이 그 파일과 id·이전 값·새 값까지 같을 때만). 받은 행 수 ≠ 표의 행 수거나 한 묶음에 임대·분양/시도가 섞이면 계산·쓰기를 안 한다. 열쇠 규칙(`_same-complex.mjs`)이나 그 재료(`leaseTypes.mjs`·`stripRoundWords`)를 고칠 땐 `_same-complex.test.mjs` 의 시제품 대조(표본 121행)와 운영 미리보기의 "바뀜" 명단을 먼저 본다.
- 세션588: ⑭ = `checkComplexKeyGaps` + `checkComplexKeyRunStale`(kind `stale`, collector `assign-complex-keys` — 만든 지 36시간 넘은 행의 묶음 열쇠 칸이 비었거나, 채우기의 마지막 성공이 36시간을 넘으면 알린다. 채우기 단계는 daily-deploy 에서 실패해도 굽기를 막지 않으므로 "안 돌았다"를 이 점검이 잡는다. 실패 기록은 ⑬).
```

- [ ] **Step 3: `.claude/BACKLOG.md` — A-14 의 "한 단지 = 한 장" 🔴 줄 바로 아래에 한 줄**

```markdown
- 🟠 **"한 단지 = 한 장" 가) 열쇠 깔기 구현(세션588 계획서 `docs/superpowers/plans/2026-10-02-one-card-a-complex-key.md`)** — 공용 모듈·칸·채우기 배치·굽기 앞 단계·감시 ⑭. 운영 순서 = 마이그레이션 적용 → 미리보기 전이표 승인 → 첫 채우기(`--apply-from`) → 그 뒤에 PR 합침. 다음 = 나) 미분양 묶음 배분 계획서(그 전에 설계서 §6-9 결정).
```

- [ ] **Step 4: 붙임 폴더를 지운다**

Run: `cd <워크트리> && git ls-files "docs/superpowers/plans/2026-10-02-one-card-a-complex-key.files" `
Expected: `tools/` 아래 6개 파일만 남아 있다(`apply-monitor-patch` · `make-same-complex-fixture` · `mutate-lib` · `mutate-assign` · `mutate-monitor` · `mutate-same-complex` — 나머지는 Task 1~5 에서 옮겼다). 다른 파일이 남아 있으면 옮기지 않은 것이니 멈추고 확인.

```bash
cd <워크트리> && git rm -r -q "docs/superpowers/plans/2026-10-02-one-card-a-complex-key.files"
```

- [ ] **Step 5: 최종 게이트(전체 1회 — 01:30~06:30 밖에서, 다른 작업반의 전체 시험과 겹치지 않게 메인 신호를 받고)**

각각 `> <스크래치>/gate-<이름>.log 2>&1; echo "exit=$?"` 로 받는다.

`cd <워크트리> && node ../../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.scripts.json` → `exit=0`
`cd <워크트리> && for a in env-keys monitor-coverage collector-patterns fill-matrix orphan-collectors hooks-wiring declared-deps playwright-cache cron-concurrency rules-paths customer-facing-excuses; do node scripts/audit-$a.mjs > /dev/null 2>&1; echo "$a exit=$?"; done` → 열한 줄 전부 `exit=0`
`cd <워크트리> && node --loader ./scripts/alias-loader.mjs scripts/audit-node-esm-chain.mjs` → `exit=0`
`cd <워크트리> && node ../../../node_modules/prettier/bin/prettier.cjs --check src/constants/leaseTypes.mjs` → `exit=0`(주석 한 줄이 서식 검사를 깨지 않는지)
`cd <워크트리> && node ../../../node_modules/vitest/vitest.mjs run` → `exit=0`, 실패 0(전체 시험 — 기준선은 메인이 지시서에 적어 준다)

`src/**` 는 주석 한 줄만 고쳤으므로 `lint` · `typecheck`(src) · `build` 는 CI 에 맡긴다.

- [ ] **Step 6: 본 폴더에 내 새 이름이 새지 않았는지**

Run: `grep -c "complex_key" F:/mibunyang/scripts/monitor-collectors.mjs F:/mibunyang/.github/workflows/daily-deploy.yml; ls F:/mibunyang/scripts/collectors/_same-complex.mjs 2>&1 | tail -1`
Expected: 두 파일 모두 `0`, 세 번째는 "No such file"(본 폴더는 손대지 않았다).

- [ ] **Step 7: 올려 두기 + 최종 보고**

`<스크래치>/commit-msg-6.txt`:

```
docs: complex_key 칸·채우기 배치·감시 ⑭ 안내 + 계획서 붙임 폴더 정리 (한 단지 = 한 장 가)
```

```bash
cd <워크트리> && git add -- supabase/CLAUDE.md scripts/CLAUDE.md .claude/BACKLOG.md
```

최종 보고(응답 본문, 60줄 안팎): 결론 → Task 별 `file:line` → 수치(시험 수·변이 표·tsc·감사 exit) → 안 한 것("안 함 + 이유") → 본 폴더 새 이름 0건.

---

## 운영 단계 (메인 세션 — 작업반 일이 아니다)

순서가 곧 안전장치다. **PR 을 먼저 합치면** 그날 새벽 굽기의 새 단계가 실패한다 — 칸이 없으면 조회 오류로, 칸이 있고 비어 있으면 차단기(`KEY_BREAKER` — 채움이 기존 열쇠보다 많음, 세션589 추가)로 — 그리고 매일 실패 기록과 감시 알림이 온다. (세션589 전 판은 이 경우 승인 없이 전 행을 채웠다.)

1. **구현 PR 만들기(합치지 않는다)** — 작업반 Task 1~6 → 메인이 Task 마다 커밋 → 검사관 3명(할루 Sonnet · 코드 적대 Opus[수집기·DB·감시] · 맹점 Opus, 지시서에 이 계획서와 설계서 경로) → PR 올림. CI 초록 확인.
2. **마이그레이션 적용**(사장님 승인 뒤, psql — 절차 = 메모리 `reference_perm_baseline_ops.md` · `feedback_sql_real_db_rollback_test.md` · `supabase/CLAUDE.md` "마이그레이션 적용" 절. psql 이 안 되면 Dashboard SQL Editor):
   - 리허설은 **한 파일로 한 번에**(손으로 한 줄씩 치지 않는다 — `ADD COLUMN` 은 가장 강한 잠금을 `ROLLBACK` 까지 쥐어서, 그동안 사이트 API·2u 의 조회가 줄을 선다): 스크래치에 `rehearsal.sql` = `BEGIN; SET LOCAL statement_timeout = '10s'; \i <마이그레이션 절대경로>` + 확인 쿼리(파일 머리말) + `SELECT count(*) FROM apartments_flat;` + `ROLLBACK;` 을 만들어 `psql -X -v ON_ERROR_STOP=1 -f rehearsal.sql` 로. 기대 = 확인 쿼리 1행 · VIEW 행 수가 적용 전과 같음 · 몇 초 안에 끝남.
   - 본 적용(`psql -X -v ON_ERROR_STOP=1 --single-transaction -f <마이그레이션>` — `supabase/CLAUDE.md` "적용" 줄 그대로. 한 트랜잭션이라야 `SET lock_timeout` 이 ALTER 에 걸리고, COMMENT 에서 죽어도 반쪽 적용이 안 남는다 — 세션589 검사관 C #2) → 확인 쿼리 1행 → **supabase-js 로 그 칸을 한 번 조회**(`supabase/CLAUDE.md` "칸 추가 뒤 확인" — PostgREST 가 새 칸을 아는지. 탐침은 `select("id,complex_key").limit(1)` 에 `error` 를 찍고, 있는 표·없는 칸 대조군을 같이) → `node scripts/perm-baseline.mjs` 미리보기로 권한 지문 변화 0 확인 → 2u 세션에 "`apartments` 에 칸 하나 추가" 인계 한 줄(`supabase/CLAUDE.md` 마이그레이션 체크리스트 2번 — 2u 는 칸을 하나씩 매핑해 읽으므로 영향 0, 검사관 C 가 `mb_models.py` 로 확인).
   - 시각: **다음 두 시간대를 피한다** — 매일 KST 03:00~06:30(굽기 03:0x · 어린이집 04:30 · 로컬 러너 05:30 이 이 안에 있다)과 월·목 08~14시(네이버 러너). 매월 6일(10/06 화)은 05:30 러너에 molit-units 가 들어 있다. ⚠️ `supabase/CLAUDE.md` 체크리스트 5번은 "ALTER 는 KST 02~03시"다 — 이 칸 추가는 즉시 끝나는 변경(기본값 없는 NULL 칸)이고 `lock_timeout 5s` 가 걸려 있어, 낮에 적용할지를 사장님께 여쭙고 정한다(세션589).
3. **미리보기 → 전이표**(구현 워크트리의 코드로, 조회만). 워크트리에는 비밀값 파일이 없으므로 본 폴더의 것을 **실행 인자로** 읽힌다(파일을 복사하지 않는다 — `loadEnv` 는 이미 있는 환경 값을 덮지 않는다, `_shared.mjs:29`):
   `cd <워크트리> && node --env-file=F:/mibunyang/.env.local scripts/collectors/assign-complex-keys.mjs --out=F:/mibunyang/.omc/artifacts/<세션>/complex-key-plan.json > F:/mibunyang/.omc/artifacts/<세션>/complex-key-dryrun.log 2>&1; echo "exit=$?"`
   - 연결이 안 되면 `SUPABASE_URL + SUPABASE_SERVICE_KEY 필요` 로 멈춘다(아무것도 안 쓴다) — 그때는 실행 방법을 사장님께 여쭌다.
   - 기대(행 수가 10/02 와 같은 3,256 이면): `단지 3256행 → 묶음 2360개 | 빈칸→값 3256 · 값→다른 값 0 · 그대로 0`. 행이 늘었으면 늘어난 행 명단으로 묶음 수 차이를 설명한다.
   - 전이표: 빈칸 → 값 N행 · 값 → 다른 값 0 · 손님 화면에 닿는 수 **0**(이 칸을 읽는 곳이 아직 없다) · 되돌리기 = `UPDATE apartments SET complex_key = NULL;`(또는 되돌리기 마이그레이션) — **단, PR 을 합친 뒤(운영 단계 5 이후)에는 굽기의 `Assign complex keys` 단계를 먼저 빼야 한다.** 칸만 비우면 다음 03:0x 굽기는 차단기(`KEY_BREAKER` — 채움이 기존 열쇠보다 많음)에 걸려 쓰지 않고 매일 실패 알림을 낸다(세션589 — 그 전 판은 승인 없이 다시 채웠다). 굽기 단계를 뺄 때는 `scripts/audit-orphan-collectors.mjs` ALLOWLIST 에 한 줄을 넣는다(안 넣으면 CI 가 고아 수집기로 빨강). VIEW 를 다른 이유로 다시 만든 뒤라면 안쪽 `SELECT *` 가 새 칸을 품어 `DROP COLUMN` 이 실패한다(VIEW 를 먼저 되돌린다). 화면이 이 칸을 읽기 시작한 뒤(다) 단계)라면 그날 모든 카드가 갈라졌다가 되살아나므로, 그때의 되돌리기는 다) 계획서에서 따로 정한다. 부수 효과 = 전 행의 `updated_at` 이 그 시각으로 바뀐다(트리거 `trg_apartments_updated` — 카드 행은 매일 점수 계산이 이미 같은 일을 한다). 카드가 아닌 행(3,256 − 2,639 ≈ 600행)은 처음 한꺼번에 바뀐다 — 닿는 곳 셋을 전이표에 적는다: 관리비 수집기의 회차 순서(`updated_at` 오름차순으로 대상을 고른다) · 2u API 응답의 `updated_at` · 관리자 수집기 상태 화면(세션589 검사관 C #9).
   - 검사관(1의 적대·맹점 검사관)에게 계획 파일의 묶음 명단까지 보게 한다(`data-changing-run-approval.md` §5 — 반영 **전에**). 계획 파일의 `updates` 줄마다 이름·시도·구가 실려 있어 그 파일만으로 명단을 읽을 수 있다(세션589).
   - 반영 전에 되돌릴 사본 1회: `(id, complex_key, updated_at)` 전 행을 파일로(`data-changing-run-approval.md` §3 — 계획 파일은 의도이지 DB 상태가 아니다).
4. **첫 채우기**(사장님 전이표 승인 뒤) — **승인한 그 계획 파일로**:
   `cd <워크트리> && node --env-file=F:/mibunyang/.env.local scripts/collectors/assign-complex-keys.mjs --apply-from=F:/mibunyang/.omc/artifacts/<세션>/complex-key-plan.json > F:/mibunyang/.omc/artifacts/<세션>/complex-key-apply.log 2>&1; echo "exit=$?"`
   약 3,256건 ÷ 5 × 0.1초 + 요청 시간 ≈ 2~4분. 그 사이 행이 생기거나 바뀌었으면 `KEY_PLAN_MISMATCH` 로 아무것도 안 쓰고 끝난다 → 미리보기부터 다시.
   - 확인(세어서): 빈 칸 0행 · `collector_runs` 에 `assign-complex-keys` success ok = 그 행 수 · **2회차 미리보기가 "빈칸→값 0 · 값→다른 값 0"** · DB 의 `(id, complex_key)` 가 계획 파일의 `(id, next)` 와 전부 같음(집합 대조).
5. **PR 합침** — 합침 직전 미리보기 1회(`값→다른 값 0` · 빈칸 = 그 사이 들어온 새 행뿐인지). 첫 채우기 뒤 **36시간 안, KST 09:00 뒤 ~ 03:00 앞**에 합친다(36시간을 넘겨 09:00 전에 합치면 감시 ⑭ 가 "마지막 성공 N시간 전"을 한 번 울린다 — 세션589 검사관 A #12 · C #8). (fetch → 보고 → 사장님 허락) → 본 폴더 `git pull --ff-only`(월·목 08~14시 · 04:30~06:30 밖).
6. **다음 굽기 확인**(다음 날 03:10 뒤): daily-deploy 로그의 `Assign complex keys` 단계가 성공 · `collector_runs` 새 1행(ok = 그날 고친 수, skip = 그대로인 수) · 빈 칸 = 그 뒤 들어온 새 행뿐 · 감시 로그 `⑭ 묶음 열쇠 칸 점검: … 이상 0건`. 월·목 러너와 월요일 seed 로 새 행이 들어온 **다음 날**도 한 번 더 본다(새 행이 채워졌는지 · "바뀜" 명단이 새 블록 공고로 설명되는지).
7. 며칠 문제 없으면 **나) 미분양 묶음 배분 계획서**를 쓴다(그 전에 설계서 §6-9 를 사장님께 여쭌다).

## 다음 단계가 이 단계에서 가져다 쓰는 것

- 나) `collect-unsold-kosis.mjs`: `assignComplexKeys(rows, exceptions)` 로 묶음을 만들고, 묶음마다 `pickBundleUnits(members)` 로 분모를 잡아 한 행으로 접어 `planUnsoldUpdates` 에 넣는다 — 칸을 읽지 않는다(설계서 §4-7 (4)③ · (5)).
- 다) VIEW: `PARTITION BY COALESCE(complex_key, id)` · 대표/재료 행 고르기는 `pickRepresentativeId` / `pickMaterialId` 와 **같은 순서**를 SQL 로 옮기고 같은 표본으로 맞댄다(설계서 §4-7 (2)(3)(9)(10)).
- ⚠️ **세션589 검사관이 다) 계획서로 넘긴 것**(가) 에서는 화면이 칸을 안 읽어 미뤘다 — 다) 전에 닫는다): ① 바뀜 수·합류 수(새 행이 기존 묶음에 들어온 것)를 `collector_runs` 에 따로 남기고 합류 행도 로그에 찍는다 — "어제 왜 카드가 바뀌었나"를 되짚을 이력(C #4) ② 예외 명단 견고화 — `isolate` 는 id 하나만 뗀다(같은 단지의 새 회차 행은 다시 틀린 묶음에 들어간다) · `always` 닻 행의 이름이 바뀌면 엉뚱한 묶음이 합쳐진다 · 예외에 든 행의 유형이 뒤집히면 `KEY_MIXED` 로 배치 전체가 멈춘다(C #6) ③ `KEY_` 실패는 실패 비율과 무관하게 알리기(A #7 — 지금은 10% 미만이면 ⑬ 침묵, ⑭ 가 36시간 뒤) ④ `pickRepresentativeId`·`pickMaterialId` 는 빈 묶음이면 던지고, id 비교가 글자순이다(`ap-10000000` < `ap-6027962`)(A #10) ⑤ `always` 짝의 순서(`[a,b]`)를 바꾸면 묶음은 같아도 열쇠 글자가 바뀐다 — 차단기 30행에 걸릴 수 있다(A #9) ⑥ 주입형 `main` + 가짜 DB 동작 시험(알려진 한계 ⑤ — 그때까지는 `main()` 본문 지문 가드가 다리다) ⑦ 열쇠 재료는 칸 6개(`name`·`region`·`gu`·`lat`·`lng`·`presale_type`)다 — 구 개편 remap·좌표 정정·유형 정정이 열쇠를 바꾼다(C #5 — 규칙 `admin-district-code-reform.md` §2-13 · `data-changing-run-approval.md` §1 에 한 줄씩 넣었다).

## Self-Review (계획서를 쓴 뒤 메인이 한 점검)

- **설계서 대조**: §5-4 가) 의 여섯 부품 — 공용 모듈(Task 1) · 예외 파일(Task 1) · 칸 마이그레이션(Task 2) · `assign-complex-keys.mjs`(Task 3) · 굽기 앞 단계(Task 4) · 감시(Task 5). §4-7 (6) 의 감시 다섯 중 ①빈 칸·마지막 성공(Task 5) ②차단기 ③승인 파일 대조 ④섞인 묶음(Task 3)은 이 단계에 넣었고, ⑤"규칙이 못 묶는 후보 주간 명단"은 §5-4 라) 로 미뤘다(안 함 — 화면이 아직 이 칸을 안 읽어 급하지 않다).
- **맹점 검사관(Opus) 지적 15건 중 이 계획서·붙임 코드에 닿는 것**(`.omc/artifacts/session588/reviews/review-docs-C.md`): #3 세대수 순위(주인 행만 맨 앞) · #4 단계 시간 제한 · #5 워크트리 실행 방법 · #6 `--apply-from` · #7 차단기 30행 + 경고 주석 · #8 감시에 마지막 성공 시각 · #14 예외 명단 안전장치 · #15 리허설을 한 파일로 — 전부 반영. 나머지(#1·#2·#9~#13)는 설계서 §4-7·§6-8~10 에 반영(나)·다) 단계의 일).
- **보완분 재검사(Opus, 검사관 A2) 지적 8건**(`.omc/artifacts/session588/reviews/review-code-A2.md`) — 전부 반영: #1 `--apply-from` + `--out` 동시 거부 · #2 예외로 죽은 `--apply-from` 실행도 실패 기록 + 승인 파일을 DB 조회 전에 읽음 · #3 실패 경로 정적 가드 + 변이(A15~A18·A20·A22) · #4 되돌리기 문장(합친 뒤엔 굽기 단계 먼저) · #5 개수 승인 인자 삭제 · #6 이전 값 조건으로 쓰기 · #7 대조 줄을 JSON 으로 · #8 변이·편집 도구(백업 파일 + finally · 빨강 판정 엄격히 · ❌ 면 종료 코드 1 · 세 파일 확인 뒤 한꺼번에 쓰기 · 복구 안내). 반영하지 않은 🟢 넷(설계 범위 밖이라 기록만): 예외 명단이 국민임대↔장기전세나 같은 시도의 다른 구를 묶어도 경보 없음(명단은 사람이 승인한다) · 첫 채우기가 도중에 끊긴 상태에서 차단기가 걸리면 남은 빈칸 채움도 같이 멈춤(승인 파일로 다시 반영) · 쓰기 일부 실패·중단된 날엔 예외 id 경고가 빠짐(⑭ 가 36시간 뒤에 잡는다) · stale 알림의 공통 조치 문구가 ⑭ 안내와 어긋남(`notify-telegram.mjs:96`).
- **A2 반영분 재검사(Opus, 검사관 A3) 지적 5건** — #1 모르는 인자를 흘려보냄(`--dry-run` 을 붙이면 쓰고도 기록 0행) → 허용 목록 + 같은 인자 두 번 거부 · #2 정적 가드가 글자의 존재·순서만 봄(약속을 깨는 12종이 초록) → 주석 줄을 뺀 사본에서 대조 + 배선 줄 12개를 글자 그대로 못 박음 + 변이 13종 추가(A24~A36) · #3 변이 판정이 "시험 파일을 못 불러옴"을 잡힘으로 셈 → `Tests` 줄의 실패 수만 읽음 · #4 쓰다가 일부 실패한 날의 기록에 머리말 없음 → `KEY_WRITE` · #5 편집 도구가 쓰는 도중 실패하면 일부만 바뀜 → Task 5 Step 2 에 복구 문장. 반영 안 한 것: 주입형 `main` + 가짜 DB 동작 시험(아래 "알려진 한계" ⑤).
- **마지막 좁은 재검사(Opus, 검사관 A4) 지적 5건**(`reviews/review-code-A4.md`) — 판정: 코드 동작은 약속대로, 쓰고도 기록이 안 남는 인자 조합 없음(`node --env-file=… <스크립트> 인자` 꼴에서 인자 자리도 실제로 확인). 지적은 전부 **가드·도구** 쪽이라 시험과 도구만 고쳤다(코드 동작 변화 0 — 그래서 다시 재검사하지 않았다): #1 승인 대조 분기 조건을 가드가 못 박지 않음 → 분기 조건 + 대조 줄을 한 덩어리로 대조 · #2 `rpt.fail` 줄과 꼬리 블록 위치 → 꼬리 일곱 줄을 한 덩어리로, 쓰기 루프 뒤인지까지 · #3 `parseArgs` 호출 줄 · #4 두 조회 줄(필터 없이 읽고 센다) · #5 변이 판정이 색 코드에 깨짐 → `NO_COLOR` + 제어 문자 벗기기. 변이 5종 추가(A37~A41).
- **빈칸 검색**: "나중에"·"적절히" 류 없음. 코드는 붙임 파일로 깃에 들어 있고, 작업반이 새로 쓰는 것은 Task 1 의 주석 두 줄 · Task 4 의 YAML · Task 6 의 문서 네 줄뿐이다.
- **이름 맞춤**: `assignComplexKeys` · `parseComplexExceptions` · `missingExceptionIds` · `findMixedBundles` · `planKeyUpdates` · `evaluateChangeBreaker` · `comparePlanToApproved` · `parseArgs` · `checkComplexKeyGaps` · `checkComplexKeyRunStale` · `fetchKeyHealth` · 수집기 이름 `"assign-complex-keys"` — Task 사이와 붙임 파일에서 같은 글자다.
- **알려진 한계**: ① 붙임 표본의 정답지는 시제품 v1(10/01 19:07 스냅숏)이다 — 규칙을 일부러 바꾸는 날엔 표본의 `expectedKeys` 도 같이 고쳐야 한다(도구 `tools/make-same-complex-fixture.mjs` 는 세션587 산출물이 있는 이 PC 에서만 돈다. 기록으로 남기는 것이지 실행 경로가 아니다). ② 가장 큰 묶음이 지금 19행이다 — 다) 단계의 시계열 조회 한도(id 20개)에 가깝다(설계서 §4-7 (10)). ③ `--env-file` 실행은 계획서를 쓸 때 확인하지 못했다(안전장치가 환경 값 확인 명령을 막았다) — 운영 단계 3 의 첫 미리보기가 첫 확인이다. ④ 붙임 코드는 맹점 검사(C) → 보완분 재검사(A2) → 그 반영분 재검사(A3) → 마지막 좁은 재검사(A4)를 받았다. A4 뒤에 고친 것은 시험·변이 도구뿐이고(코드 동작 변화 0), 그 판(03:2x)의 **시험 파일과 변이 도구는 독립 검사를 받지 않았다** — 운영 단계 1 의 검사관 3명이 본다. ⑤ 실패 경로와 `main()` 배선의 가드는 소스 글자를 읽는 정적 가드다(`main()` 을 실제로 돌려 보는 시험이 아니다) — 줄을 다른 꼴로 고쳐 쓰면 가드도 같이 고쳐야 하고, 줄 중간의 주석으로 끈 코드는 못 본다. **검사관 A3·A4 가 연달아 이 가드에서 구멍을 찾았다**(초록인 채 약속이 깨지는 수정 12종 → 4종). 지금 판에서 알려진 구멍은 막았지만 이 방식은 구멍이 남기 쉽다 — 더 튼튼한 길은 `main` 을 조회·쓰기·파일 읽기를 주입받는 꼴로 바꿔 가짜 DB 로 동작 시험(행 수 어긋남·미리보기·승인 불일치 → 쓰기 0회 등)을 두는 것이다. 이번엔 안 했다(검증 끝난 코드를 다시 뜯는 일이라): **`main()` 을 다음에 고치는 사람이 그때 바꾼다** — 구현 검사관이 지금 필요하다고 판정하면 구현 PR 에서 한다.
