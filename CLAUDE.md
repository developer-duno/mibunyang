# 미분양 아파트 비교 엔진 v3.0

> React 19 SPA + Supabase PostgreSQL + Vercel Serverless. 6개 카테고리 41+ 지표 AHP 스코어링.

## 현재 진행 상황

**마지막 작업**: 2026-04-19 세션118 — 수집기 부전 복구(거시 목적 "기존 수집기 100% 활용해 단지별 미등록 지점 100% 채우기" 진입). **9 GATE 초안 🔴3 → 재설계 후 🟢8/🟡1/🔴0**. 단계 0 실측 결과 플랜 3개 과제 스킵/취소 확정: (a) compute-scores gap 570 추정 → **실제 7건**만(애초부터 거의 채워짐), (b) `collect-trades.yml`에 matrix 구조 없음 + 지방 17개 시도 trades 전부 이미 존재(광주 16k/울산 13k/세종 28k/강원 12k/제주 1.9k) → **단계 4 지방 확장 스킵**, (c) `molit-units` 04-06 failure는 `scripts/CLAUDE.md "Exit Code 정책"` `failed>0→exit(1)` 의도적 계약이며 데이터 이미 upsert 완료 → **수정 불요**. **실제 실행 2단계**: (1) `.github/workflows/collect-naver-listings.yml` concurrency `data-collection` → `naver-postprocess` 분리(YAML 1줄, 6일 연속 cancelled 해소 — 2026-04-12~04-17 Naver Post-Processing이 월간 수집기 27개와 같은 그룹 공유해 큐에서 밀려남 → sync-naver-complex/geocode/reverse-geocode/calc-exclusive-ratio/transport/infra/schools 7단계 후처리 매일 누락), (2) `scripts/collectors/collect-unsold-kosis.mjs` L100-114 raw `https.request` → `fetchWithRetry` 교체(`_shared.mjs:130` AbortSignal+429/500/503+ECONNRESET 재시도 3회, 세션104 `migration.mjs` 패턴 재사용, 에러 prefix `KOSIS ...` 유지). 테스트 `collect-unsold-kosis.test.mjs` +1 ("ECONNRESET 1회 → 재시도 후 성공", 20→21 passed). **Review**: collector-contract PASS(배치/upsert/병렬 0바이트, 쿼터 로깅 영향 0) / null-safety-checker PASS(모든 에러 경로 outer try/catch 수렴, `data.err` 접근 안전, `err.message` Error 인스턴스 보장). **단계 5·6 세션 내 추가 실행**: (5) compute-scores dry-run 결과 apartments_flat VIEW가 2001 중 1,424건만 노출(577건 필터링됨), cats_cache NULL 7건은 정상 단지인데 VIEW 범위 밖이라 **재계산해도 반영 불가 → 스킵 확정**. 근본 원인(VIEW 필터링 조건) 조사는 별도 에픽. (6) B1 R² 실험: regions 시도 17행 중 `population`/`households`/`jeonse_rate`/`supply_ratio` 4컬럼 전부 NULL 실측 → 사용 가능 독립변수 8개로 축소, NULL 드롭 후 유효 14건. Pearson top3 `avg_price_sqm`+0.70/`land_cost_ratio`+0.69/`pop_growth`+0.62. LOOCV 최고 성능 Ridge α=10 **R²=+0.379 / MAE=10.60만원/월** → **게이트 R²≥0.7 실패**, C 공식 확정 재확인. `.claude/plans/session117-sigungu-income-poc.md` 4.2절 B1 실패 기록 append(gitignored). 재검토 조건: regions NULL 4컬럼 수집 완료 or 시군구 실측 소득 소규모 확보. **KPI**: vite build 🟢 384ms, 변경 3파일 순 +23줄, 커밋 2개 origin/main push 완료. **추가 조사 (같은 세션)**: 별도 에픽 후보 2개 심층 실측 완료 — (A) **apartments_flat VIEW 577건 누락 근본 원인 확정**: VIEW dedup CTE의 `PARTITION BY regexp_replace(name,'\([^)]*\)$','')` + `ORDER BY id DESC`가 "(오)" 접미 오피스텔 쌍 단지에서 오피스텔 우선 선택. cats_cache NULL 7건 전부 일반분양 본체가 (오) 오피스텔(id 더 큼)에 가려진 케이스(ap-6028344/ap-6028138 등 7개 쌍 실측). VIEW 계약상 의도적 동작이지만 UX·스코어 정책 재검토 필요 → 별도 에픽. (B) **regions NULL 4컬럼 수집기 실태**: `population` 시군구 420/454 (92.5%) 채워져 있으나 최신 3-14/3-20 스냅샷의 시도 17행만 부분 NULL(2-01 스냅샷엔 정상), `households`/`jeonse_rate`/`supply_ratio` 0/454 — `households`는 수집기 부재, `jeonse_rate`는 `trade-stats.mjs:461`이 apartments만 저장, `supply_ratio`는 `housing-permits.mjs`가 `householdMap[region]=r.households||r.population`에 의존하는데 시도 레벨 둘 다 NULL이라 체인 차단. **B1 v2 재실험**: tmp/poc-b1-sido-train-v2.csv 추출(시도별 population NOT NULL 스냅샷 + 필드별 non-null 합성), 14행 → 유효 12건, 독립변수 9개(population 추가). 최고 Ridge α=10 **R²=+0.290 / MAE=12.58만원/월** (v1 +0.38 대비 하락). **게이트 재실패 — C 확정 유지**. 재검토 조건 업데이트: 시군구 392 실측 샘플 확보만이 실질적 해결책 (A안 TASIS 스크레이핑 재검토 불가피 가능). **새 에픽 후보**: (a) dedup 정책 `presale_stage='일반' 우선` 정렬 추가, (b) `households` regions 수집기 신설, (c) `trade-stats.mjs`에 regions.jeonse_rate 파생 저장, (d) population.mjs 3-14/3-20 부분 NULL 재현·수정. **다음 세션(119+)**: 단계 3(사용자 키 3개 발급 후) + 위 에픽 중 택1.

**이전 작업**: 2026-04-18 세션117 — 시군구 소득 PoC 상태 공식화(C 확정, 코드 변경 0, docs-only 1커밋). 세션116이 작성한 PoC 설계 문서(`.claude/plans/session117-sigungu-income-poc.md`, gitignored)를 `대기 (Waiting on trigger)` → `공식 확정: C (현상 유지)`로 상태 전이. **판단 근거 3개**: (1) 트리거 증거 0 — 섬·군 10개 단지(인천 동구 2/옹진군 2/가평 3/양평 2/연천 1) 왜곡에 대한 사용자 제보·UX 피드백·경쟁사 도입 사례 중 발동 0, (2) 세션114 정직성 보정(`fairPriceFromSidoAvg` 플래그 + `PRICE_FALLBACK_RELIABILITY_PENALTY=15` + 괴리도/신뢰도 detail 경고 접미)이 세션115 Playwright 5/5 DOM 노출 실측으로 작동 확인, (3) B안 B1 상관관계 분석이 R²<0.7이면 2세션 매몰비용 — 2~4세션 투자 정당화할 실사용 왜곡 근거 없음. **9 GATE 전 🟢9/🟡0/🔴0** (Explore 실측: `git check-ignore .claude/plans/session117-sigungu-income-poc.md` exit 0, 민감정보 grep 0건, CLAUDE.md L56 단일 라인 unique 확인). **재오픈 트리거** 4개(왜곡 제보/UX 잡음 피드백/경쟁사 도입/시도=시군구 지역 추가 왜곡) 발동 시 세션118+에서 B 우선 검토 → 실패 시 A. PoC 문서 A/B 선택지 분석(1~3절)은 재오픈 대비 전량 보존. **Review**: 코드 변경 0줄 → 전용 에이전트 대상 축(scoring-validator·null-safety-checker·collector-contract) 해당 없음 (세션116과 동일 근거). **KPI**: vite build 🟢, 변경 파일 3개(git 추적 2: CLAUDE.md·SESSION_LOG.md / gitignored 1: PoC 문서).

**이전 작업**: 2026-04-18 세션116 — 세션115 남은 과제 3개 순차 정리(전부 문서 변경, 코드 0줄). **작업1**: `scripts/fix_sejong_coord.mjs` 처분 — Supabase SDK 재확인 결과 `ah-2022910239` lat=36.4975527417026, lng=127.256494831314 이미 반영. 4세션째 untracked 방치된 파일 삭제(백업 로직 없어 리스크 0, 스크립트 자체 가드 L43-45 `before.lat != null` 분기로 dry-run도 무동작). **작업3**: CLAUDE.md 행안부 문구 정정 — `gh run list --workflow=collect-population.yml` 결과 2026-04-05 schedule `success` 2m40s 확인 → "행안부 API 복구 대기"는 의미상 부정확. `migration.mjs`는 세션103에서 KOSIS DT_1B26001_A01 전면 전환(행안부 호출 0), `population.mjs`만 MOIS_POP_KEY 의존하되 현재 장애 없음. 우선순위 6번을 "population.mjs MOIS 인구 API 안정성 모니터링"(상시 대기 불필요, 장애 시에만 대응)으로 재명명. **작업2**: 시군구 소득 수집 PoC 설계 문서 `.claude/plans/session117-sigungu-income-poc.md` 작성(로컬 전용 gitignored). 선택지 A(TASIS WebSquare 스크레이핑, 3~5세션, 법적 리스크 중)/B(시도값 기반 회귀·추정, 2~4세션, 법적 리스크 하)/C(현상유지) 비용·신뢰도·유지보수 비교, **추천안 C** + 트리거(사용자 왜곡 제보 등) 발생 시 B 우선 → 실패 시 A. 관련 라인 탐색 결과 기록: [trade-stats.mjs:314-317](scripts/collectors/trade-stats.mjs#L314-L317) 3단 폴백, [scorePrice.js:61](src/scoring/scorePrice.js#L61)~[L126](src/scoring/scorePrice.js#L126) `fairPriceFromSidoAvg` 런타임 플래그(DB 미저장). **Review**: 코드 변경 0줄이라 scoring-validator·null-safety-checker·collector-contract 등 전용 에이전트 대상 축 해당 없음 → vite build + grep 정합성만 수행(SESSION_LOG에 생략 근거 기록). **KPI**: vite build 🟢 (세션 마감 재확인), CLAUDE.md 우선순위 6항목 중 2개 완료 체크(fix_sejong 삭제·행안부 교정), 미래 트리거 문서화 1건.

**이전 작업**: 2026-04-18 세션115 — 세션114 sidoNotice/폴백차감15 **끝단 UI 실측**(프로덕션 전문가 대시보드). Playwright + `addInitScript`로 `expertToken`/`refreshToken`/`userRole=expert` localStorage 주입 + `/api/auth/verify`·`/api/auth/login` `page.route` 스텁(useExpertMode verify 폴링 로그아웃 분기 차단) → `localStorage.userRole==="expert"` 시 `App.jsx:123 setTab("expert")` 자동 진입. **5/5 단지 전부 DOM 노출 확인**: 자라섬 수자인(rel 55→45), 효성해링턴 양평(55→45), 인천 두산위브 더센트럴(57→47, **동명 단지 부평구 필터링을 위해 키워드 "인천 두산위브"**), 에코리버(67→57), 리아츠 더 인천(67→57). 괴리도 detail에 `" — 광역 시도 평균 기준(실시세 왜곡 가능)"` 5/5, 신뢰도 detail에 `" -폴백차감15"` 5/5. **콘솔 에러 0**. **세션114 CLAUDE.md 교정**: "로그인 후 DetailModal 실측" 문구는 부정확 — 실제 노출 지점은 전문가 탭 `ExpertDashboard` (`src/components/expert/ExpertDashboard.jsx:100` → `ExpertScoreBreakdown` L58 `{sub.detail||sub.info}`), DetailModal(소비자 뷰) 아님. **작업2**: 시군구별 소득 수집 가능성 조사(코드 X, 경로만). KOSIS 공식 FAQ로 "시군구 해상도 소득 통계 공식 없음" 확정 → A(KOSIS) 불가 / B(TASIS WebSquare 스크레이핑, 난이도 중상·법적 이슈) / C(시도값 기반 폴백 추정 모델). 장기 과제로 문서화만. **작업3**: unstaged 노이즈 정리. `.bak-20260415` 2개 삭제(4세션째 방치), `.gitignore`에 `backups/`·`**/*.bak-*` 추가(기존 tracked 디렉토리 session113/114 영향 없음). `scripts/fix_sejong_coord.mjs`는 실행 여부 미확인으로 보류. **KPI**: vite build 🟢 392ms / 실측 스크립트·스크린샷·result.json 증거 `backups/session115_scripts/`(gitignore됨). 커밋 `32f1885`.

**이전 작업**: 2026-04-18 세션114 — 시도 평균 폴백 사용 시 **dataReliability -15 차감 + detail 경고 접미**(방안 A+B). **실측 검증**: 커밋 `ee85ce3` 푸시(04-18 01:05 KST) 후 daily-deploy(04-18 03:44 KST)가 자동 실행해 `apartments.cats_cache` **5/5 단지에 sidoNotice 문자열 주입 확인**(DB SDK 실측, Supabase CLI 우선 원칙). Vercel 프로덕션 배포 **Ready**(mibunyang-peach.vercel.app), 카드 **1,321개 렌더 + 콘솔 에러 0건**(Playwright 회귀 실측). sidoNotice/폴백차감15 최종 노출은 **전문가 대시보드 `ExpertScoreBreakdown`**(세션115 실측 교정: DetailModal 아님)에서만 가시 → 비로그인 실측은 범위 초과. **부수 CLAUDE.md 세척**: API 엔드포인트 수 `14개 → 21개` 정정, "Vercel 12함수 감축" 우선순위 제거. 섬·군 지역 인접 실거래 실측으로 폴백 왜곡 확인(경기 시도 평균 7,312 천원/㎡ vs 여주 2,484·이천 2,819·가평 trades 0건 → 실시세의 2~3배 고평가). `src/constants/scoringTiers.js`에 `PRICE_FALLBACK_RELIABILITY_PENALTY = 15` 신규 상수. `src/scoring/scorePrice.js`: (A) `fairPriceFromSidoAvg` 플래그 도입, `avgPriceSqm`/`presalePp` 폴백 경로에서 `fairPrice>0` 시 true → `relBase = Math.max(0, apt.dataReliability - 15)`. (B) 정상 경로 반환 시 괴리도 detail 끝에 `" — 광역 시도 평균 기준(실시세 왜곡 가능)"` 접미, 데이터 신뢰도 info/detail에 `" -폴백차감15"` 접미. **점수 가중치 일체 불변.** 테스트 7개 추가. **KPI**: vitest 147 files **2,384 tests** 🟢. 커밋 `ee85ce3` / `d1749b7` / `e6c48ec`.

**이전 작업**: 2026-04-17 세션112 — `AptCard.jsx` price=0 단지 infoTag에 `classifyNoPrice` detail 노출. 세션111이 생성한 8분기 안내 문구(임대/정비/후분양/오피스텔/분양계획/택지블록/공공/기본)가 `ExpertScoreBreakdown.jsx:58`(전문가 모드)에서만 보이던 것을 일반 사용자 카드로 확장. 변경: [AptCard.jsx:100-104](src/components/AptCard.jsx#L100) 조건부 렌더 3줄 → 5줄 삼항 확장 (`info === "데이터 부재"`이되 `detail` 있으면 `<span>{detail}</span>`, 둘 다 없으면 null). 점수/가중치/scorePrice.js **일체 불변**. 테스트 [AptCard.test.jsx](src/components/AptCard.test.jsx)에 2케이스 추가(detail 노출 + `"적정가 -3.5%"` 회귀 방지). **KPI**: vite build 🟢 384ms / vitest 147 files **2,377 tests** 🟢 (세션111 2,375 → +2) / scoring-validator PASS (PROFILES 5×100·0.30+0.20+0.15+0.25+0.07+0.03=1.00 불변·PIR_SCORE_TIERS·PRICE_NO_DATA_DEFAULTS 상수 불변·스코어링 모듈 0바이트 diff) / null-safety-checker PASS (subs[0]?.info/?.detail optional chaining·detail undefined→null 반환·빈 span 방지) / Hook PASS (순수 JSX 조건부 렌더) / 보안 PASS (detail은 scorePrice 하드코딩 리터럴, 사용자 입력 없음). 커밋 `d21ace9`.

**이전 작업**: 2026-04-17 세션111 — `classifyNoPrice` 분기 확장으로 38건 pir NULL **100% 맞춤 안내 달성**. **세션111-A**: 오피스텔/택지지구 블록/공공분양 3개 분기 추가(21%→68%). **세션111-B**: 기타 잔존 12건 원본 추적 결과 전부 `presale_stage="분양계획"` + `presale_pp=0` + `recruit=2026-04~05` (모집공고 전 예정 단지 정상 데이터) 확인 → `stage === "분양계획"` 분기 1개 추가로 27건 흡수(**100% 커버리지**). 판정 순서: 임대→정비→후분양→오피스텔→**분양계획**→택지블록→공공→기본. 점수 로직(devSc=30, 가중치 1.00, PIR 구간) **일체 불변**, UX 문구만 정교화. `engine.test.js` 9개 테스트 추가(택지블록·오피스텔·공공·분양계획·우선순위·기본 유지, 각 `score: 30` 단언). **KPI**: 맞춤 안내 적용률 **8/38 → 38/38 (100%)**. **Review**: vite build 🟢 377ms / vitest 147 files **2,375 tests** 🟢(세션110 2,366→+9) / scoring-validator PASS(PROFILES 5×100·0.30+0.20+0.15+0.25+0.07+0.03=1.00 불변·PIR 구간 상수 불변·classifyNoPrice detail 문자열만 생성) / null-safety-checker PASS(`apt.presaleStage||""` 기본값·strict equality 안전·apartments_flat VIEW presaleStage 노출 확인) / Hook PASS(순수 함수) / 보안 PASS(입력 경로 없음).

**이전 작업**: 2026-04-17 세션110 — `collect-avg-income.mjs` KOSIS tblId DT_1C86 → INH_1C96_04 전환(2022 → 2024p 최신화). 시도 해상도 최신화. avg-income UPDATE 17/17, trade-stats 2001/2001, compute-scores 1424/1424. PIR 평균 18.34년. 커밋 `03ca58b`.

**이전 작업**: 2026-04-17 세션109 — `compute-scores.mjs` 재실행으로 세션108 PIR 구간 변경을 `apartments.cats_cache` 1,424건에 반영. dry-run·실제 UPDATE 전부 1,424/1,424 성공. 사후 집계(1,994건) 평균 price 서브스코어 52.2점, 분포 중심 30~49(49.8%), 상위권 70~89(26.2%). 프론트 검증(webapp-testing) 콘솔 에러 0, 카드 30+ 렌더. 코드 변경 0(DB UPDATE만). 커밋 `9bbab23`.

**이전 작업**: 2026-04-17 세션108 — `scorePrice.js` PIR 구간 재설계 (개인소득 PIR 분포 대응). 세션107에서 PIR 중앙값 0.76→19.25 정상화됐지만 기존 구간(`≤3/≤5/≤7`, 가구소득 가정)과 안 맞아 **828/1000건(83%)이 PIR 0~9점 쏠림**. 분위수 기반 새 구간(`≤10 우수/≤20 양호/≤30 보통/>30 부담`). **신규 상수**: `PIR_SCORE_TIERS = { EXCELLENT_MAX: 10, GOOD_MAX: 20, MODERATE_MAX: 30, BURDEN_PENALTY: 2 }` in `scoringTiers.js`. **scorePrice.js**: L90-99 구간 교체 + L72·L109 detail 문자열 `"우수 10↓, 양호 20↓, 보통 30↓, 부담 30↑"`. **테스트**: engine.test.js PIR 5개(우수/양호/보통/부담/하한클램프) — 기존 `PIR<=3→100` 1개 교체 + 4개 신규. **KPI 시뮬(1000건)**: 90~100점 113→**261**, 70~89점 4→**480**, 0~9점 **828→21**, 평균 PIR 서브스코어 **13.3 → 77.1** (정상 분화). **경계 연속성**: pir=10→100, pir=20→80, pir=30→60, pir=60→0 (수식 연결 검증). **Review**: vite build 🟢 531ms / vitest 147 files **2,365 tests** 🟢(세션107 2,361→+4) / scoring-validator PASS(PROFILES 5개·scorePrice 내부 0.15 가중치 불변·경계 수식 연속성·테스트 경계 기댓값 전수 검산).

**이전 작업**: 2026-04-17 세션107 — regions.avg_income 100% NULL 해소 + trade-stats.mjs NATIONAL_MEDIAN_INCOME 5000→195 정정. 커밋 `eb019ae`. PIR 중앙값 0.76→19.25 정상화.

**이전 작업**: 2026-04-17 세션106 — price=0 오염 버그 수정 + DB 클린업. 커밋 `fbf373b`. KPI pir NULL 50→38건, "가격>0 pir NULL" 7→0건, pir 커버리지 97.3%.

**이전 작업**: 2026-04-16 세션105 — "가격 있는데 pir NULL" 7건 원인 확정 (읽기 전용 조사, 코드/커밋 0). `naver-presale.mjs` price=0 저장 버그 확정. 세션106에서 수정 완료.

**이전 작업**: 2026-04-16 세션104 — `migration.mjs` KOSIS 호출에 `fetchWithRetry` 적용 + pir NULL 50건 구조적 분기 조사. **9 GATE 재검증 옵션 C 확정**: 원래 계획의 "regions 시계열 스냅샷 전환"은 `apartments_flat.latest_regions` CTE(DISTINCT ON recorded_at DESC)와 컬럼별 소유자 분리 구조(migration/population/housing-permits/collect-market-stats) 충돌로 GATE 1·6 🔴 → VIEW를 컬럼별 LATERAL 최신값으로 재작성하는 별도 에픽으로 분리. 세션104는 작업 2·3만 실행, GATE 🟢 9/🟡 0/🔴 0. **작업 2**: `scripts/collectors/migration.mjs:118` `fetchKosis()` export 승격 + raw `fetch`→`fetchWithRetry`(`_shared.mjs:130`, AbortSignal 30s 내장, 429/500/503 지수 백오프 3회). 에러 prefix `KOSIS HTTP …` 유지 위해 try/catch rethrow(collector-contract WARN 해소). 테스트 `fetchWithRetryMock` + fetchKosis describe 4개 추가(23→27). **작업 3**: `apartments_flat.pir` NULL 50건 Supabase SDK 조회 + 사유 키워드 분류 → price=0 기타 35, 미분류(가격 있음) 9, 정비사업 5, 임대형 1. "가격 있는데 pir NULL" 5~7건(원주역 우미 린·의정부 힐스테이트 탑석·하남 감일·광주 태전·경산 중산자이·포항 힐스초곡·광주 봉선)은 세션105에서 trade_stats 입력값(nearby_median·avg_income) 추적 예정. 세션105 플랜 초안: `.claude/plans/session105-pir-null-classification.md`. **KPI**: vitest 146 files/**2,339 tests** 🟢(세션103 2,335→+4), vite build 🟢. Review: collector-contract PASS / null-safety-checker PASS.

**이전 작업**: 2026-04-16 세션103 — `migration.mjs` 행안부 → KOSIS DT_1B26001_A01 전면 전환. **세션85 "행안부 MOIS_POP_KEY 502 서버장애" 진단은 오진** — 세션102 재조사에서 행안부 활용신청 4개 API 전부 net_migration 부적합 확인, transMovStats 테이블 자체가 행안부에 존재하지 않음. KOSIS "시군구별 이동자수"(orgId=101, tblId=DT_1B26001_A01, itmId=T25순이동, objL1=ALL) 단일 호출로 전국 272건(전국1+시도17+시군구254) 일괄 수집. **C1 prefix 매핑**: C1 2자리=시도(11서울…50제주), 5자리=앞2자리가 시도prefix → 동명이구 자동 해결(부산중구 26110 vs 서울중구 11140). `C1_TO_REGION` 맵은 기존 `REGION_LAWD_PREFIX` 역변환 + 강원 42/51·전북 45/52 양방향 방어. 공백 정규화 `normalizeC1Name("중  구")→"중구"`. ITM_NM "순이동" 직접 사용(계산 불필요). **신규 export**: `C1_TO_REGION`, `normalizeC1Name`, `mapC1`, `aggregateKosisRows`. 테스트 12→23 (+11), 전체 vitest **146 files / 2,335 tests 🟢**. **KPI**: regions.net_migration NULL **454 → 0 (100%→0%)**, 271건 UPDATE 성공/0 실패. Review: null-safety-checker PASS / collector-contract WARN → C 옵션 수정 적용(limit(1) 제거 + try/finally로 쿼터 기록 보장). 커밋 예정.

**이전 작업**: 2026-04-16 세션99 — `scorePrice.js` price=0 devSc=97 오인 버그 수정. 세션96 메모의 "서울 9건 pir NULL — price=0 구조적(재건축·후분양·청년임대)" 저우선 표시 개선으로 진입했다가 실버그 발견: L52 분기 조건 `fairPrice <= 0`만 체크 → price=0 + nearbyMedian>0 조합(전국 38건)이 정상 분기로 빠져 `dev = ((fairPrice-0)/fairPrice)*100 = 100%` → `DEV_SCORE_TIERS[0].score = 97` 만점 오인. 가격 카테고리 내부 가중치 0.30 → 종합점수 +6~7점 왜곡. 분기 조건을 `|| !apt.price || apt.price <= 0`으로 확장해 "데이터 부재" 경로로 흡수(devSc=PRICE_NO_DATA_DEFAULTS.dev=30 중립). classifyNoPrice 헬퍼(파일 private)로 subs[0].detail을 유형별 안내(정비사업/후분양/임대형/기본)로 분기. AptCard.jsx:100 "데이터 부재" 문자열 비교 호환 위해 info는 고정. 9 GATE 2회 검증(🟢9/🟡0/🔴0). Review: scoring-validator PASS / null-safety-checker PASS / vitest 137 passed / vite build 🟢. 커밋 `0adc222`.

**이전 작업**: 2026-04-15 세션98 — `transport-tago.mjs` 수집 실패/성공 신호 분리. `searchBusStopsTago` 4개 실패 경로(키 없음/HTTP 실패/JSON 실패/body 비정상)를 `null` sentinel로 통일, 정상 응답만 배열 반환. `buildTransportRow({apartmentId, subways, busStops, validICs, validKTX})` 순수 함수 추출 후 export → null이면 `bus_routes=null`+`bus_stop_names=null`, `[]`이면 `0+null`, `[N]`이면 `N+문자열`. `engine.js:68` `_noBus` 판정 소스를 `apt.busRoutes`→`apt.busStopNames`로 이동. 신규 테스트 6개 (22→28). 9 GATE 2회 검증(🟢9/🟡0/🔴0). 커밋 `f91b0db`.

**이전 작업**: 2026-04-15 세션97 — `apartments_flat.dataReliability` VIEW 공식 강화로 유령값 제거. Plan 모드 + 9 GATE 검증(🟢 8 / 🟡 1 / 🔴 0) 통과 후 2단계 실행. 단계 A: forward 마이그레이션 229줄 신규(실질 3줄 수정) + schema.sql 3줄 동기화. 단계 B: 롤백 마이그레이션 229줄(비상용) + Supabase SQL Editor 수동 적용. **판정 변경**: `p.price IS NOT NULL → > 0`, `i.hospital IS NOT NULL → > 0`, `t.bus_routes IS NOT NULL → t.bus_stop_names IS NOT NULL` (bus_routes DEFAULT 0이라 NULL 판정 불가 → 수집기가 busStopNames.length>0일 때만 join 저장하는 bus_stop_names가 "수집 성공" 신호로 정확). **실측 KPI**: avg dataReliability **88.38** (변경 전 93 대비 -4.62점, 예상 -4.7 일치), below_50=4, above_80=1,317/1,424(92.5%). **핵심 발견**: bus 박탈 대상 **239/772** — 나머지 533건(69%)은 수집 성공인데 실제 버스 0노선이어서 점수 유지. `> 0` 방식 대비 훨씬 정확한 결과로 판정 로직 선택이 옳았음. Review: vite build 🟢 / vitest 146 files 2,310 tests 🟢 / scoring-validator 🟢 / null-safety-checker 🟢.

**이전 작업**: 2026-04-15 세션96 — 서울 PIR NULL 57% 메모 검증: **이미 해소된 상태** 확인. 현재 서울 `apartments_flat.pir` NULL이 **9/266 = 3.4%**. 57% 는 세션85 이전 낡은 메모. 잔존 9건 전부 `price=0` 구조적.

**이전 작업**: 2026-04-15 세션94 — 화성시 50건 nearbyMedian NULL 해소. 사전조사에서 원인 체인 재특정: apartments.gu 에 "화성시 동탄구/만세구/효행구/병점구" 복합 문자열 64건 저장돼 있어 `collect-trades.mjs:163` regionGuPairs 생성 시 `getLawdCd("경기","화성시 동탄구")` 매칭 실패 → MOLIT API 호출 자체가 미수행 → trades 화성시 0건 → trade-stats `statsKey` 매칭 실패 → nearby_median NULL. 세션92-d 의 LAWD 41591 교정은 정확했으나 gu 복합 문자열 때문에 효과 없었음. 3단계 처리: (A) `scripts/fix_hwaseong_gu.mjs` 신규 — LIKE '화성시 %' OR gu IN (동탄/만세/효행/병점) 매칭, 64/64 UPDATE, JSON 백업 자동(롤백 지원), 멱등. (C1) `collect-trades.mjs` `--only=region:gu` 플래그 +15줄 + 테스트 3개 (32→35 passed). (C2) 화성시 타겟 재수집 18콜 → 매매 706+전세 1523+분양권 6=2,235건 upsert → trade-stats 재계산 2001/2001. **KPI**: nearbyMedian NULL **65→15 (-50, -76.9%)**, 커버리지 95.4→**99.3%** (+3.9pt). 화성시 64/64 해소. 잔존 15건 전부 섬·산간(인천 동구 5/옹진군 2, 경기 가평 3/양평 4/연천 1) — 구조적. 쿼터 19콜 소비. 9 GATE 전수 🟢, Review 단계 simplify/scoring-validator/null-safety-checker/collector-contract.

**이전 작업**: 2026-04-15 세션93 — 세종 33건 nearbyMedian NULL 해소. `statsKey(region,gu)` 헬퍼 도입, 세종 화이트리스트로 gu 무시. KPI 98→65. 커밋 `8ee1907`.

**잔여 10건 (세션114 실측, 전부 구조적 + avgSqm 폴백 경로로 점수 계산 중)**:
- 인천 동구 2 (두산위브 더센트럴, 리아츠 더 인천 4차) — 섬 인접 공백
- 인천 옹진군 2 (백령1/연평 국민임대) — 섬, area=NULL → 폴백 무효, pir만 작동
- 경기 가평군 3 (자라섬 수자인, 청평수자인더퍼스트, 썬밸리오드카운티) — 군 단위 거래 희소
- 경기 양평군 2 (우방아이유쉘 에코리버3차, 효성해링턴 플레이스) — 동일
- 경기 연천군 1 (수레울1단지 국민임대) — area=NULL

**다음 세션 우선순위** (세션116 재정렬):
1. ~~가평·양평·옹진 dev 왜곡 정직성 보정~~ **완료 (세션114 방안 A+B)**
2. ~~Vercel 12함수 감축~~ **불필요 — 실측 결과 21개 함수로 Ready 배포 (세션114 정정)**
3. ~~전문가 대시보드 sidoNotice/폴백차감15 끝단 UI 실측~~ **완료 (세션115 Playwright 5/5 DOM 노출 확인)**
4. **시군구별 소득 수집 — 공식 확정: C (현상 유지, 세션117)** — KOSIS 공식 FAQ로 시군구 해상도 소득 데이터 공식 없음 확정(세션115). 세션116 PoC 설계 문서(`.claude/plans/session117-sigungu-income-poc.md`, **로컬 전용 gitignored**)에서 A(TASIS 스크레이핑)/B(시도값 기반 추정)/C(현상유지) 비교 후 **세션117에서 C 공식 확정**. 근거: 트리거 증거 0 + 세션114 정직성 보정(`fairPriceFromSidoAvg` + `-15점` + 경고 접미) 실측 작동 + B1 ROI 불확실. 재오픈 조건: 사용자 왜곡 제보 / 전문가 대시보드 경고 UX 잡음 피드백 / 경쟁 서비스 도입 / 시도=시군구 지역 추가 왜곡 — PoC 문서 0절 참조. 발동 시 B 우선 → 실패 시 A.
5. ~~`scripts/fix_sejong_coord.mjs` 처분~~ **완료 (세션116 — DB 이미 반영 확인 후 untracked 파일 삭제)**
6. **`population.mjs` MOIS 인구 API 안정성 모니터링** — `migration.mjs`는 세션103에서 KOSIS DT_1B26001_A01로 완전 전환 완료(행안부 호출 0). `population.mjs`만 여전히 MOIS_POP_KEY 의존. 최근 `collect-population.yml` 2026-04-05 schedule 실행 `success` 2m40s — 현재 장애 없음. 상시 대기 불필요, 장애 발생 시에만 대응.

**DB 품질** (세션110 측정, nearbyMedian 커버리지는 세션114 재측정):
- trade_stats 2,001건: **nearbyMedian 잔여 NULL 10건** (세션114 실측, 99.5%+ 커버리지)
  - **pir 1,960건**, 중앙값 **16.85년**, 평균 **18.34년** (세션107 19.25 → 세션110 18.34, 2024 소득 반영으로 -0.91)
- apartments 1,994건: **cats_cache.price 평균 52.8점**, PIR 서브스코어 평균 83.5점(90~100점 44.3%)
  - **dataReliability 평균 88.38점** (세션97 공식 강화 후), 80점 이상 1,317건(92.5%)
- regions 454건:
  - **avg_income 시도 17/17 UPDATE** (세션110 INH_1C96_04 2024p, 205~269만원/월), 시군구 392건은 NULL 유지(trade-stats가 시도값 fallback)

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
