# 파생 캐시 키 누락 · 시각 산출물 미검증 — 범용 점검 프롬프트

> 이 문서는 다른 저장소에 그대로 붙여넣어 쓸 수 있는 점검 프롬프트다. 언어·프레임워크에 무관하며, 두 절은 서로 독립이다 — 하나만 필요하면 그 절만 떼어 써라.

---

## 절 1 — 파생 캐시 키 누락 (silent, 화면에 거짓이 뜬다)

### ① 무엇이 문제인가

어떤 함수의 출력이 `f(a, b, c)` 처럼 여러 입력에 의존할 때, 그 결과를 캐시·메모이제이션하면서 **캐시 키에는 `a, b`만 넣고 `c`는 빠뜨리는** 결함이다.

```js
// 빨강 — c(=coordShared, 좌표 의심 플래그)가 출력을 바꾸는데 키에는 없다
const imgKey = `${score}|${priceLabel}`;
let img = cache.get(imgKey);
if (!img) {
  img = buildMarkerSvg(score, color, priceLabel, coordShared); // 함수엔 넘김
  cache.set(imgKey, img);
}
```

```js
// 초록 — 출력을 바꾸는 입력은 전부 키에 반영
const imgKey = `${score}|${priceLabel}|${coordShared ? 1 : 0}`;
let img = cache.get(imgKey);
if (!img) {
  img = buildMarkerSvg(score, color, priceLabel, coordShared);
  cache.set(imgKey, img);
}
```

**왜 위험한가**: 에러가 안 난다. 타입 체커도 안 잡는다(캐시 키는 대개 `string`이라 타입 시스템이 "이 문자열이 이 함수의 모든 입력을 대표하는가"를 검사할 방법이 없다). 결과는 **먼저 캐시를 채운 호출이 나중 호출의 화면을 조용히 덮어쓴다.** 이 버그는 캐시가 뜨거워진(여러 항목이 쌓인) 뒤에야, 그것도 우연히 키가 겹치는 두 항목이 나란히 나타날 때만 눈에 띈다 — 그래서 리뷰·단위테스트에서 잘 안 잡힌다.

**해당하는 자리**: React `useMemo`/`useCallback` 의존성 배열, `React.memo`의 두 번째 인자(비교 함수), `Map`/`WeakMap` 기반 수제 캐시, SWR·React Query·비슷한 데이터 페칭 라이브러리의 쿼리 키, 커스텀 훅 내부의 `useRef`/모듈 스코프 캐시, 서버 사이드 응답 캐시(Redis 키, HTTP 캐시 키), 빌드 도구의 콘텐츠 해시 미포함 자산, ORM/쿼리 빌더의 캐시된 쿼리.

### ② 어떻게 찾나 (명령)

**패턴 1 — 캐시/메모 자료구조를 찾는다**

```bash
rg -n --type-add 'code:*.{js,jsx,ts,tsx,py,go,rb,java,kt}' -tcode \
  '\b(new\s+Map|new\s+WeakMap|cache\s*=|memo(?:ize)?\(|lru[-_]?cache|@lru_cache|functools\.lru_cache)' \
  -g '!**/node_modules/**' -g '!**/dist/**' -g '!**/*.test.*'
```
- 무엇을 찾는가: 캐시 저장소 선언 지점.
- 왜 후보인가: 캐시가 있다는 것 자체는 문제가 아니지만, 이 근처에 "키 생성" 코드가 반드시 있고 거기가 검사 대상이다.
- 오탐: 캐시가 아니라 단순 조회 테이블(정적 상수, 입력에 안 바뀜)인 경우 — 이건 안전.

**패턴 2 — 키를 만드는 곳에서 템플릿 리터럴/문자열 결합을 찾는다**

```bash
rg -n '(key|cacheKey|memoKey)\s*=\s*[`"'\''].*\$\{|(key|cacheKey|memoKey)\s*=\s*.*\+.*\+' \
  -g '!**/node_modules/**' --type-add 'code:*.{js,jsx,ts,tsx}' -tcode
```
- 무엇을 찾는가: 여러 변수를 이어붙여 캐시 키 문자열을 만드는 지점.
- 왜 후보인가: 여기 나열된 변수 목록이 곧 "이 함수가 실제로 쓰는 입력 목록"과 **손으로 맞춰야** 한다 — 하나가 늘면 둘 다 안 늘어날 위험이 있다.
- 오탐: 결합에 들어간 값이 실제로 함수 결과에 영향 안 주는 순수 식별자(예: 로그용 requestId)인 경우.

**패턴 3 — `useMemo`/`useCallback` 의존성 배열과 본문 참조 변수를 대조 (React류)**

```bash
rg -n -U 'use(Memo|Callback)\(\s*\([^)]*\)\s*=>\s*\{[\s\S]*?\},\s*\[[^\]]*\]\)' \
  -g '!**/node_modules/**' --type-add 'code:*.{js,jsx,ts,tsx}' -tcode -A 0
```
- 무엇을 찾는가: 훅 호출부 전체(본문 + 의존성 배열)를 한 번에.
- 왜 후보인가: 본문에서 참조하는 외부 변수와 배열에 적힌 항목이 다르면 결함이다. `eslint-plugin-react-hooks`의 `exhaustive-deps`가 이미 있다면 아래를 먼저 돌려라(직접 grep보다 정확):
```bash
npx eslint --no-eslintrc --rule '{"react-hooks/exhaustive-deps":"error"}' --plugin react-hooks <대상 파일>
```
- 오탐: `eslint-disable-next-line react-hooks/exhaustive-deps` 주석이 있는 줄 — 누군가 의도적으로 뺀 것일 수도, 과거의 실수일 수도 있으니 **주석의 이유를 읽어라.**

**패턴 4 — 캐시를 채우는 함수와 캐시 키 생성부가 물리적으로 떨어져 있는지 확인**

```bash
rg -n 'buildMarkerSvg|render[A-Z]\w*\(|generate[A-Z]\w*\(' -g '!**/node_modules/**' \
  --type-add 'code:*.{js,jsx,ts,tsx}' -tcode
```
- 무엇을 찾는가: 렌더/생성 함수의 모든 호출부.
- 왜 후보인가: 이 함수의 **시그니처(인자 목록)**를 먼저 읽고, 그 인자 전부가 호출부 바로 위/아래의 캐시 키 조합에 들어있는지 눈으로 대조한다.

### ③ 진짜인지 판정

찾은 후보마다 다음 질문에 **하나씩 답**한다. 전부 "예"면 안전, 하나라도 "아니오"면 결함이다.

1. **이 함수(또는 이 memo 블록)의 출력을 바꾸는 입력을 전부 나열했는가?** — 함수 시그니처, 본문에서 읽는 클로저 변수, props, context 값까지 포함.
2. **1에서 나열한 입력 각각이 캐시 키(또는 의존성 배열)에 반영되어 있는가?** — 이름이 아니라 "값이 바뀌면 키도 바뀌는가"로 확인. `coordShared`가 `boolean`인데 키에는 `String(coordShared)`가 없고 `coordShared`가 객체 참조라 매번 새로 생성된다면 그것도 별개의 버그(키가 항상 달라져 캐시가 무의미)다.
3. **입력이 나중에 추가된 이력이 있는가?** — `git log -p --follow <파일>`로 함수 시그니처에 인자가 추가된 커밋을 찾고, 같은 커밋 또는 그 이후 커밋에서 캐시 키도 함께 바뀌었는지 대조한다.
   ```bash
   git log -p --follow -- <파일 경로> | rg -n '^\+.*function \w+\(|^\+.*=>\s*\{|^\+.*Key\s*='
   ```
4. **키가 "부분적으로만" 바뀌는 입력을 놓치지 않았는가?** — boolean/enum처럼 값의 가짓수가 적은 입력이 특히 잘 빠진다(문자열 결합에서 "어차피 대부분 false겠지"라는 암묵적 가정이 생기기 쉽다).

### ④ 고친 뒤 검증

통과하는 테스트는 절반의 검증이다. **뮤테이션 테스트**로 가드가 실제로 작동하는지 확인해야 한다.

1. **정상 케이스**: 두 개의 다른 입력 조합(`c=true`, `c=false`)으로 함수를 두 번 호출하고, 캐시가 **서로 다른 두 개의 항목**을 갖는지 확인한다.
   ```js
   const out1 = getOrBuild({ score: 80, priceLabel: '5억', coordShared: false });
   const out2 = getOrBuild({ score: 80, priceLabel: '5억', coordShared: true });
   assert.notStrictEqual(out1, out2, '캐시 키에 coordShared가 반영되지 않았다');
   assert.strictEqual(cache.size, 2);
   ```
2. **뮤테이션 테스트 — 일부러 키를 다시 깨뜨려 본다**: 고친 캐시 키에서 새로 추가한 필드를 주석 처리하거나 지우고, 위 테스트가 **반드시 실패**하는지 확인한다. 실패하지 않으면 테스트 자체가 그 입력을 검증하지 못하는 것이다 — 테스트를 다시 써라.
   ```diff
   - const imgKey = `${score}|${priceLabel}|${coordShared ? 1 : 0}`;
   + const imgKey = `${score}|${priceLabel}`;  // 일부러 되돌려 테스트가 빨간불인지 확인
   ```
3. **캐시 스트레스**: 실제 데이터 규모(예: 1,000개 이상의 항목)를 순서를 바꿔 두 번 채워보고, 두 번의 결과가 항목 단위로 완전히 동일한지 diff한다. 순서에 따라 다른 항목이 먼저 캐시를 채우므로, **순서 의존성이 있으면 이 비교에서 드러난다.**
4. **경계값**: 입력이 `undefined`/`null`/기본값일 때도 키가 고유하게 생성되는지 확인 — `` `${undefined}` `` 는 문자열 `"undefined"`가 되어 우연히 다른 값과 충돌하지 않는지 점검.

### ⑤ 안티패턴

- "타입이 맞으니 안전하다" — 캐시 키는 대개 `string`이라 타입 체커가 완전성을 못 본다.
- "테스트가 통과하니 캐시 키가 맞다" — 테스트가애초에 그 입력을 다르게 주지 않았을 수 있다. 뮤테이션 테스트로 확인하라.
- "이 입력은 거의 항상 같은 값이라 실무에서 안 걸릴 것" — "거의 항상"이 곧 "가끔 걸려서 재현 안 되는 버그"가 되는 지점이다.
- "함수 시그니처만 보면 된다" — 클로저로 캡처된 외부 변수, context, 모듈 스코프 전역도 출력에 영향을 준다면 입력이다.
- "캐시를 지우면(invalidate) 해결된다" — 캐시 무효화 타이밍 문제로 덮으면 근본 원인(키 불완전성)이 남아 다른 상황에서 재발한다.

---

## 절 2 — 시각 산출물 미검증 (테스트는 초록, 그림은 깨짐)

### ① 무엇이 문제인가

SVG/canvas/CSS 레이아웃/차트/PDF/이미지처럼 **최종적으로 사람 눈에 보이는 산출물**을, "특정 속성 문자열이 출력에 포함되어 있는가"만으로 검증하는 결함이다.

```js
// 빨강 — 속성이 있다는 것만 확인. 겹침·잘림·위치는 아무도 안 본다
expect(svg).toContain('stroke-dasharray="4 3"');
```

```js
// 초록 — 실제로 렌더해서 눈으로(또는 픽셀 비교로) 확인하는 절차가 별도로 존재
// (아래 ②의 렌더 스크립트 + ④의 대조 절차를 테스트 스위트의 일부로 문서화)
```

**왜 위험한가**: "속성이 문자열에 있다"와 "그 속성이 의도한 대로 보인다"는 다른 명제다. 다음 경우 전부 속성 테스트는 초록불이지만 화면은 깨진다:
- 두 개의 `stroke-dasharray`가 서로 다른 `<path>`에 겹쳐 찍혀 이중 노출된다.
- 텍스트가 컨테이너를 벗어나 잘린다.
- 색상 대비가 부족해 다크모드에서 안 보인다.
- z-index/겹침 순서가 바뀌어 다른 요소에 가려진다.
- 반응형 레이아웃에서 특정 화면 너비에서만 겹친다.
- 애니메이션/트랜지션 중간 프레임이 깨진다.

### ② 어떻게 찾나 (명령)

**패턴 1 — 시각 산출물을 문자열 포함 여부로만 검사하는 테스트를 찾는다**

```bash
rg -n '\.(toContain|toMatch|includes)\(.*(svg|canvas|render|html)' \
  -g '**/*.test.*' -g '**/*.spec.*' -i
```
- 무엇을 찾는가: 렌더링 결과(변수명에 svg/canvas/render/html이 들어간 경우)를 문자열 포함으로만 검사하는 단언.
- 왜 후보인가: 문자열 포함 검사는 "존재"만 증명하고 "위치/겹침/가독성"은 증명하지 못한다.
- 오탐: 정말로 속성 존재 여부만이 의미 있는 경우(예: 접근성 속성 `aria-label`이 붙었는지 확인 — 이건 시각적 겹침과 무관하므로 문자열 검사로 충분).

**패턴 2 — 스냅샷 테스트가 있는지, 있다면 이미지 스냅샷인지 텍스트 스냅샷인지 확인**

```bash
rg -n 'toMatchSnapshot|toMatchImageSnapshot|expect\(.*\)\.toMatchSnapshot' \
  -g '**/*.test.*' -g '**/*.spec.*'
```
- 무엇을 찾는가: 스냅샷 테스트 존재 여부.
- 왜 후보인가: `toMatchSnapshot()`(텍스트/DOM 직렬화)만 있고 `toMatchImageSnapshot()`(픽셀 비교)이 없다면, 여전히 "보이는 대로"는 검증되지 않는다 — DOM 구조가 같아도 CSS가 깨지면 스냅샷은 그대로다.

**패턴 3 — 시각 산출물을 만드는 함수/컴포넌트를 찾고, 그 옆에 렌더-후-확인 스크립트가 있는지 확인**

```bash
rg -l 'export (function|const) \w*(Svg|Chart|Marker|Icon|Canvas|Pdf)\w*' \
  --type-add 'code:*.{js,jsx,ts,tsx}' -tcode -g '!**/node_modules/**'
```
- 무엇을 찾는가: 시각 산출물 생성 함수 목록.
- 왜 후보인가: 이 목록을 만든 뒤, 각 함수마다 ②의 렌더 스크립트가 있는지, 최근 변경 시 그 스크립트를 실제로 돌려 PNG를 열어봤는지가 판정 대상이다.

### ③ 진짜인지 판정

1. **이 테스트가 실패하면, 실제로 눈에 보이는 문제가 있다는 뜻인가, 아니면 속성 문자열만 없어진 것인가?** — 속성이 있어도 다른 요소에 가려지거나 겹치는 경우를 그 테스트가 구분할 수 있는가.
2. **최근 이 함수/컴포넌트를 변경한 커밋에서, 렌더링 결과를 실제로 눈으로 본 흔적이 있는가?** — PR 설명, 커밋 메시지, 첨부 스크린샷을 확인. 없으면 "본 적 없이 병합됐다"는 뜻이다.
3. **겹침이 발생할 수 있는 구조적 조건이 있는가?** — 여러 시각 요소(테두리+꼬리, 아이콘+배지, 텍스트+배경)가 같은 좌표 공간을 공유하는지 코드를 읽어 확인. 공유한다면 겹침 가능성이 있고, 속성 테스트만으로는 못 잡는다.

### ④ 고친 뒤 검증 — 눈으로 보는 절차

headless 브라우저로 실제로 렌더링해서 이미지 파일로 저장하고, **그 파일을 직접 연다.**

**최소 스크립트 골격 (Playwright 예시 — Puppeteer/Selenium도 동일 원리)**

```js
// scripts/visual-check.mjs — 이 산출물을 만드는 코드를 실제 브라우저 컨텍스트에서 렌더
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 800, height: 600 },
  deviceScaleFactor: 3, // ← 중요: 1배율에서는 안티앨리어싱에 묻혀 안 보이는 1px 겹침이 3배율에서 드러난다
});

await page.goto('file://' + process.cwd() + '/scratch/render-target.html');
// 또는 로컬 개발 서버: await page.goto('http://localhost:5173/__visual-check?case=marker-dashed');

await page.waitForSelector('[data-testid="target"]'); // 렌더 완료 대기 (폰트/이미지 로드 포함)
await page.locator('[data-testid="target"]').screenshot({ path: 'scratch/out.png' });

await browser.close();
console.log('저장됨: scratch/out.png — 반드시 직접 열어서 확인할 것');
```

**절차**:
1. 위 스크립트로 **변경 전/후 두 장**을 각각 저장한다(`before.png`, `after.png`).
2. **확대 배율(`deviceScaleFactor`)을 3 이상**으로 올려 저장한다 — 1배율 스크린샷은 렌더러의 안티앨리어싱이 미세한 겹침·1px 어긋남을 뭉개버려서, 실제로는 깨진 것도 멀쩡해 보인다. 이번 사고(꼬리 뭉개짐)도 1배율에서는 눈에 잘 안 띄었다.
3. 두 이미지를 **직접 연다** (이미지 뷰어로 나란히 놓고 비교, 또는 `magick compare before.png after.png diff.png`처럼 픽셀 차이 이미지를 만들어 확인).
4. 의심 구간(테두리와 다른 요소가 겹치는 자리, 텍스트 경계, 색상 대비가 낮은 부분)을 **200% 이상 확대해서** 다시 본다.
5. 여러 "케이스"(정상/의심 플래그 켠 경우/빈 값/최댓값/최솟값)를 각각 렌더해서 한 장씩 저장한다 — 한 케이스만 보고 "됐다"고 하지 않는다.
6. 가능하면 **픽셀 diff를 CI에 남긴다**(`pixelmatch`, `jest-image-snapshot` 등). 사람이 매번 눈으로 볼 수 없으니, 최초 1회는 반드시 사람이 보고 기준(baseline) 이미지를 승인한 뒤, 이후는 자동 비교로 회귀를 잡는다.
7. 뒷정리: 검증용으로 만든 임시 페이지·스크립트·이미지 파일은 작업이 끝나면 지운다(흔적을 남기지 않는다).

### ⑤ 안티패턴

- "속성이 문자열에 있으니 렌더링도 맞을 것" — 존재와 겹침·가독성은 별개다.
- "DOM 스냅샷이 통과했으니 시각적으로도 통과" — CSS/레이아웃 붕괴는 DOM 구조를 안 바꾸고도 일어난다.
- "1배율 스크린샷으로 충분하다" — 미세한 겹침은 배율을 올려야 보인다.
- "코드 리뷰에서 로직만 보면 된다, 그림은 나중에 QA가 볼 것" — 자동화된 눈 확인 절차가 없으면 "나중"은 영원히 안 온다.
- "한 케이스만 렌더해서 봤으니 다른 케이스도 괜찮을 것" — 겹침은 특정 입력 조합(예: 특정 플래그 조합)에서만 발생하는 경우가 많다.
- "픽셀 비교 없이 사람이 매번 본다" — 확장성이 없어 곧 생략된다. 최초 1회 사람 승인 + 이후 자동 diff로 가야 지속된다.


---

## 부록 — 이 저장소(mibunyang)에 실제로 돌린 결과 (세션562, 2026-09-23)

이 프롬프트를 **작성한 저장소에 그대로 적용**한 기록이다. 프롬프트가 실제로 쓸모 있는지
확인한 실측이자, 다른 저장소에서 어떤 결과를 기대할 수 있는지 보여주는 예시다.

### 절 1(캐시 키) 결과

| 자리 | 키 | 결과를 가르는 입력 | 판정 |
|---|---|---|---|
| `KakaoMapView` `imgKey` | `점수\|가격\|coordShared` | 같음 | ✅ (이번에 고친 자리) |
| `useMarketStatsHistory` | `region\|gu` | URL도 `region`·`gu` | ✅ |
| `useHistoryData` | `endpoint\|idsKey∥apartmentId` | URL과 1:1 대응 | ✅ |
| `useFinlifeRates` | `topFinGrpNo` **만** | URL은 `apiPath`+`topFinGrpNo` | ⚠️ **잠재** |

**`useFinlifeRates` 는 지금은 안전하다** — 호출자(`useLoanRates`·`useRentLoanRates`)가
**각자 자기 `cacheRef` 를 만들고** `apiPath` 를 상수로 고정해 **캐시 범위 자체가 갈리기** 때문이다.
그러나 호출자가 `apiPath` 를 인자로 열거나 `cacheRef` 를 공유하면 **주담대 금리와 전세대출 금리가
섞인다.** 해당 파일에 경고 주석을 남겼다.

→ **교훈**: "키에 빠졌다" 가 곧 "버그다" 는 아니다. **캐시의 범위(scope)** 를 함께 봐야 한다.
범위가 이미 그 입력별로 갈려 있으면 키에 없어도 안전하다 — 다만 **우연히 안전한 구조**이므로
주석으로 못 박아 둔다.

### React 의존성 배열 — 자동 방어가 이미 있었다

`eslint-plugin-react-hooks` 의 `exhaustive-deps` 가 `recommended` 에 포함돼 있어
**`npm run lint` 가 이미 매번 검사**하고 있었다. 저장소 전체 **누락 0건**.

⚠️ 이 사실을 확인하는 과정에서 **가짜 초록불을 두 번** 겪었다:
1. `--rule` 로 규칙을 덮어쓰면 **플러그인을 못 찾아 아예 안 돈다**(에러가 나는데 grep 으로
   걸러내면 "0건" 으로 보인다).
2. 뮤테이션 문자열이 실제 코드와 안 맞아 **치환이 일어나지 않았는데** "검사기가 고장났다" 고
   오판했다. 실제 배열은 `[apartmentId, idsKey, endpoint]` 인데 `[endpoint, apartmentId, idsKey]`
   로 찾았다.

→ **교훈**: 뮤테이션 스크립트는 **치환이 실제로 일어났는지 단언**하라.
`assert new != old, "MUTATION FAILED"` 한 줄이 이 두 사고를 다 막는다.

### 절 2(시각 검증) 결과

- SVG 를 문자열로만 검사하는 단언 **2건** — 둘 다 이번에 손본 `markerSvg.test.ts`.
  `<svg` 태그 존재 확인이라 오탐(정당한 사용)이다.
- **진짜 사각지대 = `LineChart.tsx` 에 테스트 파일이 아예 없다.** 차트는 좌표를 계산해
  선을 그리므로 겹침·잘림이 가장 나기 쉬운 자리인데 검증이 0건이다.
  → 별도 작업으로 남긴다(이번 세션 범위 밖).
- 이번에 실제로 잡은 결함: 물방울 핀의 **원 테두리와 꼬리에 점선이 이중으로 얹혀 모양이 뭉개짐.**
  테스트 21건이 전부 초록이었고, **3배 확대 렌더(`deviceScaleFactor: 3`)로 눈으로 보고서야** 발견했다.
  고친 뒤에는 "꼬리에는 점선이 없어야 한다" 는 단언을 테스트에 추가해 회귀를 막았다.
