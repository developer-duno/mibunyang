# 안전장치는 "고장 내서" 검증한다 — 통과만 보면 껍데기가 남는다

## 한 줄

**"테스트가 통과한다"와 "그 코드가 지켜진다"는 다르다.** 새로 만든 가드(테스트·감사 스크립트·CI 스텝)는 **일부러 고장 내서 실제로 잡히는지** 확인해야 한다. 통과만 확인하면, 아무것도 지키지 않는 가드가 초록불을 달고 남는다.

> 사건·이력 (세션491 — 뮤테이션 없이 못 잡은 오판 2건: 감사 정규식이 `${{ }}` 공백에서 잘림 · 행복경로만 테스트해 가드가 지워져도 12건 전부 통과) → [rules-history/meta/guards-must-be-mutation-tested.md](../../rules-history/meta/guards-must-be-mutation-tested.md)

## 의무 (새 가드를 만들 때)

새 테스트·감사 스크립트·CI 스텝을 추가하면 **두 방향을 모두** 확인한다. 하나만 보면 절반만 검증한 것이다.

| 방향 | 확인 | 안 하면 |
|---|---|---|
| **정상이 통과하는가** | 손대지 않은 상태에서 `exit 0` / green | 가드가 항상 실패해 CI 를 영구히 막는다 |
| **고장이 걸리는가** | 지키려는 그 코드를 **일부러 되돌려** red / `exit 1` | **아무것도 안 지키는 껍데기**가 초록불을 달고 남는다 |

### 뮤테이션 절차

```bash
cp <대상> /tmp/x.bak                 # 1. 백업
sed -i 's/<가드>/<망가뜨린 형태>/' <대상>   # 2. 일부러 고장
<테스트 명령>                          # 3. red 인지 확인 — green 이면 가드가 무효다
cp /tmp/x.bak <대상>                  # 4. 즉시 원복
git diff --stat <대상>                # 5. 변동 0 확인 (원복 검증)
```

**뮤테이션은 최소 2종**을 권한다 — 조건 뒤집기(`==` → `===`, `if` → `if !`)와 가드 삭제. 하나만 하면 그 하나만 지켜진다.

#### ⚠️ 원복에 `git checkout -- <파일>` 을 쓰지 마라 — **미커밋 작업 전체가 날아간다** (세션543 실사고)

위 절차의 원복은 **사본(`cp`)** 이다. 구현이 아직 커밋되지 않은 상태(이 저장소의 일반적인 "구현 → 뮤테이션 → 커밋" 순서가 그렇다)에서
`git checkout -- <파일>` 로 원복하면 뮤테이션만이 아니라 **그 파일의 구현 전체가 HEAD 로 되돌아간다.** 세션543 에서 코딩 에이전트가
스펙에 적힌 그 지시를 따르다 353줄짜리 구현을 한 번 통째로 잃었다(직후 `grep -c` 가 0 을 돌려줘 발견 → 재적용). 원복은 작업 시작 시 뜬
사본에서 `cp` 하고 `cmp` 로 **바이트 동일**을 확인한다. `git checkout` 은 커밋된 상태에서만 원복 수단이다.

#### ⚠️ 한 파일에 두 곳을 바꿀 땐 **한 번의 원자적 치환**으로 (세션538 실사고)

같은 파일에 치환을 두 번 하면, 두 번째 백업이 **이미 망가진 상태**를 백업한다. 그러면 원복이
1차 뮤테이션 상태로 돌아가고 — 그게 문법상 멀쩡해 보이면 **깨진 코드가 그대로 남는다.**

세션538 실사고: `calc-exclusive-ratio.mjs` 의 게이트 호출과 import 를 따로 치환했더니,
원복 후 `isPlausibleExclRatio(ratio)` 를 부르는데 그 이름은 import 되지 않은 상태가 됐다.
`git status` 는 "수정됨"만 말하고, 테스트도 그 경로를 안 지나면 초록이다. 시스템의
"파일이 디스크에서 바뀌었다" 알림이 아니었으면 그대로 커밋했다.

```bash
# 빨강 — 두 번 부르면 두 번째 백업이 망가진 상태를 담는다
mut <파일> <패턴1> <대체1>;  mut <파일> <패턴2> <대체2>;  restore <파일>

# 초록 — 한 번에 전부 바꾸고, 백업은 그 전에 딱 하나
mut <파일> <패턴1> <대체1> <패턴2> <대체2>;  restore <파일>
```

**원복 검증을 `git status`(수정 여부)로 하지 마라** — 그건 "내 의도한 변경"과 "뮤테이션 잔재"를
구분하지 못한다. 지키려던 그 줄을 **직접 grep 해서 원래 모습인지 확인**하고, 가능하면 그 파일의
정상 동작(dry-run·테스트)을 한 번 더 돌려 같은 결과가 나오는지 본다.

⚠️ 같은 사고의 사촌 둘 — 둘 다 "치환이 안 먹었는데 먹은 줄 안다":
- **CRLF**: 여러 줄 문자열을 그대로 찾으면 안 걸린다(작업 트리가 CRLF 일 때). `\r?\n` 정규식으로.
- **파이썬으로 `/tmp` 파일 열기**: MSYS 경로가 안 통해 조용히 실패한다. node 를 쓴다.
  치환 도구는 **"대상 문자열 없음"을 반드시 시끄럽게 실패**시켜라 — 조용히 넘어가면 옛 결과를
  새 결과로 착각한다.

### ⚠️ 소스를 grep 하는 테스트는 선언부·주석·문자열에 걸린다 (세션 491 실제 사고)

배선(어느 파일을 읽는지, 어떤 인자를 넘기는지)은 순수 함수 테스트로 못 잡아서 소스를 직접 grep 하게 되는데,
**그 정규식이 함수 선언부에도 매칭되면 가드가 통째로 무효**가 된다.

```js
// 빨강 — 호출부를 되돌려도 통과한다
//   `export function findMismatches(lockVersion, found, ...)` 선언부에 매칭되기 때문
expect(src).toMatch(/findMismatches\(\s*lockVersion\s*,/);

// 초록 — 좌변까지 고정해 호출부만 잡는다
expect(src).toMatch(/const\s+issues\s*=\s*findMismatches\(\s*lockVersion\s*,/);
```

같은 이유로 **주석 처리된 코드**도 매칭된다(`_graceful-coverage.test.mjs` 의 `BREAK_REGEX` 가 이 취약점을 갖고 있다 —
`if (rpt.interrupted()) break;` 앞에 `//` 를 붙이면 가드가 죽은 채 통과한다).
소스 grep 가드를 쓸 땐 **좌변·선언 키워드까지 고정**하고, 가능하면 주석을 걷어낸 사본에 돌린다.

**이 함정은 뮤테이션 없이는 절대 안 드러난다** — 정상 상태에서는 어차피 통과하기 때문이다.

#### ⚠️ 그 "주석을 걷어낸 사본" 자체가 코드를 먹을 수 있다 (세션531)

> 사건·이력 (세션531 — 위 처방을 그대로 따랐는데도 가드가 죽어 있었다: 스트리퍼가 문자열 안 `*/*` 를 가짜 주석 시작으로 읽어 34줄이 통째로 지워짐) → [rules-history/meta/guards-must-be-mutation-tested.md](../../rules-history/meta/guards-must-be-mutation-tested.md)

```js
// 빨강 — 문자열 안 "*/*" 가 주석 시작이 된다
code.replace(/\/\*[\s\S]*?\*\//g, " ")

// 초록 — 줄머리 고정. 블록 주석은 언제나 줄머리(들여쓰기 허용)에서 시작하고,
//        문자열 안 "*/*" 는 그렇지 않다.
code.replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, " ")
```

**판별법**: 스트리퍼를 통과시킨 사본에서 **내가 겨누는 문자열이 실제로 남아 있는지**부터 센다.
`expect(src).toMatch(...)` 를 쓰기 전에 `src.includes("<겨누는 식별자>")` 로 존재를 먼저 확인하면
"가드가 뭘 검사하는지도 모르는 채 통과"를 막는다. 두 번째 안전망은 언제나 뮤테이션이다 —
이 사고도 **스트리퍼를 옛 판본으로 되돌리는 뮤테이션**이 red 를 내는지로 잠갔다.

⚠️ 정규식 폭이 넓은 도구(주석 제거·코드 정규화·`sed` 일괄 치환)는 **문자열 리터럴을 구분하지
못한다**. 그런 도구를 가드의 전처리로 쓰면, 전처리 자체가 검사 범위를 조용히 깎는다.

#### ⚠️ 그 결함을 고치는 가드조차 **표적을 잘못 고르면 껍데기다** (세션539)

> 사건·이력 (세션539 — 세션531 처방을 그대로 따라 스트리퍼를 고쳤는데 표적을 지워지는 구간 바깥에서 골라 뮤테이션 128건이 전부 green) → [rules-history/meta/guards-must-be-mutation-tested.md](../../rules-history/meta/guards-must-be-mutation-tested.md)

**처방 = 무엇이 실제로 지워지는지 먼저 재라.** 옛/새 두 판본을 같은 파일에 돌려 **줄 단위로 비교**한다:

```js
const a = OLD(src).split("\n"), b = NEW(src).split("\n");
const diffs = []; for (let i = 0; i < b.length; i++) if (a[i] !== b[i]) diffs.push(i + 1);
// 이 diffs 안에 있는 식별자만이 유효한 표적이다
```

#### ⚠️ 줄머리 고정만으로는 부족하다 — 두 위험이 **반대 방향**이다 (세션539)

즉 위험이 둘이고 서로 반대다: ①문자열 안 `*/*` 를 주석으로 **오인**(고정이 막음)
②줄 중간 주석을 **못 지움**(고정이 만듦). 한 정규식으로 둘 다 못 막으니 **두 단계로 나눈다**:

```js
.replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, blank)   // ① 줄머리 블록 주석 — 문자열은 줄머리에서 시작 안 함
.replace(/(?<!\*)\/\*[\s\S]*?\*\//g, blank)    // ② 줄 중간 — `*` 뒤의 `/*`(= `*/*`)만 제외
```

> 사건·이력 (세션539 — 줄머리 고정만 걸었더니 기존 테스트가 red 로 잡음: 줄 중간 블록 주석을 못 지워 주석 처리된 exit 이 "안전장치 있음"으로 오인됨. 다른 4개 형제 파일이 무사했던 건 테스트로 안 지켜서일 뿐) → [rules-history/meta/guards-must-be-mutation-tested.md](../../rules-history/meta/guards-must-be-mutation-tested.md)

#### ⚠️ 뮤테이션 치환을 셸 인라인으로 쓰면 역슬래시가 붕괴한다 (세션539)

> 사건·이력 (세션539 — `node -e`/heredoc 안 정규식이 무너져 문법 오류로 죽은 것을 "red"로 오독할 뻔함) → [rules-history/meta/guards-must-be-mutation-tested.md](../../rules-history/meta/guards-must-be-mutation-tested.md)

- 치환 스크립트는 **파일로 저장**하고 `String.raw` 를 쓴다(셸을 거치지 않는다).
- 뮤테이션 직후 **`node --check <파일>` 으로 문법부터 확인**한다 — 이게 "고장 나서 red"와
  "깨져서 red"를 가르는 유일한 방법이다.
- 치환 도구는 **대상을 못 찾으면 시끄럽게 실패**시킨다(조용히 넘어가면 옛 결과를 새 결과로 착각).

### exit code 측정 함정

```bash
# 빨강 — $? 가 head 의 것이라 항상 0
node scripts/audit-x.mjs | head -4; echo "exit=$?"

# 초록 — 파이프 없이 받고 나서 출력
node scripts/audit-x.mjs > /tmp/x.log 2>&1; echo "exit=$?"; head -4 /tmp/x.log
```

> 사건·이력 (세션491 — 이 함정에 빠져 "뮤테이션이 exit 0" 이라는 잘못된 관측을 함) → [rules-history/meta/guards-must-be-mutation-tested.md](../../rules-history/meta/guards-must-be-mutation-tested.md)

## 적용 시점 (의무)

- `scripts/audit-*.mjs` 신설 → CI 등록 전
- 회귀 가드 목적의 테스트 신설 (특히 "이 구조가 되돌아오는 것을 막는" 테스트)
- `_graceful-coverage.test.mjs` 의 **ALLOWLIST 에서 항목을 제거**할 때 — 검사 대상에 넣었으면 그 가드가 실제로 잡는지 확인
- CI 에 새 스텝 추가

## 안티 패턴

- ❌ "테스트 N건 전부 통과 → 안전" — **통과는 절반의 검증**이다
- ❌ "감사 5종 통과 → 이번 변경도 안전" — 그 감사가 **이번 변경을 검사하지 않을 수 있다**. 세션 491 실사례: `audit-fill-matrix` 는 "cron 가진 collector" 를 검사하는데 cron 을 지우는 변경이라 **오히려 더 쉽게 통과**했다. 통과가 안전 근거가 못 된다
- ❌ 행복 경로만 테스트 — 가드가 필요 없는 입력만 넣으면 가드가 지워져도 모른다
- ❌ 파이프(`| head`)로 exit code 측정
- ❌ 뮤테이션 후 원복 확인 생략 — `git diff --stat` 으로 변동 0 을 반드시 본다

## ⚠️ 주기·설정을 바꾸면 그것을 읽는 감시도 함께 바꾼다 (세션 491)

> 사건·이력 (세션491 — 워크플로 cron 을 월간→분기로 내리고 monitor-collectors.mjs 를 안 고쳐 진짜 장애 경보가 "미발화"로 덮여 사라짐. 세션463 기록과 방향만 반대로 재발) → [rules-history/meta/guards-must-be-mutation-tested.md](../../rules-history/meta/guards-must-be-mutation-tested.md)

- `stale_days` 같은 임계는 **cron 주기의 파생값**이다. 한쪽만 바꾸면 조용히 어긋난다
- 예약(cron)을 **아예 지운** 워크플로는 "미발화" 개념이 성립하지 않는데,
  감시 목록에 남아 있으면 임계 초과 시 설계상 영구히 참이 되어 거짓 경보 → dedup 으로 **그 검사가 영구 침묵**

**의무**: cron·주기·플래그를 바꾸는 PR 은 `grep -rn "<대상 이름>" scripts/monitor*.mjs .claude/rules/` 로
그 값을 읽는 곳을 전부 찾아 함께 고치고, **테스트로 두 파일을 묶는다**(한쪽만 바뀌면 red).

## ⚠️ 테스트가 **그 코드가 실제로 지나는 경로**를 지나는가 (세션 508 — 새 변종)

지금까지의 사각은 "가드가 약하다"였다. 이번 건 다르다 — **가드는 정확한데 테스트가 그 코드에
도달하지 않는다.** 순수 함수를 직접 호출하는 테스트는 그 앞단(정규화·기본값·래퍼)을 **건너뛴다.**

> 사건·이력 (세션508 — `scoreLocation`/`scoreRisk` null 처리를 고쳤는데 `sanitize` 가 값을 이미 굳혀 넘겨 수정이 화면에 무효과. 앞단을 되돌리는 뮤테이션에 202건 전부 초록 — 지켜진다는 증거가 0) → [rules-history/meta/guards-must-be-mutation-tested.md](../../rules-history/meta/guards-must-be-mutation-tested.md)

**의무 — 수정한 코드마다 자문한다:**

1. **실전에서 이 함수를 누가 부르나?** 호출 사슬을 한 번 grep 한다(`grep -rn "함수명(" src/`).
   화면·배치가 지나는 진입점(이 레포는 `calcCats`)이 있으면, **그 진입점을 지나는 테스트**를 최소 1건 둔다.
2. **앞단이 내 값을 덮어쓰지 않나?** 기본값·정규화·클램프를 하는 레이어(`sanitize` 류)를 직접 읽는다.
   덮어쓰면 그 레이어도 같이 고치고, **그 레이어의 되돌림이 red 를 내는지** 뮤테이션한다.
3. **뮤테이션 대상은 "내가 고친 모든 줄"이다.** 함수 본문만 되돌려 보고 끝내면, 같은 PR 안의
   앞단 수정은 무방비로 남는다.

```js
// 빨강 — sanitize 를 건너뛴다. 앞단이 되돌아가도 초록.
expect(scoreLocation(makeApt({ noise: null })).total).toBe(X);

// 초록 — 화면이 실제로 지나는 경로. 앞단 되돌림에 red.
expect(calcCats(makeApt({ noise: null })).location.total).toBe(
  calcCats(makeApt({ noise: 65 })).location.total
);
expect(calcCats(makeApt({ noise: null })).location.total).toBeGreaterThan(
  calcCats(makeApt({ noise: 75 })).location.total // 옛 폴백값 — 같아지면 되돌아간 것
);
```

**"옛 기본값과 달라야 한다"를 단언에 넣는 것이 핵심이다.** "중립값과 같다"만 쓰면 우연히
같은 값이 나오는 되돌림을 놓친다.

### ⚠️ 재발 — 세션512에서 같은 함정이 또 났다 (룰이 있어도 안 물었다)

> 사건·이력 (세션512 — 세션508이 이 절을 박제한 뒤에도 똑같이 재발: `scoreBenefit` 직접 호출 테스트로 green 을 받았지만 `sanitize` 가 값을 눌러 실전 경로에선 옛 문구 그대로. 화면을 열어 보고서야 드러남) → [rules-history/meta/guards-must-be-mutation-tested.md](../../rules-history/meta/guards-must-be-mutation-tested.md)

**룰을 아는 것과 그 순간 자문하는 것은 다른 일이다.** 문구·기본값·null 처리를 고칠 때는 편집 직후
반드시 한 번 묻는다:

```bash
# 내가 읽는 이 필드가 sanitize 를 지나면서 바뀌나?
grep -n '<필드명>' src/scoring/engine.ts
```

바뀌면 ① 앞단에 `_no*` 플래그로 사실을 남기고 ② **가드를 `calcCats` 경유로** 쓴다.
직접 호출 가드는 이 결함에 초록불을 준다 — 세션508·512 두 번 실증됐다.

## ⚠️ **파생 가드는 상수 변경을 못 잡는다** — "어긋나지 않음"과 "옳음"은 다르다 (세션514)

이 저장소는 "수치를 손으로 적지 말고 **상수에서 읽어** 대조하라"를 관습으로 삼는다(세션513 파생
가드). 그런데 그 관습만 지키면 **가드 전체가 한 상수에서 파생**되므로, 그 상수를 잘못 바꿔도
문구·판정·테스트가 **함께 따라가며 전부 초록**이 된다.

> 사건·이력 (세션514 — `LIQUIDITY_TIERS[0].min` 을 2,000→2,500 으로 바꾸는 뮤테이션에 468건 전부 green. 경계·문구·benchmark·판정이 모두 그 상수의 파생이었기 때문) → [rules-history/meta/guards-must-be-mutation-tested.md](../../rules-history/meta/guards-must-be-mutation-tested.md)

**처방 = 관측값 앵커.** 파생 가드 옆에, 상수가 **스스로 근거로 든 실측치**(분포의 사분위 등)를
테스트에 적고 상수가 그 근방(±15% 등)에 있는지 본다. 적는 것은 **티어 값이 아니라 관측값**이라
파생 원칙과 충돌하지 않는다.

```js
// 세션514 실측(모집단·시점 명시). 티어가 아니라 관측값이다.
const OBSERVED = [1735, 1073, 715]; // p75 · med · p25
LIQUIDITY_TIERS.forEach((t, i) => {
  const ratio = t.min / OBSERVED[i];
  expect(ratio).toBeGreaterThan(0.85);
  expect(ratio).toBeLessThan(1.15);
});
```

⚠️ **앵커는 데이터가 참일 때만 유효하다.** 세션513이 적은 앵커(p25 516·med 995·p75 1,954)는
수집기 페이징 결함으로 오염된 분포였다([[unordered-pagination-loses-rows]]). 앵커를 고칠 땐
**재수집 후 다시 재고** 함께 고친다 — 앵커가 틀리면 가드가 틀린 경계를 지킨다.

## ⚠️ 코더의 뮤테이션이 전부 red 여도 **가드가 0줄 늘었으면 껍데기다** (세션513)

수정한 파일마다 **테스트가 실제로 늘었는지**를 diff 로 센다. 뮤테이션 red 는 **그 뮤테이션이 겨눈 자리**만 증명한다.

> 사건·이력 (세션513 — 코더 뮤테이션 8종이 전부 red 였는데도 수정 파일 중 두 곳은 테스트가 0줄 늘어 되돌려도 초록이었음. 오케스트레이터가 뒤늦게 메움) → [rules-history/meta/guards-must-be-mutation-tested.md](../../rules-history/meta/guards-must-be-mutation-tested.md)

## ⚠️ **이어받은 가드**는 "뮤테이션 대상" 표시가 있어도 직접 고장 내 본다 (세션523)

지금까지의 조항은 전부 **내가 새로 만든 가드**를 전제한다. 그런데 다른 세션·다른 사람이
만들어 둔 가드를 이어받는 경우가 있고, 그때 테스트 파일에 `⚠️ 뮤테이션 대상` 같은 표시가
붙어 있으면 **이미 검증됐다고 착각하기 쉽다**. 그 표시는 **의도의 표시일 뿐 실행의 증거가
아니다** — 표시를 달아 두고 실제로는 안 돌린 채 세션이 끝날 수 있다.

> 사건·이력 (세션523 — 직전 세션이 표시만 달아 둔 채 실제로 안 돌린 가드를 이어받아 돌려 보니 1종이 green: 같은 판정이 두 경로에 나뉘어 있어 한쪽만 지켜지고 있었음) → [rules-history/meta/guards-must-be-mutation-tested.md](../../rules-history/meta/guards-must-be-mutation-tested.md)

- **미완결 작업을 이어받으면 커밋 전에 그 가드의 뮤테이션부터** 한다. 남이 통과시킨
  초록불은 "이 코드가 옳다"는 증거이지 "이 가드가 지킨다"는 증거가 아니다.
- **같은 판정이 여러 경로에 나뉘어 있으면 경로마다 뮤테이션한다.** 한 경로가 red 라고
  다른 경로가 지켜지는 게 아니다 — 검사 문구가 같아 눈으로는 구분이 안 된다.
- 이어받은 작업 전반의 판정은 [[session523-unfinished-work-completion]] 참조 —
  "가드 통과"와 "실효"는 다른 축이라 **DB 결과로 완결을 판정**해야 한다.

## ⚠️ 가드가 **입력 형식**을 실전과 다르게 넣으면, 경로를 지켜도 사각이 남는다 (세션529)

> 사건·이력 (세션529 — 세션508 룰을 명시 인용해 만든 가드가 운영 DB 에 0건인 날짜 형식만 써서 결함 분기를 한 번도 안 지남. 준공완료 958곳을 전부 미준공 판정하는 결함이 가드 밑에서 살아남음) → [rules-history/meta/guards-must-be-mutation-tested.md](../../rules-history/meta/guards-must-be-mutation-tested.md)

**의무**: 가드를 쓸 때 그 입력이 **운영 데이터에 실제로 존재하는 형식인지** 실측하라.
```bash
# 그 컬럼의 실제 형식 분포를 세라 — 테스트가 쓰는 형식이 0건이면 그 가드는 실전을 안 지난다
node -e '…' # DB census (형식별 건수)
grep -rn 'completion: *"' src/ --include=*.test.*   # 테스트가 넣는 형식
```
역설적 신호: **다른 레이어 테스트는 실전 형식을 쓰는데 그 결함이 있는 곳만 다른 형식**이면 위험하다.

## ⚠️ 뮤테이션 목록에 **"경쟁 후보값"** 을 넣어라 — 옛 값만 시험하면 이번 결정은 무방비다 (세션529)

> 사건·이력 (세션529 — "뮤테이션 10종 전부 red" 를 근거로 들었지만 그 10종은 전부 앵커 범위 밖(옛 값 복원)이었음. 적대검증이 앵커 범위 안의 경쟁 후보값을 넣어 보니 둘 다 green) → [rules-history/meta/guards-must-be-mutation-tested.md](../../rules-history/meta/guards-must-be-mutation-tested.md)

**의무**: 값을 고르는 PR 은 뮤테이션에 ①옛 값 ②**기각한 경쟁 후보값** 둘 다 넣는다.
경쟁 후보가 green 이면 — 그 자리가 무방비라는 뜻이니 — **가드를 좁히든지, 무방비임을 기록**하라.

## ⚠️ 경계·범위를 **표에서 읽는 가드**는 표가 밀리면 같이 밀린다 (세션529 자책)

> 사건·이력 (세션529 — "구간 인덱스가 밀리면 red" 가드를 경계를 표에서 읽는 방식으로 만들어, 경계만 미는 뮤테이션에 green. 파생 가드 함정을 막으려고 쓴 가드가 그 함정에 빠짐) → [rules-history/meta/guards-must-be-mutation-tested.md](../../rules-history/meta/guards-must-be-mutation-tested.md)

```js
// 빨강 — 표에서 읽어 검사. 표가 밀리면 같이 밀린다
midMonths.forEach((m, i) => { const b = AGE_PREMIUM[i];
  expect(yrs).toBeGreaterThanOrEqual(b.min); expect(getAgeCoeff(ymOffset(m))).toBe(b.coeff); });

// 초록 — 경계를 **리터럴로 못 박는다**
expect(AGE_PREMIUM.map((a) => a.min)).toEqual([0, 1, 3, 5, 10, 15, 20]);
const cases = [[-6, 0], [-24, 1], [-48, 2]];  // [월, 기대 인덱스] 둘 다 리터럴
cases.forEach(([m, i]) => expect(getAgeCoeff(ymOffset(m))).toBe(AGE_PREMIUM[i].coeff));
```

**판별법**: 그 단언이 검사 대상에서 값을 읽는가? 읽으면 그건 항등식이지 가드가 아니다.

> 답습 자산·차단 검증 이력 → [rules-history/meta/guards-must-be-mutation-tested.md](../../rules-history/meta/guards-must-be-mutation-tested.md)
