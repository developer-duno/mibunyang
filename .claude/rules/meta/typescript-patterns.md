# TypeScript Patterns — JSDoc + // @ts-check 답습 자산

> M5d~M7 (scripts/collectors + src/) typecheck 활성화 누적 18 패턴 (세션 350 §15 tsconfig glob 함정 + §16 LSP≠tsc 추가). 신규 .js/.mjs/.test.* 파일 // @ts-check 활성화 시 답습 의무.

## 사용법

1. 새 파일에 `// @ts-check` 추가 → `npx tsc --noEmit` baseline 측정
2. 본 문서 [§1~§10] 패턴 grep + 해당 패턴 발견 시 정정 적용
3. 시뮬레이션 ([§11]) → 적용 후 재측정 (1차 정정 후 새 errors 가능)
4. EXIT=0 도달 후 commit

## 박제 누적 사고 (자가 학습)

| 사고 | 세션 | 정착 |
|---|---|---|
| `.find(...)!.score` 환각 (TS8013) | 218 (M7-B2) | [§6] |
| calc-layout highFloor null narrow 신규 발생 | 201 | [§11] |
| Supabase GenericStringError 직접 cast 거부 | 198 | [§3] |
| D 패턴 unknown 인덱싱 → string-only 함수 호출 | 192 (M5a-extra) | [§9] |
| spread conditional TS2339 | 201 | [§7] |

---

## §1. JSDoc cast 표준 (parenthesized + double-bang)

### 1.1 Parenthesized cast (식 자체를 좁힘)

```js
// 빨강: TS2345 / TS2322 / TS18048
const apt = makeApt({ transitDev: null });
calcCats(apt, { regionMedians });

// 초록: 식 전체에 cast 1회
const apt = makeApt(/** @type {any} */ ({ transitDev: null }));
calcCats(apt, /** @type {any} */ ({ regionMedians }));
```

### 1.2 Double-bang boolean narrow (`!!x` + `?? ""` fallback)

```js
// 빨강: string | undefined → endsWith() string-only
const isCLI = process.argv[1] && import.meta.url.endsWith(
  process.argv[1].replace(/\\/g, "/").split("/").pop()
);

// 초록 (isCLI v2 — 세션 198 박제):
const isCLI = !!process.argv[1] && import.meta.url.endsWith(
  process.argv[1].replace(/\\/g, "/").split("/").pop() ?? ""
);
```

### 1.3 Record<string, unknown> 함수 매개변수 (D 패턴)

```js
/** @param {Record<string, unknown>} a */
function toApartmentRow(a) {
  return { name: a.name ?? null }; // ?? 통과
}
```

→ string-only 함수 호출 시 [§9] 추가 cast 필요

---

## §2. null/undefined narrow

### 2.1 옵셔널 체인 + `?? 폴백`

```js
// 빨강: TS2532 / TS18048 (Object possibly undefined)
expect(arr.find(s => s.name === "X").score).toBe(100);

// 초록: ?. + ?? 0 (매처 입력)
expect(arr.find(s => s.name === "X")?.score ?? 0).toBe(100);
```

### 2.2 변수 선언 시 (any) cast (find 결과 변수 narrow)

```js
// 빨강: const rel = .find(...); rel.score → TS18048
// 초록: 변수 cast 1회 → 이후 모든 접근 OK
const rel = /** @type {any} */ (arr.find(s => s.name === "X"));
rel.score; // OK
```

### 2.3 let var JSDoc cast 시 init = (any)(undefined) 동시 의무

```js
// 빨강: TS2454 (Variable used before assigned)
/** @type {string | null} */
let result;
if (cond) result = "x";

// 초록: init 값 (any)(undefined) 명시
/** @type {string | null} */
let result = /** @type {any} */ (undefined);
if (cond) result = "x";
```

### 2.4 변수 narrow 의무 (배열 spread + 함수 인자 전달)

```js
// 빨강: arr 추론 { name, type } ↔ someFunc 인자 Record<string, any> 불일치
let arr = [...filter1, ...filter2].sort(...);
arr = await someFunc(arr); // TS2322

// 초록: 변수 선언 시 명시 narrow
/** @type {Array<Record<string, any>>} */
let arr = [...filter1, ...filter2].sort(...);
```

---

## §3. Mock / test 타입화

### 3.1 importOriginal Record<string, unknown> cast

```js
// 빨강: TS2698 spread types
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = await importOriginal();
  return { ...orig, foo: "bar" };
});

// 초록: cast 1회
vi.mock("./_shared.mjs", async (importOriginal) => {
  const orig = /** @type {Record<string, unknown>} */ (await importOriginal());
  return { ...orig, foo: "bar" };
});
```

### 3.2 vi.Mock cast (mock 인자 number → string)

```js
const mockFn = /** @type {import('vitest').Mock} */ (someFn);
mockFn.mockReturnValue("...");
```

### 3.3 KakaoDoc | undefined narrow 우회 (test 한정 null any cast)

```js
// production 시그니처 = KakaoDoc | undefined (null 거부)
// test 에서 런타임 robustness 검증 시:
expect(extractSubwayName(/** @type {any} */ (null))).toBeNull();
```

> **Production 코드는 시그니처 정확히 좁힐 것.** any cast 는 .test.* 한정.

### 3.4 Map<key, T[]> 명시 narrow + `.get() ?? [] push`

```js
// 빨강: m.get(key) = T[] | undefined → push 시 TS18048
const m = new Map();
m.set(key, []);
m.get(key).push(item);

// 초록: 명시 + ?? [] push
/** @type {Map<string, MyType[]>} */
const m = new Map();
m.set(key, []);
(m.get(key) ?? []).push(item);
```

### 3.5 makeApt overrides cast (null 충돌)

```js
// 빨강: Partial<Apt> 의 string | undefined 가 null 거부
makeApt({ transitDev: null, builder: null });

// 초록: overrides 객체에 cast
makeApt(/** @type {any} */ ({ transitDev: null, builder: null }));
```

### 3.6 Array cast (객체 배열 → Apt[])

```js
// 빨강: TS2345 X[] is not assignable to Apt[]
computeRegionalMedians([{ region: "경기", pir: null }]);

// 초록: 변수 선언 시 또는 인자 위치에 cast
const apts = /** @type {any} */ ([{ region: "경기", pir: null }]);
computeRegionalMedians(apts);
// 또는
computeRegionalMedians(/** @type {any} */ (apts));
```

### 3.7 ScoringContext cast (maint 누락)

```js
// 빨강: regionMedians value 의 maint 5번째 필드 누락 → TS2322
calcCats(apt, { regionMedians: { 경기: { pir: 5, psr: 0.8, unsoldRate: 15, supplyRatio: 100 } } });

// 초록: ScoringContext 자체 cast
const cats = calcCats(apt, /** @type {any} */ ({ regionMedians }));
```

---

## §4. Supabase / 외부 API 타입 좁힘

### 4.1 Supabase builder 임시 변수 any cast

```js
// 빨강: q.eq / q[op](...) dynamic call → TS7053 / TS2345
let q = sb.from(table).select(...).range(...);
for (const { col, op, val } of rangeFilters) {
  q = q[op](col, val);
}

// 초록: 변수 선언 시 any cast (인라인)
/** @type {any} */
let q = sb.from(table).select(...).range(...);
```

### 4.2 Supabase GenericStringError 이중 cast (unknown 경유)

```js
// 빨강: TS2352 — Record 와 GenericStringError 충분히 겹치지 않음
allRows.push(.../** @type {Record<string, unknown>[]} */ (first || []));

// 초록: unknown 경유 이중 cast
allRows.push(.../** @type {Record<string, unknown>[]} */ (
  /** @type {unknown} */ (first || [])
));
```

### 4.3 reduce 콜백 typed 인라인

```js
// 빨강: TS7006 implicit any
prices.reduce((s, p) => s + p, 0);

// 초록: 콜백 시그니처 인라인
prices.reduce(/** @type {(s: number, p: number) => number} */ ((s, p) => s + p), 0);
```

---

## §5. 에러 narrow (catch 블록)

### 5.1 execFileAsync object err narrow

```js
} catch (err) {
  const e = /** @type {{ code?: string|number, status?: string|number, message?: string }} */ (err);
  const code = e.code || e.status || "unknown";
  return { ok: false, error: e.message ?? String(err) };
}
```

> `err instanceof Error` narrow 만으로는 `code`/`status` 접근 불가. ExecException 인라인 typedef cast.

### 5.2 isCLI 통일 entry point (.mjs collector)

```js
const isCLI = !!process.argv[1] && import.meta.url.endsWith(
  process.argv[1].replace(/\\/g, "/").split("/").pop() ?? ""
);
if (isCLI) {
  main().catch(err => {
    logError(PHASE, err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
```

---

## §6. 금지 사항: `.js + // @ts-check` 에서 non-null assertion

**룰**: `.js` 파일 + `// @ts-check` 모드에서 `!.X` (non-null assertion) 금지. **TS8013 발생.**

| 빨강 (.js + // @ts-check) | 정정 |
|---|---|
| `.find(...)!.score` | `.find(...)?.score ?? 0` (매처 input) |
| `.find(...)!.score` | `/** @type {any} */ (.find(...)).score` (변수 cast) |
| `arr[0]!` | `arr[0]` (이미 narrow) 또는 `(any) cast` |
| `obj!.prop` | `obj?.prop` 또는 `(any) cast` |

**Why**: non-null assertion `!` 은 .ts 문법. JSDoc 모드는 JSDoc cast + 옵셔널 체인만 허용.

**사건**: 세션 218 M7-B2 — plan §B2 답습 박제값에 `.find(...)!.score` 환각. 64건 일괄 substitution 후 64 errors → 즉시 환각 발견 + 옵셔널 체인 정정. **plan 박제 패턴도 환각 가능 → 작업 중 1 substitution 직후 1 측정 의무**.

---

## §7. spread conditional 흡수 (TS2339)

객체 리터럴 + `if (cond) obj.key = value` 패턴 → TS2339 ('Property X does not exist on type'). 정정: 객체 리터럴 안에 `...(cond ? { key: value } : {})` 흡수.

```js
// 빨강
const updates = { region, gu, dong, address: addr?.address };
if (district) updates.district = district; // TS2339

// 초록
const updates = {
  region, gu, dong,
  address: addr?.address,
  ...(district ? { district } : {}),
};
```

**Grep**:
```bash
grep -nB3 -A1 "^\s*if (\w*) \w*\.\w* = " <file>
```

**대안 (기각)**: `/** @type {Record<string, any>} */` cast — 타입 안전 잃음, 권장 안 함.

**적용 트리거**: collectors 의 Supabase update/insert 객체, API 응답 변환 객체, 동적 프로퍼티 객체 리터럴.

---

## §8. ScoringContext / Factory 표준 호출

### 8.1 makeApt / makeItem / makeScoredItem (test factory)

```js
// 빨강: Partial<Apt> ↔ null 충돌
const apt = makeApt({ transitDev: null });

// 초록: overrides 객체 cast
const apt = makeApt(/** @type {any} */ ({ transitDev: null }));
```

### 8.2 ScoringContext 일부 누락 cast

```js
// regionMedians 의 5필드 (pir/psr/unsoldRate/supplyRatio/maint) 일부 누락 시
const cats = calcCats(apt, /** @type {any} */ ({ regionMedians }));
```

### 8.3 makeItem factory 일관 호출

```js
const item = /** @type {any} */ (makeScoredItem({ name: "X", score: 80 }));
```

> Factory 시그니처가 strict Partial 일 때 null 의도 보존 위해 cast 필요.

---

## §9. D 패턴 (Record<string, unknown>) 한계

**룰**: `Record<string, unknown>` 매개변수 박제 후 인덱싱 결과는 `unknown` (any 와 다름). string-only / number-only 함수 호출 시 narrow 미발동 → parenthesized cast 1건 추가 필요.

```js
/** @param {Record<string, unknown>} a */
function toApartmentRow(a) {
  return {
    builder: resolveBuilder(/** @type {string | undefined | null} */ (a.builder)),
    // ?? null 같은 falsy 처리는 unknown 도 통과 (cast 불필요)
    name: a.name ?? null,
  };
}
```

**예외**: `JSON.parse(...)` 결과가 any 라 루프 변수 a 도 any → 동일 호출이 다른 위치에서 cast 없이 통과. **명시적 함수 매개변수만 본 패턴 적용**.

**장기 해소**: 정확한 typedef (ApartmentRowRaw / PriceRowRaw) 박제 시 cast 불필요.

**사고**: 세션 192 (M5a-extra) — D 패턴 27 errors fix 후 잔여 1 errors. L119 parenthesized cast 1건 추가로 해소. M5d collectors 35+ 변환 시 5~15 잔여 errors 가능 → 호출처 grep 으로 일괄 캐스팅.

---

## §10. .test.mjs typecheck

### 10.1 importOriginal cast → [§3.1] 참조

### 10.2 mock 인자 number → string + expect 동시 변경

mock 시그니처 변경 시 expect 도 동시 변경 (number → String narrow):

```js
// 빨강: mock 반환 타입 변경 후 expect 빨강
mockFn.mockReturnValue("100");
expect(result).toBe(100); // TS2345

// 초록: expect 동시 정정
expect(result).toBe(String(100));
```

### 10.3 cats 단일 변수 + 배열 any cast

```js
// 빨강: cats 추론이 narrow 됨
const cats = calcCats(apt, ctx);
expect(cats[0].score).toBe(80);

// 초록: 단일 변수 cast 1회
const cats = /** @type {any} */ (calcCats(apt, ctx));
expect(cats[0].score).toBe(80);
```

### 10.4 useDataPipeline 6건 분기 정정 (M7-C7 답습)

분기마다 useDataPipeline 결과를 다른 타입으로 좁힌 경우 sub 별 cast 정정 (각 분기 entry point 1회씩).

---

## §11. 시뮬레이션 의무

### 룰

`// @ts-check` 활성화 plan 작성 시, 사전 측정만으로 끝내지 말고 **JSDoc/cast/isCLI v2 등 모든 정정 적용 후 typecheck 재측정** 의무. 백업→정정→측정→복원 사이클로 git diff 변동 0 보장.

### 사이클

```bash
# 1. 백업
cp <file> /tmp/_x.bak

# 2. 정정 적용 (Edit tool 사용 가능 — 복원으로 git diff 변동 0)

# 3. 측정
npm run typecheck:scripts 2>&1 | grep -E "<file>|Found"
# 또는
npx tsc --noEmit 2>&1 | grep -E "<file>|error TS"

# 4. 즉시 복원
cp /tmp/_x.bak <file>

# 5. 검증
git diff --stat <files>  # 변동 0 필수
```

### Why

calc-layout (세션 201) 사고: 사전 측정 9 errors 확인 후 모든 정정 적용했더니 **신규 errors 2건 발생** (TS18047 highFloor possibly null L59/L60). JSDoc 의 `highFloor: number | null` 명시가 본체 strict 추론으로 narrow 실패. 본체 가드 강화 (`highFloor != null && highFloor > 0`) 로 해결.

reverse-geocode plan v1부터 §"시뮬레이션 의무" 명시 → Agent A 가 plan 검증에서 시뮬 1회 → 1차 정정만으로 12→0 정확 예측. 본 작업도 시뮬 결과 그대로 0 errors 달성.

### 새 errors 발견 시

plan 본문에 *"1차 정정 후 N errors 잔여 → 2차 정정 patch"* 명시. plan v2/v3 보강. 서브에이전트 Explore 에 시뮬 절차 위임 가능 (세션 201 reverse-geocode Agent A 패턴).

---

## §12. 정정 적용 순서 (M8 답습 권장)

1. `// @ts-check` 추가 → typecheck 측정
2. **factory @returns + (any) cast** ([§8]) → 큰 그룹 일괄 해소 (TS2345 다수)
3. **`.find(...)?.X` 옵셔널 체인 일괄** (substitution, [§2.1])
4. **`.find(...)?.X ?? 0` 매처 입력 위치 추가** (substitution, [§2.1])
5. **변수 선언 시점 (any) cast** ([§2.2], rel/dev/sub 등)
6. **개별 cast** ([§3.5][§3.6][§3.7] overrides/Array/ScoringContext)
7. **`parseFloat(String(...))` narrow** ([§4.3 변형])
8. **isCLI v2 entry point** ([§5.2]) — .mjs collector 한정
9. **spread conditional 흡수** ([§7]) — 객체 리터럴 한정
10. 잔여 측정 → 0 도달 확인 → commit

---

## §13. 입력 자산 (글로벌 메모 인덱스)

다음 글로벌 메모가 본 문서의 원천. 본문은 점에 박힌 사례, 본 문서는 정착된 패턴 카탈로그:

| 메모 | 역할 |
|---|---|
| `~/.claude/projects/f--mibunyang/memory/feedback_session218_new_patterns.md` | M7-B2 신규 6 패턴 ([§2.1][§2.2][§3.5][§3.6][§3.7][§4.3 변형]) |
| `feedback_session204_new_patterns.md` | M5d-3c-9 신규 5 패턴 ([§2.4][§3.1][§3.4][§4.1][§4.3]) |
| `feedback_session201_new_pattern.md` | spread conditional ([§7]) |
| `feedback_session198_new_patterns.md` | Group D 4 패턴 ([§3.3][§4.2][§5.1][§5.2 v2]) |
| `feedback_ts8013_non_null_assertion.md` | non-null assertion 환각 ([§6]) |
| `feedback_simulation_mandate.md` | 시뮬레이션 의무 ([§11]) |
| `feedback_d_pattern_record_unknown_limit.md` | D 패턴 한계 ([§9]) |

→ 글로벌 메모는 보존 (사고 박제 + 인용 출처). 본 문서는 미래 .ts/// @ts-check 작업의 검색 가능 카탈로그.

## §14. 신규 패턴 추가 시

본 문서 [§N] 섹션에 추가 + 글로벌 메모 새 파일 박제 + [§13] 인덱스 갱신. 16 → N 카운트 업데이트. M8/M9 작업 중 발견 시 즉시 편집 (1 커밋).

---

## §15. tsconfig include glob 은 .gitignore 를 무시한다 (세션 350 박제)

`tsconfig.scripts.json` include 를 개별 파일 열거 → glob (`scripts/**/*.mjs`) 전환 시 **결정적 함정**: TypeScript 의 include/exclude glob 은 `.gitignore` 를 **존중하지 않는다**. gitignore 된 파일 (`scripts/probes/*`, `scripts/_tmp*` 등) 이 검사 대상으로 끌려들어와 검사 대상 외 파일에서 새 에러 폭발.

```jsonc
// 빨강: glob 만 전환 (gitignore 무시 함정)
"include": ["scripts/types.ts", "scripts/**/*.mjs"]
// → probes/datagokr-apply.mjs 등 @ts-check 없는 gitignore 파일도 검사 대상

// 초록: @ts-check 없는 파일 + gitignore 파일 exclude 전부 명시
"include": ["scripts/types.ts", "scripts/**/*.mjs"],
"exclude": [
  "node_modules", "dist", "build", ".vercel",
  "scripts/collect-data.mjs",                  // @ts-check 없음 (ETL 진입점)
  "scripts/probes/datagokr-apply.mjs",         // gitignore 대상
  "scripts/probes/kosis-api-test.mjs", "scripts/probes/kosis-api-test2.mjs",
  "scripts/_tmp_schoolinfo_probe.mjs"          // gitignore 임시 잔재
]
```

**검증 가드 (의무)**: glob 전환 후 `--listFiles` 로 제외 대상이 검사망에 안 들어왔는지 확인.

```bash
npx tsc --noEmit -p tsconfig.scripts.json --listFiles 2>&1 | grep -E "probes/|_tmp_|collect-data" && echo "FAIL 제외 누락" || echo "OK 제외 정상"
```

**장점**: glob 전환 = 미래 신규 collector 자동 포함 → "@ts-check 박았는데 include 미등재로 검사 안 받는 거짓 안전" 사각지대 영구 해소. 세션 350 = 거짓 안전 53파일 211에러 발견 (75개 열거 방식의 누적 사각지대).

### 외부 라이브러리 TS7016 (타입 없는 모듈) — 본채는 @types 설치

`import yaml from "js-yaml"` 처럼 `.d.ts` 없는 라이브러리 → TS7016. **본채 (production) 코드면 `@types/*` 설치** (§3.3 "본채는 타입 정확히, any cast 는 .test 한정"). `@ts-ignore` 는 본채 타입 안전 영구 포기라 회피. `@types/js-yaml`·`@types/unzipper` 등 DefinitelyTyped 존재 확인 후 devDependency 추가. 설치 버전이 런타임 버전보다 마이너 뒤처지면 (예: @types/unzipper 0.10 vs unzipper 0.12) §11 시뮬레이션으로 호환 1회 검증.

## §16. LSP/IDE 진단 ≠ tsc -p tsconfig.scripts.json (진실의 원천, 세션 350 박제)

작업 중 IDE/LSP 진단 (`<new-diagnostics>` 또는 plugin lsp_diagnostics) 이 `.mjs` 파일에서 에러를 계속 보고하지만, 실제 `npx tsc --noEmit -p tsconfig.scripts.json` 으로는 **0** 인 경우 발생.

원인: LSP 는 보통 **루트 tsconfig.json (`checkJs: false`)** 기준으로 보거나 stale 상태. scripts 의 `.mjs` 검사는 `tsconfig.scripts.json` (`checkJs: true`) 별도 프로젝트라 LSP 기본 설정과 다름.

**진실의 원천 = `tsc -p tsconfig.scripts.json`**. LSP 진단은 보조 신호. 정정 완료 판정·잔여 에러 카운트는 반드시 tsc 명령으로. (메모리 룰 §"vitest stale 캐시" / §"메모리는 진실의 원천 아님" 답습 — 진단 도구 ≠ 진실의 원천)

```bash
# 빨강: LSP <new-diagnostics> 보고만 보고 "아직 에러 남음" 단정
# 초록: tsc 직접 측정
npx tsc --noEmit -p tsconfig.scripts.json 2>&1 | grep -c "<file>"
```

> **사건**: 세션 350 — naver-presale.test.mjs factory cast 후 LSP 가 L435/452/460 등 TS2739/TS18047 계속 보고. tsc -p tsconfig.scripts.json 실측 = 0. LSP 추측 폐기 후 tsc 만 기준으로 진행.
