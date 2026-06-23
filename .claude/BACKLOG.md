# 개선 백로그

> 최초 출처: 2026-04-19 `/improve` 분석 → `~/.claude/plans/pwd-f-mibunyang-improve-report.md`
> 운영 규칙: 🔴 미션은 `/blueprint` 로 바로 실행. 🟡/🟢 는 `/improve` 에서 3회 이상 반복 지적되면 🔴 승격.
> CLAUDE.md 본문에 백로그 진행 상태 두지 말 것 — 전부 이 파일
> **완료 항목은 [BACKLOG_ARCHIVE.md](BACKLOG_ARCHIVE.md) 로 이동.** 이 파일은 "할 일"만 유지.

---

## ✅ 완료된 일 (색인 — 상세는 [BACKLOG_ARCHIVE.md](BACKLOG_ARCHIVE.md))

> **중복 플랜 방지**: plan 작성 전 이 색인을 grep. 여기 있으면 = 이미 완료, plan 금지.
> fix 를 박은 세션이 그 자리에서 항목을 ARCHIVE 로 이동 + 이 색인에 한 줄 추가 (drift 0).

- ✅ 복도유형(복도식) 카드 칩 — 세션 433 (PR #139, main 9a9f387). corridorType(채움 87%, 계단식 70.7%/복도식 13.5%)이 수집만 되고 src/ 미사용. **복도식만 주황 칩**(약점 신호), 계단식 다수라 생략. 표현계층 전용. AptCard span 1+comparator 1줄+테스트 3. **잔여=👤 production 칩 확인**.
- ✅ 지역 활력 데이터(출산율·의료) 상세 노출 — 세션 433 (PR #140, main 531447e). regions 시군구 KOSIS 3종 85% 채움인데 미사용 → 상세 시세 탭 노출. VIEW latest_regions_gu CTE(array_agg FILTER 세션391 lag 회피)+JOIN, 매칭 69%. 138→141 연쇄. 점수 무변경(통합 보류). **잔여=👤 VIEW 마이그 Dashboard 적용(`20260623000000`)·production 확인·점수통합 결정**. collect-data select(*)라 미적용도 무회귀.
- ✅ "최근 본 단지" 홈 위젯 — 세션 428 (PR #135). 사장님 "무슨 작업 할지 추천(완료 제외)" → BACKLOG 전수 라이브 실측 결과 박힌 항목 **전부 진행 불가**(MOLIT supply_ratio API 여전히 다운·무순위 차수 2회+ 0개·KOSIS 로컬 이전·RLS 11개 타 레포·avg_price ADR 보류) → BACKLOG 밖 손님 가치 발굴. grep 결과 비교함·찜·공유·관심지역은 **이미 구현**(중복 금지), **"최근 본 단지"만 부재**. 사장님 결정=홈 위젯+로그인만 기록. **구현(순수 localStorage 표현계층, 점수·엔진·DB·백엔드 무변경)**: `useRecentlyViewed.ts` 신규(`useFavorites.ts`/`useComparison.ts` 답습 — STORAGE_KEY `mibunyang_recent`·MAX_RECENT 8·recordView 맨앞 unshift+중복제거+절단·clearRecent·localStorage quota 가드·크로스탭 동기화·오염값 방어). 기록 지점=`useDetailModal.handleOpenDetail`에 `recordView` 인자 주입(상세 진입 단일 지점, `handleDetailGated`가 isLoggedIn만 통과시켜 "로그인 시 기록" 자동 충족). `RecentlyViewedWidget.tsx` 신규(`TopPicksWidget` 답습, 가로 스크롤, rank=0으로 순위배지 숨김, scoredMap 부재 단지 filter 스킵, 지우기 버튼). HomePage `hasRecent` 가드(살아있는 단지 1개+일 때만 노출). `AptCard` `rank>0` 가드 1줄(호출처 2곳 다 rank≥1이라 무회귀, 최근위젯만 rank=0). **적대검증 워크플로 6에이전트 4관점(null안전·Hook규칙·보안·멘탈모델) 확정 사고 0** + 발견 2건 반영: (1) **카카오 로그인 후 pendingDetail 복원 경로(`useKakaoCallbackEffect.ts:44`)가 recordView 건너뜀** → 로그인까지 한 단지인데 미기록=정책 불일치 → recordView 인자 추가+회귀 2건. (2) localStorage 빈 문자열 오염 방어(`x.length > 0`). 변경 8파일+신규 4(훅·위젯·각 테스트). tsc0·vitest src **1848**(+신규 28)·eslint0·build0·cross-validate 4관점 PASS. **잔여=👤 production 카카오 로그인→단지 2~3개 상세 열기→홈 탭 "최근 본 단지" 위젯 최근순 확인**(단위 테스트가 회귀 가드).
- ✅ 카카오 손님 마케팅 동의·전화번호 수집 + 100명 배포 안정성 + footer 연락처 + 카카오 콘솔 전화번호 심사 제출 — 세션 427 (PR #130~#134, main 1fe22fe). 사장님 "카카오 본인인증 손님 DB 나중에 활용(연락·마케팅·분석)" → 5 PR + 콘솔 직접 조작. **PR#130 rate limit fail-open 차등**(100명 배포): Redis 순단 fail-close 전역=전 API 429 SPOF → `FAIL_CLOSE_ENDPOINTS=Set(login,subscribers)`만 fail-close(brute-force/공개쓰기), 나머지(verify/logout/kakao/consult/admin/proxy) fail-open(JWT·admin토큰·OAuth 2차방어선). verify 20→60(공유WiFi). CORS=상대경로 same-origin이라 무변경(적대검증 반박). production=정적JSON CDN이라 DB부하≈0. **PR#131 마케팅 동의+전화번호**(엔진 무변경): 신규/미선택 손님 로그인 직후 동의 모달 1회(거부가능·관리자제외)·`POST /api/auth/kakao-consent`(JWT→`users:consent_marketing` sadd/srem)·`kakao.ts` phone_number→user.phoneNumber(비즈앱 심사 전 null 후 자동채움)·`VITE_KAKAO_PHONE_SCOPE` 토글(기본OFF)·admin/users stats `marketing{consent,withPhone}`·StatsSection 카드. **적대검증 34 agent critical 1**=레거시 사용자(consentMarketing 필드없음 undefined) `=== null` false→모달 영영 안뜸→fix `!== true && !== false`+분기B 초기화+회귀테스트3. **PR#132 footer 연락처**(전화 010-9829-8888 tel:·이메일 kyh11kyh@gmail.com mailto:·주소 옛지번→등록증 도로명 계룡로38번길92). **PR#133 privacy.html**(개인정보 처리방침 정적페이지, Vercel 실제파일이 rewrite보다 우선). **PR#134 로그인 화면 수집 안내**(LoginPromptModal+InfoPage, 화면↔동의항목 일치=카카오 심사 기준). **카카오 콘솔 직접 조작(Playwright)**: 공식문서 직독(서브에이전트 2회 빈응답→신뢰0) developers.kakao.com/docs/ko/kakaologin/prerequisite=회원가입화면 수집항목=동의항목 일치 필수·심사 영업일3~5일. 미분양아파트앱(ID 1398824) 이미 비즈앱+비즈니스정보 심사승인 완료→추가기능신청→개인정보 동의항목→전화번호 선택동의→폼(회원가입링크·처리방침URL·fullpage 스크린샷·수집사유)→**신청 제출 완료=🔵심사중**(결과 영업일3~5일 후 사장님 카카오계정 이메일). 가이드=`docs/kakao-phone-consent-setup.md`. tsc0·vitest api395+src1823·eslint0·build0·CI/e2e/Vercel green. **잔여=👤 (1)전화번호 심사 승인 이메일 대기→승인 후 동의항목 전화번호 선택동의 켜기+`VITE_KAKAO_PHONE_SCOPE=true` env (2)production 동의모달·통계 라이브검증. 후속=동의철회 UI·연락처 활용(발송) 기능·카카오톡 채널 활용.**
- ✅ expertToken→authToken 명칭 정리 + 자동 이관 — 세션 426 (PR #129, main d0eed91). 세션 405 전문가 role 폐지 후 역사적 이름 정리. 세션 426 BACKLOG 전 항목(21개) 라이브 실측 결과 코드로 진행 가능한 작업이 이것 하나뿐(나머지 외부 API 막힘·데이터 부족·다른 레포 소관)이라 사장님 "감행" 결정. **손님 가치 0 (순수 내부 명칭, 화면·점수·동작 무변경)**. **명칭(표현계층/인증만, 점수·엔진·DB·백엔드 무변경)**: localStorage 키 `"expertToken"`→`"authToken"`·`useExpertMode`→`useAuth`(git mv 히스토리 보존)·`expertLoggedIn`/`setExpertLoggedIn`→`loggedIn`/`setLoggedIn`·`handleExpertLogin`/`handleExpertLogout`→`handleLogin`/`handleLogout`·`interface ExpertUser`→`AuthUser`·App.tsx `const expert`→`auth`. **자동 이관(로그아웃 0)**: `src/lib/authToken.ts` 신규 `getAuthToken()`/`clearAuthTokens()` — authToken 우선, 없으면 구 expertToken(localStorage→sessionStorage) 1회 이관+옛키 청소+userRole 동반. 부트스트랩 3곳(App 초기 tab·useAuth·useAdminMode 초기 state)에서 호출=첫 마운트 1회 이관, 멱등. **보존(rename 아님)**: `userTypes.expert`(백엔드 통계 응답 필드 StatsSection/types/admin, L52 주석 "PR-3 범위 밖")·`role "expert"`(DB 잔존 role 값 손님 취급 로직)·주석 "구 Expert…" 역사 기록. **안전 근거=백엔드 무관 실측**(`grep -rn expertToken api/`=0건, 서버는 토큰 값만 Bearer 수신 → localStorage 키 이름은 순수 클라 관심사). **회귀 가드**: 자동 이관 테스트 신규(useAuth 1 localStorage 옛키→authToken+로그인 유지 / useAdminMode 2 localStorage·sessionStorage 옛키 이관), 로그아웃 청소는 authToken+옛키 둘 다 검증. **누락 정정**: useAppNavigation.test.js의 mock 인자 키(`expert`→`auth`)를 plan 호출처 목록에서 빠뜨려 typecheck는 통과(.js 약타입)했으나 잔재 grep+vitest가 잡음 → 갱신. 변경 18파일(소스9+테스트6+CLAUDE.md1+lib신규1+rename2). tsc0·vitest src **1810**(jsdom 114파일, +2 이관)·eslint0(기존 warning2 무관)·vite build0·잔재 grep0(코드명칭·키·변수 전부)·CI/e2e/Vercel green. **잔여=👤 production 카카오/관리자 로그인 유지 라이브 확인(자동 이관 실증)**(단위 테스트가 회귀 가드). 자동 이관 코드는 충분한 시간 후 제거 가능(본 PR 유지).
- ✅ consults 열람 페이지네이션 — 세션 425 (PR #128, main 852be71). 세션 405 🟢 보류 항목 해소. 사장님 "consults 페이지네이션(A)" 선택 → 방식 설명 요청 → 1번(더보기) 확정. **문제**: GET /api/consults `.limit(100)` 고정 → 상담 101건째부터 관리자 **silent 잘림**(프론트가 count 안 받아 잘린 줄도 모름). consults **0행**(손님 미신청)이라 장기 안전장치. **해결(표현계층 전용·점수/정렬/엔진 무변경)**: API handleGet `.limit(100)`→limit/offset 쿼리+`.range(offset, offset+limit-1)`(admin/users.ts L77-80 클램프 답습 기본50/상한100)·`.order("id",desc)` tiebreaker(submitted_at 동일값 페이징 안정)·`count ?? 0` 폴백(supabase count=number|null, postgrest-js index.d.cts:613)·인증 분기는 파싱보다 앞=약화0. 프론트 AdminConsults `total:number|null`+loadingMore state+PAGE_SIZE50 명시전송·"더 보기" 버튼(PresaleResultList L77-87 답습 minHeight44/F.base/disabled, 표시조건 `total != null && consults.length < total`=null<숫자 함정 차단)·헤더 "총 N건 (M건 표시 중)"·append id dedup(offset+동시INSERT 행시프트 경계중복 방어)·mountedRef 가드(더보기 fetch 언마운트 후 setState 차단)·중복클릭 가드. 테스트 mock `.limit`→`.order().range()` 3곳교체(mockRange+mockOrder2 2단, beforeEach clearAllMocks가 returnValue 지우므로 재설정)+range인자/클램프/count null(+4), AdminConsults 대조군 `getByText("1건")`→`/총 1건/`+mock count 추가+더보기/null미표시/dedup(+3, fireEvent import). **적대검증 워크플로 20에이전트 4관점(waasbk16a)** 31findings→CONFIRMED9 전부반영, **거짓경보2 기각**(Vercel 단일프로젝트 원자배포라 "API 먼저 머지 회귀" 무효·PAGE_SIZE drift 현재 코드 없음). tsc0·vitest src **3502**(+6)·eslint0·build0·cross-validate5축PASS(빌드·null안전·Hook·보안=직독, 스코어링 N/A)·CI/e2e/Vercel green. **잔여=👤 production 카카오 로그인→관리자 대시보드 상담 목록 더보기 확인**(consults 0행이라 단위 테스트가 회귀 가드).
- ✅ "입주 빠른순" 정렬 추가 — 세션 424 (PR #127, main 47517a9). 세션 423 🟡 보류 항목 해소. 사장님 "BACKLOG 손님가치UX" → AskUserQuestion "입주 빠른순" 선택 → 세부 위임. **적대검증 워크플로 4에이전트(w4v016myo)가 1차설계(미래 입주예정 먼저)를 멘탈모델 충돌로 반증**: "입주 빠른순"인데 미분양 핵심(준공 후 미분양=즉시입주)이 미래단지 전부 뒤로(과거856 중 미입주760=89%)→라벨↔동작 반대. **사장님 재결정 "지금 들어갈 집 먼저"**=rank0 준공완료(`completion<NOW_YM`, 최근순)/1 예정(`>=NOW`, 가까운순)/2 미정·null(맨뒤). comparator `/^\d{6}$/.test`로 "미정"(한글)·빈·null 모두 rank2 일관(`??""`만으론 미정이 `>=NOW` true라 미래오염=M2). NOW_YM classify.ts `const`→`export const`(단일진실·순환0, useDataPipeline 재사용). **변경 9파일(+54-15) 표현계층만**(점수·AHP·필터·엔진·DB 무변경)=소스4(classify·types/hooks·useDataPipeline SORTERS·sortOptions entry `C.blue`)+카피2(GuideSections "8가지"→"10가지"+대단지순·입주순 설명=세션423 units 미반영 stale 동시정정·InfoPage.test 어서션)+테스트3(sortOptions.test 대조군3 9→10·useDataPipeline.test 신규·SortPanel JSDoc 숫자제거). 라이브실증 apartments.json 1424(null208+미정36)→미정/null244 전부맨뒤·throw0 / list TOP12 전부 202605(최근 준공완료)·rank경계 index1289. tsc0·vitest src1805(+2)·eslint0·build0·CI/e2e/Vercel green. **👤 production 머지·배포 완료**(미분양아파트.com 번들 moveInSoon 반영 확인) — 사장님 라이브 새로고침으로 드롭다운 "입주빠른순" 10번째 확인 잔여.
- ✅ 손님 가치 UX 2건 (치안우수 배지 + 대단지순 정렬) — 세션 423 (PR #126, main 1df34f0). 사장님 "BACKLOG 손님가치UX 작업가능한것" → 후보5 라이브실측(apartments.json 1424)+9에이전트 워크플로 평가+직독 → "둘다" 결정. **A 대단지순 정렬**: `useDataPipeline` SORTERS에 `units` 내림차순 1줄(동률 종합점수 tie-break, unsoldRate 패턴 답습)+`sortOptions` SORT_OPTIONS entry(`C.cyan`, SortPanel/SearchFilterBar 자동렌더=컴포넌트0)+SortKey union `"units"`+sortOptions.test 대조군함정 8→9 3곳(toHaveLength·expectedKeys·size). units 채움률 100%·변별력 우수(2000세대+ 48개). **B 치안우수 배지**: 치안1·2등급 361단지(25%) 초록 "치안우수"(현재 위험4·5만 빨강이라 안전강점 미표시)·alertRow조건 `<=2`추가(순수안전 15개 노출)·위험`>=4`와 상호배타(3등급 둘다미표시)·memo comparator 이미추적. **표현계층 전용**(점수·AHP·엔진 무변경). **적대검증반증**: 워크플로 "치안1·2등급 95.8%혐오시설 동시보유→모순"=오도, 전체단지 95.9%=거의동일(미분양 외곽多)→우려기각. tsc0·vitest src 1803(+6)·eslint0·build0·cross-validate5축PASS·CI/e2e/Vercel green. **👤 production 라이브검증 완료**: 정렬 드롭다운 "대단지순" 9번째 등재 + `?sort=units` 클릭 시 올림픽파크포레온(12032세대) 1위=로컬실측 일치 / 치안우수 배지 1·2·5·6위 초록 노출(Playwright 실측). 폐기/보류 3건은 아래 🟢/🟡 절 정정.
- ✅ 소비자 목록 단지명·지역 검색창 — 세션 419 (PR #121, main c688a5b). 세션405 전문가폐지 때 소실된 이름검색 복원. **사장님 "지저분하지 않게"=줄추가0**: 필터바 1행 "검색" FilterButton→기존 지역/금액과 동일하게 펼쳐지는 input(FilterDropdown 재활용). 신규 `searchMatch.ts`[normalizeQuery 전각공백U+3000제거+소문자화·matchesQuery name/region/gu `?? ""`폴백]. useDataPipeline useDeferredValue(searchQuery)→filtered매칭, activeFilterCount에 trim. useFilterSort resetFilters에 setSearchQuery("") 1줄=handleResetAll/applyPreset/applyHistory 3경로커버. **검색어 URL/undo/preset 미참여**[일시적탐색]. filtered만좁힘→지도/홈미니지도도 같은결과[사장님결정]. AptListSection 검색0건 "'X'에맞는단지없음"+해제버튼. 활성판정=trim/표시=raw. **적대검증2회54건**[filtered누수의도확정·전각공백·빈결과노출·"L45테스트깨짐"환각폐기]. 코드리뷰 SAFE_TO_MERGE 블로커0. tsc0·vitest3474·eslint0·build✓·CI/e2e green. **잔여=👤 라이브검증[카카오로그인→"래미안"검색]**
- ✅ 수집기 시각축 KST 통일 — recorded_at 하루밀림 정정 — 세션 419 (PR #122, main 8c0939f). 사장님이 luxury_resale(SQLite+Python) timezone프롬프트를 mibunyang(React+Supabase+Actions)에 변형지시. **점검(적대검증4축52건)=대부분이미안전**[DB컬럼전부TIMESTAMPTZ·D-day setHours정규화·scorePrice/dday음수가드·토큰epoch]. SQLite CURRENT_TIMESTAMP·Python datetime.now() 혼재함정 우리엔없음. **진짜결함=recorded_at UTC저장**[`new Date().toISOString().slice(0,10)`→KST02:00~08:00발화가UTC로전날→하루밀림]. 정정=`_shared.mjs today()`=`Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Seoul"})`환경무관KST고정, recorded_at4곳[unsold-kosis·air-quality·applyhome·naver-presale386]→today(), presale_fetched_at(datetime)은timestamptz라유지, monitor음수가드5곳Math.max(0,...). **TZ env 31개 폐기**[적대검증 정면반박: cron발화안바꿈(runtime만)·today()Intl이본질해결·getMonth()월경계시프트잠복위험·CI환경의존숨김]→사장님재결정 코드만KST. cron정정[2026-03부터 `timezone:`파라미터로KST발화가능, 안씀]. 로컬러너(집PC KST)무변경·과거소급안함. tsc:scripts0·vitest수집기1107·환경무관실증(TZ=UTC여도today()=KST)·코드리뷰SAFE 블로커0. **진짜active버그는air-quality1개**[cron `0 15 * * 1`=KST화00:00경계적중], 나머지3개는방어적하드닝
- ✅ 지도 지역/시군구 클로즈업 + 마커 클릭 바로 상세 + 전체화면 — 세션 417 (PR #119. 사장님 production 스크린샷 3건: `?region=대전`골라도 전국그대로[클로즈업안됨]·말풍선클릭해도 카드만뜨고 안들어감[2단계]·전체화면 요청. **진짜원인=MapView가 filterRegion/Gu안받음[filtered만, App.tsx:358]+didFitRef가드[세션413빈화면방지]첫fit후영구생략. 데이터·필터·UI완비[RegionPanel시도+구군2단계·lat/lng100%·useDataPipeline gu정확매칭]=빠진고리는fit하나뿐**. **①클로즈업**: synth권고=별도effect보다 마커effect내 didFitRef옆`else if`분기[markers재채움직후 stale0+순서보장]. `deferredRegion`/`deferredGu` prop[원시filterRegion/Gu아닌deferred=stale회피, useDataPipeline이미 useDeferredValue보유 return1줄]. `prevRegionRef`/`prevGuRef`[useRef=현재값초기화]"직전과다를때만"fit→정렬/예산변경엔발화0[수동위치보존]+마운트직후이중fit방지. didFitRef·마커effect deps무변경. `setBounds(b,40,24,40,24)`padding+과도줌클램프 시도`REGION_FIT_MIN_LEVEL=8`/구`GU_FIT_MIN_LEVEL=4`[클러스터경계CLUSTER_OPTS.minLevel5보다아래=단일단지구 개별마커풀림, 적대검증5→4]. "전체"되돌림은fit안함. **②마커클릭1단계화**: click=`setSelected`강조+`onDetailRef.current`상세 둘다. `onDetailRef`미러[useRef+useEffect, onSelectRef답습]=마커effect deps오염0. 비로그인→handleDetailGated로그인모달[정책유지]. SelectedAptCard상세버튼중복이나무해유지. **③전체화면**: 지도탭div `width:100vw+marginLeft:calc(-50vw+50%)`[root maxWidth1200돌파 풀블리드]. MapView `fullscreen`prop→border:none+borderRadius0. 높이calc불변[필터바가지도위에그대로=잘림방지 폭전체화면, 세로는PR2]. **가로스크롤바fix[적대검증major]=index.html전역 `html,body overflow-x:hidden;margin:0`**[100vw가세로스크롤바폭15~17px포함→세로스크롤있으면 가로스크롤생김]. **적대검증2라운드7축 major1[100vw가로스크롤바]fix+minor반영[구클램프5→4·mutation갭음성케이스3]**, minor보류=데스크톱헤더1200px와 전체폭지도정렬불일치[의도된트레이드오프, 헤더root공유라안건드림]·세로전체화면한계·상세버튼중복무해. 회귀=tsc0·vitest**3449**[MapView29→40: region-fit8+마커클릭onDetail1+fullscreen2]·eslint0err·build✓·CI/e2e green. 커밋198ac14[클로즈업]+a4481bc[클릭+전체화면]+7a43bff[docs]. **수정파일**: useDataPipeline.ts·types/hooks.ts[deferred노출]·MapView.types.ts[deferredRegion/Gu/fullscreen prop]·MapView.tsx·App.tsx·MapView.test.jsx·index.html. **잔여=👤사장님 production수동검증4**[www.미분양아파트.com 카카오로그인→지도탭: 대전/유성구클로즈업·마커클릭바로상세·전체화면가로스크롤바없음·데스크톱헤더정렬어색한지]. **PR2[별세션]=필터칩추가시 지도하단잘림 근본해소[calc→flex]+세로전체화면[필터바오버레이=BottomNav fixed·100dvh iOS·SelectedAptCard위치 재검증 위험])
- ✅ 지도 마커 호갱노노급 디자인 + 선택 마커 강조 (PR2) — 세션 416 (PR #117, main fd19fb0. 세션414 통합홈 production ON 후 사장님 진단 "마커+인터랙션 같이 구려" → 카카오 SDK 유지. **마커 디자인(안 A 점수 주인공)**: `buildMarkerSvg`·`shortPrice`·`MARKER_*` 상수를 **`markerSvg.ts`(순수 모듈, import.meta.env 0)** 분리[node/미리보기 직접 import = drift 0], kakaoMapHelpers엔 KAKAO_KEY·SDK·getKakaoMaps만, MapView import 1줄. 가격배지=둥근 말풍선 rx10+흰 테두리+도형 그림자 rgba(0,0,0,0.22)+점수 13px·가격 9px[기존 관행]. 무가격핀=물방울+테두리+타원 그림자. 좌표 불변식 node 실측[꼬리 끝점(w/2,h)=offset.y·그림자 하단 ≤ H·본체 x=1 width=W-2 stroke 안 잘림]. 클러스터 흰 테두리+boxShadow. **선택 마커 강조(인터랙션)**: `markerByIdRef`(apt.id→marker) 마커 effect 매 run 재채움[stale 차단]+강조 effect deps=[selected]만[전체 재생성 회피, ref 격리 세션406]+`__normalImage` 보관[복원]+setImage 강조[1.15배·테두리2.5·zIndex50]+**clusterer.redraw()**[복원/강조 실제 시만]. 강조색=색 변형 X[gr엔 .c/.bg 2색뿐]=크기·테두리·zIndex. 전국뷰(레벨≥5)=클러스터 묶임이라 강조는 줌인 시 보임. **적대검증 2라운드(13프로브) major 7 정정**: variant 코드상수 토글=TS2367[let도, 머지불가]→코드엔 한 안만·미리보기 비교 / "SVG filter img/dataURI 불안정"=거짓[MDN]→도형 그림자는 단순/성능 / 클러스터러 setImage=redraw 필수[공식문서] / mock Marker setImage 부재 시 기존 테스트 동반 붕괴→setupKakao mock 갱신 / 미리보기 복제=drift→markerSvg.ts 분리. 미리보기=`scripts/probes/gen-marker-preview.mjs`[node24 native TS strip로 markerSvg.ts 직접 import]→`tmp/_tmp_marker-preview.html`[둘 다 gitignore] 안 A vs 안 B(가격 주인공) 나란히. tsc0·vitest 3438[markerSvg.test 9+선택강조 회귀 3 신규]·eslint0err·build✓·CI/e2e green. **디자인 안 A 머지 근거**: 미분양 AHP 점수화 엔진=점수가 차별점[호갱노노는 가격 서비스]·프로필마다 점수 다른 게 핵심·가격은 카드/상세에 이미 큼·markerSvg.ts 분리로 안 B 교체 1함수+미리보기. **카카오 로그인 진앙 발견(마커 무관)**: KOE006 "등록 안 된 redirect URI"=정식 도메인 **`미분양아파트.com`**[xn--hg3bi2ac4o1ig57cnoa.com, KAKAO_REDIRECT_URI 실측]만 카카오 콘솔 등록 → `mibunyang-peach.vercel.app`는 미등록=로그인 불가. **카카오 OAuth 라이브 검증은 `www.미분양아파트.com`에서만**[peach는 비로그인 검증만]. **잔여=👤 사장님 production 수동검증**: `www.미분양아파트.com` 카카오 로그인→지도 탭→새 마커+줌인 후 클릭 강조. 안 B 더 원하면 미리보기 비교 후 후속 커밋)
- ✅ 통합 홈 위젯 개선 (위젯 3건) — 세션 415 (PR #116, main 7607892. 세션414 통합홈 production ON 후 사장님 라이브 관찰 → ① **미분양많은순 정렬 신규**[정렬 7→8, SortKey타입+SORT_OPTIONS+SORTERS 3곳 동기화, null→-1 동률 종합점수 tie-break, GuideSections "8가지" — 미분양 전문 서비스인데 정작 미분양 정렬 부재였던 빈틈 해소] ② **시장요약 칸별 맞춤 클릭 동선**[MarketSummaryWidget onCellNav? prop, nav 칸만 button(터치44·aria-label) 데이터기준 div정적, App onMarketNav=setSortKey+handleNavClick, home_market_nav 계측. 전국단지/분양가→목록, 미분양률→목록+미분양순] ③ **곧분양 빈상태 정리**[완전빈(이번주0+임박0) 2줄겹침 제거→단일안내, 부분빈 "임박한 청약은 없어요"]. 추천 카드 밀도 = 풀카드 유지(간략행 2안 라이브 비교 후 폐기). 테스트 대조군 갱신[sortOptions 7→8·"정렬(7가지)"→"(8가지)" 3곳]. tsc0·vitest 3,427·eslint0·CI/e2e green. 라이브 검증(production browser_click) = 미분양률중위칸→URL?sort=unsoldRate+목록 미분양률 내림차순(7100%→5300%→4400% 실측)+드롭다운 "미분양순" 8번째 등재. **다음 = PR2 지도 마커·인터랙션[카카오 유지, buildMarkerSvg 단색배지·그림자없음 → 호갱노노급]**)
- ✅ 상세 모달 IA 개편 D2b 종합 요약 대시보드 + 관리자 탭 분리 — 세션 409 (종합 탭에 CategoryMiniCard 6개[점수+등급+결론 1줄+탭하면 점수 탭 해당 카테고리 자동 펼침]로 **6각형 레이더 대체**[구현물 적대검증이 레이더+미니카드 이중 노출 +234px = "길고 루즈" 지시 역행 적발 → 미니카드가 시각화+진입 흡수, 단일 출처] + 관리자 인사이트 3종[AdminScoreBreakdown·AdminUnitSupply·AdminDataAudit]을 점수·분양 탭에서 별도 "관리자" 탭[sec-admin]으로 분리[adminLoggedIn 시만, sections useMemo 7탭]. 신규 2파일[catVerdict.ts 결론 문구 단일출처·CategoryMiniCard.tsx] + CatPanel defaultExpanded prop. 사장님 위임 결정 3건 = 카테고리별 맞춤 문구[price 적정가 괴리 실측]·자동 펼침·레이더 유지+미니카드. 적대검증 2라운드 8축 major 5+1 정정[★중점 텍스트→"중점"칩(테스트 카운트 보존)·단일슬롯 key 회귀→카테고리별 seq 맵(형제 펼침 보존)·deviation "0.0" 데이터부재→fairPrice>0 판별·임계 70/50 gr 경계 정합·sections 단일출처·SHORT_LABEL label키·benefit noData]. 인쇄 동선 보존[sec-admin data-tab-panel + adminLoggedIn 즉시 마운트]. tsc 0·lint 0·vitest catVerdict 27+miniCard 10+CatPanel 14+DetailModal 40. 별건 발굴 = AptCard L109·GuideSections L105 deviation 역부호 불일치 박제[아래 🟡])
- ✅ 상세 모달 IA 개편 D2a 데이터 재배분 — 세션 408 (구 DataSections 8섹션[단일 토글] 해체 → 주제별 탭 분산: 단지기본→종합·생활인프라/교통/치안환경→입지[빈약 해소]·시장지표/네이버교차/층별가→시세·청약경쟁/분양정보/모집공고→분양. 점수 탭=CatPanel 순수 점수+관리자 검수(AdminDataAudit 138필드). 신규 3파일[dataSections.ts 4그룹상수·DataSectionBlock.tsx 섹션별 접힘+자체박스+부가블록3·AdminDataAudit.tsx]. 사장님 결정 = 섹션별 접기[더보기] 유지[토글 제거 시 입지 탭 가장 김=루즈 재발]. 적대검증 2라운드 15 probe major 6 정정[토글제거 폐기·종합탭 중복 4필드 unsoldRate/completion/dong/roadAddress 제거(핵심지표 중복)·admin fullFields 게이트 이식·컨테이너 박스 일관·부가블록 footer 종합1회]. 정보 소실 0[귀속 맵 전수]. tsc 0·lint 0·vitest 3,336·e2e 6+1skip. 다음 = D2b 종합 요약 대시보드[미니카드]+관리자 탭 분리)
- ✅ 상세 모달 IA 개편 D1 + CTA sticky — 세션 407 (PR #106 점프 앵커→콘텐츠 교체 탭[activeTab+visited keepMounted — 금융 useRef 캐시 훅 refetch·presale_view 중복·펼침 소실 차단, 관리자 전 패널 마운트=인쇄 보존 print media 실증, jsdom scrollTo undefined→setActiveTab 가드 밖] → PR #107 CTA sticky bottom[길면 반투명 92%+blur 겹침·짧으면 제자리 — 분기 없이 자동, 포커스 트랩 불변식 유지]. 적대검증 2라운드 9 probe — "App 상시 마운트" 할루시네이션·visited 시딩 누락·PriceTable null e2e 함정 적발 후 구현. D2 순서 확정 = D2a 데이터 재배분 먼저[사장님 위임 결정 — 입지 탭 빈약 실측]. vitest 3,331·e2e 6+1skip)
- ✅ 통합 홈 M2 미니지도 + 곧분양 호갱노노 패턴 4종 — 세션 406 (PR #104 MapView prop 3종[height/compact/onSelect — ref 격리]·MapEntryWidget 280px 임베드·spec v4 추록[관리자 위젯 안 살림] → PR #105 RegionChipBar 지역칩+★관심지역·PresaleResultList 분양결과[잔여세대 경쟁률 — "1순위" 표기 금지, 적대검증 적발]·UpcomingPage result 탭·카드 강조줄. 적대검증 2회 14 probe major 6 정정. vitest 3,325·e2e 8/8)
- ✅ 전문가 역할 완전 폐지 3-PR — 세션 405 (PR #101 이식[상세 모달 관리자 인사이트: AdminScoreBreakdown·DataSections adminMode 138필드·AdminUnitSupply 청약홈 평형 표·인쇄] → #102 철거[expert/ 18파일 -2,600줄, AdminLoginForm·AdminConsults·InfoPage 카카오 카드+관리자 링크, 네비 축 adminLoggedIn — 카카오 손님 전문가 네비 오노출 quirk 해소, "회원 관리" 개명] → #103 백엔드[signup 폐지·login 비admin generic 401·isAdminEmail 단일 출처·refresh expert→user 강등·consults admin 단독·create-admin-user.mjs 잠금 방지]. 자료 소실 0 — 귀속 맵 = `docs/superpowers/specs/2026-06-12-expert-role-abolition-decision.md`. spec v3 추록 = M2 재산정)
- ✅ energy_grade 오염 정정 — kaptdEcnt(승강기대수) 에너지등급 오인 + 죽은 코드 제거 — 세션 358 (데이터 품질 점검 중 발견. `molit-building-info.mjs` 가 국토부 공동주택 상세 API 의 `kaptdEcnt`/`kaptdEcntp`[= 승강기 대수]를 에너지효율등급 1~7로 오인 → 우연히 1~7대 단지 358건 오저장 + 화면 "N등급" 거짓 표시. raw API 실측[값 0/5/8/21=등급 불가] + 적대검증 워크플로[7필드 전수 raw 검증 → 오인 3건/정상 4건]로 확정. 정정: 수집기 energy_grade + 건폐율/용적률[`kaptdBcRat`/`kaptdVlRat`=API 응답에 없는 죽은 코드, 실제는 네이버 `sync-naver-complex` 가 채움] 추출 제거 + DB 358건 NULL[`cleanup-energy-grade.mjs`] + `data-audit.mjs` PERMANENT_NULL 에 energyGrade 추가[worst-fields 오탐 제거]. 3관점 적대 리뷰 = 회귀 0/blocker 0/high 2 confirmed[PERMANENT_NULL·cleanup 커밋]. vitest molit 22/22 + data-audit 17/17 + scoring 164/164 + tsc 0. building 78.6%→77.1%[오염 제거 정직 하락]. 상세 = DB_QUALITY.md 2026-06-01 절. **잔여**: 승강기 대수 신규 수집은 활용처 불분명[스코어링·화면·DB 컬럼 0]이라 비권장.)
- ✅ `sync-naver-complex` articles/price 1000건 cap + 4회 fetch 통합 — 세션 356 (`.range(0,99999)` cap 4곳[area/trade_type/**complex_price_history**/floor] → `fetchAllPages` 전건 페이지네이션. 461,751행 중 0.2%만 읽던 데이터 정확성 사고. 추가로 같은 articles 전건을 4번 fetch 하던 비효율 → 8컬럼 1회 통합 fetch[allArticles, matchCache 직후] 로 4 Phase 공유. timeout 30→60. dry-run 실증 before 1000→after 461,466건/시세 25,941단지. vitest 46/46 + tsc 0 + 메모리 적대검증 34배 헤드룸. 박제값 정정 = 세션 355 "Phase4 cap/시세 누락" 오류. 상세 = 🔴 즉시 절)
- ✅ vitest 4 `environmentMatchGlobs` → `projects` 마이그레이션 — 세션 348 (vitest 4.1.6 dist 에 `environmentMatchGlobs` 0건 실측 = 완전 제거 → 지금까지 api/scripts 테스트가 **node 아닌 jsdom 에서 돌고 있었음**(브라우저 API 미사용이라 무사고). `// @ts-expect-error` 제거 + `test.projects` inline 2개(jsdom=src / node=api+scripts) + 공통 옵션 루트 유지 + 각 `extends: true`. 회귀 0 실측 = 전후 **672 파일 / 3146 케이스 / 100% / src 1563·api 387·scripts 1196 완전 동일** + typecheck 0 + `vitest list --project` 분기 확인. 워크플로 2관점 조사(공식 문서 + 함정) + 직접 실측 교차 검증. 상세 = [BACKLOG_ARCHIVE.md](BACKLOG_ARCHIVE.md))
- ✅ 5/29 자연 cron cancelled 모니터링 종결 + 진앙 정정 — 세션 347 (부팅 점검 실측: incremental 자연 cron 5/26·27·28 cancelled → **5/29 success(74분, all step success, 순수 자연 cron)** = 세션 338 PR #51 효과 확인. **진앙 정정** = 5/28 cancelled 는 BACKLOG 가 적은 "transport 105초 외부 cancel / 인프라 부하 가설"이 아니라, raw `gh api jobs` 실측 결과 **세션 342 검증용 manual dispatch(19:25~21:57, 2h31m)가 같은 concurrency 그룹(`naver-postprocess-incremental`, `cancel-in-progress:false`) 점유 → 자연 schedule run 44분 큐 대기 후 manual 종료 2초 뒤 cancel**. 답습 = 검증용 수동 실행은 자연 cron 시각(20:30 UTC)과 겹치지 않게. 부팅 1차 진단 "좀비 run" 은 `currentDate` 메타값 단정 환각(`date -u` 실측 의무). 상세 = [BACKLOG_ARCHIVE.md](BACKLOG_ARCHIVE.md))
- ✅ audit-env-keys collector→yml 역방향 매칭 재구성 — 세션 346 (P2 였던 "step 단위 보강" 진입 시 자가 점검 1 발동 결과 **더 근본적 사각지대 9건 실측 발견**: `findWorkflowForCollector` 1:1 매칭이 yml명≠collector명(transport-tago↔collect-transport 등) collector 9개를 **검증조차 안 하고 clean 오집계** = 세션 328 사고 진짜 근본 원인. `extractStepCollectorEnv()` 신규로 모든 yml step 의 collector 호출 역방향 수집 + multi-collector/1:N/env 상속 처리 + validate `${{ secrets.X }}` B형 정규식 통일. errorCount 0 유지(9개 전부 실측 누락 0) + 세션328/이름불일치 재현 시뮬 EXIT 1 검출 확인 + vitest 10/10. 상세 = [BACKLOG_ARCHIVE.md](BACKLOG_ARCHIVE.md))
- ✅ graceful shutdown 15 collector 일괄 보강 — 세션 329 PR-A + 330 PR-B + 337 PR-C 누적 머지로 완전 완료 (세션 341 실측 답습 결과 = `_graceful-coverage.test.mjs` 53/53 PASS 회귀 가드 박힘. BACKLOG L92 박제값 stale 환각 정정. 잔여 = `collect-maintenance` + `trade-stats-regions` 만 ALLOWLIST 박힘 별 진단 후보)
- ✅ monitor-collectors §5 schools stale_days 35→14 정정 (세션 339, NEIS 일일 발화 기준 + 세션 338 3주 사고 35일 한계 안에 묻혀 alert 0회 발화한 진앙 해소; `external-api-outage-policy.md` 동시 동기 + `collector-timeout-rootcause-analysis.md` 세션 338 절 신규)
- ✅ schools-neis 3주 cancelled root fix — 데이터 완결성 resume skip (`buildEnrichedIds` 헬퍼 export) + timeout 180→240 + 단위 테스트 6건 (세션 338, PR #51 머지 main `b76f6a9`; 5/22+5/26+5/27 3주 연속 cancelled 진앙 = NEIS 단지당 5.8초 12배 지연 + resume skip 패턴 부재. Plan v1+v2 환각 10건 검출 = 서브에이전트 3개 + DB 실측 교차 검증 패턴 답습 자산)
- ✅ Node 20/22 → 24 일괄 통일 — 47 workflow yml + `.nvmrc` (24.14.1) + `engines.node` (>=24.0.0) (세션 312 확인, 커밋 `3cc54d6` 2026-05-10 머지; GitHub Actions Node 20 deprecation 대응 완료, 메모만 stale 박힌 박제값을 본 PR 로 정정)
- ✅ trade-stats DSR batch fix — 직렬 for-loop 1960 row × 150ms = 4분 54초 → `createSemaphore(10)` + `Promise.all` 30초 + workflow timeout 15→30 (세션 309; 박힘 환각 7건 정정 — "9주+ 같은 원인" → 5/24 만 DSR + 5/17/5/10 옛 cron 큐 충돌 5/18 정정 완료; spec `docs/superpowers/specs/2026-05-25-trade-stats-dsr-batch-fix-design.md`)
- ✅ fill-missing-data Phase 3+4+5 폐기 + audit-fill-matrix CI 가드 (세션 308, PR #11 머지 main `7b6fc72`, 커밋 `58f5983`; dry-run run 26378950237 success 17분 40초; 5/31 cron 발화 6번째 누적 cancelled 차단, -108줄)
- ✅ regions 표기 충돌 root fix — population.mjs parseGu(ctpvNm, sggNm) + SIDO_CODES 3건 정정 (세종/강원/전북) + 1행 응답 객체 처리 (세션285, 커밋 `78a862d`; 자치구 채워진 0→35/41, 신규 시도 3개)
- ✅ MarketStatsCharts 평평한 0 차트 정정 — KOSIS 시도 단위 한계 → API 시도 폴백 + UI null 가드 + 헤더 "(시도 평균)" 표시 (세션280, 커밋 `29a6f01`/`7423fc9`; 동반 커밋 `0557e1a` DetailModal `priceByArea` 빈 배열 가드)
- ✅ apartments.json 13MB → list 1.66MB + prices 11.35MB lazy 분리 + Vercel Brotli 적용 (list 198KB / prices 858KB) (세션279, 커밋 `6714fa7`/`b57de6b`/`7eb2a2e`; spec `docs/superpowers/specs/2026-05-20-apartments-json-split-design.md`)
- ✅ Supabase Advisor security_definer_view·function_search_path_mutable 4건 — VIEW 2개 security_invoker=on + 함수 2개 search_path='' (세션276, 마이그 `20260519130000_fix_security_definer.sql`)
- ✅ 일요일 data-collection 큐 경합 해소 — calc 2개 calc-collection 그룹 분리 + fill-missing-data cron 21→02시·Phase5 timeout 360→120 + monitor 목록 3개 보강 (세션273, 커밋 `68c5051`)
- ✅ 테스트 미커버 hooks 5개 — useKeyboardShortcuts·useFinlifeRates·useKakaoCallbackEffect·useCollectorMonitoring·useAppNavigation 45 테스트 추가, 커버리지 23→28/28 (세션273, 커밋 `581ad1c`)
- ✅ lint react-hooks 경고 12건 해소 — ref useEffect 이동 + set-state-in-effect 룰 off (세션273, 커밋 `07fff78`)
- ✅ Kakao SDK `(window as any)` 9건 → kakaoMapHelpers getKakaoMaps 일원화 (세션273, 커밋 `c7c60b4`)
- ✅ collect-trade-stats.yml cron 일요일 21시 concurrency 충돌 fix (세션272, 커밋 `608ca5c`; `0 21 * * 0`→`0 16 * * 0`)
- ✅ SearchFilterBar `as any` 7건 제거 — PresetPanel 공유 타입 정합 (세션272, 커밋 `5b9fa44`)
- ✅ #4 컬럼별 NULL 비율 모니터 — data-audit 19 카테고리 (세션263, 커밋 `bfa3582`~`13c3ee2`; 세션264 키 drift 가드 `5a130af`/`bc5263f`)
- ✅ collect-migration.yml KOSIS_MIGRATION_KEY 3-way 동기화 fix (세션232, 커밋 `1bbf9b4`)
- ✅ package-lock.json @emnapi peer deps 누락 fix (세션180, 커밋 `cf2e5a5`)
- ✅ 미션 1 공개 API 보안 — rateLimit proxy + dompurify (세션119)
- ✅ KOSIS Phase 2-A tblId DT_1YL202001E → DT_MLTM_2082 fix (세션222, 커밋 `4c0ffc9`)
- ✅ Naver Post-Processing 90분 한계 해결 — D-2 split (세션229, 커밋 `c045594`)
- ❌ MOLIT_KEY 401 — 환각 정정, 운영 영향 0 (로컬 .env 만 영향)
- ❌ collect-market-stats KOSIS — 환각 정정, KOSIS 측 갱신 지연만 잔존
- ❌ api_quota 5일 침묵 — False Alarm 확정 (cron 무발화 정상 패턴)
- ❌ collect-applyhome recordApiQuota — 환각 정정, 커밋 `816664b` 이미 적용
- ✅ 5% 경고 임계값 경험치 측정 — 보수적 적절 (세션169)
- ✅ @vercel/kv 3 제거 + @upstash/redis 단독 (세션130, 커밋 `4a90768`)
- ✅ @vercel/analytics 2 메이저 업그레이드 (세션119, 커밋 `22434c2`)
- ✅ Node 환경 핀 engines + .nvmrc (세션125, 커밋 `6520ec9`)
- ✅ @supabase/supabase-js 2.98→2.103 (세션119, 커밋 `73b3295`)
- ✅ admin/review.js 이메일 RFC 5322 정규식 → isValidEmail() (세션119)
- ✅ App.jsx 442→354줄 4훅 분리 (세션120)
- ✅ api/supabase/apartments.js sanitize() 7헬퍼 분리 (세션119)
- ✅ React.memo comparator 일괄 점검 — AptCard 6필드 + 4파일 안전 확인 (세션159~170, 커밋 `d74b295`)
- ✅ E2E Playwright webkit 미설치 인프라 이슈 (세션162, PR #4 `927193e`)
- ✅ LoanRatesSection 금리 탭 Skeleton (세션122)
- ✅ AdminDashboard 로딩 UI (세션122)
- ✅ 저장 액션 토스트 피드백 4지점 (세션121)
- ✅ AdminDashboard 412줄 3분할 (세션138)
- ✅ InfoPage.jsx 267→60줄 4분할 (세션140)
- ✅ src/scoring/ JSDoc 7파일 12식별자 (세션122~124)
- ✅ prices.js ↔ unsold-history.js → createTimeseriesHandler 팩토리 (세션121)
- ✅ collect-building-hub.mjs HpPermitService 미구독 확정 (세션139)
- ✅ W6-D 어린이집 cpmsapi021 → regions.childcare JSONB (세션252)
- ✅ cpmsapi021 50건 한도 해소 — 개발계정 키 제약 확인 + 운영키 교체 후 재수집 (세션275, 커밋 `ea77f25`; count>50 0→368, 강남구 50→163)
- ✅ W6-D2 cpmsapi030 70필드 단지 매칭 — schools.nearby_childcare (세션252~258)
- ✅ KOSIS #4 (新)주택보급률 시도 → regions.housing_supply_level (세션259, 커밋 `8f7db36`)
- ❌ KOSIS #3 준공후 미분양 — 종결 (시군구 단위 unmatched 확정, 세션249)
- ✅ recordCollectorRun 미호출 8개 수집기 보강 (2026-05-17, 커밋 `10965d4`+`7ba94f3`)
- ✅ recordApiQuota dry-run 가드 + sbOverride 인자 (테스트 불가 해소) (세션268, 커밋 `787e036`+`a99c528`)
- ✅ KOSIS #1 매매가격지수 시군구 → market_stats_history.sale_price_index (세션269, 커밋 `2ccf094`~`694c533`; 117시군구×4분기 468행 적재)
- ✅ KOSIS #2 전세가격지수 시군구 → market_stats_history.jeonse_price_index (세션270; DT_30404_B013 동향조사, 154시군구×23개월 3565행 적재)
- ✅ KOSIS #5 합계출산율 시군구 → regions.fertility_rate (세션266, 커밋 `6524eea`; DT_1B81A17)
- ✅ KOSIS #11·#12 의료 의사/병상수 시군구 → regions.doctors_per_1k/hospital_beds_per_1k (세션267, 커밋 `9d625d5`; DT_1YL20981/DT_1YL20971 묶음 collect-medical-access.mjs)
- ✅ KOSIS Phase 3 시도 경제·교육 4지표 → regions 4컬럼 (세션271, 커밋 `6eba41b`; #6 GRDP INH_1C96_02 / #9 사교육비 DT_1PE105 / #10 사교육참여율 DT_1PE107 / #13 실업률 DT_1DA7104S 묶음 collect-regional-economy.mjs)
- ⏸️ onClick inline 클로저 → useCallback — 부분 처리 후 보류 (세션121 `1ed7db3`, 세션264 archive ⏸️절)
- ⏸️ inline style 호이스팅 — 부분 처리 후 보류 (세션149~152, 세션264 archive ⏸️절)
- ✅ SESSION_LOG.md drift 282~286 + 288 6 세션 흡수 — 메모리 3 파일 + git commit message + BACKLOG 본문에서 추출 (세션289, 1 docs 커밋)
- ✅ transport-tago 2.1배 느림 root cause 분석 종결 — 코드/API 결함 0 + 세션 294 timeout 90→120 fix 가 정답 (세션 295, docs only; 진앙=커밋 `01d0dd4` PostgREST max_rows fix, 단지 1000→2001 의도된 자리)
- ✅ audit-env-keys matrix orchestrator 답습 보강 (세션 304+308, 커밋 `96fbdcc`+`58f5983`; MATRIX_ORCHESTRATORS 상수 + extractMatrixJobs() + js-yaml FAILSAFE_SCHEMA; vitest 4 test; fill-missing-data.yml Phase 3+4+5 폐기로 phase2-calc 3 job 만 잔존)
- ✅ dataUpdatedAt vs fetchedAt drift fix (세션 280/281/292, 커밋 `89831d7`+`a4c6d8d`; collect-data.mjs L1026 양쪽 키 동시 박제 + staticDataApi.ts L46-47 fallback 듀얼 방어; staticDataApi.test.js 회귀 가드 4건)
- ✅ ARCHITECTURE.md/CLAUDE.md/README.md 박제값 일괄 정정 (세션 313; apartments 1500→2001 / App.jsx→App.tsx 다중 / memo 36→45 / api 21→23 / workflows 35→47 / Vercel KV→Upstash Redis / collect-data 1065→1193줄 / src/lib/*Api 5건 stale 정정)
- ✅ 4 collector --json wrapper fix + split 자동 호출 (세션 314; environment/industry-match/transit-match/noxious 4 collector readFileSync wrapper 파싱 + writeFileSync `{...rawWrapper, data, count}` 보존 + spawnSync split-apartments-json 자동 호출. 진앙 = `apartments.json` nested `{ok, data, fetchedAt, dataUpdatedAt}` 구조를 flat array 로 단정한 4 collector 작성 시점 사고 → `.length` undefined + wrapper 손실 + split 0건 사고. 신규 테스트 2파일 7건 (environment.test.mjs 3 + split-apartments-json.test.mjs 4). 운영 cron 미사용 = 로컬 사고만 차단. 답습 자산 = `prebuild.mjs` L2/L11 spawnSync 패턴)
- ✅ KOSIS #14 범죄율 시도 collector 가설 환각 정정 (세션 315 docs only; regions.crime_grade 758행 중 701행 (92%) 이미 채워짐 = 시도 76 + 시군구 625. CSV 기반 `collect-crime-safety.mjs` 가 시도+시군구 모두 매칭. KOSIS DT_13501N_A120 신규 collector = 불필요. NULL 57행 진짜 잔여 = CSV 갱신 (연1회 수동) 또는 행정구역 개편 분구 18행 보강 별 자리. 자가 점검 1 + 서브에이전트 #3 보고로 박힘 정정)
- ✅ collector_runs 모니터링 사각지대 — 6 collector silent fail 종결 (세션 319 진단 + 세션 320 정정 + 세션 321 진앙 확정, PR #25 + #26 + #27; 진앙 = **workflow yml timeout 부족** 확정. 가설 K (race condition) 부정. 실증 = molit-building run 26451400957 정확히 30분 cancelled + maintenance run 26450043464 정확히 1h0m15s cancelled. raw log = 단지 처리 중간 끊김 → recordCollectorRun 도달 못함. 정정 5건: molit-building 30→90 / emergency 30→60 / kosis-unsold 15→30 / housing-permits 15→30 / maintenance 60→120. 다음 cron 자동 검증 6/1~6/15 박힘 의무)
- ✅ collector graceful shutdown 박힘 = timeout 근본 해결 (세션 321 PR #28 `4bfeaa9`; 사용자 제안 "시험 시간 다 되면 답안지 내고 나오기" 패턴. SIGTERM 받으면 loop 즉시 중단 + recordCollectorRun 호출 → collector_runs row 박힘 + status="partial". 8 파일 +58/-7. _shared.mjs createReporter 갱신 + setupGracefulShutdown export + types.ts Reporter interface + 6 collector main loop 1줄 박힘. vitest 140/140 pass. AWS Lambda/K8s/Heroku 표준. 데이터 자연 증가 대비 = timeout 늘리기 의무 0건)

---

## 🔴 즉시

(세션 414 종결: 세션 413 실서비스 검증 + 통합 홈 production ON. 사장님 "실서비스 검증 먼저" → Playwright 라이브 비로그인 검증[게이트 3경로·analytics 200 실측 통과] → 사장님 "통합 홈 켜줘" → `VITE_FEATURE_HOME=true` Vercel production add + 재배포[dpl READY·peach alias] → 라이브 home-grid·home_widget_expand 200 재검증. 다음 진입 후보 = 작업 가능 미해결 항목 소진 상태 → 사장님 신규 방향 지시 대기. eslint 10[🔴 upstream 차단·9.39.4 정상동작]·avg_price[ADR 1-A 보류]·supplyRatio[MOLIT 외부 사고]는 우리 작업 불가. 👤 사장님 잔여 = 지도 위치보존 3항목 수동검증[로그인 필요]·`/api/consults 500` 확인·analytics 대시보드 수신)

- ✅ **통합 홈 production ON + 세션 413 실서비스 검증** — 세션 414 (코드 무변경, 검증+인프라). 사장님 "실서비스 검증 먼저" → Playwright 라이브(`mibunyang-peach.vercel.app`) **비로그인** 직접검증: 게이트 3경로[`?detail=ah-2020910001` URL직진입·곧분양→분양결과 카드클릭·지도탭클릭] 셋다 `role=dialog aria-label="로그인 안내"` 모달 실측 / analytics `/_vercel/insights/event` POST **200** + 페이로드 실측(`profile_change`). **통합 홈 OFF 발견**[라이브 list진입+home-grid부재+`vercel env ls production` VITE_FEATURE_HOME없음=OFF]. 사장님 "켜줘" → `printf true | vercel env add VITE_FEATURE_HOME production` + `vercel --prod --force --yes` 재배포(dpl_FMi1FVyVBz1mRNcq1wxwEkcju7cT READY·peach 자동alias). **ON 라이브 재검증**: home-grid 노출+nav "홈"탭(D4 5탭)+위젯3종[지도 D5잠금·곧분양·시장요약] + `home_widget_expand {widget:upcoming}` POST **200** 실측. **👤 사장님 잔여** = 지도 위치보존 3항목(로그인 필요)·`/api/consults 500` 확인·Vercel Analytics 대시보드 수신.

- ✅ **분양 탭 그래프·섹션 "보는 법" ? 도움말 + 확장 가능 HelpHint 패턴** — 세션 411 PR #112 (지역 시장 추이 그래프 5[평균분양가격·분양가격지수·신규공급·초기분양율·택지비율] + 섹션 2[청약경쟁·네이버분양정보] + 상단 안내 = ? 8개. 신규 `HelpHint.tsx`[`<HelpHint text label/>` 한 줄, Tooltip+IconHelp 재사용] + 카피 데이터구조 hint 필드[METRICS.hint·DataSection.hint] = 다른 탭은 hint만 채우면 자동 ?. Tooltip bare? prop + Escape stopPropagation 보강. **적대검증 개별 프로브 직독 교차로 카피 major 2 정정**[평균분양가 "평당"→"㎡당 천원" ~3.3배 왜곡·청약경쟁 "%"→"N:1 미달/미수집"] + 접근성 4[term 전달 동음해소·터치타깃]. vitest 3403[+8]·tsc 0·eslint 0)

- ✅ **다른 탭 ? 도움말 확장** — 세션 412 PR #113 `5e18aa7` (? 9개: 섹션 6[종합 단지기본·입지 생활인프라/교통/치안·시세 시장투자/네이버교차 = dataSections.ts hint 필드만 → DataSectionBlock:55 자동 렌더] + 차트 2[PriceChart·UnsoldChart 제목 옆 `<HelpHint text label/>`] + 적정가 괴리 1[DetailModal:248 행객체 hint?필드 + L256 조건부]). **카피 전부 직독 확정**[적정가괴리 "+면싸다" scorePrice:127·PIR "낮을수록좋음" scorePrice:150·순이동+=유입 fieldMeta:96·차트단위 만원/세대·지하철500m초록 dataSections:26]. 적대검증 9카피 major 0. **회귀=DataSectionBlock 테스트 대조군박제**[세션411 "교통상세 hint없음" 박제→교통상세 hint추가로 4테스트깨짐→무스코프 getByRole `{expanded:false}` + hint없는 섹션객체 직접주입 재설계]. vitest 3407[+4]·tsc 0·eslint 0·CI green.

- ✅ **상세 모달 IA 개편 — Progressive Disclosure D1~D3 전체 완결** (세션 406 사장님 지시 "너무 길고 루즈해" → 세션 407~410 4단계 종결)
  - spec = `docs/superpowers/specs/2026-06-13-detail-modal-progressive-disclosure.md` (C안 + D1~D3 추록 전부)
  - ✅ D1 (세션 407 PR #106 `321fd6e`) — 점프 앵커 → 콘텐츠 교체 탭. keepMounted·관리자 전 패널 마운트·CTA 공통 영역.
  - ✅ D2a (세션 408 PR #108) — DataSections 8섹션 해체·주제별 탭 재배분. 섹션별 접기 유지. 정보 소실 0.
  - ✅ D2b (세션 409 PR #109) — 종합 요약 대시보드(CategoryMiniCard 6, 레이더 대체) + 관리자 탭(sec-admin) 분리.
  - **✅ D3 (세션 410 PR #110 `ba9377c`)** = 탭 전환 페이드(panelStyle animation + FADE_KEYFRAMES + print CSS + reduced-motion) + ARIA tablist 정석 role=tab(패널 role=tabpanel·aria-controls isMounted 조건부·roving·화살표 automatic activation) + analytics(`detail_tab_view {tab,previous_tab}`). 적대검증 3+1라운드 = R3 loan-rates.spec 무스코프 tablist 누락·aria-controls dangling·화살표 스크롤 경합 + 구현물 관리자 로그아웃 빈화면 fallback. vitest 3391/tsc 0/eslint 0/build/e2e CI green.
  - **실서비스 수동검증 5항목 (jsdom 불가, 사장님)**: 페이드 실재 / reduced-motion 0 / 관리자 7패널 인쇄 잔류 0 / 화살표 연타 떨림 0 / axe-core ARIA 위반 0.
  - 후속 (D1 수용사항, 선택): 금융 훅 useRef→모듈 캐시 승격 / `loan-rates.spec` 커버리지 부활(로그인 mock+금융 칩 선행)

- 🟡 **/api/consults 500 검증 잔여** (세션 406 발견·조치 — 사장님 스크린샷 콘솔에서 관리자 대시보드 500 확인)
  - 진앙 실측 = Vercel production 에 `SUPABASE_SERVICE_KEY` 미설정 → `getMibuyangSupabase()` throw → catch 500. DB·쿼리는 로컬 service key 프로브로 정상 확인 (consults 0행, submitted_at 정렬 OK)
  - 조치 완료 = `vercel env add SUPABASE_SERVICE_KEY production` (2026-06-13). **다음 배포부터 적용** — 적용 후 관리자 대시보드 새로고침으로 /api/consults 200 확인 잔여. `api/subscribers.ts` 도 같은 키 사용 = 동시 치유

- ✅ **비로그인 게이트 일괄 차단** (세션 413 PR #114 `0b8a4d0`) — 사장님 결정 "닫자(일관)". 비로그인 손님이 게이트 없이 상세 직진입하던 3 구멍(`?detail=` URL 딥링크·지도 탭 MapView·분양결과/곧분양 UpcomingPage)을 전부 `App.tsx` `detail.handleOpenDetail`→`handleDetailGated` 통일. 이제 일반 목록과 동일하게 비로그인 시 LoginPromptModal 발화. "분양결과 ungated +645(45%)" 종결. 직독 교차로 잔존 우회 0 확인(setDetailAptId(null 닫기)·카카오 콜백 복원·UpcomingCardList L79/83/202 전부 수렴). 회귀=App.test ?detail= 게이트 갱신. vitest 3418·tsc 0·eslint 0·CI green

- ✅ **통합 홈 M3 — 지도 위치 보존 + analytics + 320px** (세션 413 PR #114 `0b8a4d0`) — 사장님 결정 "둘 다". setBounds 전국 리셋 억제(`didFitRef` 첫 마커 fit 1회, 이후 filtered 변경은 마커만)·center/level 연속성(App.tsx `mapViewportRef` lifted useRef + MapView `getViewport`/`onViewportChange` prop + idle 리스너, 탭 전환 간 보존)·home_* analytics(`home_widget_expand {widget}`·`home_detail_open`)·320px(`minmax(min(300px,100%),1fr)`). **적대검증 major 1 정정**: didFitRef 를 viewport 로 시드 안 함(false) — 부산 보다 경기 필터 바꾸고 재진입 시 빈 화면 방지(재마운트 항상 첫 fit, viewport 는 초기 center/level 만). 미니지도(MapEntryWidget)는 의도적 미연결(compact+idle 오염 회귀 방지). **미니지도 빈 상태 placeholder·320px 는 이미 구현됨**(세션 387/406, MapEntryWidget L68-73). 회귀=MapView.test 7+HomePage.test 4 신규. vitest 3418·tsc 0·eslint 0·CI green. **세션 414 실서비스 검증**: 게이트 3경로[?detail= URL·분양결과 카드·지도 탭 → 로그인 모달]·analytics[home_widget_expand 200 + 페이로드] = Playwright 라이브 실측 통과 / 지도 위치보존 3항목[팬줌후 필터변경 위치유지·탭전환후 center복원·필터크게바꾸고재진입 빈화면0]만 👤 사장님 수동검증 잔여(카카오 OAuth 로그인 필요, 자동화 불가)

- ✅ **KOSIS OpenAPI GitHub 러너 전면 불통 (6/9~) — 로컬 이전 + 6/12 첫 자연발화 success 실증으로 종결** (세션 393 진단 → 395 이전 → 403 실증)
  - **세션 403 최종 실증 (6/12 05:30 KST 자연 발화)**: `MibunyangKosisLocal` 정확 발화 + regional-economy collector_runs **success** + KOSIS API 4표 정상 응답(36/270/270/54건)·시도 17개 매칭. ok=0 은 **멱등 skip 정상**(collect-regional-economy.mjs L222-227 minDiff 임계 — 6/10 선행 적재 ok=17 과 값 동일). 스케줄러 LastTaskResult=0·NextRun 6/13. 세션 394 하드닝의 failure-행 검증은 실패 상황 자체가 발생하지 않아 미발동(정상)
  - **증거 (4연속 실측)**: fertility schedule 6/9 22:02Z fail + dispatch 6/10 12:53Z·12:56Z fail + **unsold-kosis dry-run 12:58Z fail** (2 collector, 다른 통계표, 저녁 시간대) — 전부 `KOSIS fetch failed` ~36초 (connection-level, fetchWithRetry 3회 소진). 같은 시각 **로컬(한국 IP) 동일 호출 3회 전부 성공** (768행 <1초).
  - **진단**: 시간대 장애창 아님 (세션 393 초기 가설 폐기). KOSIS 가 GitHub 러너(Azure 해외 데이터센터 IP) 대역 차단/불안정 추정 — KOSIS 포럼에 "IDC 대역 차단" 관행 언급, 공식 공지 부재 (2026-02-05 HTTP 폐지+분당 호출 제한 공지가 최근 강화 흐름). 마지막 러너 성공 = unsold 6/8 21:29Z → 차단 시작 6/8 밤~6/9 사이.
  - **과거 사고 재해석**: 4/1 unsold ECONNRESET + 5/5 market-stats TLS 단절 (새벽) = 동일 계열의 간헐 전조 가능.
  - **영향**: KOSIS 의존 cron 10개 (`grep -l KOSIS .github/workflows/*.yml`) 차례로 실패 예정 — 당장 regional-economy 11일·avg-income 12일·medical-access 13일·jeonse 17일. monitor checkFailedRuns 가 매번 텔레그램 알림 (6/9·6/10 발화 실증).
  - **6월 데이터 채움**: fertility 는 세션 393 로컬 실행으로 완결 (262건 갱신, collector_runs success). 타 KOSIS collector 도 cron 실패 시 로컬 실행으로 채움 가능 (한국 IP 정상).
  - **대응 옵션 (별 세션 결정)**: (a) 일시 차단이면 자연 회복 대기 + 실패 시 로컬 수동 채움 (b) 지속 시 KOSIS collector 들을 로컬 Windows 스케줄러로 이행 (네이버 수집 선례) (c) 러너에서 한국 경유 프록시 — 비권장.
  - ~~**회복 트리거**: 다음 KOSIS cron success 또는 `gh workflow run collect-unsold-kosis.yml -f dry_run=true` 재프로브 success.~~ → 세션 289 yml 삭제로 무효 (GH 복귀 계획 없음, 재프로브는 로컬 `node scripts/collectors/collect-unsold-kosis.mjs --dry-run`).
  - **→ 세션 289 종결 (옵션 b 실행)**: GH collect-*.yml 10개 삭제 + monitor 목록 10개 제거 + `EXTERNAL_API_COLLECTORS` 10종 등재 (collector_runs 신선도 "미발화" 분기 신설 + 연간 diff-only 수집기 ok=0·skip>0 outage 오탐 차단 + per-collector fetch 결함 fix) + 집서버 작업 `MibunyangKosisLocal` (매일 05:30 KST, `kosis-local-runner.mjs` 일자 디스패치). 수동 보충 = `node scripts/kosis-local-runner.mjs --date=YYYY-MM-DD`.
  - ~~부수 후보: fertility collector main try/finally 하드닝~~ → **세션 394 완료 (PR #97)**: 이번 주 실패 예정 4개 + fertility = **5개 collector try/catch/finally 하드닝** (fertility·regional-economy·medical-access·jeonse-price-index + avg-income 은 throw 시 `{ok:0,fail:0}` 가짜 빈 success 행 결함 동시 정정). 실패 시 `status=failure`+errorMessage 가 collector_runs 에 기록됨. **라이브 실증 = 6/12 새벽 KST regional-economy cron 실패 시 failure 행 1쿼리 확인**. 잔여 5개 (unsold·market-stats·sale-price-index·housing-supply-ratio 同 사각 + migration 同 avg-income quirk) = 다음 cron 7월이라 여유, 차단 지속 시 같은 패턴 후속.

- ✅ **childcare 수집기 3종 해외 IP fetch failed — 로컬 러너 이전 종결** (세션 398 코드 가드 + 세션 399 로컬 이전)
  - **사고**: `collect-childcare-detail` 이 GH 러너(해외 IP)에서 매일 04:00 발화 → `api.childcare.go.kr`(평문 HTTP) 세종 등 `fetch failed` 연쇄 → 정확히 60분 timeout cancelled. 텔레그램 "Childcare Detail 취소" 매일 발화(6/4·5·7·10·11) + Actions 60분 통째 낭비. raw 로그(run 27302018612): 세종 fetch failed ~36초 간격 연쇄, 60분(19:50→20:50) cancel. **로컬(한국 IP) 동일 stcode 직접 호출 = 200 OK 550ms 정상** = KOSIS 와 동일 해외 IP 차단 (외부 영구장애 아님).
  - **진앙 (코드)**: 실패 호출이 `processed` 카운터에 안 잡혀 DAILY_LIMIT 종료조건 영원히 미발동 + fetchWithRetry 가 fetch failed 를 30s×3 재시도 → 947 시군구 무한정 두드려 timeout.
  - **→ 코드 가드 완료 (세션 398, 커밋 `4e566c8`)**: `isNetworkError()` 헬퍼 + `attempted` 카운터(실패 포함 종료조건) + 시군구 circuit(연속 3 네트워크 실패→skip) + 전역 circuit(연속 5 시군구 전면차단→종료). 최악 전면차단 시 5×3×~36s≈9분 종료. 테스트 +5(15/15) + graceful 54/54 + tsc 0. **출혈(60분 낭비)만 멈춤 — 세종 데이터는 여전히 GH 에서 못 채움**.
  - **→ 로컬 이전 완료 (세션 399)**: `childcare-local-runner.mjs`(매일 3종 전부) + `.bat` + `register-childcare-task.ps1`(작업 `MibunyangChildcareLocal`, 매일 04:30 KST) + `childcare-local-runner.test.mjs`(5건). GH 정리 = `collect-childcare-detail.yml`·`collect-childcare-jeju.yml` 삭제 + `collect-childcare.yml` info step 제거(Kakao step 보존) + monitor-collectors.yml workflow_run 에서 Detail/Jeju name 제거 + `EXTERNAL_API_COLLECTORS` 3종 등재(stale_days 14). 이전 직후 즉시 운영 수집 1회 실증.
  - **조사 결론 (plan 단계 확정)**: info(cpmsapi021)/jeju(cpmsapi017)도 detail 과 **동일 endpoint `http://api.childcare.go.kr`** = 같은 해외 IP 차단. collect-childcare(Kakao `dapi.kakao.com`)·nearby-childcare(외부 API 없음, DB 가공)는 **해외 IP 안전 → GH 잔존**. KOSIS 러너와 **별도 러너**(KOSIS=월간 일자 디스패치 vs childcare=매일 전부, 스케줄 철학 다름 + 고장 격리). 사용자 결정 = info/jeju 도 "매월 말고 매일"(양 적어 부담 0). circuit breaker(세션 398)는 로컬 무해라 보존.
  - **세션 403 최종 실증 (6/12 04:30 KST 첫 자연 발화)**: 3종 전부 success — detail ok=4(쿼터 리셋 후 회복)·info 243·jeju 2, fail 0. 러너 로그 "3개 전부 성공"(깨진 한글 0) + LastTaskResult=0 + NextRun 6/13. 세션 400 CRLF fix 후 자연 발화 체인 완전 정상.

- 🟢 **`/api/supabase/apartments` "19초" 근본 진단 완결 (세션 357 적대검증) — 보류** (세션 351 발견 → 357 진단 종결, P2)
  - **세션 357 진단 결론 = 죽은 코드 최적화라 보류**. 12 probe 적대검증(wtpjv3c6m + wjormmmc3) + 직접 실측으로 세션 351/356 박제값 다수 정정. 코드 변경 0.
  - **세션 351 박제값 정정 (3건 할루시네이션)**:
    - ❌ "VIEW 쿼리가 DB에서 19초" → **실측 82ms** (`supabase db query --linked` EXPLAIN ANALYZE: VIEW LIMIT 1000 = 82ms, count(*) = 11ms). DB는 결백.
    - ❌ "로컬 `supabase db query` 는 집 IP 차단으로 불가, 대시보드 필수" → **실측 작동함**. `supabase projects list` 에서 mibunyang(`rwdtljipvmqpazrimyns`) LINKED(●) + `db query --linked` EXPLAIN/pg_column_size 다 됨.
    - ❌ "VITE_USE_SUPABASE=true 일 때 19초" → 현재 Production = **false 확정**(`vercel env pull` + 배포 번들 index-*.js 에 "supabase" 0건 = dead-code-elimination). 랜딩 = 정적 `apartments-list.json` 직행(1.06초).
  - **진짜 병목 (실측)**: Vercel 함수 TTFB warm 2.5~3초 / cold 4.5초. 분해 = batch1+count(0-999) 1.3~1.5초(지배) + batch2 병렬(1000-1423) 0.6~0.9초 + dataUpdatedAt 순차 25~76ms + stringify 150~205ms. **DB(82ms) 아니라 PostgREST 가 `select("*")` 163컬럼 × 1424행(2001 아님, dedup CTE)을 직렬화하는 서버시간**. 함수=icn1(서울)=Supabase(서울) 네트워크 결백. "23MB 비압축 전송 병목"(세션 356)은 **curl 기본 Accept-Encoding 미전송 측정 아티팩트** — 실브라우저는 `Content-Encoding: br` 2.54MB 받음(전송은 total의 18%뿐).
  - **컬럼 슬림화 효과 실측** (supabase-js 로컬 재현): `select("*")` 163컬럼 22.98MB = 2.0~2.5초 / catsCache 포함 ~81컬럼 9.8MB = 0.9~1.2초 / catsCache 제외 ~80컬럼 2.19MB = 0.4~0.5초 / 카드raw 20컬럼 0.62MB = 0.22초. **명시 select 자체는 * 와 차이 0(같은 컬럼이면), 효과는 오직 payload bytes(특히 catsCache 7.6MB = 단일 74%) 제거에서 발생.** catsCache 제외 안전 확인(폴백 calcCats 점수 byte 동일, 128ms CPU — `compute-scores.mjs` 가 클라 폴백과 동일 코드로 미리 박은 캐시일 뿐).
  - **보류 근거 (메타 진단)**: `/api/supabase/apartments` 는 프론트 아무도 호출 안 함(VITE_USE_SUPABASE=false). 진짜 데이터 파이프라인 = `daily-deploy.yml`(매일 KST 03:00 cron)이 `collect-data.mjs --from-supabase-only` 로 VIEW 1회 읽어 정적 JSON 생성 → git push. freshness spec v3(2026-05-25)이 정적 JSON 을 **영구 방향**으로 의도 설계(분양 데이터 분단위 변동 없음). TTFB 2.5→0.9초 개선해도 호출자 0이라 체감 0.
  - **재오픈 조건**: 미래 Supabase 실시간 모드 실제 도입 시. 그때 구현안 = `api/supabase/apartments.ts:21` `select("*")` → 카드/지도/필터/스코어링 컬럼만 명시 + catsCache 제외(sanitize L366) + 시세4배열 제거(sanitize L297-300, DetailModal lazy fetch 자동 전환) + e2e mock 갱신. 상세 plan = `~/.claude/plans/mibunyang-serene-cray.md` (v2, 단 catsCache 제외로 보강 필요).
  - **진짜 P1 분리**: `/api/upcoming` 은 `VITE_FEATURE_UPCOMING=true`(현재 라이브 호출, App.tsx:72)라 별개 게이트. 19초 사고가 재발하면 이쪽 진단(현재 라이브 실측 1.5초 200 = 건강). select 슬림화로는 안 고쳐짐.
  - 답습 자산: 세션 357 메모리 `session_2026-06-01_session357_api_19s_real_diagnosis.md` + `daily-deploy.yml` + `docs/superpowers/specs/2026-05-25-data-freshness-automation-design.md`

- ✅ **`sync-naver-complex` 30분 timeout 반복 cancelled 근본 정정** (세션 354 진단 → 세션 355 정정 + 종결)
  - **사고**: `fill-missing-data.yml` phase2-calc matrix step `sync-naver-complex` 가 매주 일요일 cron 에서 30분 timeout 도달 cancel 반복 (최근 10회 fill: cancelled 6 / failure 3 / success 1).
  - **세션 354 진앙 오진 정정 (세션 355 적대 검증)**: 세션 354 "직전 success 5/25 17분 vs 5/31 30분 = 데이터 증가 + 직렬 update 진앙"은 **부분 오진**. (1) 5/25 success 는 `--dry-run`(쓰기 0건)이었고 5/31 이 real 첫 실행 — 데이터 증가 아니라 dry-run vs real 차이. (2) 진짜 주 병목 = **`complex_links` 테이블 mibunyang DB 부재** (`PGRST205`). `matchApartments` 가 항상 이름 유사도 LCS 폴백 → complexes 63,535 × apartments 2,001 = 1억2716만 회 `stringSimilarity`(O(글자수²) DP) 를 Phase 1·4 에서 2번 반복 (dry-run 실측: Phase1 매칭 441초 + Phase4 매칭 398초 = 839초). 직렬 update 는 부차적(Phase3 ~251ms/건).
  - **정정 (세션 355, 방향 C)**: (1) **매칭 1회 계산 후 Map 재사용** (3패스→1패스, `complex_no → matched id[]` 캐시 + id 인덱스 룩업). (2) 직렬 update → `createSemaphore(10)` + BATCH=200 슬라이스 `Promise.all` (whole-array 금지 — matched pair 19,763 = trade-stats 10배라 critic 권고). timeout 30 유지(yml 무변경).
  - **실증 (dry-run)**: before 1048초(17.5분) → after 794초(13.2분). 매칭 통합 839→335초(−504초). real 추정 ~11분 << 30분.
  - **회귀 가드**: tsc -p tsconfig.scripts.json 0 + vitest 30/30 + graceful-coverage 54/54 + 적대 검증 워크플로 confirmed red 0.
  - 답습 자산: 세션 355 메모리 + plan `mibunyang-breezy-rainbow.md` + `collector-timeout-rootcause-analysis.md` §4-way (메모리 ≠ 진실의 원천 — 박제값 "데이터 증가"가 dry-run vs real 오진이었음 답습)

- ✅ **`sync-naver-complex` articles/price 1000건 cap + articles 4회 fetch 통합** (세션 355 발견 → 세션 356 정정 + 종결)
  - **사고 (박제값 정정)**: 세션 355 박제 "Phase 1/2/3/4 cap"은 **부분 오류**. 실측 = `.range(0,99999)` 단일 호출 cap = **4곳** (Phase1 area/direction L245 + Phase2 trade_type L388 + **Phase3-a complex_price_history L482** + Phase3-b floor L503). Phase4 maintenance(L640)는 이미 페이지네이션 정상(cap 아님). complex_price_history(시세)가 진짜 4번째 cap(세션 355 누락). PostgREST `max_rows=1000` 으로 articles 461,751행 중 **0.2%(1000건)**, price 338,141행 중 **0.3%** 만 읽어 전 단지 전용률·조망·일조·매물수·미분양율·시세·평균층수가 체계적 왜곡.
  - **정정 (세션 356, A+B 적대검증 워크플로)**: (A) `fetchAllPages` 헬퍼(전건 페이지네이션) 신설 + cap 4곳 정정. 추가로 같은 `articles eq(is_active,true)` 전건을 **4번 따로 fetch**(area/trade_type/floor/maintenance)하던 비효율을 발견 → **8컬럼 1회 통합 fetch**(`allArticles`, matchCache 직후)로 4 Phase 공유. (B) `fill-missing-data.yml` phase2-calc timeout 30→60 (articles 1.5배 성장 마진).
  - **실증 (dry-run v1 cap만 vs v2 통합)**: before 1000 → after **461,466건** (461배). 시세 **25,941개 단지**(이전 극소수). 통합 후 dry-run **28분 → 10분15초 (64%↓)**. 고정 5수치 동일 재현(시세 25,941 / Phase3 1,987 완전 일치, 나머지는 articles 실시간 변동 ±0.1%). peak RSS **248MB**(워크플로 적대검증 retained 91MB와 일치 — v1 "1.2GB"는 무관한 별 node 프로세스 오인 정정).
  - **회귀 가드**: fetchAllPages 6 테스트 + 통합 컬럼 가드 10 테스트(8컬럼 누락 차단) + vitest 46/46 + tsc 0. 메모리 적대검증 = V8 limit 4496MB / 8컬럼 460,986행 retained 91MB / 34배 헤드룸.
  - 답습 자산: 세션 356 메모리 + plan `mibunyang-tidy-hare.md` + 적대검증 워크플로 (메모리≠진실의원천 — 박제값 "Phase4 cap / 시세 누락" 정정)
  - **잔여 (별 자리)**: `complex_links` `.range(0,49999)` 미래 cap — 현재 테이블 부재(PGRST205) 0건, 채워지면 1000건 cap. heating fetch(L211, `.not(heating_type null)`)는 다른 필터라 통합 제외(heating_type 0건이라 무관).

- ✅ **NEIS_KEY / SCHOOLINFO_KEY 미설정 사고** (세션 327 발견 → 세션 328 종결, PR #31)
  - 진단 결과 = `collect-naver-listings-incremental.yml` Collect schools step env block 누락 (Secrets 등록 ✅, schools-neis.mjs 코드 ✅, 월간 collect-schools.yml ✅)
  - 정정 = incremental yml step env block 에 NEIS_KEY + SCHOOLINFO_KEY 2 줄 박힘 (`47a1a59`)
  - 자가 점검 1 = Explore Agent #1 정확 (Secrets ✅ + yml 누락 ❌) vs Agent #2 환각 (Secrets 미등록 ❌). 직접 `gh secret list` 답습 의무 정착
  - 검증 = 5/28 KST 05:30 자연 cron raw log "⚠️ ... 미설정" 0건 답습 의무
  - 답습 자산: `.claude/rules/workflows/secret-naming-audit.md` §"yml validate step 의무화" + 보조 BACKLOG 박힘 (audit-env-keys.mjs step 단위 검증 보강 P2)

- ✅ **scripts/CLAUDE.md 테스트 수 박제값 stale — 종결** (세션 344 발견 → 세션 345 정정)
  - 세션 344 박제 "stale 3건"은 과소. 실측 = **표 42행 나열 / 실제 55개 파일** (13개 누락) + 다수 수치 stale + `isCLI 34개 → 57개`
  - 세션 345 전수 정정: 표 → 55행 / **1017 케이스** (vitest 실측). isCLI 박제값 34 → 57. 측정 명령 박힘 (미래 stale 방지)
  - 답습 2중: (1) BACKLOG 박제값("3건") ≠ 실측 (2) **grep 카운트(931) ≠ vitest 실행 수(1017)** — grep 은 동적 생성 `it()` 못 셈 (`_graceful-coverage` ALLOWLIST 루프 grep 2 → vitest 53). 진실의 원천 = vitest `--reporter=json`

- 🔴 **concurrency 분리 = 금지 (안티 패턴 박제, 세션 344)**
  - 워크플로 분석이 "34개 collector data-collection 단일 큐 직렬화 → collector별 고유 group 분리"를 제안했으나 **하면 안 됨**
  - 직렬화 = 의도된 data.go.kr 쿼터 보호. 분리 시 매월 10일 building-info(~8,500) + trades(~3,500) = 12,100 > 일일 10,000 → 429/500 폭주 (NonRetryableError 즉시 throw)
  - 세션 273 calc-collection 분리가 정답 패턴: 쿼터 무관(외부 API 0·멱등) collector만 분리. 쿼터 쓰는 collector는 직렬 유지
  - "cancelled 줄이려 분리"는 메모리 룰 `timeout-rootcause-policy.md` 경고 "큐 막힘 환각". 대안 = cron 시각 분산(KST 05:00 13개 동시 발화 → 분산, 별 검토)

- 🟡 **reusable workflow(workflow_call) 추출 (세션 344 발견, P2, 별 세션)**
  - 38개 collect-*.yml 중 30개 표준형(checkout→setup-node@v5→npm ci→Validate secrets→collect)이 ~9K줄 보일러플레이트 중복. workflow_call 0건
  - 위험: `audit-env-keys.mjs` 3-way secret 검증(`secret-naming-audit.md` 룰)이 reusable 구조와 충돌 → audit 리팩토링 동반(extractReusableWorkflowCalls 추가)
  - 범위: Phase 1(30 표준형)만 먼저. Group C(naver-listings 4-step / building-info Saturday fallback 등 8개)는 제외. 큰 작업

- ✅ **13:35~13:36 cancelled 5건 (7~8초) 진단 — 종결** (세션 327 발견 → 세션 344 종결)
  - 5/26 13:35:58 ~ 13:36:08 workflow_dispatch 5건 = Emergency / Police / KOSIS Unsold / Housing Permits / Building Info
  - raw 실측: 앞 4건 (Emergency/Police/KOSIS/Housing Permits) = jobs=0 + 7~8초 cancel, triggering_actor=developer-duno (사람), 모두 `data-collection` concurrency 그룹 + `cancel-in-progress: false`. 동시 dispatch 후 **수동 cancel** (concurrency supersede 아님 — pending 슬롯은 새 run 도착 시 직전 것 cancel)
  - 5번째 building-info 는 별개 사고로 분리 (아래 신규 P1)

- ✅ **building-info 매월 10일 cron 30분 반복 cancel 진단 — 종결** (세션 344 발견 → 세션 345 종결)
  - **진앙 = 옛날 `timeout-minutes: 30`** (이미 PR #26 커밋 `0a9cbd1`, 2026-05-26 14:58 UTC 에서 90 으로 정정 완료). 세션 344 박제 "외부 cancel / 진앙 미확정"은 **이 커밋을 누락한 오진**
  - 교차 검증 (세션 345, 멀티 에이전트 4-way + git 직접): cancelled run 3건 모두 `0a9cbd1` 이전 생성 → 옛날 30분 timeout 에 걸린 것. (4/10 16:47 UTC / 5/10 16:51 UTC / 5/26 13:36 UTC — 전부 커밋 14:58 UTC 이전)
  - collect step 런타임 일관 (1793~1800초 ≈ 30분 정각) = 작업량 변동이 아니라 **고정 timeout 경계**. `gh run list --status timed_out` 0건은 옛 버전이 SIGKILL grace 0 으로 cancelled 로 기록됐기 때문 (`graceful-shutdown-coverage.md` 답습)
  - 5/11·4/11 fallback success = 토요일 skip 경로 (실제 수집 0건). 10일이 일/금이라 fallback 미작동 → 그 달 수집이 사실상 누락됐던 것
  - **잔여 모니터링 (P2, 신규)**: 90분이 충분한지 미검증. 다음 정기 cron = **6/10** 이 첫 full schedule 검증. 2,000+ 단지를 90분 내 완수하는지 `collector_runs` (status=success + ok_count) 로 확인. 초과 시 timeout 추가 상향 또는 단지 chunk 분할 검토

- ✅ **monitor-collectors 알림 9건 누적 사고** (세션 326 발견 → 세션 327 종결, docs only)
  - 답습 결과 = monitor 정상 작동 (9개 사고 즉시 감지 결과). 알림 9건 = 사고 아닌 정상 감지
  - 진앙 4종 분리: (1) housing-permits success 0건 = MOLIT API 500 외부 사고 (세션 323 v3 답습) (2) Naver cancelled = transport-tago 자연 변동 ±10% × timeout 120m 부족 → 180m 정정 (3) maintenance + building-info cancelled = graceful break 0 = 18 collector 패턴 사고 (4) 13:35~13:36 5건 = 세션 344 종결 (4건 수동 cancel + building-info 30분 별 P1)
  - 본 세션 정정 4건: Naver yml timeout 180 + transport-tago/infra-kakao/schools-neis break 박힘 + _shared.test.mjs SIGTERM mock 4건 + 신규 rule `graceful-shutdown-coverage.md`
  - 답습 자산: 세션 327 plan v3 (자가 점검 1 v2/v3 발동 후 환각 9건 정정)

- 🟡 **Supabase RLS — naver-estate-web 전용 11개 테이블 잔여** (세션 274 — mibunyang+공유 해결 완료)
  - 세션 274 실측 정정: 세션 273 "19개" 박제값은 부정확. `supabase db advisors --type
    security` live 조회 = `rls_disabled_in_public` 16개.
  - **해결 완료 (세션 274, 2 커밋)**:
    - mibunyang 소유 3개 (api_quota_log·air_quality_stations·collector_runs) —
      `20260519111101_enable_rls_mibunyang_owned.sql` (커밋 2ed66f7).
    - 공유 3개 (complexes·articles·complex_price_history) —
      `20260519112845_enable_rls_shared_tables.sql` (커밋 c6863dc). 정책 이름·조건은
      naver-estate-web `V007` 답습 (articles 는 `is_active=true` 숨김 의도 보존,
      anon JWT 회귀로 비활성 매물 0행 확인).
  - **잔여 11개 — naver-estate-web 전용 (mibunyang 작업 아님)**: crawl_jobs /
    user_profiles / audit_logs / rate_limit_counters / admin_settings /
    article_price_history / crawler_checkpoints / complex_pyeong_details /
    agent_verifications / monitor_alerts / naver_api_call_counts. → naver-estate-web
    세션에서 처리. mibunyang 에서 그 레포 코드 검증 불가.
  - ✅ 별도 잔여 (mibunyang) 해결 — `security_definer_view`(apartments_flat·
    api_quota_daily) + `function_search_path_mutable`(update_updated_at·
    update_scores_computed_at) — 세션 276 `20260519130000_fix_security_definer.sql`.
    VIEW 2개 `ALTER VIEW SET (security_invoker=on)` + 함수 2개 `SET search_path=''`.
    live 검증 — JOIN 9테이블 `USING(true)` 정책+GRANT 보유로 anon 무영향.

- ✅ **제주 어린이집 미수집 — cpmsapi017 collector 신설 (세션 325)**
  - 세션 275 발견 + 세션 276 진단 정정 + 세션 325 해결
  - 신규: `scripts/collectors/childcare-info-jeju.mjs` (cpmsapi017, data.go.kr 15101201)
  - 신규: `scripts/collectors/childcare-info-jeju.test.mjs` (vitest 9 test)
  - 신규: `.github/workflows/collect-childcare-jeju.yml` (월 1일 KST 06:00 cron)
  - 등재: `data-fill.mjs` regions phase 1 + `monitor-collectors.yml` workflows
  - 박제: `CHILDCARE_JEJU_KEY` 환경변수 (`.env.example` + `ENV_VARS.md`)
  - arcode 체계 환각 정정: BACKLOG L111 "50110/50130 (법정동 코드)" 박제값 = cpmsapi021
    체계. cpmsapi017 은 **49xxx 독립 체계** (제주시 49110 / 서귀포시 49130, raw 실측 박힘)
  - 운영 검증 (개발키): 제주시 50건/3,472정원 + 서귀포시 50건/3,688정원, 6 row UPDATE 박힘
  - 운영키 발급 후 (data.go.kr 승인심의 1~3일): GitHub Secret 박제 + workflow_dispatch
    재실행 → 전수 응답 (1000+ 행 추정) 갱신 의무

- 🔴 **차단: `eslint 10` 본 적용** — `eslint-plugin-react@7.37.5` (최신) peer 가 `eslint: ^9.7` 까지만 지원
  - 재오픈 트리거: `npm view eslint-plugin-react@latest peerDependencies` 결과 `^10.0.0` 등장 (세션125 조사)

---

## 🟡 곧

- ✅ **backfill-presale-prices.mjs today() 통일 완료** (세션 419 부산물 → 세션 421 해소) — `new Date().toISOString().slice(0,10)`(UTC) → `today()`(KST 고정, `_shared.mjs`) 통일. 로컬 변수 `today`→`recordedDate` 개명(헬퍼명 충돌 회피), import에 `today` 추가(L16/44/53/57). prices 형제 writer(naver-presale)와 recorded_at 시간축 일치. dry-run 실증 recorded_at=오늘 KST·tsc:scripts 0. **일회성 수동 도구(cron 0건)라 실해는 0, 일관성용**
- ❌ **monitor 음수가드 테스트 추가 — 폐기(헛돌이 확정, 세션 421)** — 세션 419 부산물로 "4곳(ageH·sinceCreated·idleDays·daysSince) 음수 입력 전용 테스트로 가드가 막는 걸 증명" 제안했으나, 세션 421 적대검증(5에이전트 만장일치 + node 줄별 실증)으로 **전부 헛돌이 확정 → 테스트 추가 0건**. 근거: 음수(미래 시각)와 0(Math.max 클램프)이 항상 양수 임계값(maxAgeHours 36·STALE_DAYS 35·stale_days≥14)의 **같은 쪽**에 떨어져 가드 제거해도 분기 불변(guardRemovalChangesBranch=false). 음수는 비교에서 먼저 걸러져 `Math.floor()` 표시 라인 **도달 불가**(사용자 노출 경로 없음). 미래-시각 테스트는 가드 제거 후에도 항상 통과 → 회귀 못 잡음. 5개 Math.max(0,..) 가드 = **방어적 no-op 확정**(제거 안전하나 cosmetic 보험이라 유지). 기존 L217 ageDays 테스트도 같은 이유로 inert. 양수-일수 표기 정확성은 기존 미발화 테스트가 이미 커버. 시간대 회귀 걱정이면 가드가 아니라 finished_at/recorded_at 저장 시간축 일치(timezone) 검증이 진짜 가치(별개)

- ✅ **expertToken 키·useExpertMode 명칭 정리** — 세션 426 (PR #129, main d0eed91). 세션 405 의도적 보류 해소. 위 완료 색인 참조.

- ✅ **비로그인 블라인드 정책 기존 구멍 2건 — 둘 다 해소** (세션 403 적대검증 부산물)
  - DetailModal ungated 진입(`?detail=` 딥링크 + UpcomingPage 상세) → **세션 413 해소**: 모든 상세 진입이 `handleDetailGated` 수렴(비로그인 시 LoginPromptModal). 세션 414 라이브 3경로 모달 검증.
  - AptCard 점수 계열 누설(Bar aria-valuenow·width% + "안전 N등급") → **세션 420 해소** (위 L276 항목, PR #123).
  - 출처: 통합 홈 IA spec 적대검증(8프로브×2라운드) blind-policy 프로브 — `docs/superpowers/specs/2026-06-11-unified-home-ia-design.md` §9

- ✅ **적정가 괴리(deviation) 부호 표기 역방향 불일치 2건 정정 완료** — 세션 411 (세션 409 D2b 적대검증 부산물 발굴 → 본 세션 해소)
  - 진실의 원천 = `scorePrice.ts:127` `dev = (fairPrice - price)/fairPrice*100` → **양수 = 분양가가 적정가보다 쌈(저렴)**. 정합 측 = DetailModal 핵심지표 L248(`>0 → 녹색=좋음`) + FAQSection.tsx L19 + catVerdict.ts:31-32 + subContext.ts:17.
  - **정정 2곳**: ① `AptCard.tsx:109` `< 0`→`> 0` + 표시 `주변대비 +{Math.round}% 저렴`(양수=저렴만 녹색 강조, L108 할인 배지 패턴 답습) ② `GuideSections.tsx:105` 카피 "+면 시세보다 저렴, -면 비쌈"으로 좌우 교체.
  - 회귀 가드 = AptCard.test.jsx 신규 4건(양수→배지/음수→미표시/null→미표시/"0.0" 데이터부재→미표시). vitest 3395(206파일, +4)·tsc 0·eslint 0. 적대검증 워크플로 5프로브 major 0(부호 방향 전원 정합).
  - 점수·정렬·엔진 무변경(표현 계층만, deviation 값 불변) — 프론트 번들 배포로 즉시 반영.

- ✅ **deviation 음수(비쌈) 카드 배지 + 비로그인 점수 계열 블라인드 정합 완료** — 세션 420 (세션 411 분리 → 한 묶음 해소, PR #123 `e9ef544`)
  - A: 음수 deviation 단지에 빨강 `주변대비 N% 비쌈` 배지(저렴 초록 배지 대칭). `AptCard.tsx:110` 인라인 span(`C.redLight/C.red`), `Math.abs(Math.round(...))`. 양수/null/"0.0"과 상호배타.
  - C: 비로그인 점수 계열 2곳 차단 — ① 카테고리 점수바 Bar(L95) → 비로그인 시 회색 `aria-hidden` placeholder div(종합 ScoreBadge `??` div 답습, Bar 컴포넌트 불변=타 5소비처 영향 0) ② "안전 N등급"(L107) → `안전 ?등급` 글자 치환. 적정가·입지·deviation 배지는 점수 아님 → 유지(사장님 결정).
  - 회귀 가드 = AptCard.test.jsx +4(음수→비쌈[기존 "음수 미표시" 대조군 함정 `/주변대비/`→`/저렴/` 정정]·양수 상호배타·비로그인 progressbar 부재·안전 ?등급). vitest 3481(210파일,+4)·tsc 0·eslint 0·vite build 0. 표현 계층만(점수·정렬·엔진 불변).
  - 설계: `docs/superpowers/specs/2026-06-15-deviation-badge-and-blind-policy-design.md`

- ✅ **루트 CLAUDE.md 박제값 stale 2건 정정 완료** (세션 403 적대검증 실측 → 같은 세션 마무리에서 즉시 정정): "11 spec"→13 / "index 172KB"→~185KB

- 🟢 **청약홈 매칭 회수 — 진짜 진앙은 후보 쿼리 presale_stage 제약 (세션 360 PR, 진단 정정)**
  - **세션 359 진단 정정**: "정규화(LCS 한계)가 병목"은 세션 360 적대 검증(6-probe 워크플로 + 라이브 재측정 2회)으로 **데이터 반증**. 정규화 회수 효과 ~0건 (미매칭 384 중 정규화로 잡을 수 있는 건 ≤8건, 긴 단지명은 음차 1글자 차이여도 이미 sim 0.92 통과). 미매칭 384 중 **235(61%)는 임대/공공주택** = 청약홈 *분양* API 구조적 부재.
  - **진짜 진앙 (라이브 재측정 2회 확정)**: `collect-applyhome-detail.mjs:225` 매칭 후보를 `presale_stage NOT NULL`(728)로 제한 → 청약홈 공고 있는데 분양 단계 미태깅된 단지가 통째로 빠짐. 제약 제거 시 매칭 **393→916 rows / 344→810 distinct (+466 단지, 2.4배)**, 신규 483 중 482가 명백 분양(sim 1.0 정답, 임대 1건뿐).
  - **세션 360 PR 처리**: 후보 쿼리 전체 apartments 확대 + region 파싱 버그(`경기도 광주시`→광주광역시 오파싱) 동반 수정. 적재는 별도 테이블만(apartments base 불변, 미분양 보호). 회귀 가드 = vitest 3180 + typecheck 0 + region 버그 fixture 2건.
  - **잔여 검증 (P2)**: 세션 360 dry-run AFTER 는 청약홈 odcloud `totalCount:0` 외부 일시장애로 이월됐으나 **세션 370 라이브 실측 = odcloud 회복**(getAPTLttotPblancDetail HTTP 200 totalCount 2777 / Mdl 14157) → 6/13 cron(`30 2 13 * *`) 정상 실행에서 `collector_runs` matched ~916 자동 검증.
  - 답습: 세션 355 LCS 폴백 + 세션 353 청약홈 매칭 개선 + **세션 360 = "정규화 진단이 적대 검증으로 반증, 진짜 진앙은 후보 쿼리 제약"** (이름 변형보다 후보 누락이 지배적 진앙). 메가단지 블록코드(D1-2BL) LCS 변별 약점은 별 항목.

- 🟡 **regions.avg_price 100% NULL + cross-repo 활성 사용 8 위치** (세션 223 발견, 세션 226 정정, 세션 277 재실측, **세션 316 재실측 + drift 정정**, **세션 334 ADR 승격**)
  - **정책 결정**: → [docs/decisions/avg_price-policy.md](../docs/decisions/avg_price-policy.md) (세션 334 ADR 박힘)
  - 채택 = 옵션 1-A (보류) + 미래 후보 = 옵션 1-D (자매 계산)
  - 재오픈 트리거 3건 박힘 (1-B cross-repo 정리 / 1-D KOSIS 분양면적 수집기 / 1-C ORM 매핑 변경)
  - 본 메모는 BACKLOG 트리거 자리 박힘 용도. 상세 근거·옵션 비교·답습 자산 = ADR 본문 우선

- ✅ **housing-permits regions UPDATE 동종 버그 — id PK 최신행만 UPDATE 선제 수정** (세션 367 발견 → 세션 368 PR)
  - `housing-permits.mjs` `.eq("region").is("gu",null).order(recorded_at).limit(1)` = PostgREST PATCH 가 order/limit 무시 → 같은 시도 전체 스냅샷 UPDATE 버그였음. `pickLatestRegionId` (export, 인라인 독립 구현 — childcare PR #76 패턴 답습, trade-stats import 사이드이펙트 회피) 로 시도별 최신행 id 추려 `.eq("id", latestId)` 로 좁힘. 회귀 테스트 5건 + 실 DB 실증(서울 5스냅샷 중 id=36@2026-03-20 최신만 선택 확인).
  - 선제 수정 근거: 현재 supply_ratio 0건(MOLIT API 500 장기 사고)이라 미발동이나, **API 복구 시 과거 시계열 영구 오염 차단** + "최신 1건만" 의도를 코드에 정확히 표현(거짓 안전 `.order().limit(1)` 제거). 화면 영향은 `latest_regions` VIEW(최신행)라 전후 0.
- 🟢 **migration regions UPDATE 전체행 동기화 — 의도된 설계로 유지(수정 보류)** (세션 367 발견, 세션 368 정책 확정)
  - `migration.mjs:259-275` `.update({net_migration}).eq("region").eq("gu")` (recorded_at 無) → 같은 시도행 전체 스냅샷 동기화(서울 5행 전부 net_migration=-167 실측). **L253-255 주석이 "regions 는 region+gu 당 여러 recorded_at 스냅샷이 동일 최신값으로 동기화되는 구조로 운영"으로 명문화 = 의도된 설계**(세션103 collector-contract 지적으로 `.order().limit(1)` 이미 제거). housing-permits 와 달리 "최신 1건" 의도 주석이 없고 "전체 동기화 의도" 주석이 명시됨 → 버그 아님. net_migration=작은 숫자 timeout 무위험 + latest_regions VIEW 최신행만 봐 화면 영향 0. 정책 재확인 없이는 손대지 않음(손대면 회귀).

- ✅ **regions.childcare 좌표 톱니 구조 — merge 보존으로 차단 (세션 367 발견 → 세션 370 PR)**
  - 진단: `childcare-detail` 매일 04:00 좌표(la/lo) ~23일 누적 보강 → `collect-nearby-childcare` 05:30 회수→schools 적재 → **`childcare-info` 가 발화할 때마다(월간 cron + 수동 dispatch, 5/19·5/26·6/01·6/02 실측) facilities 를 7필드(좌표 없음)로 덮어써 좌표 전멸** = 톱니 패턴. nearby ok_count 5/25=484→5/26=115→6/01=423→6/02=100 붕괴 실증.
  - 세션 367 PR(#76)은 "최신행 1개만" 덮도록 좁혔으나 최신행 좌표는 여전히 매번 전멸(최신행 좌표 0/246키 실측). **세션 370 = 옵션 (a) 채택**: `mergePreserveCoords(newAgg, prevChildcare)` 헬퍼 신규(childcare-info.mjs export, jeju import) — UPDATE 직전 기존 최신행 facility 의 좌표/70필드를 stcode 기준 보존, 7필드만 신규 갱신. count/total_capacity/fetched_at 는 신규 집계값. info + jeju 양쪽 동시 적용(자매 동종 버그). 단위 테스트 5건 + 실 DB merge 실증(경기 과천시 좌표 58개 전수 보존). 화면(NearbyChildcareSection)·scoring 경로 불변, JSONB 스키마 불변.
  - 효과: 최신행이 항상 좌표 보유 → nearby 매칭이 매번 100 붕괴 없이 590+ 유지 + detail ~23일 재축적이 리셋되지 않아 좌표 커버리지 단조 증가. 사후 검증 = 머지 후 다음 info 발화 시 최신행 좌표 보유율 0%→상승(다음 세션 cron 관측).

- 🟡 **무순위 이벤트 로그 차수 노출** (세션 160 1차 적재 완료, 누적 1~2개월 후)
  - DetailModal 무순위 차수·이력 섹션 / AptCard 차수 배지 (count >= 2일 때만) / 시계열 차트 (MarketStatsCharts 패턴 재사용)
  - 트리거: 같은 apartment_id 2회+ 행 발생
  - **측정 스크립트**: `node scripts/monitors/applyhome-event-recurrence.mjs` (세션 168 박제)
  - 1차 적재 결과: 1263 events / 721 단지 보유 (단지당 평균 1.75 공고 — 시계열은 누적 후)
  - **세션 422 실측 정정 (2026-06-16)**: `applyhome-event-recurrence.mjs` 라이브 실행 = 1263 events / **고유 단지 1263개 / 단지당 평균 1.00회 / 2회+ 누적 단지 0개**. 박제 "721 단지/평균 1.75"는 stale. 충돌 키 `apartment_id,house_manage_no` 라 차수 누적 구조는 정상이나 아직 같은 단지 2번째 무순위 공고 미발생 → **차수 노출 작업 보류 유지** (스크립트 자체 판정 "📭 2회+ 단지 없음"). 트리거 = 다음 적재에서 2회+ 단지 ≥5개
  - **세션 423 재확인**: 손님 가치 UX 후보 평가 시 다시 검토 → 보류 유지 결정 동일 (트리거 미도달)
  - 참조: `docs/superpowers/specs/2026-05-02-applyhome-events-log-design.md` § 명시적 비-작업

- ✅ **collect-avg-income.mjs recorded_at 매칭 키 fix 완료** (세션 284 진단·정정)
  - 세션 283 가설 "의심도 낮음" 박제 = 환각, 실제로는 사고 확정
  - L191-195 UPDATE 매칭 키 `(region, gu=null)` → recorded_at 누락 → 매월 덮어쓰기
  - 정정: aggregateIncomeRows entries 에 `recorded_at: ${period}-01-01` 추가 + UPDATE-or-INSERT (population.mjs L237-261 답습)
  - vitest 19→20 (recorded_at 회귀 가드 1건 신규)
  - 매년 KOSIS 공표 시 신규 행 INSERT, 기존 행 보존 효과

- ✅ **CHILDCARE_API_KEY 운영계정 키 응답 확인** (세션 284 진단, 세션 283 박제값 stale 정정)
  - 세션 283 박제 ("NOT NULL 50건만") = stale. 세션 284 실측 = **606/770 (78.7%)**, 서울 강남구 163 facilities 박제 (50 한도 초과 = 운영키 응답 명백)
  - 운영키 갱신 자리 이미 완료 자리 (시점 불명, 다음 세션 진단 자리)
  - 잔여 사고 자리는 아래 🟡 신규 항목 (이름 표기 충돌)으로 이관

- ✅ **regions 18 비법정 자치구 행 DELETE 완료** (세션 284)
  - 정리 대상: 용인 3 + 창원 5 + 포항 2 + 전주 2 + 천안 2 + 청주 4 (총 18 행, recorded_at=2026-01)
  - 화성시 4 (효행/만세/동탄/병점, recorded_at=2026-03) 보존 — sex_age JSONB + crime_grade=4 자치구 단위 데이터
  - 정리 후: regions 770→752, unique 시군구 302→284, childcare NULL 58→40
  - 사후 검증: 표준 화성시 단일 행 (id=1332, 2026-03-01) 에 sex_age+crime_grade=3 별도 박제 자리 확인됨

- ✅ **collect-childcare 5/1 schedule run failure 정정** (세션 283 commit, 6/1 검증 대기)
  - 사고 A: 만강아파트 1건 Supabase statement timeout → exit 1 (raw log `gh run view 25232444155`)
  - 사고 B: Step 1 fail 시 Step 2 (시군구 집계) skip
  - 정정 A: `collect-childcare.mjs` Supabase upsert retry 2회 + 1% 임계값 (1건 fail 도 전체 fail 차단)
  - 정정 B: `collect-childcare.yml` Step 2 `if: always()` 추가
  - 검증: 6/1 schedule run conclusion=success + Step 2 시군구 집계 실행 박제 (다음 세션)

- 🟡 **regions.supply_ratio 0% — MOLIT API 사고 진앙 v3** (세션 323 → v3 정정)
  - v1 환각: "60분 timeout 부족 / 큐 충돌" — 폐기
  - v2 환각: "사용자 직접 cancel" — 부분 정답 (5/10 + 5/26 cancelled 자리), 단 진짜 0% 진앙 별
  - **v3 진앙 (실측 확정)**: 세션 323 workflow_dispatch 재발화 (run 26467919257, 5분 success) 결과 17 시도 100% fetchWithRetry 사고. raw MOLIT API 직접 호출 결과 = **HTTP 500 "Unexpected errors"** (data.go.kr 서버 사고)
  - endpoint: `https://apis.data.go.kr/1613000/ArchPmsService_v2/getApHsptPrmsnLst`
  - 본인 정정 불가 자리 = data.go.kr 외부 서버 사고. 4/10 success 직전 자리 후 5월 들어 100% 사고
  - 정정 자리 = (1) MOLIT API 정상화 자연 대기 (2) `gh workflow run "Housing Permits Data Collection"` 재발화 24h 간격 답습 (3) MOLIT 콘솔 자리 답습 (서비스 폐기 / endpoint 변경 가능성)
  - 6/10 schedule run 자연 답습 = MOLIT API 정상화 여부 자동 답습
  - **세션 403 화면 거짓 표시 정직화 완료**: 전 단지 supplyRatio NULL → api `?? 150` 비관적 폴백을 화면이 "공급량 150%" 실측값처럼 표시하던 거짓 정정. scoreRisk.ts 공급량/시공사재무 sub 가 `_fallbackSupplyRatio`/`_fallbackBuilderDebt` 플래그 읽어 "정보 없음"/"부채율 미수집" 정직 표시. **점수 불변**(비관적 폴백 정책 유지, 사장님 결정). 데이터는 여전히 MOLIT API HTTP 500 복구 대기 (6/11 raw 호출 재확인). 회귀 가드 = engine.test.js 신규 2건 (NULL→정직표시 + 정상값 회귀). builderDebtRatio NULL 도 동종 정정 동시 박힘.

- ✅ **regions.jeonse_rate 0% → 22.2% — 채움 collector 신규 (세션 324 PR #29 머지)**
  - 세션 323 환각 = "orphan 가능성" → 세션 324 실측 폐기 (naver-estate-web cross-repo 4 위치 활성 사용)
  - 정정 = `scripts/collectors/trade-stats-regions.mjs` 신규 (trade-stats.mjs 산식 시군구 단위 집계, 표본 ≥ 3 게이트)
  - 운영 검증 = workflow_dispatch run 26471102001 success → 168/758 (22.2%) 박힘
  - 잔여 590 시군구 = 표본 부족 (jeonse 거래 < 3) 농어촌 자리 자연 NULL

- 🟡 **6/5 collect-market-stats schedule run 검증** (세션 282 plan v6 가설 검증)
  - lookback 24개월 적용 후 (커밋 `b312d62`) 첫 schedule run = 6/5
  - 검증 자리: workflow run log 의 `분양가격지수: N건 응답, 17개 시도 매핑` + `[분양가격지수] DT_41401N_006 (M) 202406~202606 lookback=24개월` 출력 + conclusion=success
  - 가설 확정 시 = 사고 단일 해결 / fail 시 = TLS handshake 별도 plan 트리거
  - 참조: `~/.claude/plans/pwd-f-mibunyang-git-unified-starlight.md` v6 § 6/5 검증

- ✅ **DetailModal L82~85 Supabase 가드 환각** (세션 280 동반 커밋 `0557e1a` 정정 완료, 세션 283 stale drift 발견)
  - `0557e1a fix(detail): 가격배열 fetch 가드 정정 (undefined/null/배열 skip)` (MarketStatsCharts 작업 동반)
  - 현 본문 L87 `null || Array.isArray` → skip + L90 `!== undefined` → skip + undefined 만 fetch 발동
  - BACKLOG 박제값이 1주+ stale 자리 (`feedback_memory_not_authoritative.md` 답습)

---

## 🟢 여유

- ❌ **청약경쟁률 정렬 (competitionRate desc/asc) — 세션 423 폐기 (데이터 부족·의미 왜곡)** — 손님 가치 UX 후보 평가 시 라이브 실측: CR>0 715개(50.2%) 중 분양 진행단계(분양중·청약중·분양계획)는 **48개(7%)뿐**, 나머지 667개(93%)는 완료/과거(589)+미분양실패(78) → 끝난 청약경쟁률로 전체 줄세우면 이미 완판된 과거 단지가 상위 점령(미분양 전문 서비스 목적 정반대). 단위 비일관 치명적: 최댓값 437995·349071, CR>0 중 14.4%가 1000 초과 = N:1 비율 아닌 미가공 지원자수 아티팩트가 최상단 노출. null 705개(49.5%)도 바닥. **카드 배지(세션 422)는 active 48단지만 노출해 이미 의미 전달 중** → 정렬의 한계가치 낮음. 재오픈 트리거 = active-stage 한정 필터+정렬 결합 + 모집단 ≥100단지.
- ❌ **입주시기 필터 (즉시입주/N년내/예정) — 세션 423 폐기 (완전 중복)** — `moveInFilter`(classify.ts classifyMoveIn 3분류: 입주예정/미입주/입주완료)가 이미 전 스택 배포(useFilterSort URL `?movein=` 영속화·useDataPipeline leave-one-out 카운트·AreaPanel select UI·칩·filterPresets "신혼"·전용 테스트). 신규 버킷은 같은 축 이름만 다른 변형 → 무의미. 라벨 교체 시 classify.test/useFilterSort.test/filterPresets 동시 붕괴 + "미입주(준공 후 미분양)" 핵심 변별 신호 상실. 손님 가치 개선은 신규 필터 아닌 기존 select 라벨 보조설명("미입주 = 준공 후 미분양")이 더 적합(별 후보).
- ✅ **입주 빠른순 정렬 — 세션 424 완료 (PR #127, main 47517a9)** — 세션 423 보류 해소. 위 완료 색인 참조. **보류 시 우려했던 "과거 완공 상단 점령" 함정을 사장님 결정 "지금 들어갈 집 먼저"로 역이용**: 준공완료(=즉시입주 가능한 미분양)를 오히려 rank0 최상단에 둠. 적대검증 4에이전트가 1차설계(미래예정 먼저)의 라벨↔동작 충돌 반증 → 재설계. comparator `/^\d{6}$/` 정규식으로 "미정" 36건+null 일관 맨뒤 처리(보류 시 우려한 "미정 가드"). 표현계층만(점수·엔진 무변경).

- 🟢 **청약홈 Phase 2 — 날짜 정밀화 + drift 가드 — 세션 370 적대 검증으로 REFUTED (진행 안 함)**
  - 세션 354 등록 = `recruit_date` 53건 `YYYY-MM`(월만)을 청약홈 ISO 일정으로 정밀화 + `naver-presale.mjs` drift 가드.
  - **세션 370 정정 (DB 실측)**: (1) **두 recruit_date 혼동** — `apartments.presale_recruit_date`(유일 writer naver-presale.mjs:339, 화면 "분양시기")와 `presale_schedule_official.recruit_date`(writer collect-applyhome-detail.mjs:153, 별도 테이블/화면)는 서로 다른 컬럼. (2) **drift 가드 = 막을 대상 부재** — naver-presale 는 presale_schedule_official 미접근, collect-applyhome-detail 은 apartments base 컬럼 미수정(별도 테이블만 upsert) → 청약홈 ISO 가 presale_recruit_date 를 덮어쓰는 경로 0건. (3) **정밀화 = net-harmful** — 53건 중 청약홈 매칭 27건, 그 중 year+month 일치(안전) 11 / year 불일치(오염) 13(힐스테이트 탑석 2026-05→2022-06-17 등 2020~2022 과거값). naive fill 시 네이버가 정확히 잡은 "2026 분양 예정"을 과거로 오염. **진행하지 말 것** (세션 364 "5년 과거 매칭 오염" 재현).

- 🟢 **청약홈 Phase 3 — 경쟁률(미분양 시그널) + 외부 소스 확장** (세션 354 등록, **세션 365 검증 정정**)
  - 청약홈 잔여세대/경쟁률 → 미분양 시그널 (미분양 전문 서비스에 직접 가치)
  - **세션 365 정정**: 세션 364 "경쟁률 미시작 🟢"은 stale. 수집·점수 파이프라인 **작동 중** — `collect-applyhome.mjs:85-95` net(Σ신청/Σ공급) 계산이 청약홈 공식 CMPET_RATE와 단일평형 일치(불일치 0), DB 1261단지 중 1257(99.7%) 정확. `scoreRisk.ts:86` 0.09 가중치로 점수 반영 중. 극단값(디에이치 337818:1 등)은 무순위 줍줍 진짜 경쟁률(언론 일치, 오염 아님).
  - **✅ 화면 노출 = 세션 369 PR #78 완료** (main `991b12e`): 일반 상세(DataSections)에 "청약 경쟁 현황" 전용 섹션 신규(competitionRate/Supply/Applicants). 극단값 포맷 `fmtCompetitionRate` 공유 헬퍼(`src/lib/format.ts`, `>=1000:1` 정수+천단위 콤마 `437,995:1`)로 fieldMeta·scoreRisk 통일(drift 차단). 게이트 = `competitionRate != null` 단독 + `hideWhenEmpty`로 경쟁률 없는 49.5% 단지는 섹션 숨김(presaleStage 안 묶음 — 82% 누락 회피). 전체 vitest 3198 + tsc 0 + lint 0. AptCard 카드 배지는 미노출(요청 범위 밖). **세션 366 정정**: 세션 365 "competitionRate↔unsoldRate 시점 모순 41%(294단지)"는 무효 — unsoldRate 73%가 네이버 2차시장 재판매 밀도라 다른 시장·다른 시점, "모순"이 성립 안 함. 경쟁률은 과거 청약 수요 신호, unsoldRate는 현재 재판매 밀도로 서로 다른 축 → 동시 노출 시 "모순"이 아니라 "다른 정보"로 표기.
  - 외부 소스: LH(`15058530`)·경기도 미분양(`15057206`)·당첨가점(`15110812`) — 전부 data.go.kr **활용신청 미신청**(raw 확인). 진입 시 활용신청 선행 필요 `# 👤 사용자`

- 🟢 **scoreRisk 무순위 경쟁률 안전 채점 — 세션 366 적대 검증으로 "현행 정당" 확정 (수정 보류)**
  - 세션 365가 "`competitionRate >= 10 → 5(최고 안전)` = 미분양 서비스에서 역방향 가능성" 🟡 로 등록. 세션 366 "완화 캡(5→35)" plan 작성 → 사용자 "맹점 찾아라" → 6-probe 적대 검증(워크플로 w95e4eoul) + 직접 DB 실측으로 **plan 폐기, 코드 0**.
  - **데이터 반증 (REFUTED)**: cr>=10 단지 unsold_rate 중앙값 **14.3%** < cr 3~10 **31.8%** < cr 1~3 **21.5%**. 무순위 과열 단지가 **오히려 미분양이 덜 심함** → "과열=더 위험" 직관이 데이터로 뒤집힘. compSc=5(안전)가 오히려 정합. 동탄역 롯데캐슬 294만:1·디에이치 퍼스티어 337818:1 = 미분양 아닌 역대급 과열 인기(언론 일치).
  - **"86% 미분양 보유"는 의미 오해**: unsold_rate의 73%가 실은 네이버 2차시장 재판매 매물 밀도(`sync-naver-complex.mjs:474-477`, 매일 갱신)지 1차 청약 미분양 아님. unsold_rate>100% 단지 109개 = "미분양율"일 수 없는 증거. competitionRate(과거 청약)↔unsoldRate(현재 재판매)는 다른 시점·다른 시장 → "둘 다 있으면 모순" 불성립.
  - **정량 효과 무의미**: compSc 5→35 = invest 프로필조차 종합 -0.675/100점, 602단지 순위 변동 노이즈. busywork 신호.
  - **음수 구간은 죽은 코드 아님 (제거 금지)**: `scoreRisk.ts:92-93` 음수 분기는 최초 커밋 `38d40de`에서 "절벽 방지"용 의도 설계 + 마이그 `20260326000000` COMMENT 가 `<0: 미달비율`을 **DB 컬럼 계약**으로 명문화. 제거 시 회귀.
  - **진짜 검토 거리는 스코어링 아님** (별 작업): (a) AptCard "추가 모집" 빨강 배지가 competition_rate 무시하고 단순 존재로 켜짐 + applyhome_events 라이브 전부 eventCount==1 → 세션 366이 "진짜 모순 자리"로 의심. (b) competition_supply×unsold_rate 교차 분기 (probe3 권고). 둘 다 별 세션.
  - **세션 369·370 정정 (REFUTED, 코드 0)**: (a) AptCard 배지는 **모순 아님** — 데이터 출처 `collect-applyhome.mjs:24 BASE_URL=getRemndrLttotPblancCmpet`(잔여세대/무순위 경쟁률)라 모든 event 가 정의상 무순위 공고(=미분양 시그널). "추가 모집" 라벨은 원 분양 외 추가 모집 1건만으로 의미 정확(eventCount>=2 미요구). 빨강은 다른 경고 배지와 색 의미 일관. 스펙(2026-05-02-applyhome-events-log-design.md L51·L105)이 경쟁률↔무순위 공고 "합치지 말 것" + "추가 모집=가시 라벨" 명시. 세션 366이 든 두 신호(경쟁률 스냅샷 vs 무순위 시계열 이벤트)를 혼동. **세션 369 평가(정합) 유지가 정답.**

- 🟢 **KOSIS 를 Claude Managed Agents cron 으로 이전 검토 — 보류 (세션 397 공식 문서 조사)**
  - 동기: kosis.kr 해외 IP 차단으로 집서버 Windows 스케줄러 이전(세션 288~289). 앤트로픽 Managed Agents "scheduled deployment(cron)" 신기능(2026-06-09)으로 대체 가능한가.
  - **결론 = 보류**. 공식 문서 직독: (1) 기본 cloud sandbox 는 앤트로픽 관리 인프라(리전 `inference_geo` 미지원) → KOSIS 막힐 위험. (2) **self-hosted sandbox** 면 "network egress never leave your environment" = 집 IP(한국) 사용 가능하나 집서버에 worker(always-on `ant beta:worker poll` 또는 webhook-triggered SDK) 상주 필요(현 스케줄러는 새벽 1회 발화로 충분 = 더 단순). (3) Claude Code 구독과 별개 = **토큰 + 세션 실행시간 과금**($0.08/session-hour, ms 단위; 현 집서버+GH 무료). (4) 베타(`managed-agents-2026-04-01`). (5) KOSIS 수집기는 단순 fetch 스크립트 = AI 자율 판단 불필요 = 오버킬.
  - 재오픈 트리거: (a) Managed Agents GA + 한국 리전 egress 지원 (b) KOSIS 수집에 AI 판단(통계표 자동 선정 등) 필요 발생.
  - 출처: platform.claude.com/docs/en/managed-agents/{self-hosted-sandboxes,overview} · /about-claude/pricing

- 🟢 **fill-missing-data.yml 개명** (`backfill-new-apartments.yml`) + `monitor-collectors.yml` `workflow_run.workflows` 동기화 — spec Phase 3, 6/14 발화 2회 success 후 별도 PR (세션 307 spec out-of-scope)

- ✅ **register-naver-task.ps1 과잉 권한 정리 — `Highest` → `Limited` 코드 적용** (세션 359 발견 → 세션 368 PR)
  - `scripts/register-naver-task.ps1` 이 네이버 로컬 수집 스케줄러를 관리자 상승 토큰(`-RunLevel Highest`)으로 등록하던 것을 `New-ScheduledTaskPrincipal -LogonType Interactive -RunLevel Limited` 로 변경. 6단계 수집(HTTP fetch + Supabase upsert + 산술)은 일반 권한으로 충분 = 최소 권한 원칙 충족.
  - 실증 근거: 같은 PC 의 `naver-units-night` + `LuxuryResale_*` 작업 9개가 이미 Interactive+Limited 로 정상 동작 중(`Get-ScheduledTask` 실측). 네이버 수집은 한국 IP 로컬 PC 가 켜져 있어야만 의미 → 무인 부팅 실행 요건 없음 = Interactive 트레이드오프 무해. 추가 실측: `MibunyangNaverCollect` 작업이 현재 미등록 상태라 코드 변경이 운영에 즉시 영향 0(다음 등록부터 적용).
  - **👤 재등록은 사용자가 관리자 PowerShell 에서 1회 실행**: `powershell -ExecutionPolicy Bypass -File scripts\register-naver-task.ps1`

- ✅ **apartments.json 약 13.0MB 단일 파일 — 목록용 경량 분리** (세션 279 완료)
  - 분리: `apartments.json` 13MB 원본 유지 + `apartments-list.json` 1.66MB + `apartments-prices.json` 11.35MB 신규
  - DetailModal 첫 클릭 시 prices 11.35MB lazy fetch + 모듈 Map 캐시 (`useHistoryData` 패턴 답습)
  - Vercel Brotli 압축 후 실측: list **198KB** (-88.4%) / prices **858KB** (-92.6%)
  - 첫 LCP 페이로드: 1MB → **198KB** (~-80%)
  - 커밋: 6714fa7 (분리 코드 11 파일) + b57de6b (Vercel split + spec) + 7eb2a2e (.vercelignore whitelist)
  - 사고 박제: plan v2 자가 점검 #9 "npx vite build 안전" 환각 → Vercel prebuild VERCEL skip 으로 list/prices 미생성 → SPA fallback 사고 → split-apartments-json.mjs 신규 → .vercelignore whitelist 누락 → 2 단계 누적 정정
  - 참조: `docs/superpowers/specs/2026-05-20-apartments-json-split-design.md`

- 🟢 **eslint 9→10 메이저 업그레이드** (세션 272 IMPROVE 분석)
  - `npm outdated`: eslint 9.39→10.4, @eslint/js 9.39→10.0 (메이저 1개 뒤처짐). 그 외 React/Supabase/Vite 최신.
  - ⚠️ 위 🔴 "eslint 10 본 적용" 차단 항목과 동일 사안 — `eslint-plugin-react` peer 미지원으로 막힘.

- 🟢 **모바일 alertRow 6배지 줄바꿈 시각 회귀** (세션 160 발견)
  - 375px (iPhone SE) 에서 6개 배지(분양중/입주예정/미분양/시공사/혐오시설/추가모집) 동시 표시 시 alertRow 높이 측정
  - flexWrap 자동 줄바꿈 정상 작동 + 카드 높이 폭주 없음 확인
  - 트리거: 베타테스터 보고 또는 다음 UI 분기 점검
  - 참조: 12차 GATE 검증 (G8)

- 🟢 **W6-D 옵션 ε 후속 — regions.childcare → 스코어링 통합** (UI/scoring)
  - 별 세션 분할 권장. 가중치 의사결정 (PSR sub-score 입력 영향, 사용자 결정 필요)
  - regions JSONB → calcCats.ts 신규 scoreChildcare.ts 통합

- ✅ **transport-tago 단위 시간 2.1배 느림 root cause 분석** (세션 295 종결)
  - 진앙 자리 확정: 커밋 `01d0dd4` (2026-05-22 07:42) `limit(10000) → range 페이지네이션` 자리 — transport-tago L194 fetch 자리 1000 → 2001 단지 전체 답습
  - raw log 실측: 5/21 (1000 단지) 524 미수집 2281.7초 단지 당 **4.35초** / 5/22 (2001 단지) 1001 미수집 4476.5초 단지 당 **4.47초** — 단지 당 시간 3% 노이즈 (코드/API 결함 0)
  - 세션 294 timeout 90→120 fix = 정확한 정정 자리 (회귀 자리 없음, 의도된 단지 수 자리)
  - 답습 자산: `.claude/rules/collectors/collector-timeout-rootcause-analysis.md` 신규 (4-way 답습 의무 박제)
  - 진단 사고: v1 환각 "단지 폭증 (네이버 신규)" → `apartments.created_at` 실측 30일 신규 0 → v2 정정 (`git log -- <collector>` 답습 후 진앙 자리 확정)

- 🟢 **모바일 저사양 단말 OOM 위험** (세션 279 발견, 본 PR 부수)
  - prices.json 11.35MB 모듈 Map 캐시 영구 보존 (1557 단지 × 4 배열). SPA 종료까지 메모리 반환 0
  - 512MB RAM 단말 + 긴 세션 시 OOM 가능성
  - 대안: LRU 캐시 + TTL or sessionStorage 위임
  - 트리거: 사용자 OOM 보고 또는 다음 분기 점검

---

## 📦 KOSIS 추가 데이터 보강 (세션 232 분석, 총 20 후보 중 #1~#6·#9~#13 종결 → 9 잔여)

> Agent 분석 출처: 세션 232 brainstorming (Bash 검증 + KOSIS WebFetch 8 페이지).
> **#1·#2·#3·#4·#5 + #6·#9·#10·#11·#12·#13 종결** → 위 완료 색인 / [BACKLOG_ARCHIVE.md](BACKLOG_ARCHIVE.md) 📦 섹션.
> 잔여 = #7·#8 (시군구 다차원, 추정값 부정확) + 🟢 14~20.

### 🔴 즉시 가치 — 전건 종결

매매가격지수(#1, 세션269) / 전세가격지수(#2, 세션270) / 합계출산율(#5, 세션266)
모두 완료 → 위 완료 색인. 박제값 정정:

- 매매(#1) 저장 위치 = `regions.market_stats` JSONB 아닌 `market_stats_history.sale_price_index` 컬럼
- 전세(#2) 통계표 = BACKLOG 추정 `DT_40803_N0001`(objL 차원 누락 부적합) 아닌
  `DT_30404_B013`(동향조사 유형별 전세가격지수, C1='아파트', 월간). 세션270 raw API 검증
- 전세(#2) 저장 위치 = `market_stats_history.jeonse_price_index` 신규 컬럼 (월간 base_month)

### 🟡 곧 (#7·#8 — 추정값 부정확, 진입 시 통계표 재선정 필수)

세션 271 raw API 검증 결과 BACKLOG 추정 통계표가 둘 다 부정확. 진입 plan v1 작성 시
KOSIS 통계표 검색 API(`statisticsSearch.do`)로 재선정 + raw sample 차원 검증 의무.

| # | 후보 | 추정값 (부정확) | 정정 메모 |
|---|---|---|---|
| 7 | 연령 5세별 인구 (시군구) | `DT_1B040M5` | 실재하나 성×연령×지역 3차원 — itmId/objL 정확 코드 없이 KOSIS `err 21`. KOSIS 메타 API 가 OpenAPI 키로 차단(SESSION_LOG L5538) → 사용자 콘솔 통계표 정보 페이지 의존 |
| 8 | 가구원수별 가구 (시군구) | `DT_1JC1517` | 부정확 — 실제는 "가구주 성·연령·**세대구성별**". 가구원수는 `DT_1JC1502`(읍면동)/`DT_1JC1511`(가구주 연령+가구원수). 1인가구 비율은 `DT_1PL1502` 등 별도 |

> #6·#9·#10·#11·#12·#13 = 완료(세션 267 의료 묶음 / 세션 271 경제·교육 묶음).
> #13 실업률 통계표 = BACKLOG 추정 `DT_1DA7004S`(경제활동인구) 아닌 `DT_1DA7104S`
> (성별 실업률, prdSe='Y'+objL2='0'). 세션 271 raw API 검증.

### 🟢 여유 (7건)

| # | 후보 | 통계표 추정 | 활용 위치 |
|---|---|---|---|
| 15 | 자가보유율 (시군구) | 인구주택총조사 內 (orgId=101) | regions.home_ownership |
| 16 | 산업구조 (제조/서비스 비중) | `DT_1IO1004` 후보 (orgId=101) | regions.industry_mix |
| 17 | 가구소득 5분위 격차 | 가계금융복지조사 內 (orgId=101) | regions.income_inequality |
| 18 | 출생아수 (시군구) | `INH_1B8000F_01` (orgId=101) | regions.birth_count (#5 보완) |
| 19 | 외국인 거주인구 (시군구) | 인구주택총조사 內 (orgId=101) | regions.foreign_resident_ratio |
| 20 | 시도별 종별 요양기관 | `DT_MIRE01` (orgId=354 건보공단) | regions.medical_facility_count |

### ❌ 충분 / 불필요 (이미 수집 또는 ROI 낮음)

- 시도별 ㎡당 평균 분양가격 (`DT_41401N_005`) — `collect-market-stats.mjs` 이미 수집
- 시군구별 미분양 (`DT_MLTM_2082`) — `collect-unsold-kosis.mjs` 이미 수집
- 시군구별 이동자수 (`DT_1B26001_A01`) — `migration.mjs` 이미 수집
- 시도별 1인당 개인소득 (`INH_1C96_04`) — `collect-avg-income.mjs` 이미 수집
- 시도별 범죄안전등급 (구 #14 후보) — `data/crime-safety-index.csv` + 세션243 W6-E `collect-crime-safety.mjs` 가 이미 시도+시군구 매칭. regions.crime_grade 758행 중 701행 (92%) 채움 (시도 76 + 시군구 625). KOSIS DT_13501N_A120 신규 collector = 불필요. NULL 57행 진짜 잔여 = CSV 갱신 (연1회 수동) 또는 행정구역 개편 분구 18행 보강 (별 자리) (세션 315 자가 점검 1 발동 결과)
- 청약 경쟁률 — `collect-applyhome.mjs` presale 무순위로 충분
- 교통사고율 / 자연재해율 / 학생당 교사수 — ROI 낮음 또는 NEIS 로 산출 가능

### 활용신청 단위 (세션 102 박제 패턴 답습)

- 통계청 KOSIS 는 **인증키 1개로 신청한 통계표 다건 동시 호출 가능** (세션 102: `KOSIS_MIGRATION_KEY` = `DT_1B26001_A01` 신청 후 발급. 같은 키로 다른 통계표 호출 시 활용신청 추가 의무 가능성 — 다음 plan v1 에서 KOSIS 콘솔 활용신청 목록 직접 확인)
- 권장: 키 발급 1회 + 활용신청은 통계표마다 별도 1회 묶음 (단일 키 - 여러 통계표 통과 후 본 키만 GitHub Secret 1건 등록)

### 추천 진행 순서 (별도 plan 작성 의무)

> #1~#6·#9~#13 종결 (#1 세션269, #2 세션270, #3 unmatched, #4 세션259, #5 세션266,
> #6·#9·#10·#13 세션271, #11·#12 세션267). orgId=408 키는 `KOSIS_KEY` 로 호출 가능.

1. **#7·#8 (잔여 🟡)**: 시군구 다차원 통계 — 추정값 부정확, 진입 시 통계표 재선정 +
   raw sample 차원 검증 필수. 메타 API 차단으로 사용자 콘솔 의존 가능성.
2. **Phase 4 (🟢 14~20)**: 우선순위 낮음, 사용자 요청 시 진입

---

## 미해결 정책 메모

- **혜택 10컬럼 100% NULL** = 시행사 수기 입력 대상. 자동 수집 대상 아님
- **시군구 소득 PoC** = 세션117 C 공식 확정. 재오픈 트리거 4개 발동 전 유지
- **HpPermitService** = 세션139 미구독 확정. 재오픈 트리거 3종은 `scripts/CLAUDE.md` 박제
- **방향 B (단지별 미분양 API)** = 세션158 자료조사 완료, **부재 확정**. 공식 통계 전부 시군구 단위(KOSIS DT_MLTM_2082, 국토부 통계누리 hRsId=32, R-ONE), 단지별 공개는 대구 1곳뿐. 청약홈 OpenAPI(15098547)는 단건 스냅샷, HUG 월별 사업장(15012530)은 공정률만. KOSIS 비례배분(`calcProportionalUnsold`)이 현재 최선. **재오픈 트리거 2종**: (1) HUG 15012530 응답 샘플에서 미분양 필드 발견 시 (2) 청약홈 무순위 공고 누적으로 단지별 이벤트 로그 가공 PoC 제안 시

---

## TS 부트스트랩 baseline (세션 172, 2026-05-03)

- **cold typecheck**: 2.716초 (`tsc --noEmit`, .tsbuildinfo 삭제 후)
- **incremental typecheck**: 2.366초 (캐시 적용)
- **30초 임계값** 대비 충분 안전. M1 진입 시 .ts 파일 늘어 5~10초 예상, 30초 초과 시 `tsc -b` 도입 검토 트리거 (spec § M0-12)

## TS M0 후속 — vitest 4 projects 마이그레이션

- ✅ **`environmentMatchGlobs` → `projects` 마이그레이션 완료** (세션 348) — 상세 = [BACKLOG_ARCHIVE.md](BACKLOG_ARCHIVE.md) 색인 참조

## 🟢 네이버 지도 후속 (세션 435 — 라이브 동작 후 개선 후보)

- **네이버 마커 1424개 클러스터 성능 실측** — 클러스터(MarkerClustering.js)로 묶이나 저사양 모바일 전국 줌에서 버벅임 가능. 실측 후 gridSize/maxZoom 튜닝 검토. (카카오는 내장 클러스터러라 검증됨)
- **Vercel Preview 환경변수 `VITE_NAVER_MAP_CLIENT_ID`** — production·development는 추가됨. Preview는 vercel CLI 가 git-branch 인자 요구(action_required)라 미추가. PR 미리보기에서 네이버 지도 필요 시 Vercel 대시보드에서 수동 추가.
- **색칠(choropleth)·인프라 오버레이 네이버화** — 1차 범위 밖(카카오 고정). 네이버 점 보기만 토글. 폴리곤(kakao.Polygon)·로컬검색(kakao.services categorySearch)이 네이버 v3 API 차이 커 거대 작업. 손님 요구 시 별 세션.
