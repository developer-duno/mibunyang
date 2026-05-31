# 분양 달력 강조 레이아웃 개편 (Calendar-Emphasis Redesign)

> 원본 spec: `2026-05-02-upcoming-presale-page-design.md` (페이지 최초 설계). 본 문서는 그 위의 UI 개편.

## Context (왜)

`/upcoming` 분양예정 페이지는 현재 **달력이 보조(320px 좌측), 단지 목록이 주인공(우측 1fr)** 인 2컬럼 레이아웃이다. 사용자 요청 = **"달력을 크게 키우고 목록을 작게, 달력 날짜를 누르면 그날 일정이 보이게"**. 즉 달력을 페이지의 주인공으로 승격하고, 날짜 클릭 시 "그날 무슨 일정인지"를 명시적 텍스트로 보여주는 것.

세션 352에서 별도로 진단한 결과, 이 페이지가 의존하는 `/api/upcoming`은 평소 빠름(프로덕션 5회 측정 모두 HTTP 200, 0.15~0.7초 — Vercel CDN `s-maxage=300` 캐시 덕). 간헐적 521 위험은 있으나 정적 폴백은 **불가**(`apartments-list.json`에 presale 필드 없음 — 적대 검증 refuted). 따라서 본 개편은 **순수 클라이언트 UI 변경**이며 API/데이터 파이프라인을 건드리지 않는다.

## 확정 디자인

### 레이아웃 (수직 스택, 모바일/PC 공통)

```
┌─────────────────────────────────┐
│  📅 청약 캘린더 — 2026년 5월       │  ← 달력 (풀너비, 셀 크게)
│  [큰 월간 달력 + 4색 일정 점]      │
│  ┌───────────────────────────┐  │
│  │ 📌 5월 9일 일정 (2건)       │  │  ← 일정 패널 (날짜 클릭 시 표시)
│  │ 🟠 A단지 — 청약 마감         │  │
│  │ 🟠 E단지 — 청약 마감         │  │
│  └───────────────────────────┘  │
│  [범례: 🟢분양예정 🟡청약 🟠마감 🔵발표]│
├─────────────────────────────────┤
│  [필터 탭: 전체 청약중 분양중 …]    │  ← 단지 목록 (달력 아래)
│  🏢 A단지 · 청약마감              │
│  🏢 E단지 · 청약마감              │
│  [구독 폼]                       │
└─────────────────────────────────┘
```

- **현재**: `gridTemplateColumns: isDesktop ? "320px 1fr" : "1fr"` (2컬럼)
- **변경 후**: 항상 1컬럼 수직 스택. 달력 + 일정 패널을 묶은 블록은 `maxWidth: 520px` 중앙 정렬(달력이 너무 넓게 늘어나 가독성 떨어지는 것 방지). 단지 목록은 그 아래 페이지 풀너비(기존 maxWidth 1200px 컨테이너 유지). 즉 "달력은 적당히 큰 카드, 목록은 넓게".

### 달력 확대

- `react-day-picker` v10의 `--rdp-cell-size` CSS 변수를 기본 43px → **56px**(모바일) / **48px**(PC, 너무 커지지 않게)로 오버라이드. wrapper div의 `style`에 인라인 CSS 변수로 적용(전역 CSS 오염 회피).
- 셀 폰트/점 크기도 비례 확대.

### 날짜 클릭 동작 (둘 다)

날짜 클릭 시:
1. **일정 패널 표시** (신규): 달력 바로 아래에 `📌 {월}월 {일}일 일정 (N건)` 헤더 + 그날 이벤트 목록을 텍스트로. 각 줄 = `{이벤트색emoji} {단지명} — {이벤트라벨}` (예: `🟠 힐스테이트OO — 청약 마감`).
2. **목록 필터** (기존 유지): 맨 아래 단지 목록이 그날 단지로 필터됨 (`UpcomingPage.tsx:72-83` 기존 로직).
3. 같은 날짜 재클릭 → 선택 해제 (패널 숨김 + 필터 해제).

### 일정 패널 데이터 조립 (surgical — API 무수정)

- `calendar[iso]` = `[{id, event}]` (단지명 없음). `stages.plan/apply/sale`의 `UpcomingApt`에 `name` 존재.
- **프론트에서 조립**: `selectedDate`의 `calendar[iso]` 각 `{id, event}`에 대해, `stages` 전체에서 `id→name` 매핑(Map 1회 생성 후 O(1) 조회). 이벤트 라벨은 기존 `EVENT_COLORS[event].label` 재사용.
- API(`api/upcoming.ts`)는 수정하지 않음 — 프론트 조립이 더 surgical하고 CDN 캐시 무효화 불필요.

## 컴포넌트 설계

| 단위 | 변경 | 책임 |
|---|---|---|
| `UpcomingPage.tsx` | 수정 | 레이아웃 grid → 수직 스택. selectedDate 일정 패널 데이터 조립(useMemo). 기존 5상태/필터/구독 유지 |
| `UpcomingCalendar.tsx` | 수정 | `--rdp-cell-size` 확대(wrapper style). props 무변(calendar/selectedDate/onDayClick) |
| `UpcomingDayAgenda.tsx` | **신규** | 일정 패널 — props: `{ date: string, events: Array<{name, event, id}>, onOpenDetail? }`. `EVENT_COLORS` 재사용해 색emoji+라벨 렌더. memo |
| `src/types/upcoming.ts` | 추가 | `UpcomingDayAgendaProps` 등 신규 타입 1~2개 |

- `UpcomingDayAgenda`는 순수 표시 컴포넌트(데이터 조립은 UpcomingPage에서). 단지명 클릭 시 `onOpenDetail(id)`로 상세 모달 연결(선택).

## 데이터 흐름

```
/api/upcoming → data.calendar {iso: [{id,event}]} + data.stages {plan,apply,sale: UpcomingApt[]}
  ↓ (UpcomingPage)
selectedDate 클릭 → calendar[selectedDate] 각 {id,event}
  → stages 전체에서 idToName Map 조회 → [{name, event, id}]
  → UpcomingDayAgenda 렌더 (일정 패널)
  + filteredItems (기존) → UpcomingCardList (목록 필터)
```

## 에러/엣지 케이스

- `calendar` undefined (타입상 optional): 패널 미표시, 기존 빈데이터 상태 유지.
- `selectedDate`의 `calendar[iso]` 없음: 패널 미표시 (날짜에 일정 없음).
- `id→name` 매핑 실패(stages에 해당 id 없음): 단지명 자리에 `(단지 정보 없음)` 폴백 또는 해당 줄 skip.
- 모바일: 달력 maxWidth 제한으로 좌우 넘침 방지. 셀 56px가 작은 화면(320px)에서 7열 = 392px > 320px이면 셀 크기 화면폭 기반 조정 필요(`min(56px, (100vw-padding)/7)`).

## 테스트 계획

- **신규 단위 테스트** `UpcomingDayAgenda.test.jsx` (@testing-library/react, 기존 `UpcomingCardList.test.jsx`/`SubscribeForm.test.jsx` 패턴):
  - 일정 N건 렌더 (단지명 + 이벤트 라벨 + 색emoji)
  - 빈 일정 (calendar[date] 없음) → null 렌더
  - id→name 매핑 실패 폴백
  - 이벤트 5종 라벨 매핑 (presale_announce → 🟢분양예정 등)
- **UpcomingPage 데이터 조립 테스트**: idToName Map 조립 로직(순수 함수로 추출해 단위 테스트). selectedDate 변경 시 패널 데이터 정확성.
- **회귀**: 기존 `api/upcoming.test.ts`(43 케이스), `UpcomingCardList.test.jsx`, E2E `upcoming.spec.ts` 영향 없음 확인 (API/필터 로직 무변).
- `npm run typecheck` + `npx vitest run` + lint 0.

## 범위 밖 (명시적 제외)

- `/api/upcoming` 정적 폴백 (적대 검증: 정적 JSON에 presale 필드 없어 불가. 별도 작업).
- `selectedDate` URL 쿼리 동기화 (새로고침 시 필터 보존 — 별도 개선).
- 헤더 CTA + UpcomingPage 이중 fetch 통합 (별도).
- API의 `calendar`에 name 추가 (프론트 조립으로 대체 — CDN 캐시 무효화 회피).

## 구현 순서

1. `src/types/upcoming.ts` — `UpcomingDayAgendaProps` 타입 추가.
2. `UpcomingDayAgenda.tsx` 신규 + 단위 테스트 (TDD).
3. `UpcomingPage.tsx` — 레이아웃 수직 스택 전환 + idToName 조립 useMemo + UpcomingDayAgenda 연결.
4. `UpcomingCalendar.tsx` — `--rdp-cell-size` 확대.
5. 반응형 검증 (모바일 320px ~ PC 1200px) + typecheck/vitest/lint.

각 단계 독립 커밋. 커밋/push는 사용자 승인 후.
