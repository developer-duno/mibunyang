# LineChart Y축 눈금 개선 + 데이터 부족 시 표시 — 설계

> 작성: 2026-05-16 (세션 258 후속). 대상: `src/components/LineChart.tsx` + 소비자 2개.

## Context

DetailModal 단지 상세의 분양가 추이·미분양 추이 그래프가 깨져 보인다는 사용자 보고. 실측 진단 결과 두 갈래 결함이 동시에 작동한다.

### 결함 1 — Y축 눈금 계산 (실제 컴포넌트 버그)

`LineChart.tsx` L41~53 의 눈금 계산:

```js
const rangeY = maxY - minY || 1;          // 모든 값이 같으면 인위적 1
const gridLines = 4;                       // 무조건 4등분
const val = maxY - (rangeY / gridLines) * i;  // 0.25 단위 소수 눈금 발생
Math.round(val)                            // 반올림 → 중복 라벨
```

실측 시뮬레이션:
- 미분양 `[1, 1]` → 눈금 `1, 0.75, 0.5, 0.25, 0` → `Math.round` → **`1,1,1,0,0`** (스크린샷의 "1,1,0,0")
- 분양가 `[52845, 52845]` → 눈금 `52845, 52844.75, ... 52844` → `Math.round` → **`52845,52845,52845,52844,52844`** (스크린샷의 "52,845/52,844" 정체)

두 원인: (1) 모든 값이 같을 때 `rangeY` 가 인위적 1 이 되어 미세 소수 눈금이 생김, (2) 정수 데이터(세대수)에 소수 눈금이 무조건 4등분으로 찍힘.

### 결함 2 — 데이터 2~3개일 때 단조로움

수유동 북한산 스카이뷰 단지 실측: `prices` 2행 (3/14·3/20, 둘 다 52845), `unsold_history` 2행 (1월·2월, 둘 다 1). 데이터가 적고 값이 안 변해 평평한 직선 → 사용자가 "고장난 것"으로 오인.

데이터는 cron 누적(분양가 매주 / 미분양 매월)으로 시간이 지나면 늘어난다. 본 작업은 "적을 때도 제대로 된 그래프로 보이게" 만드는 것.

## 목표 (사용자 확정)

- **범위**: 컴포넌트 품질 전반 개선 (눈금 버그 + 데이터 부족 표시 둘 다)
- **접근법 A**: `LineChart.tsx` 파일 내에서 개선. 눈금 계산은 파일 내 모듈 함수로 분리 (단위 테스트 가능). 외부 차트 라이브러리 미사용 (번들 0KB 증가).
- **데이터 부족 시**: 그래프 + "누적 중" 안내 문구 동시 표시.

## 변경 범위

| 파일 | 변경 |
|---|---|
| `src/components/LineChart.tsx` | `niceTicks()` 모듈 함수 추가 + Y축 눈금/좌표 변환 교체 + 점 강조 로직 |
| `src/components/detail/PriceChart.tsx` | 데이터 부족 시 "누적 중" 안내 문구 |
| `src/components/detail/UnsoldChart.tsx` | 데이터 부족 시 "누적 중" 안내 문구 |
| `src/components/primitives.test.jsx` | `niceTicks` 단위 테스트 + LineChart 테스트 보강 |

`MarketStatsCharts.tsx` 도 `LineChart` 를 쓰지만 props 시그니처 불변 → 개선 혜택만 자동 수령, 코드 변경 없음.

## 설계

### 1. `niceTicks(minY, maxY)` 모듈 함수

`LineChart.tsx` 파일 상단에 `export` 모듈 함수로 추가. 입력 = 데이터 y 최소/최대. 반환:

```ts
type NiceScale = { ticks: number[]; min: number; max: number };
function niceTicks(minY: number, maxY: number): NiceScale
```

분기 동작:

1. **모든 값이 같을 때** (`maxY === minY`):
   - 값 `v` 를 중앙에 두고 위아래 여백을 만든다.
   - `v` 가 정수이고 `v <= 10` (미분양 등 작은 정수): `min = max(0, v-1)`, `max = v+1`, ticks = 정수 1단위 (`[0,1,2]` 형태).
   - 그 외 (분양가 등 큰 값): `v` 기준 ±(자릿수 단위)로 여백. `min/max` 가 `v` 를 정확히 가운데 두도록. ticks 3개 (`min, v, max`).
2. **정수 데이터** (모든 y 가 정수 && `maxY - minY <= 10`):
   - `min = floor(minY)`, `max = ceil(maxY)`, ticks = `min`~`max` 1단위 정수 배열. 소수 눈금 제거.
3. **일반 데이터**:
   - "nice number" 알고리즘. 목표 눈금 수 4~5개.
   - 원시 간격 `rawStep = (maxY-minY)/4` → 1·2·5·10 의 10^n 배수 중 가장 가까운 "nice" 값으로 올림.
   - `min = floor(minY/step)*step`, `max = ceil(maxY/step)*step`, ticks = `min`~`max` step 간격.

좌표 변환은 `niceTicks` 반환의 `min`/`max` 를 사용 (기존 `minY`/`rangeY` 대체):

```js
const { ticks, min, max } = niceTicks(dataMinY, dataMaxY);
const rangeY = max - min;  // 0 가능성 없음 (niceTicks 가 항상 min<max 보장)
const toY = v => pad.t + ih - ((v - min) / rangeY) * ih;
```

그리드 라인은 `gridLines` 고정 루프 대신 `ticks` 배열을 순회.

**불변식**: `niceTicks` 는 항상 `min < max` 와 `ticks.length >= 2` 를 보장한다 (rangeY=0 방어).

### 2. 데이터 적을 때 점 강조

`LineChart` 내부, `data.length` 기준 분기 (새 prop 없음):

- `data.length <= 3`: 점 반지름 `r = 3 → 4.5`, 각 점에 값 라벨 상시 표시 (클릭 없이). 라벨은 점 위에 작은 텍스트.
- `data.length >= 4`: 기존대로 (점 `r=3`, 라벨은 클릭 툴팁).

모든 값이 같아 평평한 직선일 때도 1번의 `niceTicks` 가 값을 범위 중앙에 두므로 선이 차트 가장자리에 붙지 않고 가운데에 그려진다.

### 3. "누적 중" 안내 문구

`PriceChart.tsx` / `UnsoldChart.tsx` 에 각각 추가. `chartData.length < 6` 일 때 그래프 아래 회색 작은 글씨 (`F.micro`, `C.muted`):

- `PriceChart`: `데이터 {N}개 · 매주 자동 수집 누적 중`
- `UnsoldChart`: `데이터 {N}개 · 매월 자동 수집 누적 중`

`length >= 6` 이면 문구 미표시. `LineChart` 는 안 건드림.

## 데이터 흐름

```
prices/unsold_history (DB, 행 2~24개)
  → usePriceHistory / useUnsoldHistory (집계)
  → PriceChart/UnsoldChart (chartData 변환 + 누적 중 문구 분기)
  → LineChart (niceTicks 눈금 + 점 강조 렌더)
```

변경 전후로 데이터 흐름 자체는 동일. 눈금 계산과 렌더만 교체.

## 엣지 케이스

| 상황 | 처리 |
|---|---|
| 모든 y 동일 (평평) | `niceTicks` 가 값 중앙 + 위아래 여백 → 선이 가운데 |
| 정수 데이터 (미분양 세대수) | 정수 눈금만, 소수 눈금 제거 |
| 데이터 2개 | 점 강조 + 값 라벨 + "누적 중" 문구 |
| y 에 음수 (갭투자액 등 — 현 LineChart 미사용이나 방어) | `niceTicks` 가 `min<0` 도 정상 처리 |
| `data.length < 2` | 기존대로 "데이터가 부족합니다" (변경 없음) |

## 테스트

`primitives.test.jsx` 에 추가/보강:

- `niceTicks` 단위 테스트:
  - `niceTicks(1,1)` → 정수 작은 값, ticks 정수, min<max
  - `niceTicks(52845,52845)` → 큰 동일값, ticks 3개, 52845 중앙
  - `niceTicks(0,1)` → 정수 `[0,1]`
  - `niceTicks(100,120)` → nice step (5 또는 10 단위)
  - 모든 케이스: `min < max`, `ticks.length >= 2` 불변식
- LineChart 렌더 테스트 보강:
  - 데이터 2개 + 동일 y → SVG 렌더, 선이 가장자리에 안 붙음 (path d 좌표 검증)
  - `data.length <= 3` → 점 반지름 4.5 확인
- 기존 LineChart 테스트 5건 (데이터 부족 메시지 / SVG 렌더 / title / hit area / 툴팁) 회귀 통과 유지

## 검증

| 항목 | 방법 | 성공 기준 |
|---|---|---|
| 단위 테스트 | `npx vitest run src/components/primitives.test.jsx` | niceTicks + LineChart 전부 pass |
| 타입 | `npm run typecheck` | 0 errors |
| 회귀 | `npx vitest run src/components` | 기존 components 테스트 전부 pass |
| 빌드 | `npm run build` | 성공, 번들 크기 증가 0 (외부 의존 없음) |
| 육안 | `npm run dev` → 강북구 단지 상세 (👤 사용자 카카오 로그인) | 분양가/미분양 그래프 눈금 정상, 점 강조, "누적 중" 문구 |

## 비-작업 (명시적 제외)

- 어린이집 5곳 제한 확장 — 사용자가 "이번엔 그래프만" 확정
- 외부 차트 라이브러리 도입 — 사용자 기각
- `MarketStatsCharts` 코드 변경 — props 불변, 자동 혜택만
- 데이터 수집 주기 변경 — cron 누적은 별개 영역
