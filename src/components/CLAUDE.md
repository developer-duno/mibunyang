# 컴포넌트 규칙

> UI 컴포넌트 수정 시 반드시 이 규칙을 따를 것.

## memo() 컴포넌트

> ⚠️ **개수는 휘발성 = 드리프트 단골** (세션 452·456 교훈). 아래 숫자는 박제값이 아니라 참고용 —
> 진실의 원천은 실측: `grep -lE "memo\(function|= memo" src/components/<그룹>/*.tsx | grep -v test | wc -l`.
> 컴포넌트가 늘면 숫자만 고치지 말고 이 실측 명령으로 확인. (2026-06-29 세션456 실측 반영)

| 그룹 | 개수 | 위치 | 컴포넌트 |
|------|------|------|---------|
| 소비자 | 18 | `src/components/` | CatPanel, AptCard, CompareSheet, ShareSheet, ConsultForm, DetailModal, LoginPromptModal, LineChart, RegionChipBar(지역 칩+★관심지역, 세션 406), PresaleResultList(분양결과 — 잔여세대 경쟁률, "1순위" 표기 금지, 세션 406), **HelpHint**(제목 옆 ? 도움말 — Tooltip+IconHelp 재사용, `<HelpHint text label/>` 한 줄로 어느 탭이든 재사용, 세션 411), primitives.tsx 내부(Bar/ScoreBadge/Radar/EmphasisBadge/Skeleton 3종) |
| 홈 | 7 | `home/` | HomePage, WidgetCard, MapEntryWidget(M2: 로그인 시 MapView compact 미니지도 임베드 + 뷰포트 진입 lazy), UpcomingWidget(세션 415 빈상태 정리 — 완전빈 단일안내/부분빈 "임박한 청약은 없어요"), TopPicksWidget, MarketSummaryWidget(세션 415 칸별 클릭 동선 — onCellNav prop, nav 있는 칸만 button, home_market_nav 계측), **RecentlyViewedWidget**(최근 본 단지 가로 스크롤 위젯 — localStorage·MAX_RECENT 8·rank=0 순위배지 숨김·삭제단지 스킵·지우기 버튼, 세션 429) (세션 404 M1 신설, 세션 406 표 등재) |
| 섹션 | 14 | `sections/` | HeaderSection, SearchFilterBar, AptListSection(내부 2개), AdminLoginForm, InfoPage, BottomNav, **MapView**(카카오 지도 패스스루 — `<KakaoMapView {...props}/>` memo 래퍼. 세션 435~448 네이버/카카오 provider 토글이 있었으나 세션 449에 네이버 전면 제거[v3 POI API 부재·두 SDK 버그표면 2배]. App·MapEntryWidget 의 import 경로·번들 청크 분리·MapView.test.jsx 보존 위해 파일 유지, 세션 449), **KakaoMapView**(구 MapView 본문 — 점 보기 마커+클러스터+색칠/인프라+현위치+GPS 자동 동네, 세션 435 분리), **InfraOverlay**(지도 위 주변시설 아이콘 토글 — 8 카테고리[지하철·병원·마트·학교·학원·편의점·약국·카페], 카카오 Places categorySearch 실시간, **단지 선택 시 그 단지 좌표 기준** 검색·미선택 시 화면중앙 폴백, 카테고리 단일출처 `infraCategories.ts`, 카카오 전용, 세션 448), SelectedAptCard (+ 비-memo 헬퍼 `markerSvg.ts`[buildMarkerSvg·shortPrice·MARKER_* 상수·**MY_LOCATION_DOT_SVG**(현위치 파란점, 세션 448 4곳→1), import.meta.env 0 순수 모듈 — 세션 416 분리]·`kakaoMapHelpers.ts`[KAKAO_KEY·SDK·getKakaoMaps]·**`mapShared.tsx`**[지도 공용 표현계층 — `MapShell`(forwardRef 루트 div+높이 3분기 calc+border/radius fullscreen 분기+error 오버레이, mapRef 위임)·`MyLocationButton`(memo, 📍 현위치 버튼), 카카오 지도 껍데기 추출, SDK 로직 무관, 세션 448]) |
| 상세 | 19 | `detail/` | PriceTable, PriceChart, UnsoldChart, SchoolInfo, PresaleInfo, LoanAnalysis, LoanRatesSection, **DataSectionBlock**(공공데이터 섹션 1개=자체 접힘+자체 박스+부가블록 3종, 세션 408 D2a — 구 DataSections 해체), **CategoryMiniCard**(종합 탭 카테고리 요약 미니카드 — 점수+등급+결론 1줄[catVerdict]+탭하면 점수 탭 자동 펼침, 세션 409 D2b), **ProfileWeightBar**(종합 탭 "왜 이 점수인지" 가중치 막대 — getTopCats 상위3 카테고리 가중치% 가로막대[기여분 숫자 미표시·비중만]+강점/보완 1줄[최고/최저 total, benefit noData 제외], 세션 434), HighlightField, InfrastructureSection, AdminScoreBreakdown, AdminUnitSupply, **AdminDataAudit**(138필드 표+관리자 완성도+fullFields 토글 — 세션 408. 세션 409 D2b 로 AdminScoreBreakdown·AdminUnitSupply 와 함께 관리자 탭[sec-admin]으로 이동) (관리자 인사이트 — 세션 405 전문가 대시보드 이식, adminLoggedIn 게이트+lazy) |
| 필터 | 8 | `filters/` | FilterButton, FilterDropdown, RegionPanel, BudgetPanel, AreaPanel, SortPanel, DetailPanel, PresetPanel |
| 관리자 | 6 | `admin/` | AdminDashboard, AdminHelpGuide, AdminConsults, WeightEditor, WeightTable, ScoreBreakdownPreview (단, 세션138 이후 `admin/` 폴더에는 memo 아닌 StatsSection/UserCard/UserList 3개 추가 존재) |

> **전문가 그룹(`expert/` 9개)은 세션 405 에 폐지** — 자료는 상세 모달 관리자 인사이트(AdminScoreBreakdown·AdminUnitSupply·AdminDataAudit 138필드 표[세션 408 D2a 로 구 DataSections adminMode 분리])와 AdminConsults/AdminHelpGuide 로 이식. 결정 문서: `docs/superpowers/specs/2026-06-12-expert-role-abolition-decision.md` |
| 아이콘 | 1 | `icons.tsx` | 내부 공용 memo 1개 (IconClose 등 9개 아이콘은 순수 SVG 함수, memo 래핑 안 함) |

- 반드시 `memo(function Name(...) { ... })` 패턴 유지
- memo 효과를 위해 콜백은 `useCallback`으로 안정화 필수

---

## 접근성 규칙

- ARIA 속성 제거 금지 (role, aria-pressed, aria-selected, aria-current, aria-live)
- 터치 타겟: 필터/정렬 버튼 minHeight 36px+, 네비 버튼 minHeight 44px+
  - ⚠️ 36px 는 **터치(모바일·태블릿) 기준**. 데스크톱(isDesktop ≥1024, 마우스)만 32px 납작 허용 — 정렬칩·상세토글·시공사 select 가 `isDesktop ? 32 : 36` (세션 483, 세션 481 목업 "PC만 납작" 합의). 태블릿(isPC 768~1023)은 터치라 36 유지.
- 폰트 크기: 최소 10px (8px 금지)
- 색상 대비: C.muted = `#6B7280` (WCAG AA 4.6:1) — 더 밝은 색 변경 금지
- 키보드 접근: 카드 `tabIndex={0}`, `role="button"`, `onKeyDown` 유지

## 크로스브라우저 규칙

- `100dvh` 사용 (`100vh` 금지 — iOS Safari 주소창)
- `inset: 0` 금지 → `top:0; right:0; bottom:0; left:0` (Safari <14.1)
- SVG 텍스트: `dy="0.35em"` 사용 (`dominantBaseline` 금지 — Firefox <128)
- iOS Safe Area: 하단 네비 + Toast에 `env(safe-area-inset-bottom)` 필수

---

## 관리자 인사이트 규칙 (세션 405 — 구 전문가 페이지 규칙 승계)

- 모든 신규 블록은 `adminLoggedIn` 게이트 + lazy import — 소비자 화면/번들 영향 0 (게이트 가드 테스트 의무)
- 모든 필드 개별 표시 필수 (AdminDataAudit, fieldMeta.ts `FIELD_SECTIONS` 9섹션 전수 — 정확한 개수·섹션 구성은 fieldMeta.ts 가 진실의 원천, 박제 금지)
- 스코어링 중간 계산 과정 투명 표시 (AdminScoreBreakdown — 적정가 과정·기여도·가중 합계)
- catKeys는 `orderedCatEntries(res.cats)` 로 추출 — 필드 목록을 손으로 적지 않는다는 **기존 취지는 그대로**이고, 거기에 표시 순서만 `CAT_DISPLAY_ORDER`(`constants/catOrder.ts`)로 고정한다. `Object.keys(res.cats)` 직접 사용 금지 — 그 순서는 서버 `catsCache` 의 JSON 직렬화 부산물이라 수집기 변경만으로 화면이 조용히 뒤집혔다(세션 487). 존재하지 않는 카테고리는 자동으로 빠지고, `catOrder.test.ts` 가 6개 전량·중복 0 을 잠근다.

---

## 주요 컴포넌트 구조

### App.tsx

Hook + useMemo + 콜백 + 탭 라우팅 + isDesktop prop 스레딩 + trackEvent

### 섹션 컴포넌트 (`sections/`)

| 컴포넌트 | 줄 | 역할 |
|---------|-----|------|
| HeaderSection | 166 | 데스크톱: 상단 바 60px / 모바일: 그라디언트 + HelpModal |
| SearchFilterBar | ~590 | 드롭다운 오케스트레이터 (7개 FilterButton[지역/금액/면적/정렬/추천/상세/**검색**] + 패널 + 칩 + undo). 검색=단지명·지역 input(세션 419, `searchMatch.ts` 부분일치, 펼쳐지는 드롭다운, 활성판정 trim·표시 raw, 칩 "검색: X ✕") |
| AptListSection | 53 | 카드 그리드 (isDesktop 3컬럼/isPC 2컬럼) |
| KakaoMapView | ~290 | Kakao Map (마커+클러스터+현위치+인프라). `MapView` 는 이 컴포넌트로 패스스루(세션 449). 마커 SVG는 `markerSvg.ts buildMarkerSvg`(세션 416 분리 — 둥근 말풍선+흰 테두리+도형 그림자 rgba(0,0,0,0.22), 가격배지/무가격핀, selected 인자로 강조 1.15배). M2 prop 3종: `height`·`compact`(위젯 모드 — 컨트롤 숨김+휠줌 차단)·`onSelect`(선택 미러, ref 격리 — 마커 effect deps 추가 금지). **M3 prop 2종(세션 413)**: `getViewport`·`onViewportChange`. `didFitRef=false` 첫 마커 fit 1회(전국 리셋 억제). **선택 마커 강조(세션 416)**: `markerByIdRef`(apt.id→marker) 마커 effect 매 run 재채움[stale 차단]+강조 effect `deps=[selected]`만[전체 재생성 회피]+`__normalImage` 보관[복원]+`setImage` 강조+`setZIndex(50)`+`clusterer.redraw()`[복원/강조 실제 시만, setImage auto-redraw 미보장]. 전국뷰(레벨≥5)=클러스터 묶임이라 강조는 줌인 시 보임. 미니지도(MapEntryWidget)는 의도적 미연결(idle 오염 회귀 방지). **세션 417 prop 3종**: `deferredRegion`·`deferredGu`(지역/시군구 변경 시 그 지역 단지로 자동 클로즈업 — 마커 effect 내 didFitRef 옆 `else if` 분기, `prevRegionRef`/`prevGuRef` "직전과 다를 때만" fit[정렬/예산엔 발화 0=수동 위치 보존], setBounds padding 40/24/40/24+과도줌 클램프 시도 `REGION_FIT_MIN_LEVEL=8`/구 `GU_FIT_MIN_LEVEL=4`[클러스터 경계 5보다 아래=개별 마커 풀림], "전체"는 fit 안 함. 원시 filterRegion/Gu 아닌 deferred[stale 회피]. 미니지도엔 미연결)·`fullscreen`(전체화면 — border:none+radius0, 높이 calc 불변[필터바 위 그대로=잘림 방지]. App 지도 탭 div `width:100vw+marginLeft:calc(-50vw+50%)` 풀블리드+index.html `html,body overflow-x:hidden`[가로 스크롤바 방지]). **마커 클릭 1단계화(세션 417)**: click=`setSelected`(강조)+`onDetailRef.current`(바로 상세) 둘 다. `onDetailRef` 미러(onSelectRef 답습)=마커 effect deps 오염 0. 비로그인→handleDetailGated 로그인 모달 |
| BottomNav | 36 | 하단 네비 (isDesktop → null) |

> **production 콘솔 노이즈 진단 (세션446 — 재조사 금지, 실증 완료)**: 콘솔의 ① "화면마커/클러스터원/1초 FPS"(`[네이버지도 성능]`) 로그 도배와 ② CSP `'unsafe-eval'` 차단 에러는 **둘 다 우리 코드가 아니라 브라우저 확장 프로그램이 주입한 스크립트** 출처다. 실증: 우리 번들 3개(`index`·`vendor`·`rolldown-runtime`)+`index.html` 인라인+카카오 SDK(`kakao.min.js`) **전수 grep 0건** — "화면마커"·"requestAnimationFrame FPS 측정"·`eval(`·`new Function(` 모두 0. 콘솔의 VM369~ 번호 = 동적 주입 특징. 그 주입 스크립트가 네이버지도 DOM(당시 NaverMapView 클러스터 `width:44px;border-radius:50%`)을 세며 eval 로 FPS 측정 → 우리 CSP 가 eval 을 막아 ② 에러 발생(= **CSP 가 외부 주입을 정상 차단** = 보안 작동). **결정 = 손대지 않음**: 우리 코드 결함 0, 손님 브라우저엔 안 뜸(특정 확장 설치 사용자만), `'unsafe-eval'` 추가는 보안 약화라 금지. 확인법 = 시크릿 모드(확장 off)에서 로그 사라짐. (세션 449에 NaverMapView 자체를 제거 — 이 확장 노이즈는 외부 확장 출처라 우리 코드와 무관했고, 네이버 DOM 이 없어진 지금은 그 확장이 무엇을 세는지만 바뀔 뿐 결론[손대지 않음]은 동일.) ⚠️ **세션446 본인 착시 2회**(처음 "카카오 SDK 로그"로 오판) — `.claude/rules/meta/tool-output-illusion-guard.md` §"grep 0건 출처 추측 금지" 답습.

### 상세 컴포넌트 (`detail/`)

| 컴포넌트 | 줄 | 역할 |
|---------|-----|------|
| DetailModal | ~390 | 모달 컨테이너 (isDesktop 760px, ARIA dialog). 세션 407 D1: 콘텐츠 교체 탭(activeTab+visited keepMounted, 관리자=전 패널 마운트) + CTA sticky bottom 바. 세션 408 D2a: 공공데이터 8섹션 주제별 탭 분산. 세션 409 D2b: 종합 탭에 CategoryMiniCard 6개(점수+결론, 클릭 시 점수 탭 해당 카테고리 자동 펼침 — jumpSeqs[k] 단조 증가 key 로 1개만 리마운트). 관리자 인사이트 3종을 **관리자 탭(sec-admin)**으로 분리(sections useMemo, 소비자 6탭/관리자 7탭). **세션 410 D3**: 탭 전환 페이드(panelStyle animation + FADE_KEYFRAMES `<style>` + print CSS 무효화 + reduced-motion) + **ARIA tablist 정석 role=tab**(패널 role=tabpanel+aria-labelledby, isMounted 조건부 aria-controls) + analytics(handleTabChange 에서 `detail_tab_view {tab,previous_tab}`) + 관리자 로그아웃 시 빈 화면 fallback(sections.some(activeTab)). CatPanel 은 점수 탭에서 순수 점수만 |
| PriceChart | 43 | 분양가 추이 SVG (usePriceHistory + siblingIds) |
| UnsoldChart | 45 | 미분양 추이 SVG (useUnsoldHistory + siblingIds) |
| PresaleInfo | 130 | 네이버 분양정보 (가격카드/일정/링크/Analytics) |
| DataSectionBlock | ~120 | 공공데이터 섹션 1개 렌더(자체 접힘 더보기 + 자체 박스 + 부가블록 3종 NearbyFacilities/PriceByFloor/AnnouncementLink). 섹션 정의·fieldsOf·dataValueColor 는 `@/lib/dataSections`(4그룹 상수 OVERVIEW/LOCATION/PRICE/PRESALE). 세션 408 D2a 로 구 DataSections.tsx(152줄, 단일 토글 8섹션) 해체 |
| CategoryMiniCard | ~70 | 종합 탭 카테고리 요약 미니카드 — 점수+등급(gr)+결론 1줄(`@/constants/catVerdict` catVerdict). 클릭 시 점수 탭 해당 카테고리 자동 펼침(DetailModal jumpSeqs key). 강조=테두리+"중점" 칩(★ 없음). 세션 409 D2b |
| AdminDataAudit | ~115 | 관리자: 138필드 전수 표(FIELD_SECTIONS 9섹션 fullFields 토글) + 관리자 기준 완성도 + ★중점 강조. 구 DataSections adminMode 분리(세션 408 D2a). 세션 409 D2b 로 관리자 탭(sec-admin) 소속 |
| AdminScoreBreakdown | 150 | 관리자: 적정가 산출 과정·가중치 기여도·최종 가중 합계·도시등급·인쇄 (구 ExpertScoreBreakdown+Summary 이식, 세션 405) |
| AdminUnitSupply | 76 | 관리자: 동/호수 3칸 + 청약홈 평형별 공급 표 (구 ExpertUnitPlaceholder 이식, usePresaleDetail units 유일 소비처) |

### 프리미티브 (`primitives.tsx`)

| 컴포넌트 | 역할 |
|---------|------|
| Bar | 수평 프로그레스 바 |
| ScoreBadge | 원형 점수 인디케이터 (SVG circle) |
| LineChart | 시계열 SVG 라인 차트 (다중 라인, 터치 툴팁 3초 auto-dismiss) |
| Radar | 6점 레이더 차트 |
| EmphasisBadge | 프로필 상위 카테고리 "★ 중점" 배지 (CatPanel·ExpertFieldTable 공용, `background?` 옵셔널) |

### AptCard

- `isDesktop`: shadowMd, borderRadius 16, fontSize 16
- `isFav`: 관심매물 하이라이트 (border 색상)
- `moveInDone` (준공 + 미분양 0): opacity 0.55. **판정은 `unsold`(수) 기준**(세션 445) — `unsoldRate`(%)는 100% 초과 폭발값이 null 로 무력화돼 있을 수 있어, 미분양 단지가 "입주완료"로 둔갑하던 회귀 방지(classify.ts:33·hideNoUnsold 필터와 일치)
- alertRow 배지: 분양중/분양예정 + 입주상태 + 미분양 + 시공사신용 + 혐오시설 + 치안(위험/주의/**우수**) + 추가모집 + **혐오안심**. **치안우수(세션 423)**: `crimeSafetyGrade<=2`(1·2등급) 초록 `C.green` "치안우수" — 현재 위험(`>=4`)만 빨강이라 안전 강점 미표시였음. 위험(`>=4`)과 **상호배타**(3등급은 둘 다 미표시). alertRow 렌더 조건에 `<=2`도 추가(혐오시설 없는 순수안전 단지도 노출). comparator는 `crimeSafetyGrade` 이미 추적(추가 불필요). **혐오안심(세션 430)**: `noxiousDist>1000m` → 초록 `C.green` "혐오시설 없음" 신규 노출 — 기존 `<=1000m` 빨강과 **상호배타**(치안우수 세션 423 패턴 답습).
- infoRow 배지(세션 420, **문구 정정 세션 487**): deviation 양수→초록 **"적정가보다 N% 저렴"** / 음수→빨강 **"적정가보다 N% 비쌈"**(`Math.abs`, 상호배타). ⚠️ 옛 문구 "주변대비"는 **거짓 라벨**이었다 — `deviation` 은 `scorePrice.ts` 가 계산한 **적정가와의 괴리**이지 주변 단지 비교가 아니다. 세션 487 편차 스트립(진짜 지역 중위값 대비)이 바로 위에 붙으면서 한 카드에 "평당가 158% 비싸요 / 주변대비 62% 저렴"이 동시에 뜨는 모순이 라이브에서 드러나 정정(사장님 승인). 적정가·입지·할인도 여기. **청약 경쟁률(세션 422)**: `PRESALE_ACTIVE_STAGES`(분양중/청약중/분양계획)+`competitionRate>0`일 때만 `C.indigo` "청약 N:1"(`fmtCompetitionRate` 위임, 천단위 콤마). **미분양 단계 제외**(미분양% 배지와 동시노출 모순 차단). comparator에 `competitionRate` 비교 1줄. `fieldMeta.ts presaleNA`(미분양 포함 4종)는 재사용 안 함. **역세권 칩(세션 430)**: `subwayDist≤500m` → 초록 "역세권 Nm" 강조 / `>500m` → 회색 거리 표시 / `null` 숨김. **전세가율 칩(세션 430)**: `jeonseRate≥70%` → 초록 / `<50%` → 주황 / `50~69%` → 회색. **주차 여유도 칩(세션 430)**: `parkingRatio≥1.5` → 초록 "주차 여유" / `<1` → 주황 "주차 부족" / `1~1.49` → 회색. **복도유형 칩(세션 433)**: `corridorType==="복도식"` → 주황 (계단식·혼합식 생략). **초등 도보 칩(세션 437)**: `naverSchoolWalkMin≤5분` → 초록 "초등 도보 N분" 강조 / `6분~` → 회색 / `null` 숨김. **전용률 칩(세션 437)**: `exclusiveRatio≥80%` → 초록 "전용률 N%"(점수 '우수' 티어) / `<80%` → 회색 / `null` 숨김. **LPG난방 칩(세션 437)**: `heatFuel==="LPG"` → 주황 "LPG난방"(난방비↑ 약점, 도시가스·null 생략). 세 칩 comparator 비교 추가(세션 426/430 함정). **교통호재 칩(세션 440)**: `transitDev` 존재+`!=="없음"`+`devDist≤2km` → 파랑 "🚆 노선역"(라벨=`transitDev.split(" ").slice(0,2)` 2토큰). 멀면 숨김(scoreFuture L51-52 처럼 점수도 낮음=거짓 강조 차단). comparator에 `transitDev`·`devDist` 2줄. **DSR 통과 칩(세션 440)**: `dsr40pass===true` → 초록 "DSR 통과"(자금조달 양호 강점, false 다수·null 생략, scoreRisk "DSR통과" 문구 일관). comparator에 `dsr40pass` 1줄. 두 칩 모두 표현계층 전용(점수·DB·블라인드 무변경). **학군 등급 칩(세션 441)**: `schoolGrade==="C"` → 주황 "학군 C"(보통, 상대적 약점)만 노출. **라이브 실측 분포 A=84.4%·B=12.2%·C=3.4%·D=0%** → A 는 다수(84%)라 강조하면 노이즈, D 는 0건, B 는 양호 → **C(3.4% 소수)가 유일한 변별 신호**(교육 중시 손님에게 상대적 약점). A·B·D·null 숨김. `schoolGrade`=schools-neis `gradeFromScore` A/B/C/D(apartments_flat VIEW `sc.school_grade`). comparator에 `schoolGrade` 1줄. 표현계층 전용. **답습: 칩 임계는 라이브 분포 실측 후 결정 — 박제 가정(A강점/D약점)이 실측(A다수/D0)으로 뒤집힘.** **향 칩(세션 444)**: `primaryDirection.startsWith("북")`(북향·북동향·북서향) → 주황 약점(채광·난방 불리). 라이브 실측 1424행 = 남쪽 93%(남58.9·남동19.5·남서14.9)·동3.2·서1.5·북쪽 **1.9%**(북서0.9·북동0.6·북0.4) → 남쪽 다수=강조 노이즈, 북쪽(1.9% 희소)이 유일 변별 신호. 라벨=실제 방향 그대로. 동/서(중립)·null 숨김. comparator `primaryDirection` 1줄. 표현계층 전용(점수·블라인드 무관, raw 필드라 비로그인도 노출). 학군 C 칩 패턴 답습.
- `isLoggedIn` 블라인드(점수 계열만, 정책 api/CLAUDE.md "점수 블라인드"): 종합 ScoreBadge→`??` div / 카테고리 점수숫자→blur+`??` / **카테고리 Bar→aria-hidden 회색 placeholder**(세션 420, Bar 컴포넌트 불변=호출처만) / **"안전 N등급"→"안전 ?등급"**(세션 420). 적정가·입지·deviation 배지는 점수 아니라 노출 유지. **스크린리더 정합(세션 463)**: 원형 `??` div = `role="img"`+aria-label "점수 비공개 — 로그인 후 확인 가능"(비로그인 스크린리더가 물음표만 듣던 공백 해소), blur `??` 숫자 span = 비로그인 시 aria-hidden(장식 반복 — 정책 설명은 원형 1회).

---

## 반응형 레이아웃

| 브레이크포인트 | 플래그 | 컨테이너 | 카드 그리드 | 네비게이션 |
|--------------|-------|---------|-----------|----------|
| <768px | 모바일 | 520px | 1컬럼 | 하단 BottomNav |
| 768~1023px | isPC | 960px | 2컬럼 (gap 16px) | 하단 BottomNav |
| 1024px+ | isDesktop | 1200px | 3컬럼 (gap 20px) | 상단 고정 바 60px |

- `useResponsive()` → `{ isPC, isDesktop }` (150ms 디바운스)
- isDesktop prop: App → HeaderSection, BottomNav, SearchFilterBar, AptListSection→AptCard, DetailModal, CompareSheet, MapView
- 롤백: useResponsive에서 `isDesktop: false` 고정 시 즉시 복원

## 데스크톱 키보드/테마

- 키보드 단축키: 1~5 프로필, Ctrl+Z undo, Ctrl+Shift+Z redo, Escape 모달닫기
- 헤더 화이트 테마: C.borderStrong("#D1D5DB"), 모바일 borderBottom 1.5px
