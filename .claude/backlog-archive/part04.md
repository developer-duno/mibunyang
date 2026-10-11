## 📜 NEXT_SESSION 산출 회고 (세션 274 이후 이동, 2026-05-20)

> NEXT_SESSION.md L60~85 에서 이동 (사용자 "아카이브로 분리" 요청 답습, 세션 277).
> SESSION_LOG.md 정식 박제까지 임시 보존. SESSION_LOG 세션 265~276 12 세션 미반영
> 상태이며, 박제 완료되면 본 절은 제거 가능.

### 세션 274 산출 (커밋 2ed66f7·c6863dc)

#### mibunyang 소유 3개 테이블 RLS 활성화

세션 273 이 "RLS Disabled 19개" 박제. 세션 274 가 `supabase db advisors --type security`
live 조회로 정정 — 실제 `rls_disabled_in_public` 16개. 그중 mibunyang 소유 3개만 해결:

- 신규 마이그 `supabase/migrations/20260519111101_enable_rls_mibunyang_owned.sql`
  + 롤백 `supabase/migrations/_rollbacks/20260519111101_rollback_enable_rls_mibunyang_owned.sql`
  (세션 277 직접 ls 실측 — Agent D 의 "디렉토리 부재" 보고는 환각, 정확 위치 = `supabase/migrations/_rollbacks/`)
- `api_quota_log`: RLS on + Public read + Service write
- `air_quality_stations`: RLS on + Service write only
- `collector_runs`: 기존 RLS on·정책0(20260517020124 부분 적용) → 정책 2개 보강
- `supabase/CLAUDE.md` "마이그레이션 적용" 절 — supabase CLI 단발 적용 방법 추가

검증: live 적용(`supabase db query --file`) + `BEGIN..ROLLBACK` 시뮬레이션 + anon JWT
회귀(api_quota_log 100행·collector_runs 31행 읽힘 = Public read 작동, air_quality_stations
0행 = 차단 의도대로) + collector dry-run + vitest 9/9. advisor 16→14.

#### 검증 중 발견 (cross-repo 실측 정정)

- 공유 3개(complexes/articles/complex_price_history)는 **naver-estate-web 소유**
  (`f:\cursor\naver-estate-web` 의 `V007`/`V001` 마이그). mibunyang 이 정책 만들면
  충돌 — 특히 `articles` 는 naver 가 `is_active=true` 숨김 의도. → 범위 5→3 축소.
- `.claude/BACKLOG.md` RLS 절·apartments.json 수치·어린이집 절 정정 (로컬, 커밋 안 함).

plan: `C:\Users\user\.claude\plans\claude-velvety-map.md`

---

## 세션 285 (2026-05-21) — regions 표기 충돌 root fix (커밋 `78a862d`)

세션 284 진단 다음 세션 작업 자리 완결. CI success (Population/Monitor/CI 3 워크플로 success).

**세 사고 통합 정정**:

1. parseGu() 자치구 정보 손실 — `[ctpvNm, sggNm].join(" ").split(/\s+/)[1]` (시도+시 단위로 잘림) → `parseGu(ctpvNm, sggNm)` 시그니처 (sggNm 그대로 박힘, population-sex-age.mjs v2 답습). 시도 단위 집계 `hasGuLevel` 플래그로 중복 차단.
2. SIDO_CODES 환각 3건 (2026-03-21 `09e25fef` ~ 2026-05-21 `78a862d`, 61일 누락):
   - 세종 `3600000000` → `3611000000`
   - 강원 `4200000000` → `5100000000`
   - 전북 `4500000000` → `5200000000`
3. 1행 응답 객체 처리 — `items.item` 객체/배열 양형 대응 (Array.isArray 가드 + 단일 객체일 때 `[items]` 변환).

**실측 효과**:

- regions 752 → 790 (+38 행)
- 자치구 (region, gu 공백) 행 pop_growth 채워진: 0 → 35 / 41
- 신규 시도 단위: 세종 391072 / 강원 1506843 / 전북 622915 (이전 NULL)

**잔여 사고** (다음 후속 박제 자리):

- 중복 행 (같은 region+gu 페어에 NULL 행 + 값 행 공존) — upsert 키 불일치 또는 잔재 행
- 화성시 4 자치구 행 (sex_age/crime_grade 보존용) 잔존
- 자매 SIDO_CODES drift 2건 (population-sex-age.mjs L26-31 + naver-presale.mjs L47 세종) — **세션 286 동시 fix** (별도 커밋 2건)

plan: 세션 284 진단 다음 세션 작업 자리

---

## 세션 ~271 이하 완료 색인 (세션 439 감사 — BACKLOG 비대 정리로 이동)

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

