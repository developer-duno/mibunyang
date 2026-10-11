## 세션 462 감사 — BACKLOG 비대 정리로 이동 (2026-07-02)

> 세션 462: BACKLOG.md 134KB → 완료(✅) 항목 71건 이동(색인 오래된 세션<400 한 줄 + 카테고리 섹션 상세 블록). 활성 항목·최근 색인·폐기(❌) 결정은 BACKLOG 잔류.

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
- ✅ SESSION_LOG.md drift 282~286 + 288 6 세션 흡수 — 메모리 3 파일 + git commit message + BACKLOG 본문에서 추출 (세션289, 1 docs 커밋)
- ✅ transport-tago 2.1배 느림 root cause 분석 종결 — 코드/API 결함 0 + 세션 294 timeout 90→120 fix 가 정답 (세션 295, docs only; 진앙=커밋 `01d0dd4` PostgREST max_rows fix, 단지 1000→2001 의도된 자리)
- ✅ audit-env-keys matrix orchestrator 답습 보강 (세션 304+308, 커밋 `96fbdcc`+`58f5983`; MATRIX_ORCHESTRATORS 상수 + extractMatrixJobs() + js-yaml FAILSAFE_SCHEMA; vitest 4 test; fill-missing-data.yml Phase 3+4+5 폐기로 phase2-calc 3 job 만 잔존)
- ✅ dataUpdatedAt vs fetchedAt drift fix (세션 280/281/292, 커밋 `89831d7`+`a4c6d8d`; collect-data.mjs L1026 양쪽 키 동시 박제 + staticDataApi.ts L46-47 fallback 듀얼 방어; staticDataApi.test.js 회귀 가드 4건)
- ✅ ARCHITECTURE.md/CLAUDE.md/README.md 박제값 일괄 정정 (세션 313; apartments 1500→2001 / App.jsx→App.tsx 다중 / memo 36→45 / api 21→23 / workflows 35→47 / Vercel KV→Upstash Redis / collect-data 1065→1193줄 / src/lib/*Api 5건 stale 정정)
- ✅ 4 collector --json wrapper fix + split 자동 호출 (세션 314; environment/industry-match/transit-match/noxious 4 collector readFileSync wrapper 파싱 + writeFileSync `{...rawWrapper, data, count}` 보존 + spawnSync split-apartments-json 자동 호출. 진앙 = `apartments.json` nested `{ok, data, fetchedAt, dataUpdatedAt}` 구조를 flat array 로 단정한 4 collector 작성 시점 사고 → `.length` undefined + wrapper 손실 + split 0건 사고. 신규 테스트 2파일 7건 (environment.test.mjs 3 + split-apartments-json.test.mjs 4). 운영 cron 미사용 = 로컬 사고만 차단. 답습 자산 = `prebuild.mjs` L2/L11 spawnSync 패턴)
- ✅ KOSIS #14 범죄율 시도 collector 가설 환각 정정 (세션 315 docs only; regions.crime_grade 758행 중 701행 (92%) 이미 채워짐 = 시도 76 + 시군구 625. CSV 기반 `collect-crime-safety.mjs` 가 시도+시군구 모두 매칭. KOSIS DT_13501N_A120 신규 collector = 불필요. NULL 57행 진짜 잔여 = CSV 갱신 (연1회 수동) 또는 행정구역 개편 분구 18행 보강 별 자리. 자가 점검 1 + 서브에이전트 #3 보고로 박힘 정정)
- ✅ collector_runs 모니터링 사각지대 — 6 collector silent fail 종결 (세션 319 진단 + 세션 320 정정 + 세션 321 진앙 확정, PR #25 + #26 + #27; 진앙 = **workflow yml timeout 부족** 확정. 가설 K (race condition) 부정. 실증 = molit-building run 26451400957 정확히 30분 cancelled + maintenance run 26450043464 정확히 1h0m15s cancelled. raw log = 단지 처리 중간 끊김 → recordCollectorRun 도달 못함. 정정 5건: molit-building 30→90 / emergency 30→60 / kosis-unsold 15→30 / housing-permits 15→30 / maintenance 60→120. 다음 cron 자동 검증 6/1~6/15 박힘 의무)
- ✅ collector graceful shutdown 박힘 = timeout 근본 해결 (세션 321 PR #28 `4bfeaa9`; 사용자 제안 "시험 시간 다 되면 답안지 내고 나오기" 패턴. SIGTERM 받으면 loop 즉시 중단 + recordCollectorRun 호출 → collector_runs row 박힘 + status="partial". 8 파일 +58/-7. _shared.mjs createReporter 갱신 + setupGracefulShutdown export + types.ts Reporter interface + 6 collector main loop 1줄 박힘. vitest 140/140 pass. AWS Lambda/K8s/Heroku 표준. 데이터 자연 증가 대비 = timeout 늘리기 의무 0건)
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

- ✅ **backfill-presale-prices.mjs today() 통일 완료** (세션 419 부산물 → 세션 421 해소) — `new Date().toISOString().slice(0,10)`(UTC) → `today()`(KST 고정, `_shared.mjs`) 통일. 로컬 변수 `today`→`recordedDate` 개명(헬퍼명 충돌 회피), import에 `today` 추가(L16/44/53/57). prices 형제 writer(naver-presale)와 recorded_at 시간축 일치. dry-run 실증 recorded_at=오늘 KST·tsc:scripts 0. **일회성 수동 도구(cron 0건)라 실해는 0, 일관성용**
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

- ✅ **housing-permits regions UPDATE 동종 버그 — id PK 최신행만 UPDATE 선제 수정** (세션 367 발견 → 세션 368 PR)
  - `housing-permits.mjs` `.eq("region").is("gu",null).order(recorded_at).limit(1)` = PostgREST PATCH 가 order/limit 무시 → 같은 시도 전체 스냅샷 UPDATE 버그였음. `pickLatestRegionId` (export, 인라인 독립 구현 — childcare PR #76 패턴 답습, trade-stats import 사이드이펙트 회피) 로 시도별 최신행 id 추려 `.eq("id", latestId)` 로 좁힘. 회귀 테스트 5건 + 실 DB 실증(서울 5스냅샷 중 id=36@2026-03-20 최신만 선택 확인).
  - 선제 수정 근거: 현재 supply_ratio 0건(MOLIT API 500 장기 사고)이라 미발동이나, **API 복구 시 과거 시계열 영구 오염 차단** + "최신 1건만" 의도를 코드에 정확히 표현(거짓 안전 `.order().limit(1)` 제거). 화면 영향은 `latest_regions` VIEW(최신행)라 전후 0.
- ✅ **regions.childcare 좌표 톱니 구조 — merge 보존으로 차단 (세션 367 발견 → 세션 370 PR)**
  - 진단: `childcare-detail` 매일 04:00 좌표(la/lo) ~23일 누적 보강 → `collect-nearby-childcare` 05:30 회수→schools 적재 → **`childcare-info` 가 발화할 때마다(월간 cron + 수동 dispatch, 5/19·5/26·6/01·6/02 실측) facilities 를 7필드(좌표 없음)로 덮어써 좌표 전멸** = 톱니 패턴. nearby ok_count 5/25=484→5/26=115→6/01=423→6/02=100 붕괴 실증.
  - 세션 367 PR(#76)은 "최신행 1개만" 덮도록 좁혔으나 최신행 좌표는 여전히 매번 전멸(최신행 좌표 0/246키 실측). **세션 370 = 옵션 (a) 채택**: `mergePreserveCoords(newAgg, prevChildcare)` 헬퍼 신규(childcare-info.mjs export, jeju import) — UPDATE 직전 기존 최신행 facility 의 좌표/70필드를 stcode 기준 보존, 7필드만 신규 갱신. count/total_capacity/fetched_at 는 신규 집계값. info + jeju 양쪽 동시 적용(자매 동종 버그). 단위 테스트 5건 + 실 DB merge 실증(경기 과천시 좌표 58개 전수 보존). 화면(NearbyChildcareSection)·scoring 경로 불변, JSONB 스키마 불변.
  - 효과: 최신행이 항상 좌표 보유 → nearby 매칭이 매번 100 붕괴 없이 590+ 유지 + detail ~23일 재축적이 리셋되지 않아 좌표 커버리지 단조 증가. 사후 검증 = 머지 후 다음 info 발화 시 최신행 좌표 보유율 0%→상승(다음 세션 cron 관측).

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

- ✅ **regions.jeonse_rate 0% → 22.2% — 채움 collector 신규 (세션 324 PR #29 머지)**
  - 세션 323 환각 = "orphan 가능성" → 세션 324 실측 폐기 (naver-estate-web cross-repo 4 위치 활성 사용)
  - 정정 = `scripts/collectors/trade-stats-regions.mjs` 신규 (trade-stats.mjs 산식 시군구 단위 집계, 표본 ≥ 3 게이트)
  - 운영 검증 = workflow_dispatch run 26471102001 success → 168/758 (22.2%) 박힘
  - 잔여 590 시군구 = 표본 부족 (jeonse 거래 < 3) 농어촌 자리 자연 NULL

- ✅ **DetailModal L82~85 Supabase 가드 환각** (세션 280 동반 커밋 `0557e1a` 정정 완료, 세션 283 stale drift 발견)
  - `0557e1a fix(detail): 가격배열 fetch 가드 정정 (undefined/null/배열 skip)` (MarketStatsCharts 작업 동반)
  - 현 본문 L87 `null || Array.isArray` → skip + L90 `!== undefined` → skip + undefined 만 fetch 발동
  - BACKLOG 박제값이 1주+ stale 자리 (`feedback_memory_not_authoritative.md` 답습)

- ✅ **입주 빠른순 정렬 — 세션 424 완료 (PR #127, main 47517a9)** — 세션 423 보류 해소. 위 완료 색인 참조. **보류 시 우려했던 "과거 완공 상단 점령" 함정을 사장님 결정 "지금 들어갈 집 먼저"로 역이용**: 준공완료(=즉시입주 가능한 미분양)를 오히려 rank0 최상단에 둠. 적대검증 4에이전트가 1차설계(미래예정 먼저)의 라벨↔동작 충돌 반증 → 재설계. comparator `/^\d{6}$/` 정규식으로 "미정" 36건+null 일관 맨뒤 처리(보류 시 우려한 "미정 가드"). 표현계층만(점수·엔진 무변경).

- ✅ **fill-missing-data.yml 개명** (`backfill-new-apartments.yml`) + `monitor-collectors.yml` `workflow_run.workflows` 동기화 (세션 453, 동작 보존) — `name: Fill Missing Data → Backfill New Apartments` + workflow_run 매칭 동기화(파일명 아닌 name 으로 매칭) + audit-env-keys.mjs/audit-fill-matrix.mjs 경로 갱신. spec `2026-05-25-fill-missing-data-redesign.md` Phase 3 완결

- ✅ **코드 단순화 4건 + naver-listings 죽은코드 제거** (세션 456, PR #199, main `9f6e183`, 동작 100% 보존) — AI 49 에이전트 전수 코드 냄새 진단(SAFE 7/RISKY 22/FALSE 16) 후 안전 정리만. **A** naver-listings.mjs 로컬 중복 `sleep` 제거→`_shared` import 통일 / **B** kakao/infra.ts `keys`·`defaults` 별도배열→`[{key,fallback}]` 객체배열 짝 보장 / **C** SearchFilterBar undo/redo 버튼 인라인스타일 중복→`undoRedoBtnStyle` 헬퍼 / **D** AptCard 추천이유 3중삼항→if-else 평탄화 / **F** naver-listings 죽은코드 제거(`getComplexDetail`·`NAVER_COMPLEX_API`·미사용 `sb`·import). **검증** vitest 3777 변경전후 동일·typecheck0·lint0·build0·infra esbuild0·CI/e2e/Vercel green. **보류** E(useDataPipeline matcher 분리)=현재 명확+의도된 leave-one-out 성능패턴(과한 단순화 경계). 사고 1건=CI format:check 누락(회귀가드에 미포함→정정, [[format-check-in-guard]] 메모). 동작·점수·DB 무변경.

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

- ✅ **transport-tago 단위 시간 2.1배 느림 root cause 분석** (세션 295 종결)
  - 진앙 자리 확정: 커밋 `01d0dd4` (2026-05-22 07:42) `limit(10000) → range 페이지네이션` 자리 — transport-tago L194 fetch 자리 1000 → 2001 단지 전체 답습
  - raw log 실측: 5/21 (1000 단지) 524 미수집 2281.7초 단지 당 **4.35초** / 5/22 (2001 단지) 1001 미수집 4476.5초 단지 당 **4.47초** — 단지 당 시간 3% 노이즈 (코드/API 결함 0)
  - 세션 294 timeout 90→120 fix = 정확한 정정 자리 (회귀 자리 없음, 의도된 단지 수 자리)
  - 답습 자산: `.claude/rules/collectors/collector-timeout-rootcause-analysis.md` 신규 (4-way 답습 의무 박제)
  - 진단 사고: v1 환각 "단지 폭증 (네이버 신규)" → `apartments.created_at` 실측 30일 신규 0 → v2 정정 (`git log -- <collector>` 답습 후 진앙 자리 확정)

- ✅ **`environmentMatchGlobs` → `projects` 마이그레이션 완료** (세션 348) — 상세 = [BACKLOG_ARCHIVE.md](BACKLOG_ARCHIVE.md) 색인 참조

- ✅ **네이버 마커 1424개 클러스터 성능 실측 — 측정 완료, 버벅임 없음 종결** (세션 436, 사장님 라이브 측정). production 데스크톱 크롬 전국 줌(최대 부하, 클러스터 원 20+개)에서 idle FPS **61(부드러움)** 일관. 팬/줌 순간만 일시 10~34 dip 후 즉시 61 회복(`MarkerClustering.js:413 _onIdle → _redraw` 전체 재계산 1프레임, 코드 진단 예측 지점). 정적 분석상 네이버 gridSize 120 > 카카오 60 = 오히려 더 공격적으로 묶음 → 튜닝 불필요 확정. 저사양 모바일은 dip이 더 깊을 수 있으나 사용자 보고 트리거 대기(현재 정상). **부산물: nelo 텔레메트리 CSP 차단 발견** — 네이버 SDK 가 `kr-col-ext.nelo.navercorp.com`(로그수집)으로 보내는 통신이 connect-src 미등재로 차단. 공식 확인 = NELO(로그분석 인프라)·DNS 차단리스트 등재 추적 도메인 = 지도 기능 무해. 사장님 결정 = **차단 유지**(손님 사용기록 네이버 유출 0, 콘솔 에러는 손님 미노출). 코드 변경 0.

- ✅ **필터 리디자인 PR2 (정렬 칩화+소제목색+2칸) — 세션 482 #260 완료 + ④컨트롤높이·2칸게이팅은 세션 483 #263·#264 완결. 원문:**
  - (원문) **필터 리디자인 PR2 — 정렬 칩화 + 상세 소제목 색 + 2칸 (세션 481 다음 최우선)** — 사장님 명시 "정렬은 아직 세로 17줄, 이걸 먼저". PR1(글래스 오버레이, #258 main 7485baf) 완료 후 3-PR 계획의 2단계. **① 정렬 칩화**: `SortPanel.tsx` `flexDirection:column gap:3`(17개 세로 나열) → `flexWrap gap:5` 칩. SORT_OPTIONS(17개, `sortOptions.ts`) 재사용, 각 버튼=색 dot+라벨, **선택된 것만 색**(나머지 회색). 세로 17줄→3~4줄 = 모바일 BottomNav(z100) 가림 해소(PR1 라이브서 확인된 현상). **② 상세 소제목 색**: `filterGroups.ts`(세션480)에 그룹 색 필드 추가(교통=blue·가족=pink·자금=indigo·안전=green), `DetailPanel.tsx` 소제목을 색 칩 라벨로 + 버튼 회색 통일(선택 시만 강조). **③ 상세 2칸 그리드**(PC 2/모바일 1, 세션480은 그룹화만·2칸 아님). **④ 컨트롤 높이 토큰** PC 32/모바일 36(filterStyles numInput·resetBtn + FilterButton + SortPanel 칩). 표현계층 전용(동작·데이터·점수·비로그인 무변경). 설계서 `docs/superpowers/specs/2026-07-05-filter-glass-redesign-design.md`. 목업 반복 합의 완료(사장님 65% 글래스·소제목색"가"안·칩·PC납작 전부 확정).
- ✅ **필터 리디자인 PR3 (카드 radius 통일) — 세션 482 #261 완료. 원문:**
  - (원문) **필터 리디자인 PR3 — 카드 버튼/배지 radius 통일 (세션 481 3단계)** — theme `R` 토큰(세션481 PR1 도입, chip7·btn8·panel10·badge6·card14)을 `AptCard.tsx` 에 적용. 현재 radius 제각각(infoTag 3·배지 4·6·버튼 8·카드 14/16) → R 토큰 치환으로 필터 칩과 통일. **radius 값만 치환**(동작·색·조건 무변경). PR2 이후. 사장님 "버튼을 홈페이지랑 통일" 요청 실현.

