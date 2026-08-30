# 개선 백로그

> 최초 출처: 2026-04-19 `/improve` 분석 → `~/.claude/plans/pwd-f-mibunyang-improve-report.md`
> 운영 규칙: 🔴 미션은 `/blueprint` 로 바로 실행. 🟡/🟢 는 `/improve` 에서 3회 이상 반복 지적되면 🔴 승격.
> CLAUDE.md 본문에 백로그 진행 상태 두지 말 것 — 전부 이 파일
> **완료 항목은 [BACKLOG_ARCHIVE.md](BACKLOG_ARCHIVE.md) 로 이동.** 이 파일은 "할 일"만 유지.

---

## ✅ 완료된 일 (색인 — 상세는 [BACKLOG_ARCHIVE.md](BACKLOG_ARCHIVE.md))

> **중복 플랜 방지**: plan 작성 전 이 색인을 grep. 여기 있으면 = 이미 완료, plan 금지.
> fix 를 박은 세션이 그 자리에서 항목을 ARCHIVE 로 이동 + 이 색인에 한 줄 추가 (drift 0).

- ✅ 치안 등급 수집기가 3월경 이후 안 돌던 것 종결 + 로컬 러너 매월 8일 편입 (세션521). `collect-crime-safety` 는 "사람이 연 1회 수동 실행" 설계라 워크플로·스케줄러가 없었고 `audit-orphan-collectors` ALLOWLIST·monitor `EXEMPT_FROM_STALE_CHECK` 양쪽이 사유를 적고 제외해 뒀다. 그런데 채우는 대상인 `regions` 에는 **매월 새 `recorded_at` 행이 생겨** NULL 비율이 계속 올랐다(58%→64%, 경보 영구화). 레포에 있던 CSV(243 시군구)로 1회 실행 = `apartments.crime_safety_grade` 70%→**100%** · `regions.crime_grade` 36%→**100%** · 화면 62.6%→**100%**. 835곳이 실제 등급을 받았고 그중 **579곳은 점수가 조금 내려갔다**(중립 35 → 실측 평균 45.1 — 회귀가 아니라 추정이 실측으로 바뀐 것). 러너 매월 8일 편입(행 생성자 population 5일·market-stats 6일 **뒤**) + 양쪽 예외 목록에서 제거해 정식 감시 대상으로. 뮤테이션 3종 red. **교훈 = 예외 목록의 사유는 '지금도 유효한가'를 주기적으로 재판정해야 한다** — "CSV 가 안 바뀌니 자동화할 대상이 없다"는 근거가 "채울 대상에 새 행이 생긴다"는 사실 앞에서 무너졌다.
- ✅ 3화면 재설계 **PR-3 전체 종결** — 상세 팝업 탭별 재배치 (세션508·509, PR [#369](https://github.com/developer-duno/mibunyang/pull/369)·[#377](https://github.com/developer-duno/mibunyang/pull/377)·[#378](https://github.com/developer-duno/mibunyang/pull/378)·[#379](https://github.com/developer-duno/mibunyang/pull/379)·[#380](https://github.com/developer-duno/mibunyang/pull/380), main 23bddea). 3a 종합 판정 한 줄 · 3b-1 입지 교통 카드 · 3b-2 층별가 계단 · 3c-1 분양 추가모집·시공사 · **3c-2 건물 정보 카드**. 결과 = **서랍이 입지 탭 하나만 남음**(종합·시세·분양·금융 0). **① 현존 점수 누출 차단**: `layout` 이 옛 종합 탭 서랍에 있었고 그 경로엔 로그인 분기가 없어, 세션503(2-B) 게이트 폐지 뒤로 비로그인 손님이 `4베이판상 (10점)` 을 이미 보고 있었다(적대검증이 origin/main 을 실행으로 재현) → 전용 `fmtLayout`. **② 용적률·건폐율 0% 를 전 화면에서 "미수집"으로**(198곳·12.4%) — 점수 쪽은 세션488 이후 이미 "정보 없음" 판정인데 표시 쪽만 안 따라와 한 모달 안에서 서로 다른 말을 하고 있었다. 카드가 아니라 `fieldMeta` 공통 포맷(`nPos`)을 고쳐 관리자 표·서랍까지 일괄 정정. **③ 껍데기 가드 3종 수리**(향 색 배선·카드 배선·0 가드 — 되돌려도 전부 초록이던 것을 뮤테이션 red 로 실증 후 잠금). 상세 = 글로벌 메모리 `session_2026-08-10_session509_pr3c2_and_zero_percent.md`.
- ✅ 버스(TAGO) → data.go.kr 정적 파일 전환 + 개수 세는 순서 정정 (세션 497·498, PR [#337](https://github.com/developer-duno/mibunyang/pull/337)·[#335](https://github.com/developer-duno/mibunyang/pull/335), main 66ceb76). **① TAGO 는 서울 미커버**(서울은 자체 BIS 인 TOPIS 사용) → 서울 637단지 중 391곳(62%)이 "버스 0개" 거짓 기록 → 정적 파일(15067528) 매칭으로 교체, TAGO 호출 0. 증분 워크플로가 transport 한 스텝에 4시간 job timeout 을 다 먹고 infra·schools 가 아예 안 돌던 사고도 같이 해소. **② 그 규명 중 발견**: 정적 파일은 정류장 기둥 하나를 방향별로 여러 행에 담는데(서울 16,980행 vs 서울시 TOPIS 공식 11,231건) dedup **전에** 상한을 걸어 도심이 과소 계상 — 전 단지 55%가 평균 2.54개(교통 원점수 5.08점) 손실, 대구 -10.05·서울 -9.47 vs 제주 -0.40 의 체계적 편향, 만점 버킷 0곳. dedup 先 + 만점 기준 15→20(만점 비율 30.2% → 13.9%). 뮤테이션 5종 red 실증 + `BUS_UNIQUE_CAP`↔`FULL_BUS_ROUTES` 동기화 가드 신설. 룰 = `.claude/rules/collectors/external-file-duplicate-rows.md`. 상세 = `docs/superpowers/specs/2026-08-07-transport-busstop-reversal-and-implementation.md` §8.
- ✅ monitor NULL 급증 오탐 정정 + 매일 아침 브리핑 (세션 478, PR #249) — 상세 = ARCHIVE "세션 478~479 완료".
- ✅ 곧분양 모바일 UI 3건 — 지역칩 넘침·스크롤 힌트·캘린더 기본 펼침 (세션 478, PR #250·#251) — 상세 = ARCHIVE.
- ✅ 커스텀 프리셋 필터 유실 정정 — snap 에 3필터 누락 (세션 479, PR #253) — 상세 = ARCHIVE.
- ✅ 지역칩 "★ 관심지역" 라벨 + 편집모드 안내 (세션 479, PR #254) — 상세 = ARCHIVE.
- ✅ 병원/공원 가까운순 정렬 + 도보권 필터 (세션 479, PR #255) — 상세 = ARCHIVE.
- ❌ noxious 취소 / housing-permits ok=0 — 오탐·기지, 조치 불필요 (세션 477) — 상세 = ARCHIVE.
- ✅ 랜딩 정적 JSON 슬림 + 상세 해시 버킷 — PR1(세션 468)·PR2([#324](https://github.com/developer-duno/mibunyang/pull/324), 세션 495) 완료. 잔여 관찰 3건은 세션 496 라이브 실측으로 종결(daily-deploy success / 버킷 0·15 `200 application/json` / prices 는 Content-Type `text/html`=파일 부재 + git 미추적 0). **prices 삭제 검증을 상태코드로 하면 SPA 폴백 200 에 속는다** — Content-Type 으로 볼 것. 상세 = [BACKLOG_ARCHIVE.md](BACKLOG_ARCHIVE.md) 🟡 절.
- ✅ 필터 히스토리 기능 제거 (세션 484, PR #267·#268, main b68fd96·db6b738). 진입=NEXT_SESSION [5]-(A) 추천 소제목 통일 → 실제 테마값 재현 **웹 목업(Artifact)** 확인 후 사장님 "바꾸지 않는 게 좋을 것"(소제목 취소) + "히스토리 필요없어 보이는데" → 직독 동의(라벨 "필터 N개·HH:MM" 설명력 0 / undo·redo 버튼 + "+ 프리셋 저장"과 역할 중복 / 사용 계측 0). **PR#267**: 6파일 +7-226 순수 제거 — useFilterSort(LS_FILTER_HISTORY·MAX_HISTORY·state·saveToHistory·자동저장 effect·applyHistory·clearHistory·applySnapshot skipHistory 1줄·return 3키)·PresetPanel(select+지우기+historyKey+props3)·SearchFilterBar/App 배선·types/hooks(FilterHistoryEntry, 42→39키)·**SearchFilterBar.types.ts**(플랜 5파일 박제였으나 실제 6파일 — props 타입 별도 파일). undo/프리셋/검색 무변경, localStorage 옛 키 방치(무해). **PR#268 ★교훈=잔재 grep 은 영어 식별자+사용자 노출 한글 문구 이중으로** — GuideSections "히스토리 드롭다운으로 과거 필터 조합도 불러올 수 있습니다"(제거된 기능 거짓 안내)를 release 단계 한글 grep 이 발견 + stale 주석 2건 정리. 검증 = 잔재 grep 0(`_clearHistoryCache`=시계열 캐시 별개)·typecheck0·lint0·vitest 4035(유일 fail=audit-env-keys F드라이브 EPERM 기존 플레이크)·build·code-reviewer PASS·로컬 라이브(히스토리 부재+프리셋 적용+**undo 클릭→URL 복원**=applySnapshot 끝단 증명)·CI green 양쪽·**prod 실측 2회**(번들 "필터 히스토리" 0→index-B2-t0x57 "히스토리 드롭다운" 0 + DOM 추천 드롭다운=칩 5개만). /api/upcoming 500 1회=curl 3연속 200 단발 무사고. 운영: 서브에이전트 relay 껍데기 4연속(Explore2·재요청·Plan)→본인 직독 대체, code-reviewer 만 정상(프롬프트 "껍데기 금지·판정 본문 필수" 명시). 상세 = 메모리 `session_2026-07-05_session484_remove_filter_history.md`.
- ✅ 세션481 목업 누락분 2건 정정 — 상세필터 가로2칸 + 컨트롤높이 PC32/모바36 (세션 483, PR #263·#264, main 56bb063·7f1b2da). 사장님 **라이브 스크린샷**으로 세션481 목업 8항목 중 2건 미반영 지적("빼먹고 했네") → 사장님 원본 대화(세션481 jsonl) grep 으로 누락 확정. **진짜원인=게이팅 임계**: 2칸이 `isDesktop`(≥1024)에서만이라 그보다 좁은 폭서 1칸(코드론 정상·목업 기대 불일치). **PR#263**: DetailPanel grid `isDesktop?"1fr 1fr":"1fr"` → **`isPC?`(≥768 태블릿+PC 2칸/모바1칸)**, isPC 배선 App→SearchFilterBar→DetailPanel(prop isDesktop→isPC 교체). ⚠️**auto-fit 함정**: 처음 `repeat(auto-fit,minmax(240px,1fr))` 넣으니 라이브 1280px→**4칸**(auto-fit=max-count 없음)→"2칸" 어긋남→isPC 이진 고정 정정(라이브 DOM 실측이 잡음). **PR#264**: 컨트롤높이 `isDesktop?32:36`(SortPanel prop 신설+칩 / DetailPanel `toggleBtnStyle(active,color,isDesktop)` 시그니처+토글+시공사select), **isPC=2칸grid vs isDesktop=높이납작 용도분리**(DetailPanel 두 prop), components/CLAUDE.md "36px=터치 기준·데스크톱만 32 허용" 주석. 표현계층 전용. 검증 typecheck0·lint0·filters86·build·code-reviewer PASS 양쪽·CI green 양쪽. **★prod 배포실측(release 스킬)**: 번들 index-Bzm8_jCo 갱신+`?32:36`×3 grep, **production DOM 실측** PC1280=2칸·토글32·정렬칩32 / 태블릿800=2칸·36·36 / 모바375=1칸·36·36 전부 기대값. ⚠️**prod 기본탭=홈(isFeatureHome)·로컬dev=목록** — `/properties` 경로≠탭(SPA 매핑 없음), prod 실측은 "목록" 탭(exact) 클릭 먼저+패널마다 fresh goto(scrim 가로챔). 착시 정정: 스크린샷 소제목 회색 → 배포번들 grep=4색 전부 출하(화면 상태 문제). 세션481 8항목 **전부 완결**. BACKLOG 드리프트 정리(482 완료된 🔴PR2·🟡PR3 → ARCHIVE 이동). 상세 = 메모리 `session_2026-07-05_session483_detail_2col_control_height.md`.
- ✅ 필터 리디자인 PR2+PR3 — 정렬 칩화·상세 소제목색·2칸 + 둥글기 R토큰 통일 (세션 482, PR #260·#261, main 78a49f3·1606018). 세션 481 3-PR 로드맵 **완결**. 사장님 대화서 확정: PR2+PR3 둘 다(PR 2개 분리=회귀 분산) / 상세 PC2칸·모바1칸 / 정렬 선택만 색 / 둥글기 싹 통일 / **범위=필터8파일+AptCard만**(247군데 중, 관리자·상세모달·폼 제외). **PR2(#260 78a49f3)**: SortPanel `flexDirection:column gap:3`(세로17줄)→`flexWrap`(칩)=모바일 BottomNav(z100) 가림 해소, **네이티브 `<button>`+aria-current 유지**(span 금지=테스트·키보드 깨짐), **`height:36` 명시**(padding만 ≈29px<터치36px 규칙, 적대검증이 잡음), 선택만 색 / `filterGroups.ts` `FilterGroup.color: ToggleColor` 필드 + `groupLabelStyle(color)` 헬퍼(교통blue·가족pink·자금indigo·안전green) / DetailPanel 소제목 색라벨+2칸 그리드(`gridTemplateColumns: isDesktop?"1fr 1fr":"1fr"`)+**isDesktop prop 4곳**(타입·구조분해·SearchFilterBar 호출부·테스트 makeProps). 5파일 +120-88. **PR3(#261 1606018)**: borderRadius 3·4·5·6·8·14·16 제각각→R토큰(카드→R.card·버튼/select/input→R.btn·칩→R.chip·배지/태그→R.badge). AptCard 9곳(**S.btnBase=진짜 하단버튼**·L424=혜택 amber 박스 라벨정정)·필터 8파일. **동그라미(50%)·progress pill(99) 유지** / PresetPanel 융합칩 **split-corner=template string 유지** / chipStyle 10→7=**활성필터칩 19곳 공유**(의도). 9파일 +38-38(순수 substitution). **★적대검증(사장님 "맹점·할루시네이션 찾아라" 명시)=6프로브 워크플로+리퓨트→살아남은 6건 전부 반영**(칩36px·L424오기록·split-corner·chipStyle공유·네이티브button·isDesktop4곳). 서브에이전트 결과 본인 grep 교차검증. 검증 typecheck0·lint0·format·vitest(PR2 66·PR3 175 무회귀)·build·code-reviewer PASS·라이브 DOM 실측(PC 2칸 555px+4색 소제목·모바일 정렬칩 36px 패널222px·카드 14px·토글칩 7px)·CI green(PR2 ci4m10·e2e3m57 / PR3 ci4m11·e2e3m52). **운영 박제**: ①format:check 로컬 미실행 사고=PR2 첫 CI 38초 red(DetailPanel prettier 미정렬)→커밋 전 prettier 의무 ②force-push 권한거부→`reset --soft`후 format 별도커밋 일반 push(스쿼시라 최종 1커밋). 상세 = 메모리 `session_2026-07-05_session482_filter_chips_radius.md`.
- ✅ 필터 리디자인 PR1 — 드롭다운 글래스 오버레이(카드 안 밀림) (세션 481, PR #258, main 7485baf). 필터를 열면 드롭다운이 단지 카드를 아래로 밀어내던 문제 해소 + 사장님이 목업서 감탄한 "투명한 필터". 목업 10+회 반복 합의로 글래스 리디자인 방향 확정 → 3-PR 분리(PR1 오버레이/PR2 정렬칩+상세소제목색/PR3 카드radius). **표현계층 3파일 +54-6**: theme `R{chip7·btn8·panel10·badge6·card14}` 토큰 + `FilterDropdown.tsx` `position:absolute top:calc(100%+6px)`(카드 안 밀림)+`filter-glass` className+`<style>`주입(65% 반투명+backdrop-blur, `@supports` 미지원 시 불투명 폴백+다크, BADGE_ANIM 1회 가드 답습) + `SearchFilterBar.tsx` 바 root `position:relative z20`(오버레이 기준점)+`openPanel &&` fixed scrim(z15 rgba0.16 클릭 닫힘). z-index 안전(scrim15<헤더50<네비100=카드만 어둡게). **적대검증=서브에이전트 주간한도 초과로 워크플로 5개 전부 실패→본인 직접 grep/직독**(z-index·테스트무회귀·이중닫힘멱등)+**로컬 dev 라이브 스크린샷 실측**(PC 카드안밀림+글래스비침 확인). typecheck0·lint0·format·vitest108(필터/서치바 무수정)·build848ms·CI(ci4m19·e2e3m56·headSha be901ac 매칭)→squash. **정렬 17줄이 모바일 BottomNav 가림=PR2 정렬칩화로 해소 예정**. 상세 = 메모리 `session_2026-07-05_session481_filter_glass_redesign.md`.
- ✅ 손님 가치 발굴 — 주차 여유도 정렬 + 필터 추가 (세션 477, PR #245, main 9c28a7e). 부팅 green·코드 큐 0 (BACKLOG 전 항목 외부 대기[청약홈 7/6·MOLIT 7/10·households 7/15·eslint10 upstream] 또는 👤 사장님 결정 대기[분양 알림 PR3·/api/consults 새로고침]). 부팅 블록 자율 레인 (d) 새 손님 가치 발굴 → **parkingRatio(주차 대/세대)**: 채움률 90.5%(1427/1576, count-exact 실측으로 착시 회피)·분포 p10 0.73~p90 1.58 중앙값 1.26, AptCard 칩 표시(세션430)+scoreProduct 반영만 있고 정렬·필터 축 둘 다 부재. 세션 474(정렬 2종)·475(필터 2종) 라인. 사장님 결정 = **정렬+필터 한 PR / 필터 임계 ≥1.5(여유, 230단지 14.6%, AptCard "주차 여유" 초록칩 기준 일치)**. **표현계층 전용**(점수·AHP·엔진·DB·비로그인 블라인드 무변경, 색상 기존 C.blue 재사용→theme.test churn 0). 정렬 `parkingHigh`=parkingRatio 내림차순 null→-Infinity 맨뒤 동률 종합점수 tie-break(jeonseHigh 패턴). 필터 `parkingGoodOnly`=parkingRatio≥1.5(경계 1.5 포함). 배선 = `childcareGoodOnly`(세션475) 전 사이트 1:1 복제[useFilterSort URL맵·state·toggle·SETTERS·5 deps배열·return / useDataPipeline param·baseFilterArgs·activeFilterCount / types/hooks·SearchFilterBar.types·DetailPanel props / App·SearchFilterBar 칩], childcare vs parking 사이트 개수 대조로 누락 0 확인(useFilterSort 15 vs 14 차이=useState 줄바꿈 cosmetic). 검증 = typecheck0·lint0(기존 saveCustomPreset deps 경고만 유지, crimeSafe/childcare 동일 클래스 신규 아님)·format:check(DetailPanel.test·filterEngine prettier --write 1회 후 통과, aria-label 길어져 줄바꿈)·**vitest 2090 pass**(신규 8: 정렬1·필터2·toggle1·URL왕복2·DetailPanel토글2)·vite build exit0·code-reviewer PASS·CI(ci 4m14s·e2e 3m42s·Vercel headSha ef9cf66 매칭). 14파일 +186-26. 상세 = 메모리 `session_2026-07-04_session477_parking_sort_filter.md`.
- ✅ api 잔여 1건 — kakao-consent partial write 정합 (세션 476, PR #243, main 0258024). `api/auth/kakao-consent.ts` 가 user 해시(`kv.set`)를 통계 집합(`sadd`/`srem`)보다 **먼저** 커밋 → 집합 갱신이 Redis 순단으로 throw 하면 해시만 새 값·집합은 옛 상태 → `api/admin/users.ts:25` `kv.scard("users:consent_marketing")` 통계 영구 drift. **처방 = 쓰기 순서 재배치**(집합 먼저 → 성공 시 해시). `api/admin/review.ts:26-33` "통계 집합 우선 보호" 본질 답습. **해시 실패 시 롤백 안 함**(사장님 결정): consent 는 단일 op 라 review.ts 식 반대-op 보상이 오히려 drift 재생산, 집합=새값(통계 정확)·해시만 잠시 뒤처져 재요청 자연 치유(withHandler 500). 회귀 = 신규 테스트 2건(sadd/srem 실패 → 500 + kv.set 미호출)로 "집합 먼저, 실패 시 해시 미변경" 순서 계약 잠금, 기존 8 테스트 무변경. 검증 = vitest 10 pass·typecheck0·전체 3987 pass(F드라이브 audit-env-keys EPERM 플레이크 무관)·code-reviewer PASS·CI(ci 4m5s·e2e 3m52s·Vercel headSha b9bb04c 매칭)·squash 머지. 표현계층·점수·DB·블라인드 무변경. 상세 = 메모리 `session_2026-07-04_session476_kakao_consent_write_order.md`.
- ✅ 비로그인 지도 로그인 모달 카피 분기 + 로그인 후 지도 복귀 (세션 469 발굴·구현, PR #233, main 35c8b9f) — **세션 476 재확인 후 색인 이동**(구현 완료됐으나 pending 색인에 stale 잔존). `LoginPromptModal` `PROMPT_COPY` 트리거 별 카피 분기(map/detail) + `kakao_pending_tab='map'` 저장→콜백 복원(useKakaoAuth). 지도 요청 손님이 로그인 후 지도 탭 복귀. 표현계층 전용. 검증 = useKakaoAuth.test.js pendingTab 테스트 + 기존 통과.
- ✅ 손님 가치 발굴 — 관리비 낮은순 + 치안 안전순 정렬 2종 추가 (세션 474, PR #240, main 54a2480). 오늘(7/4 토) 관찰 대기 4건 미도달 + eslint 10 upstream 차단으로 자동 작업 부재 → 사장님 "우선순위 파악해 진행 + 서브에이전트 활용" → 워크플로 4후보 병렬 실측 우선순위화 → 사장님 위임("프로젝트 목적·사용자 편의·미래가치/실증·데이터 관리"). **손님 미노출 지표 정렬화**: DB엔 채워졌으나(관리비 71.3% p10~p90=3~22만원 3배차 / 치안 86.9% 등급 1~5 전구간 분산, base 직독 교차검증) 손님이 정렬할 수단 부재. **표현계층 전용**(점수·AHP·엔진·DB 무변경) — `SORTERS`(useDataPipeline.ts) comparator 2개[maintenanceLow·crimeSafe, null→Infinity 맨뒤 subwayNear 패턴 답습, 동률 종합점수 tie-break] + `SORT_OPTIONS`(관리비=green·치안=cyan, 라벨 구분) + `SortKey` union 2줄 + 대조군 12→14(toHaveLength·size·expectedKeys·has()) + 정렬 회귀 테스트 2개. **crimeSafe ≠ safe**(safe=risk 종합점수 / crimeSafe=원본 등급값). **필터는 제외**(useFilterSort 12곳+DetailPanel 5경로 = 정렬 5배 diff, 별 PR 분리 = 데이터 관리 원자성). 검증 = typecheck0·lint0·format·vitest src 3973·build exit0·code-reviewer PASS·CI(ci 4m·e2e 3m44s·Vercel headSha 매칭). 블라인드 무관(공개 데이터 표시 순서만). 상세 = 메모리 `session_2026-07-04_session474_sort_maintenance_crime.md`.
- ✅ 신규 단지 유입 양대 경로 동시 사망 — 재고 신선도 3개월 동결 (세션 465 발굴 🔴 P0) — **세션 473 전건 해소 확정** (2026-07-04, 코드 변경 0). a·b·c 세 경로 라이브 실측: (a) 네이버 `apartments` 최신 ap-* created_at **07-03** (세션 465 스케줄러 재등록 + 470 하드닝 후 신규 유입 재개) / (b) `naver-presale` success **ok=560 07-03** (침묵 해소) / (c) 청약홈 ah-* 로스터 **1531 + 최신 created_at 07-03** (세션 466 seeding 구현 #228). **seeding 자연 cron 경로를 dry-run 리허설로 사전 검증**(run 28685183716): 좌표 정밀 중복 게이트 실전 발화(`판정 등록0·중복54·보류11`, 래미안 엘라비네 sim1.00 dist9m 정확 skip)·로스터 diff·ah-* 1531 불변(INSERT 0 안전). **정정**: dry-run 은 `recordCollectorRun` 내부 가드(`_shared.mjs:599-605`)로 collector_runs 기록 skip = monitor ⑤ 오염 방지 설계. **잔여 = 7/6(월) 11:30 KST 자연 cron 후 collector_runs 신규행(id>405) + 실 INSERT 확인 1회**(리허설이 dry 경로 증명, 관찰만). 상세 = 메모리 `session_2026-07-04_session473_applyhome_seed_rehearsal.md`.
- ✅ dependabot #202 minor group (@types/node 26.0.0→26.0.1 · prettier 3.8.4→3.9.1) — 세션 471 머지 (2026-07-04, main 8c7a08f). prettier 3.9.1 이 `src/types/database.types.ts` 1파일 재포맷(conditional-type 괄호+union 한줄접기, 동작·타입 무변경 typecheck0 증명) → CI format:check fail. babel #220 선례로 dependabot 브랜치에 재포맷 커밋 push 후 CI green 재실행 → squash 머지 → main CI success 재확인. 운영 박제: F드라이브 exFAT 는 `npm ci`(전삭제→rolldown .node unlink EPERM) 금지, `npm install`(in-place) 사용. 상세 = 메모리 `session_2026-07-04_session471_dependabot_202.md`.
- ✅ 청약홈 매칭 회수 검증 (P2) — 세션 465 라이브 실증 종결 (2026-07-03). `collector_runs` id=236 `applyhome-detail` 6/13 cron(`30 2 13 * *`) 자연 발화 success **ok=934 fail=0**(예측 ~916 + 이후 신규 공고 자연 증가) + `presale_schedule_official` 라이브 = **984 rows / 859 distinct 단지**(예측 916/810 초과 달성). 세션 360 처방(후보 쿼리 presale_stage 제약 제거 = 전체 apartments 확대) 2.4배 회복(393→934) 실증 확정. 상세 = BACKLOG_ARCHIVE "🟡 곧 — 완료".

## 🔴 즉시

### 세션534 전수 감사 — 처리분·잔여분 (2026-08-28)

전 코드베이스 5렌즈 스캔 → 적대검증 → 계획 적대검증 → 위험 낮은 순 5PR(로컬 커밋, 독립리뷰 통과, push 대기).

**처리 완료(draft PR 대기 — 사장님 승인 후 push)**:
- PR-1 정리: pairs 죽은 배선·죽은 상수 5종(POP_RISK/POP_FUTURE/AREA_ADJ_TIERS·WON_TO_MANWON·REGION_STATS_SIDO/GU)·NOW_YM 중복·주석 스트리퍼 앵커 5곳.
- PR-2 표시정직: 적정가 게이지/핵심지표 중립대(±10%) 3분기·부재(fairPrice≤0) "0.0%" 둔갑 게이트·scoreFuture info↔detail 모순 3곳·빈값 토큰 공용상수.
- PR-3 보안: admin 강제 로그아웃이 무력했던 것(adminAuth KV status 재확인)·kakao-consent 블랙리스트 미확인.
- PR-4 수집기: trade-stats 가격행 선택을 화면 VIEW 규칙과 일치·행안부 1행 응답 유실.
- PR-5 페이징: trade-stats-regions 79만행 무정렬 유실 → 고유키 커서·selectAll 옵트인 커서.

**잔여(감사가 찾았으나 이번 제외 — 착수 가능)**:
- ✅ **apartments/complexes 손제작 무정렬 루프 — 세션534 PR-7([#456](https://github.com/developer-duno/mibunyang/pull/456))이 전수 종결** — apartments/complexes 무정렬 인라인 `.range()` 루프 **14곳(단일줄 8 + 다중줄 6)** 을 고유키 커서로 전환(전량형=selectAll 통째 교체 / fail-open 자리=손제작 커서로 시맨틱 보존). 전수 grep 확정으로 인라인 루프 0(naver-presale:740 은 의도된 bounded 단발, 제외). ⚠️ collect-crime-safety:152 는 **regions** 대상이라 이 트랙 아님(별도 판단). ⚠️ schools-neis 의 **schools 테이블** 루프는 apartments 아님(미대상).
  ✅ **`sync-naver-complex.mjs` 범용 헬퍼 `fetchAllPages` — 세션535 가 키셋 커서로 재작성해 종결** — articles(활성 26만) = `article_no` 내림차순 lt 커서 / complex_price_history(38.6만) = `id` 오름차순. 결함 재현 실측 = 같은 offset 2회 교집합 0/100. 같은 파일 heating 집계의 **range 없는 생 쿼리**(1000행 캡 잠복, `.range(` grep 사각)도 동시 전환. fail-open 계약 유지(selectAll 미사용 사유). 테스트 재작성(fake 가 `.range` 미제공 → OFFSET 회귀 시 TypeError) + 뮤테이션 7종 red(그중 M4 가 배선 가드 구멍 적발 → select 리터럴 고정). 상세 = `.claude/rules/collectors/unordered-pagination-loses-rows.md` 답습 자산 §세션535.
  ℹ️ **`complex_links` 테이블은 DB 에 실존하지 않음** (세션535 실측: "Could not find the table 'public.complex_links'") — sync-naver-complex 의 complex_links 조회는 항상 에러 → 이름 유사도 폴백으로 빠지는 죽은 경로. 페이징 결함 아님이라 미수정. 이 테이블을 만들 계획이 생기면 그때 단발 `range(0,49999)`(1000행 캡)도 함께 손볼 것.
- 🟢 **scoreProduct 미수집→최하 폴백 채점(SC2)** — sanitize 가 null 로 누른 floorAreaRatio·exclusiveRatio·parkingRatio·maxFloor 를 화면엔 "미수집"이라면서 채점은 최하 폴백으로 떨어뜨린다(미수집=최악). **점수 변경이라 사장님 결정** — 세션403 "비관적 폴백 유지" 선례와 같은 성격.
- 🟢 **login 타이밍 오라클(S2)** — 존재 계정만 PBKDF2 실행 → 응답시간으로 계정 존재 추론 가능. rate-limit(5/5분·fail-close)이 실질 완화라 Low. 필요 시 miss 경로에 더미 해시.
- ℹ️ **trade-stats house_type 분류 경계차(Info)** — SQL `LIKE 'presale_%'` 의 `_` 는 와일드카드, JS `.startsWith("presale_")` 의 `_` 는 리터럴. 현재 실데이터는 `presale_min` 하나뿐이라 동일. 밑줄 없는 `presale*` house_type 도입 시에만 갈림.

### 🔴 compute-scores 가 공유 DB 에 단지당 개별 UPDATE 2,211건을 병렬 발사 (세션527 확정, 2026-08-24)

**자매 레포(naver-estate-web 세션381)가 Supabase Logs Explorer 로 실측해 알려왔고, 우리 코드에서 확인했다.**
8/24 03:03 KST 창(= 우리 Daily Data Refresh 실행 03:02:51~03:04:19)에 `/rest/v1/apartments` **2,214건**,
초당 약 32회 버스트. 이게 PostgREST 백엔드 ~20개를 만들고 idle 로 03:21 까지 잔존 →
만성 포화(스왑 100%) Micro 인스턴스의 마지막 지푸라기 = **공유 DB OOM 크래시(8/22·8/24 두 번)** 사슬.

진앙 = `scripts/compute-scores.mjs:175-184`:
```js
const BATCH = 10;
const promises = batch.map(row =>
  sb.from("apartments").update({ cats_cache: row.cats_cache }).eq("id", row.id).select("id"));
await Promise.all(promises);   // 단지 1곳당 요청 1개 × 2,211곳
```

⚠️ **세션526 메모리의 "공유 DB 크래시 = 우리 무혐의(순차 1연결·88초)"는 틀렸다** — 읽기(`selectAll`
페이징 3요청)만 보고 **쓰기 루프**를 못 본 판단이었다. 메모리를 정정할 것.

### ✅ 1차 완화 완료 (PR [#435](https://github.com/developer-duno/mibunyang/pull/435), main `784a5746`) — 근본책은 아래 잔여

**❌ 처음 적어둔 처방(`upsertBatch` 로 교체 → 2,211 → 5 요청)은 실측에서 불가 판명.** 같은 항목에
적어둔 "착수 시 실측 1건 의무"가 그걸 막았다 — 운영 DB 에서 `{id, cats_cache}` 만 upsert 하니
`null value in column "name" of relation "apartments" violates not-null constraint`.
PostgREST 가 **INSERT 를 선시도**하기 때문이고, 그대로 바꿨으면 **재계산이 전량 실패**했다.
(`naver-presale.mjs:809` 등 기존 `upsertBatch` 사용처는 **전체 필드를 보내는 신규 등록**이라
"일부 필드만 보내는 upsert" 의 선례가 아니었다 — 내가 선례로 오독한 것.)
전체 행 upsert 는 읽은 시점 이후 다른 수집기가 바꾼 컬럼을 되돌리는 **lost update** 위험이라 배제.

**채택 = 동시성·요청률 완화** (요청 수는 그대로): `UPDATE_CONCURRENCY` 10→**5**(export) +
`UPDATE_BATCH_DELAY_MS` **100ms**. 초당 약 25회(피크 32) → **약 10회**. 소요 88초 → 약 220초.
가드 5건 + 뮤테이션 3종 red.

**잔여(근본책) = Postgres RPC** — `jsonb_to_recordset` 로 배열 UPDATE 하면 요청 수 자체가 수십 건이 된다.
마이그레이션이 필요하고 이 저장소는 **Dashboard 수동 적용**이 원칙(supabase CLI 가 다른 조직 로그인)이라
사장님 손을 거쳐야 한다. 순서 = ① 마이그레이션 적용 → ② 코드 전환(적용 전 전환하면 호출이 실패한다).

⚠️ **인과 정정 (자매 세션이 스스로 통지)**: 위 "크래시의 마지막 지푸라기" 서술은 **미검증 해석**이었다.
버스트(03:03)와 크래시(03:21) 사이 **19분 공백이 설명되지 않았고**, OOM 판정도 Postgres 서버 로그
원문이 아니라 대시보드 그래프 판독이다. **버스트 존재(2,214건·초당 32회)는 확정, 인과는 미확정.**
이 트랙의 근거는 "크래시를 막는다" 가 아니라 **"공유 자원에 초당 32회를 쏠 이유가 없다"** 로 읽을 것.

⚠️ **가격 축 수정(아래 항목)의 재계산이 이 버스트를 또 일으킨다** — 재계산 전에 최소 ①을 적용할 것.
컴퓨트는 8/24 05:50 Small(2GB)로 업그레이드돼 재발 위험은 줄었지만 요청 수를 줄이는 가치는 그대로.

### 🔴 가격 축 결함 — B(0점 몰림)·C(면적 결측) 잔여 + 프로필 비중 재측정 (세션527 조사, 2026-08-24)

> 조사 전문 = [docs/superpowers/specs/2026-08-24-price-axis-investigation.md](../docs/superpowers/specs/2026-08-24-price-axis-investigation.md)
> (모집단·방법·대조군·스윕표·척도 후보 시뮬까지 전부 박제 — **착수 전 이 문서부터 읽을 것**).
> **결함 A(괴리도 면적 편향)는 세션527이 수술 완료** — PR [#434](https://github.com/developer-duno/mibunyang/pull/434),
> main `d31b0360`. corr(면적,괴리도) **−0.704 → −0.157** · 라펜트힐 −924% → −16% ·
> 버킷 탄 단지 890/1,713 · **안 탄 단지 점수 변화 0건**. 적대검증 4관점 safe_to_merge.
> 아래 B·C 는 **원인이 다른 별개 결함**이라 그대로 잔여.

**✅ 결함 B — 처방 ① 적용·배포 완료 (세션528 #438 → 세션529 #439, main `be6774d9`)**

⚠️ **아래 옛 서술의 1.17 은 오염된 표본이었다 (세션529 정정).** 세션527이 "분양가 ÷ 동네 실거래
중앙 1.17 · 70.9%가 분양가 > 실거래"를 결함 B 의 원인으로 지목하고 세션528이 그 값을
`PRESALE_PREMIUM_COEFF` 로 채택했는데, 그 표본(892곳)은 `parseCompletion` 결함(YYYYMM 을
`new Date` 로 넘겨 서기 20만 년대로 읽음)으로 **83.4%가 이미 준공된 단지**였다. 고장난 판정으로
재현하면 n=892·중앙 1.173·70.9% 가 소수 셋째 자리까지 일치한다. 안전 근거로 든 `corr(면적,dev)`
무변화도 검증이 아니라 **항등식**이었다(계수가 97% 행에 균일하게 곱해져 계수와 무관하게 불변).
→ 올바른 미준공만으로 재산출한 값은 **1.34**(전수 괴리율 패리티). `AGE_PREMIUM` 도 방향이 반대임이
드러나 실측 재산출({1.18·1.16·1.04·0.95×4}). **0점 몰림 62% → 31.3%**(세션528 잣대 n=1,666 로는
45.6% → 39.9%). 척도(음수 배율 4)는 **안 건드렸다** — 척도 후보 S2 는 여전히 미적용이고 옛 스윕표는
분포가 바뀌어 stale 이니 **지금 분포에서 다시 재야** 한다.

⚠️ **남은 문제 — 개선의 상당 부분이 "비교 실거래 없는" 1,251곳에서 나온다**(0점 32.5%→26.1%).
비교 실거래가 있는 신뢰 표본 906곳은 사실상 제자리(평균 42.0→41.1). **분포 개선을 변별력 개선으로
읽지 말 것** — 근본 해소는 아래 결함 C(면적 결측)다.

🔴 **세션529 적대검증이 남긴 후속** (상세 = 세션529 메모리 · `src/constants/brands.ts` 주석):
- **임대 행을 채점에서 가르지 않는 선재 결함** — price 가 매매가가 아니라 보증금인 행이 매매 기준
  적정가와 비교돼 괴리도 만점을 받는다(판정불가 381곳 중 375곳 만점, 78%가 LH 국민임대).
  ⚠️ **손님 화면 영향은 없다** — 그 중 367곳이 `LEASE_PRESALE_TYPES` 필터에 걸려 정적 JSON 에서
  빠진다(적대검증이 확인). 문제는 **계수 산출·분포 보고의 모집단 오염**이다.
- **미준공 면적 편향 −0.467** — 전체(−0.107)·준공완료(+0.007)는 세션527 처방으로 해소됐는데
  미준공만 **변경 전후 완전히 동일**하게 남았다(선재, 전체 평균에 가려짐). 결함 C 와 뿌리 공유.
- **5~10y 계수 0.95 는 CI95 [0.695, 1.032]** 로 중립 1.0 을 기각하지 못한다(n=27). 최대 −78점을
  만드는 값이라 표본이 두터워지면 재검토 대상.

(옛 서술 보존 — 이 표본이 오염됐다는 사실과 함께 읽을 것)
> 분양가 ÷ 동네 실거래 = 중앙 1.17, p75 1.41, p90 1.75, 70.9%가 분양가 > 실거래.
> 실증: 써밋 리미티드 남천 142㎡ 분양가 29.9억 vs 동네 140㎡ 실거래 평균 6.85억.
> 표본 수 가드는 무의미 — `count ≥ 10` 으로 좁혀도 dev 중앙 −17.1% → −17.0%.

**✅ 결함 B(척도)·C(면적 결측) 둘 다 세션531 종결** — PR [#445](https://github.com/developer-duno/mibunyang/pull/445)(면적) + 눈금 PR.
**순서대로 했다**: 면적을 먼저 채우고, 깨끗해진 분포에서 경계를 잡았다(오염된 분포에 눈금을 맞추면
오염을 정당화하게 된다 — 세션514 앵커 교훈).

- **C(면적)**: 네이버 분양 주택형 목록(`/api/complex/scale`)에서 전용면적 수집.
  면적 보유 **897 → 1,554곳(89.8%)**, 버킷 경로를 타는 단지 **892 → 1,428곳**.
  기각한 대체 경로 3종(prices 재사용 0곳 · 가격÷평당가 역산 승률 53.1% · 평당가 비교 상관 0.149)은
  `scripts/CLAUDE.md` "분양 단지의 전용면적" 절에 근거와 함께 박제 — **되살리려면 새 근거를 들고 올 것**.
- **B(척도)**: 경계를 신뢰군 분포에서 읽었다(p90 +35.7 · p15 −37.0 → ±35), 음수 배율 4 → **1**.
  신뢰군 1,428곳: 0점 40.3%→**16.2%** · 만점 21.1%→**10.4%** · 양 끝 61.3%→**26.6%** ·
  10점 구간 최대 점유 44.0%→**22.4%**. 평균 39.9→40.9 로 **중심은 그대로**(눌린 양 끝을 편 것).
  ⚠️ 스펙 문서 §"결함 B 착수용" 의 척도 후보표(S1~S4)는 **그때 분포 기준이라 stale** — 쓰지 말 것.
- **문구 밴드 ±5 → ±10**: 근거는 **우리 추정 자체의 흔들림**이다. 계수를 문서화된 범위 안에서만
  흔들어도 괴리율이 **중앙 ±11.5%p** 움직이는데(n=1,537), ±5 밴드에서는 표본의 **5.4%만** 흔들림이
  밴드 안에 들어왔다 = 나머지 94%에 **추정 오차보다 작은 차이로 "저렴/비쌈"을 단정**하고 있었다.
  밴드를 쓰는 네 자리(점수 탭·카드 칩·카테고리 한 줄·엔진 detail)를 **한 상수**로 묶었다.

🔴 **세션531이 남긴 후속**:
- **면적 미상 176곳(10.2%)** — 네이버가 그 단지의 주택형 목록을 안 준다(빈 응답 589건). 지어내지 않고
  화면에 사실을 적었다(괴리도 `detail` 에 "면적 미상이라 동네 전체 실거래 총액과 비교"). 다른 출처
  (청약홈 상세 `SUPLY_AR` 등)를 찾으면 더 줄일 수 있다.
- **`trade-stats.mjs` 의 `latestPriceMap` 이 `house_type` 을 안 본다** — VIEW(`latest_prices`)는 청약홈
  행을 먼저 고르는데 이쪽은 `recorded_at` 최신만 본다. 그래서 **같은 단지에 서로 다른 price·area 를
  쓰고**, PSR 이 화면 `price` 와 다른 값에서 계산된다. VIEW 와 같은 규칙으로 맞추면 되고, 그때
  그 단지들의 psr 이 "중립 50" → 실측으로 바뀐다(세션521 치안 백필과 같은 성격). 규모 = 소~중.
- **`compute-scores` 재실행 필요** — 눈금 변경은 `catsCache` 를 다시 구워야 화면에 닿는다.
  daily-deploy 가 매일 굽지만, 머지 직후 1회 수동 실행이 빠르다.

(옛 서술 보존 — 세션527 시점 기록. 수치는 그때 분포 기준이라 stale)
> **결함 B** `dev < 0` 이면 `max(0, 35 + dev×4)` 라 **dev ≤ −8.75% 에서 이미 바닥**인데 실제 중앙은
> −19.2%. 위쪽도 dev ≥ +20% 면 전부 97점. **결함 A 를 고쳐도 안 풀렸다**(A 적용 후에도 62.2%).
> **결함 C** 1,713곳 중 818곳(47.8%) `area` 없음. `prices` 가 `presale_min`(area 0%) / `seed`(area 100%)
> 로 갈리는데 `trade-stats.mjs:216-221` 이 `recorded_at` 최신 1행만 고르고 `house_type` 을 안 본다.
> 단지 2,737곳 중 최신행 면적 없음 1,562곳, 그중 306곳은 `seed` 행이 있어 복구 가능.
> ⚠️ "면적 있는 행 우선"으로 단순 변경 금지 — `price` 도 같은 행에서 오므로 분양가가 함께 바뀐다.

🟡 **결함 C 잔여 (세션531·532 진행분 반영, 2026-08-25)** — 손님 노출 1,730 기준 면적 미상
**833 → 176(세션531) → 106곳(세션532 PR [#447](https://github.com/developer-duno/mibunyang/pull/447))**.
남은 106곳은 성격이 갈리므로 처방이 다르다:

| 무리 | 곳수 | 상태 | 처방 |
|---|---|---|---|
| ㉡ | **33** | `prices` 행 **자체가 없음**(그래서 price·area 둘 다 없음) + `applyhome_unit_supply` 표는 있음 | **청약홈에서 가격과 면적을 같은 줄에서 생성** → 짝 100%. 33곳 전부 가능(최저 분양가 주택형 기준 2.16억~8.99억 / 34~118㎡). ⚠️ **화면에 없던 분양가가 새로 생기므로 사장님 확인 필요**. 사장님이 "이번엔 70곳만"으로 미룸(2026-08-25) |
| ㉢ | **68** | 청약홈 표 자체가 없음(재개발임대·정비사업 등 일반분양 아님) | ~~경로 미발견~~ → **세션533 이 공고 매칭 경로 개척** (`scripts/backfill-presale-area-notices.mjs` — 청약홈 일반+무순위 완화 이름매칭 + LH 공고 2원 소스). 아래 진행분 참조 |

🟢 **세션533 진행분 (2026-08-27)**: ㉢ 중 `prices` 행 보유 38곳을 공고 매칭으로 훑어 **5곳 채움**(전부 가격 이격 ≤20.4% 교차검증 통과 — 힐스테이트고덕·고양창릉우미린·대전하늘채1회차·안양에버포레 A1/A2). 게이트 = sim≥0.60+시도+가격30% 이중검증, **이름 우선 채택** + 시군구·차수·블록 토큰 게이트(뮤테이션 14종 red). 잔여: **후보없음 31**(청약홈 공고 자체가 없는 재개발·정비·주상복합 — LH 도 기여 0, 서울분은 SH 관할이라 공공 API 부재) · **farGap 2**(두 표 불일치, 의도적 차단) · **prices 행 없음 35**(㉡와 같은 "행 생성" 문제 — 사장님 보류 유지). 재실행은 멱등(`--dry-run` 먼저).

세션532 방식(`scripts/backfill-presale-area-applyhome.mjs`)은 **저장된 price 에 가장 가까운 분양가의
주택형**을 고른다 — "청약홈 최저가 주택형"을 그냥 쓰면 두 표의 시점 차이 때문에 69.4%밖에 안 맞는다
(price 최근접은 95.7%, 대조군 1,395곳). 가격이 30% 넘게 벌어지면 두 표가 다른 집을 가리키므로
채우지 않는다(`MAX_PRICE_GAP_RATIO`, 그 구간 정확도 38.7%로 절벽).

**프로필 비중 — 투자–신혼 0.943** (세션526 잔여 1순위). 원인은 **공분산의 59.6%가 price×price**로 확정.
후보 스윕표가 스펙 문서 §4 에 있다(**A3b = 신혼만 괴리.20/전세.15/PIR.55/PSR.05 → 0.848**, 투자 무변동,
상위50 중 비싼 단지 유입 0곳). ⚠️ **결함 A·B 를 고치면 dev 분포가 바뀌므로 이 표는 다시 재야 한다** —
그대로 쓰면 낡은 잣대로 정한 값이 된다. 착수 절차·안전 지표(상위50 중 dev<−20% 유입 수)는 문서에 있다.
> 🔴 **그 조건이 세션531에 충족됐다** — A(세션527)·B(척도)·C(면적) 가 전부 끝나 dev 분포가 두 번 더
> 바뀌었다(면적 보유 897→1,554 · 0점 40.3%→16.2% · 만점 21.1%→10.4%). 스펙 §4 스윕표는 이제
> **확실히 stale** 이다. 착수하려면 **지금 분포에서 처음부터 다시 재는 것**이 첫 단계다.

**곁가지 2건**: ① `collect-data.mjs:1163-1165` 가 psr 을 **총액 비율**로 덮어쓰는 죽은 로직(지금은 VIEW 가
`ts.psr` 을 쓰므로 무해하나 살아나면 PSR 에 면적 편향 유입) ② `cardChips.ts:55-73` 이 "서브가중치 ×
카테고리가중치"를 5프로필 평균으로 **고정**해 둔 상수 — 가격 서브가 프로필별로 갈리면 재도출 대상.

### ✅ trades 실거래 수집 중단 — 세션515 종결 (이전 #404 + 복구 + 경계 재도출) (2026-08-15)

- **진단 확정(세션515 실측)**: 해외 IP 차단은 `apis.data.go.kr` 중 **국토부(1613000) 네임스페이스만**,
  2026-08-06부터, **러너 IP 복불복**(maintenance 8/06 같은 날 600전멸→재시도 3,160전성공이 증거).
  로컬 같은 호출 156ms 200. 7/06 cancelled 은 차단이 아니라 120분 timeout 킬(별건).
- **처방 완료**: PR #404 — 1613000 의존 5종(trades·molit-units·molit-building·maintenance·building-hub)
  GH yml 삭제 + `kosis-local-runner` DAY_TABLE 이전(토요일 게이트·--limit=600 보존) + monitor ⑤ 3건 신규 등재.
- **복구 완료**: 로컬 수동 1회(20분·3,726호출) → 461,222행 upsert, 202606=73,304·202607=67,444 적재.
  trade-stats 2,693/2,693 재계산.
- **재도출 완료**: `LIQUIDITY_TIERS` 1700/1050/700 → **2450/1650/1050**(완전한 6개월 창 분포
  p25 1,057·med 1,683·p75 2,479, 밴드 몰림 25.1/26.0/25.0/23.9%) + 관측값 앵커 동반 갱신.
- **관찰 잔여**: ① ✅ 8/16 로컬 러너 첫 MOLIT 자동 실행 — 세션516 확인(maintenance 289건 성공)
  ② ✅ molit-building 8/10 실패분 — 세션524(2026-08-22) 수동 보충 완료: 갱신 214·실패 0·API 477회.
  남은 미수집 227곳은 국토부 목록 미등재·이름 매칭 불가분이라 매월 10일 정기가 계속 시도(정상 잔여 — 8/10 이전에도 상존하던 몫)
  ③ 8월분 실거래는 9/6 정기 사이클이 수집(당월 제외 설계).

### P2 도시·산업축 — jigu 저장 트랙 착수 (세션515, 사장님 승인: "jigu 저장 켜기")

- **실측으로 전제 정정**: `dev_plans` source=naver **0행** — 역대 유일 실행(8/13 success ok=5392)은
  **dry-run 의 위장 기록**(수집기가 dry-run 도 recordCollectorRun 호출). 코드는 jigu 완비, 실행이 없었던 것.
- **처방(이 PR)**: ①dry-run collector_runs 기록 차단 ②`--kinds=jigu` 선택 수집(전량 7.5h 단발
  upsert 구조 위험 회피 — jigu 만 ≈1.9h) → 머지 후 실수집 1회.
- ✅ **jigu 실수집 완주 (세션516, [#409](https://github.com/developer-duno/mibunyang/pull/409))**:
  세션515의 "429 = IP 쿨다운" 인계가 **오진**이었다 — 헤더 대조 실험(A 현재코드=429 즉답 20ms /
  B +Referer=429 / C +쿠키=**200**)으로 진짜 원인 = **세션 쿠키 누락** 확정. developmentplan API 는
  쿠키 없는 요청을 "Rate limit exceeded" 거짓 문구로 즉답 거부한다. `ensureNaverSession()` 으로
  JWT+쿠키 한 캐시 배선 후 **88/88 타일·429 0회·451초 완주 → dev_plans naver/jigu 194행,
  progression_step 100% 채움**(부분준공59·실시변경36·실시계획34·지구지정27 등 13종 —
  세션512 P0-1 "조성중/완공 판별 재료" 확보). 적대검증 major = 주석만 고치고 **런타임 로그의
  옛 오진 문구**를 안 고친 것 → 5곳 정정 동반.
- ✅ **후속① 크론 부재 해소 (세션517)**: `kosis-local-runner` DAY_TABLE **매월 20일**에
  `naver-devplan.mjs --kinds=road,rail,station,jigu` 편입. 20일 = 15~19일 maintenance 배치 직후 빈
  슬롯이고 네이버 소스라 data.go.kr 쿼터 0 소모, 05:30 발화는 월/목 08:00 네이버 체인과 무충돌.
  스케줄러 재등록 불필요(러너가 이미 매일 05:30 발화). monitor ⑤ `naver-devplan`(stale_days 38, 월간
  기준) 동시 등재 + 크론↔감시를 한쪽만 되돌리면 red 인 동기화 가드 3건.
- ✅ **후속② road·rail·station 실수집 완주 (세션517)**: **+259행**(road 75·rail 34·station 150),
  88/88 타일·429 0회·22.4분. 핵심 실측 = **road·rail 의 `progression_step` 은 전부 "예정" 한 값**
  (단계 변별력 0 → 점수는 단계가 아니라 **거리 존재 신호**로 설계해야 한다), **station 은 원본에 단계
  필드 자체가 없다**(`normalizeDevPlanItem` 주석 박제 확인). 단계 13종 변별력은 **jigu 뿐**
  (부분준공59·실시변경36·실시계획34·지구지정27 등). **잔여** = 전량(V-WORLD 축 포함) 수집 +
  **중간 체크포인트 부재**(마지막 일괄 upsert 라 중단 시 전부 유실 — 세션516 main() 직독 재확인).
  현 크론은 `--kinds` 로 네이버 4종만 돌려 이 위험을 피한다.
- ✅ **후속③ 점수 설계 — 세션518~522 로 종결** (세션524 실측 확인으로 "미착수" 표기 낡음 정정):
  세션518 설계(`docs/superpowers/specs/2026-08-18-devplan-scoring-design.md`) → 세션520 구현
  ([#419](https://github.com/developer-duno/mibunyang/pull/419), station 144·jigu 135 미래가치 합류,
  최근접→최고점 선택, 교통 채움률 48.5→56.1%) → 세션522 노선급 6종 35역 등재
  ([#422](https://github.com/developer-duno/mibunyang/pull/422)). road·rail 은 탈 수 있는 지점이
  없어 제외(세션520 실측 결정). 머지·재계산·배포·운영 확인까지 완료.

### 세션 512 적대검증 잔여 — 12 에이전트가 찾고 내가 안 고친 것 (2026-08-14)

> 세션512 3PR 을 6관점 적대검증에 걸어 **40건 생존(high 15·medium 15·low 10) / 8건 기각**.
> 그중 **내 회귀 2건 + 무방비 가드 3건은 [#396](https://github.com/developer-duno/mibunyang/pull/396) 으로 즉시 반영**했다.
> 아래는 남은 것 — 전부 파일:줄과 실측 수치가 나와 있어 재조사 없이 착수 가능하다.
> 모집단은 명시 없으면 **정적 JSON 1,646곳**.

#### 🔴 내 P0-1 진단을 정정해야 한다 (다음 세션이 이 문장들을 사실로 받으면 안 됨)

- 🔴 **"corr ≈ 0 이므로 가치 없음"은 근거가 못 된다** — 같은 잣대로 재면 **지하철 거리 r=−0.053**,
  학군까지 탈락한다(시군구 중심화 pooled, 구 n≥10). 도시개발 r=+0.101(n=927) · 산업단지 r=+0.009(n=711).
  정직한 결론은 "**현재 데이터로는 두 축의 가치를 판정할 수 없다**"이고, 판정 불가를 가치 없음으로
  바꿔 제거를 결정하면 안 된다. 판정하려면 단지/구 단위 **가격 시계열**이 먼저 필요하다(별 트랙).
- 🔴 **"내용물은 완공 지구"는 표본 3개로 일반화한 것** — 도시축 고유 지구 **554개** · 산업축 고유 단지
  **240개** 중, 이름만으로 조성 중이 확인되는 것만 세도 **68곳 / 18개 지구**(부천원종 공공주택지구 15 ·
  인천검단 15 · 남양주진접2 5 등 3기 신도시). 제거/유지 결정 전에 554+240 의 완공 여부를 먼저 재야 한다.
- ✅ **도시축 상태 출처 — 세션517 수집 + 세션520 배선으로 종결.** 그때 "저장 안 됨"이던 `jigu` 는
  이제 **194건**이 진행단계까지 들어와 있고(세션517), 세션520 에 `transit-match.mjs` 가 도시축
  후보로 받는다(부분준공 59건 제외 → 135건 합류). 만점 비율 21.3% → 22.2%.
  ⚠️ 남은 비대칭: `lh_zone` 1,174건은 원본에 `progression_step` 이 **전부 null** 이라 같은
  부분준공 걸러내기를 못 한다 — 데이터 한계이지 설계 의도가 아니다.
- ✅ **네이버 노선 6종의 노선급 — 세션522 등재 완료.** 공식 자료(서울시 미디어허브·부산교통공사·
  국토부고시 2024-12) + dev_plans raw 직독으로 확정: 위례선=트램6 · 사상하단선/양산선=경전철8 ·
  신분당선(광교-호매실)/여주-원주선=지하철연장12 · 경강선(시흥-성남)=**월곶판교선 별칭**이라
  도시철도15 상속. TS 표+수집기 거울 동시 등재, 값 잠금 가드(@/constants 직접 import) 신설,
  뮤테이션 3종 red. 전 단지 영향 실측 = 오름 61(평균 +4.89)·내림 25(전부 위례선 8→6, 추정→실측
  정정). 원문(착수 방법·경위)은 아래 이력 보존:
  (이력) 🟡 네이버 노선 6종의 노선급 미확인 — 35역이 기본급(8)에 머문다 (세션520 신설).
  `TRANSIT_LINE_TYPE`(scoringTiers.ts)은 노선명으로 등급을 찾는데, 세션520에 합류한 네이버 역사
  144개 중 **위례선·사상하단선·양산선·신분당선·경강선·여주-원주선**
  6종(35역)은 표에 대응이 없어 `TRANSIT_GRADE_DEFAULT`(8, 경전철 수준)로 떨어진다.
  도시철도(15)·GTX(20)라면 7~12점 손해다. **추측으로 채우지 않았다** — 공식 자료 확인이 선행 조건.
  → 착수: `node /f/tmp/s520-lines.mjs` 형태로 미등재 노선을 다시 뽑고(스크립트는 레포 밖), 각 노선의
  종류를 공식 소스(국가철도공단·해당 지자체 도시철도 고시)로 확인한 뒤 표에 추가.
  ⚠️ `engine.test.js` 의 1:1 가드는 **시드 파일만** 읽어서 이 사각을 못 본다 — 네이버 노선을 덮는
  가드를 함께 만들 것(단 ALLOWLIST 방식은 감시를 영구 무력화하니 피한다, 세션517 선례).

#### ✅ PR-4(점수 변경) 착수 전 경고 — 세션513 [#400](https://github.com/developer-duno/mibunyang/pull/400) 에 5건 전부 반영 완료 (아래는 이력 보존용)

- 🔴 **거래량: 구(區) 단위 통계인데 경계는 단지 단위** — `fieldMeta.ts:144-148` label "구 최근6개월 거래" ·
  `regionStatsFields.ts:63` scope:"gu". 폴백만 제거하면 **이 축이 전 단지 동점**이 된다(표시 거짓 하나를
  지우고 변별력 0 을 얻음). 경계를 구 단위 실제 분포로 재설계하거나 축 이름을 "이 구의 거래 활력"으로 바꿀 것.
- 🔴 **dsr40pass 는 이진 사실이 아니라 연속량의 임계 이진화** — `trade-stats.mjs:412-421`
  `dsr=(annualPayment/annualIncome)*100; dsr40pass = dsr<=40`. null 은 "입력(가격·소득) 미수집"이다.
  세션508 **이진** 규칙(=== false 만 불이익)을 그대로 쓰면 미측정 121곳이 **실측 4.3%만 받는 최상 대우**를
  받는다. → **연속·구간** 칸을 적용(중립). 더 나은 길은 DSR 원값(%)을 저장해 구간 채점.
- 🔴 **주차 폴백: 35곳이 화면엔 "정보 없음"인데 조용히 만점** — `scoreProduct.ts:66-69` 분모가
  `presaleGeneralSupply`. 분모를 `units` 로 **그냥 바꾸면 반대 방향으로 같은 사고**가 난다.
  → `Math.max(units, presaleGeneralSupply)` + 상식 클램프(비율 3 초과면 폴백 폐기) + info 를
  "추정 N대/세대"로.
- 🔴 **앞단(API)이 같은 값을 이미 덮어쓴다 — `engine.ts:40` 만 고치면 경로가 갈린다** :
  `api/supabase/apartments.ts:308` `recentTrades6m: row.recentTrades6m ?? 0` ·
  `:318` `dsr40pass: row.dsr40pass ?? false`. **세션508 sanitize 사고의 재발 자리**다. 회귀 가드는
  `calcCats` 단독이 아니라 **API sanitize 를 지나는 경로**로 짤 것.
- 🔴 **브랜드 문제는 '등급 간격'이 아니었다** — `resolveBuilder`(brands.ts:33-37)가 열거식 별칭이라
  법인격 접미·공백 변형을 못 덮어 **68곳이 20점→5점**으로 떨어진다. 87.7%(1,444곳)는 애초에 미등재라
  간격을 고쳐도 12.3%만 움직인다. → ① 별칭을 **정규화식**(㈜·(주)·주식회사·공백 제거 후 대조)으로
  ② 신탁·조합·공기업은 `fieldMeta` 의 `isNotApplicable` 로 "해당없음" 처리.

#### 🟡 손님이 읽는 안내문이 낡음 (점수 무변경, 문구만)

- ✅ **프로필 가중치 안내문** — 세션513 [#398](https://github.com/developer-duno/mibunyang/pull/398) `getTopCats(PROFILES[k].w)` 파생으로 교체(가드도 소스에서 수치를 읽어 대조).
- ✅ **미래가치 설명 낡음** — 세션513 [#398](https://github.com/developer-duno/mibunyang/pull/398) ScoringEngine·HeaderSection 실산식으로 교체(KTX·광역철도·"인구에 가중치 집중" 제거, 입지 축 KTX 는 참이라 유지).
- ✅ **혜택 "점수화합니다" 단언** — 세션513 [#398](https://github.com/developer-duno/mibunyang/pull/398) ScoringEngine+FAQ 를 HeaderSection 표준 문장으로. ★같은 PR 에서 JS 문자열 안 `&apos;` 5곳이 화면에 글자 그대로 찍히던 것도 정정(+가드).
- ✅ **"관리비 비교 불가" 90%가 실제로 비교해서 진 것** — 세션513 [#399](https://github.com/developer-duno/mibunyang/pull/399) detail 4분기(미수집/비쌈/같음/진짜 불가). catsCache 반영은 P1 머지 후 compute-scores(늦어도 다음 daily-deploy).
- ✅ **CompareSheet 라벨 하드코딩** — 세션513 [#399](https://github.com/developer-duno/mibunyang/pull/399) wonSource 파생(고유1=이름/2+="혜택 합계"/0="혜택 금액" — 점수 행 "혜택"과 중복 회피).

#### 🟢 정리

- ✅ **`catVerdict` 죽은 price 키** — 세션513 [#399](https://github.com/developer-duno/mibunyang/pull/399) 제거 + `Exclude<Category,"price">` 타입 잠금(되살리면 typecheck red).
- ✅ **적정가 괴리도 판정 점수 역산** — 세션513 [#399](https://github.com/developer-duno/mibunyang/pull/399) 값(dev) 기반으로(±5 경계 = benchmark 와 한 쌍, 파싱 실패 "적정가 산출 불가").
- ✅ **교통축 측정 반경 미명시** — 세션513 [#399](https://github.com/developer-duno/mibunyang/pull/399) "반경 5km 내 계획 노선 없음"으로 통일.
- ✅ **`FieldVisuals.tsx` 고아** — 세션513 사장님 결정으로 삭제(untracked 라 커밋 흔적 없음).

### 세션 512 전수 조사 — 문구가 값과 어긋나던 자리 (2026-08-14, 정적 JSON n=1,646)

> **완료분**: [#393](https://github.com/developer-duno/mibunyang/pull/393) 미래가치 3축 704곳 ·
> [#394](https://github.com/developer-duno/mibunyang/pull/394) 판정표 11종 ·
> [#395](https://github.com/developer-duno/mibunyang/pull/395) 엔진 info/detail 6종.
> 머지 후 `compute-scores` 재계산 2,101/2,101 성공 → 새 문구 운영 DB 반영 확인.
> 원칙은 [.claude/rules/meta/score-meaning-and-wording-are-a-pair.md](rules/meta/score-meaning-and-wording-are-a-pair.md) 에 박제.
> **아래는 점수가 바뀌어 별도 승인이 필요한 잔여분.** 조사·적대검증은 끝났고 처방 방향까지 나와 있다.

- ✅ **거래량 null 폴백 + 구 단위 경계** — 세션513 [#400](https://github.com/developer-duno/mibunyang/pull/400) null 보존(엔진+API) + LIQUIDITY_TIERS 사분위 재설계(2000/1000/500) + UNKNOWN 45. 최상 몰림 61.5%→13.9%.
- ✅ **dsr40pass 미산정 "주의" 거짓** — 세션513 [#400](https://github.com/developer-duno/mibunyang/pull/400) null 보존+문구 3분기("미산정"). ⚠️처방은 이진 갈래가 아니라 **중립=다수(미통과) 구간 50**(true 4.3%뿐 — 이진 규칙의 반례, scoreRisk 주석 참조). 점수 변동 0 실측.
- ✅ **주차 폴백 분모** — 세션513 [#400](https://github.com/developer-duno/mibunyang/pull/400) `Math.max(units, presaleGeneralSupply)` + 3대/세대 초과 폴백 포기 + "추정 N대/세대" 표기. "정보 없음+만점권" 35→0곳.
- ✅ **브랜드 표기 변형·해당없음** — 세션513 [#400](https://github.com/developer-duno/mibunyang/pull/400) resolveBuilder 정규화(62곳 회복) + scoreProduct·fieldMeta 배선 수리 + 조합·신탁·공공 "(브랜드 해당없음)". 잔여는 아래 신규 항목.
- ✅ **resolveBuilder 사본 3벌 동기화 — 세션515 종결 (세션534 감사 실측)** — 대조 테스트가 `scripts/collectors/_shared.test.mjs:726-765`("resolveBuilder — brands.ts 정본과 동기화" · "BUILDER_ALIASES 표가 양쪽 동일")에 존재해 세 구현이 같은 입력→같은 출력임을 잠근다. 이력:
  (이력) 🟢 **resolveBuilder 사본 3벌 동기화** (세션513 신규) — 프론트 `brands.ts` 만 정규화 매칭 보유.
  `scripts/collectors/_shared.mjs:517`·`dart-builders.mjs:221` 사본은 열거식 그대로라 수집 시점
  표기가 어긋날 수 있다(스코어링 시 resolve 로 전량 커버돼 화면 영향 0 — 급하지 않음).
  동기화 시 세 구현이 같은 입력→같은 출력임을 잠그는 대조 테스트 동반할 것.

### 세션 512 P0-1 — 도시·산업축이 "이미 완공된 지구"를 미래가치로 센다 (사장님 결정 진행 중)

> 사장님이 통합안(①출처 교체 ②미래가치에서 빼기 ③입지로 이전 ④정직한 재명명)을 **전부 적용**으로
> 정하셨다. 다만 실측이 ③을 무너뜨렸다 — 아래 근거 참조. 착수 전 이 블록을 먼저 읽을 것.

- 🔴 **진단(실측 확정)**: `dev_plans` 1,792건의 `progression_step`·`eta` 가 **100% NULL** 이고,
  내용물이 화성동탄·광교지구·부천상동·수원영통(완공 신도시)과 한국수출(주안)·인천기계·대구염색
  (수십 년 가동 중 공단)이다. **V-WORLD 는 상태 컬럼을 주지 않는다** — 라이브 probe 결과
  `LT_C_LHZONE` = `zonename` 만, `LT_C_DAMDAN` = `cat_nam`(국가/일반산업단지 = 종류)·`dan_name`·`dan_id`.
  즉 "필드 하나 더 수집" 으로는 못 푼다.
- 🔴 **그냥 빼면 안 되는 이유**: 두 축이 1,603곳(97.4%)에 점수를 준다. 제거 시 미래가치 총점
  고유값 **71→46**, 최빈 몰림 **3.9%→20.1%** (세션511이 21.8%→3.9%로 고쳐 놓은 지표가 되돌아감),
  인구 설명력 R² 69.1%→71.3%.
- 🔴 **③(입지 이전)이 데이터로 무너졌다**: 시군구 내부 corr(거리, 평당가) = 산업 **−0.003**(86개
  시군구·1,020곳) / 도시 **+0.072**(114개·1,345곳). 둘 다 "가까울수록 좋다"가 성립하지 않는다.
  산업단지 ≤1km 는 소음 45.3dB·평당가 중앙 1,689만 vs 3~5km 42.6dB·1,897만. LH 지구는 거리별
  평당가가 평평(1,902~2,052)하고 의미 있는 건 "5km 안에 아예 없음" 38곳(인프라 19.3 vs 167~220)뿐.
- 🟡 **대체 출처 — 절반만 확보**:
  - 산업축 ✅ **KICOX 전국산업단지현황통계**(data.go.kr 15085886)에 `조성상태`(조성중/준공)·착공일·
    준공일이 있다. 파일데이터라 오픈API 자동변환 대상.
  - 도시축 ✅ **완료 — 택지정보시스템(openapi.jigu.go.kr) "지구단계정보" 수집기 가동 중** (세션523).
    V-WORLD `LT_C_LHZONE` 과 **같은 모집단**(18개 법령 고시·공고 전국 사업지구)·전국·**매월 갱신**
    (최근 2026-07-31)·단계코드/단계진행코드 필드 보유. REST API 형식도 라이브 가이드에서 실측:
    `authkey`(기관 사용신청 후 발급) + `serviceno`(1~18 — 지구정보 3·부분준공정보 9·
    사업지구기본정보 16 등) + `citycd`(시도) + `dstrcno`(지구번호, 예 `48170KH2006002`).
    data.go.kr 자동변환 API 는 **없음**(15072117 uddi 호출 404 "등록되지 않은 서비스" 실측 —
    파일 수동 다운로드 또는 기관 API 신청 두 길뿐).
    **세션522 후속 실측으로 셋 다 종결 — 기관 신청 자체가 불필요해짐**: 무인증 3단계 사슬을
    curl 로 끝까지 증명 — ①`POST /down/title.json`(table) → ntfcDe ②`POST /api/list.json`
    (**tNm**+table+ctprvn=00+ntfcDe — tNm 누락이 406 의 원인이었다) → fileNo ③`POST
    /openApi/down.do?fileTy=csv&stdrDe=&ctprvn=00&table=BLS5_DSTRC_MASTER&fileNo=` → ZIP
    (EUC-KR CSV, 62KB). 실물 확인: 전국 1,371지구, 단계코드 8종 = CP준공 888(65%)·RM실시변경
    275·RA실시계획 82·SA지구지정 45·DM개발변경 36·PC부분준공 19·SM지구변경 13·DA개발계획 13.
    광교=준공 ✓·인천검단=부분준공·남양주진접2=실시변경·⚠️화성동탄/동탄2=실시변경(장부상 변경
    고시 진행 — "이름으로 완공 추정"보다 이 장부값을 쓴다). lh_zone 1,174건 이름 매칭(관대한
    부분일치) **98.8%**. 정의서 직링크 = `/bls_Column_Info_lx.pdf`·`/bls_Code_Info_v1.1.xlsx`.
    ⚠️ 수집기 설계 주의: `naver-devplan.mjs:692` V-WORLD 축이 progression_step:null 을 upsert
    payload 에 포함 — 전량 재수집 시 보강값을 덮어쓴다(payload 에서 그 키 제거 필요).
    `filterCityDevs`(transit-match.mjs:236)는 jigu+부분준공만 제외라 **채우기만 하면 점수 불변**
    (준공 제외 + 경계 재설계는 별도 승인 단계). (구) LH 15101342 = PDF·19지구뿐 기각 유지.
    **세션523 종결**: `scripts/collectors/lhzone-status.mjs` 신설 + 로컬 러너 매월 21일(네이버 20일 다음날) +
    monitor ⑤ 등재(stale 38). 라이브 1회 실행으로 `dev_plans.progression_step`(lh_zone) **0 → 1,144/1,174(97.4%)**
    (정확 1,117 · 포함 27 · 모호 스킵 17 · 미매칭 13, 실패 0). 단계 분포 준공 783·실시변경 205·실시계획 63·
    지구지정 37·개발변경 21·부분준공 15·지구변경 11·개발계획 9. **점수 영향 0을 코드로 확인** —
    `progression_step` 을 점수에 쓰는 자리는 `transit-match.mjs filterCityDevs` 하나뿐이고 그 조건이
    `kind === "jigu"` 라 lh_zone 에 값이 들어가도 안 걸린다(jigu 부분준공 59건 전후 불변).
    같이 처리: `naver-devplan.mjs` 가 V-WORLD 행에 `progression_step: null` 을 실어 보내 재수집 때마다
    이 값을 지우던 것 차단(payload 에서 키 제거 + PostgREST 가 키 불일치 배열을 거부하므로 출처별 분리 upsert).
    `transit-match.mjs` 주석의 낡은 전제("lh_zone 은 원본이 전부 null") 도 함께 정정.
- ⚠️ **경계 재설계가 동반돼야 한다** — "조성중만" 으로 좁히면 대상이 급감해 대부분 0점이 된다.
  세션511이 네 번 겪은 **"경계 먼저, 데이터 나중"** 함정의 다섯 번째가 될 자리다.

### 세션 510 PR-4 착수 조사가 찾은 것 (2026-08-11, 운영 API n=1,646 실측)

> 카드 계층화(PR-4) 실측 중 **화면과 점수가 서로 다른 말을 하는 자리**가 여럿 드러났다.
> PR-4 는 그중 표현 계층만 고쳤고(중복 적정가 칩·전세가율 색·미입주 층), 아래는 남은 것.
> 모수·산식은 전부 그 세션 조사 결과에 있다 — **수치를 인용할 땐 모수를 함께 적을 것.**

- ✅ **혐오시설 빨강 경고 — (나)안 이미 구현돼 있음 (세션522 실측 확인으로 낡음 정정)** — `cardChips.ts` L338~ "세션510 ①-2" 주석 블록이 정확히 (나)안: 감점 등재(`NOXIOUS_PENALTY`) 시설만 빨강, 나머지는 시설 이름을 적은 회색 사실 칩. `brands.ts` 도 죽은 키 4종 제거 + `고압선` 표기 정정(옛 `고압송전탑`이 63곳 놓침 주석) + "의도적 감점 0" 목록화 완료. (가)(채점표 확장 = 점수 이동)만 미착수 상태로 남음. 아래는 이력:
  (이력) 🔴 혐오시설 빨강 경고 933곳 중 890곳(95.4%)이 점수 감점 0 — `src/constants/brands.ts` `NOXIOUS_PENALTY` 키 7종(소각장·고압송전탑·화장장·교도소·묘지·철도인접·유흥가)과 `scripts/collectors/noxious.mjs` 수집 카테고리 10종(…장례식장·공장·하수처리장·축산시설…)의 **교집합이 3종뿐**. 스냅샷 등장 횟수: 공장 1,097 · 장례식장 794 · 하수처리장 84 — 전부 감점 0. 실제 감점되는 시설 보유 단지는 43곳(2.6%)뿐이다.
  - 두 갈래: **(가)** 채점표를 채운다(점수 이동 → 전 단지 재계산 + 사장님 승인 필요) / **(나)** 감점 있는 시설만 빨강, 나머지는 회색 사실 칩(점수 무변경, 빨강 노출 56.7%→2.6%). 권장 = (나)로 화면을 먼저 정직하게 만들고 (가)를 별 PR 로.
  - 이름 어긋남도 함께 정리: `고압선`(수집) vs `고압송전탑`(채점표), 수집이 안 만드는 죽은 키 4종.
- ✅ **시군구 4지표 미표시 — 세션523 종결** — 정식 일반구 **39곳** 기준 도달률: 합계출산율 **39/39** · 의사수·병상수 **38/39** · 공시가격 **35/39**(못 채운 4곳은 전부 화성 신설구 — 손님 화면의 화성 단지 67곳이 시 단위 표기라 그 행은 애초에 아무도 안 읽는다). 세션522 가 쓰기부(`normalizeGu`)를 배선했고, 세션523 이 **그런데도 왜 안 채워졌는지**를 지표별로 갈라 각각 처방했다 — 원인이 넷 다 달랐다:
  - **공시가격**: 별칭표에 압축형이 없어 8/19 재실행분까지 전부 압축형으로 들어가 있었다(정식 표기 **0건**/504행). 별칭 추가 후 재실행 → 정식 일반구 **35곳** 생성. 열쇠는 `recorded_at` 이 실행일이 아니라 **CSV 기준연도**라는 것 — 그래서 재실행이 옛 자리에 그대로 꽂힌다(`collect-housing-price.mjs` 는 UPDATE 0행이면 INSERT).
  - **매매가격지수**(`market_stats_history`, 별도 표라 regions 전수조사에 안 잡혔다): 같은 원인으로 20곳 미표시 → 재실행으로 **585건 전량 정식 표기**. 1·4·7·10월만 도는 수집기라 안 돌렸으면 10월까지 방치될 자리였다.
  - **합계출산율**: 부모 시 폴백 코드가 **8/11 도입**인데 이 수집기는 **8/09** 에 돌아 혜택을 못 받은 상태였다(의사수는 8/13 실행이라 이미 반영 — 같은 PR 인데 실행 시점 이틀 차이로 갈렸다). 재실행 → 일반구 **193건** 폴백.
  - **인구이동은 고칠 수 없다(데이터 한계)** — KOSIS `DT_1B26001_A01` 이 일반구를 **아예 안 준다**(라이브 실측 2026-08-22: 시군구 254건 중 압축형·정식형 양쪽 **0건**). 세션522 주석의 "KOSIS 는 일반구를 압축형으로 준다" 는 이 표에 한해 사실이 아니었다 — 표 단위로 확인하지 않고 "KOSIS 가 준다/안 준다" 를 일반화하면 이 오진을 반복한다(`migration.mjs` 주석 정정 완료).
  - ⚠️ **소급 백필 스크립트는 만들지 않기로 확정**(사장님 승인). 전수 조사 결과 "비정규 행에만 있고 정식 행엔 없는 값"은 **공시가격 하나뿐**이었고 그건 재실행으로 풀렸다. 게다가 "같은 `recorded_at` 의 정식 행에만 옮긴다"는 제약 때문에 **연 단위 값(1월 1일) ↔ 월 단위 행**이 영원히 안 만나 구조적으로 0건이다(직전 세션 초안의 dry-run 실측: 0행/0칸, 70건 전부 "옮길 곳 없음"). 필요해지면 코드를 되살리기보다 이 문단의 사실을 근거로 새로 짜는 편이 낫다.
  - ⚠️ **화성시는 접기 규칙이 유일하게 "구 → 시" 인 자리**(별칭 36개 중 1개)라 별도 주의가 붙는다 — 아래 `pickCanonicalRows` 항목 참조.
  (이력) 🔴 **시군구 4지표가 310곳(19.4%)에서 "미수집" — 세션510 블록의 유일한 진짜 잔여 (세션522 재실측: 경기 장안구가 여전히 `수원시 장안구` 4행·`수원장안구` 2행·`수원시` 6행 공존. 단 `_shared.mjs:445 normalizeGu`(canonical/parentCity 반환)는 이미 존재 — 쓰기부 배선·소급·소비자 정리가 남은 몫)** — 앞선 진단("apartments.gu 두 표기")이 **한 단계 틀렸다**. 진짜는 `regions` 안에서 같은 장소가 **세 표기**로 갈리고 표기마다 채워진 컬럼이 다르다는 것: `경기|수원시 장안구`(apartments 가 조인하는 행) = 네 컬럼 전부 빈 껍데기 / `경기|수원장안구` = 공시가격만 / `경기|수원시` = 출산율·의사·병상만. **어느 한 표기로 통일해도 절반은 여전히 못 읽는다.**
  - 피해: 공시가격·합계출산율·의사수·병상수 310곳 미표시 · 지도 색칠 356곳(22.3%) 누락 · 필터 옵션에서 경기 16개 구가 두 줄로 갈림(동안구 12곳 중 6곳만 노출) · 반쪽 주소 110곳.
  - 처방 순서: ①**쓰기부 통일**(`_shared.mjs normalizeGu` 를 전국 일반구로 확장, `canonical`+`parentCity` 둘 다 반환. 시 단위 지표는 그 시의 모든 구 행에 복제) ②별칭표 파일 하나·소비자 넷(`regulation-zones.json` 선례 답습) ③프론트 3곳 최소 수정.
  - ⚠️ **규제지역(`getZone`)은 이미 별칭으로 막혀 있어 손대면 안 된다.**
- ✅ **화성시 인구구성이 구 하나 값으로 덮일 뻔한 것 — 세션523 차단(미커밋 상태에서 잡아 운영 유출 0)** — 별칭표 36개 중 **화성시만** 접기 방향이 "구 → 시" 다(동탄·병점·만세·효행 → 화성시). 그렇게 접는 결론 자체는 옳다 — 손님 화면의 화성 단지 67곳이 전부 시 단위 표기라 구 단위 행은 아무도 못 읽는다. 문제는 **행안부가 화성시를 시 단위와 신설 4구로 둘 다 준다**는 것이라(실측: `regions` 에 구 단위 `sex_age` 16건), 세션522 가 `population-sex-age.mjs` 에 표기 통일을 붙인 순간 5개 원문이 한 키로 모여 UPDATE 루프가 같은 행을 **다섯 번 덮어쓰게** 됐다 → 시 전체 인구구성이 마지막 구의 값으로 바뀐다. **실패 0 · 로그 정상**이라 사람 눈에 안 띄는 자리였다.
  - 처방 = `pickCanonicalRows(items, recordedAt)` 신설(**export** — `main()` 안에 두면 테스트가 그 경로를 못 지난다, 세션508·512 가 두 번 겪은 자리). 한 키에 여럿이 모이면 **접히지 않은 원문(= 시 단위)** 을 남기되, **같은 등급끼리는 기존 동작(나중 것이 이김)을 그대로 둔다** — 세종처럼 원래부터 여러 원문이 한 키로 모이던 자리의 결과를 이 수정이 조용히 바꾸지 않게 하려는 것.
  - 시 단위 원문 없이 접힌 것만 여럿이면 `logError` 로 남긴다(지금은 안 일어나지만 원본이 바뀌면 조용히 틀릴 자리).
  - 가드 **7건 신규** + **뮤테이션 4종 전부 red**(시 단위 우선 규칙 삭제 → 1 실패 · `folded` 판정 무력화 → 5 · 경고 제거 → 1 · dedup 무력화 → 4).
  - 별칭표 `_why` 의 근거("화성시 일반구는 시 단위 통계만 나와")도 사실과 달라 정정 — 행안부는 구 단위도 준다. **접는 이유는 통계 부재가 아니라 화면이 못 읽기 때문**이다.
- ✅ **점수 탭 판정 "데이터 부재" — CatPanel 은 해결돼 있음 (세션522 실측)** — `CatPanel.tsx:76-81 isNoDataInfo` 가 `startsWith("데이터 부재")` 포함. `FieldTable.tsx:88` 의 좁은 인식(`—`·`미수집`만)은 잔존하나 그 노출은 아래 🟡 "빈 값 표기 9종 혼용" 트랙의 ②단계 소관(중복 등재 회피). 이력:
  (이력) 🔴 점수 탭 판정이 "데이터 부재"를 못 잡아 890곳 결함 — `src/components/CatPanel.tsx:64 isNoDataInfo` 가 `"-"`·`"정보 없음"`·`"미수집"`·`"미확인"` 만 본다. 그런데 `scorePrice.ts` 는 `"데이터 부재"` 를 낸다(1,111회) → **값이 없는 가격 지표에 판정 문구가 그대로 붙는다.** 세션 488 이 막으려던 바로 그 사고다. `FieldTable.tsx:88` 도 `"—"`·`"미수집"` 만 봐서 같은 구멍.
- ✅ **자연환경 합 100 초과 — 정규화로 해소돼 있음 (세션522 실측)** — 현행 `scoreLocation.ts:128` `env = (합 / ENV_MAX) * 100` (클램프가 아니라 나눔 — 자르면 64%가 동점이 되어 변별력이 죽는다는 근거 주석 동반). 이력:
  (이력) 🔴 `scoreLocation.ts:121` 자연환경 합에 클램프가 없다 — `env = viewSc + sunSc + noiseSc + airSc` 이론 최대 128(실측 최대 120), **100 초과가 1,173/1,597(73.4%)**. 0~100 스케일을 가정한 막대·등급 표시가 있으면 넘친다.

 — 2026-08-10(월) 13:30 KST (세션 496)** — 마이그 `20260807000000_applyhome_stage1_remndr.sql` 은 **2026-08-07 👤 사장님이 Dashboard 로 적용 완료**. 적용 직후 실측 검증: `applyhome_cancel_respl` 테이블 생성(0행 — 첫 수집 전이라 정상) + `applyhome_unit_supply.source` 컬럼 생성 + **기존 8,905행 전부 `source='apt'` 소급 태깅**(DEFAULT 작동 확인). 적용 전 실측은 PGRST205 / 42703 이었다. ✅ **첫 실행·실적재 완결(세션524 실측, 2026-08-22)** — `applyhome-remndr` 주간 자동 발화 8/10 ok=4,814 · 8/17 ok=4,815 둘 다 success(실패 0) + `applyhome_cancel_respl` 426행 채워짐.
  - ⚠️ **구조적 사각 (별건 — 마이그 게이트 collector 가 늘면 재발)**: 마이그 미적용 분기는 `recordCollectorRun` 을 부르지 않아 `collector_runs` 에 **행 자체가 안 남고**, 그래서 monitor ⑤ 가 그 실패를 못 본다. 유일한 신호가 Actions 실패 텔레그램 1회뿐이라 놓치면 매주 조용히 반복된다. 처방 후보 = 그 분기에서도 `recordCollectorRun(PHASE, {status:'blocked'})` 를 남기거나, monitor 에 "행 자체가 안 생기는 collector" 탐지를 추가.
  - 📎 **적용 경로 메모**: 이 PC 의 `supabase` CLI 는 플라워그룹 조직에 로그인돼 있어 `rwdtljipvmqpazrimyns` 가 `projects list` 에 안 보인다(2026-08-07 실측) → CLI 단발 적용(`supabase/CLAUDE.md` 방법 A) 불가, Dashboard(방법 B)만 가능했다. **CLI 를 미분양 계정으로 `login`+`link` 해두면 다음부터 Claude 가 직접 적용할 수 있다.**
  - ✅ **머지 완료 + dry-run 실증 (2026-08-07, 세션 496b)**: #330 머지(`2db8a01`) → main CI success → `workflow_dispatch` dry-run(run `31179129186`) **success**. 로그 실측 = 잔여세대 평형 **4,626건**(5페이지 전량) / 취소후재공급 **436건** / 로스터 2,635건 / 평형 매칭 공고 1,547·미매칭 105 → **4,382행** / 경쟁률 공고 228·미매칭 8 → **426행** / **충돌키 검사 0건(기존 8,905행 대조)** / `[완료] 12.0초 | 성공 4,808 | 실패 0 | DB 쓰기 0`. 충돌키 검사가 8,905행을 실제로 읽었다는 것 자체가 **마이그(`source` 컬럼)가 살아 있음의 증거**다. → ✅ 실적재도 완결(위 세션524 실측 참조 — 본 블록 전체 종결).
- 🟢 **글래스 확대 (선택, 세션 481 2단계) — 떠 있는 요소 전반** — PR1 글래스를 필터 드롭다운 외 다른 "떠 있는 요소"(헤더 sticky·BottomNav·DetailModal·지도 컨트롤)로 확대. 사장님 "홈페이지 전체적으로 이런 효과 예쁘네" 발화 → 단 "떠 있는 요소만"(바탕 카드/본문 불투명=가독성·성능) 확정. backdrop-blur 성능(저사양폰) 주의. 필터 PR2/PR3 안정화 후.

(세션 414 종결: 세션 413 실서비스 검증 + 통합 홈 production ON. 사장님 "실서비스 검증 먼저" → Playwright 라이브 비로그인 검증[게이트 3경로·analytics 200 실측 통과] → 사장님 "통합 홈 켜줘" → `VITE_FEATURE_HOME=true` Vercel production add + 재배포[dpl READY·peach alias] → 라이브 home-grid·home_widget_expand 200 재검증. 다음 진입 후보 = 작업 가능 미해결 항목 소진 상태 → 사장님 신규 방향 지시 대기. eslint 10[🔴 upstream 차단·9.39.4 정상동작]·avg_price[ADR 1-A 보류]·supplyRatio[MOLIT 외부 사고]는 우리 작업 불가. 👤 사장님 잔여 = 지도 위치보존 3항목 수동검증[로그인 필요]·`/api/consults 500` 확인·analytics 대시보드 수신)

- 🟡 **/api/consults 500 검증 잔여** (세션 406 발견·조치 — 사장님 스크린샷 콘솔에서 관리자 대시보드 500 확인)
  - 진앙 실측 = Vercel production 에 `SUPABASE_SERVICE_KEY` 미설정 → `getMibuyangSupabase()` throw → catch 500. DB·쿼리는 로컬 service key 프로브로 정상 확인 (consults 0행, submitted_at 정렬 OK)
  - 조치 완료 = `vercel env add SUPABASE_SERVICE_KEY production` (2026-06-13). **다음 배포부터 적용** — 적용 후 관리자 대시보드 새로고침으로 /api/consults 200 확인 잔여. `api/subscribers.ts` 도 같은 키 사용 = 동시 치유
  - **세션 465 간접 실측 3종 (2026-07-03) = 근본 원인(env 부재) 해소 확정**: (1) `vercel env ls production` = `SUPABASE_SERVICE_KEY` 존재(20d 전 등록 = 6/13 조치 일치, 이후 매일 배포 다수 = 적용 확정) (2) 비인증 GET → 401 "인증이 필요합니다"(핸들러 건강) (3) 단, `consults.ts:77 requireAdminGate` 가 `:86 getMibuyangSupabase()` **앞**이라 비인증 401은 service key 런타임 증명이 아님 — 완전 증명은 관리자 로그인 세션 필요. **잔여 = 👤 관리자 대시보드 새로고침 1클릭 (/api/consults 200 확인)**

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

- 🔴 **concurrency 분리 = 금지 (안티 패턴 박제, 세션 344)**
  - 워크플로 분석이 "34개 collector data-collection 단일 큐 직렬화 → collector별 고유 group 분리"를 제안했으나 **하면 안 됨**
  - 직렬화 = 의도된 data.go.kr 쿼터 보호. 분리 시 매월 10일 building-info(~8,500) + trades(~3,500) = 12,100 > 일일 10,000 → 429/500 폭주 (NonRetryableError 즉시 throw)
  - 세션 273 calc-collection 분리가 정답 패턴: 쿼터 무관(외부 API 0·멱등) collector만 분리. 쿼터 쓰는 collector는 직렬 유지
  - "cancelled 줄이려 분리"는 메모리 룰 `timeout-rootcause-policy.md` 경고 "큐 막힘 환각". 대안 = cron 시각 분산(KST 05:00 13개 동시 발화 → 분산, 별 검토)

- 🟡 **reusable workflow(workflow_call) 추출 (세션 344 발견, P2, 별 세션)**
  - ~~38개 collect-*.yml ~9K줄~~ → **세션 465 실측 정정: collect-*.yml 27개 / 합계 1,525줄 / workflow_call 여전히 0건** (KOSIS 로컬 이전 세션 288-289 + 개명/폐기 세션 308·453 누적으로 모수 1/6 축소 — "큰 작업" 판정 근거 stale, 진입 시 ROI 재산정)
  - (원문) 표준형(checkout→setup-node@v5→npm ci→Validate secrets→collect) 보일러플레이트 중복. workflow_call 0건
  - 위험: `audit-env-keys.mjs` 3-way secret 검증(`secret-naming-audit.md` 룰)이 reusable 구조와 충돌 → audit 리팩토링 동반(extractReusableWorkflowCalls 추가)
  - 범위: Phase 1(30 표준형)만 먼저. Group C(naver-listings 4-step / building-info Saturday fallback 등 8개)는 제외. 큰 작업

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

- 🔴 **차단: `eslint 10` 본 적용 (dependabot #203 OPEN 유지)** — ⚠️ **진짜 원인 = peer 경고 아님, plugin 런타임 크래시** (세션 471 실패 로그 실측 정정)
  - 실패 로그(run 28682719274): `eslint-plugin-react/lib/util/version.js` → `TypeError: contextOrFilename.getFilename is not a function` (exit 2). eslint 10 이 구식 `context.getFilename()` 제거 → plugin 이 옛 API 호출 → **Lint 스텝 런타임 크래시**. `--legacy-peer-deps`(우리 CI 설치)로도 못 넘김 (설치는 되나 실행 깨짐). peer `^9.7` 은 증상.
  - 실측(세션 471): `eslint-plugin-react` latest=7.37.5 · 전 버전 · beta(`next`=7.8.0-rc.0) 전부 eslint 10 지원판 **없음**. `@eslint/js` 도 10 공동 bump 필요(dependabot 은 eslint 만 bump).
  - **결정(세션 471, 사장님) = #203 그대로 열어둠** = 방치 아니라 업스트림 대기. 프로젝트 영향 0 (eslint 9.39.4 정상 동작).
  - 재오픈/해소 트리거: `eslint-plugin-react` 가 eslint 10 지원판(= `getFilename` API 크래시 해소 + peer `^10` 수용) 발행 → dependabot 자동 갱신 후 CI green 확인. 확인 명령: `npm view eslint-plugin-react@latest peerDependencies.eslint` 에 `^10` 등장 여부 + 실제 `npm run lint` 크래시 재현 여부 둘 다 실측.
  - 지금 당장 eslint 10 가려면 유일 길 = `@eslint-react/eslint-plugin`(flat config 네이티브 eslint 10) 교체 + lint 설정 재작성 + 규칙 차이 검증 = 별도 작업(세션 471 미채택).

---

## 🟡 곧

- 🟡 **층수 파생값이 최고층과 어긋나 손님이 모순을 읽는다 — 305곳(17%) (세션509 적대검증)**
  "최고층 90층"인데 바로 옆이 "층수 범위 중층(6~15F)". `apartments_flat` VIEW 기준 **305/1,797(17.0%)**,
  base `apartments` 기준 424/2,353(18.0%). 눈에 띄는 고층일수록 몰려 있다(maxFloor 상위 8건 중 5건이
  floors="중층"). **저절로 안 고쳐진다** — `scripts/collectors/calc-floors.mjs:44` 가 `!a.floors`(빈 것)만
  채우는데(쓰기 지점은 :63 한 곳뿐), `max_floor` 는 `molit-building-info.mjs` 가 월간으로 덮어쓴다.
  선택지 ① 파생 재계산(빈 것만이 아니라 어긋난 행도 갱신) ② 표시에서 `floors` 를 빼기 — `floors` 는
  `maxFloor` 100% 파생이라 나란히 보여주는 것 자체가 중복이고, 재설계 PR 계열의 "중복 걷어내기"
  원칙과도 맞는다(적대검증자 제안). 세션509 는 PR-3c-2 범위 밖이라 보류.

- 🟡 **quakeDesign 변별력 0 — scoreProduct 재설계 때 항목 폐기·5점 재배분 검토 (세션508)**
  quakeDesign 은 신축 아파트에서 변별력 0(알려진 것 중 98.9% 보유) — scoreProduct 9항목·합계 100
  재설계 때 항목 폐기 + 5점 재배분 검토 (세션508)

- 🟡 **분양 알림 발송 — PR1(#229 체계)·PR2(#230 가시성·카피) 완료, 잔여 = PR3 실발송 (세션 467)**
  - 완료(세션 467): `scripts/notify-subscribers.mjs`(접수시작 D-0~7 미래만 × 구독자 매칭 × notification_logs 멱등 dedup, SMS_ADAPTER_READY=false + SOLAPI env 이중 게이트로 계약 전 자동 dry-run) + `notify-subscribers.yml`(주간 월 14:00 KST) + applyhome-detail **주간화**(월 13일→매주 월 12:30, 미래 접수일 0건 진앙 해소) + monitor ⑤ 등재 + admin 구독자·발송로그 화면 + SubscribeForm 카피 "카카오 알림톡 또는 문자" 중립화. 설계 원문 = `~/.claude/plans/467-clever-toast.md`
  - 👤 **notification_logs 마이그 Dashboard SQL Editor 적용 대기** (`supabase/migrations/20260703000000`) — 적용 전에도 구독자 0명이라 발송기는 조기 종료(무해), 첫 구독자 생기기 전 적용
  - **PR3(실발송) 선행 결정 2건(사장님)**: ① 솔라피(SMS) 계약+발신번호 등록 ② 구 문구("카카오 알림톡")로 동의한 기존 구독자에게 SMS 발송 소급 허용 여부(리뷰 P2-3 — consent_source 버전 태깅 대안). PR3 범위 = sendSms 솔라피 SDK 실구현 + SMS_ADAPTER_READY=true 플립(테스트 동시 갱신) + UnsubscribePage(`/unsubscribe?p=&t=`) + Secrets 4종 + fail_reason 에 phone 미포함 규율(리뷰 P2-2)
  - 🟢 후속 소품: AdminConsults·AdminSubscribers mountedRef StrictMode dev 로딩 고착(리뷰 P2-4, production 무영향) / 무순위(ah-*) 알림 event_type 분리(무순위 API 접수일 부재로 v1 제외) / 관찰 = 다음 월 12:30 detail 주간화 첫 발화 후 `special_receipt_bgnde>=오늘` >0 실측 + 14:00 notify 첫 run 텔레그램 요약

- 🟡 **한 카드에서 가격 두 값이 반대를 가리킨다 — 670곳(44.0%)** (세션 510 라이브 육안 확인 중 발견) — 편차 막대 `평당가 149% 비싸요`(같은 지역 한가운데 값 대비)와 칩 `적정가보다 61% 저렴`(엔진 적정가 대비)이 나란히 뜬다. 모수 = 두 값이 동시에 뜨는 1,524곳, 방향 일치 854곳(56.0%) / **반대 670곳(44.0%)**.
  - 논리적 모순은 아니다 — **잣대가 다르다**(지역 중위값 vs `scorePrice` 적정가). 세션 487 이 문구를 "주변대비"→"적정가보다"로 정정해 이미 한 번 완화했다.
  - 남은 문제 = **손님이 두 잣대를 구분할 단서가 화면에 없다.** 편차 막대 헤더는 "○○ 아파트 한가운데 값과 비교"라고 밝히지만, 칩은 "적정가보다"라고만 해서 그 "적정가"가 무엇인지 카드에서는 알 수 없다.
  - 후보: 칩에 근거 한 마디를 붙이거나(`적정가(모델가) 대비`), 둘 중 하나를 카드에서 빼고 상세로 옮기거나, 두 값을 한 줄에 나란히 놓아 잣대 차이를 드러내기. **사장님 결정 필요** — 표현 선택이라 실측만으로 못 정한다.
- 🟡 **빈 값 표기 9종 혼용 — 단 "전부 한 단어로"는 틀린 처방 (세션 510 조사)** — `FIELD_META` 150필드에 `fmt(null)` 을 전부 실행해 보니 반환이 9종(`—` 66 · `미수집` 61 · `없음` 12 · `0만원` 4 · `-` 2 · `0%` 2 · `정보 없음` 1 · `아니오` 1 · `미인증` 1). 손님 노출: 입지 탭 1,377곳(83.7%)이 2종 이상, 점수 탭은 catsCache 보유 1,597곳 **전부(100%)** 가 2종 이상(카테고리마다 어휘가 다르다 — benefit `-` / product·risk `정보 없음` / future·location `없음` / price `데이터 부재`).
  - ⚠️ **뜻이 다른 셋은 통일 대상이 아니다**: `해당없음`(개념 자체가 없음) · `반경 밖`(측정했는데 멀다) · 혐오시설 `없음`(짝 필드가 빈 배열로 일관). 뭉개면 세션508 원칙("모름을 나쁘게/없게 단정하지 않는다")을 거꾸로 어긴다.
  - 순서: ①`src/constants/emptyText.ts` 신설(`sentinels.ts` 선례 — 진실의 원천 1곳 + CI 대조) ②**판정부터** 옛 토큰까지 인식하게(위 🔴 CatPanel 항목과 같은 작업) ③표시 문자열 교체. ②를 먼저 해야 ③ 도중에도 판정이 안 깨진다.
- 🟡 **층수 파생값 모순 — 재실측 294곳(20.2%)** (앞선 세션 기록 "305곳(17%)" 을 정정) — `floors`(구간 문자열 "중층(6~15F)")와 `maxFloor`(숫자)가 어긋난다. 모수 = 둘 다 값이 있는 1,455곳. 예: "서초동 지에스타워" `floors=중층(6~15F)` 인데 `maxFloor=19`. **한 카드(`BuildingInfoCard`) 안에서 나란히 보인다.** 원인 = `calc-floors.mjs:44` 가 `!a.floors`(빈 것)만 채우는데 `max_floor` 는 월간으로 덮어써 저절로 안 고쳐진다. 후보: 표시에서 `floors` 를 빼기(어차피 `maxFloor` 파생) 또는 파생을 매번 다시 계산.
  - 참고: `floorRange`(예: "1~48")는 또 다른 축이다 — 상한이 `maxFloor` 와 다른 경우가 1,359곳이라 셋을 같은 뜻으로 다루면 안 된다.
- 🟡 **운영 API `/api/supabase/apartments` 간헐적 500** — 2026-08-10 밤 첫 호출이 500 + `{"ok":false,"error":"데이터 조회 중 오류가 발생했습니다"}`(72바이트), 재시도 2회는 200(23.8MB). 정적 JSON 폴백이 있어 화면은 안 깨지지만 **폴백 데이터가 더 낡다**(1,597행 vs API 1,646행). 23.8MB 응답 크기가 서버리스 한도에 걸리는지 확인 필요.
- 🟢 **`discountPct > 0` 카드 칩 0곳 — 규명 완결 (세션534 감사): 데이터가 안 들어온다** — `discount_pct` 를 쓰는 수집기가 0(운영 파이프라인). 유일한 writer 는 일회성 `scripts/migrate-to-supabase.mjs`(마이그레이션), `naver-presale.mjs`·`collect-data.mjs` 에는 할인 필드 자체가 없다(`data-audit.mjs` 의 discountPct 언급은 감사용 읽기). 렌더 경로(`cardChips.ts:236`)·산식(`scoreBenefit.ts`)은 정상 — **값이 채워지면 저절로 살아난다**(조건 안 지움, 이미 결정됨). 출처 발굴(네이버 분양 상세 API 등에서 실할인 수집)은 별도 사장님 결정. 이력:
  (이력) 🟡 렌더 경로가 한 번도 도달하지 않는다 — 데이터/죽은 필드 규명 후 살리거나 걷어낸다.
- 🟡 **Supabase Micro 컴퓨트 hang — Small 업그레이드 검토 (세션 460 진단, 👤 사장님 미결정)** — 공유 인스턴스(`rwdtljipvmqpazrimyns`, t4g.micro RAM 1GB)가 2026-06-29 양쪽 collector+Vercel 부하에서 일시 hang → Cloudflare 522 약 2.5h, daily-deploy 1회 failure. 대시보드 Restart로 회복. **근본 해소 = Micro→Small(RAM 2GB, Pro 크레딧 후 순 +$5/월)** — 비용 공유라 협의 필요. 재발 시 진단·업그레이드 절차 = `supabase/CLAUDE.md` "컴퓨트 한계" 절 + 글로벌 메모리 `session_2026-06-30_session460_db_hang_infra.md`. **데이터 다이어트는 반려**(Pro+Disk30% 명분없음, 공유테이블 양쪽 위험). 워치 = hang 재발 빈도. 1회성이면 Micro 유지, 반복되면 Small.
- ❌ **monitor 음수가드 테스트 추가 — 폐기(헛돌이 확정, 세션 421)** — 세션 419 부산물로 "4곳(ageH·sinceCreated·idleDays·daysSince) 음수 입력 전용 테스트로 가드가 막는 걸 증명" 제안했으나, 세션 421 적대검증(5에이전트 만장일치 + node 줄별 실증)으로 **전부 헛돌이 확정 → 테스트 추가 0건**. 근거: 음수(미래 시각)와 0(Math.max 클램프)이 항상 양수 임계값(maxAgeHours 36·STALE_DAYS 35·stale_days≥14)의 **같은 쪽**에 떨어져 가드 제거해도 분기 불변(guardRemovalChangesBranch=false). 음수는 비교에서 먼저 걸러져 `Math.floor()` 표시 라인 **도달 불가**(사용자 노출 경로 없음). 미래-시각 테스트는 가드 제거 후에도 항상 통과 → 회귀 못 잡음. 5개 Math.max(0,..) 가드 = **방어적 no-op 확정**(제거 안전하나 cosmetic 보험이라 유지). 기존 L217 ageDays 테스트도 같은 이유로 inert. 양수-일수 표기 정확성은 기존 미발화 테스트가 이미 커버. 시간대 회귀 걱정이면 가드가 아니라 finished_at/recorded_at 저장 시간축 일치(timezone) 검증이 진짜 가치(별개)

- 🟡 **regions.avg_price 100% NULL + cross-repo 활성 사용 8 위치** (세션 223 발견, 세션 226 정정, 세션 277 재실측, **세션 316 재실측 + drift 정정**, **세션 334 ADR 승격**)
  - **정책 결정**: → [docs/decisions/avg_price-policy.md](../docs/decisions/avg_price-policy.md) (세션 334 ADR 박힘)
  - 채택 = 옵션 1-A (보류) + 미래 후보 = 옵션 1-D (자매 계산)
  - 재오픈 트리거 3건 박힘 (1-B cross-repo 정리 / 1-D KOSIS 분양면적 수집기 / 1-C ORM 매핑 변경)
  - 본 메모는 BACKLOG 트리거 자리 박힘 용도. 상세 근거·옵션 비교·답습 자산 = ADR 본문 우선

- 🟢 **migration regions UPDATE 전체행 동기화 — 의도된 설계로 유지(수정 보류)** (세션 367 발견, 세션 368 정책 확정)
  - `migration.mjs:259-275` `.update({net_migration}).eq("region").eq("gu")` (recorded_at 無) → 같은 시도행 전체 스냅샷 동기화(서울 5행 전부 net_migration=-167 실측). **L253-255 주석이 "regions 는 region+gu 당 여러 recorded_at 스냅샷이 동일 최신값으로 동기화되는 구조로 운영"으로 명문화 = 의도된 설계**(세션103 collector-contract 지적으로 `.order().limit(1)` 이미 제거). housing-permits 와 달리 "최신 1건" 의도 주석이 없고 "전체 동기화 의도" 주석이 명시됨 → 버그 아님. net_migration=작은 숫자 timeout 무위험 + latest_regions VIEW 최신행만 봐 화면 영향 0. 정책 재확인 없이는 손대지 않음(손대면 회귀).

- 🟡 **무순위 이벤트 로그 차수 노출** (세션 160 1차 적재 완료, 누적 1~2개월 후)
  - DetailModal 무순위 차수·이력 섹션 / AptCard 차수 배지 (count >= 2일 때만) / 시계열 차트 (MarketStatsCharts 패턴 재사용)
  - 트리거: 같은 apartment_id 2회+ 행 발생
  - **측정 스크립트**: `node scripts/monitors/applyhome-event-recurrence.mjs` (세션 168 박제)
  - 1차 적재 결과: 1263 events / 721 단지 보유 (단지당 평균 1.75 공고 — 시계열은 누적 후)
  - **세션 422 실측 정정 (2026-06-16)**: `applyhome-event-recurrence.mjs` 라이브 실행 = 1263 events / **고유 단지 1263개 / 단지당 평균 1.00회 / 2회+ 누적 단지 0개**. 박제 "721 단지/평균 1.75"는 stale. 충돌 키 `apartment_id,house_manage_no` 라 차수 누적 구조는 정상이나 아직 같은 단지 2번째 무순위 공고 미발생 → **차수 노출 작업 보류 유지** (스크립트 자체 판정 "📭 2회+ 단지 없음"). 트리거 = 다음 적재에서 2회+ 단지 ≥5개
  - **세션 423 재확인**: 손님 가치 UX 후보 평가 시 다시 검토 → 보류 유지 결정 동일 (트리거 미도달)
  - **세션 465 재측정 (2026-07-03)**: 동일 — 1263 events / 고유 1263 / 평균 1.00 / 2회+ 단지 **0개** → 보류 유지. ⚠️ 부수 관찰: 총량 1263 이 세션 160(5월 초)→422(6/16)→465(7/3) 내내 고정 = 신규 무순위 공고 유입 0. 자연스러운지(수집 필터·upsert 충돌키·API 응답 창) 별도 검증 후보
  - **세션 465 구조 확정 — 트리거 도달 불가능 (세션 422 "차수 누적 구조는 정상" 박제 정정)**: `collect-applyhome.mjs` 집계가 HOUSE_MANAGE_NO 단위(`buildEventsFromAggregated`) + `apartment_id = ah-{no}` 1:1 유도값 + 충돌키 `apartment_id,house_manage_no` → 같은 단지 2번째 무순위 공고가 와도 **같은 키에 upsert = row 불증가**, 평균 1.00 영구 고정. upstream 재확인(4100행 전수, 세션 465 워크플로)도 HOUSE_MANAGE_NO 당 PBLANC_NO 2종+ = 0건. → 측정 스크립트 재실행 무의미. 재오픈 조건 = 이벤트 로그를 공고번호(PBLANC_NO) 단위 적재로 재설계 + 위 🔴 신규 유입 경로 복구와 함께 (그 전까지 본 항목 동결)
  - 참조: `docs/superpowers/specs/2026-05-02-applyhome-events-log-design.md` § 명시적 비-작업

- ✅ **regions.supply_ratio 0% — 세션 501 에서 전부 종결됨 (세션 522 실측 확인으로 본 항목 낡음 정정)**
  - **⛔ 이 항목의 "대안·경계 재설계" 계획은 세션 501 이 이미 전부 실행했다** — 세션 522(2026-08-22)
    실측: ①`housing-permits.mjs` KOSIS `DT_MLTM_666` 전환 완료(헤더 주석 참조) ②`kosis-local-runner`
    DAY_TABLE **매월 11일** 편입(L174) ③8/11 자동 발화 collector_runs `success ok=17` ④DB
    `regions.supply_ratio` 17/17 시도 채움(0.09~3.0%) ⑤경계 재설계 완료 — 주 지표를 주택보급률
    `HOUSING_SUPPLY_LEVEL_TIERS`(scoringTiers.ts)로 교체 + 인허가율은 `PERMIT_RATIO_HIGH/LOW` 보정,
    scoreRisk.ts:93-154 배선 확인. 아래는 그 결정에 이르게 한 이력 보존용.
  - v1 환각: "60분 timeout 부족 / 큐 충돌" — 폐기
  - v2 환각: "사용자 직접 cancel" — 부분 정답 (cancelled 자리), 단 진짜 0% 진앙은 별
  - v3 (세션 323): "HTTP 500 = data.go.kr 서버 사고 → 자연 복구 대기" — **세션 501 에서 폐기**
  - **v4 진앙 (2026-08-08 raw 실측 확정)**: HTTP **400** + `NO_OPENAPI_SERVICE_ERROR`
    (`returnReasonCode` 12, "해당 오픈API 서비스가 없거나 폐기됨"). 500 이 아니라 **서비스 소멸**이다.
    → **기다려도 복구되지 않는다.** v3 의 "자연 대기 / 24h 재발화" 지침은 무효.
  - 죽은 endpoint: `https://apis.data.go.kr/1613000/ArchPmsService_v2/getApHsptPrmsnLst`
  - **후속 `ArchPmsHubService`(카탈로그 15136267)는 이 용도에 못 쓴다** — `getApHsTpInfo` 는
    `sigunguCd`+`bjdongCd` **둘 다 필수**(하나만 넣으면 `{"body":{}}` 빈 응답). 법정동 단위라
    시도 집계를 하려면 전국 법정동 전수가 필요해 일 10,000회 쿼터(자매 레포 공유)를 넘긴다.
    우리 단지 법정동(882곳)만 돌면 호출은 되지만 "시도 전체 인허가"가 아니라 지표 정의가 깨진다.
    (API 자체는 살아 있다 — 200 NORMAL SERVICE + 실데이터 확인. 용도가 안 맞을 뿐.)
  - **대안 = KOSIS `DT_MLTM_666`(지역별 주택건설 인허가실적)** — orgId 116, 시도 17개 × 연간
    (1990~2025), 단위 "호", **호출 1회**. 차원은 교차 cells 확정(C1_NM 이 실제 시도명).
    ⚠️ objL2/objL3 를 넘기면 `err 21`. `itmId=ALL objL1=ALL prdSe=A` 만 넘길 것.
    ⚠️ 집계행("실적"·"수도권")이 섞여 오므로 제외 필요.
    ⚠️ kosis.kr 은 해외 IP(GitHub 러너) 차단 → 로컬 러너(`kosis-local-runner`) 경유.
  - **⛔ 채우기 전에 등급 경계를 먼저 재설계해야 한다**: 현행 `SUPPLY_RATIO_TIERS` 50/100/130% 는
    **주택보급률용** 숫자인데 이 지표는 연간 인허가÷가구수라 실제값이 **0.1~10%(중앙값 1.7%)**.
    그대로 채우면 17개 시도가 전부 최하 등급(5점)으로 몰려, **지금(전부 150→최고 75점 동점)과
    방향만 반대인 같은 동점 상태**가 된다. 세션498(버스 만점 몰림)·세션500(IC 만점 몰림)에서
    두 번 고친 것과 같은 병 — 분포를 먼저 재고 **만점 비율로 경계를 고르는** 그 절차를 그대로 적용.
  - 분모(`regions.households`)는 **세션 501 에서 정정 완료**(PR #348). 그전에는 6개 시도에서
    시·군 111개가 누락돼 경기 가구수가 실제의 절반이었다 — 이제 분모는 신뢰할 수 있다.
  - **세션 403 화면 거짓 표시 정직화 완료**: 전 단지 supplyRatio NULL → api `?? 150` 비관적 폴백을 화면이 "공급량 150%" 실측값처럼 표시하던 거짓 정정. scoreRisk.ts 공급량/시공사재무 sub 가 `_fallbackSupplyRatio`/`_fallbackBuilderDebt` 플래그 읽어 "정보 없음"/"부채율 미수집" 정직 표시. **점수 불변**(비관적 폴백 정책 유지, 사장님 결정). 데이터는 여전히 MOLIT API HTTP 500 복구 대기 (6/11 raw 호출 재확인). 회귀 가드 = engine.test.js 신규 2건 (NULL→정직표시 + 정상값 회귀). builderDebtRatio NULL 도 동종 정정 동시 박힘.

---

## 🟢 여유

- 🟢 **`stale_days` ↔ 실제 발화 주기 자동 가드는 만들지 않았다** (세션521 판단, 근거 있음). 뮤테이션에서 `stale_days: 38 → 14` 를 아무도 안 잡는 것이 드러나 만들려 했으나, `EXTERNAL_API_COLLECTORS` 전 항목을 러너 주기와 대조하니 **어긋난 항목 0건**이었다. `molit-units` 만 14 로 보이는데 그건 러너 월 1회 외에 **네이버 파이프라인이 월/목** 같은 수집기를 돌려 정상 최대 간격이 4일이기 때문이고, 그 사유가 `monitor-collectors.mjs:282-283` 에 이미 주석으로 있다. 기계 가드를 만들려면 실행 경로 4종(러너·`run-naver-local`·`post-naver-collect`·GH yml)을 다 읽고 정당한 예외를 ALLOWLIST 로 빼야 하는데, **그 ALLOWLIST 가 바로 이번에 문제가 된 종류의 사각**이다(세션517·521). 같은 사고가 재발하면 그때 근거를 들고 만든다. 선례 = `.claude/rules/collectors/external-api-outage-policy.md` 세션463 절.

- 🟢 **빈 값을 "—"와 "미수집" 두 말로 부른다 — 건물 정보 카드 안에서 동시 노출 (세션509 적대검증)**
  같은 카드 8행 중 `corridorType`·`heatFuel`·`primaryDirection`·`layout`·`floorAreaRatio`·
  `buildingCoverageRatio` 는 "미수집", `maxFloor`·`floors` 는 "—" 를 쓴다(`fieldMeta` 의 `n()` 기본
  fallback). 세션509 의 0% 정정으로 4개→2개로 줄었지만 **한 카드 안 혼용은 남았다.** 손님에겐 둘 다
  "없음"이라 뜻은 통하나 표기가 갈린다. 고치려면 `maxFloor`(`n(v,"층")`)·`floors`(`v ?? "—"`)의
  fallback 을 "미수집" 으로 — 단 이 fmt 는 서랍·관리자 표도 함께 쓰므로 전 표면 영향(0% 때처럼
  공통 포맷 일괄이 맞는지 사장님 판단 필요).
- 🟢 **`pairs` 배선이 죽었는데 채움률 도넛 계산엔 남아 있다 (세션509 적대검증, 미검증 후보)**
  `src/lib/dataSections.ts:17` `fieldsOf` 가 `section.pairs` 를 합집합에 넣는데, 조사원 보고로는
  `pairs` 를 정의하는 곳도 렌더하는 곳도 0이고 테스트가 그 상태를 못박아 뒀다고 한다. ⚠️ **이 항목은
  적대검증에서 반증 단계를 못 거친 8건 중 하나** — 착수 전 `grep -rn "pairs" src/` 로 정의·렌더·테스트
  전수 실측부터 할 것(부재 단정 금지).
- ✅ **지역칩 "★편집" 라벨 모호 → "★ 관심지역" + 안내 문구 (세션 479 완료, PR #254)** — 위 완료 색인 참조. "★ 편집"→"★ 관심지역" + 편집 모드 안내 1줄로 라벨이 기능을 드러내게 정정.
- 🟢 **손님 가치 발굴 후보 — 병원/공원 가까운순 정렬 + 필터 (세션 477 실측, 다음 세션 후보)** — 세션 474/475/477 라인 연장. 거리 지표 라이브 실측(count-exact): `hospitalDist` 94.8%(median 189m·p90 590m·**max 989m=~1km 캡, sentinel 0**·≤500m 859단지) / `parkDist` 95.0%(median 241m·p90 579m·max 998m·≤500m 854단지). 둘 다 채움률 높고 분포 좋음(1km 캡이라 null=1km 밖). `emergencyDist`는 median 1564m·max 69km로 분포 넓음(응급실 희소, 성격 다름=별도 판단). **패턴 = subwayNear 정렬 그대로 답습**(거리 오름차순, null→Infinity 맨뒤, 동률 종합점수 tie-break) + `subwayOnly` 필터 답습(≤500m). 사장님 결정 필요 = ① 지표 선택(병원·공원·응급실 중 몇 개) ② 정렬만/필터만/둘 다 ③ 필터 임계(≤500m 도보권 권장). **표현계층 전용**(fieldMeta 이미 존재·AptCard 일부 노출). ⚠️ 주의 = hospitalDist/parkDist 는 sentinel 없음(subwayDist 9999·icDist/ktxDist 99 와 다름, masked-defaults 답습 불필요). 상세 실측 = 메모리 `session_2026-07-04_session477_parking_sort_filter.md`.
- ✅ **정렬·필터 전수 검사 — 대부분 세션524 [#428](https://github.com/developer-duno/mibunyang/pull/428)에서 종결 (세션534 감사 실측)** — #428(main `d5827b83`, 2026-08-22)이 시군구 배선 갭 4건 수리 + **필터 21종 테스트 가드 22건**을 붙였다. 아래 "이미 발견된 갭"(saveCustomPreset snap 3필드 누락)도 그 PR 소관으로 수리됨. 잔여 = 7축 매트릭스 **자동 검출 스크립트**(사람이 필터 추가 시 누락을 CI가 잡는 것)는 미착수 — 필요 시 아래 원문 참조. 이력:
  (이력) 🟢 **정렬·필터 전수 검사 (드리프트 감사) — 사장님 요청 (세션 477, 다음 세션 과제)** — 정렬 15종·필터 토글 9종·범위 필터 7종이 세션별로 하나씩 copy-paste 배선(~16 사이트)돼 누적 → **개별 사이트 드리프트 위험**. 목적 = "각자 따로 만든 필터를 통합 전수 점검". **이미 발견된 갭 1건(세션 477)**: `useFilterSort.ts saveCustomPreset` 의 snap 객체가 `crimeSafeOnly`/`childcareGoodOnly`/`parkingGoodOnly` **3개를 누락** → 이 필터들은 커스텀 프리셋 저장 시 절대 안 담김(deps 배열엔 있는데 snap 객체엔 없어 loop 에서 undefined→스킵). **점검 축(설계 초안)**: (1) URL 왕복 — 모든 필터가 `?param=1` 저장·복원 round-trip 하나(deserializeFromURL↔serializeToURL) (2) 프리셋 저장/복원 — snap 객체 vs FILTER_URL_MAP 정합(위 갭) (3) undo/redo 스냅샷 포함 여부 (4) activeFilterCount 반영 (5) DetailPanel reset 포함 (6) SearchFilterBar active 칩 노출 (7) 필터별 단위 테스트 존재. **구현안** = 각 필터의 7축 매트릭스를 스크립트/테스트로 자동 검출(FILTER_URL_MAP 기준 leave-none-out), 누락 시 fail. **표현계층·회귀 안전 작업**(기존 동작 보존 + 누락 메움). 진입 시 = 서브에이전트로 필터별 7축 grep 매트릭스 먼저 실측 후 갭 목록 확정 → 사장님께 "고칠 것/둘 것" 판단 받고 수정.
- ❌ **청약경쟁률 정렬 (competitionRate desc/asc) — 세션 423 폐기 (데이터 부족·의미 왜곡)** — 손님 가치 UX 후보 평가 시 라이브 실측: CR>0 715개(50.2%) 중 분양 진행단계(분양중·청약중·분양계획)는 **48개(7%)뿐**, 나머지 667개(93%)는 완료/과거(589)+미분양실패(78) → 끝난 청약경쟁률로 전체 줄세우면 이미 완판된 과거 단지가 상위 점령(미분양 전문 서비스 목적 정반대). 단위 비일관 치명적: 최댓값 437995·349071, CR>0 중 14.4%가 1000 초과 = N:1 비율 아닌 미가공 지원자수 아티팩트가 최상단 노출. null 705개(49.5%)도 바닥. **카드 배지(세션 422)는 active 48단지만 노출해 이미 의미 전달 중** → 정렬의 한계가치 낮음. 재오픈 트리거 = active-stage 한정 필터+정렬 결합 + 모집단 ≥100단지.
- ❌ **입주시기 필터 (즉시입주/N년내/예정) — 세션 423 폐기 (완전 중복)** — `moveInFilter`(classify.ts classifyMoveIn 3분류: 입주예정/미입주/입주완료)가 이미 전 스택 배포(useFilterSort URL `?movein=` 영속화·useDataPipeline leave-one-out 카운트·AreaPanel select UI·칩·filterPresets "신혼"·전용 테스트). 신규 버킷은 같은 축 이름만 다른 변형 → 무의미. 라벨 교체 시 classify.test/useFilterSort.test/filterPresets 동시 붕괴 + "미입주(준공 후 미분양)" 핵심 변별 신호 상실. 손님 가치 개선은 신규 필터 아닌 기존 select 라벨 보조설명("미입주 = 준공 후 미분양")이 더 적합(별 후보).
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

- 🟢 **eslint 9→10 메이저 업그레이드** (세션 272 IMPROVE 분석)
  - `npm outdated`: eslint 9.39→10.4, @eslint/js 9.39→10.0 (메이저 1개 뒤처짐). 그 외 React/Supabase/Vite 최신.
  - ⚠️ 위 🔴 "eslint 10 본 적용" 차단 항목과 동일 사안 — `eslint-plugin-react` peer 미지원으로 막힘.

- 🟢 **모바일 alertRow 6배지 줄바꿈 시각 회귀** (세션 160 발견, **세션 465 트리거 도달**)
  - 375px (iPhone SE) 에서 6개 배지(분양중/입주예정/미분양/시공사/혐오시설/추가모집) 동시 표시 시 alertRow 높이 측정
  - flexWrap 자동 줄바꿈 정상 작동 + 카드 높이 폭주 없음 확인 (당시 6종 인벤토리 기준)
  - **세션 465 실측**: 배지 인벤토리 6→7슬롯(치안위험/우수 추가) + 로그인 뷰 apartments.json 에서 **6배지 동시 노출 26단지 실존**(5배지 226) — 예: 인천용현 경남아너스빌. 비로그인 랜딩 JSON 은 presaleStage 등 미포함이라 최대 3배지 = 로그인 뷰만 해당. Q3 분기 도달 + 인벤토리 변화 = 재검증 트리거 충족 → Playwright 375px 로 6배지 단지 카드 1회 실측(다음 UI 세션), 문제 시 배지 상한 검토
  - 참조: 12차 GATE 검증 (G8)

- 🟢 **W6-D 옵션 ε 후속 — childcare 카테고리 승격 여부만 잔여 (세션 465 stale 정정)**
  - ~~"regions.childcare → 신규 scoreChildcare.ts 통합" (미통합 뉘앙스)~~ → **실측: childcare 신호는 이미 점수 반영 중** — `scoringTiers.ts:52` INFRA sub `{key:"childcare", max:5, weight:0.1}` + `scoreLocation.ts:160-161` detail 노출 + 상세 입지 탭 NearbyChildcareSection(세션 257). 미래 세션이 "미통합"으로 오판해 신규 카테고리 중복 설계 시 **이중 반영 사고** 위험이라 재정의
  - 잔여 = 별도 top-level 카테고리 승격 + 가중치 재배분 여부 **사장님 결정만** (현행 인프라 sub 유지가 기본값)

- 🟢 **모바일 저사양 단말 OOM 위험** (세션 279 발견, 본 PR 부수)
  - prices.json 11.35MB 모듈 Map 캐시 영구 보존 (1557 단지 × 4 배열). SPA 종료까지 메모리 반환 0
  - **세션 465 기준선 갱신**: 12,295,731 bytes(12.29MB)/1602단지 = +8.3% 성장(~+1MB/분기). OOM 보고 여전히 0 → 코드 처방(LRU/TTL) 미도달 유지, 15MB 초과 또는 OOM 보고 시 재평가. DetailModal:125 주석 실측 동기 완료(PR #225)
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

## ✅ 네이버 지도 — 세션 449에 전면 제거 (카카오 단일화)

> **세션 449**: 네이버 지도(NaverMapView·naverMapHelpers·MarkerClustering.js·provider 토글)를 전면 제거하고 카카오 단일화. 근거 = 네이버 v3 POI API 부재로 구조적 열위 + 두 SDK·줌 좌표계 반대로 버그 표면 2배(세션 448 production 크래시) > 입증된 가치(사용률 미계측). 아래 후속 후보들은 전부 무효(네이버 자체가 사라짐). `VITE_NAVER_MAP_CLIENT_ID`(vite-env·CSP) 제거 완료. 👤 잔여 = `.env.example`·Vercel 대시보드 환경변수 수동 정리(있으면, 남겨도 무해).

- ~~Vercel Preview 환경변수 `VITE_NAVER_MAP_CLIENT_ID`~~ · ~~색칠·인프라 오버레이 네이버화~~ — 세션 449 네이버 제거로 둘 다 무효.
