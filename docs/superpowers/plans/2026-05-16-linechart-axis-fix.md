# LineChart Y축 눈금 개선 + 데이터 부족 시 표시 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 분양가/미분양 추이 그래프의 Y축 눈금 버그를 고치고, 데이터가 적을 때도 제대로 된 그래프로 보이게 한다.

**Architecture:** `LineChart.tsx` 파일 내에 `niceTicks()` 모듈 함수를 추가해 Y축 눈금 계산을 교체한다. 외부 차트 라이브러리 없이 자체 SVG 컴포넌트를 개선한다. 데이터가 적을 때(≤3) 점을 강조하고, 소비자(`PriceChart`/`UnsoldChart`)에 "누적 중" 안내 문구를 추가한다.

**Tech Stack:** React 19 + TypeScript (JSX/TSX), SVG, Vitest + Testing Library. 빌드 = Vite. 테스트 실행 = `npx vitest run`.

**Spec:** `docs/superpowers/specs/2026-05-16-linechart-axis-fix-design.md`

---

## File Structure

| 파일 | 책임 | 작업 |
|---|---|---|
| `src/components/LineChart.tsx` | 시계열 SVG 라인 차트 엔진 | Modify — `niceTicks` 함수 추가 + 눈금/좌표/점 렌더 교체 |
| `src/components/detail/PriceChart.tsx` | 분양가 추이 (LineChart 소비자) | Modify — "누적 중" 안내 문구 |
| `src/components/detail/UnsoldChart.tsx` | 미분양 추이 (LineChart 소비자) | Modify — "누적 중" 안내 문구 |
| `src/components/primitives.test.jsx` | LineChart 테스트 (LineChart 절 존재) | Modify — `niceTicks` 단위 테스트 + LineChart 보강 |

`niceTicks` 는 `LineChart.tsx` 에서 `export` 한다 (테스트가 직접 import). `MarketStatsCharts.tsx` 는 변경하지 않는다 — `LineChart` props 시그니처가 불변이라 개선 혜택만 자동 수령.

---

## 배경: 현재 LineChart.tsx 의 문제 코드

`src/components/LineChart.tsx` L40~53 (현재):

```tsx
const allY = [...data.map(d => d.y), ...(secondaryData || []).map(d => d.y).filter(v => v != null)];
const minY = Math.min(...allY), maxY = Math.max(...allY);
const rangeY = maxY - minY || 1;
const toX = (i: number, len: number) => pad.l + (i / (len - 1)) * iw;
const toY = (v: number) => pad.t + ih - ((v - minY) / rangeY) * ih;
const makePath = (pts: Array<{ y: number | null }>) => pts.map((d, i) => `${i === 0 ? "M" : "L"}${toX(i, pts.length).toFixed(1)},${toY(d.y as number).toFixed(1)}`).join(" ");
const gridLines = 4;
```

L52~54 그리드 렌더 (현재):

```tsx
{Array.from({ length: gridLines + 1 }, (_, i) => { const y = pad.t + (ih / gridLines) * i; const val = maxY - (rangeY / gridLines) * i; return (
  <g key={i}><line x1={pad.l} y1={y} x2={w - pad.r} y2={y} stroke="#E5E7EB" strokeWidth=".5" /><text x={pad.l - 4} y={y} textAnchor="end" dy="0.35em" fill={C.muted} fontSize={F.micro}>{Math.round(val).toLocaleString()}</text></g>
); })}
```

**버그**: `rangeY = maxY - minY || 1` 이 모든 값 동일 시 인위적 1 → 소수 눈금 + `Math.round` 중복 라벨. `gridLines` 고정 4등분 → 정수 데이터에 소수 눈금.

---

## Task 1: niceTicks 함수 + 단위 테스트

**Files:**
- Modify: `src/components/LineChart.tsx` (파일 상단, import 다음에 함수 추가)
- Test: `src/components/primitives.test.jsx` (LineChart describe 블록 위에 niceTicks describe 추가)

- [ ] **Step 1: 테스트 작성 — niceTicks 단위 테스트**

`src/components/primitives.test.jsx` 상단 import 에 `niceTicks` 추가. 현재 L4:

```jsx
import { Bar, ScoreBadge, Radar, LineChart, SkeletonBox, SkeletonText, SkeletonList } from "./primitives";
```

→ 그 아래 줄에 추가:

```jsx
import { niceTicks } from "./LineChart";
```

그리고 `describe("LineChart", () => {` 블록 **바로 위**에 다음 describe 블록을 삽입:

```jsx
describe("niceTicks", () => {
  // 불변식: 항상 min < max 이고 ticks 2개 이상
  it("모든 반환값이 min<max + ticks.length>=2 불변식 만족", () => {
    for (const [a, b] of [[1, 1], [52845, 52845], [0, 1], [100, 120], [1, 5], [0, 0], [3, 3]]) {
      const r = niceTicks(a, b);
      expect(r.min).toBeLessThan(r.max);
      expect(r.ticks.length).toBeGreaterThanOrEqual(2);
    }
  });

  // 작은 정수 동일값 → 값 중앙 + 정수 눈금
  it("niceTicks(1,1) → 정수 눈금 [0,1,2], 1이 중앙", () => {
    const r = niceTicks(1, 1);
    expect(r.ticks).toEqual([0, 1, 2]);
    expect(r.min).toBe(0);
    expect(r.max).toBe(2);
  });

  // 큰 동일값 → 값 중앙 + 위아래 여백 (소수 눈금 정체 방지)
  it("niceTicks(52845,52845) → 3 눈금, 52845가 가운데", () => {
    const r = niceTicks(52845, 52845);
    expect(r.ticks).toContain(52845);
    expect(r.ticks.length).toBe(3);
    expect(r.min).toBeLessThan(52845);
    expect(r.max).toBeGreaterThan(52845);
  });

  // 작은 정수 범위 → 정수 눈금만 (소수 눈금 제거)
  it("niceTicks(0,1) → 정수 눈금 [0,1]", () => {
    expect(niceTicks(0, 1).ticks).toEqual([0, 1]);
  });

  // 미분양 0건 지속 케이스
  it("niceTicks(0,0) → [0,1] 정수 눈금", () => {
    const r = niceTicks(0, 0);
    expect(r.ticks).toEqual([0, 1]);
  });

  // 일반 데이터 → nice step (5 또는 10 배수 간격)
  it("niceTicks(100,120) → 5 단위 nice 눈금", () => {
    const r = niceTicks(100, 120);
    expect(r.ticks).toEqual([100, 105, 110, 115, 120]);
  });

  // 정수 데이터 11 이상 범위 → nice step 적용 (정수 1단위 분기 벗어남)
  it("niceTicks(0,40) → nice step 눈금, 첫 눈금 0", () => {
    const r = niceTicks(0, 40);
    expect(r.ticks[0]).toBe(0);
    expect(r.min).toBe(0);
    expect(r.ticks.length).toBeGreaterThanOrEqual(4);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `npx vitest run src/components/primitives.test.jsx -t niceTicks`
Expected: FAIL — `niceTicks` is not exported / not a function

- [ ] **Step 3: niceTicks 구현**

`src/components/LineChart.tsx` 의 import 블록 (현재 L1~2) 다음, `TOOLTIP_DISMISS_MS` 상수 (현재 L4) **위**에 다음을 추가:

```tsx
/** Y축 눈금 스케일 — niceTicks 반환 타입. */
export type NiceScale = { ticks: number[]; min: number; max: number };

/** 원시 간격을 1·2·5·10 의 10^n 배수 중 가까운 "nice" 값으로 올림. */
function niceStep(raw: number): number {
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return nice * mag;
}

/**
 * Y축 눈금 계산. 항상 min<max + ticks.length>=2 보장 (rangeY=0 방어).
 * - 모든 값 동일: 값을 중앙에 두고 위아래 여백 (작은 정수는 ±1 정수 눈금)
 * - 작은 정수 범위(<=10): 정수 1단위 눈금 (소수 눈금 제거)
 * - 일반: 1·2·5·10 nice step 으로 4~5 눈금
 */
export function niceTicks(minY: number, maxY: number): NiceScale {
  // 1) 모든 값 동일
  if (maxY === minY) {
    const v = minY;
    if (Number.isInteger(v) && Math.abs(v) <= 10) {
      const min = Math.max(0, v - 1), max = v + 1;
      const ticks: number[] = [];
      for (let t = min; t <= max; t++) ticks.push(t);
      return { ticks, min, max };
    }
    const pad = Math.max(1, Math.abs(v) * 0.001);
    const mag = Math.pow(10, Math.floor(Math.log10(pad)));
    const step = Math.ceil(pad / mag) * mag;
    return { ticks: [v - step, v, v + step], min: v - step, max: v + step };
  }
  // 2) 작은 정수 범위
  if (Number.isInteger(minY) && Number.isInteger(maxY) && maxY - minY <= 10) {
    const min = Math.floor(minY), max = Math.ceil(maxY);
    const ticks: number[] = [];
    for (let t = min; t <= max; t++) ticks.push(t);
    return { ticks, min, max };
  }
  // 3) 일반 — nice step
  const step = niceStep((maxY - minY) / 4);
  const min = Math.floor(minY / step) * step;
  const max = Math.ceil(maxY / step) * step;
  const ticks: number[] = [];
  for (let t = min; t <= max + 1e-9; t += step) ticks.push(Math.round(t * 1e6) / 1e6);
  return { ticks, min, max };
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

Run: `npx vitest run src/components/primitives.test.jsx -t niceTicks`
Expected: PASS — niceTicks 7 테스트 전부 통과

- [ ] **Step 5: 커밋**

```bash
git add src/components/LineChart.tsx src/components/primitives.test.jsx
git commit -m "feat(linechart): niceTicks Y축 눈금 계산 함수 추가

모든 값 동일/작은 정수 범위/일반 3분기. min<max + ticks.length>=2 불변식 보장.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: LineChart 가 niceTicks 사용 — 눈금/좌표 교체

**Files:**
- Modify: `src/components/LineChart.tsx` (좌표 변환 L40~45, 그리드 렌더 L52~54)
- Test: `src/components/primitives.test.jsx` (LineChart describe 블록)

- [ ] **Step 1: 테스트 작성 — 평평한 직선이 가장자리에 안 붙는지 검증**

`src/components/primitives.test.jsx` 의 `describe("LineChart", () => {` 블록 안, 기존 테스트들 **다음**에 추가:

```jsx
  // 모든 값이 동일해도 선이 차트 가운데에 그려진다 (가장자리에 안 붙음)
  it("모든 y 동일 시 선이 차트 가장자리에 붙지 않는다", () => {
    const flat = [
      { x: "1월", y: 52845 },
      { x: "2월", y: 52845 },
    ];
    const { container } = render(<LineChart data={flat} height={160} />);
    const path = container.querySelector("path[stroke]");
    expect(path).toBeInTheDocument();
    // path d 의 y 좌표 추출 — "M44.0,YY.Y L256.0,YY.Y"
    const d = path.getAttribute("d");
    const ys = [...d.matchAll(/[ML][\d.]+,([\d.]+)/g)].map(m => parseFloat(m[1]));
    // height 160, pad.t=16, pad.b=28 → 내부 영역 16~132. 가운데 ≈ 74
    // 가장자리(16 또는 132)에 붙으면 버그. 30~120 사이면 정상
    for (const y of ys) {
      expect(y).toBeGreaterThan(30);
      expect(y).toBeLessThan(120);
    }
  });

  // 정수 데이터의 Y축 눈금 텍스트에 소수점이 없다
  it("정수 데이터 Y축 눈금에 소수점 라벨 없음", () => {
    const intData = [
      { x: "1월", y: 1 },
      { x: "2월", y: 1 },
    ];
    const { container } = render(<LineChart data={intData} height={160} />);
    // 그리드 라벨 text (textAnchor=end) 추출
    const labels = [...container.querySelectorAll("text")]
      .map(t => t.textContent)
      .filter(t => t && /^\d/.test(t));
    for (const l of labels) {
      expect(l).not.toMatch(/\./);  // 소수점 없음
    }
  });
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `npx vitest run src/components/primitives.test.jsx -t LineChart`
Expected: FAIL — 평평한 직선 테스트에서 y 좌표가 가장자리(16 또는 132)에 붙음 (현재 `rangeY||1` 버그)

- [ ] **Step 3: LineChart 좌표 변환 교체**

`src/components/LineChart.tsx` 현재 L40~46:

```tsx
  const allY = [...data.map(d => d.y), ...(secondaryData || []).map(d => d.y).filter(v => v != null)];
  const minY = Math.min(...allY), maxY = Math.max(...allY);
  const rangeY = maxY - minY || 1;
  const toX = (i: number, len: number) => pad.l + (i / (len - 1)) * iw;
  const toY = (v: number) => pad.t + ih - ((v - minY) / rangeY) * ih;
  const makePath = (pts: Array<{ y: number | null }>) => pts.map((d, i) => `${i === 0 ? "M" : "L"}${toX(i, pts.length).toFixed(1)},${toY(d.y as number).toFixed(1)}`).join(" ");
  const gridLines = 4;
```

→ 다음으로 교체:

```tsx
  const allY = [...data.map(d => d.y), ...(secondaryData || []).map(d => d.y).filter(v => v != null)] as number[];
  const dataMinY = Math.min(...allY), dataMaxY = Math.max(...allY);
  const { ticks, min: scaleMin, max: scaleMax } = niceTicks(dataMinY, dataMaxY);
  const rangeY = scaleMax - scaleMin;  // niceTicks 불변식 → 항상 > 0
  const toX = (i: number, len: number) => pad.l + (i / (len - 1)) * iw;
  const toY = (v: number) => pad.t + ih - ((v - scaleMin) / rangeY) * ih;
  const makePath = (pts: Array<{ y: number | null }>) => pts.map((d, i) => `${i === 0 ? "M" : "L"}${toX(i, pts.length).toFixed(1)},${toY(d.y as number).toFixed(1)}`).join(" ");
```

(`const gridLines = 4;` 줄은 삭제 — 다음 스텝에서 `ticks` 배열로 대체)

- [ ] **Step 4: LineChart 그리드 렌더 교체**

`src/components/LineChart.tsx` 현재 L52~54 (그리드 라인 + Y축 라벨):

```tsx
      {Array.from({ length: gridLines + 1 }, (_, i) => { const y = pad.t + (ih / gridLines) * i; const val = maxY - (rangeY / gridLines) * i; return (
        <g key={i}><line x1={pad.l} y1={y} x2={w - pad.r} y2={y} stroke="#E5E7EB" strokeWidth=".5" /><text x={pad.l - 4} y={y} textAnchor="end" dy="0.35em" fill={C.muted} fontSize={F.micro}>{Math.round(val).toLocaleString()}</text></g>
      ); })}
```

→ `ticks` 배열 순회로 교체:

```tsx
      {ticks.map((val, i) => { const y = toY(val); return (
        <g key={i}><line x1={pad.l} y1={y} x2={w - pad.r} y2={y} stroke="#E5E7EB" strokeWidth=".5" /><text x={pad.l - 4} y={y} textAnchor="end" dy="0.35em" fill={C.muted} fontSize={F.micro}>{val.toLocaleString()}</text></g>
      ); })}
```

(`Math.round` 제거 — `niceTicks` 가 이미 깔끔한 값을 반환. `val.toLocaleString()` 직접 사용)

- [ ] **Step 5: 테스트 실행 — 통과 확인**

Run: `npx vitest run src/components/primitives.test.jsx -t LineChart`
Expected: PASS — 평평한 직선/정수 눈금 신규 2건 + 기존 LineChart 5건 전부 통과

- [ ] **Step 6: 타입 체크**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 7: 커밋**

```bash
git add src/components/LineChart.tsx src/components/primitives.test.jsx
git commit -m "fix(linechart): Y축 눈금 niceTicks 적용 — 소수 눈금/평평한 직선 정체 해소

rangeY=0 방어 + 정수 데이터 정수 눈금. Math.round 중복 라벨 제거.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: 데이터 적을 때(≤3) 점 강조 + 값 라벨 상시 표시

**Files:**
- Modify: `src/components/LineChart.tsx` (점 렌더 L57, 값 라벨 추가)
- Test: `src/components/primitives.test.jsx` (LineChart describe 블록)

- [ ] **Step 1: 테스트 작성 — 데이터 ≤3 시 점 반지름 확대**

`src/components/primitives.test.jsx` 의 `describe("LineChart", () => {` 블록 안에 추가:

```jsx
  // 데이터 3개 이하 → 점 반지름 확대 (r=4.5)
  it("데이터 3개 이하면 점 반지름이 4.5", () => {
    const few = [
      { x: "1월", y: 100 },
      { x: "2월", y: 120 },
    ];
    const { container } = render(<LineChart data={few} />);
    // 시각 dot circle (r 속성, fill=color, data-index 없음)
    const dots = [...container.querySelectorAll("circle")].filter(
      c => c.getAttribute("r") === "4.5" && !c.hasAttribute("data-index")
    );
    expect(dots.length).toBe(2);
  });

  // 데이터 4개 이상 → 점 반지름 기존(r=3)
  it("데이터 4개 이상이면 점 반지름이 3", () => {
    const many = [
      { x: "1월", y: 100 }, { x: "2월", y: 120 },
      { x: "3월", y: 110 }, { x: "4월", y: 130 },
    ];
    const { container } = render(<LineChart data={many} />);
    const dots = [...container.querySelectorAll("circle")].filter(
      c => c.getAttribute("r") === "3" && !c.hasAttribute("data-index")
    );
    expect(dots.length).toBe(4);
  });

  // 데이터 3개 이하 → 각 점에 값 라벨 텍스트 상시 표시
  it("데이터 3개 이하면 각 점 위에 값 라벨 표시", () => {
    const few = [
      { x: "1월", y: 1000 },
      { x: "2월", y: 2000 },
    ];
    const { container } = render(<LineChart data={few} />);
    // 값 라벨 = data-pointlabel 속성 가진 text
    const valLabels = container.querySelectorAll("text[data-pointlabel]");
    expect(valLabels.length).toBe(2);
    expect(valLabels[0].textContent).toBe("1,000");
    expect(valLabels[1].textContent).toBe("2,000");
  });
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `npx vitest run src/components/primitives.test.jsx -t LineChart`
Expected: FAIL — 점 반지름이 항상 3 (현재 하드코딩) / `data-pointlabel` 요소 없음

- [ ] **Step 3: LineChart 점 렌더 교체**

`src/components/LineChart.tsx` 현재 L57 (시각 dot circle):

```tsx
      {data.map((d, i) => <circle key={i} cx={toX(i, data.length)} cy={toY(d.y as number)} r="3" fill={color}><title>{d.label || `${d.x}: ${d.y}`}</title></circle>)}
```

→ 데이터 수 기준 반지름 분기 + 값 라벨 추가. `makePath(data)` path 직후 (현재 L56) 다음, hit area (현재 L59) **위**에 다음으로 교체/삽입:

먼저 좌표 변환 블록 (Task 2 에서 만든 `makePath` 정의) 다음 줄에 상수 추가:

```tsx
  const fewPoints = data.length <= 3;
  const dotR = fewPoints ? "4.5" : "3";
```

그리고 현재 L57 의 시각 dot 렌더를 다음으로 교체:

```tsx
      {data.map((d, i) => <circle key={i} cx={toX(i, data.length)} cy={toY(d.y as number)} r={dotR} fill={color}><title>{d.label || `${d.x}: ${d.y}`}</title></circle>)}
      {fewPoints && data.map((d, i) => {
        const cx = toX(i, data.length);
        const cy = toY(d.y as number);
        // 라벨이 차트 위로 안 잘리게 — 점이 위쪽이면 아래에 표시
        const above = cy > pad.t + 16;
        return (
          <text key={`pl${i}`} data-pointlabel="" x={cx} y={above ? cy - 8 : cy + 16} textAnchor="middle" fill={C.text} fontSize={F.micro} fontWeight="600">
            {(d.y as number).toLocaleString()}
          </text>
        );
      })}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

Run: `npx vitest run src/components/primitives.test.jsx -t LineChart`
Expected: PASS — 점 반지름 2건 + 값 라벨 1건 신규 + 기존 LineChart 테스트 전부 통과

- [ ] **Step 5: 타입 체크**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 6: 커밋**

```bash
git add src/components/LineChart.tsx src/components/primitives.test.jsx
git commit -m "feat(linechart): 데이터 3개 이하 시 점 강조 + 값 라벨 상시 표시

데이터가 적어도 그래프가 단조롭지 않고 각 점이 명확히 보이도록.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: PriceChart / UnsoldChart "누적 중" 안내 문구

**Files:**
- Modify: `src/components/detail/PriceChart.tsx` (return JSX)
- Modify: `src/components/detail/UnsoldChart.tsx` (return JSX)
- Test: 없음 — 소비자 컴포넌트 단순 조건부 텍스트. LineChart 핵심 로직은 Task 1~3 에서 검증됨. App.test 회귀로 충분.

- [ ] **Step 1: PriceChart 안내 문구 추가**

`src/components/detail/PriceChart.tsx` 현재 return 블록 (L39~44):

```tsx
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: F.sm, fontWeight: 700, color: C.text, marginBottom: 6 }}>분양가 추이</div>
      <LineChart data={chartData} color={C.green} height={160} yLabel="분양가 추이" />
    </div>
  );
```

→ 다음으로 교체 (`chartData.length < 6` 일 때 문구 추가):

```tsx
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: F.sm, fontWeight: 700, color: C.text, marginBottom: 6 }}>분양가 추이</div>
      <LineChart data={chartData} color={C.green} height={160} yLabel="분양가 추이" />
      {chartData.length < 6 && (
        <div style={{ fontSize: F.micro, color: C.muted, marginTop: 4, textAlign: "center" }}>
          데이터 {chartData.length}개 · 매주 자동 수집 누적 중
        </div>
      )}
    </div>
  );
```

- [ ] **Step 2: UnsoldChart 안내 문구 추가**

`src/components/detail/UnsoldChart.tsx` 현재 return 블록 (L38~47):

```tsx
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: F.sm, fontWeight: 700, color: C.text }}>미분양 추이</span>
        <span style={{ fontSize: F.micro, color: C.red }}>● 미분양</span>
        {secondaryData.length >= 2 && <span style={{ fontSize: F.micro, color: C.muted }}>┄ 준공후</span>}
      </div>
      <LineChart data={chartData} color={C.red} height={160} yLabel="미분양 추이" secondaryData={secondaryData.length >= 2 ? secondaryData : undefined} secondaryColor={C.amber} />
    </div>
  );
```

→ `LineChart` 다음에 문구 추가:

```tsx
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: F.sm, fontWeight: 700, color: C.text }}>미분양 추이</span>
        <span style={{ fontSize: F.micro, color: C.red }}>● 미분양</span>
        {secondaryData.length >= 2 && <span style={{ fontSize: F.micro, color: C.muted }}>┄ 준공후</span>}
      </div>
      <LineChart data={chartData} color={C.red} height={160} yLabel="미분양 추이" secondaryData={secondaryData.length >= 2 ? secondaryData : undefined} secondaryColor={C.amber} />
      {chartData.length < 6 && (
        <div style={{ fontSize: F.micro, color: C.muted, marginTop: 4, textAlign: "center" }}>
          데이터 {chartData.length}개 · 매월 자동 수집 누적 중
        </div>
      )}
    </div>
  );
```

- [ ] **Step 3: 타입 체크**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 4: 커밋**

```bash
git add src/components/detail/PriceChart.tsx src/components/detail/UnsoldChart.tsx
git commit -m "feat(detail): 분양가/미분양 추이 데이터 부족 시 누적 중 안내 문구

데이터 6개 미만일 때 그래프 아래 안내 — 고장이 아닌 누적 대기 상태임을 명시.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: 전체 회귀 검증 + 빌드

**Files:** 없음 (검증만)

- [ ] **Step 1: 컴포넌트 전체 테스트**

Run: `npx vitest run src/components`
Expected: PASS — 전체 components 테스트 (96 파일 기준, niceTicks/LineChart 신규 포함). 실패 0건.

- [ ] **Step 2: 타입 체크 (전체)**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 3: 린트**

Run: `npm run lint`
Expected: 0 errors / 0 warnings

- [ ] **Step 4: 빌드**

Run: `npm run build`
Expected: 성공. 번들 크기 — vendor/index 가 변경 전과 동일 수준 (외부 의존 추가 0).

- [ ] **Step 5: 육안 검증 안내 (👤 사용자)**

dev 서버(`npm run dev`)에서 카카오 로그인 후 강북구 단지 상세(예: 수유동 북한산 스카이뷰) 진입:
- 분양가 추이: Y축 눈금이 깔끔한 값, 점 2개가 크게 + 값 라벨, 아래 "데이터 2개 · 매주 자동 수집 누적 중"
- 미분양 추이: Y축 눈금이 정수만(0,1,2 등 — 소수 없음), 평평한 선이 차트 가운데, 아래 "데이터 2개 · 매월 자동 수집 누적 중"

- [ ] **Step 6: push + CI 확인**

```bash
git push origin main
gh run list --branch main --limit 1 --json conclusion,status
```

Expected: CI success.

---

## Self-Review

**Spec coverage:**
- ✅ 결함 1 (Y축 눈금 버그) → Task 1 (`niceTicks`) + Task 2 (적용)
- ✅ 결함 2 (데이터 부족 단조로움) → Task 3 (점 강조) + Task 4 (안내 문구)
- ✅ 접근법 A (LineChart 내 모듈 함수, 외부 라이브러리 미사용) → Task 1 `niceTicks` export
- ✅ 데이터 부족 시 "그래프 + 누적 중 안내 동시" → Task 3 + Task 4
- ✅ 테스트 (niceTicks 단위 + LineChart 보강) → Task 1 Step 1, Task 2 Step 1, Task 3 Step 1
- ✅ 검증 (typecheck/회귀/빌드/육안) → Task 5
- ✅ 비-작업 (MarketStatsCharts 불변) → File Structure 명시, 변경 task 없음

**Type consistency:**
- `niceTicks(minY, maxY): NiceScale` — Task 1 정의, Task 2 Step 3 에서 `{ ticks, min, max }` 구조분해로 사용. 일치.
- `NiceScale = { ticks: number[]; min: number; max: number }` — Task 1 export, 전 task 일관.
- `fewPoints` / `dotR` — Task 3 Step 3 에서 정의 + 사용. 동일 task 내 일관.
- `chartData.length` — Task 4 에서 PriceChart/UnsoldChart 의 기존 변수 (`PriceChart.tsx` L37 / `UnsoldChart.tsx` L36 에 `chartData` 존재) 재사용. 신규 변수 아님.

**Placeholder scan:** 모든 코드 스텝에 실제 코드 포함. TBD/TODO 없음. 테스트 코드 전부 명시.
