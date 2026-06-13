# 전체 탭 ? 도움말 확장 (세션 412)

## Context

세션 411(PR #112)에서 **분양 탭**에만 ? 도움말을 넣고, "다른 탭은 데이터에 `hint`만 채우면 자동 ?"가 되도록 확장 가능한 `HelpHint` 패턴을 정착시켰다. 사장님 지시 = 그 패턴을 **나머지 탭(종합·입지·시세) + 차트 2개 + 적정가 괴리 인라인 지표**까지 확장해 분양 탭과 같은 수준으로 전체 완성.

목적: 처음 보는 사용자가 각 그래프·섹션·지표가 무슨 뜻인지 ? 한 번으로 알 수 있게 한다. 카피는 초등학생 눈높이 + 전문용어는 "(= 쉬운 설명)" 병기 (세션 411 톤 답습).

## 진실의 원천 (직독 확정 — 추측 0)

| 항목 | 출처 | 확정 사실 |
|---|---|---|
| 적정가 괴리 부호 | `src/scoring/scorePrice.ts:127` | `dev = ((fairPrice - price) / fairPrice) * 100` → **양수=싸다(좋음), 음수=비싸다** |
| 적정가 괴리 인라인 위치 | `src/components/DetailModal.tsx:248` | 종합 탭 핵심지표 "적정가 괴리" 행. 양수=초록 음수=빨강. **HelpHint 없음** |
| PIR | `src/constants/fieldMeta.ts:57` | "PIR (소득대비)", 단위 "배" = 소득 대비 집값 배율 |
| PSR | `fieldMeta.ts:58` | "PSR (주변대비)", `toFixed(2)` = 주변 시세 대비 배율 |
| netMigration | `fieldMeta.ts:96` | "순이동", 단위 "명", `+`/`-` 부호 (양수=유입) |
| dataReliability | `fieldMeta.ts:59` | "데이터 신뢰도", "%" |
| subwayDist 색 | `src/lib/dataSections.ts:26` | ≤500m 초록 = 가까울수록 좋음 |
| 차트 렌더 위치 | `DetailModal.tsx:308-309` | PriceChart·UnsoldChart = 시세 탭. **둘 다 HelpHint 없음** |
| UnsoldChart 점선 | `UnsoldChart.tsx:29-34,43` | secondaryData = 준공후 미분양(amber 점선 `┄`) |
| 자동 ? 메커니즘 | `DataSectionBlock.tsx:55` | `section.hint && <HelpHint text={section.hint} label={section.title} />` |

## 작업 범위 (? 총 9개)

### 1. 차트 2개 (시세 탭) — `<HelpHint>` 직접 삽입

`PriceChart.tsx:41` / `UnsoldChart.tsx:41`의 제목을 `MarketStatsCharts.tsx:106-109` 패턴(`<span flex>제목<HelpHint/></span>`)으로 감싼다.

- **PriceChart** 제목 "분양가 추이" 옆:
  > "이 단지(같은 분양 묶음)의 분양가가 시간에 따라 어떻게 바뀌었는지예요. 단위는 만원이고, 매주 자동으로 모아 쌓고 있어요."
- **UnsoldChart** 제목 "미분양 추이" 옆:
  > "이 단지의 안 팔린 세대(미분양)가 달마다 어떻게 변했는지예요. 빨강은 전체 미분양, 점선(┄)은 다 지어진 뒤에도 안 팔린 '준공후 미분양'이라 더 주의해서 봐야 해요. 매월 자동 수집."

상수 `PRICE_CHART_HINT` / `UNSOLD_CHART_HINT`를 각 파일 모듈 스코프에 둔다 (MarketStatsCharts의 `SECTION_HINT` 패턴).

### 2. 적정가 괴리 인라인 (종합 탭) — `<HelpHint>` 삽입

`DetailModal.tsx:248` "적정가 괴리" 행. 라벨 객체(`{ l, v, c }`)에 ? 를 붙이려면 라벨 렌더부(L256 `<span>{r.l}</span>`)가 모든 행 공용이므로, **이 행 1개에만** hint를 다는 방식이 필요. 행 객체에 옵셔널 `hint?` 필드를 추가하고 L256에서 `{r.hint && <HelpHint text={r.hint} label={r.l}/>}` 조건부 렌더.

- 적정가 괴리 hint:
  > "주변 시세로 계산한 '적정가'와 실제 분양가를 비교한 거예요. +(플러스)면 적정가보다 싸게(좋은 신호), −(마이너스)면 비싸게 나온 거예요. 예: +5%면 적정가보다 5% 저렴해요."

세션 411 GuideSections 정정("+면 저렴, −면 비쌈")과 동일 방향 — 정합 확인 완료.

### 3. 섹션 hint 6개 (`dataSections.ts`) — hint 필드만 추가

`DataSectionBlock`이 이미 `section.hint`를 렌더하므로 데이터만 채우면 자동 ?.

| 상수 | 섹션 | hint |
|---|---|---|
| OVERVIEW_SECTIONS[0] | 단지 기본정보 | "이 단지의 위치·세대수·시공사·관리비 같은 기본 정보예요. 데이터 신뢰도(%)는 우리가 모은 정보가 얼마나 충분한지 보여줘요." |
| LOCATION_SECTIONS[0] | 생활인프라(반경 1km) | "걸어서 갈 만한 거리(반경 1km) 안에 병원·마트·편의점·공원 같은 생활시설이 몇 개 있는지예요. 많을수록 생활이 편해요." |
| LOCATION_SECTIONS[1] | 교통 상세 | "가장 가까운 지하철역까지 거리, 버스 노선 수, 고속도로 IC·KTX 거리예요. 지하철이 가까울수록(500m 이내는 초록색) 출퇴근이 편해요." |
| LOCATION_SECTIONS[2] | 치안/환경 | "주변 치안 안전등급, 가까운 경찰관서, 대기질(미세먼지), 혐오시설까지 거리예요. 안전하고 공기 좋은 곳인지 보는 정보예요." |
| PRICE_SECTIONS[0] | 시장/투자 지표 | "집값이 적정한지 따지는 숫자들이에요. PIR은 '소득 몇 년치를 모아야 집을 사나'(낮을수록 좋음), PSR은 주변 시세 대비 비율, 순이동(+)은 사람이 늘어나는 동네라는 신호예요." |
| PRICE_SECTIONS[1] | 네이버 교차검증 | "네이버 부동산에서 따로 모은 주변 시세·전세가율·매물 수예요. 우리 데이터와 비교해 시세를 두 번 확인하는 용도예요." |

## 회귀 가드

- **PriceChart.test / UnsoldChart.test** — HelpHint 노출(? 아이콘 + 클릭 시 hint 텍스트) 1건씩. 세션 411 답습: 제목 토글과 ? 트리거가 둘 다 button이면 `getByRole("button",{expanded})` 또는 hint 텍스트로 특정.
  - ⚠️ 차트는 hook(usePriceHistory 등) 의존 → 기존 테스트의 mock 패턴 답습. `data.length < 2`면 차트 자체가 null 이라 hint도 안 뜸 → mock에 2개 이상 데이터 주입 필요.
- **dataSections.test** (없으면 신규) — 6개 섹션 hint 비어있지 않음 검증.
- **DetailModal** — 적정가 괴리 행에 hint 조건부 렌더 (기존 DetailModal.test 에 1건 추가 가능하면).

## 변경 파일

| 파일 | 변경 |
|---|---|
| `src/components/detail/PriceChart.tsx` | 제목에 HelpHint + 상수 1 |
| `src/components/detail/UnsoldChart.tsx` | 제목에 HelpHint + 상수 1 |
| `src/components/DetailModal.tsx` | 핵심지표 행 객체 `hint?` 필드 + L256 조건부 렌더 + import HelpHint |
| `src/lib/dataSections.ts` | 6개 섹션에 hint 추가 |
| `src/components/detail/PriceChart.test.*` | HelpHint 노출 테스트 |
| `src/components/detail/UnsoldChart.test.*` | HelpHint 노출 테스트 |
| `src/lib/dataSections.test.*` (또는 기존) | 6 hint 검증 |

## 비변경 (불변식)

- **HelpHint.tsx·Tooltip.tsx·DataSectionBlock.tsx 무변경** — 패턴 그대로 재사용 (세션 411 확장 설계의 의도).
- **점수·정렬·스코어링 엔진 무변경** — 표현 계층(hint 카피)만. deviation 값 자체 불변 → 정적 JSON 재계산 불필요.
- **PRESALE_SECTIONS hint 무변경** — 세션 411에서 이미 완료.

## 검증 (end-to-end)

1. `npx vitest run` — 전체 + 신규 가드 통과
2. `npx tsc --noEmit` — 0
3. `npx eslint <변경 파일>` — 0
4. 적대검증 워크플로 — 카피 정확성(단위·부호·포맷) 다축 프로브. 세션 411 답습: 종합 응답이 잘리면 개별 프로브 `agent-*.jsonl` 직독 교차.
5. 사장님 실서비스 수동검증: 시세 탭 차트 ? + 적정가 괴리 ? + 입지/시세/종합 섹션 ?, 모바일 탭 동작.
