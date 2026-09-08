# `fix-placeholder-addresses.mjs --apply-from=<dry-run json>` — 검토한 목록을 그대로 반영하는 모드 (세션543)

## 배경 (세션542 실사고)

`--apply` 는 미리보기 결과를 적용하는 게 아니라 **전체를 다시 분석**한다. 2026-09-06 새벽 `--apply` 순간
청약홈 API 가 page 1 = **0건**(15분 전 dry-run 은 1,675건)을 돌려줘 A 출처가 통째로 빠진 채 재분석이 돌았고,
승인한 29곳 대신 **33곳**이 옮겨졌다(리버카운티 3곳은 39km 밖 다른 단지). 즉시 6곳 되돌림.
처방 ① 로스터 0건이면 `--apply` 중단(fail-close, PR #478 완료) → 처방 ② **이 모드**.

원칙: "눈으로 본 목록" 과 "반영되는 목록" 이 **같은 파일**이어야 검토가 의미 있다. 재분석은 하지 않는다.

## 목표 (완료 조건)

1. `--apply-from=<json>` 이 주어지면 dry-run JSON(`{generatedAt, tally, rows}`)의 `rows` 중
   `tier ∈ APPLY_TIERS`(`--include-weak` 면 `B_kakao_weak` 포함) **이고** `newLat`·`newLng` 가 유한 숫자인 행만 대상으로 삼는다.
   외부 호출(청약홈 로스터·카카오) **0회**. `KAKAO_KEY` 불필요.
2. **반영 전 전제 검사**: 대상 id 들의 현재 DB `lat/lng` 를 조회해 파일의 `lat/lng`(dry-run 시점 현재값)와 비교한다.
   - 같다 → `apply`
   - DB 가 이미 `newLat/newLng` 와 같다 → `already`(멱등, 재실행 안전)
   - 둘 다 아니다 → `changed`(그 사이 누가 옮김 = 전제 붕괴) → **그 행 skip + 로그**
   - DB 에 행 없음 → `missing` → skip + 로그
3. **반영 직후 대조**: 반영한 id 를 DB 에서 다시 읽어 `lat/lng == newLat/newLng` 확인. 불일치가 1건이라도 있으면 목록을 찍고 `exit 1`.
4. 기본은 **미리보기**(1·2 까지 수행하고 무엇을 어떻게 할지 표로 출력). `--apply` 가 함께 있어야 UPDATE 한다(도구 관례 유지).
5. `--purge-derived` 조합 허용 — 기존 시간창 규칙(`inSafeWindow`/`--force-timing`) 그대로, **반영 성공 id 만** purge.
6. 배타 조합은 `exit 1`: `--apply-from` 과 `--refit-fields` / `--ids-file` / `--limit` / `--out` (의미 충돌).
7. `generatedAt` 이 48시간보다 오래됐으면 **경고**만(중단 아님 — 실제 가드는 2번 전제 검사).
8. 파일 안 같은 id 중복 → 그 id 전부 거부(reason 기록). `rows` 가 배열이 아니면 throw.

## 구현 형태 (기존 구조 답습, 최소 변경)

- 순수 함수 export 3개 (`process.exit`·DB 접근 없음):
  - `selectApplyFromRows(json, { includeWeak })` → `{ rows, rejected: [{ id, reason }] }`
  - `planApplyFrom(fileRows, dbRows)` → `{ apply: [], already: [], changed: [], missing: [] }`
    좌표 동일 판정 = `Math.abs(a - b) < 1e-7`(≈1cm). 테스트에 경계값 명시.
  - `verifyApplied(fileRows, dbRowsAfter)` → `{ ok: string[], mismatch: [{ id, expected, actual }] }`
- 기존 `--apply` 의 UPDATE 루프(L893~905 부근)를 `applyCoordFixes(sb, fixList)` 로 **추출만** 하고 두 경로가 공유.
  기존 경로의 UPDATE 페이로드(`address: newAddress || oldAddress, road_address: null, lat, lng, updated_at`)는 **한 글자도 바꾸지 않는다**.
- `main()`: `const applyFrom = strArg(argv, "--apply-from");` 파싱 → 배타 검사 → `refit`/`idsFile` 분기보다 **앞**에서
  `if (applyFrom) { await runApplyFrom(sb, ...); return; }` — `fetchApplyhomeRoster()`·`selectAll(apartments)` 보다 먼저 반환.
- DB 조회는 refit 분기의 `.in("id", chunk)` 패턴 답습(29~300건 규모, 900 초과 시 300씩).
- 로그: 등급별 대상 수 · rejected 사유별 · apply/already/changed/missing 수 · 반영 성공/실패 · 대조 일치/불일치.
  `changed` 는 id·파일 좌표·DB 좌표를 한 줄씩(사람이 판단할 재료).

## 테스트 (`scripts/fix-placeholder-addresses.test.mjs` 에 추가)

- `selectApplyFromRows`: tier 필터(ok/none/conflict/B_complex 제외, weak 는 옵션일 때만), `newLat` null 제외, 문자열 숫자 거부,
  중복 id 거부, `rows` 비배열 throw, 빈 배열.
- `planApplyFrom`: 4분류 각 1건 + 경계(1e-8 차이 = 같음, 1e-4 차이 = 다름) + `already` 가 `changed` 보다 먼저 판정되는지.
- `verifyApplied`: 전부 일치 / 1건 불일치 / DB 행 누락은 mismatch.
- 배선(소스 grep, 같은 파일 "배선 —" describe 의 `stripComments` 답습, 스트리퍼 자체 점검 포함):
  - `const applyFrom = strArg(argv, "--apply-from");`
  - `if (applyFrom) {` 블록의 위치가 `fetchApplyhomeRoster()` 호출보다 **앞**(indexOf 비교) — 재분석 전 반환
  - 배타 검사 정규식(`applyFrom && (refit || idsFile || limit || outPath)` 꼴)
  - `verifyApplied(` 호출 뒤 `mismatch.length` 로 `process.exit(1)`
  - 기존 `--apply` 경로가 여전히 `applyCoordFixes(` 를 부른다(추출로 끊기지 않았다)
- ⚠️ **뮤테이션 의무** ([guards-must-be-mutation-tested](../../../.claude/rules/meta/guards-must-be-mutation-tested.md)) — 최소 4종, 각각 red 확인:
  ① `selectApplyFromRows` 의 tier 필터 제거 ② `planApplyFrom` 에서 `changed` 를 `apply` 로 흘림 ③ `verifyApplied` 호출 제거
  ④ `if (applyFrom)` 분기를 로스터 조회 **뒤**로 이동.
  원복은 `git checkout -- <파일>` 로 **파일당 한 번에**(백업 덮어쓰기 함정), 뮤테이션 직후 `node --check` 로 문법 확인,
  원복 후 `git diff --stat` 로 의도한 변경만 남았는지 확인. 결과를 보고서에 표로.

## 문서

- 파일 헤더 usage(L101~115 부근)에 `--apply-from` 두 줄(미리보기/반영) 추가, "후속: `--apply-from`" 문구 제거.
- `.claude/BACKLOG.md` 의 🔴 `--apply-from` 항목 → `✅ 완료(세션543, PR #TBD)` 로 갱신(PR 번호는 오케스트레이터가 채움).
- `.claude/rules/collectors/placeholder-coordinates-truth-sources.md` 안티패턴 `"dry-run 을 눈으로 봤으니 --apply 는 그걸 적용한다"`
  항목 끝에 "처방 ② `--apply-from` 적용 완료(세션543)" 한 줄.

## 검증 명령 (구현자 실행)

```bash
node --check scripts/fix-placeholder-addresses.mjs
npx vitest run scripts/fix-placeholder-addresses.test.mjs scripts/collectors/_kakao-poi.test.mjs
npm run typecheck:scripts
```

라이브 dry-run(DB 접근)은 오케스트레이터가 별도로 한다.

## 금지

- **커밋 금지** — 오케스트레이터가 fetch·원격 보고·승인 후 커밋한다.
- 기존 `--apply`·`--refit-fields`·`--ids-file` 경로 동작 변경 금지(추출만).
- `src/` 건드리지 않는다. 순수 함수 안에서 `process.exit`·DB 접근 금지.

---

## v2 — 적대검증(critic) 반영 정정 목록 (2026-09-09, 머지 전 필수)

비평가가 확인한 것: 이 모드는 "파일 행 == 쓰인 행" 은 지키지만 **"검토한 것 == 쓰인 것"** 과 **"덤프 판정이 옳다"** 는 지키지 못한다.
같은 부류의 사고가 더 이른 시점(dry-run 시각)과 더 얕은 지점(인자 오타)으로 옮겨갔을 뿐. 아래를 전부 반영한다.

### F1. 미지·값 없는 인자는 `exit 1` (최우선)
- `main()` 서두에 알려진 인자 화이트리스트: 불리언 `--apply`·`--purge-derived`·`--refit-fields`·`--include-weak`·`--force-timing`,
  값 인자 `--limit=`·`--out=`·`--ids-file=`·`--apply-from=`. 그 외(`--apply-from` 단독, `--apply--from=…`, `--include-week` 등) → 목록을 찍고 `exit 1`.
- 값 인자의 값이 빈 문자열(`--apply-from=`) → `exit 1`.
- 배타 검사는 `numArg` 결과가 아니라 **원시 argv 존재**로 본다(`--limit=0` 이 null 로 사라지는 함정).
- 배선 테스트: 화이트리스트 상수 export + 단위 테스트(순수 함수 `validateArgv(argv) → {unknown:[], empty:[]}`), 배선 grep 1건.

### F2. 덤프에 출처 상태를 기록하고 apply-from 이 검사한다
- `--out` 덤프 = `{ generatedAt, rosterSize, includeWeak, limit, applySet, tally, rows }`.
  `applySet = fixList.map(r => String(r.id))` (그 dry-run 이 콘솔에 "정정 대상"으로 보여준 바로 그 집합).
- `runApplyFrom`: `rosterSize === 0` → `exit 1`("로스터 0건 덤프 — 판정 자체가 틀렸다"). `rosterSize`·`applySet` **부재(구버전 덤프)** → `exit 1`("미리보기를 다시 만들라").
  `limit` 이 있으면 경고 한 줄(개발 표본).
- `selectApplyFromRows(json)` 는 **`applySet` 에 든 id 만** 통과시킨다(등급 재계산 폐지). 검증은 유지: tier ∈ APPLY_TIERS ∪ {B_kakao_weak}, newLat/newLng 유한 숫자, 중복 id 거부.
  `applySet` 에 있는데 rows 에 없는 id → rejected 사유 "applySet 에만 있음". 시그니처에서 `includeWeak` 옵션 제거.
- `--include-weak` 를 `--apply-from` 배타 목록에 추가(반영 집합은 파일이 정한다).

### F3. purge 공백 + 반영 결과 파일
- purge 대상 = `okIds ∪ already 의 id`. `plan.apply.length === 0` 이어도 `purge && already.length > 0` 이면 purge 는 수행(조기 return 금지).
- `--apply` 반영 실행 시(미리보기 아님) `<덤프경로에서 .json 뗀 것>.applied.json` 에 `{ generatedAt, source, ids: okIds ∪ alreadyIds }` 를 쓴다
  → 후속 `--refit-fields --ids-file=…applied.json` / `--purge-derived --ids-file=…` 의 입력. 로그에 경로 출력.
- 기존 테스트 `★ purge 는 반영에 성공한 id 만 지운다` 는 새 의미로 갱신(okIds ∪ already).

### F4. apply-from 미리보기 목록 = dry-run 과 같은 품질
- `plan.apply` 를 `row.distM` 내림차순 정렬 후 30건, 각 줄에 `distM` 표시, 잘리면 `… 외 N건` 한 줄.
- `already` 는 "N건은 이미 새 좌표 — 손대지 않음" 한 줄로 성공과 구분.

### F5. 문구 하향 (과장 제거)
- 헤더/주석의 "구조적으로 못 일어나게" · "근본 처방" → "덤프에 적힌 목록만 반영한다(재분석 0). **덤프 자체가 틀렸으면 그대로 반영된다** — 그래서 `rosterSize`·`applySet` 을 함께 기록하고 검사한다".
- 헤더에 한 줄: "잘못 옮겨진 행(DB 가 파일의 현재 좌표도 새 좌표도 아님)은 `changed` 로 건너뛴다 — 이 모드로 지난 사고를 **되돌릴 수는 없다**."
- 규칙 문서 안티패턴의 기존 지시 "apply 직후 집합 대조" 는 **plain `--apply` 경로에 여전히 필요** — "(`--apply` 경로)" 를 명시하고 처방 ② 문장은 "apply-from 은 덤프 신뢰성 검사(rosterSize·applySet)까지 포함" 으로.
- BACKLOG 항목: ✅ 로 두되 본문에 "보장 범위 = 파일 행==쓰인 행 · 쓰기 전 전제 · 쓰기 후 되읽기 · 덤프 출처 검사(rosterSize·applySet)" 를 적는다.

### 검증 (F1~F5 후)
- 순수 함수 테스트: `validateArgv` · `selectApplyFromRows(applySet 기반)` · 덤프 필드 부재/0 케이스(runApplyFrom 은 비순수이므로 판정만 순수 함수 `checkDumpProvenance(json) → {ok, reason}` 로 빼서 테스트).
- 뮤테이션 추가 ≥3: ①미지 인자 검사 제거 ②`rosterSize===0` 검사 제거 ③applySet 필터 제거(등급으로 되돌림) ④purge 대상에서 already 제거.
- ⚠️ **원복은 `git checkout` 금지(미커밋 작업 전체가 날아간다 — 이번 세션 실사고).** 작업 시작 시 사본을 떠 두고 `cp` + 바이트 비교(`cmp`)로 원복.

## v2 추가 — code-reviewer 반영 (F6~F9)

### F6. 껍데기 가드 수리 ① — "대조 불일치 → exit 1"
- 현 테스트는 `if (mismatch.length > 0) {` 부터 **고정 400자 창**을 보는데, 그 창에 뒤따르는 `if (fail > 0) process.exit(1);` 이 들어와
  불일치 블록의 exit 를 지워도 초록(리뷰어 시뮬레이션 실측). 창을 **다음 문장 경계**로 자른다:
  `const block = SRC.slice(i, SRC.indexOf("purgeDerived(", i))` 안에 `process.exit(1);` 이 있고 `purgeDerived(` 는 없어야 한다.
- 뮤테이션: 불일치 블록의 `process.exit(1);` 삭제 → red 확인.

### F7. 껍데기 가드 수리 ② — "재분석 전 반환"
- 현 순서 가드는 `if (applyFrom) {` 첫 등장 위치만 비교하고 **`return;` 을 안 본다**. 추가:
  `expect(SRC).toMatch(/await runApplyFrom\(sb, \{[^;]*\}\);\s*return;/)` + 순서 비교는 `SRC.indexOf("await runApplyFrom(sb, {")` 위치를 로스터 호출과 비교.
- 뮤테이션: `return;` 삭제 → red 확인.

### F8. 경로 기준 통일
- `--out` 은 cwd 기준(`writeFileSync(outPath)`), `--apply-from` 은 `resolve(ROOT, path)` = 레포 루트 기준 → cwd ≠ 루트면 **다른 파일**을 연다.
  `--apply-from` 을 `resolve(path)`(cwd 기준)로 바꿔 `--out` 과 같은 기준으로. `.applied.json` 도 그 절대경로 옆에.

### F9. `fetchCoordRows` 청크
- 900 상한은 refit 에서 근거 없이 복사된 값(URL 14KB, 16KB 한계 근처). 새 함수는 **항상 300씩** 자른다. refit 분기는 건드리지 않는다(후속).

### F4 보강
- apply-from 미리보기는 재분석이 없어 행 수가 작다 — `apply` 행을 **전부**(distM 내림차순) 찍는다. `already`/`changed`/`missing` 도 전부.

### F5 보강
- 헤더 "already(재실행 안전)" 은 **좌표 한정**임을 명시(파생표 purge 는 F3 로 already 포함).
- BACKLOG 문구 "`newLat` 만" → "`newLat`·`newLng` 둘 다 유한 숫자".
- 전부 실패(okIds 0)면 purge 호출하지 않는다(`purgeIds.length > 0` 일 때만).

## v3 — 2차 리뷰(정정분) 반영 (2026-09-09, 머지 전 · 각 5줄 이내)

- **G1 (F6 가드 재수리)** `test.mjs` "대조 불일치 → exit 1" 가드: 창 방식은 `if (fail > 0) process.exit(1)` 을 앞으로 올리는 리팩터에 뚫리고
  `not.toContain("purgeDerived(")` 는 슬라이스 경계가 그 문자열이라 **항등식**. 앵커 고정으로 교체:
  `expect(SRC).toMatch(/반영 직후 대조 불일치[^\n]*\r?\n\s*process\.exit\(1\);/)` (CRLF 워킹트리라 `\r?` 필수). 항등식 줄 삭제.
  뮤테이션 2종: ①불일치 블록 exit 삭제 ②`if (fail > 0) process.exit(1);` 을 `const purgeIds` 앞으로 이동(+불일치 exit 삭제) → 둘 다 red.
- **G2 (F2 가드 앵커)** 같은 창 방식인 provenance 가드도 앵커로: `/if \(!prov\.ok\) \{[^}]*process\.exit\(1\);/`.
- **G3 (applySet 멤버 탈락 = 덤프 손상 신호)** `runApplyFrom`: `rejected` 중 `applySet` 에 든 id 는 한 줄씩 출력하고, `apply` 면 `exit 1`
  ("applySet 멤버가 검증에서 탈락 — 덤프가 손상·편집됐다. 미리보기를 다시 만들라"). 미리보기면 경고만.
- **G4 (불일치 exit 경로에도 `.applied.json`)** mismatch 블록에서 exit 직전에 같은 경로로 `{ generatedAt, source, ids: purgeTargetIds(matched, alreadyIds), verified: false, mismatch }` 를 쓴다(불일치 id 는 ids 에서 제외 — refit 입력으로 새면 틀린 좌표 기준 재정합). 정상 경로는 `verified: true`.
- **G5 (weak 등급 ↔ 덤프 includeWeak)** `selectApplyFromRows`: `tier === "B_kakao_weak" && json.includeWeak !== true` → rejected("덤프가 weak 를 포함하지 않았다").
- **G6 (`--limit=abc`)** `main()`: `strArg(argv,"--limit") != null && numArg(argv,"--limit") == null` → exit 1(값 오타로 "제한 없음"이 되지 않게). `--limit=0` 은 기존 의미 유지 여부를 확인해 테스트에 명시.
- **G7 (stale 주석)** `test.mjs` "아래 세 순수 함수 … 셋 다" → 실제 개수로.
- **BACKLOG 후속 한 줄**: 기존 `--apply` 경로가 UPDATE 실패 id 까지 purge(`fixList` 전체) — 새 경로(okIds)와 대비, 후속 정정 후보. `--ids-file` 은 ROOT 기준·`.applied.json` 은 cwd 기준 → 절대경로 권장 한 줄(헤더).
- 뮤테이션(G1 2종 + G3 exit 제거 + G4 mismatch 경로 write 제거 + G5 조건 제거) 전부 red, 원복은 사본 `cp`+`cmp`(git checkout 금지).
