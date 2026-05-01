# 미분양 아파트 비교 엔진 v3.0

> React 19 SPA + Supabase PostgreSQL + Vercel Serverless. 6개 카테고리 41+ 지표 AHP 스코어링.

## ⚠️ 사용자에게 말할 때는 무조건 쉬운 말로

글로벌 `~/.claude/CLAUDE.md`의 "쉬운 말 원칙"을 이 프로젝트에서도 그대로 따른다.
**대화창에 쓰는 모든 자연어는 초등학생도 알아들을 수 있게 풀어 쓴다.**

이 프로젝트에서 자주 등장하는 어려운 단어 → 쉬운 말 짝:

| 어려운 말 | 풀어 쓴 표현 |
|---|---|
| role / 역할 | "회원 종류 (일반 사용자 / 전문가 / 관리자)" |
| 탭 라우팅 / setTab | "어느 화면으로 보낼지 정하기" |
| JWT / 토큰 | "로그인 출입증" |
| OAuth / 콜백 | "카카오에 로그인 맡기고 결과 받아오기" |
| KV / 캐시 | "잠깐 저장해두는 메모장" |
| 리팩토링 | "기능은 그대로 두고 코드만 정리" |
| inline style 호이스팅 | "여기저기 흩어진 디자인 값을 한곳에 모으기" |
| RLS / 정책 | "DB에서 누구한테 보여줄지 정한 규칙" |
| 9 GATE | "위험 9가지 미리 체크" |
| 5교차검증 | "다섯 가지 관점으로 다시 보기" |
| 수집기 / collector | "공공·외부 사이트에서 자료 가져오는 스크립트" |
| 멱등성 | "여러 번 돌려도 결과 같음" |
| 마이그레이션 | "DB 구조 바꾸는 작업" |
| dedup | "중복 제거" |

규칙 적용 범위는 글로벌과 동일:
- ✅ 적용: 사용자에게 보내는 한국어 문장, 옵션 비교, 결론, AskUserQuestion 질문
- ❌ 미적용: 코드, 주석, 커밋 메시지, 변수명, bash 명령, 플랜 파일의 기술 섹션

**사건 기록 (2026-04-30 세션153):** 베타테스터 "카카오 로그인 후 전문가 화면" 보고를 조사한 뒤 결과를 보고할 때 "JWT 발급", "kakao:{id} 역참조", "ADMIN_EMAIL 오버라이드", "탭 라우팅" 같은 표현을 그대로 사용. 사용자 "쉽게 이야기해줘" 재지적. 글로벌 규칙은 있지만 이 프로젝트 단어들은 따로 풀려 있지 않아 같은 실수 반복 위험 → 프로젝트 CLAUDE.md 맨 위에 박제.

## 현재 진행 상황


> 세션별 상세는 [.claude/SESSION_LOG.md](.claude/SESSION_LOG.md) 완전 보존. 이 섹션은 스캔용 색인.

### 최근 3세션 (상세)

**세션155 (2026-05-02)** — 색칠 지도 UI 2단계 시군구 251 폴리곤 + 합산 매핑 + 줌 자동 전환 (4커밋 origin/main `f405c11..6e68722`)
- 실행 플랜 [cd-f-mibunyang-pwd-fancy-lobster.md](C:\Users\user\.claude\plans\cd-f-mibunyang-pwd-fancy-lobster.md). 1차 🟡 GATE 3/8 → 2차 🟢9/🟡0/🔴0
- **배경**: 색칠 지도 3 세션 분할 마지막. 153(자료 박제) → 154(시도 17) → 155(시군구 251 + 자동 드릴다운). 베타테스터 "특단의 조치" 정면 종결
- **사용자 결정 4건**: 지금 바로 / 줌 ≥9 자동 전환 / 창원(5)·청주(2) 합산 / 데이터 0건 회색 0.2
- **Phase 1 실측 발견**: sigungu.geojson 251 features (Poly 233 + Multi 18). code 5자리 prefix 2자리 = SIDO_CODE_TO_DB 17키 100% 일치. **일반시 12개 구 분할 33 polygon** (고양·부천·성남·수원·안산·안양·용인·전주·창원·천안·청주·포항) → DB regions.js gus 시 단일 표기 일치 → 정규식 `/^(.+?시)[가-힣]+구$/` 자동 합산
- **커밋 1 `f405c11`** (2파일 +78줄): [src/lib/geoJsonGuToDbKey.js](src/lib/geoJsonGuToDbKey.js) — `geoSigunguToByGuKey(feature)` 헬퍼. code prefix → SIDO_CODE_TO_DB → region (동명이구 7개 안전). name "XX시YY구" → 일반시 12개 합산. 6 테스트 (창원 5구 → 모두 "경남|창원시" / 동명이구 / null 가드)
- **커밋 2 `a122c64`** (1파일 +99줄): [ChoroplethSigunguOverlay.jsx](src/components/sections/ChoroplethSigunguOverlay.jsx) — 시군구 폴리곤 오버레이. fetch `/geo/sigungu.geojson` 1회 → 251 폴리곤. byGu[key].avg → gr().c, 데이터 없으면 회색 0.2. 시도(0.65/0.25)보다 옅게 0.55/0.2. click → setBounds + onGuClick(byGuKey)
- **커밋 3 `83d0fc0`** (1파일 +115줄): ChoroplethSigunguOverlay 6 테스트. **창원 5구 합산 검증** (5 features 입력 → 5 polygon 모두 같은 키 콜백)
- **커밋 4 `6e68722`** (2파일 +95/-3, ChoroplethView 108→154줄): [ChoroplethView.jsx](src/components/sections/ChoroplethView.jsx) — `level` useState + `showSigungu = level <= 8` + `zoom_changed` 리스너 useEffect (cleanup `removeListener` 옵셔널) + 시도 useEffect 첫 줄 `if (showSigungu)` 가드 + 의존성 배열 추가 + 렌더에 SigunguOverlay Suspense lazy. 추가 3 테스트
- **5교차검증**: null-safety-checker 🟢 PASS (High/Med 0, Low 3 false positive — `mapInstance.getLevel` typeof 가드 / byGu 객체 참조 deps 성능만 / showSigungu race 는 polygonsRef 분리로 불가능) / vite build 🟢 429ms (ChoroplethSigunguOverlay 별도 lazy chunk) / Hook 메인 🟢 / 보안 메인 🟢 (innerHTML/eval 0건)
- **검증**: 156 files / **2489 tests PASS** (세션 154 154/2474 → +2 files / +15 tests 정확 일치)
- **사용자 가치**: 🟢 직접 — 색칠 모드 + 줌 ≥9 시 시군구 251 자동 노출. 시도 → 시군구 → 단지 마커 3단계 자연스러운 드릴다운 완성
- **누락 작업 의도적 박제 2건**: 줌 임계값 히스테리시스/디바운스 미적용 (실 영향 미미) / removeListener 미지원 SDK fallback (누수 미미)

**세션154 (2026-05-02)** — 색칠 지도 UI 1단계 시도 17개 폴리곤 + 토글 + 줌인 (6커밋 origin/main `3fc32e0..b7974ff`)
- 실행 플랜 [cd-f-mibunyang-pwd-fancy-lobster.md](C:\Users\user\.claude\plans\cd-f-mibunyang-pwd-fancy-lobster.md). 1차 9 GATE 🔴 GATE 0 + 🟡 GATE 1/3/8 → 5단계 재분할 + 4건 보강 후 2차 🟢9/🟡0/🔴0 통과
- **배경**: 세션 153 색칠 지도 3 세션 분할의 **2단계 UI 구현**. 베타테스터 "지도 어처구니없다 / 특단의 조치" 보고 정면 대응. 사용자 결정 (AskUserQuestion 2건): 마커 완전히 숨김 + 폴리곤 클릭 시 줌인 + 점 보기 자동 복귀
- **9 GATE 1차 발견**: `src/utils/` 디렉토리 부재 (실측 `src/lib/`) / `MapView` 가 `App.jsx:11` 에서 lazy import 중인데 ChoroplethView 도 같은 패턴 적용 누락 / fetch 중 SkeletonText 누락 / Suspense fallback 누락
- **커밋 1 `33496cc`** (2파일 +95줄): [src/lib/geoJsonToKakaoPaths.js](src/lib/geoJsonToKakaoPaths.js) — `geoJsonFeatureToKakaoPaths(feature, kakao)` 헬퍼 (Polygon → 1 path / MultiPolygon → N path / hole 무시 / [lng,lat]→LatLng(lat,lng) 뒤집기). 테스트 4 케이스
- **커밋 2 `8020a19`** (1파일 +55줄): [ChoroplethLegend.jsx](src/components/sections/ChoroplethLegend.jsx) — 6단계 색 박스 범례. gr() 점수 95/85/75/65/55/45 호출 후 S/A/B+/B/C/D 라벨. isPC/isDesktop 분기 fontSize/padding/box. role=img + aria-label
- **커밋 3 `c6b28fd`** (1파일 +106줄): [ChoroplethView.jsx](src/components/sections/ChoroplethView.jsx) — 본체. fetch `/geo/sido.geojson` 1회 → 시도 17 폴리곤 색칠. byRegion[dbName].avg → gr().c, 데이터 없으면 회색 0.25. click → setBounds + onSidoClick(dbName), hover 0.65→0.85, mouseout 복귀. unmount cleanup
- **커밋 4 `6806194`** (1파일 +128줄): ChoroplethView 8 테스트 (fetch · 폴리곤 · 이벤트 · cleanup). kakao 이벤트는 DOM 이벤트 아니라 `kakao.maps.event.addListener` 콜백 → fake event registry 만들어 handler 직접 호출
- **커밋 5 `0c612ce`** (2파일 +91/-6, MapView 158→196줄): [MapView.jsx](src/components/sections/MapView.jsx) — `mode` useState ("point"|"choropleth") + 좌상단 [🎨 색칠]/[📍 점] 토글 버튼 (aria-pressed, aria-label) + 마커 useEffect 가드 (색칠 모드 시 clusterer.clear) + lazy + Suspense fallback null. handleSidoClick = setMode("point") (setBounds 는 ChoroplethView 내부)
- **커밋 6 `b7974ff`** (1파일 +2/-1): null-safety-checker Medium/Low 보강 — `(geoData.features || [])` (외부 정적 GeoJSON 신뢰 회피) + `if (path.length === 0) continue` (빈 path setBounds 방어)
- **5교차검증**: null-safety-checker 🟢 (High/Medium 0 본질, Low 4건 중 2건 즉시 보강) / vite build 🟢 418ms (MapView 9.41→10.57KB +1.16, **ChoroplethView 4KB 별도 lazy chunk**) / Hook 메인 🟢 (호출 순서 정합 mode 추가 후) / 보안 메인 🟢 (innerHTML/eval/dangerouslySetInnerHTML/new Function 0건)
- **검증**: 154 files / **2474 tests PASS** (세션 153 152/2458 → +2 files / +16 tests 정확 일치)
- **사용자 가치**: 🟢 직접 — 베타테스터 "지도 어처구니없다" 정면 대응. 좌상단 토글 클릭 → 시도 17개 폴리곤 평균 점수 색칠 + 우하단 범례 + 폴리곤 클릭 자동 줌인. 데이터 0건 시도 회색 0.25
- **다음 세션 155 (3단계 시군구)**: 251개 폴리곤 + 창원 5구·청주 2구 합산 매핑 + 동적 import + 줌 레벨 감지

**세션153 (2026-05-02)** — 색칠 지도 기반 자료 (GeoJSON 2 + 매핑 + 평균 점수 훅) (4커밋 origin/main `3be8865..3fc32e0`)
- 베타테스터 "지도 어처구니없다 / 특단의 조치" 보고 후 색칠 지도(코로플레스) 3 세션 분할의 **1단계 자료 박제**. UI 변경 0
- 4커밋: 쉬운 말 규칙 박제 / 전문가 로그인 시 지도 메뉴 노출 / CSP daumcdn 화이트리스트 (카카오 SDK) / GeoJSON 2개(시도 17 + 시군구 251) + regionGeoMapping 17개 + useRegionAverages 훅 + 테스트 5
- **검증**: 152 files / 2458 tests PASS (+5 useRegionAverages)

**세션152 (2026-04-30)** — WeightEditor inline style → WE_S 6키 호이스팅 (1커밋 origin/main `3738dfe`)
- 실행 플랜 [cd-f-mibunyang-pwd-clever-cherny.md](C:\Users\user\.claude\plans\cd-f-mibunyang-pwd-clever-cherny.md). 9 GATE 🟢9/🟡0/🔴0 (서브에이전트 2개 병렬: GATE 1 영향범위 + GATE 5 보안 grep 실측, 메인 GATE 0/2/3/4/6/7/8 직접)
- **배경**: 4/30 학교알리미 D-Day 당일이지만 사용자 프로브 실행 전 외부 대기 윈도우. 박제 "WeightEditor 100줄 정적 4건 67%" 가용 후보 중 최고 가성비. 세션149~151 패턴 5번째 적용
- **GATE 1 실측 4확인**: WeightEditor 외부 import 2곳(AdminDashboard:4, test:3) / WE_S 명명 충돌 0 / 테스트 toHaveStyle 0건 → 0수정 / 자식 prop 미수신 / theme import 순환 0
- **커밋 `3738dfe` (1파일 +19/-9, 100→110줄)**: [WeightEditor.jsx](src/components/admin/WeightEditor.jsx) — `const WE_S = {...}` 6키 모듈 스코프 정의 + 6건 inline → 객체 참조 치환
  - **WE_S 6키**: container/title/tabRow/tabBadge (정적 4) + tabButtonBase/validationBase (스프레드 베이스 2)
  - **정적 4건 단순 치환**: L51→container / L52→title / L55→tabRow / L67→tabBadge
  - **동적 2건 부분 호이스트**: L60-65 `{ ...WE_S.tabButtonBase, fontWeight, background, color, border }` (active 의존 4동적) + L88-92 `{ ...WE_S.validationBase, background, color }` (sum===100 의존 2동적)
- **inline 누적 5 컴포넌트 85→29 (-66%)** ⭐ — 세션149 HS_S 13키 + HM_S 12키 + 세션150 DM_S 13키 + 세션151 DS_S 14키 + 세션152 WE_S 6키 = 58정적 호이스팅 + 잔여 27 동적 보존
- **5교차검증**: null-safety-checker 비해당 / 빌드 🟢 423ms (AdminDashboard 27.65KB 불변) / 회귀 🟢 (151 files / 2453 tests PASS, WeightEditor 14케이스 0수정) / lint 🟢 clean / 보안 🟢 (DB 변경 0, 권한 부모 gating)
- **GATE 4 grep 재검증**: `style={{` 잔존 2건 (스프레드 동적 2건만) + `WE_S.` 매치 8건 (6키 전부 사용)
- **검증**: 151 files / **2453 tests PASS** (세션151 베이스라인 정확히 유지)
- **사용자 가치**: ⚪ 간접 — 정적 호이스팅 미세 성능 개선 + 디자인 토큰화 토대
- **교훈 3건 추가 (세션151 23건 + 3 = 26건)**:
  24. **외부 대기 윈도우의 가성비 활용** — 4/30 D-Day 당일 프로브 실행 전 30분 윈도우에 안전한 소작업 1건 완료. 박제 메모 가성비 67% 가용 후보 중 최고
  25. **9 GATE 서브에이전트 2병렬 효율성** — GATE 1 + 5 Explore 동시, 메인 7게이트 직접. 폴링 금지 규칙 준수
  26. **세션 누적 패턴 5번째 반복 안정화** — HS_S → HM_S → DM_S → DS_S → WE_S 4파일 검증된 컨벤션(`*Base` 접미사 + 의미 기반 키) 정착. 신규 컴포넌트 즉시 적용 가능

**세션151 (2026-04-29)** — DataSections inline → DS_S 14건 호이스팅 + collect-market-stats 시계열 복구 (2커밋 origin/main `2f32aaf..f448edb`)
- 실행 플랜 [cd-f-mibunyang-pwd-harmonic-rossum.md](C:\Users\user\.claude\plans\cd-f-mibunyang-pwd-harmonic-rossum.md). 9 GATE 🟢18/⚪2/🔴0 (서브에이전트 2개 병렬: GATE 1/5/6 grep 실측 + GATE 2/3/4/7/8 정합성, 🟡 1건 ROLLBACK 주석 보강 후 전통과)
- **배경**: 세션149~150 inline 호이스팅 패턴 (HS_S/HM_S/DM_S) 1세션 더 확장 + 박제 메모 vs 실측 차이 2건 발견 후 수정
  - 박제 1순위 SearchFilterBar(38%)/AptCard(35%) 모두 가성비 낮음 → 실측 가성비 최고 **DataSections 83% (15정/3동)**
  - 박제 "collect-market-stats reader 부재" 잘못 → 실측 **5건** (scorePrice avgPriceSqm/priceIndex/landCostRatio + scoreRisk newSupply/initialSaleRate, latest_regions CTE 통해 노출). 시계열 복구 가치 🟢 상승
- **사용자 결정 (AskUserQuestion 2건)**: 진행 방향 = "DataSections + market-stats" / Reader 범위 = "B안: 수집기+테이블만, reader 다음 세션"
- **커밋 1 `2f32aaf` (1파일 +44/-24, 순증 +20)**: [DataSections.jsx](src/components/detail/DataSections.jsx) — `const DS_S = {...}` 14키 모듈 스코프 정의 + 14건 inline → 객체 참조 치환
  - **DS_S 14키**: container/toggleHead/toggleTitle/body/subBlock/sectionTitle/subSectionTitle/highlightRowBase/grid/gridCell/gridLabel/gridValueBase/emptyText/link/footer
  - **동적 4건 보존**: L78 rotate(showData) / L86 marginTop(si>0) / L90 marginBottom(section.grid) / L106·L124·L135 color 부분 호이스트
  - **부분 호이스트 4건**: `{ ...DS_S.gridValueBase, color: <expr> }` + `{ ...DS_S.highlightRowBase, marginBottom: <expr> }` 패턴
- **커밋 2 `f448edb` (3파일 +128/-3)**: collect-market-stats 시계열 복구
  - [supabase/migrations/20260429000000_create_market_stats_history.sql](supabase/migrations/20260429000000_create_market_stats_history.sql) **신규** (region/gu/base_month + 5지표 wide format, UNIQUE COALESCE(gu,'') + RLS Public read+Service write + ROLLBACK 주석 5줄)
  - [collect-market-stats.mjs](scripts/collectors/collect-market-stats.mjs) parseAllPeriodsByRegion 신규 export + historyMap merge (지표 루프 안) + main() 말미 upsertBatch + recordApiQuota(KOSIS_KEY, 5)
  - [collect-market-stats.test.mjs](scripts/collectors/collect-market-stats.test.mjs) parseAllPeriodsByRegion 5케이스 추가 (월간 3개월/분기 5자리/포맷 위반/REGION_MAP 매핑 실패/DT NaN)
- **dry-run 실측**: `market_stats_history: 134건 예상` (5지표 wide merge), recordApiQuota dryRun 가드 작동
- **분기 PRD_DE 응답 6자리 발견** (예: `202504`) — 요청은 5자리(`20262`) 보내지만 응답은 월간 형식. 정규식 `/^\d{6}$/` + `/^\d{5}$/` 둘 다 두어 회귀 0
- **병존 정책**: 기존 extractLatestByRegion + regions UPDATE 0수정. apartments_flat VIEW · latest_regions CTE · scorePrice/scoreRisk reader 5건 회귀 0
- **inline 누적 3 컴포넌트 78→27 (-65%)** ⭐ — HeaderSection 34→9 / DetailModal 29→15 / DataSections 18→4 (= 세션149 HS_S 13키 + HM_S 12키 + 세션150 DM_S 13키 + 세션151 DS_S 14키)
- **9수집기 쿼터 로깅 누락 1건 해소** — 세션137 schools-neis 와 동일 패턴 (collect-market-stats recordApiQuota 0건 → 5건/회)
- **5교차검증**: null-safety-checker 🟢 (단계1: High/Med 0, Low 3 false positive / 단계2: High/Med 0, Low 3 변경 무관) / collector-contract 🟢 (C1~C5 + 추가 4항목 PASS, conflictCol UNIQUE 일치) / 빌드 🟢 433ms (DetailModal 49.98KB 불변) / 보안 🟢 (KOSIS_KEY env 이름만 DB 기록)
- **검증**: 151 files / **2453 tests PASS** (세션150 2448 → +5)
- **사용자 가치**: ⚪ 간접 — DataSections inline 정적 호이스팅 미세 성능 + market_stats_history 시계열 누적 시작 (134건/회). reader는 다음 세션 차트 컴포넌트로
- **migration 사용자 과제**: Supabase Dashboard SQL Editor 수동 실행 필요 (CREATE TABLE 성공 후 다음 cron 5/5 부터 데이터 누적 시작)
- **교훈 6건 추가 (세션150 17건 + 6 = 23건)**:
  18. **박제 메모 vs 실측 차이 발견 가치** — 우선순위 박제 메모(SearchFilterBar 1순위)를 그대로 따랐으면 가성비 38%로 시간 낭비. 실측 grep + 라인 매핑으로 DataSections 83% 발굴
  19. **세션 사이 사실 검증 가치** — 세션135 박제 "collect-market-stats reader 부재" 가 실측 5건. 박제는 시점 정보, 실행 전 재검증 필수
  20. **2도메인 동시 진행 시 커밋 분리 원칙** — inline 호이스팅(렌더링) + 시계열 복구(수집기) 도메인 독립이라 한 세션 내 가능, 단 커밋·머지 분리로 revert 단위 명확
  21. **9 GATE 서브에이전트 병렬 검증** — GATE 1/5/6 (grep 실측) + GATE 2/3/4/7/8 (정합성) 두 에이전트 동시 기동, 메인은 GATE 0 자체 검증. 폴링 금지 규칙 준수
  22. **분기 API 응답 포맷 추정 vs 실측 차이** — KOSIS prdSe=Q 요청 PRD_DE 가 5자리(`20262`)로 보내도 응답은 6자리(`202504`). dry-run 1회 inspect 가 정규식 안전성 즉시 확인
  23. **API 호출 0증가 시계열 복구** — 동일 `rows` 두 함수(extractLatestByRegion + parseAllPeriodsByRegion) 재파싱으로 KOSIS 쿼터 0증가. 세션134 collect-unsold-kosis 동일 패턴

**세션150 (2026-04-29)** — DetailModal inline style → DM_S 14건 호이스팅 (세션149 HS_S/HM_S 패턴 직속 후속) (1커밋 origin/main `dbe0b90`)
- 실행 플랜 [cd-f-mibunyang-pwd-sparkling-lecun.md](C:\Users\user\.claude\plans\cd-f-mibunyang-pwd-sparkling-lecun.md). 9 GATE 🟢9/🟡0/🔴0 (서브에이전트 2개 병렬: 영향범위 grep + 보안 실측)
- **배경**: 4/30 학교알리미 D-1 시점에 80줄 이내 안전 작업 적합. 분리 후보 3개(DetailModal 29 / SearchFilterBar 12 / AptCard 17) 중 가성비 최고인 DetailModal 단독 진행. market-stats 시계열 복구는 reader 부재로 우선순위 낮음
- **GATE 4 정정**: Plan 에이전트 "12건 확정" 보고 후 영향범위 grep 실측에서 L91 metricsLabel 정적 1건 누락 발견 → 14건 자연 확장 (80줄 예산 여전히 안전)
- **커밋 `dbe0b90`** (1파일 +31/-14): [DetailModal.jsx](src/components/DetailModal.jsx) — `const DM_S = {...}` 13키 모듈 스코프 정의 + 14건 inline → 객체 참조 치환
  - **DM_S 13키**: dragBar/headerRow/closeBtn (헤더 3) + scoreBadgeWrap/radarRow/metricsHead/metricsRow/metricsLabel (메트릭 5) + benefitsBox/benefitsHead/benefitsChipRow/benefitsChip (혜택 4) + republishBadge/actionRow (기타 2)
  - **잔여 동적 15건 보존**: outer/card/header padding (isPC/isDesktop) / 주소 라인 2개 (작은 객체) / radar wrap (1키) / metricsCol (2키) / metricsValue (`r.c || C.text` 동적 색상) / onConsult·isFav·isComp·onShare 버튼 4종 (props 의존)
- **DetailModal.jsx 전체 inline 29건 → 15건 (-48%)** ⭐ — 세션149 HeaderSection 34→9 (-74%) 패턴 정착
- **5교차검증**: null-safety-checker 🟢 (High/Med 0, Low 3 변경 무관 false positive) / 빌드 🟢 495ms (DetailModal 청크 49.93KB 불변) / Hook 메인 직접 (useRef×2 + useEffect×1 변경 0) / 보안 메인 직접 (innerHTML/eval 0건)
- **검증**: 151 files / **2448 tests PASS** (세션149 베이스라인 정확히 유지), DetailModal.test.jsx 15/15 PASS 0수정
- **사용자 가치**: ⚪ 간접 — 정적 호이스팅 미세 성능 개선, 디자인 토큰화 토대. inline 상수화 누적 2 컴포넌트 63→24 (-62%)
- **교훈 1건 추가 (세션149 16건 + 1 = 17건)**:
  17. Plan 매핑표 정밀도의 한계 — Plan 에이전트 "12건 확정" 후 9 GATE 영향범위 grep 실측에서 L91 metricsLabel 누락 발견. **하네스 검증 단계에 라인별 정적/동적 재분류 한 번 더 돌리는 게 안전**. Plan만 신뢰하지 말 것

**세션149 (2026-04-29)** — 학교알리미 재프로브 사전 준비 + HeaderSection inline style 상수화 시작점 박제 (2커밋 origin/main `f62f2c5..b46a415` + 1 gitignored)
- 실행 플랜 [cd-f-mibunyang-pwd-fuzzy-axolotl.md](C:\Users\user\.claude\plans\cd-f-mibunyang-pwd-fuzzy-axolotl.md) (학교알리미) + [session149-headersection-helpmodal-styles.md](C:\Users\user\.claude\plans\session149-headersection-helpmodal-styles.md) (HM_S) + [session149-headersection-body-styles.md](C:\Users\user\.claude\plans\session149-headersection-body-styles.md) (HS_S). 9 GATE 🟢9/🟡0/🔴0 (전 작업 동일 패턴)
- **배경**: 세션148 npm audit 종료 + 외부 이벤트 D-1/D-4 윈도우 (4/30 학교알리미 재개, 5/3 neisCode CI). 외부 대기 작업 1건 + 백로그 🟢 1번 "inline style 787건 점진 상수화" 시작점 박제
- **작업 1 학교알리미 프로브 (gitignored)**: `scripts/_tmp_schoolinfo_probe.mjs` 50줄 — 강남(11680)/서초(11650)/송파(11710) × 초(02)/중(03)/고(04) = 9회 호출. resultCode/list/COL_S_SUM 출력 + 자동 판정(E 해소/C 매칭/B 키만료/A 엔드포인트/부분실패). 사용자 SCHOOLINFO_KEY .env.local 동기화 확인 완료. `_tmp_*` 패턴 보호 (`git status` clean). 4/30 사용자 트리거 1분 내 실행 가능
- **작업 2 HelpModal 정적 추출 커밋 `f62f2c5`** (1파일 +30/-13): AptCard L18 `const S = {...}` 패턴 복제 시작점. HM_S 12키 추가 (HelpModal 직전) → HelpModal 14 inline → 12 객체 참조 + 1 스프레드(섹션 색상) + 1 인라인(loop index marginBottom)
- **작업 3 HeaderSection 본체 정적 추출 커밋 `b46a415`** (1파일 +30/-13): HM_S 직속 후속. HS_S 13키 추가 (HM_S 직후) — 데스크톱 6 (desktopLeft/desktopH1/desktopCount/desktopProfileWrap/desktopRight/desktopLogoutBtn) + 모바일 7 (mobileHeaderRow/mobileH1/mobileSubtitle/mobileTopRight/mobileVersion/mobileProfileScroll/mobileProfileLabel) → 본체 22 inline 중 정적 13 추출. 동적 9건(profile/isActive/helpOpen/containerMaxWidth) 인라인 보존
- **HeaderSection.jsx 전체 inline 34건 → 9건 (-74%)** ⭐ — 잔여 9건 모두 props/state 동적 의존
- **9 GATE 검증**: 백그라운드 Explore 에이전트 + 메인 직접 grep 병렬 — 동일 결론 도출. 폴링 금지 규칙 준수 (백그라운드 자동 알림)
- **5교차검증**: 전용 에이전트 호출 조건 미해당 (스코어링/null/수집기 변경 0) → 메인 agent 5축 직접. 빌드 🟢 387ms/457ms / null 🟢 / Hook 🟢 / 보안 🟢 / 회귀 🟢
- **검증**: 151 files / **2448 tests PASS** (세션148 베이스라인 정확히 유지), HeaderSection 8/8 PASS 2회
- **사용자 가치**: 간접 — 정적 호이스팅 미세 성능 개선, 향후 디자인 토큰화·CSS-in-JS 마이그레이션 토대. 외부 대비 — 4/30 즉시 진단 가능
- **교훈 5건 추가 (세션148 11건 + 5 = 16건)**:
  12. 분리 흐름 종료 후 inline 상수화가 자연스러운 후속 — 같은 파일 내부 정적 객체 추출은 위험 ⭐ 대비 효과 큼
  13. 백그라운드 Explore + 메인 직접 grep 병렬이 9 GATE 가속 — GATE 1을 백그라운드 위임하면서 메인은 GATE 5/6 직접 처리. 폴링 금지(자동 알림) 규칙 준수
  14. 외부 이벤트 D-1 사전 준비의 가치 — 4/30 당일 즉시 작성하면 30~60분 지연. 50줄 미리 두면 1분 내 실행
  15. HelpModal vs 본체 분리 커밋의 가치 — 24건을 한 커밋에 묶으면 80줄 예산 초과 + 단일 책임 혼합. 분리하면 1커밋 = 1관심사 = `git revert` 단위
  16. 가용 백로그 기준 우선순위 재평가 — "분리 후보 비-작업 명시"가 백로그 🟢 1번을 자연스럽게 부상. 우선순위 정적 아니라 가용 컨텍스트 따라 변동

_(세션148/147/146 상세는 SESSION_LOG 또는 아래 색인 표 참조)_

**세션138 (2026-04-22)** — AdminDashboard 417→96줄 3분할 (3커밋 origin/main `9c035f3..cdfe592`) — 상세는 SESSION_LOG 참조

**세션137 (2026-04-21~22)** — schools-neis `recordApiQuota` 1줄 보강 — CLAUDE.md 쿼터 로깅 원칙 복구 (1커밋 origin/main `c0f501f..5b2be14`)
- 실행 플랜 [cd-f-mibunyang-pwd-moonlit-kahn.md](C:\Users\user\.claude\plans\cd-f-mibunyang-pwd-moonlit-kahn.md). 9 GATE 🟢9/🟡0/🔴0 (서브에이전트 GATE 5-4 🔴 "api_quota_log UNIQUE 부재" 판정 → **재판정 🟢** — 기존 스키마 설계 의도, `api_quota_daily` VIEW `SUM()` 집계로 충분)
- **배경**: 세션136 2차 검증 독립 유효 성과 (scripts/CLAUDE.md "9개 수집기 쿼터 로깅" 원칙 위반 — schools-neis 만 누락, migration.mjs:163·molit-building-info.mjs:219·collect-unsold-kosis.mjs:286 전부 준수). 4/30 학교알리미 + 5/3 CI 외부 이벤트 대기라 지금 할 수 있는 유일한 내부 작업
- **커밋 `5b2be14`** (1파일 +4/-1):
  - [schools-neis.mjs](scripts/collectors/schools-neis.mjs) L11 import 에 `recordApiQuota` 추가 (`_shared.mjs:431` export 재사용)
  - L385-386 main() 말미 2줄: `if (!dryRun && NEIS_KEY) await recordApiQuota(PHASE, "NEIS_KEY", neisApiCalls);` / `if (!dryRun && SCHOOLINFO_KEY) await recordApiQuota(PHASE, "SCHOOLINFO_KEY", schoolInfoApiCalls);`
  - dryRun 가드 + 키 존재 가드 (migration.mjs 패턴과 동일)
- **5교차검증**: collector-contract 🟢 PASS (쿼터 로깅 원칙 위반 해소, 모범 패턴 3수집기와 일관) / null-safety-checker 🟢 (High/Med/Low 0, 카운터 L42/L161 모듈스코프 `let X=0` 초기화 확정) / 빌드 🟢 486ms 번들 불변 / 보안 🟢 (env **이름** 만 DB 기록, try/catch 메인 흐름 보호)
- **검증**: 150 files / **2434 tests PASS** (세션136 동일 유지), dry-run 실측 시 "DRY-RUN 모드" 로그 + `recordApiQuota` 호출 0건 (가드 작동 확인)
- **사용자 가치**: 2026-05-03 KST 07:00 `collect-schools.yml` 정기 실행 후 `api_quota_log` 테이블로 NEIS/SCHOOLINFO 호출량 일별 추적 가능. 4/30 학교알리미 서비스 재개 후 호출 정상화 여부 실측 모니터링 수단 확보

**세션136 (2026-04-21)** — schools.students 학교알리미 복구 Phase 0 진단 → **가설 E 서비스 점검 확정, 4/30 대기** (1커밋 origin/main `c0f501f`)
- 실행 플랜 [cd-f-mibunyang-pwd-pure-hamming.md](C:\Users\user\.claude\plans\cd-f-mibunyang-pwd-pure-hamming.md). 2차 재판정 🟢9/🟡0/🔴0 (1차 🟢7/🟡2 → 서브에이전트 재검증 3건 보강 후 전통과)
- **가설 판정**: A 엔드포인트/B 키 만료/C 매칭/D IP — 전부 **보류** (원본 응답 수령 자체 불가). **E 서비스 점검 ✅ 확정** — 학교알리미 공식 공지 "2025-08~2026-03 업로드 첨부파일 열람 일시 중단, 2026-04-30 1차 정시 공시와 함께 재게시" 사용자 스크린샷 실증
- **Phase 0 실행**: `scripts/_tmp_schoolinfo_probe.mjs` 40줄 (_tmp_* gitignored) → 강남구 초중고 3회 호출 시도. `SCHOOLINFO_KEY` 로컬 `.env.local` 미동기화로 중단. `gh secret list` 실측: SCHOOLINFO_KEY 2026-04-02 등록 확인(세션118 일치), 단 write-only 라 값 추출 불가. 사용자 스크린샷으로 원인 전환
- **2차 검증 주요 발견 3건**:
  - `normalizeSchoolName` 4지점 이중 역할 (schools-neis.mjs L53/70/182/218) → Phase 1-C 옵션 A 기각, **옵션 B(유사도 0.8→0.75 + DEBUG 로그)** 단계적 접근 채택
  - `classes` 1.4% 실적은 neisCode 과거 저장분 유산 — 실제 baseline 사실상 0%
  - **[schools-neis.mjs](scripts/collectors/schools-neis.mjs) `recordApiQuota` 호출 0건** — scripts/CLAUDE.md "쿼터 로깅 9개 수집기" 원칙 위반. 다른 수집기(molit-building-info.mjs:219, migration.mjs:163) 전부 기록 중. 독립 유효 성과로 세션137 이월
- **코드 수정 0파일**, docs 2파일 (SESSION_LOG + 이 CLAUDE.md)
- **교훈**: "API 0건/실패" 진단 시 Claude 혼자 코드·API 조사로는 "외부 서비스 점검" 가설 못 잡음 → 공식 사이트 접속해 공지 확인을 다음 세션부터 우선 절차로

**세션135 (2026-04-21)** — 세션132 CI 사후 확인 + "재활용 패턴" 전수 점검 (docs-only, 1커밋 예정)
- 실행 플랜 [cd-f-mibunyang-pwd-lazy-pumpkin.md](C:\Users\user\.claude\plans\cd-f-mibunyang-pwd-lazy-pumpkin.md). 9 GATE 🟢9/🟡0/🔴0 (1차 🟢7/🟡2 → 단계 1 실패처리 1줄 추가 후 전통과)
- **단계 1 결과**: `schools.nearby_schools[*].neisCode` = **0.0% (21,608 요소 중 0건)**. 🔴 원인 확정: `collect-schools.yml` cron `'0 22 2 * *'` = 매월 2일 UTC 22:00 → 세션132 커밋 `8b16d62` (2026-04-20 작성) 는 **2026-05-03 KST 07:00** 실행 시 첫 반영. 현재 0% 는 정상. **5/3 이후 재측정 필요**
- **부수 발견**: 세션133 DB 품질 표의 "schools 5,239 요소" 는 `supabase-js` 기본 limit 1000 탓 과소집계. 실제 **21,608** (4배). 페이지네이션 포함 1회성 스크립트(`_tmp_*`, `.gitignore` 보호, 실행 후 삭제) 로 실측
- **단계 2 매트릭스** (코드 읽기 전용, 수정 0파일):
  - ✅ [migration.mjs](scripts/collectors/migration.mjs) L127 `newEstPrdCnt: "1"` — 최신 1개월만 요청 → 재활용 낭비 없음
  - 🟡 [collect-market-stats.mjs](scripts/collectors/collect-market-stats.mjs) L102-107 6개월+8분기 요청 / L74-88 `extractLatestByRegion` 지역별 최신값만 추출, 나머지 버림 / regions 에 시계열 컬럼 부재 → **세션134 unsold_history 와 동일 패턴**, 복구 가치 🟡 (reader 없어 긴급도 낮음)
  - ✅ [population.mjs](scripts/collectors/population.mjs) L43-44 `srchFrYm=srchToYm` 단일 월 요청 + L238-250 `regions.recorded_at` 시계열 INSERT → 올바른 설계
- **결론 3개**: (1) 🟡 #1 CI 사후 확인은 5/3 까지 **대기** (🔴 아님), (2) collect-market-stats 시계열 복구 🟡 #5~6 추가, (3) migration/population 안전 확인
- **서브에이전트 병렬 검증**: GATE 0~8 중 GATE 1 (영향범위) / GATE 5 (보안) Explore 2개 동시 기동. 민감 정보 하드코딩 0건, `.gitignore:31` `_tmp_*` 패턴 보호 확인, `schools.nearby_schools` 테이블 구조 실증(`supabase/schema.sql:168-174`)
- **코드 수정 0파일**, docs 3파일 (이 CLAUDE.md + priorities + SESSION_LOG) 예정

**세션134 (2026-04-21)** — unsold_history 0행 복구 + 세션118 migration DB 반영 (1커밋 origin/main `95ebcfd..c5c3a55`)
- 실행 플랜 [cd-f-mibunyang-pwd-graceful-newt.md](C:\Users\user\.claude\plans\cd-f-mibunyang-pwd-graceful-newt.md). **2차 수렴 9 GATE 🟢9/🟡0/🔴0** (1차 🟡1 → PRD_DE 정규식 가드 반영 후 2차 전통과)
- **세션133 🥈 migration 반영**: Supabase Dashboard SQL Editor 에서 사용자가 `20260419000000_view_dedup_prefer_general.sql` 직접 실행. apartments_flat total_rows=1424 (불변) / `(오)` 접미 23→**17** (-6건, 세션118 예상 "6건 교체" 정확 일치). 기존 오피스텔 승자 자리에 일반분양 본체 6건 노출 시작
- **세션133 🥇 unsold_history 0행 원인 확정**: 조사 결과 "수집기가 아예 구현된 적 없음" (grep 0건). 테이블/읽기 엔드포인트(`api/supabase/unsold-history.js` 세션121 리팩토링)/프론트 UnsoldChart 모두 있는데 **우편함만 있고 우체부 없음** 상황
- **해결 방향 A**: 기존 `collect-unsold-kosis.mjs` 확장. KOSIS API 가 이미 3개월 범위 단일 호출로 받아오는데 `parseKosisRows` 가 최신 월만 추출하고 버려옴 → 재파싱으로 시계열 저장. **API 재호출 0, 쿼터 증가 0**
- **커밋 `c5c3a55`** (2파일 +114/-2):
  - [collect-unsold-kosis.mjs](scripts/collectors/collect-unsold-kosis.mjs) 신규 export `parseKosisRowsAllMonths(rows)` (PRD_DE `/^\d{6}$/` 정규식 가드 포함) + `main()` 말미 unsold_history upsert 블록 + `recordApiQuota(PHASE, "KOSIS_KEY", 1)` 추가 + import 2개
  - `upsertBatch("unsold_history", rows, "apartment_id,base_month", 500, sb)` UNIQUE 멱등
  - `post_completion_unsold`/`change` 는 KOSIS `DT_MLTM_2082` 미제공 → `null` 저장 (프론트 UnsoldChart null 안전)
  - [collect-unsold-kosis.test.mjs](scripts/collectors/collect-unsold-kosis.test.mjs) 신규 describe 5건 (3개월 분리 / PRD_DE 분기 포맷 skip / C1_NM 매핑 실패 / DT NaN / '계' `_total` 월별)
- **기존 `parseKosisRows` 병존** (교체 X) — regions/apartments UPDATE 경로 회귀 0
- **실제 DB 실행 결과** (로컬 `KOSIS_KEY` 보유로 CI 전 로컬 실측):
  - apartments 미분양 추정 갱신 119건
  - **unsold_history 0 → 1,099행** (distinct 508 apartments × 평균 2.16 월)
  - 월 범위 `["202601", "202602"]` — KOSIS 1~2개월 지연 반영 정상 (`202603`/`202604` 요청했으나 응답 없음)
  - `recordApiQuota kosis-unsold: KOSIS_KEY 1회 기록` 정상
- **5교차검증**: null-safety-checker 🟢 (High/Med 0, Low 1 — `row.C2_NM` undefined 시 `"undefined"` 키 품질 이슈만) / collector-contract 🟢 (C1 배치 500 + conflictCol "apartment_id,base_month" UNIQUE 일치, C2 순차, C3 에러, C4 쿼터 dry-run 가드, C5 dry-run 로그 전부 PASS) / 빌드 🟢 (868ms 번들 불변) / 보안 🟢 (KOSIS_KEY 재사용, injection 0)
- 검증: 150 files / **2429 → 2434 tests PASS** (+5), `vite build` 868ms
- **사용자 가치**: UnsoldChart.jsx 가 508개 아파트의 월별 미분양 추이 차트를 실제로 그릴 수 있게 됨. 매월 1일 자동 수집으로 시계열 자연 축적

**세션133 (2026-04-20~21)** — 우선순위 자기점검 + DB 품질 전수 재측정 + UX Playwright 실측 (docs-only, 1커밋 예정)
- **촉발**: 사용자 "프로젝트 목적에 부합한 일들 하고 있나" 점검 요청. 세션132 `neisCode` 작업을 포함해 최근 우선순위 판단에 사실 오류 누적 가능성
- **1단계 — migration 반영 안내**: 세션118 `20260419000000_view_dedup_prefer_general.sql` 이 작성만 되고 DB 반영 안 된 상태 확인. "(오)" 23건 노출 유지 (예상 반영 후 20건). Dashboard SQL Editor 수동 실행 사용자 과제
- **2단계 — DB 품질 전수 재측정** (`db-quality-audit.mjs` 1회성 실행 후 삭제):
  - ✅ 자연 개선: `cats_cache NULL` 7→0 (flat 기준), `price=0` 해소 유지, `dataReliability ≥80` 1,317→1,338 (92.5→94.0%), `net_migration/pop_growth` 100% (세션103 이후), `catsCache` flat 0 NULL
  - 🔴 **NEW 발견**: `unsold_history 0행` (시계열 전무), `schools.nearby_schools[*].students` 0/5,239, `classes` 143/5,239 (2.7%), `neisCode` 0% (세션132 커밋 후 CI 미실행)
  - 🔴 유지: `regions.households/jeonse_rate/supply_ratio 0/454` (reader 없어 우선순위 낮음)
  - 🟡 **의도적**: 혜택 10컬럼 100% NULL — 시행사 자료 운영자 수기 입력 대상 (`data-fill.mjs:46 SKIP_CATEGORIES` 에 `benefits` 포함). **자동 수집 대상 아님, 건드리지 말 것**
- **3단계 — Playwright UX 실측** (`~/.claude/tmp/mibunyang_ux_audit*.py` 4회 반복, 삭제 예정):
  - `1424개 단지` 표기 확인 → migration 미반영 확정 (원본 2001 대비 577개 dedup 제외)
  - 비로그인 카드: 점수 "??" 블러, "혜택 데이터 미수집" 전 카드 노출 (설계 의도)
  - 로그인 모방 시도 실패 — fake token 을 서버 `verify` 가 무효 판정. DetailModal 자동화는 실제 카카오 OAuth 필요
  - 콘솔 에러/경고 **0건** — 프런트 런타임 건전성 ✅
- **세션132 재평가**: `neisCode` 저장은 수집기 멱등성 확보 (진짜 가치 있음) 이나 사용자 체감 0. 우선순위 1등이었으면 안 됐음 정직하게 인정
- **세션134 우선순위 재정립**: `unsold_history 0행 조사` 🥇 / 세션118 migration 반영 🥈 / 세션132 CI 사후 확인 🥉 / `schools.students` 학교알리미 복구 4등
- 커밋 예정: CLAUDE.md DB 품질 섹션 + 다음 세션 우선순위 + 최근 3세션 블록 + SESSION_LOG 세션133 append

**세션131 (2026-04-20)** — test 주석 정리 10 라인 3분할 커밋 + eslint 재확인 + 통합 플랜 아카이브 (4커밋 origin/main `39ce0ca..18777ce`)
- 실행 플랜 [131-humble-snowglobe.md](C:\Users\user\.claude\plans\131-humble-snowglobe.md). 9 GATE 1차 🔴(6파일 일괄) → 실측 grep 재수행 10 라인 식별 → 3분할 재설계 → 2차 🟢9/🟡0/🔴0
- **커밋 `39ce0ca`** (3파일 +3/-3): api/_lib/ test 3종 주석 정리 — `rateLimit.test.js:7` / `tokenBlacklist.test.js:7` / `adminAuth.test.js:12` 에서 `세션127/128: @vercel/kv → ./redis.js` 히스토리 제거
- **커밋 `1b4893a`** (5파일 +5/-5): api/auth/ test 5종 주석 정리 — `logout/login/signup/kakao/verify.test.js` 에서 `세션128/129 Upstash 교체` 히스토리 제거. kakao.test.js:143 본문 회귀 방지 앵커는 보존
- **커밋 `35ba093`** (2파일 +2/-2): admin test 2종 **사실 오류 수정** — `review.test.js:22` / `users.test.js:22` 의 `@vercel/kv 모킹` 주석이 실제 L29/L27 `vi.mock('../_lib/redis.js')` 와 불일치 → `redis.js 모킹` 으로 정정
- **커밋 `18777ce`** docs: 이 세션 기록 + 통합 플랜 아카이브 반영
- **eslint 재확인**: `npm view eslint-plugin-react@latest peerDependencies` → peer `^3 || ... || ^9.7` 불변. 에픽 3-B 🔴 차단 유지. 재오픈 트리거: registry `^10.0.0` 등장
- **통합 플랜 아카이브**: `~/.claude/plans/pwd-linear-rossum.md` (git 외부) 상단 완료 배너 + 에픽 11개(1/2-A/2-B1/2-B2/3-A/3-B/4-A0+A1a/4-A1b-1/4-A1b-2/4-B/4-C) 각 말미 완료 커밋 해시 박제
- **비변경 대상 명시**: [kakao.test.js:143](api/auth/kakao.test.js#L143) 본문 회귀 방지 앵커 / [redis.js:3](api/_lib/redis.js#L3) 프로덕션 wrapper 설계 근거 / `src/scoring/**` 가중치 재설계 앵커 — 전부 보존
- 검증: 150 files / **2429 tests PASS** (세션130 동일 유지), 주석만 변경이므로 `vite build` smoke 생략
- 5교차검증: 전용 에이전트 호출 조건 미해당(스코어링/null/수집기 모두 비수정) → 메인 agent 직접 검증으로 처리

**세션130 (2026-04-20)** — 에픽 4-C: admin 체인 Upstash 교체 + stats dead route 제거 + **@vercel/kv 의존성 완전 제거** (4커밋 origin/main `ce9e3d2..4a90768`)
- 활성 통합 플랜 [pwd-linear-rossum.md](C:\Users\user\.claude\plans\pwd-linear-rossum.md) 에픽 4-C. 실행 플랜 [pwd-f-mibunyang-soft-parasol.md](C:\Users\user\.claude\plans\pwd-f-mibunyang-soft-parasol.md)
- **9 GATE 2회 수렴**: 1차 🟢5/🟡4 (GATE 0/1/3/4 — stats.js dead route 발견) → 재설계 (치환→삭제) → 2차 🟢9/🟡0/🔴0 통과
- **중대 발견 → 결정**: `api/admin/stats.js` 프론트 호출 0건 (grep 실증, `useAdminMode.js:151` 은 `/api/admin/users?action=stats` 만 사용 → users.js 의 handleStats L5-51 경로) + stats.js 주석 L4 "stats.js 통합 — Vercel Hobby 12함수 제한" 자체 실토 → **dead route 삭제** 결정 (세션129 refresh.js 선례 동일)
- **Explore 서브에이전트 오탐 기각**: 1번 에이전트 "숨은 호출자 1건" 보고 → 메인 Read 직접 검증 (`useAdminMode.js:146-159`) → `fetchStats` 함수명만 "stats" 키워드 매칭, 실제 URL 은 users.js 경로로 확정
- **커밋 `e5aab6f`** (2파일 +2/-2): review.js L1 교체 + review.test.js L29 mock 경로 교체 (19케이스 본문 0변경)
- **커밋 `264f209`** (2파일 +2/-2): users.js L1 교체 + users.test.js L27 mock 경로 교체. handleStats + main handler 동시. stats.test.js 교차 의존 파손은 단계 3 에서 자동 해소 (설계상 의도된 윈도우)
- **커밋 `bc7aafa`** (2파일 -186): stats.js 90줄 + stats.test.js 97줄 **삭제**. dead code 대량 감축
- **커밋 `4a90768`** (2파일 -15): package.json L29 `"@vercel/kv": "^2.0.0"` 제거 + package-lock.json 재생성. `node_modules/@vercel/kv` 실측 제거 (`npm install` removed 1 package)
- 검증: 150 files / **2429 tests PASS** (세션129 2431 → -2 stats.test.js 삭제분), `vite build` 431ms, 번들 불변, `npm audit` 0건
- **@vercel/kv prod import 3 → 0 ← 세션126~130 Upstash 마이그레이션 5세션 종결**
- null-safety-checker 3회 호출 🟢 PASS (High/Med 0): review.js 롤백 체인 + users.js handleStats/main 양경로 + 의존성 제거 단독 검증

**세션129 (2026-04-20)** — 에픽 4-B: auth 체인 Upstash 교체 + refresh.js dead route 제거 (4커밋 origin/main `143f9ea..efda699`)
- 활성 통합 플랜 [pwd-linear-rossum.md](C:\Users\user\.claude\plans\pwd-linear-rossum.md) 에픽 4-B. 실행 플랜 [pwd-fancy-pixel.md](C:\Users\user\.claude\plans\pwd-fancy-pixel.md)
- **9 GATE 0~8 전수 🟢9/🟡0/🔴0** 통과 후 실행. null-safety-checker 🟢 PASS (High/Med 0, Upstash `get/set/sadd/del` null 반환 `@vercel/kv` 동등 실증 `error-8y4qG0W2.d.ts:4636`)
- **중대 발견 → 결정**: `api/auth/refresh.js` 가 프론트 호출 0건 (grep 실증, `useExpertMode.js:133,150` 은 `/api/auth/verify` 만 사용) + verify.js `handleRefresh` 가 동일 로직 쌍둥이 → **dead route 삭제** 결정 (공격 표면 축소)
- **커밋 `708fa44`** (1파일 -48): refresh.js 삭제 — 세션128 박제 "refresh.test.js 부재" 근본 해소
- **커밋 `12d1578`** (2파일 +2/-5): verify.js L1 교체 + verify.test.js 두-mock 해제 (`vi.mock('@vercel/kv')` 제거, `../_lib/redis.js` 단독)
- **커밋 `3b7630e`** (4파일 +6/-6): login+signup pair — prod L1 교체 + test mock 경로 교체. `sadd/del` Upstash 호환 실측
- **커밋 `efda699`** (2파일 +171/-1): kakao.js L1 교체 + **kakao.test.js 신규 9케이스** (OAuth A/B/C 분기 + redirect_uri 화이트리스트 + `ex: 7776000` TTL 호환)
- 검증: 151 files / **2431 tests PASS** (세션128 2422 → +9 kakao), `vite build` 389ms, 번들 불변, `npm audit` 0건
- **`@vercel/kv` prod import 8 → 3** (admin/stats·users·review 만 잔존, 세션130 에픽 4-C 이월)

**세션127 (2026-04-20)** — 에픽 4-A1b-1: rateLimit 체인 Upstash 교체 (1커밋 origin/main `86eb15d..e479ade`)
- 활성 통합 플랜 [pwd-linear-rossum.md](C:\Users\user\.claude\plans\pwd-linear-rossum.md) 에픽 4 재설계 — 원안 "prod 2파일 동시" → 5 하위 에픽 pair-commit 전략으로 분할
- 9 GATE 1차 🔴2건(`vi.mock('@vercel/kv')` 10파일 회귀 리스크) → 2차 재검증 🟢9/🟡0/🔴0 (비대칭성 발견)
- **비대칭 실측**: `vi.mock('../_lib/rateLimit.js')` **10회** 함수레벨 스텁(철벽) vs `vi.mock('../_lib/tokenBlacklist')` **0회** → rateLimit 선별 교체, tokenBlacklist 세션128 이월
- **커밋 `e479ade`** (3파일 +8/-28): [redis.js](api/_lib/redis.js) 28→9줄 (`getInstance` getter 제거, `export const kv = Redis.fromEnv()` 직접 노출) + [rateLimit.js](api/_lib/rateLimit.js) L1 `@vercel/kv` → `./redis.js` + [rateLimit.test.js](api/_lib/rateLimit.test.js) L14 mock 경로 교체
- Vercel Upstash 실측: `upstash-kv-fuchsia-pocket ● Available` 연결됨, `KV_REST_API_URL/TOKEN` 레거시 env 는 `Redis.fromEnv()` 공식 fallback (`nodejs.mjs:266-282` 실측) → env 추가 불필요
- 5교차검증: null-safety-checker 🟢 (High/Med 0, Low 1 즉시 수정), 메인 보안 🟢 (fail-close `rateLimit.js:22-25` 불변)
- 검증: 150 files / **2422 tests PASS** (세션126 동일), `vite build` 510ms, 번들 불변, `npm audit` 0건
- `@vercel/kv` prod import 10 → 9 (rateLimit.js 제거)

**세션126 (2026-04-19~20)** — 에픽 4-A0+4-A1a: Upstash 설치 + Lazy Redis Wrapper (2커밋 origin/main `c7ea9a1..f02bea0`)
- 활성 통합 플랜 [pwd-linear-rossum.md](C:\Users\user\.claude\plans\pwd-linear-rossum.md) 에픽 4 착수. 9 GATE 4차 재검증 🟢8/🟡1/🔴0 (GATE 3 🟡 유지 — prod 교체는 환경변수 주입 후 세션127 이월)
- **커밋 `c7ea9a1`**: `npm install @upstash/redis@1.37.0 --save` — transitive 1.36.3 → direct 1.37.0 승격. semver 호환 `^1.31.3`, npm audit 0건
- **커밋 `f02bea0`**: [api/_lib/redis.js](api/_lib/redis.js) 신규 28줄 — `getRedisClient()` lazy factory + `kv` getter. 호출부 0 → 런타임 영향 0
- 실측 근거: `node_modules/@upstash/redis/nodejs.mjs` L266-283 — env 부재 시 `console.warn`만, throw 없음 → 빌드·배포 안전
- 5교차검증 (커밋 2): null-safety-checker 🟢 (High 0/Med 0/Low 2 정보성)
- 검증: 150 files / **2422 tests PASS** (세션125 동일 유지), `vite build` 470/441ms, 번들 불변, `npm audit` 0건

**세션125 (2026-04-19)** — 에픽 3-A 조사 + Node 환경 핀 (1커밋 origin/main `6520ec9`)
- 활성 통합 플랜 [pwd-linear-rossum.md](C:\Users\user\.claude\plans\pwd-linear-rossum.md) 의 에픽 3-A 진행. 사용자 옵션 B 선택. 9 GATE 9🟢/0🟡/0🔴
- **에픽 3-A 조사 결론**: eslint 10 본 적용(에픽 3-B) 🔴 차단 — `eslint-plugin-react@7.37.5` (최신) peer 가 `eslint: ^9.7` 까지만 지원, npm registry 에 호환 신버전 미배포. 재오픈 트리거: `npm view eslint-plugin-react@latest peerDependencies` 결과 `^10.0.0` 등장
- **본 작업 (2파일 +4/-0)** — [package.json](package.json) `engines.node: ">=20.19.0"` 추가, `.nvmrc` 신규 1줄. 값 근거: 로컬 v24.14.1 + Vercel Node 22 + GitHub Actions 37워크플로우 모두 충족 실측
- 검증: 150 files / **2422 tests PASS** (세션124 동일 유지), `vite build` 466ms, 번들 불변

**세션124 (2026-04-19)** — Scoring JSDoc 에픽 2-B2 안전·미래 — 시리즈 완료 (1커밋 origin/main `a2ea62e`)
- 활성 통합 플랜 [pwd-linear-rossum.md](C:\Users\user\.claude\plans\pwd-linear-rossum.md) 의 에픽 2-B2 진행. 9 GATE 9🟢/0🟡/0🔴 (세션123 동일 패턴 선례)
- **2파일 +72/-1** — [scoreRisk.js](src/scoring/scoreRisk.js) (11서브 가중치 합 1.0000 검산 박제 + safety=100-risk 방향성 + listingPen·finSc 공공분양·crimeSc 복합·서브 구간 표 위치), [scoreFuture.js](src/scoring/scoreFuture.js) (FUTURE_WEIGHT_MAP 8조합 합 항상 1.00 + popSc 7단계 + TRANSIT_HIGH 1.2배 + netMigration 보정 + 5키워드 상수/matchAny 헬퍼 JSDoc + `includes()` 부분 매칭 함정 박제)
- 5교차검증: scoring-validator 🟢 (FUTURE_WEIGHT_MAP 8조합 모두 합 1.00 검산, popSc 7단계 임계값 정확), null-safety-checker 🟢 (matchAny 상위 가드 6지점 검증, fw undefined 불가)
- **Scoring JSDoc 시리즈 완성**: 3세션 누적 8파일 12식별자 (에픽 2-A `7b4b0ad` + 2-B1 `d314f2f` + 2-B2 `a2ea62e`)
- 검증: 150 files / **2422 tests PASS** (세션123 동일 유지), `vite build` 591ms, 번들 불변, lint 84 warnings 유지

**세션123 (2026-04-19)** — Scoring JSDoc 에픽 2-B1 입지·상품·혜택 (1커밋 origin/main `d314f2f`)
- 활성 통합 플랜 [pwd-linear-rossum.md](C:\Users\user\.claude\plans\pwd-linear-rossum.md) 의 에픽 2-B1 진행. 9 GATE 9🟢/0🟡/0🔴 (세션122 에픽 2-A 동일 패턴 선례)
- **3파일 +81/-0** — [scoreLocation.js](src/scoring/scoreLocation.js) (5서브 합 1.00 + airSc 복합 + walkMin/혐오시설 거리 보정 + INFRA_CONFIG 10항목 합 1.00 박제), [scoreProduct.js](src/scoring/scoreProduct.js) (PRODUCT_MAX 9항목 합 100 + 주택유형별 brandSc 상한 + presaleParking 폴백 박제), [scoreBenefit.js](src/scoring/scoreBenefit.js) (loanVal 공식 + maintSave 이중 가드 + price=0/totalWon=0 0나누기 방지 박제)
- 5교차검증: scoring-validator 🟢 (JSDoc ↔ 구현 ↔ src/scoring/CLAUDE.md 3중 일치, PRODUCT_MAX 검산 20+15+15+10+10+10+10+5+5=100), null-safety-checker 🟢 (안전성 약속 정확, sanitize 의존 6건은 책임 범위 밖)
- 검증: 150 files / **2422 tests PASS** (세션122 동일 유지), `vite build` 484ms, 번들 불변, lint 84 warnings 유지

**세션122 (2026-04-19)** — Skeleton primitives + Scoring JSDoc 핵심 3파일 (2커밋 origin/main `88b7138..7b4b0ad`)
- 백로그 4에픽 통합 플랜(`pwd-linear-rossum.md`) 착수. 9 GATE 3차 재검증 🟢8/🟡1/🔴0 통과 후 실행
- **에픽 1** [primitives.jsx](src/components/primitives.jsx) +45줄 — SkeletonBox/SkeletonText/SkeletonList 3종. 기존 AptListSection `@keyframes skeleton-pulse` 1.5s 재사용. [detail/LoanRatesSection.jsx](src/components/detail/LoanRatesSection.jsx) L50 텍스트 → `<SkeletonText>`, [admin/AdminDashboard.jsx](src/components/admin/AdminDashboard.jsx) L162·L206 → `<SkeletonList>`
- **에픽 2-A** JSDoc 7함수 — [engine.js](src/scoring/engine.js) sanitize·calcCats·calcAll, [scorePrice.js](src/scoring/scorePrice.js) getAgeCoeff·getAreaAdj·scorePrice, [computeRegionalMedians.js](src/scoring/computeRegionalMedians.js). src/scoring/CLAUDE.md 규칙 박제 (가중치 1.00/100, 0~100 클램핑, `??` 전용, PIR 구간, fairPrice 3단 폴백 -15)
- 5교차검증: null-safety-checker 🟢 (에픽 1), scoring-validator 🟢 (에픽 2-A, JSDoc 내용 전부 CLAUDE.md + 실제 구현과 일치)
- 검증: 150 files / **2422 tests PASS** (세션121 2418 → +4 Skeleton), `vite build` 423/419ms, 번들 불변, lint 84 warnings (기존 수준)

**세션121 단계 C (2026-04-19)** — 저장 액션 토스트 피드백 (1커밋 origin/main `9e52be8`)
- 🟢 백로그 "저장 액션(가중치·프리셋) 토스트 피드백" 해소. 기존 useToast 패턴 4지점 적용
- [WeightEditor.jsx](src/components/admin/WeightEditor.jsx) +4 / [AdminDashboard.jsx](src/components/admin/AdminDashboard.jsx) +2 / [SearchFilterBar.jsx](src/components/sections/SearchFilterBar.jsx) +6 / [App.jsx](src/App.jsx) +2
- 토스트 4종: `"가중치가 저장되었습니다"` · `"프로필이 초기화되었습니다"` · `"프리셋이 저장되었습니다"` · `"프리셋이 삭제되었습니다"`
- 기본값 `showToast = () => {}` 폴백으로 기존 테스트 수정 없이 통과. prop drilling 2레벨
- 9 GATE 🟢9/🟡0/🔴0, null-safety Review PASS (Medium 1건 즉시 수정: 삭제 실패 시 토스트 안 뜨도록 조건 가드)
- 검증: 150 files / **2418 tests PASS** 유지, `vite build` 396ms, 번들 +0.13kB

**세션121 (2026-04-19)** — createTimeseriesHandler 팩토리 추출 (1커밋 origin/main `3cad834`)
- 🟢 백로그 "api/supabase/prices.js ↔ unsold-history.js 중복 11줄 → 공통 헬퍼" 해소
- **신규** [api/_lib/timeseriesHandler.js](api/_lib/timeseriesHandler.js) 58줄 — `createTimeseriesHandler({ table, select, orderBy, errorLabel, filter? })` 팩토리
- **수정** [api/supabase/prices.js](api/supabase/prices.js) 49→21줄 (-28), [api/supabase/unsold-history.js](api/supabase/unsold-history.js) 48→19줄 (-29) — 선언부만 남김. presale_% 필터는 `filter` 훅으로 이전
- 외부 동작 불변: 기존 테스트 13케이스(prices 7 + unsold-history 6) **수정 없이** 통과
- 9 GATE 1차 🟢9/🟡0/🔴0 (서브에이전트 2개 병렬: 영향범위 grep + 보안 실측)
- 검증: 150 files / **2418 tests PASS** (세션120 유지), `vite build` 397ms, null-safety PASS, 번들 불변
- rateLimit "proxy" 유지 (세션119 🔴 보안 수정 보존)

**세션120 (2026-04-19)** — App.jsx 훅 4분리 442→354줄 (3커밋 origin/main `7b52948..97bcb67`)
- 🟡 백로그 "App.jsx 442줄 → useAppState() 훅 분리" 해소. 보수 4훅 분리로 -88줄(-20%) 달성
- **신규 훅 4종**:
  - [useLoginGate.js](src/hooks/useLoginGate.js) 34줄 + test 5건 (커밋 `54818b9`) — showLoginPrompt/loginTrigger/pendingDetailId + 3핸들러
  - [useShareCallbacks.js](src/hooks/useShareCallbacks.js) 59줄 + test 6건 (커밋 `31b53d4`) — scoredMapRef 내부 관리 + 필터 10개 개별 prop
  - [useKakaoCallbackEffect.js](src/hooks/useKakaoCallbackEffect.js) 34줄 (커밋 `97bcb67`) — `[tab]` deps + eslint-disable 유지 명시
  - [useKeyboardShortcuts.js](src/hooks/useKeyboardShortcuts.js) 23줄 (커밋 `97bcb67`) — 1~5/Ctrl+Z/Escape 가드
- **Hook 호출 순서 조정**: useLoginGate를 useAppNavigation **앞**에 배치 (onLoginRequired 콜백이 setLoginTrigger 참조)
- [src/hooks/CLAUDE.md](src/hooks/CLAUDE.md) 호출 순서 섹션 갱신
- 9 GATE 1차 🟢6/🟡3 → 2차 보강 🟢9/🟡0/🔴0 통과 후 실행
- 검증: 150 files / **2418 tests PASS** (세션119 3차 후속 2407 → +11), `vite build` 486ms, 번들 불변

**세션119 3차 후속 (2026-04-19)** — sanitize 그룹 분리 + @vercel/analytics 2.0 (5커밋 origin/main)
- `/improve` 🟡 백로그 저리스크 2건 해소. 9 GATE 3차 🟢9/🟡0/🔴0
- **sanitize() 7그룹 분리** (커밋 `587826d`→`c5f704c`→`8ca6980`→`d704adf`): 193줄 단일 객체 → `sanitizeFallbackFlags`·`Basics`·`Benefits`·`Environment`·`Infra`·`Transport`·`Region`·`Transaction`·`NaverCross`·`Presale` 10헬퍼 + 4단독 인라인. 파일 303→363줄
- **스냅샷 테스트 선행**: 54필드 `toHaveProperty` 전수 검증 1건 추가(587826d)로 리팩토링 회귀 방어
- **@vercel/analytics 1.6.1→2.0.1** (커밋 `22434c2`): 메이저 업그레이드, `/react` subpath + `track()` 시그니처 유지로 **소스 수정 0파일**. peerDep react `^18||^19` 유지
- 검증: 148 files / **2407 tests PASS** (이전 2406 → +1), `vite build` 500ms, `npm audit` 0건, 번들 +0.54kB

**세션119 후속 (2026-04-19)** — 429 UX + 이메일 검증 공용화 + supabase-js 2.103 (5커밋 origin/main)
- `/improve` 🟡 3건 묶음 해소. 9 GATE 1차 🟢8/🟡1 → 단계 4 분할 후 🟢9/🟡0/🔴0
- **429 UX**: [src/hooks/useHistoryData.js](src/hooks/useHistoryData.js) · [src/services/staticDataApi.js](src/services/staticDataApi.js) 에 `res.status === 429` 분기 + 한국어 재시도 메시지 (커밋 `7b6d223`·`97b572e`)
- **이메일 검증 공용화**: [api/_lib/validators.js](api/_lib/validators.js) 신규 `isValidEmail()` — RFC 5322 정규식 + 254자 + 타입 가드. `auth/signup.js:13`·`login.js:12` 인라인 중복 제거 + `admin/review.js:72` 의 느슨한 `.includes("@")` 강화 (커밋 `1d4f3c3`·`295334c`). `bad@`·`@x.com`·TLD 1글자 차단
- **supabase-js**: 2.98→**2.103.3** 마이너 (커밋 `73b3295`). Node >=20 요구사항 충족(v24.14.1/Vercel Node 22)
- 검증: 148 files / **2406 tests PASS** (세션119 2385 → +21), `vite build` 512ms, `npm audit` 0건, 번들 +0.09kB

**세션119 (2026-04-19)** — 공개 API rateLimit + dompurify 취약 해소 (4커밋 origin/main)
- `/improve` 🔴 미션 1건 해소. 9 GATE 🟢8/🟡1/🔴0 통과 후 단계 1 6파일 → **1a/1b/1c 3분할** 재검증
- `api/supabase/{apartments,prices,unsold-history}.js`에 `rateLimit: "proxy"` (30/5분/IP) 각각 적용 — 커밋 `deef147`·`fb8ef69`·`a76b69f`
- 기존 `proxy: 30` LIMITS 키 재사용 (이미 8개 API에서 사용 중). 3개 테스트 파일에 `finlife/loans.test.js:8-10` 표준 mock 3줄 추가
- `npm audit fix` → dompurify 3.3.3 → **3.4.0** (GHSA-39q2-94rc-95cp, ADD_TAGS 우회 moderate). package.json 불변, lock만 갱신 — 커밋 `be54322`
- 검증: supabase 테스트 33/33 + 전체 2385/2385 PASS, `vite build` 406ms (번들 불변), `npm audit` 0건
- 🟡: 프론트 `staticDataApi.js:25`·`useHistoryData.js:25`가 429 전용 처리 없음 — 정상 사용자 30/5분 초과 가능성 낮음, 별도 에픽

**세션118 (2026-04-19)** — 수집기 부전 복구 (7커밋 origin/main)
- 9 GATE 초안 🔴3 → 재설계 후 🟢8/🟡1/🔴0
- [collect-naver-listings.yml](.github/workflows/collect-naver-listings.yml) concurrency 분리 (커밋 `082d0e2`) · [collect-unsold-kosis.mjs](scripts/collectors/collect-unsold-kosis.mjs) fetchWithRetry (커밋 `8328692`)
- 네이버 긴급 쿨다운 4종 (커밋 `74db0d0`): naver-listings MIN_INTERVAL 1→5s·PAGE_DELAY 1.5→3s·RETRY_DELAYS [10,20,40,60,120]s / naver-collect.py thr 1→5s / run-naver-local.bat `py -3`+`MIBUNYANG_PYTHON` env / GA timeout 30→60분
- 단계 3 재정의 (커밋 `3c969cb`): AIRKOREA/NEIS/SCHOOLINFO 3키 이미 등록됨(`gh secret list` 실측). 진짜 장애는 [collect-schools.yml](.github/workflows/collect-schools.yml) 매월 1일 UTC 20:00 3종 그룹 충돌. cron 1일→2일 + `school-collection` 그룹 분리
- 단계 4·5 스킵: 지방 17개 시도 trades 전부 존재 / compute-scores gap 7건은 `apartments_flat` VIEW dedup CTE `ORDER BY id DESC`가 "(오)" 오피스텔 우선 선택 (별도 에픽)
- 단계 6 B1 R² v1(+0.38)·v2(+0.29) 모두 게이트 0.7 실패 → 세션117 C 공식 확정 재확인
- regions NULL 4컬럼 실측: `population` 시군구 92.5% / 시도 부분 NULL, `households`·`jeonse_rate`·`supply_ratio` 0/454 (각각 수집기 부재·미저장·체인 차단)

**세션117 (2026-04-18)** — 시군구 소득 PoC `C (현상 유지)` 공식 확정 (docs-only)
- `.claude/plans/session117-sigungu-income-poc.md` (gitignored) 상태 전이
- 재오픈 트리거 4개: 왜곡 제보 / UX 잡음 / 경쟁사 도입 / 시도=시군구 지역 추가 왜곡

**세션116 (2026-04-18)** — 남은 과제 3개 정리 (전부 docs)
- `scripts/fix_sejong_coord.mjs` 처분 (DB 반영 확인 후 untracked 삭제)
- CLAUDE.md 행안부 문구 정정 (`migration.mjs` 세션103에서 KOSIS 전환 완료)
- 시군구 소득 PoC 설계 문서 작성 (A/B/C 비교, 추천안 C)

### 세션93~148 색인 (상세는 SESSION_LOG)

| 세션 | 날짜 | 핵심 변경 | 커밋 |
|------|------|----------|------|
| 148 | 04-28 | postcss <8.5.10 XSS moderate 보안 패치 (npm audit fix). transitive only, package.json 0수정. 8.5.8→8.5.12 | `4f3a1e9` |
| 147 | 04-28 | WeightEditor 233→100줄 2자식 분리 (WeightTable 97 + ScoreBreakdownPreview 71). 150 미만 확실 달성 | `359fec3` |
| 146 | 04-28 | WeightEditor.test.jsx 신규 14케이스 6도메인 (분리 전 테스트 선행, 코드 0수정). 153줄 추가 | `ecd00cb` |
| 145 | 04-28 | MapView 216→158줄 헬퍼 + SelectedAptCard 분리 (시계열 차트 격리) — 150 미달 8줄 인정 | `c1fbdaa` |
| 144 | 04-28 | primitives.jsx 154→91줄 LineChart 단독 분리 (시계열 차트 엔진 격리, re-export 11 소비자 0수정) | `79bdb1c` |
| 143 | 04-28 | DataSections 183→152줄 2자식 분리 (HighlightField + InfrastructureSection, detail/ 평면) — 150 미달 2줄 인정 | `276e15a` |
| 142 | 04-23 | ExpertLoginForm 191→121줄 SignupExtraFields 분리 — 150줄 미만 첫 달성 (sections/ 평면 배치) | `365dda4` |
| 141 | 04-23 | SearchFilterBar 257→184줄 PresetPanel 분리 (filters/ 폴더 6패널 구조 완성, 150 미달성 용인) | `de250f7` |
| 140 | 04-22~23 | InfoPage.jsx 267→60줄 4분할 (sections/info/ 서브폴더 신설, ScoringEngine·FAQSection·GuideSections) | `54ecea1`·`5408446` |
| 139 | 04-22 | building-hub HpPermitService 코드 제거(-61줄) + 정책 박제. 네이버 경로 단일화 + 미구독 확정 | `1434c2f`·`00280a9` |
| 132 | 04-20 | schools-neis neisCode/officeCode 저장 3줄 추가 (재조회 멱등성 보장). CI 반영은 5/3 이후 | `8b16d62` |
| 115 | 04-18 | sidoNotice 끝단 UI 실측 (Playwright 5/5 전문가 대시보드 DOM 노출) | `32f1885` |
| 114 | 04-18 | fairPriceFromSidoAvg 폴백 신뢰도 `-15` + 경고 접미. `PRICE_FALLBACK_RELIABILITY_PENALTY=15` 신규 | `ee85ce3`·`d1749b7`·`e6c48ec` |
| 112 | 04-17 | AptCard `classifyNoPrice` detail 일반 카드로 확장 | `d21ace9` |
| 111 | 04-17 | classifyNoPrice 8분기 → pir NULL 38건 100% 맞춤 안내 | - |
| 110 | 04-17 | collect-avg-income KOSIS DT_1C86→INH_1C96_04 (2022→2024p), PIR 평균 18.34년 | `03ca58b` |
| 109 | 04-17 | compute-scores 재실행 1,424건 반영 (세션108 PIR 구간) | `9bbab23` |
| 108 | 04-17 | scorePrice PIR 구간 재설계 ≤3/≤5/≤7 → ≤10/≤20/≤30. `PIR_SCORE_TIERS` 신규. 828건 쏠림 해소 | - |
| 107 | 04-17 | regions.avg_income 100% NULL 해소 + NATIONAL_MEDIAN_INCOME 5000→195 | `eb019ae` |
| 106 | 04-17 | price=0 오염 버그, pir NULL 50→38 | `fbf373b` |
| 105 | 04-16 | "가격 있는데 pir NULL" 7건 원인 확정 (naver-presale price=0 저장) | - |
| 104 | 04-16 | migration.mjs KOSIS fetchWithRetry + pir NULL 50건 분류 | - |
| 103 | 04-16 | migration.mjs 행안부→KOSIS DT_1B26001_A01 전면 전환. net_migration 454→0 | - |
| 99 | 04-16 | scorePrice price=0 devSc=97 오인 버그 수정 (종합점수 +6~7 왜곡 제거) | `0adc222` |
| 98 | 04-15 | transport-tago null/[]/[N] 3신호 분리 | `f91b0db` |
| 97 | 04-15 | apartments_flat.dataReliability VIEW 공식 강화 (bus_stop_names 판정), avg 88.38 | - |
| 96 | 04-15 | 서울 PIR NULL 57% 메모 검증 — 이미 해소 (9/266=3.4%) | - |
| 94 | 04-15 | 화성시 64건 gu 복합문자열 해소. nearbyMedian 65→15 | - |
| 93 | 04-15 | 세종 33건 nearbyMedian (statsKey 헬퍼 + 세종 화이트리스트) | `8ee1907` |

### 잔여 nearbyMedian NULL 10건 (세션114 실측, 전부 구조적 + avgSqm 폴백 경로)

- 인천 동구 2 (두산위브 더센트럴, 리아츠 더 인천 4차) — 섬 인접 공백
- 인천 옹진군 2 (백령1/연평 국민임대) — 섬, area=NULL → 폴백 무효
- 경기 가평군 3 (자라섬 수자인, 청평수자인더퍼스트, 썬밸리오드카운티)
- 경기 양평군 2 (우방아이유쉘 에코리버3차, 효성해링턴 플레이스)
- 경기 연천군 1 (수레울1단지 국민임대) — area=NULL

### 다음 세션 우선순위 (세션156+, 세션155 후속)

> 5/2 기준: 색칠 지도 3 세션 분할 완료 (153 자료 → 154 시도 → 155 시군구). **세션156 진입 시점 = 사용자 베타테스터 색칠 지도 체험 결과 청취 우선**. 5/3 neisCode CI D-1 / 5/5 market-stats CI D-3.

1. 🥇 **베타테스터 색칠 지도 체험 보고 청취** — 세션 153~155 3단계 완성. 사용자가 이번 주 안에 베타테스터에게 "색칠 모드 토글 → 줌인 시 시군구 자동 전환" 흐름 시연 가능. UX 잡음(level 8↔9 진동 / 폴리곤 색 가독성 / 일반시 합산 표기 적절성) 보고에 따라 후속 분기:
   - level 진동 보고 시 → 히스테리시스 (≥10 시도 / ≤8 시군구) 또는 50ms 디바운스 적용
   - 색 가독성 → fillOpacity 조정 (시군구 0.55 → 0.6~0.7)
   - 합산 적절성 → 일반시 12개 분할/통합 사용자 선택 토글 검토
2. 🥈 **5/3 학교알리미 + neisCode CI 결과 검증** — `collect-schools.yml` cron `'0 22 2 * *'` = 5/3 KST 07:00. 그 이후 `schools.nearby_schools[*].neisCode` 비율 쿼리(기대 >70%) + 학교알리미 students/classes 비율 추적 (현재 0% / 1.4%)
3. 🥉 **세션151 migration 사용자 과제** — Supabase Dashboard SQL Editor 에서 `20260429000000_create_market_stats_history.sql` 수동 실행 필요. 미실행 시 5/5 cron upsert 부분 실패
2. 🥈 **세션151 migration 사용자 과제** — Supabase Dashboard SQL Editor 에서 `20260429000000_create_market_stats_history.sql` 수동 실행 필요. CREATE TABLE 성공 후 다음 cron 5/5 (매월 5일 KOSIS 수집) 부터 자연 누적 시작. 미실행 시 5/5 cron 의 upsert 단계가 "table not found" 로 실패 (regions UPDATE 부분은 정상 작동, 부분 실패만)
3. 🟢 **inline style 점진 상수화 후속** — 세션149~151 누적 4파일 79→23 (-71%) 정착 후 남은 후보:
   - WeightEditor 100줄 정적 4건 (67% 비율, 작지만 깔끔)
   - 잔여 후보 SearchFilterBar 38% / AptCard 35% (🟡 가성비 낮음, 보류 권장)
4. 🥉 **세션132 커밋 `8b16d62` 사후 확인 — 5/3 이후** — `collect-schools.yml` cron `'0 22 2 * *'` = 5/3 KST 07:00. 그 이후 `schools.nearby_schools[*].neisCode` 비율 쿼리(기대 >70%). 현재 0.0% (21,608 요소 중 0건)
5. 🟢 **세션151 후속 — market_stats_history reader** (시계열 차트) — 5/5 CI 후 134건 누적 시작 후 다음 단계:
   - `api/supabase/market-stats-history.js` 신규 (createTimeseriesHandler 팩토리 재사용 — 세션121 패턴, 5지표 모두 옵션 필터)
   - `useMarketStatsHistory` hook (정적 fetch + 5분 캐시)
   - DetailModal 안 5지표 LineChart (시계열 차트, primitives.LineChart 재사용)
6. 🟡 **unsold_history 시계열 축적 모니터링** — 매월 1일 KOSIS 수집 후 행수 증가 확인. 2~3개월 후 결측 패턴 분석 (현재 508×2개월, 향후 이상적으로 1,300×3개월 = 3,900행)
7. 🟡 **방향 B 검토** — 청약홈 API 가 단지별 월별 미분양 이력 제공하는지 조사. KOSIS 비례배분(세션134) 대비 정확도 개선 여지
8. 🟡 `population.mjs` MOIS 인구 API 안정성 모니터링 — 장애 시에만
9. 🟢 **이월 에픽 후보** (reader 부재라 낮은 우선순위): (a) `households` regions 수집기, (b) `trade-stats.mjs` 에 regions.jeonse_rate 파생 저장

**명시적 비-작업** (의도적 설계, 건드리지 말 것):
- **혜택 10컬럼 100% NULL** — 시행사 제공 자료 기반 운영자 수기 입력 (자동 수집 대상 아님)
- **시군구 소득** — 세션117 C 공식 확정, 재오픈 트리거 4개 발동 전 유지
- **ExpertLoginForm AuthStatusBanner/KakaoLoginButton 추가 분리** — 세션142 A안 채택 (작아서 분리 이득 미미)
- **sections/expert-login/ 서브폴더 신설** — 세션142 거부 (1파일은 평면 규칙)
- **HeaderSection 동적 inline 9건 추가 추출** — 세션149 명시 (props/state 의존, useMemo·스프레드 분리는 별도 후속 시 검토)
- **DetailModal 동적 inline 15건 추가 추출** — 세션150 명시 (isPC/isDesktop/isFav/isComp/r.c 의존, 별도 후속 시 useMemo dynStyles 패턴 검토)
- **DataSections 동적 inline 4건 추가 추출** — 세션151 명시 (showData/loop index/section.grid/dataValueColor·f.dist 의존, 부분 호이스트 4건은 이미 적용)
- **market-stats reader endpoint·차트 컴포넌트** — 세션151 사용자 결정 B안 채택 (수집기+테이블만, reader는 별도 세션). 5/5 CI 데이터 누적 후 가치 재평가
- **collect-market-stats long format 재논의** — 세션151 wide 확정 (scorePrice/scoreRisk reader 5건 모두 wide 사용). long 마이그레이션은 향후 reader 요구사항 변화시
- **kakaoMapHelpers.js 안에 폴리곤 헬퍼 추가** — 세션154 거부 ("MapView.jsx 전용. 외부 컴포넌트 사용 0" 주석 위반 회피, `src/lib/geoJsonToKakaoPaths.js` 분리)
- **색칠 모드에서 마커 + 폴리곤 동시 표시** — 세션154 사용자 결정 (마커 완전히 숨김 채택). UX 잡음·성능 부담
- **폴리곤 클릭 인포윈도우** — 세션154 사용자 결정 (줌인 + 점 보기 자동 전환으로 충분)
- **시도+시군구 동시 표시** — 세션155 줌 ≥9 자동 전환 = 시도 폴리곤 cleanup. 겹치면 가독성 저하
- **시군구 줌인 후 동(읍·면) 단계** — 세션155: GeoJSON 자료 없음, 가치 미미
- **시군구 별도 토글 버튼** — 세션155 사용자 결정 "줌 자동 전환" 채택
- **줌 임계값 히스테리시스/디바운스 (level 8↔9 경계 진동)** — 세션155: 사용자 의도적 1단계 줌 입출 시에만 발생, 폴리곤 그리기 1회씩이라 실 영향 미미. 향후 UX 잡음 보고 시 hysteresis (≥10 시도 / ≤8 시군구) 또는 50ms 디바운스 적용
- **kakao.event.removeListener 미지원 fallback 강화** — 세션155: 미지원 시 zoom_changed 핸들러는 mapInstance(=페이지) 라이프사이클까지 살아있음. 옵셔널 호출 한 줄 가드만 적용. mapInstance 재마운트 시점이라 누수 미미

### DB 품질 (세션133 전수 재측정 · 2026-04-20)

> 세션110/114/118 기록이 오래돼 세션133 에서 전수 재측정. 일부 지표는 자연 개선, 일부는 미해결 유지.

- **apartments 2,001건 → apartments_flat VIEW 1,424건** (dedup 577건 제외)
  - apartments.cats_cache NULL 7건 (0.3%), **apartments_flat.catsCache NULL 0건** — 세션118 "NULL 7건" 기록은 VIEW 기준 이미 해소
  - price = 0 **0건** (세션99 오염 버그 해소 유지), price NULL 38건 (2.7%)
  - dataReliability ≥80 **1,338건 (94.0%)** — 세션97 이후 소폭 개선 (1,317→1,338)
- **trade_stats 2,001건**: pir 98.0% / psr 64.1% / jeonse_rate 97.5% / nearby_median 99.2%
- **regions 454행 (시도 62 + 시군구 392)**:
  - avg_income **62/454 (13.7%)** — 시도 단위만. 세션110 "시도 17/17" 이 더 정확한 표현 (regions 테이블이 시도별 여러 recorded_at 스냅샷 포함)
  - population 420/454 (92.5%) — 시군구 부분 NULL
  - **net_migration / pop_growth 454/454 (100%)** — 세션103 KOSIS 전환 이후 전량 채워짐 (이전 기록 "454→0 NULL" 은 오표기)
  - **households / jeonse_rate / supply_ratio 0/454 유지** — reader 부재로 우선순위 낮음
- **apartments.air_quality 1,950/2,001 (97.5%)** — AIRKOREA 정상 수집
- **schools 1,971건 (apt 대비 98.5%)**:
  - school_score 1,971/1,971 (100%)
  - nearby_schools 요소 **21,608개** (세션135 페이지네이션 실측 · 세션133 "5,239" 는 supabase-js 기본 limit 1000 탓 과소): **neisCode 0% / students 0% / classes 1.4%** — 세션132 neisCode 저장 커밋 `8b16d62` 는 **다음 `collect-schools.yml` 정기 실행(5/3 KST 07:00) 후에야 반영**. students 는 학교알리미 API 수집이 세션89 이후 지속 실패
- **시계열 테이블**:
  - prices 3,633행 (apt당 평균 1.8행) · trades 608,713행
  - **unsold_history 1,099행** — 세션134 복구 완료. 508 apartments × 2개월 (202601/202602), KOSIS 1~2개월 지연 반영 정상. 매월 1일 자동 누적
- **혜택 10컬럼 (discountPct/loanFree/cashback/balcony 등) 100% NULL** — 🟡 의도적. 시행사 제공 자료 기반 운영자 수기 입력 대상. 자동 수집 대상 아님 (data-fill.mjs:46 `SKIP_CATEGORIES` 에 `benefits` 포함)
- **apartments_flat "(오)" 23→17건** — 세션134 migration 반영 완료 (`20260419000000_view_dedup_prefer_general.sql`, Supabase Dashboard 수동 실행). 일반분양 본체 6건이 VIEW 승자로 교체

---
---

## 아키텍처 개요

```
constants → scoring → theme → components → hooks → App    (단방향, 순환 참조 없음)
```

| 레이어 | 기술 | 핵심 모듈 |
|--------|------|----------|
| **프론트** | React 19 + Vite 8 (Rolldown) | App.jsx (~512줄), `@/` 경로 별칭, Pretendard 폰트 |
| **상태/훅** | useMemo 13개 체인 + useDeferredValue | useDataPipeline, useAppNavigation, useFilterSort |
| **컴포넌트** | memo() 36개 + icons.jsx (SVG 9개) | 소비자10 + 섹션8 + 상세7 + 필터8 + 전문가9 + 관리자3 |
| **API** | Vercel Serverless (21개 함수, `api/**/*.js` 테스트 제외) | withHandler HOF (CORS/Method/RateLimit/Admin 통합) |
| **DB** | Supabase PostgreSQL | 15개 테이블 + 2 VIEW + presale 19컬럼 |
| **인증** | SHA-256+salt, HMAC-SHA256 JWT | 카카오 OAuth + 전문가/관리자 role 기반 |
| **캐싱** | Vercel KV (Upstash Redis) | 세션, 토큰 블랙리스트, Rate Limit |
| **수집** | GitHub Actions (35개) + Windows 스케줄러 | 네이버(로컬 한국IP) + 공공API(Actions) |
| **테스트** | Vitest + Playwright E2E (11 spec) | `npm run test` / `npm run test:e2e` |
| **모니터링** | Vercel Analytics + Speed Insights | 페이지뷰/Web Vitals/커스텀 이벤트 (쿠키 없음) |

### 번들 구성

| 청크 | 크기 | 비고 |
|------|------|------|
| vendor (react+react-dom) | 190KB | 분리됨 |
| index (메인) | 172KB | |
| html2canvas + jsPDF | 200+400KB | dynamic import (초기 로딩 무관) |

---

## 환경변수

| 변수 | 용도 | 필수 | 비고 |
|------|------|------|------|
| `SUPABASE_URL` | DB 연결 | O | Vercel + .env.local |
| `SUPABASE_ANON_KEY` | 읽기 전용 | O | API 레이어 |
| `SUPABASE_SERVICE_KEY` | 쓰기 | O | GitHub Secrets / 로컬만 |
| `MOLIT_KEY` | data.go.kr 공공API | O | 일일 10,000건 공유 |
| `FINLIFE_API_KEY` | 금감원 금리 | - | 미등록 시 빈 배열 |
| `NEIS_KEY` | 교육청 학교 | - | 미등록 시 거리 기반만 |
| `SCHOOLINFO_KEY` | 학교알리미 학생수 | - | 미등록 시 스킵 |
| `AIRKOREA_KEY` | 에어코리아 대기질 | - | 별도 쿼터, MOLIT_KEY와 분리 |
| `KAKAO_REST_API_KEY` | 카카오 OAuth (서버) | O | VITE_KAKAO_JS_KEY와 분리 |
| `VITE_KAKAO_JS_KEY` | 카카오 (프론트) | O | 공개 키 |
| `KAKAO_REDIRECT_URI` | OAuth 콜백 URL | O | |
| `VITE_USE_SUPABASE` | DB 모드 전환 | - | `true` → Supabase, 아니면 로컬 JSON |

---

## 교차 관심사 (하위 CLAUDE.md에 없는 전역 규칙)

### 인증/세션
- admin 토큰 TTL 1h. 프론트 verify 폴링 15분 주기
- 토큰 블랙리스트: KV `bl:{hash}`, fail-open (만료가 2차 방어선)
- 로그아웃: 서버 토큰 무효화 + 프론트 sessionStorage 삭제
- 카카오 신규 사용자: role:"user", status:"approved" (승인 불필요)
- 카카오 KV: `user:{email}` + `kakao:{kakaoId}→email` 역참조 (TTL 90일)
- 카카오 탭 라우팅: role="user"→list, "expert"→expert, "admin"→admin

### 비로그인 블라인드
- AptCard: 점수 블러("??") + 상세/지도 LoginPromptModal
- CompareSheet: 점수 "??" 텍스트 치환 (CSS blur 아닌 DOM 미노출), export/공유 숨김
- LoginPromptModal Analytics: trigger prop (detail/map), 4개 이벤트

### React 성능 패턴
- useDeferredValue: 필터 5개 원시값 (filterRegion/filterGu/sortKey/moveInFilter/builderTier)
- useTransition: 정렬 변경 시 startSortTransition (useFilterSort.js)
- filterOptionCounts: 단일 패스 leave-one-out (5N→1N 최적화)
- AptListSection: IntersectionObserver 무한 스크롤 + "더 보기" 폴백
- App.jsx closeDetail 의존성: `[detail]` (React Compiler 호환)

### 데스크톱
- 키보드 단축키: 1~5 프로필, Ctrl+Z undo, Ctrl+Shift+Z redo, Escape 모달닫기
- 헤더 화이트 테마: C.borderStrong("#D1D5DB"), 모바일 borderBottom 1.5px

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

---

## 공유 인프라 (mibunyang ↔ naver-estate-web)

| 자원 | 상세 | 주의사항 |
|------|------|---------|
| Supabase DB | mibunyang: `rwdtljipvmqpazrimyns` / naver-estate-web: `gcfckzqrcujktloilwpz` | 공용 테이블은 mibunyang DB |
| data.go.kr API Key | MOLIT_KEY | 일일 10,000건 공유 |
| 집 서버 IP | 192.168.219.101 (외부: Cloudflare Tunnel) | 네이버 rate limit 공유 |
| Vercel Team | `developer-dunos-projects` | 프로젝트별 환경변수/배포 독립 |

### 공유 규칙
- **테이블 소유권**: 공용 테이블 기존 컬럼 변경/삭제 금지 → `supabase/CLAUDE.md`
- **API 쿼터**: 일일 10,000회 분배 + 10일-토요일 충돌 방지 → `scripts/CLAUDE.md`
- **네이버 시간 분리**: mibunyang 08:00(월/목), naver-estate-web interval → `scripts/CLAUDE.md`
- **마이그레이션**: 공용 테이블 ALTER 전 상대 프로젝트 쿼리 검색 필수 → `supabase/CLAUDE.md`

---

## 개선 백로그 (2026-04-19 /improve 분석 결과)

> 상세 리포트: `~/.claude/plans/pwd-f-mibunyang-improve-report.md`
> 🔴 미션은 /blueprint 로 바로 실행. 🟡/🟢 는 3회 이상 /improve에서 반복 지적되면 🔴 승격.

### 🔴 즉시 (미션 1개 · 2단계)
- ~~**미션 1 — 공개 API 보안**: `api/supabase/{apartments,prices,unsold-history}.js`에 `rateLimit: "proxy"` 추가 + `npm audit fix`로 dompurify moderate 해소 (GHSA-39q2-94rc-95cp)~~ **완료 (세션119, 4커밋 `deef147..be54322`)**

### 🟡 곧 (이번 달 · 6건, 이 중 4건 완료)
- 의존성 메이저 업그레이드: `eslint 10` **🔴 차단** (세션125 에픽 3-A 조사: eslint-plugin-react 최신이 peer eslint ^9.7까지만 지원), ~~`@vercel/kv 3`~~ **완료 (세션130 에픽 4-C 커밋 `4a90768` — @vercel/kv 패키지 자체 제거, @upstash/redis@1.37.0 단독 사용)**, ~~`@vercel/analytics 2`~~ **완료 (세션119 3차 후속, 커밋 `22434c2`)**. Node 환경 핀(engines + .nvmrc)은 세션125 커밋 `6520ec9` 로 선행 완료
- ~~`@supabase/supabase-js` 2.98→2.103 마이너~~ **완료 (세션119 후속, 커밋 `73b3295`)**
- ~~`onClick={() => ...}` inline 클로저 75건(실측) → useCallback (ExpertDashboard 등 상위)~~ **부분 완료 (세션121 A, 커밋 `1ed7db3` — memo 자식 효과 확실한 6건 처리: ExpertDashboard.handleSelect + AdminDashboard 5건. 루프 28건·이미 적용 6건·trivial 다수는 의식적 배제)**
- ~~`admin/review.js:72` 이메일 `.includes("@")` → RFC 5322 정규식~~ **완료 (세션119 후속, 커밋 `1d4f3c3`·`295334c` — 공용 `isValidEmail()` 추출)**
- ~~`App.jsx` 442줄 → `useAppState()` 훅 분리 (250줄 목표)~~ **완료 (세션120, 3커밋 `54818b9..97bcb67`, 442→354줄 -88, 4훅 추출)**
- ~~`api/supabase/apartments.js` sanitize() 54필드 → 그룹별 분리~~ **완료 (세션119 3차 후속, 커밋 `587826d`→`d704adf` — 7헬퍼 + 스냅샷 테스트)**

### 🟢 여유 (분기 내 · 8건)
- inline `style={{...}}` **787건** → CSS 상수·className 전환 (대규모)
- ~~`LoanRatesSection:49` 금리 탭 Skeleton 보강~~ **완료 (세션122, 커밋 `88b7138` — `SkeletonText lines=4`)**
- ~~`AdminDashboard` 로딩 UI (`adminLoading` 상태 렌더링)~~ **완료 (세션122, 커밋 `88b7138` — `SkeletonList` statsLoading/adminLoading 2지점)**
- ~~저장 액션(가중치·프리셋) 토스트 피드백 추가~~ **완료 (세션121 C, 커밋 `9e52be8` — 4지점 useToast 적용: 가중치 저장/초기화, 프리셋 저장/삭제)**
- ~~`AdminDashboard` 412줄 → 매출탭/승인탭 분리~~ **완료 (세션138, 3커밋 `97d205a..cdfe592`, 417 → 96줄 -321/-77%)**. 실측 "매출탭" 부재 확인 → 실제 분리 축은 **StatsSection + UserCard + UserList 3분할**. admin 폴더 3 → 6컴포넌트. test 293줄 0수정
- ~~`InfoPage.jsx` 267줄 → sections/info/ 서브폴더 분리~~ **완료 (세션140, 2커밋 `54ecea1..5408446`, 267 → 60줄 -77%)**. sections/info/ 4파일 구조: GuideSections 175줄 / ScoringEngine 45줄 / FAQSection 33줄. InfoPage 60줄(시작하기 + 3 호출 + ExpertCTA). Public API·테스트 0수정
- ~~`src/scoring/engine.js`·`scorePrice.js` JSDoc 추가~~ **완료**: 세션122 에픽 2-A 커밋 `7b4b0ad` (engine·scorePrice·computeRegionalMedians 7함수) + 세션123 에픽 2-B1 커밋 `d314f2f` (scoreLocation·Product·Benefit 3함수) + 세션124 에픽 2-B2 커밋 `a2ea62e` (scoreRisk·scoreFuture 2함수 + matchAny + 5키워드 상수). **src/scoring/ 7파일 12식별자 JSDoc 시리즈 완성**.
- ~~`api/supabase/prices.js` ↔ `unsold-history.js` 중복 11줄 → 공통 헬퍼~~ **완료 (세션121, 커밋 `3cad834` — `createTimeseriesHandler` 팩토리 추출, 외부 동작 불변)**
- ~~`collect-building-hub.mjs:243,252` TODO 2건 (HpPermitService 구독 결정)~~ **완료 (세션139, 2커밋 `1434c2f..00280a9`)**. 네이버 경로로 `heat_fuel`·`quake_design` 수집 중 실측 확인 → HpPermitService 미구독 확정, fetchHeatFuel/fetchQuakeDesign 함수 2개 + 주석 블록 삭제(-61줄), scripts/CLAUDE.md 에 재오픈 트리거 3종 박제

---

## 서브디렉토리 규칙 파일

| 디렉토리 | 핵심 내용 |
|---------|----------|
| `src/scoring/CLAUDE.md` | 가중치 합계 100, 클램핑, null 처리, 스코어링 파이프라인 |
| `src/components/CLAUDE.md` | memo 36개, 접근성(ARIA/터치타겟/대비), 크로스브라우저 |
| `src/hooks/CLAUDE.md` | Hook 호출 순서, useMemo 의존성 13개, 파생 상태 |
| `api/CLAUDE.md` | JS null 함정, 한글 인코딩, Supabase 연동, withHandler 패턴 |
| `scripts/CLAUDE.md` | units 보정, 네이버 로컬 6단계, 후처리, API 쿼터 |
| `.github/workflows/CLAUDE.md` | 35개 워크플로우 목록, GitHub Secrets, 스케줄 |
| `supabase/CLAUDE.md` | 15개 테이블 스키마, 2 VIEW, presale 19컬럼, RLS 정책 |

---

## 작업 규칙 (Plan → Guard → Work → Review)

### Plan (새 기능/리팩토링 요청 시 자동 진입)
- 단계당 수정+신규 파일 **3개 이하**
- 단일 파일 **80줄 이내**(고위험 50줄), 단일 컴포넌트 **150줄 미만**
- **5파일+** 수정 시 반드시 단계 분리
- DB 변경과 API 변경은 **다른 단계**에서
- 한 단계에 "타입 + API + 컴포넌트" 동시 생성 금지
- 플랜 필수 포함: 파일 목록+참조처(grep 결과) / 실행 순서+의존 / 영향 범위 / 롤백 / 테스트 / 단계별 예상 줄 수

### 의존 분할 순서
DB 스키마 → 타입 → API → 훅/유틸 → 하위 컴포넌트 → 메인 컴포넌트 → 페이지 라우트

### Guard (위반 시 실행 금지)
- 5파일+ 수정 → 단계 분리
- DB 변경 → 롤백 마이그레이션 명시
- API 변경 → 사용하는 프론트 페이지 나열
- 새 기능 → **에러 처리 / 로딩 상태 / 빈 데이터 / 입력 검증 / 반응형(375px) / 중복 제출 방지** 필수
- "영향 없음" 판정은 **grep 결과 기반**만 인정

### Work
- 계획에 없는 파일 수정/리팩토링 금지 (하고 싶으면 "범위 초과" 표시 후 승인 대기)
- 단계 끝날 때마다 `npx vite build`
- 에러 자동 수정 **3회 실패** 시 중단+보고
- 새 코드에 한국어 주석으로 목적 설명, 기존 네이밍/패턴 따를 것

### Review (커밋 전 자동 수행)
1. **simplify** 스킬 — 변경 코드 재사용성/품질/효율 리뷰
2. **5교차검증 병렬 에이전트** — Task 도구로 **동일 메시지에서 동시 기동** (또는 `/cross-validate` 슬래시 커맨드 사용):
   - **빌드**: 메인 agent가 `npx vite build` 실행 + import 누락 + 번들 크기
   - **스코어링**: `Task(subagent_type="scoring-validator")` — 전용 서브에이전트 호출 **필수**. 메인이 직접 grep 금지
   - **null 안전성**: `Task(subagent_type="null-safety-checker")` — 전용 서브에이전트 호출 **필수**
   - **Hook 규칙**: 메인 agent가 직접 검사 (호출 순서·의존성·조건부 호출)
   - **보안**: 메인 agent가 직접 검사 (XSS·인젝션·env 노출·innerHTML·withHandler)
   - 수집기 관련 변경 시 추가로 `Task(subagent_type="collector-contract")` 호출
3. **SESSION_LOG.md 교차검증 섹션에 어느 에이전트가 찍었는지 기록** (예: "스코어링: PASS (scoring-validator)"). 에이전트 호출 이력이 없으면 "검증 미실행"으로 표기
4. console.log 잔재 제거
5. `git commit` + `git push` (자동)
6. CLAUDE.md "현재 진행 상황" 업데이트
7. `.claude/SESSION_LOG.md` 업데이트 (날짜별 누적, 삭제 금지, .gitignore 금지)

**금지**: 전용 에이전트가 존재하는 축(스코어링, null 안전성, 수집기 계약)을 메인 agent가 **직접 검사하는 것 금지**. 전용 에이전트가 있는데 우회하면 커버리지 누락·결과 비교 불가·SESSION_LOG 추적 불가.

### 안티패턴
1회용 유틸 금지 / 과도한 추상화 금지 / 추측 금지(도구 실행 결과만 인정) / 테스트는 새 기능당 정상 1 + 에러 1 최소

---

## 로컬 Claude 자원 (2026-04-14 리뉴얼)

### SESSION_LOG.md vs memory 역할 분리
- **`.claude/SESSION_LOG.md`** (커밋 추적): 과거 지향·불변. 날짜/커밋 SHA/결정 근거. 세션 종료 시 1회 append.
- **`~/.claude/projects/f--mibunyang/memory/`** (gitignored): 현재 지향·휘발. 진행 중 가설·다음 단계·TODO.
- **중복 금지**: 확정 사실은 SESSION_LOG로 이관 후 memory에서 삭제. 같은 사실 두 곳 작성 금지.
- CLAUDE.md "현재 진행 상황"은 한 줄 요약만 — 상세는 SESSION_LOG.

### 프로젝트 전용 슬래시 커맨드 (`.claude/commands/`)
- `/collect-naver` — 네이버 수집 + post-naver-collect 파이프라인
- `/score-recalc` — 점수 재계산 + PROFILES 가중치 합 sanity
- `/cross-validate` — simplify + 5교차검증 병렬 (Review 단계 자동화)
- `/db-quality` — apartments_flat 품질 지표 재측정

### 프로젝트 전용 서브에이전트 (`.claude/agents/`)
- `scoring-validator` — 가중치/클램핑/null 검증
- `null-safety-checker` — optional chaining·기본값·숫자 포맷 가드
- `collector-contract` — 수집기 배치/upsert/병렬/쿼터/에러 계약

### settings.json hooks (비차단 경고)
- `SessionStart`: cwd=mibunyang 확인 (D:\ 재발 방지)
- `PostToolUse(Edit|Write)`: 5파일+ 편집 감지 → `.build-dirty` 플래그
- `Stop`: build 상기 + 카운터/플래그 리셋

---

## 이 프로젝트에서 자주 쓰는 스킬

Claude는 스킬 리스트를 시스템 리마인더로 이미 받고 있음. 아래는 mibunyang에서 유독 자주 쓰는 것만 — 상황이 맞으면 추가 요청 없이 자동 호출:

- **`/engineering:debug`** — 재현 필요한 UI 버그, "X가 안 됨"
- **`/engineering:incident-response`** — 행안부 API 500/502 같은 외부 장애, 네이버 수집 실패 연쇄
- **`/data:sql-queries` · `/data:explore-data`** — Supabase 쿼리 작성, apartments_flat 품질 진단
- **`/data:analyze`** — price/unsoldRate 트렌드/세그먼트 조사
- **`webapp-testing`** — UI 변경 후 브라우저 검증 (Playwright, **필수**)
- **`frontend-design`** — 새 컴포넌트/섹션 작성 시 자동 발동. Pretendard · C.borderStrong · memo 36개 구조 일관성 유지
- **`/code-review:code-review`** — GitHub PR 리뷰 (로컬 5교차검증과는 별개)
- **`/engineering:tech-debt`** — price 64%/dataReliability 57.4% 같은 품질 갭 전략
- **`simplify` · `commit`** — 커밋 전 자동 (Review 단계에서 호출)
- **`session-report` + `/claude-md-management:revise-claude-md`** — 세션 마무리 시
