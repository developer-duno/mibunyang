# 세션 420 — deviation 음수 빨강 배지 + 비로그인 점수 블라인드 정합 (A+C 한 묶음)

## Context

세션 411이 적정가 괴리(deviation) 부호를 정정하면서 **양수(저렴)만 초록 배지**로 표시하고, 음수(비쌈)·비로그인 누설은 후속으로 분리했다(BACKLOG L276-278). 이번 세션은 그 두 잔여를 한 묶음으로 해소한다.

**왜 한 묶음인가**: 두 작업 모두 `src/components/AptCard.tsx`의 인접 줄(L95~109)을 건드린다. 따로 PR을 내면 두 번째가 첫 번째를 다시 손대야 한다(중복 수정). BACKLOG L278도 "한 묶음 일괄 처리 권장"으로 명시.

**의도한 결과**:
- (A) 적정가보다 **비싼**(deviation 음수) 단지에 카드에서 빨강 "비쌈" 배지를 정직하게 노출 — 저렴 단지의 초록 배지와 대칭.
- (C) 비로그인(손님)에게 **점수 계열**(카테고리 점수바·"안전 N등급")이 새는 구멍을 막아 정책(api/CLAUDE.md L123-126 "점수 블라인드")과 정합. 적정가·입지·deviation 배지는 점수가 아니므로 유지(사장님 결정 2026-06-15).

## 진실의 원천 (실측 확정)

- **deviation 부호**: `src/scoring/scorePrice.ts:163` 정상 분기 `deviation: dev.toFixed(1)`, `dev = (fairPrice - price)/fairPrice*100`. **양수 = 저렴, 음수 = 비쌈.** 데이터 부재 분기(L116)는 `deviation: "0.0"`(문자열).
- **deviation 타입**: `src/types/scoring.ts` `deviation?: string | number` (실제값은 문자열, AptCard에서 `Number(...)` 변환).
- **정책 원문**: `api/CLAUDE.md` L123-126 — "AptCard: 점수 블러(`??`)", "CompareSheet: 점수 `??` 텍스트 치환(CSS blur 아닌 DOM 미노출)". 정책이 가리라는 것은 **점수**.
- **현재 블라인드 상태**(AptCard.tsx):
  - L82-85 종합점수 ScoreBadge → 비로그인 시 `??` div로 **대체**(안전, DOM 미노출).
  - L93 카테고리 점수 숫자 → 비로그인 시 `??` + `blur(4px)`(텍스트만 가림).
  - **L95 Bar → 가드 없음**: `aria-valuenow={Math.round(value)}` + `width:${value}%`로 실점수가 DOM/접근성 트리에 노출(누설).
  - **L107 "안전 N등급" → 가드 없음**: 위험 카테고리 점수의 등급(D~A)이라 점수 계열인데 항상 노출(누설).
- **Bar 재사용처 6곳**: AptCard·CatPanel·InfrastructureSection·HighlightField·primitives.test. → 블라인드는 **AptCard 호출처(L95)에서만**, `primitives.tsx`의 Bar 컴포넌트는 **불변**(타 화면 영향 0).

## 변경 (단일 파일: `src/components/AptCard.tsx`)

### A — 음수 deviation 빨강 배지 (L109 다음 1줄 추가)

기존 저렴 배지(L109)는 그대로 두고, 그 다음에 음수 조건 빨강 배지를 추가. 인라인 `<span style={S.infoTag, background, color}>` 패턴은 바로 위 할인 배지(L108)·저렴 배지(L109)를 그대로 답습(`C.greenLight/C.green` → `C.redLight/C.red`).

```tsx
{res.cats.price?.deviation != null && Number(res.cats.price.deviation) < 0 && <span style={{ ...S.infoTag, background: C.redLight, color: C.red, fontWeight: 700 }}>주변대비 {Math.abs(Math.round(Number(res.cats.price.deviation)))}% 비쌈</span>}
```

- `EmphasisBadge`(primitives.tsx)는 "★ 중점" 텍스트 고정이라 부적합 → 인라인 span 답습이 정답.
- `< 0`만 매칭. 데이터 부재 `"0.0"`(=0)·null·양수는 미표시 → 저렴 배지와 상호배타(같은 단지가 동시에 둘 다 뜨지 않음).
- `Math.abs`로 표시값을 양수화("주변대비 8% 비쌈"). 부호는 색·문구가 전달.

### C — 점수 계열 블라인드 2곳 (L95 Bar, L107 안전등급)

**C-1. 카테고리 점수바(L95)** — 비로그인 시 실점수 width/aria 누설 차단. 종합 ScoreBadge(L82-85)가 `??` div로 **대체**하는 패턴을 답습해, Bar도 비로그인 시 회색 placeholder div로 대체:

```tsx
{isLoggedIn
  ? <Bar value={c.total} color={(catCol as Record<string, string>)[k]} h={5} />
  : <div aria-hidden="true" style={{ height: 5, background: "#ECEEF4", borderRadius: 99 }} />}
```

- `aria-hidden` + 점수 미바인딩 → DOM·접근성 트리 어디에도 실점수 없음.
- Bar 컴포넌트 자체는 불변(타 5개 화면 영향 0).

**C-2. "안전 N등급"(L107)** — 위험 카테고리 등급이라 점수 계열. 비로그인 시 등급 글자를 `?`로 치환(라벨 "안전 ?등급"으로 항목 존재는 알리되 값 미노출):

```tsx
<span style={S.infoTag}>안전 {isLoggedIn ? gr(res.cats.risk?.total ?? 0).l : "?"}등급</span>
```

- 텍스트 치환 방식(CompareSheet 정책 답습 — CSS blur 아닌 값 미노출).

### 유지 (점수 아님 — 변경 0)

- L102-105 적정가, L106 입지 정보, L108 할인 배지, L109 저렴 배지, A의 비쌈 배지 → 가격·입지·혜택 정보라 비로그인도 노출.

## 회귀 가드 (테스트, `src/components/AptCard.test.jsx`)

기존 deviation 4 테스트(양수→배지/음수→미표시/null→미표시/"0.0"→미표시)에 더해:

1. **A 신규**: `deviation = "-8.4"` + 로그인 시 "주변대비 8% 비쌈" 빨강 배지 표시 (기존 L189 "음수→미표시" 테스트는 *저렴 배지* 미표시 가드이므로 문구를 `/저렴/`으로 좁혀 비쌈 배지와 충돌 안 하게 정정 — 대조군 박제).
2. **A 상호배타**: 양수일 때 "비쌈" 미표시, 음수일 때 "저렴" 미표시.
3. **C-1 신규**: `isLoggedIn={false}` 시 progressbar(role)가 카테고리 영역에 렌더 안 됨(`queryAllByRole("progressbar")`로 카테고리 Bar 부재 확인) + 로그인 시 존재.
4. **C-2 신규**: `isLoggedIn={false}` 시 "안전 ?등급" 표시 + 실제 등급 글자(예 "안전 A등급") 미노출. 로그인 시 등급 노출.

> ⚠️ **대조군 함정**(세션 412 답습): 기존 "음수→배지 미표시" 테스트는 *저렴* 배지 기준이었는데 이제 음수면 *비쌈* 배지가 뜬다. `screen.queryByText(/주변대비/)`로 검사하던 케이스가 있으면 비쌈 배지를 잡아 깨짐 → `/저렴/` 또는 `/비쌈/`으로 의미를 명시해 정정.

## 검증

1. `npx vitest run src/components/AptCard.test.jsx` — 신규 포함 전부 green.
2. `npm run test` — 전체 회귀(기존 ~3395 + 신규). 다른 Bar 소비처 테스트 무변경 확인.
3. `npm run typecheck` — tsc 0 (deviation `string | number` 이미 `Number()` 변환, 타입 변경 없음).
4. `npm run lint` — 0.
5. `npx vite build` — 번들 빌드(주의: `npm run build`는 prebuild가 외부 API 수집 → 로컬 검증은 `vite build`만).
6. 라이브(사장님 👤): production 카카오 로그인 전/후로 카드 비교 — 비로그인 시 점수바·등급 가려지고 비쌈/저렴 배지·적정가는 보이는지.

## 비범위 (이번 PR 아님)

- B 부산물(backfill today() 통일·monitor 음수가드 테스트) — 독립 영역(scripts/), 별 PR.
- 상세 모달 진입 게이트 — 세션 413에서 이미 완료.
- deviation 배지를 비로그인에 가리는 것 — 사장님 결정(점수 계열만)에 따라 비범위.
