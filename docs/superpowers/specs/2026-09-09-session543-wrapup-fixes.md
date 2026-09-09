# 세션543 마무리 정정 — purge 시간창·무정렬 명단 읽기·레거시 purge·경로 안내 (2026-09-09, 맹점 검증 반영)

두 PR(#481 `--apply-from`, #482 seed 이름 중복) 머지 후 독립 맹점 검증(critic)이 잡은 것 중 **오케스트레이터가 직접 재현·확인한** 항목만 담는다.

## W1 — purge 안전 시간창이 화면 재생성 시각을 포함한다 (C1, 확인됨)

- 실측: `daily-deploy.yml` cron 은 `0 18 * * *`(03:00 KST)이지만 최근 8회 실제 실행은 **18:04:36Z~18:09:47Z = 03:04~03:10 KST**. 그 job 은 `apartments_flat`(transport/schools/infra JOIN)을 한 번 SELECT 해 정적 JSON 을 만든다.
- 현 `inSafeWindow`(`scripts/fix-placeholder-addresses.mjs:385-388`) = **03:00~05:30 허용** → 03:00~03:10 에 지우면 "지하철 없음·병원 0" 이 하루 동안 화면에 박힌다(세션539 실사고 재현 경로). 세션542 의 03:10 예약은 13초 차이로 살았다(운).
- 상한도 위험: 재수집(`collect-naver-listings-incremental.yml`)은 05:30 시작이고 `transport-tago` 는 시작 시 대상 목록을 뜬다 → 05:30 직전 purge 는 그날 재수집을 놓친다.

### 처방
1. `inSafeWindow` → **KST 03:20~05:00**(`minutes >= 3*60+20 && minutes <= 5*60`). JSDoc·에러 문구·헤더 갱신.
2. **배포 스냅샷 가드**(순수 판정 + 네트워크 래퍼 분리):
   - `export function deploySnapshotTakenToday(meta, now = new Date())` — `meta.fetchedAt`(라이브 `https://xn--hg3bi2ac4o1ig57cnoa.com/data/meta.json` 의 필드, UTC ISO)이 **오늘(KST) 03:00 이후**면 true. `fetchedAt` 없거나 파싱 불가 → false.
   - `async function assertDeploySnapshotToday()` — 위 URL 을 fetch(타임아웃 10초)해 판정. **실패(네트워크·비정상 JSON)도 false** = fail-close.
   - `main()`: `purge && !forceTiming` 일 때 `inSafeWindow()` 통과 후 **추가로** 이 가드를 통과해야 진행. 실패 메시지: "오늘 03:00 이후 화면 스냅샷(meta.fetchedAt)이 아직 없다 — daily-deploy 가 끝난 뒤 지워라(강행 --force-timing)".
   - `--purge-derived` 가 있는 세 경로(레거시 `--apply`, `--ids-file`, `--apply-from`) 모두 같은 자리(main 서두 가드)에서 걸린다 — 경로별 중복 구현 금지.
3. 테스트: `inSafeWindow` 경계 4점(03:19 false · 03:20 true · 05:00 true · 05:01 false, UTC 로 주입) · `deploySnapshotTakenToday` 4케이스(오늘 03:05 KST true · 어제 03:05 false · fetchedAt 없음 false · 자정 넘김 경계) · 배선 grep(가드가 `inSafeWindow()` 와 함께 `purge && !forceTiming` 분기 안에 있다). 뮤테이션: 하한 03:20→03:00 되돌림 red · 가드 호출 제거 red.
4. 문서: `.claude/rules/collectors/purge-to-recollect-timing.md` §1 창 문구를 **03:20~05:00 + "오늘 meta.fetchedAt 확인"** 으로(실측 8회 표 한 줄 포함) · `scripts/CLAUDE.md:491`(⚠️ 이 파일은 **미커밋 편집이 이미 있다** — 그 위에 덧붙일 것, 되돌리지 말 것) · 도구 헤더/에러 문구.

## W2 — 아파트 명단 읽기 4곳이 정렬 없는 OFFSET 페이징 (C2, 확인됨)

`selectAll(fn, sb)` 에 `keyCol` 이 없으면 옛 offset 경로(`_shared.mjs:637-648`, ORDER BY 없음). 규칙 [[unordered-pagination-loses-rows]] 위반. 대상:

| 파일:줄 | select | 위험 |
|---|---|---|
| `scripts/collectors/collect-applyhome-seed.mjs:348` | `id, name, region, lat, lng` | 빠진 행 → 로스터에도 없고 `findDuplicate` 도 못 찾음 → **insert** → `mapRow` 가 `lat:null, lng:null` 을 `upsertBatch("apartments", …, "id")` 로 덮어써 **고친 좌표가 null 로 회귀**(209곳 정정의 역행 경로) |
| `scripts/collectors/collect-applyhome.mjs:172` | `id` | 경쟁률 대상 누락 |
| `scripts/collectors/collect-applyhome-detail.mjs:254` | `id, name, region` | 상세 대상 누락 |
| `scripts/collect-data.mjs:1071` | `*`(id 포함) | **일일 화면 JSON** 에서 단지 누락/중복 하루(MIN_COUNT 1000·12% 가드는 1~20행을 못 잡음) |

### 처방
- 네 호출에 세 번째 인자 `"id"` 추가(select 에 `id` 가 있음을 위에서 확인). `selectAll` 은 키가 행에 없으면 throw 하므로 select 문은 건드리지 않는다.
- 테스트: 각 파일의 기존 테스트가 `selectAll` 을 `vi.fn()` 으로 mock 하거나(`collect-applyhome*.test.mjs`) 가짜 클라이언트의 `.range()` 에 의존(`collect-data.test.mjs:583`)한다. 후자는 커서 경로(`.order().limit().gt()`)를 지나므로 가짜 클라이언트를 맞추고, **`.range` 를 제공하지 않게** 해 OFFSET 회귀 시 TypeError 가 나게 한다(규칙 문서 세션535 답습). 배선 가드: 네 호출이 `, "id")` 로 끝난다(소스 grep, 좌변 고정).
- BACKLOG `무정렬 offset 페이징 잔여 3자리` 항목(≈L610)은 **inline `.range()` 루프** 기준이라 `selectAll` 키 없는 호출을 세지 않았다. 새 줄 추가: "keyCol 없는 `selectAll` 호출 — 이번 PR 에서 apartments/apartments_flat 4곳 정정. 나머지는 **다중줄 인지 방식**으로 세고(단일줄 grep 은 다음 줄의 keyCol 을 못 본다) 대상 표가 1,000행을 넘는 것만 위험" — **개수는 직접 재서 적고**(`node` 로 파일마다 `selectAll(` 다음 닫는 괄호까지의 인자 수 세기), 이 스펙이나 리뷰의 숫자를 베끼지 않는다.

## W3 — 레거시 `--apply --purge-derived` 가 UPDATE 실패 id 까지 지운다 (M2, 확인됨)

- `scripts/fix-placeholder-addresses.mjs:~1444` `if (purge) await purgeDerived(sb, fixList.map((f) => f.id));` → `res.okIds`(`applyCoordFixes` 가 이미 반환). 실패 행은 옛 좌표 + 파생표 삭제 = 화면 빈칸만 남는다.
- 테스트: 배선 grep("레거시 경로 purge 는 okIds") + 뮤테이션(`fixList.map` 으로 되돌림 red). BACKLOG L561~563 항목 ①은 ✅ 로.

## W4 — `--ids-file` 이 `verified:false` 인 `.applied.json` 을 그대로 받는다 (minor 3)

- `readIdsFile`: `j.verified === false` 면 throw("반영 직후 대조가 불일치했던 applied.json — 사람이 확인해 verified 를 지운 뒤 다시"). 테스트 1건 + 뮤테이션.

## W5 — `/tmp` 안내가 두 폴더를 가리킨다 (C3, 확인됨)

- Git Bash `/tmp` = `C:\Users\user\AppData\Local\Temp`, node `resolve("/tmp/x")` = **`F:\tmp\x`**. 도구 헤더 예시 5곳(`:100,110-111` 부근)의 `/tmp/v2.json` 을 절대경로 예시(`C:/Users/<me>/AppData/Local/Temp/claude/<proj>/<session>/scratchpad/v2.json`)로 바꾸고 한 줄 경고: "`/tmp` 는 셸과 node 가 다른 폴더로 해석한다 — 절대경로만".
- `scripts/CLAUDE.md` 자리표시 절 끝에 같은 한 줄.

## W6 — 문서 일괄

- 규칙 문서 `purge-to-recollect-timing.md`: 창·가드·실측 표. `placeholder-coordinates-truth-sources.md` 정정 절차의 창 언급이 있으면 동일 갱신(grep `03:00`).
- BACKLOG: W2 새 줄 · W3 ✅ · "회색지대(300~500m) 정책·`(예정)` POI 취급" 은 **사장님 결정 항목**으로 1줄(세션542 는 `(20xx년xx월예정)` POI 채택을 성공으로 기록했고 critic 은 제외를 권함 — 양쪽 근거 병기, 코드 변경 없음).

## 검증

```bash
node --check scripts/fix-placeholder-addresses.mjs scripts/collectors/collect-applyhome-seed.mjs scripts/collectors/collect-applyhome.mjs scripts/collectors/collect-applyhome-detail.mjs scripts/collect-data.mjs
npx vitest run scripts/fix-placeholder-addresses.test.mjs scripts/collectors/collect-applyhome-seed.test.mjs scripts/collectors/collect-applyhome.test.mjs scripts/collectors/collect-applyhome-detail.test.mjs scripts/collect-data.test.mjs
npx vitest run scripts/
npm run typecheck:scripts
node scripts/audit-env-keys.mjs && node scripts/audit-fill-matrix.mjs
```
뮤테이션(W1 하한·W1 가드 호출·W2 keyCol 제거 1곳(collect-data)·W3·W4) 각각 red, 원복 `cp`+`cmp`(**git checkout 금지** — 미커밋 편집이 이미 있다).
라이브(오케스트레이터): `node scripts/fix-placeholder-addresses.mjs --purge-derived --ids-file=<빈 ids 파일> --apply` 를 창 밖 시각에 실행 → 시간창 메시지로 exit 1(DB 접근 0) / `--force-timing` 없이 창 안이 아니므로 가드 순서 확인은 단위 테스트로.

## 금지
- 커밋 금지. `src/` 무변경. `selectAll` 본문 무변경. `(예정)` 제외 로직 추가 금지(결정 대기).
