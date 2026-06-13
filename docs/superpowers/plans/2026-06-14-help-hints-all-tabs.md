# 전체 탭 ? 도움말 확장 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 세션 411의 분양 탭 ? 도움말 패턴을 종합·입지·시세 탭의 섹션 6개 + 차트 2개 + 적정가 괴리 인라인 지표까지 확장한다 (? 총 9개).

**Architecture:** `HelpHint`/`Tooltip`/`DataSectionBlock` 무변경 재사용. 섹션은 `dataSections.ts`의 `hint` 필드만 채우면 `DataSectionBlock`이 자동 렌더(`section.hint && <HelpHint/>`). 차트 2개와 적정가 괴리는 `<HelpHint text label/>` 한 줄 직접 삽입. 표현 계층만 변경 — 점수·정렬·스코어링 엔진 불변.

**Tech Stack:** React 19 + TypeScript, Vitest + @testing-library/react, `@/` 경로 별칭.

---

## 핵심 사실 (직독 확정)

- `Tooltip.tsx:68-70` — ? 트리거 = `role="button"` + `aria-label="${label} 풀이 보기"`. HelpHint가 `label`을 `term`으로 전달.
- 테스트 셀렉터 표준: `getByRole("button", { name: "<label> 풀이 보기" })` → 클릭 → `getByText("<hint>")`.
- `scorePrice.ts:127` — `dev = ((fairPrice - price) / fairPrice) * 100` → **양수=싸다, 음수=비싸다**.
- `DataSectionBlock.tsx:55` — `section.hint && <HelpHint text={section.hint} label={section.title} />` 이미 존재.
- `MarketStatsCharts.tsx:106-109,128` — 차트 제목 옆 HelpHint 패턴 (참조 원본).
- 차트 테스트 mock 패턴 — `vi.mock(hook)` + `vi.mock("@/components/primitives", LineChart stub)` + `makeData()`. PriceChart/UnsoldChart 테스트에 이미 "정상 렌더" 케이스 존재.

---

## File Structure

| 파일 | 책임 | 변경 |
|---|---|---|
| `src/lib/dataSections.ts` | 섹션 정의(hint 포함) | 6개 섹션에 `hint` 추가 |
| `src/components/detail/PriceChart.tsx` | 분양가 추이 차트 | 상수 1 + 제목에 HelpHint |
| `src/components/detail/UnsoldChart.tsx` | 미분양 추이 차트 | 상수 1 + 제목에 HelpHint |
| `src/components/DetailModal.tsx` | 모달 + 핵심지표 | import HelpHint + 적정가 괴리 행 hint 조건부 |
| `src/lib/dataSections.test.ts` | 섹션 hint 가드 | **신규** |
| `src/components/detail/PriceChart.test.jsx` | 차트 가드 | HelpHint 케이스 1 |
| `src/components/detail/UnsoldChart.test.jsx` | 차트 가드 | HelpHint 케이스 1 |

---

## Task 1: 섹션 hint 6개 (dataSections.ts)

**Files:**
- Modify: `src/lib/dataSections.ts` (OVERVIEW_SECTIONS / LOCATION_SECTIONS / PRICE_SECTIONS)
- Test: `src/lib/dataSections.test.ts` (신규)

- [ ] **Step 1: Write the failing test**

Create `src/lib/dataSections.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { OVERVIEW_SECTIONS, LOCATION_SECTIONS, PRICE_SECTIONS, PRESALE_SECTIONS } from "./dataSections";

describe("dataSections hint", () => {
  it("종합·입지·시세 섹션 6개 모두 hint 가 채워져 있다", () => {
    const all = [...OVERVIEW_SECTIONS, ...LOCATION_SECTIONS, ...PRICE_SECTIONS];
    expect(all).toHaveLength(6);
    for (const s of all) {
      expect(typeof s.hint).toBe("string");
      expect((s.hint ?? "").length).toBeGreaterThan(10);
    }
  });

  it("분양 섹션 hint(세션 411)는 그대로 유지된다", () => {
    expect(PRESALE_SECTIONS.every(s => (s.hint ?? "").length > 10)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/dataSections.test.ts`
Expected: FAIL — OVERVIEW/LOCATION/PRICE 섹션의 `s.hint`가 `undefined`.

- [ ] **Step 3: Add hint to 6 sections**

`src/lib/dataSections.ts` 의 각 섹션 객체에 `hint` 추가 (필드·title·기타 키 무변경):

`OVERVIEW_SECTIONS[0]` ("단지 기본정보") 에 추가:
```ts
    hint: "이 단지의 위치·세대수·시공사·관리비 같은 기본 정보예요. 데이터 신뢰도(%)는 우리가 모은 정보가 얼마나 충분한지 보여줘요.",
```

`LOCATION_SECTIONS[0]` ("생활인프라 (반경 1km)") 에 추가:
```ts
    hint: "걸어서 갈 만한 거리(반경 1km) 안에 병원·마트·편의점·공원 같은 생활시설이 몇 개 있는지예요. 많을수록 생활이 편해요.",
```

`LOCATION_SECTIONS[1]` ("교통 상세") 에 추가:
```ts
    hint: "가장 가까운 지하철역까지 거리, 버스 노선 수, 고속도로 IC·KTX 거리예요. 지하철이 가까울수록(500m 이내는 초록색) 출퇴근이 편해요.",
```

`LOCATION_SECTIONS[2]` ("치안/환경") 에 추가:
```ts
    hint: "주변 치안 안전등급, 가까운 경찰관서, 대기질(미세먼지), 혐오시설까지 거리예요. 안전하고 공기 좋은 곳인지 보는 정보예요.",
```

`PRICE_SECTIONS[0]` ("시장/투자 지표") 에 추가:
```ts
    hint: "집값이 적정한지 따지는 숫자들이에요. PIR은 '소득 몇 년치를 모아야 집을 사나'(낮을수록 좋음), PSR은 주변 시세 대비 비율, 순이동(+)은 사람이 늘어나는 동네라는 신호예요.",
```

`PRICE_SECTIONS[1]` ("네이버 교차검증") 에 추가:
```ts
    hint: "네이버 부동산에서 따로 모은 주변 시세·전세가율·매물 수예요. 우리 데이터와 비교해 시세를 두 번 확인하는 용도예요.",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/dataSections.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/dataSections.ts src/lib/dataSections.test.ts
git commit -m "feat: 종합·입지·시세 섹션 6개 ? 도움말 hint (세션 412)"
```

---

## Task 2: PriceChart 제목 HelpHint

**Files:**
- Modify: `src/components/detail/PriceChart.tsx`
- Test: `src/components/detail/PriceChart.test.jsx`

- [ ] **Step 1: Write the failing test**

`src/components/detail/PriceChart.test.jsx` 의 `describe` 블록 끝(L61 `});` 직전)에 추가:

```jsx
  // ? 도움말 노출
  it("정상 렌더 시 제목 옆 ? 도움말이 보인다", () => {
    mockUsePriceHistory.mockReturnValue({ data: makeData(3), loading: false, error: null, retry: vi.fn() });
    render(<PriceChart apartmentId={/** @type {any} */ (1)} siblingIds={[]} />);
    const trigger = screen.getByRole("button", { name: "분양가 추이 풀이 보기" });
    fireEvent.click(trigger);
    expect(screen.getByText(/매주 자동으로 모아/)).toBeTruthy();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/detail/PriceChart.test.jsx`
Expected: FAIL — `Unable to find role="button" name "분양가 추이 풀이 보기"`.

- [ ] **Step 3: Add HelpHint to PriceChart**

`src/components/detail/PriceChart.tsx`:

(a) import 추가 (L5 `import type` 뒤):
```ts
import { HelpHint } from "@/components/HelpHint";
```

(b) 모듈 스코프 상수 추가 (컴포넌트 함수 `export const PriceChart` 위, L7 주석 아래):
```ts
const PRICE_CHART_HINT = "이 단지(같은 분양 묶음)의 분양가가 시간에 따라 어떻게 바뀌었는지예요. 단위는 만원이고, 매주 자동으로 모아 쌓고 있어요.";
```

(c) 제목 줄(L41) 교체:
```tsx
      <div style={{ display: "flex", alignItems: "center", fontSize: F.sm, fontWeight: 700, color: C.text, marginBottom: 6 }}>분양가 추이<HelpHint text={PRICE_CHART_HINT} label="분양가 추이" /></div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/detail/PriceChart.test.jsx`
Expected: PASS (6 tests — 기존 5 + 신규 1).

- [ ] **Step 5: Commit**

```bash
git add src/components/detail/PriceChart.tsx src/components/detail/PriceChart.test.jsx
git commit -m "feat: 분양가 추이 차트 ? 도움말 (세션 412)"
```

---

## Task 3: UnsoldChart 제목 HelpHint

**Files:**
- Modify: `src/components/detail/UnsoldChart.tsx`
- Test: `src/components/detail/UnsoldChart.test.jsx`

- [ ] **Step 1: Write the failing test**

`src/components/detail/UnsoldChart.test.jsx` 의 `describe` 블록 끝(L63 `});` 직전)에 추가:

```jsx
  // ? 도움말 노출
  it("정상 렌더 시 제목 옆 ? 도움말이 보인다", () => {
    mockUseUnsoldHistory.mockReturnValue({ data: makeData(3, true), loading: false, error: null, retry: vi.fn() });
    render(<UnsoldChart apartmentId={/** @type {any} */ (1)} siblingIds={[]} />);
    const trigger = screen.getByRole("button", { name: "미분양 추이 풀이 보기" });
    fireEvent.click(trigger);
    expect(screen.getByText(/준공후 미분양/)).toBeTruthy();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/detail/UnsoldChart.test.jsx`
Expected: FAIL — `Unable to find role="button" name "미분양 추이 풀이 보기"`.

- [ ] **Step 3: Add HelpHint to UnsoldChart**

`src/components/detail/UnsoldChart.tsx`:

(a) import 추가 (L5 `import type` 뒤):
```ts
import { HelpHint } from "@/components/HelpHint";
```

(b) 모듈 스코프 상수 추가 (L7 주석 아래):
```ts
const UNSOLD_CHART_HINT = "이 단지의 안 팔린 세대(미분양)가 달마다 어떻게 변했는지예요. 빨강은 전체 미분양, 점선(┄)은 다 지어진 뒤에도 안 팔린 '준공후 미분양'이라 더 주의해서 봐야 해요. 매월 자동 수집.";
```

(c) 제목 span(L41) 교체 — 기존 `<span fontSize sm>미분양 추이</span>` 에 HelpHint 추가:
```tsx
        <span style={{ display: "flex", alignItems: "center", fontSize: F.sm, fontWeight: 700, color: C.text }}>미분양 추이<HelpHint text={UNSOLD_CHART_HINT} label="미분양 추이" /></span>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/detail/UnsoldChart.test.jsx`
Expected: PASS (6 tests — 기존 5 + 신규 1).

- [ ] **Step 5: Commit**

```bash
git add src/components/detail/UnsoldChart.tsx src/components/detail/UnsoldChart.test.jsx
git commit -m "feat: 미분양 추이 차트 ? 도움말 (준공후 미분양 설명 포함, 세션 412)"
```

---

## Task 4: 적정가 괴리 인라인 HelpHint (DetailModal)

**Files:**
- Modify: `src/components/DetailModal.tsx` (import + 핵심지표 배열 L246-253 + 렌더부 L256)

- [ ] **Step 1: Add import**

`src/components/DetailModal.tsx` 의 import 블록(L19 `import { MarketStatsCharts }` 부근)에 추가:
```ts
import { HelpHint } from "./HelpHint";
```

- [ ] **Step 2: 핵심지표 "적정가 괴리" 행에 hint 추가**

`DetailModal.tsx:248` 행 객체 끝에 `hint` 키 추가 (`l`, `v`, `c` 유지):
```tsx
              { l: "적정가 괴리", v: res.cats.price.deviation != null ? `${Number(res.cats.price.deviation) > 0 ? "+" : ""}${res.cats.price.deviation}%` : "—", c: res.cats.price.deviation != null ? (Number(res.cats.price.deviation) > 0 ? C.green : C.red) : C.muted, hint: "주변 시세로 계산한 '적정가'와 실제 분양가를 비교한 거예요. +(플러스)면 적정가보다 싸게(좋은 신호), −(마이너스)면 비싸게 나온 거예요. 예: +5%면 적정가보다 5% 저렴해요." },
```

- [ ] **Step 3: 렌더부 라벨 옆 조건부 HelpHint**

`DetailModal.tsx:256` 의 라벨 span 을 교체 — 행 객체에 `hint` 가 있는 행만 ? 노출. 배열 행마다 키가 다르므로 타입 안전하게 `(r as { hint?: string }).hint` 로 접근:
```tsx
                <span style={DM_S.metricsLabel}>{r.l}{(r as { hint?: string }).hint && <HelpHint text={(r as { hint?: string }).hint as string} label={r.l} />}</span>
```

- [ ] **Step 4: Run typecheck + 기존 DetailModal 테스트**

Run: `npx tsc --noEmit 2>&1 | grep -E "DetailModal|error TS" | head; echo "exit ${PIPESTATUS[0]}"`
Expected: DetailModal 관련 error 0.

Run: `npx vitest run src/components/DetailModal.test.tsx`
Expected: 기존 테스트 전부 PASS (회귀 0).

- [ ] **Step 5: Commit**

```bash
git add src/components/DetailModal.tsx
git commit -m "feat: 적정가 괴리 인라인 ? 도움말 (+면 싸다, 세션 412)"
```

---

## Task 5: 전체 회귀 가드 + 적대검증

- [ ] **Step 1: 전체 vitest**

Run: `npx vitest run 2>&1 | tail -5`
Expected: 전체 PASS. 신규 테스트 (dataSections 2 + PriceChart 1 + UnsoldChart 1 = 4) 반영. 세션 411 baseline 3403 → 3407 근방.

- [ ] **Step 2: tsc**

Run: `npx tsc --noEmit 2>&1 | tail -3; echo "exit ${PIPESTATUS[0]}"`
Expected: exit 0.

- [ ] **Step 3: eslint (변경 파일)**

Run:
```bash
npx eslint src/lib/dataSections.ts src/components/detail/PriceChart.tsx src/components/detail/UnsoldChart.tsx src/components/DetailModal.tsx src/lib/dataSections.test.ts src/components/detail/PriceChart.test.jsx src/components/detail/UnsoldChart.test.jsx
```
Expected: 0 errors.

- [ ] **Step 4: 적대검증 워크플로 — 카피 정확성**

카피 9개의 단위·부호·포맷이 데이터 진실(scorePrice.ts:127, fieldMeta.ts, dataSections.ts:26)과 일치하는지 다축 프로브.
⚠️ 세션 411 답습: 종합 응답이 잘리면("완료. 추가 작업 없음") 개별 프로브 `agent-*.jsonl` 직독 교차. 거짓 카피가 머지되지 않게.

특히 확인:
- 적정가 괴리 "+면 싸다" = scorePrice.ts:127 부호 방향 정합
- PIR "소득 몇 년치" = fieldMeta.ts:57 "소득대비" 의미 정합
- 순이동 "(+) 늘어나는 동네" = fieldMeta.ts:96 양수=유입 정합
- 지하철 "500m 이내 초록" = dataSections.ts:26 subwayDist ≤500 초록 정합

---

## Self-Review (작성자 점검 완료)

- **Spec 커버리지**: 차트 2(T2,T3) + 적정가 괴리 1(T4) + 섹션 6(T1) = 9개 모두 태스크 존재. ✅
- **Placeholder 스캔**: 없음. 모든 카피·코드 확정. ✅
- **타입 일관성**: `(r as { hint?: string }).hint` 동일 표현 2회 사용(접근·렌더). HelpHint prop `{ text, label }` 일관. ✅
- **비변경 불변식**: HelpHint·Tooltip·DataSectionBlock 무변경. 점수·엔진 무변경 → 정적 JSON 재계산 불필요. ✅
