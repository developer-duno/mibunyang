# A-19 ① 후속 — 연결 없는 행의 건축년도 **대체 조회**(지번 기반) 설계 v1

> 세션626(2026-10-11, Fable) · 전제 설계서 = `2026-10-11-a19-completion-and-bjd.md` v2(§2 규칙·§8 결정) · 재료 = `.omc/artifacts/session626/alt-variants.json`(변형 4종 실측, 읽기 전용) · 사장님 결정 2026-10-11 06:1x(§7)

## 0. 한 줄

`assign-completion.mjs` 는 건축년도를 **연결 표(active apt_seq)** 로만 본다. 연결이 없는 ah-* 행(486 · 전체 ah 1,564 의 31% — 미리보기 `ah-* 1564행`)은 연도 근거 없이 `recent_unverified`·`future_unverified`·`multi_notice_unverified`·`mixed_*` 에 걸려 정정이 막히거나, 25개월이 지나면 근거 없이 바뀐다. 처방 = 연결이 없을 때만 **우리 법정동코드(sgg+umd)·지번 본번·부번으로 거래 표를 직접 찾아** 건축년도를 얻는다(맹점 검사관 🟠2 · 세션625 제안 7).

## 1. 조사에서 굳은 사실(설계의 전제 — 2026-10-11 05:5x 실측, DB 쓰기 0)

| 사실 | 값 | 출처 |
|---|---|---|
| 연결 표 열쇠 → 건축년도 | 열쇠 512개 전부 값 있음(동률 0) | 탐침 `alt-variants.mjs` |
| 연도 근거 없는 ah-* 행 | **486** · 그중 bjd 10자리 + 지번 본번 있어 조회 가능 **433** · 나머지 53 = bjd/지번 빈칸(A-16·A-19②) | 같은 탐침 |
| 지번 조회 비용 | 433회 · 동시 5 · **7.4초**(평균 43ms/회) — `idx_trade_deals_jibun(sgg_cd, umd_nm, jibun)` 의 sgg_cd 접두만 타지만 충분 | `timing.mjs` 10회 + 탐침 |
| `umd_cd` 는 **매매 행에만** 있다(전월세·분양권 원문엔 없음) | 대체 조회는 매매 행만 본다 — 전세만 있는 땅은 못 찾음(한계 §6) | `20261003000000_trade_deals.sql:36` |
| 세션625 "99행 연도 확보"의 정체 | 본번만 조회 → 90 + 동률 15. **55행은 같은 땅의 옛 건물**(재개발 전 아파트, 1985~2008) 거래 · 나머지는 같은 단지인데 청약홈(블록·지구명) ↔ 국토부(마을·단지명) 이름이 달라 연결이 안 됐던 행 | `namegate.mjs` · `alt-analysis.txt` |
| 이름 문턱(0.6 + namesCompatible)을 걸면 | 15행만 남음 · 12개월+ 새 정정 5 → 2 | 같음 |
| **본번+부번**(우리 부번 0 이면 본번만) + 건물마다 1표 | 찾음 67 · 동률 **0** · 정정 결과는 본번만과 **동일**(12개월+ 새로 5 · 1~11개월 새로 11 · 빠짐 1) | 변형 V2 |
| 빠지는 1행 | 남양주 진접 부영 사랑으로 `ah-2022910157` 202206→202205 — 거래 건축 2009(임대 분양전환) ≠ 공고 2022 → **빠지는 게 맞다** | V2 lost |
| 옛 건물 거래만 남는 행 | 19행(완공값보다 4년+ 오래된 연도) → 전부 `year_mismatch` 로 "안 바꿈"(지금도 안 바뀌는 행) | `v2rows.txt` |
| 연결이 왜 없나 | 지번 경로는 이름 유사도 0.6~0.85 이면 \|연도 차\| ≤ 2 를 요구하는데 우리 완공월이 재공고 값(1~3년 늦음)이라 연도 게이트에서 떨어진다 — **준공월을 고치면 10/22 연결이 자연히 붙는다**(순환) | `_trade-links.mjs:478-485` |

## 2. 설계 — `scripts/collectors/assign-completion.mjs` 안에서만(새 파일 0)

### 2-1. 순수 함수 3개(DB 접근 0)

1. **`rowsNeedingAltYear(rows, links, yearsByAptSeq)`** → `CmpRow[]` — ah-* 행 중 자기 열쇠(없으면 묶음 열쇠) 어느 것도 `yearsByAptSeq` 에 **없고**(동률 null 은 "있음"으로 본다 — 연결 증거가 있는데 애매한 행은 대체 조회로 덮지 않는다), `bjd_code` 가 10자리이고 `lot_main` 이 1 이상인 행. 정렬 id. (`neededAptSeqs` 와 짝 — 같은 묶음 규칙 `groupBundles`.)
2. **`altYearOf(row, deals)`** → `number | null | undefined` — 사장님 결정 1.
   - `deals` = 그 행의 (sgg_cd, umd_cd, jibun_main) 매매 행(`build_year` 있음). 우리 `lot_sub` 가 0/빈칸이면 부번 무시(대표 지번 "외 N필지"), 아니면 `jibun_sub == lot_sub` 인 행만.
   - 건물 = `apt_seq ?? "n:" + apt_name`. 건물마다 자기 행들의 최빈 연도(동률이면 그 건물은 표 없음) → 건물들의 최빈값. 남는 건물 0 → `undefined`(자료 없음) · 건물 사이 동률 → `null`(판정 못 함) · 아니면 연도.
   - 왜 건물 1표: 레이카운티(1·2·3단지 한 지번, 전부 2023)는 통과, 광주 화정(옛 건물 2종 다른 연도)은 동률 → 못 씀. 행 수 가중이면 거래 많은 건물이 이긴다.
3. **`planCompletionUpdates(..., opts.altYears)`** — `opts.altYears: ReadonlyMap<string, number | null>`(id → 연도·동률 null) 기본 빈 Map(기존 시험 그대로). §2-1 6번(건축년도 대조) 자리에서:
   - 연결 열쇠로 모은 `years` 가 비고 `tieKey` 도 아닐 때만 대체 조회 값을 본다 — ⓐ 자기 id 에 값이 있으면 그것 ⓑ 없으면 묶음 행들의 값을 모아 최빈값(연결 열쇠와 **같은 규칙** — `ownKeys.length > 0 ? own : members`, source 와 무관 · 동률 → `year_ambiguous`). 자기 값이 `null`(동률)이면 `year_ambiguous`.
   - 얻은 연도는 **연결 표 연도와 똑같이** 쓴다(사장님 결정 2): 후보 연도와 다르면 `year_mismatch` 건너뜀 · 같으면 `yearOk` → 미래·최근·다중 공고·지번 2종 보호를 전부 통과. 결과 줄 `flags` 에 `alt_year` 추가(전이표에서 따로 센다).
   - `mixed_buildings` 셈(method ≠ bundle 열쇠 수)은 건드리지 않는다 — 대체 조회는 열쇠가 아니다.

### 2-2. 조회 — `fetchAltYears(sb, rows, opts)` (`fetchBuildYears` 와 같은 꼴)

행마다 `.from("trade_deals").select("apt_seq,apt_name,build_year,jibun_sub").eq("sgg_cd", bjd.slice(0,5)).eq("umd_cd", bjd.slice(5,10)).eq("jibun_main", String(lot_main))` + (우리 부번이 0·빈칸이 아니면) `.eq("jibun_sub", String(Number(lot_sub)))` + `.not("build_year","is",null).order("id", { ascending: true }).limit(ALT_YEAR_SAMPLE)` 를 동시 `UPDATE_CONCURRENCY`(5)개씩 · `ALT_YEAR_SAMPLE = 60`(건물 여럿이 한 지번에 섞여도 건물마다 몇 줄씩 들어오게 — 탐침 433행 중 60에 닿은 행 **11(부번≠0 인 6행 포함)** — 그래서 부번은 서버 조건(DB 값은 앞 0 없는 정수 글자, `_trade-deals.mjs:115`) + `order(id)` 로 날마다 같은 표본 · `altYearOf` 의 부번 필터는 이중 안전으로 남김) · 결과를 `altYearOf` 로 접어 `Map<id, number | null>`(자료 없음은 넣지 않음) · 조회 오류는 던진다 · `opts.interrupted` 면 던진다 · `trade_type` 조건은 안 건다(umd_cd 가 매매에만 있어 저절로 매매만). `.in` 금지(1,000행 상한) · 창 조회 금지(106만 행). `defaultDeps` 에 `fetchAltYears` 추가(주입형 — 시험은 가짜 sb).

`batch_rows`·완성 batch 는 보지 않는다 — 건물마다 최빈값이라 반쪽·중복 batch 가 판정을 못 바꾸고 표본만 먹는다(→ 서버 부번 조건으로 완화).

### 2-3. `main` 흐름 변경(그 밖은 그대로)

`readInputs` apartments select 에 `lot_sub,bjd_code` 추가 → `fetchBuildYears` 뒤 `rowsNeedingAltYear` → `fetchAltYears` → 로그 `대체 조회 N행 → 연도 M · 동률 T · 자료 없음 N-M-T` → `planCompletionUpdates(..., { minGap, altYears })` → 요약 로그에 `대체 조회로 연도 얻음 K` 추가(`flags.includes("alt_year")`) · `--out` 계획 파일 줄에도 flags 그대로(대조는 id·prev·next 세 칸 — 불변). 상수·차단기·`--apply-from` 대조·조건부 UPDATE·`CMP_*` 머리말·워크플로(5분 제한, +8초)·감시 ⑭ 전부 불변.

### 2-4. 시험·변이(필수 — `guards-must-be-mutation-tested`)

- `assign-completion.test.mjs` 에 추가: `altYearOf`(부번 0 → 본번만 / 부번 7 → 7 만 / 건물 1표 — 거래 20:3 이어도 건물 2:1 / 건물 안 동률은 표 없음 / 건물 사이 동률 null / 자료 없음 undefined / apt_seq 없으면 이름으로 건물) · `rowsNeedingAltYear`(연결 연도 있음 제외 · 동률 null 도 제외 · bjd 9자리·lot_main 0 제외 · 묶음 열쇠로 연도 있는 행 제외) · `planCompletionUpdates` + altYears(자기 값 우선 · 묶음 폴백 최빈 · 동률 → year_ambiguous · 불일치 → year_mismatch · 일치 → recent/future/multi_notice 통과 + flag alt_year · **연결 연도가 있으면 altYears 를 안 본다**) · `fetchAltYears` 가짜 sb(ops 순서 6개 · 동시 5 · 오류 throw · 자료 없음은 Map 에 없음) · main 흐름(요약 로그에 대체 조회 줄 · 계획 파일 flags). 입력은 운영 형식 그대로.
- 변이 최소 6(치환 스크립트 + `node --check` + `cmp` 원복 — `review-adv-cmp` 때와 같은 방법): ① 부번 필터 삭제 ② 건물 1표 → 행 수 최빈값 ③ 연결 연도가 있어도 altYears 를 봄 ④ alt 불일치를 무시(증거 없음 취급) ⑤ 묶음 폴백 삭제 ⑥ 동률 null 을 연도 0 으로 씀 → 각각 red 확인.
- 표적 시험 + `typecheck:scripts` + 감사 13 + 구현자 마지막 전체 1회(`npm run test` — 공용 모듈 변경 아님이지만 main 지문 가드가 있다면 갱신).

## 3. 운영 반영 순서(`data-changing-run-approval` §1~3·§5)

1. 구현 가지 코드로 본 폴더 `--env-file` 미리보기 `--out=.omc/artifacts/session626/alt-plan1.json` → 기대 = **바뀜 5(전부 12개월+ · alt_year 5)** — 명단은 §1 "새로 5"(해오름6단지 제일풍경채 `ah-2025910097` 202507→202406 · 중흥S-클래스 에듀하이 `ah-2026910025` 202604→202403 · 아산 금강펜테리움 `ah-2026910195` 202609→202507 · 용산 호반써밋 `ah-2026930016` 202608→202503 · 레이카운티 `ah-2026930017` 202606→202311). 다르면 그 차이만 보고(10/11 03:05 뒤 DB 가 바뀔 수 있음).
2. 전이표 = 그 5행 + 건너뜀 이유 전후표(`year_mismatch` 101→109 · `recent_unverified` 37→26 · `mixed_lots` 3→0 · `multi_notice_unverified` 19→15, minGap 1 기준) + 라이브 목록 노출·칩 변화 → 검사관 2인(적대 Opus + 맹점 Opus) → 사장님 승인. **이 단계(전이표 승인·검사관 확인)는 합치기 전에 끝낸다.**
3. **합친 뒤 처음 오는 KST 03:00(daily-deploy cron `0 18 * * *`) 전에** 사본 `alt-before.json`(id, completion, updated_at) + 역계획 → `--apply-from`(5행 < 차단기 10 이지만 명단 승인 경로로 통일) → 재조회 5/5 → 미리보기 "바뀜 0". 이걸 안 하면 03:05 자동 `--apply` 가 **사본 없이 5행을 쓴다**(5 < 차단기 10 이라 막히지 않는다).
4. **반영 뒤 세 시점**: ① 즉시 VIEW 값 ② 다음 03:00 굽기 — 5곳 준공 글자·칩(레이카운티 202311 → "입주완료") live-verify ③ 수집 회차는 YYYYMM 을 안 덮음. **10/22 연결 기대값(넣기 27·고치기 25)이 바뀐다** — 레이카운티 등 5행의 완공연도가 연결 연도 게이트를 통과하게 되므로 반영 직후 `assign-trade-links.mjs` 미리보기(읽기 전용)를 다시 떠 BACKLOG 10/22 줄을 갱신한다.
5. 합친 다음 날 03:05 자동 `--apply` = 바뀜 0 기대(이미 반영) · 감시 ⑭ 그대로.

## 4. 검사관·순서

구현 = `opus-coder`(Opus, 워크트리 `.claude/worktrees/s626-alt-year`) → 검사 = 적대 Opus(general-purpose, 수집기·DB — 변이 6 실측) + 맹점 Opus(`blindspot-critic`, 이 설계서 §2 대비 빠진 항목) → 보완 커밋은 새 동작이 있으면 1명 재검사 → PR → CI → §3-1·2(미리보기·전이표 승인·검사관 확인 — 합치기 전) → 합치기 → 합친 뒤 처음 오는 KST 03:00 전 §3-3 `--apply-from`.

## 5. 되돌리기

코드 = PR revert. 데이터 = `alt-before.json` 역계획(`--apply-from` 꼴, 5행). 대체 조회는 열쇠·연결 표·다른 표에 아무것도 쓰지 않는다.

## 6. 범위 밖(BACKLOG A-19 에 한 줄씩)

- **2차(1~11개월, 미리보기 221 → 대체 조회 뒤 231행)** + 그때 `MIN_GAP_MONTHS` 1 + **연도 없는 행(`no_year`)은 매일 `--apply` 에서 빼고 `--apply-from` 으로만**(BACKLOG 325 🟡2) — 사장님 결정 3: 이 PR 뒤 따로.
- 연결 표의 연도 게이트 순환(§1 마지막 줄) — 준공월 정정 뒤 10/22 회차가 스스로 푼다. 안 풀리면 지번 경로 비대칭 완화 검토.
- 전세만 있는 땅(umd_cd 없음)·bjd/지번 빈 53행·옛 건물 거래만 있는 19행 — 연결이 생기거나 사람 판정으로만.
- `parseCompletionDecisions` 가 `approved`·`why` 빈칸을 안 막음(BACKLOG 325 후속).

## 7. 사장님 결정(2026-10-11 06:1x)

1. 찾는 조건 = **본번+부번(우리 부번 0 이면 본번만) + 건물마다 1표 최빈값**(이름 문턱 없음).
2. 대체 조회 연도가 공고 연도와 다르면 **연결 표 연도와 똑같이 "안 바꿈"**(`year_mismatch`).
3. 순서 = **대체 조회 PR → 2차 승인 → 그때 "연도 없는 행은 승인 파일로만" 같이**.

## 8. 자가 점검(③ 플랜 검토)

- 맹점 후보: (a) 자기 행에 값이 없는데 묶음 행에 값이 있을 때 — 연결 열쇠와 같은 규칙으로 묶음 최빈(§2-1 3ⓑ). 탐침도 이 규칙이었다(가짜 열쇠가 자기 행에 붙어 `ownKeys` → 없으면 `members`). (b) `lot_sub` 가 문자열 "0"·null·0 세 꼴 — `lotNum` 꼴로 통일. (c) `bjd_code` 가 화성 옛 41590 이면 거래는 새 4코드 — 그 행은 조회 0건(정직한 자료 없음, `_trade-links.mjs` `sggCodesOf` 재사용은 범위 밖). (d) 탐침은 `method:"bundle"` 가짜 열쇠로 흉내 냈고 설계는 별도 맵 — 결과 수치(5/11/1)는 구현 뒤 미리보기로 다시 확인한다(§3-1). (e) 설계서 v1 의 "60에 닿은 행 0" 은 실측 없는 단정이었다(실제 11행 — 맹점 검사관 🟠1 · §2-2 정정).
- 할루 점검: 수치는 전부 `alt-variants.json`·`timing.mjs`·탐침 로그에서 옮겨 적음 · 줄 번호 `_trade-links.mjs:478-485`·`trade_deals.sql:36` 은 grep 으로 확인.
