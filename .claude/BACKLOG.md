# 개선 백로그

> 최초 출처: 2026-04-19 `/improve` 분석 → `~/.claude/plans/pwd-f-mibunyang-improve-report.md`
> 운영 규칙: 🔴 미션은 `/blueprint` 로 바로 실행. 🟡/🟢 는 `/improve` 에서 3회 이상 반복 지적되면 🔴 승격.
> CLAUDE.md 본문에 백로그 진행 상태 두지 말 것 — 전부 이 파일
> **완료 항목은 [BACKLOG_ARCHIVE.md](BACKLOG_ARCHIVE.md) 로 이동.** 이 파일은 "할 일"만 유지.

---

## ✅ 완료된 일 (색인 — 상세는 [BACKLOG_ARCHIVE.md](BACKLOG_ARCHIVE.md))

> **중복 플랜 방지**: plan 작성 전 이 색인을 grep. 여기 있으면 = 이미 완료, plan 금지.
> fix 를 박은 세션이 그 자리에서 항목을 ARCHIVE 로 이동 + 이 색인에 한 줄 추가 (drift 0).

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

---

## 🔴 즉시

(세션 309 trade-stats DSR batch fix 완결 — P0 자리 0건 박힘)

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

- 🟡 **제주 어린이집 미수집 — 별도 API collector 신설 필요** (세션 275 발견, 세션 276 진단 정정)
  - 증상: 제주시(50110)·서귀포시(50130) 2개 시군구가 cpmsapi021 에서
    `<errcode>INFO-200</errcode>`(검색결과 없음) 응답 → `regions.childcare` 제주 미수집.
  - ⚠️ **세션 275 박제값 2건 환각** (세션 276 정정):
    - "제주 13개 시군구 / 243/256" → 실제 `_shared.mjs` GU_LAWD_MAP 제주 = **2개뿐**
      (제주시·서귀포시). 정확히는 **254/256 수집**(제주 2개만 미수집).
    - "원인 = arcode 매핑 불일치" → `listAllSgg()`·GU_LAWD_MAP 제주 arcode **정상**.
      보정할 arcode 오류 없음.
  - 진짜 원인 (세션 276 운영키 raw 진단): cpmsapi021(전국 어린이집 정보, 공공데이터
    15101155)은 제주 데이터를 **API 자체가 미보유**. 제주 arcode 11종(50110/50130/
    50000/39010 등) 전부 INFO-200, 강남(163)·종로(60) 정상. schools-neis·infra-kakao
    (좌표기반)·migration·fertility(KOSIS) 등 다른 collector 는 제주 정상 → 어린이집만의
    문제이고 cpmsapi021 책임 확정.
  - 해결책: 별도 API `한국사회보장정보원_제주도 어린이집 정보조회`(공공데이터포털
    15101201) collector 신설. 코드 재활용·간단 해결책 없음 (Kakao Places 는 거리계산용,
    어린이집 목록 7필드 미제공).
  - 규모: 신규 collector 1개 + 워크플로 + data-fill 등재. facilities[] 7필드 스키마를
    cpmsapi021 과 맞춰야 cpmsapi030·collect-nearby-childcare 호환. brainstorming 선행 권장.
  - 다음 진입 시: 15101201 API 명세(엔드포인트·파라미터·필드) data.go.kr 페이지 또는
    사용자 콘솔 직접 확인 의무.

- 🔴 **차단: `eslint 10` 본 적용** — `eslint-plugin-react@7.37.5` (최신) peer 가 `eslint: ^9.7` 까지만 지원
  - 재오픈 트리거: `npm view eslint-plugin-react@latest peerDependencies` 결과 `^10.0.0` 등장 (세션125 조사)

---

## 🟡 곧

- 🟡 **regions.avg_price 100% NULL + cross-repo 활성 사용 8 위치** (세션 223 발견, 세션 226 정정, 세션 277 재실측, **세션 316 재실측 + drift 정정**)
  - 증상: mibunyang regions 664 행 모두 avg_price NULL
  - 가설 정정 (세션 226): "컬럼 폐기" → **수집기 부재 + cross-repo 활성 사용**
  - 컬럼 추가 시점: `20260313024159_init_mibunyang.sql:212` (초기 스키마, 마이그 메시지/주석 부재 = 의도 미정의)
  - mibunyang 사용처: 0건 (types/database.types.ts auto-typegen 3건만 + scoring 0건; `scorePrice.ts` 는 `avg_price_sqm` 만 폴백)
  - 🚨 naver-estate-web 사용처: 8 위치 (frontend 5 + backend 3) — 세션 316 직접 grep 재실측 + word boundary `\b`
    - frontend: `src/types/mibunyang.ts:87` (TS 타입), `src/components/mb/MbRegionStatsTable.tsx:59,60` (모바일 카드 `!= null` 표시/NULL 줄 숨김), `:142` (테이블 NULL → `-` 대시), `src/lib/mb-export.ts:51` (엑셀)
    - backend FastAPI: `db/mb_models.py:134` (SQLAlchemy ORM `Mapped[int | None]`), `db/price_queries.py:34,68` (SELECT alias; 세션 277 `:63` → 316 `:68` drift, 1.5개월 stale), `routers/mb_serializers.py:88` (응답 직렬화 `r.avg_price` 그대로)
  - 별 도메인 (무관): `backend/crawler/stats.py:16,43,91` `avg_price` = articles 단지 레벨 평균가 (`regions.avg_price` 와 무관 확정)
  - UI 사용자 영향: NULL 이미 노출 중 (모바일 줄 숨김 / 테이블 `-` 대시) → 사용자 사고 0 박힘
  - 옵션 1-A (보류, 권장, **세션 316 채택**): cross-repo 영향 정리 전 drop 금지 — 5~10분 메모 박제만. 답습 자산: 세션 226 plan v4 (옵션 1 보류 + 9 GATE 2 라운드 + 환각 정정 19건)
  - 옵션 1-B (cross-repo drop): naver-estate-web frontend 5 + backend 3 제거 PR + mibunyang DROP COLUMN — 180분+ 양 프로젝트 동기 배포
  - 옵션 1-C (강행): backend startup ORM 매핑 실패 위험만 진실 (UI 자리 NULL 이미 안전 폴백 박혀 있음)
  - 옵션 1-D (미래 후보): `avg_price = avg_price_sqm × 평균면적` 자매 계산. 전제 = 시도·시군구별 분양 평균면적 데이터 (KOSIS 분양면적 통계 별 수집기 또는 `apartments.prices.area` 집계). 1-A 보류 유지 + 미래 진입 후보
  - 참조: docs/superpowers/specs/2026-05-11-naver-postprocess-bottleneck-design.md §H 비-작업

- 🟡 **무순위 이벤트 로그 차수 노출** (세션 160 1차 적재 완료, 누적 1~2개월 후)
  - DetailModal 무순위 차수·이력 섹션 / AptCard 차수 배지 (count >= 2일 때만) / 시계열 차트 (MarketStatsCharts 패턴 재사용)
  - 트리거: 같은 apartment_id 2회+ 행 발생
  - **측정 스크립트**: `node scripts/monitors/applyhome-event-recurrence.mjs` (세션 168 박제)
  - 1차 적재 결과: 1263 events / 721 단지 보유 (단지당 평균 1.75 공고 — 시계열은 누적 후)
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

- 🟢 **fill-missing-data.yml 개명** (`backfill-new-apartments.yml`) + `monitor-collectors.yml` `workflow_run.workflows` 동기화 — spec Phase 3, 6/14 발화 2회 success 후 별도 PR (세션 307 spec out-of-scope)

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

- 🟡 **`vitest.config.ts` 의 `environmentMatchGlobs` deprecated** (세션 172 발견)
- vitest 4 의 InlineConfig 타입에 해당 옵션 없음. 런타임 동작은 유지(테스트 167→168 통과)되어 `// @ts-expect-error` 1줄로 임시 보존
- 후속 정공법: vitest 4 의 `projects` 또는 `workspace` 패턴으로 마이그레이션 (api/scripts 환경 분리)
- 트리거: M1 (scoring/ 변환) 진입 직전 또는 vitest 5 도입 검토 시
- 참조: spec/plan `2026-05-03-ts-bootstrap-*` Task 6
