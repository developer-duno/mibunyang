---
paths:
  - "scripts/collectors/geocode-missing.mjs"
  - "scripts/collectors/reverse-geocode.mjs"
  - "scripts/fix-placeholder-addresses.mjs"
  - "scripts/collectors/_kakao-poi.mjs"
  - "scripts/collectors/collect-applyhome-seed.mjs"
---

> scripts/CLAUDE.md 에서 분리(세션568 문서 다이어트). 원본 그대로, 로딩 방식만 변경.

## 좌표 지오코딩 — 폴백이 만든 자리표시 주소 (세션539~543)

`geocode-missing.mjs` 의 키워드 폴백(2·3·5차)은 결과를 검증하지 않아 단지명이 안 잡히면 **구청 같은 대표
장소**를 좌표로 쓰고, 4차는 **시군구 중심점**을 썼다. `collect-applyhome-seed.mjs` 의 `geocodeAddr` 도 청약홈
주소 문자열을 키워드로 던져 1위를 무검증 채택했다(세 번째 통로 — 세션541 발견, `덕은도시개발구역 A4블록` →
다른 단지 DMC자이더리버). 그 뒤 `reverse-geocode.mjs` 가 `address IS NULL` 행을
역지오코딩해 지번·도로명·법정동코드·동까지 채우므로 **완전한 가짜 주소**가 된다(김량장동 286 = 처인구청에
개발사업 5종·19곳이 겹침, 최대 21km). 2026-09 에 209곳을 정정했다.

- **근본 처방(세션541)** = 공유 모듈 `scripts/collectors/_kakao-poi.mjs`. 세 통로가 `geocodeApartmentByName`
  하나를 쓴다: 결과 15건 중 **아파트/주택 카테고리 · 모델하우스류 제외 · 시도+시군구 토큰 게이트 · 이름 유사도 ≥0.7**
  통과분만 채택(약함 0.7~0.85 는 시군구 게이트를 거쳤을 때만). `geocode-missing` 의 주소검색(1차 `region gu dong`
  = 항상 동/구 중심점)과 4차(시군구 중심점)는 **둘 다 삭제** — 못 찾으면 **null 로 두고 skip 으로 센다**(실패 아님 —
  실패로 세면 매일 step 이 죽는다). seed 의 청약홈 주소검색은 `isPreciseGeocode`(정밀 지번만) 통과분만.
- **v2.1(세션542)** — 같은 모듈의 구멍 셋을 실측으로 막았다: ①읍면동 토큰 없는 주소는 **도로명 토큰이 결과에 있을 때만**
  정밀(`파주운정1` → `신촌동 1` 통과 사고; 로스터 501 = 도로명 371·블록식 130) ②부분문자열 승격을 유사도 하한 **앞**으로,
  단 질의 8자 이상 + 게이트 안 부분문자열 매치 **딱 1건**(`힐스테이트` 5자는 경기 안 3단지에 걸린다) ③회차 글자 바로 뒤의
  "N차"는 뗀다(`무순위 3차` 가 남으면 카카오 0건, DB 260곳). 표·실측 = 규칙 문서 §"도구 v2 구멍 3개 → v2.1 처방".
- 정정 도구 = `scripts/fix-placeholder-addresses.mjs`(3출처 교차: **카카오 POI > 청약홈 공급주소 지오코딩 >
  단지명 매칭**, dry-run 기본, `--purge-derived --ids-file=scripts/data/placeholder-coord-fixes-2026-09.json`).
  선별기 `pickKakaoCandidate`·`cleanName`·`shortRegion`·`isPreciseGeocode` 는 `_kakao-poi.mjs` 에 있고 도구·도구
  테스트가 거기서 import 한다.
- **`--apply-from=<dry-run json>`(세션543, PR #481)** — `--apply` 는 전체를 **다시 분석**해 외부 응답이 그 순간 다르면 검토한 것과
  다른 것을 반영한다(세션542: 승인 29곳 대신 33곳). 그래서 `--out` 덤프에 `rosterSize·includeWeak·limit·applySet` 을 기록하고,
  `--apply-from` 은 그 `applySet` 만 재분석 0회로 반영한다(로스터 0건·구버전 덤프는 거부, 반영 전 DB 좌표 ↔ 덤프 좌표 대조
  `apply/already/changed/missing`, 반영 직후 되읽기, `<덤프>.applied.json` 이 후속 `--refit-fields`/`--purge-derived --ids-file` 입력).
  모르는 인자·값 없는 인자(`--apply-from` 등호 누락)는 DB 접근 전 `exit 1`. 스펙 `docs/superpowers/specs/2026-09-09-apply-from-mode.md`.
- **seed 이름 기반 중복(세션543 B-4, PR #482)** — 후보 좌표가 없어도 이름 유사도 ≥0.95 + `phaseConsistent`(괄호 안 숫자) **+ `blockConflict`
  (블록 글자, `(AA19BL)`↔`(AB19BL)`)** 비충돌 + 기존 단지 좌표 있음이면 `skip`(로그 `[중복·이름]`), 아니면 보류. 두 게이트 함수는
  `_kakao-poi.mjs` 로 이동해 seed·정정 도구가 같은 잣대. 실측 = 주간 보류 10 → 4(블록 충돌·차수 충돌·저유사도 2).
- **`(예정)` POI 단독·300~500m 회색지대 = 보고만(세션544, PR-A)** — `classify` 에 `B_kakao_planned`(K 단독인데 이름에 `(…예정)`)·
  `B_gray`(단일 출처가 현재와 300m 초과 500m 이하) 추가, 둘 다 `--apply` 밖. K·A 두 출처가 서로 300m 안이면(A2) 거리·예정 무관 반영.
  **정정 도구에만** — `_kakao-poi.mjs`·`geocode-missing`·seed 는 그대로(빈 좌표를 채우는 자리에선 `(예정)` 핀이 빈칸보다 낫다:
  ok 1,003곳 중 323곳이 `(예정)` 핀과 300m 안 일치, seed 키워드 채택 15건 중 10건이 `(예정)`). 근거 실측 = 왕숙진접메르디앙더퍼스트
  (사업지 지번 335 ↔ 현재 3m, `(예정)` 핀은 자기 주소와 339m). 스펙 `docs/superpowers/specs/2026-09-09-fix-tool-planned-gray-tiers.md`.
- 방법론·오탐 사례·지역 게이트 실측·근본 처방 = [.claude/rules/collectors/placeholder-coordinates-truth-sources.md](../.claude/rules/collectors/placeholder-coordinates-truth-sources.md).
- ⚠️ 좌표를 고쳤으면 `dong/bjd_code/lot_main/lot_sub/road_address` 도 새 좌표로 재정합해야 한다(`bjd_code` 는
  건축HUB 조회 키). 파생표 정리는 **KST 03:20~05:00** 창 + **"오늘 화면 스냅샷 확인"** 이 둘 다 통과할 때만
  ([.claude/rules/collectors/purge-to-recollect-timing.md](../.claude/rules/collectors/purge-to-recollect-timing.md)).
- **창이 03:00~05:30 → 03:20~05:00 으로 좁혀졌다(세션543 W1).** `daily-deploy.yml` cron 은 `0 18 * * *`(03:00 KST)
  이지만 **실제 실행은 03:04~03:10 KST**(최근 8회 실측 18:04:36Z~18:09:47Z)이고 그 job 이 `apartments_flat` 을
  한 번 SELECT 해 화면 JSON 을 만든다 — 03:00~03:10 에 지우면 "지하철 없음·병원 0" 이 하루 박힌다(세션542 의
  03:10 예약은 13초 차이로 살았다). 상한도 재수집(`collect-naver-listings-incremental.yml`, 05:30 시작 시 대상
  목록을 뜬다) 직전이면 그날 재수집을 놓친다. 창만으로는 그날 배포 완료를 보장 못 하므로 도구가 라이브
  `meta.json` 의 `fetchedAt` 이 **오늘 03:00 이후**인지 함께 확인한다(실패하면 진행 안 함 = fail-close).
- ⚠️ **도구 인자 경로는 절대경로로 — `/tmp` 금지.** Git Bash `/tmp` = `C:\Users\<me>\AppData\Local\Temp` 인데
  node `resolve("/tmp/x")` = `F:\tmp\x` 라 **셸과 node 가 다른 폴더를 본다**. `--out` 으로 쓴 덤프를
  `--apply-from` 이 못 찾거나 다른 폴더의 옛 동명 파일을 읽는다.
- ⚠️ **모든 `selectAll` 호출은 3번째 인자 `keyCol`(표의 고유키: `id` / complexes `complex_no` / articles `article_no` / infra·transport
  `apartment_id`)를 넘기고, 그 키를 select 에 포함한다** — 세션543 W2 가 명단 4곳, 세션544 #485 가 나머지 31곳을 옮겨 무키 호출 0.
  정적 가드 `scripts/_selectall-keycol-coverage.test.mjs`(ALLOWLIST 없음, 괄호 균형·주석/문자열/정규식 마스킹)가 새 무키 호출을 red 로
  잡는다. 조회 안에 `.order(…)` 를 두면 커서 키와 충돌해 행이 샌다 — 정렬은 `collect-maintenance` 처럼 클라이언트에서. 안 넘기면 ORDER BY 없는
  OFFSET 페이징이라 2,600행+ 표에서 **에러 없이** 행이 샌다([.claude/rules/collectors/unordered-pagination-loses-rows.md](../.claude/rules/collectors/unordered-pagination-loses-rows.md)).
  특히 `collect-applyhome-seed` 는 빠진 행을 로스터에서도 못 봐 **INSERT** 로 보내고, 그 행의 `lat:null,lng:null`
  이 upsert 로 덮어써 **고친 좌표를 null 로 되돌린다** — 209곳 정정의 역행 경로다.
