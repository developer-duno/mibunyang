# 수집기 모니터링 화면 개선 — 디자인 스펙

> 2026-05-17. 모니터링 에픽 4단계(`5dccf90`)로 만든 `CollectorMonitoring` 화면의 UX 개선.

## Context (왜 이 작업을 하나)

4단계로 관리자 페이지에 수집기 모니터링 화면을 붙였다. 운영 화면을 본 운영자 피드백:

1. **수집기 이름이 영어** — `air-quality`, `molit-units` 등. 운영자가 읽기 어렵다.
2. **카드 20개가 세로로 길게 늘어짐** — 카드 1개가 약 4줄 높이라 20개를 보려면 한참 스크롤. 한눈에 안 들어온다.
3. **항상 펼쳐진 상태** — 모든 카드가 상세까지 다 보여서 밀도가 낮다. 접었다 펴고 싶다.

(참고: 캡처 시점에 20개 전부 "실행 기록 없음"인 것은 정상 — `collector_runs` 테이블에
데이터가 아직 0건. 2단계로 수집기 19개에 기록 호출을 넣었으나 push 이후 아직 안 돌았음.
수집기가 한 번씩 돌면 자동으로 채워진다. 화면 자체는 정상 동작.)

## 사용자 결정 (AskUserQuestion 3건)

- **접기/펼치기**: 카드마다 클릭해서 펼침 (평소엔 한 줄, 클릭 시 상세).
- **이름**: 한글만 표시 (영어 병기 안 함).
- **이름 출처**: 프론트 매핑 파일 (영어 → 한글, 매핑 없으면 영어 그대로 fallback).
- 한글 라벨 문구·세부 디자인: "알아서 해달라" — Claude 재량.

## 범위

`CollectorMonitoring` 컴포넌트의 **UI만** 변경한다. 데이터 모양·API·훅은 불변.

| 파일 | 변경 |
|---|---|
| `src/components/admin/collectorLabels.ts` | **신규** — 영어 collector명 → 한글 라벨 매핑 + `collectorLabel()` 헬퍼 |
| `src/components/admin/CollectorMonitoring.tsx` | **수정** — 카드를 콤팩트 행으로 + 클릭 펼침 |
| `src/components/admin/CollectorMonitoring.test.jsx` | **수정** — 펼침 동작 + 한글 라벨 테스트 추가 |

`useCollectorMonitoring.ts` / `types/admin.ts` / `AdminDashboard.tsx` — **불침범**.

## 설계

### 1. `collectorLabels.ts` — 영→한 매핑

```ts
const COLLECTOR_LABELS: Record<string, string> = {
  "air-quality": "대기질",
  "applyhome": "청약홈 분양정보",
  "avg-income": "지역 평균소득",
  "childcare-detail": "어린이집 상세",
  "childcare-info": "어린이집 정보",
  "collect-building-hub": "건축물대장",
  "collect-maintenance": "관리비",
  "collect-trades": "실거래가",
  "emergency": "응급의료시설",
  "housing-permits": "주택 인허가",
  "kosis-housing-supply-ratio": "주택보급률",
  "kosis-unsold": "미분양 통계",
  "market-stats": "주택시장 통계",
  "migration": "인구 순이동",
  "molit-building-info": "건축물 정보",
  "molit-units": "단지 세대수",
  "population": "인구",
  "population-sex-age": "성·연령별 인구",
  "schools": "학교 정보",
  "transport-tago": "대중교통",
  "naver-listings": "네이버 매물",
  "naver-presale": "네이버 분양정보",
  "dart-builders": "시공사 재무",
  "infra-kakao": "주변 인프라",
  "crime-safety": "치안 안전",
};
export function collectorLabel(name: string): string {
  return COLLECTOR_LABELS[name] ?? name; // 매핑 없으면 영어 그대로
}
```

### 2. 콤팩트 행 + 클릭 펼침

**접힌 상태** — 수집기마다 한 줄(높이 ≈ 40px):
`▸` 화살표 / 한글 이름 / 상태 점 배지 / 마지막 실행 시각(없으면 `—`).
20개가 화면 한 장에 들어온다. 행 전체가 클릭 영역(`cursor: pointer`, hover 배경).

**펼친 상태** — 클릭한 행 아래로 상세:
처리 건수(성공·실패·스킵) · 소요 시간 · API 호출 기록 · 에러 메시지(있으면).
`lastRun === null`이면 "수집 실행 기록이 아직 없습니다 (API 호출 기록만 있음)" 안내 +
`recentQuota`만 표시.

**상태 관리**: 펼친 항목 id 를 `useState<Set<string>>` 로. 여러 개 동시 펼침 가능.
`toggleExpand(name)` 콜백.

**레이아웃 (운영자 추가 요청)**: 행을 세로 1열로 길게 나열하지 않고 **CSS Grid 다열**로
배치한다. 넓은 화면 3열 / 중간 2열 / 좁은 화면 1열 (`gridTemplateColumns` +
`minmax`). 펼침은 그 칸(grid cell) 안에서 아래로 늘어난다 — 다른 칸 높이에 영향 없음.

**접근성** (컴포넌트 규칙 답습): 행에 `role="button"`, `tabIndex={0}`,
`onKeyDown`(Enter/Space → toggle), `aria-expanded`.

### 3. 상태 배지 — 색 점

글자 앞에 색 점(`●`)을 붙여 스캔성↑: 🟢 성공 / 🔴 실패 / 🟡 부분 성공 / ⚪ 실행 기록 없음.
색은 4단계의 `C.green/red/amber/muted` 그대로.

### 4. 데이터 갱신 카드 (상단 7개)

**한글화 (운영자 추가 요청)**: 테이블명 7개(`apartments`, `infra`, `schools`,
`transport`, `builders`, `trade_stats`, `regions`)도 한글 라벨로. 수집기 카드와
일관성. `collectorLabels.ts` 에 `tableLabel()` 헬퍼 추가.

**가로 스크롤 (운영자 추가 요청)**: 7개 카드를 줄바꿈하지 않고 가로 한 줄로 두고
가로 스크롤(`overflowX: auto`)로 넘겨본다. 카드는 `flexShrink: 0` 으로 폭 고정.
하단 수집기 카드(20개+)는 개수가 많아 3열 그리드 유지 — 가로 스크롤 안 함.

## 에러/빈 상태 (4단계에서 이미 처리, 유지)

- `loading` → SkeletonList / `error` → 빈 상태 메시지 / `partial` → 노란 배너
- `collectors` 0건 → "수집기 실행 기록이 없습니다"
- 위 UI 골격은 유지하고 행 리스트 부분만 교체.

## 검증

1. `npm run typecheck` — 0 errors
2. `npm run lint` — 0 warning
3. `npx vitest run --no-cache src/components/admin` — 기존 6 + 신규(펼침 클릭으로 상세
   노출 / 한글 라벨 "단지 세대수" 표시 / 접힌 상태에선 상세 안 보임) 전체 pass
4. `npm run build` — 성공
5. 로컬 `npm run dev` — 관리자 화면에서 한글 이름·콤팩트 행·클릭 펼침 확인

## 범위 밖 (YAGNI)

- 상태별 정렬 / 그룹 접기 — 실행 데이터가 실제로 쌓인 뒤 가치 판단. 지금은 전부
  "실행 기록 없음"이라 정렬 효과 0.
- API/훅/타입 변경 — UI 개선이라 불필요.
