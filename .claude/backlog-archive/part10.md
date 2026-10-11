# 백로그 아카이브 part10.md — 세션628 이관(2026-10-11)

> BACKLOG.md(394KB)의 오래된 ✅ 최상위 항목을 절 제목과 함께 그대로 옮겼다(문구 무변경, CRLF 보존).
> 원래 자리에는 절마다 "옮김" 한 줄을 남겼다. 🔴/🟡/후속이 섞인 ✅ 항목과 A-16~A-19 절은 옮기지 않았다.

### A. 날짜가 정해진 확인 (놓치면 조용히 틀린 값이 나간다)
- ✅ **10/07(수) 아침 — 어린이집 상세 원인 ① 원 응답 확인(세션603)** — 먼저 `childcare-local.log` 그날 회차에 detail 실행이 없었는지(=#701 반영) 본다. 그다음 cpmsapi030 를 지역 5곳(파주·남양주·세종·광주 서구·구례) × (시설번호 앞자리 코드 / `GU_LAWD_MAP` 코드) + 구례·광주는 개편 전후 둘 다 + 정상 지역 양성 대조군 1 = 약 11~13회, 응답을 자료 있음 / 0건 / 오류코드로 가른다. 인자 순서(arcode 먼저·key 나중)와 빈 `stcode` 는 ERROR-100 을 낸다(2u `childcare_api.py:6-7,86,156`). 2u 시 단위 코드 + 모시 폴백 표(`childcare_api.py:268-290`) 참고. **(세션619 10-09 확인: #706 으로 복귀 끝(세션609 #708 기록))**
- ✅ **10/20(화) 전 — 어린이집 상세 고친 PR 합치고 러너 3종 복귀 → #706(bf8b0eff, 10/07) 합침 · 러너 매일 3종 복귀 · 첫 회차 10/08 04:30(확인 = `childcare-local.log` detail 호출 ≈245 · 0건 응답 ≤10% · `collector_runs` childcare-detail success · 10/09 둘째 회차 "바뀜 없음" ≈245)** — 10/20 09:00 감시 ⑤-b 경보는 이제 "안 떠야 함"(뜨면 러너 고장 신호). `childcare-local-runner.test.mjs` "detail 미포함" 단언은 #706 에서 뒤집음.
- ✅ **(세션572 실측 — run 36079301953, 09:49~09:52 KST, c6e8fede: ⑫ applyhome 8곳·hold 13곳 → 이상 0 · ⑬ 최근 50시간 failure 1행 → 이상 0 · ⑪ 3/3 이상 0 · "이상 없음 (mode=daily)" · check-failed 0 · 공개 JSON(fetchedAt 09-24T18:10Z) 대표 2행 unsold null)** 9/25(금) 09:00~09:55 첫 자연 daily(⑫ hold 13 · ⑬ 첫 자연) — 기대: 공개 로그 "⑫ … applyhome 8곳 · hold 13곳 → 이상 0건" · "⑬ … 이상 0건" · 텔레그램 "오늘 이상 0건". (d) "해제/추가" 가 뜨면 누가 hold 를 바꿨는지 `collector_runs` 로.
- ✅ **(세션569 결과 — 어린이집 3종 success · 네이버는 12:26 재부팅으로 3/6 에서 끊김 → 12:53 수동 재개 14:43 완주, naver-presale 실패 4 = 단지 상세 응답 없음 · naver-collect partial)** **9/24(목) 04:30 어린이집 로컬 러너 · 08:00 네이버 러너** — 로컬 러너는 `F:\mibunyang` **작업 트리를 그대로 실행**한다(`kosis-local-runner.bat` `cd /d "%~dp0.."`). 세션566·567 모두 마무리에 작업 트리를 main·깨끗한 상태로 두었다 — 다음 세션도 **끝날 때 작업 트리를 main·깨끗한 상태로** 둔다(admin-district-code-reform §6). 확인: `collector_runs` 의 childcare·네이버 계열 최근 행 status=success(세션567 이 합친 `_shared.mjs` `MERGED_SIDO_RE` 변경의 첫 실행).
- ✅ **(세션582 실측 — run 11:06 schedule success · collector_runs school-walk 02:08Z success ok=8 · 빈칸 16 → 8 = 아래 기대 명단 8 그대로, 기대 밖 0 · 같은 날 감시 ⑫ "applyhome 7곳 · hold 14곳 → 이상 0건"(run 36284086128))** 9/27(일) 11:00 `backfill-new-apartments` 정기 실행 — `calc-school-walk` 가 세션567 분교장 판정 + coord_shared 비움으로 도는 첫 정기 회차. 확인: `collector_runs` school-walk success · `apartments.naver_school_walk_min` **빈칸 = coord_shared 8행뿐**(9/25 실측은 **16** — 9/24 신규 ap- 8곳(ap-6025784·6027109·6027182·6027498·6027693·6028285·6028553·6028696)이 아직 미계산이라 이 회차가 채우면 8 이 정상)(명단: ah-2024910225·ah-2025910011·ah-2025910034·ah-2025910268·ah-2025910269·ah-2025930013·ap-6025734·ap-6028554 — 이 밖의 빈칸이 생기면 조사) · 오션포레(ah-2026910156) 29분 유지.
- ✅ **9/28(월) 08:00 네이버 러너 = 완주 기록 첫 실전(#611)** — 12:00 뒤 `collector_runs` 에 `naver-pipeline` success 1행(ok 6·skip 0, 경고 단계가 있으면 skip N + `WARN_STEPS:` 마커)이 있어야 한다. 없으면 bat·`record-pipeline-run.mjs` 확인(#613 부터는 ⑤ since 가 9/29 아침에 "등재 뒤 행 0" 경보 — A-9). 재시작 금지 08:00~14:00. **(세션619 10-09 확인: 9/28 12:04 naver-pipeline success ok 6 · 이후 10/01·10/05·10/08 행도 있음)**
- ✅ **9/28(월) 11:30 `collect-applyhome-seed` 주간 실행** — 세션568 부터 새 단지에 `unsold_source: "applyhome"` 을 쓴다. 마이그(20260924000200)는 9/24 11:40 운영 적용 완료 → PR #597 이 그 전에 합쳐져 있어야 코드와 DB 가 맞는다(안 합쳐져 있으면 옛 코드가 돌아 출처만 비는 것 — 실패는 아님). **세션569 C6**: #606 합침(25b1d09f) — 새 단지 행에 공고일(`unsold_as_of`)이 채워지는지 확인. 감시 ⑫ 기대 = "applyhome 7곳 · hold 14곳 → 이상 0건"(세션576 C6 만료로 봉담 8→7 · 세션577 음성아이파크 hold 13→14, seed 뒤 7+N — 세션577 검사관 C 정정). **(세션619 10-09 확인: 9/28 11:55 applyhome-seed success ok 1 · applyhome 8곳 전부 unsold_as_of 있음)**
  C6 마이그·backfill 은 9/24 에 이미 운영 적용 완료(as_of 8/8). 42703(칸 없음) 오류가 나면 최우선.
- ✅ **(세션568 #596 — 진짜 원인은 API 중단이 아니라 조회 월 "2개월 전" 고정: 국토부 건물 에너지 자료는 약 5개월 늦게 공개(202604 있음·202607 0건). 표본 3곳으로 자료 있는 최신 달 자동 탐지 (202605 탐지, 대상 3,040). 11:40 실행은 collector_runs 기록이 없고, 세션569 가 12:44~13:37 재실행 완주(성공 442·스킵 2,598·API 4,469, collector_runs success))** building-hub 7/15 분기 회차 누락(세션567 감시 수동 실행에서 드러남 — "100일 미발화" 경보) — 8/15 에 Actions → 로컬 러너 이전(d46a6ac3, 국토부 해외 IP 차단)했는데, 이전 **전** 7/15 회차가 기록 없이 빠졌다(collector_runs 마지막 = 6/15·5/18, 둘 다 ok 0 skip 2000). 다음 정상 회차 = 로컬 러너 **10/15**. 자료(건물 에너지)는 세션550 기록상 화면 비노출·점수 미사용 → 손님 영향 없음. 선택지: 수동 보충(`node scripts/collectors/collect-building-hub.mjs --dry-run` 먼저) 또는 10/15 까지 대기(그때까지 매일 브리핑에 "장기 미발화" 표시).
- ✅ **9/29(화) 대기질 회차 확인 뒤 PR #569(infra 대기질 6칸, draft) 머지** — 그날 `mergeKeepingAnnual`·자동 재부착의 첫 실전을 먼저 본다. 머지 → 10/06 회차에 infra 6칸 3,068곳 채움 확인 → 자매 `env_air.py` 폐지 PR(자매 레포). **(세션603 #569 닫음 · 세션604 자매 env_air.py 폐지 ✅ 2u #675)** **(세션619 10-09 확인: #569 닫음·2u env_air.py 폐지로 끝)**
- ✅ **10/02(금) 05:30 주택보급률 · 10/06(화) 05:30 market-stats 로컬 러너** — #602 마커의 첫 실전은 10/02(주택보급률 매월 2일 — `REGION_UNRESOLVED_COLLECTORS` 에 포함), 이후 10/06 market-stats. 기대: `collector_runs` 각 수집기 최신 행 `error_message` = null(KOSIS 가 광주·전남을 아직 따로 준다) → 감시 ⑪ 침묵. 마커 `REGION_UNRESOLVED` 가 있으면 KOSIS 가 "전남광주" 로 바꾼 것 — 원천이 분리해 주기 전까지 두 지역 새 값이 안 들어온다. 집계 라벨 "5대광역시 및 세종특별자치시" 띄어쓰기도 로그로 확인. **✅ 10/02 몫(세션588 조회 08:19)**: `kosis-housing-supply-ratio` success · ok 23 · skip 147 · `error_message` 빈칸(마커 없음 = 기대대로, 감시 ⑪ 침묵) — 남은 것은 10/06 market-stats. **(세션619 10-09 확인: 10/06 05:31 market-stats success ok 935 · error_message 빈칸(마커 없음))**
- ✅ **10/09(금) 미분양 로컬 러너(day 9)** — C6 첫 실전(#606 합침(25b1d09f), 본 폴더 pull 완료). 기대: 만료 = 운정 1곳(봉담은 09-26 03:24 미리 실행에서 이미 KOSIS — 세션577 정정) · 0 되는 곳 2곳(운정·ah-2022910097) — **수동 `--expect-zero` 때만** 반영(A-7). ✅ 비운 11곳은 세션570 에 출처 hold 로 보류(#610·backfill 완료) — 기대 로그 `[hold] 14건`(세션571 대표 2행 + 세션577 음성아이파크) · `[빈칸→0] 1건: ap-6028696` · `hold 보호로 건너뜀 0` · `unsold_history hold 제외: 14건` · skip_lease 683(이름 규칙 #633 뒤 재시뮬 `session577/unsold_impact_after_lease.json` — 새 달 자료라 숫자는 바뀐다; **10/09 전에 새 달 dry-run 전이표 → 사장님 진행/보류**, 러너를 멈추려면 예약 작업 Disable). ⚠️ 10/08~09 연휴에 PC 가 꺼져 있으면 이 회차가 통째로 빠진다(`MAX_CATCHUP_PER_RUN = 1`, `kosis-local-runner.mjs:71`). **(세션619 10-09 확인: 10/09 05:31 kosis-unsold success ok 3,919 · hold 14 유지 · ap-6028696 빈칸→0 · unsold>units 0 · applyhome 8곳 전부 6개월 안)**
- ~~**오늘** — 세종 VIEW SQL 적용~~ ✅ **완료(세션551, 2026-09-20 21:4x KST, 사장님 Dashboard)**. 회귀 0 확인(총 2,443행 · 비세종 fertilityRate 2,408 / housingPrice 2,393 / doctorsPer1k 2,408 / hospitalBedsPer1k 2,406 전부 불변) + 세종 35곳 fertility·housing 0→35. `data-audit` 세종 수치를 다시 기준선으로 써도 된다.
- ~~**09-21(월) 05:30** — `lhzone-status` 첫 자동 발화~~ ✅ **완료(세션555 실측)**: 2026-09-20T20:30Z(=09-21 05:30 KST) `success` · `ok=1144 fail=0` — 08-21 회차와 동일한 수치다.
- ~~**09-21(월) 08:00 이후** — 네이버 파이프라인 완주 확인 / `--max-minutes` 도입~~ ✅ **해소(세션555 실측)**: `--max-minutes` 는 **이미 도입돼 있다**(`naver-collect.py:372` 기본 90, `run-naver-local.bat:37` 이 `--max-minutes=120` 으로 호출). 그래서 `naver-collect` 가 매 회차 정확히 120분에 `partial` 로 끊기는 것은 **고장이 아니라 설계**다 — bat 주석 그대로 *"1단계를 제한해 2~6단계가 항상 돌도록"*, 남은 단지는 다음 실행이 resume 한다(`naver-collect.py:496`). 최근 5회 전부 `partial`/120분/`fail=0`(ok 7,603~13,531, skip 409~469).
  ⚠️ 다음 세션이 `partial` 을 사고로 오판하지 말 것. 진짜 이상 신호는 **`fail_count > 0`** 이거나 **`ok_count` 가 연속으로 급락**하는 경우다.
- ~~**09-22(화) 01:30 이후** — 인천 새 4구 `regions.jeonse_rate` 채움~~ ✅ **완료(세션556 실측, 2026-09-22 02:45 KST)**:
  4구 전부 2026-07 행에 값이 있고 **서로 다르다** = 승계가 아니라 자체 값이다.
  제물포 **79.6**(모구 동구는 null) · 영종 **67.2**(중구 71.8) · 서해 **63.9**(서구 42.1) · 검단 **65.3**(서구 42.1).
  ⚠️ **`jeonse_rate` 는 애초에 "모구 승계 4종" 에 없었다**(승계 대상 = `fertility_rate`·`doctors_per_1k`·
  `hospital_beds_per_1k`·`housing_price`). 그 4종은 **여전히 승계 상태**다 — 세션556 실측에서
  서해구·검단구가 넷 다 같은 값(0.936 / 2.2 / 10 / 294 = 옛 서구)으로 확인됐다. 그쪽은 아래 🟠 항목 소관.
  ⚠️ **정정(세션556 재실측, 2026-09-22): 승계는 두 구가 아니라 새 4구 전부다.**
  영종구 = 옛 중구 값(0.92 / 3.8 / 13.3) · 제물포구 = 옛 동구 값(0.84 / 3.1 / 11) ·
  서해구·검단구 = 옛 서구 값(0.936 / 2.2 / 10). `housing_price` 는 새 4구에만 값이 있고(242/221/294/294)
  **모구 3곳은 2026-06 행에서 null** — 즉 새 구 행이 모구보다 최신이다.
  다음 세션 확인법: 위 7개 구를 `recorded_at desc` 로 한 번에 뽑아 **모구와 값이 같은지** 본다.
  같으면 아직 승계, 달라지면 원천이 새 구를 주기 시작한 것이다.
- ✅ **완료(세션556, #534) — `.env.local` 의존 env 키 2종: 실측하니 문제가 아니었다.**
  모듈 상수를 `"DUMMY_KEY"` 와 `""` 로 직접 바꿔 각각 돌렸고 **양쪽 다 10건 통과**했다.
  `useShare.test.js` 의 `beforeEach` 가 `isInitialized` 를 항상 `true` 로 모킹해, 키를 읽는 **두 자리**
  (`useShare.ts:25` 공유 시점 재시도 · `:94` 마운트 useEffect)가 모두 `!true` 로 막혀 **도달하지 않는다.**
  사장님 결정: 문제 없는 곳에 방어를 넣지 않고 **이유를 테스트 파일 주석으로** 남겼다.
  ⚠️ 이 안전은 **`isInitialized: true` 모킹에 의존**한다 — 그 모킹을 바꾸거나 `init` 분기를 지나는
  테스트를 새로 넣으면 그때부터 키에 흔들린다(그 경우 `vi.mock` 또는 주입으로 격리).
- ✅ **완료(세션556, #534) — `useKakaoCallbackEffect.test.js` 항진명제: 주석만 정정.**
  지적이 정확했다 — `useKakaoCallbackEffect.ts:66` 이 `pendingTab === "map"` 을 먼저 보고 return 하므로
  `isFeatureHome()` 은 else 안에서만 읽히고, stubEnv 를 무엇으로 바꿔도 결과가 같다.
  다만 그 테스트가 지키는 것은 **분기 순서**(map 우선)이고 그건 유효한 회귀 가드라 **테스트는 건드리지 않았다.**
  주석에 "이것이 지키는 것은 분기 순서이지 깃발 ON 경로가 아니다" 를 명시하고, 깃발 ON 경로는
  같은 파일의 **"VITE_FEATURE_HOME=true 면 user 로그인 착지가 home 이다"**(pendingTab 없음)가
  검증한다는 사실을 실측 확인해 적었다.
- ✅ **고아 워크트리 9개(693MB) 정리** — 세션555. `git worktree list` 는 1개인데 `.claude/worktrees/` 에 세션549~552 잔재 9개가 `.git` 없는 껍데기로 남아 있었다. 삭제 전 전수 대조로 **"고아에만 있는 src 파일 0개"**(5개 폴더 전부)·차이 방향이 전부 "main 이 더 최신"임을 확인. `.claude/` 693MB+ → **14MB**(`du -sh` 블록 기준 — 실내용은 `du -sb` 약 2.0MB). ⚠️ 워크트리를 쓰면 **등록 해제만으로는 폴더가 안 지워진다** — 다음에도 `ls .claude/worktrees/` 와 `git worktree list` 개수를 대조할 것.
- ✅ **10-06 저녁** — 로컬 러너 상태 파일 `.kosis-local-runner-state.json` 의 `lastProcessed` 가 `2026-10-06` 인가. ⚠️ `MAX_CATCHUP_PER_RUN = 1` 이라 **PC 가 2일 이상 꺼져 있으면 10-06(market-stats·molit-units·collect-trades)이 통째로 건너뛰어진다**(시뮬 실측: 10-04→10-07 이면 처리 목록이 10-05·10-07 로 10-06 이 빠진다). 모니터는 `stale_days 38` 이라 한 달 넘게 지나야 운다. (grep `MAX_CATCHUP`) **(세션619 10-09 확인: 상태 파일 lastProcessed 2026-10-09 · 10-06 몫(market-stats·molit-units·trades 44만) 전부 돎)**
- ✅ **10-07** — `migration.mjs` 첫 자연 실행(exit 0 · `중복 키 — 경남|창원시` ERROR 1줄은 정상). (grep `창원시`) **(세션619 10-09 확인: 10/07 05:31 migration success ok 272)**

### A-2. 세션559 후속 — 반드시 이어야 하는 것 (중간 상태로 남았다)
- ✅ **대기질 2단계 — 점수·문구를 3년 평균으로** (세션560 완료, PR [#551](https://github.com/developer-duno/mibunyang/pull/551)·[#552](https://github.com/developer-duno/mibunyang/pull/552) 머지 + 운영 반영)
  · **표를 읽는 코드가 0건이었다** — 전달 통로 `air-annual-attach.mjs` 를 새로 만들어야 했다(경계만 옮기는 일이 아니었음)
  · 경계 = **3칸 `15 / 19` → 20/14/8**(사장님 확정). 옛 경계는 **단지 91.6%가 한 칸에 뭉쳐** 변별력 0 이었다.
    실측 분포 min 10.25 / p25 17.17 / 중앙 18.63 / p75 19.71 / max 26.03 → 새 경계로 20점 250(8.4%) / 14점 1,611(53.8%) / 8점 1,131(37.8%)
  · 폴백 = **14점(가운데 칸)**. 3년 평균 없는 76곳(측정소 13종)은 **우리 자료 사정**이지 단지 잘못이 아니다
  · ⚠️ **계획에 없던 결함 차단**: 매일 도는 `collect-air-quality.mjs` 가 `air_quality` 를 **통째로 교체**해
    `annual` 이 다음 날 새벽 전부 날아갈 상태였다 → `mergeKeepingAnnual` 로 보존(그 로직 지우면 조용히 전 단지 폴백)
  · 반영 결과: 화면 문구가 **좋음 206 / 보통 1,177 / 나쁨 909** 세 갈래(이전엔 보통·좋음 두 갈래)
  · 가드 신설 15건 + 뮤테이션 5종 red(기각한 경쟁 후보 5칸안 포함 — 앵커 범위 **안**이라 파생 가드였다면 통과했을 자리)
- ✅ **다음 KOSIS 회차(매월 9일) 확인** — 정리로 비운 1,090곳+81곳이 공식값으로 채워지는가 **(세션619 10-09 확인: 10/09 회차 뒤 unsold 채움 2,505/3,281 · unsold>units 0 (비운 곳 전후 개수 대조는 안 함))**
  · 확인: `apartments` 에서 `unsold IS NOT NULL` 개수가 늘었는지 + `unsold > units` 가 0인지
  · 안 채워지면 `shouldSkipKosisFill` 또는 비례배분 로직을 다시 본다

### B. 데이터·수집기 (①) — 위에서부터
- ✅ **완료(세션555, #529) — 단위 테스트가 기능깃발을 stub 하지 않고 OFF 를 가정하던 문제**
  `src/__tests__/setup.js` 의 `beforeEach` 가 `VITE_FEATURE_HOME`·`VITE_FEATURE_UPCOMING` 을 빈 값으로
  고정해 어느 PC 에서도 같은 결과가 나온다(세션556 부팅 점검 재확인: `beforeEach` 3건 · 깃발 stub 1건).
  ⚠️ **`beforeEach` 로 매번 다시 걸어야 한다** — 파일 최상위에서 한 번만 걸면 ON 테스트의 뒷정리
  (`vi.unstubAllEnvs()`)가 기본값까지 걷어낸다(세션555 실측: 그 상태로 3건 잔존).
  ── 이하 당시 원문 ──
  `src/__tests__/setup.js` 에 깃발 고정이 **없어** 각 PC `.env.local` 에 좌우된다.
  실측: CI `ci.yml` Test 는 깃발 없이 돌아 green / 내 로컬은 `VITE_FEATURE_HOME=true` 라 **12건 실패**.
  실패 테스트가 주석으로 가정을 적어 둔 자리 = `useAppNavigation.test.js:60` · `useKakaoCallbackEffect.test.js:88`
  ("featureFlag OFF 테스트 환경 = list"). e2e 도 같은 결 — CI 는 `VITE_FEATURE_UPCOMING`·`HOME` 둘 다 주입해 23 passed,
  로컬은 UPCOMING 이 없어 `upcoming.spec` 4건 실패.
  → `setup.js` 에서 두 깃발을 기본 OFF 로 고정(한 곳)하면 어느 PC 에서도 같은 결과. **다음 세션 P2**.

### D. 화면 재설계 (③) — **PR-1~6 완료, D2 의 PC 원칙 3/3**(세션554 PR [#525](https://github.com/developer-duno/mibunyang/pull/525) main `b1a0bef0` + 세션555 "점수 3열" 뜻 확정)
- ✅ **PR-5 홈 시장 현황판** — 세션552, PR [#519](https://github.com/developer-duno/mibunyang/pull/519), main `6846d7b2`, 라이브 검증 완료.
  중위값 폐지(사장님 "왜 중위값을 내야 하지?") → **가격대별 단지 수 5구간**(경계는 BudgetPanel 프리셋 3/5/7/10억과 동일) + **지역별 미분양률 막대 17개**(상위 5 + 더보기).
  표본 20곳 미만 지역은 "N곳 기준"·회색·맨 아래(제주 10곳 55.5%가 맨 위 최장 막대를 차지하던 것을 화면 실측으로 발견).
  집계는 원장의 "daily-deploy 산출"이 아니라 **클라이언트 useMemo**(새 수집 0 — Q5 "집계만"에는 부합). 원장이 스냅샷이라 다음 세션이 파이프라인을 찾지 않도록 여기 적어 둔다.
  ⚠️ **적대검증이 상급 결함 2건을 잡았다**(그냥 머지했으면 손님이 틀린 수를 봤다): 위젯 개수 ≠ 클릭 후 목록 개수가 **다섯 구간 전부**(3~5억 819→729, 3억미만 184→219로 방향까지 반대).
  원인 셋 = ①모집단(목록은 hideNoUnsold 기본 켜짐) ②경계(목록 `<=` vs 위젯 `<`) ③`price ?? 0`이 가격 미상 66곳을 0원 취급. 셋 다 수정 후 라이브 165/729/434/211/105 일치 확인.
- ✅ **[PR-6 묶음] 거래 건수 노출** — 세션554, PR [#525](https://github.com/developer-duno/mibunyang/pull/525).
  `LTV한도` 앞에 `거래` 열(근거가 결과보다 먼저) + 5건 미만 amber·굵게·title. 상수 `FEW_TRADES_MAX = 5`.
  **실측 정정(2026-09-21, `apartments_flat` 2,458행 / 면적구간 72,595개)**: 거래 1건 **8.8%**(6,354) · 5건 미만 **21.4%**(15,503) · count 결측 0.
  옛 기록 "7.3% / 18.7%" 는 stale 이었다(할루시네이션 감사가 재측정해 확정).
- ✅ **[PR-6 잔여] "점수 3열" — 뜻 확정 후 기구현으로 판정** — 세션555.
  원장 D2 의 PC 원칙 3개 중 3번째. 2026-08-11 감사(`docs/superpowers/specs/2026-08-11-redesign-plan-full-audit.md:221`)가
  *"착수 전 뜻부터 확정 — 비교 시트 3열인지 점수 탭 카테고리 3열인지 안 갈린다"* 고 못박은 항목이라,
  세션555 가 **양쪽 코드를 먼저 실측한 뒤 사장님께 질문**해 뜻을 확정했다(AskUserQuestion, 2026-09-21).
  ⚠️ **1차 설명은 틀렸다 — 세션555 맹점 검사관이 적발, 사장님께 정정 보고 후 재확인받았다.** 후보는 둘이 아니라 **셋**이다:
  - ⓐ **비교 시트** — `CompareSheet` 는 비교 대상을 가로 열(`<th>` per item)로 **이미** 그린다. 단 `useComparison.ts:6 MAX_COMPARE = 4`(3 아님).
  - ⓑ **진짜 점수 탭**(`sec-score` = `DetailModal.tsx:900`~930) — `CatPanel` 을 **세로로 나열**할 뿐이다. `CatPanel.tsx` 에 `gridTemplateColumns` **0건** = 3열이 아니다.
  - ⓒ **종합 탭 미니카드**(`sec-overview` = `DetailModal.tsx:462`~656, 그 안의 **`:551`**) — `isPC ? "repeat(3, 1fr)" : "repeat(2, 1fr)"` 로 **이미 PC 3열**.
  1차 때 나는 ⓒ의 코드를 보여 주며 "ⓑ가 이미 됐다"고 말했다 — **551 이 어느 패널 안인지 확인하지 않았다**(패널 경계는 `grep -n 'isPanelMounted("sec-' src/components/DetailModal.tsx` 로 1초에 나온다).
  원장 원문(`…-decisions.md:22`)도 *"**비교 대상** 가로 배열(점수 3열)"* 로 **비교를 한정**하고 있어, "D2 3원칙이 전부 상세 화면" 이라는 1차 근거는 셋째 항목엔 맞지 않는다.
  - **사장님 결정(정정 후 재확인, 2026-09-21) = ⓒ 로 충족된 것으로 본다.** 근거 = 종합 탭에 점수 카드 5개가 PC 3열로 있어 "점수를 한눈에" 목적이 달성되고, 비교 시트도 이미 가로 배열이다.
  → **새로 만들 것 없음.** `MAX_COMPARE` 는 4 유지(담을 수 있는 개수를 줄이면 손님 기능이 축소된다).
  → 다시 열게 된다면 후보는 **ⓑ 점수 탭을 PC 3열로**(지금 세로 나열이라 스크롤이 길다). 단 `CatPanel` 은 서브지표를 최대 41개까지 펼치므로 3열로 좁히면 표가 눌린다 — **만들어 보고 눈으로 확인해야** 하는 자리다.

### 세션538 전용률 정리가 남긴 것 (2026-09-01~02)
- ~~🟢 **`audit-env-keys.test.mjs` 가 병렬 실행에서 간헐적으로 unhandled rejection 을 낸다**~~
  `isCLI` 가드 없이 import 시점에 `main()` 이 무조건 돌아, 다른 테스트 파일이 임시 yml 을 만들고
  지우는 것과 경합하면 `process.exit(2)` 가 튄다. 단독 실행·재실행은 항상 clean 이라 **테스트
  결과 자체는 안 틀리지만** exit code 가 흔들린다(세션538 에서 2회 관측). 다른 수집기들이 쓰는
  `isCLI` 패턴을 붙이면 끝난다.
