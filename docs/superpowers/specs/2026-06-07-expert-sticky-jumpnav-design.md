# 전문가 화면 StickyJumpNav (목차바) — 설계

> 작성 2026-06-07 (세션 382). 소비자 DetailModal 목차바(#84·#85·#88)의 전문가 화면 확장.

## Context (왜)

소비자 상세 모달(DetailModal)은 세션 377~381(#84·#85·#88)에서 sticky 목차바(StickyJumpNav)를
얻어 6 섹션 점프 + active 칩 전환 + e2e 검증까지 완료됐다. 그러나 **전문가 대시보드
(ExpertDashboard, 풀페이지)는 목차바가 없다.** 전문가 화면은 단지 1개에 대해 헤더 → 점수분해
→ 점수요약 → 필드표 9섹션 → 유닛 → 데이터완성도가 세로로 길게 쌓여, 고객 상담 중 "이 단지
안전 지표 보자", "교차검증 어때?"처럼 특정 섹션으로 바로 가려면 긴 스크롤이 필요하다.

이 작업은 소비자의 검증된 StickyJumpNav 컴포넌트를 **재사용**해 전문가 화면에도 목차바를
얹는다. 신규 컴포넌트 0, 데이터 단일 출처(FIELD_SECTIONS) 파생으로 미래 drift 0.

## 실측 사실 (확인 완료)

- **전문가 스크롤 컨테이너** = `ExpertDashboard.tsx:65` 의 `<div data-print-content style={{ flex:1, overflowY:"auto" }}>`. 소비자 bodyRef 와 같은 역할. **단 `position` 속성 없음** → offsetTop 기준 부정확 위험 → `position:relative` 추가 필요(소비자 #85 와 동일 이슈).
- **필드표 = FIELD_SECTIONS 9섹션** (fieldMeta.ts:187): 개요/가격/안전/입지/상품성/혜택/미래/교차검증/분양. `ExpertDashboard.tsx:107` `FIELD_SECTIONS.map` 으로 전부 렌더. ExpertFieldTable 은 **빈 섹션도 항상 제목 박스를 그림**(필드 전부 미수집이어도) → 죽은 칩 위험 0.
- **재사용 자산** = `StickyJumpNav.tsx`(JUMP_NAV_HEIGHT=44, props: sections/activeId/totalScore/onJump/isDesktop). aria-current·가로 스크롤 active 정렬·sticky 좌우 패딩 누출 차단 내장.
- **소비자 점프 패턴** = id 단 블록 + IntersectionObserver(root=컨테이너, rootMargin `-44px 0px -55% 0px`) + handleJump(`scrollTo({top: offsetTop - JUMP_NAV_HEIGHT, behavior:"smooth"})` + setActiveSection). scrollTo 타입 가드 포함.
- **인쇄 CSS** (App.tsx:196): 인쇄 시 `[data-no-print]{display:none}` + `[data-print-content]{overflow:visible; height:auto}`. 인쇄가 전문가 핵심 기능이므로 칩바는 인쇄에서 숨겨야 함(`data-no-print`).

## 결정 (사장님 확정)

칩 구성 = **요약 1 + 필드 9 = 10칩**.

| 칩 라벨 | 점프 대상 id | 묶는 블록 |
|---|---|---|
| 요약 | `sec-summary` | ExpertScoreBreakdown + ExpertScoreSummary |
| 단지 개요 | `sec-개요` | FIELD_SECTIONS[개요] ExpertFieldTable |
| 가격/시장 지표 | `sec-가격` | FIELD_SECTIONS[가격] |
| 안전도/리스크 | `sec-안전` | FIELD_SECTIONS[안전] |
| 입지/교통/교육/환경 | `sec-입지` | FIELD_SECTIONS[입지] |
| 상품성/건축 | `sec-상품성` | FIELD_SECTIONS[상품성] |
| 혜택/할인 | `sec-혜택` | FIELD_SECTIONS[혜택] |
| 미래가치 | `sec-미래` | FIELD_SECTIONS[미래] |
| 네이버 교차검증 | `sec-교차검증` | FIELD_SECTIONS[교차검증] |
| 네이버 분양정보 | `sec-분양` | FIELD_SECTIONS[분양] |

- 칩 라벨 = `FIELD_SECTIONS[i].label` 그대로(이미 사용자 친화 라벨). id = `sec-${FIELD_SECTIONS[i].key}`.
- 칩 목록은 `FIELD_SECTIONS` 에서 **파생** → 섹션 추가/변경 시 칩 자동 반영. 하드코딩 금지(drift 0).
- 유닛/완성도 블록은 칩 없음(상담 점프 빈도 낮음 + 칩 과다 방지). 화면 맨 끝이라 스크롤로 도달.

## 아키텍처

### 컴포넌트 재사용
- `StickyJumpNav.tsx` 그대로 사용. **수정 0.** props 가 범용이라 전문가도 호환.
  - `totalScore` prop: 전문가는 `selectedItem.res.total` 전달(소비자처럼 "종합 N" 우측 표시) — UX 일관.

### 전문가 측 통합 (ExpertDashboard.tsx 만 수정)
1. **칩 데이터 생성** (모듈 레벨 상수, FIELD_SECTIONS 파생):
   ```ts
   const EXPERT_JUMP_SECTIONS: JumpSection[] = [
     { id: "sec-summary", label: "요약" },
     ...FIELD_SECTIONS.map(s => ({ id: `sec-${s.key}`, label: s.label })),
   ];
   ```
2. **컨테이너 ref + position:relative**: `data-print-content` div 에 `useRef<HTMLDivElement>` 부착 + style 에 `position: "relative"` 추가(offsetTop 기준 정확화).
3. **활성 섹션 state + IntersectionObserver**: `activeSection` useState + useEffect(소비자 DetailModal L137-156 패턴 답습, root=컨테이너 ref, rootMargin `-44px 0px -55% 0px`, deps=[selectedId]). selectedItem 없으면 observer 미설치(early return).
4. **handleJump**: 소비자 DetailModal L161-168 답습(scrollTo offsetTop-44, scrollTo 타입 가드, setActiveSection).
5. **렌더 위치 (확정 — 소비자 구조와 다름)**:
   - 소비자: 헤더(단지명/닫기)가 스크롤러 **밖**, StickyJumpNav 가 스크롤러 첫 자식 → top:0 고정.
   - 전문가: 헤더 줄(목록/프로필/도움말 버튼, `data-no-print`)이 스크롤러(`data-print-content`) **안** 첫 줄. → **칩바를 헤더 줄 바로 아래, `selectedItem` 블록 진입 직전(ExpertHelpGuide 뒤·ExpertAptHeader 앞)에 배치.** 헤더 줄이 스크롤되어 올라가면 칩바가 top:0 에 고정(자연스러운 동작). 단지 미선택 시(else 분기)엔 칩바 없음.
   - **인쇄 숨김 — 확정 방식**: StickyJumpNav 를 `<div data-no-print>` 래퍼로 감싸지 않는다(래퍼가 sticky 컨텍스트를 가로채면 칩바가 top:0 에 안 붙음). 대신 **StickyJumpNav 에 optional `wrapperProps`(또는 `noPrint?: boolean`) prop 1개만 추가**해 컴포넌트 내부 root div 에 `data-no-print` 가 직접 붙도록 한다(StickyJumpNav 최소 수정 1줄, 소비자는 prop 미전달이라 영향 0). 이게 sticky·인쇄 둘 다 안전한 유일한 깔끔한 방법.

### 섹션 ID 부착 (ExpertDashboard.tsx 렌더 수정)
- `sec-summary`: `<div id="sec-summary">` 로 ExpertScoreBreakdown + ExpertScoreSummary 감쌈.
- `sec-${key}`: `FIELD_SECTIONS.map` 의 각 ExpertFieldTable 을 `<div id={\`sec-${sec.key}\`}>` 로 감쌈. **단 2열 그리드 셀**이므로 wrapper div 가 그리드 셀이 되도록 주의(현재 ExpertFieldTable 이 직접 그리드 자식 → wrapper 가 그리드 자식이 되고 ExpertFieldTable 은 wrapper 자식). 그리드 레이아웃 깨짐 없는지 검증.

## 미해결(구현 시 결정) — scroll-margin / 인쇄 래퍼

1. **칩바 인쇄 숨김 방식**: (a) `<div data-no-print>` 래퍼 + sticky 유지 확인, (b) StickyJumpNav 에 optional prop 추가. → **(a) 우선 시도**, sticky 깨지면 (b). StickyJumpNav 최소 수정 허용(선택적 wrapper class).
2. **그리드 셀 wrapper**: id wrapper 가 2열 그리드를 깨지 않는지 — 깨지면 `display:contents` 로 wrapper 가 레이아웃 투명하게.
   ⚠️ `display:contents` 면 그 요소는 offsetParent 가 안 되고 querySelector 로 잡혀도 offsetTop 이 부정확할 수 있음 → 점프 대상은 **contents 아닌 실제 박스**여야. 절충: wrapper 를 그리드 셀로 두되 내부 ExpertFieldTable 의 marginBottom 을 wrapper 로 이동. **구현 시 실측으로 확정.**

## 테스트

- **단위 (vitest, jsdom)**: ExpertDashboard.test 에
  - EXPERT_JUMP_SECTIONS 가 FIELD_SECTIONS 파생(10칩, label/id 매핑) 검증
  - 칩 클릭 시 scrollTo 호출(spy) + 인자(top number, behavior smooth) + setActiveSection(aria-current)
  - scrollTo 미구현 환경 무에러
  - 각 섹션 id(`sec-summary`, `sec-가격` 등)가 DOM 에 존재
- **e2e (Playwright)**: 소비자 detail-modal.spec.ts 의 점프 테스트 패턴 답습.
  - 전문가 로그인(loginViaToken 재사용) → 전문가 대시보드 진입(소비자뷰 전환 안 함) → 단지 선택 → 칩 클릭 → 맨 아래 섹션(`sec-분양`) toBeInViewport + scrollTop 증가 + aria-current.
  - instant scrollTo 패치(headless smooth 비결정성 회피) 답습.
- **회귀 가드**: tsc 0 / typecheck:e2e 0 / lint 0err / vitest 전체 pass / 인쇄 시 칩바 숨김(수동 또는 CSS 단언).

## 검증 (end-to-end)

1. 로컬: `npx tsc --noEmit` + `npm run lint` + `npm test` + `npm run typecheck:e2e` 전부 통과.
2. dev 서버에서 전문가 로그인 → 단지 선택 → 칩 클릭 시 해당 섹션으로 스크롤 + active 전환 육안 확인.
3. 인쇄 미리보기(Ctrl+P)에서 칩바가 안 나오는지 확인.
4. 모바일 폭에서 칩 가로 스크롤 + active 칩 자동 정렬 확인.

## 범위 밖

- 소비자 DetailModal 변경(이미 #88 완료).
- FIELD_SECTIONS 자체 구조 변경.
- 유닛/완성도 블록 점프(칩 없음 결정).
