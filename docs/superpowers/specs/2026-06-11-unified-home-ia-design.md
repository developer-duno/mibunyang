# 통합 홈 (Unified Home) IA 재설계 — C안 + 전문가 위젯 (v2, 적대검증 반영)

> 세션 403 브레인스토밍 확정 + **적대검증 워크플로(8프로브×2라운드, 27 에이전트) 정정 반영**.
> 사장님 요구 = "소비자뷰·대시보드·지도·곧분양이 너무 따로 논다. 정보를 하나도 누락시키지 않고 한군데 어울리게."
> v1 → v2: 확정 문제 18건(할루시네이션 3·게이트 충돌 1군·누락 다수) 정정. 모든 파일:라인은 검증자 실측.

## 0. 확정된 결정 (사장님 선택)

| # | 결정 | 선택지 중 | 근거 |
|---|---|---|---|
| D1 | **C안 — 위젯판 홈 신설** | A 지도워크스페이스 / B 연결강화 / C 대시보드홈 | "다 모였다" 느낌 최강. 아실·리치고·토스 홈 모델 |
| D2 | **지도 핀 클릭 → 지도 하단 고정 오버레이 카드** | V1 지도위카드 / V2 옆패널전환 | 기존 `SelectedAptCard` 재사용. ⚠️ v2 정정: "말풍선"이 아니라 **하단 고정 가로 바**(SelectedAptCard.tsx L14-31 `position:absolute; bottom:12`) — 신규 구현이 아니라 공사 더 적음. 버튼 라벨 "상세" |
| D3 | **전문가 옵션 1 — 홈이 깊어진다** | 옵션1 홈에위젯 / 옵션2 분리유지 | 로그인 시 같은 홈에 전문가 위젯 2종 추가. 138필드 풀 대시보드는 보존 |
| D4 | **모바일 하단 5탭**: 홈·목록·지도·곧분양·정보 | 5탭 / 7탭 / 홈이목록흡수 | 비교→목록 안 버튼, 상담→정보 안(**신규 공사** — §2) + DetailModal onConsult 유지 |
| D5 | **비로그인 홈 미니지도 = 잠금 placeholder** (적대검증 후 신규 결정) | 잠금 유지 / 공개 전환 | 현행 "지도 = 로그인 필수" 정책(useAppNavigation.ts L67-68 게이트, LoginPromptModal trigger="map") 유지. 비로그인 홈의 지도 위젯 자리 = "로그인하면 지도가 열려요" 안내판. 5개 검증자가 독립 발견한 최대 맹점의 해소 |

**필수 불변 조건 = 정보 누락 0**: 기존 화면·기능·데이터 요소는 삭제하지 않는다. 입구(네비 위치)만 옮긴다.

## 1. 새 IA 구조

```
홈(신설, 기본 탭)                    ← 위젯판. 모든 화면의 허브
├── 🗺 지도 위젯 (로그인 시) / 잠금 안내판 (비로그인, D5)
│      → 펼치기 = handleNavClick("map") — 기존 지도 탭 (게이트·analytics 자동 답습)
├── 📅 곧분양 위젯 (isFeatureUpcoming ON일 때만) → 펼치기 = handleNavClick("upcoming")
├── ⭐ 추천 TOP 위젯  → "전체 목록" = handleNavClick("list")
├── 📊 시장 요약 위젯 (이미 로드된 데이터 집계만)
├── 🔬 점수 분해 위젯 (전문가 로그인 시, 축약 모드) → "전체" = handleNavClick("expert")
└── ✅ 데이터 완성도 위젯 (전문가 로그인 시, 축약 모드) → "138필드 표" = handleNavClick("expert")

기존 탭 전부 보존: list / map / upcoming / expert / expertConsults / consult / info / admin
                  + 숨은 탭 2종: expertLogin / kakaoCallback (v2 추가 — 라우팅 재작성 시 누락 금지)
```

### 핵심 인터랙션 (D2+D5 정정 반영)
1. 홈 미니지도(로그인 시) 핀 클릭 → 지도 하단 고정 오버레이 카드 = `SelectedAptCard` 재사용
2. 같은 클릭으로 (전문가) 점수분해·완성도 위젯 동기 갱신 — **MapView에 `onSelect` prop 신설이 전제** (§2, 현재는 내부 useState라 외부에서 알 수 없음)
3. **홈의 모든 상세 진입(SelectedAptCard "상세"·추천 TOP 카드)은 `handleDetailGated`(useLoginGate.ts:20) 경유 의무 — `handleOpenDetail` 직결 금지**
4. 모바일: 핀 클릭 → 하단 카드 (지도 탭과 동일 패턴)
5. 위젯 "펼치기"는 전부 `handleNavClick(k)` 경유 — setTab 직접 호출 금지 (지도 로그인 게이트 + `tab_switch` analytics 연속성 둘 다 자동 보존, useAppNavigation.ts L65-68)

### 네비게이션 (D4 확정 — 항목 수는 isFeatureUpcoming ON 가정)
| 위치 | 변경 전 | 변경 후 |
|---|---|---|
| 모바일 하단 (소비자) | 목록·지도·📅·비교·상담·정보 (6) | **홈**·목록·지도·📅곧분양·정보 (5) |
| 모바일 하단 (전문가) | 대시보드·상담목록·소비자뷰·지도·로그아웃 (5) | **홈**·대시보드·상담목록·소비자뷰·지도·로그아웃 (6) |
| 데스크톱 상단 (소비자) | 목록·지도·곧분양N·비교·상담·정보 | **홈**·목록·지도·곧분양N·비교·상담·정보 (7) |
| 데스크톱 상단 (전문가) | 대시보드·상담목록·소비자뷰·지도·곧분양 | **홈**·대시보드·상담목록·소비자뷰·지도·곧분양 |

- 모바일 **비교** → 목록 화면 내 버튼 (showComp 토글 그대로). BottomNav.tsx L23의 `!(n.k === "list" && showComp)` 활성 표시 잔재 동시 정리
- 모바일 **상담** → 정보 페이지 안 진입(**InfoPage 신규 공사**, §2) + DetailModal onConsult 유지(프리필 미실행이 원래 의도 — 변경 불필요)
- ⚠️ "전문가" 구분의 실제 코드 축 = `expertLoggedIn`(토큰 보유 — 카카오 일반 유저·admin도 true 가능, useExpertMode.ts:34) — 전문가 위젯 게이트는 **role 축 확인** 포함 (§2)

### 초기 탭·딥링크 (v2 신규 절 — App.tsx L92-123 초기화 4갈래 전부 명시)
| 경로 | 현행 | 변경 후 |
|---|---|---|
| 신규 방문 (비로그인) | `list` | **`home`** (isFeatureHome OFF면 `list` 안전 폴백 — UpcomingPage URL 폴백 패턴 L94-101 답습) |
| `/upcoming` 직진입 | upcoming (flag OFF면 list 폴백) | 현행 유지 (flag OFF 폴백은 `home`으로) |
| 전문가/관리자 토큰 복원 (L119-122) | `expert`/`admin` 직행 | **현행 유지** — 파워유저 직행 효율 우선. 홈은 네비 1클릭 |
| 카카오 콜백 착지 (useKakaoCallbackEffect.ts L42·47) | `setTab("list")` | **`home`으로 변경** (로그인 직후 홈 = 지도 위젯 열린 첫 경험) |
| UpcomingPage "메인으로" (App.tsx L356) | `setTab("list")` | **`home`으로 변경** |
| `?compare=` 딥링크 (App.tsx L220-222) | list 탭에서만 CompareSheet 렌더 (L300-309) | **딥링크 감지 시 `setTab("list")` 동시 호출** — 단 `?detail=` 복합 링크면 detail 우선(`if (!detailId)`일 때만 setTab — useDetailModal.ts:9 탭 전환 모달닫기와 충돌 회피) |
| `?detail=` 딥링크 | 전역 렌더 (L402-410) | 무변경 |

## 2. 컴포넌트 설계 (재사용 최우선 — v2: "수정 0" 환각 정정)

| 컴포넌트 | 신규/수정/재사용 | 내용 |
|---|---|---|
| `src/components/home/HomePage.tsx` | **신규** | 위젯 그리드 (auto-fit minmax — 세션387 답습). `selectedApt` 상태 보유. 데이터 로딩 중(apartments=[]) 전체 스켈레톤 |
| `MapView` + `MapView.types.ts` | **재사용 + 소형 수정 2건** (v2 정정 — v1 "수정 0"은 환각) | ① `height?: string` prop — 현재 루트 높이가 뷰포트 기준 하드코딩(MapView.tsx L160 `calc(100dvh-...)` 3분기)이라 위젯 박스에서 넘침. 기본값 = 현행 3분기 유지 → 기존 지도 탭(App.tsx L326) 무변경. 위젯 높이 하한 ~260px(SelectedAptCard ~60px 점유 고려) ② `onSelect?: (item: {apt; res} \| null) => void` prop — 선택이 내부 useState(L22)라 현재 홈이 알 수 없음. 4개 setSelected 지점(L102 핀클릭·L73 모드전환·L84 filtered 리셋·L207 onClose) 전부에서 호출, null 전파 포함(전문가 위젯 빈 상태 복귀). optional이라 기존 호출 무변경 ③ 위젯 모드: `compact` prop으로 인프라 오버레이(36px×4 스택)·모드토글·현위치·줌 컨트롤 숨김 + point 모드 고정 ④ 컨테이너 크기 변경 시 `map.relayout()` 필요 여부 구현 시 1회 확인(현재 호출 0건 실측) |
| 지도 위젯 (HomePage 내) | **신규(소형)** | 비로그인 = 잠금 placeholder(D5, LoginPromptModal trigger="map" 재사용). 로그인 = MapView 임베드. **뷰포트 진입 시 SDK 로드**(IntersectionObserver — AptListSection.tsx L128-134 sentinel 답습)가 1안, "탭하면 로드"는 폴백(발동 기준: Speed Insights 모바일 LCP p75 > 2.5s) |
| 곧분양 위젯 | **재사용+소형 신규** | App.tsx L69-91의 기존 `/api/upcoming` fetch를 **합계만 보관 → 전체 응답 보관으로 state lift** (fetch 횟수 불변=1회). 위젯 = 이번주 N건 + D-day 임박 3건. ⚠️ `catsCache`에 top-level total 없음(실측 — UpcomingCardList.tsx L75 `catsCache?.total`은 항상 undefined인 기존 버그) → 위젯은 D-day·단계·가격만 표시, 점수 쓰려면 `scoredMap` 매칭. **isFeatureUpcoming OFF면 위젯 미노출**(fetch 자체가 L70에서 차단됨 — 이중 플래그 의존 명시) |
| 추천 TOP 위젯 | **재사용** | `useDataPipeline` scored 상위 3 (프로필 연동). **AptCard 재사용 시 `isLoggedIn` prop 명시 전달 의무** — 기본값 true라 누락 시 비로그인에 점수 silent 노출(AptCard.tsx:38). 서열·순위 노출은 현행 목록과 일관 허용, 숫자 점수만 "??" |
| 시장 요약 위젯 | **신규(집계만)** | 이미 로드된 데이터만 클라이언트 집계. **점수 파생 지표(평균 점수 등)는 비로그인 "??" 제약** — 원시값(단지 수·미분양률 중위값)은 현행 정책상 허용 |
| 점수 분해 위젯 | **재사용(축약 모드)** | `ExpertScoreBreakdown` = `{apt, res, profile}` 3 props 순수 컴포넌트(실측 확인 — 대시보드 상태 결합 0). **축약 모드 = 카테고리 합계 6행만**, 서브항목 표는 "전체 →" 위임. ⚠️ 이 컴포넌트는 customWeights 무시(L10 `PROFILES[profile]?.w` 고정) — res와 가중치 출처 일치 구현 시 확인 |
| 완성도 위젯 | **재사용(축약 모드)** | `ExpertDataCompleteness` = `{apt}` 1 prop(실측 확인). 축약 = 진행바+%+5분류 카운트. ⚠️ 모집단 138필드 = 소비자 도넛(78필드)과 수치 다름 → 라벨 "전문가 기준 138필드" 명시 |
| 전문가 위젯 게이트 | — | `expertLoggedIn` + **role 확인** (admin 토큰·카카오 user도 expertToken 보유 가능 — App.tsx L103-121 실측) |
| `InfoPage` | **수정** (v2 신규 행 — v1 누락) | 상담 진입 버튼/카드 **신규** (현재 없음 — 실측). props `onConsultClick` 추가, `handleNavClick("consult")` 경유 = 예산 프리필(useAppNavigation.ts L73-86) + consultSubmitted 리셋 보존 |
| `BottomNav` / `HeaderSection` | **수정** | navItems 홈 추가 + D4 재배열 + BottomNav L23 잔재 정리 + **네비 안내 텍스트 5곳 동시 갱신**(HeaderSection L88·90 HELP_SECTIONS / GuideSections.tsx L133·168 / useComparison.ts L31 복원 토스트) |
| `App.tsx` | **수정** | `tab === "home"` 분기 + §1 초기 탭·딥링크 표 전체 + upcoming 응답 state lift |
| `featureFlags.ts` 외 **배선 5곳** | **수정** (v2 구체화) | ① featureFlags.ts `isFeatureHome()` ② vite-env.d.ts ImportMetaEnv `VITE_FEATURE_HOME`(L3-9 동시 박제 의무 주석 실존) ③ e2e.yml env 추가 ④ playwright.config.ts webServer.env(관례상 동시) ⑤ ci.yml은 **미주입 유지**(기본 OFF — 기존 회귀 보존, ON 경로는 BottomNav.test.jsx L96-126 `vi.stubEnv` 패턴 양갈래) |

## 3. 데이터 흐름 (새 fetch 0 유지)

```
useDataPipeline (기존) ──→ scored/scoredMap/filtered ──→ 지도 위젯·추천 TOP·시장 집계·전문가 위젯 입력({apt,res} = scoredMap.get(id))
/api/upcoming (기존 1회) ──→ 전체 응답 state lift ──→ 헤더 라벨 + 곧분양 위젯
MapView onSelect(신설) ──→ 홈 selectedApt ──→ SelectedAptCard + 전문가 위젯 2종 동기 갱신
  └ filtered 변경·모드 토글 시 null 전파 → 선택 해제 + 전문가 위젯 빈 상태 복귀 (MapView L84 리셋 로직과 일관)
로그인 상태 ──→ 지도 위젯 잠금(D5)·추천 TOP isLoggedIn·전문가 위젯 표시(role 축)
```

- **위젯 lazy ≠ 기본 탭 지연** (v2 사실 박제): lazy chunk는 홈 렌더 즉시 fetch됨. Kakao SDK·타일은 외부 스크립트라 lazy 범위 밖 → 미니지도는 뷰포트 진입 로드(§2)가 본선
- 홈↔지도 탭은 별개 마운트 = MapView 인스턴스 재생성 + 위치·줌·선택 불연속 (§8 미결: 초기 center/level prop 공유 검토)
- Kakao SDK 로더는 멱등(kakaoMapHelpers.ts L74-92 실측) — 양쪽 마운트해도 중복 로드 0

## 4. 정보 누락 0 — 보존 맵 (v2 보강)

| 현재 요소 | 통합 후 위치 | 변화 |
|---|---|---|
| 목록: AptCard 그리드·필터 6종·정렬·프로필 5종·비교 시트 | 목록 탭 그대로 | 입구 +1 (홈 추천 위젯) |
| 목록: 비교 하단탭 (모바일) | 목록 화면 안 버튼 | 위치만 이동 |
| 지도: 마커·클러스터·색칠모드·인프라 오버레이·선택카드 + **비로그인 게이트(trigger="map")** | 지도 탭 그대로 (게이트 포함 보존 — D5) | 입구 +1 (홈 미니지도 펼치기, handleNavClick 경유) |
| 곧분양: 단계탭 4종·캘린더·카드(D-day·캘린더등록)·알림신청 | /upcoming 그대로 | 입구 +1 (홈 위젯 펼치기) |
| 전문가: 사이드바·요약·점수분해·138필드 9섹션·완성도·도움말 | expert 탭 그대로 | 입구 +1 (홈 전문가 위젯 펼치기) |
| 상담 폼 | consult 탭 유지 + **InfoPage 진입 신규 추가** + DetailModal 버튼 | 모바일 하단탭에서만 빠짐 |
| URL 딥링크 `?detail=` / `?compare=` / `?profile=` (v2 추가) | §1 표 — compare는 setTab("list") 페어로 보존 | 동작 보존 |
| 숨은 탭 expertLogin·kakaoCallback (v2 추가) | 라우팅 분기 그대로 | — |
| 정보·DetailModal 6섹션·비로그인 블라인드 정책 | 전부 불변 + **홈 진입도 handleDetailGated 경유로 정책 답습** | — |

## 5. 빈 상태 / 에러 처리 (v2 보강)

- 위젯 단위 독립 (한 위젯 실패가 홈 전체를 깨지 않음)
- **데이터 로딩 중**: useApartmentData 비동기(App L139) — apartments=[] 첫 렌더 시 홈 전체 위젯 스켈레톤 (v2 추가)
- **지도 위젯 에러**: SDK 키 미설정/로드 실패 시 MapView 에러 오버레이(L162-170)가 위젯 크기로 — 위젯용 문구·크기 정의 (v2 추가)
- 곧분양 API 실패 → "불러오기 실패 · 재시도" (UpcomingPage 5상태 답습) / upcoming flag OFF → 위젯 미노출
- 전문가 위젯 미선택 → "지도에서 단지를 선택하세요"
- isFeatureHome OFF → 홈 미노출 + 기본탭 list 폴백 = 현행 IA 그대로

## 6. 마일스톤 (3 PR — v2 재배치: 비로그인 분기는 M1)

| 단계 | 범위 | 완료 기준 |
|---|---|---|
| **M1** | featureFlag 배선 5곳 + HomePage + 소비자 위젯 4종 + **비로그인 분기(D5 잠금 placeholder·추천 TOP isLoggedIn — v2에서 M2→M1 이동)** + 네비 5탭 + 안내 텍스트 5곳 + InfoPage 상담 진입 + §1 초기탭·딥링크 표 전체 | vitest 신규(위젯 5상태·잠금 placeholder·`?compare=` 딥링크 회귀) + 기존 전체 회귀 green + e2e 홈 spec 1개(mobile.spec.ts L57-62 flag-OFF auto-skip 패턴 + e2e.yml env 추가) + CI 기본 OFF 유지·ON은 stubEnv 양갈래 |
| **M2** | **MapView height/onSelect/compact prop 신설(전제 작업)** + 전문가 위젯 2종(축약 모드) + selectedApt 동기 갱신 | onSelect 4지점 null 전파 테스트 + 로그인/role 분기 + 기존 지도 탭 byte-for-byte 무변경 회귀 + expert e2e |
| **M3** | 다듬기: 모바일 위젯 순서·접기 기본값·접근성(ARIA)·Analytics(`home_*` 신규 + 펼치기 tab_switch 연속성 확인) | lint·tsc·Playwright 전체 green |

## 7. 테스트 전략 (v2 보강)

- **양갈래 플래그 전략**: CI 기본 = OFF(기존 회귀 보존) / ON 경로 = `vi.stubEnv` describe 블록(BottomNav.test.jsx L96-126 선례) + e2e는 env 주입 spec
- 단위: 위젯 렌더 5상태 / 핀클릭 onSelect → 카드+전문가 위젯 동기 / null 전파 빈 상태 복귀 / 네비 5탭 회귀
- 회귀: 기존 화면 4개 진입 2-way + `?compare=`·`?detail=` 딥링크 + 카카오 콜백 착지
- 비로그인: 홈 지도 위젯 잠금 placeholder → 클릭 시 LoginPromptModal(trigger="map") / 추천 TOP 점수 "??" / 홈 상세 진입 LoginPromptModal 발화
- e2e: 홈 진입 → (로그인) 핀 클릭 → 카드 → 상세 → 곧분양 위젯 → /upcoming

## 8. 미결 (구현 시 확정)

- 시장 요약 지표 목록 — 가진 필드 실측 후 (새 수집 금지 + 점수 파생 지표 "??" 제약만 고정)
- 미니지도 setBounds 전국 리셋 억제 옵션(다른 위젯 조작 → filtered identity 변경 → 패닝 복귀 문제) + relayout 필요 여부
- 홈↔지도 탭 위치·줌 연속성 (초기 center/level prop 공유)
- 마커 생성 수 — 검증자 간 모순(전수 1,424 vs 좌표 보유 ~731): 구현 시 MapView L89 skip 조건 기준 실측
- 전문가 모바일 6탭 폭 — 실기기 확인
- V1(하단 카드) → V2(옆 패널) 전환 여지 — **onSelect prop(M2)이 전제**

## 9. 본 작업 범위 밖 발견 (BACKLOG 박제 대상 — 적대검증 부산물)

- DetailModal ungated 진입 기존 2건: `?detail=` 딥링크(App.tsx L213-219)·UpcomingPage(L355) — 비로그인 도달 가능 (기존 구멍, 홈 IA와 무관)
- AptCard 비로그인 부분 누설: Bar가 실점수를 aria-valuenow·width%로 DOM 노출(primitives.tsx L10-11) + "안전 N등급" 텍스트
- 루트 CLAUDE.md stale 2건: "Playwright E2E (11 spec)" → 실측 13 / index 172KB → ~185KB
